#!/bin/sh
# Starts the Node API on 127.0.0.1:3000 and nginx (the router) in the
# foreground. PORT=3000 is explicit: Render injects PORT=10000 by default and
# the service env overrides it to 8080 for nginx — the Node server must stay
# on 3000 so nginx can proxy to it inside the container.
#
# The bundle lives at artifacts/api-server/dist/index.mjs (esbuild writes
# into the package dir, and pnpm runs the build with that package as cwd) —
# hence the ./artifacts/... path from /app.
set -e

PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &

nginx -g 'daemon off;'