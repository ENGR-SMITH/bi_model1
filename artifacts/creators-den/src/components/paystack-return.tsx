import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import {
  confirmPaystackCheckout,
  getGetAccountQuotaQueryKey,
  getSubscriptionPlansQueryKey,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// PaystackReturnGate — mounted on the profile page (where storage is bought).
// After Paystack redirects the customer back, the URL carries ?reference=…;
// this gate confirms the charge with the server, refreshes the account quota,
// and shows the outcome over the page.
// ---------------------------------------------------------------------------

type ReturnState =
  | { kind: 'busy' }
  | { kind: 'success'; total?: number; cardLast4?: string | null }
  | { kind: 'error'; message: string };

function apiErrorMessage(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string } | null;
  return err?.response?.data?.error || err?.message || 'Something went wrong. Please try again.';
}

export function PaystackReturnGate() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ReturnState | null>(null);

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference) return;
    let disposed = false;
    setState({ kind: 'busy' });

    void (async () => {
      try {
        const res = await confirmPaystackCheckout({ reference });
        if (disposed) return;
        // Drop the query params so a refresh doesn't re-confirm (harmless anyway).
        window.history.replaceState(window.history.state, '', window.location.pathname);
        if (res.granted) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetAccountQuotaQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getSubscriptionPlansQueryKey() }),
          ]);
          if (disposed) return;
          setState({ kind: 'success', total: res.receipt?.total, cardLast4: res.receipt?.cardLast4 ?? null });
        } else {
          setState({
            kind: 'error',
            message: res.error || 'Your payment could not be confirmed. If you were charged, it will be applied shortly — check back in a minute.',
          });
        }
      } catch (e) {
        if (disposed) return;
        setState({ kind: 'error', message: `${apiErrorMessage(e)} If you were charged, your plan will appear here shortly.` });
      }
    })();

    return () => {
      disposed = true;
    };
    // Runs once per page load — the reference arrives on the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal small-modal plan-modal" role="dialog" aria-modal="true" data-testid="paystack-return-gate">
        <button type="button" className="modal-close" onClick={() => setState(null)} aria-label="Close"><X size={16} /></button>
        {state.kind === 'busy' && (
          <>
            <span className="eyebrow">PAYSTACK</span>
            <h2>Confirming your payment…</h2>
            <p>This can take a few seconds. Your storage updates as soon as it lands.</p>
            <p className="den-footnote mt-3" style={{ display: 'flex', gap: 6 }}><Loader2 size={13} className="spin" /> Checking with Paystack…</p>
          </>
        )}
        {state.kind === 'success' && (
          <>
            <span className="eyebrow">PAYMENT CONFIRMED</span>
            <h2>More space — done.</h2>
            <p>
              {state.total !== undefined ? (
                <>Charged ${(state.total / 100).toFixed(2)}{state.cardLast4 ? <> · card •••• {state.cardLast4}</> : null} — the bar above now shows your new limit.</>
              ) : (
                <>Your workspace limit has been extended.</>
              )}
            </p>
            <button type="button" className="primary-btn w-full mt-3" onClick={() => setState(null)}>Done</button>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <span className="eyebrow">PAYMENT NOT CONFIRMED</span>
            <h2>Something went wrong.</h2>
            <p>{state.message}</p>
            <button type="button" className="primary-btn w-full mt-3" onClick={() => setState(null)}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
