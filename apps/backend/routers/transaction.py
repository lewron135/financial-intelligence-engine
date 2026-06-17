import csv as _csv_mod
import io
import re
from datetime import datetime

import pdfplumber
from fastapi import APIRouter, Depends, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models.insight import Insight
from models.recommendation import GrowthRecommendation
from models.transaction import Transaction
from services.categorizer import TransactionCategorizer
from services.ml_pipeline import MLPipelineOrchestrator

router = APIRouter(prefix="/transactions", tags=["Transactions"])


class TransactionCreate(BaseModel):
    user_id: str
    amount: float
    category: str
    merchant_name: str


class StagedTransaction(BaseModel):
    """A single parsed-but-not-yet-saved transaction row."""
    date: str        # ISO "YYYY-MM-DD"
    description: str
    amount: float
    type: str        # "DB" or "CR"
    category: str


class BulkInsertRequest(BaseModel):
    user_id: str = "usr_123"
    transactions: list[StagedTransaction]


@router.post("/")
def create_transaction(
    transaction: TransactionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    db_transaction = Transaction(
        user_id=transaction.user_id,
        amount=transaction.amount,
        category=transaction.category,
        merchant_name=transaction.merchant_name,
    )
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)

    background_tasks.add_task(
        MLPipelineOrchestrator.run_pipeline,
        db_transaction.user_id,
        db_transaction.id,
        db,
    )

    return {
        "status": "success",
        "message": "Transaction recorded. ML Intelligence pipeline triggered in background.",
        "data": {
            "id": db_transaction.id,
            "user_id": db_transaction.user_id,
            "amount": db_transaction.amount,
            "category": db_transaction.category,
            "merchant_name": db_transaction.merchant_name,
            "timestamp": db_transaction.timestamp,
        },
    }


# ── BCA statement parser ──────────────────────────────────────────────────────

# Optional leading row-number (e.g. "1 " / "23 "), then DD/MM/YYYY, DD/MM/YY,
# or DD/MM/... (BCA PDFs truncate the year column with a literal ellipsis when
# the cell is too narrow to render all four digits).
_DATE_RE = re.compile(
    r'^(?:\d{1,3}\s+)?(\d{2}[/\-]\d{2}[/\-](?:\d{2,4}|\.\.\.))\s+(.*)',
    re.DOTALL,
)

# BCA QR/tap transactions embed the date as "TGL: MMDD" inside the description
# cell (e.g. "TGL: 0611 QR 915 TRANSAKSI DEBIT"). Captures the two 2-digit parts.
_TGL_RE = re.compile(r'\bTGL[.:\s]+(\d{2})(\d{2})\b', re.I)

# BI-FAST transfers use "TANGGAL :DD/MM" instead of TGL: MMDD.
# Example: "PEND TANGGAL :10/06 TRANSFER DR 009 ..."
_TANGGAL_RE = re.compile(r'\bTANGGAL\s*:\s*(\d{2})/(\d{2})\b', re.I)

# Amount in Indonesian (1.234.567,89) or Western (1,234,567.89) notation
# followed by DB or CR with optional whitespace between.
_AMOUNT_TYPE_RE = re.compile(
    r'(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(DB|CR)(?=\s|$)',
    re.IGNORECASE,
)

# Lines to discard: table headers, account-info, page dividers.
# Deliberately narrow — "debit"/"kredit" alone are too ambiguous to skip.
_SKIP_RE = re.compile(
    r'^(tanggal\b|keterangan\b|mutasi\b|saldo\b|nomor\b|rekening\b|'
    r'periode\b|halaman\b|page\b|cabang\b|tgl\s+ket|tgl\s+keterangan|'
    r'---+|\*{3,}|={3,}|nama\s*:|alamat\s*:|informasi\s+mutasi)',
    re.I,
)

# Separator between vertically-stacked transactions inside a single table cell.
# pdfplumber merges adjacent rows when the PDF has no horizontal rule between
# them.  The resulting cells look like "PEND\n\n\nPEND\n\n\n10/06/...".
# A blank line (two or more consecutive newlines, possibly with spaces) marks
# the boundary; a single "\n" inside a description (e.g. "TGL: 0610\n QR 918")
# must NOT be treated as a separator.
_STACK_SEP = re.compile(r'\n[ \t]*\n')


