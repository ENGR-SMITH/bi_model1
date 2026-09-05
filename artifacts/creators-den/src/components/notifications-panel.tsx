import { Bell, Inbox, LayoutGrid } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoNotificationsQueryKey,
  useListChannels,
  useListVideoNotifications,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import { useRealtimeNotifications } from '@/lib/realtime';

/** The channel id a notice belongs to, read from its deep link. */
function channelIdFromLink(deepLink: string): string | undefined {
  return deepLink.match(/\/channels\/([^/]+)/)?.[1];
}

/**
 * The den inbox panel — the CMS right rail. Every channel the user is on feeds
 * this one feed (the server returns the account's notifications across ALL
 * channels), so each row names the channel it came from. Only UNREAD notices
 * are listed — opening one marks it read and it leaves the feed automatically;
 * the full history stays under the bell in the Inbox page.
 */
export function NotificationsPanel() {
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const notifications = useListVideoNotifications({ query: { queryKey: getListVideoNotificationsQueryKey() } });
  const channels = useListChannels();
  const mark = useMarkVideoNotificationRead();

  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.readAt);
  const channelById = new Map((channels.data ?? []).map((channel) => [channel.id, channel]));

  const open = (notification: { id: string; deepLink: string }) => {
    mark.mutate(
      { notificationId: notification.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoNotificationsQueryKey() });
        },
      },
    );
  };

  // Always render once loaded so the CMS side rail keeps its shape.
  if (!notifications.data) return null;

  return (
    <div className="paper-card cd-inbox" data-testid="panel-notifications">
      <div className="cd-inbox-head">
        <span className="cd-inbox-head-mark"><Bell size={14} /></span>
        <span className="cd-inbox-head-copy">
          <b>Notices</b>
          <small>{unread.length > 0 ? 'across all your channels' : 'all caught up'}</small>
        </span>
        {unread.length > 0 && (
          <span className="cd-inbox-unread-pill" data-testid="notices-unread-count">{unread.length}</span>
        )}
      </div>
      <div className="cd-inbox-list">
        {unread.length === 0 ? (
          <div className="cd-inbox-empty">
            <Inbox size={16} />
            No unread notices — read ones clear out automatically.
          </div>
        ) : (
          unread.slice(0, 10).map((notification) => {
            const channelId = channelIdFromLink(notification.deepLink);
            const channel = channelId ? channelById.get(channelId) : undefined;
            const channelName = channel?.youtubeTitle || channel?.name;
            return (
              <a
                key={notification.id}
                href={notification.deepLink || '/'}
                onClick={() => open(notification)}
                className="cd-inbox-row unread"
                data-testid={`notification-${notification.id}`}
              >
                <span className="cd-inbox-row-icon"><Bell size={13} /></span>
                <span className="cd-inbox-row-copy">
                  <b>{notification.title}</b>
                  <small>{notification.body}</small>
                  <span className="cd-inbox-row-meta">
                    {channelName && (
                      <span className="cd-inbox-channel" data-testid={`notification-channel-${channel?.id}`}>
                        <span className="cd-inbox-channel-avatar" aria-hidden>
                          {channel?.youtubeAvatarUrl ? <img src={channel.youtubeAvatarUrl} alt="" /> : channelName.slice(0, 1).toUpperCase()}
                        </span>
                        {channelName}
                      </span>
                    )}
                    <em>{notification.category.replaceAll('_', ' ')} · {new Date(notification.createdAt).toLocaleDateString()}</em>
                  </span>
                </span>
                <span className="cd-inbox-unread-dot" aria-label="Unread" />
              </a>
            );
          })
        )}
      </div>
      {items.length > 0 && unread.length > 0 && (
        <a className="cd-inbox-foot" href="/notifications" data-testid="notices-open-inbox">
          <LayoutGrid size={12} /> Open the full inbox
        </a>
      )}
    </div>
  );
}
