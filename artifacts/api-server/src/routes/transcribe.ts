import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import multer from "multer";
import { detectTools, uploadDir } from "../video/worker";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Transcription — speech-to-text for the Author Den draft editor (dictate
// into the mic or upload an audio clip, and the words land in the draft).
// Engine order, so it works with whatever the server already has configured:
//   1. Groq's hosted Whisper (GROQ_API_KEY — the same key as the Story
//      Oracle provider), fast and no local install.
//   2. The local faster-whisper install the video pipeline uses.
//   3. Otherwise a clear 503 so the UI can tell the author what to configure.
// No audio is stored: the upload is written to a temp subdir of the upload
// dir, transcribed, and deleted before the response is sent.
// ---------------------------------------------------------------------------

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(uploadDir(), "dictation");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12) || ".webm";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function audioFileName(mimeType: string): string {
  const ext = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg" }[mimeType] ?? "mp3";
  return `recording.${ext}`;
}

/** Groq's hosted Whisper — OpenAI-compatible audio transcriptions endpoint. */
async function transcribeWithGroq(filePath: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-large-v3");
  form.append("response_format", "json");
  form.append("file", new File([fs.readFileSync(filePath)], audioFileName(mimeType), { type: mimeType || "audio/mpeg" }));
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim() ?? ""}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq transcription failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { text?: string };
  const text = (payload.text ?? "").trim();
  if (!text) throw new Error("Groq returned an empty transcript");
  return text;
}

/** Local faster-whisper fallback — same engine call the video pipeline uses. */
function transcribeWithWhisper(filePath: string): string {
  const script = [
    "import sys",
    "from faster_whisper import WhisperModel",
    "model = WhisperModel('small', device='cpu', compute_type='int8')",
    "segments, info = model.transcribe(sys.argv[1])",
    "print('\\n'.join(s.text.strip() for s in segments))",
  ].join("\n");
  const run = spawnSync("python", ["-c", script, filePath], { encoding: "utf8", timeout: 60 * 30 * 1000 });
  if (run.status !== 0) {
    throw new Error(`faster-whisper transcription failed: ${(run.stderr ?? "").slice(0, 300) || "unknown error"}`);
  }
  const text = (run.stdout ?? "").trim();
  if (!text) throw new Error("faster-whisper returned an empty transcript");
  return text;
}

// POST /transcribe — one audio file in the `audio` field → { text, engine }.
router.post("/transcribe", audioUpload.single("audio"), async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "An audio file is required" });
    return;
  }

  const filePath = req.file.path;
  try {
    if (process.env.GROQ_API_KEY?.trim()) {
      const text = await transcribeWithGroq(filePath, req.file.mimetype);
      res.json({ text, engine: "groq-whisper" });
      return;
    }
    if (detectTools().whisper) {
      const text = transcribeWithWhisper(filePath);
      res.json({ text, engine: "faster-whisper" });
      return;
    }
    res.status(503).json({
      error: "Transcription is not configured on this server — set GROQ_API_KEY in the server .env (the same key as the Story Oracle) or install faster-whisper.",
    });
  } catch (cause) {
    logger.error({ userId, err: cause }, "transcribe failed");
    res.status(502).json({ error: cause instanceof Error ? cause.message : "Transcription failed" });
  } finally {
    // The audio is transient — never keep dictation on disk.
    fs.promises.rm(filePath, { force: true }).catch(() => {});
  }
});

export default router;