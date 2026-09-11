import { PiArrowLeftDuotone, PiBellDuotone, PiCheckDuotone, PiEnvelopeDuotone, PiSparkleDuotone } from 'react-icons/pi';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link, useParams } from 'wouter';
import { useCreateWaitlistEntry } from '@workspace/api-client-react';
import { getNexetCategory, nexetUpcomingCategories } from '@/data/categories';
import AuthorsPage from '@/pages/authors';
import ContentCreatorsPage from '@/pages/content-creators';
import { TicketGate } from '@/components/ticket-gate';
import { useToast } from '@/hooks/use-toast';

export default function CategoryUnavailable() {
  const { slug } = useParams<{ slug: string }>();
  const category = getNexetCategory(slug);
  const [email, setEmail] = useState('');
  const { user } = useUser();
  const mutation = useCreateWaitlistEntry();
  const { toast } = useToast();

  useEffect(() => {
    const profileEmail = user?.primaryEmailAddress?.emailAddress;
    if (profileEmail && !email) setEmail(profileEmail);
  }, [email, user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    if (mutation.isSuccess && category) {
      toast({
        title: `${category.shortName} is on the list`,
        description: `We’ll let you know when the ${category.shortName.toLowerCase()} room opens.`,
      });
    }
  }, [category, mutation.isSuccess, toast]);

  if (!category) return <CategoryNotFound />;
  // The paywall: authors and content-creators need an active pass ($5.88 /
  // month) before the room opens — the coupon-card popup handles the purchase.
  if (category.slug === 'authors') {
    return (
      <TicketGate slug="authors" name={category.name}>
        <AuthorsPage />
      </TicketGate>
    );
  }
  if (category.slug === 'content-creators') {
    return (
      <TicketGate slug="content-creators" name={category.name}>
        <ContentCreatorsPage />
      </TicketGate>
    );
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    mutation.mutate({ data: { categorySlug: category.slug, email: email.trim() } });
  };

  const apiError = mutation.error as { response?: { data?: { error?: string } }; message?: string } | null;
  const errorMessage = apiError?.response?.data?.error || apiError?.message || 'We could not save that just yet. Try once more.';

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/dashboard" className="focus-house group inline-flex items-center gap-2 rounded-full py-2 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-back-dashboard">
        <PiArrowLeftDuotone className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
        Back to the atrium
      </Link>
      <div className="reveal mt-10 grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <div>
          <span className="icon-chip h-16 w-16 text-[#3b82f6]">
            <category.icon className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-white sm:text-8xl">Not quite lit.</h1>
          <p className="mt-7 max-w-[25rem] text-base leading-[1.8] text-zinc-400">{category.description} We&apos;re preparing this room with care.</p>
        </div>
        <div className="card-surface rounded-[1.75rem] p-6 sm:p-9">
          <div className="flex items-start gap-4">
            <span className="mt-1 icon-chip h-11 w-11 shrink-0 text-[#3b82f6]"><PiBellDuotone className="h-5 w-5 animate-breathe" /></span>
            <div>
              <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em] text-white">Be first through the door.</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">Add your email and we&apos;ll let you know when {category.shortName.toLowerCase()} has a place in the house.</p>
            </div>
          </div>
          {mutation.isSuccess ? (
            <div className="mt-8 rounded-2xl border border-[#34d399]/30 bg-[#34d399]/10 p-5" role="status" data-testid="status-waitlist-success">
              <div className="flex items-center gap-3 text-[#34d399]"><PiCheckDuotone className="h-5 w-5" /><span className="font-bold">You&apos;re on the list.</span></div>
              <p className="mt-2 text-sm leading-relaxed text-[#34d399]">We&apos;ll keep the light on for {email.trim()}.</p>
            </div>
          ) : (
            <form className="mt-8" onSubmit={submit}>
              <label htmlFor="waitlist-email" className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Email address</label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <PiEnvelopeDuotone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                  <input id="waitlist-email" name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="focus-house w-full rounded-xl border border-white/10 bg-[#111111] py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600" data-testid="input-waitlist-email" />
                </div>
                <button type="submit" disabled={mutation.isPending} className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#3b82f6] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-wait disabled:opacity-60" data-testid="button-notify-me">
                  {mutation.isPending ? 'Saving your place...' : 'Notify me when live'}
                  {!mutation.isPending && <PiSparkleDuotone className="h-4 w-4 text-white/80" />}
                </button>
              </div>
              {mutation.isError && <p className="mt-3 text-sm font-semibold text-red-400" role="alert" data-testid="status-waitlist-error">{errorMessage}</p>}
              <p className="mt-4 text-xs leading-relaxed text-zinc-600">One note from the house: we&apos;ll only use this to share the opening.</p>
            </form>
          )}
        </div>
      </div>

      {/* Explore All is the doorway to the rooms still on the blueprint, so its
          page lays those rooms out as cards instead of one vague waitlist. */}
      {category.slug === 'explore' && (
        <section className="reveal reveal-1 mt-20" data-testid="explore-upcoming-features">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <h2 className="max-w-[14ch] text-4xl font-extrabold leading-[.95] tracking-[-0.05em] text-white sm:text-5xl">The rooms behind this door.</h2>
            <p className="max-w-[24rem] text-sm leading-relaxed text-zinc-400">Each one is a separate room on the blueprint. Open a card to hold your place in line for it.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {nexetUpcomingCategories.map((upcoming) => {
              const UpcomingIcon = upcoming.icon;
              return (
                <Link
                  key={upcoming.slug}
                  href={`/categories/${upcoming.slug}`}
                  className="focus-house group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl border border-white/10 card-surface card-surface-hover p-6 transition-all hover:-translate-y-1 hover:border-white/20"
                  data-testid={`card-explore-upcoming-${upcoming.slug}`}
                >
                  <span className="card-spot" />
                  <span className="card-shine" />
                  <div className="relative flex items-center justify-between">
                    <span className="icon-chip h-12 w-12 text-zinc-300">
                      <UpcomingIcon className="h-6 w-6" />
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono-ui text-[9px] uppercase tracking-[0.13em] text-zinc-400">
                      Coming soon
                    </span>
                  </div>
                  <div className="relative mt-8">
                    <h3 className="max-w-[14ch] text-xl font-bold leading-[1.05] tracking-[-0.03em] text-zinc-100">{upcoming.name}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-zinc-500">{upcoming.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function CategoryNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">That room moved.</h1>
      <Link href="/dashboard" className="mt-8 inline-flex rounded-lg bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb]" data-testid="link-return-rooms">Return to the atrium</Link>
    </div>
  );
}