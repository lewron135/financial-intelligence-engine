import os
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
import google.generativeai as genai

load_dotenv()

router = APIRouter(prefix="/market", tags=["AI Analyst"])

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

_cache: Dict[str, Tuple[float, Any]] = {}
CACHE_TTL = 300  # 5-minute cache


def _cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None


def _cache_set(key: str, data: Any) -> None:
    _cache[key] = (time.time(), data)


# ── Technical Indicators ──────────────────────────────────────────────────────

def _sma(closes: List[float], period: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        result[i] = sum(closes[i - period + 1 : i + 1]) / period
    return result


def _ema(closes: List[float], period: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(closes)
    if len(closes) < period:
        return result
    k = 2 / (period + 1)
    result[period - 1] = sum(closes[:period]) / period
    for i in range(period, len(closes)):
        result[i] = closes[i] * k + result[i - 1] * (1 - k)  # type: ignore[operator]
    return result


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(d, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_gain / avg_loss)), 2)


def _macd(closes: List[float]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    macd_line: List[Optional[float]] = [
        (ema12[i] - ema26[i])  # type: ignore[operator]
        if ema12[i] is not None and ema26[i] is not None
        else None
        for i in range(len(closes))
    ]
    valid_macd = [v for v in macd_line if v is not None]
    if len(valid_macd) < 9:
        return None, None, None
    first_idx = next(i for i, v in enumerate(macd_line) if v is not None)
    k = 2 / 10
    signal: List[Optional[float]] = [None] * len(closes)
    signal[first_idx + 8] = sum(valid_macd[:9]) / 9
    for i in range(first_idx + 9, len(closes)):
        signal[i] = macd_line[i] * k + signal[i - 1] * (1 - k)  # type: ignore[operator]
    last_macd = macd_line[-1]
    last_sig = signal[-1]
    last_hist = (last_macd - last_sig) if last_macd is not None and last_sig is not None else None  # type: ignore[operator]
    return (
        round(last_macd, 4) if last_macd is not None else None,
        round(last_sig, 4) if last_sig is not None else None,
        round(last_hist, 4) if last_hist is not None else None,
    )


def _atr(
    highs: List[Optional[float]],
    lows: List[Optional[float]],
    closes: List[float],
    period: int = 14,
) -> Optional[float]:
    """Wilder's ATR: smoothed average of True Range.

    Skips candles where high or low is None/zero — Yahoo Finance sometimes
    returns null OHLCV for market holidays, and zero substitution would
    corrupt the True Range calculation.
    """
    if len(closes) < period + 1 or not highs or not lows:
        return None
    true_ranges: List[float] = []
    for i in range(1, len(closes)):
        h, lo, prev_c = highs[i], lows[i], closes[i - 1]
        if not h or not lo or prev_c == 0.0:
            continue
        true_ranges.append(max(h - lo, abs(h - prev_c), abs(lo - prev_c)))
    if len(true_ranges) < period:
        return None
    atr = sum(true_ranges[:period]) / period
    for tr in true_ranges[period:]:
        atr = (atr * (period - 1) + tr) / period
    return round(atr, 4)


# ── Market & Pricing Helpers ──────────────────────────────────────────────────

def _detect_market(symbol: str) -> str:
    return "ID" if symbol.upper().endswith(".JK") else "US"


def _round_price(value: float, market: str) -> float:
    return round(value) if market == "ID" else round(value, 2)


# ── Signal & Confidence ───────────────────────────────────────────────────────

def _compute_signal_and_confidence(
    rsi: Optional[float],
    macd_hist: Optional[float],
    price: float,
    ma20: Optional[float],
    ma50: Optional[float],
) -> Tuple[str, int]:
    """Score ranges 10–95. BUY ≥ 65, SELL ≤ 40, else HOLD."""
    score = 50

    if rsi is not None:
        if rsi < 30:
            score += 15   # deeply oversold
        elif rsi < 50:
            score += 10   # approaching oversold
        elif rsi > 70:
            score -= 15   # overbought
        elif rsi > 60:
            score -= 5

    if macd_hist is not None:
        score += 10 if macd_hist > 0 else -10

    if ma20 is not None:
        score += 10 if price > ma20 else -10

    if ma50 is not None:
        score += 10 if price > ma50 else -10

    score = max(10, min(95, score))
    signal = "BUY" if score >= 65 else ("SELL" if score <= 40 else "HOLD")
    return signal, score


# ── Misc Helper ───────────────────────────────────────────────────────────────

def _fmt(d: dict, key: str) -> str:
    v = d.get(key, {})
    raw = (v.get("fmt") or v.get("raw")) if isinstance(v, dict) else v
    return str(raw) if raw is not None else "N/A"


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/analyze/{symbol}")
async def analyze_symbol(symbol: str):
    try:
        sym = symbol.upper()
        cache_key = f"quant_v1:{sym}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        async with httpx.AsyncClient(timeout=20) as client:
            chart_url = (
                f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
                "?range=3mo&interval=1d&includePrePost=false&events=div"
            )
            try:
                chart_resp = await client.get(chart_url, headers=YAHOO_HEADERS)
                chart_resp.raise_for_status()
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Yahoo chart fetch failed: {exc}")

            summary_url = (
                f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
                "?modules=defaultKeyStatistics,summaryDetail,financialData,assetProfile"
            )
            try:
                summary_resp = await client.get(summary_url, headers=YAHOO_HEADERS)
                summary_resp.raise_for_status()
                fund_raw = summary_resp.json()
            except Exception:
                fund_raw = {}

        chart_raw = chart_resp.json()
        result = chart_raw.get("chart", {}).get("result", [{}])[0]
        quote = result.get("indicators", {}).get("quote", [{}])[0]
        meta = result.get("meta", {})
        timestamps: List[int] = result.get("timestamp", [])

        closes: List[float] = [c or 0.0 for c in (quote.get("close") or [])]
        # Preserve None for missing H/L so _atr() can skip corrupt candles
        highs: List[Optional[float]] = [(h if h and h > 0 else None) for h in (quote.get("high") or [])]
        lows: List[Optional[float]] = [(lo if lo and lo > 0 else None) for lo in (quote.get("low") or [])]

        if not closes:
            raise HTTPException(status_code=404, detail=f"No chart data found for {sym}")

        # ── Indicators ────────────────────────────────────────────────────────
        rsi_val = _rsi(closes)
        sma20_series = _sma(closes, 20)
        sma50_series = _sma(closes, 50)
        ma20 = next((v for v in reversed(sma20_series) if v is not None), None)
        ma50 = next((v for v in reversed(sma50_series) if v is not None), None)
        macd_val, macd_sig, macd_hist = _macd(closes)
        atr_val = _atr(highs, lows, closes, period=14)

        price: float = meta.get("regularMarketPrice") or closes[-1]
        prev_close: float = meta.get("previousClose") or meta.get("chartPreviousClose") or price
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0
        currency = meta.get("currency", "USD")
        high52 = meta.get("fiftyTwoWeekHigh", "N/A")
        low52 = meta.get("fiftyTwoWeekLow", "N/A")

        # ── Market, TP, SL ────────────────────────────────────────────────────
        market = _detect_market(sym)
        take_profit: Optional[float] = None
        cut_loss: Optional[float] = None
        if atr_val is not None:
            take_profit = _round_price(price + 3.0 * atr_val, market)
            cut_loss = _round_price(price - 1.5 * atr_val, market)

        # ── Signal & Confidence ───────────────────────────────────────────────
        signal, confidence_score = _compute_signal_and_confidence(
            rsi_val, macd_hist, price, ma20, ma50
        )

        # ── Chart Data (last 60 bars for frontend) ────────────────────────────
        window = 60
        start = max(0, len(closes) - window)
        chart_data: List[Dict[str, Any]] = []
        for i in range(start, len(closes)):
            chart_data.append({
                "date": timestamps[i] if i < len(timestamps) else None,
                "close": round(closes[i], 4),
                "ma20": round(sma20_series[i], 4) if sma20_series[i] is not None else None,
                "ma50": round(sma50_series[i], 4) if sma50_series[i] is not None else None,
            })

        # ── Fundamentals ──────────────────────────────────────────────────────
        qs_result = (fund_raw.get("quoteSummary") or {}).get("result") or [{}]
        qs = qs_result[0] if qs_result else {}
        fin = qs.get("financialData") or {}
        stats = qs.get("defaultKeyStatistics") or {}
        profile = qs.get("assetProfile") or {}

        sector = profile.get("sector", "N/A")
        industry = profile.get("industry", "N/A")
        summary_blurb = (profile.get("longBusinessSummary") or "")[:600]

        # ── Gemini Prompt ─────────────────────────────────────────────────────
        above_ma20 = "Above" if ma20 and price > ma20 else "Below"
        above_ma50 = "Above" if ma50 and price > ma50 else "Below"

        quant_block = ""
        if atr_val is not None:
            quant_block = f"""
### Quant Engine Risk Levels (ATR-Based — use these exact numbers in your explanation)
- ATR 14-day: {atr_val:.2f} — this is the average daily price range (volatility proxy)
- Take Profit: {take_profit} (= Price + 3.0 × ATR → 1:2 Risk-Reward target)
- Cut Loss: {cut_loss} (= Price − 1.5 × ATR → 1.5× volatility buffer below price)
- Algorithmic Signal: {signal} | Confidence: {confidence_score}/100
"""

        prompt = f"""You are the Wondr Quant Engine — an Explainable AI (XAI) financial analyst for retail investors in Indonesia and the US.

Your job: write transparent, plain-language reasoning that explains WHY the computed signal and risk levels make sense, referencing only the data below. Structure your response in **markdown** with these sections:
1. **Signal Rationale** — why BUY/HOLD/SELL based on RSI, MACD, and moving average alignment
2. **Volatility Analysis** — explain what the ATR means in plain language and why the TP/SL levels are placed where they are
3. **Bull Case** — key upside catalysts from the data
4. **Bear Case** — key downside risks from the data
5. **Key Risks** — one paragraph on what could invalidate this signal

Do NOT invent numbers. Reference only what's provided. Be concise and educational.

## Stock: {sym} | Currency: {currency} | Sector: {sector} | Industry: {industry}

### Technical Snapshot
- Current Price: {price:.2f} ({change_pct:+.2f}% today)
- 52-Week Range: {low52} – {high52}
- RSI (14): {rsi_val if rsi_val is not None else "N/A"}
- MA20: {f"{ma20:.2f}" if ma20 else "N/A"} — price is {above_ma20} this level
- MA50: {f"{ma50:.2f}" if ma50 else "N/A"} — price is {above_ma50} this level
- MACD Line: {macd_val} | Signal Line: {macd_sig} | Histogram: {macd_hist}
{quant_block}
### Fundamental Snapshot
- Market Cap: {_fmt(stats, "marketCap")}
- Forward P/E: {_fmt(stats, "forwardPE")}
- Trailing P/E: {_fmt(stats, "trailingPE")}
- Total Revenue: {_fmt(fin, "totalRevenue")}
- Profit Margin: {_fmt(fin, "profitMargins")}
- Debt / Equity: {_fmt(fin, "debtToEquity")}
- Return on Equity: {_fmt(fin, "returnOnEquity")}
- Free Cash Flow: {_fmt(fin, "freeCashflow")}

### Business Summary
{summary_blurb}

Provide your transparent AI reasoning now:"""

        # ── Gemini call ───────────────────────────────────────────────────────
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured on server")

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(prompt)
        ai_reasoning: str = response.text

        payload: Dict[str, Any] = {
            "symbol": sym,
            "current_price": _round_price(price, market),
            "signal": signal,
            "confidence_score": confidence_score,
            "take_profit": take_profit,
            "cut_loss": cut_loss,
            "atr_volatility": round(atr_val, 2) if atr_val is not None else None,
            "ai_reasoning": ai_reasoning,
            "chart_data": chart_data,
        }
        _cache_set(cache_key, payload)
        return payload

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
