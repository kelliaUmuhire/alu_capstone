from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parents[3]
MODEL_OUTPUTS_DIR = PROJECT_ROOT / "data" / "model_outputs"
MODEL_DIR = PROJECT_ROOT / "models"
PROXY_DIR = PROJECT_ROOT / "data" / "labels"

ASSESSMENTS_PATH = MODEL_OUTPUTS_DIR / "sector_model_assessments.csv"
MODEL_PERFORMANCE_PATH = MODEL_OUTPUTS_DIR / "model_performance.csv"
DISTRICT_FOLD_PERFORMANCE_PATH = MODEL_OUTPUTS_DIR / "district_fold_performance.csv"
FEATURE_IMPORTANCE_PATH = MODEL_OUTPUTS_DIR / "feature_importance.csv"
FEATURE_SUMMARY_PATH = MODEL_OUTPUTS_DIR / "feature_summary.csv"
TRAINING_DATASET_PATH = MODEL_OUTPUTS_DIR / "training_dataset.csv"
MODEL_METADATA_PATH = MODEL_OUTPUTS_DIR / "model_metadata.json"
HYBRID_SENSITIVITY_PATH = MODEL_OUTPUTS_DIR / "hybrid_weight_sensitivity.csv"
PROXY_LABELS_PATH = PROXY_DIR / "sector_vulnerability_proxy_labels.csv"
GADM_L3_PATH = PROJECT_ROOT / "data" / "raw" / "gadm41_RWA_3.json"

MODEL_PATHS = {
    "random_forest": MODEL_DIR / "sector_proxy_random_forest.joblib",
    "catboost": MODEL_DIR / "sector_proxy_catboost.joblib",
}

CLASS_ORDER = ["Low", "Medium", "High"]
FEATURE_COLUMNS = [
    "sentinel__elevation__subunit_mean",
    "sentinel__elevation__subunit_std",
    "sentinel__ndvi__subunit_mean",
    "sentinel__ndvi__subunit_std",
    "sentinel__ndbi__subunit_mean",
    "sentinel__ndbi__subunit_std",
    "sentinel__mndwi__subunit_mean",
    "sentinel__mndwi__subunit_std",
    "sentinel__slope__subunit_mean",
    "sentinel__slope__subunit_std",
]


class SectorPredictionPayload(BaseModel):
    sentinel__elevation__subunit_mean: float | None = Field(None, description="Mean elevation for the sector subunit.")
    sentinel__elevation__subunit_std: float | None = Field(None, description="Elevation standard deviation.")
    sentinel__ndvi__subunit_mean: float | None = Field(None, description="Mean NDVI.")
    sentinel__ndvi__subunit_std: float | None = Field(None, description="NDVI standard deviation.")
    sentinel__ndbi__subunit_mean: float | None = Field(None, description="Mean NDBI.")
    sentinel__ndbi__subunit_std: float | None = Field(None, description="NDBI standard deviation.")
    sentinel__mndwi__subunit_mean: float | None = Field(None, description="Mean MNDWI.")
    sentinel__mndwi__subunit_std: float | None = Field(None, description="MNDWI standard deviation.")
    sentinel__slope__subunit_mean: float | None = Field(None, description="Mean slope.")
    sentinel__slope__subunit_std: float | None = Field(None, description="Slope standard deviation.")


class PredictionResponse(BaseModel):
    model: str
    predicted_proxy_class: str
    probabilities: dict[str, float]
    feature_columns: list[str]
    caveat: str


