import os

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import HeatmapRequestSerializer, PlanRequestSerializer
from .services import geocoding
from .services.geo import haversine_mi
from .services.heatmap import build_heatmap
from .services.planner import TripRequest, plan_trip
from .services.weather import WeatherRequired


def weather_required(exc: WeatherRequired) -> Response:
    """Ask the client to fetch forecasts and repeat the request with them."""
    return Response({"weather_request": exc.request})


class HealthView(APIView):
    throttle_classes = []  # polled by health checks

    def get(self, request):
        return Response({"status": "ok", "version": os.environ.get("APP_VERSION", "dev")})


class GeocodeView(APIView):
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 2:
            return Response({"results": []})
        return Response({"results": [p.to_dict() for p in geocoding.search(query)]})


class PlanView(APIView):
    def post(self, request):
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        origin, destination = (
            geocoding.resolve(p) if isinstance(p, str) else p for p in (data["origin"], data["destination"])
        )
        if haversine_mi((origin.lat, origin.lon), (destination.lat, destination.lon)) < 1:
            return Response(
                {"detail": "Origin and destination are the same place."}, status=status.HTTP_400_BAD_REQUEST
            )

        trip = TripRequest(
            origin=origin,
            destination=destination,
            departure=data["departure_time"],
            load_weight_lb=data["load_weight_lb"],
            interval_mi=int(data["interval_miles"]),
            client_weather=data.get("weather"),
        )
        try:
            return Response(plan_trip(trip))
        except WeatherRequired as exc:
            return weather_required(exc)


class HeatmapView(APIView):
    def post(self, request):
        serializer = HeatmapRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            heatmap = build_heatmap(
                data["corridor"], data["departure_time"], data["load_weight_lb"], client_weather=data.get("weather")
            )
        except WeatherRequired as exc:
            return weather_required(exc)
        return Response(heatmap)
