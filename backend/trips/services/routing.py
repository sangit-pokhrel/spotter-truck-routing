"""Route options from OSRM.

OSRM's `alternatives` usually yields 1–2 routes. To always offer three genuinely different
options we also route through via-points pushed perpendicular to the origin→destination line,
then keep candidates that are (a) not near-duplicates of an already chosen route,
(b) not absurd detours and (c) locally optimal around the via-point. (c) rejects "spurs" where
the via-point snapped onto a side road and the route drives out to it and straight back.
"""
from __future__ import annotations

import hashlib
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

from .geo import METERS_PER_MILE, LatLon, cumulative, haversine_mi, interpolate, offset_point, resample
from .http import ProviderError, get_json

logger = logging.getLogger(__name__)

# (fraction along origin→destination, perpendicular offset as fraction of the direct distance)
VIA_CANDIDATES: tuple[tuple[float, float], ...] = (
    (0.5, 0.12), (0.5, -0.12), (0.5, 0.25), (0.5, -0.25), (0.35, 0.18), (0.65, -0.18),
)
VIA_ROUND_SIZE = 3
MAX_DETOUR_RATIO = 1.6  # reject candidates slower than this × the fastest route
DUPLICATE_OVERLAP = 0.8  # share of a route lying within OVERLAP_RADIUS of another
OVERLAP_RADIUS_MI = 1.5
# Local-optimality check: the stretch ±window around a via-point may be at most this much
# longer than the fastest road between its two ends.
SPUR_WINDOW_MI = (25.0, 75.0)  # clamp of 10% of the trip length
MAX_LOCAL_STRETCH = 1.25


@dataclass
class Route:
    points: list[LatLon]
    seg_miles: list[float]
    seg_hours: list[float]
    via_mile: float | None = None  # where the forced via-point sits, for via-routes

    @property
    def distance_mi(self) -> float:
        return sum(self.seg_miles)

    @property
    def duration_h(self) -> float:
        return sum(self.seg_hours)


def _parse_route(raw: dict, max_speed_mph: float) -> Route:
    points = [(lat, lon) for lon, lat in raw["geometry"]["coordinates"]]
    dists: list[float] = []
    durs: list[float] = []
    for leg in raw["legs"]:
        ann = leg.get("annotation") or {}
        dists += ann.get("distance", [])
        durs += ann.get("duration", [])

    n = len(points) - 1
    if len(dists) == n and len(durs) == n:
        seg_miles = [d / METERS_PER_MILE for d in dists]
        seg_hours = [t / 3600 for t in durs]
    else:  # annotations misaligned: spread total duration proportionally to distance
        seg_miles = [haversine_mi(points[i], points[i + 1]) for i in range(n)]
        total_mi = sum(seg_miles) or 1.0
        seg_hours = [raw["duration"] / 3600 * m / total_mi for m in seg_miles]

    # A loaded truck can't do 80 mph where a car profile might.
    seg_hours = [max(h, m / max_speed_mph) for m, h in zip(seg_miles, seg_hours)]
    via_mile = raw["legs"][0]["distance"] / METERS_PER_MILE if len(raw["legs"]) > 1 else None
    return Route(points=points, seg_miles=seg_miles, seg_hours=seg_hours, via_mile=via_mile)


def _osrm(waypoints: list[LatLon], alternatives: int = 0) -> list[Route]:
    cfg = settings.TRUCK_ROUTING
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in waypoints)
    data = get_json(
        f"{cfg['OSRM_URL']}/route/v1/driving/{coords}",
        {
            "alternatives": alternatives or "false",
            "overview": "full",
            "geometries": "geojson",
            "annotations": "distance,duration",
            "steps": "false",
        },
        provider="Routing service",
    )
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ProviderError(data.get("message") or "No drivable route found between these locations.")
    return [_parse_route(r, cfg["TRUCK_MAX_SPEED_MPH"]) for r in data["routes"]]


def _osrm_distance_mi(a: LatLon, b: LatLon) -> float:
    """Fastest-route distance only (no geometry), for cheap sanity checks."""
    coords = f"{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}"
    data = get_json(
        f"{settings.TRUCK_ROUTING['OSRM_URL']}/route/v1/driving/{coords}",
        {"overview": "false", "steps": "false"},
        provider="Routing service",
    )
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ProviderError("No drivable route found.")
    return data["routes"][0]["distance"] / METERS_PER_MILE


