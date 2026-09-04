// ---------------------------------------------------------------------------
// CaptainReviewSurface — the Captain's review workbench, restructured on the
// preview/video template:
//
//   Top row  — the SAME two-column template as the preview pages:
//     · left column: the Big canvas with the Preview | Diff map toggle (and
//       diff settings) above it — the submitted version plays with review
//       pins scoped to this pull request, and the diff map compares it
//       against the leg's head baseline.
//     · right column: instead of the pin/comment wall, the DESCRIPTION the
//       submitter wrote when handing the stage in (plus the PR review notes
//       dropped on the canvas, so pins stay visible).
//   Bottom row (where the preview pages run the version carousel) — split
//     into two cards: the big Accept / Reject decision on the left and the
//     REMARK (improvement note, AI-polished) on the right.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, AudioLines, Clapperboard, FileUp, GitPullRequest, MessageSquare, Play, Send } from 'lucide-react';
import {
  getGetVideoAssetQueryKey,
  getGetVideoTimelineVersionQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimelineVersion,
  useListVideoComments,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import type { VideoAssetDetail, VideoSubmission } from '@workspace/api-client-react';
import { AssetPlayer, EmptyPlayer, ImageStage, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  DEFAULT_AUDIO_DIFF_SETTINGS,
  DEFAULT_DIFF_SETTINGS,
  PreviewCanvasColumn,
  WaveformPlayer,
  type DiffSettings,
  type PreviewView,
} from '@/components/preview-shared';
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import { ReviewDecisionCard, ReviewRemarkCard } from '@/components/review-actions';
import type { StudioLeg } from '@/components/role-oracle';
import { RELAY_LEGS } from '@/components/shell';
import { reviewerColor, reviewerLabel } from '@/lib/annotations';

const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);
const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);

const LEG_TONES: Record<string, string> = {
  SELECTS: 'gold',
  CUT: 'accent',
  SOUND: 'teal',
  FINISH: 'muted',
  THUMBNAIL: 'accent',
};

function legLabel(leg: string): string {
  return RELAY_LEGS.find((relay) => relay.leg === leg)?.label ?? leg;
}

