#!/usr/bin/env python3
"""Train CatBoost and Random Forest sector-level vulnerability-proxy models.

The target is the reviewed census-informed proxy class (Low/Medium/High).
To avoid target leakage, this script uses only aggregated Sentinel-2 terrain
and spectral features. Census inputs used to construct the proxy label, sector
coordinates, and row-count fields are deliberately excluded.

Evaluation uses leave-one-district-out cross-validation. Every out-of-fold
prediction is from a model that did not train on that sector's district.
Results are therefore pilot evidence of proxy-class generalisation, not proof
of real-world Ubudehe prediction.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import joblib
import matplotlib

# The batch script writes PNG files without a display. When this module is
# imported from Jupyter, leave backend selection to the notebook frontend.
if __name__ == "__main__":
    matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from scipy.optimize import minimize_scalar
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import Pipeline


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FEATURES = PROJECT_ROOT / "data" / "processed" / "sector_subunit_x10_dataset.csv"
DEFAULT_LABELS = PROJECT_ROOT / "data" / "labels" / "sector_vulnerability_proxy_labels.csv"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "model_outputs"
DEFAULT_MODEL_DIR = PROJECT_ROOT / "models"
RANDOM_STATE = 42
CLASS_ORDER = ["Low", "Medium", "High"]
PRIMARY_ASSESSMENT_MODEL = "random_forest"
HYBRID_MODEL_WEIGHT = 0.60
HYBRID_INDICATOR_WEIGHT = 0.40
HYBRID_WEIGHT_SCENARIOS = {
    "indicator_model_equal_50_50": (0.50, 0.50),
    "recommended_model_60_indicator_40": (0.60, 0.40),
    "model_emphasis_70_indicator_30": (0.70, 0.30),
}

# Mean captures each assessment unit's typical remotely sensed condition;
# standard deviation captures spatial heterogeneity without making the feature
# table unnecessarily wide.
SENTINEL_VARIABLES = ("elevation", "ndvi", "ndbi", "mndwi", "slope")
SENTINEL_STATS = ("mean", "std")
TUNING_CANDIDATES = {
    "random_forest": [
        {"model__n_estimators": 250, "model__max_depth": 3, "model__min_samples_leaf": 2, "model__max_features": "sqrt"},
        {"model__n_estimators": 300, "model__max_depth": 5, "model__min_samples_leaf": 1, "model__max_features": "sqrt"},
        {"model__n_estimators": 300, "model__max_depth": 6, "model__min_samples_leaf": 2, "model__max_features": 0.8},
        {"model__n_estimators": 300, "model__max_depth": None, "model__min_samples_leaf": 4, "model__max_features": 0.8},
    ],
    "catboost": [
        {"model__iterations": 200, "model__depth": 3, "model__learning_rate": 0.03, "model__l2_leaf_reg": 5.0},
        {"model__iterations": 250, "model__depth": 4, "model__learning_rate": 0.03, "model__l2_leaf_reg": 7.0},
        {"model__iterations": 250, "model__depth": 5, "model__learning_rate": 0.03, "model__l2_leaf_reg": 7.0},
        {"model__iterations": 200, "model__depth": 4, "model__learning_rate": 0.05, "model__l2_leaf_reg": 9.0},
    ],
}


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    frame.to_csv(path, index=False, encoding="utf-8-sig")


def classify_score_tertiles(scores: pd.Series) -> tuple[pd.Series, dict[str, float]]:
    """Classify a continuous study-area score using transparent tertile cutoffs."""
    low_upper = float(scores.quantile(1 / 3))
    medium_upper = float(scores.quantile(2 / 3))
    classes = pd.Series(
        np.select(
            [scores.le(low_upper), scores.le(medium_upper)],
            ["Low", "Medium"],
            default="High",
        ),
        index=scores.index,
        dtype="object",
    )
    return classes, {"low_upper": low_upper, "medium_upper": medium_upper}


def add_hybrid_assessment_fields(assessments: pd.DataFrame) -> pd.DataFrame:
    """Fuse RF and census-indicator scores into the documented final ranking."""
    result = assessments.copy()
    result["hybrid_model_weight"] = HYBRID_MODEL_WEIGHT
    result["hybrid_indicator_weight"] = HYBRID_INDICATOR_WEIGHT
    result["hybrid_model_contribution"] = result["model_vulnerability_score"] * HYBRID_MODEL_WEIGHT
    result["hybrid_indicator_contribution"] = result["proxy_score"] * HYBRID_INDICATOR_WEIGHT
    result["hybrid_vulnerability_score"] = (
        result["hybrid_model_contribution"] + result["hybrid_indicator_contribution"]
    )
    result["hybrid_vulnerability_class"], thresholds = classify_score_tertiles(
        result["hybrid_vulnerability_score"]
    )
    result["hybrid_priority_rank"] = (
        result["hybrid_vulnerability_score"].rank(method="first", ascending=False).astype(int)
    )
    result["hybrid_class_threshold_method"] = "study_area_hybrid_score_tertiles"
    result["hybrid_class_low_upper_score"] = thresholds["low_upper"]
    result["hybrid_class_medium_upper_score"] = thresholds["medium_upper"]
    return result


def hybrid_sensitivity_analysis(assessments: pd.DataFrame) -> pd.DataFrame:
    """Show whether sector priorities are stable under plausible fusion weights."""
    scenarios: list[pd.DataFrame] = []
    baseline_ranks = assessments.set_index("sector_id")["hybrid_priority_rank"]
    for scenario, (model_weight, indicator_weight) in HYBRID_WEIGHT_SCENARIOS.items():
        result = assessments[
            ["sector_id", "sector_name", "district", "model_vulnerability_score", "proxy_score"]
        ].copy()
        result["scenario"] = scenario
        result["model_weight"] = model_weight
        result["indicator_weight"] = indicator_weight
        result["hybrid_score"] = (
            result["model_vulnerability_score"] * model_weight + result["proxy_score"] * indicator_weight
        )
        result["hybrid_class"], _ = classify_score_tertiles(result["hybrid_score"])
        result["hybrid_rank"] = result["hybrid_score"].rank(method="first", ascending=False).astype(int)
        result["baseline_60_40_rank"] = result["sector_id"].map(baseline_ranks).astype(int)
        result["rank_change_from_60_40"] = result["baseline_60_40_rank"] - result["hybrid_rank"]
        result["in_top_10"] = result["hybrid_rank"].le(10)
        scenarios.append(result)
    return pd.concat(scenarios, ignore_index=True).sort_values(["scenario", "hybrid_rank"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--features", type=Path, default=DEFAULT_FEATURES)
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def feature_columns(frame: pd.DataFrame) -> list[str]:
    candidate_sets = [
        [f"sentinel__{variable}__{stat}" for variable in SENTINEL_VARIABLES for stat in SENTINEL_STATS],
        [f"sentinel__{variable}__subunit_{stat}" for variable in SENTINEL_VARIABLES for stat in SENTINEL_STATS],
    ]
    for expected in candidate_sets:
        if all(column in frame.columns for column in expected):
            return expected
    missing_by_schema = {
        "sector_summary_dataset": [column for column in candidate_sets[0] if column not in frame.columns],
        "sector_subunit_dataset": [column for column in candidate_sets[1] if column not in frame.columns],
    }
    raise ValueError(f"Missing required aggregated Sentinel feature(s): {missing_by_schema}")


def training_unit(frame: pd.DataFrame) -> str:
    return "sector_subunit" if "sector_subunit_id" in frame.columns else "sector"


def model_metadata_columns(frame: pd.DataFrame) -> list[str]:
    base = ["sector_id", "sector_name", "district", "proxy_class", "proxy_score", "proxy_rank"]
    if "sector_subunit_id" in frame.columns:
        return [
            "sector_subunit_id",
            "sector_subunit_index",
            "sentinel__subunit_matched_row_count",
            *base,
        ]
    return base


def load_training_data(features_path: Path, labels_path: Path) -> tuple[pd.DataFrame, list[str]]:
    if not features_path.exists() or not labels_path.exists():
        raise FileNotFoundError(f"Expected features at {features_path} and labels at {labels_path}")
    features = pd.read_csv(features_path)
    labels = pd.read_csv(labels_path)
    required_feature_metadata = {"sector_id", "sector_name", "district"}
    required_label_columns = {"sector_id", "proxy_class", "proxy_score", "proxy_rank"}
    if missing := required_feature_metadata.difference(features.columns):
        raise ValueError(f"Feature table is missing metadata: {sorted(missing)}")
    if missing := required_label_columns.difference(labels.columns):
        raise ValueError(f"Label table is missing required columns: {sorted(missing)}")
    repeated_sector_features = features["sector_id"].duplicated().any()
    merge_validation = "many_to_one" if repeated_sector_features else "one_to_one"
    frame = features.merge(
        labels[["sector_id", "proxy_class", "proxy_score", "proxy_rank"]],
        how="inner",
        on="sector_id",
        validate=merge_validation,
    )
    if frame["sector_id"].nunique() != len(labels):
        raise ValueError("Training merge did not retain every labelled sector.")
    if not repeated_sector_features and len(frame) != len(labels):
        raise ValueError("Sector-level training merge did not retain exactly one feature row per labelled sector.")
    if repeated_sector_features and (frame.groupby("sector_id").size() < 1).any():
        raise ValueError("Subunit training merge produced at least one labelled sector with no feature rows.")
    selected = feature_columns(frame)
    frame[selected] = frame[selected].apply(pd.to_numeric, errors="coerce")
    if set(frame["proxy_class"]) != set(CLASS_ORDER):
        raise ValueError(f"Expected all proxy classes {CLASS_ORDER}; found {sorted(frame['proxy_class'].unique())}")
    if frame["district"].nunique() < 3:
        raise ValueError("At least three districts are needed for district-held-out evaluation.")
    return frame, selected


def make_models() -> dict[str, Pipeline]:
    return {
        "random_forest": Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=500,
                        max_depth=4,
                        min_samples_leaf=2,
                        max_features="sqrt",
                        class_weight="balanced",
                        random_state=RANDOM_STATE,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        "catboost": Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    CatBoostClassifier(
                        iterations=300,
                        depth=4,
                        learning_rate=0.03,
                        l2_leaf_reg=5.0,
                        loss_function="MultiClass",
                        random_seed=RANDOM_STATE,
                        verbose=False,
                        allow_writing_files=False,
                    ),
                ),
            ]
        ),
    }


def ordered_log_loss(y_true: pd.Series, probabilities: np.ndarray) -> float:
    indices = y_true.map({label: index for index, label in enumerate(CLASS_ORDER)}).to_numpy()
    selected = probabilities[np.arange(len(probabilities)), indices]
    return float(-np.log(np.clip(selected, 1e-12, 1.0)).mean())


def metric_row(
    y_true: pd.Series,
    y_pred: np.ndarray,
    model_name: str,
    held_out_district: str,
    probabilities: np.ndarray | None = None,
) -> dict[str, Any]:
    result = {
        "model": model_name,
        "held_out_district": held_out_district,
        "test_row_count": len(y_true),
        "accuracy": accuracy_score(y_true, y_pred),
        "balanced_accuracy": balanced_accuracy_score(y_true, y_pred),
        "macro_f1": f1_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
        "macro_precision": precision_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
        "macro_recall": recall_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
    }
    if probabilities is not None:
        encoded = pd.Categorical(y_true, categories=CLASS_ORDER).codes
        one_hot = np.eye(len(CLASS_ORDER))[encoded]
        confidence = probabilities.max(axis=1)
        result.update(
            {
                "log_loss": ordered_log_loss(y_true, probabilities),
                "multiclass_brier_score": float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1))),
                "mean_confidence": float(confidence.mean()),
                "confidence_accuracy_gap": float(confidence.mean() - result["accuracy"]),
            }
        )
    return result


def labels_for_model_classes(classes: Any) -> list[str]:
    """Normalise CatBoost's possible integer class codes to proxy labels."""
    observed = list(classes)
    if set(observed) == set(CLASS_ORDER):
        return [str(value) for value in observed]
    if all(isinstance(value, (int, np.integer, float, np.floating)) and int(value) == value for value in observed):
        codes = [int(value) for value in observed]
        if set(codes).issubset(set(range(len(CLASS_ORDER)))):
            return [CLASS_ORDER[code] for code in codes]
    raise ValueError(f"Cannot map model class labels to proxy classes: {observed}")


