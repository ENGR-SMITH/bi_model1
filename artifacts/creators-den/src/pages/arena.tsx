import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowRight, CheckCircle2, Clapperboard, Megaphone, Users } from 'lucide-react';
import {
  useListArenaPosts,
  useListChannels,
  useListVideoProjects,
} from '@workspace/api-client-react';
import type { ArenaPostSummary, ArenaRole, ListArenaPostsSort } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { PostArenaRoleModal, type ArenaPostProjectOption } from '@/components/arena-post-composer';
import { ARENA_ROLE_META, ArenaRoleTag, timeAgo } from '@/components/arena-apply-modal';
import { ArenaGlobalWatchBell } from '@/components/arena-watch';

// ---------------------------------------------------------------------------
// Arena board — every OPEN role post across the platform's channels. Role
// filter chips + newest / most-auditions sort; each card shows the channel,
// project, poster, pitch excerpt, and the LIVE applicant count. Cards open the
// post page (apply modal, Captain view) and every project carries a read-only
// preview link that works while the audition is open.
// ---------------------------------------------------------------------------

const ROLE_FILTERS: Array<{ key: 'ALL' | ArenaRole }> = [
  { key: 'ALL' },
  { key: 'VIDEO' },
  { key: 'AUDIO' },
  { key: 'SCRIPT' },
  { key: 'THUMBNAIL' },
];

