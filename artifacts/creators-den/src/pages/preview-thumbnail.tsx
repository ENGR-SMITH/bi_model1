// ---------------------------------------------------------------------------
// Thumbnail preview — the cover studio.
//
// Left column, row 1: the big canvas — the selected version's chosen design
// rendered at its natural aspect, with spatial pins (colour-tagged, no
// timecode) and a full-screen expand button.
// Left column, row 2: the carousel of the project's THUMBNAIL versions.
// Right column: the pin / comment wall.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Image as ImageIcon } from 'lucide-react';
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
import { predecessorOf, PreviewDiff, type PreviewDiffSelection } from '@/components/preview-diff';
import {
  DEFAULT_DIFF_SETTINGS,
  FullscreenButton,
  PreviewCanvasColumn,
  PreviewLayout,
  PreviewNotesPanel,
  VAULT_KIND_LABELS,
  VersionCarousel,
  type CarouselItem,
  type DiffSettings,
  type PreviewVersion,
  type PreviewView,
} from '@/components/preview-shared';

const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);

// ---------------------------------------------------------------------------
// ThumbnailCanvas — the design canvas for one selected THUMBNAIL version.
// Falls back to the vault's processed design images when the version has none.
// ---------------------------------------------------------------------------

function ThumbnailCanvas({
  projectId,
  version,
  assets,
  vaultAssetId,
  annotationHeaderRef,
}: {
  projectId: string;
  version: { id: string; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** Explicit vault asset to preview (picked from the timeline row). */
  vaultAssetId?: string | null;
  /** The column-header annotation slot — the annotate pencil portals here. */
  annotationHeaderRef: RefObject<HTMLDivElement | null>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);

  const snap = version ? ((version.snapshot ?? null) as {
    designs?: Array<{ id?: string; assetId: string; title?: string; style?: string }>;
  } | null) : null;
  const designs = Array.isArray(snap?.designs) ? snap!.designs! : [];
  const design = designs[0] ?? null;

  const fallback = useMemo(
    () =>
      assets.find((a) => IMAGE_KINDS.has(a.kind) && a.status === 'PROCESSED') ??
      assets.find((a) => IMAGE_KINDS.has(a.kind)) ??
      null,
    [assets],
  );
  // A version's chosen design may reference an asset that is no longer in the
  // vault — validate it so the stage always shows a real image. An explicitly
  // picked vault file (from the timeline row) wins over everything.
  const explicitAsset = vaultAssetId && assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '';
  const designAssetId = design?.assetId && assets.some((a) => a.id === design.assetId) ? design.assetId : '';
  const assetId = explicitAsset || designAssetId || fallback?.id || '';

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="thumbnail-canvas">
      <div className="inline-heading">
        <span className="eyebrow"><ImageIcon size={13} /> Big canvas{version ? ` · THUMBNAIL v${version.version}` : ''}</span>
        <span className="flex items-center gap-2">
          {!version && <span className="den-tag teal">vault preview</span>}
        </span>
      </div>
      <div className="pv-stage-player mt-2">
        {assetId ? (
          <ImageStage src={proxyUrlFor(projectId, assetId)}>
            <AnnotationCanvas
              projectId={projectId}
              leg="THUMBNAIL"
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={version?.id}
              headerRef={annotationHeaderRef}
              surfaceRef={stageRef}
              glowPins
            />
            <FullscreenButton targetRef={stageRef} />
          </ImageStage>
        ) : (
          <EmptyPlayer>
            <p className="text-sm font-semibold">No thumbnail design in the vault yet.</p>
            <p className="text-xs opacity-70">Add a design in the vault to preview it here.</p>
          </EmptyPlayer>
        )}
      </div>
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

  // Every comparable item in the timeline: saved THUMBNAIL versions AND the
  // vault's design images. A version compares against its older version; a
  // file compares against the older file — so the diff-map works even when
  // only raw images/audio/video were uploaded (no versions saved yet).
  const diffVersions = useMemo<PreviewDiffSelection[]>(
    () => [
      ...(thumbVersions.data ?? []).map((v) => ({
        key: `version-${v.id}`,
        id: v.id,
        leg: 'THUMBNAIL' as const,
        kind: 'version' as const,
        version: v.version,
        parentVersionId: v.parentVersionId ?? null,
        createdAt: v.createdAt,
      })),
      ...(project.data?.assets ?? [])
        .filter((a) => IMAGE_KINDS.has(a.kind))
        .map((a) => ({
          key: `asset-${a.id}`,
          id: a.id,
          leg: 'THUMBNAIL' as const,
          kind: 'asset' as const,
          createdAt: a.createdAt,
          label: a.fileName,
        })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thumbVersions.data, project.data?.assets],
  );

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
  const [vaultAssetId, setVaultAssetId] = useState<string | null>(null);
  // Preview / split-screen diff-map toggle for the big-canvas column.
  const [view, setView] = useState<PreviewView>('preview');
  // Diff-map settings, driven by the settings dropdown beside the toggle.
  const [diffSettings, setDiffSettings] = useState<DiffSettings>(DEFAULT_DIFF_SETTINGS);

  useEffect(() => {
    if (!selectedId && !vaultAssetId && versions.length > 0) setSelectedId(versions[0].id);
  }, [versions, selectedId, vaultAssetId]);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;
  const selectedDetail = useGetVideoTimelineVersion(projectId, selected?.leg ?? '', selected?.id ?? '', {
    query: {
      queryKey: getGetVideoTimelineVersionQueryKey(projectId, selected?.leg ?? '', selected?.id ?? ''),
      enabled: Boolean(selected) && !vaultAssetId,
    },
  });

  // While a vault file is being previewed there is no active version.
  const activeVersion = vaultAssetId ? null : selected;

  // The selected timeline item as a diff selection — a version OR a vault
  // file — plus whether it has an older same-kind predecessor to diff against.
  const activeSelection: PreviewDiffSelection | null =
    (vaultAssetId
      ? diffVersions.find((s) => s.key === `asset-${vaultAssetId}`)
      : activeVersion
        ? diffVersions.find((s) => s.key === `version-${activeVersion.id}`)
        : null) ?? null;
  const hasDiff = Boolean(activeSelection && predecessorOf(diffVersions, activeSelection));

  // The annotate pencil ports into the column header, centered between the
  // canvas label and the view toggle — shared by the preview and diff surfaces.
  const annotationHeaderRef = useRef<HTMLDivElement>(null);

  // Default the column to the diff map when the timeline has something to
  // compare (2+ items), otherwise keep the plain preview.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (defaultedRef.current) return;
    if (diffVersions.length === 0) return; // still loading
    defaultedRef.current = true;
    setView(hasDiff ? 'diff' : 'preview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDiff, diffVersions.length]);

  // If the selected version suddenly has no older version to compare (e.g. the
  // oldest one is picked), fall the column back to the plain preview view.
  useEffect(() => {
    if (!hasDiff) setView('preview');
  }, [hasDiff]);

  // Timeline row: versions (newest first) + the vault's image uploads.
  const carouselItems = useMemo<CarouselItem[]>(() => {
    const versionItems: CarouselItem[] = versions.map((v) => ({
      key: `version-${v.id}`,
      kind: 'version',
      id: v.id,
      leg: v.leg,
      version: v.version,
      message: v.message,
      createdAt: v.createdAt,
      isHead: v.isHead,
    }));
    const vaultItems: CarouselItem[] = (project.data?.assets ?? [])
      .filter((a) => IMAGE_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset',
        id: a.id,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'image',
        thumbUrl: a.status === 'PROCESSED' ? proxyUrlFor(projectId, a.id) : undefined,
      }));
    return [...versionItems, ...vaultItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, project.data?.assets, projectId]);

  const activeKey = vaultAssetId ? `asset-${vaultAssetId}` : selected ? `version-${selected.id}` : carouselItems[0]?.key ?? null;

  const onCarouselSelect = (key: string) => {
    if (key.startsWith('asset-')) {
      setVaultAssetId(key.slice('asset-'.length));
      setSelectedId(null);
    } else {
      setSelectedId(key.slice('version-'.length));
      setVaultAssetId(null);
    }
  };

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
        <PreviewCanvasColumn
          view={view}
          onViewChange={setView}
          hasDiff={hasDiff}
          eyebrow={<span className="eyebrow">Big canvas</span>}
          annotationHeaderRef={annotationHeaderRef}
          settings={diffSettings}
          onSettingsChange={setDiffSettings}
          settingsKind="pixel"
          preview={
            <ThumbnailCanvas
              projectId={p.id}
              version={activeVersion ? { id: activeVersion.id, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
              assets={p.assets}
              vaultAssetId={vaultAssetId ?? undefined}
              annotationHeaderRef={annotationHeaderRef}
            />
          }
          diff={
            // Split-screen VCS: the selected version vs its immediate
            // predecessor (renders nothing for the oldest / lone version).
            <PreviewDiff
              projectId={p.id}
              leg="THUMBNAIL"
              versions={diffVersions}
              selected={activeSelection}
              fallbackAssetIds={(p.assets ?? []).filter((a) => IMAGE_KINDS.has(a.kind)).map((a) => a.id)}
              settings={diffSettings}
              onSettingsChange={setDiffSettings}
              annotationHeaderRef={annotationHeaderRef}
            />
          }
        />
      }
      rail={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['THUMBNAIL']}
          assetId={activeAssetId}
        />
      }
      versions={
        <VersionCarousel
          items={carouselItems}
          activeKey={activeKey}
          onSelect={onCarouselSelect}
          emptyText="No thumbnail versions saved yet — save a snapshot in the Thumbnail studio first."
        />
      }
    />
  );
}
