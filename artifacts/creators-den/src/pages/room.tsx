import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  MoreHorizontal,
  Palette,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListVideoNotificationsQueryKey,
  getListVideoProjectsQueryKey,
  useCreateVideoProject,
  useDeleteVideoProject,
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

function DeleteProjectModal({ project, deleting, onCancel, onConfirm }: { project: VideoProject; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" onClick={deleting ? undefined : onCancel} data-testid="modal-delete-project">
      <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Close" disabled={deleting}><X size={16} /></button>
        <div className="project-modal-heading">
          <span className="eyebrow">Delete project</span>
          <h2>Delete “{project.name}” <em>for good?</em></h2>
          <p>This removes the project, its members, vault assets, versions, and activity — it will disappear from your profile and explore. The files on disk stay put in case another project shares them. This cannot be undone.</p>
        </div>
        <div className="project-modal-fields" style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={deleting} data-testid="button-cancel-delete">
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={onConfirm}
            disabled={deleting}
            style={{ background: 'hsl(var(--destructive))', borderColor: 'hsl(var(--destructive))' }}
            data-testid="button-confirm-delete-project"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The three-dot menu on each project card — the single place to change
// visibility (public ↔ private) or delete the project. Captain only. The
// dropdown and the delete modal render through a portal so the card's
// overflow:hidden and hover transform can't clip or trap them (which caused
// the page glitch).
function CardMenu({ project }: { project: VideoProject }) {
  const queryClient = useQueryClient();
  const update = useUpdateVideoProjectVisibility();
  const remove = useDeleteVideoProject();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isPublic = project.visibility === 'PUBLIC';

  const openMenu = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    setMenuPos(rect ? { top: rect.bottom + 6, left: rect.right } : null);
    setOpen(true);
  };
  const closeMenu = () => setOpen(false);

  // Dismiss on outside click, Escape, or any scroll/resize (the cards sit in a
  // scrollable rail, so the menu just closes instead of trying to follow it).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onViewportChange = () => closeMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const toggleVisibility = () => {
    update.mutate(
      { projectId: project.id, data: { visibility: isPublic ? 'PRIVATE' : 'PUBLIC' } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
          closeMenu();
        },
      },
    );
  };

  const confirmDelete = () => {
    remove.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
          closeMenu();
          setConfirming(false);
        },
      },
    );
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="card-menu-btn"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project menu for ${project.name}`}
        data-testid={`card-menu-${project.id}`}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="card-menu"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          data-testid={`card-menu-popup-${project.id}`}
        >
          <button type="button" role="menuitem" onClick={toggleVisibility} disabled={update.isPending} data-testid={`menu-visibility-${project.id}`}>
            {isPublic ? <EyeOff size={14} /> : <Eye size={14} />}
            {isPublic ? 'Make private' : 'Make public'}
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { closeMenu(); setConfirming(true); }} data-testid={`menu-delete-${project.id}`}>
            <Trash2 size={14} />
            Delete project
          </button>
        </div>,
        document.body,
      )}
      {confirming && createPortal(
        <DeleteProjectModal
          project={project}
          deleting={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmDelete}
        />,
        document.body,
      )}
    </>
  );
}

function ProjectCard({ project, isCaptain }: { project: VideoProject; isCaptain: boolean }) {
  const isPublic = project.visibility === 'PUBLIC';

  return (
    <div className={`cd-card cd-card-project ${isPublic ? 'is-public' : 'is-private'}`} data-testid={`card-video-project-${project.id}`}>
      {/* Stretched link — the whole card opens the project; controls sit above it. */}
      <Link href={`/projects/${project.id}`} className="cd-card-hit" aria-label={`Open ${project.name}`} data-testid={`link-open-project-${project.id}`} />
      <div className="cd-card-thumb" aria-hidden>
        <Film size={26} />
        <span className="cd-card-badge">{project.status.replaceAll('_', ' ')}</span>
        <span className={`eye-indicator ${isPublic ? 'is-open' : 'is-closed'}`} title={isPublic ? 'Public — visible on your profile' : 'Private — hidden from your profile'}>
          <span className="eye-toggle-icon" key={isPublic ? 'open' : 'closed'}>
            {isPublic ? <Eye size={13} /> : <EyeOff size={13} />}
          </span>
          {isPublic ? 'Public' : 'Private'}
        </span>
      </div>
      <div className="cd-card-body">
        <div className="cd-card-title-row">
          <span className="cd-card-title">{project.name}</span>
          {isCaptain && <CardMenu project={project} />}
        </div>
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
