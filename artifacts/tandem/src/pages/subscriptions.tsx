import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PiArrowLeftDuotone, PiCheckCircleDuotone, PiCheckDuotone, PiCircleNotchDuotone, PiConfettiDuotone, PiCreditCardDuotone, PiFolderOpenDuotone, PiHardDrivesDuotone, PiLockKeyDuotone, PiSparkleDuotone, PiTicketDuotone, PiWarningCircleDuotone, PiXDuotone } from 'react-icons/pi';
import type { IconType } from 'react-icons';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';
import {
  confirmPaystackCheckout,
  getSubscriptionPlansQueryKey,
  useCreatePaystackCheckout,
  useSubscriptionPlans,
  type SubscriptionPlan,
  type SubscriptionRecord,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Subscriptions & Payments — the TANDEM hub for every plan across the house:
// category passes, Creator Den workspace storage, and Author Den projects.
// Shows the account's full subscription history (type, plan, status, expiry)
// and lets the user subscribe to any available plan here — the same products
// are also payable inline on the Creator Den and Author Den themselves.
//
// Payments run through Paystack's hosted checkout (USD). Buying a plan opens
// a Paystack page; when the customer returns, the page confirms the charge
// with the server (POST /paystack/confirm) and shows the receipt.
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function price(usd: number): string {
  return `$${(usd / 100).toFixed(2)}`;
}

function apiErrorMessage(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string } | null;
  return err?.response?.data?.error || err?.message || 'Something went wrong. Please try again.';
}

const KIND_META: Record<string, { icon: IconType; label: string }> = {
  pass: { icon: PiTicketDuotone, label: 'Category passes' },
  storage: { icon: PiHardDrivesDuotone, label: 'Creator Den · workspace storage' },
  projects: { icon: PiFolderOpenDuotone, label: 'Author Den · work projects' },
};

