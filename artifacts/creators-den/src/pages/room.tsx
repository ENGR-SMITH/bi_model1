import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  Image,
  LockKeyhole,
  Mic2,
  Palette,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoNotificationsQueryKey,
  getListVideoProjectsQueryKey,
  useCreateVideoProject,
  useListVideoNotifications,
  useListVideoProjects,
  useMarkVideoNotificationRead,
  useUpdateVideoProjectVisibility,
} from '@workspace/api-client-react';
import type { VideoProject } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useRealtimeNotifications } from '@/lib/realtime';

// The five relay stages, framed as an external-first version-control pipeline:
// each role checks a version out to their own editor and pushes it back for review.
const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: Film, blurb: 'Marks the golden takes and sets the narrative spine — Hook, Setup, Core, Payoff, CTA — then pushes the first version for review.' },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: Scissors, blurb: 'Checks the version out to their own NLE, tightens every cut and layers B-roll, then pushes the picture back as a pull request.' },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: Mic2, blurb: 'Restores captured audio and scores the piece externally, then submits the pass for the Captain to approve.' },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: Palette, blurb: 'Grades and finishes in Resolve or After Effects, exports every format, and A/B-compares against the last version.' },
  { number: '05', role: 'Thumbnail Designer', studio: 'Cover art & titles', icon: Image, blurb: 'Picks the frame, writes the title, and ships the thumbnail — versioned and reviewed like every other stage.' },
];

function NotificationsPanel() {
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

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const create = useCreateVideoProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim(), description: description.trim() || undefined } },
      {
        onSuccess: (project) => setLocation(`/projects/${project.id}`),
      },
    );
  };

  const error = create.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <span className="project-modal-orbit"><span /><i /><b>C</b></span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
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
              data-testid="input-video-project-description"
            />
          </div>
          {create.isError && (
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--destructive))' }} role="alert">
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

function ProjectCard({ project, isCaptain }: { project: VideoProject; isCaptain: boolean }) {
  const queryClient = useQueryClient();
  const update = useUpdateVideoProjectVisibility();
  const isPublic = project.visibility === 'PUBLIC';

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isCaptain || update.isPending) return;
    update.mutate(
      { projectId: project.id, data: { visibility: isPublic ? 'PRIVATE' : 'PUBLIC' } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
        },
      },
    );
  };

  const toggleTitle = isCaptain
    ? isPublic
      ? 'Public — visible on your profile. Click to make private.'
      : 'Private — hidden from your profile. Click to make public.'
    : 'Only the Captain can change visibility';

  return (
    <div className={`cd-card cd-card-project ${isPublic ? 'is-public' : 'is-private'}`} data-testid={`card-video-project-${project.id}`}>
      {/* Stretched link — the whole card opens the project; the eye toggle sits above it. */}
      <Link href={`/projects/${project.id}`} className="cd-card-hit" aria-label={`Open ${project.name}`} data-testid={`link-open-project-${project.id}`} />
      <div className="cd-card-thumb" aria-hidden>
        <Film size={26} />
        <span className="cd-card-badge">{project.status.replaceAll('_', ' ')}</span>
      </div>
      <button
        type="button"
        className={`eye-toggle ${isPublic ? 'is-open' : 'is-closed'}`}
        onClick={toggle}
        disabled={!isCaptain || update.isPending}
        title={toggleTitle}
        aria-pressed={isPublic}
        data-testid={`eye-toggle-${project.id}`}
      >
        <span className="eye-toggle-icon" key={isPublic ? 'open' : 'closed'}>
          {isPublic ? <Eye size={14} /> : <EyeOff size={14} />}
        </span>
        <span className="eye-toggle-label">{isPublic ? 'Public' : 'Private'}</span>
      </button>
      <div className="cd-card-body" aria-hidden>
        <span className="cd-card-title">{project.name}</span>
        <span className="cd-card-meta">
          {new Date(project.createdAt).toLocaleDateString()}
          {project.description ? ` · ${project.description}` : ''}
        </span>
      </div>
    </div>
  );
}

export default function ContentCreatorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';
  const projects = useListVideoProjects();
  const [modalOpen, setModalOpen] = useState(false);

  const recent = projects.data ?? [];
  const featured = recent[0] ?? null;

  return (
    <div className="page">
      <div className="cd-billboard mb-6" data-testid="room-billboard">
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow>Welcome in, {name}</SectionEyebrow>
          <h1>Version control for video.</h1>
          <p>
            Drop raw footage into a locked vault, hand each role its stage, and move the picture down the
            relay — selects, cut, sound, finish, thumbnail — reviewing, comparing, and approving every
            version until the Captain releases the master.
          </p>
          <div className="cd-billboard-actions">
            <button type="button" className="cd-actionbtn is-primary" onClick={() => setModalOpen(true)} data-testid="button-new-project">
              <Clapperboard size={15} /> New project
            </button>
            {featured && (
              <Link href={`/projects/${featured.id}`} className="cd-actionbtn" data-testid="link-continue-project">
                Continue “{featured.name}” <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="cd-rail">
        <div className="cd-rail-head">
          <h3>Continue where you left off</h3>
          {recent.length > 0 && <span className="mono-label">{recent.length} project{recent.length === 1 ? '' : 's'}</span>}
        </div>
        {projects.isLoading ? (
          <div className="panel-empty">Opening your projects…</div>
        ) : projects.isError ? (
          <p className="setting-copy" style={{ color: 'hsl(var(--destructive))' }}>The vault could not be opened. Try again in a moment.</p>
        ) : recent.length > 0 ? (
          <div className="cd-rail-track">
            {recent.map((project) => (
              <ProjectCard key={project.id} project={project} isCaptain={project.ownerId === user?.id} />
            ))}
            <button type="button" className="cd-card cd-card-add" onClick={() => setModalOpen(true)} data-testid="card-new-project">
              <Clapperboard size={22} />
              <span>New project</span>
            </button>
          </div>
        ) : (
          <div className="empty-state" data-testid="empty-projects">
            <Clapperboard size={22} />
            <h3>No projects yet.</h3>
            <p>Create your first project, drop in the raw footage, and the relay can begin — selects, cut, sound, finish, thumbnail.</p>
            <button type="button" className="primary-btn mt-3" onClick={() => setModalOpen(true)}>
              <Clapperboard size={14} /> New project
            </button>
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
                <p className="den-footnote mt-3"><ArrowUpRight size={12} /> {leg.studio}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <NotificationsPanel />
      </div>

      <div className="paper-card accent-card mt-6" data-testid="panel-the-lock">
        <div className="inline-heading">
          <span className="eyebrow"><LockKeyhole size={13} /> The lock</span>
        </div>
        <div className="den-stack mt-1">
          <div className="list-row">
            <span className="world-symbol"><LockKeyhole size={13} /></span>
            <span><b>Private by design</b><small>Raw files never leave the vault — no one downloads until the Captain releases the master.</small></span>
          </div>
          <div className="list-row">
            <span className="world-symbol"><Film size={13} /></span>
            <span><b>Stream, don&apos;t ship</b><small>Proxies stream in-browser and transcripts stay searchable, while the locked originals never move.</small></span>
          </div>
          <div className="list-row">
            <span className="world-symbol"><Sparkles size={13} /></span>
            <span><b>Edit outside, review inside</b><small>Every role checks out to their own editor and gets a role-aware AI advisor — the browser reviews, compares, and approves.</small></span>
          </div>
        </div>
      </div>

      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
