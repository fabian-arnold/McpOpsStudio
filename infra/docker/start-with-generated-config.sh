#!/bin/sh
set -eu

config_file="${MCP_OPS_CONFIG_FILE:-/var/lib/mcpops-config/runtime.env}"
if [ -f "$config_file" ]; then
  set -a
  # The generated file contains only hexadecimal and base64url values.
  . "$config_file"
  set +a
  export DATABASE_URL="postgresql://mcpops:${POSTGRES_PASSWORD}@postgres:5432/mcp_ops_studio?schema=public"
fi

exec "$@"
