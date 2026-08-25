import { getAuth } from "@clerk/express";
import {
  db,
  tandemVideoProjectsTable,
  tandemVideoMembersTable,
  tandemVideoFollowsTable,
  collaborationActivityEventsTable,
} from "@workspace/db";
import {
  FollowVideoUserParams,
  FollowVideoUserResponse,
  GetVideoUserContributionsParams,
  GetVideoUserContributionsResponse,
  GetVideoUserSocialParams,
  GetVideoUserSocialResponse,
  ListExploreCreatorsResponse,
  ListExploreProjectsResponse,
  ListVideoUserFollowersParams,
  ListVideoUserFollowersResponse,
  ListVideoUserFollowingParams,
  ListVideoUserFollowingResponse,
  UnfollowVideoUserParams,
  UnfollowVideoUserResponse,
} from "@workspace/api-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { randomUUID } from "node:crypto";
import { resolveUserNames, resolveUserProfiles } from "../lib/user-names";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Utc date string "YYYY-MM-DD" for a given Date. */
function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Build a GitHub-style contribution graph: contiguous daily counts from `now`
 * back `weeks * 7` days, zero-filled.
 */
function buildContributionGrid(
  daily: Map<string, number>,
  now: Date,
  weeks: number,
): { date: string; count: number }[] {
  const days: { date: string; count: number }[] = [];
  const cursor = new Date(now);
  cursor.setUTCHours(0, 0, 0, 0);
  // Start from today and walk back `weeks * 7` days (inclusive).
  for (let i = 0; i < weeks * 7; i++) {
    const key = dateKey(cursor);
    days.unshift({ date: key, count: daily.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/**
 * Resolves `isFollowing` for a target user from the viewer's perspective.
 * Returns `null` when viewing yourself (no self-follow).
 */
async function resolveFollowState(
  viewerId: string,
  targetId: string,
): Promise<boolean | null> {
  if (viewerId === targetId) return null;
  const [row] = await db
    .select()
    .from(tandemVideoFollowsTable)
    .where(
      and(
        eq(tandemVideoFollowsTable.followerId, viewerId),
        eq(tandemVideoFollowsTable.followingId, targetId),
      ),
    )
    .limit(1);
  return !!row;
}

async function getFollowCounts(targetId: string) {
  const followers = await db
    .select()
    .from(tandemVideoFollowsTable)
    .where(eq(tandemVideoFollowsTable.followingId, targetId));
  const following = await db
    .select()
    .from(tandemVideoFollowsTable)
    .where(eq(tandemVideoFollowsTable.followerId, targetId));
  return {
    followerCount: followers.length,
    followingCount: following.length,
  };
}

// ---------------------------------------------------------------------------
// Explore — discoverable creators
// ---------------------------------------------------------------------------

router.get("/video/explore/creators", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // All public projects → the owners and the active members are "creators".
  const publicProjects = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.visibility, "PUBLIC"));

  const publicProjectIds = publicProjects.map((p) => p.id);

  const ownerIds = new Set(publicProjects.map((p) => p.ownerId));
  const memberIds = new Set<string>();

  // Active members of public projects — with project ids so we can also count
  // each user's distinct public projects (the Captain is both owner and member,
  // so dedupe by project id).
  const projectIdsByUser = new Map<string, Set<string>>();
  const addProject = (uid: string, projectId: string) => {
    const set = projectIdsByUser.get(uid) ?? new Set<string>();
    set.add(projectId);
    projectIdsByUser.set(uid, set);
  };
  for (const p of publicProjects) addProject(p.ownerId, p.id);

  if (publicProjectIds.length > 0) {
    const memberships = await db
      .select({ projectId: tandemVideoMembersTable.projectId, userId: tandemVideoMembersTable.userId })
      .from(tandemVideoMembersTable)
      .where(
        and(
          inArray(tandemVideoMembersTable.projectId, publicProjectIds),
          eq(tandemVideoMembersTable.status, "ACTIVE"),
        ),
      );
    for (const m of memberships) {
      memberIds.add(m.userId);
      addProject(m.userId, m.projectId);
    }
  }

  const allCreatorIds = [...new Set([...ownerIds, ...memberIds])];

  if (allCreatorIds.length === 0) {
    res.json(ListExploreCreatorsResponse.parse([]));
    return;
  }

  const profiles = await resolveUserProfiles(allCreatorIds);

  const summaries = await Promise.all(
    allCreatorIds.map(async (uid) => {
      const c = await getFollowCounts(uid);
      const profile = profiles[uid];
      return {
        userId: uid,
        displayName: profile?.name ?? uid.slice(0, 12),
        imageUrl: profile?.imageUrl ?? null,
        publicProjectCount: projectIdsByUser.get(uid)?.size ?? 0,
        followerCount: c.followerCount,
        isFollowing: await resolveFollowState(userId, uid),
      };
    }),
  );

  // Most active (by public project count) first.
  summaries.sort((a, b) => b.publicProjectCount - a.publicProjectCount);

  res.json(ListExploreCreatorsResponse.parse(summaries));
});

// ---------------------------------------------------------------------------
// Explore — discoverable public projects
// ---------------------------------------------------------------------------

router.get("/video/explore/projects", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const projects = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.visibility, "PUBLIC"))
    .orderBy(desc(tandemVideoProjectsTable.updatedAt));

  const ownerIds = [...new Set(projects.map((p) => p.ownerId))];
  const profiles = await resolveUserProfiles(ownerIds);

  res.json(
    ListExploreProjectsResponse.parse(
      projects.map((p) => {
        const profile = profiles[p.ownerId];
        return {
          ...p,
          ownerName: profile?.name ?? p.ownerId.slice(0, 12),
          ownerImageUrl: profile?.imageUrl ?? null,
        };
      }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Follow state (counts + isFollowing)
// ---------------------------------------------------------------------------

router.get(
  "/video/users/:userId/social",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoUserSocialParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const targetId = params.data.userId;
    const counts = await getFollowCounts(targetId);
    const isFollowing = await resolveFollowState(viewerId, targetId);

    res.json(
      GetVideoUserSocialResponse.parse({
        userId: targetId,
        ...counts,
        isFollowing,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Follow / unfollow
// ---------------------------------------------------------------------------

router.post(
  "/video/users/:userId/follow",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = FollowVideoUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const targetId = params.data.userId;
    if (viewerId === targetId) {
      res.status(400).json({ error: "You cannot follow yourself" });
      return;
    }

    // idempotent — if already following, just return state.
    const [existing] = await db
      .select()
      .from(tandemVideoFollowsTable)
      .where(
        and(
          eq(tandemVideoFollowsTable.followerId, viewerId),
          eq(tandemVideoFollowsTable.followingId, targetId),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(tandemVideoFollowsTable).values({
        id: randomUUID(),
        followerId: viewerId,
        followingId: targetId,
      });
    }

    const counts = await getFollowCounts(targetId);
    res.json(
      FollowVideoUserResponse.parse({
        userId: targetId,
        ...counts,
        isFollowing: true,
      }),
    );
  },
);

router.delete(
  "/video/users/:userId/follow",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = UnfollowVideoUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const targetId = params.data.userId;
    if (viewerId === targetId) {
      res.status(400).json({ error: "You cannot unfollow yourself" });
      return;
    }

    await db
      .delete(tandemVideoFollowsTable)
      .where(
        and(
          eq(tandemVideoFollowsTable.followerId, viewerId),
          eq(tandemVideoFollowsTable.followingId, targetId),
        ),
      );

    const counts = await getFollowCounts(targetId);
    res.json(
      UnfollowVideoUserResponse.parse({
        userId: targetId,
        ...counts,
        isFollowing: false,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Followers / following lists
// ---------------------------------------------------------------------------

async function listFollowUsers(
  kind: "followers" | "following",
  targetId: string,
  viewerId: string,
) {
  const rows =
    kind === "followers"
      ? await db
          .select()
          .from(tandemVideoFollowsTable)
          .where(eq(tandemVideoFollowsTable.followingId, targetId))
      : await db
          .select()
          .from(tandemVideoFollowsTable)
          .where(eq(tandemVideoFollowsTable.followerId, targetId));

  const theirIds = [
    ...new Set(rows.map((r) => (kind === "followers" ? r.followerId : r.followingId))),
  ];
  if (theirIds.length === 0) return [];

  const profiles = await resolveUserProfiles(theirIds);
  return await Promise.all(
    theirIds.map(async (uid) => ({
      userId: uid,
      displayName: profiles[uid]?.name ?? uid.slice(0, 12),
      imageUrl: profiles[uid]?.imageUrl ?? null,
      isFollowing: await resolveFollowState(viewerId, uid),
    })),
  );
}

router.get(
  "/video/users/:userId/followers",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoUserFollowersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const entries = await listFollowUsers("followers", params.data.userId, viewerId);
    res.json(ListVideoUserFollowersResponse.parse(entries));
  },
);

router.get(
  "/video/users/:userId/following",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoUserFollowingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const entries = await listFollowUsers("following", params.data.userId, viewerId);
    res.json(ListVideoUserFollowingResponse.parse(entries));
  },
);

// ---------------------------------------------------------------------------
// Contributions graph (public-project activity over trailing ~26 weeks)
// ---------------------------------------------------------------------------

router.get(
  "/video/users/:userId/contributions",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoUserContributionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const profileUserId = params.data.userId;

    // Public project ids the user owns or participates in.
    const publicProjects = await db
      .select({ id: tandemVideoProjectsTable.id })
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.visibility, "PUBLIC"));

    const publicProjectIds = publicProjects.map((p) => p.id);
    if (publicProjectIds.length === 0) {
      res.json(
        GetVideoUserContributionsResponse.parse({
          total: 0,
          days: [],
        }),
      );
      return;
    }

    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 26 * 7); // ~26 weeks

    const events = await db
      .select()
      .from(collaborationActivityEventsTable)
      .where(
        and(
          eq(collaborationActivityEventsTable.actorId, profileUserId),
          inArray(collaborationActivityEventsTable.projectId, publicProjectIds),
        ),
      );

    // Filter the older end in JS (sqlite `>=` on timestamps works differently
    // from PG; filtering client-side keeps both backends aligned).
    const filtered = events.filter((e) => e.createdAt >= fromDate);

    // Aggregate per day.
    const daily = new Map<string, number>();
    for (const e of filtered) {
      const key = dateKey(e.createdAt);
      daily.set(key, (daily.get(key) ?? 0) + 1);
    }

    const days = buildContributionGrid(daily, now, 26);
    const total = [...daily.values()].reduce((a, b) => a + b, 0);

    res.json(GetVideoUserContributionsResponse.parse({ total, days }));
  },
);

export default router;