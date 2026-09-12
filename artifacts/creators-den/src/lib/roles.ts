// ---------------------------------------------------------------------------
// Creator Den roles — the four content roles that own the main studio pages.
// A member can hold several roles at once; the Captain holds CAPTAIN.
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<string, string> = {
  CAPTAIN: 'Captain',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  SCRIPT: 'Script',
  THUMBNAIL: 'Thumbnail',
  UPLOADER: 'Uploader',
  VIEWER: 'Viewer',
};

/** The four assignable content roles (the invite dropdown + role grants). */
export const CONTENT_ROLES = ['VIDEO', 'AUDIO', 'SCRIPT', 'THUMBNAIL'] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

/** The "All roles" sentinel used by download grants to cover every file. */
export const ALL_ROLES = 'ALL';

/** Roles a Captain can pick when granting downloads, including ALL. */
export const GRANT_ROLES = [...CONTENT_ROLES, ALL_ROLES] as const;

// The vault asset kinds each role owns — mirrors the server's ROLE_KINDS so
// the finish page can tell which grants unlock which file.
const ROLE_KINDS: Record<string, string[]> = {
  VIDEO: ['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE'],
  AUDIO: ['RAW_AUDIO', 'VO_PICKUP'],
  THUMBNAIL: ['THUMBNAIL_DESIGN', 'GRAPHIC'],
  SCRIPT: [],
};

/** The owning role of a vault asset kind, or null when no role owns it. */
export function roleForKind(kind: string): string | null {
  for (const [role, kinds] of Object.entries(ROLE_KINDS)) {
    if (kinds.includes(kind)) return role;
  }
  return null;
}

/** True when the viewer holds a role (or is the Captain, who holds all). */
export function hasRole(myRoles: string[] | null | undefined, role: string): boolean {
  if (!myRoles) return false;
  return myRoles.includes('CAPTAIN') || myRoles.includes(role);
}

export function isCaptain(myRoles: string[] | null | undefined): boolean {
  return myRoles?.includes('CAPTAIN') ?? false;
}

/**
 * A member's roles as the roster shows them.
 *
 * Video and Audio are the one craft on a crew list — an editor who also
 * handles the sound is one teammate, not two — so a member holding both reads
 * as a single "Video & Audio" entry instead of two tags sitting side by side.
 * Every other role stays its own entry.
 */
export function displayRoleEntries(
  roles: string[] | null | undefined,
): Array<{ key: string; label: string }> {
  const held = roles ?? [];
  if (held.length === 0) return [];
  const both = held.includes('VIDEO') && held.includes('AUDIO');
  return held
    .filter((role) => !(both && role === 'AUDIO'))
    .map((role) => {
      if (both && role === 'VIDEO') return { key: 'VIDEO_AUDIO', label: 'Video & Audio' };
      return { key: role, label: ROLE_LABELS[role] ?? role };
    });
}

/** Human labels for a member's roles, joined for a tooltip. */
export function rolesLabel(roles: string[] | null | undefined): string {
  const entries = displayRoleEntries(roles);
  if (entries.length === 0) return 'Viewer';
  return entries.map((entry) => entry.label).join(', ');
}
