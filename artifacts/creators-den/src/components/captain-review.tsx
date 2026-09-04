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
//       Preview | Diff map toggle, comparing the submitted item against a
//       baseline. A FILE hand-in (a submit-for-review upload held as
//       PENDING_REVIEW) runs through the very same shared canvas in its
//       direct mode and diffs against the leg's vault media — exactly like a
//       studio previewing its newest upload.
//     · right column, split 50 : 50 — the submitter's DESCRIPTION (the
//       message they wrote when handing the stage in) on top, and the
//       Captain's REMARK note directly below it.
//   Bottom: the big Accept / Reject decision as two bare centered buttons
//   under the canvas (no card). Version submissions diff against the leg's
//   head version; a FILE hand-in diffs against the newest processed vault
//   file of the leg.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import {
  getGetVideoTimelineVersionQueryKey,
  useGetVideoProject,
  useGetVideoTimelineVersion,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import type { VideoSubmission } from '@workspace/api-client-react';
import {
  AudioStageCanvas,
  ThumbnailStageCanvas,
  VideoStageCanvas,
  type StageCanvasVersion,
} from '@/components/preview-canvas';
import {
  DEFAULT_AUDIO_DIFF_SETTINGS,
  DEFAULT_DIFF_SETTINGS,
  PreviewCanvasColumn,
  type DiffSettings,
  type PreviewView,
} from '@/components/preview-shared';
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

// ---------------------------------------------------------------------------
// ReviewStage — the Big canvas for a REVIEW submission, rendered from the SAME
// shared stage canvases the preview studios run (preview-canvas.tsx), scoped
// to the review:
//   · a VERSION submission hands the submitted version (its timeline
//     snapshot) in — the canvas validates the snapshot's clip/design against
//     the vault exactly like the studios,
//   · a FILE submission (submit-for-review uploads held as PENDING_REVIEW)
//     hands the staged asset in via `directAssetId` — there is no snapshot
//     yet, so the shared canvas streams the staged original straight off the
//     server in its vault-preview chrome, badge reading "held for review".
// `submissionId` makes the shared canvas show only THIS submission's notes as
// markers/pins. There is deliberately NO canvas logic here — it lives once, in
// the shared component the working video/audio/thumbnail studios render.
// ---------------------------------------------------------------------------

