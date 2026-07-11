#!/bin/sh
set -eu

shutdown() {
  trap - TERM INT EXIT
  kill "${runtime_pid:-}" "${builder_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap shutdown TERM INT EXIT

if [ "${MCP_OPS_WATCH_MODE:-false}" = "true" ]; then
  pnpm --filter @mcpops/runtime dev &
  runtime_pid=$!
  pnpm --filter @mcpops/worker dev &
  builder_pid=$!
else
  pnpm --filter @mcpops/runtime start &
  runtime_pid=$!
  pnpm --filter @mcpops/worker start &
  builder_pid=$!
fi

set +e
wait -n "$runtime_pid" "$builder_pid"
status=$?
set -e
exit "$status"
