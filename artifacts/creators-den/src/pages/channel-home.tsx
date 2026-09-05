import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  Image,
  Link2,
  LockKeyhole,
  Mic2,
  MoreHorizontal,
  Palette,
  Scissors,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListChannelProjectsQueryKey,
  getListChannelsQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoProjectsQueryKey,
  useCreateVideoProject,
  useDeleteVideoProject,
  useGetChannel,
  useListChannelPeople,
  useListChannelProjects,
  useUpdateVideoProjectVisibility,
  type VideoProject,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useChannelPresence } from '@/lib/realtime';
import { channelProjectUrl } from '@/lib/den-urls';

// The five relay stages — kept from the old room page as the education rail.
const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: Film, blurb: 'Marks the golden takes and sets the narrative spine — Hook, Setup, Core, Payoff, CTA — then pushes the first version for review.' },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: Scissors, blurb: 'Checks the version out to their own NLE, tightens every cut and layers B-roll, then pushes the picture back as a pull request.' },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: Mic2, blurb: 'Restores captured audio and scores the piece externally, then submits the pass for the Captain to approve.' },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: Palette, blurb: 'Grades and finishes in Resolve or After Effects, exports every format, and A/B-compares against the last version.' },
  { number: '05', role: 'Thumbnail Designer', studio: 'Cover art & titles', icon: Image, blurb: 'Picks the frame, writes the title, and ships the thumbnail — versioned and reviewed like every other stage.' },
];

function NewProjectModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const create = useCreateVideoProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim(), description: description.trim() || undefined, channelId } },
      {
        onSuccess: (project) => setLocation(channelProjectUrl(channelId, project.id)),
      },
    );
  };

  const error = create.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="modal-backdrop" onClick={create.isPending ? undefined : onClose}>
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <span className="project-modal-orbit"><span /><i /><b>C</b></span>
        <button type="button" className="modal-close" onClick={onClose} disabled={create.isPending} aria-label="Close"><X size={16} /></button>
        <div className="project-modal-heading">
          <span className="eyebrow">New locked project</span>
          <h2>A new repo <em>for footage.</em></h2>
          <p>Name the project, then drop your raw footage into the vault. Files are viewable by the team — downloadable by no one until the Captain releases the master.</p>
        </div>
        <form className="project-modal-fields" onSubmit={submit}>
          <div className="field">
            <span>Project name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name — e.g. Interview with Ada"
              maxLength={120}
              required
              autoFocus
              disabled={create.isPending}
              data-testid="input-video-project-name"
            />
          </div>
          <div className="field">
            <span>What are we making? (optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are we making?"
              maxLength={2000}
              rows={3}
              disabled={create.isPending}
              data-testid="input-video-project-description"
            />
          </div>
          {create.isError && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }} role="alert">
              {error?.response?.data?.error || 'We could not open that project just yet.'}
            </p>
          )}
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="primary-btn modal-submit"
            data-testid="button-create-video-project"
          >
            {create.isPending ? 'Opening the project…' : 'Create project'}
            <ArrowRight size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

