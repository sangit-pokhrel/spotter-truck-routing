"""Trip planning: routes → checkpoints with ETAs → weather → risk → recommendation."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .geo import LatLon, cumulative, interpolate, resample, simplify
from .geocoding import Place
from .recommendation import RouteStats, explain, rank
from .risk import RiskAssessment, RiskLevel, WeatherSample, assess
from .routing import Route, find_routes
from .weather import Forecast, resolve_forecasts, snap

logger = logging.getLogger(__name__)

ROUTE_NAMES = "ABC"
CORRIDOR_STEP_MI = 10.0


@dataclass(frozen=True)
class TripRequest:
    origin: Place
    destination: Place
    departure: datetime  # timezone-aware
    load_weight_lb: float
    interval_mi: int
    client_weather: dict | None = None  # browser-fetched forecasts, see weather.resolve_forecasts


@dataclass
class Checkpoint:
    mile: float
    point: LatLon
    hours: float  # hours after departure
    covers: tuple[float, float] = (0.0, 0.0)  # mile range this checkpoint represents
    weather: WeatherSample | None = None
    risk: RiskAssessment | None = None

    @property
    def coverage_mi(self) -> float:
        return self.covers[1] - self.covers[0]


@dataclass
class EvaluatedRoute:
    name: str
    route: Route
    checkpoints: list[Checkpoint]
    miles_by_level: dict[str, float] = field(default_factory=dict)
    avg_risk: float = 0.0
    max_level: RiskLevel | None = None


def build_checkpoints(route: Route, interval_mi: float) -> list[Checkpoint]:
    """Checkpoints at 0, interval, 2·interval, … and the destination.

    Each one represents the stretch of road nearer to it than to its neighbours
    (half an interval either side), so "Severe miles" sums real road distance.
    """
    cum_mi = cumulative(route.seg_miles)
    cum_h = cumulative(route.seg_hours)
    total = cum_mi[-1]

    miles: list[float] = []
    m = 0.0
    while m < total - 1e-6:
        miles.append(m)
        m += interval_mi
    miles.append(total)

    checkpoints = []
    for mile in miles:
        point, idx, frac = interpolate(route.points, cum_mi, mile)
        hours = cum_h[idx] + route.seg_hours[idx] * frac if route.seg_hours else 0.0
        checkpoints.append(Checkpoint(mile=mile, point=point, hours=hours))

    for i, cp in enumerate(checkpoints):
        lo = 0.0 if i == 0 else (checkpoints[i - 1].mile + cp.mile) / 2
        hi = total if i == len(checkpoints) - 1 else (cp.mile + checkpoints[i + 1].mile) / 2
        cp.covers = (lo, hi)
    return checkpoints


def apply_weather(
    checkpoints: list[Checkpoint], departure: datetime, forecasts: dict[LatLon, Forecast], load_weight_lb: float
) -> None:
    for cp in checkpoints:
        forecast = forecasts.get(snap(cp.point))
        cp.weather = forecast.at(departure + timedelta(hours=cp.hours)) if forecast else None
        cp.risk = assess(cp.weather, load_weight_lb) if cp.weather else None


def summarize(name: str, route: Route, checkpoints: list[Checkpoint]) -> EvaluatedRoute:
    miles = {level.key: 0.0 for level in RiskLevel}
    miles["unknown"] = 0.0
    weighted, known = 0.0, 0.0
    max_level: RiskLevel | None = None
    for cp in checkpoints:
        if cp.risk is None:
            miles["unknown"] += cp.coverage_mi
            continue
        miles[cp.risk.level.key] += cp.coverage_mi
        weighted += int(cp.risk.level) * cp.coverage_mi
        known += cp.coverage_mi
        max_level = cp.risk.level if max_level is None else max(max_level, cp.risk.level)
    return EvaluatedRoute(
        name=name,
        route=route,
        checkpoints=checkpoints,
        miles_by_level=miles,
        avg_risk=weighted / known if known else 0.0,
        max_level=max_level,
    )


def to_stats(ev: EvaluatedRoute) -> RouteStats:
    return RouteStats(
        name=ev.name,
        no_travel_miles=ev.miles_by_level["no_travel"],
        severe_miles=ev.miles_by_level["severe"],
        high_miles=ev.miles_by_level["high"],
        avg_risk=ev.avg_risk,
        duration_h=ev.route.duration_h,
    )


def risk_segments(ev: EvaluatedRoute) -> list[dict]:
    """Split the route polyline into pieces coloured by the covering checkpoint's risk."""
    route = ev.route
    cum = cumulative(route.seg_miles)
    pieces: list[dict] = []
    vertex = 0
    for cp in ev.checkpoints:
        lo, hi = cp.covers
        coords = [interpolate(route.points, cum, lo)[0]]
        while vertex < len(cum) and cum[vertex] <= lo:
            vertex += 1
        while vertex < len(cum) and cum[vertex] < hi:
            coords.append(route.points[vertex])
            vertex += 1
        coords.append(interpolate(route.points, cum, hi)[0])
        level = cp.risk.level.key if cp.risk else "unknown"
        if pieces and pieces[-1]["level"] == level:
            pieces[-1]["coords"].extend(coords[1:])
        else:
            pieces.append({"level": level, "coords": coords})
    for piece in pieces:
        piece["coords"] = [[round(lat, 5), round(lon, 5)] for lat, lon in simplify(piece["coords"])]
    return pieces