def _parse_amount(raw: str) -> float:
    """Convert Indonesian (1.234.567,89) or Western (1,234,567.89) notation to float."""
    s = raw.strip()
    if ',' in s and '.' in s:
        if s.rindex(',') > s.rindex('.'):
            # Indonesian: dots = thousands, comma = decimal
            s = s.replace('.', '').replace(',', '.')
        else:
            # Western: commas = thousands, dot = decimal
            s = s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    return float(s)


def _normalize_cell(raw) -> str:
    """Collapse ALL whitespace inside a single-transaction cell value to spaces."""
    return ' '.join(str(raw or '').split())


def _unzip_stacked_row(row: list) -> list[list]:
    """
    pdfplumber sometimes groups multiple PDF rows into one table row when the
    PDF has no horizontal rule between them.  Each cell then contains vertically
    stacked values separated by blank lines:

        Col 0: "PEND\\n\\n\\nPEND\\n\\n\\n10/06/..."
        Col 1: "TGL: 0610\\n QR 918\\n\\n\\nTGL: 0610\\n QR 919\\n\\n\\n..."
        Col 2: "400,000.00\\n\\n\\n16,000.00\\n\\n\\n..."
        Col 3: "CR\\n\\n\\nDB\\n\\n\\n..."

    This function splits each cell on _STACK_SEP (blank lines) and zips the
    resulting sub-items back together horizontally, yielding one independent
    row per stacked transaction.

    Internal single-newlines inside a description ("TGL: 0610\\n QR 918") are
    preserved as-is; _normalize_cell collapses them to spaces afterwards.

    If no blank-line separator is found, the row is returned unchanged (wrapped
    in a single-element list so the caller always gets list[list]).
    """
    split_cols = [_STACK_SEP.split(str(c or '')) for c in row]
    depth = max(len(col) for col in split_cols)
    if depth <= 1:
        return [row]
    # Pad shorter columns so zip produces full rows
    padded = [col + [''] * (depth - len(col)) for col in split_cols]
    return [list(sub_row) for sub_row in zip(*padded)]


def _sanitize_csv_text(raw: str) -> str:
    """
    BCA PDFs often encode their mutation table as RFC-4180 CSV text directly
    inside the PDF stream.  Raw extract_text() output looks like:

        "PEND\\n","TGL: 0611 QR 915\\n TRANSAKSI DEBIT\\n","20,000.00\\n","DB\\n"
        "05/06/2026\\n","TRANSFER DR 013 AJAIB\\n","1,889,081.00\\n","CR\\n"

    Problems this causes with plain string ops:
      • Lines start with `"` so ^-anchored regexes never match.
      • Embedded newlines inside quoted fields split one row into many fragments.
      • Intra-field commas in amounts ("1,889,081.00") would be split if we
        just strip quotes and split on commas naively.

    This function uses Python's csv.reader — the correct tool for RFC-4180 —
    which handles all three problems in one pass:
      • Strips surrounding quotes.
      • Reunites multi-line fields (embedded \\n inside a quoted value).
      • Keeps intra-field commas intact (1,889,081.00 stays one token).

    Each parsed row is reassembled as double-space-joined cells so it feeds
    cleanly into _normalize_tgl_line and _parse_bca_statement.

    Fast path: if the stripped text does not start with `"` this is not
    CSV-quoted content and the original string is returned unchanged.
    """
    stripped = raw.strip()
    if not stripped or not stripped.startswith('"'):
        return raw

    rows: list[str] = []
    try:
        for raw_row in _csv_mod.reader(io.StringIO(raw)):
            # A single CSV row may contain multiple stacked transactions when
            # pdfplumber merged adjacent PDF rows into one quoted cell block.
            for row in _unzip_stacked_row(raw_row):
                cells = [_normalize_cell(c) for c in row]
                cells = [c for c in cells if c]
                if cells:
                    rows.append('  '.join(cells))
    except Exception:
        return raw  # csv parse failed — return original so caller can still try

    return '\n'.join(rows) if rows else raw


