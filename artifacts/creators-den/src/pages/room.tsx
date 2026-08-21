import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Clapperboard,
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
  useCreateVideoProject,
  useListVideoNotifications,
  useListVideoProjects,
  useMarkVideoNotificationRead,
} from '@workspace/api-client-react';
import { useRealtimeNotifications } from '@/lib/realtime';

const LEGS = [
  { number: '01', role: 'Story Architect', studio: 'Selects & structure', icon: Film, blurb: 'Marks the golden takes and builds the narrative spine: Hook → Setup → Core → Payoff → CTA.' },
  { number: '02', role: 'Visual Editor', studio: 'Precision cutting', icon: Scissors, blurb: 'Tightens every cut, layers B-roll, syncs cameras, and locks the picture.' },
  { number: '03', role: 'Sound Designer', studio: 'Restore & score', icon: Mic2, blurb: 'Cleans captured audio, ducks music under speech, and repairs bad takes.' },
  { number: '04', role: 'Motion & Color', studio: 'Finish & polish', icon: Palette, blurb: 'Grades the footage into one look, burns captions, and exports every format.' },
  { number: '05', role: 'Thumbnail Designer', studio: 'Cover art & titles', icon: Image, blurb: 'Picks the frame, writes the title, and ships the thumbnail that earns the click.' },
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
          <span className="eyebrow">New locked room</span>
          <h2>A new room <em>for footage.</em></h2>
          <p>Name the project, then drop your raw footage into the vault. Files are viewable by the team — downloadable by no one.</p>
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
            <span>What are we cutting? (optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are we cutting?"
              maxLength={2000}
              rows={3}
              data-testid="input-video-project-description"
            />
          </div>
          {create.isError && (
            <p className="text-sm font-semibold text-[#a33d31]" role="alert">
              {error?.response?.data?.error || 'We could not open that room just yet.'}
            </p>
          )}
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="primary-btn modal-submit"
            data-testid="button-create-video-project"
          >
            {create.isPending ? 'Opening the room…' : 'Create project'}
            <ArrowRight size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ContentCreatorsPage() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';
  const projects = useListVideoProjects();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="home-page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE ROOM</b>
          <span>Five roles, one relay — selects, cut, sound, finish, thumbnail — working the same locked footage until the Captain releases it.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="home-hero">
        <div>
          <span className="eyebrow-line" /><span className="eyebrow">Welcome in, {name}</span>
          <h1>Your footage<br /><em>has a room.</em></h1>
          <p>
            Drop raw files into a locked vault, hand each role its studio, and relay the picture
            down the line — selects, cut, sound, finish, thumbnail — until the Captain releases the master.
          </p>
          <button type="button" className="hero-new-project" onClick={() => setModalOpen(true)} data-testid="button-new-project">
            <Clapperboard size={16} />
            New locked room
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="hero-orbit">
          <span className="orbit-center">C</span>
          <span className="orbit-ring ring-one" />
          <span className="orbit-ring ring-two" />
          <span className="orbit-word word-a">SELECTS</span>
          <span className="orbit-word word-b">SOUND</span>
          <span className="orbit-word word-c">FINISH</span>
        </div>
      </div>

      <div className="section-head">
        <div>
          <span className="eyebrow">The relay</span>
          <h2>Five roles, one locked picture</h2>
        </div>
        <span className="mono-label">01 — 05</span>
      </div>

      <div className="project-grid">
        {LEGS.map((leg) => {
          const Icon = leg.icon;
          return (
            <div key={leg.number} className="project-card" data-testid={`card-leg-${leg.number}`}>
              <div className="project-card-top">
                <span className="template-tag">{leg.studio}</span>
                <span className="mono-label">{leg.number} / 05</span>
              </div>
              <div className="project-open">
                <h3><Icon size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 7, color: 'hsl(var(--accent))' }} />{leg.role}</h3>
                <p>{leg.blurb}</p>
              </div>
              <div className="card-rule" />
              <div className="project-meta">
                <span><Sparkles size={11} /> direct manipulation + AI</span>
                <span>studio</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="home-lower">
        <div className="quick-start">
          <span className="eyebrow">Recent rooms</span>
          <h3>Your locked rooms</h3>
          <p>Every room is private by design — raw footage stays in the vault until the Captain approves the final master.</p>
          {projects.isLoading ? (
            <div className="panel-empty">Opening the vault…</div>
          ) : projects.isError ? (
            <p className="text-sm text-[#a33d31]">The vault could not be opened. Try again in a moment.</p>
          ) : projects.data && projects.data.length > 0 ? (
            <div className="den-stack">
              {projects.data.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="list-row"
                  data-testid={`card-video-project-${project.id}`}
                >
                  <span className="world-symbol"><Film size={13} /></span>
                  <span>
                    <b>{project.name}</b>
                    <small>{project.status.replaceAll('_', ' ')} · {new Date(project.createdAt).toLocaleDateString()}</small>
                    {project.description && <small>{project.description}</small>}
                  </span>
                  <ArrowUpRight size={14} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              No rooms yet — create your first project above, then drop in the raw footage and the relay can begin.
            </div>
          )}
        </div>

        <div className="portable">
          <span className="eyebrow">The lock</span>
          <div>
            <LockKeyhole size={14} />
            <span>Private by design — raw files never leave the server.</span>
          </div>
          <div>
            <Sparkles size={14} />
            <span>Every role gets direct-manipulation tools and a role-aware AI oracle.</span>
          </div>
          <div>
            <Film size={14} />
            <span>Proxies are streamed, transcripts are searchable, originals stay locked.</span>
          </div>
          <NotificationsPanel />
        </div>
      </div>

      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
