-- =============================================================================
-- Migration: 0014_whop_payments — Whop-managed subscriptions (Paystack → Whop)
--
-- Why: billing moves from Paystack to Whop's native recurring plans. Each
-- catalog plan is mirrored once as a Whop renewal plan (POST /plans) in
-- nexet_whop_plans; checkout subscribes the customer via a Whop checkout
-- configuration, and Whop charges monthly and fires payment.succeeded each
-- cycle. The old Paystack intent/plan registries and subscription columns are
-- renamed in place (data-preserving) and extended with the Whop ids the
-- webhook grant + admin toggle need (payment id for idempotency, membership
-- id for renewals and cancel/resume).
--
-- Idempotent: every statement is guarded so this migration is safe to re-run.
-- =============================================================================

-- Rename the intent registry: nexet_paystack_intents → nexet_whop_intents
DO $$
BEGIN
  IF to_regclass('public.nexet_paystack_intents') IS NOT NULL
     AND to_regclass('public.nexet_whop_intents') IS NULL THEN
    ALTER TABLE nexet_paystack_intents RENAME TO nexet_whop_intents;
  END IF;
END $$;

ALTER TABLE nexet_whop_intents ADD COLUMN IF NOT EXISTS whop_payment_id text;
ALTER TABLE nexet_whop_intents ADD COLUMN IF NOT EXISTS whop_membership_id text;

-- Rename the plan registry: nexet_paystack_plans → nexet_whop_plans
DO $$
BEGIN
  IF to_regclass('public.nexet_paystack_plans') IS NOT NULL
     AND to_regclass('public.nexet_whop_plans') IS NULL THEN
    ALTER TABLE nexet_paystack_plans RENAME TO nexet_whop_plans;
  END IF;
END $$;

-- Whop plan id (plan_…) replaces the Paystack plan code (PLN_…).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nexet_whop_plans' AND column_name = 'plan_code'
  ) THEN
    ALTER TABLE nexet_whop_plans RENAME COLUMN plan_code TO whop_plan_id;
  END IF;
END $$;

ALTER TABLE nexet_whop_plans ADD COLUMN IF NOT EXISTS billing_period_days integer DEFAULT 30 NOT NULL;

-- Subscriptions: replace the Paystack billing columns with Whop equivalents.
-- The Paystack card authorization/customer code + email token were only used
-- by Paystack's own enable/disable + re-charge endpoints; Whop owns renewal
-- through the membership, so those columns are dropped. What Whop needs is
-- the membership id (renewal + admin cancel/resume), the plan id, the email,
-- and the payment id (webhook idempotency).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nexet_subscriptions' AND column_name = 'paystack_subscription_code'
  ) THEN
    ALTER TABLE nexet_subscriptions RENAME COLUMN paystack_subscription_code TO whop_membership_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nexet_subscriptions' AND column_name = 'paystack_plan_code'
  ) THEN
    ALTER TABLE nexet_subscriptions RENAME COLUMN paystack_plan_code TO whop_plan_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nexet_subscriptions' AND column_name = 'paystack_email'
  ) THEN
    ALTER TABLE nexet_subscriptions RENAME COLUMN paystack_email TO whop_email;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nexet_subscriptions' AND column_name = 'paystack_transaction_reference'
  ) THEN
    ALTER TABLE nexet_subscriptions RENAME COLUMN paystack_transaction_reference TO whop_payment_id;
  END IF;
END $$;

ALTER TABLE nexet_subscriptions DROP COLUMN IF EXISTS paystack_authorization_code;
ALTER TABLE nexet_subscriptions DROP COLUMN IF EXISTS paystack_customer_code;
ALTER TABLE nexet_subscriptions DROP COLUMN IF EXISTS paystack_email_token;

-- Sanity: if any renamed table still exists under the old name it was never
-- migrated (the guarded renames above only run when the target is absent).