export interface Transaction {
  id: number;
  user_id: string;
  amount: number;
  category: string;
  merchant_name: string;
  timestamp: string;
}

export type InsightType =
  | "spending_anomaly"
  | "bill_forecast"
  | "saving_tip"
  | "system_status";

export interface Insight {
  id: number;
  user_id: string;
  type: InsightType;
  category: string;
  message: string;
  anomaly_score: number | null;
  predicted_date: string | null;
  created_at: string;
}

export interface GrowthRecommendation {
  id: number;
  user_id: string;
  target_goal: string;
  current_balance: number;
  target_amount: number;
  recommended_redirect_amount: number | null;
  impact_message: string | null;
  created_at: string;
}

export interface TransactionDimension {
  total_transactions: number;
  total_spent: number;
  spending_by_category: Record<string, number>;
  latest_transaction: {
    merchant: string;
    amount: number;
    category: string;
    timestamp: string;
  } | null;
}

export interface InsightDimension {
  total_insights_generated: number;
  anomalies_detected: number;
  has_active_anomaly: boolean;
  bill_forecasts: Array<{
    category: string;
    message: string;
    predicted_date: string | null;
  }>;
}

export interface GrowthGoal {
  target_goal: string;
  current_balance: number;
  target_amount: number;
  recommended_redirect_amount: number | null;
  impact_message: string | null;
  progress_pct: number;
}

export interface GrowthDimension {
  total_recommendations: number;
  total_redirect_recommended: number;
  active_goals: GrowthGoal[];
}

export interface UserSummary {
  user_id: string;
  summary: {
    transaction_dimension: TransactionDimension;
    insight_dimension: InsightDimension;
    growth_dimension: GrowthDimension;
  };
}

export interface InsightsResponse {
  user_id: string;
  insights: Insight[];
}

export interface RecommendationsResponse {
  user_id: string;
  recommendations: GrowthRecommendation[];
}

export interface AnnotatedTransaction {
  id: number;
  merchant_name: string;
  timestamp: string;
  amount: number;
  category: string;
  is_anomaly: boolean;
}

export interface AnnotatedTransactionsResponse {
  user_id: string;
  transactions: AnnotatedTransaction[];
}

export interface SpendingForecastPeriod {
  period: string;
  amount: number;
}

export interface ForecastPeriod {
  period: string;
  amount: number;
  lower: number;
  upper: number;
}

export interface SpendingForecastResponse {
  user_id: string;
  historical: SpendingForecastPeriod[];
  forecast: ForecastPeriod[];
}

export interface DailySpendingRow {
  date: string;
  [category: string]: string | number;
}

export interface DailySpendingResponse {
  user_id: string;
  daily_spending: DailySpendingRow[];
}
