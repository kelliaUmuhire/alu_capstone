# Dashboard Mockup

This is a rough React dashboard for the Kigali settlement vulnerability MVP.

It loads:

- `public/settlement_vulnerability_rankings.json`
- `public/feature_importance.json`

## Run as a static mockup

From this folder:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173
```

The static mockup imports React from a CDN so it can run without a build step.

## Run as a normal React app later

Once Node/npm are available:

```bash
npm install
npm run dev
```

The interface is intentionally simple: summary metrics, a lightweight settlement map, filters, ranked settlements, model driver importances, and a selected-settlement detail panel.
