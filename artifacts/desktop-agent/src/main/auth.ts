// Browser-based Clerk sign-in for the desktop agent.
//
// Google OAuth (the only sign-in strategy this Clerk instance enables) needs
// the real OS browser: an embedded Electron window can't reliably show Google's
// passkey/WebAuthn UX and split sessions. So instead of opening an in-app
// window, the agent hands the user a link that completes in *their* browser.
//
// The page itself runs on the Nexet web app (creators-den), NOT on a loopback
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
// session JWT that was issued for this web app's origin (its `iss` Frontend
// API, its `azp` authorized party, or the web origin when Clerk is proxied
// through the app's domain) and not yet expired. The token is not tied to the
// agent's own publishable key, because a shipped build's baked-in key can
// legitimately differ from the deployed web app's instance (dev vs. live, or
// a custom Frontend API domain) — the API server verifies the signature.
import { randomBytes } from "node:crypto";
import http from "node:http";

import { clerkAccountsOrigin } from "./clerk-key";

export interface AuthSession {
  token: string;
  userId: string;
  email: string | null;
  /** Display name (e.g. "Ada Lovelace"), handed over by the sign-in page. */
  name: string | null;
  /** Avatar image URL (Clerk-hosted), handed over by the sign-in page. */
  imageUrl: string | null;
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
 * @param webAppUrl      Public origin of the Nexet web app whose /agent-signin
 *   page performs the sign-in. Must be a registered Clerk origin.
 */
export async function beginBrowserSignIn(
  publishableKey: string,
  webAppUrl: string,
): Promise<BrowserSignInAttempt> {
  const origin = clerkAccountsOrigin(publishableKey);
  if (!origin) {
    throw new Error(
      "Invalid Clerk publishable key. Set NEXET_CLERK_PUBLISHABLE_KEY or add it to the agent config.",
    );
  }
  let webOrigin: string;
  try {
    webOrigin = new URL(webAppUrl).origin;
  } catch {
    throw new Error(
      "Invalid web app URL. Set NEXET_WEB_URL to the Nexet web app origin (e.g. https://nexet.co).",
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
        let parsed: { state?: unknown; token?: unknown; name?: unknown; imageUrl?: unknown; email?: unknown };
        try {
          parsed = JSON.parse(body) as {
            state?: unknown;
            token?: unknown;
            name?: unknown;
            imageUrl?: unknown;
            email?: unknown;
          };
        } catch {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid request body." }));
          return;
        }
        const result = completeFromPost(parsed, state, origin, webOrigin);
        if ("error" in result) {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return;
        }
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        settle(result.session);
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
  body: { state?: unknown; token?: unknown; name?: unknown; imageUrl?: unknown; email?: unknown },
  expectedState: string,
  expectedIss: string,
  webOrigin: string,
): { session: AuthSession } | { error: string } {
  if (body.state !== expectedState) {
    return {
      error:
        "This sign-in link was superseded by a newer attempt (or opened from an old tab). " +
        "Start sign-in again from the app.",
    };
  }
  if (typeof body.token !== "string") {
    return { error: "The browser did not return a session token. Start sign-in again from the app." };
  }
  const claims = decodeSessionJwt(body.token, expectedIss, webOrigin);
  if (!claims) {
    return {
      error:
        "The app did not accept this session token — it is not a valid, unexpired Clerk token for " +
        `this sign-in page (${webOrigin}). Start sign-in again from the app.`,
    };
  }
  const name =
    typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim().slice(0, 120) : null;
  const imageUrl =
    typeof body.imageUrl === "string" && /^https?:\/\//.test(body.imageUrl)
      ? body.imageUrl.slice(0, 500)
      : null;
  // The Clerk session JWT carries no email by default, so the sign-in page
  // hands the primary email over explicitly. Claims stay as a fallback for
  // instances that add the email to the session token.
  const bodyEmail =
    typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      ? body.email.trim().slice(0, 320)
      : null;
  const email =
    bodyEmail ??
    (typeof claims.email === "string"
      ? claims.email
      : typeof claims.email_address === "string"
        ? claims.email_address
        : null);
  return {
    session: {
      token: body.token,
      userId: typeof claims.sub === "string" ? claims.sub : "unknown",
      email,
      name,
      imageUrl,
    },
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
  // A Clerk session token always carries the user as `sub` (user_…) and the
  // session as `sid` (sess_…) — cheap proof this is a Clerk token at all.
  if (typeof claims.sub !== "string" || !claims.sub.startsWith("user_")) return null;
  if (typeof claims.sid !== "string" || !claims.sid.startsWith("sess_")) return null;
  const exp = claims.exp;
  if (typeof exp === "number" && exp * 1000 < Date.now()) return null;
  const iss = claims.iss;
  const azp = claims.azp;
  // `iss` is the instance's Frontend API URL; `azp` is the origin the token
  // was minted for. Accept either: the issuer must be a real https origin (so
  // a non-Clerk token can't slip through), and the authorized party must be
  // this sign-in page's origin. The agent's baked-in key is only a hint — a
  // shipped build must not reject the deployment's real instance (live key or
  // custom Frontend API domain) just because its default key differs.
  const issuerMatches = typeof iss === "string" && (iss === expectedIss || iss === webOrigin);
  const partyMatches =
    typeof azp === "string" &&
    azp === webOrigin &&
    typeof iss === "string" &&
    iss.startsWith("https://");
  if (!issuerMatches && !partyMatches) return null;
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