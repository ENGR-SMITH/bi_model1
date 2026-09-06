// ---------------------------------------------------------------------------
// Transcription — speech-to-text for the Author Den draft editor (dictate
// into the mic or upload an audio clip → text inserted at the cursor).
// Hand-written like the subscriptions hooks so it survives a codegen
// regenerate; the server route is POST /api/transcribe.
// ---------------------------------------------------------------------------

import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

export type TranscribeResponse = {
  text: string;
  engine: "groq-whisper" | "faster-whisper";
};

export const getTranscribeUrl = () => `/api/transcribe`;

export const transcribeAudio = async (
  audio: File,
  options?: Parameters<typeof customFetch>[1],
): Promise<TranscribeResponse> => {
  const formData = new FormData();
  formData.append("audio", audio);
  return customFetch<TranscribeResponse>(getTranscribeUrl(), {
    ...options,
    method: "POST",
    body: formData,
  });
};

export default { transcribeAudio };