// ---------------------------------------------------------------------------
// ProjectChat — the crew room: a floating, draggable chat widget between
// everyone working on a project.
//
// The FAB shows the unread badge; clicking it opens the panel: the message
// thread and a composer. Messages stream in over the realtime socket AND a
// short poll, so the room keeps working even when the socket is down; send
// failures and load errors are surfaced inline instead of failing silently.
// (The member roster with avatars + roles lives on the vault's repository
// card now — see vault.tsx — not here.)
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, Send, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoChatMessagesQueryKey,
  useGetVideoProject,
  useListVideoChatMessages,
  useSendVideoChatMessage,
} from '@workspace/api-client-react';

function seenKey(projectId: string): string {
  return `creators-den-chat-seen-${projectId}`;
}

export function ProjectChat({ projectId }: { projectId: string }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const project = useGetVideoProject(projectId);
  const messages = useListVideoChatMessages(projectId, {
    query: { queryKey: getListVideoChatMessagesQueryKey(projectId), refetchInterval: 5000 },
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
  const memberNameById = new Map(members.map((member) => [member.userId, member.name ?? member.userId.slice(0, 8)]));

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

  // Opening the panel always refetches, so late messages appear immediately
  // even if the socket never delivered them.
  const openPanel = () => {
    setOpen(true);
    void queryClient.invalidateQueries({ queryKey: getListVideoChatMessagesQueryKey(projectId) });
  };

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
    if ((event.target as HTMLElement).closest('button, input, textarea, a, .den-chat-messages')) return;
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
            <span className="den-chat-head-mark"><MessageSquare size={15} /></span>
            <div>
              <b>Crew room</b>
              <small>{project.data?.name} · {members.length} {members.length === 1 ? 'member' : 'members'}</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat" data-testid="chat-close">
              <X size={15} />
            </button>
          </div>

          <div ref={listRef} className="den-chat-messages" data-testid="chat-messages">
            {messages.isError ? (
              <div className="den-chat-error" role="alert" data-testid="chat-load-error">
                <p>Could not load the crew room. The socket may be down —</p>
                <button type="button" className="text-btn" onClick={() => void messages.refetch()} data-testid="chat-retry">
                  <RefreshCw size={12} /> Retry
                </button>
              </div>
            ) : (messages.data ?? []).length === 0 ? (
              <p className="den-chat-empty">No messages yet — say hello to the crew.</p>
            ) : (
              (messages.data ?? []).map((message) => {
                const mine = message.authorId === user?.id;
                return (
                  <div key={message.id} className={`den-chat-msg ${mine ? 'mine' : ''}`} data-testid={`chat-msg-${message.id}`}>
                    {!mine && <b className="den-chat-msg-author">{memberNameById.get(message.authorId) ?? message.authorId.slice(0, 8)}</b>}
                    <p>{message.body}</p>
                    <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                );
              })
            )}
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
              disabled={messages.isError}
              data-testid="chat-input"
            />
            <button type="button" className="icon-btn" onClick={submit} disabled={!text.trim() || send.isPending || messages.isError} aria-label="Send message" data-testid="chat-send">
              <Send size={15} />
            </button>
          </div>
          {send.isError && (
            <p className="den-chat-send-error" role="alert" data-testid="chat-send-error">
              The message could not be sent — try again.
            </p>
          )}
        </div>
      ) : (
        <button type="button" className="den-chat-fab" onClick={openPanel} aria-label="Open crew chat" data-testid="chat-fab">
          <MessageSquare size={15} />
          <span>Crew chat</span>
          {unread > 0 && (
            <span className="den-chat-badge" data-testid="chat-unread">{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
      )}
    </div>
  );
}
