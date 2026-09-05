import { useRef, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  Clapperboard,
  Eye,
  Film,
  GitPullRequest,
  Globe,
  Home,
  Image,
  LayoutGrid,
  LogOut,
  Mic2,
  Package,
  Palette,
  Search,
  Scissors,
  Video,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetChannelQueryKey,
  getGetVideoProjectQueryKey,
  getListExploreCreatorsQueryKey,
  getListExploreProjectsQueryKey,
  getListVideoNotificationsQueryKey,
  getListVideoReviewQueueQueryKey,
  useGetChannel,
  useGetVideoProject,
  useListChannels,
  useListExploreCreators,
  useListExploreProjects,
  useListVideoNotifications,
  useListVideoProjects,
  useListVideoReviewQueue,
  type ChannelSummary,
} from '@workspace/api-client-react';
import { useChannelPresence, useProjectPresence, useRealtimeNotifications, useRealtimeSocket } from '@/lib/realtime';
import { ProjectChat } from '@/components/project-chat';
import { denRouteInfo, projectUrl } from '@/lib/den-urls';
import { matchesCreatorQuery, matchesProjectQuery } from '@/lib/explore-search';

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export const RELAY_LEGS = [
  {
    slug: 'selects', leg: 'SELECTS', number: '01', label: 'Selects', role: 'Video', icon: Film,
    hint: 'Selects — the first video pass: pick the golden takes from the raw footage and lay out the rough narrative (Hook → Setup → Core → Payoff → CTA).',
  },
  {
    slug: 'cut', leg: 'CUT', number: '02', label: 'Cut', role: 'Video', icon: Scissors,
    hint: 'Cut — the second video pass: trim the selected takes into the finished edit — camera switches, B-roll placement, pacing — up to picture lock.',
  },
  {
    slug: 'sound', leg: 'SOUND', number: '03', label: 'Sound', role: 'Audio', icon: Mic2,
    hint: 'Sound — the audio pass: clean the captured sound, place the music, duck it under speech, and schedule pickup voiceover.',
  },
  {
    slug: 'finish', leg: 'FINISH', number: '04', label: 'Finish', role: 'Captain', icon: Palette,
    hint: 'Finish — the Captain\'s stage: colour and motion, captions, exports, and releasing the lock so downloads open.',
  },
  {
    slug: 'thumbnail', leg: 'THUMBNAIL', number: '05', label: 'Thumbnail', role: 'Thumbnail', icon: Image,
    hint: 'Thumbnail — the cover pass: pick the frame or design, title text, and style that pops at small sizes.',
  },
] as const;

/** Hover hint for a relay stage (what Selects / Cut / … mean). */
export function legHint(leg: string): string | undefined {
  return RELAY_LEGS.find((relay) => relay.leg === leg)?.hint;
}

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

function ChannelRow({ channel, selected, onOpen }: { channel: ChannelSummary; selected: boolean; onOpen: () => void }) {
  const name = channel.youtubeTitle || channel.name;
  return (
    <button
      type="button"
      className={selected ? 'selected' : ''}
      onClick={onOpen}
      data-testid={`workspace-channel-${channel.id}`}
    >
      <span className="menu-project-mark">
        {channel.youtubeAvatarUrl ? <img src={channel.youtubeAvatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
      </span>
      <span>
        <b>{name}</b>
        <small>{channel.myRole === 'OWNER' ? 'Your channel' : 'You’re an editor'} · {channel.projectCount} project{channel.projectCount === 1 ? '' : 's'}</small>
      </span>
      {selected && <Check size={14} />}
    </button>
  );
}

// The channel dropdown: every channel on the CMS grid, plus the grid itself.
// Selecting one jumps into that channel's den.
function ChannelMenu({ channelId }: { channelId?: string }) {
  const [, setLocation] = useLocation();
  const channels = useListChannels();
  return (
    <div className="workspace-menu" data-testid="channel-menu">
      <button
        type="button"
        className="menu-home"
        onClick={() => setLocation('/')}
        data-testid="workspace-cms"
      >
        <LayoutGrid size={15} />
        <span>
          <b>All channels</b>
          <small>Back to the MCNs grid</small>
        </span>
      </button>
      {(channels.data ?? []).map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          selected={channel.id === channelId}
          onOpen={() => setLocation(`/channels/${channel.id}`)}
        />
      ))}
    </div>
  );
}

