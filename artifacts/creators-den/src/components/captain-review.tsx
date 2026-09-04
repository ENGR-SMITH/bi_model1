// ---------------------------------------------------------------------------
// CaptainReviewSurface — the Captain's review workbench, matching the
// preview/video template pixel-for-pixel in the top area:
//
//   Top row  — the SAME two-column template as the preview pages:
//     · left column: the Big canvas with the Preview | Diff map toggle (and
//       diff settings) above it — the canvas body is the SAME shared
//       component the preview/video, preview/audio and preview/thumbnail
//       studios render (VideoStageCanvas / AudioStageCanvas /
//       ThumbnailStageCanvas from preview-canvas), so the desk's media can
//       never behave differently from the studios; above it sits the same
//       Preview | Diff map toggle, comparing the submitted version against a
//       chosen baseline.
//     · right column, split 50 : 50 — the submitter's DESCRIPTION (the
//       message they wrote when handing the stage in) on top, and the
//       Captain's REMARK note directly below it.
//   Bottom rows: the big Accept / Reject decision as two bare centered
//   buttons under the canvas (no card), then the same timeline-versions strip
//   the preview studios run under their canvas — clicking a version there
//   switches the diff baseline the submission is compared against.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, AudioLines, Image as ImageIcon, Play, Send } from 'lucide-react';
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
import { AssetPlayer, ImageStage, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  AudioStageCanvas,
  ThumbnailStageCanvas,
  VideoStageCanvas,
  type StageCanvasVersion,
} from '@/components/preview-canvas';
import {
  DEFAULT_AUDIO_DIFF_SETTINGS,
  DEFAULT_DIFF_SETTINGS,
  FullscreenButton,
  PreviewCanvasColumn,
  VersionCarousel,
  WaveformPlayer,
  type CarouselItem,
  type DiffSettings,
  type PreviewView,
} from '@/components/preview-shared';
import { formatTimecode } from '@/components/timeline';
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import { ReviewDecisionBar, ReviewRemarkCard } from '@/components/review-actions';
import type { StudioLeg } from '@/components/role-oracle';
import { RELAY_LEGS } from '@/components/shell';

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

type Marker = { id: string; ms: number; tone: 'danger' | 'teal'; label?: string };

// ---------------------------------------------------------------------------
// ReviewMediaStage — the Big canvas for a VERSION submission. This is a thin
// wrapper over the SAME shared stage canvases the preview studios run
// (preview-canvas.tsx), scoped to the review:
//   · the version object is the submitted version (submission.timelineVersionId),
//   · `submissionId` makes the shared canvas show only THIS submission's
//     notes as markers/pins instead of the whole leg's notes,
//   · the empty-state wording stays review-specific ("…in this hand-in yet.").
// There is deliberately NO canvas logic here anymore — it lives once, in the
// shared component the working video/audio/thumbnail studios render.
// ---------------------------------------------------------------------------

