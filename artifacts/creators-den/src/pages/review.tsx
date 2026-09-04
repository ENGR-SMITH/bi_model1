import { useState } from 'react';
import { useUser } from '@clerk/react';
import { ArrowLeft, GitPullRequest, Inbox, ShieldCheck, Sparkles } from 'lucide-react';
import {
  getListVideoReviewQueueQueryKey,
  useListVideoProjects,
  useListVideoReviewQueue,
} from '@workspace/api-client-react';
import type { VideoReviewQueueItem, VideoSubmission } from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { ReviewPanel } from '@/components/review-panel';
import { ReviewDecisionCard, ReviewOracleCard } from '@/components/review-actions';
import { SubmissionOverview } from '@/components/submission-overview';
import { useRealtimeNotifications } from '@/lib/realtime';

// ---------------------------------------------------------------------------
// Review — the Captain's review desk (captains only). A notification-style
// queue of every pending (SUBMITTED) leg submission across the Captain's
// projects; clicking one opens the full review surface — the media, pins,
// comments, and diff — with two cards under it: big Accept / Reject and the
// Editor's oracle improvement note (AI polishes grammar + phrasing only).
// ---------------------------------------------------------------------------

const LEG_TONES: Record<string, string> = {
  SELECTS: 'gold',
  CUT: 'accent',
  SOUND: 'teal',
  FINISH: 'muted',
  THUMBNAIL: 'accent',
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ReviewPage() {
  const { user } = useUser();
  const projects = useListVideoProjects();
  const queue = useListVideoReviewQueue({
    query: { queryKey: getListVideoReviewQueueQueryKey() },
  });
  useRealtimeNotifications();

  const [selected, setSelected] = useState<VideoReviewQueueItem | null>(null);
  const [note, setNote] = useState('');

  // Only Captains get the desk: the queue is built from the viewer's OWNED
  // projects (server-side), and the UI gates on owning at least one.
  const isCaptain = (projects.data ?? []).some((project) => project.ownerId === user?.id);
  const items = (queue.data ?? []) as VideoReviewQueueItem[];
  const current = selected ? (items.find((item) => item.id === selected.id) ?? selected) : null;
  // The queue row carries every field ReviewPanel reads from a submission
  // (leg/status/timelineVersionId/note/id/submittedById) — the extra decision
  // fields are absent from the summary, so narrow the type for the panel.
  const reviewSubmission = current as unknown as VideoSubmission;

  // Everyone else sees their own submissions: what they handed in, whether it
  // is awaiting the Captain, approved, or sent back with the improvement note —
  // plus the relay-flow tree of the project timeline on the side.
  if (!isCaptain) {
    return <SubmissionOverview />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow><ShieldCheck size={13} /> Review desk · captains only</SectionEyebrow>
          <h1>Every hand-off, one desk.</h1>
          <p>
            When a leg is submitted for review it lands here. Open it, mark what to fix with the
            Editor&apos;s oracle, then Accept (merges to the timeline) or Reject (sent back with your note).
          </p>
        </div>
        {!current && (
          <span className="den-tag muted" data-testid="review-queue-count">
            {items.length} pending
          </span>
        )}
      </div>

      {current ? (
        <div className="review-workbench" data-testid="review-workbench">
          <button type="button" className="link-btn mb-3" onClick={() => setSelected(null)} data-testid="review-back">
            <ArrowLeft size={13} /> Back to the queue
          </button>

          <ReviewPanel
            projectId={current.projectId}
            submission={reviewSubmission}
            headVersionId={current.headVersionId}
            onClose={() => setSelected(null)}
            hideDecision
          />

          {/* Instead of the version carousel: two cards — the Editor's oracle
              improvement note and the big green Accept / red Reject. */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ReviewOracleCard note={note} onChange={setNote} />
            <ReviewDecisionCard
              projectId={current.projectId}
              submissionId={current.id}
              note={note}
              onDecided={() => {
                setSelected(null);
                setNote('');
              }}
            />
          </div>
        </div>
      ) : queue.isLoading ? (
        <div className="panel-empty">Opening the review desk…</div>
      ) : items.length === 0 ? (
        <div className="empty-state" data-testid="review-queue-empty">
          <Inbox size={22} />
          <h3>No submissions waiting.</h3>
          <p>
            When someone in your crew submits a leg — video, audio, script, thumbnail, or finish —
            it appears here for you to accept or reject.
          </p>
        </div>
      ) : (
        <div className="paper-card" data-testid="review-queue">
          <div className="den-stack">
            {items.map((item) => {
              const legMeta = RELAY_LEGS.find((leg) => leg.leg === item.leg);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="list-row"
                  onClick={() => {
                    setSelected(item);
                    setNote('');
                  }}
                  data-testid={`review-item-${item.id}`}
                >
                  <span className={`den-tag ${LEG_TONES[item.leg] ?? 'muted'}`}>
                    {legMeta?.label ?? item.leg}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="truncate">{item.projectName}</b>
                    <small>
                      {item.submittedByName ?? item.submittedById.slice(0, 8)} · {timeAgo(item.createdAt)}
                      {item.note ? ` — “${item.note.slice(0, 90)}”` : ''}
                    </small>
                  </span>
                  <span className="den-tag gold"><GitPullRequest size={11} /> Review</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!current && (
        <p className="den-footnote mt-6">
          <Sparkles size={13} />
          The oracle only improves grammar and phrasing — the improvement note stays yours.
        </p>
      )}
    </div>
  );
}
