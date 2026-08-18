import { afterEach, describe, expect, it, vi } from "vitest";

// queues.ts pulls in @workspace/db (which requires DATABASE_URL at import);
// the no-op enqueue test below never runs a query, so a stub is enough.
vi.mock("@workspace/db", () => ({
  db: {},
  tandemVideoJobsTable: {},
}));

import {
  bullmqEnabled,
  enqueueBullMqJob,
  queueNameFor,
  VIDEO_JOB_TYPES,
} from "./queues";
import {
  bullmqEnabled as configEnabled,
  queueNameFor as configQueueNameFor,
} from "./queue-config";

// These tests must never touch Redis — the whole point of the fallback mode
// is that isolated route tests (and local dev without REDIS_URL) run the
// in-process polling loop instead of BullMQ.

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  }
  vi.restoreAllMocks();
});

describe("bullmq queue wiring", () => {
  it("maps every job type to a distinct queue name", () => {
    const names = VIDEO_JOB_TYPES.map(queueNameFor);
    expect(new Set(names).size).toBe(VIDEO_JOB_TYPES.length);
    expect(queueNameFor("PROXY")).toBe("tandem-video-proxy");
    expect(queueNameFor("REFERENCE_ANALYZE")).toBe("tandem-video-reference-analyze");
  });

  it("pure config helpers agree with the queue module (no DB import)", () => {
    delete process.env.REDIS_URL;
    expect(configEnabled()).toBe(false);
    expect(configQueueNameFor("AUDIO")).toBe("tandem-video-audio");
    expect(bullmqEnabled()).toBe(configEnabled());
  });

  it("is enabled when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    expect(bullmqEnabled()).toBe(true);
  });

  it("enqueue is a no-op without Redis — no connection is attempted", async () => {
    delete process.env.REDIS_URL;
    // If this tried to touch Redis it would throw ECONNREFUSED; a plain row
    // insert + local Socket.IO emit must be all that happens.
    await expect(
      enqueueBullMqJob({ id: "job-1", projectId: "project-1", type: "PROXY" }),
    ).resolves.toBeUndefined();
  });
});
