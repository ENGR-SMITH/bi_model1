import type { WriterArenaRole } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Writers' Audition Arena — shared labels for the Author Den UI.
//
// The API owns the canonical role list (lib/db/src/schema/author-arena.ts); this
// mirrors the labels so the frontend never imports the server package.
// ---------------------------------------------------------------------------

export const WRITER_ROLES: WriterArenaRole[] = [
  "CO_WRITER",
  "EDITOR",
  "BETA_READER",
  "GHOSTWRITER",
  "PROOFREADER",
];

export const WRITER_ROLE_LABELS: Record<WriterArenaRole, string> = {
  CO_WRITER: "Co-writer",
  EDITOR: "Editor",
  BETA_READER: "Beta reader",
  GHOSTWRITER: "Ghostwriter",
  PROOFREADER: "Proofreader",
};

export function writerRoleLabel(role: string | null | undefined): string {
  if (!role) return "Pitch board";
  return WRITER_ROLE_LABELS[role as WriterArenaRole] ?? role;
}

/** Audition lifecycle labels. `DRAFT` is a fork that has not been submitted yet. */
export function auditionStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "SUBMITTED":
      return "In review";
    case "UNDER_REVIEW":
      return "In review";
    case "ACCEPTED_PENDING_CONTRACT":
      return "Accepted";
    case "ACCEPTED":
      return "Accepted";
    case "DECLINED":
      return "Declined";
    case "WITHDRAWN":
      return "Withdrawn";
    default:
      return status.replaceAll("_", " ").toLowerCase();
  }
}

export function auditionStatusTone(status: string): "muted" | "accent" | "teal" | "gold" | "danger" {
  switch (status) {
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return "gold";
    case "ACCEPTED_PENDING_CONTRACT":
    case "ACCEPTED":
      return "teal";
    case "DECLINED":
      return "danger";
    case "WITHDRAWN":
      return "muted";
    default:
      return "muted";
  }
}

/** An audition that can still be withdrawn (unresolved). */
export function isOpenAudition(status: string): boolean {
  return ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED_PENDING_CONTRACT"].includes(status);
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Best-effort message from a react-query/axios-style error. */
export function apiErrorText(error: unknown, fallback: string): string {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string } | null;
  return candidate?.response?.data?.error || candidate?.message || fallback;
}
