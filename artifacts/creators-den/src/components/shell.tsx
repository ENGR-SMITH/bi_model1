import { useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import {
  Activity,
  Clapperboard,
  Compass,
  Film,
  Image,
  LogOut,
  Mic2,
  Palette,
  Scissors,
  ChevronDown,
  Check,
  UserRound,
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
        <b>{others.length}</b> {others.length === 1 ? 'teammate' : 'teammates'} on this project
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
      <span className="menu-caption">Your projects</span>
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
          <b>New project</b>
          <small>Start a new locked project</small>
        </span>
      </button>
    </div>
  );
}

export function CreatorsShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const [location] = useLocation();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const projects = useListVideoProjects();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1];
  const current = projects.data?.find((p) => p.id === projectId);

  const logout = () => signOut({ redirectUrl: '/' });

  // A primary section tab. The active tab (not a breadcrumb) conveys location.
  const tab = (href: string, label: string, icon: ReactNode, testId: string) => (
    <Link
      href={href}
      className={`cd-tab ${location === href ? 'active' : ''}`}
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="app-shell">
      <header className="cd-topnav" data-testid="den-topnav">
        {/* Tier 1 — chrome: brand · workspace · account */}
        <div className="cd-topnav-chrome">
          <Link href="/" className="cd-brand" data-testid="nav-home">
            <span className="brand-mark">C</span>
            <span className="brand-copy">
              <span className="block brand-name">Creators Den</span>
              <span className="block brand-sub">video version control</span>
            </span>
          </Link>

          <div className="top-workspace-wrap" onPointerLeave={() => setWorkspaceOpen(false)}>
            <button
              type="button"
              className="top-workspace"
              onClick={() => setWorkspaceOpen((open) => !open)}
              data-testid="top-workspace"
            >
              <span>Workspace</span>
              <b className="truncate">{current?.name ?? 'Home'}</b>
              <ChevronDown size={13} />
            </button>
            {workspaceOpen && <WorkspaceMenu onClose={() => setWorkspaceOpen(false)} />}
          </div>

          <Link href="/explore" className="cd-explore-link" data-testid="nav-explore">
            <Compass size={14} />
            <span>Explore</span>
          </Link>

          <div className="cd-topnav-account">
            <Link href="/profile" className="cd-profile" data-testid="nav-profile">
              <UserRound size={14} />
              <span>Profile</span>
            </Link>
            <button type="button" className="cd-signout" onClick={logout} data-testid="button-creators-logout">
              <LogOut size={14} />
              <span>Sign out</span>
            </button>
            <UserChip />
          </div>
        </div>

        {/* Tier 2 — tabs: sections + the five-stage relay (only inside a project) */}
        {projectId && (
          <nav className="cd-topnav-tabs" aria-label="Project sections" data-testid="den-tabs">
            <div className="cd-tab-group">
              {tab(`/projects/${projectId}`, 'Vault', <Film size={15} />, 'nav-project')}
              {tab(`/projects/${projectId}/activity`, 'Timeline', <Activity size={15} />, 'nav-activity')}
            </div>
            <span className="cd-tab-divider" aria-hidden />
            <div className="cd-tab-group cd-tab-stages">
              {RELAY_LEGS.map((leg) => {
                const href = `/projects/${projectId}/${leg.slug}`;
                return (
                  <Link
                    key={leg.leg}
                    href={href}
                    title={leg.role}
                    className={`cd-tab ${location === href ? 'active' : ''}`}
                    data-testid={`nav-leg-${leg.slug}`}
                  >
                    <span className="cd-tab-num">{leg.number}</span>
                    <span>{leg.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
      </header>

      <main className="main-stage">
        {projectId && <PresenceStrip projectId={projectId} />}
        {/* Each page component supplies its own `.page` container; the shell
            must not add a second one or the content gets doubled padding. */}
        {children}
      </main>
    </div>
  );
}
