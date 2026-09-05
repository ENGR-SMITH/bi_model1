import { Link } from 'wouter';
import { Star, UserRound } from 'lucide-react';
import {
  getListArenaReviewsQueryKey,
  useListArenaReviews,
} from '@workspace/api-client-react';
import type { ArenaReview } from '@workspace/api-client-react';
import { ArenaRoleTag, timeAgo } from '@/components/arena-apply-modal';

// ---------------------------------------------------------------------------
// WorkReviewsCard — the public reputation surface of the Arena: the reviews a
// profile has RECEIVED after hired collaborations (Captain ↔ hired creator,
// one short rating + line per direction per hire). Rendered on the Creator
// Den profile page (own and others'); the note is public profile data, so it
// follows the same visibility rules as track history.
// ---------------------------------------------------------------------------

/** Five small stars; filled up to the rating. */
export function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={`review-stars ${className ?? ''}`} role="img" aria-label={`${rating} out of 5 stars`} data-testid="review-stars">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          size={12}
          className={value <= rating ? 'is-on' : 'is-off'}
          fill={value <= rating ? 'currentColor' : 'none'}
          aria-hidden
        />
      ))}
    </span>
  );
}

export function WorkReviewsCard({ userId }: { userId: string }) {
  const reviews = useListArenaReviews(
    { userId },
    {
      query: {
        queryKey: getListArenaReviewsQueryKey({ userId }),
        enabled: Boolean(userId),
      },
    },
  );
  const rows = (reviews.data ?? []) as ArenaReview[];

  return (
    <div className="cd-rail" data-testid="panel-work-reviews">
      <div className="cd-rail-head">
        <h3>Work reviews</h3>
        {rows.length > 0 && <span className="mono-label">{rows.length} received</span>}
      </div>

      {reviews.isLoading ? (
        <div className="panel-empty">Opening the work record…</div>
      ) : rows.length === 0 ? (
        <div className="paper-card" data-testid="empty-work-reviews">
          <p className="setting-copy" style={{ margin: 0 }}>
            <Star size={13} className="inline mr-1" style={{ verticalAlign: '-2px' }} />
            No work reviews yet — after an Arena hire, the Captain and the hired creator each leave
            one short public review and it lands here.
          </p>
        </div>
      ) : (
        <div className="paper-card">
          <div className="den-stack">
            {rows.map((review) => (
              <div className="work-review-row" key={review.id} data-testid={`work-review-${review.id}`}>
                <span className="work-review-topline">
                  <span className="work-review-reviewer">
                    {review.reviewerImageUrl ? (
                      <img src={review.reviewerImageUrl} alt="" />
                    ) : (
                      <UserRound size={14} />
                    )}
                    <Link href={`/profile/${review.reviewerId}`} data-testid={`work-review-reviewer-${review.reviewerId}`}>
                      {review.reviewerName ?? 'Creator'}
                    </Link>
                  </span>
                  <RatingStars rating={review.rating} />
                  <span className="work-review-context">
                    {review.projectName ? `“${review.projectName}”` : 'Hired collaboration'} ·{' '}
                    {timeAgo(review.createdAt)}
                  </span>
                </span>
                <span className="work-review-note">{review.note}</span>
                <ArenaRoleTag role={review.role} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
