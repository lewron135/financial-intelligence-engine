"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Wifi,
  WifiOff,
  Banknote,
  AlertTriangle,
  Brain,
  Sprout,
} from "lucide-react";

import TransactionSimulator from "@/components/TransactionSimulator";
import InsightAlerts from "@/components/InsightAlerts";
import GrowthRecommendations from "@/components/GrowthRecommendations";
import AnomalyScatterChart from "@/components/AnomalyScatterChart";
import ForecastChart from "@/components/ForecastChart";
import CategoryDrillDown from "@/components/CategoryDrillDown";
import type {
  UserSummary,
  Insight,
  GrowthRecommendation,
} from "@/types/banking";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEFAULT_USER_ID = "usr_123";

// ─────────────────────────────────────────────────────────────
// Metric card sub-component
// ─────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  variant: "blue" | "red" | "purple" | "emerald";
}

const VARIANT_STYLES: Record<
  MetricCardProps["variant"],
  { card: string; icon: string; value: string }
> = {
  blue: {
    card: "bg-blue-50 border-blue-100",
    icon: "bg-blue-100 text-blue-600",
    value: "text-blue-900",
  },
  red: {
    card: "bg-red-50 border-red-100",
    icon: "bg-red-100 text-red-600",
    value: "text-red-900",
  },
  purple: {
    card: "bg-purple-50 border-purple-100",
    icon: "bg-purple-100 text-purple-600",
    value: "text-purple-900",
  },
  emerald: {
    card: "bg-emerald-50 border-emerald-100",
    icon: "bg-emerald-100 text-emerald-600",
    value: "text-emerald-900",
  },
};

