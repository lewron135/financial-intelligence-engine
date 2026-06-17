"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Props {
  userId: string;
}

interface ChartPoint {
  period: string;
  historical?: number;
  forecast?: number;
  upper?: number;
  lower?: number;
}

interface TooltipEntry {
  dataKey: string;
  value: number;
  color: string;
}

function ForecastTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const LABELS: Record<string, string> = {
    historical: "Historical",
    forecast: "Forecast",
    upper: "Upper bound",
    lower: "Lower bound",
  };

  const visible = payload.filter(
    (p) => p.dataKey !== "upper" && p.dataKey !== "lower" && p.value != null
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {visible.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: p.color }}
          />
          <span className="text-gray-500">{LABELS[p.dataKey] ?? p.dataKey}:</span>
          <span className="font-medium text-gray-900">
            Rp {p.value.toLocaleString("id-ID")}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ForecastChart({ userId }: Props) {
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [hasForecast, setHasForecast] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/${userId}/spending-forecast`);
      if (!res.ok) return;
      const data = await res.json();

      const combined: ChartPoint[] = [];

      for (const h of data.historical ?? []) {
        combined.push({
          period: new Date(h.period).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
          }),
          historical: h.amount,
        });
      }

      for (const f of data.forecast ?? []) {
        combined.push({
          period: new Date(f.period).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
          }),
          forecast: f.amount,
          upper: f.upper,
          lower: f.lower,
        });
      }

      setChartData(combined);
      setHasForecast((data.forecast ?? []).length > 0);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatYAxis = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
    return String(val);
  };

  const isEmpty = chartData.length === 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-violet-500" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Spending Forecast</h2>
            <p className="text-xs text-gray-400">
              Meta Prophet &middot; weekly history + 4-week projection
            </p>
          </div>
        </div>
        {hasForecast && (
          <span className="px-2.5 py-1 text-xs font-semibold bg-violet-100 text-violet-700 rounded-full border border-violet-200">
            Forecast ready
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-56 text-sm text-gray-400">
          Running Prophet model...
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center h-56 text-center">
          <TrendingUp className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">Not enough data</p>
          <p className="text-xs text-gray-400 mt-1">
            Import transactions spanning 2+ weeks to enable forecasting
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 16, bottom: 10, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f3f4f6"
              vertical={false}
            />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<ForecastTooltip />} />
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />

            {/* Confidence interval band: upper fill, then mask lower with white */}
            <Area
              type="monotone"
              dataKey="upper"
              fill="#ede9fe"
              fillOpacity={0.45}
              stroke="none"
              legendType="none"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="lower"
              fill="#ffffff"
              fillOpacity={1}
              stroke="none"
              legendType="none"
              connectNulls={false}
            />

            <Bar
              dataKey="historical"
              name="Historical"
              fill="#818cf8"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#7c3aed"
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={{ fill: "#7c3aed", r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
