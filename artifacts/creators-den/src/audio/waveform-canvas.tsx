import { useCallback, useEffect, useRef } from 'react';

import {
  CLASS_ADDED,
  CLASS_COMMON,
  CLASS_REMOVED,
  CLASS_SILENCE,
  type AudioDiffResult,
  type WindowAnalysis,
} from './dsp';

export const CLASS_COLORS: Record<number, string> = {
  [CLASS_SILENCE]: '#0c161d',
  [CLASS_COMMON]: '#7d8e97',
  [CLASS_ADDED]: '#2fc6f0',
  [CLASS_REMOVED]: '#f16672',
};

const CLASS_RGB: Record<number, [number, number, number]> = {
  [CLASS_SILENCE]: [13, 22, 30],
  [CLASS_COMMON]: [120, 136, 145],
  [CLASS_ADDED]: [58, 197, 250],
  [CLASS_REMOVED]: [241, 102, 114],
};

export const CLASS_LABELS: Record<number, string> = {
  [CLASS_SILENCE]: 'Silence',
  [CLASS_COMMON]: 'Common',
  [CLASS_ADDED]: 'Added',
  [CLASS_REMOVED]: 'Removed',
};

function windowIndexAtTime(time: number, sampleRate: number, hopSize: number): number {
  return Math.max(0, Math.floor((time * sampleRate) / hopSize));
}

type LaneProps = {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  windows: WindowAnalysis[];
  hopSize: number;
  color: string;
  playhead: number;
  onSeek?: (time: number) => void;
};

/** One version's waveform, tinted per analysis window by its diff class. */
export function WaveformLane({
  samples,
  sampleRate,
  duration,
  windows,
  hopSize,
  color,
  playhead,
  onSeek,
}: LaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const totalFrames = Math.floor(duration * sampleRate);
    if (totalFrames <= 0 || samples.length === 0) return;

    for (let x = 0; x < width; x += 1) {
      const t = ((x + 0.5) / width) * duration;
      const wi = windowIndexAtTime(t, sampleRate, hopSize);
      const cls = windows[wi]?.cls ?? CLASS_SILENCE;
      if (cls === CLASS_SILENCE) continue;
      ctx.fillStyle = CLASS_COLORS[cls];
      ctx.globalAlpha = 0.13;
      ctx.fillRect(x, 0, 1, height);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, height / 2 - 0.5, width, 1);

    const mid = height / 2;
    const ampScale = height * 0.44;
    ctx.fillStyle = color;
    for (let x = 0; x < width; x += 1) {
      const s0 = Math.min(samples.length, Math.floor((x / width) * totalFrames));
      const s1 = Math.min(samples.length, Math.floor(((x + 1) / width) * totalFrames));
      if (s1 <= s0) continue;
      let min = 0;
      let max = 0;
      for (let i = s0; i < s1; i += 1) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yTop = mid - max * ampScale;
      const yBot = mid - min * ampScale;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
    }

    const px = (playhead / duration) * width;
    ctx.fillStyle = 'rgba(216, 246, 255, .95)';
    ctx.fillRect(px, 0, 1, height);
    ctx.fillStyle = '#d9f7ff';
    ctx.beginPath();
    ctx.moveTo(px - 3, 0);
    ctx.lineTo(px + 3, 0);
    ctx.lineTo(px, 4);
    ctx.closePath();
    ctx.fill();
  }, [samples, sampleRate, duration, windows, hopSize, color, playhead]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const redraw = () => drawRef.current();
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="df-wave-lane"
      style={{ position: 'relative', height: '100%', minHeight: 0 }}
      onPointerDown={(event) => {
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

type StripProps = {
  windows: WindowAnalysis[];
  sampleRate: number;
  hopSize: number;
  duration: number;
  playhead: number;
  onSeek?: (time: number) => void;
};

/** A solid per-window colour strip — the at-a-glance added/removed/common map. */
export function DiffStrip({ windows, sampleRate, hopSize, duration, playhead, onSeek }: StripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (duration <= 0) return;
    for (let x = 0; x < width; x += 1) {
      const t = ((x + 0.5) / width) * duration;
      const wi = windowIndexAtTime(t, sampleRate, hopSize);
      ctx.fillStyle = CLASS_COLORS[windows[wi]?.cls ?? CLASS_SILENCE];
      ctx.fillRect(x, 0, 1, height);
    }
    const px = (playhead / duration) * width;
    ctx.fillStyle = 'rgba(240, 252, 255, .95)';
    ctx.fillRect(px - 0.5, 0, 1, height);
  }, [windows, sampleRate, hopSize, duration, playhead]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const redraw = () => drawRef.current();
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="df-diff-strip"
      style={{ position: 'relative', height: '100%', minHeight: 0, cursor: onSeek ? 'pointer' : 'default' }}
      onPointerDown={(event) => {
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

type SpectralProps = {
  result: AudioDiffResult;
  playhead: number;
  onSeek?: (time: number) => void;
};

/** Frequency × time difference map rendered as raw ImageData. */
export function SpectralMap({ result, playhead, onSeek }: SpectralProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0 || result.windows.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const cols = Math.min(result.windows.length, 2200);
    const bandCount = result.bands.length;
    const cellH = 3;
    const mapW = cols;
    const mapH = bandCount * cellH;

    canvas.width = Math.round(mapW * dpr);
    canvas.height = Math.round(mapH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = ctx.createImageData(mapW, mapH);
    const data = image.data;
    for (let x = 0; x < cols; x += 1) {
      const wi = Math.floor((x / cols) * result.windows.length);
      const bandClasses = result.windows[wi]?.bandClasses;
      if (!bandClasses) continue;
      for (let b = 0; b < bandCount; b += 1) {
        const [cr, cg, cb] = CLASS_RGB[bandClasses[b]] ?? CLASS_RGB[CLASS_SILENCE];
        const row = mapH - 1 - b * cellH;
        for (let dy = 0; dy < cellH; dy += 1) {
          const base = ((row - dy) * mapW + x) * 4;
          data[base] = cr;
          data[base + 1] = cg;
          data[base + 2] = cb;
          data[base + 3] = 255;
        }
      }
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = mapW;
    offscreen.height = mapH;
    offscreen.getContext('2d')?.putImageData(image, 0, 0);

    ctx.scale(dpr, dpr);
    ctx.drawImage(offscreen, 0, 0, mapW, mapH);

    const px = (playhead / result.duration) * mapW;
    ctx.fillStyle = 'rgba(240, 252, 255, .95)';
    ctx.fillRect(px, 0, 1, mapH);
  }, [result, playhead]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const redraw = () => drawRef.current();
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="df-spectral-map"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, cursor: onSeek ? 'pointer' : 'default' }}
      onPointerDown={(event) => {
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * result.duration);
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />
    </div>
  );
}