def corridor(routes: list[Route]) -> list[list[float]]:
    pts = {(round(lat, 3), round(lon, 3)) for r in routes for lat, lon in resample(r.points, CORRIDOR_STEP_MI)}
    return [[lat, lon] for lat, lon in sorted(pts)]


def _checkpoint_json(cp: Checkpoint, departure: datetime) -> dict:
    w, r = cp.weather, cp.risk
    return {
        "mile": round(cp.mile, 1),
        "lat": round(cp.point[0], 5),
        "lon": round(cp.point[1], 5),
        "eta": (departure + timedelta(hours=cp.hours)).isoformat(),
        "hours_from_departure": round(cp.hours, 3),
        "coverage_mi": round(cp.coverage_mi, 2),
        "level": r.level.key if r else "unknown",
        "wind_mph": round(w.wind_mph, 1) if w else None,
        "gust_mph": round(w.gust_mph, 1) if w and w.gust_mph is not None else None,
        "rain_in_hr": round(w.rain_in_hr, 3) if w else None,
        "snow_in_hr": round(w.snow_in_hr, 3) if w else None,
        "factors": r.factors if r else ["No forecast available for this time"],
    }


def plan_trip(req: TripRequest) -> dict:
    routes = find_routes((req.origin.lat, req.origin.lon), (req.destination.lat, req.destination.lon))
    checkpoint_sets = [build_checkpoints(r, req.interval_mi) for r in routes]

    all_points = [cp.point for cps in checkpoint_sets for cp in cps]
    last_eta = req.departure + timedelta(hours=max(r.duration_h for r in routes))
    forecasts = resolve_forecasts(all_points, req.departure, last_eta, req.client_weather)
    for cps in checkpoint_sets:
        apply_weather(cps, req.departure, forecasts, req.load_weight_lb)

    evaluated = [summarize(ROUTE_NAMES[i], r, cps) for i, (r, cps) in enumerate(zip(routes, checkpoint_sets))]
    ranked = rank([to_stats(ev) for ev in evaluated])
    order = {s.name: i + 1 for i, s in enumerate(ranked)}

    return {
        "origin": req.origin.to_dict(),
        "destination": req.destination.to_dict(),
        "departure": req.departure.isoformat(),
        "load_weight_lb": req.load_weight_lb,
        "interval_mi": req.interval_mi,
        "recommended_route": ranked[0].name,
        "recommendation_reason": explain(ranked),
        "routes": [
            {
                "id": ev.name,
                "name": f"Route {ev.name}",
                "rank": order[ev.name],
                "distance_mi": round(ev.route.distance_mi, 1),
                "duration_h": round(ev.route.duration_h, 3),
                "arrival": (req.departure + timedelta(hours=ev.route.duration_h)).isoformat(),
                "miles_by_level": {k: round(v, 1) for k, v in ev.miles_by_level.items()},
                "avg_risk": round(ev.avg_risk, 3),
                "max_level": ev.max_level.key if ev.max_level is not None else "unknown",
                "segments": risk_segments(ev),
                "checkpoints": [_checkpoint_json(cp, req.departure) for cp in ev.checkpoints],
            }
            for ev in evaluated
        ],
        "corridor": corridor(routes),
    }
