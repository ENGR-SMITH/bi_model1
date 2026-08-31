import { BrowserWindow, session as electronSession } from "electron";
import { clerkAccountsOrigin } from "./clerk-key";

export interface AuthSession {
  token: string;
  userId: string;
  email: string | null;
}

/**
 * Opens the Clerk hosted sign-in page in a modal window. On successful sign-in
 * we read the `__session` cookie (Clerk's session JWT, short-lived) and hand it
 * back as a bearer token for API calls. Resolves null if the user cancels.
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

  const signInUrl = `${origin}/sign-in?redirect_url=${encodeURIComponent(origin)}`;
  await win.loadURL(signInUrl);

  return new Promise<AuthSession | null>((resolve) => {
    let closed = false;
    const finish = (value: AuthSession | null) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    const tryReadSession = async (): Promise<void> => {
      try {
        const cookies = await ses.cookies.get({ name: "__session" });
        const cookie = cookies[0];
        if (cookie && cookie.value && cookie.value.length > 10) {
          const claims = decodeJwt(cookie.value);
          finish({
            token: cookie.value,
            userId: typeof claims?.sub === "string" ? claims.sub : "unknown",
            email: typeof claims?.email === "string" ? claims.email : null,
          });
        }
      } catch {
        // keep polling
      }
    };

    const poll = setInterval(() => void tryReadSession(), 1200);

    const handle = (_e: unknown, url: string) => {
      // Signed-in redirects land back on the Clerk accounts origin; pick the
      // session up as soon as the cookie is present.
      void tryReadSession();
      if (url.startsWith(origin) && url.includes("sign-in")) {
        void tryReadSession();
      }
    };

    const onClosed = () => {
      clearInterval(poll);
      finish(null);
    };

    const cleanup = () => {
      clearInterval(poll);
      win.webContents.removeListener("will-navigate", handle as never);
      win.removeListener("closed", onClosed);
    };

    // The token is set as a cookie on a Clerk-managed subdomain; watch all
    // navigation so we catch the moment it appears.
    win.webContents.on("will-navigate", handle);
    win.on("closed", onClosed);
    void tryReadSession();
  });
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