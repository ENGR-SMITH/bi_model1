// ---------------------------------------------------------------------------
// CaptainReviewSurface — the Captain's review workbench, matching the
// preview/video template pixel-for-pixel in the top area:
//
//   Top row  — the SAME two-column template as the preview pages:
//     · left column: the Big canvas with the Preview | Diff map toggle (and
//       diff settings) above it — exactly the preview/video canvas (media +
//       timecode + markers + pins, clips switching as the playhead moves),
//       comparing the submitted version against the leg's head baseline.
//     · right column: the submitter's DESCRIPTION — the message they wrote
//       when handing the stage in.
//   Bottom row (where the preview pages run the version carousel) — split
//     into two cards: the big Accept / Reject decision on the left and the
//     REMARK note on the right.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
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
import { AssetPlayer, EmptyPlayer, ImageStage, pollWhileProcessing, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  DEFAULT_AUDIO_DIFF_SETTINGS,
  DEFAULT_DIFF_SETTINGS,
  FullscreenButton,
  PreviewCanvasColumn,
  WaveformPlayer,
  type DiffSettings,
  type PreviewView,
} from '@/components/preview-shared';
import { formatTimecode } from '@/components/timeline';
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import { ReviewDecisionCard, ReviewRemarkCard } from '@/components/review-actions';
import type { StudioLeg } from '@/components/role-oracle';
import { RELAY_LEGS } from '@/components/shell';
import { activeClipAt, type TimelineSnapshotLike } from '@/lib/diff';

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

type ReviewSnapshot = {
  clips?: Array<{ id?: string; assetId: string; inMs: number; outMs: number }>;
  designs?: Array<{ assetId?: string }>;
  music?: Array<{ id?: string; assetId: string; inMs: number; outMs: number }>;
  pickups?: Array<{ id?: string; assetId: string; timeMs: number }>;
};

