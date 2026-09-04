// ---------------------------------------------------------------------------
// CaptainReviewSurface — the Captain's review workbench, matching the
// preview/video template pixel-for-pixel in the top area:
//
//   Top row  — the SAME two-column template as the preview pages:
//     · left column: the Big canvas with the Preview | Diff map toggle (and
//       diff settings) above it — exactly the preview/video canvas (media +
//       timecode + markers + pins), comparing the submitted version against
//       the leg's head baseline.
//     · right column: the submitter's DESCRIPTION — the message they wrote
//       when handing the stage in.
//   Bottom row (where the preview pages run the version carousel) — split
//     into two cards: the big Accept / Reject decision on the left and the
//     REMARK note on the right.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, AudioLines, Clapperboard, FileUp, Play, Send } from 'lucide-react';
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
import { formatTimecode } from '@/components/timeline';
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import { ReviewDecisionCard, ReviewRemarkCard } from '@/components/review-actions';
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

// ---------------------------------------------------------------------------
// The media stage — the same Big canvas as the preview/video page: the
// version's media plays in the frame player (audio legs in the waveform
// player, THUMBNAIL as a design frame) with the playhead timecode in the
// card header, review pins on the frame, and timecode markers under it.
// ---------------------------------------------------------------------------

type Marker = { id: string; ms: number; tone: 'danger' | 'teal'; label?: string };

function ReviewMediaStage({
  projectId,
  submission,
  assetId,
  detail,
  leg,
  isAudio,
  version,
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
  /** Submitted version number (v2, v3…) for the canvas label. */
  version: number | null;
  playheadMs: number;
  onSeek: (ms: number) => void;
  /** The annotate pencil portals here (shared with the diff map's pencil). */
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
  /** Review markers: this PR's timecode comments + clip boundaries. */
  markers: Marker[];
}) {
  return (
    <div className="paper-card pv-stage" data-testid="captain-review-media">
      <div className="inline-heading">
        <span className="eyebrow">
          {isAudio ? <AudioLines size={13} /> : leg === 'THUMBNAIL' ? <Clapperboard size={13} /> : <Play size={13} />}
          Big canvas · {legLabel(leg)}{version ? ` v${version}` : ''}
        </span>
        {leg !== 'THUMBNAIL' && (
          <span className="mono-label">{formatTimecode(playheadMs)}</span>
        )}
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
    music?: Array<{ id?: string; assetId?: string; inMs?: number; outMs?: number }>;
    pickups?: Array<{ id?: string; assetId?: string; timeMs?: number }>;
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

  // Timecode markers under the media, exactly like the preview pages: red
  // ticks for this PR's comments on the asset + teal ticks at clip boundaries.
  const markers = useMemo<Marker[]>(() => {
    const list: Marker[] = [];
    for (const comment of comments.data ?? []) {
      if (comment.timecodeMs == null || comment.submissionId !== submission.id || comment.assetId !== assetId) continue;
      list.push({ id: `note-${comment.id}`, ms: comment.timecodeMs, tone: 'danger' });
    }
    clips.forEach((clip, index) => list.push({ id: `clip-${index}`, ms: clip.inMs, tone: 'teal' }));
    if (leg === 'SOUND') {
      soundMusic.forEach((track, index) => list.push({ id: `music-${index}`, ms: track.inMs ?? 0, tone: 'teal' }));
      soundPickups.forEach((pickup, index) => list.push({ id: `pickup-${index}`, ms: pickup.timeMs ?? 0, tone: 'danger' }));
    }
    return list;
  }, [comments.data, submission.id, assetId, clips, leg, soundMusic, soundPickups]);

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

  const versionNo = version.data?.version ?? null;

  // A file held for review can't play or diff until a decision.
  let canvasBody: ReactNode;
  if (isAssetSubmission) {
    canvasBody = (
      <div className="paper-card pv-stage" data-testid="captain-review-file">
        <div className="inline-heading">
          <span className="eyebrow"><FileUp size={13} /> {fileParts?.fileName}</span>
        </div>
        <div className="pv-stage-player mt-2">
          <EmptyPlayer>
            <p className="text-sm font-semibold">Held for your decision.</p>
          </EmptyPlayer>
        </div>
      </div>
    );
  } else if (!assetId) {
    canvasBody = (
      <div className="paper-card pv-stage" data-testid="captain-review-empty">
        <div className="pv-stage-player">
          <EmptyPlayer>
            <p className="text-sm font-semibold">No media to review in this hand-in.</p>
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
        version={versionNo}
        playheadMs={playheadMs}
        onSeek={onSeek}
        annotationHeaderRef={annotationHeaderRef}
        markers={markers}
      />
    );
  }

  return (
    <div className="page pv-page review-page" data-testid="review-workbench">
      <div className="pv-top">
        {/* First column — the Big canvas with Preview | Diff map, exactly like
            the preview pages. */}
        <div className="pv-canvas-col">
          <PreviewCanvasColumn
            view={view}
            onViewChange={setView}
            hasDiff={hasDiff}
            eyebrow={
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
            }
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