function ReviewStage({
  projectId,
  submission,
  leg,
  version,
  snapshot,
  assets,
  annotationHeaderRef,
  directAssetId = null,
  directAnnotationVersionId = null,
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
  /** PENDING_REVIEW staged file to preview directly (file hand-ins). */
  directAssetId?: string | null;
  /** timelineVersionId recorded for new pins in direct (file) mode — the
      pending submission id, exactly like the legacy file canvas wrote. */
  directAnnotationVersionId?: string | null;
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
  const shared = {
    projectId,
    version: stageVersion,
    assets,
    annotationHeaderRef,
    submissionId: submission.id,
    directAssetId,
    annotationTimelineVersionId: directAnnotationVersionId || null,
    defaultLeg: leg,
    emptyTitle,
  };

  if (leg === 'SOUND') return <AudioStageCanvas {...shared} />;
  if (leg === 'THUMBNAIL') return <ThumbnailStageCanvas {...shared} />;
  return <VideoStageCanvas {...shared} />;
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
  // A file handed in for review carries an `ASSET:<assetId>` sentinel — it has
  // no timeline snapshot; the staged original is what the Captain reviews
  // until the decision (accept moves it into the vault, reject deletes it).
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

  // ---- The media this review is about. The project vault's assets of the
  // leg's kinds feed the canvases' fallbacks, the diff pool for a FILE
  // hand-in (only PROCESSED files have a proxy the split-screen map can
  // stream), and the strip below the canvas. Playable (PROCESSED) files
  // first, newest first, and no pending-review uploads: nothing may ever try
  // to stream a proxy that can't exist yet, which is what made the desk's
  // canvas 404 while the same footage played fine in the vault. ----
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
  const processedMediaAssets = useMemo(
    () =>
      assets
        .filter((a) => mediaKinds.has(a.kind) && a.status === 'PROCESSED')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, leg],
  );

  // ---- The diff map: the submitted item vs its baseline. Version
  // submissions compare against the leg's head version (the last approved
  // version); FILE submissions compare the staged file against the newest
  // processed vault file of the leg — the studio's "newest upload vs its
  // older sibling" comparison. ----
  const audioLeg = leg === 'SOUND';
  const [view, setView] = useState<PreviewView>('preview');
  const [diffSettings, setDiffSettings] = useState<DiffSettings>(
    audioLeg ? DEFAULT_AUDIO_DIFF_SETTINGS : DEFAULT_DIFF_SETTINGS,
  );

  const diffVersions = useMemo<PreviewDiffSelection[]>(() => {
    if (isAssetSubmission) {
      // The staged file vs the newest processed vault file of the leg — an
      // explicit pair (the file selection's parentVersionId names the
      // baseline so the recency rule can't pick a different older file).
      const baseline = processedMediaAssets[0] ?? null;
      if (!baseline) return [];
      const submissionName = fileParts?.fileName ?? 'Submitted file';
      return [
        {
          key: `asset-${baseline.id}`,
          id: baseline.id,
          leg,
          kind: 'asset',
          createdAt: baseline.createdAt,
          label: baseline.fileName,
        },
        {
          key: `file-${pendingAssetId}`,
          id: pendingAssetId,
          leg,
          kind: 'asset',
          parentVersionId: baseline.id,
          createdAt: submission.createdAt,
          label: submissionName,
        },
      ];
    }
    const rows = legVersions.data ?? [];
    const submitted = rows.find((v) => v.id === submission.timelineVersionId);
    const baseline = headVersionId ? rows.find((v) => v.id === headVersionId) : null;
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
  }, [isAssetSubmission, headVersionId, processedMediaAssets, fileParts, pendingAssetId, legVersions.data, leg, submission.timelineVersionId, submission.createdAt]);

  const activeSelection: PreviewDiffSelection | null = diffVersions[1] ?? null;
  const hasDiff = Boolean(activeSelection && predecessorOf(diffVersions, activeSelection));

  // Open the column on the diff map when a comparison exists (the preview
  // studios do the same), otherwise keep the plain preview. Waits until the
  // compare data has actually resolved: the submitted version list for
  // version hand-ins, the project vault for file hand-ins.
  const viewInitializedRef = useRef(false);
  useEffect(() => {
    if (viewInitializedRef.current) return;
    if (isAssetSubmission ? !project.data : (legVersions.data?.length ?? 0) === 0) return;
    viewInitializedRef.current = true;
    setView(hasDiff ? 'diff' : 'preview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDiff, isAssetSubmission, legVersions.data?.length, project.data]);
  // If the picked baseline suddenly has nothing to compare (e.g. the submitted
  // version itself was picked), fall back to the plain preview.
  useEffect(() => {
    if (!hasDiff) setView('preview');
  }, [hasDiff]);

  const versionNo = version.data?.version ?? null;
  const annotationHeaderRef = useRef<HTMLDivElement>(null);

  let canvasBody: ReactNode;
  if (isAssetSubmission) {
    // A file hand-in has no snapshot — the shared canvas previews the staged
    // original straight off the server (direct mode, badge "held for review").
    canvasBody = (
      <ReviewStage
        projectId={projectId}
        submission={submission}
        leg={leg}
        version={null}
        snapshot={null}
        assets={assets}
        annotationHeaderRef={annotationHeaderRef}
        directAssetId={pendingAssetId}
        directAnnotationVersionId={submission.timelineVersionId}
      />
    );
  } else {
    canvasBody = (
      <ReviewStage
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

    </div>
  );
}
