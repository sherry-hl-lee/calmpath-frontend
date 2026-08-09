# CalmPath Frontend

Sensory-aware walking routes for Melbourne CBD.

## Run locally

Open `index.html` in a browser, or from this folder:

```bash
npx serve .
```

## Features

- **Route Planner (US1.1–1.3):** CBD destination → route options with Low / High / Limited Data, busy corridor highlights, public transport stops, crowd threshold with alternatives
- **Quiet Refuges (US2.1):** Location + radius; deployed FastAPI/RDS refuge search and on-selection address lookup via CloudFront HTTPS
- **Predictive Alerts (US2.2):** historical-trend alerts with actions to quieter routes or refuges

Route crowd/sensory values and predictive alerts remain demo data in `js/data.js`.
