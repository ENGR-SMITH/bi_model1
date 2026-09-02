import { BrowserWindow, session as electronSession } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { clerkAccountsOrigin } from "./clerk-key";

export interface AuthSession {
  token: string;
  userId: string;
  email: string | null;
}

// Clerk session cookie names (v2+ __session, legacy __client, and others)
const CLERK_COOKIE_NAMES = ["__session", "__client"];

/**
 * Opens the Clerk hosted sign-in page in a modal window. On successful sign-in
 * we read the session cookie (Clerk's session JWT) and hand it back as a bearer
 * token for API calls. Resolves null if the user cancels.
 */
export async function signInWithClerk(publishableKey: string): Promise<AuthSession | null> {
  const origin = clerkAccountsOrigin(publishableKey);
  if (!origin) {
    throw new Error(
      "Invalid Clerk publishable key. Set TANDEM_CLERK_PUBLISHABLE_KEY or add it to the agent config.",
    );
  }

  const ses = electronSession.fromPartition("tandem-agent");
  const win = new BrowserWindow({
    width: 520,
    height: 640,
    title: "Sign in to Tandem",
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
    },
    parent: undefined,
    modal: false,
  });

  // Clerk no longer serves hosted pages at *.clerk.accounts.dev/sign-in (that
  // URL returns 404), so we serve our own page over a loopback HTTP server. It
  // mounts Clerk's SignIn component straight from the instance's Frontend API;
  // the __session cookie lands in this session partition and is picked up by
  // the cookie polling below. A real http://127.0.0.1 origin (rather than
  // file://) is required for Clerk's FAPI requests to behave correctly.
  const rendererDir = path.join(__dirname, "..", "renderer");
  const pageServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const fileName = url.pathname === "/signin.js" ? "signin.js" : "signin.html";
    const body = fs.readFileSync(path.join(rendererDir, fileName));
    res.writeHead(200, {
      "Content-Type": fileName.endsWith(".js") ? "text/javascript" : "text/html",
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  const port = (pageServer.address() as { port: number }).port;
  win.on("closed", () => pageServer.close());
  await win.loadURL(
    `http://127.0.0.1:${port}/signin.html?fapi=${encodeURIComponent(origin)}&publishableKey=${encodeURIComponent(publishableKey)}`,
  );

  return new Promise<AuthSession | null>((resolve) => {
    let closed = false;
    let pollCount = 0;
    const MAX_POLL_COUNT = 120; // ~2 minutes at 1 s interval

    const finish = (value: AuthSession | null) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    /** Try every known Clerk cookie; return true once a valid session is found. */
    const tryReadSession = async (): Promise<boolean> => {
      try {
        for (const cookieName of CLERK_COOKIE_NAMES) {
          const cookies = await ses.cookies.get({ name: cookieName });
          const cookie = cookies.find((c) => c.value && c.value.length > 20);
          if (cookie) {
            const claims = decodeJwt(cookie.value);
            if (claims) {
              finish({
                token: cookie.value,
                userId: typeof claims.sub === "string" ? claims.sub : "unknown",
                email:
                  typeof claims.email === "string"
                    ? claims.email
                    : typeof claims.email_address === "string"
                      ? claims.email_address
                      : null,
              });
              return true;
            }
          }
        }
      } catch {
        // keep polling
      }
      return false;
    };

    const poll = setInterval(async () => {
      pollCount++;
      if (pollCount >= MAX_POLL_COUNT) {
        finish(null);
        return;
      }
      await tryReadSession();
    }, 1000);

    // Watch all navigation events — after Clerk sign-in the browser redirects
    // through several hops before landing on the redirect_url.
    const onWillNavigate = (_e: unknown, _url: string) => {
      void tryReadSession();
    };
    const onDidNavigate = (_e: unknown, _url: string) => {
      void tryReadSession();
    };

    const onClosed = () => {
      clearInterval(poll);
      finish(null);
    };

    const cleanup = () => {
      clearInterval(poll);
      win.webContents.removeListener("will-navigate", onWillNavigate as never);
      win.webContents.removeListener("did-navigate", onDidNavigate as never);
      win.removeListener("closed", onClosed);
    };

    win.webContents.on("will-navigate", onWillNavigate);
    win.webContents.on("did-navigate", onDidNavigate as never);
    win.on("closed", onClosed);
    void tryReadSession();
  });
}

/**
 * Clears all Clerk session cookies so the next sign-in shows the login form
 * instead of auto-authenticating.
 */
export async function clearClerkSession(): Promise<void> {
  const ses = electronSession.fromPartition("tandem-agent");
  try {
    const cookies = await ses.cookies.get({});
    for (const cookie of cookies) {
      if (CLERK_COOKIE_NAMES.includes(cookie.name)) {
        // Construct the cookie URL from domain + path
        const protocol = cookie.secure ? "https:" : "http:";
        const cookieUrl = `${protocol}//${cookie.domain}${cookie.path}`;
        await ses.cookies.remove(cookieUrl, cookie.name);
      }
    }
  } catch {
    // best-effort cleanup
  }
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