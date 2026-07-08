# Rwanda Sector Vulnerability Assessment

This repository builds and serves a sector-level vulnerability assessment for
Gasabo, Kicukiro, Musanze, and Nyarugenge. It combines Sentinel-2-derived
features, census tables, and GADM level-3 administrative boundaries.

The models learn a transparent census-informed proxy label. The final sector
priority is an ML-assisted hybrid index: 60% Random Forest out-of-fold score
plus 40% census indicator score. The weights are explicit decision assumptions,
not learned parameters. Results are not official Ubudehe categories, household
poverty classifications, or field-validated vulnerability measures.

## Repository structure

- `app/api/` - FastAPI service for assessments, metrics, map geometry, and predictions.
- `app/dashboard/` - React/Vite sector vulnerability dashboard.
- `scripts/` - dataset, proxy-label, and model-training pipelines.
- `notebooks/` - executable model-training and analysis notebook.
- `data/raw/` - unchanged supplied census, Sentinel-2, and boundary files.
- `data/processed/` - joined, audited, and sector/subunit-level datasets.
- `data/labels/` - rule-based vulnerability proxy labels and methodology audits.
- `data/model_outputs/` - model assessments, performance tables, plots, and reports.
- `models/` - trained Random Forest and CatBoost model artifacts.
- `archive/initial_kigali_mvp/` - preserved initial informal-settlement MVP.

## Python setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r app/api/requirements.txt
```

## Rebuild the data

Run these commands from the repository root:

```bash
python scripts/build_dataset.py --overwrite
python scripts/build_sector_vulnerability_proxy.py --overwrite
```

The dataset builder reads from `data/raw/` and writes derived tables to
`data/processed/`. The proxy builder writes labels and audits to `data/labels/`.

## Train the models

Batch workflow:

```bash
python scripts/train_sector_proxy_models.py --overwrite
```

Notebook workflow:

```bash
jupyter notebook notebooks/sector_proxy_model_training.ipynb
```

Both workflows use the x10 sector-subunit feature table, while evaluation and
reporting preserve the 50 independent sector assessment units. They also write
`hybrid_weight_sensitivity.csv`, which compares the final ranks under 50/50,
60/40, and 70/30 model/indicator weighting.

## Run the API

```bash
uvicorn app.api.app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger documentation is available at `http://127.0.0.1:8000/docs`.

## Run the dashboard

In another terminal:

```bash
cd app/dashboard
pnpm install
pnpm run dev
```

The dashboard is then available at `http://127.0.0.1:5173/` and expects the API
on port `8000`.

## Archived MVP

The initial Kigali informal-settlement MVP is preserved under
`archive/initial_kigali_mvp/`. It is kept for project history and comparison;
the root-level sector workflow is the current solution.
