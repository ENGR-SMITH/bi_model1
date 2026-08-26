// ---------------------------------------------------------------------------
// Thumbnail preview — the cover studio.
//
// Left column, row 1: the big canvas — the selected version's chosen design
// rendered at its natural aspect, with spatial pins (colour-tagged, no
// timecode) and a full-screen expand button.
// Left column, row 2: the carousel of the project's THUMBNAIL versions.
// Right column: the pin / comment wall.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Image as ImageIcon, LockKeyhole, Play } from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  getGetVideoTimelineVersionQueryKey,
  useGetVideoProject,
  useGetVideoTimeline,
  useGetVideoTimelineVersion,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import { useProjectRealtime } from '@/lib/realtime';
import { EmptyPlayer, ImageStage, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import {
  FullscreenButton,
  PreviewLayout,
  PreviewNotesPanel,
  VersionCarousel,
  type PreviewVersion,
} from '@/components/preview-shared';

// ---------------------------------------------------------------------------
// ThumbnailCanvas — the design canvas for one selected THUMBNAIL version.
// ---------------------------------------------------------------------------

function ThumbnailCanvas({
  projectId,
  version,
  assets,
}: {
  projectId: string;
  version: { id: string; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string }>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);

  const snap = (version?.snapshot ?? null) as {
    designs?: Array<{ id?: string; assetId: string; title?: string; style?: string }>;
  } | null;
  const designs = Array.isArray(snap?.designs) ? snap!.designs! : [];
  const design = designs[0] ?? null;
  const assetId = design?.assetId ?? '';
  const assetName = assets.find((a) => a.id === assetId)?.fileName ?? assetId.slice(0, 8);
  const stageTitle = [design?.title, design?.style].filter(Boolean).join(' · ') || assetName || 'Design preview';

  if (!version) {
    return (
      <div className="paper-card pv-stage" data-testid="thumbnail-canvas">
        <div className="inline-heading">
          <span className="eyebrow"><Play size={13} /> Big canvas</span>
        </div>
        <EmptyPlayer className="mt-3">
          <p className="text-sm font-semibold">No version selected yet.</p>
        </EmptyPlayer>
      </div>
    );
  }

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="thumbnail-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><ImageIcon size={13} /> Big canvas · THUMBNAIL v{version.version}</span>
        {design && <span className="den-tag gold truncate">{design.title || assetName}</span>}
      </div>
      <div className="pv-stage-player mt-3">
        {assetId ? (
          <ImageStage src={proxyUrlFor(projectId, assetId)} title={stageTitle}>
            <AnnotationCanvas
              projectId={projectId}
              leg="THUMBNAIL"
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={version.id}
            />
          </ImageStage>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">This version has no chosen design.</p>
            <p className="text-xs opacity-70">Save a thumbnail snapshot with a chosen image to see it here.</p>
          </EmptyPlayer>
        )}
        <FullscreenButton targetRef={stageRef} />
      </div>
      {design && (
        <div className="cd-metarow mt-3">
          <span className="cd-metatext min-w-0">
            <b className="truncate">{design.title || assetName}</b>
            <small>{design.style ? `style · ${design.style}` : 'chosen design'} · {designs.length} design{designs.length === 1 ? '' : 's'} in v{version.version}</small>
          </span>
        </div>
      )}
      <p className="den-footnote mt-3">
        <LockKeyhole size={13} />
        The design is rendered from the degraded proxy — the locked original never leaves the vault. Pins sit directly on the pixels.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ThumbnailPreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);
  const thumbVersions = useListVideoTimelineVersions(projectId, 'THUMBNAIL');
  const thumbTimeline = useGetVideoTimeline(projectId, 'THUMBNAIL');

  const versions = useMemo<PreviewVersion[]>(
    () =>
      (thumbVersions.data ?? [])
        .map((v) => ({
          id: v.id,
          leg: 'THUMBNAIL' as const,
          version: v.version,
          message: v.message ?? '',
          createdAt: v.createdAt,
          isHead: v.version === thumbTimeline.data?.version,
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thumbVersions.data, thumbTimeline.data?.version],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && versions.length > 0) setSelectedId(versions[0].id);
  }, [versions, selectedId]);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  const selectedDetail = useGetVideoTimelineVersion(projectId, selected?.leg ?? '', selected?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, selected?.leg ?? '', selected?.id ?? ''),
      enabled: Boolean(selected),
    },
  });

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the cover studio…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>STUDIO CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;
  const snap = (selectedDetail.data?.snapshot ?? null) as { designs?: Array<{ assetId: string }> } | null;
  const design = Array.isArray(snap?.designs) ? snap!.designs![0] : null;
  const activeAssetId = design?.assetId ?? undefined;

  return (
    <PreviewLayout
      canvas={
        <ThumbnailCanvas
          projectId={p.id}
          version={selected ? { id: selected.id, version: selected.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
        />
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['THUMBNAIL']}
          assetId={activeAssetId}
          timelineVersionId={selected?.id}
          composerLeg="THUMBNAIL"
        />
      }
      versions={
        <VersionCarousel
          versions={versions}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          emptyText="No thumbnail versions saved yet — save a snapshot in the Thumbnail studio first."
        />
      }
    />
  );
}
