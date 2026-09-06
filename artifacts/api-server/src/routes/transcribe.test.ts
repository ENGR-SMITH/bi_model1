import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  fetchImpl: null as null | ((url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>),
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  return built.exports;
});

// Force the "no local faster-whisper" path so the not-configured test is
// deterministic regardless of what the CI machine has installed.
vi.mock("../video/worker", async (importOriginal) => {
  const original = await importOriginal<typeof import("../video/worker")>();
  return {
    ...original,
    detectTools: () => ({ ffmpeg: false, ffprobe: false, whisper: false, melt: false }),
  };
});

import transcribeRouter from "./transcribe";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", transcribeRouter);
  return app;
}

const AUDIO_BYTES = Buffer.from("fake-webm-bytes-for-the-test");

beforeEach(() => {
  state.userId = "user-1";
  state.fetchImpl = null;
  vi.stubGlobal("fetch", async (url: string, init?: any) => {
    if (!state.fetchImpl) throw new Error("unexpected fetch in this test");
    return state.fetchImpl(url, init);
  });
  process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-test-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
});

describe("transcribe", () => {
  it("requires authentication", async () => {
    state.userId = null;
    const res = await request(createApp()).post("/api/transcribe").attach("audio", AUDIO_BYTES, "note.webm");
    expect(res.status).toBe(401);
  });

  it("requires an audio file", async () => {
    const res = await request(createApp()).post("/api/transcribe");
    expect(res.status).toBe(400);
  });

  it("transcribes via Groq Whisper when GROQ_API_KEY is set", async () => {
    process.env.GROQ_API_KEY = "sk-test-groq";
    let calledUrl = "";
    state.fetchImpl = async (url, init) => {
      calledUrl = url;
      expect(init?.headers?.Authorization).toBe("Bearer sk-test-groq");
      return { ok: true, status: 200, json: async () => ({ text: "Hello from the transcript." }), text: async () => "" };
    };
    const res = await request(createApp()).post("/api/transcribe").attach("audio", AUDIO_BYTES, "note.webm");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "Hello from the transcript.", engine: "groq-whisper" });
    expect(calledUrl).toContain("api.groq.com");
  });

  it("surfaces Groq failures as 502 with the provider message", async () => {
    process.env.GROQ_API_KEY = "sk-test-groq";
    state.fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => "invalid audio" });
    const res = await request(createApp()).post("/api/transcribe").attach("audio", AUDIO_BYTES, "note.webm");
    expect(res.status).toBe(502);
    expect(String(res.body.error)).toContain("invalid audio");
  });

  it("returns 503 when no engine is configured", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await request(createApp()).post("/api/transcribe").attach("audio", AUDIO_BYTES, "note.webm");
    expect(res.status).toBe(503);
    expect(String(res.body.error)).toContain("GROQ_API_KEY");
  });
});