def model_probabilities(model: Pipeline, features: pd.DataFrame) -> np.ndarray:
    """Return probabilities in the stable Low/Medium/High column order."""
    observed = np.asarray(model.predict_proba(features))
    labels = labels_for_model_classes(model.classes_)
    ordered = np.zeros((len(features), len(CLASS_ORDER)), dtype=float)
    for source_index, label in enumerate(labels):
        ordered[:, CLASS_ORDER.index(label)] = observed[:, source_index]
    return ordered


def sector_probability_table(data: pd.DataFrame, probabilities: np.ndarray, prefix: str) -> pd.DataFrame:
    """Average repeated subunit probabilities to one independent sector row."""
    metadata = ["sector_id", "sector_name", "district", "proxy_class", "proxy_score", "proxy_rank"]
    rows = data[metadata].reset_index(drop=True).copy()
    for index, label in enumerate(CLASS_ORDER):
        rows[f"{prefix}_{label.lower()}"] = probabilities[:, index]
    return rows.groupby(metadata, as_index=False, dropna=False).mean(numeric_only=True)


def inner_district_splits(data: pd.DataFrame) -> list[tuple[np.ndarray, np.ndarray]]:
    """Keep both sectors and their subunits inside whole-district inner folds."""
    if data["district"].nunique() < 2:
        raise ValueError("At least two districts are required for group-aware inner validation.")
    splitter = LeaveOneGroupOut()
    return list(splitter.split(data, data["proxy_class"], groups=data["district"]))


