// ---------------------------------------------------------------------------
// The Nexet user ID — a short, deterministic, human-friendly handle derived
// from the Clerk user id, so a teammate can be invited without sharing an
// email address. Format: `NEXET` + 5 uppercase Crockford base32 characters
// (e.g. NEXET6EUHY).
//
// The same derivation MUST be mirrored in the Creator Den client
// (creators-den/src/lib/nexet-uid.ts) so a profile and the server always
// agree on a user's ID. Because it is derived, not stored, nothing changes in
// the database; the server resolves an invite by walking the Clerk user list
// and matching computed IDs.
// ---------------------------------------------------------------------------

// Crockford base32 — excludes I, L, O, U to avoid lookalike characters.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SUFFIX_LENGTH = 5;

/** The Nexet ID for a Clerk user id, e.g. "user_2abc..." -> "NEXET6EUHY". */
export function nexetUid(userId: string): string {
  // FNV-1a 32-bit over the id bytes.
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;

  let suffix = "";
  let value = hash;
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
    suffix += ALPHABET[value % 32];
    value = Math.floor(value / 32);
  }
  return `NEXET${suffix}`;
}

/** True when the input looks like a Nexet ID (case-insensitive). */
export function isNexetUid(input: string): boolean {
  return /^NEXET[0-9A-Z]{5}$/i.test(input.trim());
}

/** Normalize a typed invite for comparison: trim + uppercase. */
export function normalizeNexetUid(input: string): string {
  return input.trim().toUpperCase();
}
