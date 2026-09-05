import { getAuth } from "@clerk/express";
import {
  db,
  tandemChannelsTable,
  tandemChannelMembersTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemChannel,
  type TandemChannelMember,
} from "@workspace/db";
import {
  CreateChannelBody,
  CreateChannelResponse,
  DeleteChannelParams,
  GetChannelParams,
  GetChannelResponse,
  ListChannelPeopleParams,
  ListChannelPeopleResponse,
  ListChannelProjectsParams,
  ListChannelProjectsResponse,
  ListChannelsResponse,
  UpdateChannelBody,
  UpdateChannelParams,
  UpdateChannelResponse,
  DisconnectChannelOauthParams,
  ExchangeChannelOauthBody,
  ExchangeChannelOauthParams,
  StartChannelOauthParams,
} from "@workspace/api-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { randomUUID } from "node:crypto";
import { resolveUserProfiles } from "../lib/user-names";
import {
  disconnectChannelOauth,
  exchangeChannelOauth,
  startChannelOauth,
} from "../channels/oauth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Creator Den channels — the multi-channel workspaces behind the CMS grid.
//
//   GET/POST /channels            — the caller's channel list + creation
//   GET/PATCH/DELETE /channels/:id — detail / owner rename / empty delete
//   GET /channels/:id/people      — GitHub-style roster (owner + editors)
//   GET /channels/:id/projects    — the channel home's project cards
//
// Membership model: exactly one OWNER row (the creator) and zero-or-more
// EDITOR rows that are ensured/removed as project memberships change
// (src/channels/channel-members.ts). The same EDITOR row powers the owner's
// contributor strip AND the editor's CMS mirror card.
// ---------------------------------------------------------------------------

/** The caller's channel membership row, if any. */
export async function channelMembership(
  channelId: string,
  userId: string,
): Promise<TandemChannelMember | null> {
  const [row] = await db
    .select()
    .from(tandemChannelMembersTable)
    .where(
      and(
        eq(tandemChannelMembersTable.channelId, channelId),
        eq(tandemChannelMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The project rows a caller may see on a channel home: the owner sees every
 * project in the channel; an editor sees only the projects they are an
 * ACTIVE member of.
 */
export async function visibleChannelProjectRows(
  channelId: string,
  userId: string,
  role: string,
): Promise<typeof tandemVideoProjectsTable.$inferSelect[]> {
  if (role === "OWNER") {
    return db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.channelId, channelId))
      .orderBy(desc(tandemVideoProjectsTable.updatedAt));
  }
  const memberships = await db
    .select({ projectId: tandemVideoMembersTable.projectId })
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.userId, userId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );
  const memberProjectIds = memberships.map((m) => m.projectId);
  if (memberProjectIds.length === 0) return [];
  return db
    .select()
    .from(tandemVideoProjectsTable)
    .where(
      and(
        eq(tandemVideoProjectsTable.channelId, channelId),
        inArray(tandemVideoProjectsTable.id, memberProjectIds),
      ),
    )
    .orderBy(desc(tandemVideoProjectsTable.updatedAt));
}

/** One ChannelSummary row (channel + viewer role + the viewer's counts). */
async function summarizeChannel(
  channel: TandemChannel,
  role: string,
  userId: string,
): Promise<typeof CreateChannelResponse._type> {
  const visible = await visibleChannelProjectRows(channel.id, userId, role);
  const memberRows = await db
    .select({ id: tandemChannelMembersTable.id })
    .from(tandemChannelMembersTable)
    .where(eq(tandemChannelMembersTable.channelId, channel.id));
  return {
    id: channel.id,
    ownerId: channel.ownerId,
    status: channel.status as "CREATED" | "CONNECTED",
    name: channel.name,
    youtubeChannelId: channel.youtubeChannelId ?? null,
    youtubeTitle: channel.youtubeTitle ?? null,
    youtubeDescription: channel.youtubeDescription ?? null,
    youtubeAvatarUrl: channel.youtubeAvatarUrl ?? null,
    youtubeBannerUrl: channel.youtubeBannerUrl ?? null,
    youtubeCountry: channel.youtubeCountry ?? null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    myRole: role as "OWNER" | "EDITOR",
    youtubeConnected: channel.status === "CONNECTED",
    projectCount: visible.length,
    editorCount: memberRows.length,
  };
}

// GET /channels — the CMS grid: owned + editor mirror channels.
router.get("/channels", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rows = await db
    .select()
    .from(tandemChannelMembersTable)
    .where(eq(tandemChannelMembersTable.userId, userId));

  const channels =
    rows.length > 0
      ? await db
          .select()
          .from(tandemChannelsTable)
          .where(
            inArray(
              tandemChannelsTable.id,
              rows.map((r) => r.channelId),
            ),
          )
      : [];

  const roleById = new Map(rows.map((r) => [r.channelId, r.role]));
  const summaries = await Promise.all(
    channels.map((channel) =>
      summarizeChannel(channel, roleById.get(channel.id) ?? "EDITOR", userId),
    ),
  );
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json(ListChannelsResponse.parse(summaries));
});

