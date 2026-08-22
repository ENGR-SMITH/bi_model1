// ---------------------------------------------------------------------------
// DEV-ONLY mock of `@clerk/react/internal`.
//
// Companion to ./clerk-mock.ts — aliased in only when the app is launched with
// `CREATORS_DEV_NO_AUTH=1` (see vite.config.ts). `main.tsx` calls
// `publishableKeyFromHost` to derive the Clerk publishable key; the mock just
// returns a placeholder, since the mocked ClerkProvider ignores it.
// ---------------------------------------------------------------------------

/** Returns a placeholder publishable key; the mocked provider ignores it. */
export function publishableKeyFromHost(
  _hostname?: string,
  _fallback?: string,
): string {
  return 'pk_test_creators_den_dev';
}