// The three-dot menu on each project card (visibility + delete, Captain only).
function CardMenu({ project, channelId }: { project: VideoProject; channelId: string }) {
  const queryClient = useQueryClient();
  const update = useUpdateVideoProjectVisibility();
  const remove = useDeleteVideoProject();
  const [confirming, setConfirming] = useState(false);
  const isPublic = project.visibility === 'PUBLIC';
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListChannelProjectsQueryKey(channelId) });
    queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
  };

  const toggleVisibility = () => {
    update.mutate(
      { projectId: project.id, data: { visibility: isPublic ? 'PRIVATE' : 'PUBLIC' } },
      { onSuccess: refresh },
    );
  };

  const confirmDelete = () => {
    remove.mutate(
      { projectId: project.id },
      { onSuccess: refresh, onSettled: () => setConfirming(false) },
    );
  };

  return (
    <>
      <div className="channel-card-menu-wrap" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="cd-card-delete" onClick={toggleVisibility} aria-label={isPublic ? 'Make private' : 'Make public'} title={isPublic ? 'Make private' : 'Make public'} data-testid={`menu-visibility-${project.id}`}>
          {isPublic ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button type="button" className="cd-card-delete" onClick={() => setConfirming(true)} aria-label="Delete project" title="Delete project" data-testid={`menu-delete-${project.id}`}>
          <Trash2 size={14} />
        </button>
      </div>
      {confirming && createPortal(
        <div className="modal-backdrop" onClick={remove.isPending ? undefined : () => setConfirming(false)} data-testid="modal-delete-project">
          <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setConfirming(false)} aria-label="Close" disabled={remove.isPending}><X size={16} /></button>
            <div className="project-modal-heading">
              <span className="eyebrow">Delete project</span>
              <h2>Delete “{project.name}” <em>for good?</em></h2>
              <p>This removes the project, its members, vault assets, versions, and activity. It cannot be undone.</p>
            </div>
            <div className="project-modal-fields" style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary-btn" onClick={() => setConfirming(false)} disabled={remove.isPending}>Cancel</button>
              <button type="button" className="primary-btn" onClick={confirmDelete} disabled={remove.isPending} style={{ background: 'hsl(var(--destructive))', borderColor: 'hsl(var(--destructive))' }} data-testid="button-confirm-delete-project">
                <Trash2 size={14} /> {remove.isPending ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// One project card: its live avatar stack (who is actively working on this
// project right now, from the channel presence roster) + Captain actions.
function ProjectCard({ project, channelId, activeByProject, isCaptain }: {
  project: VideoProject;
  channelId: string;
  activeByProject: Map<string, Array<{ userId: string; name: string; imageUrl?: string }>>;
  isCaptain: boolean;
}) {
  const isPublic = project.visibility === 'PUBLIC';
  const active = activeByProject.get(project.id) ?? [];
  return (
    <div className={`cd-card cd-card-project ${isPublic ? 'is-public' : 'is-private'}`} data-testid={`card-video-project-${project.id}`}>
      <Link href={channelProjectUrl(channelId, project.id)} className="cd-card-hit" aria-label={`Open ${project.name}`} data-testid={`link-open-project-${project.id}`} />
      <div className="cd-card-thumb" aria-hidden>
        <Film size={26} />
        <span className="cd-card-badge">{project.status.replaceAll('_', ' ')}</span>
        <span className={`eye-indicator ${isPublic ? 'is-open' : 'is-closed'}`} title={isPublic ? 'Public' : 'Private'}>
          {isPublic ? <Eye size={13} /> : <EyeOff size={13} />}
          {isPublic ? 'Public' : 'Private'}
        </span>
        {isCaptain && <CardMenu project={project} channelId={channelId} />}
        {active.length > 0 && (
          <span className="card-live-stack" data-testid={`card-active-${project.id}`}>
            {active.map((member) => (
              <span key={member.userId} className="card-live-avatar" title={`${member.name || 'Teammate'} is working on this project now`}>
                {member.imageUrl ? <img src={member.imageUrl} alt="" /> : <span>{member.name?.slice(0, 1) || '?'}</span>}
                <i aria-hidden />
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="cd-card-body">
        <span className="cd-card-title">{project.name}</span>
        <span className="cd-card-meta">{new Date(project.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export default function ChannelHomePage() {
  const { channelId } = useParams<{ channelId: string }>();
  const { user } = useUser();
  const channel = useGetChannel(channelId);
  const projects = useListChannelProjects(channelId);
  const people = useListChannelPeople(channelId);
  const roster = useChannelPresence(channelId);
  const [modalOpen, setModalOpen] = useState(false);
  const firstName = user?.firstName || user?.username || 'maker';

  const data = channel.data;
  const isOwner = data?.myRole === 'OWNER';
  const recent = projects.data ?? [];
  const featured = recent[0] ?? null;
  const displayName = data?.youtubeTitle || data?.name || 'Channel';

  // presence roster → per-project stacks for the carousel + live dots on the
  // contributor strip. Entries with projectId null are on the home itself.
  const activeByProject = new Map<string, Array<{ userId: string; name: string; imageUrl?: string }>>();
  const activeUserIds = new Set<string>();
  for (const entry of roster) {
    if (entry.userId === user?.id) continue;
    activeUserIds.add(entry.userId);
    if (!entry.projectId) continue;
    const member = (people.data ?? []).find((p) => p.userId === entry.userId);
    const stack = activeByProject.get(entry.projectId) ?? [];
    stack.push({ userId: entry.userId, name: entry.name || member?.name || 'Teammate', imageUrl: member?.imageUrl ?? undefined });
    activeByProject.set(entry.projectId, stack);
  }
  const channelPeople = people.data ?? [];
  const editorCount = data?.editorCount ?? channelPeople.length;

  return (
    <div className="page">
      <div className="cd-billboard mb-6" data-testid="channel-billboard">
        {data?.youtubeBannerUrl && <img className="cd-billboard-media" src={data.youtubeBannerUrl} alt="" aria-hidden />}
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow>
            {isOwner ? 'Your channel' : 'You’re an editor on'} · {data?.youtubeConnected ? 'linked to YouTube' : 'not linked to YouTube yet'}
          </SectionEyebrow>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="channel-hero-logo" aria-hidden>
              {(data?.youtubeAvatarUrl && <img src={data.youtubeAvatarUrl} alt="" />) || displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>{displayName}</span>
          </h1>
          <p>
            {isOwner
              ? 'This channel’s den — every project runs from studio to release here, with the people on it and, once linked, the analytics of everything you publish.'
              : 'You were added to projects on this channel — they live here, alongside the people working on them.'}
          </p>
          <div className="cd-billboard-actions">
            <button type="button" className="cd-actionbtn is-primary" onClick={() => setModalOpen(true)} data-testid="button-new-project">
              <Clapperboard size={15} /> New project
            </button>
            <Link href={`/channels/${channelId}/analytics`} className="cd-actionbtn" data-testid="link-channel-analytics">
              <BarChart3 size={15} /> Analytics
            </Link>
            {featured && (
              <Link href={channelProjectUrl(channelId, featured.id)} className="cd-actionbtn" data-testid="link-continue-project">
                Continue “{featured.name}” <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* GitHub-contributors-style roster: everyone on the channel, with a live
          dot when they are currently present on a project here. */}
      <div className="paper-card mb-6" data-testid="channel-roster">
        <div className="inline-heading">
          <span className="eyebrow"><Users size={13} /> On this channel</span>
          <span className="mono-label">{editorCount} {editorCount === 1 ? 'person' : 'people'}</span>
        </div>
        {channelPeople.length > 0 ? (
          <div className="roster-strip" data-testid="roster-strip">
            {channelPeople.map((person) => {
              const active = activeUserIds.has(person.userId);
              const label = [person.name, ...person.projectRoles].filter(Boolean).join(' · ');
              return (
                <Link
                  key={person.userId}
                  href={`/profile/${person.userId}`}
                  className={`roster-avatar ${active ? 'is-active' : ''}`}
                  title={label || 'Channel member'}
                  data-testid={`roster-${person.userId}`}
                >
                  {person.imageUrl ? <img src={person.imageUrl} alt="" /> : <span>{person.name?.slice(0, 1) || person.userId.slice(0, 1).toUpperCase()}</span>}
                  {active && <i aria-label="Currently on this channel" />}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="den-footnote mt-2">No one else is on this channel yet — invite editors from inside a project.</p>
        )}
      </div>

      <div className="cd-rail">
        <div className="cd-rail-head">
          <h3>Continue where you left off</h3>
          {recent.length > 0 && <span className="mono-label">{recent.length} project{recent.length === 1 ? '' : 's'}</span>}
        </div>
        {projects.isLoading ? (
          <div className="panel-empty">Opening your projects…</div>
        ) : projects.isError ? (
          <p className="setting-copy" style={{ color: 'hsl(var(--foreground))' }}>This channel’s projects could not be opened. Try again in a moment.</p>
        ) : recent.length > 0 ? (
          <div className="cd-rail-track">
            {recent.map((project) => (
              <ProjectCard key={project.id} project={project} channelId={channelId} activeByProject={activeByProject} isCaptain={project.ownerId === user?.id} />
            ))}
            {isOwner && (
              <button type="button" className="cd-card cd-card-add" onClick={() => setModalOpen(true)} data-testid="card-new-project">
                <Clapperboard size={22} />
                <span>New project</span>
              </button>
            )}
          </div>
        ) : (
          <div className="empty-state" data-testid="empty-projects">
            <Clapperboard size={22} />
            <h3>{isOwner ? 'No projects in this channel yet.' : 'Nothing added you to yet.'}</h3>
            <p>
              {isOwner
                ? 'Create the first project, drop in raw footage, and the relay can begin — selects, cut, sound, finish, thumbnail.'
                : 'When the Captain adds you to a project on this channel, it appears here.'}
            </p>
            {isOwner && (
              <button type="button" className="primary-btn mt-3" onClick={() => setModalOpen(true)}>
                <Clapperboard size={14} /> New project
              </button>
            )}
          </div>
        )}
      </div>

      <div className="cd-rail mt-8">
        <div className="cd-rail-head">
          <h3>The five stages</h3>
          <span className="mono-label">01 — 05</span>
        </div>
        <div className="cd-rail-grid">
          {LEGS.map((leg) => {
            const Icon = leg.icon;
            return (
              <div key={leg.number} className="paper-card" data-testid={`card-leg-${leg.number}`}>
                <div className="inline-heading">
                  <span className="eyebrow"><Icon size={13} style={{ color: 'hsl(var(--accent))' }} /> {leg.role}</span>
                  <span className="mono-label">{leg.number} / 05</span>
                </div>
                <p className="setting-copy mt-2">{leg.blurb}</p>
                <p className="den-footnote mt-3">{leg.studio}</p>
              </div>
            );
          })}
        </div>
      </div>

      {modalOpen && <NewProjectModal channelId={channelId} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
