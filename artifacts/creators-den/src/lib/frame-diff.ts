// ---------------------------------------------------------------------------
// Frame diff — the pixel-level difference kernel behind the split-screen
// version-control surface (ported from the smith_mi video-version-comparison
// app's `diff.ts` + `lib/canvas.ts`).
//
// Pure / DOM-light maths (blur, morphology, perceptual scoring) so the
// accuracy-critical code is unit-testable, plus small canvas helpers to draw a
// compared source into a frame and to paint the blue/red difference map.
// ---------------------------------------------------------------------------

/** Separable 3x3 box blur over RGB — suppresses codec grain and sub-pixel
 *  edge shimmer between encodes so only real content differences survive. */
export function boxBlur3(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height;
  const tmp = new Float32Array(n * 4);
  const out = new Float32Array(n * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = (row + x) * 4;
      const xm = x > 0 ? i - 4 : i;
      const xp = x < width - 1 ? i + 4 : i;
      tmp[i] = (data[xm] + data[i] + data[xp]) / 3;
      tmp[i + 1] = (data[xm + 1] + data[i + 1] + data[xp + 1]) / 3;
      tmp[i + 2] = (data[xm + 2] + data[i + 2] + data[xp + 2]) / 3;
    }
  }
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = (row + x) * 4;
      const ym = y > 0 ? i - stride : i;
      const yp = y < height - 1 ? i + stride : i;
      out[i] = (tmp[ym] + tmp[i] + tmp[yp]) / 3;
      out[i + 1] = (tmp[ym + 1] + tmp[i + 1] + tmp[yp + 1]) / 3;
      out[i + 2] = (tmp[ym + 2] + tmp[i + 2] + tmp[yp + 2]) / 3;
    }
  }
  return out;
}

/** Morphological opening (erode then dilate) on a binary mask — removes
 *  isolated speckle while keeping genuine connected regions intact. */
export function openMask(changed: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = new Uint8Array(changed.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      if (!changed[p]) continue;
      const c =
        changed[p - 1] + changed[p + 1] + changed[p - width] + changed[p + width] +
        changed[p - width - 1] + changed[p - width + 1] + changed[p + width - 1] + changed[p + width + 1];
      if (c >= 3) eroded[p] = 1;
    }
  }
  const dilated = new Uint8Array(changed.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      if (!eroded[p]) continue;
      dilated[p] = 1;
      dilated[p - 1] = 1;
      dilated[p + 1] = 1;
      dilated[p - width] = 1;
      dilated[p + width] = 1;
      dilated[p - width - 1] = 1;
      dilated[p - width + 1] = 1;
      dilated[p + width - 1] = 1;
      dilated[p + width + 1] = 1;
    }
  }
  return dilated;
}

export type DiffCore = {
  changed: Uint8Array;
  signedLuma: Float32Array;
  changedFraction: number;
  netDirection: number;
};

/** Blurs both frames, compensates a uniform exposure/colour shift, scores each
 *  pixel perceptually, thresholds by sensitivity (4..60, higher = more
 *  sensitive), then opens the mask. `netDirection` > 0 → V2 brighter. */
