import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PiArrowUpRightDuotone, PiCheckCircleDuotone, PiCircleNotchDuotone, PiConfettiDuotone, PiLockKeyDuotone, PiTicketDuotone, PiXDuotone } from 'react-icons/pi';
import {
  confirmPaystackCheckout,
  getGetTicketStatusQueryKey,
  getTicketCategoryAccessQueryKey,
  useCreatePaystackCheckout,
  useGetTicketStatus,
  useTicketCategoryAccess,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Ticket gate — the TANDEM category paywall. Each available category
// (Author-Writer, Content-Creators) requires an active pass ($1.88 / 3 weeks)
// before the room opens. Without a pass the page renders dimmed behind a
// coupon-style popup. Payment runs through Paystack's hosted checkout (USD):
// the popup opens a Paystack page, and when the customer returns the gate
// confirms the charge (?reference=…) before the room unlocks. No card
// details are ever collected here.
// ---------------------------------------------------------------------------

export function TicketGate({
  slug,
  name,
  children,
}: {
  slug: 'authors' | 'content-creators';
  name: string;
  children: ReactNode;
}) {
  const status = useGetTicketStatus();
  const access = useTicketCategoryAccess(slug, {
    query: { queryKey: getTicketCategoryAccessQueryKey(slug) },
  });
  const active = status.data?.tickets.some((ticket) => ticket.category === slug) ?? false;

  // Paystack return: the checkout redirects back with ?reference=… — confirm
  // the charge server-side, unlock the room, and show the stamped pass.
  const [confirming, setConfirming] = useState(false);
  const [returnStamp, setReturnStamp] = useState<{ expiresAt: string; total: number; cardLast4: string | null; promoCode: string | null } | null>(null);

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference) return;
    let disposed = false;
    setConfirming(true);
    void (async () => {
      try {
        const res = await confirmPaystackCheckout({ reference });
        if (disposed) return;
        window.history.replaceState(window.history.state, '', window.location.pathname);
        if (res.granted) {
          const refreshed = await status.refetch();
          if (disposed) return;
          const ticket = refreshed.data?.tickets.find((item) => item.category === slug);
          setReturnStamp({
            expiresAt:
              ticket?.expiresAt ??
              new Date(Date.now() + (refreshed.data?.weeks ?? 3) * 7 * 24 * 60 * 60 * 1000).toISOString(),
            total: res.receipt?.total ?? 0,
            cardLast4: res.receipt?.cardLast4 ?? null,
            promoCode: res.receipt?.promoCode ?? null,
          });
        }
      } catch {
        // Confirmation failed — the gate simply stays as the status query says.
      } finally {
        if (!disposed) setConfirming(false);
      }
    })();
    return () => {
      disposed = true;
    };
    // Runs once per page load — the reference arrives on the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status.isLoading || access.isLoading) return <>{children}</>;

  // A visitor who has NOT spent their one-time free tour yet — either a fresh
  // account (canStartTour) or a tour still running — must NOT get the paywall
  // popup. The ticket only appears once the tour is exhausted and access is
  // actually restricted; meanwhile they get a quiet free-preview strip.
  const canPreview = !active && (access.data?.tourActive === true || access.data?.canStartTour === true);

  return (
    <>
      {/* The room is dimmed behind the popup only when a pass is required. */}
      <div className={active || canPreview ? '' : 'pointer-events-none select-none opacity-30 blur-[1px]'} aria-hidden={!active && !canPreview}>
        {children}
      </div>
      {!active && canPreview && (
        <FreePreviewStrip slug={slug} name={name} previewing={access.data?.tourActive === true} />
      )}
      {!active && !canPreview && <PassCoupon slug={slug} name={name} onPurchased={() => void status.refetch()} />}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="ticket-confirming">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111111] p-8 text-center text-white shadow-2xl">
            <PiCircleNotchDuotone className="mx-auto h-8 w-8 animate-spin text-[#3b82f6]" />
            <p className="mt-4 text-sm font-semibold text-zinc-100">Confirming your payment…</p>
            <p className="mt-1 text-xs text-zinc-500">This can take a few seconds.</p>
          </div>
        </div>
      )}
      {returnStamp && (
        <PassStamp
          name={name}
          weeks={status.data?.weeks ?? 3}
          expiresAt={returnStamp.expiresAt}
          total={returnStamp.total}
          cardLast4={returnStamp.cardLast4}
          promoCode={returnStamp.promoCode}
          discount={Math.max(0, (status.data?.priceUsd ?? 188) - returnStamp.total)}
          onDone={() => setReturnStamp(null)}
        />
      )}
    </>
  );
}

