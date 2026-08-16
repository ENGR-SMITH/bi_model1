import { ArrowRight, FileText, Hourglass, Inbox as InboxIcon, MessageCircle, PenLine, Users } from 'lucide-react';
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
      urgent.push({ kind: 'contract', label: 'Contract action required', body: `Approve the contract for “${p.title}” so the room can open.`, href: `/authors-den/?project=${p.id}`, icon: <FileText className="h-4 w-4" /> });
    } else if (p.status === 'ACTIVE' && p.currentTurn === myRole) {
      urgent.push({ kind: 'turn', label: 'Your turn', body: `The next pass in “${p.title}” is yours to write.`, href: `/authors-den/?project=${p.id}`, icon: <PenLine className="h-4 w-4" /> });
    } else if (p.status === 'ACTIVE') {
      urgent.push({ kind: 'waiting', label: 'Waiting on partner', body: `${roleLabel(p, p.currentTurn)} is carrying “${p.title}”.`, href: `/authors-den/?project=${p.id}`, icon: <Hourglass className="h-4 w-4" /> });
    }
  });
  if (pendingReviews.length) {
    urgent.push({ kind: 'review', label: 'Review pending', body: `${pendingReviews.length} continuation${pendingReviews.length === 1 ? '' : 's'} waiting on your eye.`, href: '/authors/collaborations/continuations', icon: <InboxIcon className="h-4 w-4" /> });
  }
  if (unreadNotes.length) {
    urgent.push({ kind: 'inbox', label: `${unreadNotes.length} unread note${unreadNotes.length === 1 ? '' : 's'}`, body: 'Private notifications from your rooms.', href: '/inbox', icon: <MessageCircle className="h-4 w-4" /> });
  }
  const cardClass = (kind: string) => kind === 'turn' || kind === 'contract' ? 'bg-[#f0c85c] text-[#292b45]' : kind === 'review' ? 'bg-[#e55b4c] text-[#fff4e6]' : 'bg-[#3e8074] text-[#fff4e6]';

  const openNote = (n: any) => {
    mark.mutate({ notificationId: n.id });
    // Reading a submitted project always happens in Author Den — never on a Tandem read page.
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
    <div className="mx-auto max-w-[1180px]">
      <div className="reveal flex flex-col justify-between gap-5 border-b-2 border-[#d6cbb9] pb-9 md:flex-row md:items-end">
        <div>
          <SectionEyebrow>Messages / inbox</SectionEyebrow>
          <h1 className="mt-5 max-w-[12ch] text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45] sm:text-8xl">
            Your inbox.
          </h1>
        </div>
        <p className="max-w-sm border-l-2 border-[#d6cbb9] pl-5 text-sm leading-[1.8] text-[#625f6d]">
          {unreadCount > 0
            ? `${unreadCount} unread ${unreadCount === 1 ? 'item' : 'items'} need your attention.`
            : 'Everything here is read and resting. Urgent work, private threads, and room notes gather below.'}
        </p>
      </div>

      {urgent.length > 0 && (
        <section className="reveal reveal-1 mt-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#e55b4c]">Urgent work</h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#98909a]">{urgent.length} item{urgent.length === 1 ? '' : 's'} need you</span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {urgent.slice(0, 6).map((item) => (
              <Link key={`${item.kind}-${item.href}`} href={item.href} className={`soft-lift focus-house rounded-[1.25rem] p-6 ${cardClass(item.kind)}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#292b45]/10">{item.icon}</span>
                <h3 className="mt-6 text-lg font-extrabold tracking-[-.03em]">{item.label}</h3>
                <p className="mt-1 text-xs leading-relaxed opacity-80">{item.body}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-xs font-bold">Open <ArrowRight className="h-3.5 w-3.5" /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="reveal reveal-1 mt-10 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        {/* Private threads */}
        <section aria-labelledby="threads-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="threads-heading" className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#e55b4c]">
              <MessageCircle className="h-4 w-4" /> Conversations
            </h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#98909a]">{threads.length} thread{threads.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-5 space-y-3">
            {threadsQ.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-[1.25rem] bg-[#e5d7c5]" />)}</div>
            ) : threads.length ? threads.map((t) => (
              <button key={t.id} data-testid={`inbox-thread-${t.id}`} onClick={() => t.projectId ? window.location.href = `/authors-den/?project=${t.projectId}&chat=1` : setLocation(`/authors/collaborations/thread/${t.id}`)}
                className={`focus-house soft-lift flex w-full items-start gap-4 rounded-[1.25rem] border-2 p-5 text-left ${t.unread ? 'border-[#e55b4c]/50 bg-[#fff4e6]' : 'border-[#d6cbb9] bg-[#f2e7d8]'}`}>
                <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#292b45] font-mono-ui text-[11px] font-medium uppercase text-[#fff4e6]">{(t.partnerName || 'W').slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="block truncate text-sm font-bold text-[#292b45]">{t.sourceProjectTitle}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[10px] font-bold text-[#77717a]">{t.messageCount} msg{t.messageCount === 1 ? '' : 's'}</span>
                      {t.unread && <span className="rounded-full bg-[#e55b4c] px-2 py-0.5 font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#fff4e6]">New</span>}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[#77717a]">with {t.partnerName}</span>
                  <span className={`mt-2 block truncate text-sm leading-relaxed ${t.unread ? 'font-semibold text-[#292b45]' : 'text-[#625f6d]'}`}>{t.lastMessage ? `“${t.lastMessage}”` : 'No messages yet — start the conversation.'}</span>
                  {t.lastMessageAt && <span className="mt-2 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{new Date(t.lastMessageAt).toLocaleString()}</span>}
                </span>
              </button>
            )) : (
              <div className="rounded-[1.25rem] border-2 border-dashed border-[#d6cbb9] bg-[#fff4e6] p-6">
                <p className="font-display text-2xl italic text-[#292b45]">No conversations yet.</p>
                <p className="mt-2 text-sm leading-relaxed text-[#77717a]">Private threads open when a seed is answered — the creator and respondent can talk without leaving the room.</p>
              </div>
            )}
          </div>
        </section>

        {/* Notifications */}
        <section aria-labelledby="notes-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="notes-heading" className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-[#3e8074]">
              <InboxIcon className="h-4 w-4" /> Room notes
            </h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#98909a]">{unreadNotes.length} unread</span>
          </div>
          <div className="mt-5 space-y-3">
            {inboxQ.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-[1.25rem] bg-[#e5d7c5]" />)}</div>
            ) : notes.length ? notes.map((n) => (
              <div key={n.id} data-testid={`inbox-note-${n.id}`} onClick={() => openNote(n)}
                className={`focus-house flex w-full cursor-pointer items-start gap-3 rounded-[1.25rem] border-2 p-4 text-left ${n.read ? 'border-[#d6cbb9] bg-[#f2e7d8]' : 'border-[#e55b4c]/40 bg-[#fff4e6]'}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-[#d6cbb9]' : 'bg-[#e55b4c]'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold leading-snug">{n.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-[#77717a]">{n.body}</span>
                  <span className="mt-2 block font-mono-ui text-[9px] uppercase tracking-[.12em] text-[#98909a]">{n.category} · {new Date(n.createdAt).toLocaleDateString()}</span>
                  {n.category === 'continuation_submitted' && n.resourceId && (
                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/authors-den/?preview=${n.resourceId}`; }} className="focus-house mt-3 inline-flex items-center gap-2 rounded-full border-2 border-[#3e8074] px-3 py-1.5 text-xs font-bold text-[#2f675e]">Preview in Author Den <ArrowRight className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              </div>
            )) : (
              <div className="rounded-[1.25rem] border-2 border-dashed border-[#d6cbb9] bg-[#fff4e6] p-6">
                <p className="font-display text-2xl italic text-[#292b45]">The hallway is still.</p>
                <p className="mt-2 text-sm leading-relaxed text-[#77717a]">Submissions, selections, and contract turns will arrive here when they need you.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="reveal reveal-2 mt-10 flex flex-wrap items-center gap-3 border-t-2 border-[#d6cbb9] pt-6 text-sm text-[#77717a]">
        <Users className="h-4 w-4 text-[#3e8074]" />
        <span>Everything here is private to you — urgent work, notes, and conversations from your rooms only.</span>
        <Link href="/authors/atrium" className="focus-house ml-auto inline-flex items-center gap-2 rounded-full bg-[#292b45] px-4 py-2 text-xs font-bold text-[#fff4e6]">
          Collaboration home <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
