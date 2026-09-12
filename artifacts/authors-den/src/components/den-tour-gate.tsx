// ---------------------------------------------------------------------------
// DenTourGate — the one-time, server-backed preview tour for visitors who do
// not hold an active Nexet pass for this den (Author Den tours against the
// "authors" category, independently of the Creators Den tour).
//
//   · active pass            → the den opens normally, nothing is shown
//   · first visit, no pass   → the den's tour (20 minutes here, the length the
//                              server grants — see TOUR_MINUTES_BY_CATEGORY)
//                              auto-starts with no banner; the expiry notice is
//                              the only moment anything is shown while access is
//                              restricted
//   · tour running           → the app works normally during the countdown
//   · tour expired           → "Your tour has ended" notice pops up — the only
//                              moment the ticket appears, since access is now
//                              actually restricted — then the visitor is
//                              navigated back to the Nexet category page to
//                              buy the pass
//   · tour already used      → no re-entry: navigate straight to the paywall
//
// The tour state lives on the server (nexet_tours, one row per user per
// category ever), so refreshing or clearing the browser can never re-grant
// it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  authors: '/categories/authors',
  'content-creators': '/categories/content-creators',
};

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
      // the den again. Go straight back to the Nexet category paywall.
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
  // The server owns the tour length; the copy reads it back so the notice can
  // never claim a length the den did not actually grant.
  const tourMinutes = data?.tourMinutes ?? 10;

  // The countdown hit zero — flip to the "tour over" notice and start the
  // auto-redirect back to the Nexet category page.
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

  return (
    <>
      {children}

      {/* The "tour is over" notice — then straight back to the Nexet paywall. */}
      {phase === 'expired' && (
        <div
          className="tour-over-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Your preview tour has ended"
          data-testid="den-tour-over"
        >
          <div className="tour-over-card">
            <span className="tour-over-rule" aria-hidden />
            <span className="tour-over-badge" aria-hidden>
              <Clock3 size={22} />
            </span>
            <p className="tour-over-eyebrow">PREVIEW TOUR · {TOUR_LABEL[category].toUpperCase()}</p>
            <h2>Your tour has ended</h2>
            <p className="tour-over-copy">
              The {tourMinutes}-minute preview is over, so the desk is closing. Take the{' '}
              {category === 'authors' ? 'Authors &amp; Writers' : 'Content Creators'} pass and the room
              opens again right where you left it.
            </p>

            <div className="tour-over-ring" style={{ '--countdown': String((redirectIn / 6) * 100) } as CSSProperties}>
              <span>{redirectIn}</span>
            </div>

            <a className="tour-over-cta" href={PAYWALL_PATH[category]} data-testid="den-tour-over-buy">
              <Ticket size={15} /> Get the pass
            </a>
            <p className="tour-over-note" data-testid="den-tour-over-redirect">
              Returning to Nexet in {redirectIn}s — the pass works in every den.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
