// ---------------------------------------------------------------------------
// Whop reconciliation timer — settles PENDING checkout intents that no webhook
// resolved. The payment.succeeded webhook is the fast path, but it is a single
// delivery: if one is ever missed (deploy, downtime, rotated secret, exhausted
// retries) the customer has been charged and nothing else would notice. This
// sweep asks Whop directly and grants anything that was actually paid.
//
// Runs in the API process, alongside the storage-maintenance timers.
// ---------------------------------------------------------------------------

import { logger } from "../lib/logger";
import { reconcileRecentPayments, reconcileWhopIntents } from "../routes/whop";

const MINUTE_MS = 60 * 1000;

function intervalMinutes(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw >= 1 ? raw : fallback;
}

let _timer: ReturnType<typeof setInterval> | null = null;

async function safeRun(): Promise<void> {
  // 1. Intents we are still waiting on — settles the checkout the customer is
  //    sitting in front of right now.
  try {
    const result = await reconcileWhopIntents();
    if (result.checked > 0) {
      logger.info(
        result,
        result.granted > 0
          ? "Whop reconciliation recovered purchase(s) the webhook missed"
          : "Whop reconciliation cycle complete",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "Whop intent reconciliation cycle failed");
  }

  // 2. Recent payments with no matching record — the safety net for a lost
  //    webhook, an unmatched renewal, or any charge we never accounted for.
  try {
    const result = await reconcileRecentPayments();
    if (result.recovered > 0 || result.unmatched > 0) {
      logger.info(result, "Whop payment reconciliation cycle complete");
    }
  } catch (error) {
    logger.error({ err: error }, "Whop payment reconciliation cycle failed");
  }
}

/**
 * Start the reconciliation timer. Idempotent — returns a stop function.
 * `WHOP_RECONCILE_INTERVAL_MINUTES` overrides the cadence (default: every 5
 * minutes, first sweep shortly after boot). Tests call `reconcileWhopIntents()`
 * directly instead of waiting on the timer.
 */
export function startWhopReconciliation(): () => void {
  const ms = intervalMinutes("WHOP_RECONCILE_INTERVAL_MINUTES", 5) * MINUTE_MS;

  if (!_timer) {
    const first = setTimeout(() => void safeRun(), 20_000);
    first.unref?.();
    _timer = setInterval(() => void safeRun(), ms);
    _timer.unref?.();
  }

  return () => {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  };
}
