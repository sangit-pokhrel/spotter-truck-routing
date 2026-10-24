"""Provider clients with HTTP mocked out."""

from datetime import UTC, datetime
from unittest import mock

import pytest

from trips.services import routing, weather
from trips.services.geocoding import parse_coordinates
from trips.services.routing import Route, select_distinct


def osrm_route(coords, seconds_per_seg=60.0, meters_per_seg=1609.344):
    n = len(coords) - 1
    return {
        "geometry": {"coordinates": [[lon, lat] for lat, lon in coords]},
        "duration": seconds_per_seg * n,
        "legs": [{"annotation": {"distance": [meters_per_seg] * n, "duration": [seconds_per_seg] * n}}],
    }


def test_parse_route_caps_truck_speed():
    coords = [(40.0, -100.0), (40.01, -100.0), (40.02, -100.0)]
    raw = osrm_route(coords, seconds_per_seg=36.0)  # 1 mile in 36 s = 100 mph
    route = routing._parse_route(raw, max_speed_mph=65)
    assert route.distance_mi == pytest.approx(2)
    assert route.duration_h == pytest.approx(2 / 65)


def test_parse_route_falls_back_when_annotations_misaligned():
    coords = [(40.0, -100.0), (40.5, -100.0), (41.0, -100.0)]
    raw = osrm_route(coords, seconds_per_seg=3600)  # ~34.5 mi/h, under the speed cap
    raw["legs"][0]["annotation"]["distance"] = [1.0]  # wrong length
    route = routing._parse_route(raw, max_speed_mph=65)
    assert len(route.seg_miles) == 2
    assert route.duration_h == pytest.approx(raw["duration"] / 3600)


def line(lon_offset, n=50):
    pts = [(40 + i * 0.1, -100 + lon_offset) for i in range(n)]
    return Route(points=pts, seg_miles=[6.9] * (n - 1), seg_hours=[0.1] * (n - 1))


def test_select_distinct_drops_duplicates_and_long_detours():
    base = line(0)
    duplicate = line(0.001)
    distinct = line(1.0)
    detour = Route(points=line(3.0).points, seg_miles=base.seg_miles, seg_hours=[0.2] * 49)  # 2x slower
    chosen = select_distinct([base, duplicate, distinct, detour], count=3)
    assert chosen == [base, distinct]


def test_find_routes_adds_via_routes_when_osrm_returns_too_few():
    calls = []

    def fake_osrm(waypoints, alternatives=0):
        calls.append(waypoints)
        if len(waypoints) == 2:
            return [line(0)]
        return [line(len(calls) * 0.8)]  # each via-point yields a distinct corridor

    with mock.patch.object(routing, "_osrm", side_effect=fake_osrm):
        routes = routing.find_routes((40, -100), (45, -100), count=3)
    assert len(routes) == 3
    assert len(calls) == 1 + routing.VIA_ROUND_SIZE  # one round of via-points was enough


def test_spur_through_via_point_is_rejected():
    # 200 mi northbound, but the via-point at mile 100 adds a 30 mi out-and-back side trip.
    route = line(0, n=30)
    route.seg_miles = [200 / 29] * 29
    route.via_mile = 100
    window = routing.spur_window(route)
    assert window == (75, 125)  # +/-25 mi floor (10% of 200 mi = 20 mi)

    straight_road = lambda a, b: 50.0  # noqa: E731 - fastest road between window ends
    assert routing.is_locally_optimal(route, fastest_between=straight_road)
    spur_road = lambda a, b: 50.0 / 1.5  # noqa: E731 - window is 1.5x the direct road
    assert not routing.is_locally_optimal(route, fastest_between=spur_road)


def test_routes_without_via_point_skip_spur_check():
    assert routing.is_locally_optimal(line(0), fastest_between=lambda a, b: pytest.fail("no call expected"))


def test_parse_route_records_via_mile():
    coords = [(40.0, -100.0), (40.01, -100.0), (40.02, -100.0)]
    raw = osrm_route(coords)
    leg = raw["legs"][0]
    raw["legs"] = [
        {"distance": 1609.344, "annotation": {k: v[:1] for k, v in leg["annotation"].items()}},
        {"distance": 1609.344, "annotation": {k: v[1:] for k, v in leg["annotation"].items()}},
    ]
    assert routing._parse_route(raw, max_speed_mph=65).via_mile == pytest.approx(1.0)


def test_parse_coordinates():
    assert parse_coordinates("39.74, -104.99").lat == 39.74
    assert parse_coordinates("Denver") is None
    assert parse_coordinates("100, 0") is None


def test_weather_batches_converts_units_and_caches():
    start = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    points = [(40 + i * 0.1, -100.0) for i in range(150)]

    def fake_get_json(url, params, provider):
        n = len(params["latitude"].split(","))
        item = {
            "hourly_units": {"wind_speed_10m": "km/h", "rain": "mm", "snowfall": "cm"},
            "hourly": {
                "wind_speed_10m": [100.0, None],
                "wind_gusts_10m": [120.0, None],
                "rain": [25.4, None],
                "showers": [25.4, None],
                "snowfall": [2.54, None],
            },
        }
        return [item] * n

    with mock.patch.object(weather, "get_json", side_effect=fake_get_json) as m:
        result = weather.get_forecasts(points, start, start)
        assert m.call_count == 2  # 150 locations -> batches of 100 + 50
        weather.get_forecasts(points, start, start)
        assert m.call_count == 2  # second call fully served from cache

    sample = result[weather.snap(points[0])].at(start)
    assert sample.wind_mph == pytest.approx(62.1371)
    assert sample.rain_in_hr == pytest.approx(2.0)  # rain + showers, mm -> in
    assert sample.snow_in_hr == pytest.approx(1.0)
    assert result[weather.snap(points[0])].wind[1] is None
