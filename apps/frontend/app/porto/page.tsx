"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ComposedChart,
  AreaChart,
  BarChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  BarChart2,
  BookOpen,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Info,
  Layers,
  Wallet,
  PlusCircle,
  Trash2,
  Pencil,
  Save,
  X,
  Sparkles,
  Search,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

import { WATCHLIST } from "@/constants/watchlist";
import { calcSMA, calcRSI, calcMACD } from "@/lib/market/indicators";
import { generateAnalysis } from "@/lib/market/scoring";
import type {
  ChartData,
  StockMeta,
  Analysis,
  RecommendationLevel,
  PortfolioHolding,
  QuantAnalysis,
} from "@/types/market";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const USER_ID = "usr_123";

// ─── Utilities ─────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtPrice(price: number, currency: string): string {
  if (currency === "IDR") {
    return price.toLocaleString("id-ID", { maximumFractionDigits: 0 });
  }
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtVol(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return vol.toString();
}

function recColors(rec: RecommendationLevel): string {
  switch (rec) {
    case "STRONG BUY":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "BUY":
      return "bg-green-100 text-green-800 border-green-200";
    case "HOLD":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "REDUCE":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "AVOID":
      return "bg-red-100 text-red-800 border-red-200";
    case "AVERAGE DOWN":
      return "bg-teal-100 text-teal-800 border-teal-200";
    case "TAKE PROFIT":
      return "bg-cyan-100 text-cyan-800 border-cyan-200";
    case "CUT LOSS":
      return "bg-rose-100 text-rose-800 border-rose-200";
    case "HOLD (No Buying Power)":
      return "bg-amber-100 text-amber-700 border-amber-200";
  }
}

function rsiBadge(rsi: number | null): string {
  if (rsi === null) return "bg-gray-100 text-gray-500";
  if (rsi < 35) return "bg-emerald-100 text-emerald-700 font-bold";
  if (rsi > 65) return "bg-red-100 text-red-700 font-bold";
  return "bg-gray-100 text-gray-600";
}

// ─── Yahoo Finance parser ───────────────────────────────────────────────────

function parseYahoo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
): { meta: StockMeta; chartData: ChartData[] } | null {
  try {
    const result = raw?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const m = result.meta ?? {};

    const rawClose: (number | null)[] = quote.close ?? [];
    const closes = rawClose.map((c) => c ?? 0);

    const ma20 = calcSMA(closes, 20);
    const ma50 = calcSMA(closes, 50);
    const ma200 = calcSMA(closes, 200);
    const rsiArr = calcRSI(closes);
    const { macdLine, macdSignal, macdHist } = calcMACD(closes);

    const chartData: ChartData[] = timestamps.map((ts, i) => ({
      timestamp: ts,
      label: fmtDate(ts),
      open: (quote.open?.[i] as number) ?? 0,
      high: (quote.high?.[i] as number) ?? 0,
      low: (quote.low?.[i] as number) ?? 0,
      close: closes[i],
      volume: (quote.volume?.[i] as number) ?? 0,
      ma20: ma20[i],
      ma50: ma50[i],
      ma200: ma200[i],
      rsi: rsiArr[i],
      macdHist: macdHist[i],
      macdLine: macdLine[i],
      macdSignal: macdSignal[i],
    }));

    const prevClose: number =
      m.previousClose ?? m.chartPreviousClose ?? m.regularMarketPrice ?? 0;
    const price: number = m.regularMarketPrice ?? 0;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    const meta: StockMeta = {
      symbol: m.symbol ?? "",
      currency: m.currency ?? "USD",
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: changePct,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? 0,
      fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? 0,
      regularMarketVolume: m.regularMarketVolume ?? 0,
    };

    return { meta, chartData };
  } catch {
    return null;
  }
}

// ─── State types ────────────────────────────────────────────────────────────

interface RowData {
  symbol: string;
  name: string;
  region: "ID" | "US";
  meta: StockMeta | null;
  chartData: ChartData[];
  rsi: number | null;
  analysis: Analysis | null;
  loading: boolean;
  error: boolean;
}

interface PortfolioState {
  cashBalance: number;
  holdings: PortfolioHolding[];
}

// ─── Shared UI pieces ──────────────────────────────────────────────────────

function RecBadge({ rec }: { rec: RecommendationLevel }) {
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border tracking-tight whitespace-nowrap ${recColors(rec)}`}
    >
      {rec}
    </span>
  );
}

function SignalIcon({ type }: { type: "bullish" | "bearish" | "neutral" }) {
  if (type === "bullish")
    return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (type === "bearish")
    return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <MinusCircle className="w-4 h-4 text-gray-400 shrink-0" />;
}

// ─── Tab 1: Watchlist ──────────────────────────────────────────────────────

function WatchlistTab({
  rows,
  onViewChart,
  onAnalyze,
}: {
  rows: RowData[];
  onViewChart: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {["Symbol", "Company", "Price", "1D Change", "RSI(14)", "Signal", ""].map(
                (h) => (
                  <th
                    key={h}
                    className={`px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider ${
                      h === "Price" || h === "1D Change"
                        ? "text-right"
                        : h === "RSI(14)" || h === "Signal"
                        ? "text-center"
                        : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr
                key={row.symbol}
                className="hover:bg-indigo-50/30 transition-colors"
              >
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-gray-900">
                      {row.symbol}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        row.region === "ID"
                          ? "bg-red-50 text-red-600"
                          : "bg-blue-50 text-blue-600"
                      }`}
                    >
                      {row.region}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-4 text-gray-500 text-xs max-w-[180px] truncate">
                  {row.name}
                </td>
                <td className="px-5 py-4 text-right">
                  {row.loading ? (
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-20 ml-auto" />
                  ) : row.error || !row.meta ? (
                    <span className="text-gray-400 text-xs">—</span>
                  ) : (
                    <span className="font-mono font-semibold text-gray-900">
                      {row.meta.currency === "USD" ? "$" : ""}
                      {fmtPrice(row.meta.regularMarketPrice, row.meta.currency)}
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  {row.loading ? (
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-14 ml-auto" />
                  ) : row.error || !row.meta ? (
                    <span className="text-gray-400 text-xs">—</span>
                  ) : (
                    <span
                      className={`flex items-center justify-end gap-1 font-semibold text-sm ${
                        row.meta.regularMarketChangePercent >= 0
                          ? "text-emerald-600"
                          : "text-red-500"
                      }`}
                    >
                      {row.meta.regularMarketChangePercent >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      {row.meta.regularMarketChangePercent >= 0 ? "+" : ""}
                      {row.meta.regularMarketChangePercent.toFixed(2)}%
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-center">
                  {row.loading ? (
                    <div className="h-5 bg-gray-100 rounded-full animate-pulse w-10 mx-auto" />
                  ) : row.rsi !== null ? (
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-xs ${rsiBadge(row.rsi)}`}
                    >
                      {row.rsi.toFixed(0)}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-center">
                  {row.loading ? (
                    <div className="h-5 bg-gray-100 rounded-full animate-pulse w-20 mx-auto" />
                  ) : row.analysis ? (
                    <RecBadge rec={row.analysis.recommendation} />
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onViewChart(row.symbol)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                    >
                      <Activity className="w-3 h-3" />
                      Chart
                    </button>
                    <button
                      onClick={() => onAnalyze(row.symbol)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      Analyze
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 text-center">
        Data via Yahoo Finance · FastAPI cache 60s · IDR prices in Rupiah
      </p>
    </div>
  );
}

// ─── Chart tooltip ─────────────────────────────────────────────────────────

function PriceTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) =>
          p.value != null && (
            <div key={p.dataKey} className="flex justify-between gap-3">
              <span style={{ color: p.color }} className="truncate">
                {p.name}
              </span>
              <span className="font-mono font-semibold text-gray-900 ml-auto">
                {typeof p.value === "number" ? fmtPrice(p.value, currency) : "—"}
              </span>
            </div>
          )
      )}
    </div>
  );
}

