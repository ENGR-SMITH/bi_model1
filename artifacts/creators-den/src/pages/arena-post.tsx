import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Megaphone,
  Users,
  X,
} from 'lucide-react';
import {
  getGetArenaPostQueryKey,
  getListArenaPostApplicationsQueryKey,
  getListArenaPostsQueryKey,
  useAcceptArenaApplication,
  useGetArenaPost,
  useListArenaPostApplications,
  useListMyArenaApplications,
  useRejectArenaApplication,
  useUpdateArenaPost,
  useWithdrawArenaApplication,
} from '@workspace/api-client-react';
import type { ArenaApplication, ArenaPostDetail } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import {
  ARENA_ROLE_META,
  ApplyArenaModal,
  ArenaRoleTag,
  timeAgo,
} from '@/components/arena-apply-modal';
import { ArenaRoleWatchMenu, SharePostButton } from '@/components/arena-watch';
import { ReviewCta } from '@/components/arena-review-modal';

// ---------------------------------------------------------------------------
// Arena post detail — one role post.
//
// Audition view (everyone): the pitch, project/channel/poster summary, the
// LIVE applicant count, a read-only "Preview project" link (open while the
// post is OPEN), and the Apply modal. A PENDING applicant can withdraw; the
// Captain sees the full audition list with Accept / Reject + portfolio links,
// plus Close / Reopen controls and the total application history.
// ---------------------------------------------------------------------------

type StatusChip = 'OPEN' | 'FILLED' | 'CLOSED';

const STATUS_META: Record<StatusChip, { label: string; tone: string }> = {
  OPEN: { label: 'Open for auditions', tone: 'accent' },
  FILLED: { label: 'Filled', tone: 'teal' },
  CLOSED: { label: 'Closed', tone: 'muted' },
};