def _normalize_tgl_line(line: str, year: int) -> str:
    """
    Rewrite lines with an embedded date indicator so they start with DD/MM/YYYY,
    making them compatible with the date-at-start scanner in _parse_bca_statement.

    Handles two BCA date-embedding formats:

    1. TGL: MMDD  — QR/tap transactions
       "PEND TGL: 0611 @QR915 00000.00nasi goren 20,000.00 DB"
       → "11/06/2026  @QR915 00000.00nasi goren 20,000.00 DB"

    2. TANGGAL :DD/MM  — BI-FAST transfers
       "PEND TANGGAL :10/06 TRANSFER DR 009 JOSPE... 400,000.00 CR"
       → "10/06/2026  TRANSFER DR 009 JOSPE... 400,000.00 CR"

    Everything before the matched date token (including "PEND") is discarded.
    Lines with neither pattern are returned unchanged.
    """
    # ── TGL: MMDD ────────────────────────────────────────────────────────────
    m = _TGL_RE.search(line)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        for mo, da in [(a, b), (b, a)]:
            if 1 <= mo <= 12 and 1 <= da <= 31:
                try:
                    parsed = datetime(year, mo, da)
                    after = line[m.end():].strip()
                    return (
                        f"{parsed.strftime('%d/%m/%Y')}  {after}"
                        if after else parsed.strftime('%d/%m/%Y')
                    )
                except ValueError:
                    continue

    # ── TANGGAL :DD/MM ───────────────────────────────────────────────────────
    m = _TANGGAL_RE.search(line)
    if m:
        dd, mm = int(m.group(1)), int(m.group(2))
        try:
            parsed = datetime(year, mm, dd)
            after = line[m.end():].strip()
            return (
                f"{parsed.strftime('%d/%m/%Y')}  {after}"
                if after else parsed.strftime('%d/%m/%Y')
            )
        except ValueError:
            pass

    return line


def _clean_description(desc: str) -> str:
    """
    Strip OCR noise from a raw description string so the staging table and
    categorizer see clean merchant names / transfer descriptions.

    Removed patterns (in order):
      • QR terminal refs:    "QR 918", "QRC 014", "QR0O08" (OCR typo for QR008)
      • Zero-saldo noise:    "00000.00" glued to the start of the merchant name
      • Non-zero saldo glued to word: "50000.00MERCHANT" → "MERCHANT"
      • Transfer ref codes:  "0706/FTFVA/WS9503170001/"
      • Artefact chars:      @  —  —_  =
      • Hanging double-dash: " - - "
    """
    # QR/QRC terminal reference numbers
    desc = re.sub(r'\bQR[CO]?\s*[0-9O]{1,6}\s*', '', desc, flags=re.I)
    # Zero saldo placeholder (00000.xx) with no space before merchant
    desc = re.sub(r'\b0{4,}\.\d+\s*', '', desc)
    # Non-zero saldo placeholder glued to next word (50000.00MERCHANT)
    desc = re.sub(r'\b\d{4,}\.\d{2,}(?=[A-Za-z])', '', desc)
    # Transfer reference codes (NNNN/AAAA/BBBBB...)
    desc = re.sub(r'\b\d{4}/[A-Za-z]{2,}/\S+\s*', '', desc)
    # Artefact chars
    desc = re.sub(r'[@=]|—[_]?', ' ', desc)
    # Double-dash artefact
    desc = re.sub(r'\s+-\s+-\s*', ' ', desc)
    return ' '.join(desc.split()).strip()


def _ocr_pdf(content: bytes) -> str:
    """
    Convert each page of an image-based PDF to a PIL image at 300 DPI and run
    Tesseract OCR.  Returns the concatenated plain-text output for all pages.

    Only called when pdfplumber finds zero character objects across all pages,
    meaning the PDF has no embedded text layer (e.g. BCA MutasiBCA exports).
    """
    from pdf2image import convert_from_bytes
    import pytesseract

    images = convert_from_bytes(content, dpi=300)
    return '\n'.join(
        pytesseract.image_to_string(img, lang='eng', config='--psm 6')
        for img in images
    )


