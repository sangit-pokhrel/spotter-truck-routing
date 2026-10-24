from datetime import UTC, timedelta

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


MAX_WEATHER_LOCATIONS = 5000
MAX_WEATHER_HOURS = 24 * 17
WEATHER_SERIES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")


class ClientWeatherSerializer(serializers.Serializer):
    """Hourly Open-Meteo data the browser fetched for us (see weather.WeatherRequired)."""

    start_hour = serializers.DateTimeField(default_timezone=UTC)
    locations = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
        max_length=MAX_WEATHER_LOCATIONS,
    )
    items = serializers.ListField(child=serializers.DictField(), max_length=MAX_WEATHER_LOCATIONS)

    def validate(self, attrs):
        if len(attrs["locations"]) != len(attrs["items"]):
            raise serializers.ValidationError("locations and items must have the same length.")
        for item in attrs["items"]:
            hourly = item.get("hourly")
            if not isinstance(hourly, dict) or not isinstance(hourly.get("wind_speed_10m"), list):
                raise serializers.ValidationError("Each item needs hourly.wind_speed_10m.")
            for name in WEATHER_SERIES:
                series = hourly.get(name, [])
                if not isinstance(series, list) or len(series) > MAX_WEATHER_HOURS:
                    raise serializers.ValidationError(f"Invalid hourly.{name}.")
                if any(v is not None and not isinstance(v, (int, float)) for v in series):
                    raise serializers.ValidationError(f"hourly.{name} must contain numbers.")
            if not isinstance(item.get("hourly_units", {}), dict):
                raise serializers.ValidationError("hourly_units must be an object.")
        return attrs


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceField()
    destination = PlaceField()
    departure_time = serializers.DateTimeField(validators=[validate_departure])
    load_weight_lb = serializers.FloatField(min_value=1, max_value=MAX_LOAD_LB)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50], default=25)
    weather = ClientWeatherSerializer(required=False)


class HeatmapRequestSerializer(serializers.Serializer):
    corridor = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
        min_length=1,
        max_length=5000,
    )
    departure_time = serializers.DateTimeField(validators=[validate_departure])
    load_weight_lb = serializers.FloatField(min_value=1, max_value=MAX_LOAD_LB)
    weather = ClientWeatherSerializer(required=False)

    def validate_corridor(self, value):
        for lat, lon in value:
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise serializers.ValidationError("Corridor contains invalid coordinates.")
        return [(lat, lon) for lat, lon in value]
