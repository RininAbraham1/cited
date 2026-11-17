#!/usr/bin/env bash
# Offline end-to-end check of Cited's server rules and UI.
#
# Runs the REAL worker (actions, RecordRoom RBAC, JobRoom generation job,
# PresenceRoom) under `wrangler dev`, with two stand-ins:
#   - mock-api.mjs plays the DeepSpace auth + api workers: it signs JWTs with a
#     throwaway key and returns canned Wikipedia/Claude/ElevenLabs responses
#     (including one hallucinated quote that the grounding check must reject).
#   - a placeholder app id, in a temp COPY of the app, because builds refuse
#     an unregistered id and this repo must keep `__APP_ID__` until a real
#     `deepspace deploy` registers it.
#
# Usage: npm install, then  bash e2e-local/run.sh
# (ui.mjs needs a Chromium: `npx playwright install chromium`, or set PW_CHROMIUM_PATH.)
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PIDS=()
cleanup() {
  # SHOTS_OUT=<dir> keeps the screenshots after the temp dir is removed.
  if [ -n "${SHOTS_OUT:-}" ] && [ -d "$WORK/shots" ]; then mkdir -p "$SHOTS_OUT" && cp "$WORK"/shots/*.png "$SHOTS_OUT"/ 2>/dev/null || true; fi
  # Each server runs in its own process group (setsid), so this also stops
  # wrangler's workerd children and nothing outlives the run.
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

for port in 8787 8799; do
  if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
    echo "Port $port is already in use (a previous run?). Stop it first." >&2; exit 1
  fi
done

mkdir -p "$WORK/app" "$WORK/harness" "$WORK/shots"
(cd "$APP" && tar --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude=e2e-local -cf - .) | tar -xf - -C "$WORK/app"
ln -s "$APP/node_modules" "$WORK/app/node_modules"
cp "$APP"/e2e-local/*.mjs "$WORK/harness/"
sed -i.bak 's/__APP_ID__/app_00000000000000000000000000/' "$WORK/app/wrangler.toml"
echo "app:app_00000000000000000000000000" > "$WORK/harness/scope.txt"

node "$WORK/harness/keys.mjs" "$WORK/harness"
PUB=$(awk 'BEGIN{ORS="\\n"}{print}' "$WORK/harness/pub.pem")
cat > "$WORK/app/.dev.vars" <<VARS
AUTH_JWT_PUBLIC_KEY="$PUB"
AUTH_JWT_ISSUER="local-test"
AUTH_WORKER_URL="http://127.0.0.1:8799"
API_WORKER_URL="http://127.0.0.1:8799"
PLATFORM_WORKER_URL="http://127.0.0.1:8799"
OWNER_USER_ID="user_owner"
APP_OWNER_JWT="owner-jwt-placeholder"
VARS

(cd "$WORK/app" && npx vite build > "$WORK/build.log" 2>&1)
(cd "$WORK/harness" && exec setsid node mock-api.mjs > "$WORK/mock.log" 2>&1) & PIDS+=($!)
(cd "$WORK/app" && exec setsid npx wrangler dev --port 8787 --ip 127.0.0.1 --show-interactive-dev-session=false > "$WORK/wrangler.log" 2>&1) & PIDS+=($!)
for _ in $(seq 1 60); do grep -q "Ready on" "$WORK/wrangler.log" 2>/dev/null && break; sleep 1; done

echo "== server rules (e2e.mjs)"
(cd "$WORK/harness" && node e2e.mjs)
echo "== three-browser UI walkthrough (ui.mjs)"
(cd "$WORK/harness" && NODE_PATH="$APP/node_modules" node ui.mjs "$WORK/shots")
mkdir -p "$APP/e2e-local/shots" && cp "$WORK"/shots/*.png "$APP/e2e-local/shots/"
echo "Screenshots: e2e-local/shots/"
