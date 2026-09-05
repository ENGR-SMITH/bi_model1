// Realtime inbox updates for the Tandem front — Socket.IO against the API
// server, the same pattern Creators Den uses.
//
// The API server joins every authenticated socket to the user's personal room
// (`user:{userId}`) and streams `notification.new` into it whenever a notice
// is written — from BOTH dens:
//   * Creators Den (video notifications: invites, uploads for review,
//     approvals, annotations, grants, releases)
//   * Author Den (collaboration notifications: submissions, contracts,
//     your-turn passes, private messages)
//
// So while the inbox page is open, one socket replaces the 20s polling: the
// two feeds are refetched the instant a new notification lands. The event
// payload is intentionally ignored — refetching the feeds keeps the read
// state and list order authoritative.
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCollaborationInboxQueryKey,
  getListVideoNotificationsQueryKey,
} from '@workspace/api-client-react';

/** Invalidates the two den notification feeds when a new one streams in. */
export function useInboxRealtime(): void {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSignedIn) return;
    let disposed = false;
    let socket: Socket | null = null;

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
      socket.on('notification.new', () => {
        // Both feeds that back the inbox page — the collaboration inbox (used
        // by the page and by Author Den's bell) and the video notification
        // feed. Invalidate every key shape that could be live.
        void queryClient.invalidateQueries({ queryKey: getGetCollaborationInboxQueryKey() });
        void queryClient.invalidateQueries({ queryKey: ['collaboration-inbox'] });
        void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
      });
      // Transient failures are retried by socket.io itself; stay quiet.
      socket.on('connect_error', () => {});
    })();

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [isSignedIn, getToken, queryClient, user?.firstName, user?.username]);
}
