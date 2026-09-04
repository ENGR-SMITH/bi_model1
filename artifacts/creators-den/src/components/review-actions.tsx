import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, XCircle } from 'lucide-react';
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
// Captain review actions — the two cards in the bottom row of the captain's
// REVIEW workbench (the preview/video-style template):
//   1. ReviewDecisionCard — BIG green Accept / red Reject. Rejecting requires
//      a remark, which travels back to the submitter.
//   2. ReviewRemarkCard — the remark field, filling the whole card, where the
//      Captain types what to improve before rejecting.
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
      <textarea
        className="review-oracle-note"
        value={note}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Drop a Remark for this submission"
        maxLength={2000}
        data-testid="review-oracle-input"
      />
    </div>
  );
}

export function ReviewDecisionCard({
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

  return (
    <div className="paper-card" data-testid="review-decision-card">
      <div className="inline-heading">
        <span className="eyebrow"><CheckCircle2 size={13} /> Decision</span>
      </div>
      <div className="review-decision-buttons">
        <button
          type="button"
          className="review-decision-approve"
          onClick={() => decide('APPROVED')}
          disabled={pending}
          data-testid="review-decision-approve"
        >
          <Check size={20} />
          {approve.isPending ? 'Approving…' : 'Accept'}
        </button>
        <button
          type="button"
          className="review-decision-reject"
          onClick={() => decide('REJECTED')}
          disabled={!canReject}
          title={note.trim() ? 'Send the remark back and reject' : 'Write a remark to reject'}
          data-testid="review-decision-reject"
        >
          <XCircle size={20} />
          {reject.isPending ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
      {error && (
        <p className="setting-copy mt-2" role="alert" data-testid="review-decision-error">
          {error.response?.data?.error || 'The decision could not be saved.'}
        </p>
      )}
    </div>
  );
}
