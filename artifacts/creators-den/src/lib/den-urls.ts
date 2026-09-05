import { useLocation } from 'wouter';

// ---------------------------------------------------------------------------
// Creator Den URL helpers (multi-channel restructure).
//
// Canonical routes:
//   /                                   — the CMS channel grid
//   /channels/:channelId                — a channel's home (the den for it)
//   /channels/:channelId/analytics      — channel analytics
//   /channels/:channelId/projects/:projectId/… — every project page, nested
//   /profile /explore /notifications    — den-level surfaces
//   /projects/:projectId/…              — legacy flat links (old notification
//                                        rows + public read-only previews);
//                                        members bounce one hop into their
//                                        channel URL, public viewers stay.
// ---------------------------------------------------------------------------

const CHANNEL_RE = /^\/channels\/([^/]+)/;
const CHANNEL_PROJECT_RE = /^\/channels\/([^/]+)\/projects\/([^/]+)/;
const FLAT_PROJECT_RE = /^\/projects\/([^/]+)/;

export type DenRouteMode = 'cms' | 'channel' | 'channel-project' | 'flat-project' | 'other';

export interface DenRouteInfo {
  mode: DenRouteMode;
  channelId?: string;
  projectId?: string;
}

/** Parses a creators-den path into its route context (pure, testable). */
export function denRouteInfo(path: string): DenRouteInfo {
  const channelProject = path.match(CHANNEL_PROJECT_RE);
  if (channelProject) {
    return { mode: 'channel-project', channelId: channelProject[1], projectId: channelProject[2] };
  }
  const channel = path.match(CHANNEL_RE);
  if (channel) {
    return { mode: 'channel', channelId: channel[1] };
  }
  const flatProject = path.match(FLAT_PROJECT_RE);
  if (flatProject) {
    return { mode: 'flat-project', projectId: flatProject[1] };
  }
  if (path === '/' || path === '') return { mode: 'cms' };
  return { mode: 'other' };
}

/** The project base for the current location (channel-scoped when inside one). */
export function useProjectBase(): string {
  const [location] = useLocation();
  const info = denRouteInfo(location);
  return info.channelId
    ? `/channels/${info.channelId}/projects`
    : '/projects';
}

/** Channel-scoped project URL (canonical member link). */
export function channelProjectUrl(channelId: string, projectId: string, rest = ''): string {
  return `/channels/${channelId}/projects/${projectId}${rest}`;
}

/** Navigable project link that keeps the current channel context when present. */
export function projectUrl(
  channelId: string | null | undefined,
  projectId: string,
  rest = '',
): string {
  return channelId
    ? channelProjectUrl(channelId, projectId, rest)
    : `/projects/${projectId}${rest}`;
}
