from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models.transaction import Transaction
from models.insight import Insight
from models.recommendation import GrowthRecommendation

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/{user_id}/summary")
def get_user_summary(user_id: str, db: Session = Depends(get_db)):
    transactions = db.query(Transaction).filter(Transaction.user_id == user_id).all()
    insights = db.query(Insight).filter(Insight.user_id == user_id).all()
    recommendations = db.query(GrowthRecommendation).filter(
        GrowthRecommendation.user_id == user_id
    ).all()

    # --- Transaction Dimension ---
    total_spent = sum(t.amount for t in transactions)
    spending_by_category: dict[str, float] = {}
    for t in transactions:
        spending_by_category[t.category] = spending_by_category.get(t.category, 0.0) + t.amount

    latest = transactions[-1] if transactions else None

    # --- Insight Dimension ---
    anomaly_insights = [i for i in insights if i.type == "spending_anomaly"]
    bill_forecasts = [i for i in insights if i.type == "bill_forecast"]

    # --- Growth Dimension ---
    total_redirect_recommended = sum(
        r.recommended_redirect_amount or 0.0 for r in recommendations
    )

    return {
        "user_id": user_id,
        "summary": {
            "transaction_dimension": {
                "total_transactions": len(transactions),
                "total_spent": total_spent,
                "spending_by_category": spending_by_category,
                "latest_transaction": {
                    "merchant": latest.merchant_name,
                    "amount": latest.amount,
                    "category": latest.category,
                    "timestamp": latest.timestamp,
                } if latest else None,
            },
            "insight_dimension": {
                "total_insights_generated": len(insights),
                "anomalies_detected": len(anomaly_insights),
                "has_active_anomaly": len(anomaly_insights) > 0,
                "bill_forecasts": [
                    {
                        "category": f.category,
                        "message": f.message,
                        "predicted_date": f.predicted_date,
                    }
                    for f in bill_forecasts
                ],
            },
            "growth_dimension": {
                "total_recommendations": len(recommendations),
                "total_redirect_recommended": total_redirect_recommended,
                "active_goals": [
                    {
                        "target_goal": r.target_goal,
                        "current_balance": r.current_balance,
                        "target_amount": r.target_amount,
                        "recommended_redirect_amount": r.recommended_redirect_amount,
                        "impact_message": r.impact_message,
                        "progress_pct": (
                            round((r.current_balance / r.target_amount) * 100, 1)
                            if r.target_amount
                            else 0.0
                        ),
                    }
                    for r in recommendations
                ],
            },
        },
    }


@router.get("/{user_id}/transactions-annotated")
def get_transactions_annotated(user_id: str, db: Session = Depends(get_db)):
    from sklearn.ensemble import IsolationForest

    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.timestamp)
        .all()
    )

    base = [
        {
            "id": t.id,
            "merchant_name": t.merchant_name,
            "timestamp": t.timestamp.isoformat() if t.timestamp else datetime.now().isoformat(),
            "amount": t.amount,
            "category": t.category,
            "is_anomaly": False,
        }
        for t in transactions
    ]

    if len(transactions) < 3:
        return {"user_id": user_id, "transactions": base}

    labels = IsolationForest(contamination=0.15, random_state=42).fit_predict(
        [[t.amount] for t in transactions]
    )

    for item, label in zip(base, labels):
        item["is_anomaly"] = bool(label == -1)

    return {"user_id": user_id, "transactions": base}


@router.get("/{user_id}/spending-forecast")
def get_spending_forecast(user_id: str, db: Session = Depends(get_db)):
    from prophet import Prophet

    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.timestamp)
        .all()
    )

    if not transactions:
        return {"user_id": user_id, "historical": [], "forecast": []}

    df = pd.DataFrame(
        [
            {
                "ds": t.timestamp.date() if t.timestamp else datetime.now().date(),
                "y": t.amount,
            }
            for t in transactions
        ]
    )
    df["ds"] = pd.to_datetime(df["ds"])
    df["week"] = df["ds"].dt.to_period("W").dt.start_time
    weekly = df.groupby("week")["y"].sum().reset_index()
    weekly.columns = ["ds", "y"]
    weekly = weekly.sort_values("ds").reset_index(drop=True)

    historical = [
        {"period": row["ds"].strftime("%Y-%m-%d"), "amount": float(row["y"])}
        for _, row in weekly.iterrows()
    ]

    if len(weekly) < 2:
        return {"user_id": user_id, "historical": historical, "forecast": []}

    model = Prophet(
        yearly_seasonality=False, weekly_seasonality=False, daily_seasonality=False
    )
    model.fit(weekly)

    future = model.make_future_dataframe(periods=4, freq="W")
    forecast = model.predict(future)

    last_date = weekly["ds"].max()
    future_rows = forecast[forecast["ds"] > last_date]

    forecast_data = [
        {
            "period": row["ds"].strftime("%Y-%m-%d"),
            "amount": max(0.0, float(row["yhat"])),
            "lower": max(0.0, float(row["yhat_lower"])),
            "upper": max(0.0, float(row["yhat_upper"])),
        }
        for _, row in future_rows.iterrows()
    ]

    return {"user_id": user_id, "historical": historical, "forecast": forecast_data}


@router.get("/{user_id}/daily-spending")
def get_daily_spending(user_id: str, db: Session = Depends(get_db)):
    transactions = (
        db.query(Transaction).filter(Transaction.user_id == user_id).all()
    )

    daily: dict[str, dict[str, float]] = {}
    for t in transactions:
        date_str = (
            t.timestamp.strftime("%Y-%m-%d")
            if t.timestamp
            else datetime.now().strftime("%Y-%m-%d")
        )
        if date_str not in daily:
            daily[date_str] = {}
        daily[date_str][t.category] = (
            daily[date_str].get(t.category, 0.0) + t.amount
        )

    result = [
        {"date": date, **categories}
        for date, categories in sorted(daily.items())
    ]

    return {"user_id": user_id, "daily_spending": result}
