import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  LockKeyhole,
  Palette,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import {
  getGetVideoAssetQueryKey,
  useGetVideoAsset,
  useGetVideoProject,
  useGetVideoTimeline,
  useListVideoSubmissions,
  oracleChat,
} from '@workspace/api-client-react';
import type { VideoAssetDetail } from '@workspace/api-client-react';
import { SectionEyebrow, ColumnSection, RELAY_LEGS } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { CommentsPanel, HistoryPanel } from './selects';
import { ActivityFeed } from '@/components/activity-feed';
import { Timeline, formatTimecode, type TimelineBlock } from '@/components/timeline';
import { RoleOracle, AiResult } from '@/components/role-oracle';
import { AssetPlayer, pollWhileProcessing } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { CheckoutPanel, ImportFlow } from '@/components/checkout-import';

const LUT_PRESETS = ['NONE', 'WARM', 'COOL', 'CINEMA', 'PUNCHY'] as const;
const CAPTION_STYLES = ['BOTTOM_CENTER', 'SPLIT', 'MINIMAL'] as const;

interface GradeNode {
  lut: (typeof LUT_PRESETS)[number];
  exposure: number; // -100..100
  warmth: number; // -100..100
}

interface GradeClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  grade: GradeNode;
}

interface LowerThird {
  id: string;
  title: string;
  subtitle: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  width: number;
}

interface FinishSnapshot {
  clips: GradeClip[];
  captions: { enabled: boolean; style: (typeof CAPTION_STYLES)[number] };
  lowerThirds: LowerThird[];
  thumbnail: { assetId: string; timeMs: number } | null;
  sceneBlocks: Array<{ id: string; type: string; startMs: number; endMs: number }>;
  markers: Array<{ id: string; label: string; timeMs: number }>;
}

const EMPTY_FINISH: FinishSnapshot = {
  clips: [],
  captions: { enabled: false, style: 'BOTTOM_CENTER' },
  lowerThirds: [],
  thumbnail: null,
  sceneBlocks: [],
  markers: [],
};

function parseSnapshot(raw: unknown): FinishSnapshot {
  const snapshot = raw as Partial<FinishSnapshot> | null | undefined;
  return {
    clips: Array.isArray(snapshot?.clips) ? snapshot.clips : [],
    captions: snapshot?.captions ?? EMPTY_FINISH.captions,
    lowerThirds: Array.isArray(snapshot?.lowerThirds)
      ? snapshot.lowerThirds.map((l) => ({ ...l, x: l.x ?? 6, y: l.y ?? 6, width: l.width ?? 230 }))
      : [],
    thumbnail: snapshot?.thumbnail ?? null,
    sceneBlocks: Array.isArray(snapshot?.sceneBlocks) ? snapshot.sceneBlocks : [],
    markers: Array.isArray(snapshot?.markers) ? snapshot.markers : [],
  };
}

const DEFAULT_GRADE: GradeNode = { lut: 'NONE', exposure: 0, warmth: 0 };

/** Turn a grade node into a CSS filter so the proxy shows the look live. */
function gradeFilter(grade: GradeNode): string {
  const LUT_FILTERS: Record<GradeNode['lut'], string> = {
    NONE: '',
    WARM: 'sepia(0.22) saturate(1.06)',
    COOL: 'saturate(0.88) hue-rotate(-6deg)',
    CINEMA: 'contrast(1.12) saturate(0.85)',
    PUNCHY: 'contrast(1.16) saturate(1.2)',
  };
  const parts: string[] = [];
  if (LUT_FILTERS[grade.lut]) parts.push(LUT_FILTERS[grade.lut]);
  if (grade.exposure !== 0) parts.push(`brightness(${(1 + grade.exposure / 200).toFixed(3)})`);
  if (grade.warmth > 0) parts.push(`sepia(${(grade.warmth / 200).toFixed(3)})`);
  else if (grade.warmth < 0) parts.push(`hue-rotate(${(grade.warmth / 5).toFixed(1)}deg)`);
  return parts.join(' ') || 'none';
}

/** The caption line for the current playhead (from the Leg 1 transcript). */
function captionFor(detail: VideoAssetDetail | undefined, playheadMs: number): string | null {
  const segments = detail?.transcript?.segments ?? [];
  const segment = segments.find((s) => playheadMs >= s.startMs && playheadMs < s.endMs);
  return segment?.text ?? null;
}

// ---------------------------------------------------------------------------
// Finish preview — the graded proxy with lower-thirds and captions overlaid,
// read-only. The grade/lower-thirds/captions are authored externally and
// imported back; this view only plays them.
// ---------------------------------------------------------------------------

