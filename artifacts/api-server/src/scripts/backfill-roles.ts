// Creator Den roles backfill (M4 — role-based studios & grants). Restores the
// CAPTAIN role on every project owner whose member row lost it (e.g. a schema
// push or manual migration wiped the roles jsonb column), and dedupes role
// arrays so no member holds a role twice. Idempotent and non-destructive —
// nothing is removed, only added/normalised.
//
// Run AFTER `pnpm --filter @workspace/db push` has restored the roles column:
//
//   pnpm --filter @workspace/api-server backfill:roles
import "../env";
import { eq } from "drizzle-orm";
import { db, tandemVideoMembersTable, tandemVideoProjectsTable } from "@workspace/db";

async function main(): Promise<void> {
  const projects = await db.select().from(tandemVideoProjectsTable);

  let captainsFixed = 0;
  let deduped = 0;
  let missingMembers = 0;

  for (const project of projects) {
    const members = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(eq(tandemVideoMembersTable.projectId, project.id));

    if (members.length === 0) {
      missingMembers += 1;
      continue;
    }

    // The project owner is the Captain. Re-assert it if the row lost it.
    const owner = members.find((row) => row.userId === project.ownerId);
    if (owner) {
      const roles = owner.roles ?? [];
      if (!roles.includes("CAPTAIN")) {
        await db
          .update(tandemVideoMembersTable)
          .set({ roles: [...roles, "CAPTAIN"] })
          .where(eq(tandemVideoMembersTable.id, owner.id));
        captainsFixed += 1;
      }
    }

    // Normalise every member's role array: dedupe and drop blanks.
    for (const row of members) {
      const roles = [...new Set((row.roles ?? []).filter(Boolean))];
      if (roles.length !== (row.roles ?? []).length) {
        await db
          .update(tandemVideoMembersTable)
          .set({ roles })
          .where(eq(tandemVideoMembersTable.id, row.id));
        deduped += 1;
      }
    }
  }

  console.log(
    `Roles backfill complete: ${projects.length} project${projects.length === 1 ? "" : "s"} scanned; ` +
      `${captainsFixed} captain role${captainsFixed === 1 ? "" : "s"} restored, ` +
      `${deduped} member row${deduped === 1 ? "" : "s"} normalised, ` +
      `${missingMembers} project${missingMembers === 1 ? "" : "s"} with no member rows.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Roles backfill failed:", error);
  process.exit(1);
});
