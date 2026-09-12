// ---------------------------------------------------------------------------
// Background channel analytics sync (§9.1). On a configurable cadence
// (YT_SYNC_INTERVAL_MINUTES, default 10) sync every CONNECTED channel with an
// ACTIVE oauth link — the same in-process pattern as the storage metering /
// retention loop; no separate worker process in v1.
//
// Ten minutes is the product promise for the Creator Den analytics page: the
// numbers it shows for the channel and for each video are at most one cycle
// old. The per-cycle work is bounded by YT_SYNC_MAX_VIDEO_QUERIES (see
// sync.ts), which rotates through the catalog so every video is refreshed in
// turn instead of only the newest ones.
// ---------------------------------------------------------------------------

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  nexetChannelsTable,
  nexetChannelOauthTable,
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
    .select({ channelId: nexetChannelOauthTable.channelId })
    .from(nexetChannelOauthTable)
    .where(eq(nexetChannelOauthTable.status, "ACTIVE"));
  if (oauthRows.length === 0) return;
  const linkedIds = oauthRows.map((row) => row.channelId);

  const channels = await db
    .select({ id: nexetChannelsTable.id })
    .from(nexetChannelsTable)
    .where(and(eq(nexetChannelsTable.status, "CONNECTED"), inArray(nexetChannelsTable.id, linkedIds)));

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
  const intervalMs = intervalMinutes("YT_SYNC_INTERVAL_MINUTES", 10) * MINUTE_MS;
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