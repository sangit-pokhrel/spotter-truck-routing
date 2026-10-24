#!/usr/bin/env bash
# Build the image on this server from the Git repo and release it with deploy.sh.
# For when CI can't run; the result is the same as a CI deploy (health-checked, with rollback).
#
#   bash /opt/truck-routing/src/deploy/update-from-source.sh
#
# DEPLOY_DIR (default /opt/truck-routing), REPO_URL and BRANCH can be overridden.
set -euo pipefail

main() {
  local dir="${DEPLOY_DIR:-/opt/truck-routing}"
  local repo="${REPO_URL:-https://github.com/sangit-pokhrel/spotter-truck-routing.git}"
  local branch="${BRANCH:-main}"
  cd "$dir"
  [ -f .env ] || { echo "Missing $dir/.env (copy deploy/.env.example)" >&2; exit 1; }

  if [ -d src/.git ]; then
    git -C src fetch --quiet origin "$branch"
    git -C src reset --quiet --hard "origin/$branch"
  else
    git clone --quiet --branch "$branch" "$repo" src
  fi

  local tag image
  tag="sha-$(git -C src rev-parse --short=7 HEAD)"
  image="$(sed -n 's/^IMAGE=//p' .env | tail -n1)"
  image="${image:-ghcr.io/sangit-pokhrel/spotter-truck-routing}"

  cp src/deploy/compose.yaml src/deploy/Caddyfile src/deploy/deploy.sh .
  echo "==> Building $image:$tag"
  docker build --build-arg VERSION="$tag" --build-arg REVISION="$(git -C src rev-parse HEAD)" -t "$image:$tag" src
  PULL=0 bash ./deploy.sh "$tag"
}

# Wrapped in a function so bash reads the whole script before `git reset` can rewrite this file.
main "$@"
