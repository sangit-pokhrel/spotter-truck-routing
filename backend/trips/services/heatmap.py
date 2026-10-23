"""Weather heatmap along the trip corridor for the next 0–48 forecast hours.

The corridor is rasterised on a grid whose columns are even in longitude and whose rows are
even in Web-Mercator Y. That way the client can paint one pixel per cell onto a tiny canvas
and drop it on the map as an image overlay with no reprojection error. The browser's bilinear
scaling then produces a smooth heatmap, and every hour is pre-computed, so the slider never
waits on the network.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from .geo import LatLon, inverse_mercator_y, mercator_y
from .planner import CORRIDOR_STEP_MI
from .risk import assess
from .weather import get_forecasts, snap

CORRIDOR_HALF_WIDTH_MI = 40.0
MAX_CELLS = 450
MIN_SPACING_MI = 8.0
MILES_PER_DEG_LAT = 69.0


class _CorridorIndex:
    """Spatial hash for "is this point within W miles of the route corridor?"."""

    def __init__(self, points: list[LatLon], radius_mi: float):
        self.radius = radius_mi
        self.cell = radius_mi / MILES_PER_DEG_LAT
        self.buckets: dict[tuple[int, int], list[LatLon]] = {}
        for p in points:
            self.buckets.setdefault(self._key(p), []).append(p)

    def _key(self, p: LatLon) -> tuple[int, int]:
        return math.floor(p[0] / self.cell), math.floor(p[1] / self.cell)

    def contains(self, p: LatLon) -> bool:
        ky, kx = self._key(p)
        # Longitude degrees shrink with latitude, so widen the x search accordingly.
        span_x = math.ceil(1 / max(math.cos(math.radians(p[0])), 0.2))
        kx_lat = math.cos(math.radians(p[0]))
        for dy in (-1, 0, 1):
            for dx in range(-span_x, span_x + 1):
                for q in self.buckets.get((ky + dy, kx + dx), ()):
                    dlat = (p[0] - q[0]) * MILES_PER_DEG_LAT
                    dlon = (p[1] - q[1]) * MILES_PER_DEG_LAT * kx_lat
                    if dlat * dlat + dlon * dlon <= self.radius * self.radius:
                        return True
        return False


def build_grid(corridor: list[LatLon]) -> tuple[dict, list[tuple[int, LatLon]]]:
    """Grid definition and the (cell index, centre) pairs lying inside the corridor."""
    index = _CorridorIndex(corridor, CORRIDOR_HALF_WIDTH_MI)
    pad_lat = CORRIDOR_HALF_WIDTH_MI / MILES_PER_DEG_LAT
    lats = [p[0] for p in corridor]
    lons = [p[1] for p in corridor]
    south, north = min(lats) - pad_lat, max(lats) + pad_lat
    mid_cos = max(math.cos(math.radians((south + north) / 2)), 0.2)
    pad_lon = pad_lat / mid_cos
    west, east = min(lons) - pad_lon, max(lons) + pad_lon
    y_top, y_bottom = mercator_y(north), mercator_y(south)

    # Start just under the spacing implied by the corridor's (over-)estimated area, then grow.
    area_estimate = len(corridor) * CORRIDOR_STEP_MI * 2 * CORRIDOR_HALF_WIDTH_MI
    spacing = max(MIN_SPACING_MI, 0.6 * math.sqrt(area_estimate / MAX_CELLS))
    while True:
        dlon = spacing / (MILES_PER_DEG_LAT * mid_cos)
        dy = math.radians(dlon)  # Mercator is conformal: equal x/y steps ⇒ square cells
        cols = max(1, math.ceil((east - west) / dlon))
        rows = max(1, math.ceil((y_top - y_bottom) / dy))
        cells = []
        for r in range(rows):
            lat = inverse_mercator_y(y_top - (r + 0.5) * dy)
            for c in range(cols):
                centre = (lat, west + (c + 0.5) * dlon)
                if index.contains(centre):
                    cells.append((r * cols + c, centre))
        if len(cells) <= MAX_CELLS:
            break
        spacing *= 1.15

    grid = {
        "west": west,
        "east": west + cols * dlon,
        "north": north,
        "south": inverse_mercator_y(y_top - rows * dy),
        "cols": cols,
        "rows": rows,
        "spacing_mi": round(spacing, 1),
    }
    return grid, cells


def build_heatmap(corridor: list[LatLon], departure: datetime, load_weight_lb: float, hours: int = 48) -> dict:
    grid, cells = build_grid(corridor)
    end = departure + timedelta(hours=hours)
    forecasts = get_forecasts([c for _, c in cells], departure, end)

    metrics = ("risk", "wind", "rain", "snow")
    frames: dict[str, list[list]] = {m: [] for m in metrics}
    for h in range(hours + 1):
        when = departure + timedelta(hours=h)
        hour_values: dict[str, list] = {m: [] for m in metrics}
        for _, centre in cells:
            fc = forecasts.get(snap(centre))
            sample = fc.at(when) if fc else None
            if sample is None:
                values = (None, None, None, None)
            else:
                values = (
                    int(assess(sample, load_weight_lb).level),
                    round(sample.wind_mph),
                    round(sample.rain_in_hr, 3),
                    round(sample.snow_in_hr, 3),
                )
            for metric, value in zip(metrics, values):
                hour_values[metric].append(value)
        for metric in metrics:
            frames[metric].append(hour_values[metric])

    return {
        "start": departure.isoformat(),
        "hours": hours,
        "grid": grid,
        "cells": [idx for idx, _ in cells],
        "frames": frames,
    }
