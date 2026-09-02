// Hosted sign-in page for the agent. Clerk no longer serves sign-in pages from
// *.clerk.accounts.dev/sign-in (that URL 404s), so this page loads Clerk's own
// JS bundle straight from the instance's Frontend API and mounts the SignIn
// component. On success Clerk sets the `__session` cookie in this window's
// session partition, which the main process picks up to finish the sign-in.
//
// NOTE: keep this file free of import/export. It's loaded as a plain <script>
// tag (no bundler), so module syntax would make tsc emit a CommonJS wrapper
// that crashes the page — `exports` is undefined in the browser.
//
// The main process passes `?fapi=<origin>&publishableKey=<key>` via loadFile.

const signinParams = new URLSearchParams(location.search);
const signinFapi = signinParams.get("fapi") ?? "";
const signinPublishableKey = signinParams.get("publishableKey") ?? "";

function showSigninError(message: string): void {
  const state = document.getElementById("signin-state");
  if (state) {
    state.className = "err";
    state.innerHTML = "";
    state.textContent = message;
  }
}

if (!signinFapi || !signinPublishableKey) {
  showSigninError("Sign-in page was opened without configuration.");
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
        const mountable = loadedClerk as {
          mountSignIn?: (node: HTMLElement | null, props?: object) => void;
        };
        if (!root || typeof mountable.mountSignIn !== "function") {
          showSigninError("The sign-in component failed to initialise.");
          return;
        }
        document.getElementById("signin-state")?.remove();
        mountable.mountSignIn(root);
      })
      .catch(() => {
        showSigninError("Could not start sign-in. Please try again.");
      });
  };
  document.head.appendChild(clerkScript);
}