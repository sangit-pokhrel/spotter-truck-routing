"""Geometry helpers. Points are (lat, lon) in degrees."""

from __future__ import annotations

import bisect
import math
from collections.abc import Sequence

EARTH_RADIUS_MI = 3958.8
METERS_PER_MILE = 1609.344

LatLon = tuple[float, float]


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def cumulative(values: Sequence[float]) -> list[float]:
    """[v0, v1, ...] -> [0, v0, v0+v1, ...]"""
    out = [0.0]
    for v in values:
        out.append(out[-1] + v)
    return out


def interpolate(points: Sequence[LatLon], cum: Sequence[float], target: float) -> tuple[LatLon, int, float]:
    """Point at distance `target` along a polyline with cumulative distances `cum`.

    Returns (point, segment index, fraction within that segment).
    """
    target = min(max(target, 0.0), cum[-1])
    idx = max(0, min(bisect.bisect_right(cum, target) - 1, len(points) - 2))
    seg = cum[idx + 1] - cum[idx]
    frac = 0.0 if seg <= 0 else (target - cum[idx]) / seg
    (lat1, lon1), (lat2, lon2) = points[idx], points[idx + 1]
    return (lat1 + (lat2 - lat1) * frac, lon1 + (lon2 - lon1) * frac), idx, frac


def offset_point(a: LatLon, b: LatLon, along: float, side_fraction: float) -> LatLon:
    """Point at fraction `along` of a->b, offset sideways by side_fraction * |ab|.

    Flat-earth approximation; only used to place detour via-points.
    """
    kx = math.cos(math.radians((a[0] + b[0]) / 2))
    ax, ay = a[1] * kx, a[0]
    bx, by = b[1] * kx, b[0]
    dx, dy = bx - ax, by - ay
    px, py = ax + dx * along - dy * side_fraction, ay + dy * along + dx * side_fraction
    return (py, px / kx)


def mercator_y(lat: float) -> float:
    lat = max(min(lat, 85.0), -85.0)
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def inverse_mercator_y(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y)) - math.pi / 2)


def simplify(points: Sequence[LatLon], tolerance_deg: float = 0.0004) -> list[LatLon]:
    """Iterative Ramer-Douglas-Peucker. The default tolerance is about 40 m."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (ay, ax), (by, bx) = points[start], points[end]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, worst_idx = 0.0, -1
        for i in range(start + 1, end):
            py, px = points[i]
            # distance to the chord, or to its start when the chord has zero length
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if norm else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, worst_idx = d, i
        if worst > tolerance_deg:
            keep[worst_idx] = True
            stack += [(start, worst_idx), (worst_idx, end)]
    return [p for p, k in zip(points, keep) if k]


def resample(points: Sequence[LatLon], step_mi: float) -> list[LatLon]:
    """Points every `step_mi` along a polyline (including both ends)."""
    if len(points) < 2:
        return list(points)
    cum = cumulative([haversine_mi(points[i], points[i + 1]) for i in range(len(points) - 1)])
    total = cum[-1]
    n = max(1, math.ceil(total / step_mi))
    return [interpolate(points, cum, total * i / n)[0] for i in range(n + 1)]