def tune_model(
    model_name: str,
    model: Pipeline,
    data: pd.DataFrame,
    selected: list[str],
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Select parameters using inner sector-grouped predictions only."""
    candidates = TUNING_CANDIDATES[model_name]
    splits = inner_district_splits(data)
    rows: list[dict[str, Any]] = []
    for candidate_index, parameters in enumerate(candidates, start=1):
        fold_scores: list[float] = []
        for train_index, test_index in splits:
            fitted = clone(model).set_params(**parameters).fit(
                data.iloc[train_index][selected], data.iloc[train_index]["proxy_class"]
            )
            raw = model_probabilities(fitted, data.iloc[test_index][selected])
            sectors = sector_probability_table(data.iloc[test_index], raw, "raw_probability")
            raw_columns = [f"raw_probability_{label.lower()}" for label in CLASS_ORDER]
            predicted = np.asarray(CLASS_ORDER)[sectors[raw_columns].to_numpy().argmax(axis=1)]
            fold_scores.append(
                f1_score(sectors["proxy_class"], predicted, labels=CLASS_ORDER, average="macro", zero_division=0)
            )
        rows.append(
            {
                "candidate_index": candidate_index,
                "parameters_json": json.dumps(parameters, sort_keys=True),
                "mean_inner_macro_f1": float(np.mean(fold_scores)),
                "std_inner_macro_f1": float(np.std(fold_scores)),
            }
        )
    results = pd.DataFrame(rows).sort_values(
        ["mean_inner_macro_f1", "std_inner_macro_f1", "candidate_index"],
        ascending=[False, True, True],
    )
    best = candidates[int(results.iloc[0]["candidate_index"]) - 1]
    return best, results.reset_index(drop=True)


def inner_oof_sector_probabilities(
    model: Pipeline,
    parameters: dict[str, Any],
    data: pd.DataFrame,
    selected: list[str],
) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    for train_index, test_index in inner_district_splits(data):
        fitted = clone(model).set_params(**parameters).fit(
            data.iloc[train_index][selected], data.iloc[train_index]["proxy_class"]
        )
        raw = model_probabilities(fitted, data.iloc[test_index][selected])
        parts.append(sector_probability_table(data.iloc[test_index], raw, "raw_probability"))
    return pd.concat(parts, ignore_index=True).sort_values("sector_id")


def temperature_scale(probabilities: np.ndarray, temperature: float) -> np.ndarray:
    """Apply multiclass temperature scaling without changing class ordering."""
    logits = np.log(np.clip(probabilities, 1e-12, 1.0)) / temperature
    logits -= logits.max(axis=1, keepdims=True)
    scaled = np.exp(logits)
    return scaled / scaled.sum(axis=1, keepdims=True)


def fit_calibration_temperature(sector_predictions: pd.DataFrame) -> float:
    columns = [f"raw_probability_{label.lower()}" for label in CLASS_ORDER]
    probabilities = sector_predictions[columns].to_numpy()
    labels = sector_predictions["proxy_class"]

    def objective(value: float) -> float:
        return ordered_log_loss(labels, temperature_scale(probabilities, value))

    result = minimize_scalar(objective, bounds=(0.35, 5.0), method="bounded")
    if not result.success:
        raise ValueError(f"Probability calibration failed: {result.message}")
    return float(result.x)


def fit_tuned_calibrated_model(
    model_name: str,
    model: Pipeline,
    data: pd.DataFrame,
    selected: list[str],
) -> tuple[Pipeline, dict[str, Any], float, pd.DataFrame]:
    best_parameters, tuning = tune_model(model_name, model, data, selected)
    calibration_predictions = inner_oof_sector_probabilities(model, best_parameters, data, selected)
    temperature = fit_calibration_temperature(calibration_predictions)
    fitted = clone(model).set_params(**best_parameters).fit(data[selected], data["proxy_class"])
    return fitted, best_parameters, temperature, tuning


def evaluate_model(
    model_name: str,
    model: Pipeline,
    data: pd.DataFrame,
    selected: list[str],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    X, y, groups = data[selected], data["proxy_class"], data["district"]
    splitter = LeaveOneGroupOut()
    predictions: list[pd.DataFrame] = []
    fold_metrics: list[dict[str, Any]] = []
    for train_index, test_index in splitter.split(X, y, groups):
        train, test = data.iloc[train_index].copy(), data.iloc[test_index].copy()
        held_out_district = str(groups.iloc[test_index].iloc[0])
        best_parameters, tuning = tune_model(model_name, model, train, selected)
        calibration_predictions = inner_oof_sector_probabilities(model, best_parameters, train, selected)
        temperature = fit_calibration_temperature(calibration_predictions)
        fitted = clone(model).set_params(**best_parameters).fit(train[selected], train["proxy_class"])

        raw_rows = model_probabilities(fitted, test[selected])
        fold = sector_probability_table(test, raw_rows, "raw_probability")
        raw_columns = [f"raw_probability_{label.lower()}" for label in CLASS_ORDER]
        raw_sector_probabilities = fold[raw_columns].to_numpy()
        calibrated = temperature_scale(raw_sector_probabilities, temperature)
        predicted = np.asarray(CLASS_ORDER)[calibrated.argmax(axis=1)]
        fold["model"] = model_name
        fold["predicted_proxy_class"] = predicted
        fold["held_out_district"] = held_out_district
        fold["calibration_temperature"] = temperature
        fold["raw_prediction_confidence"] = raw_sector_probabilities.max(axis=1)
        for class_index, label in enumerate(CLASS_ORDER):
            fold[f"probability_{label.lower()}"] = calibrated[:, class_index]
        fold["prediction_confidence"] = calibrated.max(axis=1)
        predictions.append(fold)

        calibrated_metrics = metric_row(
            fold["proxy_class"], predicted, model_name, held_out_district, calibrated
        )
        raw_predicted = np.asarray(CLASS_ORDER)[raw_sector_probabilities.argmax(axis=1)]
        raw_metrics = metric_row(
            fold["proxy_class"], raw_predicted, model_name, held_out_district, raw_sector_probabilities
        )
        calibrated_metrics.update(
            {
                "training_sector_count": int(train["sector_id"].nunique()),
                "best_parameters_json": json.dumps(best_parameters, sort_keys=True),
                "best_inner_macro_f1": float(tuning.iloc[0]["mean_inner_macro_f1"]),
                "calibration_temperature": temperature,
                **{
                    f"raw_{key}": value
                    for key, value in raw_metrics.items()
                    if key not in {"model", "held_out_district", "test_row_count"}
                },
            }
        )
        fold_metrics.append(calibrated_metrics)

    oof = pd.concat(predictions, ignore_index=True).sort_values(["district", "sector_id"])
    folds = pd.DataFrame(fold_metrics)
    probability_columns = [f"probability_{label.lower()}" for label in CLASS_ORDER]
    raw_columns = [f"raw_probability_{label.lower()}" for label in CLASS_ORDER]
    candidate_probabilities = oof[probability_columns].to_numpy()
    candidate_metrics = metric_row(
        oof["proxy_class"],
        oof["predicted_proxy_class"].to_numpy(),
        model_name,
        "all_oof",
        candidate_probabilities,
    )
    raw_predicted = np.asarray(CLASS_ORDER)[oof[raw_columns].to_numpy().argmax(axis=1)]
    raw_metrics = metric_row(
        oof["proxy_class"], raw_predicted, model_name, "all_oof", oof[raw_columns].to_numpy()
    )
    calibration_selected = candidate_metrics["log_loss"] < raw_metrics["log_loss"]
    for label in CLASS_ORDER:
        calibrated_column = f"probability_{label.lower()}"
        oof[f"candidate_calibrated_{calibrated_column}"] = oof[calibrated_column]
        if not calibration_selected:
            oof[calibrated_column] = oof[f"raw_{calibrated_column}"]
    selected_probabilities = oof[probability_columns].to_numpy()
    oof["predicted_proxy_class"] = np.asarray(CLASS_ORDER)[selected_probabilities.argmax(axis=1)]
    oof["prediction_confidence"] = selected_probabilities.max(axis=1)
    oof["calibration_selected"] = calibration_selected
    overall_row = metric_row(
        oof["proxy_class"],
        oof["predicted_proxy_class"].to_numpy(),
        model_name,
        "all_oof",
        selected_probabilities,
    )
    overall_row.update(
        {
            f"raw_{key}": value
            for key, value in raw_metrics.items()
            if key not in {"model", "held_out_district", "test_row_count"}
        }
    )
    overall_row.update(
        {
            f"candidate_calibrated_{key}": value
            for key, value in candidate_metrics.items()
            if key not in {"model", "held_out_district", "test_row_count"}
        }
    )
    overall_row["calibration_selected"] = calibration_selected

    metric_names = [
        "accuracy", "balanced_accuracy", "macro_f1", "macro_precision", "macro_recall",
        "log_loss", "multiclass_brier_score", "mean_confidence", "confidence_accuracy_gap",
    ]
    for metric in metric_names:
        folds[f"candidate_calibrated_{metric}"] = folds[metric]
        if not calibration_selected:
            folds[metric] = folds[f"raw_{metric}"]
    folds["calibration_selected"] = calibration_selected
    return oof, folds, pd.DataFrame([overall_row])


def feature_importance(model_name: str, model: Pipeline, selected: list[str]) -> pd.DataFrame:
    estimator = model.named_steps["model"]
    importance = estimator.feature_importances_
    return pd.DataFrame(
        {"model": model_name, "feature": selected, "importance": importance}
    ).sort_values("importance", ascending=False)


def plot_class_distribution(data: pd.DataFrame, output_dir: Path) -> None:
    counts = data["proxy_class"].value_counts().reindex(CLASS_ORDER, fill_value=0)
    fig, axis = plt.subplots(figsize=(6, 4))
    axis.bar(counts.index, counts.values, color=["#2f7d42", "#b77916", "#b73b2e"])
    axis.set_title("Sector Proxy-Class Distribution")
    axis.set_ylabel("Sector count")
    for index, value in enumerate(counts.values):
        axis.text(index, value + 0.3, str(value), ha="center")
    fig.tight_layout()
    fig.savefig(output_dir / "class_distribution.png", dpi=180)
    plt.close(fig)


def plot_performance(performance: pd.DataFrame, output_dir: Path) -> None:
    metrics = ["balanced_accuracy", "macro_f1"]
    fig, axis = plt.subplots(figsize=(7, 4))
    labels = performance["model"].str.replace("_", " ").str.title().tolist()
    positions = np.arange(len(performance))
    width = 0.32
    for offset, metric in [(-width / 2, metrics[0]), (width / 2, metrics[1])]:
        axis.bar(positions + offset, performance[metric], width, label=metric.replace("_", " ").title())
    axis.set_xticks(positions, labels)
    axis.set_ylim(0, 1)
    axis.set_title("District-Held-Out Model Performance")
    axis.legend()
    fig.tight_layout()
    fig.savefig(output_dir / "model_performance.png", dpi=180)
    plt.close(fig)


def plot_confusion(model_name: str, oof: pd.DataFrame, output_dir: Path) -> None:
    matrix = confusion_matrix(oof["proxy_class"], oof["predicted_proxy_class"], labels=CLASS_ORDER)
    figure, axis = plt.subplots(figsize=(5, 4))
    ConfusionMatrixDisplay(matrix, display_labels=CLASS_ORDER).plot(ax=axis, colorbar=False)
    axis.set_title(f"{model_name.replace('_', ' ').title()} OOF Confusion Matrix")
    figure.tight_layout()
    figure.savefig(output_dir / f"confusion_matrix_{model_name}.png", dpi=180)
    plt.close(figure)


def plot_feature_importance(importance: pd.DataFrame, model_name: str, output_dir: Path) -> None:
    ordered = importance.sort_values("importance", ascending=True)
    figure, axis = plt.subplots(figsize=(8, 5))
    axis.barh(ordered["feature"], ordered["importance"], color="#1d6b8f")
    axis.set_title(f"{model_name.replace('_', ' ').title()} Feature Importance")
    axis.set_xlabel("Importance")
    figure.tight_layout()
    figure.savefig(output_dir / f"feature_importance_{model_name}.png", dpi=180)
    plt.close(figure)


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    output_dir = args.output_dir.resolve()
    model_dir = args.model_dir.resolve()
    if output_dir.exists() and any(output_dir.iterdir()) and not args.overwrite:
        raise SystemExit(f"Output directory is not empty: {output_dir}. Use --overwrite to replace outputs.")
    output_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    data, selected = load_training_data(args.features, args.labels)
    unit = training_unit(data)
    write_csv(data[[*model_metadata_columns(data), *selected]], output_dir / "training_dataset.csv")
    feature_summary = pd.DataFrame(
        {
            "feature": selected,
            "missing_count": [int(data[column].isna().sum()) for column in selected],
            "missing_rate": [float(data[column].isna().mean()) for column in selected],
            "mean": [float(data[column].mean()) for column in selected],
            "std": [float(data[column].std()) for column in selected],
            "min": [float(data[column].min()) for column in selected],
            "max": [float(data[column].max()) for column in selected],
        }
    )
    write_csv(feature_summary, output_dir / "feature_summary.csv")
    write_csv(data.groupby(["district", "proxy_class"]).size().rename(f"{unit}_row_count").reset_index(), output_dir / "district_class_distribution.csv")
    plot_class_distribution(data, output_dir)

    models = make_models()
    all_oof: list[pd.DataFrame] = []
    all_folds: list[pd.DataFrame] = []
    all_performance: list[pd.DataFrame] = []
    all_importance: list[pd.DataFrame] = []
    all_tuning: list[pd.DataFrame] = []
    reports: list[pd.DataFrame] = []
    for model_name, model in models.items():
        logging.info("Evaluating %s with leave-one-district-out validation", model_name)
        oof, fold_metrics, overall = evaluate_model(model_name, model, data, selected)
        fitted_full, best_parameters, temperature, tuning = fit_tuned_calibrated_model(
            model_name, model, data, selected
        )
        calibration_selected = bool(overall.iloc[0]["calibration_selected"])
        applied_temperature = temperature if calibration_selected else 1.0
        tuning.insert(0, "model", model_name)
        tuning.insert(1, "training_scope", "all_sectors")
        tuning["selected"] = tuning["parameters_json"].eq(json.dumps(best_parameters, sort_keys=True))
        importance = feature_importance(model_name, fitted_full, selected)
        report = pd.DataFrame(classification_report(
            oof["proxy_class"], oof["predicted_proxy_class"], labels=CLASS_ORDER, output_dict=True, zero_division=0
        )).transpose().reset_index(names="metric_or_class")
        report.insert(0, "model", model_name)
        joblib.dump(
            {
                "model": fitted_full,
                "feature_columns": selected,
                "best_parameters": best_parameters,
                "calibration_method": (
                    "sector_level_temperature_scaling" if calibration_selected else "identity_calibration"
                ),
                "calibration_selected": calibration_selected,
                "calibration_candidate_temperature": temperature,
                "calibration_temperature": applied_temperature,
                "target": "proxy_class",
                "training_unit": unit,
                "training_row_count": len(data),
                "independent_sector_count": int(data["sector_id"].nunique()),
                "evaluation": "nested_leave_one_district_out",
                "caveat": "Proxy-label pilot. Do not interpret as validated Ubudehe prediction.",
            },
            model_dir / f"sector_proxy_{model_name}.joblib",
        )
        all_oof.append(oof)
        all_folds.append(fold_metrics)
        all_performance.append(overall)
        all_importance.append(importance)
        all_tuning.append(tuning)
        reports.append(report)
        plot_confusion(model_name, oof, output_dir)
        plot_feature_importance(importance, model_name, output_dir)

    oof_all = pd.concat(all_oof, ignore_index=True)
    folds_all = pd.concat(all_folds, ignore_index=True)
    performance = pd.concat(all_performance, ignore_index=True)
    importance_all = pd.concat(all_importance, ignore_index=True)
    tuning_all = pd.concat(all_tuning, ignore_index=True)
    reports_all = pd.concat(reports, ignore_index=True)
    write_csv(oof_all, output_dir / "out_of_fold_predictions.csv")
    write_csv(folds_all, output_dir / "district_fold_performance.csv")
    write_csv(performance, output_dir / "model_performance.csv")
    write_csv(importance_all, output_dir / "feature_importance.csv")
    write_csv(tuning_all, output_dir / "hyperparameter_tuning.csv")
    write_csv(reports_all, output_dir / "classification_report.csv")
    plot_performance(performance, output_dir)

    probability_columns = [f"probability_{label.lower()}" for label in CLASS_ORDER]
    assessment_columns = [
        "sector_id", "sector_name", "district", "proxy_class", "proxy_score", "proxy_rank", *probability_columns
    ]
    assessments = oof_all.loc[oof_all["model"].eq(PRIMARY_ASSESSMENT_MODEL), assessment_columns].copy()
    if assessments["sector_id"].duplicated().any() or assessments["sector_id"].nunique() != data["sector_id"].nunique():
        raise ValueError("Primary-model assessments must contain exactly one row per sector.")
    assessments.insert(6, "primary_model", PRIMARY_ASSESSMENT_MODEL)
    assessments["model_predicted_class"] = (
        assessments[probability_columns].idxmax(axis=1).str.replace("probability_", "").str.title()
    )
    assessments["model_probability"] = assessments[probability_columns].max(axis=1)
    assessments["model_vulnerability_score"] = (
        assessments["probability_high"] + 0.5 * assessments["probability_medium"]
    )
    assessments["model_priority_rank"] = (
        assessments["model_vulnerability_score"].rank(method="first", ascending=False).astype(int)
    )
    assessments["model_agrees_with_proxy_label"] = assessments["model_predicted_class"].eq(assessments["proxy_class"])
    assessments = add_hybrid_assessment_fields(assessments)
    write_csv(assessments.sort_values("hybrid_priority_rank"), output_dir / "sector_model_assessments.csv")
    write_csv(hybrid_sensitivity_analysis(assessments), output_dir / "hybrid_weight_sensitivity.csv")

    metadata = {
        "training_unit": unit,
        "training_row_count": int(len(data)),
        "independent_sector_count": int(data["sector_id"].nunique()),
        "target": "proxy_class",
        "target_source": str(args.labels.resolve()),
        "feature_source": str(args.features.resolve()),
        "feature_columns": selected,
        "excluded_feature_categories": [
            "Census variables used to construct proxy labels",
            "Coordinates (latitude and longitude)",
            "Sentinel observation-count fields",
            "Raw or repeated observation-level rows",
        ],
        "evaluation": "nested_leave_one_district_out",
        "hyperparameter_tuning": "inner_leave_one_district_out_macro_f1",
        "probability_calibration": (
            "Sector-level temperature scaling is deployed only when nested OOF log loss improves."
        ),
        "final_assessment": {
            "name": "transparent_hybrid_vulnerability_index",
            "formula": "0.60 * random_forest_oof_score + 0.40 * census_indicator_score",
            "model_weight": HYBRID_MODEL_WEIGHT,
            "indicator_weight": HYBRID_INDICATOR_WEIGHT,
            "class_threshold_method": "study_area_hybrid_score_tertiles",
            "sensitivity_scenarios": HYBRID_WEIGHT_SCENARIOS,
            "important_dependency": (
                "The Random Forest target is derived from the census indicator class, so the two hybrid components "
                "are related and must not be interpreted as independent evidence."
            ),
        },
        "districts": sorted(data["district"].unique().tolist()),
        "class_counts": data["proxy_class"].value_counts().reindex(CLASS_ORDER).to_dict(),
        "limitations": [
            "Only 50 independent sector labels are available.",
            "The target is a census-informed proxy, not an official Ubudehe category.",
            "The hybrid weights are explicit decision weights, not parameters learned from independent outcomes.",
            "Performance estimates have high uncertainty and should be treated as pilot results.",
        ],
    }
    (output_dir / "model_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    logging.info("Saved model and analytics outputs to %s", output_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, KeyError) as error:
        logging.error("%s", error)
        raise SystemExit(2) from error
