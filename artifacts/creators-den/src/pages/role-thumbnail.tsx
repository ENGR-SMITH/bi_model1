// ---------------------------------------------------------------------------
// Thumbnail role page — the cover studio.
//
// Column one: a vertical scrolling shelf mixing the project's THUMBNAIL
// versions with the vault's design images. Column two: the big canvas — the
// selected version's chosen design (or the picked vault file) rendered at its
// natural aspect, with spatial pins and a full-screen expand button. Column
// three, row 1: the pin / comment wall; row 2: the Thumbnail Designer's
// "Hand this stage in" card. Design files only arrive here via submit-for-
// review (approved by the Captain) — no direct upload on this page.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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
import { VersionShelf, type ShelfItem } from '@/components/version-shelf';
import {
  FullscreenButton,
  PreviewNotesPanel,
  RoleLayout,
  VAULT_KIND_LABELS,
  type PreviewVersion,
} from '@/components/preview-shared';
import { StageSubmitCard } from '@/components/stage-submit-card';
import { RoleAccessDenied } from '@/components/role-access-denied';
import { hasRole } from '@/lib/roles';

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
}: {
  projectId: string;
  version: { id: string; version: number; snapshot: unknown } | null;
  assets: Array<{ id: string; fileName: string; kind: string; status: string }>;
  /** Explicit vault asset to preview (picked from the version shelf). */
  vaultAssetId?: string;
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
  // picked vault file (from the shelf) wins over everything.
  const explicitAsset = vaultAssetId && assets.some((a) => a.id === vaultAssetId) ? vaultAssetId : '';
  const designAssetId = design?.assetId && assets.some((a) => a.id === design.assetId) ? design.assetId : '';
  const assetId = explicitAsset || designAssetId || fallback?.id || '';

  return (
    <div className="paper-card pv-stage" ref={stageRef} data-testid="thumbnail-canvas">
      <div className="pv-stage-player">
        {assetId ? (
          <ImageStage src={proxyUrlFor(projectId, assetId)}>
            {/* Review pins still render; the Annotate button is intentionally
                off here — pins are managed from the preview studios instead. */}
            <AnnotationCanvas
              projectId={projectId}
              leg="THUMBNAIL"
              assetId={assetId}
              playheadMs={null}
              timelineVersionId={version?.id}
              canAnnotate={false}
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

export default function RoleThumbnailPage() {
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
  const [vaultAssetId, setVaultAssetId] = useState<string | null>(null);

  // Default to the newest version once the list arrives (unless a vault file
  // has been picked from the version shelf).
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

  // While a vault file is being previewed there is no active version — the
  // canvas shows the picked file instead of the newest version's design.
  const activeVersion = vaultAssetId ? null : selected;

  // Version shelf: THUMBNAIL versions (newest first) + the vault's images.
  const shelfItems = useMemo<ShelfItem[]>(() => {
    const proj = project.data;
    const versionItems: ShelfItem[] = versions.map((v) => ({
      key: `version-${v.id}`,
      kind: 'version' as const,
      version: v.version,
      leg: v.leg,
      message: v.message,
      createdAt: v.createdAt,
      isHead: v.isHead,
    }));
    const vaultItems: ShelfItem[] = (proj?.assets ?? [])
      .filter((a) => IMAGE_KINDS.has(a.kind))
      .map((a) => ({
        key: `asset-${a.id}`,
        kind: 'asset' as const,
        fileName: a.fileName,
        kindLabel: VAULT_KIND_LABELS[a.kind] ?? a.kind,
        status: a.status,
        media: 'image' as const,
        thumbUrl: a.status === 'PROCESSED' ? proxyUrlFor(projectId, a.id) : undefined,
      }));
    return [...versionItems, ...vaultItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, project.data?.assets, projectId]);

  const activeKey = vaultAssetId ? `asset-${vaultAssetId}` : selected ? `version-${selected.id}` : shelfItems[0]?.key ?? null;

  const onShelfSelect = (key: string) => {
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

  // The Thumbnail studio only opens for members with the THUMBNAIL role (or
  // the Captain). The nav tab stays visible — this page explains why it is
  // locked.
  if (!hasRole(p.myRoles, 'THUMBNAIL')) {
    return <RoleAccessDenied role="Thumbnail" projectId={p.id} />;
  }

  const snap = (selectedDetail.data?.snapshot ?? null) as { designs?: Array<{ assetId: string }> } | null;
  const design = Array.isArray(snap?.designs) ? snap!.designs![0] : null;
  // Scope the notes rail to the design shown — the version's chosen design, or
  // the vault file being previewed.
  const notesAssetId = design?.assetId ?? vaultAssetId ?? undefined;

  return (
    <RoleLayout
      versions={
        <VersionShelf
          items={shelfItems}
          activeKey={activeKey}
          onSelect={onShelfSelect}
          emptyText="Nothing here yet — save a snapshot in the Thumbnail studio. Files you hand in for review reach the vault once the Captain approves them."
        />
      }
      canvas={
        <ThumbnailCanvas
          projectId={p.id}
          version={activeVersion ? { id: activeVersion.id, version: activeVersion.version, snapshot: selectedDetail.data?.snapshot ?? null } : null}
          assets={p.assets}
          vaultAssetId={vaultAssetId ?? undefined}
        />
      }
      notes={
        <PreviewNotesPanel
          projectId={p.id}
          legs={['THUMBNAIL']}
          assetId={notesAssetId}
          allowResolve
        />
      }
      oracle={
        <StageSubmitCard
          projectId={p.id}
          legs={['THUMBNAIL']}
          roleName="Thumbnail Designer"
        />
      }
    />
  );
}
