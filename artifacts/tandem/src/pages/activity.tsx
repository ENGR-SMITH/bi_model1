import { Activity as ActivityIcon, ArrowRight, CircleAlert, History, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useListAccountActivity } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';

const eventTone: Record<string, string> = {
  seed_published: 'bg-[#f0c85c] text-[#292b45]',
  continuation_submitted: 'bg-[#3e8074] text-[#fff4e6]',
  continuation_annotated: 'bg-[#3e8074] text-[#fff4e6]',
  message_sent: 'bg-[#292b45] text-[#f0c85c]',
  continuation_declined: 'bg-[#e55b4c] text-[#fff4e6]',
  respondent_selected: 'bg-[#3e8074] text-[#fff4e6]',
  contract_approved: 'bg-[#292b45] text-[#fff4e6]',
  contract_locked: 'bg-[#f0c85c] text-[#292b45]',
  block_submitted: 'bg-[#3e8074] text-[#fff4e6]',
  block_approved: 'bg-[#3e8074] text-[#fff4e6]',
  story_bible_updated: 'bg-[#292b45] text-[#fff4e6]',
};

export default function ActivityPage() {
  const q = useListAccountActivity();
  const events: any[] = q.data || [];

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="reveal flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Your trail / activity</SectionEyebrow>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
            A clear record.
          </h1>
        </div>
        <p className="max-w-sm border-l-2 border-[#d6cbb9] pl-5 text-sm leading-[1.8] text-[#625f6d]">
          Every room you are part of — seeds you published, continuations you received or sent, contracts locked, passes approved. Summaries only; hidden prose never enters this log.
        </p>
      </div>

      <div className="mt-12">
        {q.isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[1.25rem] bg-[#e5d7c5]" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="rounded-[1.5rem] border-2 border-[#e55b4c]/40 bg-[#fff4e6] p-8">
            <CircleAlert className="text-[#e55b4c]" />
            <p className="mt-4 font-display text-3xl italic">The record could not be opened.</p>
            <p className="mt-2 text-sm text-[#77717a]">Your work is safe. Try again in a moment.</p>
            <button onClick={() => q.refetch()} className="focus-house mt-5 rounded-full bg-[#292b45] px-5 py-3 text-sm font-bold text-[#fff4e6]">
              Try again
            </button>
          </div>
        ) : events.length ? (
          (() => {
            // Group events by calendar day so the trail reads like a journal.
            const groups = new Map<string, any[]>();
            for (const event of events) {
              const day = new Date(event.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
              const list = groups.get(day) ?? [];
              list.push(event);
              groups.set(day, list);
            }
            return <div className="space-y-10">{[...groups.entries()].map(([day, dayEvents]) => (
              <section key={day} aria-label={day}>
                <div className="flex items-center gap-4"><h2 className="font-display text-2xl italic text-[#292b45]">{day}</h2><span className="h-px flex-1 bg-[#d6cbb9]" /></div>
                <div className="mt-5 space-y-3">{dayEvents.map((event) => {
                  const tone = eventTone[event.eventType] ?? 'bg-[#f2e7d8] text-[#292b45]';
                  return (
                    <div key={event.id} data-testid={`account-activity-${event.id}`} className="soft-lift flex items-start gap-4 rounded-[1.25rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-5">
                      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
                        <History className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-relaxed text-[#292b45]">{event.summary}</p>
                        <span className="mt-1 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">
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
          <div className="rounded-[1.75rem] border-2 border-[#d6cbb9] bg-[#fff4e6] p-7 shadow-[8px_10px_0_rgba(41,43,69,0.08)] sm:p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#292b45] text-[#f0c85c]">
              <ActivityIcon className="h-6 w-6" strokeWidth={1.6} />
            </div>
            <p className="mt-8 font-display text-4xl italic text-[#292b45]">Nothing has moved yet.</p>
            <p className="mt-4 max-w-xl text-sm leading-[1.8] text-[#77717a]">
              Publish a seed, answer a seed, or open a room and your trail will gather here — every publish, submission, selection, contract lock, and approved pass.
            </p>
            <Link href="/authors/pitch-board" className="focus-house mt-8 inline-flex items-center gap-2 rounded-full bg-[#e55b4c] px-5 py-3 text-sm font-bold text-[#fff4e6]" data-testid="link-activity-dashboard">
              Visit the pitch board
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs text-[#98909a]">
        <Sparkles className="h-4 w-4 text-[#e1b956]" />
        <span>Activity reflects your rooms only — private by design.</span>
      </div>
    </div>
  );
}
