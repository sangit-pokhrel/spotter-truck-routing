"""Geocoding via Photon (OpenStreetMap data, no API key)."""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass

from django.conf import settings
from django.core.cache import cache

from .http import ProviderError, get_json

_COORD_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lon: float

    def to_dict(self) -> dict:
        return asdict(self)


def parse_coordinates(text: str) -> Place | None:
    """Accept raw "lat, lon" input so users (and tests) can skip geocoding."""
    m = _COORD_RE.match(text)
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if -90 <= lat <= 90 and -180 <= lon <= 180:
        return Place(label=f"{lat:.4f}, {lon:.4f}", lat=lat, lon=lon)
    return None


def _label(props: dict) -> str:
    parts = [props.get("name"), props.get("city"), props.get("state"), props.get("countrycode")]
    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return ", ".join(seen)


def search(query: str, limit: int = 6) -> list[Place]:
    query = query.strip()
    if direct := parse_coordinates(query):
        return [direct]
    key = "geocode:" + hashlib.sha1(f"{query.lower()}|{limit}".encode()).hexdigest()
    if (cached := cache.get(key)) is not None:
        return [Place(**p) for p in cached]

    data = get_json(
        f"{settings.TRUCK_ROUTING['PHOTON_URL']}/api/",
        {"q": query, "limit": limit, "lang": "en"},
        provider="Geocoding service",
    )
    places = []
    for feature in data.get("features", []):
        lon, lat = feature["geometry"]["coordinates"]
        places.append(Place(label=_label(feature.get("properties", {})) or query, lat=lat, lon=lon))
    cache.set(key, [p.to_dict() for p in places], 24 * 3600)
    return places


def resolve(query: str) -> Place:
    results = search(query, limit=1)
    if not results:
        raise ProviderError(f'Could not find a location for "{query}".')
    return results[0]
