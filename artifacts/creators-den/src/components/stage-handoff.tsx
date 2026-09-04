// ---------------------------------------------------------------------------
// StageHandoff — the crew side of the review loop.
//
// The Captain's Review desk only ever fills up when a leg's crew member hands
// their stage over. This panel is that action, rendered at the bottom of each
// role studio:
//   - shows the leg's review status (DRAFT / SUBMITTED / APPROVED / REJECTED)
//     and the current head version,
//   - "Submit for review" pins the current head snapshot as a pull request and
//     drops it on the Captain's queue (the desk + nav badge update live),
//   - after a rejection it shows the Captain's improvement note and unlocks
//     resubmission; after approval it confirms the merge.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, GitPullRequest, Inbox, Send, XCircle } from 'lucide-react';
import {
  getGetVideoProjectQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoActivityQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoReviewQueueQueryKey,
  getListVideoSubmissionsQueryKey,
  useCreateVideoSubmission,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoSubmissions,
} from '@workspace/api-client-react';
import type { StudioLeg } from '@/components/role-oracle';
import { InterchangeSection } from '@/components/checkout-import';

export function StageHandoff({
  projectId,
  leg,
  label,
  emptyHint,
  projectName,
}: {
  projectId: string;
  leg: StudioLeg;
  /** Human leg label, e.g. "Selects" / "Cut". */
  label: string;
  /** Shown when the stage has no saved version to hand off yet. */
  emptyHint?: string;
  /** When set (externally-edited legs), the card gains the collapsible
      checkout → edit → import round-trip for creating new versions. */
  projectName?: string;
}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const timeline = useGetVideoTimeline(projectId, leg);
  const submissions = useListVideoSubmissions(projectId);
  const project = useGetVideoProject(projectId);
  const submit = useCreateVideoSubmission();
  const [note, setNote] = useState('');

  const rows = useMemo(
    () => (submissions.data ?? []).filter((submission) => submission.leg === leg),
    [submissions.data, leg],
  );
  // The list is newest first — the pending row (at most one per leg, enforced
  // server-side) and the latest decision for the banner copy.
  const pending = rows.find((submission) => submission.status === 'SUBMITTED') ?? null;
  const lastDecided = rows.find((submission) => submission.status !== 'SUBMITTED') ?? null;

  const status = timeline.data?.status ?? 'DRAFT';
  const headVersion = timeline.data?.version ?? null;
  const isCaptain = project.data?.ownerId === user?.id;
  const sending = submit.isPending;
  const error = submit.error as { response?: { data?: { error?: string } } } | null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, leg) });
    queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
    // The Captain's queue + badge and the crew's activity/notifications react
    // instantly when a stage is handed over.
    queryClient.invalidateQueries({ queryKey: getListVideoReviewQueueQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVideoActivityQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
  };

  const onSend = () => {
    submit.mutate(
      { projectId, data: { leg, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          setNote('');
          refresh();
        },
      },
    );
  };

  const canSubmit = headVersion != null && status !== 'SUBMITTED';
  const tagTone =
    status === 'SUBMITTED' ? 'gold' : status === 'APPROVED' ? 'teal' : status === 'REJECTED' ? 'danger' : 'muted';
  const tagLabel =
    status === 'SUBMITTED'
      ? 'Pending review'
      : status === 'APPROVED'
        ? 'Approved'
        : status === 'REJECTED'
          ? 'Sent back'
          : headVersion != null
            ? 'In progress'
            : 'Not started';

  return (
    <div className="paper-card" data-testid={`stage-handoff-${leg.toLowerCase()}`}>
      <div className="inline-heading">
        <span className="eyebrow">
          <GitPullRequest size={13} /> {label} hand-off
          {headVersion != null && <span className="mono-label ml-1">v{headVersion}</span>}
        </span>
        <span className={`den-tag ${tagTone}`} data-testid={`stage-handoff-status-${leg.toLowerCase()}`}>
          {tagLabel}
        </span>
      </div>

      {status === 'SUBMITTED' && pending ? (
        <div className="setting-copy mt-2">
          <p className="flex items-start gap-2">
            <Clock3 size={14} className="mt-0.5 shrink-0" />
            <span>
              v{headVersion} is with the Captain for review
              {pending.note ? <> — “{pending.note}”</> : ''}. You&apos;ll be notified the moment it&apos;s decided.
            </span>
          </p>
          {isCaptain && (
            <Link href="/review" className="link-btn mt-2 inline-flex" data-testid={`stage-handoff-open-desk-${leg.toLowerCase()}`}>
              Open the review desk <Send size={12} className="ml-1" />
            </Link>
          )}
        </div>
      ) : status === 'APPROVED' ? (
        <p className="setting-copy mt-2 flex items-start gap-2" data-testid={`stage-handoff-approved-${leg.toLowerCase()}`}>
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>
            v{headVersion} was approved and merged as the {label.toLowerCase()} baseline
            {lastDecided?.decisionNote ? <> — the Captain added: “{lastDecided.decisionNote}”</> : ''}.
            {' '}On to the next stage.
          </span>
        </p>
      ) : status === 'REJECTED' ? (
        <div className="setting-copy mt-2">
          <p className="flex items-start gap-2" data-testid={`stage-handoff-rejected-${leg.toLowerCase()}`}>
            <XCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              The Captain sent v{headVersion} back
              {lastDecided?.decisionNote ? <> — “{lastDecided.decisionNote}”</> : ''}. Fix it, save a new version,
              then resubmit below.
            </span>
          </p>
        </div>
      ) : headVersion == null ? (
        <p className="setting-copy mt-2 flex items-start gap-2">
          <Inbox size={14} className="mt-0.5 shrink-0" />
          <span>
            {emptyHint ??
              `No version has been saved for this stage yet — once there's a ${label.toLowerCase()} snapshot to review, submit it here and it lands on the Captain's desk.`}
          </span>
        </p>
      ) : null}

      {canSubmit && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
          <span className="eyebrow">Submit for review</span>
          <p className="setting-copy mt-1">
            Pins v{headVersion} as the {label.toLowerCase()} hand-off and drops it on the Captain&apos;s queue.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 flex-1"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for the Captain (optional)"
              maxLength={2000}
              data-testid={`stage-handoff-note-${leg.toLowerCase()}`}
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sending}
              className="secondary-btn"
              data-testid={`stage-handoff-submit-${leg.toLowerCase()}`}
            >
              <Send size={13} />
              {sending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {error && (
            <p className="setting-copy mt-2" role="alert">
              {error.response?.data?.error || 'The pull request could not be created.'}
            </p>
          )}
        </div>
      )}

      {/* Externally-edited legs (Selects/Cut/Sound) create their new versions
          by taking the stage into an NLE and importing the result — the
          collapsible round-trip lives right on the hand-off card. */}
      {projectName && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <InterchangeSection projectId={projectId} projectName={projectName} leg={leg} />
        </div>
      )}
    </div>
  );
}
