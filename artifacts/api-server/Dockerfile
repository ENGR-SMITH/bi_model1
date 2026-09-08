# One-container production image: nginx (serves the 4 SPAs + routes /api and
# /socket.io) + the Node API server, under one origin. Deploy target: Render
# Web Service (Docker). See DEPLOYMENT.md §3/§4/§7.
FROM node:24-bookworm-slim

# ffmpeg/ffprobe are required for real video proxies/renders/audio/exports.
# nginx serves the four built SPAs and proxies /api + /socket.io to Node.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nginx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin pnpm explicitly — the root package.json has no "packageManager" field,
# so `corepack enable` alone would not guarantee the pnpm 10 used by CI.
RUN npm install -g pnpm@10

ENV NODE_ENV=production

# Public Clerk keys, baked into the four SPA builds at build time. Render
# auto-translates service env vars into Docker build args (see Render's Docker
# docs), so setting VITE_CLERK_PUBLISHABLE_KEY and CLERK_PUBLISHABLE_KEY on the
# service is enough. Never pass secret keys as build args — they would be baked
# into the image; secret keys only need to exist at runtime.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY

# Fail fast: a build without Clerk keys produces apps that cannot sign in.
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && test -n "$CLERK_PUBLISHABLE_KEY" \
    || { echo "ERROR: VITE_CLERK_PUBLISHABLE_KEY and CLERK_PUBLISHABLE_KEY build args are required" >&2; exit 1; }

# Full repo context (see .dockerignore — node_modules/.git/.env excluded).
COPY . .

# Workspace-aware install; the whole workspace matches the frozen lockfile.
RUN pnpm install --frozen-lockfile

# Build the API bundle (dist/index.mjs + dist/workers/*).
RUN pnpm --filter @workspace/api-server run build

# Build the four SPAs with their base paths baked in. PORT + BASE_PATH are
# required by each Vite config; the Clerk keys come from the ARG/ENV above.
RUN PORT=3001 BASE_PATH=/               pnpm --filter @workspace/tandem build \
 && PORT=3002 BASE_PATH=/authors-den/   pnpm --filter @workspace/authors-den build \
 && PORT=3003 BASE_PATH=/creators-den/  pnpm --filter @workspace/creators-den build \
 && PORT=3004 BASE_PATH=/oracle-admin/  pnpm --filter @workspace/oracle-admin build

# Ship the built SPAs into the nginx docroots.
RUN mkdir -p /srv/tandem/root /srv/tandem/authors-den /srv/tandem/creators-den /srv/tandem/oracle-admin \
 && cp -r artifacts/tandem/dist/public/.        /srv/tandem/root/ \
 && cp -r artifacts/authors-den/dist/public/.   /srv/tandem/authors-den/ \
 && cp -r artifacts/creators-den/dist/public/.  /srv/tandem/creators-den/ \
 && cp -r artifacts/oracle-admin/dist/public/.  /srv/tandem/oracle-admin/

COPY artifacts/api-server/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/api-server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
CMD ["/entrypoint.sh"]