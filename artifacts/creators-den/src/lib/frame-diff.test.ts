import { describe, expect, it } from 'vitest';
import {
  buildChangeEvents,
  computeDiffCore,
  openMask,
  type ChangeSample,
} from './frame-diff';

type RGB = [number, number, number];

function img(width: number, height: number, fill: RGB): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: RGB,
): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

const sum = (arr: Uint8Array | Uint8ClampedArray): number => arr.reduce((s, v) => s + v, 0);

describe('computeDiffCore — false-positive rejection', () => {
  it('identical frames produce zero changes', () => {
    const W = 40;
    const H = 30;
    const a = img(W, H, [100, 120, 140]);
    const core = computeDiffCore(a, a, W, H, 24);
    expect(core.changedFraction).toBe(0);
    expect(core.netDirection).toBe(0);
    expect(core.changed.every((v) => v === 0)).toBe(true);
  });

  it('a uniform brightness shift is compensated, not flagged', () => {
    const W = 40;
    const H = 30;
    const a = img(W, H, [100, 100, 100]);
    const b = img(W, H, [130, 130, 130]); // +30 re-encode/regrade
    const core = computeDiffCore(a, b, W, H, 24);
    expect(core.changedFraction).toBe(0);
  });

  it('scattered single-pixel noise is rejected by blur + threshold', () => {
    const W = 80;
    const H = 80;
    const a = img(W, H, [110, 110, 110]);
    const b = img(W, H, [110, 110, 110]);
    const spikes: Array<[number, number]> = [
      [10, 10], [30, 20], [50, 55], [70, 40], [20, 65], [60, 12],
    ];
    for (const [x, y] of spikes) {
      const i = (y * W + x) * 4;
      b[i] = 200;
      b[i + 1] = 200;
      b[i + 2] = 200;
    }
    const core = computeDiffCore(a, b, W, H, 24);
    expect(core.changedFraction).toBe(0);
  });
});

describe('computeDiffCore — real changes flagged correctly', () => {
  it('a localized brighter region is flagged where it is, in the added direction', () => {
    const W = 120;
    const H = 120;
    const a = img(W, H, [100, 100, 100]);
    const b = img(W, H, [100, 100, 100]);
    fillRect(b, W, 40, 40, 40, 40, [180, 180, 180]); // +80 block, 40x40
    const core = computeDiffCore(a, b, W, H, 24);
    expect(core.changedFraction).toBeGreaterThan(0.05);
    expect(core.changedFraction).toBeLessThan(0.2);
    expect(core.netDirection).toBeGreaterThan(0);
    expect(core.changed[60 * W + 60]).toBe(1);
    expect(core.changed[2 * W + 2]).toBe(0);
  });

  it('a localized darker region is flagged in the removed direction', () => {
    const W = 120;
    const H = 120;
    const a = img(W, H, [100, 100, 100]);
    const b = img(W, H, [100, 100, 100]);
    fillRect(b, W, 40, 40, 40, 40, [20, 20, 20]);
    const core = computeDiffCore(a, b, W, H, 24);
    expect(core.netDirection).toBeLessThan(0);
    expect(core.changed[60 * W + 60]).toBe(1);
  });

  it('higher sensitivity detects a faint change that lower sensitivity misses', () => {
    const W = 120;
    const H = 120;
    const a = img(W, H, [100, 100, 100]);
    const b = img(W, H, [100, 100, 100]);
    fillRect(b, W, 40, 40, 40, 40, [112, 112, 112]); // faint +12 block
    const low = computeDiffCore(a, b, W, H, 6);
    const high = computeDiffCore(a, b, W, H, 60);
    expect(low.changedFraction).toBe(0);
    expect(high.changedFraction).toBeGreaterThan(0);
    expect(high.changedFraction).toBeGreaterThan(low.changedFraction);
  });
});

describe('openMask', () => {
  it('removes an isolated pixel but preserves a solid block', () => {
    const W = 12;
    const H = 12;
    const single = new Uint8Array(W * H);
    single[5 * W + 5] = 1;
    expect(sum(openMask(single, W, H))).toBe(0);

    const block = new Uint8Array(W * H);
    for (let y = 3; y <= 7; y += 1) {
      for (let x = 3; x <= 7; x += 1) block[y * W + x] = 1;
    }
    const opened = openMask(block, W, H);
    expect(opened[5 * W + 5]).toBe(1);
    expect(sum(opened)).toBeGreaterThan(0);
    expect(opened[0]).toBe(0);
  });
});

describe('buildChangeEvents', () => {
  it('collapses a contiguous run into one event at its peak', () => {
    const samples: ChangeSample[] = [
      { time: 0.0, fraction: 0.0, direction: 0 },
      { time: 0.5, fraction: 0.01, direction: 5 },
      { time: 1.0, fraction: 0.04, direction: 8 },
      { time: 1.5, fraction: 0.012, direction: 3 },
      { time: 2.0, fraction: 0.0, direction: 0 },
    ];
    const events = buildChangeEvents(samples);
    expect(events.length).toBe(1);
    expect(events[0].time).toBe(1.0);
    expect(events[0].kind).toBe('blue');
    expect(events[0].label).toMatch(/4\.0% of frame/);
  });

  it('separates distinct runs and colours by direction', () => {
    const samples: ChangeSample[] = [
      { time: 0.5, fraction: 0.02, direction: -4 },
      { time: 1.0, fraction: 0.002, direction: 0 },
      { time: 1.5, fraction: 0.03, direction: 9 },
    ];
    const events = buildChangeEvents(samples);
    expect(events.length).toBe(2);
    expect(events[0].kind).toBe('red');
    expect(events[1].kind).toBe('blue');
  });
});