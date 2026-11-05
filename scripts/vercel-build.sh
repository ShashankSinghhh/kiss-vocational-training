#!/bin/sh
# Vercel build (vercel.json → buildCommand). Runs from the repo root after `pnpm install`.
set -eu

# Production only: apply pending migrations first, so new code never runs on an old schema.
# Migrations need the direct (non-pooled) Neon URL. Preview builds never touch the database.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    echo "DIRECT_DATABASE_URL must be set for production builds (docs/internal/DEPLOYMENT.md)" >&2
    exit 1
  fi
  DATABASE_URL="$DIRECT_DATABASE_URL" pnpm --filter @vtmp/api db:deploy
fi

pnpm --filter @vtmp/api build
pnpm --filter @vtmp/web build
