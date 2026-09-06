-- =============================================================================
-- Migration: tandem_paystack_intents — Paystack hosted-checkout intents
--
-- Why: subscription purchases now go through Paystack's hosted checkout
-- (POST /api/paystack/checkout). One row is written per checkout session
-- (PENDING), then flipped to SUCCESS (entitlement granted via
-- applySubscriptionPurchase) or FAILED by the charge.success / charge.failed
-- webhook or the post-redirect verify call. The unique reference makes the
-- grant idempotent: webhook and confirm-verify can race without double-granting.
--
-- Source of truth: lib/db/src/schema/paystack-intents.ts
--
-- Idempotent: guarded so re-running is safe.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_paystack_intents'
  ) THEN
    CREATE TABLE "tandem_paystack_intents" (
      "reference" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "kind" text NOT NULL,
      "plan_id" text NOT NULL,
      "plan_label" text NOT NULL,
      "interval_label" text DEFAULT '' NOT NULL,
      "amount_usd" integer NOT NULL,
      "currency" text DEFAULT 'USD' NOT NULL,
      "status" text DEFAULT 'PENDING' NOT NULL,
      "promo_code" text,
      "card_last_4" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  END IF;
END $$;