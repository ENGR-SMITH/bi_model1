import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileText, Megaphone, X } from 'lucide-react';
import {
  getGetArenaPostQueryKey,
  getListMyArenaApplicationsQueryKey,
  useGetArenaPost,
  useListMyArenaApplications,
  useWithdrawArenaApplication,
} from '@workspace/api-client-react';
import type { ArenaApplication, ArenaPostDetail } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import {
  ARENA_ROLE_META,
  ArenaRoleTag,
  timeAgo,
} from '@/components/arena-apply-modal';

// ---------------------------------------------------------------------------
// My Auditions — the caller's own audition history across every post, newest
// first, grouped into status tabs (All / Pending / Accepted / Declined /
// Withdrawn). Each row names the project + channel it was for (resolved from
// the post, which is readable by any signed-in user in every status), shows
// the documents it carried, and lets a PENDING audition be withdrawn.
// ---------------------------------------------------------------------------

type TabKey = 'all' | ArenaApplication['status'];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'REJECTED', label: 'Declined' },
  { key: 'WITHDRAWN', label: 'Withdrawn' },
];

const STATUS_META: Record<ArenaApplication['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Auditioning now', tone: 'accent' },
  ACCEPTED: { label: 'Accepted — on the team', tone: 'teal' },
  REJECTED: { label: 'Declined', tone: 'muted' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
};

export default function ArenaMinePage() {
  const mine = useListMyArenaApplications();
  const [tab, setTab] = useState<TabKey>('all');
  const rows = (mine.data ?? []) as ArenaApplication[];

  const visible = tab === 'all' ? rows : rows.filter((row) => row.status === tab);
  const countFor = (key: TabKey) =>
    key === 'all' ? rows.length : rows.filter((row) => row.status === key).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>My Auditions</SectionEyebrow>
          <h1>Where you put your name in.</h1>
          <p>
            Every audition you&apos;ve sent across the Arena, newest first — pending, hired, declined, or withdrawn.
            Pending auditions can be pulled at any time.
          </p>
        </div>
        <Link href="/arena" className="secondary-btn" data-testid="mine-back-board">
          <ArrowLeft size={14} /> Back to the arena
        </Link>
      </div>

      <div className="role-tabs arena-mine-tabs" role="group" aria-label="Filter your auditions" data-testid="mine-tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
            data-testid={`mine-tab-${key.toLowerCase()}`}
          >
            {label}
            <span className="leg-badge">{countFor(key)}</span>
          </button>
        ))}
      </div>

      {mine.isLoading ? (
        <div className="panel-empty">Opening your auditions…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="mine-empty">
          <Megaphone size={22} />
          <h3>No auditions yet.</h3>
          <p>When you audition for an open role on the arena, it shows up here with its live status.</p>
          <Link href="/arena" className="primary-btn mt-3">
            Browse open auditions <ArrowRight size={14} />
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state" data-testid={`mine-empty-${tab.toLowerCase()}`}>
          <Megaphone size={20} />
          <h3>Nothing {tab.toLowerCase()} here.</h3>
          <p>Switch tabs to see your other auditions.</p>
        </div>
      ) : (
        <div className="den-stack" data-testid="mine-list">
          {visible.map((application) => (
            <MineAuditionRow key={application.id} application={application} />
          ))}
        </div>
      )}

      <p className="den-footnote mt-6">
        Withdrawing a pending audition drops the live applicant count on that post and lets the Captain know.
      </p>
    </div>
  );
}

