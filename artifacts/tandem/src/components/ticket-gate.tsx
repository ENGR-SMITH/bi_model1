import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, CreditCard, Loader2, Lock, PartyPopper, Ticket, X } from 'lucide-react';
import {
  getGetTicketStatusQueryKey,
  useGetTicketStatus,
  usePurchaseTicket,
  useValidateTicketPromo,
} from '@workspace/api-client-react';
import type { TicketPromoValidateResponse, TicketPurchaseResponse } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Ticket gate — the TANDEM category paywall. Each available category
// (Author-Writer, Content-Creators) requires an active pass ($1.88 / 3 weeks)
// before the room opens. Without a pass the page renders dimmed behind a
// coupon-style popup where the user pays by card (or applies a promo code).
// ---------------------------------------------------------------------------

function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
    .trim();
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

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
  const active = status.data?.tickets.some((ticket) => ticket.category === slug) ?? false;

  if (status.isLoading) return <>{children}</>;

  return (
    <>
      {/* The room is dimmed behind the popup until a pass is active. */}
      <div className={active ? '' : 'pointer-events-none select-none opacity-30 blur-[1px]'} aria-hidden={!active}>
        {children}
      </div>
      {!active && <PassCoupon slug={slug} name={name} onPurchased={() => void status.refetch()} />}
    </>
  );
}

