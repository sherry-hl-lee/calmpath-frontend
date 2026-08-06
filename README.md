# CalmPath Frontend

Sensory-aware walking routes for Melbourne CBD.

## Run locally

Open `index.html` in a browser, or from this folder:

```bash
npx serve .
```

## Features

- **Route Planner (US1.1–1.3):** CBD destination → route options with Low / High / Limited Data, busy corridor highlights, public transport stops, crowd threshold with alternatives
- **Quiet Refuges (US2.1):** adjustable Location (default Your location) + radius; address loaded on select (mock API shape)
- **Predictive Alerts (US2.2):** historical-trend alerts with actions to quieter routes or refuges

Demo data is mocked in `js/data.js` in the style of City of Melbourne open data.
