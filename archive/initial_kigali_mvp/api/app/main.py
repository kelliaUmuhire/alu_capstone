from functools import lru_cache
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
MODELS_DIR = PROJECT_ROOT / "models"

RANKINGS_PATH = OUTPUTS_DIR / "settlement_vulnerability_rankings.csv"
FEATURE_IMPORTANCE_PATH = OUTPUTS_DIR / "feature_importance.csv"
MODEL_PATH = MODELS_DIR / "vulnerability_random_forest.joblib"

FEATURE_COLS = [
    "ndvi_real",
    "ndbi_real",
    "mndwi_real",
    "elevation_m_real",
    "slope_degrees_real",
    "flood_zone_overlap_real",
    "building_density_per_ha_real",
    "road_density_m_per_ha_real",
]


class FeaturePayload(BaseModel):
    ndvi_real: float = Field(..., description="Mean NDVI sampled around the settlement.")
    ndbi_real: float = Field(..., description="Mean NDBI sampled around the settlement.")
    mndwi_real: float = Field(..., description="Mean MNDWI sampled around the settlement.")
    elevation_m_real: float = Field(..., description="Mean elevation in meters.")
    slope_degrees_real: float = Field(..., description="Mean slope in degrees.")
    flood_zone_overlap_real: float = Field(
        ..., ge=0, le=1, description="Fraction of wet pixels, derived from MNDWI > 0."
    )
    building_density_per_ha_real: float = Field(
        ..., ge=0, description="OSM building count per hectare."
    )
    road_density_m_per_ha_real: float = Field(
        ..., ge=0, description="OSM drivable road length in meters per hectare."
    )


class PredictionResponse(BaseModel):
    predicted_vulnerability_class: str
    probabilities: dict[str, float]
    caveat: str


app = FastAPI(
    title="Kigali Settlement Vulnerability MVP API",
    version="0.1.0",
    description=(
        "Simple API for exploring settlement vulnerability rankings and "
        "testing the MVP Random Forest classifier. Labels are proxy labels "
        "for prototype use only."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache
def load_rankings() -> pd.DataFrame:
    if not RANKINGS_PATH.exists():
        raise FileNotFoundError(f"Missing rankings file: {RANKINGS_PATH}")
    df = pd.read_csv(RANKINGS_PATH)
    return df.sort_values("vulnerability_rank").reset_index(drop=True)


@lru_cache
def load_feature_importance() -> pd.DataFrame:
    if not FEATURE_IMPORTANCE_PATH.exists():
        return pd.DataFrame(columns=["feature", "importance"])
    return pd.read_csv(FEATURE_IMPORTANCE_PATH)


@lru_cache
def load_model_bundle() -> dict:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model file: {MODEL_PATH}")
    bundle = joblib.load(MODEL_PATH)
    if "model" not in bundle:
        raise ValueError("Model bundle must contain a 'model' key.")
    return bundle


def records(df: pd.DataFrame) -> list[dict]:
    return df.where(pd.notna(df), None).to_dict(orient="records")


@app.get("/")
def root() -> dict:
    return {
        "name": "Kigali Settlement Vulnerability MVP API",
        "docs": "/docs",
        "health": "/health",
        "caveat": "Proxy labels only; replace with validated labels before operational use.",
    }


@app.get("/health")
def health() -> dict:
    rankings_ok = RANKINGS_PATH.exists()
    model_ok = MODEL_PATH.exists()
    return {
        "status": "ok" if rankings_ok else "degraded",
        "rankings_file": rankings_ok,
        "model_file": model_ok,
        "settlement_count": int(len(load_rankings())) if rankings_ok else 0,
    }


@app.get("/settlements")
def list_settlements(
    district: str | None = Query(None, description="Filter by district."),
    vulnerability_class: Literal["High", "Medium", "Low"] | None = Query(
        None, description="Filter by predicted vulnerability class."
    ),
    search: str | None = Query(
        None, description="Case-insensitive search across settlement ID, name, and district."
    ),
    limit: int = Query(50, ge=1, le=192),
    offset: int = Query(0, ge=0),
) -> dict:
    df = load_rankings()

    if district:
        df = df[df["district"].str.casefold() == district.casefold()]
    if vulnerability_class:
        df = df[df["predicted_vulnerability_class"] == vulnerability_class]
    if search:
        needle = search.casefold()
        mask = (
            df["settlement_id"].astype(str).str.casefold().str.contains(needle, regex=False)
            | df["name"].astype(str).str.casefold().str.contains(needle, regex=False)
            | df["district"].astype(str).str.casefold().str.contains(needle, regex=False)
        )
        df = df[mask]

    total = int(len(df))
    page = df.iloc[offset : offset + limit]
    return {"total": total, "limit": limit, "offset": offset, "items": records(page)}


@app.get("/settlements/{settlement_id}")
def get_settlement(settlement_id: str) -> dict:
    df = load_rankings()
    row = df[df["settlement_id"].str.casefold() == settlement_id.casefold()]
    if row.empty:
        raise HTTPException(status_code=404, detail="Settlement not found.")
    return records(row)[0]


@app.get("/rankings/top")
def top_ranked(limit: int = Query(10, ge=1, le=50)) -> list[dict]:
    return records(load_rankings().head(limit))


@app.get("/districts")
def districts() -> list[str]:
    return sorted(load_rankings()["district"].dropna().unique().tolist())


@app.get("/feature-importance")
def feature_importance() -> list[dict]:
    return records(load_feature_importance())


@app.post("/predict", response_model=PredictionResponse)
def predict(payload: FeaturePayload) -> PredictionResponse:
    try:
        bundle = load_model_bundle()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    model = bundle["model"]
    feature_cols = bundle.get("feature_cols", FEATURE_COLS)
    input_df = pd.DataFrame([{col: getattr(payload, col) for col in feature_cols}])

    prediction = str(model.predict(input_df)[0])
    probability_values = model.predict_proba(input_df)[0]
    probabilities = {
        str(label): float(probability)
        for label, probability in zip(model.classes_, probability_values, strict=True)
    }

    return PredictionResponse(
        predicted_vulnerability_class=prediction,
        probabilities=probabilities,
        caveat="Proxy-label MVP prediction only; not field-validated.",
    )
