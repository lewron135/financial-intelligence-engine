"use client";

import { useState, useEffect, useCallback } from "react";
import { DonutChart, BarChart } from "@tremor/react";
import { PieChart, BarChart2, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type TremorColor =
  | "blue"
  | "cyan"
  | "orange"
  | "green"
  | "purple"
  | "amber"
  | "pink"
  | "red"
  | "indigo"
  | "gray";

const CATEGORY_COLORS: Record<string, TremorColor> = {
  food_and_beverage: "orange",
  groceries: "green",
  shopping: "purple",
  transfer_investment: "blue",
  transport: "amber",
  utilities: "cyan",
  lifestyle: "pink",
  healthcare: "red",
  travel: "indigo",
  uncategorized: "gray",
};

interface DonutEntry {
  name: string;
  value: number;
  rawName: string;
}

interface DailyEntry {
  date: string;
  amount: number;
}

interface DailySpendingRow {
  date: string;
  [category: string]: string | number;
}

interface Props {
  spendingByCategory: Record<string, number>;
  userId: string;
}

export default function CategoryDrillDown({
  spendingByCategory,
  userId,
}: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dailySpending, setDailySpending] = useState<DailySpendingRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDailyData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/${userId}/daily-spending`);
      if (!res.ok) return;
      const data = await res.json();
      setDailySpending(data.daily_spending ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchDailyData();
  }, [fetchDailyData]);

  const donutData: DonutEntry[] = Object.entries(spendingByCategory)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({
      name: key.replace(/_/g, " "),
      value,
      rawName: key,
    }));

  const donutColors: TremorColor[] = donutData.map(
    (d) => CATEGORY_COLORS[d.rawName] ?? "gray"
  );

  const filteredDailyData: DailyEntry[] = selectedCategory
    ? dailySpending
        .filter((row) => row[selectedCategory] != null)
        .map((row) => ({
          date: new Date(row.date).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
          }),
          amount: Number(row[selectedCategory]) || 0,
        }))
    : [];

  const handleDonutChange = (val: { name?: string } | null) => {
    if (!val || !val.name) {
      setSelectedCategory(null);
      return;
    }
    const found = donutData.find((d) => d.name === val.name);
    setSelectedCategory(found?.rawName ?? null);
  };

  const selectedColor =
    selectedCategory != null
      ? (CATEGORY_COLORS[selectedCategory] ?? "blue")
      : "blue";

  const isEmpty = donutData.length === 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <PieChart className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">
              Category Drill-Down
            </h2>
            <p className="text-xs text-gray-400">
              {selectedCategory
                ? `Daily view: ${selectedCategory.replace(/_/g, " ")}`
                : "Click a segment to inspect daily spending"}
            </p>
          </div>
        </div>
        {selectedCategory && (
          <button
            onClick={() => setSelectedCategory(null)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <PieChart className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No spending data yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Import transactions to populate this chart
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div>
            <DonutChart
              data={donutData}
              category="value"
              index="name"
              valueFormatter={(v) => `Rp ${v.toLocaleString("id-ID")}`}
              colors={donutColors}
              onValueChange={handleDonutChange}
              className="h-52"
            />
          </div>

          <div className="h-52 flex flex-col justify-center">
            {!selectedCategory ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <BarChart2 className="w-8 h-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">Select a category</p>
                <p className="text-xs text-gray-400 mt-1">
                  Click any segment to see daily breakdown
                </p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                Loading...
              </div>
            ) : filteredDailyData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <BarChart2 className="w-8 h-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No daily data</p>
                <p className="text-xs text-gray-400 mt-1 capitalize">
                  No records for{" "}
                  {selectedCategory.replace(/_/g, " ")}
                </p>
              </div>
            ) : (
              <BarChart
                data={filteredDailyData}
                index="date"
                categories={["amount"]}
                colors={[selectedColor]}
                valueFormatter={(v) => `Rp ${v.toLocaleString("id-ID")}`}
                className="h-52"
                showLegend={false}
                showGridLines={false}
                showAnimation
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
