import { useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  GitPullRequest,
  History,
  Inbox,
  LockKeyhole,
  MessageSquare,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoNotificationsQueryKey,
  useListVideoNotifications,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import type { VideoNotification } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useRealtimeNotifications } from '@/lib/realtime';

// ---------------------------------------------------------------------------
// Notifications — the account's notification center. Every event that touches
// the user (invites, submissions, decisions, timeline updates, annotations,
// grants, releases) lands here with a deep link; clicking a row marks it read
// and opens the room it points at. Live via the realtime socket.
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  video_invite: { icon: UserPlus, tone: 'accent', label: 'Invite' },
  video_submission: { icon: GitPullRequest, tone: 'gold', label: 'Submitted for review' },
  video_approved: { icon: CheckCircle2, tone: 'teal', label: 'Approved' },
  video_rejected: { icon: XCircle, tone: 'danger', label: 'Needs another pass' },
  video_timeline_updated: { icon: History, tone: 'accent', label: 'Timeline updated' },
  video_comment: { icon: MessageSquare, tone: 'teal', label: 'Annotation' },
  video_released: { icon: LockKeyhole, tone: 'teal', label: 'Lock released' },
  video_grant: { icon: CheckCircle2, tone: 'accent', label: 'Download access' },
  video_grant_revoked: { icon: XCircle, tone: 'danger', label: 'Access revoked' },
};

const FALLBACK_META = { icon: Bell, tone: 'muted', label: 'Update' } as const;

/** Server deep links carry the /creators-den base; the router strips it. */
function stripBase(deepLink: string): string {
  return deepLink.replace(/^\/creators-den/, '') || '/';
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const notifications = useListVideoNotifications();
  const markRead = useMarkVideoNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
      },
    },
  });

  const rows = (notifications.data ?? []) as VideoNotification[];
  const unread = useMemo(() => rows.filter((n) => !n.readAt), [rows]);

  const open = (notification: VideoNotification) => {
    if (!notification.readAt) {
      markRead.mutate({ notificationId: notification.id });
    }
    setLocation(stripBase(notification.deepLink));
  };

  const markAllRead = () => {
    for (const notification of unread) {
      markRead.mutate({ notificationId: notification.id });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Notifications</SectionEyebrow>
          <h1>What's happening in your den.</h1>
          <p>
            Invites, pull requests, decisions, timeline updates, annotations — every event that
            touches your account lands here, newest first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unread.length > 0 && (
            <button type="button" className="secondary-btn" onClick={markAllRead} data-testid="notifications-mark-all">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
          <span className="den-tag muted" data-testid="notifications-count">
            {unread.length} unread · {rows.length} total
          </span>
        </div>
      </div>

      {notifications.isLoading ? (
        <div className="panel-empty">Opening the notification center…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="notifications-empty">
          <Inbox size={22} />
          <h3>All quiet.</h3>
          <p>
            When you're invited to a project, a leg is submitted for review, a decision lands, or
            someone annotates a preview — it shows up here.
          </p>
        </div>
      ) : (
        <div className="paper-card" data-testid="notifications-list">
          <div className="den-stack">
            {rows.map((notification) => {
              const meta = CATEGORY_META[notification.category] ?? FALLBACK_META;
              const Icon = meta.icon;
              return (
                <button
                  key={notification.id}
                  type="button"
                  className={`list-row notification-row ${notification.readAt ? 'is-read' : 'is-unread'}`}
                  onClick={() => open(notification)}
                  data-testid={`notification-${notification.id}`}
                >
                  <span className={`notification-dot ${meta.tone}`} aria-hidden>
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="truncate">{notification.title}</b>
                    <small className="notification-body">{notification.body}</small>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`den-tag ${meta.tone}`}>{meta.label}</span>
                    <span className="mono-label">{timeAgo(notification.createdAt)}</span>
                  </span>
                  {!notification.readAt && <span className="notification-unread-dot" aria-label="Unread" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="den-footnote mt-6">
        <Bell size={13} />
        Notifications stream in live while you're signed in — no refresh needed.
      </p>
    </div>
  );
}
