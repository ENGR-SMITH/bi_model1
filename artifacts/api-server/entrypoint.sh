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

# Desktop-agent release feed. The installers are packaged per-OS on GitHub
# runners and published to Cloudflare R2 (see
# .github/workflows/build-desktop-agent.yml), so the image ships no copies.
# When DESKTOP_AGENT_FEED_URL names that public feed base (…/desktop-agent),
# <this origin>/desktop-agent/… redirects there — the same path the agent's
# updateUrl defaults to, so an installed agent updates from the real domain.
# Unset, the path goes to the Node server, which serves a locally built
# dist-bundle when one exists (dev) and a 404 when it does not.
FEED_BASE="${DESKTOP_AGENT_FEED_URL%/}"
if [ -n "$FEED_BASE" ]; then
  printf 'location /desktop-agent/ { rewrite ^/desktop-agent/(.*)$ %s/$1 redirect; }\n' "$FEED_BASE" \
    > /etc/nginx/desktop-agent.conf
else
  printf 'location /desktop-agent/ { proxy_pass http://127.0.0.1:3000; }\n' \
    > /etc/nginx/desktop-agent.conf
fi

PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &

nginx -g 'daemon off;'
