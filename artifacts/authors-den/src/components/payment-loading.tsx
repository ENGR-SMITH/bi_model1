import { CreditCard, Lock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Payment loading overlay — rendered full-screen the moment a pay button is
// clicked, and kept up while the server creates the Whop checkout session and
// the browser is handed off to Whop's hosted page. The pay button keeps its own
// inline spinner underneath, so the click always reads as "in progress"; this
// overlay is what stops a second click and tells the author what is coming.
//
// z-index 60 sits above the pay modal backdrop (z-40), so the unfinished
// purchase cannot be re-triggered while it settles.
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
