#!/bin/sh
set -eu

if [ "${POSTGRES_USER}" = "${MCP_OPS_DB_USER}" ]; then
  echo >&2 "MCP_OPS_DB_USER must differ from the PostgreSQL bootstrap user."
  exit 1
fi

psql \
  --set=ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set=app_user="${MCP_OPS_DB_USER}" \
  --set=app_password="${MCP_OPS_DB_PASSWORD}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the application login only when it does not already exist. The ALTER
-- below is intentionally repeated so credential changes apply on a fresh
-- initialization without ever attempting to demote PostgreSQL's bootstrap role.
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'app_user'
)
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_user',
  :'app_password'
)
\gexec

SELECT format(
  -- Prisma's baseline migration contains CREATE SCHEMA IF NOT EXISTS public.
  -- PostgreSQL checks database CREATE privilege even when the schema exists.
  'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO %I',
  current_database(),
  :'app_user'
)
\gexec

SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec
SQL
