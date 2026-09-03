// Browser-based Clerk sign-in for the desktop agent.
//
// Google OAuth (the only sign-in strategy this Clerk instance enables) needs
// the real OS browser: an embedded Electron window can't reliably show Google's
// passkey/WebAuthn UX and split sessions. So instead of opening an in-app
// window, the agent hands the user a link that completes in *their* browser.
//
// The flow:
//
//  1. The user clicks "Sign up" -> beginBrowserSignIn() starts a tiny
//     http://127.0.0.1 server on a random port and returns a link that
//     carries a random, unguessable per-attempt `state`.
//  2. The user opens that link in their normal browser (click or copy). The
//     page is served by the agent and mounts Clerk's sign-up UI directly from
//     the instance's Frontend API (Clerk no longer serves hosted pages from
//     *.clerk.accounts.dev/sign-up — that URL 404s, so we serve the page).
//  3. After the user completes authentication, the page has a live Clerk
//     session *in that browser*. It posts the session JWT back to the loopback
//     server (same origin) along with the `state`.
//  4. The main process matches `state`, decodes the JWT, and the app is signed
//     in. Each link is tied to exactly one attempt: only the request carrying
//     that attempt's `state` can complete it, and only the first completion
//     wins. The token never travels through any third party.
//
// Security notes: the server binds 127.0.0.1 only; `state` is 32 random bytes;
// the link expires after SIGN_IN_TTL_MS; the reported token must be a Clerk
// session JWT for this instance's Frontend API origin and not yet expired.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { clerkAccountsOrigin } from "./clerk-key";

export interface AuthSession {
  token: string;
  userId: string;
  email: string | null;
}

const SIGN_IN_TTL_MS = 10 * 60 * 1000; // how long a sign-in link stays valid
const MAX_BODY_BYTES = 64 * 1024;

export interface BrowserSignInAttempt {
  /** Link to open in the system browser (http://127.0.0.1:<port>/signin.html?...). */
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
 * the sign-in page, opened in the user's browser, reports the Clerk session
 * back.
 */
export async function beginBrowserSignIn(publishableKey: string): Promise<BrowserSignInAttempt> {
  const origin = clerkAccountsOrigin(publishableKey);
  if (!origin) {
    throw new Error(
      "Invalid Clerk publishable key. Set TANDEM_CLERK_PUBLISHABLE_KEY or add it to the agent config.",
    );
  }

  const state = randomBytes(32).toString("hex");
  const rendererDir = path.join(__dirname, "..", "renderer");

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

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    // The browser page reports the completed sign-in here. Only the attempt
    // that issued `state` may finish, and only once.
    if (req.method === "POST" && url.pathname === "/complete") {
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
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid request body." }));
          return;
        }
        const session = completeFromPost(parsed, state, origin);
        if (!session) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "This sign-in link is no longer valid." }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        settle(session);
      });
      return;
    }

    // Static page files for the sign-in UI.
    const fileName =
      url.pathname === "/signin.js" ? "signin.js" : url.pathname === "/" || url.pathname === "/signin.html" ? "signin.html" : null;
    if (!fileName) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = fs.readFileSync(path.join(rendererDir, fileName));
      res.writeHead(200, {
        "Content-Type": fileName.endsWith(".js") ? "text/javascript" : "text/html",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/signin.html?fapi=${encodeURIComponent(origin)}&publishableKey=${encodeURIComponent(publishableKey)}&state=${state}`,
    done,
    cancel: () => settle(null),
  };
}

/**
 * Validates a /complete POST and turns it into an AuthSession. Rejects wrong
 * states, non-JWT tokens, tokens not issued for this instance's Frontend API,
 * and expired tokens.
 */
function completeFromPost(
  body: { state?: unknown; token?: unknown },
  expectedState: string,
  expectedIss: string,
): AuthSession | null {
  if (body.state !== expectedState || typeof body.token !== "string") return null;
  const claims = decodeSessionJwt(body.token, expectedIss);
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
 * dot-separated parts, issued by this instance's Frontend API origin, and not
 * yet expired. (We can't cryptographically verify the signature without the
 * secret key — the API server rejects bad tokens on the first API call.)
 */
function decodeSessionJwt(token: string, expectedIss: string): Record<string, unknown> | null {
  const claims = decodeJwt(token);
  if (!claims) return null;
  if (claims.iss !== expectedIss) return null;
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
