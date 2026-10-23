from unittest import mock

import pytest

from trips.services import speed_limits
from trips.services.http import ProviderError
from trips.services.planner import build_checkpoints, limit_coverage
from trips.services.routing import Route
from trips.services.speed_limits import Stretch, apply_known_limits, enrich_routes, truck_hours

GOVERNED = 65.0


def straight_route(miles=100.0, pieces=10, car_mph=60.0, lon=-100.0):
    step = miles / pieces
    points = [(40 + i * step / 69.0, lon) for i in range(pieces + 1)]
    hours = [step / car_mph] * pieces
    return Route(points=points, seg_miles=[step] * pieces, seg_hours=list(hours), osrm_hours=list(hours))


def valhalla(*edges):
    """Fake trace_attributes response: (length mi, limit mph, road class) per edge."""
    return {"edges": [{"length": length, "speed_limit": limit, "road_class": cls} for length, limit, cls in edges]}


class TestTruckHours:
    def test_interstate_driven_at_governed_speed_not_posted_75(self):
        assert truck_hours(65, osrm_hours=1.2, limit_mph=75, road_class="motorway", governed_mph=GOVERNED) == pytest.approx(1.0)

    def test_highway_below_governed_speed_uses_posted_limit(self):
        assert truck_hours(55, osrm_hours=0.5, limit_mph=55, road_class="trunk", governed_mph=GOVERNED) == pytest.approx(1.0)

    def test_local_road_keeps_slower_osrm_estimate(self):
        # 10 mi at a posted 45 would be 13 min; OSRM says 20 min (turns, lights) → keep OSRM
        assert truck_hours(10, osrm_hours=1 / 3, limit_mph=45, road_class="primary", governed_mph=GOVERNED) == pytest.approx(1 / 3)

    def test_local_road_never_faster_than_posted(self):
        assert truck_hours(30, osrm_hours=0.4, limit_mph=30, road_class="secondary", governed_mph=GOVERNED) == pytest.approx(1.0)

    def test_unknown_limit_falls_back_to_governed_cap(self):
        assert truck_hours(65, osrm_hours=0.8, limit_mph=None, road_class=None, governed_mph=GOVERNED) == pytest.approx(1.0)


def test_lookup_maps_edges_onto_route_and_retimes_it():
    route = straight_route(miles=100, pieces=10, car_mph=60)
    # Matched length (50 mi) differs from ours (100 mi): edges are stretched to fit.
    fake = valhalla((25, 75, "motorway"), (25, 55, "motorway"))
    with mock.patch.object(speed_limits, "post_json", return_value=fake):
        status = enrich_routes([route], wait=True)
    assert status == speed_limits.APPLIED
    assert route.seg_limits == [75] * 5 + [55] * 5
    assert route.duration_h == pytest.approx(50 / 65 + 50 / 55)


def test_limits_are_reused_spatially_by_other_routes():
    first = straight_route(miles=100, pieces=10)
    with mock.patch.object(speed_limits, "post_json", return_value=valhalla((100, 70, "motorway"))):
        enrich_routes([first], wait=True)
    # Same road, sampled differently (e.g. a live re-check from a new GPS position): no lookups.
    second = straight_route(miles=100, pieces=25)
    with mock.patch.object(speed_limits, "post_json", side_effect=AssertionError("should be cached")):
        assert enrich_routes([second], wait=True) == speed_limits.APPLIED
    assert set(second.seg_limits) == {70}


def test_background_lookup_reports_pending_and_does_not_block():
    route = straight_route()
    with mock.patch.object(speed_limits, "_start", return_value=True) as start:
        assert enrich_routes([route]) == speed_limits.PENDING
    assert start.call_args.args[1] is False  # wait=False → background thread


def test_failed_lookup_keeps_fallback_eta_and_cools_down():
    route = straight_route(miles=100, pieces=10, car_mph=60)
    before = route.duration_h
    with mock.patch.object(speed_limits, "post_json", side_effect=ProviderError("down")) as post:
        assert enrich_routes([route], wait=True) == speed_limits.UNAVAILABLE
        enrich_routes([route], wait=True)
    assert post.call_count == 1  # second plan skipped the stretch while it cools down
    assert route.duration_h == pytest.approx(before)
    assert set(route.seg_limits) == {None}


def test_unposted_road_counts_as_looked_up():
    route = straight_route(miles=100, pieces=10, car_mph=60)
    with mock.patch.object(speed_limits, "post_json", return_value=valhalla((100, 0, "primary"))):
        assert enrich_routes([route], wait=True) == speed_limits.APPLIED  # no repeated lookups
    assert set(route.seg_limits) == {None}


def test_checkpoints_carry_speed_limit_and_coverage():
    route = straight_route(miles=100, pieces=10)
    known = [(70.0, "motorway")] * 6 + [None] * 4
    apply_known_limits(route, known, GOVERNED)
    cps = build_checkpoints(route, interval_mi=50)
    assert [cp.speed_limit_mph for cp in cps] == [70, 70, None]  # mile 50 is inside the 0–60 mi stretch
    assert limit_coverage(route) == pytest.approx(0.6)


def test_long_routes_are_chunked_under_service_limits():
    route = straight_route(miles=600, pieces=60)
    chunks = speed_limits._chunks(route)
    assert len(chunks) >= 6
    for _, start, end in chunks:
        assert end - start <= speed_limits.CHUNK_MI + speed_limits.SAMPLE_MI + 1e-6  # < 200 km
    assert chunks[0][1] == pytest.approx(0) and chunks[-1][2] == pytest.approx(600, rel=0.01)


def test_stretch_dataclass_is_immutable():
    with pytest.raises(AttributeError):
        Stretch(0, 1, 55, "primary").limit_mph = 60
