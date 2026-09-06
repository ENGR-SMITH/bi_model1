import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { ChevronRight, GitPullRequest, Inbox, ShieldCheck, Sparkles } from 'lucide-react';
import { useParams } from 'wouter';
import {
  getListVideoReviewQueueQueryKey,
  useListVideoProjects,
  useListVideoReviewQueue,
} from '@workspace/api-client-react';
import type { VideoReviewQueueItem, VideoSubmission } from '@workspace/api-client-react';
import { SectionEyebrow, RELAY_LEGS } from '@/components/shell';
import { CaptainReviewSurface } from '@/components/captain-review';
import { SubmissionOverview } from '@/components/submission-overview';

// ---------------------------------------------------------------------------
// Review — the review page, reachable two ways:
//   · inside a project  (/projects/:projectId/review) — keeps the whole
//     project rail visible. The Captain sees THIS project's queue, the crew
//     see this project's review board + timeline tree.
//   · global            (/review) — used when no project is open. Captains see
//     every pending submission across their owned projects; the crew see the
//     board across their projects.
// The Captain's workbench is the preview/video template: Big canvas with the
// Preview | Diff map toggle, a right rail split 50/50 into the submitter's
// description and the REMARK improvement note, then the bare Accept / Reject
// decision under the canvas and the timeline-versions strip.
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
  const { projectId } = useParams<{ projectId?: string }>();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const projects = useListVideoProjects();
  const queue = useListVideoReviewQueue({
    query: {
      queryKey: getListVideoReviewQueueQueryKey(),
      // The queue spans owned projects and the socket is project-scoped, so
      // while the desk is open it polls to pick up new submissions and to
      // drop the ones the Captain just decided.
      refetchInterval: 8_000,
      refetchOnWindowFocus: true,
    },
  });
  const [selected, setSelected] = useState<VideoReviewQueueItem | null>(null);
  const [note, setNote] = useState('');

  const allItems = (queue.data ?? []) as VideoReviewQueueItem[];
  // Inside a project the desk only shows that project's reviews.
  const items = projectId ? allItems.filter((item) => item.projectId === projectId) : allItems;

  // The Captain is the owner of the review surface: globally, someone who
  // owns at least one project; inside a project, that project's owner.
  const currentProject = projectId ? (projects.data ?? []).find((p) => p.id === projectId) : null;
  const isCaptain = projectId
    ? Boolean(currentProject && currentProject.ownerId === user?.id)
    : (projects.data ?? []).some((project) => project.ownerId === user?.id);

  const current = selected ? (items.find((item) => item.id === selected.id) ?? selected) : null;
  // The queue row carries every field the review surface reads from a
  // submission (leg/status/timelineVersionId/note/id/submittedById) — the
  // extra decision fields are absent from the summary, so narrow the type.
  const reviewSubmission = current as unknown as VideoSubmission;

  const clearSelection = () => {
    setSelected(null);
    setNote('');
    void queryClient.invalidateQueries({ queryKey: getListVideoReviewQueueQueryKey() });
  };

  // Everyone else sees the project's review board: every stage that has been
  // handed in (awaiting the Captain, approved, or sent back with the
  // improvement note) plus the relay-flow tree of the timeline on the side.
  if (!isCaptain) {
    return <SubmissionOverview projectId={projectId} />;
  }

  const projectName = projectId
    ? currentProject?.name ?? items[0]?.projectName ?? 'this project'
    : null;

  // ---- The Captain's desk ----------------------------------------------
  if (current) {
    return (
      <CaptainReviewSurface
        projectId={current.projectId}
        submission={reviewSubmission}
        headVersionId={current.headVersionId}
        note={note}
        onNoteChange={setNote}
        onDecided={() => clearSelection()}
        onBack={() => {
          setSelected(null);
          setNote('');
        }}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow><ShieldCheck size={13} /> Review desk · captains only</SectionEyebrow>
          <h1>{projectName ? `Reviews for ${projectName}.` : 'Every hand-off, one desk.'}</h1>
          <p>
            When a leg is submitted for review it lands here. Open it, mark what to fix in the
            REMARK, then Accept (merges to the timeline) or Reject (sent back with your note).
          </p>
        </div>
        <span className="den-tag muted" data-testid="review-queue-count">
          {items.length} pending
        </span>
      </div>

      {queue.isLoading ? (
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
        <div className="paper-card review-queue" data-testid="review-queue">
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
                  <span className={`den-tag ${LEG_TONES[item.leg] ?? 'muted'}`} title={legMeta?.hint}>
                    {legMeta?.label ?? item.leg}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="truncate">{item.projectName}</b>
                    <small>
                      {item.submittedByName ?? item.submittedById.slice(0, 8)} · {timeAgo(item.createdAt)}
                    </small>
                    {item.note && (
                      <em className="review-item-note truncate" title={item.note}>“{item.note}”</em>
                    )}
                  </span>
                  <span className="den-tag gold review-item-cta"><GitPullRequest size={11} /> Review</span>
                  <ChevronRight size={16} className="review-item-chevron" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="den-footnote mt-6">
        <Sparkles size={13} />
        The oracle only improves grammar and phrasing — the improvement note stays yours.
      </p>
    </div>
  );
}