// The project dropdown: ONLY the projects inside the currently selected
// channel (the den context's channel home; the CMS has no channel selected).
function ProjectMenu({ channelId, projectId }: { channelId?: string; projectId?: string }) {
  const [, setLocation] = useLocation();
  const projects = useListVideoProjects(channelId ? { channelId } : undefined);
  const list = projects.data ?? [];

  if (!channelId) {
    return (
      <div className="workspace-menu" data-testid="project-menu">
        <span className="menu-empty-caption">Open a channel to see its projects.</span>
      </div>
    );
  }

  return (
    <div className="workspace-menu" data-testid="project-menu">
      {list.map((project) => {
        const selected = project.id === projectId;
        return (
          <button
            key={project.id}
            type="button"
            className={selected ? 'selected' : ''}
            onClick={() => setLocation(projectUrl(project.channelId, project.id))}
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
      {list.length === 0 && <span className="menu-empty-caption">No projects here yet.</span>}
    </div>
  );
}

// A long, always-visible search field in the centre of the top bar. Typing
// opens a LIVE results dropdown (matching creators + public projects, fetched
// on first keystroke); Enter or the telescope still opens the full Explore
// results page.
function ExploreSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const searching = query.trim().length > 0;

  const creators = useListExploreCreators({ query: { queryKey: getListExploreCreatorsQueryKey(), enabled: searching } });
  const projects = useListExploreProjects({ query: { queryKey: getListExploreProjectsQueryKey(), enabled: searching } });

  const creatorHits = searching ? (creators.data ?? []).filter((c) => matchesCreatorQuery(c, query)).slice(0, 5) : [];
  const projectHits = searching ? (projects.data ?? []).filter((p) => matchesProjectQuery(p, query)).slice(0, 4) : [];
  // Wait for both explore lists to resolve so a loading flicker never shows
  // a premature “no results”.
  const showDrop = open && searching && creators.isSuccess && projects.isSuccess;

  const go = (href: string) => {
    setQuery('');
    setOpen(false);
    setLocation(href);
  };

  const submit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const q = query.trim();
    go(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
  };

  return (
    <div className="cd-explore-search">
      <div className="cd-explore-search-wrap">
        <form className="cd-explore-search-box" role="search" onSubmit={submit} data-testid="nav-explore">
          <button type="submit" className="cd-explore-search-icon" aria-label="Search the den" data-testid="nav-explore-toggle">
            <Search size={15} />
          </button>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Let a click on a suggestion land before the dropdown closes.
              blurTimer.current = window.setTimeout(() => setOpen(false), 140);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
            placeholder="Search creators and projects…"
            aria-label="Search creators and projects"
            data-testid="nav-explore-input"
          />
        </form>
        {showDrop && (
          <div className="cd-search-drop" onMouseDown={(event) => event.preventDefault()} data-testid="nav-explore-drop">
            {creatorHits.length === 0 && projectHits.length === 0 ? (
              <p className="cd-search-drop-empty">No creators or projects match “{query.trim()}”.</p>
            ) : (
              <>
                {creatorHits.length > 0 && (
                  <div className="cd-search-drop-group">
                    <p className="cd-search-drop-label">Creators</p>
                    {creatorHits.map((creator) => (
                      <button
                        type="button"
                        key={creator.userId}
                        className="cd-search-drop-item"
                        onClick={() => go(`/profile/${creator.userId}`)}
                        data-testid={`nav-search-creator-${creator.userId}`}
                      >
                        <span className="cd-search-drop-avatar" aria-hidden>
                          {creator.imageUrl ? <img src={creator.imageUrl} alt="" /> : creator.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <b>{creator.displayName}</b>
                          <small>{creator.publicProjectCount} public project{creator.publicProjectCount === 1 ? '' : 's'}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {projectHits.length > 0 && (
                  <div className="cd-search-drop-group">
                    <p className="cd-search-drop-label">Projects</p>
                    {projectHits.map((project) => (
                      <button
                        type="button"
                        key={project.id}
                        className="cd-search-drop-item"
                        onClick={() => go(`/projects/${project.id}`)}
                        data-testid={`nav-search-project-${project.id}`}
                      >
                        <span className="cd-search-drop-avatar" aria-hidden>
                          {project.ownerImageUrl ? <img src={project.ownerImageUrl} alt="" /> : project.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <b>{project.name}</b>
                          <small>{project.ownerName} · public</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" className="cd-search-drop-all" onClick={() => submit()} data-testid="nav-explore-drop-all">
                  See all results on Explore <ArrowRight size={12} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CreatorsShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [location] = useLocation();
  const [channelOpen, setChannelOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const info = denRouteInfo(location);

  const channelId = info.mode === 'channel' || info.mode === 'channel-project' ? info.channelId : undefined;
  const projectId = info.mode === 'channel-project' || info.mode === 'flat-project' ? info.projectId : undefined;

  // The den chrome for the current space: which project list + channel chrome
  // to show depends on where we are (channel home, project inside a channel,
  // or a flat legacy/public project page).
  const projects = useListVideoProjects(channelId ? { channelId } : undefined);
  const channel = useGetChannel(channelId ?? '', {
    query: {
      queryKey: getGetChannelQueryKey(channelId ?? ''),
      enabled: Boolean(channelId),
    },
  });
  const channelData = channel.data;
  const channelLabel = channelData?.youtubeTitle || channelData?.name;
  const current = projects.data?.find((p) => p.id === projectId);

  // Live notifications: the bell badge counts unread; the socket keeps it fresh.
  useRealtimeNotifications();
  const notifications = useListVideoNotifications();
  const unreadCount = (notifications.data ?? []).filter((n) => !n.readAt).length;

  const isCaptain = (projects.data ?? []).some((p) => p.ownerId === user?.id);
  const reviewQueue = useListVideoReviewQueue({
    query: {
      queryKey: getListVideoReviewQueueQueryKey(),
      enabled: isCaptain,
    },
  });
  const pendingReviews = projectId
    ? (reviewQueue.data ?? []).filter((item) => item.projectId === projectId).length
    : (reviewQueue.data ?? []).length;

  // Read-only mode: a PUBLIC project opened by someone who is not a member.
  const detail = useGetVideoProject(projectId ?? '', {
    query: {
      queryKey: getGetVideoProjectQueryKey(projectId ?? ''),
      enabled: Boolean(projectId),
    },
  });
  const readOnly = Boolean(projectId) && Boolean(detail.data) && (detail.data?.myRoles?.length ?? 0) === 0;
  const projectLabel = current?.name ?? detail.data?.name ?? channelLabel ?? 'Home';
  // The brand reads "Creators Den" only on the MCNs grid; inside a channel it
  // shows the channel's name, and inside a project the project's name.
  const brandTitle = !channelId && !projectId ? 'Creators Den' : projectLabel;
  const brandSub = projectId
    ? (channelLabel ? `in ${channelLabel}` : 'channel project')
    : channelId
      ? (channelData?.myRole === 'OWNER' ? 'Your channel' : 'You’re an editor')
      : 'video version control';

  const logout = () => signOut({ redirectUrl: '/' });

  // Base for project links: channel-scoped when inside a channel, flat for
  // legacy/public pages so the workspace stays coherent either way.
  const base = channelId ? `/channels/${channelId}/projects/${projectId}` : `/projects/${projectId}`;
  const homeHref = channelId ? `/channels/${channelId}` : '/';

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
        {/* Tier 1 — chrome: brand · search · account. */}
        <div className="cd-topnav-chrome">
          <Link href={homeHref} className="cd-brand" data-testid="nav-home">
            {/* Inside a channel the frame carries that channel's profile image;
                the "C" mark is kept only where "Creators Den" is written. */}
            <span className={`brand-mark ${channelId && channelData?.youtubeAvatarUrl ? 'has-avatar' : ''}`} aria-hidden>
              {channelId && channelData?.youtubeAvatarUrl ? <img src={channelData.youtubeAvatarUrl} alt="" /> : 'C'}
            </span>
            <span className="brand-copy">
              <span className="block brand-name">{brandTitle}</span>
              <span className="block brand-sub truncate" title={brandSub}>{brandSub}</span>
            </span>
          </Link>

          {/* Channel analytics sits in the chrome row, right beside the name
              that is written here (the channel or project name). It is
              channel-scoped, so it only appears once a channel is selected. */}
          {channelId && (
            <Link
              href={`/channels/${channelId}/analytics`}
              className={`cd-topnav-analytics-chrome ${location === `/channels/${channelId}/analytics` || location.startsWith(`/channels/${channelId}/analytics/`) ? 'active' : ''}`}
              aria-label="Channel analytics"
              title="Channel analytics"
              data-testid="nav-analytics"
            >
              <BarChart3 size={14} />
              <span>Analytics</span>
            </Link>
          )}

          <ExploreSearch />

          <div className="cd-topnav-account">
            <span className="cd-topnav-bell-wrap">
              <Link href={projectId ? `${base}/notifications` : '/notifications'} className="cd-topnav-bell" aria-label="Notifications" title="Notifications" data-testid="nav-notifications">
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="cd-topnav-bell-badge" data-testid="nav-notifications-badge">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <span className="cd-topnav-bell-label">INBOX</span>
            </span>
            <UserChip />
          </div>
        </div>

        {/* Tier 2 — the notch chips + section tabs. */}
        <div className="cd-topnav-secondary">
          <div className="cd-topnav-workspace-col">
            {/* Globe icon in front of the Channel dropdown → the MCNs grid. */}
            <div className="cd-topnav-chip">
              <Link href="/" className="cd-topnav-home-notch" aria-label="All channels" title="All channels (MCNs grid)" data-testid="nav-mcn">
                <Globe size={15} />
              </Link>
            </div>
            {/* Channel dropdown — every channel, one click to its den. */}
            <div className="cd-topnav-chip">
              <div className="top-workspace-wrap" onPointerLeave={() => setChannelOpen(false)}>
                <button
                  type="button"
                  className="top-workspace"
                  onClick={() => {
                    setChannelOpen((open) => !open);
                    setProjectOpen(false);
                  }}
                  data-testid="top-channel"
                >
                  <span>Channel</span>
                  <b className="truncate">{channelLabel ?? 'All channels'}</b>
                  <ChevronDown size={13} />
                </button>
                {channelOpen && <ChannelMenu channelId={channelId} />}
              </div>
            </div>
            {/* Channel home + its project dropdown only make sense once a
                channel is selected — on the MCNs grid (no channel yet) they
                drop away and only the globe + Channel switcher remain. */}
            {channelId && (
              <>
                {/* A quiet gap between the channel dropdown and the home icon. */}
                <span className="cd-topnav-chip-gap" aria-hidden />
                {/* Home icon — on the near side of the project dropdown. */}
                <div className="cd-topnav-chip">
                  <Link href={homeHref} className="cd-topnav-home-notch" aria-label="Channel home" title="Channel home" data-testid="nav-home-notch">
                    <Home size={15} />
                  </Link>
                </div>
                {/* Project dropdown — projects of the currently selected channel only. */}
                <div className="cd-topnav-chip">
                  <div className="top-workspace-wrap" onPointerLeave={() => setProjectOpen(false)}>
                    <button
                      type="button"
                      className="top-workspace"
                      onClick={() => {
                        setProjectOpen((open) => !open);
                        setChannelOpen(false);
                      }}
                      data-testid="top-project"
                    >
                      <span>Project</span>
                      <b className="truncate">{current?.name ?? 'No project'}</b>
                      <ChevronDown size={13} />
                    </button>
                    {projectOpen && <ProjectMenu channelId={channelId} projectId={projectId} />}
                  </div>
                </div>
              </>
            )}
          </div>

          {projectId && (
            <nav className="cd-topnav-tabs" aria-label="Project sections">
              <div className="cd-tab-group">
                {!readOnly && tab(`${base}`, 'Vault', <Film size={15} />, 'nav-project')}
                {!readOnly && (
                  <Link href={`${base}/review`} className={`cd-tab ${location === `${base}/review` || location.startsWith(`${base}/review/`) ? 'active' : ''}`} data-testid="nav-review">
                    <GitPullRequest size={15} />
                    <span>Review</span>
                    {isCaptain && pendingReviews > 0 && (
                      <b className="cd-topnav-review-badge cd-nav-badge" data-testid="nav-review-badge">{pendingReviews}</b>
                    )}
                  </Link>
                )}
                {tab(`${base}/activity`, 'Timeline', <Activity size={15} />, 'nav-activity')}
                {tab(`${base}/preview`, 'Preview', <Clapperboard size={15} />, 'nav-preview', true)}
              </div>
              {readOnly ? (
                <span className="den-tag muted cd-readonly-tag" title="You are viewing a PUBLIC project read-only — only its preview and timeline are open to you.">
                  <Eye size={11} /> Read only
                </span>
              ) : (
                <>
                  <span className="cd-tab-divider" aria-hidden />
                  <div className="cd-tab-group cd-tab-stages">
                    {[
                      { href: `${base}/role/video`, number: '01', label: 'Video', icon: <Video size={15} />, testId: 'nav-role-video' },
                      { href: `${base}/role/audio`, number: '02', label: 'Audio', icon: <Mic2 size={15} />, testId: 'nav-role-audio' },
                      { href: `${base}/role/script`, number: '03', label: 'Script', icon: <Package size={15} />, testId: 'nav-role-script' },
                      { href: `${base}/role/thumbnail`, number: '04', label: 'Thumbnail', icon: <Image size={15} />, testId: 'nav-role-thumbnail' },
                      { href: `${base}/preview/finish`, number: '05', label: 'Finish', icon: <Palette size={15} />, testId: 'nav-role-finish' },
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
        {projectId && !readOnly && <PresenceStrip projectId={projectId} />}
        {children}
      </main>

      {projectId && !readOnly && <ProjectChat projectId={projectId} />}
    </div>
  );
}
