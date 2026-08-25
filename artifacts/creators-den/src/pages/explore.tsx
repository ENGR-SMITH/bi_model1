import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { Check, Compass, Eye, Film, Search, UserPlus, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoUserSocialQueryKey,
  getListExploreCreatorsQueryKey,
  getListExploreProjectsQueryKey,
  getListVideoUserFollowersQueryKey,
  getListVideoUserFollowingQueryKey,
  useFollowVideoUser,
  useListExploreCreators,
  useListExploreProjects,
  useUnfollowVideoUser,
} from '@workspace/api-client-react';
import type { VideoCreatorSummary, VideoPublicProject } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';

// ---------------------------------------------------------------------------
// Explore — GitHub-style discovery. Two browse rails (creators / projects)
// over PUBLIC track history, with client-side name search.
// ---------------------------------------------------------------------------

export function FollowButton({ userId, isFollowing, size = 'sm' }: { userId: string; isFollowing: boolean | null; size?: 'sm' | 'md' }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const follow = useFollowVideoUser();
  const unfollow = useUnfollowVideoUser();
  const pending = follow.isPending || unfollow.isPending;

  // Never offer a self-follow.
  if (user?.id === userId) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListExploreCreatorsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetVideoUserSocialQueryKey(userId) });
    queryClient.invalidateQueries({ queryKey: getListVideoUserFollowersQueryKey(userId) });
    queryClient.invalidateQueries({ queryKey: getListVideoUserFollowingQueryKey(userId) });
  };

  const toggle = () => {
    if (pending || isFollowing == null) return;
    const mutation = isFollowing ? unfollow : follow;
    mutation.mutate({ userId }, { onSuccess: refresh });
  };

  return (
    <button
      type="button"
      className={`follow-btn ${isFollowing ? 'is-following' : ''} is-${size}`}
      onClick={toggle}
      disabled={pending || isFollowing == null}
      data-testid={`follow-${userId}`}
    >
      {isFollowing ? <Check size={13} /> : <UserPlus size={13} />}
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}

function Avatar({ imageUrl, name, className }: { imageUrl: string | null; name: string; className?: string }) {
  if (imageUrl) return <img src={imageUrl} alt="" className={`explore-avatar ${className ?? ''}`} />;
  return (
    <span className={`explore-avatar ${className ?? ''}`} aria-hidden>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function CreatorCard({ creator }: { creator: VideoCreatorSummary }) {
  return (
    <div className="explore-card" data-testid={`explore-creator-${creator.userId}`}>
      <Link href={`/profile/${creator.userId}`} className="explore-card-main">
        <Avatar imageUrl={creator.imageUrl} name={creator.displayName} />
        <span className="min-w-0">
          <b className="truncate">{creator.displayName}</b>
          <small>
            {creator.publicProjectCount} public project{creator.publicProjectCount === 1 ? '' : 's'} · {creator.followerCount} follower{creator.followerCount === 1 ? '' : 's'}
          </small>
        </span>
      </Link>
      <FollowButton userId={creator.userId} isFollowing={creator.isFollowing} />
    </div>
  );
}

function ProjectCard({ project }: { project: VideoPublicProject }) {
  return (
    <div className="explore-card explore-project" data-testid={`explore-project-${project.id}`}>
      <Link href={`/profile/${project.ownerId}`} className="explore-project-owner">
        <Avatar imageUrl={project.ownerImageUrl} name={project.ownerName} className="is-tiny" />
        <span>{project.ownerName}</span>
      </Link>
      <div className="explore-project-body">
        <span className="explore-project-icon"><Film size={20} /></span>
        <div className="min-w-0">
          <b className="explore-project-title">{project.name}</b>
          <small>
            {project.status.replaceAll('_', ' ')} · {new Date(project.createdAt).toLocaleDateString()}
          </small>
          {project.description && <p className="explore-project-desc">{project.description}</p>}
        </div>
      </div>
      <span className="den-tag muted"><Eye size={11} /> Public</span>
    </div>
  );
}

export default function ExplorePage() {
  const [tab, setTab] = useState<'creators' | 'projects'>('creators');
  const [query, setQuery] = useState('');

  const creators = useListExploreCreators({ query: { queryKey: getListExploreCreatorsQueryKey() } });
  const projects = useListExploreProjects({ query: { queryKey: getListExploreProjectsQueryKey() } });

  const q = query.trim().toLowerCase();
  const filteredCreators = useMemo(
    () => (creators.data ?? []).filter((c) => !q || c.displayName.toLowerCase().includes(q)),
    [creators.data, q],
  );
  const filteredProjects = useMemo(
    () => (projects.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
    [projects.data, q],
  );

  const loading = tab === 'creators' ? creators.isLoading : projects.isLoading;
  const empty = tab === 'creators' ? filteredCreators.length === 0 : filteredProjects.length === 0;
  const total = tab === 'creators' ? (creators.data?.length ?? 0) : (projects.data?.length ?? 0);

  return (
    <div className="page">
      <div className="explore-hero" data-testid="explore-hero">
        <SectionEyebrow><Compass size={13} /> Discovery</SectionEyebrow>
        <h1>Explore the den.</h1>
        <p>Find creators and the projects they&apos;ve made public — browse their track history, then follow along.</p>

        <div className="explore-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === 'creators' ? 'Search creators by name…' : 'Search projects by name, owner, or description…'}
            data-testid="explore-search"
          />
        </div>

        <div className="role-tabs explore-tabs" role="tablist">
          <button type="button" className={tab === 'creators' ? 'active' : ''} onClick={() => setTab('creators')} data-testid="tab-creators">
            <UserRound size={13} /> Creators <span className="leg-badge">{creators.data?.length ?? 0}</span>
          </button>
          <button type="button" className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')} data-testid="tab-projects">
            <Film size={13} /> Projects <span className="leg-badge">{projects.data?.length ?? 0}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="panel-empty">Scanning the den…</div>
      ) : empty ? (
        <div className="empty-state" data-testid="explore-empty">
          <Compass size={22} />
          <h3>{query ? 'Nothing matches that search.' : tab === 'creators' ? 'No creators yet.' : 'No public projects yet.'}</h3>
          <p>
            {query
              ? 'Try a different name, or clear the search to see everything.'
              : tab === 'creators'
                ? 'When a Captain marks a project PUBLIC, they appear here.'
                : 'When a Captain marks a project PUBLIC, it appears here.'}
          </p>
          {query && (
            <button type="button" className="secondary-btn mt-3" onClick={() => setQuery('')}>
              Clear search
            </button>
          )}
        </div>
      ) : tab === 'creators' ? (
        <div className="explore-grid" data-testid="explore-creators-list">
          {filteredCreators.map((creator) => (
            <CreatorCard key={creator.userId} creator={creator} />
          ))}
        </div>
      ) : (
        <div className="explore-grid" data-testid="explore-projects-list">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {!loading && !empty && (
        <p className="den-footnote mt-6">
          <Eye size={13} />
          Showing {tab === 'creators' ? filteredCreators.length : filteredProjects.length} of {total} {tab === 'creators' ? 'creators' : 'projects'} with public track history.
        </p>
      )}
    </div>
  );
}