app = FastAPI(
    title="Rwanda Sector Vulnerability API",
    version="0.3.0",
    description=(
        "FastAPI service for the sector-level ML-assisted hybrid vulnerability dashboard. "
        "The final priority combines 60% Random Forest out-of-fold score with 40% census "
        "indicator score. It is not an official Ubudehe category or field-validated poverty estimate."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing {label}: {path}")


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [{key: clean_value(value) for key, value in row.items()} for row in frame.to_dict(orient="records")]


def class_counts(frame: pd.DataFrame, column: str = "proxy_class") -> dict[str, int]:
    counts = frame[column].value_counts().reindex(CLASS_ORDER, fill_value=0)
    return {label: int(counts[label]) for label in CLASS_ORDER}


def normalize_class(value: str | None) -> str | None:
    if value is None:
        return None
    lookup = {label.casefold(): label for label in CLASS_ORDER}
    normalized = lookup.get(value.casefold())
    if normalized is None:
        raise HTTPException(status_code=422, detail=f"Class must be one of {CLASS_ORDER}.")
    return normalized


@lru_cache
def load_assessments() -> pd.DataFrame:
    ensure_file(ASSESSMENTS_PATH, "sector model assessments")
    frame = pd.read_csv(ASSESSMENTS_PATH)
    labels = load_proxy_labels()
    census_columns = [
        "sector_id",
        "population_total",
        "population_urban",
        "population_rural",
        "urban_share",
        "rural_share",
        "population_density_per_km2",
        "sex_population_total",
        "population_male",
        "population_female",
        "female_share",
        "sex_ratio_male_per_100_female",
        "child_dependency_ratio",
        "older_dependency_ratio",
        "total_age_dependency_ratio",
        "age_table_granularity",
        "district_age_share_0_14",
        "district_age_share_15_64",
        "district_age_share_65_plus",
        "component_density_pressure",
        "component_rurality_context",
        "component_district_age_dependency_context",
        "label_limitations",
    ]
    available_columns = [column for column in census_columns if column in labels.columns]
    if len(available_columns) > 1:
        frame = frame.merge(
            labels[available_columns].drop_duplicates("sector_id"),
            how="left",
            on="sector_id",
            validate="one_to_one",
        )
    return frame.sort_values("hybrid_priority_rank").reset_index(drop=True)


@lru_cache
def load_proxy_labels() -> pd.DataFrame:
    ensure_file(PROXY_LABELS_PATH, "sector vulnerability proxy labels")
    return pd.read_csv(PROXY_LABELS_PATH)


@lru_cache
def load_training_dataset() -> pd.DataFrame:
    ensure_file(TRAINING_DATASET_PATH, "sector training dataset")
    return pd.read_csv(TRAINING_DATASET_PATH)


@lru_cache
def load_model_performance() -> pd.DataFrame:
    ensure_file(MODEL_PERFORMANCE_PATH, "model performance")
    return pd.read_csv(MODEL_PERFORMANCE_PATH)


@lru_cache
def load_district_fold_performance() -> pd.DataFrame:
    ensure_file(DISTRICT_FOLD_PERFORMANCE_PATH, "district fold performance")
    return pd.read_csv(DISTRICT_FOLD_PERFORMANCE_PATH)


@lru_cache
def load_feature_importance() -> pd.DataFrame:
    ensure_file(FEATURE_IMPORTANCE_PATH, "feature importance")
    return pd.read_csv(FEATURE_IMPORTANCE_PATH)


@lru_cache
def load_feature_summary() -> pd.DataFrame:
    ensure_file(FEATURE_SUMMARY_PATH, "feature summary")
    return pd.read_csv(FEATURE_SUMMARY_PATH)


@lru_cache
def load_model_metadata() -> dict[str, Any]:
    if not MODEL_METADATA_PATH.exists():
        return {}
    return json.loads(MODEL_METADATA_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_gadm_l3() -> dict[str, Any]:
    ensure_file(GADM_L3_PATH, "GADM level-3 GeoJSON")
    return json.loads(GADM_L3_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_model_bundle(model_name: str) -> dict[str, Any]:
    path = MODEL_PATHS.get(model_name)
    if path is None:
        raise HTTPException(status_code=422, detail=f"Model must be one of {sorted(MODEL_PATHS)}.")
    ensure_file(path, f"{model_name} model bundle")
    bundle = joblib.load(path)
    if not isinstance(bundle, dict) or "model" not in bundle:
        raise ValueError(f"{model_name} bundle must contain a 'model' key.")
    return bundle


def filter_assessments(
    district: str | None,
    hybrid_class: str | None,
    proxy_class: str | None,
    predicted_class: str | None,
    agreement: bool | None,
    search: str | None,
) -> pd.DataFrame:
    frame = load_assessments()
    if district:
        frame = frame[frame["district"].astype(str).str.casefold() == district.casefold()]
    hybrid_class = normalize_class(hybrid_class)
    if hybrid_class:
        frame = frame[frame["hybrid_vulnerability_class"] == hybrid_class]
    proxy_class = normalize_class(proxy_class)
    if proxy_class:
        frame = frame[frame["proxy_class"] == proxy_class]
    predicted_class = normalize_class(predicted_class)
    if predicted_class:
        frame = frame[frame["model_predicted_class"] == predicted_class]
    if agreement is not None:
        frame = frame[frame["model_agrees_with_proxy_label"].astype(bool) == agreement]
    if search:
        needle = search.casefold()
        searchable = [
            "sector_id", "sector_name", "district", "hybrid_vulnerability_class", "proxy_class",
            "model_predicted_class",
        ]
        mask = pd.Series(False, index=frame.index)
        for column in searchable:
            mask = mask | frame[column].astype(str).str.casefold().str.contains(needle, regex=False)
        frame = frame[mask]
    return frame


def sort_frame(frame: pd.DataFrame, sort_by: str, order: Literal["asc", "desc"]) -> pd.DataFrame:
    allowed = {
        "hybrid_priority_rank",
        "hybrid_vulnerability_score",
        "model_priority_rank",
        "model_vulnerability_score",
        "model_probability",
        "proxy_rank",
        "proxy_score",
        "sector_name",
        "district",
    }
    if sort_by not in allowed:
        raise HTTPException(status_code=422, detail=f"sort_by must be one of {sorted(allowed)}.")
    return frame.sort_values(sort_by, ascending=order == "asc")


def sector_summary() -> dict[str, Any]:
    assessments = load_assessments()
    labels = load_proxy_labels()
    performance = load_model_performance()
    best_model = performance.sort_values(["macro_f1", "balanced_accuracy"], ascending=False).head(1)
    top = assessments.sort_values("hybrid_priority_rank").head(1)
    return {
        "sector_count": int(assessments["sector_id"].nunique()),
        "district_count": int(assessments["district"].nunique()),
        "training_row_count": int(load_model_metadata().get("training_row_count", len(load_training_dataset()))),
        "independent_sector_count": int(load_model_metadata().get("independent_sector_count", assessments["sector_id"].nunique())),
        "class_counts": class_counts(assessments, "hybrid_vulnerability_class"),
        "indicator_class_counts": class_counts(assessments),
        "predicted_class_counts": class_counts(assessments, "model_predicted_class"),
        "agreement_count": int(assessments["model_agrees_with_proxy_label"].astype(bool).sum()),
        "average_proxy_score": float(assessments["proxy_score"].mean()),
        "average_hybrid_score": float(assessments["hybrid_vulnerability_score"].mean()),
        "top_priority_sector": records(top)[0] if not top.empty else None,
        "best_model": records(best_model)[0] if not best_model.empty else None,
        "population_total": int(labels["population_total"].sum()) if "population_total" in labels else None,
        "caveat": "ML-assisted hybrid prioritisation index; not an official Ubudehe or household-level assessment.",
    }


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": "Rwanda Sector Vulnerability API",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
        "dashboard": "/dashboard",
        "sectors": "/sectors",
        "sector_geojson": "/map/sectors.geojson",
        "caveat": "ML-assisted hybrid index only; not an official Ubudehe or household assessment.",
    }


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, Any]:
    required = {
        "assessments": ASSESSMENTS_PATH,
        "proxy_labels": PROXY_LABELS_PATH,
        "training_dataset": TRAINING_DATASET_PATH,
        "model_performance": MODEL_PERFORMANCE_PATH,
        "feature_importance": FEATURE_IMPORTANCE_PATH,
        "hybrid_sensitivity": HYBRID_SENSITIVITY_PATH,
        "gadm_l3": GADM_L3_PATH,
        **{f"model_{name}": path for name, path in MODEL_PATHS.items()},
    }
    checks = {name: path.exists() for name, path in required.items()}
    return {
        "status": "ok" if all(checks.values()) else "degraded",
        "checks": checks,
        "summary": sector_summary() if checks["assessments"] else None,
    }


@app.get("/dashboard")
@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    assessments = load_assessments()
    return {
        "summary": sector_summary(),
        "districts": districts(),
        "classes": CLASS_ORDER,
        "rankings": records(assessments.sort_values("hybrid_priority_rank").head(15)),
        "model_performance": records(load_model_performance()),
        "feature_importance": records(load_feature_importance().sort_values("importance", ascending=False).head(12)),
        "metadata": load_model_metadata(),
    }


@app.get("/sectors")
@app.get("/api/sectors")
def list_sectors(
    district: str | None = Query(None, description="Filter by district."),
    hybrid_class: str | None = Query(None, description="Filter by final hybrid class: Low, Medium, or High."),
    proxy_class: str | None = Query(None, description="Filter by proxy class: Low, Medium, or High."),
    predicted_class: str | None = Query(None, description="Filter by Random Forest predicted class."),
    agreement: bool | None = Query(None, description="Filter by whether the Random Forest prediction agrees with the proxy label."),
    search: str | None = Query(None, description="Case-insensitive search across sector fields."),
    sort_by: str = Query("hybrid_priority_rank", description="Sort field."),
    order: Literal["asc", "desc"] = Query("asc"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    frame = filter_assessments(district, hybrid_class, proxy_class, predicted_class, agreement, search)
    frame = sort_frame(frame, sort_by, order)
    total = int(len(frame))
    page = frame.iloc[offset : offset + limit]
    return {"total": total, "limit": limit, "offset": offset, "items": records(page)}


@app.get("/sectors/{sector_id}")
@app.get("/api/sectors/{sector_id}")
def get_sector(sector_id: str) -> dict[str, Any]:
    assessments = load_assessments()
    match = assessments[assessments["sector_id"].astype(str).str.casefold() == sector_id.casefold()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Sector not found.")
    sector = records(match)[0]
    labels = load_proxy_labels()
    label_match = labels[labels["sector_id"].astype(str).str.casefold() == sector_id.casefold()]
    sector["census_proxy_inputs"] = records(label_match)[0] if not label_match.empty else None
    return sector


@app.get("/rankings/top")
@app.get("/api/rankings/top")
def top_ranked(limit: int = Query(10, ge=1, le=50)) -> list[dict[str, Any]]:
    return records(load_assessments().sort_values("hybrid_priority_rank").head(limit))


@app.get("/districts")
@app.get("/api/districts")
def districts() -> list[str]:
    return sorted(load_assessments()["district"].dropna().astype(str).unique().tolist())


@app.get("/summary")
@app.get("/api/summary")
def summary() -> dict[str, Any]:
    return sector_summary()


@app.get("/model/performance")
@app.get("/api/model/performance")
def model_performance(
    include_folds: bool = Query(False, description="Include leave-one-district-out fold metrics."),
) -> dict[str, Any]:
    response = {"overall": records(load_model_performance())}
    if include_folds:
        response["folds"] = records(load_district_fold_performance())
    return response


@app.get("/feature-importance")
@app.get("/api/feature-importance")
def feature_importance(
    model: Literal["random_forest", "catboost"] | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> list[dict[str, Any]]:
    frame = load_feature_importance()
    if model:
        frame = frame[frame["model"] == model]
    return records(frame.sort_values("importance", ascending=False).head(limit))


@app.get("/features/summary")
@app.get("/api/features/summary")
def feature_summary() -> list[dict[str, Any]]:
    return records(load_feature_summary())


@app.get("/training/subunits")
@app.get("/api/training/subunits")
def training_subunits(
    sector_id: str | None = Query(None),
    district: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    frame = load_training_dataset()
    if sector_id:
        frame = frame[frame["sector_id"].astype(str).str.casefold() == sector_id.casefold()]
    if district:
        frame = frame[frame["district"].astype(str).str.casefold() == district.casefold()]
    total = int(len(frame))
    page = frame.sort_values(["district", "sector_id", "sector_subunit_index"]).iloc[offset : offset + limit]
    return {"total": total, "limit": limit, "offset": offset, "items": records(page)}


@app.get("/map/sectors.geojson")
@app.get("/api/map/sectors.geojson")
def sector_geojson(
    assessed_only: bool = Query(True, description="Return only sectors with model assessments."),
) -> dict[str, Any]:
    geojson = load_gadm_l3()
    assessment_lookup = {
        row["sector_id"]: row
        for row in records(load_assessments())
    }
    features = []
    for feature in geojson.get("features", []):
        sector_id = feature.get("properties", {}).get("GID_3")
        assessment = assessment_lookup.get(sector_id)
        if assessed_only and assessment is None:
            continue
        copied = {
            "type": "Feature",
            "geometry": feature.get("geometry"),
            "properties": dict(feature.get("properties", {})),
        }
        if assessment is not None:
            copied["properties"].update({"assessment": assessment})
        features.append(copied)
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "assessed_only": assessed_only,
            "feature_count": len(features),
            "assessment_count": len(assessment_lookup),
            "caveat": "GeoJSON assessment properties use proxy labels, not official Ubudehe labels.",
        },
    }


@app.post("/predict/sector", response_model=PredictionResponse)
@app.post("/api/predict/sector", response_model=PredictionResponse)
def predict_sector(
    payload: SectorPredictionPayload,
    model: Literal["random_forest", "catboost"] = Query("random_forest"),
) -> PredictionResponse:
    try:
        bundle = load_model_bundle(model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    feature_columns = bundle.get("feature_columns", FEATURE_COLUMNS)
    input_row = {column: getattr(payload, column, None) for column in feature_columns}
    input_frame = pd.DataFrame([input_row], columns=feature_columns)
    input_frame = input_frame.apply(pd.to_numeric, errors="coerce")

    estimator = bundle["model"]
    probability_values = np.asarray(estimator.predict_proba(input_frame))[0]
    model_labels = list(getattr(estimator, "classes_", CLASS_ORDER))
    probabilities = {label: 0.0 for label in CLASS_ORDER}
    for label, probability in zip(model_labels, probability_values, strict=False):
        label_name = CLASS_ORDER[int(label)] if isinstance(label, (int, np.integer)) else str(label)
        probabilities[label_name] = float(probability)
    ordered = np.asarray([probabilities[label] for label in CLASS_ORDER])
    temperature = float(bundle.get("calibration_temperature", 1.0))
    logits = np.log(np.clip(ordered, 1e-12, 1.0)) / temperature
    calibrated = np.exp(logits - logits.max())
    calibrated /= calibrated.sum()
    probabilities = {label: float(calibrated[index]) for index, label in enumerate(CLASS_ORDER)}
    predicted_label = CLASS_ORDER[int(calibrated.argmax())]

    return PredictionResponse(
        model=model,
        predicted_proxy_class=predicted_label,
        probabilities=probabilities,
        feature_columns=list(feature_columns),
        caveat="Proxy-label pilot prediction only; not field-validated and not an official Ubudehe estimate.",
    )