function ReviewMediaStage({
  projectId,
  submission,
  leg,
  version,
  snapshot,
  assets,
  annotationHeaderRef,
}: {
  projectId: string;
  submission: VideoSubmission;
  leg: StudioLeg;
  /** Submitted version number (v2, v3…) for the canvas label. */
  version: number | null;
  /** The submitted version's snapshot (its timeline document). */
  snapshot: unknown;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** The annotate pencil portals here (shared with the diff map's pencil). */
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
}) {
  const stageVersion: StageCanvasVersion | null =
    version == null
      ? null
      : {
          id: submission.timelineVersionId,
          leg,
          version,
          snapshot: snapshot ?? null,
        };
  const emptyTitle =
    leg === 'SOUND'
      ? 'No audio in this hand-in yet.'
      : leg === 'THUMBNAIL'
        ? 'No design in this hand-in yet.'
        : 'No video in this hand-in yet.';
  const common = {
    projectId,
    version: stageVersion,
    assets,
    annotationHeaderRef,
    submissionId: submission.id,
    emptyTitle,
  };

  if (leg === 'SOUND') return <AudioStageCanvas {...common} />;
  if (leg === 'THUMBNAIL') return <ThumbnailStageCanvas {...common} />;
  return <VideoStageCanvas {...common} />;
}

// ---------------------------------------------------------------------------
// ReviewFileStage — the Big canvas for a FILE submission (submit-for-review
// uploads held as PENDING_REVIEW). The staged original streams straight from
// the server (the proxy route now serves pending files to members) so the
// Captain reviews the actual submission in the same canvas as everything else.
// There is no snapshot to diff yet — the toggle simply stays on Preview, and
// Accept moves the file into the vault / Reject deletes it.
// ---------------------------------------------------------------------------

function ReviewFileStage({
  projectId,
  submission,
  leg,
  assetId,
  detail,
  annotationHeaderRef,
}: {
  projectId: string;
  submission: VideoSubmission;
  leg: StudioLeg;
  /** The staged pending asset id (from the `ASSET:` sentinel). */
  assetId: string;
  detail?: VideoAssetDetail;
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);
  const fileParts = fileSubmissionParts(submission);

  // Media kind of the staged file drives the player (audio wave / image frame
  // / video with its own native controls).
  const kind = detail?.kind ?? '';
  const mime = detail?.mimeType ?? '';
  const isAudio = AUDIO_KINDS.has(kind);
  const isImage = !isAudio && (IMAGE_KINDS.has(kind) || mime.startsWith('image/'));

  const markers = useMemo<Marker[]>(
    () =>
      (comments.data ?? [])
        .filter((c) => c.timecodeMs != null && c.submissionId === submission.id && c.assetId === assetId)
        .map((c) => ({ id: c.id, ms: c.timecodeMs as number, tone: 'danger' as const, label: c.label ?? undefined })),
    [comments.data, submission.id, assetId],
  );

  const directStreamUrl = proxyUrlFor(projectId, assetId);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="captain-review-file">
      <div className="inline-heading">
        <span className="eyebrow">
          {isAudio ? <AudioLines size={13} /> : isImage ? <ImageIcon size={13} /> : <Play size={13} />}
          Big canvas · {fileParts.fileName}
        </span>
        {!isAudio && !isImage && (
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
        )}
      </div>
      <div className="pv-stage-player mt-2">
        {isImage ? (
          <ImageStage src={directStreamUrl}>
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              glowPins
            />
            <FullscreenButton targetRef={stageRef} />
          </ImageStage>
        ) : isAudio ? (
          <WaveformPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            onPlayheadChange={setPlayheadMs}
            markers={markers}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={setPlayheadMs}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              dropLine
            />
            <FullscreenButton targetRef={stageRef} />
          </WaveformPlayer>
        ) : (
          <AssetPlayer
            projectId={projectId}
            assetId={assetId}
            detail={detail}
            videoRef={videoRef}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            markers={markers}
            directStreamUrl={directStreamUrl}
          >
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={assetId}
              playheadMs={playheadMs}
              onSeek={setPlayheadMs}
              timelineVersionId={submission.timelineVersionId}
              submissionId={submission.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
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
  const leg = submission.leg as StudioLeg;
  // A file handed in for review carries an `ASSET:<assetId>` sentinel — there
  // is no snapshot to play or diff until the Captain decides (accept moves it
  // into the vault, reject deletes it and sends it back).
  const isAssetSubmission = submission.timelineVersionId.startsWith('ASSET:');
  const pendingAssetId = isAssetSubmission ? submission.timelineVersionId.slice('ASSET:'.length) : '';
  const fileParts = isAssetSubmission ? fileSubmissionParts(submission) : null;

  // The submitted version + the leg's head version (diff baseline).
  const version = useGetVideoTimelineVersion(projectId, leg, submission.timelineVersionId, {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, leg, submission.timelineVersionId),
      enabled: !isAssetSubmission,
    },
  });
  const legVersions = useListVideoTimelineVersions(projectId, leg);

  // The staged pending file's detail — only for file submissions (it has no
  // proxy row and never transitions to PROCESSED, so no polling loop).
  const pendingDetail = useGetVideoAsset(projectId, pendingAssetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, pendingAssetId),
      enabled: isAssetSubmission && Boolean(pendingAssetId),
    },
  });

  // ---- The diff map: the submitted version vs a chosen baseline (defaults
  // to the leg's head — the last approved version). The version strip below
  // the canvas can pick any other version as the baseline. ----
  const audioLeg = leg === 'SOUND';
  const [view, setView] = useState<PreviewView>('preview');
  const [diffSettings, setDiffSettings] = useState<DiffSettings>(
    audioLeg ? DEFAULT_AUDIO_DIFF_SETTINGS : DEFAULT_DIFF_SETTINGS,
  );
  const [baselineVersionId, setBaselineVersionId] = useState<string | null>(null);
  const baselineId = baselineVersionId ?? headVersionId;

  const diffVersions = useMemo<PreviewDiffSelection[]>(() => {
    if (isAssetSubmission) return [];
    const rows = legVersions.data ?? [];
    const submitted = rows.find((v) => v.id === submission.timelineVersionId);
    const baseline = baselineId ? rows.find((v) => v.id === baselineId) : null;
    // A submission pinned straight onto the (only) baseline has nothing to
    // compare against.
    if (!submitted || !baseline || baseline.id === submitted.id) return [];
    return [
      {
        key: `version-${baseline.id}`,
        id: baseline.id,
        leg,
        kind: 'version',
        version: baseline.version,
        parentVersionId: baseline.parentVersionId ?? null,
        createdAt: baseline.createdAt,
      },
      {
        key: `version-${submitted.id}`,
        id: submitted.id,
        leg,
        kind: 'version',
        version: submitted.version,
        // Point at the baseline so the pair diffs submission vs it even when
        // the submission was saved on top of an older snapshot.
        parentVersionId: baseline.id,
        createdAt: submitted.createdAt,
      },
    ];
  }, [isAssetSubmission, baselineId, legVersions.data, leg, submission.timelineVersionId]);

  const activeSelection: PreviewDiffSelection | null = diffVersions[1] ?? null;
  const hasDiff = Boolean(activeSelection && predecessorOf(diffVersions, activeSelection));

  // Open the column on the diff map when a comparison exists (the preview
  // studios do the same), otherwise keep the plain preview.
  const viewInitializedRef = useRef(false);
  useEffect(() => {
    if (viewInitializedRef.current) return;
    if (isAssetSubmission || (legVersions.data?.length ?? 0) === 0) return;
    viewInitializedRef.current = true;
    setView(hasDiff ? 'diff' : 'preview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDiff, isAssetSubmission, legVersions.data?.length]);
  // If the picked baseline suddenly has nothing to compare (e.g. the submitted
  // version itself was picked), fall back to the plain preview.
  useEffect(() => {
    if (!hasDiff) setView('preview');
  }, [hasDiff]);

  // Fallback assets of the right media kind — for the diff map when either
  // snapshot references no explicit clip/design (or references media that
  // left the vault). Playable (PROCESSED) files first, newest first, and no
  // pending-review uploads: the diff must never try to stream a proxy that
  // can't exist yet, which is what made the desk's canvas 404 while the same
  // footage played fine in the vault.
  const assets = project.data?.assets ?? [];
  const mediaKinds = leg === 'SOUND' ? AUDIO_KINDS : leg === 'THUMBNAIL' ? IMAGE_KINDS : VIDEO_KINDS;
  const fallbackAssetIds = useMemo(
    () =>
      assets
        .filter((a) => mediaKinds.has(a.kind) && a.status !== 'PENDING_REVIEW')
        .sort((a, b) => {
          const playable = (x: { status: string }) => (x.status === 'PROCESSED' ? 0 : 1);
          return playable(a) - playable(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets],
  );

  const versionNo = version.data?.version ?? null;
  const annotationHeaderRef = useRef<HTMLDivElement>(null);

  // The timeline-versions strip under the canvas — the same row the preview
  // studios run. The submitted card is the active one; picking any other card
  // makes the diff map compare the submission against that version instead of
  // the leg's head. (File submissions have no version to pin, so no strip.)
  const carouselItems = useMemo<CarouselItem[]>(() => {
    if (isAssetSubmission) return [];
    return (legVersions.data ?? [])
      .map((v) => ({
        key: `version-${v.id}`,
        kind: 'version' as const,
        id: v.id,
        leg,
        version: v.version,
        message: v.message ?? '',
        createdAt: v.createdAt,
        isHead: Boolean(headVersionId && v.id === headVersionId),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssetSubmission, legVersions.data, leg, headVersionId]);

  const onVersionStripSelect = (key: string) => {
    if (!key.startsWith('version-')) return;
    const id = key.slice('version-'.length);
    // Clicking the submitted card again returns to the leg's head baseline.
    setBaselineVersionId(id === submission.timelineVersionId ? null : id);
  };

  let canvasBody: ReactNode;
  if (isAssetSubmission) {
    canvasBody = (
      <ReviewFileStage
        projectId={projectId}
        submission={submission}
        leg={leg}
        assetId={pendingAssetId}
        detail={pendingDetail.data}
        annotationHeaderRef={annotationHeaderRef}
      />
    );
  } else {
    canvasBody = (
      <ReviewMediaStage
        projectId={projectId}
        submission={submission}
        leg={leg}
        version={versionNo}
        snapshot={version.data?.snapshot ?? null}
        assets={assets}
        annotationHeaderRef={annotationHeaderRef}
      />
    );
  }

  return (
    <div className="page pv-page review-page" data-testid="review-workbench">
      {/* Slim back control above the grid — the column header itself is the
          exact preview/video head (Big canvas eyebrow + annotate + toggle). */}
      <div className="review-topbar">
        <button
          type="button"
          className="pv-review-back"
          onClick={onBack}
          title="Back to the queue"
          aria-label="Back to the queue"
          data-testid="review-back"
        >
          <ArrowLeft size={14} />
        </button>
      </div>

      <div className="pv-top">
        {/* First column — the Big canvas with Preview | Diff map, exactly like
            the preview pages. */}
        <div className="pv-canvas-col">
          <PreviewCanvasColumn
            view={view}
            onViewChange={setView}
            hasDiff={hasDiff}
            eyebrow={<span className="eyebrow">Big canvas</span>}
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

        {/* Second column — the submitter's DESCRIPTION on top and the
            Captain's REMARK below it, each card taking half of the rail. */}
        <div className="pv-notes-col review-rail">
          <div className="paper-card review-submission-card pv-notes" data-testid="captain-review-description">
            <div className="inline-heading">
              <span className="eyebrow"><Send size={13} /> Submitted for review</span>
              <span className={`den-tag ${LEG_TONES[leg] ?? 'muted'}`}>{legLabel(leg)}</span>
            </div>
            <blockquote className="review-description-text">
              {isAssetSubmission ? fileParts?.message || '—' : submission.note || '—'}
            </blockquote>
          </div>
          <ReviewRemarkCard note={note} onChange={onNoteChange} />
        </div>
      </div>

      {/* Decision — the big Accept / Reject pair, floating centered under the
          canvas (no card around them). */}
      <ReviewDecisionBar
        projectId={projectId}
        submissionId={submission.id}
        note={note}
        onDecided={onDecided}
      />

      {/* The timeline-versions strip — same spot as the preview studios'
          carousel row; picking a card switches the diff baseline. */}
      {carouselItems.length > 0 && (
        <div className="pv-versions-row">
          <VersionCarousel
            items={carouselItems}
            activeKey={`version-${submission.timelineVersionId}`}
            onSelect={onVersionStripSelect}
            emptyText={`No ${legLabel(leg)} versions saved on the timeline yet.`}
          />
        </div>
      )}
    </div>
  );
}
