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

# Mean captures each assessment unit's typical remotely sensed condition;
# standard deviation captures spatial heterogeneity without making the feature
# table unnecessarily wide.
SENTINEL_VARIABLES = ("elevation", "ndvi", "ndbi", "mndwi", "slope")
SENTINEL_STATS = ("mean", "std")


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    frame.to_csv(path, index=False, encoding="utf-8-sig")


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


def metric_row(y_true: pd.Series, y_pred: np.ndarray, model_name: str, held_out_district: str) -> dict[str, Any]:
    return {
        "model": model_name,
        "held_out_district": held_out_district,
        "test_row_count": len(y_true),
        "accuracy": accuracy_score(y_true, y_pred),
        "balanced_accuracy": balanced_accuracy_score(y_true, y_pred),
        "macro_f1": f1_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
        "macro_precision": precision_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
        "macro_recall": recall_score(y_true, y_pred, labels=CLASS_ORDER, average="macro", zero_division=0),
    }


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


def evaluate_model(
    model_name: str,
    model: Pipeline,
    data: pd.DataFrame,
    selected: list[str],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    X = data[selected]
    y = data["proxy_class"]
    groups = data["district"]
    splitter = LeaveOneGroupOut()
    predictions: list[pd.DataFrame] = []
    fold_metrics: list[dict[str, Any]] = []
    for train_index, test_index in splitter.split(X, y, groups):
        X_train, X_test = X.iloc[train_index], X.iloc[test_index]
        y_train, y_test = y.iloc[train_index], y.iloc[test_index]
        held_out_district = str(groups.iloc[test_index].iloc[0])
        fitted = model.fit(X_train, y_train)
        model_labels = labels_for_model_classes(fitted.classes_)
        predicted = np.asarray(fitted.predict(X_test)).reshape(-1)
        if set(predicted).issubset(set(range(len(CLASS_ORDER)))):
            predicted = np.asarray([CLASS_ORDER[int(value)] for value in predicted])
        probabilities = fitted.predict_proba(X_test)
        probability_frame = pd.DataFrame(0.0, index=test_index, columns=CLASS_ORDER)
        probability_frame.loc[:, model_labels] = probabilities
        fold = data.iloc[test_index][model_metadata_columns(data)].copy()
        fold["model"] = model_name
        fold["predicted_proxy_class"] = predicted
        fold["held_out_district"] = held_out_district
        for label in CLASS_ORDER:
            fold[f"probability_{label.lower()}"] = probability_frame.loc[test_index, label].to_numpy()
        fold["prediction_confidence"] = probability_frame.max(axis=1).to_numpy()
        predictions.append(fold)
        fold_metrics.append(metric_row(y_test, predicted, model_name, held_out_district))
    oof = pd.concat(predictions, ignore_index=True).sort_values(["district", "sector_id"])
    folds = pd.DataFrame(fold_metrics)
    overall = pd.DataFrame(
        [metric_row(oof["proxy_class"], oof["predicted_proxy_class"].to_numpy(), model_name, "all_oof")]
    )
    return oof, folds, overall


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
    reports: list[pd.DataFrame] = []
    for model_name, model in models.items():
        logging.info("Evaluating %s with leave-one-district-out validation", model_name)
        oof, fold_metrics, overall = evaluate_model(model_name, model, data, selected)
        fitted_full = model.fit(data[selected], data["proxy_class"])
        importance = feature_importance(model_name, fitted_full, selected)
        report = pd.DataFrame(classification_report(
            oof["proxy_class"], oof["predicted_proxy_class"], labels=CLASS_ORDER, output_dict=True, zero_division=0
        )).transpose().reset_index(names="metric_or_class")
        report.insert(0, "model", model_name)
        joblib.dump(
            {
                "model": fitted_full,
                "feature_columns": selected,
                "target": "proxy_class",
                "training_unit": unit,
                "training_row_count": len(data),
                "independent_sector_count": int(data["sector_id"].nunique()),
                "evaluation": "leave_one_district_out",
                "caveat": "Proxy-label pilot. Do not interpret as validated Ubudehe prediction.",
            },
            model_dir / f"sector_proxy_{model_name}.joblib",
        )
        all_oof.append(oof)
        all_folds.append(fold_metrics)
        all_performance.append(overall)
        all_importance.append(importance)
        reports.append(report)
        plot_confusion(model_name, oof, output_dir)
        plot_feature_importance(importance, model_name, output_dir)

    oof_all = pd.concat(all_oof, ignore_index=True)
    folds_all = pd.concat(all_folds, ignore_index=True)
    performance = pd.concat(all_performance, ignore_index=True)
    importance_all = pd.concat(all_importance, ignore_index=True)
    reports_all = pd.concat(reports, ignore_index=True)
    write_csv(oof_all, output_dir / "out_of_fold_predictions.csv")
    write_csv(folds_all, output_dir / "district_fold_performance.csv")
    write_csv(performance, output_dir / "model_performance.csv")
    write_csv(importance_all, output_dir / "feature_importance.csv")
    write_csv(reports_all, output_dir / "classification_report.csv")
    plot_performance(performance, output_dir)

    probability_columns = [f"probability_{label.lower()}" for label in CLASS_ORDER]
    consensus = (
        oof_all.groupby(["sector_id", "sector_name", "district", "proxy_class", "proxy_score", "proxy_rank"], as_index=False)[probability_columns]
        .mean()
    )
    consensus["consensus_predicted_class"] = consensus[probability_columns].idxmax(axis=1).str.replace("probability_", "").str.title()
    consensus["consensus_confidence"] = consensus[probability_columns].max(axis=1)
    consensus["agreement_with_proxy_label"] = consensus["consensus_predicted_class"].eq(consensus["proxy_class"])
    write_csv(consensus.sort_values("proxy_rank"), output_dir / "sector_model_assessments.csv")

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
        "evaluation": "leave_one_district_out",
        "districts": sorted(data["district"].unique().tolist()),
        "class_counts": data["proxy_class"].value_counts().reindex(CLASS_ORDER).to_dict(),
        "limitations": [
            "Only 50 independent sector labels are available.",
            "The target is a census-informed proxy, not an official Ubudehe category.",
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
