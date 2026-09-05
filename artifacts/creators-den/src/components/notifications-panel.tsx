import { Bell, Inbox } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVideoNotificationsQueryKey,
  useListVideoNotifications,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import { useRealtimeNotifications } from '@/lib/realtime';

/** The den inbox panel — reused on the CMS grid and each channel home. */
export function NotificationsPanel() {
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const notifications = useListVideoNotifications({ query: { queryKey: getListVideoNotificationsQueryKey() } });
  const mark = useMarkVideoNotificationRead();

  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.readAt);

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
          <small>{unread.length > 0 ? `${unread.length} new` : 'all caught up'}</small>
        </span>
      </div>
      <div className="cd-inbox-list">
        {items.length === 0 ? (
          <div className="cd-inbox-empty">
            <Inbox size={16} />
            Nothing here yet — activity lands here as it happens.
          </div>
        ) : (
          items.slice(0, 8).map((notification) => (
            <a
              key={notification.id}
              href={notification.deepLink || '/'}
              onClick={() => !notification.readAt && open(notification)}
              className={`cd-inbox-row ${notification.readAt ? '' : 'unread'}`}
              data-testid={`notification-${notification.id}`}
            >
              <span className="cd-inbox-row-icon"><Bell size={13} /></span>
              <span className="cd-inbox-row-copy">
                <b>{notification.title}</b>
                <small>{notification.body}</small>
                <em>{notification.category.replaceAll('_', ' ')} · {new Date(notification.createdAt).toLocaleDateString()}</em>
              </span>
              {!notification.readAt && <span className="cd-inbox-unread-dot" aria-label="Unread" />}
            </a>
          ))
        )}
      </div>
    </div>
  );
}
