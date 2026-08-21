import { useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import {
  ArrowUpRight,
  Clapperboard,
  DoorOpen,
  Film,
  Image,
  LogOut,
  Mic2,
  Palette,
  Scissors,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useListVideoProjects } from '@workspace/api-client-react';
import { useProjectPresence, useRealtimeSocket } from '@/lib/realtime';

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export const RELAY_LEGS = [
  { slug: 'selects', leg: 'SELECTS', number: '01', label: 'Selects', role: 'Story Architect', icon: Film },
  { slug: 'cut', leg: 'CUT', number: '02', label: 'Cut', role: 'Visual Editor', icon: Scissors },
  { slug: 'sound', leg: 'SOUND', number: '03', label: 'Sound', role: 'Sound Designer', icon: Mic2 },
  { slug: 'finish', leg: 'FINISH', number: '04', label: 'Finish', role: 'Motion & Color', icon: Palette },
  { slug: 'thumbnail', leg: 'THUMBNAIL', number: '05', label: 'Thumbnail', role: 'Thumbnail Designer', icon: Image },
] as const;

function UserChip({ compact }: { compact?: boolean }) {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'Maker';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || name.slice(0, 2);
  return (
    <div className="flex items-center gap-2.5" data-testid="user-chip">
      <span className="avatar" aria-hidden>{initials}</span>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block max-w-40 truncate text-xs font-bold text-[hsl(var(--foreground))]" data-testid="text-user-name">{name}</span>
          <span className="block max-w-40 truncate text-[10px] text-[hsl(var(--muted-foreground))]">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
        </span>
      )}
    </div>
  );
}

