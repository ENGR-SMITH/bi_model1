import { createInsertSchema } from "drizzle-zod";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Creator Den — multi-channel workspaces. A "channel" is a YouTube-linked
// workspace owned by one user (an agency/MCN manages several). Every video
// project now belongs to a channel; the den pages for a channel (studio,
// vault, roles, review, analytics) all live under that channel.
// ---------------------------------------------------------------------------

// One workspace. CREATED rows carry the owner's chosen name; once the owner
// links their real YouTube channel via Google OAuth (Phase 2), the channel is
// CONNECTED and mirrors the YouTube title, avatar, and banner so the CMS grid
// and the den chrome can show real branding.
export const tandemChannelsTable = pgTable("tandem_channels", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  // CREATED (workspace ready, not yet linked) → CONNECTED (YouTube OAuth
  // linked + metadata fetched). CREATED channels already host projects; only
  // branding + analytics require CONNECTED.
  status: text("status").notNull().default("CREATED"),
  name: text("name").notNull(),
  // YouTube channel binding + branding, populated by the OAuth connect flow.
  youtubeChannelId: text("youtube_channel_id"),
  youtubeTitle: text("youtube_title"),
  youtubeDescription: text("youtube_description"),
  youtubeAvatarUrl: text("youtube_avatar_url"),
  youtubeBannerUrl: text("youtube_banner_url"),
  youtubeCountry: text("youtube_country"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Who is on the channel. Exactly one OWNER row (the creator, always present).
// EDITOR rows are ensured/removed whenever a user is added to or removed from
// the last project they hold on the channel — the same row powers the owner's
// GitHub-style contributor strip AND the editor's own CMS mirror card, so
// there are no per-user mirror rows.
export const tandemChannelMembersTable = pgTable(
  "tandem_channel_members",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    // OWNER | EDITOR
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    channelUserUnique: unique("tandem_channel_member_channel_user").on(
      table.channelId,
      table.userId,
    ),
  }),
);

// Encrypted YouTube OAuth tokens for a connected channel (one row per
// channel). Ciphertext is produced with the SESSION_SECRET AES helper used
// for the Story Oracle provider keys (lib/oracle.ts encryptSecret). Tokens
// never leave the server; editors of the channel never see them.
export const tandemChannelOauthTable = pgTable(
  "tandem_channel_oauth",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    youtubeChannelId: text("youtube_channel_id").notNull(),
    accessTokenCipher: text("access_token_cipher").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    scope: text("scope").notNull().default(""),
    // ACTIVE | REVOKED
    status: text("status").notNull().default("ACTIVE"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    linkedByUserId: text("linked_by_user_id").notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    channelUnique: unique("tandem_channel_oauth_channel_unique").on(table.channelId),
  }),
);

export const insertTandemChannelSchema = createInsertSchema(tandemChannelsTable);
export const insertTandemChannelMemberSchema = createInsertSchema(tandemChannelMembersTable);
export const insertTandemChannelOauthSchema = createInsertSchema(tandemChannelOauthTable);

export type TandemChannel = typeof tandemChannelsTable.$inferSelect;
export type TandemChannelMember = typeof tandemChannelMembersTable.$inferSelect;
export type TandemChannelOauth = typeof tandemChannelOauthTable.$inferSelect;

export const tandemChannelRoleSchema = z.enum(["OWNER", "EDITOR"]);
export const tandemChannelStatusSchema = z.enum(["CREATED", "CONNECTED"]);
