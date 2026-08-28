// ---------------------------------------------------------------------------
// MemberAvatar — the shared avatar for every member of a project: the account's
// real profile photo when one exists (fetched per user), otherwise a stable
// colored initial circle. Used by the vault's repository + members cards, the
// Finish export page, and the crew-room chat.
// ---------------------------------------------------------------------------

import { getGetUserProfileQueryKey, useGetUserProfile } from '@workspace/api-client-react';

export function MemberAvatar({
  userId,
  name,
  size = 26,
}: {
  userId: string;
  name?: string | null;
  size?: number;
}) {
  const profile = useGetUserProfile(userId, {
    query: { queryKey: getGetUserProfileQueryKey(userId), enabled: Boolean(userId) },
  });
  const label = (name || '?').slice(0, 1).toUpperCase();
  const hue = [...(name || userId || '?')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span
      className="den-chat-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      title={name ?? undefined}
    >
      {profile.data?.imageUrl ? (
        <img src={profile.data.imageUrl} alt="" />
      ) : (
        <span
          className="den-chat-avatar-initial"
          style={{ background: `hsl(${hue} 40% 42%)`, color: '#fff' }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
