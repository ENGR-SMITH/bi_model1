// Hosted sign-in page for the desktop agent (device flow).
//
// The desktop agent opens this page (on the Tandem web app's domain — the
// origin Clerk trusts) in the user's normal browser. The page mounts Clerk's
// standard <SignIn /> UI; once a session exists it hands the session JWT back
// to the agent's loopback token receiver, which matches the per-attempt
// `state` and finishes the desktop sign-in.
//
// URL shape (built by the desktop agent):
//   /creators-den/agent-signin?state=<hex>&loopback=http://127.0.0.1:<port>
//
// The Google OAuth round-trip does a full page load, so the attempt params are
// stashed in sessionStorage as well as read from the URL — that way they
// survive Clerk's own query-param juggling during the flow.
import { useEffect, useMemo, useState } from 'react';
import { SignIn, useAuth, useUser } from '@clerk/react';

const ATTEMPT_KEY = 'tandem-agent-signin-attempt';

type Phase = 'loading' | 'signin' | 'posting' | 'success' | 'error';

interface Attempt {
  state: string;
  loopback: string;
}

/** Raise the desktop agent app on this machine after sign-in completes.
 * The agent registers the `tandem-agent://` scheme at install, so opening it
 * hands control straight back to the app (and focuses its window). A hidden
 * iframe keeps this sign-in tab in place; on browsers that block iframe
 * protocol navigation it falls back to a background tab. No-op when the app
 * isn't installed. */
function summonDesktopApp(): void {
  const url = 'tandem-agent://launch';
  try {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 1500);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function readAttempt(): Attempt | null {
  const url = new URLSearchParams(window.location.search);
  const state = url.get('state') ?? '';
  const loopback = url.get('loopback') ?? '';
  if (state && loopback) {
    const attempt = { state, loopback };
    try {
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    } catch {
      // private mode etc. — the URL params are still usable this session
    }
    return attempt;
  }
  try {
    const saved = sessionStorage.getItem(ATTEMPT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Attempt;
      if (parsed.state && parsed.loopback) return parsed;
    }
  } catch {
    // fall through to error state
  }
  return null;
}

export default function AgentSignInPage() {
  const attempt = useMemo(readAttempt, []);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!attempt) {
      setPhase('error');
      setError(
        'This sign-in link is incomplete or expired. Close this tab and click “Sign up” again in Tandem Desktop Agent.',
      );
    } else if (isLoaded && isSignedIn) {
      setPhase('posting');
    } else if (isLoaded) {
      setPhase('signin');
    }
  }, [attempt, isLoaded, isSignedIn]);

  // Once a Clerk session exists in this browser, post the session JWT to the
  // desktop agent's loopback receiver and wait for its acknowledgement.
  useEffect(() => {
    if (phase !== 'posting' || !attempt) return;
    let cancelled = false;

    (async () => {
      // The token can lag the signed-in state by a moment after sign-in.
      let token: string | null = null;
      for (let i = 0; i < 20 && !cancelled; i++) {
        token = await getToken();
        if (token) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (cancelled) return;
      if (!token) {
        setPhase('error');
        setError('Could not read your session token. Close this tab and try again from the app.');
        return;
      }
      try {
        // The desktop agent has no access to Clerk's user API, so it takes the
        // display profile (name + avatar) from here — the page that owns the
        // session — and shows it in the app's account card.
        const fullName = [user?.firstName ?? '', user?.lastName ?? ''].filter(Boolean).join(' ').trim();
        const res = await fetch(`${attempt.loopback}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: attempt.state,
            token,
            name: fullName || null,
            imageUrl: user?.imageUrl || null,
          }),
        });
        if (cancelled) return;
        if (res.ok) {
          setPhase('success');
          // Sign-in finished — bring the user straight back to the desktop
          // app instead of leaving them stranded on this tab.
          summonDesktopApp();
        } else {
          setPhase('error');
          setError(
            'The desktop app did not accept this sign-in (the link may have expired). ' +
              'Close this tab and click “Sign up” again in Tandem Desktop Agent.',
          );
        }
      } catch {
        if (cancelled) return;
        setPhase('error');
        setError(
          'Could not reach Tandem Desktop Agent. Is the app still running? Close this tab and try again.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, attempt, getToken, user?.firstName, user?.lastName, user?.imageUrl]);

  return (
    <div className="agent-signin-page">
      <div className="agent-signin-brand">
        <span className="agent-signin-mark">T</span>
        <span className="agent-signin-name">Tandem Desktop Agent</span>
      </div>

      <div className="agent-signin-card">
        {phase === 'loading' && (
          <div className="agent-signin-state">
            <span className="agent-signin-spinner" />
            <p>Loading sign-in…</p>
          </div>
        )}

        {phase === 'signin' && (
          <div className="agent-signin-state">
            <p className="agent-signin-hint">Sign in with your Tandem account to continue in the app.</p>
            <SignIn />
          </div>
        )}

        {phase === 'posting' && (
          <div className="agent-signin-state">
            <span className="agent-signin-spinner" />
            <p>Confirming your sign-in with the desktop app…</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="agent-signin-state">
            <div className="agent-signin-check">✓</div>
            <h2>You're signed in</h2>
            <p>Opening Tandem Desktop Agent… if it doesn't appear, click its icon (or relaunch it) — you can close this tab.</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="agent-signin-state agent-signin-error">
            <h2>Sign-in didn't complete</h2>
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}