-- Admin-manageable knobs on the code-defined plan catalog. Only rows present
-- here override a plan's defaults. Keyed by (kind, planId) matching the plan
-- ids used across the checkout paths.

CREATE TABLE tandem_subscription_plan_settings (
  kind text NOT NULL,
  plan_id text NOT NULL,
  auto_renew_available boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, plan_id)
);
