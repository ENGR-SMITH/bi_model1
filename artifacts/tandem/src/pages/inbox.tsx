import { PiArrowRightDuotone, PiChatCircleDuotone, PiFileTextDuotone, PiHourglassDuotone, PiPenDuotone, PiTrayDuotone, PiUsersDuotone } from 'react-icons/pi';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCollaborationInboxQueryKey,
  getListVideoNotificationsQueryKey,
  getListContinuationsQueryKey,
  useGetCollaborationInbox,
  useListCollaborationProjects,
  useListCollaborationThreads,
  useListContinuations,
  useListVideoNotifications,
  useMarkCollaborationNotificationRead,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import type { VideoNotification } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/protected-shell';
import {
  denPageCtaLabel,
  metaFor,
  noticeDenPageHref,
  TONE_TEXT,
  WORLD_CHIP,
  WORLD_LABEL,
  type NoticeWorld,
} from '@/lib/notice-meta';

function roleLabel(project: any, role: string) {
  return project.creatorId === role ? project.creatorName : project.respondentName;
}

// ---------------------------------------------------------------------------
// Notices — the inbox pulls BOTH den feeds into one list:
//   * Author Den  → the collaboration notifications (seeds, submissions,
//                   contracts, your-turn passes, private messages)
//   * Creators Den → the video notifications (invites, uploads for review,
//                   approvals/rejections, annotations, grants, releases)
// Each row stays brief — the type of notice plus where it came from — and
// carries a link into that den's own notifications page for the full detail.
// Live updates come from the app-wide NotificationCenter (one realtime
// socket), so this page needs no polling of its own.
// ---------------------------------------------------------------------------

interface Notice {
  key: string;
  world: NoticeWorld;
  id: string;
  category: string;
  label: string;
  tone: string;
  title: string;
  unread: boolean;
  createdAt: string;
}

