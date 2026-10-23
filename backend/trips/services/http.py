"""Shared HTTP session for third-party providers: connection pooling, retries, timeouts."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    """An upstream API (routing, weather, geocoding) failed or returned unusable data."""


def _config() -> dict[str, Any]:
    return settings.TRUCK_ROUTING


@lru_cache(maxsize=1)
def session() -> requests.Session:
    retry = Retry(
        total=3,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    s = requests.Session()
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=32)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers["User-Agent"] = _config()["USER_AGENT"]
    return s


def get_json(url: str, params: dict[str, Any] | None = None, *, provider: str) -> Any:
    try:
        resp = session().get(url, params=params, timeout=_config()["HTTP_TIMEOUT_S"])
    except requests.RequestException as exc:
        logger.warning("%s request failed: %s", provider, exc)
        raise ProviderError(f"{provider} is unreachable. Please try again.") from exc
    if resp.status_code >= 400:
        logger.warning("%s returned %s: %s", provider, resp.status_code, resp.text[:300])
        raise ProviderError(f"{provider} returned HTTP {resp.status_code}.")
    try:
        return resp.json()
    except ValueError as exc:
        raise ProviderError(f"{provider} returned an invalid response.") from exc
