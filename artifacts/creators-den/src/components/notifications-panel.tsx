import { Bell } from 'lucide-react';
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

  const unread = (notifications.data ?? []).filter((n) => !n.readAt);

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

  if (!notifications.data || notifications.data.length === 0) return null;

  return (
    <div className="paper-card" data-testid="panel-notifications">
      <div className="inline-heading">
        <span className="eyebrow"><Bell size={13} /> Notices</span>
        {unread.length > 0 && (
          <span className="den-tag danger">{unread.length} new</span>
        )}
      </div>
      <div className="den-stack">
        {(notifications.data ?? []).slice(0, 8).map((notification) => (
          <a
            key={notification.id}
            href={notification.deepLink || '/'}
            onClick={() => !notification.readAt && open(notification)}
            className={`list-row ${notification.readAt ? '' : 'selected'}`}
            data-testid={`notification-${notification.id}`}
          >
            <span className="world-symbol"><Bell size={13} /></span>
            <span>
              <b>{notification.title}</b>
              <small>{notification.body}</small>
              <small>{notification.category.replaceAll('_', ' ')} · {new Date(notification.createdAt).toLocaleDateString()}</small>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
