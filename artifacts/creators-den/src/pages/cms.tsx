import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  CheckCircle2,
  Film,
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
  useListChannels,
  useListVideoProjects,
  useStartChannelOauth,
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

function NewChannelModal({ onClose, onCreated }: { onClose: () => void; onCreated: (channel: ChannelSummary) => void }) {
  const create = useCreateChannel();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim() } },
      {
        onSuccess: (channel) => onCreated(channel),
        onError: () => setError('We could not create that channel just yet.'),
      },
    );
  };

  return (
    <div className="modal-backdrop" onClick={create.isPending ? undefined : onClose}>
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <span className="project-modal-orbit"><span /><i /><b>C</b></span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="project-modal-heading">
          <span className="eyebrow">New channel</span>
          <h2>A workspace for <em>one channel.</em></h2>
          <p>Name the channel, then link it to the YouTube channel it belongs to — its banner, logo, and name will come straight from YouTube, and its videos become trackable in Analytics.</p>
        </div>
        <form className="project-modal-fields" onSubmit={submit}>
          <div className="field">
            <span>Channel name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Ada Makes Games"
              maxLength={80}
              required
              autoFocus
              data-testid="input-channel-name"
            />
          </div>
          {error && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--destructive))' }} role="alert">{error}</p>}
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
      </div>
    </div>
  );
}

// The Google consent window for linking a channel to its YouTube channel.
// The owner clicks "Connect" → start returns the consent URL → a new tab opens
// Google → on return the oauth-callback page exchanges the code and lands back
// on the CMS with the card now CONNECTED (real branding).
function ConnectChannelModal({ channel, onClose }: { channel: ChannelSummary; onClose: () => void }) {
  const start = useStartChannelOauth();
  const queryClient = useQueryClient();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  const begin = () => {
    setError('');
    start.mutate(
      { channelId: channel.id },
      {
        onSuccess: (result) => {
          setLinkUrl(result.url);
          // Open the consent screen; the user comes back through the
          // oauth-callback page, which redirects to the CMS once linked.
          window.open(result.url, '_blank', 'noopener,noreferrer');
        },
        onError: (err) => {
          const e = err as { response?: { data?: { error?: string } } };
          setError(e?.response?.data?.error || 'Could not start the link.');
        },
      },
    );
  };

  const refreshStatus = () => {
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    // Once the card flips to CONNECTED the modal closes on its own.
  };

  return (
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
                The consent screen opened in a new tab. Pick the channel there — this card updates the moment it's linked.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={linkUrl} target="_blank" rel="noreferrer" className="secondary-btn" data-testid="link-consent-reopen">
                  <Youtube size={14} /> Reopen Google
                </a>
                <button type="button" className="secondary-btn" onClick={refreshStatus} data-testid="button-connect-refresh">
                  <RefreshCw size={13} /> I've linked it
                </button>
              </div>
            </>
          )}
          {error && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--destructive))' }} role="alert" data-testid="connect-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function ChannelCardMenu({ channel }: { channel: ChannelSummary }) {
  const queryClient = useQueryClient();
  const remove = useDeleteChannel();
  const disconnect = useDisconnectChannelOauth();
  const [confirming, setConfirming] = useState<'delete' | 'disconnect' | null>(null);
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
                {busyMessage && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--destructive))', marginTop: 4 }} role="alert">{busyMessage}</p>}
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
                {busyMessage && <p className="text-sm font-semibold" style={{ color: 'hsl(var(--destructive))', marginTop: 4 }} role="alert">{busyMessage}</p>}
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
        {channel.youtubeBannerUrl ? (
          <img src={channel.youtubeBannerUrl} alt="" />
        ) : (
          <span className="cms-channel-banner-fallback" />
        )}
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

export default function CmsPage() {
  const queryClient = useQueryClient();
  const channels = useListChannels();
  const [modalOpen, setModalOpen] = useState(false);

  // The channel grid: owned channels first (the owner's cards), then the
  // editor mirror cards — real branding either way, straight from YouTube.
  const list = channels.data ?? [];
  const sorted = [...list].sort((a, b) => {
    if (a.myRole !== b.myRole) return a.myRole === 'OWNER' ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const onCreated = () => {
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
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

      <div className="mt-8">
        <NotificationsPanel />
      </div>

      {modalOpen && <NewChannelModal onClose={() => setModalOpen(false)} onCreated={onCreated} />}
    </div>
  );
}
