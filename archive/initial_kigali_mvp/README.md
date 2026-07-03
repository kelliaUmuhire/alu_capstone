# Kigali Vulnerability MVP

This folder contains the MVP workspace for an AI-powered decision support tool that ranks vulnerable informal settlements using Sentinel-2/SRTM-derived features and OSM-derived physical indicators.

## Github link: https://github.com/kelliaUmuhire/alu_capstone

## Video link: https://drive.google.com/file/d/1qqzZHcINouBCACHKr0v4XObvt1NCkt_m/view?usp=sharing

## Folder structure

- `data/real_features.csv` - extracted raster and OSM model features
- `data/settlement_coordinates.csv` - settlement metadata and coordinates
- `notebooks/vulnerability_random_forest_proxy.ipynb` - Random Forest MVP notebook
- `outputs/proxy_vulnerability_rankings.csv` - current proxy-ranked settlements
- `models/` - notebook will save the trained model here
- `dashboard/` - placeholder for the React dashboard mockup
- `api/` - placeholder for the FastAPI service
- `scripts/build_proxy_rankings.py` - small helper that creates the proxy ranking CSV without training the model
- `requirements.txt` - Python modeling requirements for the notebook

## Run the notebook

From this folder:

```bash
pip install -r requirements.txt
jupyter notebook notebooks/vulnerability_random_forest_proxy.ipynb
```

Then run all cells. The notebook will save:

- `outputs/settlement_vulnerability_rankings.csv`
- `outputs/feature_importance.csv`
- `models/vulnerability_random_forest.joblib`

## Rebuild the proxy ranking CSV

```bash
python scripts/build_proxy_rankings.py
```


## Dashboard

The rough React dashboard is in `dashboard/`. It includes a lightweight settlement map, reads JSON exports from `dashboard/public/`, and can be run with a static server:

```bash
cd dashboard
python3 -m http.server 5173
```

Then open `http://127.0.0.1:5173`.

## API

The FastAPI service is in `api/`. It exposes rankings, settlement details, feature importance, and a model-backed prediction endpoint.

From this folder:

```bash
pip install -r api/requirements.txt
uvicorn api.app.main:app --host 127.0.0.1 --port 8000
```

Then open:

- API root: `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/health`
