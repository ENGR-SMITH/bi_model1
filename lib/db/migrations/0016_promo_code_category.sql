-- Promo codes become dedicated to a single NEXET category pass.
--
-- The coupon system is now a property of the pass card only: a code belongs to
-- exactly one category (authors | content-creators) and refuses to validate
-- against the other one. Codes created before this column existed stay NULL,
-- which the API treats as "applies to any category" so a live campaign is not
-- killed by the migration. New codes must specify a category.
--
-- Storage and project subscriptions no longer accept promo codes at all; that
-- is enforced in the API, not here.

ALTER TABLE nexet_promo_codes ADD COLUMN category text;
