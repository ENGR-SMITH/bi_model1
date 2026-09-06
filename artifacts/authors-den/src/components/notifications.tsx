import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import {
  ArrowRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock3,
  FileText,
  GitPullRequest,
  Hourglass,
  Inbox,
  LockKeyhole,
  MessageSquare,
  MessagesSquare,
  PenLine,
  XCircle,
} from "lucide-react";
import {
  getGetCollaborationInboxQueryKey,
  useGetCollaborationInbox,
  useListCollaborationProjects,
  useListCollaborationThreads,
  useListContinuations,
  useMarkCollaborationNotificationRead,
} from "@workspace/api-client-react";
import type {
  CollaborationNotification,
  CollaborationProject,
  InboxThread,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Notifications — the Author Den inbox, backed by the collaboration
// notification feed (seeds published, continuations submitted/declined,
// acceptances, contract locks, your-turn passes, and private messages).
// Clicking a row marks it read and opens its deep link (the Author Den studio
// handles ?project= & ?chat=; cross-app links open the Tandem room).
//
// This page also owns the two surfaces that used to live on the Tandem inbox:
//   * Urgent work — contract approvals, your-turn passes, waiting states, and
//     pending reviews, computed live from the shared rooms.
//   * Conversations — the private threads with the collaborator, newest first.
// The Tandem inbox keeps only a brief notice row for each of these events and
// points here for the full detail.
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

// Stable hue for a conversation partner's avatar circle, mirroring the chat.
function partnerHue(name: string): number {
  return [...(name || "C")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
}

function partnerLabel(project: CollaborationProject): string {
  return project.creatorId === project.currentTurn ? project.creatorName : project.respondentName;
}

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
  const { user } = useUser();
  const queryClient = useQueryClient();
  const inbox = useGetCollaborationInbox();
  const markRead = useMarkCollaborationNotificationRead({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetCollaborationInboxQueryKey() });
      },
    },
  });
  const projectsQ = useListCollaborationProjects();
  const threadsQ = useListCollaborationThreads();
  const continuationsQ = useListContinuations();

  const rows = (inbox.data ?? []) as CollaborationNotification[];
  const projects = (projectsQ.data ?? []) as CollaborationProject[];
  const threads = (threadsQ.data ?? []) as InboxThread[];
  const continuations = (continuationsQ.data ?? []) as any[];
  const unread = useMemo(() => rows.filter((n) => !n.read), [rows]);

  // Urgent work — the same live room-state cards the Tandem inbox used to
  // show, now computed here so the studio becomes the home for them.
  const urgent: Array<{ key: string; label: string; body: string; href: string; icon: typeof Bell; tone: string }> = [];
  projects.forEach((p) => {
    const myRole = p.creatorId === user?.id ? "CREATOR" : "RESPONDENT";
    const myApproved = p.creatorId === user?.id ? p.creatorApproved : p.respondentApproved;
    if (p.status === "CONTRACT_PENDING" && !myApproved) {
      urgent.push({ key: `contract-${p.id}`, label: "Contract action required", body: `Approve the contract for “${p.title}” so the room can open.`, href: `/authors-den/?project=${p.id}`, icon: FileText, tone: "gold" });
    } else if (p.status === "ACTIVE" && p.currentTurn === myRole) {
      urgent.push({ key: `turn-${p.id}`, label: "Your turn", body: `The next pass in “${p.title}” is yours to write.`, href: `/authors-den/?project=${p.id}`, icon: PenLine, tone: "accent" });
    } else if (p.status === "ACTIVE") {
      urgent.push({ key: `waiting-${p.id}`, label: "Waiting on partner", body: `${partnerLabel(p)} is carrying “${p.title}”.`, href: `/authors-den/?project=${p.id}`, icon: Hourglass, tone: "muted" });
    }
  });
  const pendingReviews = continuations.filter((c: any) => c.status === "UNDER_REVIEW");
  if (pendingReviews.length) {
    urgent.push({ key: "review-pending", label: "Review pending", body: `${pendingReviews.length} continuation${pendingReviews.length === 1 ? "" : "s"} waiting on your eye.`, href: "/authors/collaborations/continuations", icon: Clock3, tone: "danger" });
  }

  const open = (notification: CollaborationNotification) => {
    if (!notification.read) {
      markRead.mutate({ notificationId: notification.id });
    }
    window.location.href = notification.deepLink;
  };

  const openThread = (thread: InboxThread) => {
    if (thread.projectId) window.location.href = `/authors-den/?project=${thread.projectId}&chat=1`;
    else window.location.href = `/authors/collaborations/thread/${thread.id}`;
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
          <p>Submissions, decisions, contract locks, your-turn passes, private messages, and the conversations they open — newest first.</p>
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

      {urgent.length > 0 && (
        <section className="mb-8">
          <div className="inline-heading">
            <span className="eyebrow">Urgent work</span>
            <span className="mono-label">{urgent.length} item{urgent.length === 1 ? "" : "s"} need you</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {urgent.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => window.location.href = item.href}
                  className="group flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-xs transition duration-150 hover:-translate-y-0.5 hover:border-accent/60"
                >
                  <span className={`notification-dot ${item.tone}`} aria-hidden>
                    <Icon size={15} />
                  </span>
                  <span>
                    <b className="block text-sm font-semibold text-foreground">{item.label}</b>
                    <small className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.body}</small>
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-accent">
                    Open <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {threads.length > 0 && (
        <section className="mb-8">
          <div className="inline-heading">
            <span className="eyebrow">Conversations</span>
            <span className="mono-label">{threads.length} thread{threads.length === 1 ? "" : "s"}</span>
          </div>
          <div className="paper-card">
            <div className="den-stack">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="list-row notification-row"
                  onClick={() => openThread(thread)}
                  data-testid={`notification-thread-${thread.id}`}
                >
                  <span
                    className="person-dot"
                    style={{ background: `hsl(${partnerHue(thread.partnerName)} 40% 42%)`, color: "#fff" }}
                    aria-hidden
                  >
                    {(thread.partnerName || "W").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="truncate">{thread.sourceProjectTitle}</b>
                    <small className="notification-body">
                      with {thread.partnerName}
                      {thread.lastMessage ? ` — “${thread.lastMessage}”` : " — no messages yet, start the conversation."}
                    </small>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {thread.unread && <span className="den-tag accent">New</span>}
                    <span className="mono-label">{thread.messageCount} msg{thread.messageCount === 1 ? "" : "s"}</span>
                    {thread.lastMessageAt && <span className="mono-label">{timeAgo(thread.lastMessageAt)}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

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
        <MessagesSquare size={13} />
        Notifications reflect the collaboration rooms you're part of — private threads, shared projects, and pitch-board decisions.
      </p>
    </div>
  );
}