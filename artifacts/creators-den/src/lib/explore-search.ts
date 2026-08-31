// ---------------------------------------------------------------------------
// Explore search matching. A query matches a creator or project when it shows
// up in the visible text OR in the underlying identities — the raw Clerk user
// id and the derived Tandem ID (TANDEM•••••) — so users are findable by the
// ID they share on their profile, not just by display name.
// ---------------------------------------------------------------------------

import { tandemUid } from '@/lib/tandem-uid';
import type { VideoCreatorSummary, VideoPublicProject } from '@workspace/api-client-react';

function normalize(rawQuery: string): string {
  return rawQuery.trim().toLowerCase();
}

/** True when a creator row matches the query (name, Clerk id, or Tandem ID). */
export function matchesCreatorQuery(creator: VideoCreatorSummary, rawQuery: string): boolean {
  const q = normalize(rawQuery);
  if (!q) return true;
  return (
    creator.displayName.toLowerCase().includes(q) ||
    creator.userId.toLowerCase().includes(q) ||
    tandemUid(creator.userId).toLowerCase().includes(q)
  );
}

/** True when a project row matches the query (name, owner, description, ids). */
export function matchesProjectQuery(project: VideoPublicProject, rawQuery: string): boolean {
  const q = normalize(rawQuery);
  if (!q) return true;
  return (
    project.name.toLowerCase().includes(q) ||
    project.ownerName.toLowerCase().includes(q) ||
    project.description.toLowerCase().includes(q) ||
    project.ownerId.toLowerCase().includes(q) ||
    tandemUid(project.ownerId).toLowerCase().includes(q)
  );
}
