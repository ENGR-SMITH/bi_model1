import { and, eq } from "drizzle-orm";
import {
  db,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemVideoMember,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Project access — the single source of truth for who may read a Creator Den
// project.
//
//   member  — an ACTIVE member: full read + write (writes still gate on the
//             member's roles in each route).
//   public  — not a member, but the project is PUBLIC: read-only access to
//             the preview + timeline data (no writes, no crew chat).
//   null    — no access (private project, or the project does not exist).
//
// Writes must keep using `requireMember`-style checks so a public viewer can
// never mutate anything; this resolver only widens *reads* for PUBLIC
// projects so search results can open read-only.
// ---------------------------------------------------------------------------

export type ProjectAccess =
  | { kind: "member"; member: TandemVideoMember }
  | { kind: "public" }
  | null;

export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const [project] = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const [member] = await db
    .select()
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.projectId, projectId),
        eq(tandemVideoMembersTable.userId, userId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (member) return { kind: "member", member };

  // A non-member may only read projects the Captain marked PUBLIC.
  if (project.visibility === "PUBLIC") return { kind: "public" };
  return null;
}
