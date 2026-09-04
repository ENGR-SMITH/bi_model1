import { useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquare, XCircle } from 'lucide-react';
import {
  getGetVideoProjectQueryKey,
  getListVideoActivityQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoReviewQueueQueryKey,
  getListVideoSubmissionsQueryKey,
  useApproveVideoSubmission,
  useRejectVideoSubmission,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Captain review actions — the decision + remark on the Captain's REVIEW
// workbench:
//   1. ReviewRemarkCard — the REMARK note, filling the bottom half of the
//      right rail directly under the "Submitted for review" card, where the
//      Captain types what to improve before rejecting.
//   2. ReviewDecisionBar — the big green Accept / red Reject decision as two
//      bare, centered buttons below the canvas (no card around them).
//      Rejecting requires a remark, which travels back to the submitter.
// ---------------------------------------------------------------------------

export function ReviewRemarkCard({
  note,
  onChange,
}: {
  note: string;
  onChange: (note: string) => void;
}) {
  return (
    <div className="paper-card review-remark-card" data-testid="review-oracle-card">
      <div className="inline-heading">
        <span className="eyebrow"><MessageSquare size={13} /> Remark</span>
      </div>
      <textarea
        className="review-oracle-note"
        value={note}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Drop a Remark for this submission — it travels back to the crew when you Reject."
        maxLength={2000}
        data-testid="review-oracle-input"
      />
    </div>
  );
}

export function ReviewDecisionBar({
  projectId,
  submissionId,
  note,
  onDecided,
}: {
  projectId: string;
  submissionId: string;
  /** The improvement remark — required before rejecting. */
  note: string;
  onDecided: (decision: 'APPROVED' | 'REJECTED') => void;
}) {
  const queryClient = useQueryClient();
  const approve = useApproveVideoSubmission();
  const reject = useRejectVideoSubmission();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListVideoReviewQueueQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListVideoActivityQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
  };

  const pending = approve.isPending || reject.isPending;
  const error = (approve.error ?? reject.error) as { response?: { data?: { error?: string } } } | null;

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    if (pending) return;
    const mutation = decision === 'APPROVED' ? approve : reject;
    mutation.mutate(
      {
        projectId,
        submissionId,
        data: decision === 'REJECTED' ? { note: note.trim().slice(0, 2000) } : {},
      },
      {
        onSuccess: () => {
          refresh();
          onDecided(decision);
        },
      },
    );
  };

  const canReject = note.trim().length > 0 && !pending;
  const hasNote = note.trim().length > 0;

  return (
    <div className="review-decision-bar" data-testid="review-decision-bar">
      <div className="review-decision-buttons">
        <button
          type="button"
          className="review-decision-approve"
          onClick={() => decide('APPROVED')}
          disabled={pending}
          title="Accept — merges this hand-in onto the timeline"
          data-testid="review-decision-approve"
        >
          <Check size={18} strokeWidth={3} />
          {approve.isPending ? 'Approving…' : 'Accept'}
        </button>
        <button
          type="button"
          className="review-decision-reject"
          onClick={() => decide('REJECTED')}
          disabled={!canReject}
          title={hasNote ? 'Reject — sends it back with your Remark' : 'Write a Remark to reject'}
          data-testid="review-decision-reject"
        >
          <XCircle size={18} />
          {reject.isPending ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
      {/* A rejection must travel back with a reason — the Reject button stays
          locked until the REMARK field holds one, and this says why. */}
      {!hasNote && !pending && (
        <p className="review-decision-hint" role="status" data-testid="review-reject-hint">
          <MessageSquare size={11} />
          Write a Remark above — you must leave a note before you can Reject this hand-in.
        </p>
      )}
      {error && (
        <p className="setting-copy review-decision-error" role="alert" data-testid="review-decision-error">
          {error.response?.data?.error || 'The decision could not be saved.'}
        </p>
      )}
    </div>
  );
}
