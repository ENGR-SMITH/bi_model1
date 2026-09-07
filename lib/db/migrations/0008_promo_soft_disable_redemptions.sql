-- Promo codes: soft-disable + one redemption per person.
-- 1. `active` lets an admin pause a code (keep its row/history) instead of
--    deleting it; a paused code stops validating immediately.
ALTER TABLE tandem_promo_codes ADD COLUMN active boolean NOT NULL DEFAULT true;

-- 2. One row per (code, user): shared codes are usable by many people, but
--    each person can redeem a given code only once.
CREATE TABLE IF NOT EXISTS tandem_promo_redemptions (
  code TEXT NOT NULL REFERENCES tandem_promo_codes(code) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
