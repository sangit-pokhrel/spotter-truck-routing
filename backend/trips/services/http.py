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


class RateLimited(ProviderError):
    """The upstream API refused us with HTTP 429 (free tiers limit per client IP)."""


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
        # After the last retry, hand back the real response (e.g. 429 + reason) instead of
        # raising a generic RetryError, so errors say what the provider actually returned.
        raise_on_status=False,
    )
    s = requests.Session()
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=32)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers["User-Agent"] = _config()["USER_AGENT"]
    return s


def _error_reason(resp: requests.Response) -> str:
    """Providers put a human-readable cause in `reason` (Open-Meteo) or `message` (OSRM)."""
    try:
        body = resp.json()
    except ValueError:
        return ""
    return str(body.get("reason") or body.get("message") or "")[:200] if isinstance(body, dict) else ""


def get_json(url: str, params: dict[str, Any] | None = None, *, provider: str) -> Any:
    try:
        resp = session().get(url, params=params, timeout=_config()["HTTP_TIMEOUT_S"])
    except requests.RequestException as exc:
        logger.warning("%s request failed: %s", provider, exc)
        raise ProviderError(f"{provider} is unreachable. Please try again.") from exc
    if resp.status_code >= 400:
        logger.warning("%s returned %s: %s", provider, resp.status_code, resp.text[:300])
        if resp.status_code == 429:
            raise RateLimited(f"{provider} is rate-limiting requests. Please try again in a minute.")
        reason = _error_reason(resp)
        raise ProviderError(f"{provider} returned HTTP {resp.status_code}{f': {reason}' if reason else '.'}")
    try:
        return resp.json()
    except ValueError as exc:
        raise ProviderError(f"{provider} returned an invalid response.") from exc
