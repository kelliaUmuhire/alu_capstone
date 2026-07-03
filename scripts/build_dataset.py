#!/usr/bin/env python3
"""Build lossless sector-linked census and Sentinel-2 datasets for Rwanda.

The script intentionally keeps the original source files unchanged and keeps
audited copies in the raw-data directory. It creates complementary model tables:

* sentinel_with_census.csv: one row per original Sentinel observation.
* sector_summary_dataset.csv: one row per sector, with every numeric Sentinel
  field summarised and all census fields retained.
* sector_subunit_x10_dataset.csv: ten deterministic Sentinel subunit summaries
  per sector by default, retaining the sector census context.

It is designed for the four supplied census workbooks (Gasabo, Kicukiro,
Musanze, Nyarugenge), a GADM level-3 sector GeoJSON, and Kigali/Musanze
Sentinel CSVs.  Source schema is detected at runtime and written to audit
files.  Critical spatial joins are never guessed: unmatched or ambiguous rows
remain in the output and are listed in the audit files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
import geopandas as geopandas
import numpy as numpy
import pandas as pandas

gpd, np, pd = geopandas, numpy, pandas


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = PROJECT_ROOT / "data" / "raw"
DEFAULT_PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
DEFAULT_CENSUS = {
    "gasabo": DEFAULT_RAW_DIR / "gasabo_population.xlsx",
    "kicukiro": DEFAULT_RAW_DIR / "kicukiro_population.xlsx",
    "musanze": DEFAULT_RAW_DIR / "musanze_population.xlsx",
    "nyarugenge": DEFAULT_RAW_DIR / "nyarugenge_population.xlsx",
}
DEFAULT_GEOJSON = DEFAULT_RAW_DIR / "gadm41_RWA_3.json"
DEFAULT_SENTINEL = {
    "musanze": DEFAULT_RAW_DIR / "musanze_features.csv",
    "kigali": DEFAULT_RAW_DIR / "kigali_features.csv",
}
TARGET_DISTRICTS = ("Gasabo", "Kicukiro", "Musanze", "Nyarugenge")


def normalise_text(value: Any) -> str:
    """Normalise labels only for matching; raw source values are retained."""
    if value is None or pd.isna(value):
        return ""
    value = str(value).strip().casefold()
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def safe_name(value: Any) -> str:
    value = normalise_text(value)
    value = re.sub(r"\W+", "_", value, flags=re.UNICODE).strip("_")
    return value or "unnamed"


def unique_names(names: Iterable[Any]) -> list[str]:
    seen: dict[str, int] = {}
    result: list[str] = []
    for position, name in enumerate(names, start=1):
        base = safe_name(name) if str(name).strip() else f"unnamed_{position}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        result.append(base if count == 1 else f"{base}_{count}")
    return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    """Write without index; utf-8-sig opens cleanly in desktop Excel."""
    frame.to_csv(path, index=False, encoding="utf-8-sig")


def first_present(columns: Iterable[str], candidates: Iterable[str]) -> str | None:
    lookup = {normalise_text(column): column for column in columns}
    for candidate in candidates:
        found = lookup.get(normalise_text(candidate))
        if found is not None:
            return found
    return None


def find_geo_column(columns: Iterable[str], kind: str, override: str | None) -> str:
    columns = list(columns)
    if override:
        if override not in columns:
            raise ValueError(f"GeoJSON column {override!r} was not found. Available: {columns}")
        return override
    candidates = {
        "sector_id": ("GID_3", "gid_3", "sector_id", "id_3", "shapeid"),
        "sector_name": ("NAME_3", "name_3", "sector", "sector_name", "name"),
        "district": ("NAME_2", "name_2", "district", "district_name"),
    }[kind]
    result = first_present(columns, candidates)
    if result is None:
        raise ValueError(
            f"Could not detect the GeoJSON {kind} column. Re-run with the relevant "
            f"--geo-{kind.replace('_', '-')} option. Available: {columns}"
        )
    return result


def nonempty(value: Any) -> bool:
    return not (value is None or pd.isna(value) or str(value).strip() == "")


def split_into_blocks(raw: pd.DataFrame) -> list[tuple[int, pd.DataFrame]]:
    """Split a sheet on entirely blank rows, retaining source row offsets."""
    populated = raw.apply(lambda row: any(nonempty(value) for value in row), axis=1)
    blocks: list[tuple[int, pd.DataFrame]] = []
    start: int | None = None
    for index, has_data in populated.items():
        if has_data and start is None:
            start = int(index)
        elif not has_data and start is not None:
            blocks.append((start, raw.loc[start : int(index) - 1].copy()))
            start = None
    if start is not None:
        blocks.append((start, raw.loc[start:].copy()))
    return blocks


def auto_header_row(block: pd.DataFrame) -> int:
    """Choose a header candidate, but log it for review in table_metadata.csv."""
    upper = min(len(block), 12)
    counts = [sum(nonempty(value) for value in block.iloc[row]) for row in range(upper)]
    viable = [row for row, count in enumerate(counts) if count >= 2]
    if not viable:
        return 0
    # A title is often a single merged cell. Prefer the first dense row.
    best_count = max(counts[row] for row in viable)
    return next(row for row in viable if counts[row] == best_count)


def configured_table(config: dict[str, Any], district_key: str, sheet_name: str, block_index: int) -> dict[str, Any]:
    """Return optional manual parsing instructions from a JSON configuration."""
    return (
        config.get("workbooks", {})
        .get(district_key, {})
        .get("sheets", {})
        .get(sheet_name, {})
        .get("blocks", {})
        .get(str(block_index), {})
    )


@dataclass
class CensusExtraction:
    records: pd.DataFrame
    metadata: pd.DataFrame
    fields: pd.DataFrame


def read_census_workbook(
    district_key: str,
    path: Path,
    config: dict[str, Any],
) -> CensusExtraction:
    """Read every worksheet and keep each parsed row, including non-matches."""
    workbook = pd.ExcelFile(path, engine="openpyxl")
    records: list[pd.DataFrame] = []
    metadata: list[dict[str, Any]] = []
    fields: list[dict[str, Any]] = []

    for sheet_name in workbook.sheet_names:
        raw = pd.read_excel(workbook, sheet_name=sheet_name, header=None, dtype=object)
        for block_index, (sheet_start, block) in enumerate(split_into_blocks(raw), start=1):
            instructions = configured_table(config, district_key, sheet_name, block_index)
            header_rows = instructions.get("header_rows")
            if header_rows is None:
                header_rows = [auto_header_row(block)]
                header_method = "auto"
            else:
                header_rows = [int(row) for row in header_rows]
                header_method = "configured"
            if not header_rows or max(header_rows) >= len(block):
                raise ValueError(
                    f"Invalid header_rows for {path.name}, sheet {sheet_name}, block {block_index}."
                )

            header_values: list[str] = []
            for column in range(block.shape[1]):
                pieces = [str(block.iloc[row, column]).strip() for row in header_rows if nonempty(block.iloc[row, column])]
                header_values.append(" | ".join(pieces) if pieces else f"unnamed_column_{column + 1}")
            columns = unique_names(header_values)
            data_start = max(header_rows) + 1
            table = block.iloc[data_start:].copy()
            table.columns = columns
            table = table.loc[table.apply(lambda row: any(nonempty(value) for value in row), axis=1)].copy()
            if table.empty:
                metadata.append(
                    {
                        "district_source": district_key,
                        "source_file": path.name,
                        "source_sheet": sheet_name,
                        "source_block": block_index,
                        "status": "skipped_empty_after_header",
                        "header_method": header_method,
                        "header_rows_zero_based": json.dumps(header_rows),
                        "candidate_sector_column": "",
                        "row_count": 0,
                    }
                )
                continue

            sector_column = instructions.get("sector_column")
            if sector_column is not None and sector_column not in table.columns:
                raise ValueError(
                    f"Configured sector column {sector_column!r} not found in {path.name}, "
                    f"sheet {sheet_name}, block {block_index}. Detected: {list(table.columns)}"
                )
            if sector_column is None:
                sector_column = first_present(
                    table.columns,
                    ("sector", "sector name", "umurenge", "name_3", "name"),
                )
            join_method = "configured" if instructions.get("sector_column") else "header_detected"
            if sector_column is None:
                join_method = "not_detected"

            table.insert(0, "source_row_number", [sheet_start + data_start + index + 1 for index in range(len(table))])
            table.insert(0, "source_block", block_index)
            table.insert(0, "source_sheet", sheet_name)
            table.insert(0, "source_file", path.name)
            table.insert(0, "district_source", district_key)
            table.insert(0, "census_record_id", [f"{district_key}:{sheet_name}:{block_index}:{row}" for row in table["source_row_number"]])
            table["source_sector_value"] = table[sector_column] if sector_column else pd.NA
            table["source_sector_key"] = table["source_sector_value"].map(normalise_text)
            table["sector_column_used"] = sector_column if sector_column else pd.NA
            records.append(table)

            metadata.append(
                {
                    "district_source": district_key,
                    "source_file": path.name,
                    "source_sheet": sheet_name,
                    "source_block": block_index,
                    "status": "parsed",
                    "header_method": header_method,
                    "header_rows_zero_based": json.dumps(header_rows),
                    "candidate_sector_column": sector_column or "",
                    "sector_join_method": join_method,
                    "row_count": len(table),
                    "columns_json": json.dumps(columns),
                }
            )
            for column in columns:
                fields.append(
                    {
                        "district_source": district_key,
                        "source_file": path.name,
                        "source_sheet": sheet_name,
                        "source_block": block_index,
                        "source_column": column,
                        "output_feature_prefix": f"census__{safe_name(district_key)}__{safe_name(sheet_name)}__block_{block_index}__{safe_name(column)}",
                    }
                )

    if not records:
        raise ValueError(f"No populated table blocks found in {path}")
    return CensusExtraction(pd.concat(records, ignore_index=True, sort=False), pd.DataFrame(metadata), pd.DataFrame(fields))


def make_sector_base(geojson_path: Path, args: argparse.Namespace) -> tuple[gpd.GeoDataFrame, dict[str, str]]:
    sectors = gpd.read_file(geojson_path)
    if sectors.empty:
        raise ValueError(f"The GeoJSON contains no features: {geojson_path}")
    if sectors.crs is None:
        raise ValueError("The GeoJSON has no CRS. Reproject or define it before using this pipeline.")
    columns = list(sectors.columns)
    found = {
        "sector_id": find_geo_column(columns, "sector_id", args.geo_sector_id),
        "sector_name": find_geo_column(columns, "sector_name", args.geo_sector_name),
        "district": find_geo_column(columns, "district", args.geo_district),
    }
    result = sectors[[found["sector_id"], found["sector_name"], found["district"], "geometry"]].copy()
    result.columns = ["sector_id", "sector_name", "district", "geometry"]
    result["sector_id"] = result["sector_id"].astype(str)
    result["sector_name"] = result["sector_name"].astype(str)
    result["district"] = result["district"].astype(str)
    result["sector_name_key"] = result["sector_name"].map(normalise_text)
    result["district_key"] = result["district"].map(normalise_text)
    wanted = {normalise_text(name) for name in TARGET_DISTRICTS}
    result = result.loc[result["district_key"].isin(wanted)].copy()
    if result.empty:
        raise ValueError(
            "No Gasabo, Kicukiro, Musanze, or Nyarugenge sectors were found in the GeoJSON. "
            f"Detected district examples: {sectors[found['district']].dropna().astype(str).head(12).tolist()}"
        )
    result["sector_area_km2"] = result.to_crs("EPSG:6933").geometry.area / 1_000_000
    if result["sector_id"].duplicated().any():
        duplicate_ids = result.loc[result["sector_id"].duplicated(keep=False), "sector_id"].tolist()
        raise ValueError(f"Sector IDs are not unique in the selected GeoJSON: {duplicate_ids[:10]}")
    return result, found


def census_wide_by_sector(records: pd.DataFrame, sectors: gpd.GeoDataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Join all recognisable census rows while retaining unmatched rows separately."""
    data_columns = {
        "census_record_id", "district_source", "source_file", "source_sheet", "source_block",
        "source_row_number", "source_sector_value", "source_sector_key", "sector_column_used",
    }
    matched_parts: list[pd.DataFrame] = []
    unmatched_parts: list[pd.DataFrame] = []
    sector_lookup = sectors[["sector_id", "district_key", "sector_name_key"]].copy()

    for (district, sheet, block), group in records.groupby(["district_source", "source_sheet", "source_block"], dropna=False):
        source = group.copy()
        source["district_key"] = source["district_source"].map(normalise_text)
        joined = source.merge(
            sector_lookup,
            how="left",
            left_on=["district_key", "source_sector_key"],
            right_on=["district_key", "sector_name_key"],
            validate="many_to_one",
            indicator=True,
        )
        joined["census_join_status"] = np.where(joined["_merge"].eq("both"), "matched", "unmatched")
        unmatched_parts.append(joined.loc[joined["census_join_status"].ne("matched")].copy())
        matched = joined.loc[joined["census_join_status"].eq("matched")].copy()
        if matched.empty:
            continue
        feature_columns = [column for column in group.columns if column not in data_columns]
        # A source table maps to a single feature namespace, avoiding collisions
        # between similarly named columns in the three population tables.
        prefix = f"census__{safe_name(district)}__{safe_name(sheet)}__block_{block}__"
        renamed = matched[["sector_id", *feature_columns]].rename(columns={column: prefix + safe_name(column) for column in feature_columns})
        if renamed["sector_id"].duplicated().any():
            # Census table should have one row per sector. Keep all source rows in
            # census_records_all.csv and fail here rather than choose one silently.
            duplicates = renamed.loc[renamed["sector_id"].duplicated(keep=False), "sector_id"].unique().tolist()
            raise ValueError(
                f"Census table {district}/{sheet}/block {block} has multiple rows for sector(s) {duplicates[:10]}. "
                "Provide a corrected source table or split the block with --census-config."
            )
        matched_parts.append(renamed)

    wide = sectors.copy()
    for part in matched_parts:
        wide = wide.merge(part, how="left", on="sector_id", validate="one_to_one")
    unmatched = pd.concat(unmatched_parts, ignore_index=True, sort=False) if unmatched_parts else pd.DataFrame()
    return wide, unmatched


