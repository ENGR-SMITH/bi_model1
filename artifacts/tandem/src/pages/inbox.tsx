import { PiArrowRightDuotone, PiClockDuotone, PiPenNibDuotone, PiTrayDuotone, PiUsersDuotone, PiVideoCameraDuotone } from 'react-icons/pi';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCollaborationInboxQueryKey,
  getListVideoNotificationsQueryKey,
  useGetCollaborationInbox,
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

// ---------------------------------------------------------------------------
// Notices — the inbox pulls BOTH den feeds into one brief list:
//   * Author Den  → the collaboration notifications (seeds, submissions,
//                   contracts, your-turn passes, private messages)
//   * Creators Den → the video notifications (invites, uploads for review,
//                   approvals/rejections, annotations, grants, releases)
// Each row stays brief — the type of notice plus where it came from — and
// carries a link into that den's own notifications page for the full detail.
// Urgent work (contract/turn/review) and the conversation list moved to the
// Author Den notifications page (?notifications=1); when one of those events
// fires, its notification lands here as a brief row.
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
  const queryClient = useQueryClient();
  const inboxQ = useGetCollaborationInbox({ query: { queryKey: ['collaboration-inbox'] } });
  const videoQ = useListVideoNotifications({ query: { queryKey: getListVideoNotificationsQueryKey() } });
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
  const unreadCount = unreadNotes.length;
  const unreadByWorld = (world: NoticeWorld) => notices.filter((n) => n.world === world && n.unread).length;

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
            : 'Everything here is read and resting. Notices from both dens gather below — each one opens its full page inside the den it came from.'}
        </p>
      </div>

      <section aria-labelledby="notes-heading" className="reveal reveal-1 mt-10">
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
              className={`focus-house group soft-lift relative flex w-full cursor-pointer items-start gap-4 overflow-hidden rounded-2xl border p-4 pl-5 text-left transition-colors ${n.unread ? (n.world === 'creators' ? 'border-red-500/50 bg-red-500/[0.06] hover:bg-red-500/[0.09]' : 'border-[#3b82f6]/50 bg-[#3b82f6]/[0.06] hover:bg-[#3b82f6]/[0.09]') : 'card-surface hover:border-white/15'}`}>
              <span className="card-spot" />
              {n.unread && (
                <span className={`pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-full ${n.world === 'creators' ? 'bg-red-500 shadow-[0_0_12px_1px_rgba(239,68,68,0.55)]' : 'bg-[#3b82f6] shadow-[0_0_12px_1px_rgba(59,130,246,0.55)]'}`} />
              )}
              <span className={`icon-chip h-10 w-10 shrink-0 ${n.world === 'creators' ? 'text-red-400' : 'text-[#93c5fd]'}`}>
                {n.world === 'creators' ? <PiVideoCameraDuotone className="h-4 w-4" /> : <PiPenNibDuotone className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 font-mono-ui text-[8.5px] uppercase tracking-[.14em] ${WORLD_CHIP[n.world]}`}>
                    {WORLD_LABEL[n.world]}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 font-mono-ui text-[8.5px] uppercase tracking-[.14em] ${TONE_TEXT[n.tone] ?? TONE_TEXT.muted}`}>{n.label}</span>
                  {n.unread && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#fbbf24] shadow-[0_0_10px_2px_rgba(251,191,36,0.45)]" />}
                </span>
                <span className={`mt-2 block text-sm leading-snug ${n.unread ? 'font-semibold text-white' : 'font-medium text-zinc-200'}`}>{n.title}</span>
                <span className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-ui text-[9px] uppercase tracking-[.12em] text-zinc-500">
                  <span className="inline-flex items-center gap-1.5">
                    <PiClockDuotone className="h-3 w-3 text-zinc-600" /> {new Date(n.createdAt).toLocaleDateString()}
                  </span>
                  <span className={`inline-flex items-center gap-1 transition-colors ${n.unread ? 'text-[#93c5fd]' : 'text-zinc-400 group-hover:text-white'}`}>
                    View in {denPageCtaLabel(n.world)} <PiArrowRightDuotone className="arrow-nudge-right h-3 w-3" />
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

      <div className="reveal reveal-2 mt-12 flex flex-wrap items-center gap-3 border-t border-white/5 pt-7 text-sm text-zinc-500">
        <PiUsersDuotone className="h-4 w-4 text-[#34d399]" />
        <span>Everything here is private to you — notices are brief here; urgent work and conversations live on the Author Den notifications page, and each row opens it.</span>
        <Link href="/categories/authors" className="focus-house ml-auto inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white">
          Authors room <PiArrowRightDuotone className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}