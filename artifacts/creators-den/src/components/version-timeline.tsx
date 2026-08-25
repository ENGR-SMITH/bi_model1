// ---------------------------------------------------------------------------
// VersionTimeline — the Timeline column of the activity page.
//
// Where the ledger (activity.tsx) is a day-grouped feed of *events*, this is a
// graph of *nodes*: every saved role version AND every raw vault upload, laid
// out as a boustrophedon "snake-and-ladder" — cards zig-zag across two columns,
// newest on top, with arrows tracing the chronological chain from one node to
// the next. Versions read warm (role-toned spine); vault uploads read in a cool
// blue with a dashed border, so the two kinds are unmistakable. The role filter
// is shared with the ledger and lives in the parent (activity.tsx); `leg ===
// 'all'` merges everything.
//
// The snake (bottom = oldest, index 0):
//   pair p = floor(i / 2); p=0 is the bottom row, rows grow upward.
//   even p → left-to-right (arrow →), odd p → right-to-left (arrow ←).
//   a vertical "ladder" arrow joins the last card of pair p up to the first
//   card of pair p+1 — same column: RIGHT when p even, LEFT when p odd.
//   an odd total leaves the newest node alone on the top row; it sits in the
//   single column the incoming ladder arrives on (so the arrow points at it),
//   or centred when it is the only node.
//
// Cards render in chronological DOM order (older first) and are placed into
// their column with an explicit `grid-column`, so the narrow-screen collapse
// (a column-reverse stack) stays newest-first regardless of row direction.
//
// Data reuses the CommitLog pattern: the five legs via useListVideoTimeline-
// Versions, plus useGetVideoProject for the member name-map AND the vault
// assets. The parent ActivityPage already calls useProjectRealtime, which
// invalidates these caches on every save/upload — so this child stays live
// without re-subscribing.
// ---------------------------------------------------------------------------

import { useMemo, type CSSProperties } from 'react';
import { Film, History, Image as ImageIcon, Music, Paperclip } from 'lucide-react';
import {
  useGetVideoProject,
  useListVideoTimelineVersions,
} from '@workspace/api-client-react';
import { RELAY_LEGS } from '@/components/shell';

const LEG_TONES: Record<string, string> = {
  SELECTS: 'gold',
  CUT: 'accent',
  SOUND: 'teal',
  FINISH: 'muted',
  THUMBNAIL: 'accent',
};

// den-tag tone → the HSL *triplet* it paints with, so a version card can carry
// a thin role-coloured spine (`--spine`) matching its tag. Consumed as
// `hsl(var(--spine))`, so `var(--x)` tokens (already triplets) and raw triplets
// both work.
const TONE_SPINE: Record<string, string> = {
  accent: 'var(--accent)',
  gold: 'var(--sidebar-primary)',
  teal: '164 33% 45%',
  muted: 'var(--muted-foreground)',
  danger: 'var(--destructive)',
};

// Vault uploads are a different KIND of node than role versions, so they read in
// a distinct cool blue instead of the warm role tones — see .is-upload in CSS.
const UPLOAD_SPINE = '212 90% 62%';

// A vault asset's kind maps to the relay leg it feeds, so the role filter can
// surface "everything relevant to Sound" (its versions + its audio uploads).
// Unmapped kinds stay leg-less and appear only under "All roles".
const ASSET_LEG: Record<string, string> = {
  RAW_VIDEO: 'SELECTS',
  SCREEN_REC: 'SELECTS',
  REFERENCE: 'SELECTS',
  B_ROLL: 'CUT',
  RAW_AUDIO: 'SOUND',
  VO_PICKUP: 'SOUND',
  GRAPHIC: 'FINISH',
  THUMBNAIL_DESIGN: 'THUMBNAIL',
};

const KIND_LABELS: Record<string, string> = {
  RAW_VIDEO: 'Camera footage',
  RAW_AUDIO: 'Separate audio',
  SCREEN_REC: 'Screen recording',
  B_ROLL: 'B-roll',
  REFERENCE: 'Reference video',
  VO_PICKUP: 'Pickup voiceover',
  GRAPHIC: 'Graphic',
  THUMBNAIL_DESIGN: 'Thumbnail design',
};

const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);
const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);

function uploadIcon(kind: string) {
  if (AUDIO_KINDS.has(kind)) return Music;
  if (IMAGE_KINDS.has(kind)) return ImageIcon;
  if (VIDEO_KINDS.has(kind)) return Film;
  return Paperclip;
}

type TLKind = 'version' | 'upload';

interface TLNode {
  kind: TLKind;
  id: string;
  leg: string | null; // role lane for filtering (uploads mapped by asset kind)
  createdAt: string;
  authorId: string;
  // version-only
  versionNo?: number;
  message?: string;
  parentVersionId?: string | null;
  // upload-only
  assetKind?: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number | null;
}

