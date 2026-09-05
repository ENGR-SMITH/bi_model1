import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  CheckCircle2,
  Film,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
  Users,
  X,
  Youtube,
} from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListChannelsQueryKey,
  getListVideoProjectsQueryKey,
  useAttachVideoProjectChannel,
  useCreateChannel,
  useDeleteChannel,
  useDisconnectChannelOauth,
  useListArenaPosts,
  useListChannels,
  useListVideoProjects,
  useStartChannelOauth,
  type ArenaPostSummary,
  type ChannelSummary,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { NotificationsPanel } from '@/components/notifications-panel';

// ---------------------------------------------------------------------------
// The CMS — Creator Den's landing page. A grid of every channel the caller is
// on (their own + the channels they edit on, mirrored with real branding),
// a "+ New channel" card, and a section for legacy channel-less projects the
// owner still has to attach to a channel.
// ---------------------------------------------------------------------------

// Modals are portaled to <body> so their fixed backdrops are viewport-relative
// (no ancestor transform can stretch the page), and body scrolling is locked
// while one is open so the page behind never scrolls.
function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

// The Google "G" mark for the sign-in button (four brand colors, no icon lib).
function GoogleG() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v2.98h3.89c2.26-2.09 3.53-5.17 3.53-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.89-2.98c-1.08.72-2.45 1.16-4.04 1.16-3.1 0-5.73-2.09-6.67-4.91H1.3v3.07C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.33 14.36a7.2 7.2 0 0 1 0-4.72V6.57H1.3a11.97 11.97 0 0 0 0 10.86l4.03-3.07z" />
      <path fill="#EA4335" d="M12 4.73c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.23 0 12 0 7.31 0 3.26 2.7 1.3 6.57l4.03 3.07C6.27 6.82 8.9 4.73 12 4.73z" />
    </svg>
  );
}

