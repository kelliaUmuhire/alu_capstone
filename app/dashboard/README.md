
# Vulnerable Assessment Dashboard

Sector-level dashboard for the Rwanda vulnerability assessment solution.

## Running the code

From `app/dashboard`:

```bash
pnpm install
pnpm run dev
```

The FastAPI service must also be running on port `8000`; see `app/api/README.md`.

## API configuration

Copy `.env.example` to `.env` for local development, or define this environment
variable in the frontend hosting service:

```text
VITE_API_BASE_URL=https://your-api-service.onrender.com
```

Do not include a trailing slash. Vite embeds this value during the frontend
build, so redeploy the dashboard after changing it.
  
