import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Dev-only, opt-in escape hatch for local visual/design QA. When launched with
// CREATORS_DEV_NO_AUTH=1, Clerk is swapped for a local mock (src/dev/clerk-mock*)
// so the app renders without a real sign-in. Unset (every build/deploy) this is
// a no-op and the genuine Clerk package is used untouched.
const devNoAuth = process.env.CREATORS_DEV_NO_AUTH === '1';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      // The `/internal` entry MUST precede the base package: Vite matches
      // string aliases by prefix and uses the first hit, so `@clerk/react`
      // listed first would also swallow `@clerk/react/internal`.
      ...(devNoAuth
        ? {
            '@clerk/react/internal': path.resolve(
              import.meta.dirname,
              'src/dev/clerk-mock-internal.ts',
            ),
            '@clerk/react': path.resolve(
              import.meta.dirname,
              'src/dev/clerk-mock.ts',
            ),
          }
        : {}),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Dev-only: mirror the production router, which sends /api and the
    // realtime socket to the API server. The proxy never affects builds.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
      },
      // Socket.IO (blueprint §11): same-origin /socket.io with a websocket
      // upgrade to the API server.
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
