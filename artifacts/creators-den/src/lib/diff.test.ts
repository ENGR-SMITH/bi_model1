import { describe, expect, it } from 'vitest';
import {
  activeClipAt,
  diffSummary,
  diffTimelineSnapshots,
  type TimelineSnapshotLike,
} from './diff';

const camA = 'asset-cam-a';
const camB = 'asset-cam-b';

function clip(id: string, assetId: string, inMs: number, outMs: number, src?: { srcInMs: number; srcOutMs: number }) {
  return { id, assetId, inMs, outMs, ...src };
}

function snapshot(clips: TimelineSnapshotLike['clips'] = [], sceneBlocks: TimelineSnapshotLike['sceneBlocks'] = [], markers: TimelineSnapshotLike['markers'] = [], designs: TimelineSnapshotLike['designs'] = []): TimelineSnapshotLike {
  return { clips, sceneBlocks, markers, designs };
}

function design(assetId: string, title: string, style: string) {
  return { id: `d-${assetId}`, assetId, title, style };
}

describe('diffTimelineSnapshots', () => {
  it('reports an empty diff for identical snapshots', () => {
    const a = snapshot([clip('c1', camA, 0, 5000), clip('c2', camB, 5000, 10000)]);
    const diff = diffTimelineSnapshots(a, snapshot(a.clips));
    expect(diff.clips).toHaveLength(0);
    expect(diff.counts.clips).toEqual({ added: 0, removed: 0, moved: 0, trimmed: 0, slipped: 0 });
    expect(diffSummary(diff)).toBe('No changes');
  });

  it('flags added and removed clips', () => {
    const a = snapshot([clip('c1', camA, 0, 5000)]);
    const b = snapshot([clip('c1', camA, 0, 5000), clip('c2', camB, 5000, 10000)]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.added).toBe(1);
    expect(diff.counts.clips.removed).toBe(0);
    expect(diff.clips[0].kind).toBe('added');
    expect(diff.clips[0].assetId).toBe(camB);
  });

  it('flags removed clips', () => {
    const a = snapshot([clip('c1', camA, 0, 5000), clip('c2', camB, 5000, 10000)]);
    const b = snapshot([clip('c1', camA, 0, 5000)]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.removed).toBe(1);
    expect(diff.clips[0].kind).toBe('removed');
    expect(diff.clips[0].assetId).toBe(camB);
  });

  it('flags trimmed clips with the previous window', () => {
    const a = snapshot([clip('c1', camA, 0, 5000)]);
    const b = snapshot([clip('c1', camA, 0, 6000)]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.trimmed).toBe(1);
    expect(diff.clips[0]).toMatchObject({ kind: 'trimmed', wasInMs: 0, wasOutMs: 5000, inMs: 0, outMs: 6000 });
  });

  it('flags slipped clips when only the source window changes', () => {
    const a = snapshot([clip('c1', camA, 0, 5000, { srcInMs: 0, srcOutMs: 5000 })]);
    const b = snapshot([clip('c1', camA, 0, 5000, { srcInMs: 2000, srcOutMs: 7000 })]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.slipped).toBe(1);
    expect(diff.clips[0]).toMatchObject({ kind: 'slipped', wasSrcInMs: 0, wasSrcOutMs: 5000 });
  });

  it('flags reordered clips as moved without false positives on insertions', () => {
    const a = snapshot([
      clip('c1', camA, 0, 5000),
      clip('c2', camB, 5000, 10000),
      clip('c3', camA, 10000, 15000),
    ]);
    // c3 moves to the front; c2 stays put.
    const b = snapshot([
      clip('c3', camA, 10000, 15000),
      clip('c1', camA, 0, 5000),
      clip('c2', camB, 5000, 10000),
    ]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.moved).toBe(1);
    expect(diff.clips[0]).toMatchObject({ kind: 'moved', assetId: camA, fromPosition: 3, position: 1 });
  });

  it('matches clips across EDL imports whose ids were regenerated', () => {
    const a = snapshot([
      clip('import-1', camA, 0, 5000),
      clip('import-2', camB, 5000, 10000),
      clip('import-3', camA, 10000, 15000),
    ]);
    // A re-import mints fresh ids; camB clip was trimmed and moved.
    const b = snapshot([
      clip('import-9', camA, 10000, 15000),
      clip('import-10', camA, 0, 5000),
      clip('import-11', camB, 5000, 12000),
    ]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.added).toBe(0);
    expect(diff.counts.clips.removed).toBe(0);
    expect(diff.counts.clips.moved).toBe(1);
    expect(diff.counts.clips.trimmed).toBe(1);
  });

  it('diffs scene blocks by type', () => {
    const a = snapshot([], [
      { id: 's1', type: 'HOOK', startMs: 0, endMs: 10000 },
      { id: 's2', type: 'CORE', startMs: 30000, endMs: 60000 },
    ]);
    const b = snapshot([], [
      { id: 's1', type: 'HOOK', startMs: 0, endMs: 10000 },
      { id: 's3', type: 'SETUP', startMs: 12000, endMs: 25000 },
      { id: 's2', type: 'CORE', startMs: 40000, endMs: 65000 },
    ]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.sceneBlocks.added).toBe(1);
    expect(diff.counts.sceneBlocks.trimmed).toBe(1);
    expect(diff.sceneBlocks.find((block) => block.type === 'SETUP')?.kind).toBe('added');
    expect(diff.sceneBlocks.find((block) => block.type === 'CORE')).toMatchObject({ kind: 'trimmed', wasStartMs: 30000, startMs: 40000 });
  });

  it('diffs markers by id and reports time moves', () => {
    const a = snapshot([], [], [
      { id: 'm1', label: 'intro', timeMs: 2000 },
      { id: 'm2', label: 'beat', timeMs: 9000 },
    ]);
    const b = snapshot([], [], [
      { id: 'm1', label: 'intro', timeMs: 2500 },
      { id: 'm3', label: 'cta', timeMs: 70000 },
    ]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.markers.moved).toBe(1);
    expect(diff.counts.markers.added).toBe(1);
    expect(diff.counts.markers.removed).toBe(1);
    expect(diff.markers.find((marker) => marker.label === 'intro')).toMatchObject({ kind: 'moved', wasTimeMs: 2000, timeMs: 2500 });
  });

  it('tolerates null or missing snapshots', () => {
    const diff = diffTimelineSnapshots(null, undefined);
    expect(diff.clips).toHaveLength(0);
    expect(diffSummary(diff)).toBe('No changes');
  });
});