// POST /channels — create a workspace channel; the creator becomes OWNER.
router.post("/channels", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = CreateChannelBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A channel name is required" });
    return;
  }

  const channelId = randomUUID();
  const [channel] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tandemChannelsTable)
      .values({
        id: channelId,
        ownerId: userId,
        status: "CREATED",
        name: body.data.name.trim(),
      })
      .returning();
    await tx.insert(tandemChannelMembersTable).values({
      id: randomUUID(),
      channelId,
      userId,
      role: "OWNER",
    });
    return [created] as const;
  });

  res.status(201).json(CreateChannelResponse.parse(await summarizeChannel(channel, "OWNER", userId)));
});

// GET /channels/:channelId — channel detail for the den chrome (owner or editor).
router.get("/channels/:channelId", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = GetChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const membership = await channelMembership(channel.id, userId);
  if (!membership) {
    res.status(403).json({ error: "You are not on this channel" });
    return;
  }

  res.json(
    GetChannelResponse.parse(await summarizeChannel(channel, membership.role, userId)),
  );
});

// PATCH /channels/:channelId — rename (owner only).
router.patch("/channels/:channelId", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = UpdateChannelParams.safeParse(req.params);
  const body = UpdateChannelBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid channel update" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (channel.ownerId !== userId) {
    res.status(403).json({ error: "Only the channel owner can update it" });
    return;
  }

  const [updated] = await db
    .update(tandemChannelsTable)
    .set({ name: body.data.name.trim(), updatedAt: new Date() })
    .where(eq(tandemChannelsTable.id, channel.id))
    .returning();

  res.json(UpdateChannelResponse.parse(await summarizeChannel(updated, "OWNER", userId)));
});

// DELETE /channels/:channelId — owner only; the channel must have no projects
// left inside it (the 409 tells the caller what to do first).
router.delete("/channels/:channelId", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = DeleteChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (channel.ownerId !== userId) {
    res.status(403).json({ error: "Only the channel owner can delete it" });
    return;
  }

  const [project] = await db
    .select({ id: tandemVideoProjectsTable.id })
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.channelId, channel.id))
    .limit(1);
  if (project) {
    res.status(409).json({
      error: "This channel still has projects — move or delete them before deleting the channel",
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(tandemChannelMembersTable)
      .where(eq(tandemChannelMembersTable.channelId, channel.id));
    await tx.delete(tandemChannelsTable).where(eq(tandemChannelsTable.id, channel.id));
  });

  res.status(204).end();
});

