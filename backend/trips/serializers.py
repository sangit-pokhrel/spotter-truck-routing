from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .services.geocoding import Place

MAX_DEPARTURE_AHEAD = timedelta(days=7)
MAX_DEPARTURE_PAST = timedelta(hours=2)
MAX_LOAD_LB = 150_000


class PlaceField(serializers.Field):
    """Either free text ("Denver, CO" / "39.7,-104.9") or {"label", "lat", "lon"} from autocomplete."""

    default_error_messages = {"invalid": "Enter a location name or an object with lat/lon."}

    def to_internal_value(self, data):
        if isinstance(data, str):
            if len(data.strip()) < 2:
                self.fail("invalid")
            return data.strip()
        if isinstance(data, dict):
            try:
                lat, lon = float(data["lat"]), float(data["lon"])
            except (KeyError, TypeError, ValueError):
                self.fail("invalid")
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                self.fail("invalid")
            return Place(label=str(data.get("label") or f"{lat:.4f}, {lon:.4f}"), lat=lat, lon=lon)
        self.fail("invalid")

    def to_representation(self, value):
        return value


def validate_departure(value):
    if timezone.is_naive(value):
        raise serializers.ValidationError("Include a timezone offset, e.g. 2026-10-23T08:00:00-05:00.")
    now = timezone.now()
    if value < now - MAX_DEPARTURE_PAST:
        raise serializers.ValidationError("Departure can't be in the past.")
    if value > now + MAX_DEPARTURE_AHEAD:
        raise serializers.ValidationError("Departure must be within the next 7 days (forecast range).")
    return value


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceField()
    destination = PlaceField()
    departure_time = serializers.DateTimeField(validators=[validate_departure])
    load_weight_lb = serializers.FloatField(min_value=1, max_value=MAX_LOAD_LB)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50], default=25)


class HeatmapRequestSerializer(serializers.Serializer):
    corridor = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
        min_length=1,
        max_length=5000,
    )
    departure_time = serializers.DateTimeField(validators=[validate_departure])
    load_weight_lb = serializers.FloatField(min_value=1, max_value=MAX_LOAD_LB)

    def validate_corridor(self, value):
        for lat, lon in value:
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise serializers.ValidationError("Corridor contains invalid coordinates.")
        return [(lat, lon) for lat, lon in value]
