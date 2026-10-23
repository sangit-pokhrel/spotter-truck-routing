from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .services.http import ProviderError


def api_exception_handler(exc, context):
    """Upstream provider failures become 502s with a user-readable message."""
    if isinstance(exc, ProviderError):
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return exception_handler(exc, context)
