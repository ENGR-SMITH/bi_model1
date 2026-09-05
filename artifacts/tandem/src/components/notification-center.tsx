// Live notification center for the signed-in Tandem app.
//
// One Clerk-authenticated Socket.IO connection (the same pattern Creators Den
// uses) is kept for the whole app. The API server streams every new den
// notice into the user's personal room as `notification.new` — from Creators
// Den (invites, uploads for review, approvals, annotations, grants) and from
// Author Den (submissions, contracts, your-turn passes, private messages).
//
// What happens on each notice:
//   * the two den feeds backing /inbox are invalidated, so the list is always
//     current when the user opens it;
//   * unless the user is already on /inbox, a brief toast pops in — the den it
//     came from and the type of notice — with an Open action that jumps to
//     that den's own notifications page for the full detail.
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import {
  getGetCollaborationInboxQueryKey,
  getListVideoNotificationsQueryKey,
  useMarkCollaborationNotificationRead,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import {
  metaFor,
  noticeDenPageHref,
  WORLD_LABEL,
  worldFromPayload,
  type NoticeWorld,
} from '@/lib/notice-meta';

type NoticePayload = {
  id?: unknown;
  source?: unknown;
  category?: unknown;
  title?: unknown;
  read?: unknown;
  readAt?: unknown;
};

/** Marks a notice read in whichever den wrote it, then opens its den page. */
function openDenNotice(
  payload: NoticePayload,
  world: NoticeWorld,
  markCollab: { mutate: (vars: { notificationId: string }) => void },
  markVideo: { mutate: (vars: { notificationId: string }) => void },
) {
  const id = typeof payload.id === 'string' ? payload.id : null;
  if (id) {
    if (world === 'creators') markVideo.mutate({ notificationId: id });
    else markCollab.mutate({ notificationId: id });
  }
  window.location.href = noticeDenPageHref(world);
}

export function NotificationCenter() {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const markCollab = useMarkCollaborationNotificationRead();
  const markVideo = useMarkVideoNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
      },
    },
  });

  useEffect(() => {
    if (!isSignedIn) return;
    let disposed = false;
    let socket: Socket | null = null;

    const invalidateFeeds = () => {
      void queryClient.invalidateQueries({ queryKey: getGetCollaborationInboxQueryKey() });
      void queryClient.invalidateQueries({ queryKey: ['collaboration-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['collaboration-inbox-threads'] });
      void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
    };

    (async () => {
      // The session token can lag the signed-in state by a moment after
      // sign-in (or a navigation); retry briefly until it is available.
      let token: string | null = null;
      for (let attempt = 0; attempt < 20 && !disposed; attempt++) {
        token = await getToken();
        if (token) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (disposed || !token) return;
      const url = (import.meta.env.VITE_SOCKET_URL as string | undefined) || undefined;
      socket = io(url, {
        path: '/socket.io',
        // Polling first: the dev-server proxy reliably forwards the polling
        // handshake, and socket.io upgrades to websocket when it can.
        transports: ['polling', 'websocket'],
        auth: {
          token,
          name: user?.firstName || user?.username || undefined,
        },
      });
      socket.on('notification.new', (payload: NoticePayload) => {
        invalidateFeeds();
        // On the inbox page the notice appears in the list live — a popup on
        // top of it is redundant. Elsewhere, show the brief toast.
        if (location === '/inbox') return;
        const world = worldFromPayload(payload);
        const meta = metaFor(world, typeof payload?.category === 'string' ? payload.category : '');
        const noticeTitle =
          typeof payload?.title === 'string' && payload.title.trim().length > 0
            ? payload.title.trim()
            : meta.label;
        toast({
          // Title carries which den + what type, e.g. "Creators Den · Submitted for review".
          title: `${WORLD_LABEL[world]} · ${meta.label}`,
          description: noticeTitle,
          action: (
            <ToastAction
              altText={`Open in ${WORLD_LABEL[world]}`}
              onClick={() => openDenNotice(payload, world, markCollab, markVideo)}
            >
              Open {WORLD_LABEL[world].split(' ')[0]}
            </ToastAction>
          ),
        });
      });
      // Transient failures are retried by socket.io itself; stay quiet.
      socket.on('connect_error', () => {});
    })();

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [
    isSignedIn,
    getToken,
    queryClient,
    user?.firstName,
    user?.username,
    location,
    markCollab,
    markVideo,
  ]);

  return null;
}