// ─── Scorecard ─────────────────────────────────────────────────────────────

function ScoreCard({
  analysis,
  meta,
}: {
  analysis: Analysis;
  meta: StockMeta;
}) {
  const scoreColor =
    analysis.score >= 4
      ? "text-emerald-600"
      : analysis.score >= 0
      ? "text-amber-600"
      : "text-red-500";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
            Analysis Score
          </p>
          <span className={`text-5xl font-black leading-none ${scoreColor}`}>
            {analysis.score > 0 ? "+" : ""}
            {analysis.score}
          </span>
          <span className="text-sm text-gray-400 ml-1">/ max 10</span>
        </div>
        <div className="text-right">
          <RecBadge rec={analysis.recommendation} />
          <p className="text-[10px] text-gray-400 mt-2">Outlook</p>
        </div>
      </div>

      {meta.fiftyTwoWeekHigh > 0 && meta.fiftyTwoWeekLow > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-400 mb-1.5">
            <span>52W Low: {fmtPrice(meta.fiftyTwoWeekLow, meta.currency)}</span>
            <span>52W High: {fmtPrice(meta.fiftyTwoWeekHigh, meta.currency)}</span>
          </div>
          <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="absolute h-2 rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400 w-full" />
            {(() => {
              const range = meta.fiftyTwoWeekHigh - meta.fiftyTwoWeekLow;
              const pct =
                range > 0
                  ? ((meta.regularMarketPrice - meta.fiftyTwoWeekLow) / range) * 100
                  : 50;
              return (
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-indigo-600 rounded-full shadow"
                  style={{ left: `${Math.min(Math.max(pct, 4), 96)}%` }}
                />
              );
            })()}
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Signals
        </p>
        {analysis.signals.map((sig, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 p-3 rounded-xl border ${
              sig.type === "bullish"
                ? "bg-emerald-50 border-emerald-100"
                : sig.type === "bearish"
                ? "bg-red-50 border-red-100"
                : "bg-gray-50 border-gray-100"
            }`}
          >
            <SignalIcon type={sig.type} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-bold text-gray-900">{sig.label}</span>
                <span
                  className={`text-[10px] font-bold ${
                    sig.score > 0
                      ? "text-emerald-600"
                      : sig.score < 0
                      ? "text-red-500"
                      : "text-gray-400"
                  }`}
                >
                  {sig.score > 0 ? `+${sig.score}` : sig.score || ""}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                {sig.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab 2: Chart View ─────────────────────────────────────────────────────

const RANGES = [
  { label: "1M", value: "1mo", interval: "1d" },
  { label: "3M", value: "3mo", interval: "1d" },
  { label: "6M", value: "6mo", interval: "1d" },
  { label: "1Y", value: "1y", interval: "1wk" },
  { label: "2Y", value: "2y", interval: "1wk" },
];

function ChartTab({
  rows,
  selectedSymbol,
  onSelectSymbol,
  chartData,
  meta,
  analysis,
  chartRange,
  onRangeChange,
  loading,
  onAnalyze,
}: {
  rows: RowData[];
  selectedSymbol: string;
  onSelectSymbol: (s: string) => void;
  chartData: ChartData[];
  meta: StockMeta | null;
  analysis: Analysis | null;
  chartRange: string;
  onRangeChange: (r: string) => void;
  loading: boolean;
  onAnalyze: (symbol: string) => void;
}) {
  const currency = meta?.currency ?? "USD";
  const tickEvery = Math.max(1, Math.floor(chartData.length / 7));
  const priceFmt = (v: number) => fmtPrice(v, currency);

  const macdCells = chartData.map((d, i) => (
    <Cell
      key={i}
      fill={(d.macdHist ?? 0) >= 0 ? "#10b981" : "#ef4444"}
      fillOpacity={0.8}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {rows.map((row) => (
              <button
                key={row.symbol}
                onClick={() => onSelectSymbol(row.symbol)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  row.symbol === selectedSymbol
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {row.symbol}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => onRangeChange(r.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    chartRange === r.value
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => onAnalyze(selectedSymbol)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              <Sparkles className="w-3 h-3" />
              Analyze Further
            </button>
          </div>
        </div>

        {meta && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50 flex-wrap">
            <div>
              <span className="font-mono font-black text-gray-900 text-lg">
                {meta.currency === "USD" ? "$" : ""}
                {fmtPrice(meta.regularMarketPrice, meta.currency)}
              </span>
              <span
                className={`ml-2 text-sm font-semibold ${
                  meta.regularMarketChangePercent >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {meta.regularMarketChangePercent >= 0 ? "+" : ""}
                {meta.regularMarketChangePercent.toFixed(2)}%
              </span>
            </div>
            <span className="text-xs text-gray-400">Vol: {fmtVol(meta.regularMarketVolume)}</span>
            <span className="text-xs text-gray-400">Currency: {meta.currency}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
          <p className="text-sm text-gray-400">Loading market data…</p>
        </div>
      ) : chartData.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 flex flex-col items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
          <p className="text-sm text-gray-400">
            No data — backend or Yahoo Finance may be unavailable.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-0 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
                Price &amp; Moving Averages
              </span>
            </div>
            <div className="px-2 pt-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} syncId="market" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickEvery} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={priceFmt} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={72} domain={["auto", "auto"]} />
                  <Tooltip content={<PriceTooltip currency={currency} />} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                  <Area type="monotone" dataKey="close" name="Close" stroke="#6366f1" fill="url(#priceGrad)" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#6366f1" }} />
                  <Line type="monotone" dataKey="ma20" name="MA20" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="ma50" name="MA50" stroke="#8b5cf6" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="ma200" name="MA200" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="px-5 pt-3 pb-0">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">RSI (14)</span>
            </div>
            <div className="px-2 pt-1">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={chartData} syncId="market" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickEvery} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [typeof v === "number" ? v.toFixed(1) : v, "RSI"]}
                    labelFormatter={(l) => l}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 2" strokeWidth={1} />
                  <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 2" strokeWidth={1} />
                  <Area type="monotone" dataKey="rsi" name="RSI" stroke="#6366f1" fill="url(#rsiGrad)" strokeWidth={1.5} dot={false} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="px-5 pt-3 pb-0">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">MACD (12, 26, 9)</span>
            </div>
            <div className="px-2 pt-1">
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={chartData} syncId="market" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickEvery} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={48} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any, n: any) => [typeof v === "number" ? v.toFixed(4) : v, n]}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <ReferenceLine y={0} stroke="#d1d5db" strokeWidth={1} />
                  <Bar dataKey="macdHist" name="Histogram" maxBarSize={6}>{macdCells}</Bar>
                  <Line type="monotone" dataKey="macdLine" name="MACD" stroke="#6366f1" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="macdSignal" name="Signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="px-5 pt-3 pb-0">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Volume</span>
            </div>
            <div className="px-2 pt-1 pb-4">
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={chartData} syncId="market" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickEvery} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtVol} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [typeof v === "number" ? fmtVol(v) : v, "Volume"]}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <Bar dataKey="volume" name="Volume" fill="#c7d2fe" maxBarSize={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {analysis && meta && <ScoreCard analysis={analysis} meta={meta} />}
        </>
      )}
    </div>
  );
}

