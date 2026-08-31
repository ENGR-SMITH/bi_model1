import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { BookOpen, Check, Search, UserPlus, Users } from "lucide-react";
import {
  getGetVideoUserSocialQueryKey,
  getListExploreAuthorsQueryKey,
  getListVideoUserFollowersQueryKey,
  getListVideoUserFollowingQueryKey,
  useFollowVideoUser,
  useListCollaborationSeeds,
  useListExploreAuthors,
  useUnfollowVideoUser,
} from "@workspace/api-client-react";
import type { CollaborationSeed, ExploreAuthor } from "@workspace/api-client-react";
import { normalizeTandemUid, tandemUid } from "@/lib/tandem-uid";

// ---------------------------------------------------------------------------
// Explore — the Author Den discovery room (the writer analogue of the Creator
// Den explore page). Search authors by display name, raw user id, or unique
// Tandem ID, follow them, and browse published seeds (the pitch board work).
// ---------------------------------------------------------------------------

function matchesQuery(author: ExploreAuthor, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const uid = normalizeTandemUid(tandemUid(author.userId));
  const normalized = normalizeTandemUid(query);
  if (uid.includes(normalized)) return true;
  return (
    author.displayName.toLowerCase().includes(q) ||
    author.userId.toLowerCase().includes(q) ||
    author.userId.slice(0, 12).toLowerCase().includes(q)
  );
}

export function FollowButton({ userId, isFollowing }: { userId: string; isFollowing: boolean | null }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const follow = useFollowVideoUser();
  const unfollow = useUnfollowVideoUser();
  const pending = follow.isPending || unfollow.isPending;

  if (user?.id === userId) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListExploreAuthorsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetVideoUserSocialQueryKey(userId) });
    void queryClient.invalidateQueries({ queryKey: getListVideoUserFollowersQueryKey(userId) });
    void queryClient.invalidateQueries({ queryKey: getListVideoUserFollowingQueryKey(userId) });
  };

  const toggle = () => {
    if (pending || isFollowing == null) return;
    const mutation = isFollowing ? unfollow : follow;
    mutation.mutate({ userId }, { onSuccess: refresh });
  };

  return (
    <button
      type="button"
      className={`den-follow-btn ${isFollowing ? "is-following" : ""}`}
      onClick={toggle}
      disabled={pending || isFollowing == null}
      data-testid={`follow-${userId}`}
    >
      {isFollowing ? <Check size={13} /> : <UserPlus size={13} />}
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}

function AuthorAvatar({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (imageUrl) return <img src={imageUrl} alt="" className="den-author-avatar" />;
  return (
    <span className="den-author-avatar den-author-avatar-initial" aria-hidden>
      {(name || "A").slice(0, 1).toUpperCase()}
    </span>
  );
}

function AuthorRow({ author }: { author: ExploreAuthor }) {
  return (
    <div className="list-row" data-testid={`author-${author.userId}`}>
      <AuthorAvatar imageUrl={author.imageUrl} name={author.displayName} />
      <span className="min-w-0">
        <b className="truncate">{author.displayName}</b>
        <small>{tandemUid(author.userId)}</small>
      </span>
      <span className="den-author-stats">
        <span title="Published seeds"><BookOpen size={12} /> {author.publishedSeedCount}</span>
        <span title="Followers"><Users size={12} /> {author.followerCount}</span>
      </span>
      <FollowButton userId={author.userId} isFollowing={author.isFollowing} />
    </div>
  );
}

function WorkCard({ seed }: { seed: CollaborationSeed }) {
  return (
    <a
      className="list-row den-work-row"
      href={`/authors/pitch-board/seed/${seed.id}`}
      data-testid={`work-${seed.id}`}
    >
      <span className="den-work-mark"><BookOpen size={15} /></span>
      <span className="min-w-0">
        <b className="truncate">{seed.sourceProjectTitle}</b>
        <small className="truncate">
          {seed.creatorName} · {seed.genre} · {seed.unitType}
        </small>
        <em className="truncate">{seed.seedText.slice(0, 140)}</em>
      </span>
      <span className="den-tag muted">{seed.respondentCount} responses</span>
    </a>
  );
}

export function ExplorePage() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"authors" | "work">("authors");
  const authors = useListExploreAuthors();
  const seeds = useListCollaborationSeeds();

  const filteredAuthors = useMemo(
    () => (authors.data ?? []).filter((author) => matchesQuery(author, query)),
    [authors.data, query],
  );
  const filteredSeeds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = seeds.data ?? [];
    if (!q) return rows;
    return rows.filter(
      (seed) =>
        seed.sourceProjectTitle.toLowerCase().includes(q) ||
        seed.creatorName.toLowerCase().includes(q) ||
        seed.genre.toLowerCase().includes(q) ||
        seed.seedText.toLowerCase().includes(q),
    );
  }, [seeds.data, query]);

  return (
    <div className="page explore-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">THE WRITER'S ROOM</div>
          <h1>Find your next second voice.</h1>
          <p>Search authors by name or Tandem ID, follow the ones you want to hear from, and browse the work on the pitch board.</p>
        </div>
      </div>

      <label className="search-field explore-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search authors, Tandem IDs, or published work…"
          data-testid="explore-search"
        />
      </label>

      <div className="filter-tabs role-tabs explore-tabs" role="tablist">
        <button type="button" className={tab === "authors" ? "active" : ""} onClick={() => setTab("authors")} role="tab" aria-selected={tab === "authors"} data-testid="tab-authors">
          Authors <span className="leg-badge">{authors.data?.length ?? 0}</span>
        </button>
        <button type="button" className={tab === "work" ? "active" : ""} onClick={() => setTab("work")} role="tab" aria-selected={tab === "work"} data-testid="tab-work">
          Published work <span className="leg-badge">{seeds.data?.length ?? 0}</span>
        </button>
      </div>

      {tab === "authors" ? (
        authors.isLoading ? (
          <div className="panel-empty">Opening the writer's room…</div>
        ) : filteredAuthors.length > 0 ? (
          <div className="paper-card">
            <div className="den-stack">
              {filteredAuthors.map((author) => (
                <AuthorRow key={author.userId} author={author} />
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state" data-testid="explore-authors-empty">
            <Users size={22} />
            <h3>No authors match “{query}”.</h3>
            <p>Authors appear here once they publish a seed to the pitch board. Try a name or their Tandem ID.</p>
          </div>
        )
      ) : seeds.isLoading ? (
        <div className="panel-empty">Opening the pitch board…</div>
      ) : filteredSeeds.length > 0 ? (
        <div className="paper-card">
          <div className="den-stack">
            {filteredSeeds.map((seed) => (
              <WorkCard key={seed.id} seed={seed} />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-state" data-testid="explore-work-empty">
          <BookOpen size={22} />
          <h3>No published work matches “{query}”.</h3>
          <p>Seeds your collaborators publish to the pitch board show up here.</p>
        </div>
      )}
    </div>
  );
}
