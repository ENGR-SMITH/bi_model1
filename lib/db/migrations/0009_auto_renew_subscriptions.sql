-- Server-managed auto-renewal for category passes: the user authorizes a
-- card at checkout, we keep the Paystack authorization, and a scheduler
-- re-charges it at each pass cycle (the charge.success webhook grants the
-- extension through the same intent → grant path as a fresh purchase).

ALTER TABLE nexet_subscriptions ADD COLUMN auto_renew boolean NOT NULL DEFAULT false;
ALTER TABLE nexet_subscriptions ADD COLUMN paystack_authorization_code text;
ALTER TABLE nexet_subscriptions ADD COLUMN paystack_customer_code text;
ALTER TABLE nexet_subscriptions ADD COLUMN paystack_email text;
ALTER TABLE nexet_subscriptions ADD COLUMN renewal_failure text;

ALTER TABLE nexet_paystack_intents ADD COLUMN auto_renew boolean NOT NULL DEFAULT false;
ALTER TABLE nexet_paystack_intents ADD COLUMN renewal_for text;
ALTER TABLE nexet_paystack_intents ADD COLUMN customer_email text;
