import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Shared AES-256-GCM secret helpers. Anything that must be stored encrypted
// (Story Oracle provider keys, YouTube OAuth tokens) uses these; the key is
// derived from SESSION_SECRET so one environment secret covers all vaults.
// ---------------------------------------------------------------------------

const encryptionKey = () =>
  crypto.createHash("sha256").update(process.env.SESSION_SECRET ?? "manuskript-development-key").digest();

/** Encrypt a UTF-8 value → `iv.authTag.ciphertext` (all base64url). */
export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Decrypt a value produced by encryptSecret; throws on tampering/wrong key. */
export function decryptSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

/** A masked hint of a stored secret (last 4 chars), safe for admin surfaces. */
export function keyHint(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    const value = decryptSecret(ciphertext);
    return value.length > 4 ? `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}` : "••••";
  } catch {
    return "configured";
  }
}