// The stamped pass receipt — shown right after a purchase (including a FREE
// promo granted server-side) or when the customer returns from the Paystack
// checkout.
function PassStamp({
  name,
  weeks,
  expiresAt,
  total,
  cardLast4,
  promoCode,
  discount,
  onDone,
}: {
  name: string;
  weeks: number;
  expiresAt: string;
  total: number;
  cardLast4: string | null;
  promoCode: string | null;
  discount: number;
  onDone: () => void;
}) {
  const expires = new Date(expiresAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="ticket-success">
      <div className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#131316]/90 p-7 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] backdrop-blur-xl">
        <span className="card-spot" />
        <span className="card-shine" />
        <div className="relative flex items-center justify-between">
          <span className="icon-chip h-14 w-14 text-[#34d399]">
            <PiConfettiDuotone className="h-7 w-7" />
          </span>
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#34d399]">PASS PURCHASED</span>
        </div>
        <h2 className="mt-5 font-display text-3xl font-extrabold tracking-[-0.05em]">
          You're in, {name.split(' ')[0]}.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Your {name} pass is active until <b className="text-white">{expires}</b>
          {promoCode ? (
            <span className="mt-2 flex items-center gap-2 text-[#34d399]">
              <PiCheckCircleDuotone className="h-4 w-4" /> Promo {promoCode} applied —{' '}
              {discount > 0 ? `you saved $${(discount / 100).toFixed(2)}` : 'the pass was free'}.
            </span>
          ) : null}
        </p>
        <div className="mt-5 rounded-2xl border-2 border-dashed border-white/10 bg-[#111111] p-4">
          <div className="flex items-center justify-between font-mono-ui text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            <span>{cardLast4 ? <>Card •••• {cardLast4}</> : <>Free pass</>}</span>
            <span>Total ${(total / 100).toFixed(2)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="focus-house relative mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_-12px_rgba(59,130,246,.8)] transition-all hover:brightness-110 hover:shadow-[0_16px_36px_-12px_rgba(139,92,246,.9)]"
          data-testid="button-enter-room"
        >
          Enter the room <PiTicketDuotone className="inline h-4 w-4 text-white/80" />
        </button>
        <button
          type="button"
          className="focus-house absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
          onClick={onDone}
          aria-label="Close"
        >
          <PiXDuotone className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FreePreviewStrip({
  slug,
  name,
  previewing,
}: {
  slug: 'authors' | 'content-creators';
  name: string;
  previewing: boolean;
}) {
  const denPath = slug === 'authors' ? '/authors-den/' : '/creators-den/';
  return (
    <div
      className="mx-auto mt-4 flex max-w-[1320px] items-center justify-between gap-4 rounded-xl border border-[#3b82f6]/30 bg-[#3b82f6]/10 px-4 py-3"
      data-testid="free-preview-strip"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="icon-chip h-9 w-9 shrink-0 text-[#60a5fa]">
          <PiTicketDuotone className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">
            {previewing ? `You're previewing ${name} free` : `Preview ${name} free for 10 minutes`}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {previewing
              ? 'Your free tour is still running — no card needed yet.'
              : 'Take the free tour before you buy — no card needed.'}
          </p>
        </div>
      </div>
      <a
        href={denPath}
        className="focus-house inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#2563eb]"
        data-testid="link-start-free-tour"
      >
        {previewing ? 'Resume the tour' : 'Tour it free'}
        <PiArrowUpRightDuotone className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function PassCoupon({ slug, name, onPurchased }: { slug: string; name: string; onPurchased: () => void }) {
  const queryClient = useQueryClient();
  const status = useGetTicketStatus();
  const priceUsd = status.data?.priceUsd ?? 188;
  const weeks = status.data?.weeks ?? 3;

  const [promoInput, setPromoInput] = useState('');
  const [stamp, setStamp] = useState<{ expiresAt: string; total: number; cardLast4: string | null; promoCode: string | null } | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const checkout = useCreatePaystackCheckout({
    mutation: {
      onSuccess: (res) => {
        if (res.granted) {
          // A FREE promo (full discount) is granted server-side — no redirect.
          setStamp({
            expiresAt: new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString(),
            total: 0,
            cardLast4: null,
            promoCode: promoInput.trim() || null,
          });
          void queryClient.invalidateQueries({ queryKey: getGetTicketStatusQueryKey() });
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
        const err = e as { response?: { data?: { error?: string } }; message?: string } | null;
        setError(err?.response?.data?.error || err?.message || 'The payment could not be started. Please try again.');
      },
    },
  });

  const callbackUrl = `${window.location.origin}${window.location.pathname}`;
  const busy = checkout.isPending || opening;

  const pay = () => {
    setError('');
    checkout.mutate({
      data: {
        kind: 'pass',
        planId: slug,
        promoCode: promoInput.trim() || undefined,
        callbackUrl,
      },
    });
  };

  if (stamp) {
    return (
      <PassStamp
        name={name}
        weeks={weeks}
        expiresAt={stamp.expiresAt}
        total={stamp.total}
        cardLast4={stamp.cardLast4}
        promoCode={stamp.promoCode}
        discount={Math.max(0, priceUsd - stamp.total)}
        onDone={() => {
          setStamp(null);
          onPurchased();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="ticket-gate">
      <div className="soft-lift group relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#131316]/90 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] backdrop-blur-xl">
        <span className="card-spot" />
        <span className="card-shine" />

        {/* Coupon stub header */}
        <div className="relative p-7 pb-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="icon-chip h-12 w-12 shrink-0 text-[#60a5fa] shadow-[0_0_24px_-6px_rgba(59,130,246,.55)]">
              <PiTicketDuotone className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-[#60a5fa]">Tandem access pass</p>
              <h2 className="mt-1 truncate font-display text-2xl font-extrabold tracking-[-0.04em] text-white">{name}</h2>
            </div>
          </div>

          {/* Price — its own row under the title. */}
          <div className="mt-6 flex items-baseline gap-1.5">
            <span className="font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.05em] text-[#34d399] drop-shadow-[0_0_18px_rgba(52,211,153,.35)]">${(priceUsd / 100).toFixed(2)}</span>
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#34d399]/70">/ {weeks} weeks</span>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">
            Unlocks the whole room. Renewing extends your pass.
          </p>
          {/* The free tour is offered on the room page while the visitor is
              still eligible — by the time this popup renders, the one-time
              tour has been spent and only a pass opens the room again. */}
        </div>

        {/* Perforation */}
        <div className="relative flex items-center px-2">
          <span className="absolute -left-2 h-4 w-4 rounded-full bg-[#131316]/90" />
          <div className="h-0 flex-1 border-t-2 border-dashed border-white/10" />
          <span className="absolute -right-2 h-4 w-4 rounded-full bg-[#131316]/90" />
        </div>

        {/* Payment body — Paystack hosted checkout (USD), no card fields. */}
        <div className="relative p-7 pt-6">
          <div className="flex items-start gap-3 rounded-2xl border border-[#34d399]/15 bg-gradient-to-br from-[#34d399]/10 to-transparent p-3.5">
            <span className="icon-chip h-8 w-8 shrink-0 text-[#34d399]">
              <PiLockKeyDuotone className="h-3.5 w-3.5" />
            </span>
            <p className="text-xs leading-relaxed text-zinc-300">
              You'll be taken to <b className="text-white">Paystack's secure checkout</b> (USD) to pay. You'll land back here when it's done.
            </p>
          </div>

          <div className="mt-5">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-zinc-500">Promo code (optional)</span>
            <input
              value={promoInput}
              onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
              placeholder="PROMOCODE"
              disabled={busy}
              className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm uppercase tracking-[0.1em] text-white placeholder:text-zinc-600 transition-colors focus:border-[#3b82f6]/50 disabled:opacity-50"
              data-testid="input-promo"
            />
          </div>

          {error && (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert" data-testid="purchase-error">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={pay}
            disabled={checkout.isPending || opening}
            className="focus-house mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_-12px_rgba(59,130,246,.8)] transition-all hover:brightness-110 hover:shadow-[0_16px_36px_-12px_rgba(139,92,246,.9)] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-pay"
          >
            {busy ? (
              <><PiCircleNotchDuotone className="h-4 w-4 animate-spin" /> {opening ? 'Opening secure checkout…' : 'Starting checkout…'}</>
            ) : (
              <><PiLockKeyDuotone className="h-4 w-4 text-white/80" /> Pay ${(priceUsd / 100).toFixed(2)} · {weeks} weeks</>
            )}
          </button>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-[10px] leading-relaxed text-zinc-600">
            <PiLockKeyDuotone className="h-3 w-3 shrink-0 text-[#34d399]" />
            Secure checkout by Paystack — no card details ever pass through this site.
          </p>
        </div>

        {/* Pass specs — what the ticket covers, replacing the old coupon stub. */}
        <div className="relative grid grid-cols-3 gap-3 border-t border-white/10 bg-white/[.02] px-7 py-4">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-zinc-500">Pass length</p>
            <p className="mt-1 text-sm font-bold text-white">{weeks} weeks</p>
          </div>
          <div className="border-l border-white/10 pl-3">
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-zinc-500">Unlocks</p>
            <p className="mt-1 text-sm font-bold leading-tight text-white">{name}</p>
          </div>
          <div className="border-l border-white/10 pl-3">
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-zinc-500">Payment</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-white">
              <PiLockKeyDuotone className="h-3 w-3 shrink-0 text-[#34d399]" /> Paystack
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
