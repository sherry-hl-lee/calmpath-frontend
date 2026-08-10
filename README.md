# CalmPath Frontend

Sensory-aware walking routes for Melbourne CBD.

## Run locally

Open `index.html` in a browser, or from this folder:

```bash
npx serve .
```

## Features

- **Route Planner (US1.1–1.3):** `POST /api/v1/routes/compare` (Shortest + Recommended) with OSRM demo fallback until backend POST is live; crowd threshold with alternatives
- **Quiet Refuges (US2.1):** Location + radius; deployed FastAPI/RDS refuge search and on-selection address lookup via CloudFront HTTPS
- **Predictive Alerts (US2.2):** historical-trend alerts with actions to quieter routes or refuges

Route crowd/sensory values and predictive alerts remain demo data in `js/data.js`.
