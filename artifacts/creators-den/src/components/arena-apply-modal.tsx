import { useState } from 'react';
import { FileText, Paperclip, Send, X } from 'lucide-react';
import { useCreateArenaApplication } from '@workspace/api-client-react';
import type { ArenaRole } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Arena shared bits — role metadata for the board + post pages, and the
// "Audition for this role" modal (message + up to 3 documents).
// ---------------------------------------------------------------------------

/** Role → display labels + den-tag tone for the four content roles. */
export const ARENA_ROLE_META: Record<
  ArenaRole,
  { label: string; roleLabel: string; tone: string; blurb: string }
> = {
  VIDEO: {
    label: 'Video',
    roleLabel: 'Video editor',
    tone: 'accent',
    blurb: 'Selects through Finish — cutting the video from raw footage to picture lock.',
  },
  AUDIO: {
    label: 'Audio',
    roleLabel: 'Sound designer',
    tone: 'teal',
    blurb: 'Clean the captured sound, place the music, duck it under speech, schedule VO.',
  },
  SCRIPT: {
    label: 'Script',
    roleLabel: 'Scriptwriter',
    tone: 'gold',
    blurb: 'Write and structure the script, hook, and CTA for this project.',
  },
  THUMBNAIL: {
    label: 'Thumbnail',
    roleLabel: 'Thumbnail designer',
    tone: 'muted',
    blurb: 'Design the cover — the frame, title text, and style that pops at small sizes.',
  },
};

/** A small colored role tag, e.g. <ArenaRoleTag role="VIDEO" />. */
export function ArenaRoleTag({ role, dataTestId }: { role: ArenaRole; dataTestId?: string }) {
  const meta = ARENA_ROLE_META[role];
  return (
    <span className={`den-tag ${meta.tone}`} data-testid={dataTestId}>
      {meta.label}
    </span>
  );
}

/** Short human relative time, e.g. "3h ago". */
export function timeAgo(iso: string): string {
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

/** Pretty-print bytes for the document chips (e.g. "1.2 MB"). */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export const ARENA_MESSAGE_MIN = 20;
export const ARENA_MESSAGE_MAX = 2000;
export const ARENA_MAX_FILES = 3;
export const ARENA_FILE_MAX_BYTES = 15 * 1024 * 1024;

const DOCUMENT_ACCEPT =
  'application/pdf,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp,image/gif,.doc,.docx,.xls,.xlsx';

interface ApplyArenaModalProps {
  postId: string;
  role: ArenaRole;
  projectName: string;
  channelName: string;
  onClose: () => void;
  onApplied: () => void;
}

// ---------------------------------------------------------------------------
// ApplyArenaModal — the audition composer. Sends a free-text pitch plus up to
// 3 documents (server caps each at 15 MB and allowlists the MIME types).
// ---------------------------------------------------------------------------

export function ApplyArenaModal({
  postId,
  role,
  projectName,
  channelName,
  onClose,
  onApplied,
}: ApplyArenaModalProps) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const apply = useCreateArenaApplication({
    mutation: {
      onSuccess: () => onApplied(),
      onError: (error) => {
        const messageFromServer =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null;
        setLocalError(messageFromServer ?? 'We could not send your audition just yet. Try again.');
      },
    },
  });

  const meta = ARENA_ROLE_META[role];
  const messageLength = message.length;
  const canSubmit =
    messageLength >= ARENA_MESSAGE_MIN &&
    messageLength <= ARENA_MESSAGE_MAX &&
    files.length <= ARENA_MAX_FILES &&
    !apply.isPending;

  const pickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalError(null);
    const picked = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow re-picking the same file after a removal
    if (picked.length === 0) return;
    const tooBig = picked.find((file) => file.size > ARENA_FILE_MAX_BYTES);
    if (tooBig) {
      setLocalError(`“${tooBig.name}” is larger than 15 MB.`);
      return;
    }
    const room = ARENA_MAX_FILES - files.length;
    if (picked.length > room) {
      setLocalError(`You may attach at most ${ARENA_MAX_FILES} documents.`);
      return;
    }
    setFiles((current) => [...current, ...picked]);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLocalError(null);
    apply.mutate({ postId, data: { message: message.trim(), files: files.length > 0 ? files : undefined } });
  };

  const error =
    localError ??
    (apply.isError
      ? ((apply.error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'We could not send your audition just yet.')
      : null);

  return (
    <div className="modal-backdrop" onClick={apply.isPending ? undefined : onClose} data-testid="arena-apply-modal">
      <div className="modal project-modal arena-apply-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={apply.isPending} aria-label="Close">
          <X size={16} />
        </button>
        <div className="project-modal-heading">
          <span className="eyebrow">Audition for this role</span>
          <h2>
            Pitch for the <em>{meta.roleLabel}</em> seat.
          </h2>
          <p>
            {channelName} is looking for a {meta.label.toLowerCase()} contributor on “{projectName}”. Tell the
            Captain what you&apos;d bring — a link or sample document always helps.
          </p>
        </div>
        <form className="project-modal-fields" onSubmit={submit}>
          <div className="field">
            <span>
              Why you? ({messageLength}/{ARENA_MESSAGE_MAX} — at least {ARENA_MESSAGE_MIN} characters)
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="I've cut 20+ long-form videos for creators and I love this channel's pacing. Here's what I'd bring to this project…"
              maxLength={ARENA_MESSAGE_MAX}
              rows={5}
              disabled={apply.isPending}
              autoFocus
              data-testid="input-arena-apply-message"
            />
          </div>

          <div className="field arena-files-field">
            <span>Supporting documents (optional — up to {ARENA_MAX_FILES} × 15 MB)</span>
            <label className="secondary-btn arena-file-pick" data-testid="arena-file-pick">
              <Paperclip size={14} />
              Attach documents
              <input type="file" multiple accept={DOCUMENT_ACCEPT} onChange={pickFiles} disabled={apply.isPending} />
            </label>
            {files.length > 0 && (
              <ul className="arena-file-list">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="arena-file-row">
                    <FileText size={13} />
                    <span className="truncate">{file.name}</span>
                    <small>{formatBytes(file.size)}</small>
                    <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="arena-apply-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="primary-btn modal-submit" data-testid="button-arena-apply">
            {apply.isPending ? 'Sending your audition…' : 'Send audition'}
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