// GET /channels/:channelId/people — the contributor roster: owner + editors
// with resolved identities and the roles they hold across the channel.
router.get("/channels/:channelId/people", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = ListChannelPeopleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  const membership = await channelMembership(channel.id, userId);
  if (!membership) {
    res.status(403).json({ error: "You are not on this channel" });
    return;
  }

  const members = await db
    .select()
    .from(tandemChannelMembersTable)
    .where(eq(tandemChannelMembersTable.channelId, channel.id));

  // Every project in the channel + its ACTIVE member rows → roles per user.
  const projects = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.channelId, channel.id));
  const projectIds = projects.map((p) => p.id);
  const memberRows =
    projectIds.length > 0
      ? await db
          .select()
          .from(tandemVideoMembersTable)
          .where(
            and(
              inArray(tandemVideoMembersTable.projectId, projectIds),
              eq(tandemVideoMembersTable.status, "ACTIVE"),
            ),
          )
      : [];

  const rolesByUser = new Map<string, Set<string>>();
  const projectsByUser = new Map<string, Set<string>>();
  for (const row of memberRows) {
    const userRoles = rolesByUser.get(row.userId) ?? new Set<string>();
    (row.roles ?? []).forEach((role) => userRoles.add(role));
    rolesByUser.set(row.userId, userRoles);
    const userProjects = projectsByUser.get(row.userId) ?? new Set<string>();
    userProjects.add(row.projectId);
    projectsByUser.set(row.userId, userProjects);
  }
  // The channel owner captains every project they own in the channel.
  const ownerProjects = projectsByUser.get(channel.ownerId) ?? new Set<string>();
  for (const p of projects) {
    if (p.ownerId === channel.ownerId) ownerProjects.add(p.id);
  }
  projectsByUser.set(channel.ownerId, ownerProjects);
  const ownerRoles = rolesByUser.get(channel.ownerId) ?? new Set<string>();
  ownerRoles.add("CAPTAIN");
  rolesByUser.set(channel.ownerId, ownerRoles);

  const profiles = await resolveUserProfiles(members.map((m) => m.userId));

  const roster = members.map((member) => ({
    userId: member.userId,
    name: profiles[member.userId]?.name ?? null,
    imageUrl: profiles[member.userId]?.imageUrl ?? null,
    role: member.role as "OWNER" | "EDITOR",
    projectRoles: [...(rolesByUser.get(member.userId) ?? new Set<string>())],
    projectCount: projectsByUser.get(member.userId)?.size ?? 0,
  }));

  res.json(ListChannelPeopleResponse.parse(roster));
});

// POST /channels/:channelId/oauth/start — build the Google consent URL
// (owner only, PKCE state). The client opens the returned url in a new tab;
// Google redirects to /creators-den/channels/oauth/callback with code+state.
router.post(
  "/channels/:channelId/oauth/start",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = StartChannelOauthParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid channel id" });
      return;
    }

    const result = await startChannelOauth(params.data.channelId, userId);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ url: result.url, channelId: params.data.channelId });
  },
);

// POST /channels/:channelId/oauth/exchange — swap the consent code for
// tokens, bind the YouTube channel, and store encrypted credentials.
router.post(
  "/channels/:channelId/oauth/exchange",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ExchangeChannelOauthParams.safeParse(req.params);
    const body = ExchangeChannelOauthBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid link request" });
      return;
    }

    try {
      await exchangeChannelOauth(params.data.channelId, body.data.state, body.data.code);
    } catch (error) {
      req.log.warn({ err: error instanceof Error ? error.message : String(error) }, "channel oauth exchange failed");
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not link the YouTube channel" });
      return;
    }

    const [channel] = await db
      .select()
      .from(tandemChannelsTable)
      .where(eq(tandemChannelsTable.id, params.data.channelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.json(await summarizeChannel(channel, "OWNER", userId));
  },
);

// POST /channels/:channelId/oauth/disconnect — revoke + clear the vault
// (owner only). Projects, roster, and editors all stay; the card flips back
// to "Connect your YouTube channel".
router.post(
  "/channels/:channelId/oauth/disconnect",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = DisconnectChannelOauthParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid channel id" });
      return;
    }

    const result = await disconnectChannelOauth(params.data.channelId, userId);
    if (result.error) {
      res.status(403).json({ error: result.error });
      return;
    }

    const [channel] = await db
      .select()
      .from(tandemChannelsTable)
      .where(eq(tandemChannelsTable.id, params.data.channelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.json(await summarizeChannel(channel, "OWNER", userId));
  },
);

// GET /channels/:channelId/projects — the project cards for a channel home.
router.get("/channels/:channelId/projects", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = ListChannelProjectsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, params.data.channelId))
    .limit(1);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  const membership = await channelMembership(channel.id, userId);
  if (!membership) {
    res.status(403).json({ error: "You are not on this channel" });
    return;
  }

  const projects = await visibleChannelProjectRows(channel.id, userId, membership.role);
  res.json(ListChannelProjectsResponse.parse(projects));
});

export default router;
