# FastAPI Service

Sector-level API for the Rwanda vulnerability dashboard.

The service reads the current model outputs from:

- `data/model_outputs/sector_model_assessments.csv`
- `data/model_outputs/model_performance.csv`
- `data/model_outputs/feature_importance.csv`
- `data/model_outputs/training_dataset.csv`
- `data/model_outputs/hybrid_weight_sensitivity.csv`
- `models/sector_proxy_random_forest.joblib`
- `models/sector_proxy_catboost.joblib`

The API serves a final hybrid priority built from 60% Random Forest out-of-fold
score and 40% census indicator score. Both components remain visible for audit.
This is not an official Ubudehe or household-level assessment.

## Run

From the repository root:

```bash
pip install -r app/api/requirements.txt
uvicorn app.api.app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger UI:

```text
http://127.0.0.1:8000/docs
```

## Frontend Entry Points

- `GET /dashboard` - compact payload for the dashboard landing state.
- `GET /sectors` - paginated final hybrid sector rankings with filters.
- `GET /sectors/{sector_id}` - one sector with model assessment and census proxy inputs.
- `GET /map/sectors.geojson` - GADM level-3 assessed sector geometries with assessment properties.
- `GET /summary` - hybrid-class KPI totals and caveats.
- `GET /model/performance?include_folds=true` - overall and district-held-out metrics.
- `GET /feature-importance?model=random_forest` - feature importance.
- `GET /training/subunits?sector_id=...` - x10 Sentinel subunit rows for audit/debug.
- `POST /predict/sector?model=random_forest` - model-backed proxy-class prediction.

All main endpoints are also available under `/api/...` for frontend proxy setups.

## Example Prediction Payload

```json
{
  "sentinel__elevation__subunit_mean": 1800,
  "sentinel__elevation__subunit_std": 50,
  "sentinel__ndvi__subunit_mean": 0.45,
  "sentinel__ndvi__subunit_std": 0.1,
  "sentinel__ndbi__subunit_mean": -0.05,
  "sentinel__ndbi__subunit_std": 0.05,
  "sentinel__mndwi__subunit_mean": -0.4,
  "sentinel__mndwi__subunit_std": 0.1
}
```

Missing feature values are accepted as `null` and are handled by the trained model pipeline.
