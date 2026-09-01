import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Check, CreditCard, FolderOpen, HardDrive, Loader2, Lock, PartyPopper, Sparkles, Ticket, X } from 'lucide-react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';
import {
  getSubscriptionPlansQueryKey,
  usePurchaseSubscription,
  useSubscriptionPlans,
  type SubscriptionCard,
  type SubscriptionPlan,
  type SubscriptionRecord,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Subscriptions & Payments — the TANDEM hub for every plan across the house:
// category passes, Creator Den workspace storage, and Author Den projects.
// Shows the account's full subscription history (type, plan, status, expiry)
// and lets the user subscribe to any available plan here — the same products
// are also payable inline on the Creator Den and Author Den themselves.
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

const KIND_META: Record<string, { icon: typeof Ticket; label: string }> = {
  pass: { icon: Ticket, label: 'Category passes' },
  storage: { icon: HardDrive, label: 'Creator Den · workspace storage' },
  projects: { icon: FolderOpen, label: 'Author Den · work projects' },
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

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const plansQuery = useSubscriptionPlans();
  const data = plansQuery.data;
  const [paying, setPaying] = useState<SubscriptionPlan | null>(null);

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
    <div className="mx-auto max-w-[1060px]">
      <div className="tandem-page-header reveal flex flex-col justify-between gap-5 border-b border-white/5 pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Billing & passes</SectionEyebrow>
          <h1 className="mt-5 text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-7xl">Yours at a glance.</h1>
          <p className="mt-5 max-w-[34rem] text-base leading-[1.8] text-zinc-400">
            Every subscription on your account — category passes, Creators Den storage, and Author&nbsp;Den projects — in one place. Subscribe here, or on the den itself; your plan follows your account.
          </p>
        </div>
        <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-100" data-testid="link-subscriptions-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the atrium
        </Link>
      </div>

      {/* Current usage — the live account state. */}
      <div className="reveal reveal-1 mt-10 grid gap-5 lg:grid-cols-3">
        <div className="soft-lift card-surface rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold text-zinc-100">Passes</span>
            <Ticket className="h-5 w-5 text-[#3b82f6]" />
          </div>
          <p className="mt-2 text-sm text-zinc-500">{activeByPlan.size} active</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data?.current.filter((s) => s.active).length === 0 && (
              <span className="rounded-full bg-white/5 px-3 py-1 font-mono-ui text-[10px] uppercase tracking-[.14em] text-zinc-500">No active pass</span>
            )}
            {data?.current.filter((s) => s.active).map((sub) => (
              <span key={sub.id} className="inline-flex items-center gap-1.5 rounded-full bg-[#34d399]/10 px-3 py-1 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#34d399]">
                <BadgeCheck className="h-3 w-3" />
                {sub.planLabel.split(' ').slice(0, 2).join(' ')} · until {formatDate(sub.periodEnd)}
              </span>
            ))}
          </div>
        </div>

        <div className="soft-lift card-surface rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold text-zinc-100">Storage</span>
            <HardDrive className="h-5 w-5 text-[#34d399]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2 text-sm">
            <span className="text-lg font-bold text-zinc-100">{formatBytes(storageUsed)}</span>
            <span className="text-zinc-500">of {formatBytes(storageTotal)}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#34d399]" style={{ width: `${barPercent(storageUsed, storageTotal)}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{formatBytes(Math.max(0, storageTotal - storageUsed))} left</p>
        </div>

        <div className="soft-lift card-surface rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold text-zinc-100">Projects</span>
            <FolderOpen className="h-5 w-5 text-[#fbbf24]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2 text-sm">
            <span className="text-lg font-bold text-zinc-100">{projectsUsed}</span>
            <span className="text-zinc-500">of {projectsTotal}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${barPercent(projectsUsed, projectsTotal)}%` }} />
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
          const meta = KIND_META[kind] ?? { icon: Ticket, label: 'Plans' };
          const Icon = meta.icon;
          return (
            <section key={kind} className="reveal mt-12">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3b82f6]/10 text-[#3b82f6]"><Icon className="h-4 w-4" /></span>
                <div>
                  <h2 className="text-2xl font-semibold text-zinc-100">{meta.label}</h2>
                </div>
                <div className="h-px flex-1 bg-white/5" />
                <span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-zinc-600">0{index + 1}</span>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupPlans.map((plan) => {
                  const activeSub = activeByPlan.get(`${plan.kind}:${plan.planId}`);
                  return (
                    <div key={`${plan.kind}:${plan.planId}`} className="soft-lift flex flex-col card-surface rounded-2xl p-5" data-testid={`plan-${plan.kind}-${plan.planId}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xl font-semibold leading-none text-zinc-100">{plan.planLabel}</p>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-500">{plan.intervalLabel}</span>
                      </div>
                      <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-zinc-500">{plan.detail}</p>
                      <div className="mt-4 flex items-end justify-between">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold tracking-[-.03em] text-zinc-100">{price(plan.priceUsd)}</span>
                          <span className="text-xs text-zinc-500">/ {plan.intervalLabel}</span>
                        </div>
                      </div>
                      {activeSub ? (
                        <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#34d399]/10 px-4 py-2.5 text-center text-xs font-semibold text-[#34d399]" data-testid={`plan-active-${plan.planId}`}>
                          <Check className="h-3.5 w-3.5" />
                          Active until {formatDate(activeSub.periodEnd)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPaying(plan)}
                          className="focus-house mt-4 rounded-xl bg-[#3b82f6] py-2.5 text-center text-xs font-semibold text-white transition-colors hover:bg-[#2563eb]"
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
                      {sub.active ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
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
          onPaid={() => {
            void queryClient.invalidateQueries({ queryKey: getSubscriptionPlansQueryKey() });
            setPaying(null);
          }}
        />
      )}
    </div>
  );
}