def discover_coordinate_columns(frame: pd.DataFrame, args: argparse.Namespace) -> tuple[str | None, str | None, str | None]:
    if args.latitude or args.longitude:
        if not (args.latitude and args.longitude):
            raise ValueError("Provide both --latitude and --longitude, or neither.")
        missing = [column for column in (args.latitude, args.longitude) if column not in frame.columns]
        if missing:
            raise ValueError(f"Coordinate column(s) not present in Sentinel CSV: {missing}")
        return args.latitude, args.longitude, "configured_lat_lon"
    if args.geometry_column:
        if args.geometry_column not in frame.columns:
            raise ValueError(f"Geometry column {args.geometry_column!r} is not present in Sentinel CSV.")
        return None, None, "configured_wkt"

    latitude = first_present(frame.columns, ("latitude", "lat", "y", "y_coord", "y_coordinate", "centroid_lat"))
    longitude = first_present(frame.columns, ("longitude", "lon", "lng", "long", "x", "x_coord", "x_coordinate", "centroid_lon"))
    if latitude and longitude:
        return latitude, longitude, "auto_lat_lon"
    geometry = first_present(frame.columns, ("geometry", "wkt", "geom", "the_geom"))
    if geometry:
        return None, None, "auto_wkt"
    return None, None, None


