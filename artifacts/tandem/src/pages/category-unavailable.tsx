import { ArrowLeft, Bell, Check, Mail, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link, useParams } from 'wouter';
import { useCreateWaitlistEntry } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';
import { getTandemCategory } from '@/data/categories';
import AuthorsPage from '@/pages/authors';
import ContentCreatorsPage from '@/pages/content-creators';
import { TicketGate } from '@/components/ticket-gate';
import { useToast } from '@/hooks/use-toast';

export default function CategoryUnavailable() {
  const { slug } = useParams<{ slug: string }>();
  const category = getTandemCategory(slug);
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
  // The paywall: authors and content-creators need an active pass ($1.88 / 3
  // weeks) before the room opens — the coupon-card popup handles the purchase.
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
    <div className="mx-auto max-w-[900px]">
      <Link href="/dashboard" className="focus-house inline-flex items-center gap-2 rounded-full py-2 text-xs font-bold text-zinc-500 hover:text-white" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the atrium
      </Link>
      <div className="reveal mt-10 grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <div>
          <span className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] border-2 border-white/10 bg-[#e1b956] text-white shadow-[6px_7px_0_rgba(41,43,69,0.1)]">
            <category.icon className="h-7 w-7" strokeWidth={1.5} />
          </span>
          <SectionEyebrow>Door {category.shortName.toLowerCase()} / on the blueprint</SectionEyebrow>
          <h1 className="mt-5 text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-white sm:text-8xl">Not quite lit.</h1>
          <p className="mt-7 max-w-[25rem] text-base leading-[1.8] text-zinc-400">{category.description} We&apos;re preparing this room with care.</p>
        </div>
        <div className="rounded-[1.75rem] border-2 border-white/10 bg-[#111111] p-6 shadow-[8px_10px_0_rgba(41,43,69,0.08)] sm:p-9">
          <div className="flex items-start gap-4">
            <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-[#f0c85c]"><Bell className="h-5 w-5" /></span>
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#3b82f6]">Leave a light on</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.05em] text-white">Be first through the door.</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">Add your email and we&apos;ll let you know when {category.shortName.toLowerCase()} has a place in the house.</p>
            </div>
          </div>
          {mutation.isSuccess ? (
            <div className="mt-8 rounded-2xl border-2 border-[#8dc2ad] bg-[#e5f1e8] p-5" role="status" data-testid="status-waitlist-success">
              <div className="flex items-center gap-3 text-[#286254]"><Check className="h-5 w-5" /><span className="font-bold">You&apos;re on the list.</span></div>
              <p className="mt-2 text-sm leading-relaxed text-[#286254]">We&apos;ll keep the light on for {email.trim()}.</p>
            </div>
          ) : (
            <form className="mt-8" onSubmit={submit}>
              <label htmlFor="waitlist-email" className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-500">Email address</label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                  <input id="waitlist-email" name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="focus-house w-full rounded-xl border-2 border-white/10 bg-[#111111] py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600" data-testid="input-waitlist-email" />
                </div>
                <button type="submit" disabled={mutation.isPending} className="focus-house inline-flex items-center justify-center gap-2 rounded-xl bg-[#111111] px-5 py-3.5 text-sm font-bold text-[#fff4e6] transition-colors hover:bg-[#3e8074] disabled:cursor-wait disabled:opacity-60" data-testid="button-notify-me">
                  {mutation.isPending ? 'Saving your place...' : 'Notify me when live'}
                  {!mutation.isPending && <Sparkles className="h-4 w-4 text-[#f0c85c]" />}
                </button>
              </div>
              {mutation.isError && <p className="mt-3 text-sm font-semibold text-[#a33d31]" role="alert" data-testid="status-waitlist-error">{errorMessage}</p>}
              <p className="mt-4 text-xs leading-relaxed text-zinc-600">One note from the house: we&apos;ll only use this to share the opening.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <SectionEyebrow>Door not found</SectionEyebrow>
      <h1 className="mt-5 text-6xl font-extrabold tracking-[-0.08em]">That room moved.</h1>
      <Link href="/dashboard" className="mt-8 inline-flex rounded-full bg-[#111111] px-5 py-3 text-sm font-bold text-[#fff4e6]" data-testid="link-return-rooms">Return to the atrium</Link>
    </div>
  );
}