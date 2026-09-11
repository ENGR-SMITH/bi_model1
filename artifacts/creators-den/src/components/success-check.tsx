// ---------------------------------------------------------------------------
// Brief "payment confirmed" success mark — an SVG circle and check that draw
// themselves in once (~0.8s) with a single ring burst, then hold. Shown by the
// Whop return gate the moment a charge is confirmed.
//
// Decorative only: the "PAYMENT CONFIRMED" eyebrow beside it already carries
// the meaning for screen readers, so the mark is hidden from the
// accessibility tree rather than announced twice.
// ---------------------------------------------------------------------------

export function SuccessCheck({
  size = 'md',
  className,
}: {
  /** `sm` for these compact receipt modals; `md` (84px) is the default. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={`success-check${size === 'sm' ? ' success-check--sm' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <span className="success-check-burst" />
      <svg viewBox="0 0 52 52">
        <circle className="success-check-circle" cx="26" cy="26" r="24" />
        <path className="success-check-mark" d="M14 27l8 8 16-16" />
      </svg>
    </span>
  );
}
