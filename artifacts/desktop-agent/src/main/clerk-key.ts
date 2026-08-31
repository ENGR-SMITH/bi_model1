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

export function parsePublishableKey(key: string | undefined | null): ParsedPublishableKey | null {
  if (!key) return null;
  const trimmed = key.trim();
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
      frontendApi: json.d,
      publishableKey: trimmed,
      instanceType: json.t || "",
    };
  } catch {
    // fall back to the legacy `<instance>.clerk.accounts.dev` form
    return {
      frontendApi: decoded,
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