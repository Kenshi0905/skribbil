#!/usr/bin/env bash
set -Eeuo pipefail

# This image is the free public-preview profile. Never silently fall back to
# an ephemeral local database or local artwork storage in this profile.
for key in DATABASE_URL PUBLIC_ORIGIN SKRIBBIL_ENGINE_SECRET SKRIBBIL_ORIGIN_KEY \
  S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  if [[ -z "${!key:-}" ]]; then
    printf 'Missing required configuration: %s\n' "$key" >&2
    exit 1
  fi
done
if [[ ${#SKRIBBIL_ENGINE_SECRET} -lt 32 || ${#SKRIBBIL_ORIGIN_KEY} -lt 32 ]]; then
  printf 'Engine and origin secrets must each contain at least 32 random characters.\n' >&2
  exit 1
fi
if [[ "$PUBLIC_ORIGIN" != https://* || "$S3_ENDPOINT" != https://* ]]; then
  printf 'Public origin and object-store endpoint must use HTTPS.\n' >&2
  exit 1
fi
if [[ "${SKRIBBIL_RANKED_ENABLED:-false}" != false ]]; then
  printf 'This free preview profile requires ranked mode disabled: the engine outbox is ephemeral.\n' >&2
  exit 1
fi

export NODE_ENV=production HOST=0.0.0.0 COOKIE_SECURE=true
export PORT="${PORT:-10000}"
export ENGINE_URL=http://127.0.0.1:8080
export SKRIBBIL_EVENTS_URL="http://127.0.0.1:${PORT}/api/internal/engine-events"
export SKRIBBIL_RANKED_ENABLED=false
export SKRIBBIL_OUTBOX_DIR="${SKRIBBIL_OUTBOX_DIR:-/app/.data/engine-outbox}"

api_pid=''
engine_pid=''
cleanup() {
  trap - EXIT TERM INT
  [[ -z "$api_pid" ]] || kill -TERM "$api_pid" 2>/dev/null || true
  [[ -z "$engine_pid" ]] || kill -TERM "$engine_pid" 2>/dev/null || true
  [[ -z "$api_pid" ]] || wait "$api_pid" 2>/dev/null || true
  [[ -z "$engine_pid" ]] || wait "$engine_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Only the Node process is reachable through Render's public port.
PORT=8080 NETWORK_ADDRESS=127.0.0.1 ROOT_PATH=engine ROOT_URL="$PUBLIC_ORIGIN" \
  CORS_ALLOWED_ORIGINS="$PUBLIC_ORIGIN" /usr/local/bin/skribbil-engine &
engine_pid=$!
node server/index.mjs &
api_pid=$!

# If either process dies, terminate its sibling so Render can restart the unit.
set +e
wait -n "$engine_pid" "$api_pid"
status=$?
set -e
[[ "$status" -ne 0 ]] || status=1
exit "$status"