export function computeDiffCore(
  aData: Uint8ClampedArray,
  bData: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity: number,
): DiffCore {
  const n = width * height;
  const ba = boxBlur3(aData, width, height);
  const bb = boxBlur3(bData, width, height);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let p = 0, i = 0; p < n; p += 1, i += 4) {
    sumR += bb[i] - ba[i];
    sumG += bb[i + 1] - ba[i + 1];
    sumB += bb[i + 2] - ba[i + 2];
  }
  const offR = sumR / n;
  const offG = sumG / n;
  const offB = sumB / n;

  const norm = (Math.max(4, Math.min(60, sensitivity)) - 4) / 56;
  const threshold = 26 - norm * 18;

  const signedLuma = new Float32Array(n);
  const changed = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p += 1, i += 4) {
    const dR = bb[i] - offR - ba[i];
    const dG = bb[i + 1] - offG - ba[i + 1];
    const dB = bb[i + 2] - offB - ba[i + 2];
    const dLuma = dR * 0.2126 + dG * 0.7152 + dB * 0.0722;
    const chroma = (Math.abs(dR) + Math.abs(dG) + Math.abs(dB)) / 3;
    const score = Math.abs(dLuma) * 0.8 + chroma * 0.2;
    signedLuma[p] = dLuma;
    changed[p] = score > threshold ? 1 : 0;
  }

  const opened = openMask(changed, width, height);
  let count = 0;
  let direction = 0;
  for (let p = 0; p < n; p += 1) {
    if (opened[p]) {
      count += 1;
      direction += signedLuma[p];
    }
  }
  return { changed: opened, signedLuma, changedFraction: count / n, netDirection: direction };
}

export type ChangeSample = { time: number; fraction: number; direction: number };
export type ChangeEvent = { id: string; time: number; label: string; kind: 'blue' | 'red' };

export const DIFF_FPS = 24;

/** Collapse a series of per-sample scores into discrete events: each contiguous
 *  run above the area threshold becomes one event at its peak sample. */
export function buildChangeEvents(samples: ChangeSample[]): ChangeEvent[] {
  const AREA_THRESHOLD = 0.006;
  const events: ChangeEvent[] = [];
  let peak: ChangeSample | null = null;
  const flush = () => {
    if (!peak) return;
    events.push({
      id: `evt-${events.length}-${Math.round(peak.time * 1000)}`,
      time: peak.time,
      label: `${(peak.fraction * 100).toFixed(1)}% of frame`,
      kind: peak.direction >= 0 ? 'blue' : 'red',
    });
    peak = null;
  };
  for (const sample of samples) {
    if (sample.fraction >= AREA_THRESHOLD) {
      if (!peak || sample.fraction > peak.fraction) peak = sample;
    } else {
      flush();
    }
  }
  flush();
  return events.slice(0, 40);
}

/** Draw a source (video frame or image) into a WxH canvas with "contain" fit so
 *  two compared sources align even when their aspect ratios differ. */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  W: number,
  H: number,
): void {
  const vw = sw || W;
  const vh = sh || H;
  const scale = Math.min(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(source, 0, 0, vw, vh, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function fillChangedDots(result: ImageData, changed: Uint8Array, signedLuma: Float32Array): void {
  for (let p = 0, i = 0; p < changed.length; p += 1, i += 4) {
    if (changed[p]) {
      if (signedLuma[p] >= 0) {
        result.data[i] = 42;
        result.data[i + 1] = 193;
        result.data[i + 2] = 246;
      } else {
        result.data[i] = 232;
        result.data[i + 1] = 84;
        result.data[i + 2] = 107;
      }
      result.data[i + 3] = 255;
    }
  }
}

/** The blue/red difference map from two RGBA pixel buffers. Blue = V2 brighter
 *  (added), red = V2 darker (removed); the base is a darkened V1. */
export function renderDiffImage(
  aData: Uint8ClampedArray,
  bData: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const output = canvas.getContext('2d');
  if (!output) return canvas;

  const { changed, signedLuma } = computeDiffCore(aData, bData, width, height, sensitivity);

  const result = output.createImageData(width, height);
  for (let p = 0, i = 0; p < changed.length; p += 1, i += 4) {
    if (!changed[p]) {
      const luminance =
        (aData[i] * 0.2126 + aData[i + 1] * 0.7152 + aData[i + 2] * 0.0722) * 0.22;
      result.data[i] = luminance;
      result.data[i + 1] = luminance + 4;
      result.data[i + 2] = luminance + 10;
    }
    result.data[i + 3] = 255;
  }
  fillChangedDots(result, changed, signedLuma);
  output.putImageData(result, 0, 0);
  return canvas;
}