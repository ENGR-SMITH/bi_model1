// Browser-based Clerk sign-in for the desktop agent.
//
// Google OAuth (the only sign-in strategy this Clerk instance enables) needs
// the real OS browser: an embedded Electron window can't reliably show Google's
// passkey/WebAuthn UX and split sessions. So instead of opening an in-app
// window, the agent hands the user a link that completes in *their* browser.
//
// The page itself runs on the Tandem web app (creators-den), NOT on a loopback
// server. That's a hard Clerk constraint: Clerk only initialises its JS from
// origins registered on the instance (the web app's domain), so a page served
// from a random http://127.0.0.1:<port> origin fails with "the sign-in
// component failed to initialise". Hosting the page on the web app keeps the
// sign-in on a trusted origin while the token still lands locally.
//
// The flow:
//
//  1. The user clicks "Sign up" -> beginBrowserSignIn() starts a tiny
//     http://127.0.0.1 loopback server on a random port (the token receiver)
//     and returns a link to the web app's hosted /agent-signin page carrying a
//     random, unguessable per-attempt `state` plus the loopback address.
//  2. The user opens that link in their normal browser (click or copy). The
//     web app mounts Clerk's sign-in UI (its domain is registered with Clerk)
//     and after the user completes authentication it has a live Clerk session
//     *in that browser*.
//  3. The web app page posts the session JWT back to the loopback server
//     (cross-origin, so the server answers with CORS headers) along with the
//     `state`.
//  4. The main process matches `state`, decodes the JWT, and the app is signed
//     in. Each link is tied to exactly one attempt: only the request carrying
//     that attempt's `state` can complete it, and only the first completion
//     wins. The token never travels through any third party.
//
// Security notes: the server binds 127.0.0.1 only; `state` is 32 random bytes;
// the link expires after SIGN_IN_TTL_MS; the reported token must be a Clerk
// session JWT for this instance's Frontend API origin (or the web app origin
// when Clerk is proxied through the app's domain) and not yet expired.
import { randomBytes } from "node:crypto";
import http from "node:http";

import { clerkAccountsOrigin } from "./clerk-key";

export interface AuthSession {
  token: string;
  userId: string;
  email: string | null;
}

const SIGN_IN_TTL_MS = 10 * 60 * 1000; // how long a sign-in link stays valid
const MAX_BODY_BYTES = 64 * 1024;

export interface BrowserSignInAttempt {
  /** Link to open in the system browser (the web app's hosted sign-in page). */
  url: string;
  /**
   * Resolves with the session once the browser page reports a completed Clerk
   * sign-in, or null if the attempt is cancelled or expires first.
   */
  done: Promise<AuthSession | null>;
  /** Abort the attempt (closes the loopback server; any open link stops working). */
  cancel: () => void;
}

/**
 * Starts a browser sign-in attempt. Resolves (via the returned `done`) when
 * the hosted sign-in page, opened in the user's browser, reports the Clerk
 * session back.
 *
 * @param publishableKey Clerk publishable key, used to derive the expected JWT
 *   issuer (the instance's Frontend API origin).
 * @param webAppUrl      Public origin of the Tandem web app whose /agent-signin
 *   page performs the sign-in. Must be a registered Clerk origin.
 */
export async function beginBrowserSignIn(
  publishableKey: string,
  webAppUrl: string,
): Promise<BrowserSignInAttempt> {
  const origin = clerkAccountsOrigin(publishableKey);
  if (!origin) {
    throw new Error(
      "Invalid Clerk publishable key. Set TANDEM_CLERK_PUBLISHABLE_KEY or add it to the agent config.",
    );
  }
  let webOrigin: string;
  try {
    webOrigin = new URL(webAppUrl).origin;
  } catch {
    throw new Error(
      "Invalid web app URL. Set TANDEM_WEB_URL to the Tandem web app origin (e.g. https://app.example.com).",
    );
  }

  const state = randomBytes(32).toString("hex");

  let settleFn: (session: AuthSession | null) => void = () => {};
  const done = new Promise<AuthSession | null>((resolve) => {
    settleFn = resolve;
  });

  let settled = false;
  let server: http.Server | null = null;

  const settle = (session: AuthSession | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(ttlTimer);
    if (server) server.close();
    settleFn(session);
  };

  const ttlTimer = setTimeout(() => settle(null), SIGN_IN_TTL_MS);

  // CORS headers let the hosted web page (a different origin) POST the session
  // JWT to this loopback receiver. Access-Control-Allow-Private-Network is
  // required by Chrome's Private Network Access for requests from a public
  // HTTPS page to a loopback address (the production web app -> 127.0.0.1).
  const corsHeaders = {
    "Access-Control-Allow-Origin": webOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };

  server = http.createServer((req, res) => {
    // The browser page reports the completed sign-in here. Only the attempt
    // that issued `state` may finish, and only once. The page is cross-origin
    // (the web app's domain), so answer the CORS preflight first.
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === "POST" && (req.url ?? "/").split("?")[0] === "/complete") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) req.destroy();
      });
      req.on("end", () => {
        let parsed: { state?: unknown; token?: unknown };
        try {
          parsed = JSON.parse(body) as { state?: unknown; token?: unknown };
        } catch {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid request body." }));
          return;
        }
        const session = completeFromPost(parsed, state, origin, webOrigin);
        if (!session) {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "This sign-in link is no longer valid." }));
          return;
        }
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        settle(session);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `${webOrigin}/creators-den/agent-signin?state=${encodeURIComponent(state)}&loopback=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
    done,
    cancel: () => settle(null),
  };
}

/**
 * Validates a /complete POST and turns it into an AuthSession. Rejects wrong
 * states, non-JWT tokens, tokens not issued for this instance's Frontend API
 * (or the web app origin when Clerk runs behind the app's proxy), and expired
 * tokens.
 */
function completeFromPost(
  body: { state?: unknown; token?: unknown },
  expectedState: string,
  expectedIss: string,
  webOrigin: string,
): AuthSession | null {
  if (body.state !== expectedState || typeof body.token !== "string") return null;
  const claims = decodeSessionJwt(body.token, expectedIss, webOrigin);
  if (!claims) return null;
  return {
    token: body.token,
    userId: typeof claims.sub === "string" ? claims.sub : "unknown",
    email:
      typeof claims.email === "string"
        ? claims.email
        : typeof claims.email_address === "string"
          ? claims.email_address
          : null,
  };
}

/**
 * Decodes a Clerk session JWT and sanity-checks it: it must be three
 * dot-separated parts, issued by this instance's Frontend API origin (or the
 * web app origin when Clerk is proxied through the app's domain), and not yet
 * expired. (We can't cryptographically verify the signature without the secret
 * key — the API server rejects bad tokens on the first API call.)
 */
function decodeSessionJwt(
  token: string,
  expectedIss: string,
  webOrigin: string,
): Record<string, unknown> | null {
  const claims = decodeJwt(token);
  if (!claims) return null;
  const iss = claims.iss;
  if (typeof iss !== "string") return null;
  // The web app may serve Clerk through its own domain (CLERK_PROXY_PATH),
  // which makes Clerk issue tokens with iss = the proxied origin.
  if (iss !== expectedIss && iss !== webOrigin) return null;
  const exp = claims.exp;
  if (typeof exp === "number" && exp * 1000 < Date.now()) return null;
  return claims;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}