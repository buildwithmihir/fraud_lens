"""Train an XGBoost fraud classifier on the credit-card dataset (~0.17% fraud).

Accuracy is meaningless at this imbalance, so we weight the positive class and
report precision/recall/F1/AUC plus a confusion matrix with the catch rate.
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

MODEL_DIR = Path(__file__).resolve().parent
DATA_PATH = MODEL_DIR / "data" / "creditcard.csv"
OUT_PATH = MODEL_DIR / "saved_model" / "fraud_model.pkl"
RANDOM_STATE = 42
TEST_SIZE = 0.2

# --- Load ------------------------------------------------------------------
df = pd.read_csv(DATA_PATH)
print(f"Loaded {len(df):,} rows x {df.shape[1]} cols from {DATA_PATH.name}")

# Time is seconds-from-start, not time-of-day, so it carries no generalizable
# signal — drop it. Features are V1-V28 (PCA components) + Amount.
X = df.drop(columns=["Time", "Class"])
y = df["Class"].astype(int)
print(f"Features ({X.shape[1]}): {X.columns[0]}..{X.columns[-2]}, {X.columns[-1]}")
print(f"Fraud    : {y.sum():,} / {len(y):,} ({y.mean() * 100:.3f}%)")

# --- Split -----------------------------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
)

# Computed from the training split, never hardcoded.
n_neg, n_pos = int((y_train == 0).sum()), int((y_train == 1).sum())
scale_pos_weight = n_neg / n_pos
print(f"\nTrain    : {len(y_train):,} rows ({n_pos} fraud)")
print(f"Test     : {len(y_test):,} rows ({int(y_test.sum())} fraud)")
print(f"scale_pos_weight = {n_neg:,} / {n_pos} = {scale_pos_weight:.2f}")

# --- Train -----------------------------------------------------------------
model = XGBClassifier(
    n_estimators=400, max_depth=4, learning_rate=0.1, subsample=0.8,
    colsample_bytree=0.8, scale_pos_weight=scale_pos_weight,
    eval_metric="aucpr", tree_method="hist", n_jobs=-1,
    random_state=RANDOM_STATE,
)
model.fit(X_train, y_train)

# --- Evaluate on the held-out test set -------------------------------------
y_pred = model.predict(X_test)
y_proba = model.predict_proba(X_test)[:, 1]

print("\n=== Held-out test metrics ===")
print(f"Precision : {precision_score(y_test, y_pred):.4f}")
print(f"Recall    : {recall_score(y_test, y_pred):.4f}")
print(f"F1        : {f1_score(y_test, y_pred):.4f}")
print(f"ROC-AUC   : {roc_auc_score(y_test, y_proba):.4f}")
print(f"PR-AUC    : {average_precision_score(y_test, y_proba):.4f}")

tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
print("\n=== Confusion matrix ===")
print(f"{'':14}{'pred legit':>12}{'pred fraud':>12}")
print(f"{'actual legit':14}{tn:>12,}{fp:>12,}")
print(f"{'actual fraud':14}{fn:>12,}{tp:>12,}")
print(f"\nFraud caught : {tp}/{tp + fn} ({tp / (tp + fn) * 100:.1f}%)")
print(f"False alarms : {fp:,} of {tn + fp:,} legit ({fp / (tn + fp) * 100:.3f}%)")

# --- Save ------------------------------------------------------------------
OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
joblib.dump(model, OUT_PATH)
print(f"\nSaved model -> {OUT_PATH}")
