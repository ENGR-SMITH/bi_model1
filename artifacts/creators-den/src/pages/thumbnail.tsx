import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Image as ImageIcon,
  LockKeyhole,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetVideoTimelineQueryKey,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoSubmissions,
  useSaveVideoTimeline,
} from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { ImageStage, proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { RoleOracle } from '@/components/role-oracle';
import { CommentsPanel, HistoryPanel } from '@/components/review-shared';
import { ActivityFeed } from '@/components/activity-feed';

// ---------------------------------------------------------------------------
// The THUMBNAIL 5th leg (VCS design §11). The thumbnail's \"document\" — the
// chosen design image + title + style — is a `timeline_versions.snapshot`
// jsonb under leg 'THUMBNAIL', so it inherits versioning, submissions, the
// commit log, and review comments for free. Design happens externally
// (Photoshop/Figma/Canva → upload a PNG/JPG to the vault as THUMBNAIL_DESIGN);
// marking and highlighting happen here, in-browser, as annotations.
// ---------------------------------------------------------------------------

const STYLES = ['FACE_CLOSEUP', 'SPLIT', 'TEXT_OVERLAY', 'MINIMAL', 'GRID'] as const;
type ThumbnailStyle = (typeof STYLES)[number];

interface ThumbnailDesign {
  id: string;
  assetId: string;
  title: string;
  style: string;
}

interface ThumbnailSnapshot {
  designs: ThumbnailDesign[];
}

const EMPTY_SNAPSHOT: ThumbnailSnapshot = { designs: [] };

export default function ThumbnailStudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useUser();

  // Live: comments, submissions, and timeline saves stream in per leg.
  useProjectRealtime(projectId, 'THUMBNAIL');

  const [working, setWorking] = useState<ThumbnailSnapshot>(EMPTY_SNAPSHOT);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [stageAssetId, setStageAssetId] = useState<string | null>(null);

  const project = useGetVideoProject(projectId);
  const timeline = useGetVideoTimeline(projectId, 'THUMBNAIL');
  const save = useSaveVideoTimeline();
  const submissions = useListVideoSubmissions(projectId);

  const designAssets = (project.data?.assets ?? []).filter((asset) => asset.kind === 'THUMBNAIL_DESIGN');
  const currentDesign = working.designs[0] ?? null;

  // Seed working state from the timeline head whenever it changes.
  useEffect(() => {
    if (timeline.data?.snapshot) {
      const snapshot = timeline.data.snapshot as unknown as ThumbnailSnapshot;
      setWorking({
        designs: Array.isArray(snapshot.designs) ? snapshot.designs : [],
      });
      setDirty(false);
    }
  }, [timeline.data?.snapshot, timeline.data?.version]);

  // Default the stage to the chosen design (or the first uploaded design).
  useEffect(() => {
    if (stageAssetId) return;
    const preferred = currentDesign?.assetId ?? designAssets[0]?.id ?? null;
    if (preferred) setStageAssetId(preferred);
  }, [currentDesign?.assetId, designAssets, stageAssetId]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canEdit = role === 'CAPTAIN' || role === 'THUMBNAIL_DESIGNER';

  const headVersionId = timeline.data?.versions.find((v) => v.version === timeline.data?.version)?.id ?? null;

  const onPickDesign = (assetId: string) => {
    const next: ThumbnailDesign = {
      id: currentDesign?.id ?? crypto.randomUUID(),
      assetId,
      title: currentDesign?.title ?? '',
      style: currentDesign?.style ?? '',
    };
    setWorking({ designs: [next] });
    setStageAssetId(assetId);
    setDirty(true);
  };

  const onTitle = (title: string) => {
    setWorking((prev) => ({
      designs: [
        {
          id: prev.designs[0]?.id ?? crypto.randomUUID(),
          assetId: prev.designs[0]?.assetId ?? designAssets[0]?.id ?? '',
          title,
          style: prev.designs[0]?.style ?? '',
        },
      ],
    }));
    setDirty(true);
  };

  const onStyle = (style: string) => {
    setWorking((prev) => ({
      designs: [
        {
          id: prev.designs[0]?.id ?? crypto.randomUUID(),
          assetId: prev.designs[0]?.assetId ?? designAssets[0]?.id ?? '',
          title: prev.designs[0]?.title ?? '',
          style,
        },
      ],
    }));
    setDirty(true);
  };

  const onSave = () => {
    save.mutate(
      { projectId, leg: 'THUMBNAIL', data: { snapshot: working as unknown as Record<string, unknown>, message: message.trim() || undefined } },
      {
        onSuccess: () => {
          setMessage('');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetVideoTimelineQueryKey(projectId, 'THUMBNAIL') });
        },
      },
    );
  };

  const saveError = save.error as { response?: { data?: { error?: string } } } | null;

  const oracleContext = useMemo(() => {
    const pick = designAssets.find((asset) => asset.id === currentDesign?.assetId);
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Chosen design: ${pick?.fileName ?? 'none yet'}`,
      `Title text: ${currentDesign?.title || '(not set)'}`,
      `Style: ${currentDesign?.style || '(not set)'}`,
      `Available designs: ${designAssets.map((a) => a.fileName).join(', ') || 'none uploaded yet'}`,
    ].join('\n\n').slice(0, 4000);
  }, [project.data?.name, currentDesign, designAssets]);

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the studio…</div></div>;
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Thumbnail Designer · cover art</SectionEyebrow>
          <h1>The thumbnail studio.</h1>
          <p>Designs are made externally and uploaded to the vault as PNG/JPG. Here you choose the winning image, set the title and style, and save versioned passes for the Captain to review.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-studio-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canEdit ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canEdit ? 'Thumbnail Designer' : 'Viewing'}
          </span>
        </div>
      </div>

      <div className="cd-watch">
        <div className="cd-watch-main">
          <div className="paper-card">
            <div className="inline-heading">
              <span className="eyebrow"><ImageIcon size={13} /> Design canvas</span>
              {designAssets.length > 1 && (
                <select
                  value={stageAssetId ?? ''}
                  onChange={(event) => setStageAssetId(event.target.value || null)}
                  className="!w-auto !text-xs"
                  data-testid="select-stage-design"
                >
                  {designAssets.map((a) => (
                    <option key={a.id} value={a.id}>{a.fileName}</option>
                  ))}
                </select>
              )}
            </div>

            {stageAssetId ? (
              <ImageStage
                className="mt-3"
                src={proxyUrlFor(p.id, stageAssetId)}
                title={designAssets.find((a) => a.id === stageAssetId)?.fileName ?? 'Design preview'}
              >
                <AnnotationCanvas
                  projectId={p.id}
                  leg="THUMBNAIL"
                  assetId={stageAssetId}
                  playheadMs={null}
                  timelineVersionId={headVersionId}
                />
              </ImageStage>
            ) : (
              <div className="empty-state mt-3" data-testid="empty-thumbnail-designs">
                <Upload size={22} />
                <h3>No designs in the vault yet.</h3>
                <p>Thumbnail design happens externally — export a PNG/JPG (Photoshop, Figma, Canva), then upload it to the vault as a “Thumbnail design” and it appears here.</p>
                <Link href={`/projects/${p.id}`} className="secondary-btn mt-3">
                  Upload a design <ArrowUpRight size={13} />
                </Link>
              </div>
            )}

            <p className="den-footnote mt-3">
              <LockKeyhole size={13} />
              Marking and highlighting are review annotations — click Annotate, then the frame, to pin feedback on the image.
            </p>
          </div>

          <CommentsPanel projectId={p.id} leg="THUMBNAIL" />
        </div>

        <div className="cd-watch-rail">
          <div className="paper-card accent-card">
            <div className="inline-heading">
              <span className="eyebrow"><ImageIcon size={13} /> The thumbnail document</span>
              <span className="mono-label">{designAssets.length} design{designAssets.length === 1 ? '' : 's'} in vault</span>
            </div>
            <p className="setting-copy">
              The chosen image + title + style is the stage&apos;s document — saved as a Git-style snapshot, submitted to the Captain, and reviewed with pins on the frame.
            </p>

            <div className="field mt-3">
              <span>Chosen design</span>
              <select
                value={currentDesign?.assetId ?? ''}
                disabled={!canEdit || designAssets.length === 0}
                onChange={(event) => onPickDesign(event.target.value)}
                data-testid="select-current-design"
              >
                <option value="">Pick a design…</option>
                {designAssets.map((a) => (
                  <option key={a.id} value={a.id}>{a.fileName}</option>
                ))}
              </select>
            </div>

            <div className="field mt-3">
              <span>Title text</span>
              <input
                value={currentDesign?.title ?? ''}
                disabled={!canEdit}
                onChange={(event) => onTitle(event.target.value)}
                placeholder="e.g. “I Tested the $10,000 Camera”"
                maxLength={120}
                data-testid="input-design-title"
              />
            </div>

            <div className="field mt-3">
              <span>Style</span>
              <div className="den-chip-list">
                {STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    disabled={!canEdit}
                    className={`den-chip ${currentDesign?.style === style ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : ''}`}
                    onClick={() => onStyle(style)}
                    data-testid={`design-style-${style}`}
                  >
                    {style.replaceAll('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
              <span className="eyebrow"><Save size={12} /> Save this pass</span>
              <p className="setting-copy mt-1">
                Every save creates a versioned snapshot — the Captain can always see what changed, and Compare shows it side-by-side.
              </p>
              {canEdit ? (
                <div className="mt-3 flex gap-2">
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What changed in this pass? (optional)"
                    maxLength={500}
                    data-testid="input-save-message"
                  />
                  <button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="primary-btn" data-testid="button-save-snapshot">
                    <Save size={13} />
                    {save.isPending ? 'Saving…' : 'Save snapshot'}
                  </button>
                </div>
              ) : (
                <p className="setting-copy mt-3">You&apos;re viewing this stage — only the Thumbnail Designer or the Captain can edit it.</p>
              )}
              {dirty && <p className="den-footnote mt-2"><Sparkles size={12} /> Unsaved changes</p>}
              {save.isError && (
                <p className="setting-copy mt-2" role="alert">
                  {saveError?.response?.data?.error || 'The snapshot could not be saved.'}
                </p>
              )}
            </div>
          </div>

          <RoleOracle
            leg="THUMBNAIL"
            roleName="Thumbnail Designer"
            context={oracleContext}
            disabled={!canEdit}
            placeholder="e.g. Which style converts best for this title?"
          />

          <HistoryPanel
            projectId={p.id}
            leg="THUMBNAIL"
            versions={timeline.data?.versions ?? []}
            currentVersion={timeline.data?.version ?? null}
            canSubmit={canEdit}
          />

          <ActivityFeed projectId={p.id} leg="THUMBNAIL" className="" />

          {(() => {
            const legStatus = submissions.data?.find((s) => s.leg === 'THUMBNAIL');
            if (!legStatus) return null;
            return (
              <p className="den-footnote">
                <Sparkles size={13} />
                Stage status: {legStatus.status.toLowerCase()}
                {legStatus.decidedAt && ` · decided ${new Date(legStatus.decidedAt).toLocaleDateString()}`}
              </p>
            );
          })()}
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Designs stay locked in the vault. The chosen image + title + style is versioned like every other leg — and reviewed with pins on the frame.
      </p>
    </div>
  );
}
