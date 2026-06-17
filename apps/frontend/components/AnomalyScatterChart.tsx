"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Activity, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Props {
  userId: string;
}

interface ScatterPoint {
  x: number;
  y: number;
  name: string;
  date: string;
  category: string;
  isAnomaly: boolean;
}

interface TooltipPayload {
  payload: ScatterPoint;
}

function AnomalyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs max-w-[180px]">
      <p className="font-semibold text-gray-900 mb-1 truncate">{d.name}</p>
      <p className="text-gray-500 mb-1">{d.date}</p>
      <p className="text-gray-800 font-medium">
        Rp {d.y.toLocaleString("id-ID")}
      </p>
      <p className="text-gray-400 capitalize mt-0.5">
        {d.category.replace(/_/g, " ")}
      </p>
      {d.isAnomaly && (
        <div className="mt-2 flex items-center gap-1 text-red-600 font-semibold border-t border-red-100 pt-2">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Anomaly flagged
        </div>
      )}
    </div>
  );
}

const NormalDot = (props: { cx?: number; cy?: number }) => (
  <circle
    cx={props.cx}
    cy={props.cy}
    r={4}
    fill="#93c5fd"
    fillOpacity={0.8}
    stroke="#60a5fa"
    strokeWidth={0.5}
  />
);

const AnomalyDot = (props: { cx?: number; cy?: number }) => (
  <circle
    cx={props.cx}
    cy={props.cy}
    r={7}
    fill="#ef4444"
    fillOpacity={0.85}
    stroke="#dc2626"
    strokeWidth={1}
  />
);

export default function AnomalyScatterChart({ userId }: Props) {
  const [normalPoints, setNormalPoints] = useState<ScatterPoint[]>([]);
  const [anomalyPoints, setAnomalyPoints] = useState<ScatterPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/users/${userId}/transactions-annotated`
      );
      if (!res.ok) return;
      const data = await res.json();

      const normal: ScatterPoint[] = [];
      const anomaly: ScatterPoint[] = [];

      for (const tx of data.transactions ?? []) {
        const ts = new Date(tx.timestamp);
        const point: ScatterPoint = {
          x: ts.getTime(),
          y: tx.amount,
          name: tx.merchant_name,
          date: ts.toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          category: tx.category,
          isAnomaly: tx.is_anomaly,
        };
        if (tx.is_anomaly) anomaly.push(point);
        else normal.push(point);
      }

      setNormalPoints(normal);
      setAnomalyPoints(anomaly);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatXAxis = (ts: number) =>
    new Date(ts).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
    });

  const formatYAxis = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
    return String(val);
  };

  const isEmpty = normalPoints.length === 0 && anomalyPoints.length === 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">
              ML Anomaly Detection
            </h2>
            <p className="text-xs text-gray-400">
              Isolation Forest &middot;{" "}
              {anomalyPoints.length} anomal
              {anomalyPoints.length === 1 ? "y" : "ies"} detected
            </p>
          </div>
        </div>
        {anomalyPoints.length > 0 && (
          <span className="px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-700 rounded-full border border-red-200">
            {anomalyPoints.length} flagged
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-56 text-sm text-gray-400">
          Analyzing transactions...
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center h-56 text-center">
          <Activity className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No data yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Import transactions to run anomaly detection
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["auto", "auto"]}
              tickFormatter={formatXAxis}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              name="Date"
            />
            <YAxis
              dataKey="y"
              type="number"
              tickFormatter={formatYAxis}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              name="Amount"
              width={42}
            />
            <Tooltip
              content={<AnomalyTooltip />}
              cursor={{ strokeDasharray: "3 3", stroke: "#d1d5db" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            <Scatter
              name="Normal"
              data={normalPoints}
              shape={<NormalDot />}
            />
            <Scatter
              name="Anomaly"
              data={anomalyPoints}
              shape={<AnomalyDot />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
