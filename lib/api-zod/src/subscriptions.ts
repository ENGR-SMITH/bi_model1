import * as zod from "zod";

// ---------------------------------------------------------------------------
// Subscriptions — hand-written zod schemas for the subscriptions API. These
// live outside the generated folder so they survive codegen; they mirror the
// Orval convention (a const per request/response, coerced dates) so the rest
// of the client treats them like any generated schema.
// ---------------------------------------------------------------------------

export const SubscriptionKindSchema = zod.enum(["pass", "storage", "projects"]);

export const SubscriptionPlanSchema = zod.object({
  kind: zod.enum(["pass", "storage", "projects"]),
  planId: zod.string(),
  planLabel: zod.string(),
  priceUsd: zod.number().int(),
  intervalLabel: zod.string(),
  detail: zod.string(),
});

export const SubscriptionRecordSchema = zod.object({
  id: zod.string(),
  kind: zod.enum(["pass", "storage", "projects"]),
  planId: zod.string(),
  planLabel: zod.string(),
  priceUsd: zod.number().int(),
  status: zod.string(),
  intervalLabel: zod.string(),
  periodStart: zod.string(),
  periodEnd: zod.string(),
  source: zod.string(),
  promoCode: zod.string().nullable(),
  cardLast4: zod.string().nullable(),
  active: zod.boolean(),
});

export const ListSubscriptionsResponseSchema = zod.array(SubscriptionRecordSchema);

export const GetSubscriptionsPlansResponseSchema = zod.object({
  plans: zod.array(SubscriptionPlanSchema),
  current: zod.array(SubscriptionRecordSchema),
  usage: zod.object({
    storage: zod.object({
      usedBytes: zod.number(),
      totalBytes: zod.number(),
      remainingBytes: zod.number(),
    }),
    projects: zod.object({
      used: zod.number(),
      total: zod.number(),
      remaining: zod.number(),
    }),
  }),
});

export const SubscriptionCardSchema = zod.object({
  number: zod.string().min(1),
  expiryMonth: zod.number().int(),
  expiryYear: zod.number().int(),
  cvc: zod.string().min(1),
});

export const PurchaseSubscriptionBodySchema = zod.object({
  kind: zod.enum(["pass", "storage", "projects"]),
  planId: zod.string().min(1),
  card: SubscriptionCardSchema,
  promoCode: zod.string().nullish(),
});

export const SubscriptionReceiptSchema = zod.object({
  subtotal: zod.number().int(),
  discount: zod.number().int(),
  total: zod.number().int(),
  cardLast4: zod.string(),
  promoCode: zod.string().nullable(),
});

export const PurchaseSubscriptionResponseSchema = zod.object({
  subscription: SubscriptionRecordSchema,
  receipt: SubscriptionReceiptSchema,
});

export type SubscriptionKind = zod.infer<typeof SubscriptionKindSchema>;
export type SubscriptionPlan = zod.infer<typeof SubscriptionPlanSchema>;
export type SubscriptionRecord = zod.infer<typeof SubscriptionRecordSchema>;
export type SubscriptionUsageStorage = { usedBytes: number; totalBytes: number; remainingBytes: number };
export type SubscriptionUsageProjects = { used: number; total: number; remaining: number };
export type SubscriptionCard = zod.infer<typeof SubscriptionCardSchema>;
export type SubscriptionReceipt = zod.infer<typeof SubscriptionReceiptSchema>;