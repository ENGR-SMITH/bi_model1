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
import { AudioLines, MessageSquare, Mic, Pause, Play, RefreshCw, Send, Square, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoChatMessagesQueryKey,
  useGetVideoProject,
  useListVideoChatMessages,
  useSendVideoChatMessage,
  useSendVideoChatVoiceNote,
} from '@workspace/api-client-react';
import { MemberAvatar } from '@/components/member-avatar';

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function seenKey(projectId: string): string {
  return `creators-den-chat-seen-${projectId}`;
}

// A proper voice-note message: a play button, a live-equalizer bar that fills
// left→right as the note plays, and the elapsed/total time — instead of a bare
// native <audio controls> fighting the bubble.
function VoiceNoteBubble({
  audioUrl,
  durationMs,
  mine,
}: {
  audioUrl: string;
  durationMs: number | null;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(durationMs);

  useEffect(() => {
    return () => audioRef.current?.pause();
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const BAR_COUNT = 28;
  const showTime = currentTime > 0 && duration ? currentTime : duration;
  const filledIndex = duration && currentTime > 0 ? Math.floor((currentTime / duration) * BAR_COUNT) : playing ? BAR_COUNT : 0;

  return (
    <div className={`den-voice ${mine ? 'mine' : ''}`} data-testid="chat-voice-note">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration * 1000);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime * 1000)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        className="den-voice-play"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        data-testid="chat-voice-play"
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <div className="den-voice-wave" aria-hidden>
        {Array.from({ length: BAR_COUNT }).map((_, index) => {
          const height = 0.35 + ((index * 37) % 55) / 100;
          return (
            <span
              key={index}
              className={index < filledIndex ? 'fill' : playing ? 'live' : 'idle'}
              style={{ height: `${height * 100}%` }}
            />
          );
        })}
      </div>
      <span className="den-voice-time">{formatDuration(Math.round((showTime ?? 0) / 1000))}</span>
    </div>
  );
}

export function ProjectChat({ projectId }: { projectId: string }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const project = useGetVideoProject(projectId);
  const messages = useListVideoChatMessages(projectId, {
    query: { queryKey: getListVideoChatMessagesQueryKey(projectId), refetchInterval: 5000 },
  });
  const send = useSendVideoChatMessage();
  const sendVoice = useSendVideoChatVoiceNote();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  // Voice note recorder: a live MediaRecorder session + a ticking timer.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordSecondsRef = useRef(0);
  const recordTimerRef = useRef<number | null>(null);
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

  // Stop any in-flight recording when the panel closes or the component unmounts.
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (blob.size === 0) {
          setVoiceError('The recording came back empty — try again.');
          return;
        }
        const durationMs = Math.max(1, Math.round(recordSecondsRef.current * 1000));
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const name = `voice-note-${Date.now()}.${ext}`;
        const file = new File([blob], name, { type: mimeType });
        sendVoice.mutate(
          { projectId, data: { audio: file, durationMs, name } },
          {
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: getListVideoChatMessagesQueryKey(projectId) });
            },
          },
        );
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((seconds) => {
          recordSecondsRef.current = seconds + 1;
          return seconds + 1;
        });
      }, 1000);
    } catch {
      setVoiceError('Microphone access was denied — allow the mic to record voice notes.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
    if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
  };

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
  // Release docks the chat to whichever side of the screen is nearer — left or
  // right, at any height — so the room always rests against an edge.
  const onDragEnd = (event: globalThis.PointerEvent) => {
    const drag = dragRef.current;
    const shell = shellRef.current;
    dragRef.current = null;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    if (!drag || !shell) return;
    const maxX = Math.max(0, window.innerWidth - shell.offsetWidth - 8);
    const maxY = Math.max(0, window.innerHeight - shell.offsetHeight - 8);
    const x = Math.min(Math.max(8, drag.lx + event.clientX - drag.sx), maxX);
    const y = Math.min(Math.max(8, drag.ly + event.clientY - drag.sy), maxY);
    const snapLeft = x + shell.offsetWidth / 2 < window.innerWidth / 2;
    setPos({ x: snapLeft ? 8 : maxX, y });
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
            <span className="den-chat-head-avatars">
              {members.slice(0, 5).map((member) => (
                <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={24} />
              ))}
              {members.length > 5 && <span className="den-chat-avatar den-chat-more">+{members.length - 5}</span>}
            </span>
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
                    {message.audioUrl ? (
                      <div className="den-chat-voice" data-testid="chat-voice-note">
                        <VoiceNoteBubble
                          audioUrl={message.audioUrl}
                          durationMs={message.audioDurationMs}
                          mine={mine}
                        />
                        {message.body && <p className="den-chat-voice-caption">{message.body}</p>}
                      </div>
                    ) : (
                      <p>{message.body}</p>
                    )}
                    <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                );
              })
            )}
          </div>

          <div className="den-chat-compose">
            {recording ? (
              <span className="den-chat-record" data-testid="chat-record">
                <span className="den-chat-record-dot" aria-hidden />
                <b>Recording</b>
                <span className="den-chat-record-timer">{formatDuration(recordSeconds)}</span>
                <button type="button" className="icon-btn" onClick={stopRecording} aria-label="Stop recording" data-testid="chat-record-stop">
                  <Square size={13} />
                </button>
              </span>
            ) : (
              <>
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
                  disabled={messages.isError || sendVoice.isPending}
                  data-testid="chat-input"
                />
                <button
                  type="button"
                  className="icon-btn chat-mic-btn"
                  onClick={() => void startRecording()}
                  disabled={messages.isError || sendVoice.isPending}
                  aria-label="Record a voice note"
                  title="Record a voice note"
                  data-testid="chat-mic"
                >
                  {sendVoice.isPending ? <AudioLines size={14} className="spin" /> : <Mic size={14} />}
                </button>
                <button type="button" className="icon-btn" onClick={submit} disabled={!text.trim() || send.isPending || messages.isError} aria-label="Send message" data-testid="chat-send">
                  <Send size={15} />
                </button>
              </>
            )}
          </div>
          {(send.isError || sendVoice.isError) && !voiceError && (
            <p className="den-chat-send-error" role="alert" data-testid="chat-send-error">
              The {sendVoice.isError ? 'voice note' : 'message'} could not be sent — try again.
            </p>
          )}
          {voiceError && (
            <p className="den-chat-send-error" role="alert" data-testid="chat-voice-error">
              {voiceError}
            </p>
          )}
        </div>
      ) : (
        <button type="button" className="den-chat-fab" onClick={openPanel} aria-label="Open crew chat" data-testid="chat-fab">
          <span className="den-chat-fab-avatars">
            {members.slice(0, 3).map((member) => (
              <MemberAvatar key={member.userId} userId={member.userId} name={member.name} size={26} />
            ))}
            {members.length === 0 && <span className="den-chat-avatar"><MessageSquare size={13} /></span>}
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