interface SnakeRow {
  pair: number;
  first: TLNode; // older of the pair — chron[2p]
  second: TLNode | null; // newer — chron[2p+1]; null on the lone top card
  ltr: boolean; // even pair reads left-to-right, odd right-to-left
  lone: boolean;
  loneCol: 1 | 2 | null; // column the lone card hugs (arrival side); null = span
  vLadder: 'left' | 'right' | null; // outgoing-up ladder side (null on top row)
}

function timeAgo(iso: string): string {
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

function absTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function keyOf(node: TLNode): string {
  return `${node.kind}:${node.id}`;
}

// chron = chronological ascending (oldest first). Build rows bottom→up, then
// reverse so the caller renders the newest pair first (top of the page).
function buildSnake(chron: TLNode[]): SnakeRow[] {
  const rowCount = Math.ceil(chron.length / 2);
  const rows: SnakeRow[] = [];
  for (let p = 0; p < rowCount; p++) {
    const second = chron[2 * p + 1] ?? null;
    const ltr = p % 2 === 0;
    const lone = second === null;
    // A lone card hugs the column its incoming ladder arrives on: the row below
    // (p-1) ends on its vLadder side (right when that row is ltr, else left).
    let loneCol: 1 | 2 | null = null;
    if (lone && p > 0) loneCol = (p - 1) % 2 === 0 ? 2 : 1;
    rows.push({
      pair: p,
      first: chron[2 * p],
      second,
      ltr,
      lone,
      loneCol,
      vLadder: p < rowCount - 1 ? (ltr ? 'right' : 'left') : null,
    });
  }
  return rows.reverse();
}

export function VersionTimeline({ projectId, leg, onLegChange }: { projectId: string; leg: string; onLegChange: (leg: string) => void }) {
  const selects = useListVideoTimelineVersions(projectId, 'SELECTS');
  const cut = useListVideoTimelineVersions(projectId, 'CUT');
  const sound = useListVideoTimelineVersions(projectId, 'SOUND');
  const finish = useListVideoTimelineVersions(projectId, 'FINISH');
  const thumbnail = useListVideoTimelineVersions(projectId, 'THUMBNAIL');
  const project = useGetVideoProject(projectId);

  const legQueries = [
    ['SELECTS', selects],
    ['CUT', cut],
    ['SOUND', sound],
    ['FINISH', finish],
    ['THUMBNAIL', thumbnail],
  ] as const;

  // Every saved version across all five legs.
  const versions = useMemo<TLNode[]>(() => {
    const rows: TLNode[] = [];
    for (const [name, query] of legQueries) {
      for (const v of query.data ?? []) {
        rows.push({
          kind: 'version',
          id: v.id,
          leg: name,
          createdAt: v.createdAt,
          authorId: v.createdById,
          versionNo: v.version,
          message: v.message ?? '',
          parentVersionId: v.parentVersionId ?? null,
        });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selects.data, cut.data, sound.data, finish.data, thumbnail.data]);

  // Every raw vault upload, mapped to the leg it feeds (or leg-less).
  const uploads = useMemo<TLNode[]>(
    () =>
      (project.data?.assets ?? []).map((asset) => ({
        kind: 'upload' as const,
        id: asset.id,
        leg: ASSET_LEG[asset.kind] ?? null,
        createdAt: asset.createdAt,
        authorId: asset.uploaderId,
        assetKind: asset.kind,
        fileName: asset.fileName,
        sizeBytes: asset.sizeBytes,
        durationMs: asset.durationMs,
      })),
    [project.data?.assets],
  );

  const merged = useMemo<TLNode[]>(() => [...versions, ...uploads], [versions, uploads]);

  // version id → version number, so each card can show `from v<parent>` — the
  // genealogy resolves across legs even in the merged view (CommitLog §4).
  const versionNumberById = useMemo(() => {
    const m = new Map<string, number>();
    for (const [, query] of legQueries) {
      for (const v of query.data ?? []) m.set(v.id, v.version);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selects.data, cut.data, sound.data, finish.data, thumbnail.data]);

  const memberNameById = useMemo(
    () => new Map((project.data?.members ?? []).map((member) => [member.userId, member.name])),
    [project.data?.members],
  );

  // Filter → sort chronological ascending → snake rows (newest pair first).
  const chron = useMemo(() => {
    const filtered = leg === 'all' ? merged : merged.filter((node) => node.leg === leg);
    return [...filtered].sort((a, b) => {
      const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return byTime !== 0 ? byTime : (a.versionNo ?? 0) - (b.versionNo ?? 0);
    });
  }, [merged, leg]);

  const rows = useMemo(() => buildSnake(chron), [chron]);

  // The head "Latest" crown belongs to the newest *version* in view — a raw
  // upload never earns it, even when it is the newest node chronologically.
  const headKey = useMemo(() => {
    let head: TLNode | null = null;
    for (const node of chron) if (node.kind === 'version') head = node;
    return head ? keyOf(head) : null;
  }, [chron]);

  const copyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
  };

  const loading =
    selects.isLoading || cut.isLoading || sound.isLoading || finish.isLoading || thumbnail.isLoading;

  const renderCard = (node: TLNode, opts: { lone?: boolean; col?: number } = {}) => {
    const isHead = keyOf(node) === headKey;
    const author = memberNameById.get(node.authorId) ?? node.authorId.slice(0, 8);
    const spine =
      node.kind === 'upload'
        ? UPLOAD_SPINE
        : TONE_SPINE[LEG_TONES[node.leg ?? ''] ?? 'muted'] ?? TONE_SPINE.muted;

    const style: Record<string, string> = { '--spine': spine };
    if (opts.lone && opts.col == null) style.gridColumn = '1 / -1';
    else if (opts.col) style.gridColumn = String(opts.col);

    const className = [
      'snake-card',
      isHead && 'is-head',
      opts.lone && opts.col == null && 'is-lone',
      node.kind === 'upload' && 'is-upload',
    ]
      .filter(Boolean)
      .join(' ');

    const idButton = (
      <button
        type="button"
        className="snake-card-id mono-label"
        title={`Copy ${node.kind === 'upload' ? 'asset' : 'version'} ID · ${node.id}`}
        onClick={() => copyId(node.id)}
        data-testid={`snake-id-${node.id}`}
      >
        #{node.id.slice(0, 8)}
      </button>
    );

    if (node.kind === 'upload') {
      const Icon = uploadIcon(node.assetKind ?? '');
      return (
        <article
          className={className}
          style={style as CSSProperties}
          data-testid={`snake-card-upload-${node.id.slice(0, 8)}`}
        >
          <div className="snake-card-head">
            <span className="snake-tag-upload">
              <Icon size={11} />
              Vault
            </span>
            <span className="snake-card-file" title={node.fileName}>
              {node.fileName}
            </span>
          </div>
          <p className="snake-card-kind">{KIND_LABELS[node.assetKind ?? ''] ?? node.assetKind}</p>
          <div className="snake-card-meta">
            {idButton}
            <span className="snake-card-person" title="Uploaded by">
              {author}
            </span>
            <span className="snake-card-sep" aria-hidden />
            <span className="snake-card-time" title={absTime(node.createdAt)}>
              {timeAgo(node.createdAt)}
            </span>
            {node.sizeBytes != null && (
              <span className="snake-card-size">{formatBytes(node.sizeBytes)}</span>
            )}
          </div>
        </article>
      );
    }

    const legMeta = RELAY_LEGS.find((l) => l.leg === node.leg);
    const parent = node.parentVersionId
      ? versionNumberById.get(node.parentVersionId) ?? null
      : null;
    return (
      <article
        className={className}
        style={style as CSSProperties}
        data-testid={`snake-card-${node.leg}-${node.versionNo}`}
      >
        <div className="snake-card-head">
          <span className={`den-tag ${LEG_TONES[node.leg ?? ''] ?? 'muted'}`}>
            {legMeta?.label ?? node.leg}
          </span>
          <span className="snake-card-ver">v{node.versionNo}</span>
          {isHead && <span className="snake-card-latest">Latest</span>}
        </div>
        {node.message && <p className="snake-card-msg">{node.message}</p>}
        <div className="snake-card-meta">
          {idButton}
          <span className="snake-card-person" title="Submitted by">
            {author}
          </span>
          <span className="snake-card-sep" aria-hidden />
          <span className="snake-card-time" title={absTime(node.createdAt)}>
            {timeAgo(node.createdAt)}
          </span>
          {parent !== null && <span className="snake-card-from">from v{parent}</span>}
        </div>
      </article>
    );
  };

  const activeRoleLabel = leg === 'all' ? null : RELAY_LEGS.find((l) => l.leg === leg)?.role ?? leg;

  return (
    <div className="cd-timeline" data-testid="version-timeline">
      {loading ? (
        <div className="panel-empty" data-testid="timeline-loading">Tracing the version graph…</div>
      ) : chron.length === 0 ? (
        <div className="cd-empty" data-testid="timeline-empty">
          <span className="cd-empty-mark" aria-hidden><History size={20} /></span>
          <p>
            {activeRoleLabel
              ? `Nothing from ${activeRoleLabel} yet — no versions saved and no uploads routed here.`
              : 'Nothing yet — every version a role saves and every vault upload lands here and grows the snake.'}
          </p>
        </div>
      ) : (
        <div className="snake" data-testid="timeline-snake">
          {rows.map((row) => {
            const second = row.second;
            return (
              <div
                key={row.pair}
                className={`snake-row ${row.lone ? 'is-lone' : ''}`}
                data-testid={`snake-row-${row.pair}`}
              >
                {row.vLadder && (
                  <span className={`snake-arrow-v on-${row.vLadder}`} aria-hidden data-testid="snake-arrow-v" />
                )}
                {row.lone ? (
                  renderCard(row.first, { lone: true, col: row.loneCol ?? undefined })
                ) : (
                  <>
                    {renderCard(row.first, { col: row.ltr ? 1 : 2 })}
                    <span
                      className={`snake-arrow-h to-${row.ltr ? 'right' : 'left'}`}
                      aria-hidden
                      data-testid="snake-arrow-h"
                    />
                    {second && renderCard(second, { col: row.ltr ? 2 : 1 })}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
