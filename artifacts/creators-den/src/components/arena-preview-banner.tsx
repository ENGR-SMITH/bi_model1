import { Megaphone } from 'lucide-react';
import { Link } from 'wouter';
import { useListArenaPosts } from '@workspace/api-client-react';
import type { ArenaPostSummary } from '@workspace/api-client-react';
import { ARENA_ROLE_META } from '@/components/arena-apply-modal';

// ---------------------------------------------------------------------------
// ArenaPreviewBanner — the slim \"Audition preview\" strip at the top of the
// read-only window a signed-in creator gets while an OPEN role post exists on
// a project they are not a member of (viewerAccess === 'applicant'). It names
// the open role and links back to the post so the audition flow never dead-
// ends inside the preview. Rendered by the shell inside the main stage; it
// returns null once no OPEN post remains (post filled/closed → window closed).
// ---------------------------------------------------------------------------

export function ArenaPreviewBanner({ projectId }: { projectId: string }) {
  const posts = useListArenaPosts({ projectId });
  const rows = (posts.data ?? []) as ArenaPostSummary[];
  const open = rows.filter((post) => post.status === 'OPEN');

  if (posts.isLoading || open.length === 0) return null;

  const first = open[0];
  const roleLabel = ARENA_ROLE_META[first.role]?.label ?? first.role;
  const extra = open.length > 1 ? ` and ${open.length - 1} other open role${open.length > 2 ? 's' : ''}` : '';

  return (
    <div className="arena-preview-banner" data-testid="arena-preview-banner">
      <Megaphone size={13} />
      <span className="min-w-0">
        You&apos;re previewing this project to audition — apply for the <b>{roleLabel.toLowerCase()}{extra}</b> role
        while it&apos;s open. Only its timeline and preview are visible until you&apos;re hired.
      </span>
      <Link href={`/arena/posts/${first.id}`} className="arena-preview-banner-link" data-testid="arena-preview-banner-link">
        View the audition →
      </Link>
    </div>
  );
}
