import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Bell, BookOpen, Check, Clock3, PenLine, Search, Send, Users } from "lucide-react";
import {
  getListWriterArenaPostsQueryKey,
  getListWriterArenaWatchesQueryKey,
  useCreateWriterArenaWatch,
  useDeleteWriterArenaWatch,
  useListWriterArenaPosts,
  useListWriterArenaWatches,
} from "@workspace/api-client-react";
import type { WriterArenaPostSummary, WriterArenaRole } from "@workspace/api-client-react";
import { WRITER_ROLES, WRITER_ROLE_LABELS, timeAgo, writerRoleLabel } from "@/lib/arena";

// ---------------------------------------------------------------------------
// The Writers' Audition Arena board — one page, two rails over the same seed
// model: Open Roles (kind=ROLE) and Seed Pitches (kind=SEED). A role card opens
// the call; a seed card opens the same frozen-brief detail the pitch board uses.
// ---------------------------------------------------------------------------

type Rail = "role" | "seed";
type Sort = "newest" | "most_applied";

function WriterAvatar({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (imageUrl) return <img src={imageUrl} alt="" className="den-author-avatar" />;
  return (
    <span className="den-author-avatar den-author-avatar-initial" aria-hidden>
      {(name || "A").slice(0, 1).toUpperCase()}
    </span>
  );
}

function RoleChip({
  role,
  active,
  watching,
  busy,
  count,
  onFilter,
  onToggleWatch,
}: {
  role: WriterArenaRole | "ALL";
  active: boolean;
  watching: boolean;
  busy: boolean;
  count: number;
  onFilter: () => void;
  onToggleWatch?: () => void;
}) {
  const label = role === "ALL" ? "All" : WRITER_ROLE_LABELS[role];
  return (
    <span className={`arena-chip ${active ? "active" : ""}`}>
      <button type="button" className="arena-chip-filter" onClick={onFilter} aria-pressed={active}>
        {label}
        <span className="leg-badge">{count}</span>
      </button>
      {onToggleWatch && (
        <button
          type="button"
          className={`arena-chip-bell ${watching ? "is-watching" : ""}`}
          onClick={onToggleWatch}
          disabled={busy}
          title={watching ? `Stop watching ${label} calls` : `Notify me about new ${label} calls`}
          aria-label={watching ? `Stop watching ${label} calls` : `Notify me about new ${label} calls`}
          data-testid={`watch-${role}`}
        >
          <Bell size={12} />
        </button>
      )}
    </span>
  );
}

function ArenaCard({ post, onOpen }: { post: WriterArenaPostSummary; onOpen: () => void }) {
  const applied = Boolean(post.myApplicationId);
  const open = post.availability === "OPEN" && !post.filledBy;
  return (
    <article className="arena-card" data-testid={`arena-card-${post.id}`}>
      <button type="button" className="arena-card-main" onClick={onOpen}>
        <span className="arena-card-topline">
          <WriterAvatar imageUrl={post.creatorImageUrl} name={post.creatorName} />
          <span className="min-w-0">
            <b className="truncate">{post.sourceProjectTitle}</b>
            <small className="truncate">by {post.creatorName}</small>
          </span>
          <span className={`den-tag ${post.kind === "ROLE" ? "accent" : "muted"}`}>
            {writerRoleLabel(post.role)}
          </span>
        </span>
        <p className="arena-card-pitch">{post.rolePitch || post.seedText}</p>
        <span className="arena-card-foot">
          <span className="arena-card-time">
            <Clock3 size={11} /> {timeAgo(post.publishedAt)}
          </span>
          {post.genre && <span className="arena-card-meta">{post.genre}</span>}
          <span className="arena-card-count">
            {post.filledBy ? (
              <>Filled</>
            ) : post.respondentCount === 0 ? (
              <>Be the first to audition</>
            ) : (
              <>
                <Users size={11} /> {post.respondentCount} auditioning
              </>
            )}
          </span>
        </span>
      </button>
      <span className={`arena-card-state ${applied ? "is-applied" : open ? "is-open" : ""}`}>
        {applied ? (
          <>
            <Check size={12} /> Audition sent
          </>
        ) : post.filledBy ? (
          "Role filled"
        ) : open ? (
          "Open now"
        ) : (
          "Closed"
        )}
      </span>
    </article>
  );
}

export function ArenaPage({
  hasProjects,
  initialRole = "ALL",
  onOpenPost,
  onOpenMine,
  onCallRole,
}: {
  hasProjects: boolean;
  /** The role chip to open on — set by the category page's seat cards (`?role=`). */
  initialRole?: WriterArenaRole | "ALL";
  onOpenPost: (seedId: string) => void;
  onOpenMine: () => void;
  onCallRole: () => void;
}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [rail, setRail] = useState<Rail>("role");
  const [roleFilter, setRoleFilter] = useState<WriterArenaRole | "ALL">(initialRole);
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");

  const posts = useListWriterArenaPosts({
    rail,
    role: rail === "role" && roleFilter !== "ALL" ? roleFilter : undefined,
    sort,
  });
  const allPosts = useListWriterArenaPosts({});
  const watches = useListWriterArenaWatches();
  const createWatch = useCreateWriterArenaWatch();
  const deleteWatch = useDeleteWriterArenaWatch();

  const refreshWatches = () => {
    void queryClient.invalidateQueries({ queryKey: getListWriterArenaWatchesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListWriterArenaPostsQueryKey() });
  };

  const globalWatchFor = (role: WriterArenaRole) =>
    (watches.data ?? []).find((watch) => watch.role === role && !watch.creatorId);

  const toggleWatch = (role: WriterArenaRole) => {
    const existing = globalWatchFor(role);
    if (existing) {
      deleteWatch.mutate({ watchId: existing.id }, { onSuccess: refreshWatches });
    } else {
      createWatch.mutate({ data: { role } }, { onSuccess: refreshWatches });
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = posts.data ?? [];
    if (!q) return list;
    return list.filter(
      (post) =>
        post.sourceProjectTitle.toLowerCase().includes(q) ||
        post.creatorName.toLowerCase().includes(q) ||
        post.seedText.toLowerCase().includes(q) ||
        (post.rolePitch ?? "").toLowerCase().includes(q),
    );
  }, [posts.data, query]);

  const counts = useMemo(() => {
    const all = allPosts.data ?? [];
    const role: Record<string, number> = { ALL: 0 };
    for (const r of WRITER_ROLES) role[r] = 0;
    let seeds = 0;
    for (const post of all) {
      if (post.kind === "ROLE" && post.role) role[post.role] = (role[post.role] ?? 0) + 1;
      if (post.kind === "SEED") seeds += 1;
    }
    role.ALL = all.filter((post) => post.kind === "ROLE").length;
    return { role, seeds };
  }, [allPosts.data]);

  return (
    <div className="page arena-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">THE WRITER&apos;S ROOM</div>
          <h1>Writers&apos; Audition Arena.</h1>
          <p>
            Open roles an author is calling for, and the frozen seeds already on the pitch board. Read the brief,
            audition, and let the work choose its second voice.
          </p>
        </div>
        <div className="arena-header-actions">
          <button type="button" className="secondary-btn" onClick={onOpenMine} data-testid="link-my-auditions">
            <PenLine size={15} /> My auditions
          </button>
          <button type="button" className="primary-btn" onClick={onCallRole} data-testid="button-call-role">
            <Send size={15} /> Call for a role
          </button>
        </div>
      </div>

      <div className="filter-tabs role-tabs" role="tablist" aria-label="Arena rails">
        <button
          type="button"
          className={rail === "role" ? "active" : ""}
          onClick={() => setRail("role")}
          role="tab"
          aria-selected={rail === "role"}
          data-testid="tab-open-roles"
        >
          Open roles <span className="leg-badge">{counts.role.ALL}</span>
        </button>
        <button
          type="button"
          className={rail === "seed" ? "active" : ""}
          onClick={() => setRail("seed")}
          role="tab"
          aria-selected={rail === "seed"}
          data-testid="tab-seed-pitches"
        >
          Seed pitches <span className="leg-badge">{counts.seeds}</span>
        </button>
      </div>

      <div className="arena-toolbar">
        <label className="search-field arena-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles, authors, or project titles…"
            data-testid="arena-search"
          />
        </label>
        <label className="arena-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} data-testid="arena-sort">
            <option value="newest">Newest</option>
            <option value="most_applied">Most auditions</option>
          </select>
        </label>
      </div>

      {rail === "role" && (
        <div className="arena-chips" role="tablist" aria-label="Writing roles">
          <RoleChip
            role="ALL"
            active={roleFilter === "ALL"}
            watching={false}
            busy={false}
            count={counts.role.ALL}
            onFilter={() => setRoleFilter("ALL")}
          />
          {WRITER_ROLES.map((role) => (
            <RoleChip
              key={role}
              role={role}
              active={roleFilter === role}
              watching={Boolean(globalWatchFor(role))}
              busy={createWatch.isPending || deleteWatch.isPending}
              count={counts.role[role] ?? 0}
              onFilter={() => setRoleFilter(role)}
              onToggleWatch={() => toggleWatch(role)}
            />
          ))}
        </div>
      )}

      {!user ? (
        <div className="panel-empty">Sign in to audition for a role.</div>
      ) : posts.isLoading ? (
        <div className="panel-empty">Opening the arena…</div>
      ) : posts.isError ? (
        <div className="empty-state">
          <BookOpen size={22} />
          <h3>The arena could not be opened.</h3>
          <p>Check your connection and try again.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="arena-empty">
          {rail === "role" ? <Send size={22} /> : <BookOpen size={22} />}
          <h3>{rail === "role" ? "No open calls match this filter." : "No seeds on the board right now."}</h3>
          <p>
            {rail === "role"
              ? hasProjects
                ? "Call for a role from one of your projects and other writers can audition for it."
                : "Create a project first, then call for the role you need."
              : "Published seeds appear here the moment an author posts one."}
          </p>
          {rail === "role" && (
            <button type="button" className="primary-btn" onClick={onCallRole}>
              <Send size={15} /> Call for a role
            </button>
          )}
        </div>
      ) : (
        <div className="arena-grid" data-testid="arena-grid">
          {rows.map((post) => (
            <ArenaCard key={post.id} post={post} onOpen={() => onOpenPost(post.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
