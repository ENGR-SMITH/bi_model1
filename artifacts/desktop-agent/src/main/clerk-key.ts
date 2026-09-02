// Derives the Clerk Frontend API origin from a publishable key.
//
// Clerk publishable keys are `pk_test_<base64url>` where the payload encodes
// the Frontend API domain. This mirrors Clerk's own `parsePublishableKey`
// (we keep it dependency-free so the desktop agent has no Clerk JS at runtime).
export interface ParsedPublishableKey {
  frontendApi: string;
  publishableKey: string;
  instanceType: string;
}

/** Clerk terminates the domain inside the payload with "$"; it's a marker, not part of the hostname. */
function stripTerminator(s: string): string {
  return s.replace(/\$$/, "");
}

export function parsePublishableKey(key: string | undefined | null): ParsedPublishableKey | null {
  if (!key) return null;
  // Some key formats append the "$" terminator as a literal suffix after the
  // base64url payload rather than encoding it; drop it so the regex accepts it.
  const trimmed = key.trim().replace(/\$$/, "");
  const testId = /^(pk_(test|live)_[a-zA-Z0-9]+)$/.exec(trimmed);
  if (!testId) return null;
  const payload = trimmed.split("_")[2];
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(decoded) as { d?: string; i?: string; t?: string };
    if (!json.d) return null;
    return {
      frontendApi: stripTerminator(json.d),
      publishableKey: trimmed,
      instanceType: json.t || "",
    };
  } catch {
    // fall back to the legacy `<instance>.clerk.accounts.dev` form
    return {
      frontendApi: stripTerminator(decoded),
      publishableKey: trimmed,
      instanceType: "production",
    };
  }
}

export function clerkAccountsOrigin(key: string | undefined | null): string | null {
  const parsed = parsePublishableKey(key);
  if (!parsed) return null;
  return `https://${parsed.frontendApi}`;
}
