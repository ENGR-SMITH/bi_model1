// ---------------------------------------------------------------------------
// DEV-ONLY mock of `@clerk/react`.
//
// This module is NOT imported anywhere in the source. It is swapped in for the
// real `@clerk/react` package by a Vite `resolve.alias` that only activates
// when the app is launched with `CREATORS_DEV_NO_AUTH=1` (see vite.config.ts).
// With the flag unset — i.e. every real build/deploy — the genuine Clerk
// package is used and this file is never referenced.
//
// Purpose: render the Creator Den locally for visual/design QA without a live
// Clerk session or the Tandem sign-in wall. It reports a fixed, signed-in dev
// identity so the app boots straight to the room. It is intentionally JSX-free
// so it type-checks as a standalone module regardless of the JSX runtime.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';

// A stable, obviously-fake identity. `id` is what pages compare against
// `project.members[].userId` to resolve the viewer's role; with the real API
// server this will simply not match, leaving the viewer as a non-member.
const DEV_USER = {
  id: 'dev-user',
  firstName: 'Dev',
  lastName: 'Creator',
  fullName: 'Dev Creator',
  username: 'dev',
  imageUrl: '',
  primaryEmailAddress: { emailAddress: 'dev@creators.local' },
  emailAddresses: [{ id: 'dev-email', emailAddress: 'dev@creators.local' }],
};

/** Passthrough provider — renders children, ignores Clerk props. */
export function ClerkProvider(props: { children?: ReactNode }): ReactNode {
  return props.children ?? null;
}

/** Always loaded + signed in; hands out a placeholder session token. */
export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: DEV_USER.id,
    sessionId: 'dev-session',
    orgId: null,
    getToken: async () => 'dev-token',
    signOut: async () => {},
  };
}

/** Fixed dev user for name/avatar/role lookups. */
export function useUser() {
  return { isLoaded: true, isSignedIn: true, user: DEV_USER };
}

/** Only `signOut` is consumed (shell menu); the rest are harmless no-ops. */
export function useClerk() {
  return {
    signOut: async () => {},
    openSignIn: () => {},
    openUserProfile: () => {},
    redirectToSignIn: () => {},
  };
}
