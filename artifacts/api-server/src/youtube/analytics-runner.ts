// ---------------------------------------------------------------------------
// Background channel analytics sync (§9.1). On a configurable cadence
// (YT_SYNC_INTERVAL_MINUTES, default 60) sync every CONNECTED channel with an
// ACTIVE oauth link — the same in-process pattern as the storage metering /
// retention loop; no separate worker process in v1.
// ---------------------------------------------------------------------------

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  tandemChannelsTable,
  tandemChannelOauthTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { runChannelSync } from "./sync";

const MINUTE_MS = 60 * 1000;

function intervalMinutes(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw >= 1 ? raw : fallback;
}

let _timer: ReturnType<typeof setInterval> | null = null;

/** Sync every CONNECTED channel that still has an ACTIVE oauth link. */
export async function syncConnectedChannels(): Promise<void> {
  const oauthRows = await db
    .select({ channelId: tandemChannelOauthTable.channelId })
    .from(tandemChannelOauthTable)
    .where(eq(tandemChannelOauthTable.status, "ACTIVE"));
  if (oauthRows.length === 0) return;
  const linkedIds = oauthRows.map((row) => row.channelId);

  const channels = await db
    .select({ id: tandemChannelsTable.id })
    .from(tandemChannelsTable)
    .where(and(eq(tandemChannelsTable.status, "CONNECTED"), inArray(tandemChannelsTable.id, linkedIds)));

  for (const channel of channels) {
    try {
      const result = await runChannelSync(channel.id);
      if (result.status === "ERROR") {
        logger.warn({ channelId: channel.id, error: result.error }, "Channel analytics background sync reported an error");
      }
    } catch (error) {
      logger.error({ channelId: channel.id, err: error }, "Channel analytics background sync failed");
    }
  }
}

/**
 * Start the background sync timer. Idempotent — returns a stop function.
 * `YT_SYNC_INTERVAL_MINUTES` overrides the cadence (tests call
 * `syncConnectedChannels` directly).
 */
export function startChannelAnalyticsSync(): () => void {
  const intervalMs = intervalMinutes("YT_SYNC_INTERVAL_MINUTES", 60) * MINUTE_MS;
  if (!_timer) {
    // First pass shortly after boot, then on the cadence.
    const first = setTimeout(() => void syncConnectedChannels().catch((error) => logger.error({ err: error }, "Channel analytics first sync failed")), 60_000);
    first.unref?.();
    _timer = setInterval(() => void syncConnectedChannels().catch((error) => logger.error({ err: error }, "Channel analytics sync cycle failed")), intervalMs);
    _timer.unref?.();
  }
  return () => {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  };
}