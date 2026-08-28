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

/** Human labels for a member's roles, joined for a tooltip. */
export function rolesLabel(roles: string[] | null | undefined): string {
  if (!roles || roles.length === 0) return 'Viewer';
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(', ');
}