describe('designs diff (THUMBNAIL leg)', () => {
  it('reports no design changes when the chosen image is untouched', () => {
    const a = snapshot([], [], [], [design('design-a', 'Title', 'SPLIT')]);
    const diff = diffTimelineSnapshots(a, snapshot([], [], [], [design('design-a', 'Title', 'SPLIT')]));
    expect(diff.designs).toHaveLength(0);
    expect(diff.counts.designs).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(diffSummary(diff)).toBe('No changes');
  });

  it('flags a newly chosen design as added', () => {
    const a = snapshot([], [], [], []);
    const b = snapshot([], [], [], [design('design-b', 'New title', 'TEXT_OVERLAY')]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.designs.added).toBe(1);
    expect(diff.designs[0]).toMatchObject({ kind: 'added', assetId: 'design-b', title: 'New title' });
  });

  it('flags a dropped design as removed', () => {
    const a = snapshot([], [], [], [design('design-a', 'Title', 'SPLIT')]);
    const b = snapshot([], [], [], []);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.designs.removed).toBe(1);
    expect(diff.designs[0]).toMatchObject({ kind: 'removed', assetId: 'design-a' });
  });

  it('flags a title or style change on the same image as changed', () => {
    const a = snapshot([], [], [], [design('design-a', 'Old title', 'SPLIT')]);
    const b = snapshot([], [], [], [design('design-a', 'New title', 'FACE_CLOSEUP')]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.designs.changed).toBe(1);
    expect(diff.designs[0]).toMatchObject({
      kind: 'changed',
      assetId: 'design-a',
      wasTitle: 'Old title',
      title: 'New title',
      wasStyle: 'SPLIT',
      style: 'FACE_CLOSEUP',
    });
  });

  it('keeps clip diffs independent of design diffs', () => {
    const a = snapshot([clip('c1', camA, 0, 5000)], [], [], [design('design-a', 'Title', 'SPLIT')]);
    const b = snapshot([clip('c1', camA, 0, 6000)], [], [], [design('design-b', 'Title', 'SPLIT')]);
    const diff = diffTimelineSnapshots(a, b);
    expect(diff.counts.clips.trimmed).toBe(1);
    expect(diff.counts.designs).toEqual({ added: 1, removed: 1, changed: 0 });
  });
});

describe('activeClipAt', () => {
  it('returns the clip under the playhead', () => {
    const s = snapshot([clip('c1', camA, 0, 5000), clip('c2', camB, 5000, 10000)]);
    expect(activeClipAt(s, 6000)?.assetId).toBe(camB);
    expect(activeClipAt(s, 0)?.assetId).toBe(camA);
    expect(activeClipAt(s, 12000)).toBeNull();
  });
});
