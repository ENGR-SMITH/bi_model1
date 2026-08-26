// ---------------------------------------------------------------------------
// ProjectChat — the crew room: a floating, draggable chat widget between
// everyone working on a project (the same idea as the Author Den's floating
// chat, but project-wide instead of a private 1:1 thread).
//
// The FAB shows the project's member avatars with an unread badge; clicking
// it opens the panel: a member roster (avatar + name of every person on the
// project), the message thread, and a composer. The panel is draggable by
// its header, messages stream in over the realtime socket, and the unread
// badge counts messages that arrived since the panel was last opened.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetUserProfileQueryKey,
  getListVideoChatMessagesQueryKey,
  useGetUserProfile,
  useGetVideoProject,
  useListVideoChatMessages,
  useSendVideoChatMessage,
} from '@workspace/api-client-react';

function seenKey(projectId: string): string {
  return `creators-den-chat-seen-${projectId}`;
}

// One profile query per member gives their real avatar photo when the
// account has one; otherwise a stable colored initial circle.
function MemberAvatar({ userId, name, size = 26 }: { userId: string; name?: string | null; size?: number }) {
  const profile = useGetUserProfile(userId, {
    query: { queryKey: getGetUserProfileQueryKey(userId), enabled: Boolean(userId) },
  });
  const label = (name || '?').slice(0, 1).toUpperCase();
  const hue = [...(name || userId || '?')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span className="den-chat-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name ?? undefined}>
      {profile.data?.imageUrl ? <img src={profile.data.imageUrl} alt="" /> : (
        <span className="den-chat-avatar-initial" style={{ background: `hsl(${hue} 40% 42%)`, color: '#fff' }}>{label}</span>
      )}
    </span>
  );
}

export function ProjectChat({ projectId }: { projectId: string }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const project = useGetVideoProject(projectId);
  const messages = useListVideoChatMessages(projectId, {
    query: { queryKey: getListVideoChatMessagesQueryKey(projectId), refetchInterval: 10000 },
  });
  const send = useSendVideoChatMessage();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  // Drag state: the whole widget (FAB + panel) moves by grabbing the header.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; lx: number; ly: number } | null>(null);

  const members = project.data?.members ?? [];
  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.userId, member.name ?? member.userId.slice(0, 8)])),
    [members],
  );

  // Keep the newest message in view while the panel is open.
  useEffect(() => {
    const el = listRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [messages.data, open]);

  // Unread badge: while closed, count messages after the last seen id.
  useEffect(() => {
    const rows = messages.data ?? [];
    if (rows.length === 0) return;
    const lastId = rows[rows.length - 1].id;
    if (open) {
      try {
        localStorage.setItem(seenKey(projectId), lastId);
      } catch {
        // Storage unavailable — badge just stays until the panel opens.
      }
      setUnread(0);
      return;
    }
    let seen = '';
    try {
      seen = localStorage.getItem(seenKey(projectId)) ?? '';
    } catch {
      // Ignore — treat everything as unread.
    }
    const index = seen ? rows.findIndex((row) => row.id === seen) : -1;
    setUnread(index === -1 ? rows.length : rows.length - 1 - index);
  }, [messages.data, open, projectId]);

  // ---- Dragging (grab the panel header; interactive elements are exempt) ----
  const onDragMove = (event: globalThis.PointerEvent) => {
    const drag = dragRef.current;
    const shell = shellRef.current;
    if (!drag || !shell) return;
    const maxX = Math.max(0, window.innerWidth - shell.offsetWidth - 8);
    const maxY = Math.max(0, window.innerHeight - shell.offsetHeight - 8);
    setPos({
      x: Math.min(Math.max(8, drag.lx + event.clientX - drag.sx), maxX),
      y: Math.min(Math.max(8, drag.ly + event.clientY - drag.sy), maxY),
    });
  };
  const onDragEnd = () => {
    dragRef.current = null;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
  };
  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, textarea, a, .den-chat-messages, .den-chat-members')) return;
    const shell = shellRef.current;
    if (!shell) return;
    dragRef.current = {
      sx: event.clientX,
      sy: event.clientY,
      lx: pos?.x ?? window.innerWidth - shell.offsetWidth - 26,
      ly: pos?.y ?? window.innerHeight - shell.offsetHeight - 26,
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
  };

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(
      { projectId, data: { body } },
      {
        onSuccess: () => {
          setText('');
          void queryClient.invalidateQueries({ queryKey: getListVideoChatMessagesQueryKey(projectId) });
        },
      },
    );
  };

  if (!projectId || project.isError) return null;

  return (
    <div
      ref={shellRef}
      className="den-chat"
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={onDragStart}
      data-testid="project-chat"
    >
      {open ? (
        <div className="den-chat-panel" data-testid="chat-panel">
          <div className="den-chat-head">
            <span className="den-chat-head-avatars">
              {members.slice(0, 4).map((member) => (
                <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={24} />
              ))}
              {members.length > 4 && <span className="den-chat-avatar den-chat-more">+{members.length - 4}</span>}
            </span>
            <div>
              <b>Crew room</b>
              <small>{project.data?.name} · {members.length} {members.length === 1 ? 'member' : 'members'}</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat" data-testid="chat-close">
              <X size={15} />
            </button>
          </div>

          {/* The whole crew — avatar + name for everyone on the project. */}
          <div className="den-chat-members" data-testid="chat-members">
            {members.map((member) => (
              <span key={member.userId} className="den-chat-member" title={member.role ?? undefined}>
                <MemberAvatar userId={member.userId} name={member.name} size={22} />
                <span>{member.name ?? member.userId.slice(0, 8)}</span>
                {member.role && <span className="den-tag accent">{member.role.replace(/_/g, ' ')}</span>}
              </span>
            ))}
          </div>

          <div ref={listRef} className="den-chat-messages" data-testid="chat-messages">
            {(messages.data ?? []).length === 0 && (
              <p className="den-chat-empty">No messages yet — say hello to the crew.</p>
            )}
            {(messages.data ?? []).map((message) => {
              const mine = message.authorId === user?.id;
              return (
                <div key={message.id} className={`den-chat-msg ${mine ? 'mine' : ''}`} data-testid={`chat-msg-${message.id}`}>
                  {!mine && <b className="den-chat-msg-author">{memberNameById.get(message.authorId) ?? message.authorId.slice(0, 8)}</b>}
                  <p>{message.body}</p>
                  <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              );
            })}
          </div>

          <div className="den-chat-compose">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Message the crew…"
              maxLength={2000}
              data-testid="chat-input"
            />
            <button type="button" className="icon-btn" onClick={submit} disabled={!text.trim() || send.isPending} aria-label="Send message" data-testid="chat-send">
              <Send size={15} />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="den-chat-fab" onClick={() => setOpen(true)} aria-label="Open crew chat" data-testid="chat-fab">
          <span className="den-chat-fab-avatars">
            {members.slice(0, 3).map((member) => (
              <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={26} />
            ))}
            {members.length === 0 && <span className="den-chat-avatar">C</span>}
          </span>
          <span>Crew chat</span>
          {unread > 0 && (
            <span className="den-chat-badge" data-testid="chat-unread">{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
      )}
    </div>
  );
}
