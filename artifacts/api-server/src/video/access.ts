import { and, eq } from "drizzle-orm";
import {
  db,
  tandemArenaPostsTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemVideoMember,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Project access — the single source of truth for who may read a Creator Den
// project.
//
//   member     — an ACTIVE member: full read + write (writes still gate on the
//                member's roles in each route).
//   public     — not a member, but the project is PUBLIC: read-only access to
//                the preview + timeline data (no writes, no crew chat).
//   applicant  — not a member of a (possibly PRIVATE) project that currently
//                has an OPEN Arena post: the same read-only preview + timeline
//                surface PUBLIC viewers get, but only while the audition is
//                open (the Arena audition window). Resolves after `public` so
//                PUBLIC projects keep reporting as `public`.
//   null       — no access (private project with no open audition, or the
//                project does not exist).
//
// Writes must keep using `requireMember`-style checks so a public viewer or
// Arena applicant can never mutate anything; this resolver only widens *reads*
// for PUBLIC projects and for projects with an open audition.
// ---------------------------------------------------------------------------

export type ProjectAccess =
  | { kind: "member"; member: TandemVideoMember }
  | { kind: "public" }
  | { kind: "applicant" }
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

  // A non-member may only read projects the Captain marked PUBLIC...
  if (project.visibility === "PUBLIC") return { kind: "public" };

  // ...or a project with an OPEN Arena audition (the read-only preview window
  // closes the moment the post is filled or closed).
  const [openPost] = await db
    .select({ id: tandemArenaPostsTable.id })
    .from(tandemArenaPostsTable)
    .where(
      and(
        eq(tandemArenaPostsTable.projectId, projectId),
        eq(tandemArenaPostsTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (openPost) return { kind: "applicant" };

  return null;
}
