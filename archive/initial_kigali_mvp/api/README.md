# FastAPI Service

Simple API for the Kigali settlement vulnerability MVP.

## Run

From the project root:

```bash
pip install -r api/requirements.txt
uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger UI:

```text
http://127.0.0.1:8000/docs
```

## Endpoints

- `GET /health`
- `GET /settlements`
- `GET /settlements/{settlement_id}`
- `GET /rankings/top`
- `GET /districts`
- `GET /feature-importance`
- `POST /predict`

The `/predict` endpoint uses `models/vulnerability_random_forest.joblib` when available.

Important: this MVP uses proxy vulnerability labels, not field-validated ground truth.
