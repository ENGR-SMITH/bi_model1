// ---------------------------------------------------------------------------
// DenTourGate — the one-time, server-backed preview tour for visitors who do
// not hold an active Tandem pass for this den (Author Den tours against the
// "authors" category, independently of the Creators Den tour).
//
//   · active pass            → the den opens normally, nothing is shown
//   · first visit, no pass   → the 10-minute tour auto-starts; a slim top
//                              countdown bar runs until it hits zero
//   · tour running           → the app works normally during the countdown
//   · tour expired           → "Your tour has ended" notice, then the visitor
//                              is navigated straight back to the Tandem
//                              category page to buy the pass
//   · tour already used      → no re-entry: navigate straight to the paywall
//
// The tour state lives on the server (tandem_tours, one row per user per
// category ever), so refreshing or clearing the browser can never re-grant
// it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { Clock3, Ticket } from 'lucide-react';
import {
  getTicketCategoryAccessQueryKey,
  useStartTicketTour,
  useTicketCategoryAccess,
  type TicketCategory,
} from '@workspace/api-client-react';

const TOUR_LABEL: Record<TicketCategory, string> = {
  authors: 'Author Den',
  'content-creators': 'Creators Den',
};

const PAYWALL_PATH: Record<TicketCategory, string> = {
  authors: '/authors',
  'content-creators': '/content-creators',
};

function fmtClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type Phase = 'loading' | 'open' | 'tour' | 'expired';

export function DenTourGate({ category, children }: { category: TicketCategory; children: ReactNode }) {
  const { isSignedIn } = useAuth();
  const access = useTicketCategoryAccess(category, {
    query: {
      queryKey: getTicketCategoryAccessQueryKey(category),
      enabled: isSignedIn,
      // Keep the entry state fresh while the den is open: buying the pass in
      // another tab clears the countdown on its own; expiry is caught even if
      // this tab slept through an interval.
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });
  const startTour = useStartTicketTour();
  const startAttempted = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const [endsAt, setEndsAt] = useState<number | null>(null);
  // Seconds until the auto-redirect after the tour ends (lets the notice land).
  const [redirectIn, setRedirectIn] = useState(6);

  const data = access.data;

  // Decide what the visitor may do from the server's entry state. A transport
  // failure fails OPEN (the den needs the API anyway; we never want to lock a
  // member out because the status call itself hiccuped).
  useEffect(() => {
    if (!isSignedIn || !data) return;
    // The expiry notice is already up and its own redirect is running — a
    // periodic refetch flipping to tourUsed must not cut the notice short.
    if (phaseRef.current === 'expired') return;
    if (data.passActive) {
      setPhase('open');
      setEndsAt(null);
      return;
    }
    if (data.tourActive && data.tourEndsAt) {
      setPhase('tour');
      setEndsAt((prev) => (prev && prev > Date.now() ? prev : new Date(data.tourEndsAt as string).getTime()));
      return;
    }
    if (data.tourUsed) {
      // The one-time tour has already been spent — only an active pass opens
      // the den again. Go straight back to the Tandem category paywall.
      window.location.replace(PAYWALL_PATH[category]);
      return;
    }
    // Fresh visitor with no pass — grant the one-time tour (guarded on the
    // server; a 409 from a race just refetches to read the real state).
    if (!startAttempted.current) {
      startAttempted.current = true;
      startTour.mutate(
        { category },
        {
          onSuccess: (result) => {
            setEndsAt(new Date(result.tour.endsAt).getTime());
            setPhase('tour');
            void access.refetch();
          },
          onError: () => void access.refetch(),
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, data]);

  // Tick the countdown once a second while the tour is running.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'tour' || endsAt == null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase, endsAt]);

  const remainingMs = phase === 'tour' && endsAt != null ? Math.max(0, endsAt - nowMs) : 0;

  // The countdown hit zero — flip to the "tour over" notice and start the
  // auto-redirect back to the Tandem category page.
  useEffect(() => {
    if (phase !== 'tour' || remainingMs > 0) return;
    setPhase('expired');
    setRedirectIn(6);
  }, [phase, remainingMs]);

  useEffect(() => {
    if (phase !== 'expired') return;
    const id = window.setInterval(() => {
      setRedirectIn((seconds) => {
        if (seconds <= 1) {
          window.location.replace(PAYWALL_PATH[category]);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, category]);

  const inTour = phase === 'tour' && endsAt != null;

  return (
    <>
      {children}

      {/* The slim top countdown bar while the tour is running. */}
      {inTour && (
        <div
          role="status"
          aria-live="polite"
          data-testid="den-tour-bar"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 16px',
            background: 'linear-gradient(90deg, rgba(41,43,69,.96), rgba(62,58,88,.96))',
            backdropFilter: 'blur(8px)',
            color: '#fff',
            fontFamily: 'DM Sans, system-ui, sans-serif',
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: '0 1px 0 rgba(255,255,255,.08), 0 6px 18px rgba(0,0,0,.35)',
          }}
        >
          <Clock3 size={13} color="#f0c674" />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Preview tour of the {TOUR_LABEL[category]} ·{' '}
            <b style={{ fontVariantNumeric: 'tabular-nums', color: '#f0c674' }}>{fmtClock(Math.ceil(remainingMs / 1000))}</b>{' '}
            left — buy a pass to keep access
          </span>
          <span style={{ flex: 1 }} />
          <a
            href={PAYWALL_PATH[category]}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 14px',
              borderRadius: 999,
              background: '#3b82f6',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
            data-testid="den-tour-buy"
          >
            <Ticket size={12} /> Get the pass
          </a>
        </div>
      )}

      {/* The "tour is over" notice — then straight back to the Tandem paywall. */}
      {phase === 'expired' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Your preview tour has ended"
          data-testid="den-tour-over"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            background: 'rgba(30,28,44,.8)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 430,
              padding: '30px 28px',
              borderRadius: 22,
              background: '#fdf8f1',
              border: '1px solid rgba(41,43,69,.12)',
              color: '#292b45',
              textAlign: 'center',
              boxShadow: '0 30px 80px rgba(41,43,69,.35)',
              fontFamily: 'DM Sans, system-ui, sans-serif',
            }}
          >
            <Clock3 size={26} style={{ color: '#b7791f' }} />
            <h2
              style={{
                margin: '14px 0 6px',
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: '-0.03em',
              }}
            >
              Your tour has ended
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: '#625f6d' }}>
              The 10-minute preview of the {TOUR_LABEL[category]} is over. Buy the{' '}
              {category === 'authors' ? 'Authors &amp; Writers' : 'Content Creators'} pass to come back — you&apos;re
              being returned to Tandem to get it.
            </p>
            <a
              href={PAYWALL_PATH[category]}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                marginTop: 20,
                padding: '12px 16px',
                borderRadius: 12,
                background: '#3b82f6',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: 14,
              }}
              data-testid="den-tour-over-buy"
            >
              <Ticket size={15} /> Get the pass
            </a>
            <p style={{ margin: '14px 0 0', fontSize: 11.5, color: '#8d8a99' }} data-testid="den-tour-over-redirect">
              Redirecting to Tandem in {redirectIn}s…
            </p>
          </div>
        </div>
      )}
    </>
  );
}
