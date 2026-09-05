// Shared metadata for den notifications shown in Tandem — used by both the
// /inbox Notices list and the live notification toasts so the two surfaces
// label each notice identically.
//
// World = which den wrote the notice:
//   * 'authors'  → Author Den / collaboration notifications
//   * 'creators' → Creators Den / video notifications

export type NoticeWorld = 'authors' | 'creators';

export interface NoticeKindMeta {
  /** Short human label for the notification category, e.g. "Approved". */
  label: string;
  /** Colour key — see TONE_TEXT below for the Tailwind classes. */
  tone: string;
}

export const AUTHORS_META: Record<string, NoticeKindMeta> = {
  continuation_submitted: { label: 'Submitted for review', tone: 'gold' },
  collaboration_message: { label: 'Message', tone: 'teal' },
  continuation_declined: { label: 'Archived', tone: 'danger' },
  respondent_accepted: { label: 'Accepted', tone: 'teal' },
  respondent_selected: { label: 'Selected', tone: 'teal' },
  contract_locked: { label: 'Contract locked', tone: 'accent' },
  contract_action_required: { label: 'Action required', tone: 'gold' },
  your_turn: { label: 'Your turn', tone: 'accent' },
  block_approved: { label: 'Approved', tone: 'teal' },
};

export const CREATORS_META: Record<string, NoticeKindMeta> = {
  video_invite: { label: 'Invite', tone: 'accent' },
  video_submission: { label: 'Submitted for review', tone: 'gold' },
  video_approved: { label: 'Approved', tone: 'teal' },
  video_rejected: { label: 'Needs another pass', tone: 'danger' },
  video_timeline_updated: { label: 'Timeline updated', tone: 'accent' },
  video_comment: { label: 'Annotation', tone: 'teal' },
  video_released: { label: 'Lock released', tone: 'teal' },
  video_grant: { label: 'Download access', tone: 'accent' },
  video_grant_revoked: { label: 'Access revoked', tone: 'danger' },
  // Arena (audition arena) categories — §9.4 of the Arena plan.
  video_arena_applied: { label: 'New audition', tone: 'gold' },
  video_arena_accepted: { label: 'Audition accepted', tone: 'teal' },
  video_arena_rejected: { label: 'Audition declined', tone: 'danger' },
  video_arena_closed: { label: 'Audition closed', tone: 'muted' },
  video_arena_withdrawn: { label: 'Audition withdrawn', tone: 'muted' },
  video_arena_watch: { label: 'Role alert', tone: 'accent' },
  video_arena_reviewed: { label: 'New work review', tone: 'teal' },
};

/** Tailwind chip classes per tone. */
export const TONE_TEXT: Record<string, string> = {
  accent: 'bg-[#3b82f6]/10 text-[#93c5fd]',
  teal: 'bg-[#34d399]/10 text-[#5eead4]',
  gold: 'bg-[#fbbf24]/10 text-[#fcd34d]',
  danger: 'bg-red-500/10 text-red-400',
  muted: 'bg-white/5 text-zinc-400',
};

/** Chip classes + plain label for the den the notice came from. */
export const WORLD_CHIP: Record<NoticeWorld, string> = {
  authors: 'bg-[#3b82f6]/10 text-[#93c5fd]',
  creators: 'bg-red-500/10 text-red-300',
};
export const WORLD_LABEL: Record<NoticeWorld, string> = {
  authors: 'Author Den',
  creators: 'Creators Den',
};

/** Label of the Open affordance, e.g. "View in Author Den". */
export function denPageCtaLabel(world: NoticeWorld): string {
  return world === 'creators' ? 'Creators Den inbox' : 'Author Den';
}

/**
 * Where the notice's full information lives: the den's own notifications
 * page. Author Den is a single-page studio, so its link opens the
 * notifications view via ?notifications=1.
 */
export function noticeDenPageHref(world: NoticeWorld): string {
  return world === 'creators' ? '/creators-den/notifications' : '/authors-den?notifications=1';
}

/** Human metadata for a category in a world, with a quiet fallback. */
export function metaFor(world: NoticeWorld, category: string): NoticeKindMeta {
  const table = world === 'creators' ? CREATORS_META : AUTHORS_META;
  return table[category] ?? { label: 'Update', tone: 'muted' };
}

/**
 * Resolve which den wrote a pushed notification. The server includes an
 * explicit `source`, but the category prefix is a reliable fallback for older
 * servers that predate it.
 */
export function worldFromPayload(payload: {
  source?: unknown;
  category?: unknown;
}): NoticeWorld {
  const source = typeof payload?.source === 'string' ? payload.source : '';
  if (source === 'creators') return 'creators';
  if (source === 'authors') return 'authors';
  const category = typeof payload?.category === 'string' ? payload.category : '';
  return category.startsWith('video_') || category === 'channel-analytics' ? 'creators' : 'authors';
}
