// Disk-consolidation follow-up to the content-hash backfill (VCS design §6 —
// "Media = Git LFS"): after backfilling, identical legacy copies still occupy
// disk. This pass keeps the earliest copy of each content hash and deletes the
// duplicates, repointing every asset_files/asset row at the kept blob.
//
// DRY-RUN BY DEFAULT — nothing is deleted or rewritten without --apply:
//
//   pnpm --filter @workspace/api-server consolidate:hashes          # preview
//   pnpm --filter @workspace/api-server consolidate:hashes --apply  # actually consolidate
import "../env";
import { consolidateContentHashes } from "../video/content-address";
import { uploadDir } from "../video/worker";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const result = await consolidateContentHashes(uploadDir(), { dryRun: !apply });
  const unit = apply ? "freed" : "would free";
  console.log(
    `Content-hash consolidation (${apply ? "applied" : "dry-run — nothing changed"}): ` +
      `${result.hashes} duplicate hash${result.hashes === 1 ? "" : "es"} found; ` +
      `${result.rowsRepointed} file row${result.rowsRepointed === 1 ? "" : "s"} and ` +
      `${result.assetsRepointed} asset${result.assetsRepointed === 1 ? "" : "s"} ` +
      `${apply ? "repointed" : "would be repointed"}; ` +
      `${result.bytesReclaimed.toLocaleString()} bytes ${unit}; ` +
      `${result.filesDeleted} file${result.filesDeleted === 1 ? "" : "s"} deleted; ` +
      `${result.missingFiles} skipped (file missing on disk).`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Content-hash consolidation failed:", error);
  process.exit(1);
});
