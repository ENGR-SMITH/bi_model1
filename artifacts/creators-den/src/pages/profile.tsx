import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowLeft, Check, Copy, Eye, Film, LockKeyhole, UserRound } from 'lucide-react';
import { tandemUid } from '@/lib/tandem-uid';
import {
  getGetUserProfileQueryKey,
  getGetVideoUserContributionsQueryKey,
  getGetVideoUserSocialQueryKey,
  getListPublicVideoProjectsQueryKey,
  getListVideoUserFollowersQueryKey,
  getListVideoUserFollowingQueryKey,
  useGetUserProfile,
  useGetVideoUserContributions,
  useGetVideoUserSocial,
  useListPublicVideoProjects,
  useListVideoUserFollowers,
  useListVideoUserFollowing,
} from '@workspace/api-client-react';
import type { VideoContributionDay, VideoProject } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { FollowButton } from '@/pages/explore';
import { CvCard, StorageBar } from '@/components/account-panel';
import { PaystackReturnGate } from '@/components/paystack-return';
import { WorkReviewsCard } from '@/components/work-reviews-card';

// ---------------------------------------------------------------------------
// Profile — the creator's public track history. It lists every project the
// user created or participated in that the Captain has marked PUBLIC; PRIVATE
// projects never appear. `/profile` is your own page, `/profile/:userId` is
// anyone else's. Carries the GitHub-style contribution graph + follow model.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Contribution level 0–4 for a day's count (GitHub-style intensity buckets). */
function levelOf(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function ContributionsGraph({ days, total }: { days: VideoContributionDay[]; total: number }) {
  // Column-major: chunk the contiguous day stream into 7-cell week columns.
  const weeks = useMemo(() => {
    const cols: VideoContributionDay[][] = [];
    for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));
    return cols;
  }, [days]);

  // Month labels along the top — shown when a week column starts a new month.
  const monthLabels = useMemo(() => {
    const labels: (string | null)[] = [];
    let last = -1;
    for (const col of weeks) {
      const first = col[0];
      if (!first) {
        labels.push(null);
        continue;
      }
      const month = Number(first.date.slice(5, 7)) - 1;
      labels.push(month === last ? null : MONTHS[month] ?? null);
      last = month;
    }
    return labels;
  }, [weeks]);

  return (
    <div className="paper-card" data-testid="panel-contributions">
      <div className="inline-heading">
        <span className="eyebrow"><Film size={13} /> Contributions</span>
        <span className="mono-label">{total} in the last 26 weeks</span>
      </div>
      <div className="contrib-wrap">
        <div className="contrib-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, 11px)` }}>
          {monthLabels.map((label, index) => (
            <span key={index} className="contrib-month" style={{ gridColumn: index + 1 }}>{label ?? ''}</span>
          ))}
        </div>
        <div className="contrib-grid" data-testid="contrib-grid">
          {weeks.map((column, weekIndex) => (
            <div key={weekIndex} className="contrib-week">
              {column.map((day) => (
                <span
                  key={day.date}
                  className={`contrib-cell level-${levelOf(day.count)}`}
                  title={day.count > 0 ? `${day.count} contribution${day.count === 1 ? '' : 's'} on ${day.date}` : `No contributions on ${day.date}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="contrib-legend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => <span key={level} className={`contrib-cell level-${level}`} />)}
          <span>More</span>
        </div>
      </div>
      <p className="den-footnote mt-3">
        <Eye size={13} />
        Activity inside public projects only — private vaults stay off the record.
      </p>
    </div>
  );
}

function TrackRow({ project, profileUserId, linkable }: { project: VideoProject; profileUserId: string; linkable: boolean }) {
  const created = project.ownerId === profileUserId;
  const body = (
    <>
      <span className="world-symbol"><Film size={13} /></span>
      <span className="min-w-0">
        <b className="truncate">{project.name}</b>
        <small>
          {new Date(project.createdAt).toLocaleDateString()}
          {project.description ? ` · ${project.description}` : ''}
        </small>
      </span>
      <span className={`den-tag ${created ? 'danger' : 'accent'}`} title={created ? 'They created this project' : 'They participated in this project'}>
        {created ? 'Created · Captain' : 'Participated'}
      </span>
      <span className="den-tag muted">{project.status.replaceAll('_', ' ')}</span>
    </>
  );

  const className = `list-row ${linkable ? '' : 'is-static'}`;
  const testId = `track-project-${project.id}`;

  return linkable ? (
    <Link href={`/projects/${project.id}`} className={className} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function FollowListEntry({ userId, displayName, imageUrl, isFollowing }: { userId: string; displayName: string; imageUrl: string | null; isFollowing: boolean | null }) {
  return (
    <div className="list-row is-static" data-testid={`follow-entry-${userId}`}>
      <span className="person-dot" style={{ background: 'hsl(var(--accent) / .25)', color: 'hsl(var(--accent))' }}>
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full rounded-full object-cover" /> : displayName.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <b className="truncate">{displayName}</b>
        <small>@{userId.slice(0, 12)}</small>
      </span>
      <FollowButton userId={userId} isFollowing={isFollowing} />
    </div>
  );
}

export default function ProfilePage() {
  const params = useParams<{ userId?: string }>();
  const { user } = useUser();
  const [followTab, setFollowTab] = useState<'followers' | 'following' | null>(null);
  const [copiedUid, setCopiedUid] = useState(false);

  const viewingSelf = !params.userId || params.userId === user?.id;
  const profileUserId = params.userId ?? user?.id ?? '';

  const profile = useGetUserProfile(params.userId ?? '', {
    query: { queryKey: getGetUserProfileQueryKey(params.userId ?? ''), enabled: Boolean(params.userId) },
  });
  const projects = useListPublicVideoProjects(profileUserId, {
    query: { queryKey: getListPublicVideoProjectsQueryKey(profileUserId), enabled: Boolean(profileUserId) },
  });
  const social = useGetVideoUserSocial(profileUserId, {
    query: { queryKey: getGetVideoUserSocialQueryKey(profileUserId), enabled: Boolean(profileUserId) },
  });
  const contributions = useGetVideoUserContributions(profileUserId, {
    query: { queryKey: getGetVideoUserContributionsQueryKey(profileUserId), enabled: Boolean(profileUserId) },
  });

  const followers = useListVideoUserFollowers(profileUserId, {
    query: {
      queryKey: getListVideoUserFollowersQueryKey(profileUserId),
      enabled: Boolean(profileUserId) && followTab === 'followers',
    },
  });
  const following = useListVideoUserFollowing(profileUserId, {
    query: {
      queryKey: getListVideoUserFollowingQueryKey(profileUserId),
      enabled: Boolean(profileUserId) && followTab === 'following',
    },
  });

  const displayName = viewingSelf
    ? [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.username || 'maker'
    : profile.data?.displayName || 'Creator';
  const email = viewingSelf ? user?.primaryEmailAddress?.emailAddress : undefined;
  const initials = viewingSelf
    ? `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || displayName.slice(0, 2)
    : displayName.slice(0, 2);
  const avatarUrl = viewingSelf ? user?.imageUrl : profile.data?.imageUrl ?? null;

  const track = (projects.data ?? []).filter((project) => project.visibility === 'PUBLIC');
  const followerCount = social.data?.followerCount ?? 0;
  const followingCount = social.data?.followingCount ?? 0;
  const contributionsTotal = contributions.data?.total ?? 0;
  const contributionsDays = contributions.data?.days ?? [];

  const followList = followTab === 'followers' ? (followers.data ?? []) : followTab === 'following' ? (following.data ?? []) : [];

  if (params.userId && profile.isError) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>PROFILE NOT FOUND</b><span>This creator does not exist.</span></div></div>
        <h1 style={{ font: '700 clamp(30px, 4vw, 43px) var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 24px' }}>This creator does not exist.</h1>
        <Link href="/" className="primary-btn"><ArrowLeft size={14} /> Back to the room</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="cd-billboard mb-6" data-testid="profile-billboard">
        <div className="cd-billboard-scrim" />
        <div className="cd-billboard-body">
          <SectionEyebrow>Creator profile · track history</SectionEyebrow>
          <div className="profile-hero">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="profile-avatar" data-testid="profile-avatar" />
            ) : (
              <span className="profile-avatar" aria-hidden data-testid="profile-avatar">
                <UserRound size={22} />
              </span>
            )}
            <div className="min-w-0">
              <h1>{displayName}</h1>
              <p className="profile-sub">
                {email || `@${profileUserId.slice(0, 12)}`}
                <span className="mono-label ml-2">{track.length} public project{track.length === 1 ? '' : 's'}</span>
                <span className="mono-label ml-2">{followerCount} follower{followerCount === 1 ? '' : 's'} · {followingCount} following</span>
              </p>
              {/* The unique Tandem ID — invite someone with it, no email needed. */}
              <div className="profile-uid" data-testid="profile-uid">
                <span className="mono-label">{viewingSelf ? 'Your unique Tandem ID' : 'Tandem ID'}</span>
                <button
                  type="button"
                  className="profile-uid-value"
                  onClick={() => {
                    void navigator.clipboard?.writeText(tandemUid(profileUserId)).then(() => {
                      setCopiedUid(true);
                      window.setTimeout(() => setCopiedUid(false), 1800);
                    });
                  }}
                  title="Copy to clipboard"
                  data-testid="profile-uid-copy"
                >
                  {tandemUid(profileUserId)}
                  {copiedUid ? <Check size={12} className="profile-uid-copied" /> : <Copy size={12} />}
                </button>
                <span className="profile-uid-hint mono-label">{copiedUid ? 'Copied!' : 'share this to be invited'}</span>
              </div>
            </div>
          </div>
          <div className="cd-billboard-actions">
            <Link href="/" className="cd-actionbtn" data-testid="link-profile-home">
              <ArrowLeft size={14} /> Home
            </Link>
            {!viewingSelf && <FollowButton userId={profileUserId} isFollowing={social.data?.isFollowing ?? null} size="md" />}
            {viewingSelf && (
              <span className="den-tag muted" title="Open a project on the home page and flip its eye to change what appears here">
                <Eye size={12} /> Visibility is set per project — Captain only
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="account-cards">
        {/* The workspace size bar is the account owner's private limit — it
            only renders on the signed-in user's own profile, with buy-more. */}
        {viewingSelf && <StorageBar />}
        {/* The CV is public profile info: editable on your own profile,
            view-only on anyone else's. */}
        <CvCard userId={profileUserId} editable={viewingSelf} />
      </div>

      {contributionsDays.length > 0 && (
        <div className="mb-6">
          <ContributionsGraph days={contributionsDays} total={contributionsTotal} />
        </div>
      )}

      <div className="cd-rail">
        <div className="cd-rail-head">
          <h3>Track history</h3>
          <span className="mono-label">{track.length} public</span>
        </div>

        {projects.isLoading ? (
          <div className="panel-empty">Opening the track record…</div>
        ) : track.length > 0 ? (
          <div className="paper-card">
            <div className="den-stack">
              {track.map((project) => (
                <TrackRow
                  key={project.id}
                  project={project}
                  profileUserId={profileUserId}
                  linkable={viewingSelf}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state" data-testid="empty-track-history">
            <Eye size={22} />
            <h3>No public projects yet.</h3>
            {viewingSelf ? (
              <>
                <p>Your track history only shows projects set to PUBLIC. Open a project from the home page and flip its eye open to publish it here.</p>
                <Link href="/" className="primary-btn mt-3"><Film size={14} /> Manage projects</Link>
              </>
            ) : (
              <p>This creator has not published any projects yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <WorkReviewsCard userId={profileUserId} />
      </div>

      <div className="cd-rail mt-8">
        <div className="cd-rail-head">
          <h3>Followers</h3>
          <div className="role-tabs explore-tabs" role="tablist">
            <button type="button" className={followTab === 'followers' ? 'active' : ''} onClick={() => setFollowTab(followTab === 'followers' ? null : 'followers')} data-testid="tab-followers">
              Followers <span className="leg-badge">{followerCount}</span>
            </button>
            <button type="button" className={followTab === 'following' ? 'active' : ''} onClick={() => setFollowTab(followTab === 'following' ? null : 'following')} data-testid="tab-following">
              Following <span className="leg-badge">{followingCount}</span>
            </button>
          </div>
        </div>
        {followTab ? (
          followList.length > 0 ? (
            <div className="paper-card">
              <div className="den-stack">
                {followList.map((entry) => (
                  <FollowListEntry key={entry.userId} userId={entry.userId} displayName={entry.displayName} imageUrl={entry.imageUrl} isFollowing={entry.isFollowing} />
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state" data-testid="empty-follow-list">
              <UserRound size={22} />
              <h3>{followTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</h3>
              <p>{viewingSelf ? 'Follow creators from the explore page to build your circle.' : 'Check back later — the den is growing.'}</p>
            </div>
          )
        ) : (
          <p className="setting-copy">Open a tab to see who follows this creator and who they follow.</p>
        )}
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Only PUBLIC projects appear on a profile — private vaults never leave the room.
      </p>

      {/* Confirms a Paystack payment when the customer returns from checkout. */}
      <PaystackReturnGate />
    </div>
  );
}
