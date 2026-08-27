import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_RATE,
  CLASS_ADDED,
  CLASS_COMMON,
  CLASS_REMOVED,
  compareAudio,
} from './dsp';

/** A short tone-ish arbitrary waveform so spectra are non-trivial. */
function signal(seconds: number, freq: number, seed = 1): Float32Array {
  const n = Math.floor(seconds * ANALYSIS_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / ANALYSIS_RATE;
    const phase = t * freq;
    // Sum a few harmonics so band classification is not a pure single bin.
    out[i] = 0.6 * Math.sin(2 * Math.PI * phase + seed) + 0.3 * Math.sin(2 * Math.PI * phase * 2.7);
  }
  return out;
}

describe('compareAudio', () => {
  it('classifies identical files as common (no added/removed), no events', () => {
    const v1 = signal(1, 440);
    const v2 = v1.slice();
    const result = compareAudio(v1, v2, ANALYSIS_RATE, { slackDb: 6 });
    expect(result.windows.length).toBeGreaterThan(0);
    let added = 0;
    let removed = 0;
    for (const w of result.windows) {
      if (w.cls === CLASS_ADDED) added += 1;
      if (w.cls === CLASS_REMOVED) removed += 1;
    }
    // Level-match equalizes exactly; symmetric silence may read common.
    expect(result.stats.addedSeconds).toBeLessThan(0.1);
    expect(result.stats.removedSeconds).toBeLessThan(0.1);
    expect(added).toBe(0);
    expect(removed).toBe(0);
    expect(result.events.length).toBe(0);
  });

  it('detects added audio when the second file has extra content', () => {
    const v1 = signal(1, 440); // baseline
    const v2 = signal(1.6, 440); // same tone, but longer
    const result = compareAudio(v1, v2, ANALYSIS_RATE, { slackDb: 6 });
    const common = result.windows.filter((w) => w.cls === CLASS_COMMON).length;
    expect(common).toBeGreaterThan(0);
    expect(result.stats.addedSeconds).toBeGreaterThan(0);
    expect(result.events.some((e) => e.kind === 'added')).toBe(true);
  });
});