export default function ArenaBoardPage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [roleFilter, setRoleFilter] = useState<'ALL' | ArenaRole>('ALL');
  const [sort, setSort] = useState<ListArenaPostsSort>('newest');
  const [composerOpen, setComposerOpen] = useState(false);

  const posts = useListArenaPosts({
    role: roleFilter === 'ALL' ? undefined : roleFilter,
    sort,
  });
  const rows = (posts.data ?? []) as ArenaPostSummary[];

  // Captains post open roles on their own channel projects — the CTA only
  // appears when the caller owns at least one project inside a channel.
  const channels = useListChannels();
  const myProjects = useListVideoProjects();
  const channelNameById = new Map(
    (channels.data ?? []).map((channel) => [channel.id, channel.youtubeTitle || channel.name]),
  );
  const ownedOptions: ArenaPostProjectOption[] = ((myProjects.data ?? []) as Array<{
    id: string;
    name: string;
    channelId: string | null;
    ownerId: string;
  }>)
    .filter((project) => Boolean(project.channelId) && project.ownerId === user?.id)
    .map((project) => ({
      id: project.id,
      name: project.name,
      channelId: project.channelId as string,
      channelName: channelNameById.get(project.channelId as string) ?? 'Your channel',
    }))
    .sort((a, b) => a.channelName.localeCompare(b.channelName) || a.name.localeCompare(b.name));

  return (
    <div className="page arena-page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Collaboration / Audition Arena</SectionEyebrow>
          <h1>Audition for open seats.</h1>
          <p>
            Captains across the platform post the roles they need — video, audio, script, thumbnails — and you
            audition with a pitch and your work. Every open post lets you preview the project read-only before you
            apply.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="den-tag accent" data-testid="arena-open-count">
            <Users size={11} /> {rows.length} open {rows.length === 1 ? 'audition' : 'auditions'}
          </span>
          <Link href="/arena/mine" className="secondary-btn" data-testid="nav-arena-mine">
            Your auditions <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="arena-toolbar" data-testid="arena-toolbar">
        <div className="role-tabs" role="group" aria-label="Filter by role">
          {ROLE_FILTERS.map(({ key }) => (
            <span key={key} className="arena-role-pill">
              <button
                type="button"
                className={roleFilter === key ? 'active' : ''}
                onClick={() => setRoleFilter(key)}
                data-testid={`arena-role-${key.toLowerCase()}`}
              >
                {key === 'ALL' ? 'All roles' : ARENA_ROLE_META[key].label}
              </button>
              {key !== 'ALL' && <ArenaGlobalWatchBell role={key} />}
            </span>
          ))}
        </div>
        <div className="role-tabs" role="group" aria-label="Sort auditions">
          <button
            type="button"
            className={sort === 'newest' ? 'active' : ''}
            onClick={() => setSort('newest')}
            data-testid="arena-sort-newest"
          >
            Newest
          </button>
          <button
            type="button"
            className={sort === 'most_applied' ? 'active' : ''}
            onClick={() => setSort('most_applied')}
            data-testid="arena-sort-most-applied"
          >
            Most auditions
          </button>
        </div>
        {ownedOptions.length > 0 && (
          <button
            type="button"
            className="primary-btn arena-toolbar-cta"
            onClick={() => setComposerOpen(true)}
            data-testid="button-arena-board-post"
          >
            <Megaphone size={14} /> Post an open role
          </button>
        )}
      </div>

      {posts.isLoading ? (
        <div className="panel-empty">Opening the arena…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="arena-empty">
          <Clapperboard size={22} />
          <h3>No open auditions{roleFilter !== 'ALL' ? ` for ${ARENA_ROLE_META[roleFilter].label.toLowerCase()}` : ''} right now.</h3>
          <p>Captains post the roles they need here — check back soon, or watch a role to get pinged when one opens.</p>
        </div>
      ) : (
        <div className="den-stack" data-testid="arena-board">
          {rows.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <p className="den-footnote mt-6">
        <Clapperboard size={13} />
        The applicant count is live — it moves the moment someone auditions or is declined.
      </p>

      {composerOpen && ownedOptions.length > 0 && (
        <PostArenaRoleModal
          projects={ownedOptions}
          onClose={() => setComposerOpen(false)}
          onCreated={(post) => {
            setComposerOpen(false);
            setLocation(`/arena/posts/${post.id}`);
          }}
        />
      )}
    </div>
  );
}

function PostCard({ post }: { post: ArenaPostSummary }) {
  const meta = ARENA_ROLE_META[post.role];
  const applied = post.myApplication === 'pending' || post.myApplication === 'accepted';

  return (
    <Link
      href={`/arena/posts/${post.id}`}
      className="arena-card"
      data-testid={`arena-post-${post.id}`}
    >
      <span className="arena-card-main">
        <span className="arena-card-topline">
          <span className="arena-channel-avatar" aria-hidden>
            {post.channelAvatarUrl ? <img src={post.channelAvatarUrl} alt="" /> : post.channelName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="arena-card-channel">{post.channelName}</span>
            <span className="arena-card-project">{post.projectName}</span>
          </span>
        </span>

        <span className="arena-card-roleline">
          <ArenaRoleTag role={post.role} />
          <span className="arena-card-seat">looking for a {meta.roleLabel.toLowerCase()}</span>
        </span>

        <span className="arena-card-pitch">{post.pitch}</span>

        <span className="arena-card-foot">
          <span className="arena-card-poster">
            {post.posterImageUrl ? <img src={post.posterImageUrl} alt="" /> : <i>{post.posterName.slice(0, 1)}</i>}
            {post.posterName}
          </span>
          <span className="arena-card-time">{timeAgo(post.createdAt)}</span>
          <span className="arena-card-arrow">
            Open audition <ArrowRight size={13} />
          </span>
        </span>
      </span>

      <span className="arena-card-side">
        {applied ? (
          <span className="arena-count applied" data-testid={`arena-count-${post.id}`}>
            <CheckCircle2 size={13} />
            {post.myApplication === 'accepted' ? 'You’re on this team' : 'Audition sent'}
          </span>
        ) : null}
        <span className={`arena-count ${applied ? 'is-applied' : ''}`}>
          {post.applicantCount > 0 ? (
            <>
              <b>{post.applicantCount}</b>
              already applied
            </>
          ) : (
            <>Be the first to audition</>
          )}
        </span>
      </span>
    </Link>
  );
}
