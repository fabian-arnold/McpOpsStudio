#!/bin/sh
set -eu

shutdown() {
  trap - TERM INT EXIT
  kill "${web_pid:-}" "${api_pid:-}" "${caddy_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap shutdown TERM INT EXIT

if [ "${MCP_OPS_WATCH_MODE:-false}" = "true" ]; then
  pnpm --filter @mcpops/api dev &
  api_pid=$!
  pnpm --filter @mcpops/web dev &
  web_pid=$!
else
  pnpm --filter @mcpops/api start &
  api_pid=$!
  pnpm --filter @mcpops/web start &
  web_pid=$!
fi

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

set +e
wait -n "$api_pid" "$web_pid" "$caddy_pid"
status=$?
set -e
exit "$status"