function PassCoupon({ slug, name, onPurchased }: { slug: string; name: string; onPurchased: () => void }) {
  const queryClient = useQueryClient();
  const status = useGetTicketStatus();
  const priceUsd = status.data?.priceUsd ?? 188;
  const weeks = status.data?.weeks ?? 3;

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<TicketPromoValidateResponse | null>(null);
  const [promoError, setPromoError] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [purchased, setPurchased] = useState<TicketPurchaseResponse | null>(null);

  const validatePromo = useValidateTicketPromo({
    mutation: {
      onSuccess: (result) => {
        if (result.valid) {
          setPromo(result);
          setPromoError('');
        } else {
          setPromo(null);
          setPromoError('That promo code is not valid');
        }
      },
      onError: () => {
        setPromo(null);
        setPromoError('That promo code could not be checked right now');
      },
    },
  });

  const purchase = usePurchaseTicket({
    mutation: {
      onSuccess: (result) => {
        setPurchased(result);
        void queryClient.invalidateQueries({ queryKey: getGetTicketStatusQueryKey() });
      },
      onError: (error) => {
        const apiError = error as { response?: { data?: { error?: string } }; message?: string } | null;
        setPurchaseError(apiError?.response?.data?.error || apiError?.message || 'The payment could not be completed. Check your card and try again.');
      },
    },
  });

  const discountedPriceUsd = promo?.discountedPriceUsd ?? priceUsd;
  const totalLabel = useMemo(() => `$${(discountedPriceUsd / 100).toFixed(2)}`, [discountedPriceUsd]);

  const pay = () => {
    setPurchaseError('');
    const digits = cardNumber.replace(/\D/g, '');
    const [month, year] = expiry.split('/');
    if (digits.length < 12) {
      setPurchaseError('Enter the full card number');
      return;
    }
    if (!month || !year || month.length !== 2 || year.length !== 2) {
      setPurchaseError('Enter the card expiry as MM/YY');
      return;
    }
    if (!cvc) {
      setPurchaseError('Enter the security code');
      return;
    }
    purchase.mutate({
      data: {
        category: slug,
        card: {
          number: digits,
          expiryMonth: Number(month),
          expiryYear: Number(year),
          cvc,
        },
        promoCode: promo?.valid ? promo.code : undefined,
      },
    });
  };

  const applyPromo = () => {
    setPromoError('');
    if (!promoInput.trim()) {
      setPromoError('Enter a promo code first');
      return;
    }
    validatePromo.mutate({ data: { code: promoInput } });
  };

  // Success state — the stamped pass with its expiry, and the way into the room.
  if (purchased) {
    const expires = new Date(purchased.ticket.expiresAt).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return (
      <div className="tandem-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="ticket-success">
        <div className="tandem-modal relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] p-7 text-white shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#34d399]/10 text-[#34d399]">
              <PartyPopper className="h-6 w-6" />
            </span>
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#34d399]">PASS PURCHASED</span>
          </div>
          <h2 className="mt-5 font-display text-3xl font-extrabold tracking-[-0.05em]">
            You're in, {name.split(' ')[0]}.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Your {name} pass is active until <b className="text-white">{expires}</b>
            {purchased.receipt.promoCode ? (
              <span className="mt-2 flex items-center gap-2 text-[#34d399]">
                <BadgeCheck className="h-4 w-4" /> Promo {purchased.receipt.promoCode} applied — {purchased.receipt.discount > 0 ? `you saved $${(purchased.receipt.discount / 100).toFixed(2)}` : 'the pass was free'}.
              </span>
            ) : null}
          </p>
          <div className="mt-5 rounded-2xl border-2 border-dashed border-white/10 bg-[#111111] p-4">
            <div className="flex items-center justify-between font-mono-ui text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              <span>Card •••• {purchased.receipt.cardLast4}</span>
              <span>Total ${(purchased.receipt.total / 100).toFixed(2)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onPurchased}
            className="focus-house mt-6 w-full rounded-xl bg-[#3b82f6] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb]"
            data-testid="button-enter-room"
          >
            Enter the room <Ticket className="ml-1 inline h-4 w-4 text-white/80" />
          </button>
          <button
            type="button"
            className="focus-house absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
            onClick={() => { setPurchased(null); onPurchased(); }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tandem-modal-backdrop fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111111]/60 p-4 backdrop-blur-sm" data-testid="ticket-gate">
      <div className="tandem-modal relative w-full max-w-md rounded-3xl border border-white/10 bg-[#111111] text-white shadow-2xl">
        {/* Coupon stub header */}
        <div className="rounded-t-[1.35rem] p-6 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#3b82f6]/10 text-[#3b82f6]">
                <Ticket className="h-5 w-5" />
              </span>
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">Tandem access pass</p>
                <h2 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.04em]">{name}</h2>
              </div>
            </div>
            <span className="font-display text-2xl font-extrabold tracking-[-0.04em]">{totalLabel}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            A ticket unlocks the whole {name.toLowerCase()} category — <b>{weeks} weeks</b> of access. Renew anytime; a renewal extends the pass.
          </p>
        </div>

        {/* Perforation */}
        <div className="relative flex items-center px-2">
          <span className="absolute -left-2 h-4 w-4 rounded-full bg-[#111111]/60" />
          <div className="h-0 flex-1 border-t-2 border-dashed border-white/10" />
          <span className="absolute -right-2 h-4 w-4 rounded-full bg-[#111111]/60" />
        </div>

        {/* Payment body */}
        <div className="rounded-b-[1.35rem] p-6 pt-5">
          <label className="block">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Card number</span>
            <div className="relative mt-2">
              <CreditCard className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                value={cardNumber}
                onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
                placeholder="4242 4242 4242 4242"
                inputMode="numeric"
                autoComplete="cc-number"
                className="focus-house w-full rounded-xl border border-white/10 bg-[#111111] py-3 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600"
                data-testid="input-card-number"
              />
            </div>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Expiry</span>
              <input
                value={expiry}
                onChange={(event) => setExpiry(formatExpiry(event.target.value))}
                placeholder="MM/YY"
                inputMode="numeric"
                autoComplete="cc-exp"
                className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] py-3 px-4 text-sm text-white placeholder:text-zinc-600"
                data-testid="input-card-expiry"
              />
            </label>
            <label className="block">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">CVC</span>
              <input
                value={cvc}
                onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="123"
                inputMode="numeric"
                autoComplete="cc-csc"
                className="focus-house mt-2 w-full rounded-xl border border-white/10 bg-[#111111] py-3 px-4 text-sm text-white placeholder:text-zinc-600"
                data-testid="input-card-cvc"
              />
            </label>
          </div>

          {/* Promo code */}
          <div className="mt-4">
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Promo code</span>
            <div className="mt-2 flex gap-2">
              <input
                value={promoInput}
                onChange={(event) => {
                  setPromoInput(event.target.value.toUpperCase());
                  setPromo(null);
                  setPromoError('');
                }}
                placeholder="PROMOCODE"
                className="focus-house min-w-0 flex-1 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm uppercase tracking-[0.1em] text-white placeholder:text-zinc-600"
                data-testid="input-promo"
              />
              <button
                type="button"
                onClick={applyPromo}
                disabled={validatePromo.isPending}
                className="focus-house rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition-colors hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/10 disabled:cursor-wait disabled:opacity-60"
                data-testid="button-apply-promo"
              >
                {validatePromo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
              </button>
            </div>
            {promo?.valid && (
              <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#34d399]" data-testid="promo-applied">
                <Check className="h-3.5 w-3.5" /> {promo.code} — {promo.label}. Pass is now {totalLabel}.
              </p>
            )}
            {promoError && (
              <p className="mt-2 text-xs font-semibold text-red-400" role="alert" data-testid="promo-error">
                {promoError}
              </p>
            )}
          </div>

          {purchaseError && (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400" role="alert" data-testid="purchase-error">
              {purchaseError}
            </p>
          )}

          <button
            type="button"
            onClick={pay}
            disabled={purchase.isPending}
            className="focus-house mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3b82f6] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-pay"
          >
            {purchase.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
            ) : (
              <><Lock className="h-4 w-4 text-white/80" /> Pay {totalLabel} · {weeks} weeks</>
            )}
          </button>
          <p className="mt-3 flex items-center gap-2 text-center text-[10px] leading-relaxed text-zinc-600">
            <Lock className="h-3 w-3 shrink-0" />
            Cards are validated securely; only the last four digits are stored. Test card: 4242 4242 4242 4242.
          </p>
        </div>

        {/* Coupon detach footer — barcode + expiry, so the pass reads like a
            printed coupon you tear off along the dashed line. */}          <div className="flex items-center gap-4 border-t border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="h-8 w-5 -rotate-90 rounded-md border border-[#3b82f6]" />
            <span className="font-mono-ui text-[8px] uppercase tracking-[0.18em] text-[#3b82f6]">Tear</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Tandem access pass · {weeks} weeks</p>
            <div className="mt-2 flex h-8 items-end gap-[2px]">
              {Array.from({ length: 26 }).map((_, i) => (
                <span key={i} className="rounded-[1px] bg-zinc-600" style={{ width: '2px', height: `${34 + ((i * 47) % 46)}%` }} />
              ))}
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.16em] text-zinc-500">Valid until</p>
            <p className="mt-1 font-mono-ui text-sm font-medium text-white">
              {new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
