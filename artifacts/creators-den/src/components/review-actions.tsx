import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Sparkles, WandSparkles, XCircle } from 'lucide-react';
import {
  getGetVideoProjectQueryKey,
  getListVideoActivityQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoReviewQueueQueryKey,
  getListVideoSubmissionsQueryKey,
  oracleChat,
  useApproveVideoSubmission,
  useRejectVideoSubmission,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Captain review actions — the two cards in the bottom row of the captain's
// REVIEW workbench (the preview/video-style template):
//   1. ReviewDecisionCard — BIG green Accept / red Reject. Rejecting requires
//      an improvement note, which travels back to the submitter.
//   2. ReviewRemarkCard — REMARK: a note field for what to fix, with an AI
//      button that improves grammar / phrasing ONLY (never adds or changes
//      the substance of the note).
// ---------------------------------------------------------------------------

// The oracle's rephrase-only system prompt: grammar + clarity + phrasing.
// Every specific point, timecode, and instruction must survive verbatim; the
// AI is explicitly forbidden from adding suggestions or changing meaning.
const IMPROVE_PROMPT = [
  "You are the Editor's oracle in a video relay (Creators Den).",
  'The reviewer has drafted an improvement note for a submission they are about to reject.',
  'Improve the note\'s grammar, spelling, clarity, and phrasing ONLY.',
  'Keep every specific point, timecode, file reference, and instruction exactly as written — do not add new suggestions, soften criticism, or change the meaning.',
  'Return ONLY the improved note text, with no preamble, quotes, or commentary.',
].join(' ');

export function ReviewRemarkCard({
  note,
  onChange,
}: {
  note: string;
  onChange: (note: string) => void;
}) {
  const [meta, setMeta] = useState<{ providerId: string; modelId: string; attempted?: string[] } | null>(null);

  const improve = useMutation({
    mutationFn: () =>
      oracleChat({
        messages: [
          { role: 'system', content: IMPROVE_PROMPT },
          { role: 'user', content: (note.trim() || 'The note is empty.').slice(0, 4000) },
        ],
        context: null,
        temperature: 0.2,
      }),
    onSuccess: (result) => {
      setMeta({ providerId: result.providerId, modelId: result.modelId, attempted: result.attempted });
      onChange(result.content.trim());
    },
  });

  return (
    <div className="paper-card" data-testid="review-oracle-card">
      <div className="inline-heading">
        <span className="eyebrow"><WandSparkles size={13} /> REMARK</span>
      </div>
      <textarea
        className="review-oracle-note"
        value={note}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. Tighten the second beat — the cut at 02:14 lands late. Rebalance the room tone under the VO and add a title card before the hook."
        rows={4}
        maxLength={2000}
        data-testid="review-oracle-input"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => improve.mutate()}
          disabled={improve.isPending || !note.trim()}
          data-testid="review-oracle-improve"
        >
          {improve.isPending ? <Sparkles size={13} className="spin" /> : <Sparkles size={13} />}
          {improve.isPending ? 'Polishing…' : 'Improve writing'}
        </button>
        {improve.isError && (
          <span className="setting-copy" role="alert" data-testid="review-oracle-error">
            The oracle could not polish the note right now — your draft is unchanged.
          </span>
        )}
        {meta && !improve.isPending && (
          <span className="oracle-answer-meta">
            <span>
              {meta.providerId} · {meta.modelId}
            </span>
            <small>rephrased</small>
          </span>
        )}
      </div>
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
  /** The improvement note — required before rejecting. */
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
          title={note.trim() ? 'Reject and send the improvement note back' : 'Write an improvement note above to reject'}
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
