"""Django settings, configured from environment variables."""

import os
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.onrender.com")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "trips",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# The app is stateless (no models); SQLite only satisfies Django's internals.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Shared cache across workers/instances when REDIS_URL is set; per-process otherwise.
REDIS_URL = os.environ.get("REDIS_URL")
if REDIS_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}
else:
    # File cache is shared by all gunicorn workers on one instance (LocMem is per process).
    CACHES = {
        "default": {
            "BACKEND": "trips.cache.ResilientFileBasedCache",
            "LOCATION": os.environ.get("CACHE_DIR", str(Path(tempfile.gettempdir()) / "truck-routing-cache")),
            "OPTIONS": {"MAX_ENTRIES": 20000},
        }
    }

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True

# browser-forwarded forecasts can be a few hundred KB
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# The built React app (copied here by the Dockerfile) is served from "/".
FRONTEND_DIST = BASE_DIR / "frontend_dist"
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
WHITENOISE_INDEX_FILE = True
# browsers won't install the PWA without the right manifest type
WHITENOISE_MIMETYPES = {".webmanifest": "application/manifest+json"}


def whitenoise_headers(headers, path, url):
    """The SPA is served by WhiteNoise before Django's middleware, so add anti-framing here too."""
    headers["X-Frame-Options"] = "DENY"


WHITENOISE_ADD_HEADERS_FUNCTION = whitenoise_headers

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "trips.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": os.environ.get("API_RATE_LIMIT", "120/min")},
    # Behind a reverse proxy every request comes from the proxy's IP; trusting that many
    # X-Forwarded-For hops lets the throttle see real clients.
    "NUM_PROXIES": int(os.environ["TRUSTED_PROXIES"]) if os.environ.get("TRUSTED_PROXIES") else None,
}

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))

SILENCED_SYSTEM_CHECKS = [
    # JSON API without cookies or sessions: nothing for CSRF to protect
    "security.W003",
    # the proxy terminates TLS and redirects HTTP; doing it here breaks internal health checks
    "security.W008",
    # includeSubDomains/preload affect the whole domain, so they're left to its owner
    "security.W005",
    "security.W021",
]

TRUCK_ROUTING = {
    "OSRM_URL": os.environ.get("OSRM_URL", "https://router.project-osrm.org"),
    "PHOTON_URL": os.environ.get("PHOTON_URL", "https://photon.komoot.io"),
    # Commercial Open-Meteo key is optional; the free endpoint is used without it.
    "OPEN_METEO_API_KEY": os.environ.get("OPEN_METEO_API_KEY", ""),
    # auto | server | client: where hourly forecasts are fetched
    "WEATHER_SOURCE": os.environ.get("WEATHER_SOURCE", "auto"),
    "HTTP_TIMEOUT_S": float(os.environ.get("HTTP_TIMEOUT_S", "20")),
    "USER_AGENT": os.environ.get("HTTP_USER_AGENT", "spotter-truck-routing/1.0"),
    # Governed (top) speed of the truck; most fleet trucks are limited to ~65 mph.
    "TRUCK_MAX_SPEED_MPH": float(os.environ.get("TRUCK_MAX_SPEED_MPH", "65")),
    # posted speed limits via Valhalla; when off, only the speed cap applies
    "SPEED_LIMITS_ENABLED": env_bool("SPEED_LIMITS_ENABLED", True),
    "VALHALLA_URL": os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de"),
    # the public Valhalla allows ~1 req/s; raise for a self-hosted one
    "SPEED_LIMITS_PARALLEL": int(os.environ.get("SPEED_LIMITS_PARALLEL", "2")),
    "WEATHER_CACHE_TTL_S": int(os.environ.get("WEATHER_CACHE_TTL_S", "1800")),
    "ROUTE_CACHE_TTL_S": int(os.environ.get("ROUTE_CACHE_TTL_S", "3600")),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
