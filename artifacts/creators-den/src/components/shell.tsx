import { useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import {
  Activity,
  Bell,
  Check,
  ChevronDown,
  Clapperboard,
  Eye,
  FileText,
  Film,
  GitPullRequest,
  Home,
  Image,
  LogOut,
  Mic2,
  Package,
  Palette,
  Scissors,
  Search,
  Video,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetVideoProjectQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoReviewQueueQueryKey,
  useGetVideoProject,
  useListVideoNotifications,
  useListVideoProjects,
  useListVideoReviewQueue,
} from '@workspace/api-client-react';
import { useProjectPresence, useRealtimeNotifications, useRealtimeSocket } from '@/lib/realtime';
import { ProjectChat } from '@/components/project-chat';

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export const RELAY_LEGS = [
  { slug: 'selects', leg: 'SELECTS', number: '01', label: 'Selects', role: 'Video', icon: Film },
  { slug: 'cut', leg: 'CUT', number: '02', label: 'Cut', role: 'Video', icon: Scissors },
  { slug: 'sound', leg: 'SOUND', number: '03', label: 'Sound', role: 'Audio', icon: Mic2 },
  { slug: 'finish', leg: 'FINISH', number: '04', label: 'Finish', role: 'Captain', icon: Palette },
  { slug: 'thumbnail', leg: 'THUMBNAIL', number: '05', label: 'Thumbnail', role: 'Thumbnail', icon: Image },
] as const;

// The account tile IS the profile link: the user's real account image (or
// initials fallback), full name, and email. No separate "Profile" button.
function UserChip() {
  const { user } = useUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.username || 'Maker';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || name.slice(0, 2);
  return (
    <Link href="/profile" className="cd-account" data-testid="user-chip" aria-label={`Open ${name}'s profile`}>
      <span className="avatar" aria-hidden>
        {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : initials}
      </span>
      <span className="cd-account-meta">
        <span className="cd-account-name" data-testid="text-user-name">{name}</span>
        <span className="cd-account-email">{user?.primaryEmailAddress?.emailAddress || 'Tandem member'}</span>
      </span>
    </Link>
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
      <button
        type="button"
        className="menu-home"
        onClick={() => {
          setLocation('/');
          onClose();
        }}
        data-testid="workspace-home"
      >
        <Home size={15} />
        <span>
          <b>Home</b>
          <small>Back to the room</small>
        </span>
      </button>
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

// A long, always-visible search field in the centre of the top bar — the
// telescope icon lives inside it; submitting jumps to /explore?q=…
function ExploreSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    setLocation(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
    setQuery('');
  };

  return (
    <div className="cd-explore-search">
      <form className="cd-explore-search-box" role="search" onSubmit={submit} data-testid="nav-explore">
        <button type="submit" className="cd-explore-search-icon" aria-label="Search the den" data-testid="nav-explore-toggle">
          <Search size={15} />
        </button>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search creators and projects…"
          aria-label="Search creators and projects"
          data-testid="nav-explore-input"
        />
      </form>
    </div>
  );
}

export function CreatorsShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [location] = useLocation();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const projects = useListVideoProjects();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1];
  const current = projects.data?.find((p) => p.id === projectId);

  // Live notifications: the bell badge counts unread; the socket keeps it fresh.
  useRealtimeNotifications();
  const notifications = useListVideoNotifications();
  const unreadCount = (notifications.data ?? []).filter((n) => !n.readAt).length;

  // The Review desk is Captain-only: the queue scans owned projects, so the
  // chip only appears (and only fetches) when the user owns at least one.
  const isCaptain = (projects.data ?? []).some((p) => p.ownerId === user?.id);
  const reviewQueue = useListVideoReviewQueue({
    query: {
      queryKey: getListVideoReviewQueueQueryKey(),
      enabled: isCaptain,
    },
  });
  const pendingReviews = (reviewQueue.data ?? []).length;

  // Read-only mode: a PUBLIC project opened by someone who is not a member
  // (e.g. from a search result). The detail query carries the viewer's roles
  // — an empty `myRoles` means the viewer only gets PREVIEW + TIMELINE.
  const detail = useGetVideoProject(projectId ?? '', {
    query: {
      queryKey: getGetVideoProjectQueryKey(projectId ?? ''),
      enabled: Boolean(projectId),
    },
  });
  const readOnly = Boolean(projectId) && Boolean(detail.data) && (detail.data?.myRoles?.length ?? 0) === 0;
  const projectLabel = current?.name ?? detail.data?.name ?? 'Home';

  const logout = () => signOut({ redirectUrl: '/' });

  // A primary section tab. The active tab (not a breadcrumb) conveys location.
  // `matchPrefix` keeps the tab lit on its sub-pages (e.g. Preview → /preview/video).
  const tab = (href: string, label: string, icon: ReactNode, testId: string, matchPrefix = false) => {
    const active = matchPrefix ? location === href || location.startsWith(`${href}/`) : location === href;
    return (
      <Link
        href={href}
        className={`cd-tab ${active ? 'active' : ''}`}
        data-testid={testId}
      >
        {icon}
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className="app-shell">
      <header className="cd-topnav" data-testid="den-topnav">
        {/* Tier 1 — chrome: brand · search · account (the account tile is the profile). */}
        <div className="cd-topnav-chrome">
          <Link href="/" className="cd-brand" data-testid="nav-home">
            <span className="brand-mark">C</span>
            <span className="brand-copy">
              <span className="block brand-name">Creators Den</span>
              <span className="block brand-sub">video version control</span>
            </span>
          </Link>

          <ExploreSearch />

          <div className="cd-topnav-account">
            <Link href="/notifications" className="cd-topnav-bell" aria-label="Notifications" title="Notifications" data-testid="nav-notifications">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="cd-topnav-bell-badge" data-testid="nav-notifications-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
            <UserChip />
          </div>
        </div>

        {/* Tier 2 — three cut-out chips on one row: workspace · relay deck · sign out. */}
        <div className="cd-topnav-secondary">
          <div className="cd-topnav-workspace-col">
            {/* The home notch — a quiet chip with just the home icon, sitting
                beside the WORKSPACE dropdown. */}
            <div className="cd-topnav-chip">
              <Link href="/" className="cd-topnav-home-notch" aria-label="Home" title="Home" data-testid="nav-home-notch">
                <Home size={15} />
              </Link>
            </div>
            <div className="cd-topnav-chip">
              <div className="top-workspace-wrap" onPointerLeave={() => setWorkspaceOpen(false)}>
                <button
                  type="button"
                  className="top-workspace"
                  onClick={() => setWorkspaceOpen((open) => !open)}
                  data-testid="top-workspace"
                >
                  <span>Workspace</span>
                  <b className="truncate">{projectLabel}</b>
                  <ChevronDown size={13} />
                </button>
                {workspaceOpen && <WorkspaceMenu onClose={() => setWorkspaceOpen(false)} />}
              </div>
            </div>
            {/* The Review desk chip — Captain-only, with a pending-count badge. */}
            {isCaptain && (
              <div className="cd-topnav-chip">
                <Link href="/review" className="cd-topnav-review" title="Review submissions" data-testid="nav-review">
                  <GitPullRequest size={13} />
                  <span>Review</span>
                  {pendingReviews > 0 && (
                    <b className="cd-topnav-review-badge" data-testid="nav-review-badge">
                      {pendingReviews}
                    </b>
                  )}
                </Link>
              </div>
            )}
          </div>

          {projectId && (
            <nav className="cd-topnav-tabs" aria-label="Project sections">
              <div className="cd-tab-group">
                {/* A public (non-member) viewer only gets PREVIEW + TIMELINE. */}
                {!readOnly && tab(`/projects/${projectId}`, 'Vault', <Film size={15} />, 'nav-project')}
                {tab(`/projects/${projectId}/activity`, 'Timeline', <Activity size={15} />, 'nav-activity')}
                {tab(`/projects/${projectId}/preview`, 'Preview', <Clapperboard size={15} />, 'nav-preview', true)}
              </div>
              {readOnly ? (
                <span className="den-tag muted cd-readonly-tag" title="You are viewing a PUBLIC project read-only — only its preview and timeline are open to you.">
                  <Eye size={11} /> Read only
                </span>
              ) : (
                <>
                  <span className="cd-tab-divider" aria-hidden />
                  {/* The four studios sit on the relay rail (numbered, lit on hover /
                      active) — the removed Selects / Cut / Sound / Finish stages now
                      live here as Video / Audio / Script / Thumbnail. */}
                  <div className="cd-tab-group cd-tab-stages">
                    {[
                      { href: `/projects/${projectId}/role/video`, number: '01', label: 'Video', icon: <Video size={15} />, testId: 'nav-role-video' },
                      { href: `/projects/${projectId}/role/audio`, number: '02', label: 'Audio', icon: <Mic2 size={15} />, testId: 'nav-role-audio' },
                      { href: `/projects/${projectId}/role/script`, number: '03', label: 'Script', icon: <FileText size={15} />, testId: 'nav-role-script' },
                      { href: `/projects/${projectId}/role/thumbnail`, number: '04', label: 'Thumbnail', icon: <Image size={15} />, testId: 'nav-role-thumbnail' },
                      { href: `/projects/${projectId}/preview/finish`, number: '05', label: 'Finish', icon: <Package size={15} />, testId: 'nav-role-finish' },
                    ].map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        title={item.label}
                        className={`cd-tab ${location === item.href || location.startsWith(`${item.href}/`) ? 'active' : ''}`}
                        data-testid={item.testId}
                      >
                        <span className="cd-tab-num">{item.number}</span>
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </nav>
          )}

          <div className="cd-topnav-signout-col">
            <div className="cd-topnav-chip">
              <button type="button" className="cd-signout" onClick={logout} data-testid="button-creators-logout">
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="main-stage">
        {/* Presence + the crew room are team surfaces — hidden in read-only. */}
        {projectId && !readOnly && <PresenceStrip projectId={projectId} />}
        {/* Each page component supplies its own `.page` container; the shell
            must not add a second one or the content gets doubled padding. */}
        {children}
      </main>

      {/* The crew room floats over every project page, like the Author Den's
          draggable chat — project-wide instead of a private 1:1 thread. */}
      {projectId && !readOnly && <ProjectChat projectId={projectId} />}
    </div>
  );
}