function MineAuditionRow({ application }: { application: ArenaApplication }) {
  const [arming, setArming] = useState(false);
  const queryClient = useQueryClient();

  // The application row carries post/project ids only — the post detail names
  // the project + channel and is readable in every status by any signed-in
  // user, so a quick per-row lookup completes the story.
  const postInfo = useGetArenaPost(application.postId, {
    query: {
      queryKey: getGetArenaPostQueryKey(application.postId),
      enabled: Boolean(application.postId),
    },
  });
  const post = (postInfo.data ?? null) as ArenaPostDetail | null;

  const withdraw = useWithdrawArenaApplication({
    mutation: {
      onSuccess: () => {
        setArming(false);
        void queryClient.invalidateQueries({ queryKey: getListMyArenaApplicationsQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetArenaPostQueryKey(application.postId),
        });
      },
    },
  });

  const status = STATUS_META[application.status];
  const meta = ARENA_ROLE_META[application.role];

  // A declined row whose post was FILLED lost the seat to the accepted hire —
  // name them on the chip + meta line instead of a bare "Declined".
  const lostToHire =
    application.status === 'REJECTED' && post?.status === 'FILLED' && post.filledBy ? post.filledBy : null;

  return (
    <div className="arena-app-row" data-testid={`mine-application-${application.id}`}>
      <span className="arena-app-avatar" aria-hidden>
        {post?.channelAvatarUrl ? <img src={post.channelAvatarUrl} alt="" /> : 'A'}
      </span>
      <div className="arena-app-body min-w-0">
        <div className="arena-app-topline">
          <ArenaRoleTag role={application.role} />
          <Link href={`/arena/posts/${application.postId}`} className="min-w-0 text-left" data-testid={`mine-post-${application.postId}`}>
            <b className="block truncate">{post?.projectName ?? 'Project'}</b>
            <small className="block truncate" style={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}>
              {post ? `${post.channelName} · posted by ${post.posterName}` : ''}
            </small>
          </Link>
          <span
            className={`den-tag ${status.tone}`}
            data-testid={`mine-status-${application.id}`}
            title={
              application.status === 'ACCEPTED'
                ? 'This role is filled — the seat is yours.'
                : lostToHire
                  ? `This role was filled by ${lostToHire.name}.`
                  : undefined
            }
          >
            {/* The ACCEPTED row is the fill: the post is no longer open and the
                caller is the hire, so the chip reads as the fill state (§6.5).
                A declined row whose post is FILLED names who got the seat. */}
            {application.status === 'ACCEPTED'
              ? 'Role filled by you'
              : lostToHire
                ? `Role filled by ${lostToHire.name}`
                : status.label}
          </span>
        </div>

        {application.message && (
          <p className="arena-app-message">{application.message}</p>
        )}

        <div className="arena-mine-meta">
          <span>{meta.roleLabel} · applied {timeAgo(application.createdAt)}</span>
          {application.status === 'ACCEPTED' && (
            <span>· the {meta.roleLabel.toLowerCase()} seat is yours</span>
          )}
          {lostToHire ? (
            <span>
              · the {meta.roleLabel.toLowerCase()} seat went to{' '}
              <Link
                href={`/profile/${lostToHire.id}`}
                className="arena-mine-hire-link"
                data-testid={`mine-hire-${application.id}`}
              >
                {lostToHire.name}
              </Link>
            </span>
          ) : (
            application.status !== 'ACCEPTED' &&
            application.decidedAt && <span>· decided {timeAgo(application.decidedAt)}</span>
          )}
        </div>

        {application.files.length > 0 && (
          <div className="arena-doc-row">
            {application.files.map((file) => (
              <a
                key={file.id}
                href={`/api/video/arena/applications/${application.id}/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="arena-doc-chip"
                data-testid={`mine-file-${file.id}`}
              >
                <FileText size={12} /> {file.fileName}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="arena-app-actions">
        {application.status === 'PENDING' && (
          <button
            type="button"
            className={`secondary-btn arena-withdraw ${arming ? 'is-armed' : ''}`}
            onClick={() => {
              if (!arming) {
                setArming(true);
                return;
              }
              withdraw.mutate({ applicationId: application.id });
            }}
            disabled={withdraw.isPending}
            data-testid={`mine-withdraw-${application.id}`}
          >
            <X size={13} />
            {withdraw.isPending ? 'Withdrawing…' : arming ? 'Confirm withdraw?' : 'Withdraw'}
          </button>
        )}
      </div>
    </div>
  );
}
