import { describe, expect, it } from 'vitest';
import { predecessorOf, type PreviewDiffSelection } from './preview-diff';

const v = (id: string, leg: string, version: number, parentVersionId?: string): PreviewDiffSelection => ({
  key: `version-${id}`,
  id,
  leg: leg as PreviewDiffSelection['leg'],
  kind: 'version',
  version,
  parentVersionId,
  createdAt: `2026-01-01T00:0${version}:00Z`,
});

const asset = (id: string, leg: string, day: number, label?: string): PreviewDiffSelection => ({
  key: `asset-${id}`,
  id,
  leg: leg as PreviewDiffSelection['leg'],
  kind: 'asset',
  createdAt: `2026-01-0${day}T00:00:00Z`,
  label: label ?? id,
});

// A timeline chain like the user described: VIDEO A -> VIDEO B -> VIDEO C
// (oldest first here; the API returns them newest-first).
const videoChain: PreviewDiffSelection[] = [
  v('c', 'SELECTS', 3, 'b'),
  v('b', 'SELECTS', 2, 'a'),
  v('a', 'SELECTS', 1),
];

describe('predecessorOf — version chains (oldest -> null, B vs A, C vs B)', () => {
  it('oldest version (A) has no predecessor -> no diff to show', () => {
    expect(predecessorOf(videoChain, v('a', 'SELECTS', 1))).toBeNull();
  });

  it('version B compares against its immediate older version A', () => {
    const pred = predecessorOf(videoChain, v('b', 'SELECTS', 2));
    expect(pred?.id).toBe('a');
    expect(pred?.version).toBe(1);
  });

  it('version C compares against its immediate older version B', () => {
    const pred = predecessorOf(videoChain, v('c', 'SELECTS', 3));
    expect(pred?.id).toBe('b');
    expect(pred?.version).toBe(2);
  });

  it('walks the parentVersionId chain even when out of sequential order', () => {
    const chain: PreviewDiffSelection[] = [
      v('c', 'SELECTS', 4, 'a'),
      v('b', 'SELECTS', 3),
      v('a', 'SELECTS', 2),
      v('seed', 'SELECTS', 1),
    ];
    // C's parent is A (not the sequential B) — the direct parent wins.
    expect(predecessorOf(chain, v('c', 'SELECTS', 4, 'a'))?.id).toBe('a');
  });

  it('ignores other legs when pairing (SELECTS vs CUT stay independent)', () => {
    const mixed: PreviewDiffSelection[] = [
      v('c', 'SELECTS', 3, 'b'),
      v('b', 'SELECTS', 2, 'a'),
      v('a', 'SELECTS', 1),
      v('k2', 'CUT', 2, 'k1'),
      v('k1', 'CUT', 1),
    ];
    expect(predecessorOf(mixed, v('c', 'SELECTS', 3))?.id).toBe('b');
    expect(predecessorOf(mixed, v('k2', 'CUT', 2))?.id).toBe('k1');
  });

  it('lone version has no predecessor', () => {
    expect(predecessorOf([v('a', 'THUMBNAIL', 1)], v('a', 'THUMBNAIL', 1))).toBeNull();
  });

  it('audio chain pairs the same way', () => {
    const audio: PreviewDiffSelection[] = [
      v('s3', 'SOUND', 3, 's2'),
      v('s2', 'SOUND', 2, 's1'),
      v('s1', 'SOUND', 1),
    ];
    expect(predecessorOf(audio, v('s3', 'SOUND', 3))?.id).toBe('s2');
    expect(predecessorOf(audio, v('s2', 'SOUND', 2))?.id).toBe('s1');
    expect(predecessorOf(audio, v('s1', 'SOUND', 1))).toBeNull();
  });
});

describe('predecessorOf — vault file chains (multiple images/audio/video)', () => {
  const imageChain: PreviewDiffSelection[] = [
    asset('img3', 'THUMBNAIL', 9, 'cover-final.png'),
    asset('img2', 'THUMBNAIL', 5, 'cover-2.png'),
    asset('img1', 'THUMBNAIL', 1, 'cover-1.png'),
  ];

  it('newest image compares against the older image', () => {
    const pred = predecessorOf(imageChain, asset('img3', 'THUMBNAIL', 9));
    expect(pred?.id).toBe('img2');
    expect(pred?.label).toBe('cover-2.png');
  });

  it('middle image compares against the first one', () => {
    expect(predecessorOf(imageChain, asset('img2', 'THUMBNAIL', 5))?.id).toBe('img1');
  });

  it('oldest image has no predecessor', () => {
    expect(predecessorOf(imageChain, asset('img1', 'THUMBNAIL', 1))).toBeNull();
  });

  it('audio and video files pair the same way', () => {
    const audioChain: PreviewDiffSelection[] = [
      asset('a2', 'SOUND', 8, 'vo-2.wav'),
      asset('a1', 'SOUND', 2, 'vo-1.wav'),
    ];
    expect(predecessorOf(audioChain, asset('a2', 'SOUND', 8))?.id).toBe('a1');
    expect(predecessorOf(audioChain, asset('a1', 'SOUND', 2))).toBeNull();

    const videoChainAssets: PreviewDiffSelection[] = [
      asset('m2', 'SELECTS', 7, 'take-2.mp4'),
      asset('m1', 'SELECTS', 3, 'take-1.mp4'),
    ];
    expect(predecessorOf(videoChainAssets, asset('m2', 'SELECTS', 7))?.id).toBe('m1');
  });

  it('a version never pairs with a file (and vice versa) — kinds stay separate', () => {
    const mixed: PreviewDiffSelection[] = [
      v('b', 'THUMBNAIL', 2, 'a'),
      v('a', 'THUMBNAIL', 1),
      asset('img1', 'THUMBNAIL', 1, 'cover-1.png'),
      asset('img2', 'THUMBNAIL', 2, 'cover-2.png'),
    ];
    // The version selects an older VERSION, not the newer image file.
    expect(predecessorOf(mixed, v('b', 'THUMBNAIL', 2))?.kind).toBe('version');
    expect(predecessorOf(mixed, v('b', 'THUMBNAIL', 2))?.id).toBe('a');
    // The image selects an older IMAGE, not the version.
    expect(predecessorOf(mixed, asset('img2', 'THUMBNAIL', 2))?.kind).toBe('asset');
    expect(predecessorOf(mixed, asset('img2', 'THUMBNAIL', 2))?.id).toBe('img1');
  });
});