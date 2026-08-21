// Pure BullMQ configuration — no DB, no Redis imports, so this module can be
// unit-tested (and reasoned about) without a live stack.

export const VIDEO_JOB_TYPES = [
  "PROXY",
  "TRANSCRIBE",
  "SYNC",
  "RENDER",
  "AUDIO",
  "EXPORT",
  "THUMBNAIL",
  "REFERENCE_ANALYZE",
  "INTERCHANGE",
  "EXPORT_BUNDLE",
] as const;

export type VideoJobType = (typeof VIDEO_JOB_TYPES)[number];

/** Queue name for a job type: `tandem-video-<type>` (one queue per type). */
export function queueNameFor(jobType: string): string {
  return `tandem-video-${jobType.toLowerCase().replaceAll("_", "-")}`;
}

/**
 * True when BullMQ mode is on (REDIS_URL set). Read fresh — never cached, so
 * tests and config changes are always honored.
 */
export function bullmqEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}
