"""Hourly forecasts from Open-Meteo (no API key needed).

* Locations are snapped to a 0.05° grid (~5 km, about the resolution of the forecast models)
  so nearby checkpoints across routes share one lookup and one cache entry.
* Many locations are fetched per HTTP call, and batches run in parallel.
* Precipitation values are the total for the preceding hour, i.e. already a per-hour rate.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from django.conf import settings
from django.core.cache import cache

from .geo import LatLon
from .http import ProviderError, RateLimited, get_json
from .risk import WeatherSample

logger = logging.getLogger(__name__)

GRID_DEG = 0.05
BATCH_SIZE = 100
MAX_PARALLEL_BATCHES = 4
FORECAST_HORIZON_DAYS = 15
HOURLY_VARS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
_TO_INCH = {"inch": 1.0, "mm": 1 / 25.4, "cm": 1 / 2.54}
_TO_MPH = {"mp/h": 1.0, "mph": 1.0, "km/h": 0.621371, "m/s": 2.23694, "kn": 1.15078}


def snap(point: LatLon) -> LatLon:
    return (round(round(point[0] / GRID_DEG) * GRID_DEG, 4), round(round(point[1] / GRID_DEG) * GRID_DEG, 4))


def floor_hour(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


@dataclass
class Forecast:
    start: datetime  # UTC, on the hour
    wind: list[float | None]
    gust: list[float | None]
    rain: list[float | None]
    snow: list[float | None]

    def at(self, when: datetime) -> WeatherSample | None:
        """Sample at the forecast hour nearest to `when`; None if outside the forecast."""
        idx = round((when - self.start).total_seconds() / 3600)
        if not 0 <= idx < len(self.wind):
            return None
        wind, rain, snow = self.wind[idx], self.rain[idx], self.snow[idx]
        if wind is None or rain is None or snow is None:
            return None
        return WeatherSample(wind_mph=wind, gust_mph=self.gust[idx], rain_in_hr=rain, snow_in_hr=snow)


def _scaled(values: list, factor: float) -> list[float | None]:
    return [None if v is None else v * factor for v in values]


def _sum(a: list, b: list) -> list[float | None]:
    return [None if x is None and y is None else (x or 0.0) + (y or 0.0) for x, y in zip(a, b)]


def _parse(item: dict, start: datetime) -> Forecast:
    hourly, units = item["hourly"], item.get("hourly_units", {})
    wind_k = _TO_MPH.get(units.get("wind_speed_10m", "mp/h"), 1.0)
    rain_k = _TO_INCH.get(units.get("rain", "inch"), 1.0)
    snow_k = _TO_INCH.get(units.get("snowfall", "inch"), 1.0)
    # Open-Meteo splits liquid precipitation into stratiform "rain" and convective "showers".
    rain = _sum(hourly.get("rain", []), hourly.get("showers", []))
    return Forecast(
        start=start,
        wind=_scaled(hourly["wind_speed_10m"], wind_k),
        gust=_scaled(hourly.get("wind_gusts_10m", []), wind_k),
        rain=_scaled(rain, rain_k),
        snow=_scaled(hourly.get("snowfall", []), snow_k),
    )


def _window(start: datetime, end: datetime) -> tuple[datetime, datetime] | None:
    """Whole-hour UTC window covering [start, end], clipped to the forecast horizon."""
    start = floor_hour(start)
    horizon = floor_hour(datetime.now(timezone.utc)).replace(hour=23) + timedelta(days=FORECAST_HORIZON_DAYS)
    end = min(floor_hour(end) + timedelta(hours=1), horizon)
    return None if end < start else (start, end)


def query_params(start: datetime, end: datetime) -> dict[str, str]:
    """Open-Meteo query (minus coordinates); shared by the server fetch and client requests."""
    return {
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
        "end_hour": end.strftime("%Y-%m-%dT%H:%M"),
    }


def _fetch_batch(locations: list[LatLon], start: datetime, end: datetime) -> list[Forecast]:
    api_key = settings.TRUCK_ROUTING["OPEN_METEO_API_KEY"]
    base = "https://customer-api.open-meteo.com" if api_key else "https://api.open-meteo.com"
    params = {
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in locations),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in locations),
        **query_params(start, end),
    }
    if api_key:
        params["apikey"] = api_key
    data = get_json(f"{base}/v1/forecast", params, provider="Weather service")
    items = data if isinstance(data, list) else [data]
    if len(items) != len(locations) or any(isinstance(i, dict) and i.get("error") for i in items):
        raise ProviderError("Weather service returned an unexpected response.")
    return [_parse(item, start) for item in items]


def get_forecasts(points: list[LatLon], start: datetime, end: datetime) -> dict[LatLon, Forecast]:
    """Hourly forecasts covering [start, end] for each point, keyed by `snap(point)`."""
    if (window := _window(start, end)) is None:
        return {}
    start, end = window

    span = f"{start:%Y%m%d%H}-{end:%Y%m%d%H}"
    unique = list(dict.fromkeys(snap(p) for p in points))
    keys = {loc: f"wx:{loc[0]},{loc[1]}:{span}" for loc in unique}
    found: dict[LatLon, Forecast] = {}
    cached = cache.get_many(list(keys.values()))
    for loc, key in keys.items():
        if key in cached:
            found[loc] = cached[key]

    missing = [loc for loc in unique if loc not in found]
    batches = [missing[i : i + BATCH_SIZE] for i in range(0, len(missing), BATCH_SIZE)]
    if batches:
        logger.info("Fetching weather for %d locations in %d batches", len(missing), len(batches))
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL_BATCHES) as pool:
            results = list(pool.map(lambda b: _fetch_batch(b, start, end), batches))
        fresh: dict[str, Forecast] = {}
        for batch, forecasts in zip(batches, results):
            for loc, fc in zip(batch, forecasts):
                found[loc] = fc
                fresh[keys[loc]] = fc
        cache.set_many(fresh, settings.TRUCK_ROUTING["WEATHER_CACHE_TTL_S"])
    return found


# --- Client-assisted fetching ------------------------------------------------------------
# Open-Meteo's free tier limits requests per IP, and shared cloud egress IPs (e.g. Render's
# free tier) hit that limit. In that case the API asks the browser to fetch the exact same
# query with its own IP/quota and post the raw hourly data back. All parsing, risk rules and
# ranking still run here; the browser is only a transport.

SERVER_LIMITED_KEY = "wx:server-rate-limited"
SERVER_LIMITED_TTL_S = 600


class WeatherRequired(Exception):
    """Raised to ask the client to fetch forecasts; carries the request to perform."""

    def __init__(self, request: dict):
        super().__init__("Client weather fetch required")
        self.request = request


def client_request(points: list[LatLon], start: datetime, end: datetime) -> dict | None:
    if (window := _window(start, end)) is None:
        return None
    unique = list(dict.fromkeys(snap(p) for p in points))
    return {
        "url": "https://api.open-meteo.com/v1/forecast",
        "params": query_params(*window),
        "locations": [[lat, lon] for lat, lon in unique],
        "batch_size": BATCH_SIZE,
    }


def from_client(payload: dict) -> dict[LatLon, Forecast]:
    """Parse forecasts the browser fetched (validated by the serializer)."""
    start = payload["start_hour"]
    return {
        snap((lat, lon)): _parse(item, start)
        for (lat, lon), item in zip(payload["locations"], payload["items"])
    }


def resolve_forecasts(
    points: list[LatLon], start: datetime, end: datetime, supplied: dict | None = None
) -> dict[LatLon, Forecast]:
    """Forecasts from the client payload, else the server fetch, else ask the client.

    WEATHER_SOURCE: "auto" (server, falling back to client while rate-limited),
    "server" (never ask the client) or "client" (always ask the client).
    """
    if supplied is not None:
        return from_client(supplied)
    mode = settings.TRUCK_ROUTING["WEATHER_SOURCE"]
    if mode == "client" or (mode == "auto" and cache.get(SERVER_LIMITED_KEY)):
        return _ask_client(points, start, end)
    try:
        return get_forecasts(points, start, end)
    except RateLimited:
        if mode != "auto":
            raise
        logger.warning("Open-Meteo rate-limited this server; using client-side fetch for %ss", SERVER_LIMITED_TTL_S)
        cache.set(SERVER_LIMITED_KEY, True, SERVER_LIMITED_TTL_S)
        return _ask_client(points, start, end)


def _ask_client(points: list[LatLon], start: datetime, end: datetime) -> dict[LatLon, Forecast]:
    """Raise WeatherRequired, unless the window is past the forecast horizon (nothing to fetch)."""
    if (request := client_request(points, start, end)) is None:
        return {}
    raise WeatherRequired(request)
