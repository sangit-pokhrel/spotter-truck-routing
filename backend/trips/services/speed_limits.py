"""Posted speed limits along routes, and truck travel times that respect them.

Limits come from Valhalla's trace_attributes (OpenStreetMap maxspeed). Highways are driven at the
lower of the posted limit and the truck's governed speed; other roads keep OSRM's slower estimate
but never exceed the limit. State truck limits (truck_rules) lower the cap further.

The public Valhalla instance allows about 1 request/s and 200 km per request, so limits are cached
per map cell and direction (any route on the same road reuses them), missing stretches are
fetched in a background thread, and failed stretches back off for a few minutes.
"""

from __future__ import annotations

import bisect
import hashlib
import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

from .geo import cumulative, haversine_mi, interpolate
from .http import ProviderError, RateLimited, post_json
from .routing import Route
from .truck_rules import segment_rules

logger = logging.getLogger(__name__)

SAMPLE_MI = 5.0  # must stay < ~6 mi: Valhalla rejects gaps over 10 km
CHUNK_MI = 115.0  # Valhalla's public limit is 200 km per trace
RATE_LIMIT_BACKOFF_S = 3.0
TILE_DEG = 0.1
CELL_DEG = 0.005  # ~500 m
CACHE_TTL_S = 30 * 24 * 3600  # posted limits change rarely
FAILURE_COOLDOWN_S = 300
DONE_COVERAGE = 0.9  # share of miles looked up before a route counts as "applied"
HIGHWAY_CLASSES = frozenset({"motorway", "trunk"})

# Status reported with each plan.
APPLIED, PENDING, UNAVAILABLE, DISABLED = "applied", "pending", "unavailable", "disabled"

_inflight: set[str] = set()
_inflight_lock = threading.Lock()
_store_lock = threading.Lock()  # tiles are read-modify-written by background threads


@dataclass(frozen=True)
class Stretch:
    """A piece of road (in route miles) with its posted limit and road class."""

    start: float
    end: float
    limit_mph: float | None
    road_class: str | None


def truck_hours(
    miles: float, osrm_hours: float, limit_mph: float | None, road_class: str | None, governed_mph: float
) -> float:
    """Hours for a truck to drive one segment."""
    floor = miles / governed_mph  # never faster than the truck can go
    if not limit_mph:
        return max(osrm_hours, floor)
    legal = min(limit_mph, governed_mph)
    if road_class in HIGHWAY_CLASSES:
        return miles / legal
    return max(osrm_hours, miles / legal)


Known = tuple[float, str | None]  # (limit mph, 0 = looked up but not posted; road class)


def _cell(lat: float, lon: float, bearing_bucket: int) -> tuple[str, str]:
    """(tile key, cell key) for a ~500 m cell and direction of travel."""
    tile = f"lim:v1:{math.floor(lat / TILE_DEG)}:{math.floor(lon / TILE_DEG)}"
    return tile, f"{math.floor(lat / CELL_DEG)}:{math.floor(lon / CELL_DEG)}:{bearing_bucket}"


