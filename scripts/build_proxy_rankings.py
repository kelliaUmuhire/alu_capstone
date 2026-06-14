from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "outputs"

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

WEIGHTS = {
    "building_density_risk": 0.25,
    "low_vegetation_risk": 0.20,
    "slope_risk": 0.15,
    "flood_overlap_risk": 0.15,
    "built_up_risk": 0.10,
    "low_road_access_risk": 0.10,
    "low_elevation_risk": 0.05,
}


def minmax(series: pd.Series) -> pd.Series:
    series = series.astype(float)
    denom = series.max() - series.min()
    if pd.isna(denom) or denom == 0:
        return pd.Series(0.0, index=series.index)
    return (series - series.min()) / denom


def main() -> None:
    features = pd.read_csv(DATA_DIR / "real_features.csv")
    coords = pd.read_csv(DATA_DIR / "settlement_coordinates.csv")
    df = coords.merge(features, on="settlement_id", how="inner", validate="one_to_one")

    filled = df[FEATURE_COLS].fillna(df[FEATURE_COLS].median(numeric_only=True))

    components = pd.DataFrame(index=df.index)
    components["building_density_risk"] = minmax(
        filled["building_density_per_ha_real"]
    )
    components["low_vegetation_risk"] = 1 - minmax(filled["ndvi_real"])
    components["slope_risk"] = minmax(filled["slope_degrees_real"])
    components["flood_overlap_risk"] = minmax(filled["flood_zone_overlap_real"])
    components["built_up_risk"] = minmax(filled["ndbi_real"])
    components["low_road_access_risk"] = 1 - minmax(
        filled["road_density_m_per_ha_real"]
    )
    components["low_elevation_risk"] = 1 - minmax(filled["elevation_m_real"])

    df["proxy_vulnerability_score"] = 100 * sum(
        components[col] * weight for col, weight in WEIGHTS.items()
    )
    low_cut, high_cut = df["proxy_vulnerability_score"].quantile([1 / 3, 2 / 3])
    df["proxy_vulnerability_class"] = pd.cut(
        df["proxy_vulnerability_score"],
        bins=[-np.inf, low_cut, high_cut, np.inf],
        labels=["Low", "Medium", "High"],
    )
    df["vulnerability_rank"] = df["proxy_vulnerability_score"].rank(
        method="first", ascending=False
    ).astype(int)

    ordered_cols = [
        "vulnerability_rank",
        "settlement_id",
        "name",
        "district",
        "latitude",
        "longitude",
        "area_hectares",
        "proxy_vulnerability_score",
        "proxy_vulnerability_class",
    ] + FEATURE_COLS

    ranking = df[ordered_cols].sort_values("vulnerability_rank")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "proxy_vulnerability_rankings.csv"
    ranking.to_csv(out_path, index=False)
    print(f"Saved {len(ranking)} rows -> {out_path}")
    print(ranking.head(10).to_string(index=False))


if __name__ == "__main__":
    main()