// ---------------------------------------------------------------------------
// ReviewMediaStage — the SAME Big canvas as the preview/video page, for a
// version submission: the snapshot's clip at the playhead streams in the
// frame player (audio legs in the waveform player, THUMBNAIL as a design
// frame), switching clips as the playhead moves, with the playhead timecode
// in the card header, review pins on the frame, and timecode markers under it.
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
  snapshot: ReviewSnapshot | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** The annotate pencil portals here (shared with the diff map's pencil). */
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
}) {
  const [playheadMs, setPlayheadMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const comments = useListVideoComments(projectId);

  const clips = useMemo(() => (Array.isArray(snapshot?.clips) ? snapshot!.clips! : []), [snapshot]);
  const design = Array.isArray(snapshot?.designs) ? snapshot!.designs![0] ?? null : null;
  const music = Array.isArray(snapshot?.music) ? snapshot!.music! : [];
  const pickups = Array.isArray(snapshot?.pickups) ? snapshot!.pickups! : [];

  // Follow the playhead into the right clip, exactly like preview/video.
  const activeClip = activeClipAt({ clips } as TimelineSnapshotLike, playheadMs) ?? clips[0] ?? null;

  const mediaKinds = leg === 'SOUND' ? AUDIO_KINDS : leg === 'THUMBNAIL' ? IMAGE_KINDS : VIDEO_KINDS;
  const fallbackAsset =
    assets.find((a) => mediaKinds.has(a.kind) && a.status === 'PROCESSED')?.id ??
    assets.find((a) => mediaKinds.has(a.kind))?.id ??
    '';
  const clipAssetId = activeClip?.assetId && assets.some((a) => a.id === activeClip.assetId) ? activeClip.assetId : '';
  const assetId =
    leg === 'THUMBNAIL'
      ? (design?.assetId && assets.some((a) => a.id === design.assetId) ? design.assetId : '') || fallbackAsset
      : clipAssetId ||
        (leg === 'SOUND'
          ? (music[0]?.assetId && assets.some((a) => a.id === music[0].assetId) ? music[0].assetId : '') ||
            (pickups[0]?.assetId && assets.some((a) => a.id === pickups[0].assetId) ? pickups[0].assetId : '')
          : '') ||
        fallbackAsset;

  const detail = useGetVideoAsset(projectId, assetId, {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, assetId),
      enabled: Boolean(assetId),
      // Keep fetching until the proxy finishes, then stop on its own — same
      // behaviour as the vault player.
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });
  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };
  const assetKind = assets.find((a) => a.id === assetId)?.kind ?? '';
  const isAudio = AUDIO_KINDS.has(assetKind);

  // Red ticks = annotation timecodes for this PR on the asset; teal ticks =
  // clip boundaries — the exact marker set the preview pages draw.
  const markers = useMemo<Marker[]>(() => {
    const list: Marker[] = [];
    for (const comment of comments.data ?? []) {
      if (comment.timecodeMs == null || comment.submissionId !== submission.id || comment.assetId !== assetId) continue;
      list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
    }
    clips.forEach((clip, index) => list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' }));
    if (leg === 'SOUND') {
      music.forEach((track, index) => list.push({ id: `music-${index}`, ms: track.inMs, tone: 'teal' }));
      pickups.forEach((pickup, index) => list.push({ id: `pickup-${index}`, ms: pickup.timeMs, tone: 'danger' }));
    }
    return list;
  }, [comments.data, submission.id, assetId, clips, leg, music, pickups]);

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="captain-review-media">
      <div className="inline-heading">
        <span className="eyebrow">
          {leg === 'THUMBNAIL' ? <ImageIcon size={13} /> : isAudio ? <AudioLines size={13} /> : <Play size={13} />}
          Big canvas{version ? ` · ${leg} v${version}` : ''}
        </span>
        {!isAudio && leg !== 'THUMBNAIL' && (
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
        )}
      </div>
      <div className="pv-stage-player mt-2">
        {assetId ? (
          leg === 'THUMBNAIL' ? (
            <ImageStage src={proxyUrlFor(projectId, assetId)}>
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
              detail={detail.data}
              playheadMs={playheadMs}
              onTimeUpdate={onSeek}
              onPlayheadChange={onSeek}
              markers={markers}
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
                surfaceRef={stageRef}
                dropLine
              />
              <FullscreenButton targetRef={stageRef} />
            </WaveformPlayer>
          ) : (
            <AssetPlayer
              projectId={projectId}
              assetId={assetId}
              detail={detail.data}
              videoRef={videoRef}
              playheadMs={playheadMs}
              onTimeUpdate={setPlayheadMs}
              markers={markers}
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
                surfaceRef={stageRef}
                timecodeReveal
                glowPins
              />
            </AssetPlayer>
          )
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">
              {leg === 'SOUND' ? 'No audio in this hand-in yet.' : leg === 'THUMBNAIL' ? 'No design in this hand-in yet.' : 'No video in this hand-in yet.'}
            </p>
          </EmptyPlayer>
        )}
      </div>
    </div>
  );
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

  const snapshot = (version.data?.snapshot ?? null) as ReviewSnapshot | null;

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
  const assets = project.data?.assets ?? [];
  const mediaKinds = leg === 'SOUND' ? AUDIO_KINDS : leg === 'THUMBNAIL' ? IMAGE_KINDS : VIDEO_KINDS;
  const fallbackAssetIds = useMemo(
    () => assets.filter((a) => mediaKinds.has(a.kind)).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets],
  );

  const versionNo = version.data?.version ?? null;
  const annotationHeaderRef = useRef<HTMLDivElement>(null);

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
        snapshot={snapshot}
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

        {/* Second column — the submitter's DESCRIPTION: just the message they
            wrote when handing the stage in. */}
        <div className="pv-notes-col">
          <div className="paper-card review-submission-card pv-notes" data-testid="captain-review-description">
            <div className="inline-heading">
              <span className="eyebrow"><Send size={13} /> Submitted for review</span>
              <span className={`den-tag ${LEG_TONES[leg] ?? 'muted'}`}>{legLabel(leg)}</span>
            </div>
            <blockquote className="review-description-text">
              {isAssetSubmission ? fileParts?.message || '—' : submission.note || '—'}
            </blockquote>
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