def _bearing_bucket(a: tuple[float, float], b: tuple[float, float]) -> int:
    lat = math.radians((a[0] + b[0]) / 2)
    bearing = math.degrees(math.atan2((b[1] - a[1]) * math.cos(lat), b[0] - a[0])) % 180
    return int(bearing // 45)


def _known(route: Route) -> list[Known | None]:
    """What the cache knows for each segment, looked up at the segment's midpoint."""
    keys = [
        _cell((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, _bearing_bucket(a, b))
        for a, b in zip(route.points, route.points[1:])
    ]
    tiles = cache.get_many(list({t for t, _ in keys}))
    return [tiles.get(t, {}).get(c) for t, c in keys]


def _store(route: Route, stretches: list[Stretch], start_mi: float, end_mi: float) -> None:
    """Store limits for every cell the route crosses between start_mi and end_mi.

    Segments are sampled every half cell, not just at their midpoint, so a later route over the
    same road finds the limit whatever its point spacing.
    """
    if not stretches:
        return
    cum = cumulative(route.seg_miles)
    starts = [s.start for s in stretches]
    entries: dict[tuple[str, str], Known] = {}
    for i, (a, b) in enumerate(zip(route.points, route.points[1:])):
        if cum[i + 1] < start_mi or cum[i] > end_mi:
            continue
        bucket = _bearing_bucket(a, b)
        steps = max(1, math.ceil(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (CELL_DEG / 2)))
        for j in range(steps + 1):
            t = j / steps
            mile = cum[i] + t * route.seg_miles[i]
            if not start_mi <= mile <= end_mi:
                continue
            s = stretches[max(0, bisect.bisect_right(starts, mile) - 1)]
            entries[_cell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, bucket)] = (
                s.limit_mph or 0.0,
                s.road_class,
            )
    if not entries:
        return
    with _store_lock:
        tiles = cache.get_many(list({tile for tile, _ in entries}))
        changed: dict[str, dict] = {}
        for (tile, cell), value in entries.items():
            changed.setdefault(tile, dict(tiles.get(tile, {})))[cell] = value
        cache.set_many(changed, CACHE_TTL_S)


def _chunks(route: Route) -> list[tuple[list[tuple[float, float]], float, float]]:
    """(points, start mile, end mile) pieces of the route, sampled every SAMPLE_MI."""
    geo_cum = cumulative([haversine_mi(route.points[i], route.points[i + 1]) for i in range(len(route.points) - 1)])
    geo_total = geo_cum[-1] or 1.0
    to_route_mi = route.distance_mi / geo_total  # OSRM road miles vs. straight-segment miles
    n = max(1, round(geo_total / SAMPLE_MI))
    samples = [(geo_total * i / n, interpolate(route.points, geo_cum, geo_total * i / n)[0]) for i in range(n + 1)]

    chunks, start = [], 0
    for i in range(1, len(samples)):
        if samples[i][0] - samples[start][0] >= CHUNK_MI or i == len(samples) - 1:
            piece = samples[start : i + 1]
            chunks.append(([p for _, p in piece], piece[0][0] * to_route_mi, piece[-1][0] * to_route_mi))
            start = i
    return chunks


def _fetch_chunk(points: list[tuple[float, float]], start_mi: float, end_mi: float) -> list[Stretch]:
    body = {
        "shape": [{"lat": round(lat, 5), "lon": round(lon, 5)} for lat, lon in points],
        "costing": "truck",
        "shape_match": "map_snap",
        "units": "miles",
        "filters": {"attributes": ["edge.speed_limit", "edge.length", "edge.road_class"], "action": "include"},
    }
    data = post_json(f"{settings.TRUCK_ROUTING['VALHALLA_URL']}/trace_attributes", body, provider="Speed-limit service")
    edges = data.get("edges") or []
    matched = sum(e.get("length", 0) for e in edges)
    if matched <= 0:
        return []
    # Matched length differs slightly from our route's; stretch edges to fit the chunk exactly.
    scale = (end_mi - start_mi) / matched
    stretches, at = [], start_mi
    for e in edges:
        length = e.get("length", 0) * scale
        limit = e.get("speed_limit")
        stretches.append(
            Stretch(
                start=at,
                end=at + length,
                limit_mph=float(limit) if isinstance(limit, (int, float)) and limit > 0 else None,
                road_class=e.get("road_class"),
            )
        )
        at += length
    return stretches


def _job_key(points: list[tuple[float, float]]) -> str:
    sig = f"{points[0][0]:.3f},{points[0][1]:.3f};{points[-1][0]:.3f},{points[-1][1]:.3f};{len(points)}"
    return hashlib.sha1(sig.encode()).hexdigest()


def _run_job(route: Route, points, start_mi: float, end_mi: float, key: str) -> None:
    try:
        for attempt in range(2):
            try:
                _store(route, _fetch_chunk(points, start_mi, end_mi), start_mi, end_mi)
                return
            except RateLimited:
                if attempt:
                    raise
                time.sleep(RATE_LIMIT_BACKOFF_S)
    except (ProviderError, KeyError, TypeError, ValueError) as exc:
        logger.info("Speed limits unavailable for miles %.0f–%.0f: %s", start_mi, end_mi, exc)
        cache.set(f"lim:cool:{key}", True, FAILURE_COOLDOWN_S)
    finally:
        with _inflight_lock:
            _inflight.discard(key)


def _missing_jobs(route: Route, known: list[Known | None]) -> list[tuple]:
    """Chunks of `route` that contain segments we know nothing about (and aren't cooling down)."""
    cum = cumulative(route.seg_miles)
    unknown_miles = [(cum[i] + cum[i + 1]) / 2 for i, k in enumerate(known) if k is None]
    if not unknown_miles:
        return []
    jobs = []
    for points, a, b in _chunks(route):
        if any(a <= m <= b for m in unknown_miles):
            key = _job_key(points)
            if not cache.get(f"lim:cool:{key}"):
                jobs.append((route, points, a, b, key))
    return jobs


def _start(jobs: list[tuple], wait: bool) -> bool:
    """Run lookups not already running elsewhere; returns True if any are (still) in flight."""
    with _inflight_lock:
        mine = [j for j in jobs if j[4] not in _inflight]
        _inflight.update(j[4] for j in mine)
        others_running = any(j[4] in _inflight for j in jobs if j not in mine)

    def run_all():
        with ThreadPoolExecutor(max_workers=settings.TRUCK_ROUTING["SPEED_LIMITS_PARALLEL"]) as pool:
            list(pool.map(lambda j: _run_job(*j), mine))

    if mine:
        if wait:
            run_all()
        else:
            threading.Thread(target=run_all, name="speed-limits", daemon=True).start()
    return (bool(mine) and not wait) or others_running


def apply_known_limits(route: Route, known: list[Known | None], governed_mph: float) -> float:
    """Set route.seg_limits / seg_truck_limits / seg_hours; returns the share of miles looked up."""
    if route.osrm_hours is None:
        return 0.0
    rules = segment_rules(route.points)
    limits: list[float | None] = []
    hours: list[float] = []
    looked_up = 0.0
    for miles, osrm_h, k, rule in zip(route.seg_miles, route.osrm_hours, known, rules):
        limit, road_class = k if k else (None, None)
        if k is not None:
            looked_up += miles
        cap = min(governed_mph, rule.limit_mph) if rule else governed_mph  # state truck limit
        limits.append(limit or None)
        hours.append(truck_hours(miles, osrm_h, limit or None, road_class, cap))
    route.seg_limits = limits
    route.seg_truck_limits = [rule.limit_mph if rule else None for rule in rules]
    route.seg_hours = hours
    return looked_up / route.distance_mi if route.distance_mi else 0.0


def enrich_routes(routes: list[Route], wait: bool = False) -> str:
    """Re-time routes with known limits; returns applied/pending/unavailable/disabled.

    Missing limits are fetched in the background unless `wait` is set.
    """
    cfg = settings.TRUCK_ROUTING
    if not routes:
        return DISABLED
    if not cfg["SPEED_LIMITS_ENABLED"]:
        # Posted limits off: state truck limits still apply on top of the governed-speed cap.
        for r in routes:
            apply_known_limits(r, [None] * len(r.seg_miles), cfg["TRUCK_MAX_SPEED_MPH"])
        return DISABLED
    known = [_known(r) for r in routes]
    jobs = [job for r, k in zip(routes, known) for job in _missing_jobs(r, k)]
    # One lookup per stretch of road even when several routes share it.
    unique = list({j[4]: j for j in jobs}.values())
    running = _start(unique, wait) if unique else False
    if wait and unique:
        known = [_known(r) for r in routes]

    coverage = [apply_known_limits(r, k, cfg["TRUCK_MAX_SPEED_MPH"]) for r, k in zip(routes, known)]
    if running:
        return PENDING
    return APPLIED if all(c >= DONE_COVERAGE for c in coverage) else UNAVAILABLE