function MetricCard({ label, value, sub, icon, variant }: MetricCardProps) {
  const s = VARIANT_STYLES[variant];
  return (
    <div className={`rounded-2xl border p-5 ${s.card}`}>
      <div className="flex items-center gap-2.5 mb-4">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.icon}`}
        >
          {icon}
        </div>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold leading-none ${s.value}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-2">{sub}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Spending breakdown sub-component
// ─────────────────────────────────────────────────────────────
function SpendingBreakdown({
  data,
  total,
}: {
  data: Record<string, number>;
  total: number;
}) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <span className="text-violet-600 font-bold text-sm">%</span>
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Spending Breakdown</h2>
          <p className="text-xs text-gray-400">By category · all time</p>
        </div>
      </div>
      <div className="space-y-3">
        {entries.map(([cat, amt]) => {
          const pct = total > 0 ? (amt / total) * 100 : 0;
          return (
            <div key={cat}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-gray-600 capitalize font-medium">
                  {cat.replace(/_/g, " ")}
                </span>
                <span className="text-gray-800 font-semibold">
                  Rp {amt.toLocaleString("id-ID")}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-violet-400 to-indigo-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const userId = DEFAULT_USER_ID;
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isStaging, setIsStaging] = useState(false);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [summaryRes, insightsRes, recsRes] = await Promise.all([
        fetch(`${API_URL}/users/${userId}/summary`),
        fetch(`${API_URL}/insights/${userId}`),
        fetch(`${API_URL}/recommendations/${userId}`),
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());

      if (insightsRes.ok) {
        const d = await insightsRes.json();
        setInsights(d.insights ?? []);
      }

      if (recsRes.ok) {
        const d = await recsRes.json();
        setRecommendations(d.recommendations ?? []);
      }

      setIsOnline(true);
      setLastUpdated(new Date());
    } catch {
      setIsOnline(false);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const txDim = summary?.summary.transaction_dimension;
  const inDim = summary?.summary.insight_dimension;
  const grDim = summary?.summary.growth_dimension;

  const totalSpent = txDim?.total_spent ?? 0;
  const totalTx = txDim?.total_transactions ?? 0;
  const anomalies = inDim?.anomalies_detected ?? 0;
  const totalRedirect = grDim?.total_redirect_recommended ?? 0;
  const activeInsights = insights.filter((i) => i.type !== "system_status");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-extrabold text-sm tracking-tight">
                W
              </span>
            </div>
            <div className="leading-none">
              <p className="font-bold text-gray-900 text-base">
                wondr Intelligence Engine
              </p>
              <p className="text-[10px] text-gray-400 font-medium tracking-wide">
                THREE DIMENSIONS CONNECTED
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                isOnline
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-600 border-red-200"
              }`}
            >
              {isOnline ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {isOnline ? "Backend live" : "Backend offline"}
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              <span className="text-xs font-medium text-gray-600">{userId}</span>
            </div>

            <button
              onClick={fetchAll}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white disabled:text-gray-400 text-sm font-medium rounded-xl transition-colors shadow-sm"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
              {isLoading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Offline banner ───────────────────────────────────── */}
      {!isOnline && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5">
          <p className="text-xs text-red-700 text-center">
            Backend unreachable — start it with:{" "}
            <code className="font-mono bg-red-100 px-1.5 py-0.5 rounded">
              cd apps/backend && uvicorn main:app --reload --port 8000
            </code>
          </p>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* ── Metric bar ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Total Spending"
            value={`Rp ${totalSpent.toLocaleString("id-ID")}`}
            sub={`Across ${totalTx} transaction${totalTx !== 1 ? "s" : ""}`}
            icon={<Banknote className="w-4 h-4" />}
            variant="blue"
          />
          <MetricCard
            label="Anomalies"
            value={String(anomalies)}
            sub={
              anomalies > 0 ? "Spending spikes detected" : "No anomalies found"
            }
            icon={<AlertTriangle className="w-4 h-4" />}
            variant={anomalies > 0 ? "red" : "emerald"}
          />
          <MetricCard
            label="ML Insights"
            value={String(activeInsights.length)}
            sub="Auto-generated by pipeline"
            icon={<Brain className="w-4 h-4" />}
            variant="purple"
          />
          <MetricCard
            label="Goal Redirect"
            value={`Rp ${totalRedirect.toLocaleString("id-ID")}`}
            sub="Rule Engine recommendation"
            icon={<Sprout className="w-4 h-4" />}
            variant="emerald"
          />
        </div>

        {lastUpdated && (
          <p className="text-xs text-gray-400 mb-6">
            Last updated:{" "}
            {lastUpdated.toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        )}

        {/* ── Main 3-column grid ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel — expands to full-width row while a statement is staged */}
          <div className={`space-y-6 ${isStaging ? "lg:col-span-3" : ""}`}>
            <TransactionSimulator
              userId={userId}
              onTransactionPosted={fetchAll}
              onStagingChange={setIsStaging}
            />
            {!isStaging && (
              <SpendingBreakdown
                data={txDim?.spending_by_category ?? {}}
                total={totalSpent}
              />
            )}
          </div>

          {/* When staging, SpendingBreakdown shifts to the next grid row (1 col) */}
          {isStaging && (
            <SpendingBreakdown
              data={txDim?.spending_by_category ?? {}}
              total={totalSpent}
            />
          )}

          {/* Center + Right panels */}
          <div className="lg:col-span-2 space-y-6">
            <InsightAlerts insights={insights} />
            <GrowthRecommendations recommendations={recommendations} />
          </div>
        </div>

        {/* ── ML Visual Analytics ─────────────────────────────── */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-5 bg-gradient-to-b from-indigo-500 to-violet-500 rounded-full" />
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              ML Visual Analytics
            </h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            <div className="lg:col-span-3">
              <AnomalyScatterChart userId={userId} />
            </div>
            <div className="lg:col-span-2">
              <ForecastChart userId={userId} />
            </div>
          </div>

          <CategoryDrillDown
            userId={userId}
            spendingByCategory={txDim?.spending_by_category ?? {}}
          />
        </div>

        {/* ── Architecture legend ──────────────────────────────── */}
        <div className="mt-8 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
          <p className="text-xs text-indigo-700 text-center leading-relaxed">
            <span className="font-semibold">Event-Driven Architecture</span>
            {" · "}POST /transactions{" → "}
            <span className="font-mono bg-indigo-100 px-1 rounded">
              BackgroundTask
            </span>
            {" → "}Isolation Forest{" → "}Meta Prophet{" → "}Rule Engine{" → "}
            Insights + Growth Recommendations
          </p>
        </div>
      </main>
    </div>
  );
}