// ─── Tab 3: Recommendations ────────────────────────────────────────────────

function RecommendationsTab({ rows }: { rows: RowData[] }) {
  const loaded = rows.filter((r) => !r.loading && !r.error && r.analysis);
  const longBuys = loaded.filter(
    (r) => r.analysis!.recommendation === "STRONG BUY" || r.analysis!.recommendation === "BUY"
  );
  const shortOpp = loaded.filter(
    (r) => r.analysis!.recommendation === "HOLD" && r.analysis!.score > 0
  );
  const avoidNow = loaded.filter(
    (r) => r.analysis!.recommendation === "REDUCE" || r.analysis!.recommendation === "AVOID"
  );
  const pending = rows.filter((r) => r.loading).length;

  function RecRow({ row }: { row: RowData }) {
    const sig = row.analysis!.signals[0];
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-100 bg-white hover:border-indigo-100 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono font-bold text-gray-900 text-sm">{row.symbol}</span>
            <RecBadge rec={row.analysis!.recommendation} />
            <span className={`ml-auto text-sm font-black ${row.analysis!.score > 0 ? "text-emerald-600" : row.analysis!.score < 0 ? "text-red-500" : "text-gray-400"}`}>
              {row.analysis!.score > 0 ? "+" : ""}
              {row.analysis!.score}
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-1">{row.name}</p>
          {sig && (
            <div className="flex items-center gap-1.5">
              <SignalIcon type={sig.type} />
              <span className="text-[11px] text-gray-500">{sig.label}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function Section({ title, icon, items, emptyMsg, accent }: {
    title: string; icon: React.ReactNode; items: RowData[];
    emptyMsg: string; accent: string;
  }) {
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${accent}`}>
          {icon}
          <span className="text-sm font-bold">{title}</span>
          <span className="ml-auto text-xs font-semibold opacity-70">
            {items.length} stock{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 px-4">{emptyMsg}</p>
        ) : (
          <div className="space-y-2">{items.map((r) => <RecRow key={r.symbol} row={r} />)}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pending > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-indigo-50 rounded-xl border border-indigo-100">
          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
          <span className="text-xs text-indigo-700">Loading {pending} symbol{pending !== 1 ? "s" : ""}…</span>
        </div>
      )}
      <Section title="Long-Term Buys" icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} items={longBuys} emptyMsg="No strong buy signals at this time." accent="bg-emerald-50 text-emerald-800" />
      <Section title="Short-Term Opportunities" icon={<Activity className="w-4 h-4 text-amber-600" />} items={shortOpp} emptyMsg="No short-term setups detected." accent="bg-amber-50 text-amber-800" />
      <Section title="Avoid Now" icon={<AlertTriangle className="w-4 h-4 text-red-500" />} items={avoidNow} emptyMsg="No avoid signals at this time." accent="bg-red-50 text-red-700" />
    </div>
  );
}

// ─── Tab 4: My Holdings ────────────────────────────────────────────────────

function MyHoldingsTab({
  portfolio,
  portfolioLoading,
  watchlistRows,
  onSaveHolding,
  onDeleteHolding,
  onUpdateCash,
}: {
  portfolio: PortfolioState;
  portfolioLoading: boolean;
  watchlistRows: RowData[];
  onSaveHolding: (symbol: string, avgPrice: number, qty: number) => Promise<void>;
  onDeleteHolding: (symbol: string) => Promise<void>;
  onUpdateCash: (cash: number) => Promise<void>;
}) {
  const [formSymbol, setFormSymbol] = useState(WATCHLIST[0].symbol);
  const [formAvgPrice, setFormAvgPrice] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [editingCash, setEditingCash] = useState(false);
  const [cashInput, setCashInput] = useState(portfolio.cashBalance.toString());
  const [cashSaving, setCashSaving] = useState(false);

  const [deletingSymbol, setDeletingSymbol] = useState<string | null>(null);

  // Sync cashInput when portfolio.cashBalance changes from parent
  useEffect(() => {
    if (!editingCash) {
      setCashInput(portfolio.cashBalance.toString());
    }
  }, [portfolio.cashBalance, editingCash]);

  // Auto-fill avg price when symbol changes
  useEffect(() => {
    const row = watchlistRows.find((r) => r.symbol === formSymbol);
    if (row?.meta) {
      setFormAvgPrice(row.meta.regularMarketPrice.toFixed(
        row.meta.currency === "IDR" ? 0 : 2
      ));
    }
  }, [formSymbol, watchlistRows]);

  // ── Enriched holdings (merge portfolio + live prices) ────────────────────
  const enriched = portfolio.holdings.map((h) => {
    const row = watchlistRows.find((r) => r.symbol === h.symbol);
    const currentPrice = row?.meta?.regularMarketPrice ?? null;
    const currency = row?.meta?.currency ?? "USD";
    const region = row?.region ?? ("US" as const);

    // ID: quantity is stored as lots (1 lot = 100 shares)
    const totalShares = region === "ID" ? h.quantity * 100 : h.quantity;
    const cost = h.averagePrice * totalShares;

    const pnlPct =
      currentPrice !== null
        ? ((currentPrice - h.averagePrice) / h.averagePrice) * 100
        : null;
    const marketValue = currentPrice !== null ? currentPrice * totalShares : null;
    const pnlAbs = marketValue !== null ? marketValue - cost : null;

    // Personalized recommendation — always pass totalShares so the scoring
    // engine works in shares regardless of market convention
    let personalRec: Analysis | null = null;
    if (row?.chartData.length && row?.meta) {
      personalRec = generateAnalysis(
        row.chartData,
        row.meta,
        { averagePrice: h.averagePrice, quantity: totalShares },
        portfolio.cashBalance
      );
    }

    return {
      ...h,
      currentPrice,
      currency,
      region,
      totalShares,
      cost,
      pnlPct,
      marketValue,
      pnlAbs,
      personalRec,
    };
  });

  // ── Portfolio summary metrics (split by currency) ────────────────────────
  const idrHoldings = enriched.filter((h) => h.currency === "IDR");
  const usdHoldings = enriched.filter((h) => h.currency === "USD");

  const idrMarketValue = idrHoldings.reduce((s, h) => s + (h.marketValue ?? 0), 0);
  const idrCost = idrHoldings.reduce((s, h) => s + h.cost, 0);
  const idrPnL = idrCost > 0 ? idrMarketValue - idrCost : 0;
  const idrPnLPct = idrCost > 0 ? (idrPnL / idrCost) * 100 : 0;

  const usdMarketValue = usdHoldings.reduce((s, h) => s + (h.marketValue ?? 0), 0);
  const usdCost = usdHoldings.reduce((s, h) => s + h.cost, 0);
  const usdPnL = usdCost > 0 ? usdMarketValue - usdCost : 0;
  const usdPnLPct = usdCost > 0 ? (usdPnL / usdCost) * 100 : 0;

  const hasIDR = idrHoldings.length > 0;
  const hasUSD = usdHoldings.length > 0;

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const avgPrice = parseFloat(formAvgPrice);
    const rawInput = parseFloat(formQty);
    if (isNaN(avgPrice) || avgPrice <= 0 || isNaN(rawInput) || rawInput <= 0) {
      setFormError(
        isIDMarket
          ? "Average price and quantity must be positive numbers."
          : "Average price and total invested amount must be positive numbers."
      );
      return;
    }
    // For US fractional shares: derive quantity from totalInvested / avgPrice
    const qty = isIDMarket ? rawInput : rawInput / avgPrice;
    setFormSaving(true);
    try {
      await onSaveHolding(formSymbol, avgPrice, qty);
      setFormQty("");
    } catch {
      setFormError("Failed to save holding. Is the backend running?");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleSaveCash() {
    const val = parseFloat(cashInput);
    if (isNaN(val) || val < 0) return;
    setCashSaving(true);
    try {
      await onUpdateCash(val);
      setEditingCash(false);
    } finally {
      setCashSaving(false);
    }
  }

  async function handleDelete(symbol: string) {
    setDeletingSymbol(symbol);
    try {
      await onDeleteHolding(symbol);
    } finally {
      setDeletingSymbol(null);
    }
  }

  const formRow = watchlistRows.find((r) => r.symbol === formSymbol);
  const formEntry = WATCHLIST.find((w) => w.symbol === formSymbol);
  const isIDMarket = formEntry?.region === "ID";

  const _formQtyNum = parseFloat(formQty) || 0;
  const _formAvgPriceNum = parseFloat(formAvgPrice) || 0;
  // For US stocks, formQty represents totalInvested; derive shares from totalInvested / avgPrice
  const _formTotalShares = isIDMarket
    ? _formQtyNum * 100
    : _formAvgPriceNum > 0 ? _formQtyNum / _formAvgPriceNum : 0;
  const _formPreviewValue =
    formRow?.meta?.regularMarketPrice != null && _formTotalShares > 0
      ? formRow.meta.regularMarketPrice * _formTotalShares
      : null;

  return (
    <div className="space-y-6">
      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          hasIDR && hasUSD
            ? "sm:grid-cols-3"
            : hasIDR || hasUSD
            ? "sm:grid-cols-2"
            : "sm:grid-cols-1"
        }`}
      >
        {/* IDR portfolio card */}
        {hasIDR && (
          <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">
                IDR
              </span>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                Total Aset IDR
              </p>
            </div>
            <p className="text-2xl font-black text-gray-900 leading-none">
              Rp {idrMarketValue.toLocaleString("id-ID", { maximumFractionDigits: 0 })}
            </p>
            <p
              className={`text-sm font-semibold mt-1 ${
                idrPnL >= 0 ? "text-emerald-600" : "text-red-500"
              }`}
            >
              {idrPnL >= 0 ? "+" : ""}
              Rp {Math.abs(idrPnL).toLocaleString("id-ID", { maximumFractionDigits: 0 })}
              {" "}({idrPnLPct >= 0 ? "+" : ""}{idrPnLPct.toFixed(2)}%)
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {idrHoldings.length} position{idrHoldings.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* USD portfolio card */}
        {hasUSD && (
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                USD
              </span>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                Total Assets USD
              </p>
            </div>
            <p className="text-2xl font-black text-gray-900 leading-none">
              ${usdMarketValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p
              className={`text-sm font-semibold mt-1 ${
                usdPnL >= 0 ? "text-emerald-600" : "text-red-500"
              }`}
            >
              {usdPnL >= 0 ? "+" : ""}
              ${Math.abs(usdPnL).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {" "}({usdPnLPct >= 0 ? "+" : ""}{usdPnLPct.toFixed(2)}%)
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {usdHoldings.length} position{usdHoldings.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Cash / Buying Power card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
            Buying Power (Cash)
          </p>
          {editingCash ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min={0}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                className="flex-1 border border-indigo-300 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <button
                onClick={handleSaveCash}
                disabled={cashSaving}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 text-white rounded-lg transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setEditingCash(false); setCashInput(portfolio.cashBalance.toString()); }}
                className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-end justify-between gap-2">
              <p className="text-2xl font-black text-indigo-600 leading-none">
                {portfolio.cashBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <button
                onClick={() => setEditingCash(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors mb-0.5"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1.5">Available to invest</p>
        </div>
      </div>

      {portfolioLoading && (
        <div className="flex items-center gap-2 px-4 py-3 bg-indigo-50 rounded-xl border border-indigo-100">
          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
          <span className="text-xs text-indigo-700">Syncing portfolio…</span>
        </div>
      )}

      {/* ── Add / update holding form ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <PlusCircle className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-bold text-gray-900">Add / Update Holding</h3>
        </div>
        <form onSubmit={handleFormSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {/* Symbol dropdown */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Symbol
            </label>
            <select
              value={formSymbol}
              onChange={(e) => setFormSymbol(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
            >
              {WATCHLIST.map((w) => (
                <option key={w.symbol} value={w.symbol}>
                  {w.symbol} — {w.name}
                </option>
              ))}
            </select>
            {formRow?.meta && (
              <p className="text-[10px] text-gray-400 mt-1">
                Current: {formRow.meta.currency === "USD" ? "$" : "Rp "}
                {fmtPrice(formRow.meta.regularMarketPrice, formRow.meta.currency)}
              </p>
            )}
          </div>

          {/* Average price */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {isIDMarket ? "Avg Price (IDR/share)" : "Avg Price (USD/share)"}
            </label>
            <input
              type="number"
              min={0}
              step="any"
              placeholder={isIDMarket ? "e.g. 9500" : "e.g. 195.50"}
              value={formAvgPrice}
              onChange={(e) => setFormAvgPrice(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          {/* Quantity (ID) / Total Invested (US) */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {isIDMarket ? "Quantity (Lots)" : "Total Invested (USD)"}
            </label>
            <input
              type="number"
              min={0}
              step={isIDMarket ? "1" : "0.01"}
              placeholder={isIDMarket ? "e.g. 5" : "e.g. 12.42"}
              value={formQty}
              onChange={(e) => setFormQty(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            {isIDMarket && _formQtyNum > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                = {(_formQtyNum * 100).toLocaleString()} shares
              </p>
            )}
            {!isIDMarket && _formQtyNum > 0 && _formAvgPriceNum > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                = {(_formQtyNum / _formAvgPriceNum).toLocaleString(undefined, { maximumFractionDigits: 6 })} shares
              </p>
            )}
          </div>

          {/* Save button */}
          <div className="flex flex-col justify-end">
            <button
              type="submit"
              disabled={formSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white disabled:text-gray-400 text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              {formSaving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {formSaving ? "Saving…" : "Save Holding"}
            </button>
          </div>
        </form>
        {_formPreviewValue !== null && (
          <p className="mt-2 text-[11px] text-indigo-600 font-mono">
            Preview:{" "}
            {isIDMarket
              ? `${_formQtyNum} lots × 100 shares × Rp ${fmtPrice(formRow!.meta!.regularMarketPrice, "IDR")} = Rp ${fmtPrice(_formPreviewValue, "IDR")}`
              : `$${fmtPrice(_formQtyNum, "USD")} ÷ $${fmtPrice(_formAvgPriceNum, "USD")} avg = ${(_formQtyNum / _formAvgPriceNum).toLocaleString(undefined, { maximumFractionDigits: 6 })} sh · Current value: $${fmtPrice(_formPreviewValue, "USD")}`}
          </p>
        )}
        {formError && (
          <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {formError}
          </p>
        )}
      </div>

      {/* ── Holdings table ─────────────────────────────────────────────────── */}
      {portfolio.holdings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 flex flex-col items-center gap-3">
          <Wallet className="w-10 h-10 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">No holdings yet</p>
          <p className="text-xs text-gray-400">
            Use the form above to add your first position.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-50 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
              Your Holdings · {enriched.length} position{enriched.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {[
                    "Symbol", "Avg Price", "Current Price",
                    "Qty / Invested", "Market Value", "P&L", "Signal", "Action",
                  ].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${
                        ["Avg Price", "Current Price", "Market Value", "P&L"].includes(h)
                          ? "text-right"
                          : ["Qty / Invested", "Signal", "Action"].includes(h)
                          ? "text-center"
                          : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {enriched.map((h) => {
                  const prefix = h.currency === "IDR" ? "Rp " : "$";
                  return (
                    <tr
                      key={h.symbol}
                      className="hover:bg-indigo-50/20 transition-colors"
                    >
                      {/* Symbol */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-gray-900 text-sm">
                            {h.symbol}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              h.region === "ID"
                                ? "bg-red-50 text-red-600"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {h.region}
                          </span>
                        </div>
                      </td>

                      {/* Avg Price */}
                      <td className="px-4 py-4 text-right">
                        <span className="font-mono text-gray-700">
                          {prefix}{fmtPrice(h.averagePrice, h.currency)}
                        </span>
                      </td>

                      {/* Current Price */}
                      <td className="px-4 py-4 text-right">
                        {h.currentPrice !== null ? (
                          <span className="font-mono font-semibold text-gray-900">
                            {prefix}{fmtPrice(h.currentPrice, h.currency)}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Loading…</span>
                        )}
                      </td>

                      {/* Quantity / Invested */}
                      <td className="px-4 py-4 text-center">
                        {h.region === "ID" ? (
                          <div>
                            <span className="font-mono font-semibold text-gray-900">
                              {h.quantity.toLocaleString()} lot{h.quantity !== 1 ? "s" : ""}
                            </span>
                            <p className="text-[10px] text-gray-400">
                              {h.totalShares.toLocaleString()} shares
                            </p>
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono font-semibold text-gray-900">
                              ${fmtPrice(h.cost, h.currency)}
                            </span>
                            <p className="text-[10px] text-gray-400">
                              {h.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} sh
                            </p>
                          </div>
                        )}
                      </td>

                      {/* Market Value */}
                      <td className="px-4 py-4 text-right">
                        {h.marketValue !== null ? (
                          <span className="font-mono font-semibold text-gray-900">
                            {prefix}{fmtPrice(h.marketValue, h.currency)}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* P&L */}
                      <td className="px-4 py-4 text-right">
                        {h.pnlPct !== null && h.pnlAbs !== null ? (
                          <div>
                            <span
                              className={`font-mono font-bold text-sm ${
                                h.pnlPct >= 0 ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {h.pnlPct >= 0 ? "+" : ""}
                              {h.pnlPct.toFixed(2)}%
                            </span>
                            <p
                              className={`text-[10px] font-mono ${
                                h.pnlAbs >= 0 ? "text-emerald-500" : "text-red-400"
                              }`}
                            >
                              {h.pnlAbs >= 0 ? "+" : ""}
                              {prefix}{fmtPrice(Math.abs(h.pnlAbs), h.currency)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Personalized Signal */}
                      <td className="px-4 py-4 text-center">
                        {h.personalRec ? (
                          <RecBadge rec={h.personalRec.recommendation} />
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => handleDelete(h.symbol)}
                          disabled={deletingSymbol === h.symbol}
                          className="inline-flex items-center justify-center w-7 h-7 text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 rounded-lg transition-colors"
                          title={`Remove ${h.symbol}`}
                        >
                          {deletingSymbol === h.symbol ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: How to Read ─────────────────────────────────────────────────────

function HowToReadTab() {
  const cards = [
    {
      icon: <Activity className="w-5 h-5 text-indigo-500" />,
      title: "RSI — Relative Strength Index",
      accent: "border-indigo-100 bg-indigo-50/40",
      items: [
        "RSI measures the speed and magnitude of price changes (0–100 scale).",
        "Below 35 → Oversold. Prices may be depressed; historically a buying zone.",
        "Above 65 → Overbought. Prices may be extended; caution on new entries.",
        "MarketLens uses 14-period Wilder's smoothing — the industry standard.",
      ],
    },
    {
      icon: <BarChart2 className="w-5 h-5 text-violet-500" />,
      title: "MACD — Moving Average Convergence Divergence",
      accent: "border-violet-100 bg-violet-50/40",
      items: [
        "MACD Line = EMA(12) − EMA(26). Measures short-term vs long-term momentum.",
        "Signal Line = EMA(9) of MACD. Crossovers generate buy/sell signals.",
        "Histogram = MACD − Signal. Green bars: bullish pressure. Red: bearish.",
        "Histogram crossing zero → a momentum shift — scored +2 or −2.",
      ],
    },
    {
      icon: <Layers className="w-5 h-5 text-amber-500" />,
      title: "Moving Averages (MA20, MA50, MA200)",
      accent: "border-amber-100 bg-amber-50/40",
      items: [
        "MA20 (amber): Short-term trend. Reactive to recent price action.",
        "MA50 (purple): Medium-term trend. Popular institutional reference.",
        "MA200 (red, dashed): Long-term trend. Defines bull/bear market regime.",
        "Golden Cross (MA20 > MA50): Bullish crossover. Scored +3.",
        "Death Cross (MA20 < MA50): Bearish reversal signal. Scored −3.",
      ],
    },
    {
      icon: <Wallet className="w-5 h-5 text-teal-500" />,
      title: "Personalized Signals (My Holdings)",
      accent: "border-teal-100 bg-teal-50/40",
      items: [
        "AVERAGE DOWN: Tech is bullish + you're >3% in loss + have cash → lower your cost basis.",
        "TAKE PROFIT: Tech is bearish + you're >5% in profit → lock in some gains.",
        "CUT LOSS: Tech is bearish + you're >8% in loss → risk management exit signal.",
        "HOLD (No Buying Power): Tech is bullish but no cash to add → sit tight.",
        "Personalized signals require a holding entry in the My Holdings tab.",
      ],
    },
    {
      icon: <Info className="w-5 h-5 text-emerald-500" />,
      title: "Scoring Engine",
      accent: "border-emerald-100 bg-emerald-50/40",
      items: [
        "Each signal contributes a score. Signals stack additively.",
        "≥ 7 pts → STRONG BUY · ≥ 4 pts → BUY · ≥ 0 → HOLD",
        "≥ −3 pts → REDUCE · < −3 pts → AVOID",
        "Personalized overrides (above) supersede the pure technical level.",
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cards.map((card) => (
        <div key={card.title} className={`rounded-2xl border p-5 space-y-3 ${card.accent}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
              {card.icon}
            </div>
            <h3 className="text-sm font-bold text-gray-900">{card.title}</h3>
          </div>
          <ul className="space-y-1.5">
            {card.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-600 leading-relaxed">
                <span className="mt-1 w-1 h-1 rounded-full bg-gray-400 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="md:col-span-2 bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <strong>Disclaimer:</strong> MarketLens provides technical analysis for educational
            purposes only. It does not constitute financial advice. Past technical signals do not
            guarantee future returns. Always conduct your own research and consult a licensed
            financial advisor before making any investment decision.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Ticker Search Bar ─────────────────────────────────────────────────────

function TickerSearchBar({ onAnalyze }: { onAnalyze: (symbol: string) => void }) {
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (sym) {
      onAnalyze(sym);
      setQuery("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all"
    >
      <Search className="w-4 h-4 text-gray-400 shrink-0" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any ticker to analyze with AI… (e.g. AAPL, BBCA.JK)"
        className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none font-mono"
      />
      <button
        type="submit"
        disabled={!query.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        Analyze
      </button>
    </form>
  );
}

// ─── Quant Engine Modal ────────────────────────────────────────────────────

const SIGNAL_STYLES = {
  BUY:  { badge: "bg-emerald-100 text-emerald-800 border-emerald-200", bar: "bg-emerald-500" },
  HOLD: { badge: "bg-amber-100 text-amber-800 border-amber-200",   bar: "bg-amber-500"   },
  SELL: { badge: "bg-red-100 text-red-800 border-red-200",         bar: "bg-red-500"     },
};

function QuantTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-xl p-3 text-xs min-w-[150px]">
      <p className="font-semibold text-gray-400 mb-2">{label}</p>
      {payload.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) =>
          p.value != null && (
            <div key={p.dataKey} className="flex justify-between gap-3">
              <span style={{ color: p.color }}>{p.name}</span>
              <span className="font-mono font-semibold text-white">
                {typeof p.value === "number" ? fmtPrice(p.value, currency) : "—"}
              </span>
            </div>
          )
      )}
    </div>
  );
}

function AnalysisModal({
  symbol,
  onClose,
}: {
  symbol: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuantAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`${API_URL}/market/analyze/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d: QuantAnalysis) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Derived chart values
  const chartPoints = data?.chart_data.map((pt) => ({
    ...pt,
    label: pt.date
      ? new Date(pt.date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "",
  })) ?? [];

  const isIDR = data?.symbol.endsWith(".JK") ?? false;
  const currency = isIDR ? "IDR" : "USD";
  const tickEvery = Math.max(1, Math.floor(chartPoints.length / 6));

  const allPrices = chartPoints.map((p) => p.close);
  const yMin = Math.min(...allPrices, data?.cut_loss ?? Infinity) * 0.985;
  const yMax = Math.max(...allPrices, data?.take_profit ?? -Infinity) * 1.015;

  const signalStyle = SIGNAL_STYLES[data?.signal ?? "HOLD"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-950 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-gray-800">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-black text-white tracking-tight">Quant Engine</p>
              <p className="text-[10px] text-violet-400 font-semibold uppercase tracking-wide">
                Gemini 2.5 Flash · {symbol} · Explainable AI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <div className="w-14 h-14 bg-violet-950 rounded-2xl flex items-center justify-center border border-violet-800">
                <Sparkles className="w-7 h-7 text-violet-400 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-200">
                  Running Quant Engine analysis…
                </p>
                <p className="text-xs text-gray-500 mt-1.5">
                  Fetching OHLCV · Computing ATR · Calling Gemini AI
                </p>
              </div>
              <RefreshCw className="w-4 h-4 text-violet-400 animate-spin" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center gap-3 py-16">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm font-semibold text-red-400">Analysis failed</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">{error}</p>
              <p className="text-xs text-gray-600">Ensure the backend is running and the symbol is valid.</p>
            </div>
          )}

          {data && (
            <>
              {/* ── Metric Strip ──────────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Current Price */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                    Current Price
                  </p>
                  <p className="font-black text-white text-lg leading-none font-mono">
                    {isIDR
                      ? `Rp ${data.current_price.toLocaleString("id-ID")}`
                      : `$${data.current_price.toFixed(2)}`}
                  </p>
                </div>

                {/* Signal */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                    Signal
                  </p>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-sm font-black border tracking-tight ${signalStyle.badge}`}
                  >
                    {data.signal}
                  </span>
                </div>

                {/* Confidence */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                    Confidence
                  </p>
                  <p className="text-white font-black text-lg leading-none mb-2">
                    {data.confidence_score}
                    <span className="text-gray-500 text-xs font-normal ml-0.5">/100</span>
                  </p>
                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${signalStyle.bar}`}
                      style={{ width: `${data.confidence_score}%` }}
                    />
                  </div>
                </div>

                {/* ATR Volatility */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                    ATR (14d)
                  </p>
                  <p className="font-black text-amber-400 text-lg leading-none font-mono">
                    {data.atr_volatility != null
                      ? (isIDR
                        ? data.atr_volatility.toLocaleString("id-ID", { maximumFractionDigits: 0 })
                        : data.atr_volatility.toFixed(2))
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1">avg daily range</p>
                </div>
              </div>

              {/* ── TP / SL Levels ────────────────────────────────────────── */}
              {(data.take_profit != null || data.cut_loss != null) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-950/50 rounded-xl border border-emerald-900 p-4 flex items-center gap-3">
                    <div className="w-2 h-10 bg-emerald-500 rounded-full shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-widest">
                        Take Profit · 1:2 R/R
                      </p>
                      <p className="font-black text-emerald-300 text-xl leading-none font-mono mt-0.5">
                        {data.take_profit != null
                          ? (isIDR
                            ? `Rp ${data.take_profit.toLocaleString("id-ID")}`
                            : `$${data.take_profit.toFixed(2)}`)
                          : "—"}
                      </p>
                      <p className="text-[10px] text-emerald-700 mt-1">
                        Price + 3.0 × ATR
                      </p>
                    </div>
                  </div>

                  <div className="bg-red-950/50 rounded-xl border border-red-900 p-4 flex items-center gap-3">
                    <div className="w-2 h-10 bg-red-500 rounded-full shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-red-400 uppercase tracking-widest">
                        Cut Loss · Volatility Buffer
                      </p>
                      <p className="font-black text-red-300 text-xl leading-none font-mono mt-0.5">
                        {data.cut_loss != null
                          ? (isIDR
                            ? `Rp ${data.cut_loss.toLocaleString("id-ID")}`
                            : `$${data.cut_loss.toFixed(2)}`)
                          : "—"}
                      </p>
                      <p className="text-[10px] text-red-800 mt-1">
                        Price − 1.5 × ATR
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Price Chart ───────────────────────────────────────────── */}
              {chartPoints.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                  <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                      Price Chart · MA20 · MA50 · TP/SL Levels
                    </span>
                  </div>
                  <div className="px-1 pb-3">
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={chartPoints} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="quantPriceGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0}    />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: "#4b5563" }}
                          interval={tickEvery}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[yMin, yMax]}
                          tickFormatter={(v: number) => fmtPrice(v, currency)}
                          tick={{ fontSize: 9, fill: "#4b5563" }}
                          axisLine={false}
                          tickLine={false}
                          width={isIDR ? 72 : 56}
                        />
                        <Tooltip content={<QuantTooltip currency={currency} />} />

                        {/* TP / SL reference lines */}
                        {data.take_profit != null && (
                          <ReferenceLine
                            y={data.take_profit}
                            stroke="#10b981"
                            strokeDasharray="5 3"
                            strokeWidth={1.5}
                            label={{
                              value: `TP ${isIDR ? data.take_profit.toLocaleString("id-ID") : data.take_profit.toFixed(2)}`,
                              position: "insideTopRight",
                              fontSize: 9,
                              fill: "#10b981",
                              fontWeight: 700,
                            }}
                          />
                        )}
                        {data.cut_loss != null && (
                          <ReferenceLine
                            y={data.cut_loss}
                            stroke="#ef4444"
                            strokeDasharray="5 3"
                            strokeWidth={1.5}
                            label={{
                              value: `SL ${isIDR ? data.cut_loss.toLocaleString("id-ID") : data.cut_loss.toFixed(2)}`,
                              position: "insideBottomRight",
                              fontSize: 9,
                              fill: "#ef4444",
                              fontWeight: 700,
                            }}
                          />
                        )}

                        {/* Price area */}
                        <Area
                          type="monotone"
                          dataKey="close"
                          name="Close"
                          stroke="#818cf8"
                          fill="url(#quantPriceGrad)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 3, fill: "#818cf8" }}
                        />

                        {/* Moving averages */}
                        <Line
                          type="monotone"
                          dataKey="ma20"
                          name="MA20"
                          stroke="#f59e0b"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="ma50"
                          name="MA50"
                          stroke="#a78bfa"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                        />
                        <Legend
                          iconType="line"
                          iconSize={12}
                          wrapperStyle={{ fontSize: 10, paddingTop: 4, color: "#6b7280" }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── AI Reasoning ──────────────────────────────────────────── */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 bg-violet-900 rounded-lg flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                    AI Reasoning · Explainable Analysis
                  </span>
                </div>
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <h1 className="text-base font-black text-white mt-0 mb-3">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-sm font-bold text-gray-200 mt-5 mb-2 pb-1 border-b border-gray-800">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xs font-bold text-gray-300 mt-3 mb-1.5">{children}</h3>,
                    p:  ({ children }) => <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>,
                    ul: ({ children }) => <ul className="space-y-1 mb-3 pl-4">{children}</ul>,
                    ol: ({ children }) => <ol className="space-y-1 mb-3 pl-4 list-decimal">{children}</ol>,
                    li: ({ children }) => <li className="text-sm text-gray-400 leading-relaxed list-disc">{children}</li>,
                    strong: ({ children }) => <strong className="font-bold text-gray-200">{children}</strong>,
                    em:     ({ children }) => <em className="italic text-gray-400">{children}</em>,
                    code:   ({ children }) => (
                      <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono text-violet-400">
                        {children}
                      </code>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-violet-700 pl-4 my-3 bg-violet-950/40 py-2 rounded-r-lg text-sm text-gray-400 italic">
                        {children}
                      </blockquote>
                    ),
                    hr: () => <hr className="border-gray-800 my-4" />,
                  }}
                >
                  {data.ai_reasoning}
                </ReactMarkdown>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-gray-600">
            Powered by Gemini 2.5 Flash · ATR-based TP/SL · For educational purposes only
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

type Tab = "watchlist" | "chart" | "holdings" | "recommendations" | "howto";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <BarChart2 className="w-4 h-4" /> },
  { id: "chart", label: "Chart View", icon: <Activity className="w-4 h-4" /> },
  { id: "holdings", label: "My Holdings", icon: <Wallet className="w-4 h-4" /> },
  { id: "recommendations", label: "Recommendations", icon: <TrendingUp className="w-4 h-4" /> },
  { id: "howto", label: "How to Read", icon: <BookOpen className="w-4 h-4" /> },
];

export default function MarketLensPage() {
  // ── AI Analyst ───────────────────────────────────────────────────────────
  const [analyzeSymbol, setAnalyzeSymbol] = useState<string | null>(null);

  // ── Watchlist ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("watchlist");
  const [watchlistRows, setWatchlistRows] = useState<RowData[]>(
    WATCHLIST.map((e) => ({
      ...e,
      meta: null,
      chartData: [],
      rsi: null,
      analysis: null,
      loading: true,
      error: false,
    }))
  );

  const loadWatchlist = useCallback(() => {
    WATCHLIST.forEach(async (entry, idx) => {
      setWatchlistRows((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], loading: true, error: false };
        return next;
      });
      try {
        const res = await fetch(
          `${API_URL}/market/chart/${encodeURIComponent(entry.symbol)}?range=3mo&interval=1d`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const parsed = parseYahoo(raw);
        if (!parsed) throw new Error("parse error");

        const { meta, chartData: cd } = parsed;
        const lastRsi = cd[cd.length - 1]?.rsi ?? null;
        const analysis = generateAnalysis(cd, meta);

        setWatchlistRows((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], meta, chartData: cd, rsi: lastRsi, analysis, loading: false, error: false };
          return next;
        });
      } catch {
        setWatchlistRows((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], loading: false, error: true };
          return next;
        });
      }
    });
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  // ── Chart view ───────────────────────────────────────────────────────────
  const [selectedSymbol, setSelectedSymbol] = useState<string>(WATCHLIST[0].symbol);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [chartMeta, setChartMeta] = useState<StockMeta | null>(null);
  const [chartAnalysis, setChartAnalysis] = useState<Analysis | null>(null);
  const [chartRange, setChartRange] = useState("3mo");
  const [chartLoading, setChartLoading] = useState(false);

  const loadChart = useCallback(async (symbol: string, range: string) => {
    setChartLoading(true);
    setChartData([]);
    setChartMeta(null);
    setChartAnalysis(null);
    try {
      const rangeObj = RANGES.find((r) => r.value === range);
      const interval = rangeObj?.interval ?? "1d";
      const res = await fetch(
        `${API_URL}/market/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const parsed = parseYahoo(raw);
      if (parsed) {
        setChartData(parsed.chartData);
        setChartMeta(parsed.meta);
        setChartAnalysis(generateAnalysis(parsed.chartData, parsed.meta));
      }
    } catch {
      // Error state shown in ChartTab
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => { loadChart(selectedSymbol, chartRange); }, [selectedSymbol, chartRange, loadChart]);

  function handleViewChart(symbol: string) {
    setSelectedSymbol(symbol);
    setActiveTab("chart");
  }

  // ── Portfolio ─────────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState<PortfolioState>({ cashBalance: 0, holdings: [] });
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const loadPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    try {
      const res = await fetch(`${API_URL}/portfolio/${USER_ID}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      setPortfolio({
        cashBalance: data.cash_balance ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        holdings: (data.holdings ?? []).map((h: any) => ({
          id: h.id,
          symbol: h.symbol,
          averagePrice: h.average_price,
          quantity: h.quantity,
        })),
      });
    } catch {
      // Keep empty portfolio on error
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  const handleSaveHolding = useCallback(async (symbol: string, avgPrice: number, qty: number) => {
    const res = await fetch(`${API_URL}/portfolio/${USER_ID}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, average_price: avgPrice, quantity: qty }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadPortfolio();
  }, [loadPortfolio]);

  const handleDeleteHolding = useCallback(async (symbol: string) => {
    const res = await fetch(
      `${API_URL}/portfolio/${USER_ID}/holdings/${encodeURIComponent(symbol)}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadPortfolio();
  }, [loadPortfolio]);

  const handleUpdateCash = useCallback(async (cashBalance: number) => {
    const res = await fetch(`${API_URL}/portfolio/${USER_ID}/cash`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cash_balance: cashBalance }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadPortfolio();
  }, [loadPortfolio]);

  const loadingCount = watchlistRows.filter((r) => r.loading).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </Link>
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-sm">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div className="leading-none">
              <p className="font-black text-gray-900 tracking-tight">MarketLens</p>
              <p className="text-[10px] text-indigo-500 font-semibold tracking-wide uppercase">
                Live Market Intelligence · Portfolio Advisor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {loadingCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-medium border border-indigo-100">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {loadingCount} loading
              </div>
            )}
            <button
              onClick={loadWatchlist}
              disabled={loadingCount > 0}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white disabled:text-gray-400 text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCount > 0 ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* ── Tab Navigation ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 py-2 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.id === "holdings" && portfolio.holdings.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-white/30 rounded-full text-[10px] font-bold">
                    {portfolio.holdings.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* AI Ticker Search — always visible */}
        <div className="mb-5">
          <TickerSearchBar onAnalyze={setAnalyzeSymbol} />
        </div>

        {activeTab === "watchlist" && (
          <WatchlistTab rows={watchlistRows} onViewChart={handleViewChart} onAnalyze={setAnalyzeSymbol} />
        )}
        {activeTab === "chart" && (
          <ChartTab
            rows={watchlistRows}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            chartData={chartData}
            meta={chartMeta}
            analysis={chartAnalysis}
            chartRange={chartRange}
            onRangeChange={setChartRange}
            loading={chartLoading}
            onAnalyze={setAnalyzeSymbol}
          />
        )}
        {activeTab === "holdings" && (
          <MyHoldingsTab
            portfolio={portfolio}
            portfolioLoading={portfolioLoading}
            watchlistRows={watchlistRows}
            onSaveHolding={handleSaveHolding}
            onDeleteHolding={handleDeleteHolding}
            onUpdateCash={handleUpdateCash}
          />
        )}
        {activeTab === "recommendations" && (
          <RecommendationsTab rows={watchlistRows} />
        )}
        {activeTab === "howto" && <HowToReadTab />}
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-4 border-t border-gray-100 mt-4">
        <p className="text-xs text-gray-400 text-center">
          wondr Intelligence Engine · MarketLens · Data proxied via FastAPI from Yahoo Finance · Not financial advice
        </p>
      </footer>

      {/* ── AI Analysis Modal ────────────────────────────────────────────── */}
      {analyzeSymbol && (
        <AnalysisModal symbol={analyzeSymbol} onClose={() => setAnalyzeSymbol(null)} />
      )}
    </div>
  );
}