function NewChannelModal({ onClose, onCreated }: { onClose: () => void; onCreated: (channel: ChannelSummary) => void }) {
  const create = useCreateChannel();
  const start = useStartChannelOauth();
  const queryClient = useQueryClient();
  useLockBodyScroll(true);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  // Google-first linking (no typed name): the consent URL runs against a
  // provisional channel id and the workspace row is created server-side from
  // the picked YouTube channel when the code comes back.
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const invalidateChannels = () => {
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    // Create only — link it now via the Google button, or later from the card.
    create.mutate(
      { data: { name: name.trim() } },
      {
        onSuccess: () => {
          invalidateChannels();
          onClose();
        },
        onError: () => setError('We could not create that channel just yet.'),
      },
    );
  };

  // A typed name → the channel is created with it and the Google consent
  // opens for that channel (onCreated hands off to the connect modal). A
  // blank name → Google-first: consent against a provisional id, and the
  // channel is created on return with the real YouTube name/logo/banner.
  const signInWithGoogle = () => {
    if (create.isPending || start.isPending) return;
    setError('');
    setPopupBlocked(false);
    const typed = name.trim();
    if (typed) {
      create.mutate(
        { data: { name: typed } },
        {
          onSuccess: (channel) => onCreated(channel),
          onError: () => setError('We could not create that channel just yet.'),
        },
      );
      return;
    }
    const provisionalId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    start.mutate(
      { channelId: provisionalId },
      {
        onSuccess: (result) => {
          setPendingLink(result.url);
          // window.open returns null when the browser blocked the pop-up — the
          // "Open Google" link below still works as a fallback.
          if (!window.open(result.url, '_blank', 'noopener,noreferrer')) setPopupBlocked(true);
        },
        onError: (err) => {
          const e = err as { response?: { data?: { error?: string } } };
          setError(e?.response?.data?.error || 'Could not reach Google — try again.');
        },
      },
    );
  };

  const busy = create.isPending || start.isPending;

  return createPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <span className="project-modal-orbit"><span /><i /><b>C</b></span>
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></button>
        <div className="project-modal-heading">
          <span className="eyebrow">New channel</span>
          <h2>A workspace for <em>one channel.</em></h2>
          <p>Type a name to create it now — or sign in with Google and the channel is built from your real YouTube channel: its name, logo, and banner, ready for Analytics.</p>
        </div>
        {pendingLink ? (
          <div className="project-modal-fields" data-testid="panel-google-pending">
            <p className="setting-copy">
              {popupBlocked
                ? 'Your browser blocked the pop-up — click below to open the Google consent screen in a new tab.'
                : 'Google opened in a new tab. Pick your YouTube channel there — this workspace is created with its name, logo, and banner the moment you finish.'}
            </p>
            <a href={pendingLink} target="_blank" rel="noreferrer" className="primary-btn modal-submit" style={{ textDecoration: 'none' }} data-testid="link-google-consent-open">
              <GoogleG /> {popupBlocked ? 'Open Google' : 'Reopen Google'}
            </a>
            <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  invalidateChannels();
                  onClose();
                }}
                data-testid="button-google-linked"
              >
                <RefreshCw size={13} /> I've linked it
              </button>
              <button type="button" className="secondary-btn" onClick={onClose} data-testid="button-google-cancel">Not now</button>
            </div>
          </div>
        ) : (
          <form className="project-modal-fields" onSubmit={submit}>
            <div className="field">
              <span>Channel name</span>
              <div className="channel-name-row">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Ada Makes Games"
                  maxLength={80}
                  required
                  autoFocus
                  disabled={busy}
                  data-testid="input-channel-name"
                />
                <button
                  type="button"
                  className="google-btn"
                  onClick={signInWithGoogle}
                  disabled={busy}
                  data-testid="button-signin-google"
                >
                  <GoogleG />
                  {start.isPending ? 'Contacting Google…' : 'Sign in with Google'}
                </button>
              </div>
              <span className="channel-name-hint">Optional — leave it blank and the name comes from your YouTube channel.</span>
            </div>
            {error && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="new-channel-error">{error}</p>}
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="primary-btn modal-submit"
              data-testid="button-create-channel"
            >
              {create.isPending ? 'Opening the channel…' : 'Create channel'}
              <ArrowRight size={15} />
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

// The Google consent window for linking a channel to its YouTube channel.
// The owner clicks "Connect" (or lands here straight from creating the
// channel, autoBegin) → start returns the consent URL → a new tab opens
// Google → on return the oauth-callback page exchanges the code and lands back
// on the CMS with the card now CONNECTED (real branding).
function ConnectChannelModal({ channel, onClose, autoBegin }: { channel: ChannelSummary; onClose: () => void; autoBegin?: boolean }) {
  const start = useStartChannelOauth();
  const queryClient = useQueryClient();
  useLockBodyScroll(true);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [popupBlocked, setPopupBlocked] = useState(false);

  const begin = () => {
    setError('');
    setPopupBlocked(false);
    start.mutate(
      { channelId: channel.id },
      {
        onSuccess: (result) => {
          setLinkUrl(result.url);
          // Open the consent screen; the user comes back through the
          // oauth-callback page, which redirects to the CMS once linked.
          const opened = window.open(result.url, '_blank', 'noopener,noreferrer');
          // window.open returns null when the browser blocked the popup — the
          // "Reopen Google" link below still works as a fallback.
          if (!opened) setPopupBlocked(true);
        },
        onError: (err) => {
          const e = err as { response?: { data?: { error?: string } } };
          setError(e?.response?.data?.error || 'Could not start the link.');
        },
      },
    );
  };

  // When the flow continues straight from "Create channel", kick the consent
  // URL off right away so the user lands on Google without an extra click.
  useEffect(() => {
    if (autoBegin) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = () => {
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    // The auto-close effect below fires once the refetch shows the card CONNECTED.
  };

  // When the refetched channel summary flips to CONNECTED the link is done —
  // close so the user lands on the grid and sees the real YouTube banner,
  // logo, and name on the card.
  useEffect(() => {
    if (channel.youtubeConnected) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.youtubeConnected]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <span className="project-modal-orbit"><span /><i /><b>Y</b></span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="project-modal-heading">
          <span className="eyebrow"><Youtube size={12} /> Link your YouTube channel</span>
          <h2>Connect “{channel.name}” <em>to YouTube.</em></h2>
          <p>Google asks which account owns the channel; you pick it, and this workspace takes its name, logo, and banner straight from YouTube. Only your own channels can be linked.</p>
        </div>
        <div className="project-modal-fields">
          {!linkUrl ? (
            <button
              type="button"
              className="primary-btn modal-submit"
              onClick={begin}
              disabled={start.isPending}
              data-testid="button-connect-start"
            >
              <Youtube size={15} />
              {start.isPending ? 'Opening Google…' : 'Continue with Google'}
            </button>
          ) : (
            <>
              <p className="setting-copy">
                {popupBlocked
                  ? 'Your browser blocked the pop-up — click below to open the Google consent screen in a new tab.'
                  : 'The consent screen opened in a new tab. Pick the channel there — this card updates the moment it\'s linked.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={linkUrl} target="_blank" rel="noreferrer" className="secondary-btn" data-testid="link-consent-reopen">
                  <Youtube size={14} /> {popupBlocked ? 'Open Google' : 'Reopen Google'}
                </a>
                <button type="button" className="secondary-btn" onClick={refreshStatus} data-testid="button-connect-refresh">
                  <RefreshCw size={13} /> I've linked it
                </button>
              </div>
            </>
          )}
          {error && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert" data-testid="connect-error">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChannelCardMenu({ channel }: { channel: ChannelSummary }) {
  const queryClient = useQueryClient();
  const remove = useDeleteChannel();
  const disconnect = useDisconnectChannelOauth();
  const [confirming, setConfirming] = useState<'delete' | 'disconnect' | null>(null);
  useLockBodyScroll(confirming !== null);
  const [busyMessage, setBusyMessage] = useState('');

  const isOwner = channel.myRole === 'OWNER';
  const canDelete = isOwner && channel.projectCount === 0;

  const confirmDelete = () => {
    remove.mutate(
      { channelId: channel.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
          setConfirming(null);
        },
        onError: (error) => {
          const err = error as { response?: { data?: { error?: string } } };
          setBusyMessage(err?.response?.data?.error || 'Could not delete this channel.');
        },
      },
    );
  };

  if (!isOwner) return null;

  const confirmDisconnect = () => {
    setBusyMessage('');
    disconnect.mutate(
      { channelId: channel.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
          setConfirming(null);
        },
        onError: (error) => {
          const err = error as { response?: { data?: { error?: string } } };
          setBusyMessage(err?.response?.data?.error || 'Could not disconnect YouTube.');
        },
      },
    );
  };

  return (
    <>
      {channel.youtubeConnected && (
        <button
          type="button"
          className="cms-card-menu-btn cms-card-disconnect"
          onClick={(event) => {
            event.stopPropagation();
            setConfirming('disconnect');
          }}
          aria-label={`Disconnect YouTube for ${channel.name}`}
          title="Disconnect the YouTube link"
          data-testid={`channel-disconnect-${channel.id}`}
        >
          <Unlink size={14} />
        </button>
      )}
      <button
        type="button"
        className="cms-card-menu-btn"
        onClick={(event) => {
          event.stopPropagation();
          setConfirming('delete');
        }}
        aria-label={`Channel menu for ${channel.name}`}
        title={canDelete ? 'Delete this channel' : 'A channel with projects cannot be deleted'}
        data-testid={`channel-menu-${channel.id}`}
      >
        <Trash2 size={14} />
      </button>
      {confirming && createPortal(
        <div className="modal-backdrop" onClick={() => setConfirming(null)} data-testid="modal-delete-channel">
          <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setConfirming(null)} aria-label="Close"><X size={16} /></button>
            {confirming === 'delete' ? (
              <>
                <div className="project-modal-heading">
                  <span className="eyebrow">Delete channel</span>
                  <h2>Delete “{channel.name}” <em>for good?</em></h2>
                  {channel.projectCount > 0 ? (
                    <p>This channel still has {channel.projectCount} project{channel.projectCount === 1 ? '' : 's'} inside it. Move or delete them before deleting the channel.</p>
                  ) : (
                    <p>This removes the channel and its editor roster. It cannot be undone.</p>
                  )}
                </div>
                {busyMessage && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))', marginTop: 4 }} role="alert">{busyMessage}</p>}
                <div className="project-modal-fields" style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <button type="button" className="secondary-btn" onClick={() => setConfirming(null)} disabled={remove.isPending}>Cancel</button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={confirmDelete}
                    disabled={remove.isPending || !canDelete}
                    style={canDelete ? { background: 'hsl(var(--destructive))', borderColor: 'hsl(var(--destructive))' } : undefined}
                    data-testid="button-confirm-delete-channel"
                  >
                    <Trash2 size={14} />
                    {remove.isPending ? 'Deleting…' : 'Delete channel'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="project-modal-heading">
                  <span className="eyebrow"><Unlink size={12} /> Disconnect YouTube</span>
                  <h2>Unlink “{channel.name}” <em>from YouTube?</em></h2>
                  <p>The channel stays — its projects, editors, and this card all remain. It just loses the YouTube link, branding, and analytics until you connect it again.</p>
                </div>
                {busyMessage && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))', marginTop: 4 }} role="alert">{busyMessage}</p>}
                <div className="project-modal-fields" style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <button type="button" className="secondary-btn" onClick={() => setConfirming(null)} disabled={disconnect.isPending}>Cancel</button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={confirmDisconnect}
                    disabled={disconnect.isPending}
                    style={{ background: 'hsl(var(--destructive))', borderColor: 'hsl(var(--destructive))' }}
                    data-testid="button-confirm-disconnect-channel"
                  >
                    <Unlink size={14} />
                    {disconnect.isPending ? 'Disconnecting…' : 'Disconnect YouTube'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function ChannelCard({ channel }: { channel: ChannelSummary }) {
  const isOwner = channel.myRole === 'OWNER';
  const displayName = channel.youtubeTitle || channel.name;
  const display = channel.youtubeAvatarUrl || channel.name.slice(0, 1).toUpperCase();
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <div className={`cms-channel-card ${isOwner ? 'is-owner' : 'is-editor'}`} data-testid={`card-channel-${channel.id}`}>
      <Link href={`/channels/${channel.id}`} className="cms-channel-hit" aria-label={`Open ${displayName}`} />
      <div className="cms-channel-banner" aria-hidden>
        {/* The media is clipped on its own wrapper so the straddling avatar
            below is never cut off at the banner's bottom edge. */}
        <span className="cms-channel-banner-media">
          {channel.youtubeBannerUrl ? (
            <img src={channel.youtubeBannerUrl} alt="" />
          ) : (
            <span className="cms-channel-banner-fallback" />
          )}
        </span>
        <span className="cms-channel-logo" aria-hidden>
          {channel.youtubeAvatarUrl ? <img src={channel.youtubeAvatarUrl} alt="" /> : display}
        </span>
        <span className="cms-status-chip">
          {channel.youtubeConnected ? <><CheckCircle2 size={11} /> Connected</> : <><Link2 size={11} /> Not linked</>}
        </span>
        {isOwner && !channel.youtubeConnected && (
          <button
            type="button"
            className="cms-connect-btn"
            onClick={(event) => {
              event.stopPropagation();
              setConnectOpen(true);
            }}
            data-testid={`channel-connect-${channel.id}`}
          >
            <Youtube size={12} /> Connect YouTube
          </button>
        )}
        {isOwner && <ChannelCardMenu channel={channel} />}
      </div>
      <div className="cms-channel-body">
        <span className="cms-channel-name">{displayName}</span>
        <span className="cms-channel-meta">
          {isOwner ? 'Your channel' : 'You’re an editor'} · {channel.projectCount} project{channel.projectCount === 1 ? '' : 's'} · {channel.editorCount} {channel.editorCount === 1 ? 'person' : 'people'}
        </span>
        <span className="cms-channel-open" aria-hidden>Open the den <ArrowRight size={12} /></span>
      </div>
      {connectOpen && <ConnectChannelModal channel={channel} onClose={() => setConnectOpen(false)} />}
    </div>
  );
}

/** Legacy channel-less projects: the Captain attaches them to a channel. */
function UnlinkedProjects() {
  const queryClient = useQueryClient();
  const channels = useListChannels();
  const unlinked = useListVideoProjects({ unlinked: '1' });
  const ownedChannels = (channels.data ?? []).filter((c) => c.myRole === 'OWNER');
  const attach = useAttachVideoProjectChannel();
  const [pendingChannel, setPendingChannel] = useState<Record<string, string>>({});

  const attachProject = (projectId: string) => {
    const channelId = pendingChannel[projectId];
    if (!channelId) return;
    attach.mutate(
      { projectId, data: { channelId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey({ unlinked: '1' }) });
          queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
          setPendingChannel((prev) => ({ ...prev, [projectId]: '' }));
        },
      },
    );
  };

  const projects = unlinked.data ?? [];
  if (projects.length === 0) return null;

  return (
    <div className="paper-card mt-8" data-testid="panel-unlinked-projects">
      <div className="inline-heading">
        <span className="eyebrow"><Film size={13} /> Unlinked projects</span>
        <span className="mono-label">{projects.length} legacy</span>
      </div>
      <p className="setting-copy mt-1">
        Projects created before channels existed live outside every channel until you attach them — then they show up
        inside that channel (and its card on this page) like any other project.
      </p>
      <div className="den-stack mt-3">
        {projects.map((project) => (
          <div className="list-row" key={project.id} data-testid={`unlinked-project-${project.id}`}>
            <span className="world-symbol"><Film size={13} /></span>
            <span className="flex-1 min-w-0">
              <b>{project.name}</b>
              <small>No channel yet · created {new Date(project.createdAt).toLocaleDateString()}</small>
            </span>
            <select
              value={pendingChannel[project.id] ?? ''}
              onChange={(event) => setPendingChannel((prev) => ({ ...prev, [project.id]: event.target.value }))}
              aria-label={`Channel for ${project.name}`}
              className="den-select"
              data-testid={`unlinked-channel-pick-${project.id}`}
            >
              <option value="">Choose a channel…</option>
              {ownedChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.youtubeTitle || channel.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => attachProject(project.id)}
              disabled={!pendingChannel[project.id] || attach.isPending}
              data-testid={`unlinked-attach-${project.id}`}
            >
              <Link2 size={13} /> Attach
            </button>
          </div>
        ))}
      </div>
      {ownedChannels.length === 0 && (
        <p className="den-footnote mt-3">Create your first channel above to attach these projects to it.</p>
      )}
    </div>
  );
}

// The doorway row under the channel wall: the public collaboration/audition
// arena, with the live count of open roles across every channel. The footer
// stacks the real avatars of up to five captains currently posting, so the
// card reads as people at work rather than a dead link.
function ArenaDoorwayRow() {
  const arena = useListArenaPosts();
  const posts = (arena.data ?? []) as ArenaPostSummary[];
  const openCount = posts.length;

  // Distinct captains currently posting (the arena list only carries poster
  // faces, not applicant ones) — dedupe and cap at five + a "+N" bubble.
  const distinct = new Map<string, { id: string; name: string; imageUrl: string | null }>();
  for (const post of posts) {
    if (!distinct.has(post.postedBy)) {
      distinct.set(post.postedBy, { id: post.postedBy, name: post.posterName, imageUrl: post.posterImageUrl });
    }
  }
  const posters = [...distinct.values()].slice(0, 5);
  const morePosters = Math.max(0, distinct.size - posters.length);

  return (
    <Link
      href="/arena"
      className="arena-doorway"
      data-testid="card-arena-doorway"
    >
      {/* Channel-card theme: a banner with the globe as the channel logo, the
          live count as the status chip, and the copy sitting tight against
          the globe instead of floating mid-card. */}
      <span className="arena-doorway-banner">
        <span className="arena-doorway-logo" aria-hidden><Globe size={22} /></span>
        <span className="arena-doorway-heading">
          <span className="eyebrow"><Globe size={11} /> Collaboration / Audition Arena</span>
          <b className="arena-doorway-title">Audition for open roles on creators' channels.</b>
        </span>
        <span className="arena-doorway-chip" data-testid="arena-doorway-count">
          <i className="arena-doorway-live-dot" aria-hidden />
          {openCount} open {openCount === 1 ? 'audition' : 'auditions'}
        </span>
      </span>
      <span className="arena-doorway-copy">
        <span className="arena-doorway-sub">
          Video, audio, script, and thumbnail seats — pitch with your work, preview the project read-only while
          it's open, and get hired straight onto the team.
        </span>
        <span className="arena-doorway-foot">
          {posters.length > 0 ? (
            <>
              <span className="arena-doorway-avatars" aria-hidden>
                {posters.map((poster) => (
                  <span key={poster.id} className="arena-doorway-avatar">
                    {poster.imageUrl ? <img src={poster.imageUrl} alt="" /> : poster.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {morePosters > 0 && <span className="arena-doorway-avatar more">+{morePosters}</span>}
              </span>
              <span className="arena-doorway-foot-text">
                <b>{posters.length === 1 ? 'A captain is posting right now' : `${posters.length} captains are posting right now`}</b>
                <small>Tap to see every open role — and audition.</small>
              </span>
            </>
          ) : (
            <span className="arena-doorway-foot-text">
              <b>Be the first to post an open role</b>
              <small>The board opens the moment a captain posts.</small>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export default function CmsPage() {
  const queryClient = useQueryClient();
  const channels = useListChannels();
  const [modalOpen, setModalOpen] = useState(false);
  // The channel to link right after it was created: the "+ New channel" flow
  // continues straight into the Google OAuth connect step instead of leaving
  // the brand-new card unlinked.
  const [connectTarget, setConnectTarget] = useState<ChannelSummary | null>(null);

  // The channel grid: owned channels first (the owner's cards), then the
  // editor mirror cards — real branding either way, straight from YouTube.
  const list = channels.data ?? [];
  const sorted = [...list].sort((a, b) => {
    if (a.myRole !== b.myRole) return a.myRole === 'OWNER' ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const onCreated = (channel: ChannelSummary) => {
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    // Straight into the Google consent flow (plan §12.2).
    setConnectTarget(channel);
  };

  return (
    <div className="page">
      <div className="cms-head">
        <div>
          <SectionEyebrow>Your channels</SectionEyebrow>
          <h1 className="cms-title">Every channel you work on, in one place.</h1>
          <p className="cms-sub">
            Open a channel to run its projects from the studio to the analytics — or add the next one.
          </p>
        </div>
        <div className="cms-head-count mono-label">
          {sorted.length} channel{sorted.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* 70/30 split: the channel wall on the left, the notice feed on the
          right — side by side instead of stacked rows. */}
      <div className="cms-split" data-testid="cms-split">
        <div className="cms-split-main">
          {/* The collaboration / audition arena — the doorway to the public
              role board, kept at the top of the channel wall so every captain
              sees it before their grid. */}
          <ArenaDoorwayRow />

          {channels.isLoading ? (
            <div className="panel-empty">Opening your channels…</div>
          ) : sorted.length > 0 ? (
            <div className="cms-grid" data-testid="cms-grid">
              {sorted.map((channel) => <ChannelCard key={channel.id} channel={channel} />)}
              <button type="button" className="cms-new-card" onClick={() => setModalOpen(true)} data-testid="card-new-channel">
                <span className="cms-new-icon"><Plus size={18} /></span>
                <b>New channel</b>
                <small>Link a YouTube channel and run its den</small>
              </button>
            </div>
          ) : (
            <div className="empty-state" data-testid="empty-channels">
              <Users size={22} />
              <h3>No channels yet.</h3>
              <p>Create a channel, link it to the YouTube channel it belongs to, and its den — projects, contributors, and analytics — all live inside it.</p>
              <button type="button" className="primary-btn mt-3" onClick={() => setModalOpen(true)}>
                <Plus size={14} /> New channel
              </button>
            </div>
          )}

          <UnlinkedProjects />
        </div>

        <aside className="cms-split-side">
          <NotificationsPanel />
        </aside>
      </div>

      {modalOpen && <NewChannelModal onClose={() => setModalOpen(false)} onCreated={onCreated} />}
      {connectTarget && (
        <ConnectChannelModal
          channel={connectTarget}
          onClose={() => setConnectTarget(null)}
          autoBegin
        />
      )}
    </div>
  );
}
