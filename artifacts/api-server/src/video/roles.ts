// The vault asset kinds each role owns — the single source of truth for the
// download grants (video-finish) and the upload role gate (video.ts). Mirrors
// the web app's ROLE_KINDS map in creators-den src/lib/roles.ts so a file's
// kind always maps to the same owning role everywhere.
export const ROLE_KINDS: Record<string, string[]> = {
  VIDEO: ["RAW_VIDEO", "SCREEN_REC", "B_ROLL", "REFERENCE"],
  AUDIO: ["RAW_AUDIO", "VO_PICKUP"],
  THUMBNAIL: ["THUMBNAIL_DESIGN", "GRAPHIC"],
  // Scripts live in the browser (the script desk), not the vault — the SCRIPT
  // role owns no physical files today, so its grants unlock nothing until
  // script files exist.
  SCRIPT: [],
};

export const ROLE_LABELS: Record<string, string> = {
  CAPTAIN: "Captain",
  VIDEO: "Video",
  AUDIO: "Audio",
  SCRIPT: "Script",
  THUMBNAIL: "Thumbnail",
  UPLOADER: "Uploader",
  VIEWER: "Viewer",
};

/** The owning role of a vault asset kind, or null when no role owns it. */
export function roleForKind(kind: string): string | null {
  for (const [role, kinds] of Object.entries(ROLE_KINDS)) {
    if (kinds.includes(kind)) return role;
  }
  return null;
}

// Roles that may add any vault kind: the Captain owns the project, and the
// Uploader role exists to move files into any rail on the Captain's behalf.
const UNRESTRICTED_UPLOAD_ROLES = ["CAPTAIN", "UPLOADER"];

// The Script desk uploads audio/video into the vault so it can be transcribed
// (a raw copy the desk turns into a script) — that flow is the one place a
// member legitimately adds media their role doesn't own.
const SCRIPT_TRANSCRIBE_KINDS = ["RAW_VIDEO", "RAW_AUDIO"];

/**
 * Whether a member holding `roles` may add an asset of `kind` to the vault.
 *
 * Rule: an uploader must hold the role that owns the kind (VIDEO footage,
 * AUDIO sound, THUMBNAIL images). The Captain/Uploader are unrestricted, and
 * a SCRIPT member may add raw audio/video for transcription.
 */
export function rolesAllowUpload(roles: string[] | null | undefined, kind: string): boolean {
  const held = roles ?? [];
  if (held.some((role) => UNRESTRICTED_UPLOAD_ROLES.includes(role))) return true;
  const owner = roleForKind(kind);
  if (owner && held.includes(owner)) return true;
  if (held.includes("SCRIPT") && SCRIPT_TRANSCRIBE_KINDS.includes(kind)) return true;
  return false;
}

/** Human-readable reason an upload of `kind` is blocked for `roles`, or null
 * when the upload is allowed. */
export function uploadBlockReason(roles: string[] | null | undefined, kind: string): string | null {
  if (rolesAllowUpload(roles, kind)) return null;
  const held = (roles ?? []).filter(Boolean);
  const owner = roleForKind(kind);
  const ownerLabel = owner ? (ROLE_LABELS[owner] ?? owner) : kind;
  const mine = held.length > 0 ? held.map((role) => ROLE_LABELS[role] ?? role).join(", ") : "Viewer";
  return `Only ${ownerLabel} members can upload ${kind} files to this project's vault — your roles here are ${mine}.`;
}
