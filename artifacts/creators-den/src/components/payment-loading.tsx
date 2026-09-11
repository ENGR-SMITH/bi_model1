import { CreditCard, Lock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Payment loading overlay — mirrors the overlay the NEXET subscriptions desk
// uses on its own pay buttons. Here it covers the "Buy more space" hand-off:
// storage is bought on the desk (a separate app under the same origin), so the
// CTA flips this up, lets it paint, then navigates — one smooth action instead
// of a bare full-page jump.
//
// z-index 60 sits above the den's modals (z-40), so a second click cannot slip
// through while the browser is leaving.
// ---------------------------------------------------------------------------

export function PaymentLoadingOverlay({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <div
      className="pay-loader"
      role="alertdialog"
      aria-busy="true"
      aria-live="assertive"
      aria-label="Opening secure checkout"
      data-testid="payment-loading"
    >
      <div className="pay-loader-inner">
        <div className="pay-loader-orbit" aria-hidden="true">
          <span className="pay-loader-ring" />
          <span className="pay-loader-icon">
            <CreditCard size={24} />
          </span>
        </div>
        <p className="mt-6 text-xl font-bold tracking-[-0.03em] text-white">Opening secure checkout…</p>
        <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-white/70">
          Taking you to <b className="text-white">Whop&apos;s secure payment page</b> — please
          don&apos;t close this window.
        </p>
        <div className="pay-loader-bar mt-6" aria-hidden="true">
          <i />
        </div>
        <span className="pay-loader-chip mt-6">
          <Lock size={12} />
          Secured by Whop
        </span>
      </div>
    </div>
  );
}
