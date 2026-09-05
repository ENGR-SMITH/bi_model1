import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Check, Link2 } from 'lucide-react';
import {
  getListArenaWatchesQueryKey,
  useCreateArenaWatch,
  useDeleteArenaWatch,
  useListArenaWatches,
} from '@workspace/api-client-react';
import type { ArenaRole, ArenaWatch } from '@workspace/api-client-react';
import { ARENA_ROLE_META } from '@/components/arena-apply-modal';

// ---------------------------------------------------------------------------
// Arena role watches + share.
//
// A watch is (role) with an optional channel scope: `channelId: null` watches
// the role across the whole Arena; a `channelId` watches it on one channel
// only. The server fans out a `video_arena_watch` notification whenever a new
// post matches a watch (poster excluded). Coexistence is allowed — a user can
// hold the global and the scoped watch on the same role at once.
//
//   ArenaGlobalWatchBell  — small bell inside a board role chip; toggles the
//                           GLOBAL watch for that role.
//   ArenaRoleWatchMenu    — post-page control; toggles the global and/or the
//                           "this channel only" watch for the post's role.
//   SharePostButton       — copies the full public post link.
// ---------------------------------------------------------------------------

const FULL_BASE = '/creators-den/arena';

export function shareUrlForPost(postId: string): string {
  if (typeof window === 'undefined') return `${FULL_BASE}/posts/${postId}`;
  return `${window.location.origin}${FULL_BASE}/posts/${postId}`;
}

/** Loads the caller's watches and exposes per-role/per-channel helpers. */
function useArenaWatches() {
  const queryClient = useQueryClient();
  const watchesQuery = useListArenaWatches();
  const watches = (watchesQuery.data ?? []) as ArenaWatch[];
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListArenaWatchesQueryKey() });
  }, [queryClient]);

  const createWatch = useCreateArenaWatch({ mutation: { onSuccess: refresh } });
  const deleteWatch = useDeleteArenaWatch({ mutation: { onSuccess: refresh } });

  return {
    loading: watchesQuery.isLoading,
    watches,
    busy: createWatch.isPending || deleteWatch.isPending,
    // -- lookups ------------------------------------------------------------
    globalWatchFor(role: ArenaRole) {
      return watches.find((watch) => watch.role === role && watch.channelId === null);
    },
    scopedWatchFor(role: ArenaRole, channelId: string) {
      return watches.find((watch) => watch.role === role && watch.channelId === channelId);
    },
    // -- mutations -----------------------------------------------------------
    toggleGlobal(role: ArenaRole) {
      const existing = watches.find((watch) => watch.role === role && watch.channelId === null);
      if (existing) deleteWatch.mutate({ watchId: existing.id });
      else createWatch.mutate({ data: { role } });
    },
    toggleScoped(role: ArenaRole, channelId: string) {
      const existing = watches.find(
        (watch) => watch.role === role && watch.channelId === channelId,
      );
      if (existing) deleteWatch.mutate({ watchId: existing.id });
      else createWatch.mutate({ data: { role, channelId } });
    },
  };
}

/** Board role-chip bell — toggles watching `role` across the whole Arena. */
export function ArenaGlobalWatchBell({ role, dataTestId }: { role: ArenaRole; dataTestId?: string }) {
  const { globalWatchFor, busy, toggleGlobal } = useArenaWatches();
  const active = Boolean(globalWatchFor(role));
  const label = `Notify me when a new ${ARENA_ROLE_META[role].roleLabel.toLowerCase()} audition opens anywhere`;

  return (
    <button
      type="button"
      className={`arena-watch-bell ${active ? 'is-watching' : ''}`}
      onClick={() => toggleGlobal(role)}
      disabled={busy}
      aria-pressed={active}
      aria-label={active ? `Stop watching ${ARENA_ROLE_META[role].label} auditions` : label}
      title={active ? `Watching ${ARENA_ROLE_META[role].label} auditions — click to stop` : label}
      data-testid={dataTestId ?? `watch-bell-${role.toLowerCase()}`}
    >
      {active ? <BellRing size={13} /> : <Bell size={13} />}
    </button>
  );
}

/**
 * Post-page watch control — a compact two-row chooser:
 *   [✓] Every channel          (global watch)
 *   [✓] Only on {channelName}  (scoped watch)
 * Both rows reflect the caller's real watches and can coexist.
 */
export function ArenaRoleWatchMenu({
  role,
  channelId,
  channelName,
  dataTestId,
}: {
  role: ArenaRole;
  channelId: string;
  channelName: string;
  dataTestId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { globalWatchFor, scopedWatchFor, busy, toggleGlobal, toggleScoped } = useArenaWatches();
  const meta = ARENA_ROLE_META[role];
  const global = Boolean(globalWatchFor(role));
  const scoped = Boolean(scopedWatchFor(role, channelId));
  const anyWatch = global || scoped;

  return (
    <div className="arena-watch-menu" data-testid={dataTestId}>
      <button
        type="button"
        className={`secondary-btn arena-watch-menu-toggle ${anyWatch ? 'is-watching' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-pressed={anyWatch}
        data-testid="button-arena-watch"
      >
        {anyWatch ? <BellRing size={14} /> : <Bell size={14} />}
        {anyWatch ? 'Watching' : `Watch ${meta.label} auditions`}
      </button>
      {open && (
        <div className="arena-watch-options" role="group" aria-label="Watch scope">
          <p className="arena-watch-options-caption">
            We’ll notify you when a new {meta.label.toLowerCase()} audition opens.
          </p>
          <button
            type="button"
            className={global ? 'checked' : ''}
            onClick={() => toggleGlobal(role)}
            disabled={busy}
            data-testid="watch-scope-global"
          >
            <span className="arena-watch-check">{global && <Check size={11} />}</span>
            <span>
              <b>Every channel</b>
              <small>Any {meta.label.toLowerCase()} audition on the Arena</small>
            </span>
          </button>
          <button
            type="button"
            className={scoped ? 'checked' : ''}
            onClick={() => toggleScoped(role, channelId)}
            disabled={busy}
            data-testid="watch-scope-channel"
          >
            <span className="arena-watch-check">{scoped && <Check size={11} />}</span>
            <span>
              <b>{channelName} only</b>
              <small>{meta.label} auditions on this channel</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Copies the post's public link (with a short "copied" confirmation). */
export function SharePostButton({ postId }: { postId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrlForPost(postId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be unavailable (permissions/iframe) — stay quiet.
    }
  };

  return (
    <button
      type="button"
      className="secondary-btn"
      onClick={() => void copy()}
      data-testid="button-arena-share"
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />}
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
