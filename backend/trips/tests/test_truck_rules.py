from unittest import mock

import pytest

from trips.services import speed_limits
from trips.services.routing import Route
from trips.services.truck_rules import TRUCK_RULES, segment_rules, state_at


@pytest.mark.parametrize(
    "lat, lon, expected",
    [
        (34.05, -118.24, "CA"),  # Los Angeles
        (45.52, -122.68, "OR"),  # Portland, OR
        (45.64, -122.66, "WA"),  # Vancouver, WA, just across the Columbia River
        (47.61, -122.33, "WA"),  # Seattle
        (42.33, -83.05, "MI"),  # Detroit
        (39.77, -86.16, "IN"),  # Indianapolis
        (39.53, -119.81, None),  # Reno, NV (no truck rule)
        (41.88, -87.63, None),  # Chicago, IL
        (39.74, -104.99, None),  # Denver, CO
    ],
)
def test_state_lookup(lat, lon, expected):
    assert state_at(lat, lon) == expected


def test_every_rule_cites_its_source():
    for rule in TRUCK_RULES.values():
        assert rule.source and rule.limit_mph < 70


def test_segment_rules_follow_the_road_across_a_state_line():
    # Northbound I-5 from Portland, OR into Vancouver, WA
    points = [(45.50 + i * 0.005, -122.67) for i in range(40)]
    states = [r.state if r else None for r in segment_rules(points)]
    assert states[0] == "OR" and states[-1] == "WA"
    assert states.index("WA") > 0  # one switch, in order


def california_route(miles=100.0, pieces=10, car_mph=60.0):
    step = miles / pieces
    points = [(36.0 + i * step / 69.0, -120.0) for i in range(pieces + 1)]  # central California
    hours = [step / car_mph] * pieces
    return Route(points=points, seg_miles=[step] * pieces, seg_hours=list(hours), osrm_hours=list(hours))


def test_california_trucks_drive_55_even_on_a_70_mph_freeway():
    route = california_route()
    fake = {"edges": [{"length": 100, "speed_limit": 70, "road_class": "motorway"}]}
    with mock.patch.object(speed_limits, "post_json", return_value=fake):
        speed_limits.enrich_routes([route], wait=True)
    assert set(route.seg_limits) == {70}
    assert set(route.seg_truck_limits) == {55}
    assert route.duration_h == pytest.approx(100 / 55)


def test_state_truck_limit_applies_without_posted_limits(settings):
    settings.TRUCK_ROUTING = {**settings.TRUCK_ROUTING, "SPEED_LIMITS_ENABLED": False}
    route = california_route(car_mph=62)
    assert speed_limits.enrich_routes([route]) == speed_limits.DISABLED
    assert route.duration_h == pytest.approx(100 / 55)


def test_no_state_rule_keeps_governed_speed():
    route = california_route()
    route.points = [(39.0 + i * 10 / 69.0, -104.9) for i in range(11)]  # Colorado
    fake = {"edges": [{"length": 100, "speed_limit": 75, "road_class": "motorway"}]}
    with mock.patch.object(speed_limits, "post_json", return_value=fake):
        speed_limits.enrich_routes([route], wait=True)
    assert set(route.seg_truck_limits) == {None}
    assert route.duration_h == pytest.approx(100 / 65)
