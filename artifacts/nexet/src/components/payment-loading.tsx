import { PiCreditCardDuotone, PiLockKeyDuotone } from 'react-icons/pi';

// ---------------------------------------------------------------------------
// Payment loading overlay — rendered full-screen the moment a pay button is
// clicked, and kept up while the server creates the Whop checkout session and
// the browser is handed off to Whop's hosted page. The pay button keeps its own
// inline spinner underneath, so the click always reads as "in progress"; this
// overlay is what stops a second click and tells the customer what is coming.
//
// It is z-index 70, above the pay modal (z-50) and every other overlay, so the
// unfinished purchase cannot be re-triggered while it settles.
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
            <PiCreditCardDuotone className="h-6 w-6" />
          </span>
        </div>
        <p className="mt-6 font-display text-xl font-extrabold tracking-[-0.03em] text-white">
          Opening secure checkout…
        </p>
        <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-zinc-400">
          Taking you to <b className="text-zinc-200">Whop&apos;s secure payment page</b> — please
          don&apos;t close this window.
        </p>
        <div className="pay-loader-bar mt-6" aria-hidden="true">
          <i />
        </div>
        <span className="pay-loader-chip font-mono-ui mt-6">
          <PiLockKeyDuotone className="h-3 w-3 text-[#34d399]" />
          Secured by Whop
        </span>
      </div>
    </div>
  );
}
