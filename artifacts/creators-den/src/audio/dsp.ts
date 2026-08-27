// Pure, DOM-free audio difference kernel — ported from the smith_mi
// video-version-comparison app (`audio/dsp.ts`). Everything is unit-testable in
// Node: FFT, resampling, log-frequency band analysis, and the added / removed /
// common classifier that drives the waveform tints and the spectral diff map.

export const ANALYSIS_RATE = 22050;
export const DEFAULT_FFT_SIZE = 2048;
export const DEFAULT_HOP_SIZE = 512;
export const MAX_ANALYSIS_WINDOWS = 3600;
export const MAX_ANALYSIS_SECONDS = 1800;

export const CLASS_SILENCE = 0;
export const CLASS_COMMON = 1;
export const CLASS_ADDED = 2;
export const CLASS_REMOVED = 3;

/** Iterative radix-2 Cooley–Tukey FFT, in place. `re`/`im` must be power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const HANN_CACHE = new Map<number, Float64Array>();

export function hannWindow(size: number): Float64Array {
  let cached = HANN_CACHE.get(size);
  if (!cached) {
    cached = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      cached[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    HANN_CACHE.set(size, cached);
  }
  return cached;
}

/** Windowed FFT magnitudes for `size` samples starting at `start`. */
export function windowMagnitudes(
  samples: Float32Array,
  start: number,
  size: number,
): Float64Array {
  const win = hannWindow(size);
  const re = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const s = start + i < samples.length ? samples[start + i] : 0;
    re[i] = s * win[i];
  }
  const im = new Float64Array(size);
  fft(re, im);
  const half = (size >> 1) + 1;
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k += 1) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

