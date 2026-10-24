#!/usr/bin/env bash
# Release an image tag: pull, start, wait for the health check, and roll back to the previous
# tag if the new one never becomes healthy.
#
#   ./deploy.sh sha-1a2b3c4      # run by CI on every push to main
#   ./deploy.sh latest           # by hand
#   PULL=0 ./deploy.sh my-tag    # deploy an image already on this host (e.g. built here)
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: ./deploy.sh <image-tag>}"
[ -f .env ] || { echo "Missing deploy/.env (copy .env.example)" >&2; exit 1; }
PREVIOUS="$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n1)"

set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env
  else
    echo "IMAGE_TAG=$1" >> .env
  fi
}

wait_healthy() {
  local cid status
  for _ in $(seq 1 40); do # ~2 minutes
    cid="$(docker compose ps -q web)"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo missing)"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1 # Docker has given up on it
    sleep 3
  done
  return 1
}

echo "==> Deploying $TAG (previous: ${PREVIOUS:-none})"
set_tag "$TAG"
[ "${PULL:-1}" = "0" ] || docker compose pull web
# Caddy waits for a healthy app, so `up` itself fails on a bad release. Don't let `set -e`
# abort here: an unhealthy release must fall through to the rollback below.
docker compose up -d --remove-orphans || echo "!! docker compose up reported a failure" >&2

if wait_healthy; then
  echo "==> $TAG is healthy"
  docker image prune -f > /dev/null
  exit 0
fi

echo "!! $TAG failed its health check; last logs:" >&2
docker compose logs --tail=60 web >&2 || true
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
  echo "!! Rolling back to $PREVIOUS" >&2
  set_tag "$PREVIOUS"
  docker compose up -d --remove-orphans || true
  if wait_healthy; then
    echo "==> Rolled back to $PREVIOUS" >&2
  else
    echo "!! Rollback to $PREVIOUS is not healthy either; check 'docker compose logs web'" >&2
  fi
fi
exit 1