def spur_window(route: Route) -> tuple[float, float] | None:
    """Mile range around the via-point to test for local optimality."""
    if route.via_mile is None:
        return None
    total = route.distance_mi
    half = min(max(0.1 * total, SPUR_WINDOW_MI[0]), SPUR_WINDOW_MI[1])
    return max(0.0, route.via_mile - half), min(total, route.via_mile + half)


def is_locally_optimal(route: Route, fastest_between=_osrm_distance_mi) -> bool:
    window = spur_window(route)
    if window is None:
        return True
    lo, hi = window
    cum = cumulative(route.seg_miles)
    a = interpolate(route.points, cum, lo)[0]
    b = interpolate(route.points, cum, hi)[0]
    return hi - lo <= fastest_between(a, b) * MAX_LOCAL_STRETCH


def _footprint(route: Route) -> set[tuple[int, int]]:
    """Coarse grid cells (~OVERLAP_RADIUS) the route passes through."""
    cell = OVERLAP_RADIUS_MI / 69.0
    return {(math.floor(lat / cell), math.floor(lon / cell)) for lat, lon in resample(route.points, 1.0)}


def _overlap(candidate: Route, other_cells: set[tuple[int, int]]) -> float:
    cell = OVERLAP_RADIUS_MI / 69.0
    samples = resample(candidate.points, 2.0)
    hits = 0
    for lat, lon in samples:
        cy, cx = math.floor(lat / cell), math.floor(lon / cell)
        if any((cy + dy, cx + dx) in other_cells for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
            hits += 1
    return hits / len(samples)


def select_distinct(candidates: list[Route], count: int) -> list[Route]:
    """Greedy pick in candidate order, skipping near-duplicates and long detours."""
    if not candidates:
        return []
    fastest = min(r.duration_h for r in candidates)
    chosen: list[Route] = []
    footprints: list[set[tuple[int, int]]] = []
    for threshold in (DUPLICATE_OVERLAP, 0.95):  # relax once if we can't find enough
        for route in candidates:
            if len(chosen) >= count:
                break
            if any(route is c for c in chosen) or route.duration_h > fastest * MAX_DETOUR_RATIO:
                continue
            if all(_overlap(route, fp) < threshold for fp in footprints):
                chosen.append(route)
                footprints.append(_footprint(route))
    return chosen


def find_routes(origin: LatLon, destination: LatLon, count: int = 3) -> list[Route]:
    key = "routes:" + hashlib.sha1(f"{origin[0]:.4f},{origin[1]:.4f};{destination[0]:.4f},{destination[1]:.4f};{count}".encode()).hexdigest()
    if (cached := cache.get(key)) is not None:
        return cached

    candidates = _osrm([origin, destination], alternatives=count)
    chosen = select_distinct(candidates, count)

    def via_route(via: LatLon) -> Route | None:
        try:
            route = _osrm([origin, via, destination])[0]
            if not is_locally_optimal(route):
                logger.info("Via-point %s skipped: route makes a spur", via)
                return None
            return route
        except ProviderError as exc:  # one bad via-point shouldn't fail the plan
            logger.info("Via-point %s skipped: %s", via, exc)
            return None

    vias = [offset_point(origin, destination, along, side) for along, side in VIA_CANDIDATES]
    # Rounds of 3 in parallel: usually one round is enough, and the public OSRM server throttles bursts.
    for start in range(0, len(vias), VIA_ROUND_SIZE):
        if len(chosen) >= count:
            break
        with ThreadPoolExecutor(max_workers=VIA_ROUND_SIZE) as pool:
            candidates += [r for r in pool.map(via_route, vias[start : start + VIA_ROUND_SIZE]) if r]
        chosen = select_distinct(candidates, count)

    routes = sorted(chosen, key=lambda r: r.duration_h)
    cache.set(key, routes, settings.TRUCK_ROUTING["ROUTE_CACHE_TTL_S"])
    return routes
