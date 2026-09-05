import { useState } from 'react';
import { Link2, Lock, Users } from 'lucide-react';
import { Link, Redirect, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getListChannelsQueryKey,
  getListVideoProjectsQueryKey,
  useAttachVideoProjectChannel,
  useGetVideoProject,
  useListChannels,
} from '@workspace/api-client-react';
import { channelProjectUrl } from '@/lib/den-urls';
import VaultPage from '@/pages/vault';
import ActivityPage from '@/pages/activity';
import NotificationsPage from '@/pages/notifications';
import ReviewPage from '@/pages/review';
import PreviewPage from '@/pages/preview';
import VideoPreviewPage from '@/pages/preview-video';
import AudioPreviewPage from '@/pages/preview-audio';
import ThumbnailPreviewPage from '@/pages/preview-thumbnail';
import ScriptPreviewPage from '@/pages/preview-script';
import FinishPreviewPage from '@/pages/preview-finish';
import RoleVideoPage from '@/pages/role-video';
import RoleAudioPage from '@/pages/role-audio';
import RoleThumbnailPage from '@/pages/role-thumbnail';
import RoleScriptPage from '@/pages/role-script';

// ---------------------------------------------------------------------------
// Legacy flat deep-link gate.
//
// Old notification rows and links inside the app still use
// /creators-den/projects/:id. Channel members bounce one hop into their
// channel URL; a legacy project with no channel shows its owner the attach
// notice; PUBLIC projects stay viewable (read-only) on the flat path so the
// profile/explore preview flow keeps working for non-members.
// ---------------------------------------------------------------------------

const FLAT_READONLY_PAGES: Array<[string, React.ComponentType]> = [
  ['', VaultPage],
  ['activity', ActivityPage],
  ['notifications', NotificationsPage],
  ['review', ReviewPage],
  ['preview', PreviewPage],
  ['preview/video', VideoPreviewPage],
  ['preview/audio', AudioPreviewPage],
  ['preview/thumbnail', ThumbnailPreviewPage],
  ['preview/script', ScriptPreviewPage],
  ['preview/finish', FinishPreviewPage],
  ['role/video', RoleVideoPage],
  ['role/audio', RoleAudioPage],
  ['role/thumbnail', RoleThumbnailPage],
  ['role/script', RoleScriptPage],
];

function AttachNotice({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const channels = useListChannels();
  const detail = useGetVideoProject(projectId);
  const attach = useAttachVideoProjectChannel();
  const [pending, setPending] = useState('');

  const owned = (channels.data ?? []).filter((c) => c.myRole === 'OWNER');
  const project = detail.data;
  const isOwner = project?.ownerId === user?.id;
  const isMember = (project?.myRoles?.length ?? 0) > 0;

  const submit = () => {
    if (!pending) return;
    attach.mutate(
      { projectId, data: { channelId: pending } },
      {
        onSuccess: (updated) => {
          queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListVideoProjectsQueryKey() });
          if (updated.channelId) {
            window.location.href = channelProjectUrl(updated.channelId, projectId);
          }
        },
      },
    );
  };

  return (
    <div className="page">
      <div className="paper-card" style={{ maxWidth: 560, marginInline: 'auto' }} data-testid="unlinked-project-card">
        <div className="inline-heading">
          <span className="eyebrow"><Link2 size={13} /> Unlinked project</span>
        </div>
        <h1 style={{ font: '700 32px var(--app-font-serif)', letterSpacing: '-.04em', margin: '10px 0 8px' }}>{project?.name ?? 'This project'}</h1>
        <p className="setting-copy">
          {isOwner
            ? 'This project was created before channels existed, so it lives outside every channel. Attach it to one of your channels and it will show up there like any other project.'
            : isMember
              ? 'This project lives outside every channel for now. When its Captain attaches it to a channel, it will appear there.'
              : 'This project is not inside a channel you can open.'}
        </p>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select value={pending} onChange={(event) => setPending(event.target.value)} className="den-select" data-testid="unlinked-pick">
              <option value="">Choose a channel…</option>
              {owned.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.youtubeTitle || channel.name}</option>
              ))}
            </select>
            <button type="button" className="primary-btn" onClick={submit} disabled={!pending || attach.isPending} data-testid="unlinked-attach-submit">
              <Link2 size={13} /> {attach.isPending ? 'Attaching…' : 'Attach to channel'}
            </button>
          </div>
        )}
        {isOwner && owned.length === 0 && (
          <p className="den-footnote mt-3">You need a channel first — <Link href="/" className="underline">create one on the channels page</Link>.</p>
        )}
        <p className="den-footnote mt-4"><Users size={11} /> Members keep their access once it lands in a channel.</p>
      </div>
    </div>
  );
}

export function LegacyProjectGate() {
  const { projectId } = useParams<{ projectId: string }>();
  // The rest of the flat path ('' | 'activity' | 'preview/video' | …) — read
  // from the location so the gate works with any deep-link pattern.
  const [location] = useLocation();
  const rest = location.split('/').slice(3).join('/');
  const detail = useGetVideoProject(projectId);

  if (detail.isLoading || (!detail.data && !detail.isError)) {
    return <div className="page"><div className="panel-empty">Opening the project…</div></div>;
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>ROOM NOT FOUND</b><span>This door leads nowhere.</span></div></div>
        <h1 style={{ font: '700 clamp(30px, 4vw, 43px) var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 24px' }}>This door leads nowhere.</h1>
        <Link href="/" className="primary-btn">Back to your channels</Link>
      </div>
    );
  }

  const project = detail.data;
  const myRoles = project.myRoles ?? [];
  const isMember = myRoles.length > 0;

  // Channel members: canonical URLs live inside the channel — bounce there.
  if (isMember && project.channelId) {
    const target = rest
      ? channelProjectUrl(project.channelId, project.id, `/${rest}`)
      : channelProjectUrl(project.channelId, project.id);
    return <Redirect to={target} />;
  }

  // Legacy project with no channel: the owner attaches it, members wait.
  if (!project.channelId) {
    return <AttachNotice projectId={project.id} />;
  }

  // A non-member viewing surface stays on the flat path as the read-only
  // preview experience (PREVIEW + TIMELINE only): PUBLIC projects opened from
  // profile/explore flows, and the Arena applicant window — a PRIVATE project
  // carrying an OPEN role post grants the same read-only access while the post
  // is OPEN. The server reports both as viewerAccess 'public' | 'applicant';
  // older payloads without the field fall back to the PUBLIC visibility check.
  const readOnlyAccess =
    project.viewerAccess === 'public' ||
    project.viewerAccess === 'applicant' ||
    (project.viewerAccess === undefined && project.visibility === 'PUBLIC');

  if (readOnlyAccess) {
    const Page = FLAT_READONLY_PAGES.find(([key]) => key === rest)?.[1] ?? VaultPage;
    return <Page key={`flat-${project.id}-${rest}`} />;
  }

  // PRIVATE project outside the caller's channels.
  return (
    <div className="page">
      <div className="page-guide"><span className="guide-pin" /><div><b>LOCKED</b><span>You are not on this project.</span></div></div>
      <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}><Lock size={18} /> Private project.</h1>
      <Link href="/" className="primary-btn">Back to your channels</Link>
    </div>
  );
}

export default LegacyProjectGate;