export default function ArenaPostPage() {
  const params = useParams<{ postId: string }>();
  const postId = params.postId ?? '';
  const { user } = useUser();
  const queryClient = useQueryClient();

  const postQuery = useGetArenaPost(postId, {
    query: { queryKey: getGetArenaPostQueryKey(postId), enabled: Boolean(postId) },
  });
  const post = (postQuery.data ?? null) as ArenaPostDetail | null;
  const [applyOpen, setApplyOpen] = useState(false);

  const isCaptain = Boolean(post && user && post.postedBy === user.id);
  const applications = useListArenaPostApplications(postId, {
    query: {
      queryKey: getListArenaPostApplicationsQueryKey(postId),
      enabled: isCaptain && Boolean(postId),
    },
  });
  const appRows = (applications.data ?? []) as ArenaApplication[];

  const refreshPost = () => {
    void queryClient.invalidateQueries({ queryKey: getGetArenaPostQueryKey(postId) });
    void queryClient.invalidateQueries({ queryKey: getListArenaPostApplicationsQueryKey(postId) });
    // The board refetches on mount anyway; this keeps it honest when it is live.
    void queryClient.invalidateQueries({ queryKey: getListArenaPostsQueryKey() });
  };

  if (postQuery.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the audition…</div></div>;
  }
  if (!post) {
    return (
      <div className="page">
        <div className="empty-state" data-testid="arena-post-missing">
          <Megaphone size={22} />
          <h3>This audition is gone.</h3>
          <p>The post may have been removed, or the link is wrong.</p>
          <Link href="/arena" className="primary-btn mt-4">Back to the arena</Link>
        </div>
      </div>
    );
  }

  const meta = ARENA_ROLE_META[post.role];
  const statusMeta = STATUS_META[post.status as StatusChip];
  const mine = post.myApplication;
  const canReviewHire = post.status === 'FILLED' && mine === 'accepted';
  // PENDING and ACCEPTED applicants are already in the running; a REJECTED
  // applicant can audition again (the server frees the seat on rejection).
  const canApply = post.status === 'OPEN' && !isCaptain && mine !== 'pending' && mine !== 'accepted';
  const isApplicant = mine === 'pending' || mine === 'accepted';

  return (
    <div className="page arena-post-page">
      <Link href="/arena" className="arena-back" data-testid="arena-back">
        <ArrowLeft size={14} /> Back to the arena
      </Link>

      <div className="page-header">
        <div>
          <SectionEyebrow>Collaboration / Audition Arena</SectionEyebrow>
          <div className="arena-post-titleline">
            <h1>We need a {meta.roleLabel.toLowerCase()}.</h1>
            <ArenaRoleTag role={post.role} dataTestId="arena-post-role" />
            <span className={`den-tag ${statusMeta.tone}`} data-testid="arena-post-status">{statusMeta.label}</span>
          </div>
          <p>
            {post.channelName} · “{post.projectName}” · posted by {post.posterName} {timeAgo(post.createdAt)}
          </p>
        </div>
      </div>

      {/* Hero: the pitch + live count + actions. */}
      <div className="paper-card arena-hero" data-testid="arena-post-hero">
        <div className="arena-hero-main">
          <p className="arena-hero-blurb">{meta.blurb}</p>
          <p className="arena-hero-pitch">{post.pitch}</p>

          <div className="arena-hero-facts">
            <span className="arena-fact">
              <span className="arena-fact-label">Project</span>
              <b>{post.projectName}</b>
            </span>
            <span className="arena-fact">
              <span className="arena-fact-label">Channel</span>
              <b>{post.channelName}</b>
            </span>
            <span className="arena-fact">
              <span className="arena-fact-label">Posted by</span>
              <b className="arena-fact-poster">
                {post.posterImageUrl ? <img src={post.posterImageUrl} alt="" /> : null}
                {post.posterName}
              </b>
            </span>
          </div>

          {post.status === 'FILLED' && (
            <p className="arena-filled-note" data-testid="arena-filled-note">
              <CheckCircle2 size={14} /> This role has been filled — the seat is taken.
            </p>
          )}
          {post.status === 'CLOSED' && (
            <p className="arena-closed-note" data-testid="arena-closed-note">
              <Clock size={14} /> This audition is closed. Pending applicants were kept on the list in case the Captain reopens it.
            </p>
          )}
        </div>

        <div className="arena-hero-side">
          <div className="arena-count-big" data-testid="arena-post-count">
            {post.applicantCount === 0 ? (
              <>
                <b>Be the first</b>
                <span>to audition for this role</span>
              </>
            ) : (
              <>
                <b>{post.applicantCount}</b>
                <span>
                  {post.applicantCount === 1 ? 'creator has already' : 'creators have already'} applied{isApplicant ? ' — you’re one of them' : ''}
                </span>
              </>
            )}
          </div>
          {isCaptain && (
            <span className="den-tag muted" data-testid="arena-total-applications">
              {post.totalApplications} total application{post.totalApplications === 1 ? '' : 's'} received
            </span>
          )}

          <div className="arena-actions">
            <Link href={`/projects/${post.projectId}`} className="secondary-btn" data-testid="arena-preview-project">
              <Eye size={14} /> Preview project
            </Link>
            {canApply && (
              <button type="button" className="primary-btn" onClick={() => setApplyOpen(true)} data-testid="button-arena-open-apply">
                Apply for this role
              </button>
            )}
            {mine === 'pending' && post.status === 'OPEN' && (
              <WithdrawButton postId={post.id} onDone={refreshPost} />
            )}
            {mine === 'pending' && post.status !== 'OPEN' && (
              <span className="den-tag muted">Your audition is on this post</span>
            )}
            {mine === 'accepted' && (
              <span className="den-tag teal" data-testid="arena-hired-chip">You were hired for this role</span>
            )}
            {canReviewHire && (
              <HireReviewCta
                postId={post.id}
                captainId={post.postedBy}
                captainName={post.posterName}
                roleLabel={meta.roleLabel}
                projectName={post.projectName}
              />
            )}
          </div>
          <div className="arena-actions-secondary">
            <SharePostButton postId={post.id} />
            <ArenaRoleWatchMenu
              role={post.role}
              channelId={post.channelId}
              channelName={post.channelName}
              dataTestId="arena-watch-menu"
            />
          </div>
          {canApply && (
            <p className="arena-apply-hint">
              {mine === 'rejected'
                ? 'Your earlier audition was declined — the Captain can still hire you. You are welcome to audition again.'
                : 'While this audition is open, you can preview the project read-only — its timeline and preview only.'}
            </p>
          )}
        </div>
      </div>

      {isCaptain && (
        <CaptainPanel
          post={post}
          applications={appRows}
          loading={applications.isLoading}
          onChanged={refreshPost}
        />
      )}

      {applyOpen && canApply && (
        <ApplyArenaModal
          postId={post.id}
          role={post.role}
          projectName={post.projectName}
          channelName={post.channelName}
          onClose={() => setApplyOpen(false)}
          onApplied={() => {
            setApplyOpen(false);
            refreshPost();
          }}
        />
      )}
    </div>
  );
}

