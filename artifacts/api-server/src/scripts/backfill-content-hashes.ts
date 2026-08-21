// One-time content-addressing backfill (VCS design §6 — "Media = Git LFS"):
// hashes legacy vault files that predate content addressing so identical
// re-uploads dedupe against them. Non-destructive — nothing is deleted.
//
//   pnpm --filter @workspace/api-server backfill:hashes
import "../env";
import { backfillContentHashes } from "../video/content-address";
import { uploadDir } from "../video/worker";

async function main(): Promise<void> {
  const result = await backfillContentHashes(uploadDir());
  const summary =
    `${result.legacy} legacy asset${result.legacy === 1 ? "" : "s"} found; ` +
    `${result.hashed} hashed, ` +
    `${result.missingFiles} skipped (file missing on disk)`;
  console.log(`Content-hash backfill complete: ${summary}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Content-hash backfill failed:", error);
  process.exit(1);
});
