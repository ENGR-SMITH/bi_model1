// ---------------------------------------------------------------------------
// Maintenance timer — starts the storage metering + retention sweeps on a
// configurable cadence (default: every 24 h, first run shortly after boot).
// In BullMQ/worker-fleet mode only the API process runs this timer, so the
// ledger is written once per deployment.
// ---------------------------------------------------------------------------

import { logger } from "../lib/logger";
import { runStorageMetering, runStorageRetention } from "./storage-maintenance";

const HOUR_MS = 60 * 60 * 1000;

function intervalHours(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw >= 1 ? raw : fallback;
}

let _meterTimer: ReturnType<typeof setInterval> | null = null;
let _retentionTimer: ReturnType<typeof setInterval> | null = null;

async function safeRun(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result = await run();
    logger.info({ result }, `${name} cycle complete`);
  } catch (error) {
    logger.error({ err: error }, `${name} cycle failed`);
  }
}

/**
 * Start the maintenance timers. Idempotent — returns a stop function.
 * `STORAGE_METER_INTERVAL_HOURS` / `STORAGE_RETENTION_INTERVAL_HOURS` override
 * the cadence (tests can pass small values / run the exported fns directly).
 */
export function startStorageMaintenance(): () => void {
  const meterMs = intervalHours("STORAGE_METER_INTERVAL_HOURS", 24) * HOUR_MS;
  const retentionMs = intervalHours("STORAGE_RETENTION_INTERVAL_HOURS", 24) * HOUR_MS;

  if (!_meterTimer) {
    // First sweep shortly after boot, then on the cadence.
    const firstMeter = setTimeout(() => void safeRun("Storage metering", () => runStorageMetering()), 30_000);
    firstMeter.unref?.();
    _meterTimer = setInterval(() => void safeRun("Storage metering", () => runStorageMetering()), meterMs);
    _meterTimer.unref?.();
  }
  if (!_retentionTimer) {
    const firstRetention = setTimeout(() => void safeRun("Storage retention", () => runStorageRetention()), 45_000);
    firstRetention.unref?.();
    _retentionTimer = setInterval(() => void safeRun("Storage retention", () => runStorageRetention()), retentionMs);
    _retentionTimer.unref?.();
  }

  return () => {
    if (_meterTimer) {
      clearInterval(_meterTimer);
      _meterTimer = null;
    }
    if (_retentionTimer) {
      clearInterval(_retentionTimer);
      _retentionTimer = null;
    }
  };
}
