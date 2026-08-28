import { describe, expect, it } from 'vitest';
import { predecessorOf, type PreviewDiffSelection } from './preview-diff';

const v = (id: string, leg: string, version: number, parentVersionId?: string): PreviewDiffSelection => ({
  id,
  leg: leg as PreviewDiffSelection['leg'],
  version,
  parentVersionId,
});

// A timeline chain like the user described: VIDEO A -> VIDEO B -> VIDEO C
// (oldest first here; the API returns them newest-first).
const videoChain: PreviewDiffSelection[] = [
  v('c', 'SELECTS', 3, 'b'),
  v('b', 'SELECTS', 2, 'a'),
  v('a', 'SELECTS', 1, undefined),
];

describe('predecessorOf — preview split-screen diff pairing', () => {
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