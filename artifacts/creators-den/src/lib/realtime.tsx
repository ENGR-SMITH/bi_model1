// ---------------------------------------------------------------------------
// Realtime client (blueprint §6 / §11) — Socket.IO against the API server.
//
//   RealtimeProvider  — one authenticated connection for the whole app. The
//                       Clerk session token is sent in the handshake and
//                       verified server-side; the socket reconnects on its
//                       own, and notifications stream to the signed-in user.
//   useProjectRealtime — joins a project room with presence (which leg the
//                       user is working in) and invalidates the React Query
//                       caches for that project when live events arrive, so
//                       jobs, comments, submissions, and assets update without
//                       a manual refresh.
//   useRealtimeNotifications — listens for the user's own notifications.
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getGetVideoReferenceQueryKey,
  getGetVideoTimelineQueryKey,
  getListVideoActivityQueryKey,
  getListVideoChatMessagesQueryKey,
  getListVideoCommentsQueryKey,
  getListVideoTimelineVersionsQueryKey,
  getListVideoDownloadsQueryKey,
  getListVideoGrantsQueryKey,
  getListVideoJobsQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoSubmissionsQueryKey,
  getListVideoSyncsQueryKey,
} from '@workspace/api-client-react';

export interface PresenceEntry {
  userId: string;
  name: string;
  leg: string | null;
  joinedAt: number;
}

const RealtimeContext = createContext<Socket | null>(null);

/** One Clerk-authenticated socket for the whole app. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let disposed = false;
    let s: Socket | null = null;

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
      s = io(url, {
        path: '/socket.io',
        // Polling first: the dev-server proxy reliably forwards the polling
        // handshake, and socket.io upgrades to websocket when it can. Leading
        // with websocket can hang indefinitely when the upgrade stalls.
        transports: ['polling', 'websocket'],
        auth: {
          token,
          name: user?.firstName || user?.username || undefined,
        },
      });
      s.on('connect', () => setSocket(s));
      s.on('disconnect', () => setSocket((current) => (current === s ? null : current)));
      // Transient failures are retried by socket.io itself; stay quiet.
      s.on('connect_error', () => {});
    })();

    return () => {
      disposed = true;
      s?.disconnect();
      setSocket(null);
    };
  }, [isSignedIn, getToken, user?.firstName, user?.username]);

  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeSocket(): Socket | null {
  return useContext(RealtimeContext);
}

/**
 * Joins a project room with presence and keeps that project's caches live.
 * Call once per project page; `leg` announces which studio the user is in.
 */
export function useProjectRealtime(projectId?: string, leg?: string | null) {
  const socket = useRealtimeSocket();
  const queryClient = useQueryClient();
  const { user } = useUser();

  useEffect(() => {
    if (!socket || !projectId) return;

    const name = user?.firstName || user?.username || undefined;
    socket.emit('presence:join', { projectId, leg: leg ?? null, name });

    const invalidate = (keys: Array<readonly unknown[]>) => {
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };

    const onJob = (payload: { projectId: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([getListVideoJobsQueryKey(projectId), getGetVideoProjectQueryKey(projectId)]);
    };
    const onComment = (payload: { projectId: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([getListVideoCommentsQueryKey(projectId)]);
    };
    const onChat = (payload: { projectId: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([getListVideoChatMessagesQueryKey(projectId)]);
    };
    const onSubmission = (payload: { projectId: string; leg?: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([
        getListVideoSubmissionsQueryKey(projectId),
        getGetVideoProjectQueryKey(projectId),
        // The vault's activity feed follows submissions + decisions live.
        getListVideoActivityQueryKey(projectId),
        // The stage hand-off status (DRAFT/SUBMITTED/APPROVED/REJECTED) lives
        // on the leg timeline — flip it the moment a submission is decided.
        ...(payload.leg ? [getGetVideoTimelineQueryKey(projectId, payload.leg as 'SELECTS' | 'CUT' | 'SOUND' | 'FINISH' | 'THUMBNAIL')] : []),
      ]);
    };
    const onAsset = (payload: { projectId: string; assetId?: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([
        getGetVideoProjectQueryKey(projectId),
        ...(payload.assetId ? [getGetVideoAssetQueryKey(projectId, payload.assetId)] : []),
        getListVideoActivityQueryKey(projectId),
      ]);
    };
    const onTimeline = (payload: { projectId: string; leg?: string }) => {
      if (payload.projectId !== projectId) return;
      const leg = (payload.leg ?? '') as 'SELECTS' | 'CUT' | 'SOUND' | 'FINISH' | 'THUMBNAIL';
      invalidate([
        getGetVideoTimelineQueryKey(projectId, leg),
        // The project-level CommitLog in the vault follows saves live too.
        getListVideoTimelineVersionsQueryKey(projectId, leg),
        getListVideoSyncsQueryKey(projectId),
        getListVideoActivityQueryKey(projectId),
      ]);
    };
    const onGrant = (payload: { projectId: string }) => {
      if (payload.projectId !== projectId) return;
      invalidate([getListVideoGrantsQueryKey(projectId), getListVideoDownloadsQueryKey(projectId)]);
    };

    socket.on('job.progress', onJob);
    socket.on('chat.new', onChat);
    socket.on('comment.new', onComment);
    socket.on('comment.updated', onComment);
    socket.on('submission.new', onSubmission);
    socket.on('submission.decided', onSubmission);
    socket.on('asset.uploaded', onAsset);
    socket.on('asset.processed', onAsset);
    socket.on('timeline.saved', onTimeline);
    socket.on('grant.created', onGrant);
    socket.on('grant.revoked', onGrant);

    return () => {
      socket.off('job.progress', onJob);
      socket.off('chat.new', onChat);
      socket.off('comment.new', onComment);
      socket.off('comment.updated', onComment);
      socket.off('submission.new', onSubmission);
      socket.off('submission.decided', onSubmission);
      socket.off('asset.uploaded', onAsset);
      socket.off('asset.processed', onAsset);
      socket.off('timeline.saved', onTimeline);
      socket.off('grant.created', onGrant);
      socket.off('grant.revoked', onGrant);
      socket.emit('presence:leave', { projectId });
    };
  }, [socket, projectId, leg, queryClient, user?.firstName, user?.username]);
}

/** Live roster of members currently in a project room (for presence UI). */
export function useProjectPresence(projectId?: string): PresenceEntry[] {
  const socket = useRealtimeSocket();
  const [roster, setRoster] = useState<PresenceEntry[]>([]);

  useEffect(() => {
    if (!socket || !projectId) {
      setRoster([]);
      return;
    }
    const onRoster = (payload: { projectId: string; roster: PresenceEntry[] }) => {
      if (payload.projectId === projectId) setRoster(payload.roster);
    };
    socket.on('presence.roster', onRoster);
    socket.on('presence.updated', onRoster);
    return () => {
      socket.off('presence.roster', onRoster);
      socket.off('presence.updated', onRoster);
    };
  }, [socket, projectId]);

  return roster;
}

/** Invalidates the notifications query when a new one streams in. */
export function useRealtimeNotifications(): void {
  const socket = useRealtimeSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const onNotification = () => {
      void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
    };
    socket.on('notification.new', onNotification);
    return () => {
      socket.off('notification.new', onNotification);
    };
  }, [socket, queryClient]);
}
