"""State truck speed limits set by statute (rarely tagged per road in OpenStreetMap).

Only states whose truck limit is below a typical 65 mph governed speed are listed; check the table
against current law before relying on it. Rules assume a loaded tractor-trailer.
Boundaries: US Census 2010 (1:20M), simplified to ~1 km.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "state_boundaries.json"


@dataclass(frozen=True)
class TruckRule:
    state: str
    limit_mph: float
    source: str
    note: str = ""


TRUCK_RULES: dict[str, TruckRule] = {
    r.state: r
    for r in (
        TruckRule("CA", 55, "California Vehicle Code §22406", "3+ axle trucks and any vehicle towing"),
        TruckRule(
            "OR", 55, "ORS 811.111", "trucks > 10,000 lb; some I-84 sections allow 60–65 (not modelled: conservative)"
        ),
        TruckRule("WA", 60, "RCW 46.61.410", "vehicles > 10,000 lb and vehicles towing"),
        TruckRule("MI", 65, "MCL 257.627", "trucks on freeways posted 70–75"),
        TruckRule("IN", 65, "IC 9-21-5-2", "trucks > 26,000 lb on interstates"),
    )
}


@dataclass(frozen=True)
class _State:
    code: str
    rings: tuple[tuple[tuple[float, float], ...], ...]  # (lon, lat) rings
    ring_bboxes: tuple[tuple[float, float, float, float], ...]
    bbox: tuple[float, float, float, float]  # min lon, min lat, max lon, max lat


@lru_cache(maxsize=1)
def _states() -> tuple[_State, ...]:
    out = []
    for item in json.loads(DATA.read_text(encoding="utf-8")):
        if item["state"] not in TRUCK_RULES:
            continue
        rings = tuple(tuple((lon, lat) for lon, lat in ring) for ring in item["rings"])
        boxes = tuple(_bbox(r) for r in rings)
        whole = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        out.append(_State(item["state"], rings, boxes, whole))
    return tuple(out)


def _bbox(ring) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def _inside(lon: float, lat: float, box: tuple[float, float, float, float]) -> bool:
    return box[0] <= lon <= box[2] and box[1] <= lat <= box[3]


def _in_ring(lon: float, lat: float, ring: tuple[tuple[float, float], ...]) -> bool:
    """Ray casting point-in-polygon."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def state_at(lat: float, lon: float) -> str | None:
    """Code of the truck-rule state containing the point, or None (no special truck limit)."""
    for st in _states():
        if _inside(lon, lat, st.bbox) and any(
            _inside(lon, lat, box) and _in_ring(lon, lat, ring) for ring, box in zip(st.rings, st.ring_bboxes)
        ):
            return st.code
    return None


def truck_limit_at(lat: float, lon: float) -> TruckRule | None:
    code = state_at(lat, lon)
    return TRUCK_RULES.get(code) if code else None


MEMO_CELLS_PER_DEG = 50  # ~2 km: consecutive road segments share a lookup


def segment_rules(points: list[tuple[float, float]]) -> list[TruckRule | None]:
    """Truck rule for each segment of a polyline (by its midpoint), memoised per ~2 km cell."""
    memo: dict[tuple[int, int], TruckRule | None] = {}
    rules: list[TruckRule | None] = []
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        lat, lon = (lat1 + lat2) / 2, (lon1 + lon2) / 2
        key = (round(lat * MEMO_CELLS_PER_DEG), round(lon * MEMO_CELLS_PER_DEG))
        if key not in memo:
            memo[key] = truck_limit_at(lat, lon)
        rules.append(memo[key])
    return rules
