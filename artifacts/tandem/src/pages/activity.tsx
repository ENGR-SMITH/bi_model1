import { Activity as ActivityIcon, ArrowRight, CircleAlert, History, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useListAccountActivity } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';

const eventTone: Record<string, string> = {
  seed_published: 'bg-[#3b82f6]/20 text-[#60a5fa]',
  continuation_submitted: 'bg-[#34d399]/20 text-[#34d399]',
  continuation_annotated: 'bg-[#34d399]/20 text-[#34d399]',
  message_sent: 'bg-[#8b5cf6]/20 text-[#a78bfa]',
  continuation_declined: 'bg-red-500/20 text-red-400',
  respondent_selected: 'bg-[#34d399]/20 text-[#34d399]',
  contract_approved: 'bg-[#3b82f6]/20 text-[#3b82f6]',
  contract_locked: 'bg-[#fbbf24]/20 text-[#fbbf24]',
  block_submitted: 'bg-[#34d399]/20 text-[#34d399]',
  block_approved: 'bg-[#34d399]/20 text-[#34d399]',
  story_bible_updated: 'bg-[#3b82f6]/20 text-[#3b82f6]',
};

export default function ActivityPage() {
  const q = useListAccountActivity();
  const events: any[] = q.data || [];

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="tandem-page-header reveal flex flex-col justify-between gap-5 border-b border-white/5 pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Your trail / activity</SectionEyebrow>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-8xl">
            A clear record.
          </h1>
        </div>
        <p className="max-w-sm border-l border-white/10 pl-5 text-sm leading-[1.8] text-zinc-400">
          Every room you are part of — seeds you published, continuations you received or sent, contracts locked, passes approved. Summaries only; hidden prose never enters this log.
        </p>
      </div>

      <div className="mt-12">
        {q.isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
            <CircleAlert className="text-red-400" />
            <p className="mt-4 text-3xl font-semibold text-zinc-100">The record could not be opened.</p>
            <p className="mt-2 text-sm text-zinc-500">Your work is safe. Try again in a moment.</p>
            <button onClick={() => q.refetch()} className="focus-house mt-5 rounded-full bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white">
              Try again
            </button>
          </div>
        ) : events.length ? (
          (() => {
            const groups = new Map<string, any[]>();
            for (const event of events) {
              const day = new Date(event.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
              const list = groups.get(day) ?? [];
              list.push(event);
              groups.set(day, list);
            }
            return <div className="space-y-10">{[...groups.entries()].map(([day, dayEvents]) => (
              <section key={day} aria-label={day}>
                <div className="flex items-center gap-4"><h2 className="text-2xl font-semibold text-zinc-100">{day}</h2><span className="h-px flex-1 bg-white/5" /></div>
                <div className="mt-5 space-y-3">{dayEvents.map((event) => {
                  const tone = eventTone[event.eventType] ?? 'bg-white/10 text-zinc-300';
                  return (
                    <div key={event.id} data-testid={`account-activity-${event.id}`} className="soft-lift flex items-start gap-4 rounded-2xl border card-surface p-5">
                      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
                        <History className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-relaxed text-zinc-100">{event.summary}</p>
                        <span className="mt-1 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-500">
                          {event.eventType.replaceAll('_', ' ')} · {new Date(event.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}</div>
              </section>
            ))}</div>;
          })()
        ) : (
          <div className="card-surface rounded-2xl p-7 sm:p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3b82f6]/10 text-[#3b82f6]">
              <ActivityIcon className="h-6 w-6" strokeWidth={1.6} />
            </div>
            <p className="mt-8 text-4xl font-semibold text-zinc-100">Nothing has moved yet.</p>
            <p className="mt-4 max-w-xl text-sm leading-[1.8] text-zinc-500">
              Publish a seed, answer a seed, or open a room and your trail will gather here — every publish, submission, selection, contract lock, and approved pass.
            </p>
            <Link href="/authors/pitch-board" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white" data-testid="link-activity-dashboard">
              Visit the pitch board
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-zinc-500">
        <Sparkles className="h-4 w-4 text-[#3b82f6]" />
        <span>Activity reflects your rooms only — private by design.</span>
      </div>
    </div>
  );
}
