# CalmPath Frontend

Sensory-aware walking routes for Melbourne CBD.

## Run locally

Open `index.html` in a browser, or from this folder:

```bash
npx serve .
```

## Features

- **Route Planner (US1.1):** `GET /api/v1/routes` — walking alternatives with sensory indicators and nearby tram/train stops; OSRM demo fallback if offline
- **Route compare (US1.2):** `POST /api/v1/routes/compare` — used when a distinct lower-crowd recommendation is available; Peak Crowd zones remain demo overlays; crowd threshold with alternatives
- **Quiet Refuges (US2.1):** Location + radius; deployed FastAPI/RDS refuge search and on-selection address lookup via CloudFront HTTPS
- **Predictive Alerts (US2.2):** historical-trend alerts with actions to quieter routes or refuges (demo data until alerts API is live)

Predictive alerts remain demo data in `js/data.js`. Peak Crowd map circles are demo overlays until a crowd-zone API is provided.