// Withdraw — two-step: the first click arms it, the second confirms. The
// application id comes from the caller's own My-Auditions list (the post
// summary only carries the state, not the row id).
function WithdrawButton({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [arming, setArming] = useState(false);
  const mine = useListMyArenaApplications();
  const mineApp = (mine.data ?? []).find(
    (app) => app.postId === postId && app.status === 'PENDING',
  );

  const withdraw = useWithdrawArenaApplication({
    mutation: {
      onSuccess: () => {
        setArming(false);
        onDone();
      },
    },
  });

  return (
    <button
      type="button"
      className={`secondary-btn arena-withdraw ${arming ? 'is-armed' : ''}`}
      onClick={() => {
        if (!arming) {
          setArming(true);
          return;
        }
        if (mineApp) withdraw.mutate({ applicationId: mineApp.id });
      }}
      disabled={withdraw.isPending || !mineApp}
      data-testid="button-arena-withdraw"
    >
      <X size={14} /> {withdraw.isPending ? 'Withdrawing…' : arming ? 'Confirm withdraw?' : 'Withdraw audition'}
    </button>
  );
}

// The hired creator's side of the mutual review: find their ACCEPTED row for
// this post (My Auditions carries the id; the post summary only has the state)
// and hand it to the shared ReviewCta pointing at the Captain.
function HireReviewCta({
  postId,
  captainId,
  captainName,
  roleLabel,
  projectName,
}: {
  postId: string;
  captainId: string;
  captainName: string;
  roleLabel: string;
  projectName: string;
}) {
  const mine = useListMyArenaApplications();
  const rows = (mine.data ?? []) as ArenaApplication[];
  const accepted = rows.find((app) => app.postId === postId && app.status === 'ACCEPTED');
  if (!accepted) return null;
  return (
    <ReviewCta
      applicationId={accepted.id}
      revieweeId={captainId}
      revieweeName={captainName || 'the Captain'}
      roleLabel={roleLabel}
      projectName={projectName}
      ctaLabel="Review the Captain"
      testIdPrefix="hire"
    />
  );
}

// Captain panel — the full audition list with decisions.
function CaptainPanel({
  post,
  applications,
  loading,
  onChanged,
}: {
  post: ArenaPostDetail;
  applications: ArenaApplication[];
  loading: boolean;
  onChanged: () => void;
}) {
  const updatePost = useUpdateArenaPost({
    mutation: { onSuccess: onChanged },
  });
  const pending = applications.filter((app) => app.status === 'PENDING');
  const hire = applications.find((app) => app.status === 'ACCEPTED');

  return (
    <section className="arena-captain-panel" data-testid="arena-captain-panel">
      {/* Fill state banner: the seat went to the ACCEPTED hire and every other
          PENDING audition was auto-declined by the accept transaction. */}
      {post.status === 'FILLED' && hire && (
        <div className="arena-fill-banner" data-testid="arena-fill-banner">
          <CheckCircle2 size={14} />
          <span className="min-w-0">
            Role filled by{' '}
            <Link href={`/profile/${hire.applicantId}`} className="arena-fill-hire" data-testid="arena-fill-hire-link">
              {hire.applicantName ?? 'Creator'}
            </Link>{' '}
            — the remaining auditions were declined. You can review the hire below.
          </span>
        </div>
      )}
      <div className="arena-section-head">
        <div>
          <span className="eyebrow">Captain view</span>
          <h2>
            {pending.length > 0
              ? `${pending.length} creator${pending.length === 1 ? '' : 's'} auditioning now.`
              : 'No pending auditions.'}
          </h2>
        </div>
        {post.status === 'OPEN' ? (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => updatePost.mutate({ postId: post.id, data: { status: 'CLOSED' } })}
            disabled={updatePost.isPending}
            data-testid="button-arena-close"
          >
            <Clock size={14} /> Close auditions
          </button>
        ) : post.status === 'CLOSED' ? (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => updatePost.mutate({ postId: post.id, data: { status: 'OPEN' } })}
            disabled={updatePost.isPending}
            data-testid="button-arena-reopen"
          >
            Reopen auditions
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="panel-empty">Loading auditions…</div>
      ) : applications.length === 0 ? (
        <div className="empty-state" data-testid="arena-applications-empty">
          <Users size={20} />
          <h3>No auditions yet.</h3>
          <p>Share the post link to start collecting applicants.</p>
        </div>
      ) : (
        <div className="den-stack" data-testid="arena-applications-list">
          {applications.map((application) => (
            <ApplicationRow key={application.id} post={post} application={application} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}

function ApplicationRow({
  post,
  application,
  onChanged,
}: {
  post: ArenaPostDetail;
  application: ArenaApplication;
  onChanged: () => void;
}) {
  const accept = useAcceptArenaApplication({ mutation: { onSuccess: onChanged } });
  const reject = useRejectArenaApplication({ mutation: { onSuccess: onChanged } });
  const pending = application.status === 'PENDING';
  const busy = accept.isPending || reject.isPending;
  // Once a post is FILLED the Captain may review the hire — exactly once.
  const reviewable = post.status === 'FILLED' && application.status === 'ACCEPTED';

  const decisionLabel: Record<ArenaApplication['status'], { label: string; tone: string }> = {
    PENDING: { label: 'Auditioning now', tone: 'accent' },
    ACCEPTED: { label: 'Accepted — on the team', tone: 'teal' },
    REJECTED: { label: 'Declined', tone: 'muted' },
    WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
  };

  return (
    <div className="arena-app-row" data-testid={`arena-application-${application.id}`}>
      <span className="arena-app-avatar" aria-hidden>
        {application.applicantImageUrl ? (
          <img src={application.applicantImageUrl} alt="" />
        ) : (
          (application.applicantName ?? 'C').slice(0, 1).toUpperCase()
        )}
      </span>
      <div className="arena-app-body min-w-0">
        <div className="arena-app-topline">
          <b>{application.applicantName ?? 'Creator'}</b>
          <span className={`den-tag ${decisionLabel[application.status].tone}`} data-testid={`arena-app-status-${application.id}`}>
            {decisionLabel[application.status].label}
          </span>
          {pending && (
            <Link href={`/profile/${application.applicantId}`} className="arena-app-portfolio" data-testid={`arena-app-portfolio-${application.id}`}>
              View portfolio <ExternalLink size={11} />
            </Link>
          )}
        </div>
        <p className="arena-app-message">{application.message}</p>
        {application.files.length > 0 && (
          <div className="arena-doc-row">
            {application.files.map((file) => (
              <a
                key={file.id}
                href={`/api/video/arena/applications/${application.id}/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="arena-doc-chip"
                data-testid={`arena-app-file-${file.id}`}
              >
                <FileText size={12} /> {file.fileName}
              </a>
            ))}
          </div>
        )}
        {application.status !== 'PENDING' && application.decidedAt && (
          <p className="arena-app-decided">
            Decided {timeAgo(application.decidedAt)}
            {application.status === 'REJECTED' ? ' — this seat went to someone else.' : ''}
            {application.status === 'WITHDRAWN' ? ' — the applicant stepped back.' : ''}
          </p>
        )}
      </div>
      {pending ? (
        <div className="arena-app-actions">
          <button
            type="button"
            className="secondary-btn arena-accept"
            onClick={() => accept.mutate({ applicationId: application.id })}
            disabled={busy}
            data-testid={`button-arena-accept-${application.id}`}
          >
            <Check size={14} /> {accept.isPending ? 'Hiring…' : 'Accept'}
          </button>
          <button
            type="button"
            className="secondary-btn arena-decline"
            onClick={() => reject.mutate({ applicationId: application.id })}
            disabled={busy}
            data-testid={`button-arena-reject-${application.id}`}
          >
            <X size={14} /> {reject.isPending ? 'Declining…' : 'Reject'}
          </button>
        </div>
      ) : reviewable ? (
        <div className="arena-app-actions">
          <ReviewCta
            applicationId={application.id}
            revieweeId={application.applicantId}
            revieweeName={application.applicantName ?? 'this creator'}
            roleLabel={ARENA_ROLE_META[post.role]?.roleLabel ?? post.role}
            projectName={post.projectName}
            testIdPrefix={`captain-${application.id}`}
          />
        </div>
      ) : null}
    </div>
  );
}
