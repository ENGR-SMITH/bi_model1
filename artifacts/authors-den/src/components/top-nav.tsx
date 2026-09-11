import { useRef, useState } from "react";
import { useUser } from "@clerk/react";
import { ArrowRight, Bell, BookOpen, Megaphone, Search } from "lucide-react";
import {
  getListCollaborationSeedsQueryKey,
  getListExploreAuthorsQueryKey,
  useListCollaborationSeeds,
  useListExploreAuthors,
} from "@workspace/api-client-react";
import { matchesAuthorQuery, matchesSeedQuery } from "@/components/explore";
import { nexetUid } from "@/lib/nexet-uid";

// ---------------------------------------------------------------------------
// The Author Den top-bar chrome. Same three pieces the Creators Den runs in
// its header: a live Explore search in the centre, the notifications bell and
// the account tile on the right, and the Audition Arena notch beside the
// workspace switcher. The sidebar stays for the writing desk itself.
// ---------------------------------------------------------------------------

/**
 * Explore, centred in the top bar. Typing opens a live results dropdown over
 * the same two lists the Explore room shows — writers and published work —
 * reusing its matchers so the two surfaces never disagree. Enter (or the
 * telescope) opens the full Explore room with the query.
 */
export function TopExploreSearch({
  onOpenExplore,
  onOpenSeed,
}: {
  onOpenExplore: (query: string) => void;
  onOpenSeed: (seedId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const searching = query.trim().length > 0;

  const authors = useListExploreAuthors({
    query: { queryKey: getListExploreAuthorsQueryKey(), enabled: searching },
  });
  const seeds = useListCollaborationSeeds(undefined, {
    query: { queryKey: getListCollaborationSeedsQueryKey(), enabled: searching },
  });

  const authorHits = searching
    ? (authors.data ?? []).filter((author) => matchesAuthorQuery(author, query)).slice(0, 4)
    : [];
  const seedHits = searching
    ? (seeds.data ?? []).filter((seed) => matchesSeedQuery(seed, query)).slice(0, 4)
    : [];
  // Wait for both lists to resolve so a loading flicker never shows a
  // premature “no results”.
  const showDrop = open && searching && authors.isSuccess && seeds.isSuccess;

  const submit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setOpen(false);
    onOpenExplore(query.trim());
  };

  const openSeed = (seedId: string) => {
    setQuery("");
    setOpen(false);
    onOpenSeed(seedId);
  };

  return (
    <div className="topnav-search">
      <div className="topnav-search-wrap">
        <form className="topnav-search-box" role="search" onSubmit={submit} data-testid="nav-explore">
          <button type="submit" className="topnav-search-icon" aria-label="Search the den" data-testid="nav-explore-toggle">
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
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Search writers and published work…"
            aria-label="Search writers and published work"
            className="topnav-search-input"
            data-testid="nav-explore-input"
          />
        </form>
        {showDrop && (
          <div className="topnav-search-drop" onMouseDown={(event) => event.preventDefault()} data-testid="nav-explore-drop">
            {authorHits.length === 0 && seedHits.length === 0 ? (
              <p className="topnav-search-empty">No writers or work match “{query.trim()}”.</p>
            ) : (
              <>
                {authorHits.length > 0 && (
                  <div className="topnav-search-group">
                    <p className="topnav-search-label">Writers</p>
                    {authorHits.map((author) => (
                      <button
                        type="button"
                        key={author.userId}
                        className="topnav-search-item"
                        onClick={() => submit()}
                        data-testid={`nav-search-author-${author.userId}`}
                      >
                        <span className="topnav-search-mark" aria-hidden>
                          {author.imageUrl ? (
                            <img src={author.imageUrl} alt="" />
                          ) : (
                            author.displayName.slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <span className="topnav-search-copy">
                          <b>{author.displayName}</b>
                          <small>
                            {nexetUid(author.userId)} · {author.publishedSeedCount} seed
                            {author.publishedSeedCount === 1 ? "" : "s"}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {seedHits.length > 0 && (
                  <div className="topnav-search-group">
                    <p className="topnav-search-label">Published work</p>
                    {seedHits.map((seed) => (
                      <button
                        type="button"
                        key={seed.id}
                        className="topnav-search-item"
                        onClick={() => openSeed(seed.id)}
                        data-testid={`nav-search-seed-${seed.id}`}
                      >
                        <span className="topnav-search-mark" aria-hidden>
                          <BookOpen size={14} />
                        </span>
                        <span className="topnav-search-copy">
                          <b>{seed.sourceProjectTitle}</b>
                          <small>
                            {seed.creatorName} · {seed.genre}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" className="topnav-search-all" onClick={() => submit()} data-testid="nav-explore-drop-all">
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

/** The inbox bell — unread count included, opening the notifications room. */
export function TopNotificationsBell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <span className="topnav-bell-wrap">
      <button
        type="button"
        className="topnav-bell"
        aria-label="Notifications"
        title="Notifications"
        onClick={onClick}
        data-testid="nav-notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="topnav-bell-badge" data-testid="bell-unread">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <span className="topnav-bell-label">INBOX</span>
    </span>
  );
}

/** The account tile IS the profile link — real avatar (or initials), name and
 * email — matching the Creators Den header. */
export function TopAccountChip({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { user } = useUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "Writer";
  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}` || name.slice(0, 2);
  return (
    <button
      type="button"
      className="topnav-account"
      onClick={onOpenProfile}
      aria-label={`Open ${name}'s profile`}
      data-testid="topnav-profile"
    >
      <span className="topnav-account-avatar" aria-hidden>
        {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : initials}
      </span>
      <span className="topnav-account-meta">
        <span className="topnav-account-name" data-testid="text-user-name">
          {name}
        </span>
        <span className="topnav-account-email">{user?.primaryEmailAddress?.emailAddress || "Nexet member"}</span>
      </span>
    </button>
  );
}

/** The Audition Arena notch, parked beside the workspace switcher. */
export function TopArenaButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`topnav-arena ${active ? "active" : ""}`}
      onClick={onClick}
      title="Writers' Audition Arena"
      data-testid="nav-arena"
    >
      <Megaphone size={15} />
      <span>Arena</span>
    </button>
  );
}
