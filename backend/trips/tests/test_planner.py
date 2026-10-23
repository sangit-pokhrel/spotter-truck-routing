from datetime import datetime, timedelta, timezone

import pytest

from trips.services.planner import apply_weather, build_checkpoints, risk_segments, summarize
from trips.services.routing import Route
from trips.services.weather import Forecast, snap

DEPARTURE = datetime(2026, 1, 1, 6, 0, tzinfo=timezone.utc)


def straight_route(miles=100.0, mph=50.0, pieces=10):
    """Northbound route made of equal segments; 1° latitude ≈ 69 mi."""
    step = miles / pieces
    points = [(30 + i * step / 69.0, -100.0) for i in range(pieces + 1)]
    return Route(points=points, seg_miles=[step] * pieces, seg_hours=[step / mph] * pieces)


def calm_forecast(wind=5.0, hours=48):
    return Forecast(start=DEPARTURE, wind=[wind] * hours, gust=[None] * hours, rain=[0.0] * hours, snow=[0.0] * hours)


def test_checkpoints_every_interval_plus_destination():
    cps = build_checkpoints(straight_route(miles=100), interval_mi=25)
    assert [cp.mile for cp in cps] == [0, 25, 50, 75, 100]


def test_checkpoint_eta_uses_route_speed():
    cps = build_checkpoints(straight_route(miles=100, mph=50), interval_mi=25)
    assert [round(cp.hours, 3) for cp in cps] == [0, 0.5, 1.0, 1.5, 2.0]


def test_eta_follows_uneven_segment_speeds():
    route = straight_route(miles=100, pieces=2)
    route.seg_hours = [1.0, 0.5]  # first half slow, second half fast
    cps = build_checkpoints(route, interval_mi=25)
    assert [round(cp.hours, 3) for cp in cps] == [0, 0.5, 1.0, 1.25, 1.5]


def test_coverage_sums_to_route_length_with_partial_last_interval():
    cps = build_checkpoints(straight_route(miles=60), interval_mi=25)
    assert [cp.mile for cp in cps] == [0, 25, 50, 60]
    assert sum(cp.coverage_mi for cp in cps) == pytest.approx(60)
    assert cps[0].covers == (0, 12.5)
    assert cps[-1].covers == (55, 60)


def test_weather_sampled_at_checkpoint_eta():
    route = straight_route(miles=100, mph=50)
    cps = build_checkpoints(route, interval_mi=50)  # ETAs 0h, 1h, 2h
    hourly_wind = [10.0, 40.0, 60.0] + [0.0] * 45
    fc = Forecast(DEPARTURE, hourly_wind, [None] * 48, [0.0] * 48, [0.0] * 48)
    forecasts = {snap(cp.point): fc for cp in cps}
    apply_weather(cps, DEPARTURE, forecasts, load_weight_lb=10_000)
    assert [cp.weather.wind_mph for cp in cps] == [10.0, 40.0, 60.0]
    assert [cp.risk.level.key for cp in cps] == ["low", "high", "no_travel"]


def test_summary_counts_miles_per_level_and_unknown():
    route = straight_route(miles=100, mph=50)
    cps = build_checkpoints(route, interval_mi=25)
    forecasts = {snap(cp.point): calm_forecast() for cp in cps[:-1]}  # last checkpoint has no data
    forecasts[snap(cps[2].point)] = calm_forecast(wind=47)
    apply_weather(cps, DEPARTURE, forecasts, load_weight_lb=35_000)

    ev = summarize("A", route, cps)
    assert ev.miles_by_level["no_travel"] == pytest.approx(25)  # 45–54 mph with > 30,000 lb
    assert ev.miles_by_level["unknown"] == pytest.approx(12.5)
    assert ev.miles_by_level["low"] == pytest.approx(62.5)
    assert ev.avg_risk == pytest.approx(4 * 25 / 87.5)


def test_risk_segments_cover_whole_route_and_merge_same_levels():
    route = straight_route(miles=100, mph=50)
    cps = build_checkpoints(route, interval_mi=25)
    forecasts = {snap(cp.point): calm_forecast() for cp in cps}
    forecasts[snap(cps[4].point)] = calm_forecast(wind=40)
    apply_weather(cps, DEPARTURE, forecasts, load_weight_lb=10_000)

    pieces = risk_segments(summarize("A", route, cps))
    assert [p["level"] for p in pieces] == ["low", "high"]
    assert pieces[0]["coords"][0] == [30.0, -100.0]
    assert pieces[-1]["coords"][-1] == [round(route.points[-1][0], 5), -100.0]
    assert pieces[0]["coords"][-1] == pieces[1]["coords"][0]


def test_forecast_lookup_uses_nearest_hour_and_bounds():
    fc = calm_forecast(hours=3)
    assert fc.at(DEPARTURE + timedelta(minutes=89)) is not None
    assert fc.at(DEPARTURE + timedelta(hours=3)) is None
    assert fc.at(DEPARTURE - timedelta(hours=1)) is None