def read_sentinel(sources: dict[str, Path]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for source_region, path in sources.items():
        frame = pd.read_csv(path, low_memory=False)
        frame.insert(0, "sentinel_source_row_number", np.arange(1, len(frame) + 1))
        frame.insert(0, "sentinel_source_file", path.name)
        frame.insert(0, "sentinel_source_region", source_region)
        frame.insert(0, "sentinel_record_id", [f"{source_region}:{row}" for row in range(1, len(frame) + 1)])
        frames.append(frame)
    return pd.concat(frames, ignore_index=True, sort=False)


def assign_sentinel_sectors(
    sentinel: pd.DataFrame,
    sectors: gpd.GeoDataFrame,
    args: argparse.Namespace,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Spatially match points, retaining all ambiguous/outside rows without assigning them."""
    latitude, longitude, method = discover_coordinate_columns(sentinel, args)
    result = sentinel.copy()
    result["sector_match_status"] = "not_attempted_no_coordinates"
    result["sector_match_method"] = method or "not_available"
    for column in ("sector_id", "sector_name", "district"):
        result[column] = pd.NA
    empty_candidates = pd.DataFrame(columns=["sentinel_record_id", "sector_id", "sector_name", "district", "match_predicate"])
    if method is None:
        return result, empty_candidates, {"coordinate_method": "not_available", "coordinate_columns": ""}

    if method.endswith("wkt"):
        geometry_column = args.geometry_column or first_present(sentinel.columns, ("geometry", "wkt", "geom", "the_geom"))
        geometry = gpd.GeoSeries.from_wkt(sentinel[geometry_column], errors="coerce")
        coordinate_note = geometry_column
    else:
        result["_latitude_numeric"] = pd.to_numeric(result[latitude], errors="coerce")
        result["_longitude_numeric"] = pd.to_numeric(result[longitude], errors="coerce")
        geometry = gpd.points_from_xy(result["_longitude_numeric"], result["_latitude_numeric"], crs=args.sentinel_crs)
        coordinate_note = f"latitude={latitude}; longitude={longitude}"
    points = gpd.GeoDataFrame(result[["sentinel_record_id"]].copy(), geometry=geometry, crs=args.sentinel_crs)
    valid = points.geometry.notna() & ~points.geometry.is_empty
    if points.crs != sectors.crs:
        points = points.to_crs(sectors.crs)

    right = sectors[["sector_id", "sector_name", "district", "geometry"]].copy()
    try:
        within = gpd.sjoin(points.loc[valid], right, how="left", predicate="within")
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise SystemExit(
            "GeoPandas could not build a spatial index. Install rtree or shapely>=2 "
            "in the environment used to run this script."
        ) from exc
    within_matches = within.loc[within["sector_id"].notna()].copy()
    unmatched_ids = set(points.loc[valid, "sentinel_record_id"]) - set(within_matches["sentinel_record_id"])
    boundary = pd.DataFrame()
    if unmatched_ids:
        boundary_points = points.loc[points["sentinel_record_id"].isin(unmatched_ids)]
        boundary = gpd.sjoin(boundary_points, right, how="left", predicate="intersects")
        boundary = boundary.loc[boundary["sector_id"].notna()].copy()

    candidates = pd.concat(
        [
            within_matches.assign(match_predicate="within"),
            boundary.assign(match_predicate="intersects") if not boundary.empty else pd.DataFrame(),
        ],
        ignore_index=True,
        sort=False,
    )
    if not candidates.empty:
        candidates = candidates[["sentinel_record_id", "sector_id", "sector_name", "district", "match_predicate"]]
        candidates = candidates.drop_duplicates()
        counts = candidates.groupby("sentinel_record_id")["sector_id"].nunique()
        unique_ids = counts.loc[counts.eq(1)].index
        one = candidates.loc[candidates["sentinel_record_id"].isin(unique_ids)].drop_duplicates("sentinel_record_id")
        result = result.merge(one, on="sentinel_record_id", how="left", suffixes=("", "_matched"))
        for column in ("sector_id", "sector_name", "district"):
            result[column] = result[f"{column}_matched"].combine_first(result[column])
            result = result.drop(columns=f"{column}_matched")
        result.loc[result["sentinel_record_id"].isin(unique_ids), "sector_match_status"] = "matched"
        ambiguous_ids = counts.loc[counts.gt(1)].index
        result.loc[result["sentinel_record_id"].isin(ambiguous_ids), "sector_match_status"] = "ambiguous_boundary"
    result.loc[valid & result["sector_id"].isna() & result["sector_match_status"].ne("ambiguous_boundary"), "sector_match_status"] = "outside_sector_boundaries"
    result.loc[~valid, "sector_match_status"] = "invalid_coordinates"
    return result, candidates, {"coordinate_method": method, "coordinate_columns": coordinate_note}


def make_sector_summary(sector_census: gpd.GeoDataFrame, sentinel: pd.DataFrame) -> pd.DataFrame:
    """Summarise every numeric source Sentinel column, while retaining census context."""
    numeric_columns = [
        column
        for column in sentinel.columns
        if column not in {"sentinel_source_row_number", "_latitude_numeric", "_longitude_numeric"}
        and pd.api.types.is_numeric_dtype(sentinel[column])
    ]
    matched = sentinel.loc[sentinel["sector_match_status"].eq("matched") & sentinel["sector_id"].notna()].copy()
    summary = sector_census.drop(columns="geometry").copy()
    counts = matched.groupby("sector_id").size().rename("sentinel__matched_row_count").reset_index()
    summary = summary.merge(counts, how="left", on="sector_id")
    summary["sentinel__matched_row_count"] = summary["sentinel__matched_row_count"].fillna(0).astype("int64")
    if numeric_columns and not matched.empty:
        aggregations = {column: ["count", "mean", "median", "min", "max", "std"] for column in numeric_columns}
        aggregated = matched.groupby("sector_id")[numeric_columns].agg(aggregations)
        aggregated.columns = [f"sentinel__{safe_name(column)}__{stat}" for column, stat in aggregated.columns]
        summary = summary.merge(aggregated.reset_index(), how="left", on="sector_id", validate="one_to_one")
    return summary


def assign_sector_subunits(
    sentinel: pd.DataFrame,
    subunit_count: int,
) -> tuple[pd.DataFrame, str]:
    """Assign matched Sentinel rows to deterministic within-sector subunits."""
    if subunit_count < 1:
        raise ValueError("--sentinel-subunits must be at least 1.")
    matched = sentinel.loc[sentinel["sector_match_status"].eq("matched") & sentinel["sector_id"].notna()].copy()
    if matched.empty:
        matched["sector_subunit_index"] = pd.Series(dtype="int64")
        return matched, "no_matched_sentinel_rows"

    coordinate_columns = [
        column
        for column in ("_longitude_numeric", "_latitude_numeric")
        if column in matched.columns and matched[column].notna().any()
    ]
    sort_columns = ["sector_id", *coordinate_columns, "sentinel_record_id"]
    method = "spatial_coordinate_order" if coordinate_columns else "sentinel_record_id_order"
    matched = matched.sort_values(sort_columns, kind="mergesort").copy()
    position = matched.groupby("sector_id").cumcount()
    group_size = matched.groupby("sector_id")["sentinel_record_id"].transform("size")
    matched["sector_subunit_index"] = np.floor(position * subunit_count / group_size).astype("int64") + 1
    matched["sector_subunit_index"] = matched["sector_subunit_index"].clip(lower=1, upper=subunit_count)
    return matched, method


def make_sector_subunit_dataset(
    sector_census: gpd.GeoDataFrame,
    sentinel: pd.DataFrame,
    subunit_count: int,
) -> pd.DataFrame:
    """Create N within-sector Sentinel summaries while retaining all sector context."""
    matched, assignment_method = assign_sector_subunits(sentinel, subunit_count)
    base = sector_census.drop(columns="geometry").copy()
    subunit_index = pd.DataFrame({"sector_subunit_index": np.arange(1, subunit_count + 1, dtype="int64")})
    base = base.merge(subunit_index, how="cross")
    base["sector_subunit_count_requested"] = subunit_count
    base["sector_subunit_id"] = (
        base["sector_id"].astype(str)
        + "__sentinel_subunit_"
        + base["sector_subunit_index"].astype(str).str.zfill(2)
    )
    base["sentinel__subunit_assignment_method"] = assignment_method

    numeric_columns = [
        column
        for column in sentinel.columns
        if column not in {"sentinel_source_row_number", "_latitude_numeric", "_longitude_numeric"}
        and pd.api.types.is_numeric_dtype(sentinel[column])
    ]
    group_columns = ["sector_id", "sector_subunit_index"]
    counts = (
        matched.groupby(group_columns)
        .size()
        .rename("sentinel__subunit_matched_row_count")
        .reset_index()
        if not matched.empty
        else pd.DataFrame(columns=[*group_columns, "sentinel__subunit_matched_row_count"])
    )
    result = base.merge(counts, how="left", on=group_columns, validate="one_to_one")
    result["sentinel__subunit_matched_row_count"] = (
        result["sentinel__subunit_matched_row_count"].fillna(0).astype("int64")
    )
    if numeric_columns and not matched.empty:
        aggregations = {column: ["count", "mean", "median", "min", "max", "std"] for column in numeric_columns}
        aggregated = matched.groupby(group_columns)[numeric_columns].agg(aggregations)
        aggregated.columns = [f"sentinel__{safe_name(column)}__subunit_{stat}" for column, stat in aggregated.columns]
        result = result.merge(aggregated.reset_index(), how="left", on=group_columns, validate="one_to_one")

    ordered_columns = [
        "sector_subunit_id",
        "sector_subunit_index",
        "sector_subunit_count_requested",
        "sentinel__subunit_assignment_method",
        "sentinel__subunit_matched_row_count",
    ]
    remaining_columns = [column for column in result.columns if column not in ordered_columns]
    return result[ordered_columns + remaining_columns]


def write_data_dictionary(output_dir: Path, datasets: dict[str, pd.DataFrame]) -> None:
    rows: list[dict[str, Any]] = []
    for dataset_name, frame in datasets.items():
        for column in frame.columns:
            rows.append(
                {
                    "dataset": dataset_name,
                    "column": column,
                    "dtype": str(frame[column].dtype),
                    "null_count": int(frame[column].isna().sum()),
                    "non_null_count": int(frame[column].notna().sum()),
                }
            )
    write_csv(pd.DataFrame(rows), output_dir / "data_dictionary.csv")


def copy_and_manifest(inputs: dict[str, Path], raw_dir: Path) -> pd.DataFrame:
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    for label, source in inputs.items():
        if not source.exists():
            raise FileNotFoundError(f"Missing input {label}: {source}")
        target = raw_dir / source.name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        manifest.append(
            {
                "input_label": label,
                "source_path": str(source.resolve()),
                "copied_path": str(target.resolve()),
                "size_bytes": source.stat().st_size,
                "sha256": sha256(source),
            }
        )
    return pd.DataFrame(manifest)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--gasabo-census", type=Path, default=DEFAULT_CENSUS["gasabo"])
    parser.add_argument("--kicukiro-census", type=Path, default=DEFAULT_CENSUS["kicukiro"])
    parser.add_argument("--musanze-census", type=Path, default=DEFAULT_CENSUS["musanze"])
    parser.add_argument("--nyarugenge-census", type=Path, default=DEFAULT_CENSUS["nyarugenge"])
    parser.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    parser.add_argument("--musanze-sentinel", type=Path, default=DEFAULT_SENTINEL["musanze"])
    parser.add_argument("--kigali-sentinel", type=Path, default=DEFAULT_SENTINEL["kigali"])
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--overwrite", action="store_true", help="Allow writing into an existing output directory.")
    parser.add_argument("--census-config", type=Path, help="Optional JSON with manual header_rows and sector_column per table block.")
    parser.add_argument("--geo-sector-id", help="Override GeoJSON sector ID field.")
    parser.add_argument("--geo-sector-name", help="Override GeoJSON sector name field.")
    parser.add_argument("--geo-district", help="Override GeoJSON district field.")
    parser.add_argument("--latitude", help="Override Sentinel latitude field; must be paired with --longitude.")
    parser.add_argument("--longitude", help="Override Sentinel longitude field; must be paired with --latitude.")
    parser.add_argument("--geometry-column", help="WKT geometry field in Sentinel CSV; alternative to latitude/longitude.")
    parser.add_argument("--sentinel-crs", default="EPSG:4326", help="CRS of Sentinel coordinates or WKT geometry.")
    parser.add_argument(
        "--sentinel-subunits",
        type=int,
        default=10,
        help="Number of deterministic within-sector Sentinel subunit summaries to create per sector.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    output_dir = args.output_dir.resolve()
    if output_dir.exists() and any(output_dir.iterdir()) and not args.overwrite:
        raise SystemExit(f"Output directory is not empty: {output_dir}. Use --overwrite or choose another directory.")
    output_dir.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.census_config.read_text(encoding="utf-8")) if args.census_config else {}

    census_paths = {
        "gasabo": args.gasabo_census,
        "kicukiro": args.kicukiro_census,
        "musanze": args.musanze_census,
        "nyarugenge": args.nyarugenge_census,
    }
    sentinel_paths = {"musanze": args.musanze_sentinel, "kigali": args.kigali_sentinel}
    all_inputs = {**{f"census_{key}": value for key, value in census_paths.items()}, "sector_geojson": args.geojson, **{f"sentinel_{key}": value for key, value in sentinel_paths.items()}}
    manifest = copy_and_manifest(all_inputs, args.raw_dir.resolve())
    write_csv(manifest, output_dir / "source_manifest.csv")

    logging.info("Reading GeoJSON sector boundaries")
    sectors, geo_columns = make_sector_base(args.geojson, args)
    logging.info("Reading all census worksheets without changing their sources")
    extractions = [read_census_workbook(key, path, config) for key, path in census_paths.items()]
    census_records = pd.concat([item.records for item in extractions], ignore_index=True, sort=False)
    census_metadata = pd.concat([item.metadata for item in extractions], ignore_index=True, sort=False)
    census_fields = pd.concat([item.fields for item in extractions], ignore_index=True, sort=False)
    write_csv(census_records, output_dir / "census_records_all.csv")
    write_csv(census_metadata, output_dir / "census_table_metadata.csv")
    write_csv(census_fields, output_dir / "census_field_map.csv")

    logging.info("Linking census records to sectors")
    sector_census, census_unmatched = census_wide_by_sector(census_records, sectors)
    write_csv(census_unmatched, output_dir / "census_unmatched_records.csv")
    sector_census.to_file(output_dir / "sector_census.geojson", driver="GeoJSON")
    write_csv(sector_census.drop(columns="geometry"), output_dir / "sector_census.csv")

    logging.info("Reading all Sentinel rows and assigning sectors when coordinates are present")
    sentinel_raw = read_sentinel(sentinel_paths)
    write_csv(sentinel_raw, output_dir / "sentinel_all_rows.csv")
    sentinel_matched, candidate_matches, coordinate_audit = assign_sentinel_sectors(sentinel_raw, sectors, args)
    write_csv(sentinel_matched, output_dir / "sentinel_with_sector.csv")
    write_csv(candidate_matches, output_dir / "sentinel_sector_candidate_matches.csv")

    observation = sentinel_matched.merge(
        sector_census.drop(columns=["geometry", "sector_name", "district"], errors="ignore"),
        how="left",
        on="sector_id",
        validate="many_to_one",
        suffixes=("", "_census"),
    )
    write_csv(observation, output_dir / "sentinel_with_census.csv")
    sector_summary = make_sector_summary(sector_census, sentinel_matched)
    write_csv(sector_summary, output_dir / "sector_summary_dataset.csv")
    sector_subunit = make_sector_subunit_dataset(sector_census, sentinel_matched, args.sentinel_subunits)
    sector_subunit_filename = f"sector_subunit_x{args.sentinel_subunits}_dataset.csv"
    write_csv(sector_subunit, output_dir / sector_subunit_filename)

    audit = pd.DataFrame(
        [
            {"audit": "geojson_columns", "value": json.dumps(geo_columns)},
            {"audit": "sentinel_coordinate_detection", "value": json.dumps(coordinate_audit)},
            {"audit": "geojson_sector_count", "value": len(sectors)},
            {"audit": "census_record_count", "value": len(census_records)},
            {"audit": "census_unmatched_record_count", "value": len(census_unmatched)},
            {"audit": "sentinel_row_count", "value": len(sentinel_raw)},
            {"audit": "sentinel_matched_row_count", "value": int(sentinel_matched["sector_match_status"].eq("matched").sum())},
            {"audit": "sentinel_ambiguous_boundary_row_count", "value": int(sentinel_matched["sector_match_status"].eq("ambiguous_boundary").sum())},
            {"audit": "sentinel_unmatched_row_count", "value": int(sentinel_matched["sector_match_status"].ne("matched").sum())},
            {"audit": "sentinel_subunit_count_per_sector", "value": args.sentinel_subunits},
            {"audit": "sector_subunit_dataset_row_count", "value": len(sector_subunit)},
            {"audit": "sector_subunit_dataset_file", "value": sector_subunit_filename},
        ]
    )
    write_csv(audit, output_dir / "join_audit.csv")
    write_data_dictionary(
        output_dir,
        {
            "census_records_all": census_records,
            "sector_census": sector_census.drop(columns="geometry"),
            "sentinel_all_rows": sentinel_raw,
            "sentinel_with_sector": sentinel_matched,
            "sentinel_with_census": observation,
            "sector_summary_dataset": sector_summary,
            sector_subunit_filename.removesuffix(".csv"): sector_subunit,
        },
    )
    logging.info("Finished. Outputs written to %s", output_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, KeyError, json.JSONDecodeError) as exc:
        logging.error("%s", exc)
        raise SystemExit(2) from exc
