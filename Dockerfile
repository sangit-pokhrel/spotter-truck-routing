# Build the React app
FROM node:25-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# Django API + built SPA in one image
FROM python:3.12-slim

# set by CI
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Weather-Aware Truck Routing" \
      org.opencontainers.image.description="Pick the safest truck route from weather at each ETA, load and travel time" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_DEBUG=false \
    PORT=8000 \
    APP_VERSION=${VERSION}
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=web /web/dist ./frontend_dist
RUN python manage.py collectstatic --noinput

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
# deploy.sh rolls back a release that never becomes healthy
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["python", "healthcheck.py"]

# Requests mostly wait on external APIs, so threads are cheap concurrency.
# --forwarded-allow-ips: trust X-Forwarded-* from the proxy in front.
CMD gunicorn config.wsgi:application --bind 0.0.0.0:${PORT} --workers ${WEB_CONCURRENCY:-2} --threads 8 \
    --timeout 90 --forwarded-allow-ips="*" --access-logfile -