function formatCardNumber(value: string): string {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}
function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function PayModal({ plan, onClose, onPaid }: { plan: SubscriptionPlan; onClose: () => void; onPaid: () => void }) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [promo, setPromo] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cardLast4: string; total: number; promoCode: string | null } | null>(null);

  const purchase = usePurchaseSubscription({
    mutation: {
      onSuccess: (res) => {
        setResult({ cardLast4: res.receipt.cardLast4, total: res.receipt.total, promoCode: res.receipt.promoCode });
      },
      onError: (e: unknown) => {
        const apiError = e as { response?: { data?: { error?: string } }; message?: string } | null;
        setError(apiError?.response?.data?.error || apiError?.message || 'The payment could not be completed. Check your card and try again.');
      },
    },
  });

  const pay = () => {
    setError('');
    const digits = cardNumber.replace(/\D/g, '');
    const [month, year] = expiry.split('/');
    if (digits.length < 12) { setError('Enter the full card number'); return; }
    if (!month || !year || month.length !== 2 || year.length !== 2) { setError('Enter the card expiry as MM/YY'); return; }
    if (!cvc) { setError('Enter the security code'); return; }
    const card: SubscriptionCard = { number: digits, expiryMonth: Number(month), expiryYear: Number(year), cvc };
    purchase.mutate({ data: { kind: plan.kind, planId: plan.planId, card, promoCode: promo.trim() || undefined } });
  };

  return (
    <div className="tandem-modal-backdrop fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="subscription-pay-gate">
      <div className="tandem-modal relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] text-white shadow-2xl">
        <div className="rounded-t-[1.35rem] p-6 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#3b82f6]/10 text-[#3b82f6]">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Subscription</p>
                <h2 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.04em]">{plan.planLabel}</h2>
              </div>
            </div>
            <span className="font-display text-2xl font-extrabold tracking-[-0.04em]">{price(plan.priceUsd)}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">{plan.detail} · billed per {plan.intervalLabel}.</p>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-house absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="relative flex items-center px-2">
          <span className="absolute -left-2 h-4 w-4 rounded-full bg-[#111111]/60" />
          <div className="h-0 flex-1 border-t-2 border-dashed border-white/10" />
          <span className="absolute -right-2 h-4 w-4 rounded-full bg-[#111111]/60" />
        </div>

        {result ? (
          <div className="rounded-b-[1.35rem] p-6 pt-5" data-testid="subscription-success">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#34d399]/10 text-[#34d399]"><PartyPopper className="h-6 w-6" /></span>
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#34d399]">Subscribed</p>
                <h3 className="text-2xl font-extrabold tracking-[-0.04em]">{plan.planLabel}</h3>
              </div>
            </div>
            <p className="mt-4 text-sm text-zinc-400">
              Charged {price(result.total)} · card •••• {result.cardLast4}
              {result.promoCode ? <><br />Promo <b>{result.promoCode}</b> applied.</> : null}
            </p>
            <button type="button" onClick={onPaid} className="focus-house mt-5 w-full rounded-xl bg-[#34d399] py-3.5 text-sm font-bold text-[#052e1c] transition-colors hover:bg-[#2bb883]">Done</button>
          </div>
        ) : (
          <div className="rounded-b-[1.35rem] p-6 pt-5">
            <label className="block">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Card number</span>
              <div className="relative mt-2">
                <CreditCard className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} placeholder="4242 4242 4242 4242" inputMode="numeric" autoComplete="cc-number" className="focus-house w-full rounded-xl border border-white/10 bg-[#111111] py-3 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600" data-testid="sub-input-card" />
              </div>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Expiry</span>
                <input value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/YY" inputMode="numeric" autoComplete="cc-exp" className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] py-3 px-4 text-sm text-white placeholder:text-zinc-600" data-testid="sub-input-expiry" />
              </label>
              <label className="block">
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">CVC</span>
                <input value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="123" inputMode="numeric" autoComplete="cc-csc" className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] py-3 px-4 text-sm text-white placeholder:text-zinc-600" data-testid="sub-input-cvc" />
              </label>
            </div>
            <div className="mt-4">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Promo code</span>
              <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="PROMOCODE" className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm uppercase tracking-[0.1em] text-white placeholder:text-zinc-600" data-testid="sub-input-promo" />
            </div>
            {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert" data-testid="subscription-error">{error}</p>}
            <button type="button" onClick={pay} disabled={purchase.isPending} className="focus-house mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3b82f6] py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-wait disabled:opacity-60" data-testid="sub-button-pay">
              {purchase.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : <><Lock className="h-4 w-4 text-white/80" /> Pay {price(plan.priceUsd)}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}