import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListArenaReviewsQueryKey,
  useCreateArenaApplicationReview,
  useListArenaReviews,
} from '@workspace/api-client-react';
import type { ArenaReview } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Mutual work reviews after a hire — the composer half of Phase 4. After an
// Accept fills a post, the Captain and the hired creator each leave ONE short
// public review (rating 1–5 + a line, max 500) that renders on the reviewee's
// profile. ReviewCta shows the right state for the current viewer: a button
// before they review, a "Review sent" tag once they have (read from the
// reviewee's received reviews via the public list endpoint).
// ---------------------------------------------------------------------------

export const REVIEW_NOTE_MAX = 500;

/** Interactive 1–5 star picker (hover preview + click to set). */
function StarPicker({ value, onChange, disabled }: { value: number; onChange: (rating: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="review-picker" role="radiogroup" aria-label="Rating" data-testid="review-rating-picker">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={n <= shown ? 'is-on' : 'is-off'}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          disabled={disabled}
          data-testid={`review-star-${n}`}
        >
          <Star size={17} fill={n <= shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

function ReviewModal({
  applicationId,
  revieweeName,
  roleLabel,
  projectName,
  onClose,
  onDone,
}: {
  applicationId: string;
  revieweeName: string;
  roleLabel: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = useCreateArenaApplicationReview({
    mutation: {
      onSuccess: () => onDone(),
      onError: (error) => {
        const serverMessage =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null;
        setLocalError(serverMessage ?? 'We could not send your review just yet. Try again.');
      },
    },
  });

  const noteLength = note.length;
  const canSubmit = rating >= 1 && rating <= 5 && note.trim().length > 0 && noteLength <= REVIEW_NOTE_MAX && !submit.isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLocalError(null);
    submit.mutate({ applicationId, data: { rating, note: note.trim() } });
  };

  const error =
    localError ??
    (submit.isError
      ? ((submit.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'We could not send your review just yet.')
      : null);

  return (
    <div className="modal-backdrop" onClick={submit.isPending ? undefined : onClose} data-testid="arena-review-modal">
      <div className="modal project-modal arena-review-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={submit.isPending} aria-label="Close">
          <X size={16} />
        </button>
        <div className="project-modal-heading">
          <span className="eyebrow">Mutual work review</span>
          <h2>
            How was working with <em>{revieweeName}</em>?
          </h2>
          <p>
            One public review per hire — {roleLabel.toLowerCase()} on “{projectName}”. It lands on{' '}
            {revieweeName}&apos;s profile for other Captains and creators to read.
          </p>
        </div>
        <form className="project-modal-fields" onSubmit={handleSubmit}>
          <div className="field">
            <span>Rating</span>
            <StarPicker value={rating} onChange={setRating} disabled={submit.isPending} />
            {rating === 0 && <small className="den-footnote">Tap a star to set your rating.</small>}
          </div>
          <div className="field">
            <span>
              Your line ({noteLength}/{REVIEW_NOTE_MAX})
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reliable, fast, and a great eye for pacing…"
              maxLength={REVIEW_NOTE_MAX}
              rows={4}
              disabled={submit.isPending}
              autoFocus
              data-testid="input-arena-review-note"
            />
          </div>

          {error && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="arena-review-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="primary-btn modal-submit" data-testid="button-arena-review-send">
            {submit.isPending ? 'Posting review…' : 'Post public review'}
            <Star size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * ReviewCta — the participant-facing affordance on a FILLED post. Shows a
 * button until the viewer has reviewed this hire (server 409s on duplicates,
 * but the reviewee's received list already tells us, so the CTA flips to
 * "Review sent" without a round-trip).
 */
export function ReviewCta({
  applicationId,
  revieweeId,
  revieweeName,
  roleLabel,
  projectName,
  ctaLabel = 'Review their work',
  testIdPrefix = 'review',
}: {
  applicationId: string;
  revieweeId: string;
  revieweeName: string;
  roleLabel: string;
  projectName: string;
  ctaLabel?: string;
  testIdPrefix?: string;
}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const received = useListArenaReviews(
    { userId: revieweeId },
    {
      query: {
        queryKey: getListArenaReviewsQueryKey({ userId: revieweeId }),
        enabled: Boolean(revieweeId),
      },
    },
  );
  const already = ((received.data ?? []) as ArenaReview[]).some(
    (review) => review.applicationId === applicationId && review.reviewerId === user?.id,
  );

  if (already) {
    return (
      <span className="den-tag teal" data-testid={`${testIdPrefix}-review-sent`}>
        <Star size={11} /> Review sent
      </span>
    );
  }

  const refresh = () => {
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: getListArenaReviewsQueryKey({ userId: revieweeId }) });
  };

  return (
    <>
      <button
        type="button"
        className="secondary-btn arena-review-cta"
        onClick={() => setOpen(true)}
        data-testid={`button-${testIdPrefix}-review`}
      >
        <Star size={13} /> {ctaLabel}
      </button>
      {open && (
        <ReviewModal
          applicationId={applicationId}
          revieweeName={revieweeName}
          roleLabel={roleLabel}
          projectName={projectName}
          onClose={() => setOpen(false)}
          onDone={refresh}
        />
      )}
    </>
  );
}