export default function InboxPage() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const inboxQ = useGetCollaborationInbox({ query: { queryKey: ['collaboration-inbox'] } });
  const videoQ = useListVideoNotifications({ query: { queryKey: getListVideoNotificationsQueryKey() } });
  const threadsQ = useListCollaborationThreads({ query: { queryKey: ['collaboration-inbox-threads'] } });
  const projectsQ = useListCollaborationProjects();
  const continuationsQ = useListContinuations({ query: { queryKey: getListContinuationsQueryKey() } });
  const mark = useMarkCollaborationNotificationRead({
    mutation: {
      onSuccess: () => {
        // Keep the nav badge + other live surfaces in sync when reading here.
        void queryClient.invalidateQueries({ queryKey: getGetCollaborationInboxQueryKey() });
        void queryClient.invalidateQueries({ queryKey: ['collaboration-inbox'] });
      },
    },
  });
  const markVideo = useMarkVideoNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
      },
    },
  });

  const authorNotes: any[] = inboxQ.data || [];
  const videoNotes: VideoNotification[] = videoQ.data || [];
  const threads: any[] = threadsQ.data || [];
  const projects: any[] = projectsQ.data || [];
  const continuations: any[] = continuationsQ.data || [];

  const notices: Notice[] = [
    ...authorNotes.map((n: any): Notice => {
      const meta = metaFor('authors', n.category);
      return {
        key: `authors-${n.id}`,
        world: 'authors',
        id: n.id,
        category: n.category,
        label: meta.label,
        tone: meta.tone,
        title: n.title,
        unread: !n.read,
        createdAt: n.createdAt,
      };
    }),
    ...videoNotes.map((n: VideoNotification): Notice => {
      const meta = metaFor('creators', n.category);
      return {
        key: `creators-${n.id}`,
        world: 'creators',
        id: n.id,
        category: n.category,
        label: meta.label,
        tone: meta.tone,
        title: n.title,
        unread: !n.readAt,
        createdAt: n.createdAt,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const unreadNotes = notices.filter((n) => n.unread);
  const unreadThreads = threads.filter((t: any) => t.unread);
  const unreadCount = unreadNotes.length + unreadThreads.length;
  const unreadByWorld = (world: NoticeWorld) => notices.filter((n) => n.world === world && n.unread).length;
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
    urgent.push({ kind: 'inbox', label: `${unreadNotes.length} unread note${unreadNotes.length === 1 ? '' : 's'}`, body: 'Notices from your Author Den rooms and Creators Den workspaces.', href: '/inbox', icon: <PiTrayDuotone className="h-4 w-4" /> });
  }
  const cardClass = (kind: string) =>
    kind === 'turn' || kind === 'contract'
      ? 'bg-[#fbbf24]/20 text-[#fbbf24]'
      : kind === 'review'
      ? 'bg-red-500/20 text-red-400'
      : 'bg-[#34d399]/20 text-[#34d399]';

  // Open a notice: mark it read in whichever den wrote it, then jump to that
  // den's notifications page where the full notification info lives.
  const openNotice = (n: Notice) => {
    if (n.unread) {
      if (n.world === 'creators') markVideo.mutate({ notificationId: n.id });
      else mark.mutate({ notificationId: n.id });
    }
    window.location.href = noticeDenPageHref(n.world);
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
            ? `${unreadCount} unread ${unreadCount === 1 ? 'item' : 'items'} need your attention across your rooms and workspaces.`
            : 'Everything here is read and resting. Urgent work, private threads, and notices from both dens gather below.'}
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
              <PiTrayDuotone className="h-4 w-4" /> Notices
            </h2>
            <span className="font-mono-ui text-[10px] uppercase tracking-[.12em] text-zinc-500">
              {unreadByWorld('authors') > 0 && <span className="mr-2 text-[#93c5fd]">{unreadByWorld('authors')} author</span>}
              {unreadByWorld('creators') > 0 && <span className="mr-2 text-red-400">{unreadByWorld('creators')} creator</span>}
              {notices.length} total
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {inboxQ.isLoading || videoQ.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />)}</div>
            ) : notices.length ? notices.map((n) => (
              <div key={n.key} data-testid={`inbox-note-${n.key}`} onClick={() => openNotice(n)}
                className={`focus-house flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition ${n.unread ? (n.world === 'creators' ? 'border-red-500/40 bg-red-500/5' : 'border-[#3b82f6]/40 bg-[#3b82f6]/5') : 'card-surface'}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.unread ? (n.world === 'creators' ? 'bg-red-500 glow-dot' : 'bg-[#3b82f6] glow-dot') : 'bg-white/10'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 font-mono-ui text-[8.5px] uppercase tracking-[.14em] ${WORLD_CHIP[n.world]}`}>
                      {WORLD_LABEL[n.world]}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-mono-ui text-[8.5px] uppercase tracking-[.14em] ${TONE_TEXT[n.tone] ?? TONE_TEXT.muted}`}>{n.label}</span>
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold leading-snug text-zinc-100">{n.title}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-500">
                    <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      View in {denPageCtaLabel(n.world)} <PiArrowRightDuotone className="h-3 w-3" />
                    </span>
                  </span>
                </span>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
                <p className="text-2xl font-semibold text-zinc-100">Both dens are quiet.</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">Notices from Author Den (submissions, contracts, your-turn passes) and Creators Den (uploads for review, approvals, invites) will appear here when they need you — opening one takes you to its full page in that den.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="reveal reveal-2 mt-12 flex flex-wrap items-center gap-3 border-t border-white/5 pt-7 text-sm text-zinc-500">
        <PiUsersDuotone className="h-4 w-4 text-[#34d399]" />
        <span>Everything here is private to you — notices are brief here; each one opens its full page inside the den it came from.</span>
        <Link href="/categories/authors" className="focus-house ml-auto inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white">
          Authors room <PiArrowRightDuotone className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
