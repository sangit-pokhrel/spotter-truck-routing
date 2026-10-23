"""Fallback to browser-fetched forecasts when the server is rate-limited."""
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest

from trips.cache import ResilientFileBasedCache
from trips.serializers import ClientWeatherSerializer
from trips.services import weather
from trips.services.http import RateLimited
from trips.services.weather import WeatherRequired, resolve_forecasts

NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
POINTS = [(40.01, -100.01), (40.02, -100.02), (41.0, -101.0)]  # first two snap to the same cell


def item(wind=10.0, hours=3):
    return {
        "hourly_units": {"wind_speed_10m": "mp/h", "rain": "inch", "snowfall": "inch"},
        "hourly": {
            "wind_speed_10m": [wind] * hours,
            "wind_gusts_10m": [None] * hours,
            "rain": [0.0] * hours,
            "showers": [0.0] * hours,
            "snowfall": [0.0] * hours,
        },
    }


@pytest.fixture
def mode(settings):
    def set_mode(value):
        settings.TRUCK_ROUTING = {**settings.TRUCK_ROUTING, "WEATHER_SOURCE": value}

    return set_mode


def test_client_mode_asks_for_unique_snapped_locations(mode):
    mode("client")
    with pytest.raises(WeatherRequired) as exc:
        resolve_forecasts(POINTS, NOW, NOW + timedelta(hours=2))
    req = exc.value.request
    assert req["locations"] == [[40.0, -100.0], [41.0, -101.0]]
    assert req["params"]["start_hour"] == NOW.strftime("%Y-%m-%dT%H:%M")
    assert req["params"]["wind_speed_unit"] == "mph"


def test_auto_mode_falls_back_and_remembers_rate_limit(mode):
    mode("auto")
    with mock.patch.object(weather, "get_forecasts", side_effect=RateLimited("429")) as fetch:
        with pytest.raises(WeatherRequired):
            resolve_forecasts(POINTS, NOW, NOW)
        with pytest.raises(WeatherRequired):
            resolve_forecasts(POINTS, NOW, NOW)
    assert fetch.call_count == 1  # circuit breaker skips the server on the second call


def test_server_mode_surfaces_rate_limit(mode):
    mode("server")
    with mock.patch.object(weather, "get_forecasts", side_effect=RateLimited("429")):
        with pytest.raises(RateLimited):
            resolve_forecasts(POINTS, NOW, NOW)


def test_supplied_forecasts_are_parsed_without_http(mode):
    mode("server")
    payload = {"start_hour": NOW, "locations": [[40.0, -100.0]], "items": [item(wind=47.0)]}
    with mock.patch.object(weather, "get_forecasts") as fetch:
        result = resolve_forecasts(POINTS, NOW, NOW, supplied=payload)
    fetch.assert_not_called()
    assert result[(40.0, -100.0)].at(NOW + timedelta(hours=1)).wind_mph == 47.0


def test_serializer_rejects_malformed_client_weather():
    base = {"start_hour": "2026-10-24T05:00", "locations": [[40, -100]], "items": [item()]}
    assert ClientWeatherSerializer(data=base).is_valid()
    assert not ClientWeatherSerializer(data={**base, "items": []}).is_valid()
    bad = item()
    bad["hourly"]["rain"] = ["lots"]
    assert not ClientWeatherSerializer(data={**base, "items": [bad]}).is_valid()


def test_cache_io_errors_are_cache_misses(tmp_path):
    c = ResilientFileBasedCache(str(tmp_path), {})
    with mock.patch("django.core.cache.backends.filebased.FileBasedCache.set", side_effect=PermissionError("locked")):
        c.set("k", 1)  # must not raise
    with mock.patch("django.core.cache.backends.filebased.FileBasedCache.get", side_effect=PermissionError("locked")):
        assert c.get("k", "miss") == "miss"
