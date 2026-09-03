// Browser sign-in page for the desktop agent.
//
// The main process serves this page on a loopback http://127.0.0.1 URL and the
// user opens it in their normal system browser (click "Open in browser" or
// copy the link from the app). Clerk no longer serves hosted sign-in pages
// from *.clerk.accounts.dev/sign-up (that URL 404s), so this page mounts
// Clerk's own JS bundle straight from the instance's Frontend API.
//
// There is no Electron session to poll cookies from — the Clerk session is
// created in *this browser's* cookie jar. So once authentication completes the
// page has a live Clerk session, and it posts the session JWT back to the
// loopback server (same origin) together with the per-attempt `state` that the
// app put in the link. The main process matches the state and finishes the
// sign-in, which is what "redirects" the user back into the desktop app.
//
// NOTE: keep this file free of import/export. It's loaded as a plain <script>
// tag (no bundler), so module syntax would make tsc emit a CommonJS wrapper
// that crashes the page — `exports` is undefined in the browser.
//
// The main process passes ?fapi=<origin>&publishableKey=<key>&state=<state>.

const signinParams = new URLSearchParams(location.search);
const signinFapi = signinParams.get("fapi") ?? "";
const signinPublishableKey = signinParams.get("publishableKey") ?? "";
const signinState = signinParams.get("state") ?? "";

const POLL_MS = 800;
// ~10 minutes of polling, matching the main-process link TTL.
const MAX_POLLS = 750;
const MAX_NETWORK_FAILS = 5;

let signedInUi = false;

interface ClerkSessionLike {
  getToken: () => Promise<string | null>;
}
interface ClerkLike {
  session: ClerkSessionLike | null;
  client: { sessions: ClerkSessionLike[] } | null;
  mountSignUp?: (node: HTMLElement | null, props?: Record<string, unknown>) => void;
}

function showSignedIn(): void {
  if (signedInUi) return;
  signedInUi = true;
  document.getElementById("signin-root")?.classList.add("hidden");
  document.getElementById("signedin")?.classList.remove("hidden");
}

function showSigninError(message: string): void {
  const state = document.getElementById("signin-state");
  if (state) {
    state.className = "err";
    state.innerHTML = "";
    state.textContent = message;
  }
}

/**
 * Watches for a live Clerk session and reports it to the app's loopback
 * server. Runs until the app confirms (success panel), the link turns out to
 * be dead, or the poll budget runs out.
 */
function startCompletionWatch(clerk: ClerkLike): void {
  let polls = 0;
  let networkFails = 0;

  const tick = async (): Promise<void> => {
    if (signedInUi) return;

    const session =
      clerk.session ?? (clerk.client?.sessions && clerk.client.sessions.length > 0 ? clerk.client.sessions[0] : null);

    if (session) {
      let token: string | null = null;
      try {
        token = await session.getToken();
      } catch {
        token = null;
      }
      if (token) {
        try {
          const res = await fetch(`${location.origin}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: signinState, token }),
          });
          if (res.ok) {
            showSignedIn();
            return;
          }
          // The app answered, but rejected the link (already used/expired).
          showSigninError(
            "This sign-in link was already used or is no longer valid. Close this tab and click Sign up again in Tandem Desktop Agent.",
          );
          return;
        } catch {
          // Network error — the loopback server may have closed between polls.
          networkFails += 1;
          if (networkFails >= MAX_NETWORK_FAILS) {
            showSigninError(
              "This sign-in link is no longer active. Close this tab and click Sign up again in Tandem Desktop Agent.",
            );
            return;
          }
        }
      }
    }

    polls += 1;
    if (polls >= MAX_POLLS) {
      showSigninError(
        "This sign-in link expired. Close this tab and click Sign up again in Tandem Desktop Agent.",
      );
      return;
    }
    setTimeout(() => void tick(), POLL_MS);
  };

  setTimeout(() => void tick(), POLL_MS);
}

if (!signinFapi || !signinPublishableKey || !signinState) {
  showSigninError("The sign-in page was opened without configuration. Close this tab and try again from the app.");
} else {
  const clerkScript = document.createElement("script");
  clerkScript.src = `${signinFapi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
  clerkScript.onerror = () => {
    showSigninError("Failed to load the sign-in component. Check your internet connection and try again.");
  };
  clerkScript.onload = () => {
    const clerkApi = (window as { Clerk?: unknown }).Clerk as
      | { load: (opts: { publishableKey: string }) => Promise<unknown> }
      | undefined;
    if (!clerkApi) {
      showSigninError("The sign-in component failed to initialise.");
      return;
    }
    clerkApi
      .load({ publishableKey: signinPublishableKey })
      .then((loadedClerk) => {
        const root = document.getElementById("signin-root");
        const clerk = loadedClerk as ClerkLike;
        if (!root || typeof clerk.mountSignUp !== "function") {
          showSigninError("The sign-in component failed to initialise.");
          return;
        }
        document.getElementById("signin-state")?.remove();
        clerk.mountSignUp(root);
        startCompletionWatch(clerk);
      })
      .catch(() => {
        showSigninError("Could not start sign-in. Please try again.");
      });
  };
  document.head.appendChild(clerkScript);
}