function PresenceStrip({ projectId }: { projectId: string }) {
  const { user } = useUser();
  const socket = useRealtimeSocket();
  const roster = useProjectPresence(projectId);
  const others = roster.filter((entry) => entry.userId !== user?.id);

  if (!socket || others.length === 0) return null;

  return (
    <div className="den-presence" data-testid="presence-strip">
      <span className="den-presence-dot" />
      <span>
        <b>{others.length}</b> {others.length === 1 ? 'teammate' : 'teammates'} in the room
      </span>
      {others.map((entry) => (
        <span key={entry.userId} className="inline-flex items-center gap-1.5" data-testid={`presence-${entry.userId}`}>
          {entry.name || 'Teammate'}
          {entry.leg && (
            <span className="den-tag accent">{RELAY_LEGS.find((l) => l.leg === entry.leg)?.label ?? entry.leg}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function WorkspaceMenu({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const projects = useListVideoProjects();
  const [location] = useLocation();
  const match = location.match(/^\/projects\/([^/]+)/);
  const currentId = match?.[1];

  return (
    <div className="workspace-menu" data-testid="workspace-menu">
      <span className="menu-caption">Your rooms</span>
      {(projects.data ?? []).map((project) => {
        const selected = project.id === currentId;
        return (
          <button
            key={project.id}
            type="button"
            className={selected ? 'selected' : ''}
            onClick={() => {
              setLocation(`/projects/${project.id}`);
              onClose();
            }}
            data-testid={`workspace-project-${project.id}`}
          >
            <span className="menu-project-mark">{project.name.slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{project.name}</b>
              <small>{project.status.replaceAll('_', ' ')}</small>
            </span>
            <Check size={14} />
          </button>
        );
      })}
      <button
        type="button"
        className="menu-new"
        onClick={() => {
          setLocation('/');
          onClose();
        }}
      >
        <Clapperboard size={15} />
        <span>
          <b>The room — new project</b>
          <small>Start a locked room</small>
        </span>
      </button>
    </div>
  );
}

function Sidebar({ projectId, onClose, open }: { projectId: string | null; onClose: () => void; open?: boolean }) {
  const { signOut } = useClerk();
  const [location] = useLocation();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const projects = useListVideoProjects();
  const current = projects.data?.find((p) => p.id === projectId);

  const logout = () => signOut({ redirectUrl: '/' });

  const navItem = (href: string, label: string, icon: ReactNode, active: boolean, extra?: ReactNode) => (
    <Link
      href={href}
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClose}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {icon}
      <span>{label}</span>
      {extra}
    </Link>
  );

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} data-testid="den-sidebar">
      <div className="brand-row">
        <span className="brand-mark">C</span>
        <span className="brand-copy">
          <span className="block brand-name">Creators Den</span>
          <span className="block brand-sub">the video room</span>
        </span>
        <button type="button" className="icon-btn sidebar-close mobile-only" aria-label="Close navigation" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="workspace-switch-wrap">
        <button
          type="button"
          className={`workspace-switch ${workspaceOpen ? 'open' : ''}`}
          onClick={() => setWorkspaceOpen((open) => !open)}
          data-testid="workspace-switch"
        >
          <span className="workspace-icon"><Clapperboard size={14} /></span>
          <span className="workspace-copy">
            <small>Workspace</small>
            <strong className="truncate">{current?.name ?? 'The room'}</strong>
          </span>
          <ChevronDown size={14} />
        </button>
        {workspaceOpen && <WorkspaceMenu onClose={() => setWorkspaceOpen(false)} />}
      </div>

      <nav aria-label="Creators Den">
        <span className="nav-label">Studio</span>
        {navItem('/', 'The room', <DoorOpen size={16} />, location === '/')}
        {projectId && navItem(`/projects/${projectId}`, 'The vault', <Film size={16} />, location === `/projects/${projectId}`)}
        {projectId && (
          <>
            <span className="nav-label nav-label-spaced">The relay</span>
            {RELAY_LEGS.map((leg) => {
              const Icon = leg.icon;
              const href = `/projects/${projectId}/${leg.slug}`;
              const active = location === href;
              return (
                <Link
                  key={leg.leg}
                  href={href}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={onClose}
                  data-testid={`nav-leg-${leg.slug}`}
                >
                  <Icon size={16} />
                  <span>{leg.role}</span>
                  <span className="nav-count">{leg.number}</span>
                </Link>
              );
            })}
          </>
        )}
        <span className="nav-label nav-label-spaced">Tandem</span>
        {navItem('/dashboard', 'Back to the atrium', <ArrowUpRight size={16} />, false)}
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="tutorial-btn" onClick={logout} data-testid="button-creators-logout">
          <LogOut size={14} />
          <span>Leave the room</span>
        </button>
        <UserChip compact />
      </div>
    </aside>
  );
}

export function CreatorsShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [topWorkspaceOpen, setTopWorkspaceOpen] = useState(false);
  const projects = useListVideoProjects();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1];
  const current = projects.data?.find((p) => p.id === projectId);

  return (
    <div className="app-shell">
      <Sidebar projectId={projectId ?? null} onClose={() => setMobileNav(false)} open={mobileNav} />
      {mobileNav && <div className="modal-backdrop mobile-only" style={{ zIndex: 15 }} onClick={() => setMobileNav(false)} />}
      <main className="main-stage">
        <header className="topbar">
          <button className="icon-btn mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="top-workspace-wrap" onPointerLeave={() => setTopWorkspaceOpen(false)}>
            <button className="top-workspace" onClick={() => setTopWorkspaceOpen((open) => !open)} data-testid="top-workspace">
              <span>Workspace</span>
              <ChevronDown size={13} />
              <b className="truncate">{current?.name ?? 'The room'}</b>
            </button>
            {topWorkspaceOpen && <WorkspaceMenu onClose={() => setTopWorkspaceOpen(false)} />}
          </div>
          <div className="top-actions">
            <Link href="/dashboard" className="link-btn" data-testid="link-back-atrium">
              <ArrowUpRight size={14} />
              Back to the atrium
            </Link>
            <UserChip />
          </div>
        </header>
        {projectId && <PresenceStrip projectId={projectId} />}
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