function barPercent(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// A full-page status panel shown while a payment is being confirmed on return,
// or right after a promo-waived (free) grant.
type ResultOverlay =
  | { kind: 'busy'; message: string }
  | { kind: 'success'; total?: number; cardLast4?: string | null; promoCode?: string | null }
  | { kind: 'error'; message: string };

function ResultOverlayView({ state, onClose }: { state: ResultOverlay; onClose: () => void }) {
  if (state.kind === 'busy') {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="paystack-result-busy">
        <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#111111] p-8 text-center text-white shadow-2xl">
          <PiCircleNotchDuotone className="mx-auto h-8 w-8 animate-spin text-[#3b82f6]" />
          <p className="mt-4 text-sm font-semibold text-zinc-100">{state.message}</p>
          <p className="mt-1 text-xs text-zinc-500">This can take a few seconds.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'success') {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm">
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] p-6 text-white shadow-2xl" data-testid="subscription-success">
          <div className="flex items-center gap-3">
            <span className="icon-chip h-14 w-14 text-[#34d399]"><PiConfettiDuotone className="h-7 w-7" /></span>
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#34d399]">Subscribed</p>
              <h3 className="text-2xl font-extrabold tracking-[-0.04em]">Payment confirmed</h3>
            </div>
          </div>
          <p className="mt-4 text-sm text-zinc-400">
            {state.total !== undefined ? (
              <>
                Charged {price(state.total)}
                {state.cardLast4 ? <> · card •••• {state.cardLast4}</> : null}
                {state.promoCode ? <> · promo <b>{state.promoCode}</b></> : null}
              </>
            ) : (
              <>Your new plan is active — the page below shows what changed.</>
            )}
          </p>
          <button type="button" onClick={onClose} className="focus-house mt-5 w-full rounded-xl bg-[#34d399] py-3.5 text-sm font-bold text-[#052e1c] transition-colors hover:bg-[#2bb883]">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="subscription-error">
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] p-6 text-white shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-14 w-14 text-[#f87171]"><PiWarningCircleDuotone className="h-7 w-7" /></span>
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#f87171]">Payment not confirmed</p>
            <h3 className="text-xl font-extrabold tracking-[-0.04em]">Something went wrong</h3>
          </div>
        </div>
        <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs leading-relaxed text-zinc-300">{state.message}</p>
        <button type="button" onClick={onClose} className="focus-house mt-5 w-full rounded-xl bg-white/10 py-3.5 text-sm font-bold text-white transition-colors hover:bg-white/20">Back to plans</button>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const plansQuery = useSubscriptionPlans();
  const data = plansQuery.data;
  const [paying, setPaying] = useState<SubscriptionPlan | null>(null);
  const [overlay, setOverlay] = useState<ResultOverlay | null>(null);

  const refreshPlans = () => {
    void queryClient.invalidateQueries({ queryKey: getSubscriptionPlansQueryKey() });
  };

  // On return from the Paystack checkout the URL carries ?reference=… (Paystack
  // appends it to the callback_url). Confirm the charge server-side, then show
  // the outcome and drop the query params so a refresh doesn't re-confirm.
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference) return;
    let disposed = false;
    setOverlay({ kind: 'busy', message: 'Confirming your payment…' });

    void (async () => {
      try {
        const res = await confirmPaystackCheckout({ reference });
        if (disposed) return;
        window.history.replaceState(window.history.state, '', window.location.pathname);
        if (res.granted) {
          await queryClient.invalidateQueries({ queryKey: getSubscriptionPlansQueryKey() });
          if (disposed) return;
          setOverlay({
            kind: 'success',
            total: res.receipt?.total,
            cardLast4: res.receipt?.cardLast4 ?? null,
            promoCode: res.receipt?.promoCode ?? null,
          });
        } else {
          setOverlay({
            kind: 'error',
            message:
              res.error ||
              'Your payment could not be confirmed. If you were charged, it will be applied shortly — check back in a minute or contact support.',
          });
        }
      } catch (e) {
        if (disposed) return;
        setOverlay({
          kind: 'error',
          message: `${apiErrorMessage(e)} If you were charged, your plan will appear here shortly.`,
        });
      }
    })();

    return () => {
      disposed = true;
    };
    // Runs once per page load — the reference arrives on the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeByPlan = useMemo(() => {
    const map = new Map<string, SubscriptionRecord>();
    for (const sub of data?.current ?? []) {
      if (sub.active) {
        const key = `${sub.kind}:${sub.planId}`;
        const existing = map.get(key);
        if (!existing || new Date(sub.periodEnd).getTime() > new Date(existing.periodEnd).getTime()) {
          map.set(key, sub);
        }
      }
    }
    return map;
  }, [data?.current]);

  const usage = data?.usage;
  const storageUsed = usage?.storage.usedBytes ?? 0;
  const storageTotal = usage?.storage.totalBytes ?? 0;
  const projectsUsed = usage?.projects.used ?? 0;
  const projectsTotal = usage?.projects.total ?? 0;

  const groups: SubscriptionPlan[][] = [
    (data?.plans ?? []).filter((p) => p.kind === 'pass'),
    (data?.plans ?? []).filter((p) => p.kind === 'storage'),
    (data?.plans ?? []).filter((p) => p.kind === 'projects'),
  ];

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="reveal flex flex-col justify-between gap-5 border-b border-white/5 pb-10 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Billing & passes</SectionEyebrow>
          <h1 className="mt-5 text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-7xl">Yours at a glance.</h1>
          <p className="mt-5 max-w-[34rem] text-base leading-[1.8] text-zinc-400">
            Every subscription on your account — category passes, Creators Den storage, and Author&nbsp;Den projects — in one place. Subscribe here, or on the den itself; your plan follows your account.
          </p>
        </div>
        <Link href="/dashboard" className="focus-house group inline-flex items-center gap-2 rounded-full py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-100" data-testid="link-subscriptions-back">
          <PiArrowLeftDuotone className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
          Back to the atrium
        </Link>
      </div>

      {/* Current usage — the live account state. */}
      <div className="reveal reveal-1 mt-12 grid gap-6 lg:grid-cols-3">
        <div className="soft-lift group card-surface relative overflow-hidden rounded-3xl p-6">
          <span className="card-spot" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-zinc-500">Category passes</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">Passes</p>
            </div>
            <span className="icon-chip h-11 w-11 text-[#3b82f6]"><PiTicketDuotone className="h-5 w-5" /></span>
          </div>
          <p className="mt-4 text-sm text-zinc-500">{activeByPlan.size} active</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data?.current.filter((s) => s.active).length === 0 && (
              <span className="rounded-full bg-white/5 px-3 py-1 font-mono-ui text-[10px] uppercase tracking-[.14em] text-zinc-500">No active pass</span>
            )}
            {data?.current.filter((s) => s.active).map((sub) => (
              <span key={sub.id} className="inline-flex items-center gap-1.5 rounded-full bg-[#34d399]/10 px-3 py-1 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#34d399]">
                <PiCheckCircleDuotone className="h-3 w-3" />
                {sub.planLabel.split(' ').slice(0, 2).join(' ')} · until {formatDate(sub.periodEnd)}
              </span>
            ))}
          </div>
        </div>

        <div className="soft-lift group card-surface relative overflow-hidden rounded-3xl p-6">
          <span className="card-spot" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-zinc-500">Creator Den · workspace</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">Storage</p>
            </div>
            <span className="icon-chip h-11 w-11 text-[#34d399]"><PiHardDrivesDuotone className="h-5 w-5" /></span>
          </div>
          <div className="mt-4 flex items-baseline gap-2 text-sm">
            <span className="text-lg font-bold text-zinc-100">{formatBytes(storageUsed)}</span>
            <span className="text-zinc-500">of {formatBytes(storageTotal)}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#34d399] shadow-[0_0_12px_rgba(52,211,153,0.5)]" style={{ width: `${barPercent(storageUsed, storageTotal)}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{formatBytes(Math.max(0, storageTotal - storageUsed))} left</p>
        </div>

        <div className="soft-lift group card-surface relative overflow-hidden rounded-3xl p-6">
          <span className="card-spot" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-zinc-500">Author Den · work projects</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">Projects</p>
            </div>
            <span className="icon-chip h-11 w-11 text-[#fbbf24]"><PiFolderOpenDuotone className="h-5 w-5" /></span>
          </div>
          <div className="mt-4 flex items-baseline gap-2 text-sm">
            <span className="text-lg font-bold text-zinc-100">{projectsUsed}</span>
            <span className="text-zinc-500">of {projectsTotal}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#3b82f6] shadow-[0_0_12px_rgba(59,130,246,0.5)]" style={{ width: `${barPercent(projectsUsed, projectsTotal)}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{Math.max(0, projectsTotal - projectsUsed)} left</p>
        </div>
      </div>

      {/* The plan catalog, grouped by product. */}
      {plansQuery.isLoading ? (
        <div className="public-card mt-10 rounded-[1.5rem] border border-white/10 bg-[#111111] p-8 text-center text-zinc-500">Opening the price list…</div>
      ) : (
        groups.map((groupPlans, index) => {
          const kind = groupPlans[0]?.kind as keyof typeof KIND_META;
          const meta = KIND_META[kind] ?? { icon: PiTicketDuotone, label: 'Plans' };
          const Icon = meta.icon;
          return (
            <section key={kind} className="reveal mt-12">
              <div className="flex items-center gap-4">
                <span className="icon-chip h-11 w-11 text-[#3b82f6]"><Icon className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-2xl font-semibold text-zinc-100">{meta.label}</h2>
                </div>
                <div className="h-px flex-1 bg-white/5" />
                <span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-zinc-600">0{index + 1}</span>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {groupPlans.map((plan, planIndex) => {
                  const activeSub = activeByPlan.get(`${plan.kind}:${plan.planId}`);
                  // The middle plan of a tier reads as the flagship price card.
                  const popular = groupPlans.length > 1 && planIndex === 1;
                  return (
                    <div
                      key={`${plan.kind}:${plan.planId}`}
                      className={`soft-lift group relative flex flex-col overflow-hidden rounded-3xl p-6 ${popular ? 'card-raised glow-accent border border-[#3b82f6]/40' : 'card-surface border border-white/10'}`}
                      data-testid={`plan-${plan.kind}-${plan.planId}`}
                    >
                      <span className="card-spot" />
                      <span className="card-shine" />
                      {popular && (
                        <span className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] px-3 py-1 font-mono-ui text-[9px] font-semibold uppercase tracking-[.14em] text-white shadow-[0_8px_20px_-8px_rgba(99,102,241,0.9)]" data-testid={`plan-popular-${plan.planId}`}>
                          <PiSparkleDuotone className="h-3 w-3" /> Most popular
                        </span>
                      )}
                      <div className="flex items-center gap-3 pr-24">
                        <span className={`icon-chip h-11 w-11 ${popular ? 'text-[#60a5fa]' : 'text-zinc-300'}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold text-zinc-100">{plan.planLabel}</p>
                          <p className="font-mono-ui text-[9px] uppercase tracking-[.16em] text-zinc-500">{plan.intervalLabel}</p>
                        </div>
                      </div>
                      <div className="mt-7 flex items-baseline gap-1.5">
                        <span className={`font-display text-[2.75rem] font-extrabold leading-none tracking-[-0.05em] ${popular ? 'text-gradient-accent' : 'text-white'}`}>{price(plan.priceUsd)}</span>
                        <span className="text-sm text-zinc-500">/ {plan.intervalLabel}</span>
                      </div>
                      <p className="mt-3 min-h-[2.75rem] text-xs leading-relaxed text-zinc-500">{plan.detail}</p>
                      <div className="card-divider my-5" />
                      {activeSub ? (
                        <span className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-[#34d399]/25 bg-[#34d399]/10 px-4 py-3 text-center text-xs font-semibold text-[#34d399]" data-testid={`plan-active-${plan.planId}`}>
                          <PiCheckDuotone className="h-3.5 w-3.5" />
                          Active until {formatDate(activeSub.periodEnd)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPaying(plan)}
                          className={`focus-house mt-auto w-full rounded-xl py-3 text-center text-xs font-bold transition-all ${popular ? 'bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white shadow-[0_12px_28px_-12px_rgba(59,130,246,0.8)] hover:brightness-110 hover:shadow-[0_16px_36px_-12px_rgba(139,92,246,0.9)]' : 'border border-white/10 bg-white/5 text-zinc-100 hover:border-white/25 hover:bg-white/10'}`}
                          data-testid={`plan-buy-${plan.planId}`}
                        >
                          Subscribe
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* Subscription history */}
      <section className="reveal mt-14">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-semibold text-zinc-100">Every subscription on this account</h2>
          <div className="h-px flex-1 bg-white/5" />
        </div>
        <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-white/10">
          {((data?.current ?? []).length === 0) ? (
            <div className="p-8 text-center text-sm text-zinc-500" data-testid="subscriptions-history-empty">
              No subscriptions yet — every pass and extension you buy lands here.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {(data?.current ?? []).map((sub) => (
                <li key={sub.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" data-testid={`subscription-${sub.id}`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full ${sub.active ? 'bg-[#34d399]/10 text-[#34d399]' : 'bg-white/5 text-zinc-500'}`}>
                      {sub.active ? <PiCheckDuotone className="h-4 w-4" /> : <PiSparkleDuotone className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{sub.planLabel}</p>
                      <p className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-zinc-500">
                        {sub.kind} · {sub.intervalLabel} · {price(sub.priceUsd)}
                        {sub.promoCode ? ` · promo ${sub.promoCode}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-zinc-400">{formatDate(sub.periodStart)} → {formatDate(sub.periodEnd)}</p>
                    <p className={`font-mono-ui text-[10px] uppercase tracking-[.14em] ${sub.active ? 'text-[#34d399]' : 'text-zinc-500'}`}>{sub.status}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {paying && (
        <PayModal
          plan={paying}
          onClose={() => setPaying(null)}
          onGranted={(total, cardLast4, promoCode) => {
            setPaying(null);
            refreshPlans();
            setOverlay({ kind: 'success', total, cardLast4, promoCode });
          }}
        />
      )}
      {overlay && <ResultOverlayView state={overlay} onClose={() => setOverlay(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PayModal — confirm + pay for one plan. No card fields: clicking through
// opens Paystack's hosted checkout (USD) in this tab; Paystack sends the user
// back to this page (?reference=…), which confirms the charge on mount.
// ---------------------------------------------------------------------------

function PayModal({
  plan,
  onClose,
  onGranted,
}: {
  plan: SubscriptionPlan;
  onClose: () => void;
  onGranted: (total: number, cardLast4: string | null, promoCode: string | null) => void;
}) {
  const [promo, setPromo] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const checkout = useCreatePaystackCheckout({
    mutation: {
      onSuccess: (res) => {
        if (res.granted) {
          // A FREE promo (or full discount) is granted server-side — no redirect.
          onGranted(0, null, promo.trim() || null);
          return;
        }
        setError('');
        setOpening(true);
        // Let the spinner paint before leaving for Paystack.
        window.setTimeout(() => {
          window.location.assign(res.checkoutUrl);
        }, 350);
      },
      onError: (e: unknown) => {
        setError(apiErrorMessage(e) || 'The payment could not be started. Please try again.');
      },
    },
  });

  const callbackUrl = `${window.location.origin}${window.location.pathname}`;

  const pay = () => {
    setError('');
    checkout.mutate({
      data: {
        kind: plan.kind,
        planId: plan.planId,
        promoCode: promo.trim() || undefined,
        callbackUrl,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="subscription-pay-gate">
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] text-white shadow-2xl">
        <div className="rounded-t-[1.35rem] p-6 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="icon-chip h-11 w-11 text-[#3b82f6]">
                <PiCreditCardDuotone className="h-5 w-5" />
              </span>
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Subscription</p>
                <h2 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.04em]">{plan.planLabel}</h2>
              </div>
            </div>
            <span className="font-display text-2xl font-extrabold tracking-[-0.04em]">{price(plan.priceUsd)}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">{plan.detail} · billed per {plan.intervalLabel}.</p>
          <button type="button" onClick={onClose} disabled={opening} aria-label="Close" className="focus-house absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-40"><PiXDuotone className="h-4 w-4" /></button>
        </div>

        <div className="relative flex items-center px-2">
          <span className="absolute -left-2 h-4 w-4 rounded-full bg-[#111111]/60" />
          <div className="h-0 flex-1 border-t-2 border-dashed border-white/10" />
          <span className="absolute -right-2 h-4 w-4 rounded-full bg-[#111111]/60" />
        </div>

        <div className="rounded-b-[1.35rem] p-6 pt-5">
          <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[.03] p-3">
            <PiLockKeyDuotone className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
            <p className="text-xs leading-relaxed text-zinc-400">
              You'll be taken to <b className="text-zinc-200">Paystack's secure checkout</b> (USD) to pay. You'll land back here when it's done.
            </p>
          </div>

          <div className="mt-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Promo code (optional)</span>
            <input
              value={promo}
              onChange={(e) => setPromo(e.target.value.toUpperCase())}
              placeholder="PROMOCODE"
              disabled={opening}
              className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm uppercase tracking-[0.1em] text-white placeholder:text-zinc-600 disabled:opacity-50"
              data-testid="sub-input-promo"
            />
          </div>

          {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert" data-testid="subscription-error">{error}</p>}

          <button
            type="button"
            onClick={pay}
            disabled={checkout.isPending || opening}
            className="focus-house mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3b82f6] py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-wait disabled:opacity-60"
            data-testid="sub-button-pay"
          >
            {checkout.isPending || opening ? (
              <><PiCircleNotchDuotone className="h-4 w-4 animate-spin" /> {opening ? 'Opening secure checkout…' : 'Starting checkout…'}</>
            ) : (
              <><PiLockKeyDuotone className="h-4 w-4 text-white/80" /> Pay {price(plan.priceUsd)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