function FinishPreview({
  projectId,
  snapshot,
  assets,
  durationMs,
  playheadMs,
  onTimeUpdate,
  onScrub,
  headVersionId,
}: {
  projectId: string;
  snapshot: FinishSnapshot;
  assets: Array<{ id: string; fileName: string }>;
  durationMs: number;
  playheadMs: number;
  onTimeUpdate: (ms: number) => void;
  onScrub: (ms: number) => void;
  /** Scope on-frame pins to the FINISH leg's head snapshot. */
  headVersionId?: string | null;
}) {
  const clips = useMemo(
    () => [...snapshot.clips].sort((a, b) => a.inMs - b.inMs || a.id.localeCompare(b.id)),
    [snapshot.clips],
  );

  const activeClip = useMemo(
    () =>
      clips.find(
        (clip) => playheadMs >= clip.inMs && playheadMs < Math.max(clip.inMs + 1, clip.outMs),
      ) ?? null,
    [clips, playheadMs],
  );

  const [fallbackAssetId, setFallbackAssetId] = useState<string | null>(null);
  useEffect(() => {
    if (!fallbackAssetId && assets.length > 0) setFallbackAssetId(assets[0].id);
  }, [assets, fallbackAssetId]);

  const previewAssetId = activeClip?.assetId ?? clips[0]?.assetId ?? fallbackAssetId ?? assets[0]?.id ?? null;
  const detail = useGetVideoAsset(projectId, previewAssetId ?? '', {
    query: {
      queryKey: getGetVideoAssetQueryKey(projectId, previewAssetId ?? ''),
      enabled: Boolean(previewAssetId),
      refetchInterval: (query) => pollWhileProcessing(query.state.data),
    },
  });

  if (assets.length === 0) return null;

  const asset = assets.find((a) => a.id === previewAssetId) ?? assets[0];
  const grade = activeClip?.grade ?? clips.find((c) => c.assetId === asset.id)?.grade ?? DEFAULT_GRADE;
  const caption = snapshot.captions.enabled ? captionFor(detail.data, playheadMs) : null;

  const clipBlocks: TimelineBlock[] = clips.map((clip) => ({
    id: clip.id,
    label: assets.find((a) => a.id === clip.assetId)?.fileName ?? clip.assetId,
    sublabel: `${clip.grade.lut} · ${formatTimecode(clip.inMs)} → ${formatTimecode(clip.outMs)}`,
    startMs: clip.inMs,
    endMs: Math.max(clip.outMs, clip.inMs + 500),
    tone: 'accent' as const,
  }));

  return (
    <div className="paper-card" data-testid="panel-finish-preview">
      <div className="inline-heading">
        <span className="eyebrow"><Palette size={13} /> Graded preview</span>
        <span className="mono-label">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
        {clips.length === 0 && assets.length > 1 && (
          <select
            value={fallbackAssetId ?? ''}
            onChange={(event) => setFallbackAssetId(event.target.value || null)}
            className="!w-auto !text-xs"
            data-testid="finish-select-preview-asset"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.fileName}</option>
            ))}
          </select>
        )}
      </div>
      <p className="setting-copy">Scrub across the clips below — each clip shows its graded look, with lower thirds and captions overlaid. The grade itself is authored externally and imported back.</p>

      <AssetPlayer
        className="mt-3"
        projectId={projectId}
        assetId={asset.id}
        detail={detail.data}
        playheadMs={playheadMs}
        onTimeUpdate={onTimeUpdate}
        filter={gradeFilter(grade)}
        title={`${asset.fileName} · ${grade.lut}`}
      >
        <div className="den-frame-overlay">
          {snapshot.lowerThirds.map((lower) => (
            <div
              key={lower.id}
              className="den-overlay-card"
              style={{ left: `${lower.x}%`, top: `${lower.y}%`, width: lower.width }}
              data-testid={`preview-lower-third-${lower.id}`}
            >
              <span className="den-overlay-title">{lower.title}</span>
              {lower.subtitle && <span className="den-overlay-sub">{lower.subtitle}</span>}
            </div>
          ))}
          {caption && (
            <div className="den-caption-bar">
              <span className="den-caption-text">{caption}</span>
            </div>
          )}
        </div>
        <AnnotationCanvas
          projectId={projectId}
          leg="FINISH"
          assetId={asset.id}
          playheadMs={playheadMs}
          onSeek={onScrub}
          timelineVersionId={headVersionId}
        />
      </AssetPlayer>

      {clips.length > 0 && (
        <div className="mt-4">
          <Timeline
            title="Grade clips — scrub to compare"
            hint="Click or drag the ruler to move across clips · each clip shows its own grade"
            blocks={clipBlocks}
            durationMs={durationMs}
            playheadMs={playheadMs}
            canEdit={false}
            scrubOnly
            onScrub={onScrub}
            activeId={activeClip?.id ?? null}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="den-tag gold">{grade.lut}</span>
        <span className="den-tag accent">exposure {grade.exposure > 0 ? '+' : ''}{grade.exposure}</span>
        <span className="den-tag teal">warmth {grade.warmth > 0 ? '+' : ''}{grade.warmth}</span>
        {snapshot.captions.enabled && <span className="den-tag muted">{snapshot.captions.style.replaceAll('_', ' ')} captions</span>}
        {activeClip && <span className="den-tag muted">{assets.find((a) => a.id === activeClip.assetId)?.fileName ?? activeClip.assetId}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const LEG = 'FINISH' as const;

export default function ContentCreatorsFinishPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useUser();

  useProjectRealtime(projectId, LEG);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [aiResult, setAiResult] = useState<{ title: string; body: string; meta: { providerId: string; modelId: string } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const project = useGetVideoProject(projectId);
  const finishTimeline = useGetVideoTimeline(projectId, LEG);
  const submissions = useListVideoSubmissions(projectId);

  const snapshot = useMemo(() => parseSnapshot(finishTimeline.data?.snapshot), [finishTimeline.data?.snapshot]);

  const member = project.data?.members.find((m) => m.userId === user?.id);
  const role = member?.role ?? project.data?.myRole;
  const canPush = role === 'CAPTAIN' || role === 'MOTION_COLOR';

  const timelineDuration = Math.max(
    60_000,
    project.data?.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0) ?? 60_000,
  );

  const oracleContext = useMemo(() => {
    const clips = snapshot.clips.map((c, i) => `clip ${i + 1}: ${assetsName(c.assetId)} · LUT ${c.grade.lut} · exposure ${c.grade.exposure} · warmth ${c.grade.warmth}`).join('\n') || 'none yet';
    const cards = snapshot.lowerThirds.map((l) => `“${l.title}${l.subtitle ? ` — ${l.subtitle}` : ''}” @ ${formatTimecode(l.startMs)}–${formatTimecode(l.endMs)}`).join('\n') || 'none yet';
    const caps = snapshot.captions.enabled ? snapshot.captions.style : 'off';
    return [
      `Project: ${project.data?.name ?? 'Untitled'}`,
      `Timeline duration: ${formatTimecode(timelineDuration)}`,
      `Grade clips:\n${clips}`,
      `Lower thirds:\n${cards}`,
      `Captions: ${caps}`,
      `Thumbnail: ${snapshot.thumbnail ? `frame @ ${formatTimecode(snapshot.thumbnail.timeMs)}` : 'not marked'}`,
    ].join('\n\n').slice(0, 12000);
  }, [snapshot, project.data?.name, timelineDuration]);

  function assetsName(assetId: string): string {
    return project.data?.assets.find((a) => a.id === assetId)?.fileName ?? assetId;
  }

  const runOracleSuggestion = async (instruction: string): Promise<string | null> => {
    setAiBusy(true);
    try {
      const result = await oracleChat({ messages: [{ role: 'system', content: 'You are the Motion & Color director\'s assistant in a video relay. Be concise and concrete.' }, { role: 'user', content: `${instruction}\n\nContext:\n${oracleContext}` }] });
      setAiResult((prev) => (prev ? { ...prev, meta: { providerId: result.providerId, modelId: result.modelId } } : prev));
      return result.content;
    } catch {
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  const quickActions = [
    {
      id: 'review-finish',
      label: 'Review the finish',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Review the finish: grade consistency, caption style, lower-third timing, and thumbnail pick. Give concrete notes. Be concise.').then((body) => {
          if (body) setAiResult({ title: 'Finish review', body, meta: null });
        });
      },
    },
    {
      id: 'suggest-grade',
      label: 'Suggest grades',
      busy: aiBusy,
      run: () => {
        setAiResult(null);
        void runOracleSuggestion('Suggest one cohesive grade. Answer ONLY with lines of the form "clip N: LUT=<preset> exposure=<number> warmth=<number>" using presets NONE, WARM, COOL, CINEMA, PUNCHY and the clip numbers above.').then((body) => {
          if (body) setAiResult({ title: 'Grade suggestions', body, meta: null });
        });
      },
    },
  ];

  if (project.isLoading) {
    return <div className="page"><div className="panel-empty">Opening the finishing suite…</div></div>;
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>FINISHING SUITE CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;
  const released = p.status === 'RELEASED';

  return (
    <div className="page">
      <div className="page-guide">
        <span className="guide-pin" />
        <div>
          <b>CONTENT CREATORS · THE FINISHING SUITE</b>
          <span>Review the graded master, caption burn, and lower thirds — then hand off to the external finishing tools and import the publish-ready result.</span>
        </div>
        <span className="guide-spark" />
      </div>

      <div className="page-header">
        <div>
          <SectionEyebrow>Motion &amp; Color · finish &amp; polish</SectionEyebrow>
          <h1>Finish &amp; polish.</h1>
          <p>Play the graded preview, scrub across clips, and pin feedback on exact frames. Grading, captions, and lower thirds are authored externally and imported back.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="link-finish-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className={`den-tag ${canPush ? 'teal' : 'muted'}`}>
            <Check size={10} />
            {canPush ? 'Can push & submit' : 'Read-only review'}
          </span>
        </div>
      </div>

      {released && (
        <div className="den-status-banner" data-testid="banner-released">
          <Check size={14} />
          The Lock is released — the team can download the finals from the vault.
        </div>
      )}

      <div className="role-tabs mb-5">
        {RELAY_LEGS.map((item) => {
          const Icon = item.icon;
          const active = item.leg === LEG;
          const href =
            item.leg === 'SELECTS'
              ? `/projects/${p.id}/selects`
              : item.leg === 'CUT'
                ? `/projects/${p.id}/cut`
                : item.leg === 'SOUND'
                  ? `/projects/${p.id}/sound`
                  : item.leg === 'FINISH'
                    ? `/projects/${p.id}/finish`
                    : `/projects/${p.id}/thumbnail`;
          return (
            <Link key={item.leg} href={href} className={active ? 'active' : ''} data-testid={`finish-tab-leg-${item.leg}`}>
              <Icon size={13} />
              {item.role}
            </Link>
          );
        })}
      </div>

      <div className="den-two-col">
        <div className="space-y-4">
          <ColumnSection
            eyebrow="Review"
            title="Watch & annotate"
            hint="Play the graded master and drop frame or timecode pins. Grading, captions, and lower thirds are authored externally and imported back."
          />

          <FinishPreview
            projectId={p.id}
            snapshot={snapshot}
            assets={p.assets}
            durationMs={timelineDuration}
            playheadMs={playheadMs}
            onTimeUpdate={setPlayheadMs}
            onScrub={setPlayheadMs}
            headVersionId={finishTimeline.data?.versions.find((v) => v.version === finishTimeline.data?.version)?.id ?? null}
          />

          <CommentsPanel projectId={p.id} leg="FINISH" />
        </div>

        <div className="space-y-4">
          <ColumnSection
            eyebrow="Version control"
            title="Checkout, import & review"
            hint="The finish is the diffable artifact. Checkout to edit externally, import the result as a new version, then submit it for review."
          />

          <CheckoutPanel
            projectId={p.id}
            projectName={p.name}
            leg="FINISH"
            savedVersion={finishTimeline.data?.version ?? null}
          />

          <ImportFlow projectId={p.id} leg="FINISH" canEdit={canPush} />

          <HistoryPanel
            projectId={p.id}
            leg="FINISH"
            versions={finishTimeline.data?.versions ?? []}
            currentVersion={finishTimeline.data?.version ?? null}
            canSubmit={canPush}
            wipeFilter={(snap, ms) => {
              const finish = snap as FinishSnapshot;
              const clips = Array.isArray(finish.clips) ? finish.clips : [];
              const clip = clips.find((c) => ms >= c.inMs && ms < Math.max(c.inMs + 1, c.outMs));
              return clip ? gradeFilter(clip.grade) : undefined;
            }}
          />

          <RoleOracle
            leg="FINISH"
            roleName="Motion & Color Director"
            context={oracleContext}
            quickActions={quickActions}
            disabled={!canPush}
            placeholder="e.g. Should this cut feel warmer in the core?"
          />

          {aiResult && (
            <AiResult
              title={aiResult.title}
              meta={aiResult.meta}
              actions={[
                <button key="dismiss" type="button" className="text-btn" onClick={() => setAiResult(null)}>Dismiss</button>,
              ]}
            >
              {aiResult.body}
            </AiResult>
          )}

          <ActivityFeed projectId={p.id} leg="FINISH" className="" />
        </div>
      </div>

      <p className="den-footnote mt-8">
        <LockKeyhole size={13} />
        Submit the publish-ready master — when the Captain approves, the Lock releases and the whole team can download the finals.
      </p>
    </div>
  );
}