def _extract_pdf_text(content: bytes) -> str:
    """
    Extract text from a PDF, automatically choosing the best strategy:

    • Image-based PDF (no text layer): use Tesseract OCR via _ocr_pdf.
    • Text-based PDF with table structure: use pdfplumber table extraction
      with the stacked-row unzipper.
    • Text-based PDF with plain text: fall back to pdfplumber extract_text
      + CSV sanitiser.
    """
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        # Detect image-based PDFs: zero char objects across every page.
        if sum(len(p.chars) for p in pdf.pages) == 0:
            return _ocr_pdf(content)

        parts: list[str] = []
        for page in pdf.pages:
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for raw_row in table:
                        if not raw_row:
                            continue
                        # Expand rows that pdfplumber merged due to missing
                        # horizontal rules in the PDF, then normalize each cell.
                        for row in _unzip_stacked_row(raw_row):
                            cells = [_normalize_cell(c) for c in row]
                            cells = [c for c in cells if c]
                            if cells:
                                parts.append('  '.join(cells))
            else:
                page_text = page.extract_text(x_tolerance=3, y_tolerance=3) or ''
                parts.append(_sanitize_csv_text(page_text))
    return '\n'.join(parts)


def _parse_bca_statement(text: str) -> list[dict]:
    """
    Parse BCA MutasiBCA text (from PDF or plain-text export) into transaction dicts.

    Pre-processing converts TGL: MMDD cells to DD/MM/YYYY so both the
    standard KlikBCA format and the QR/tap-based table format are handled
    by the same date-at-start scanner below.
    """
    year = datetime.now().year

    # Pre-process: convert "PEND  TGL: 0611 …" → "06/11/YYYY …"
    lines = [_normalize_tgl_line(ln.strip(), year) for ln in text.splitlines()]

    transactions: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if not line or _SKIP_RE.match(line):
            i += 1
            continue

        date_m = _DATE_RE.match(line)
        if not date_m:
            i += 1
            continue

        date_str = date_m.group(1).replace('-', '/')
        # BCA PDFs sometimes truncate the year column as "..." when the cell is
        # too narrow.  Replace it with the statement year so strptime can parse.
        if date_str.endswith('...'):
            date_str = date_str[:-3] + str(year)
        accumulated = date_m.group(2)
        j = i + 1

        amount_m = _AMOUNT_TYPE_RE.search(accumulated)
        while not amount_m and j < min(i + 6, len(lines)):
            next_line = lines[j]
            if not next_line or _SKIP_RE.match(next_line) or _DATE_RE.match(next_line):
                break
            accumulated = (accumulated + ' ' + next_line).strip()
            amount_m = _AMOUNT_TYPE_RE.search(accumulated)
            j += 1

        if not amount_m:
            i = j
            continue

        description = accumulated[: amount_m.start()].strip()
        description = re.sub(r'^\d+\s+', '', description).strip()
        description = _clean_description(description)

        try:
            fmt = '%d/%m/%y' if len(date_str.split('/')[-1]) == 2 else '%d/%m/%Y'
            parsed_date = datetime.strptime(date_str, fmt)
        except ValueError:
            i = j
            continue

        try:
            amount = _parse_amount(amount_m.group(1))
        except ValueError:
            i = j
            continue

        if description and amount > 0:
            transactions.append({
                'date': parsed_date,
                'description': description[:255],
                'amount': amount,
                'type': amount_m.group(2).upper(),
            })

        i = j

    return transactions


# ── Shared file-reading helper ────────────────────────────────────────────────

async def _get_raw_text(file: UploadFile) -> str:
    """Read an uploaded PDF or TXT file and return sanitized plain text."""
    filename = file.filename or ""
    if not re.search(r'\.(pdf|txt)$', filename, re.I):
        raise HTTPException(
            status_code=422,
            detail="Only .pdf or .txt bank statement files are supported.",
        )
    content = await file.read()
    if filename.lower().endswith(".pdf"):
        try:
            return _extract_pdf_text(content)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Failed to read PDF: {exc}")
    return _sanitize_csv_text(content.decode("utf-8", errors="replace"))


# ── Upload endpoint ───────────────────────────────────────────────────────────

