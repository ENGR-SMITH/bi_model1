// ---------------------------------------------------------------------------
// Dubbing languages — the fixed set of language dubs the audio and script role
// pages (and the desktop agent) offer when submitting media for review. The
// upload is compulsory: a member must pick one of these before a file can be
// handed in, and the choice is stored on the vault asset so preview, review,
// timeline, and the finish desk can group and label versions by language.
// ---------------------------------------------------------------------------

export const DUBBING_LANGUAGES = [
  "English",
  "Spanish",
  "Portuguese",
  "Hindi",
  "Indonesian",
] as const;

export type DubbingLanguage = (typeof DUBBING_LANGUAGES)[number];

/** Case-insensitive normalize + validate; unknown/empty falls back to English. */
export function normalizeDubbingLanguage(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return (
    DUBBING_LANGUAGES.find((lang) => lang.toLowerCase() === value.toLowerCase()) ??
    "English"
  );
}