function timeAgo(iso: string | Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** A file handed in for review carries `ASSET:<assetId>`; its note leads with
    the file name ("golden-a.mp4 — Best angle of the hero shot."). */
function fileSubmissionParts(submission: VideoSubmission): { fileName: string; message: string } {
  const note = submission.note ?? '';
  const fileName = note.split(' — ')[0] || 'File submission';
  return {
    fileName,
    message: note.includes(' — ') ? note.slice(note.indexOf(' — ') + 3).trim() : '',
  };
}

// ---------------------------------------------------------------------------
// The media stage — one version's clips/designs playing with review pins.
// Matches the preview pages' canvas: video plays in the frame player (audio
// legs in the waveform player, THUMBNAIL as a design frame), pins drop
// scoped to this submission and land on the review-notes rail.
// ---------------------------------------------------------------------------

function ReviewMediaStage({
  projectId,
  submission,
  assetId,
  detail,
  leg,
  isAudio,
  playheadMs,
  onSeek,
  annotationHeaderRef,
  markers,
}: {
  projectId: string;
  submission: VideoSubmission;
  assetId: string;
  detail?: VideoAssetDetail;
  leg: StudioLeg;
  /** Whether the resolved asset is an audio file (waveform view). */
  isAudio: boolean;
  playheadMs: number;
  onSeek: (ms: number) => void;
  /** The annotate pencil portals here (shared with the diff map's pencil). */
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
  /** Review markers: this PR's timecode comments on the asset. */
  markers: Array<{ id: string; ms: number; tone: 'accent' | 'gold' | 'danger' | 'teal' | 'muted'; label?: string }>;
}) {
  return (
    <div className="paper-card pv-stage" data-testid="captain-review-media">
      <div className="inline-heading">
        <span className="eyebrow">
          {isAudio ? <AudioLines size={13} /> : leg === 'THUMBNAIL' ? <Clapperboard size={13} /> : <Play size={13} />}
          Big canvas · {legLabel(leg)}
        </span>
        <span className="flex items-center gap-2">
          <span className="den-tag gold">submitted for review</span>
        </span>
      </div>
      <div className="pv-stage-player mt-2">
        {leg === 'THUMBNAIL' ? (
          <ImageStage
            src={proxyUrlFor(projectId, assetId)}
            title={`${legLabel(leg)} design — submitted for review`}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              glowPins
            />
          </ImageStage>
        ) : isAudio ? (
          <WaveformPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            onPlayheadChange={onSeek}
            markers={markers}
            title={`${legLabel(leg)} — submitted for review`}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              dropLine
            />
          </WaveformPlayer>
        ) : (
          <AssetPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail}
            playheadMs={playheadMs}
            onTimeUpdate={onSeek}
            markers={markers}
            title={`${legLabel(leg)} — submitted for review`}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={onSeek}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              timecodeReveal
              glowPins
            />
          </AssetPlayer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export function CaptainReviewSurface({
  projectId,
  submission,
  headVersionId,
  note,
  onNoteChange,
  onDecided,
  onBack,
}: {
  projectId: string;
  submission: VideoSubmission;
  /** The submission's leg's head version id — the diff baseline. */
  headVersionId: string | null;
  /** The REMARK the Captain is drafting (shared by the two bottom cards). */
  note: string;
  onNoteChange: (note: string) => void;
  onDecided: (decision: 'APPROVED' | 'REJECTED') => void;
  /** Back to the queue. */
  onBack: () => void;
}) {
  const project = useGetVideoProject(projectId);
  const comments = useListVideoComments(projectId);
  const leg = submission.leg as StudioLeg;
  const isPending = submission.status === 'SUBMITTED';
  // A file handed in for review carries an `ASSET:<assetId>` sentinel — there
  // is no snapshot to play or diff until the Captain decides (accept moves it
  // into the vault, reject deletes it and sends it back).
  const isAssetSubmission = submission.timelineVersionId.startsWith('ASSET:');
  const fileParts = isAssetSubmission ? fileSubmissionParts(submission) : null;

  // The submitted version + the leg's head version (diff baseline).
  const version = useGetVideoTimelineVersion(projectId, leg, submission.timelineVersionId, {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, leg, submission.timelineVersionId),
      enabled: !isAssetSubmission,
    },
  });
  const legVersions = useListVideoTimelineVersions(projectId, leg);

  // Media-friendly snapshot shape so the canvas only reads what it needs —
  // clips (video/audio legs), designs (THUMBNAIL), music/pickups (SOUND).
  type ReviewSnapshot = {
    clips?: Array<{ id?: string; assetId?: string; inMs: number; outMs: number }>;
    designs?: Array<{ assetId?: string }>;
    music?: Array<{ id?: string; assetId?: string }>;
    pickups?: Array<{ id?: string; assetId?: string }>;
  };
  const snapshot = (version.data?.snapshot ?? null) as ReviewSnapshot | null;
  const clips = useMemo(() => (Array.isArray(snapshot?.clips) ? snapshot!.clips! : []), [snapshot]);
  const design = Array.isArray(snapshot?.designs) ? snapshot!.designs![0] ?? null : null;
  const soundMusic = Array.isArray(snapshot?.music) ? snapshot!.music! : [];
  const soundPickups = Array.isArray(snapshot?.pickups) ? snapshot!.pickups! : [];

  // Resolve the media to play: the snapshot's first clip / design, validated
  // against the vault, then a processed fallback of the right media kind.
  const assets = project.data?.assets ?? [];
  const validAsset = (id?: string | null): string =>
    id && assets.some((a) => a.id === id) ? id : '';
  const mediaKinds = leg === 'SOUND' ? AUDIO_KINDS : leg === 'THUMBNAIL' ? IMAGE_KINDS : VIDEO_KINDS;
  const fallbackAsset =
    assets.find((a) => mediaKinds.has(a.kind) && a.status === 'PROCESSED')?.id ??
    assets.find((a) => mediaKinds.has(a.kind))?.id ??
    '';
  const assetId = isAssetSubmission
    ? ''
    : leg === 'THUMBNAIL'
      ? validAsset(design?.assetId) || fallbackAsset
      : validAsset(clips[0]?.assetId) ||
        (leg === 'SOUND' ? validAsset(soundMusic[0]?.assetId) || validAsset(soundPickups[0]?.assetId) : '') ||
        fallbackAsset;

  const detail = useGetVideoAsset(projectId, assetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId),
      enabled: Boolean(assetId) && !isAssetSubmission,
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  // Media kind drives the surface: audio files play in the waveform player.
  const assetKind = assets.find((a) => a.id === assetId)?.kind ?? '';
  const isAudio = AUDIO_KINDS.has(assetKind);

  const [playheadMs, setPlayheadMs] = useState(0);
  const onSeek = (ms: number) => setPlayheadMs(ms);
  const annotationHeaderRef = useRef<HTMLDivElement>(null);

  // Review markers on the media: this PR's timecode comments on the current
  // asset, drawn as a clickable rail under the frame.
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

  // ---- The diff map: the submitted version vs the leg's head baseline ----
  const audioLeg = leg === 'SOUND';
  const [view, setView] = useState<PreviewView>('preview');
  const [diffSettings, setDiffSettings] = useState<DiffSettings>(
    audioLeg ? DEFAULT_AUDIO_DIFF_SETTINGS : DEFAULT_DIFF_SETTINGS,
  );

  const diffVersions = useMemo<PreviewDiffSelection[]>(() => {
    // A submission pinned straight onto the head has nothing older to compare.
    if (isAssetSubmission || !headVersionId || headVersionId === submission.timelineVersionId) return [];
    const rows = legVersions.data ?? [];
    const head = rows.find((v) => v.id === headVersionId);
    const submitted = rows.find((v) => v.id === submission.timelineVersionId);
    if (!head || !submitted) return [];
    return [
      {
        key: `version-${head.id}`,
        id: head.id,
        leg,
        kind: 'version',
        version: head.version,
        parentVersionId: head.parentVersionId ?? null,
        createdAt: head.createdAt,
      },
      {
        key: `version-${submitted.id}`,
        id: submitted.id,
        leg,
        kind: 'version',
        version: submitted.version,
        // Point at the head so the pair diffs submission vs baseline even when
        // the submission was saved on top of an older snapshot.
        parentVersionId: head.id,
        createdAt: submitted.createdAt,
      },
    ];
  }, [isAssetSubmission, headVersionId, legVersions.data, leg, submission.timelineVersionId]);

  const activeSelection: PreviewDiffSelection | null = diffVersions[1] ?? null;
  const hasDiff = Boolean(activeSelection && predecessorOf(diffVersions, activeSelection));

  // Fallback assets of the right media kind — for the diff map when either
  // snapshot references no explicit clip/design.
  const fallbackAssetIds = useMemo(
    () => assets.filter((a) => mediaKinds.has(a.kind)).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets],
  );

  // The right rail: who/what was submitted (the DESCRIPTION), then the PR
  // review notes dropped on the canvas — so pins stay visible while the
  // description is the focus of the column.
  const memberNameById = useMemo(
    () => new Map((project.data?.members ?? []).map((member) => [member.userId, member.name])),
    [project.data?.members],
  );
  const submitterName =
    memberNameById.get(submission.submittedById) ?? submission.submittedById.slice(0, 8);
  const railNotes = useMemo(
    () => (comments.data ?? []).filter((comment) => comment.submissionId === submission.id),
    [comments.data, submission.id],
  );
  const versionNo = version.data?.version ?? null;

  // A file held for review can't play or diff until a decision — the canvas
  // column explains the hold instead.
  let canvasBody: ReactNode;
  if (isAssetSubmission) {
    canvasBody = (
      <div className="paper-card pv-stage" data-testid="captain-review-file">
        <div className="inline-heading">
          <span className="eyebrow"><FileUp size={13} /> {fileParts?.fileName}</span>
          <span className="den-tag gold">awaiting your decision</span>
        </div>
        <p className="setting-copy mt-3">
          A file was handed in for review — it is held back from the vault until you decide.
          <b> Accept</b> moves it into the project vault and starts processing it (proxy,
          transcription, previews). <b>Reject</b> deletes the file and sends it back with your REMARK.
        </p>
        <p className="den-footnote mt-3">
          There is nothing to preview or diff yet — the file stays private until your decision.
        </p>
      </div>
    );
  } else if (!assetId) {
    canvasBody = (
      <div className="paper-card pv-stage" data-testid="captain-review-empty">
        <div className="pv-stage-player">
          <EmptyPlayer>
            <p className="text-sm font-semibold">This submission has no media to preview.</p>
            <p className="text-xs opacity-70">Open the diff map below to review the pull request itself.</p>
          </EmptyPlayer>
        </div>
      </div>
    );
  } else {
    canvasBody = (
      <ReviewMediaStage
        projectId={projectId}
        submission={submission}
        assetId={assetId}
        detail={detail.data}
        leg={leg}
        isAudio={isAudio}
        playheadMs={playheadMs}
        onSeek={onSeek}
        annotationHeaderRef={annotationHeaderRef}
        markers={markers}
      />
    );
  }

  return (
    <div className="page pv-page review-page" data-testid="review-workbench">
      <div className="review-toolbar">
        <button type="button" className="link-btn" onClick={onBack} data-testid="review-back">
          <ArrowLeft size={13} /> Back to the queue
        </button>
        <span className={`den-tag ${LEG_TONES[leg] ?? 'muted'}`}>{legLabel(leg)}</span>
        <span className="mono-label truncate">
          {isAssetSubmission ? fileParts?.fileName : `${legLabel(leg)} v${versionNo ?? '…'} submitted`}
        </span>
        <span className="den-tag gold ml-auto">
          <GitPullRequest size={11} /> {submission.status}
        </span>
      </div>

      <div className="pv-top">
        {/* First column — the Big canvas with Preview | Diff map, exactly like
            the preview pages. */}
        <div className="pv-canvas-col">
          <PreviewCanvasColumn
            view={view}
            onViewChange={setView}
            hasDiff={hasDiff}
            eyebrow={<span className="eyebrow"><Clapperboard size={13} /> Big canvas</span>}
            annotationHeaderRef={annotationHeaderRef}
            settings={hasDiff ? diffSettings : undefined}
            onSettingsChange={hasDiff ? setDiffSettings : undefined}
            settingsKind={audioLeg ? 'audio' : 'pixel'}
            preview={canvasBody}
            diff={
              hasDiff && activeSelection ? (
                <PreviewDiff
                  projectId={projectId}
                  leg={leg}
                  versions={diffVersions}
                  selected={activeSelection}
                  fallbackAssetIds={fallbackAssetIds}
                  settings={diffSettings}
                  onSettingsChange={setDiffSettings}
                  annotationHeaderRef={annotationHeaderRef}
                />
              ) : null
            }
          />
        </div>

        {/* Second column — the submitter's DESCRIPTION (replaces the preview
            pages' comment wall), with the PR review notes beneath it. */}
        <div className="pv-notes-col">
          <div className="paper-card review-submission-card" data-testid="captain-review-description">
            <div className="inline-heading">
              <span className="eyebrow"><Send size={13} /> Submitted for review</span>
              <span className={`den-tag ${LEG_TONES[leg] ?? 'muted'}`}>{legLabel(leg)}</span>
            </div>
            {isAssetSubmission ? (
              <div className="review-description-file">
                <FileUp size={14} /> <b>{fileParts?.fileName}</b>
              </div>
            ) : (
              <p className="setting-copy mt-1">
                {legLabel(leg)} <b>v{versionNo ?? '…'}</b> handed in{headVersionId ? ' against the approved baseline' : ''}.
              </p>
            )}
            <blockquote className="review-description-text">
              {isAssetSubmission
                ? fileParts?.message || 'No description was attached — just the file.'
                : submission.note || 'No description was attached to this submission.'}
            </blockquote>
            <p className="den-footnote mt-2">
              by <b>{submitterName}</b> · {timeAgo(submission.createdAt)}
              {isPending ? ' · waiting on your decision' : ''}
            </p>
          </div>

          <div className="paper-card pv-notes review-rail-notes" data-testid="captain-review-notes">
            <div className="inline-heading">
              <span className="eyebrow"><MessageSquare size={13} /> Review notes</span>
              <span className="mono-label">{railNotes.length}</span>
            </div>
            {railNotes.length === 0 ? (
              <p className="setting-copy mt-3">
                No notes on this review yet — pin feedback straight on the media: the annotate
                pencil sits in the canvas header above.
              </p>
            ) : (
              <div className="den-stack mt-3">
                {railNotes.map((comment) => {
                  const color = reviewerColor(comment.authorId);
                  return (
                    <div key={comment.id} className={`list-row pv-comment-row ${comment.resolvedAt ? 'is-resolved' : ''}`} data-testid={`captain-review-note-${comment.id}`}>
                      <span
                        className="annotation-pin-dot"
                        style={{ background: comment.resolvedAt ? 'hsl(150 52% 42%)' : color, width: 18, height: 18, fontSize: 9 }}
                      >
                        {reviewerLabel(comment.authorId)}
                      </span>
                      <span>
                        <b className="mono-label !text-[9px]">
                          <span style={{ color: comment.resolvedAt ? 'hsl(150 52% 42%)' : color }}>
                            {memberNameById.get(comment.authorId) ?? comment.authorId.slice(0, 8)}
                          </span>
                          {comment.resolvedAt && <span className="den-tag resolved">resolved</span>}
                        </b>
                        <small className="!normal-case">{comment.body}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row — where the preview pages run the version carousel: the
          big Accept / Reject decision and the REMARK improvement note. */}
      <div className="review-bottom-row">
        <ReviewDecisionCard
          projectId={projectId}
          submissionId={submission.id}
          note={note}
          onDecided={onDecided}
        />
        <ReviewRemarkCard note={note} onChange={onNoteChange} />
      </div>
    </div>
  );
}
