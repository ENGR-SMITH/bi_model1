import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const oracleProvidersTable = pgTable("oracle_providers", {
  id: text("id").primaryKey(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  baseUrl: text("base_url"),
  modelId: text("model_id"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  status: text("status").notNull().default("not_configured"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  lastError: text("last_error"),
  lastSuccessModelId: text("last_success_model_id"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOracleProviderSchema = createInsertSchema(oracleProvidersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertOracleProvider = z.infer<typeof insertOracleProviderSchema>;
export type OracleProvider = typeof oracleProvidersTable.$inferSelect;

export const oracleHealthEventsTable = pgTable("oracle_health_events", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id"),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  responseStatus: integer("response_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOracleHealthEventSchema = createInsertSchema(oracleHealthEventsTable).omit({
  createdAt: true,
});
export type InsertOracleHealthEvent = z.infer<typeof insertOracleHealthEventSchema>;
export type OracleHealthEvent = typeof oracleHealthEventsTable.$inferSelect;