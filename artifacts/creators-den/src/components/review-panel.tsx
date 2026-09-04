// ---------------------------------------------------------------------------
// ReviewPanel — PR-scoped review mode (VCS design §10 / §12).
//
// Opens from a pending submission in the CommitLog. It is the Captain's
// review surface for one pull request:
//   - plays the submitted version (the snapshot the submission pinned),
//     scrubbing through its clips,
//   - lets reviewers drop pins / notes scoped to that submission (and
//     version), via AnnotationCanvas + CommentsPanel with `submissionId`,
//   - shows the timeline diff of the submission against its leg's head,
//   - Approve / Reject right on the surface — approve is the merge.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import { Check, Clapperboard, FileUp, GitPullRequest, Play, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVideoAssetQueryKey,
  getGetVideoProjectQueryKey,
  getGetVideoTimelineVersionQueryKey,
  getListVideoReviewQueueQueryKey,
  getListVideoSubmissionsQueryKey,
  useApproveVideoSubmission,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimelineVersion,
  useListVideoComments,
  useRejectVideoSubmission,
} from '@workspace/api-client-react';
import type { VideoSubmission } from '@workspace/api-client-react';
import { Timeline, formatTimecode, activeBlockId, type TimelineBlock } from '@/components/timeline';
import { AssetPlayer, ImageStage, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { DiffView } from '@/components/diff-view';
import { CommentsPanel } from '@/components/review-shared';
import type { StudioLeg } from '@/components/role-oracle';
import type { TimelineSnapshotLike } from '@/lib/diff';

export function ReviewPanel({
  projectId,
  submission,
  headVersionId,
  onClose,
  hideDecision = false,
}: {
  projectId: string;
  /** The pending submission being reviewed (leg + pinned version). */
  submission: VideoSubmission;
  /** The submission's leg's head version id (the diff baseline). */
  headVersionId: string | null;
  onClose: () => void;
  /** Hide the built-in decision card — used by the captain's REVIEW page, which
      renders its own large decision + oracle cards below the media surface. */
  hideDecision?: boolean;
}) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);

  const leg = submission.leg as StudioLeg;
  const isPending = submission.status === 'SUBMITTED';
  // A file handed in for review (submit-for-review uploads — the desktop agent
  // or any review upload) carries an `ASSET:<assetId>` sentinel instead of a
  // pinned timeline version: there is no snapshot to play or diff yet. The
  // file stays private until the Captain decides — approve moves it into the
  // vault and starts processing; reject deletes it and sends it back.
  const isAssetSubmission = submission.timelineVersionId.startsWith('ASSET:');
  const submissionFileName = isAssetSubmission
    ? submission.note.split(' — ')[0] || 'File submission'
    : null;
  const submissionMessage =
    isAssetSubmission && submission.note.includes(' — ')
      ? submission.note.slice(submission.note.indexOf(' — ') + 3).trim()
      : null;

  const version = useGetVideoTimelineVersion(projectId, leg, submission.timelineVersionId, {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, leg, submission.timelineVersionId),
      enabled: !isAssetSubmission,
    },
  });
  const project = useGetVideoProject(projectId);

  const snapshot = version.data?.snapshot as TimelineSnapshotLike | null;
  const clips = useMemo(() => (Array.isArray(snapshot?.clips) ? snapshot!.clips! : []), [snapshot]);
  // The THUMBNAIL leg's "clips" are its chosen design image(s).
  const design = Array.isArray(snapshot?.designs) ? snapshot!.designs![0] ?? null : null;
  const assetId = isAssetSubmission
    ? ''
    : clips[0]?.assetId ?? design?.assetId ?? project.data?.assets[0]?.id ?? '';

  const detail = useGetVideoAsset(projectId, assetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId),
      enabled: Boolean(assetId) && !isAssetSubmission,
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  // Review markers (design §10): this PR's timecode comments on the current
  // asset, drawn as a clickable rail under the player frame.
  const comments = useListVideoComments(projectId);
  const markers = useMemo(
    () =>
      (comments.data ?? [])
        .filter((comment) => comment.timecodeMs !== null && comment.submissionId === submission.id && comment.assetId === assetId)
        .map((comment) => ({
          id: comment.id,
          ms: comment.timecodeMs as number,
          tone: comment.kind === 'MARK' ? ('gold' as const) : ('accent' as const),
          label: comment.label ?? undefined,
        })),
    [comments.data, submission.id, assetId],
  );

  const approve = useApproveVideoSubmission();
  const reject = useRejectVideoSubmission();

  const decide = (decision: 'approve' | 'reject') => {
    const mutation = decision === 'approve' ? approve : reject;
    mutation.mutate(
      { projectId, submissionId: submission.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVideoSubmissionsQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetVideoProjectQueryKey(projectId) });
          // The Captain's desk reads this queue — keep it in sync when a
          // decision happens from a project page.
          queryClient.invalidateQueries({ queryKey: getListVideoReviewQueueQueryKey() });
          onClose();
        },
      },
    );
  };

  const isCaptain = project.data?.myRoles?.includes('CAPTAIN') ?? false;
  const decisionError = (approve.error ?? reject.error) as { response?: { data?: { error?: string } } } | null;

  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
  };

  const clipBlocks: TimelineBlock[] = clips.map((clip, index) => ({
    id: clip.id ?? `clip-${index}`,
    label: `#${index + 1}`,
    sublabel: `${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
    startMs: clip.inMs,
    endMs: clip.outMs,
    tone: 'accent',
  }));
  const durationMs = Math.max(60_000, ...clipBlocks.map((block) => block.endMs));

  const assetName = (id: string): string =>
    project.data?.assets.find((asset) => asset.id === id)?.fileName ?? id.slice(0, 8);

  return (
    <div className="paper-card accent-card mt-4" data-testid="review-panel">
      <div className="inline-heading">
        <span className="eyebrow"><GitPullRequest size={13} /> Pull request — {isAssetSubmission ? 'file upload' : `${leg.toLowerCase()} v${version.data?.version ?? '…'}`}</span>
        <span className="flex items-center gap-2">
          <span className={`den-tag ${submission.status === 'APPROVED' ? 'teal' : submission.status === 'REJECTED' ? 'danger' : 'gold'}`}>
            {submission.status}
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close review" data-testid="review-close">
            <X size={14} />
          </button>
        </span>
      </div>
      {submission.note && (
        <p className="setting-copy">
          {isAssetSubmission ? (
            <>
              “{submissionMessage ?? submissionFileName}”{' '}
              <span className="den-footnote">by {submission.submittedById.slice(0, 8)}</span>
            </>
          ) : (
            <>“{submission.note}” — by {submission.submittedById.slice(0, 8)}</>
          )}
        </p>
      )}

      {isAssetSubmission ? (
        <div className="mt-3" data-testid="review-asset">
          <div className="inline-heading">
            <span className="eyebrow"><FileUp size={13} /> {submissionFileName}</span>
            <span className="den-tag gold">awaiting your decision</span>
          </div>
          <p className="setting-copy mt-2">
            A file was handed in for review — it is held back from the vault until you decide.
          </p>
          <p className="setting-copy">
            <b>Accept</b> — moves the file into the project vault and starts processing it (proxy,
            transcription, previews) so the {leg.toLowerCase()} stage can use it.
          </p>
          <p className="setting-copy">
            <b>Reject</b> — deletes the file and sends it back to the submitter with your improvement note.
          </p>
          <p className="den-footnote mt-2">
            There is nothing to preview or diff yet: the file stays private until your decision.
          </p>
        </div>
      ) : !assetId ? (
        <p className="setting-copy mt-3">This version has no clips or designs to preview — open the diff below to review the pull request itself.</p>
      ) : (
        <div className="mt-3">
          {leg === 'THUMBNAIL' && design ? (
            <ImageStage
              src={proxyUrlFor(projectId, assetId)}
              title={`${assetName(assetId)} · thumbnail v${version.data?.version ?? ''}`}
            >
              <AnnotationCanvas
                projectId={projectId}
                leg={leg}
                assetId={assetId}
                playheadMs={null}
                timelineVersionId={submission.timelineVersionId}
                submissionId={submission.id}
              />
            </ImageStage>
          ) : (
            <AssetPlayer
              projectId={projectId}
              assetId={assetId}
              detail={detail.data}
              videoRef={videoRef}
              playheadMs={playheadMs}
              onTimeUpdate={setPlayheadMs}
              markers={markers}
              title={`${assetName(assetId)} · ${leg.toLowerCase()} v${version.data?.version ?? ''}`}
            >
              <AnnotationCanvas
                projectId={projectId}
                leg={leg}
                assetId={assetId}
                playheadMs={playheadMs}
                onSeek={onSeek}
                timelineVersionId={submission.timelineVersionId}
                submissionId={submission.id}
              />
            </AssetPlayer>
          )}
          {clipBlocks.length > 0 && (
            <div className="mt-3">
              <Timeline
                title={`Submitted cut — ${clips.length} clips`}
                hint="Click or drag the ruler to scrub the submitted version"
                blocks={clipBlocks}
                durationMs={durationMs}
                playheadMs={playheadMs}
                canEdit={false}
                scrubOnly
                onScrub={setPlayheadMs}
                activeId={activeBlockId(clipBlocks, playheadMs)}
              />
            </div>
          )}
          <p className="den-footnote mt-2">
            <Play size={12} />
            {leg === 'THUMBNAIL'
              ? 'Drop pins on the design frame to flag this review — every pin is scoped to this PR.'
              : 'Drag the ruler or play the video — drop pins on the frame to flag this review.'}
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {!isAssetSubmission && (
          <CommentsPanel projectId={projectId} leg={leg} submissionId={submission.id} timelineVersionId={submission.timelineVersionId} />
        )}
        {!hideDecision && (
          <div className="paper-card">
            <div className="inline-heading">
              <span className="eyebrow"><Clapperboard size={13} /> Decision</span>
            </div>
            <p className="setting-copy">
              Approving merges this version as the new baseline for the {leg.toLowerCase()} stage. Rejecting sends it back for another pass.
            </p>
            {isCaptain && isPending ? (
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => decide('approve')} disabled={approve.isPending || reject.isPending} className="secondary-btn" data-testid="review-approve">
                  <Check size={13} /> Approve — merge
                </button>
                <button type="button" onClick={() => decide('reject')} disabled={approve.isPending || reject.isPending} className="secondary-btn" data-testid="review-reject">
                  <X size={13} /> Reject
                </button>
              </div>
            ) : (
              <p className="setting-copy mt-3">
                {isPending ? 'Only the Captain can decide this review.' : 'This review is already decided.'}
              </p>
            )}
            {(approve.isError || reject.isError) && (
              <p className="setting-copy mt-2" role="alert">
                {decisionError?.response?.data?.error || 'The decision could not be saved.'}
              </p>
            )}
          </div>
        )}
      </div>

      {headVersionId && !isAssetSubmission && (
        <DiffView
          key={`${submission.id}-diff`}
          projectId={projectId}
          leg={leg}
          initialAId={headVersionId}
          initialBId={submission.timelineVersionId}
        />
      )}
    </div>
  );
}
