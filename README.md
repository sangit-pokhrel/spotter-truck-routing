# Weather-Aware Truck Routing

A React + Django app that helps a truck driver pick the safest route between two places. It
checks the forecast at each point on the way for the hour the truck will actually be there,
applies the load-weight rules, and weighs that against travel time.

- Live app: [spotter-truck-routing-15e6.onrender.com](https://spotter-truck-routing-15e6.onrender.com)
- Walkthrough video: _add Loom link_

| Desktop | Phone |
|---|---|
| ![Desktop view](.github/screenshot-desktop.png) | <img src=".github/screenshot-phone.png" alt="Phone view" width="260"> |

<sub>Screenshots use a simulated storm so every risk level shows up. In calm weather all routes are Low.</sub>

## What it does

You enter an origin, a destination, a departure time, the load weight, and how often to check the
weather (every 10, 25 or 50 miles). The app then:

1. finds three route options;
2. places a checkpoint every N miles on each and works out the truck's ETA there;
3. gets the forecast for that hour at each checkpoint and classifies wind, rain and snow;
4. applies the load rules and ranks the routes: fewest Severe miles, then fewest High miles,
   then lowest average risk, then shortest time;
5. shows the routes, checkpoints, risk, ETAs and a summary of each route on the map, plus a
   weather heatmap over the corridor with a 0-48 hour slider.

### Risk rules

Each checkpoint takes the worst of its three conditions:

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | < 25 mph | 25-34 | 35-44 | 45-54 | >= 55 mph |
| Rain | < 0.10 in/hr | 0.10-0.25 | 0.25-0.50 | 0.50-1.00 | > 1.00 |
| Snow | < 0.5 in/hr | 0.5-1.0 | 1.0-2.0 | 2.0-3.0 | > 3.0 |

The load rules then raise it (the mph is wind speed, since heavy trailers are what crosswinds
push around):

- wind >= 55 mph: No Travel for any load
- wind 45-54 mph and load over 30,000 lb: No Travel
- wind 35-44 mph and load over 40,000 lb: Severe

Load weight therefore changes the result: the same 40 mph wind is High for a 35,000 lb load and
Severe for a 45,000 lb one, which changes the Severe/High miles and can change the recommended
route. Every checkpoint explains itself, for example
_"45,000 lb load in 40 mph wind (> 40,000 lb at 35-44 mph) -> Severe"_.

## Beyond the brief

Everything in the brief is implemented (see [requirements](#requirements)). The rest was added
with the actual user in mind: a driver on a phone, often with patchy signal, whose weather keeps
changing.

Safety and timing:

- ETAs use real posted speed limits (OpenStreetMap via Valhalla) and the truck's governed speed,
  instead of one average speed. On Denver to Chicago this moved the arrival by about two hours,
  which changes which forecast hour each checkpoint gets.
- State truck speed limits (California and Oregon 55 mph, Washington 60, and others), placed by
  which state each road segment is in.
- No Travel miles are ranked ahead of Severe miles, so an undrivable route can't win.
- Alternative routes are filtered for near-duplicates, big detours, and routes that drive out to
  their via-point and back.

For drivers:

- Live updates: every 15 minutes the app re-plans from the phone's GPS position with fresh
  forecasts and says whether conditions ahead got worse or better.
- Phone alerts when the weather ahead gets worse.
- A pop-out mini map (picture-in-picture) that floats over Google Maps or any other app and shows
  the next hazard ahead.
- Installable as an app, and works offline: the last trip and the map tiles you've seen stay
  available with no signal.
- Mobile-first layout: the recommendation comes first, the trip form collapses to one line, and
  there are one-tap departure times, "use my location" and remembered load settings.

Map and UI:

- A strip showing the selected route's risk by mile, synced with the map as you drag along it.
- A side-by-side comparison table in ranking order, highlighting the best value per row.
- Light, dark and satellite base maps; compact A/B/C route badges that open a summary on tap.

Engineering:

- Server-side logic with a browser fallback for weather when the free API throttles the server.
- Docker image, a VPS stack, and a CI/CD pipeline that smoke-tests the image, deploys over SSH
  and rolls back automatically if the new release is unhealthy.
- 107 backend and 17 frontend tests; ruff and Prettier enforced in CI.

## How it works

### Routes

OSRM rarely returns more than two alternatives, so the backend also routes through via-points
pushed sideways from the straight line between origin and destination. A candidate is kept only
if less than 80% of it overlaps a route already chosen, it's no more than 1.6x slower than the
fastest, and the stretch around its via-point is close to the direct road between its ends.
That last check catches routes that snap to a side road and drive out and back.

### Checkpoints and ETAs

Checkpoints sit at mile 0, N, 2N and so on, plus the destination. Each one stands for the road
halfway to its neighbours, so the miles per risk level add up to the route length.

ETAs come from per-segment travel times along the road geometry. Each segment is timed as a
truck would drive it:

- highways: the lower of the posted limit and the governed speed (65 mph by default, since most
  fleet trucks are speed-limited);
- other roads: OSRM's estimate, which includes turns and lights, but never above the posted limit;
- in states with a truck speed law, never above that limit either.

Posted limits come from Valhalla's `trace_attributes`. The public instance allows about one
request per second and 200 km per request, so plans never wait for it. Limits already known are
used immediately, missing ones are fetched in a background thread, and the plan reports
`speed_limits: "pending"` so the app quietly re-plans a few seconds later. Limits are cached per
map cell and direction rather than per route, so any later route on the same road reuses them.

### Weather

Forecasts come from Open-Meteo's hourly API: wind at 10 m, rain plus showers, and snowfall, each
checkpoint taking the hour nearest its ETA. Points are snapped to a 0.05 degree grid so nearby
checkpoints share a lookup; up to 100 locations go in one request and results are cached.

The free tier limits requests per IP, and free cloud hosts share their IPs, so the server can run
out. When it does, the API responds with the exact query it needs; the browser runs it with its
own quota and posts the raw data back. Parsing, risk and ranking still happen on the server, and
a ten-minute circuit breaker stops the server retrying in the meantime.

### Recommendation

Routes are sorted by (No Travel miles, Severe miles, High miles, average risk, travel time),
rounded so floating-point noise can't decide a tie. Average risk scores Low to No Travel as 0 to
4, weighted by miles. The app names the criterion that decided it, for example
_"Route B has the fewest Severe miles (0 mi vs 150 mi on Route A)"_.

### Heatmap

The backend lays a grid of up to 300 points over an 80-mile-wide corridor around all three
routes and returns all 49 hourly frames for risk, wind, rain and snow in one response. Rows are
evenly spaced in Web Mercator, so the browser draws one pixel per cell onto a small canvas,
smooths it, and places it as a single image overlay with no reprojection error. Frames are
rendered once and cached, so moving the slider just swaps an image.

### Live updates, alerts and offline

With live updates on, the app re-plans from the GPS position every 15 minutes (and when it comes
back to the foreground), compares the new recommendation with the old one, and shows a banner;
with alerts on, a worse result also triggers a notification through the service worker.

The service worker caches the app shell, hashed assets and map tiles. The latest trip, including
its heatmap, is saved on the device, so with no signal the app still opens with that trip and an
offline banner.

## Running locally

Requirements: Python 3.11+ and Node 20+. No API keys or database setup.

```bash
# backend, http://127.0.0.1:8000
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python manage.py runserver

# frontend, http://localhost:5173 (proxies /api to the backend)
cd frontend
npm install
npm run dev
```

To run the production image instead: `docker compose up --build`, then open <http://localhost:8000>.

## Tests and code quality

```bash
cd backend  && pytest && ruff check . && ruff format --check .
cd frontend && npm test && npm run typecheck && npm run format:check
```

The backend tests cover every band boundary and load threshold (including 30,000 vs 30,001 lb),
the ranking and its tie-breaks, checkpoint placement and ETAs, speed-limit timing and caching,
state truck limits, the weather fallback, and the API. Frontend tests cover the heatmap
rasteriser, truck position, live-change detection and the saved trip.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health/` | `{"status": "ok", "version": ...}` |
| GET | `/api/geocode/?q=Denver` | place suggestions |
| POST | `/api/plan/` | routes, checkpoints, summaries and the recommendation |
| POST | `/api/heatmap/` | corridor grid with hourly frames |

```json
{
  "origin": "Denver, CO",
  "destination": { "label": "Chicago, IL", "lat": 41.8756, "lon": -87.6244 },
  "departure_time": "2026-10-24T08:00:00-06:00",
  "load_weight_lb": 42000,
  "interval_miles": 25
}
```

Places can be text or `{label, lat, lon}`. The departure needs a timezone offset and must be within
7 days; `interval_miles` is 10, 25 or 50. Either POST endpoint may answer with a `weather_request`
(see Weather above). Invalid input returns 400 with field errors; an upstream failure returns 502.

## Deployment

The app ships as one Docker image: Django serves the API and the built React app, runs as a
non-root user, and has a health check that reports the release version.

### Own VPS (recommended)

A VPS has its own IP, so the weather API's free quota isn't shared, and you can self-host
Valhalla to remove the speed-limit rate limit entirely. The app runs on port 8563 and leaves 80
and 443 to the server's other services.

One-time setup on the server:

```bash
curl -fsSL https://get.docker.com | sh                     # Docker + Compose
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/truck-routing && sudo chown deploy: /opt/truck-routing
# add the deploy key's public half to /home/deploy/.ssh/authorized_keys
# copy deploy/.env.example to /opt/truck-routing/.env and set DOMAIN and DJANGO_SECRET_KEY
```

HTTPS is needed on phones for GPS, notifications, offline mode and installing. Since 80/443
belong to other services, point the existing nginx at the app with
[`deploy/nginx-site.conf`](deploy/nginx-site.conf) (the commands, including certbot, are at the
top of the file), then set `APP_BIND=127.0.0.1` and `TRUSTED_PROXIES=1` in `.env`. For a quick
test without a domain, open `http://SERVER_IP:8563` (and `ufw allow 8563/tcp`). On a server where
80/443 are free, `COMPOSE_PROFILES=https` starts a bundled Caddy with automatic certificates.

To self-host Valhalla, add `valhalla` to `COMPOSE_PROFILES` and set `VALHALLA_URL`,
`SPEED_LIMITS_PARALLEL` and `VALHALLA_PBF_URLS` (see `.env.example`). It builds its graph from
the OpenStreetMap extracts on first start: minutes for a state, hours for the whole US, and
roughly 2 GB of RAM per state.

GitHub settings (Settings > Secrets and variables > Actions):

| Kind | Name | Value |
|---|---|---|
| Secret | `VPS_HOST` | server address |
| Secret | `VPS_USER` | `deploy` |
| Secret | `VPS_SSH_KEY` | private half of the deploy key |
| Secret | `VPS_PORT` | only if SSH isn't on 22 |
| Variable | `DEPLOY_ENABLED` | `true` |
| Variable | `DEPLOY_PATH` | `/opt/truck-routing` |
| Variable | `PUBLIC_URL` | e.g. `https://truck.example.com` or `http://SERVER_IP:8563` |

### CI/CD

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every push and pull request.
Backend (ruff, Django's deploy checks, pytest) and frontend (Prettier, typecheck, tests, build)
run in parallel. The Docker image is then built and the exact image that will ship is started and
smoke-tested (health, version, app shell, service worker, manifest, input validation).

On `main` the image is pushed to GitHub Container Registry as `sha-<commit>` and `latest`, the
stack files are copied to the server, and [`deploy/deploy.sh`](deploy/deploy.sh) starts the new
release, waits for its health check, and rolls back to the previous tag if it never becomes
healthy. The job finishes by checking that `PUBLIC_URL/api/health/` reports the new version.
Dependabot opens weekly update PRs that go through the same pipeline.

Tested locally: the stack on port 8563, the nginx config (including a 2.5 MB request that nginx's
default limit would reject), the Caddy profile, and a deliberately broken release, which was
rolled back automatically.

Deploying by hand: `cd /opt/truck-routing && ./deploy.sh latest`.

### Render

New > Blueprint, then pick the repo; [`render.yaml`](render.yaml) sets everything up, including
`WEATHER_SOURCE=client` because Render's shared IPs get throttled by the weather API.

## Configuration

All settings are environment variables with working defaults; see
[`.env.example`](.env.example) and [`deploy/.env.example`](deploy/.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_DEBUG` / `DJANGO_SECRET_KEY` | `true` / dev key | set `false` and a real key in production |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,.onrender.com` | hostnames served |
| `REDIS_URL` | none | shared cache; otherwise a file cache |
| `WEATHER_SOURCE` | `auto` | `auto`, `server` or `client` |
| `TRUCK_MAX_SPEED_MPH` | `65` | governed truck speed |
| `SPEED_LIMITS_ENABLED` / `SPEED_LIMITS_PARALLEL` | `true` / `2` | posted limits; raise parallelism for a self-hosted Valhalla |
| `VALHALLA_URL`, `OSRM_URL`, `PHOTON_URL` | public instances | point at self-hosted services |
| `OPEN_METEO_API_KEY` | none | commercial weather tier |
| `TRUSTED_PROXIES` | none | proxies in front, so rate limits see real client IPs |
| `API_RATE_LIMIT` | `120/min` | per-client limit |
| `APP_PORT` / `APP_BIND` | `8563` / `0.0.0.0` | VPS stack only |

## Project layout

```
backend/
  config/settings.py          settings from environment variables
  trips/views.py, serializers.py
  trips/services/
    risk.py                   risk bands and load rules
    recommendation.py         ranking and explanation
    planner.py                routes, checkpoints, ETAs, weather, risk
    routing.py                OSRM client and alternative routes
    speed_limits.py           posted limits, truck timing, spatial cache
    truck_rules.py            state truck speed limits
    weather.py                Open-Meteo client and browser fallback
    heatmap.py                corridor grid
    geo.py, geocoding.py, http.py
  trips/tests/
frontend/src/
  App.tsx                     layout
  hooks/useTripSession.ts     planning, live updates, alerts, offline copy
  components/                 map, comparison table, route strip, forms
  lib/                        heatmap rasteriser, geometry, pop-out map, PWA helpers
frontend/public/sw.js         service worker
deploy/                       VPS stack: compose.yaml, nginx-site.conf, deploy.sh
.github/workflows/ci-cd.yml   CI/CD
```

## Limitations

- Route geometry comes from OSRM's car profile. Truck ETAs use posted limits and the governed
  speed, but bridge heights and weight-restricted roads aren't modelled.
- The state truck-limit table covers CA, OR, WA, MI and IN and should be checked against current
  law; Oregon's 60-65 mph truck sections aren't modelled.
- Sustained wind drives the classification, as in the brief; gusts are shown for context.
- No hours-of-service breaks are added, so very long trips have optimistic ETAs (live updates
  correct them as the trip goes).
- Alerts work while the app is open or recently used. Alerts with the app fully closed would need
  a server that re-checks saved trips on a schedule and sends push notifications.
- The public routing, speed-limit and weather services are fair-use; heavy use should move to
  self-hosted instances or paid keys.

## Requirements

| Brief | Where |
|---|---|
| React + Django | `frontend/`, `backend/` |
| Origin, destination, departure, load weight | trip form |
| 3 route options from a routing API | `routing.py` |
| Weather every 10/25/50 miles at the truck's ETA | `planner.py`, `weather.py` |
| Risk from the table and load rules | `risk.py` |
| Recommendation: Severe, High, average risk, time | `recommendation.py` |
| Routes, checkpoints, risk, ETAs and route summaries on the map | `MapView.tsx` |
| Corridor heatmap with a 0-48 h slider | `heatmap.py`, `heatmapImage.ts`, `ForecastBar.tsx` |
