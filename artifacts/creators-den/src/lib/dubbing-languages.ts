// ---------------------------------------------------------------------------
// Dubbing languages — the fixed list of language dubs the audio and script
// role pages offer when submitting media for review. Choosing one is
// compulsory before a file can be handed in; the choice is stored on the
// vault asset so preview, review, timeline, and the finish desk can group and
// label versions by language. Mirrors DUBBING_LANGUAGES in the api-server.
// ---------------------------------------------------------------------------

export const DUBBING_LANGUAGES = [
  'English',
  'Spanish',
  'Portuguese',
  'Hindi',
  'Indonesian',
] as const;

export type DubbingLanguage = (typeof DUBBING_LANGUAGES)[number];