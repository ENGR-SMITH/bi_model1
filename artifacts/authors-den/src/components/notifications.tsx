import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock3,
  GitPullRequest,
  Inbox,
  LockKeyhole,
  MessageSquare,
  PenLine,
  XCircle,
} from "lucide-react";
import {
  getGetCollaborationInboxQueryKey,
  useGetCollaborationInbox,
  useMarkCollaborationNotificationRead,
} from "@workspace/api-client-react";
import type { CollaborationNotification } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Notifications — the Author Den inbox, backed by the collaboration
// notification feed (seeds published, continuations submitted/declined,
// acceptances, contract locks, your-turn passes, and private messages).
// Clicking a row marks it read and opens its deep link (the Author Den studio
// handles ?project= & ?chat=; cross-app links open the Tandem room).
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  continuation_submitted: { icon: GitPullRequest, tone: "gold", label: "Submitted for review" },
  collaboration_message: { icon: MessageSquare, tone: "teal", label: "Message" },
  continuation_declined: { icon: XCircle, tone: "danger", label: "Archived" },
  respondent_accepted: { icon: CheckCircle2, tone: "teal", label: "Accepted" },
  respondent_selected: { icon: CheckCircle2, tone: "teal", label: "Selected" },
  contract_locked: { icon: LockKeyhole, tone: "accent", label: "Contract locked" },
  contract_action_required: { icon: Clock3, tone: "gold", label: "Action required" },
  your_turn: { icon: PenLine, tone: "accent", label: "Your turn" },
  block_approved: { icon: CheckCircle2, tone: "teal", label: "Approved" },
};

const FALLBACK_META = { icon: Bell, tone: "muted", label: "Update" } as const;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const inbox = useGetCollaborationInbox();
  const markRead = useMarkCollaborationNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetCollaborationInboxQueryKey() });
      },
    },
  });

  const rows = (inbox.data ?? []) as CollaborationNotification[];
  const unread = useMemo(() => rows.filter((n) => !n.read), [rows]);

  const open = (notification: CollaborationNotification) => {
    if (!notification.read) {
      markRead.mutate({ notificationId: notification.id });
    }
    window.location.href = notification.deepLink;
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
          <div className="eyebrow">NOTIFICATIONS</div>
          <h1>What's happening in your rooms.</h1>
          <p>Submissions, decisions, contract locks, your-turn passes, and private messages — newest first.</p>
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

      {inbox.isLoading ? (
        <div className="panel-empty">Opening the inbox…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="notifications-empty">
          <Inbox size={22} />
          <h3>All quiet.</h3>
          <p>When a writer submits a continuation, a decision lands, a contract locks, or a message arrives — it shows up here.</p>
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
                  className={`list-row notification-row ${notification.read ? "is-read" : "is-unread"}`}
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
                    <span className="mono-label">{timeAgo(notification.createdAt.toString())}</span>
                  </span>
                  {!notification.read && <span className="notification-unread-dot" aria-label="Unread" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="profile-footnote mt-6">
        <Bell size={13} />
        Notifications reflect the collaboration rooms you're part of — private threads, shared projects, and pitch-board decisions.
      </p>
    </div>
  );
}
