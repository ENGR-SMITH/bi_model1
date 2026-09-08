-- =============================================================================
-- Migration: 0012_paystack_plans — Paystack-managed monthly subscriptions
--
-- Why: billing moves from the server's renewal scheduler to Paystack's native
-- recurring plans. Each catalog plan is mirrored once as a Paystack plan
-- (POST /plan, interval monthly) in tandem_paystack_plans; checkout subscribes
-- the customer with the plan code, and Paystack charges monthly and fires
-- charge.success each cycle. The subscription columns on tandem_subscriptions
-- hold what the admin toggle needs to disable/enable a subscription
-- (subscription code + email token) and what makes webhook grants idempotent
-- (the Paystack transaction reference that granted each row).
--
-- Idempotent: guarded so re-running is safe (0003/0004 precedent).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_paystack_plans'
  ) THEN
    CREATE TABLE "tandem_paystack_plans" (
      "kind" text NOT NULL,
      "plan_id" text NOT NULL,
      "plan_code" text NOT NULL,
      "amount_usd" integer NOT NULL,
      "interval" text DEFAULT 'monthly' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("kind", "plan_id")
    );
  END IF;
END $$;

ALTER TABLE tandem_subscriptions ADD COLUMN IF NOT EXISTS paystack_plan_code text;
ALTER TABLE tandem_subscriptions ADD COLUMN IF NOT EXISTS paystack_subscription_code text;
ALTER TABLE tandem_subscriptions ADD COLUMN IF NOT EXISTS paystack_email_token text;
ALTER TABLE tandem_subscriptions ADD COLUMN IF NOT EXISTS paystack_transaction_reference text;