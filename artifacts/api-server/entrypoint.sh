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
# <this origin>/desktop-agent/… redirects to that public feed base — the same
# path the agent's updateUrl defaults to, so an installed agent updates from
# the real domain.
#
# The bucket URL is the built-in default rather than a required env var: it is
# already public (every browser gets it in the web bundle as
# VITE_AGENT_DOWNLOAD_URL), and requiring DESKTOP_AGENT_FEED_URL meant that
# forgetting to set it silently broke auto-update — /desktop-agent/latest.yml
# answered 404 from Node instead of serving the feed. Set the env var to point
# at a different bucket or a custom domain; set it to EMPTY to disable the
# route and fall back to Node (which serves a local dist-bundle in dev).
DEFAULT_FEED_BASE="https://pub-e9bda4f9b07948ada5b92488c8500adc.r2.dev/desktop-agent"
FEED_BASE="${DESKTOP_AGENT_FEED_URL-$DEFAULT_FEED_BASE}"
FEED_BASE="${FEED_BASE%/}"
if [ -n "$FEED_BASE" ]; then
  printf 'location /desktop-agent/ { rewrite ^/desktop-agent/(.*)$ %s/$1 redirect; }\n' "$FEED_BASE" \
    > /etc/nginx/desktop-agent.conf
else
  printf 'location /desktop-agent/ { proxy_pass http://127.0.0.1:3000; }\n' \
    > /etc/nginx/desktop-agent.conf
fi

PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &

nginx -g 'daemon off;'
