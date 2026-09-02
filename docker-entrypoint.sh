#!/bin/sh
set -e

# Apply any pending database migrations before the server accepts traffic.
# `migrate deploy` only replays committed migrations — it never generates or
# resets anything, so it is safe to run on every start.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "Applying database migrations..."
  node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
