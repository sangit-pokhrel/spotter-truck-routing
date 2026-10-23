from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from trips import views
from trips.services.geocoding import Place
from trips.services.http import ProviderError


@pytest.fixture
def client(settings):
    settings.ALLOWED_HOSTS = ["testserver"]
    return APIClient()


def payload(**overrides):
    body = {
        "origin": {"label": "Denver", "lat": 39.74, "lon": -104.99},
        "destination": {"label": "Chicago", "lat": 41.88, "lon": -87.62},
        "departure_time": (timezone.now() + timedelta(hours=1)).isoformat(),
        "load_weight_lb": 42000,
        "interval_miles": 25,
    }
    body.update(overrides)
    return body


def test_plan_passes_validated_request_to_planner(client):
    with mock.patch.object(views, "plan_trip", return_value={"routes": []}) as plan:
        resp = client.post("/api/plan/", payload(), format="json")
    assert resp.status_code == 200
    trip = plan.call_args.args[0]
    assert trip.origin == Place("Denver", 39.74, -104.99)
    assert trip.interval_mi == 25 and trip.load_weight_lb == 42000


def test_plan_geocodes_free_text(client):
    with mock.patch.object(views.geocoding, "resolve", return_value=Place("X", 30.0, -90.0)) as resolve, \
            mock.patch.object(views, "plan_trip", return_value={}):
        resp = client.post("/api/plan/", payload(origin="New Orleans"), format="json")
    assert resp.status_code == 200
    resolve.assert_called_once_with("New Orleans")


@pytest.mark.parametrize(
    "override, field",
    [
        ({"interval_miles": 15}, "interval_miles"),
        ({"load_weight_lb": 0}, "load_weight_lb"),
        ({"departure_time": "2020-01-01T00:00:00Z"}, "departure_time"),
        ({"departure_time": "2030-01-01T00:00:00"}, "departure_time"),
        ({"origin": {"lat": 200, "lon": 0}}, "origin"),
    ],
)
def test_plan_validation(client, override, field):
    resp = client.post("/api/plan/", payload(**override), format="json")
    assert resp.status_code == 400
    assert field in resp.json()


def test_same_origin_and_destination_rejected(client):
    resp = client.post("/api/plan/", payload(destination={"lat": 39.74, "lon": -104.99}), format="json")
    assert resp.status_code == 400


def test_provider_failure_returns_502(client):
    with mock.patch.object(views, "plan_trip", side_effect=ProviderError("Routing service returned HTTP 503.")):
        resp = client.post("/api/plan/", payload(), format="json")
    assert resp.status_code == 502
    assert resp.json() == {"detail": "Routing service returned HTTP 503."}


def test_heatmap_validates_corridor(client):
    body = {"corridor": [[1000, 0]], "departure_time": payload()["departure_time"], "load_weight_lb": 1000}
    assert client.post("/api/heatmap/", body, format="json").status_code == 400
