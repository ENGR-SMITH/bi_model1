// ---------------------------------------------------------------------------
// Recovery timer — runs the stuck-proxy sweep on a configurable cadence
// (default: every 15 min, first run shortly after boot) so an asset whose
// PROXY job died while nobody was looking heals without anybody reopening the
// vault. In BullMQ/worker-fleet mode only the API process runs this timer.
//
// Set PROXY_RECOVERY_INTERVAL_MINUTES=0 to disable the sweep; the on-demand
// recovery in the vault's read path still runs.
// ---------------------------------------------------------------------------

import { logger } from "../lib/logger";
import { recoverStuckProxyJobs } from "./proxy-recovery";

const MINUTE_MS = 60 * 1000;
const DEFAULT_INTERVAL_MINUTES = 15;

function intervalMinutes(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const minutes = Number(raw);
  if (minutes === 0) return 0;
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : fallback;
}

let _timer: ReturnType<typeof setInterval> | null = null;

async function safeRun(): Promise<void> {
  try {
    const result = await recoverStuckProxyJobs();
    // Only log cycles that did something — this runs every 15 minutes forever.
    if (result.requeued > 0) {
      logger.info({ result }, "Proxy recovery cycle complete");
    }
  } catch (error) {
    logger.error({ err: error }, "Proxy recovery cycle failed");
  }
}

/**
 * Start the recovery timer. Idempotent — returns a stop function.
 */
export function startProxyRecovery(): () => void {
  const minutes = intervalMinutes("PROXY_RECOVERY_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES);
  if (minutes === 0) {
    return () => {};
  }
  if (!_timer) {
    // First sweep shortly after boot, then on the cadence.
    const firstSweep = setTimeout(() => void safeRun(), 60_000);
    firstSweep.unref?.();
    _timer = setInterval(() => void safeRun(), minutes * MINUTE_MS);
    _timer.unref?.();
  }
  return () => {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  };
}
