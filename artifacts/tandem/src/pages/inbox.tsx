import { PiArrowRightDuotone, PiChatCircleDuotone, PiFileTextDuotone, PiHourglassDuotone, PiPenDuotone, PiTrayDuotone, PiUsersDuotone } from 'react-icons/pi';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import {
  useGetCollaborationInbox,
  useListCollaborationProjects,
  useListCollaborationThreads,
  useListContinuations,
  useMarkCollaborationNotificationRead,
  getListContinuationsQueryKey,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';

function roleLabel(project: any, role: string) {
  return project.creatorId === role ? project.creatorName : project.respondentName;
}

export default function InboxPage() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const inboxQ = useGetCollaborationInbox({ query: { queryKey: ['collaboration-inbox'] } });
  const threadsQ = useListCollaborationThreads({ query: { queryKey: ['collaboration-inbox-threads'] } });
  const projectsQ = useListCollaborationProjects();
  const continuationsQ = useListContinuations({ query: { queryKey: getListContinuationsQueryKey() } });
  const mark = useMarkCollaborationNotificationRead();

  const notes: any[] = inboxQ.data || [];
  const threads: any[] = threadsQ.data || [];
  const projects: any[] = projectsQ.data || [];
  const continuations: any[] = continuationsQ.data || [];

  const unreadNotes = notes.filter((n: any) => !n.read);
  const unreadThreads = threads.filter((t: any) => t.unread);
  const unreadCount = unreadNotes.length + unreadThreads.length;
  const pendingReviews = continuations.filter((c: any) => c.status === 'UNDER_REVIEW');

  const urgent: Array<{ kind: string; label: string; body: string; href: string; icon: React.ReactNode }> = [];
  projects.forEach((p: any) => {
    const myRole = p.creatorId === user?.id ? 'CREATOR' : 'RESPONDENT';
    const myApproved = p.creatorId === user?.id ? p.creatorApproved : p.respondentApproved;
    if (p.status === 'CONTRACT_PENDING' && !myApproved) {
      urgent.push({ kind: 'contract', label: 'Contract action required', body: `Approve the contract for “${p.title}” so the room can open.`, href: `/authors-den/?project=${p.id}`, icon: <PiFileTextDuotone className="h-4 w-4" /> });
    } else if (p.status === 'ACTIVE' && p.currentTurn === myRole) {
      urgent.push({ kind: 'turn', label: 'Your turn', body: `The next pass in “${p.title}” is yours to write.`, href: `/authors-den/?project=${p.id}`, icon: <PiPenDuotone className="h-4 w-4" /> });
    } else if (p.status === 'ACTIVE') {
      urgent.push({ kind: 'waiting', label: 'Waiting on partner', body: `${roleLabel(p, p.currentTurn)} is carrying “${p.title}”.`, href: `/authors-den/?project=${p.id}`, icon: <PiHourglassDuotone className="h-4 w-4" /> });
    }
  });
  if (pendingReviews.length) {
    urgent.push({ kind: 'review', label: 'Review pending', body: `${pendingReviews.length} continuation${pendingReviews.length === 1 ? '' : 's'} waiting on your eye.`, href: '/authors/collaborations/continuations', icon: <PiTrayDuotone className="h-4 w-4" /> });
  }
  if (unreadNotes.length) {
    urgent.push({ kind: 'inbox', label: `${unreadNotes.length} unread note${unreadNotes.length === 1 ? '' : 's'}`, body: 'Private notifications from your rooms.', href: '/inbox', icon: <PiTrayDuotone className="h-4 w-4" /> });
  }
  const cardClass = (kind: string) =>
    kind === 'turn' || kind === 'contract'
      ? 'bg-[#fbbf24]/20 text-[#fbbf24]'
      : kind === 'review'
      ? 'bg-red-500/20 text-red-400'
      : 'bg-[#34d399]/20 text-[#34d399]';

  const openNote = (n: any) => {
    mark.mutate({ notificationId: n.id });
    if (n.category === 'continuation_submitted' && n.resourceId) {
      window.location.href = `/authors-den/?preview=${n.resourceId}`;
      return;
    }
    if (n.deepLink) {
      if (n.deepLink.startsWith('/authors-den')) window.location.href = n.deepLink;
      else setLocation(n.deepLink);
    }
  };

  return (
    <div className="mx-auto max-w-[1320px]">
      <div className="reveal flex flex-col justify-between gap-5 border-b border-white/5 pb-10 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Messages / inbox</SectionEyebrow>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-0.04em] text-white sm:text-8xl">
            Your inbox.
          </h1>
        </div>
        <p className="max-w-sm border-l border-white/10 pl-5 text-sm leading-[1.8] text-zinc-400">
          {unreadCount > 0
            ? `${unreadCount} unread ${unreadCount === 1 ? 'item' : 'items'} need your attention.`
            : 'Everything here is read and resting. Urgent work, private threads, and room notes gather below.'}
        </p>
      </div>

      {urgent.length > 0 && (
        <section className="reveal reveal-1 mt-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#3b82f6]">Urgent work</h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-zinc-500">{urgent.length} item{urgent.length === 1 ? '' : 's'} need you</span>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {urgent.slice(0, 6).map((item) => (
              <Link key={`${item.kind}-${item.href}`} href={item.href} className={`soft-lift focus-house group overflow-hidden rounded-3xl border p-7 ${cardClass(item.kind)}`}>
                <span className="card-spot" />
                <span className="icon-chip h-12 w-12">{item.icon}</span>
                <h3 className="mt-7 text-lg font-bold tracking-[-.03em] text-zinc-100">{item.label}</h3>
                <p className="mt-2 text-xs leading-relaxed opacity-80">{item.body}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-zinc-300">Open <PiArrowRightDuotone className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="reveal reveal-1 mt-10 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <section aria-labelledby="threads-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="threads-heading" className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#3b82f6]">
              <PiChatCircleDuotone className="h-4 w-4" /> Conversations
            </h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-zinc-500">{threads.length} thread{threads.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-5 space-y-3">
            {threadsQ.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/5" />)}</div>
            ) : threads.length ? threads.map((t) => (
              <button key={t.id} data-testid={`inbox-thread-${t.id}`} onClick={() => t.projectId ? window.location.href = `/authors-den/?project=${t.projectId}&chat=1` : setLocation(`/authors/collaborations/thread/${t.id}`)}
                className={`focus-house soft-lift flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${t.unread ? 'border-[#3b82f6]/40 bg-[#3b82f6]/5' : 'card-surface'}`}>
                <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] font-mono-ui text-[11px] font-medium uppercase text-white">{(t.partnerName || 'W').slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="block truncate text-sm font-semibold text-zinc-100">{t.sourceProjectTitle}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[10px] font-semibold text-zinc-500">{t.messageCount} msg{t.messageCount === 1 ? '' : 's'}</span>
                      {t.unread && <span className="rounded-full bg-[#3b82f6] px-2 py-0.5 font-mono-ui text-[9px] uppercase tracking-[.12em] text-white">New</span>}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">with {t.partnerName}</span>
                  <span className={`mt-2 block truncate text-sm leading-relaxed ${t.unread ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}>{t.lastMessage ? `“${t.lastMessage}”` : 'No messages yet — start the conversation.'}</span>
                  {t.lastMessageAt && <span className="mt-2 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-600">{new Date(t.lastMessageAt).toLocaleString()}</span>}
                </span>
              </button>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
                <p className="text-2xl font-semibold text-zinc-100">No conversations yet.</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">Private threads open when a seed is answered — the creator and respondent can talk without leaving the room.</p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="notes-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="notes-heading" className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#34d399]">
              <PiTrayDuotone className="h-4 w-4" /> Room notes
            </h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-zinc-500">{unreadNotes.length} unread</span>
          </div>
          <div className="mt-5 space-y-3">
            {inboxQ.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />)}</div>
            ) : notes.length ? notes.map((n) => (
              <div key={n.id} data-testid={`inbox-note-${n.id}`} onClick={() => openNote(n)}
                className={`focus-house flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left ${n.read ? 'card-surface' : 'border-[#3b82f6]/40 bg-[#3b82f6]/5'}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-white/10' : 'bg-[#3b82f6] glow-dot'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug text-zinc-100">{n.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{n.body}</span>
                  <span className="mt-2 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-600">{n.category} · {new Date(n.createdAt).toLocaleDateString()}</span>
                  {n.category === 'continuation_submitted' && n.resourceId && (
                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/authors-den/?preview=${n.resourceId}`; }} className="focus-house mt-3 inline-flex items-center gap-2 rounded-full border border-[#34d399]/40 px-3 py-1.5 text-xs font-semibold text-[#34d399]">Preview in Author Den <PiArrowRightDuotone className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
                <p className="text-2xl font-semibold text-zinc-100">The hallway is still.</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">Submissions, selections, and contract turns will arrive here when they need you.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="reveal reveal-2 mt-12 flex flex-wrap items-center gap-3 border-t border-white/5 pt-7 text-sm text-zinc-500">
        <PiUsersDuotone className="h-4 w-4 text-[#34d399]" />
        <span>Everything here is private to you — urgent work, notes, and conversations from your rooms only.</span>
        <Link href="/categories/authors" className="focus-house ml-auto inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white">
          Authors room <PiArrowRightDuotone className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