/** Linear-interpolation resampler that moves both files onto one grid. */
export function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (input.length === 0 || toRate <= 0) return new Float32Array(0);
  const outLength = Math.max(1, Math.floor((input.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  const step = fromRate / toRate;
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * step;
    const lo = Math.floor(pos);
    const hi = Math.min(input.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

export type Band = {
  index: number;
  startBin: number;
  endBin: number;
  startHz: number;
  endHz: number;
  centerHz: number;
};

export function buildBands(
  fftSize: number,
  sampleRate: number,
  bandCount = 72,
  minHz = 40,
  maxHz = 18000,
): Band[] {
  const bands: Band[] = [];
  const nyquist = sampleRate / 2;
  const lo = Math.min(Math.max(minHz, 20), nyquist * 0.5);
  const hi = Math.min(Math.max(maxHz, lo * 2), nyquist * 0.95);
  const binHz = sampleRate / fftSize;
  for (let b = 0; b < bandCount; b += 1) {
    const t0 = b / bandCount;
    const t1 = (b + 1) / bandCount;
    const f0 = lo * Math.pow(hi / lo, t0);
    const f1 = lo * Math.pow(hi / lo, t1);
    const startBin = Math.max(1, Math.round(f0 / binHz));
    const endBin = Math.min(fftSize / 2, Math.max(startBin + 1, Math.round(f1 / binHz)));
    bands.push({
      index: b,
      startBin,
      endBin,
      startHz: f0,
      endHz: f1,
      centerHz: Math.sqrt(f0 * f1),
    });
  }
  return bands;
}

export type AudioDiffOptions = {
  fftSize?: number;
  hopSize?: number;
  slackDb?: number;
  levelMatch?: boolean;
  pitchShiftRatio?: number;
};

export type WindowAnalysis = {
  time: number;
  cls: number;
  addedFraction: number;
  removedFraction: number;
  commonFraction: number;
  silenceFraction: number;
  peakDb: number;
  centroid1: number;
  centroid2: number;
  pitchShift: boolean;
  bandClasses: Uint8Array;
};

export type AudioDiffEventKind = 'added' | 'removed' | 'pitch';

export type AudioDiffEvent = {
  id: string;
  start: number;
  end: number;
  time: number;
  kind: AudioDiffEventKind;
  label: string;
  strength: number;
};

export type AudioDiffResult = {
  sampleRate: number;
  duration: number;
  fftSize: number;
  hopSize: number;
  bands: Band[];
  windows: WindowAnalysis[];
  events: AudioDiffEvent[];
  stats: {
    addedSeconds: number;
    removedSeconds: number;
    commonSeconds: number;
    silenceSeconds: number;
    pitchShiftSeconds: number;
  };
  peakDb: number;
};

function rmsOf(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function scaled(data: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i] * gain;
  return out;
}

export function compareAudio(
  v1In: Float32Array,
  v2In: Float32Array,
  sampleRate: number,
  options: AudioDiffOptions = {},
): AudioDiffResult {
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
  const slackDb = options.slackDb ?? 6;
  const levelMatch = options.levelMatch ?? true;
  const pitchShiftRatio = options.pitchShiftRatio ?? 1.18;

  let v1 = v1In;
  let v2 = v2In;
  if (levelMatch) {
    const rms1 = rmsOf(v1);
    const rms2 = rmsOf(v2);
    if (rms1 > 1e-6 && rms2 > 1e-6) {
      const gain = rms1 / rms2;
      if (Number.isFinite(gain) && gain > 0 && gain < 1e4) v2 = scaled(v2, gain);
    }
  }

  const duration = Math.max(v1.length, v2.length) / sampleRate;
  let hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const idealWindows = Math.max(1, Math.floor((duration * sampleRate) / hopSize) + 1);
  if (idealWindows > MAX_ANALYSIS_WINDOWS) {
    hopSize = Math.ceil((idealWindows / MAX_ANALYSIS_WINDOWS) * hopSize);
  }
  const windowCount = Math.max(1, Math.floor((duration * sampleRate) / hopSize) + 1);

  const bands = buildBands(fftSize, sampleRate);
  const bandCount = bands.length;
  const half = (fftSize >> 1) + 1;

  const db1All = new Float64Array(windowCount * bandCount);
  const db2All = new Float64Array(windowCount * bandCount);
  const centroid1All = new Float64Array(windowCount);
  const centroid2All = new Float64Array(windowCount);

  const mag1 = new Float64Array(half);
  const mag2 = new Float64Array(half);
  let peakDb = -Infinity;

  for (let wi = 0; wi < windowCount; wi += 1) {
    const start = wi * hopSize;
    const m1 = windowMagnitudesInto(v1, start, fftSize, mag1);
    const m2 = windowMagnitudesInto(v2, start, fftSize, mag2);
    const base = wi * bandCount;
    for (let b = 0; b < bandCount; b += 1) {
      const band = bands[b];
      const e1 = bandEnergy(m1, band);
      const e2 = bandEnergy(m2, band);
      const db1 = 10 * Math.log10(e1 + 1e-12);
      const db2 = 10 * Math.log10(e2 + 1e-12);
      db1All[base + b] = db1;
      db2All[base + b] = db2;
      if (db1 > peakDb) peakDb = db1;
      if (db2 > peakDb) peakDb = db2;
    }
    centroid1All[wi] = spectralCentroid(m1, sampleRate, fftSize);
    centroid2All[wi] = spectralCentroid(m2, sampleRate, fftSize);
  }
  if (!Number.isFinite(peakDb) || peakDb < -200) peakDb = -80;

  const floorDb = peakDb - 84;

  const windows: WindowAnalysis[] = [];
  let addedSeconds = 0;
  let removedSeconds = 0;
  let commonSeconds = 0;
  let silenceSeconds = 0;
  let pitchShiftSeconds = 0;
  const hopSeconds = hopSize / sampleRate;
  const logPitchRatio = Math.log(pitchShiftRatio);

  for (let wi = 0; wi < windowCount; wi += 1) {
    const base = wi * bandCount;
    const bandClasses = new Uint8Array(bandCount);
    let addedE = 0;
    let removedE = 0;
    let commonE = 0;
    let silenceE = 0;
    let winPeakDb = -Infinity;
    for (let b = 0; b < bandCount; b += 1) {
      const db1 = db1All[base + b];
      const db2 = db2All[base + b];
      const maxDb = db1 > db2 ? db1 : db2;
      if (maxDb > winPeakDb) winPeakDb = maxDb;
      const e1 = Math.pow(10, db1 / 10);
      const e2 = Math.pow(10, db2 / 10);
      let cls: number;
      if (maxDb < floorDb) {
        cls = CLASS_SILENCE;
      } else {
        const diff = db2 - db1;
        if (diff > slackDb) cls = CLASS_ADDED;
        else if (diff < -slackDb) cls = CLASS_REMOVED;
        else cls = CLASS_COMMON;
      }
      bandClasses[b] = cls;
      if (cls === CLASS_ADDED) addedE += e2;
      else if (cls === CLASS_REMOVED) removedE += e1;
      else if (cls === CLASS_COMMON) commonE += (e1 + e2) / 2;
      else silenceE += (e1 + e2) / 2;
    }
    const totalE = addedE + removedE + commonE + silenceE;
    const fracA = totalE > 0 ? addedE / totalE : 0;
    const fracR = totalE > 0 ? removedE / totalE : 0;
    const fracC = totalE > 0 ? commonE / totalE : 0;

    let cls: number;
    if (winPeakDb < peakDb - 70) {
      cls = CLASS_SILENCE;
    } else if (fracA >= 0.18 && fracA >= fracR && fracA >= fracC) {
      cls = CLASS_ADDED;
    } else if (fracR >= 0.18 && fracR > fracA && fracR >= fracC) {
      cls = CLASS_REMOVED;
    } else if (fracC >= 0.5 || (fracA < 0.18 && fracR < 0.18)) {
      cls = CLASS_COMMON;
    } else {
      cls = fracA >= fracR ? CLASS_ADDED : CLASS_REMOVED;
    }

    const c1 = centroid1All[wi];
    const c2 = centroid2All[wi];
    const hasEnergy = winPeakDb >= peakDb - 40;
    const pitchShift = hasEnergy && c1 > 0 && c2 > 0 && Math.abs(Math.log(c2 / c1)) > logPitchRatio;

    windows.push({
      time: (wi * hopSize) / sampleRate,
      cls,
      addedFraction: fracA,
      removedFraction: fracR,
      commonFraction: fracC,
      silenceFraction: totalE > 0 ? silenceE / totalE : 0,
      peakDb: winPeakDb - peakDb,
      centroid1: c1,
      centroid2: c2,
      pitchShift,
      bandClasses,
    });

    if (cls === CLASS_ADDED) addedSeconds += hopSeconds;
    else if (cls === CLASS_REMOVED) removedSeconds += hopSeconds;
    else if (cls === CLASS_COMMON) commonSeconds += hopSeconds;
    else silenceSeconds += hopSeconds;
    if (pitchShift) pitchShiftSeconds += hopSeconds;
  }

  const events = buildAudioEvents(windows, sampleRate, hopSize);

  return {
    sampleRate,
    duration,
    fftSize,
    hopSize,
    bands,
    windows,
    events,
    stats: {
      addedSeconds,
      removedSeconds,
      commonSeconds,
      silenceSeconds,
      pitchShiftSeconds,
    },
    peakDb,
  };
}

function windowMagnitudesInto(
  samples: Float32Array,
  start: number,
  size: number,
  out: Float64Array,
): Float64Array {
  const win = hannWindow(size);
  const re = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const s = start + i < samples.length ? samples[start + i] : 0;
    re[i] = s * win[i];
  }
  const im = new Float64Array(size);
  fft(re, im);
  const half = (size >> 1) + 1;
  for (let k = 0; k < half; k += 1) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/** Power spectral density per band (mag^2 per Hz) — width-compensated. */
function bandEnergy(mag: Float64Array, band: Band): number {
  let sum = 0;
  for (let k = band.startBin; k < band.endBin; k += 1) {
    const m = mag[k];
    sum += m * m;
  }
  return sum / (band.endHz - band.startHz);
}

/** Energy-weighted mean frequency, ignoring quiet hiss. */
function spectralCentroid(mag: Float64Array, sampleRate: number, fftSize: number): number {
  const half = mag.length;
  let peak = 0;
  for (let k = 1; k < half; k += 1) if (mag[k] > peak) peak = mag[k];
  const floor = peak * 0.02;
  let num = 0;
  let den = 0;
  const binHz = sampleRate / fftSize;
  for (let k = 1; k < half; k += 1) {
    const m = mag[k];
    if (m < floor) continue;
    num += k * binHz * m;
    den += m;
  }
  return den > 0 ? num / den : 0;
}

/** Collapse window classifications into discrete events. */
export function buildAudioEvents(
  windows: WindowAnalysis[],
  sampleRate: number,
  hopSize: number,
): AudioDiffEvent[] {
  const events: AudioDiffEvent[] = [];
  const hopSeconds = hopSize / sampleRate;
  let runKind: AudioDiffEventKind | null = null;
  let runStart = 0;
  let runEnd = 0;
  let peakIndex = 0;
  let peakStrength = 0;

  const flush = () => {
    if (runKind === null) return;
    const len = runEnd - runStart;
    if (len < 2) {
      runKind = null;
      return;
    }
    const w = windows[peakIndex];
    let label: string;
    if (runKind === 'added') {
      label = `Added audio · ${(len * hopSeconds).toFixed(2)}s`;
    } else if (runKind === 'removed') {
      label = `Removed audio · ${(len * hopSeconds).toFixed(2)}s`;
    } else {
      const ratio = w.centroid2 / w.centroid1;
      label = `Tone / pitch shift · ${ratio >= 1 ? 'up' : 'down'} ${Math.abs(Math.round((ratio - 1) * 100))}%`;
    }
    events.push({
      id: `aevt-${events.length}-${Math.round(w.time * 1000)}`,
      start: windows[runStart].time,
      end: windows[runEnd].time + hopSeconds,
      time: w.time,
      kind: runKind,
      label,
      strength: Math.min(1, peakStrength),
    });
    runKind = null;
  };

  for (let wi = 0; wi < windows.length; wi += 1) {
    const w = windows[wi];
    let kind: AudioDiffEventKind | null = null;
    let strength = 0;
    if (w.pitchShift && w.centroid1 > 0 && w.centroid2 > 0) {
      kind = 'pitch';
      strength = Math.min(1, Math.abs(Math.log(w.centroid2 / w.centroid1)) / 0.35);
    } else if (w.cls === CLASS_ADDED) {
      kind = 'added';
      strength = w.addedFraction;
    } else if (w.cls === CLASS_REMOVED) {
      kind = 'removed';
      strength = w.removedFraction;
    }
    if (kind === null || kind !== runKind) {
      flush();
      runKind = kind;
      runStart = wi;
      runEnd = wi;
      peakIndex = wi;
      peakStrength = strength;
    } else {
      runEnd = wi;
      if (strength > peakStrength) {
        peakStrength = strength;
        peakIndex = wi;
      }
    }
  }
  flush();
  return events.slice(0, 60);
}

/** Format seconds as mm:ss. */
export function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}