@router.post("/upload-pdf")
async def upload_bank_statement(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(default="usr_123"),
    db: Session = Depends(get_db),
):
    filename = file.filename or ""
    raw_text = await _get_raw_text(file)

    parsed = _parse_bca_statement(raw_text)
    if not parsed:
        return {
            "status": "no_data",
            "transactions_imported": 0,
            "message": (
                "No transactions could be extracted from the file. "
                "Ensure it is a BCA MutasiBCA PDF or plain-text export."
            ),
        }

    saved: list[Transaction] = []
    for tx in parsed:
        category = TransactionCategorizer.predict_category(tx["description"])
        db_tx = Transaction(
            user_id=user_id,
            amount=tx["amount"],
            category=category,
            merchant_name=tx["description"],
            timestamp=tx["date"],
        )
        db.add(db_tx)
        saved.append(db_tx)

    db.commit()
    for db_tx in saved:
        db.refresh(db_tx)

    if saved:
        background_tasks.add_task(
            MLPipelineOrchestrator.run_pipeline,
            user_id,
            saved[-1].id,
            db,
        )

    return {
        "status": "success",
        "transactions_imported": len(saved),
        "message": (
            f"Successfully imported {len(saved)} transaction(s) from '{filename}'. "
            "ML pipeline triggered in background."
        ),
    }


# ── 2-Step Staging: parse-only ────────────────────────────────────────────────

@router.post("/parse-only")
async def parse_statement_only(file: UploadFile = File(...)):
    """
    Parse a bank statement PDF/TXT and return a JSON preview of transactions
    WITHOUT saving anything to the database or triggering the ML pipeline.
    The caller uses this to show a staging table, then calls /bulk-insert to commit.
    """
    filename = file.filename or ""
    raw_text = await _get_raw_text(file)

    parsed = _parse_bca_statement(raw_text)
    if not parsed:
        return {"status": "no_data", "count": 0, "transactions": []}

    transactions = [
        {
            "date": tx["date"].strftime("%Y-%m-%d"),
            "description": tx["description"],
            "amount": tx["amount"],
            "type": tx["type"],
            "category": TransactionCategorizer.predict_category(tx["description"]),
        }
        for tx in parsed
    ]

    return {"status": "success", "count": len(transactions), "transactions": transactions}


# ── 2-Step Staging: bulk-insert ───────────────────────────────────────────────

@router.post("/bulk-insert")
def bulk_insert_transactions(
    payload: BulkInsertRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Commit a pre-validated list of transactions to the database and trigger the
    ML pipeline.  The list is expected to come from a prior /parse-only call,
    possibly after the user has reviewed or edited it in the staging UI.
    """
    if not payload.transactions:
        raise HTTPException(status_code=422, detail="No transactions provided.")

    saved: list[Transaction] = []
    for tx in payload.transactions:
        try:
            parsed_date = datetime.strptime(tx.date, "%Y-%m-%d")
        except ValueError:
            parsed_date = datetime.now()

        db_tx = Transaction(
            user_id=payload.user_id,
            amount=tx.amount,
            category=tx.category,
            merchant_name=tx.description,
            timestamp=parsed_date,
        )
        db.add(db_tx)
        saved.append(db_tx)

    db.commit()
    for db_tx in saved:
        db.refresh(db_tx)

    if saved:
        # Stage 1 (Isolation Forest) and Stage 3 (Rule Engine) are user-scoped:
        # one pipeline call is enough regardless of how many rows were inserted.
        # Stage 2 (BillForecaster) fires per-transaction — run it for every
        # bills/utilities row in the batch so none are missed.
        background_tasks.add_task(
            MLPipelineOrchestrator.run_pipeline,
            payload.user_id,
            saved[-1].id,
            db,
        )
        for db_tx in saved[:-1]:
            if db_tx.category in ("bills", "utilities"):
                from services.bill_forecaster import BillForecasterService
                background_tasks.add_task(
                    BillForecasterService.forecast_upcoming_bills,
                    payload.user_id,
                    db,
                )

    return {
        "status": "success",
        "transactions_imported": len(saved),
        "message": (
            f"Successfully committed {len(saved)} transaction(s). "
            "ML pipeline triggered in background."
        ),
    }


# ── Hard Reset ────────────────────────────────────────────────────────────────

@router.delete("/reset")
def hard_reset(db: Session = Depends(get_db)):
    """
    Wipe all application data from the three core tables so the user can start
    a completely fresh simulation.  Returns row counts for transparency.
    """
    n_tx  = db.query(Transaction).delete()
    n_ins = db.query(Insight).delete()
    n_rec = db.query(GrowthRecommendation).delete()
    db.commit()
    return {
        "status": "success",
        "message": "Database wiped.",
        "deleted": {
            "transactions": n_tx,
            "insights": n_ins,
            "recommendations": n_rec,
        },
    }
