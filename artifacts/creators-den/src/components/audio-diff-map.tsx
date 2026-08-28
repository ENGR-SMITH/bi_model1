// ---------------------------------------------------------------------------
// AudioDiffMap — the split-screen audio version-control surface (ported from
// the smith_mi video-version-comparison app). Shows the spectral difference
// between the reviewed version's audio and its predecessor's audio.
//
// Both proxies are fetched and decoded to mono PCM in the browser, downsampled
// to the shared analysis rate, then compared in a web worker: frequency × time
// windows get classified added (blue) / removed (red) / common (grey) / silence
// (dark). The surface shows each version's waveform lane (tinted by class), the
// Δ class strip, and a spectral map, all sharing one playhead.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Pause, Play } from 'lucide-react';
import { ANALYSIS_RATE, DEFAULT_FFT_SIZE, DEFAULT_HOP_SIZE, formatSeconds, resample, type AudioDiffOptions, type AudioDiffResult } from '@/audio/dsp';
import { CLASS_LABELS, DiffStrip, SpectralMap, WaveformLane } from '@/audio/waveform-canvas';
import { proxyUrlFor } from '@/components/asset-preview';
import { AnnotationCanvas } from '@/components/annotation-canvas';
import { FullscreenButton } from '@/components/preview-shared';
import type { StudioLeg } from '@/components/role-oracle';

let audioContext: AudioContext | null = null;

function getDecodeContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function decodeAudio(context: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      context.decodeAudioData(arrayBuffer, resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function formatAudioTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const d = Math.floor((safe % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

const CLASS_LABELS_BY_CLS: Record<number, string> = CLASS_LABELS;

export function AudioDiffMap({
  projectId,
  olderAssetId,
  newerAssetId,
  leg,
  timelineVersionId,
  annotationHeaderRef,
  olderLabel = 'Older',
  newerLabel = 'Reviewing',
  sensitivity: sensitivityProp,
  onSensitivityChange,
  levelMatch: levelMatchProp,
  onLevelMatchChange,
}: {
  projectId: string;
  olderAssetId: string;
  newerAssetId: string;
  /** Relay leg — annotations dropped on the reviewed (newest) lane are
   * scoped to it (and to `timelineVersionId` when the selection is a version). */
  leg: StudioLeg;
  timelineVersionId?: string | null;
  /** The column-header annotation slot — the annotate pencil portals here. */
  annotationHeaderRef?: RefObject<HTMLDivElement | null>;
  olderLabel?: string;
  newerLabel?: string;
  /** Controlled spectral slack (dB) — owned by the preview page so the
   * column's settings dropdown can drive it. */
  sensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
  /** Controlled auto level-match toggle. */
  levelMatch?: boolean;
  onLevelMatchChange?: (levelMatch: boolean) => void;
}) {
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sensitivityState, setSensitivityState] = useState(6);
  const sensitivity = sensitivityProp ?? sensitivityState;
  const setSensitivity = (next: number) => {
    setSensitivityState(next);
    onSensitivityChange?.(next);
  };
  const [levelMatchState, setLevelMatchState] = useState(true);
  const levelMatch = levelMatchProp ?? levelMatchState;
  const setLevelMatch = (next: boolean) => {
    setLevelMatchState(next);
    onLevelMatchChange?.(next);
  };
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<AudioDiffResult | null>(null);
  const [newerPcm, setNewerPcm] = useState<{ samples: Float32Array; duration: number } | null>(null);
  const [olderPcm, setOlderPcm] = useState<{ samples: Float32Array; duration: number } | null>(null);

  const audioNewerRef = useRef<HTMLAudioElement>(null);
  const audioOlderRef = useRef<HTMLAudioElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const analysisSeqRef = useRef(0);
  const seqRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const newerLaneRef = useRef<HTMLDivElement>(null);
  const surfRef = useRef<HTMLElement>(null);

  const olderUrl = proxyUrlFor(projectId, olderAssetId);
  const newerUrl = proxyUrlFor(projectId, newerAssetId);

  // Load + decode both proxies into mono PCM at the shared analysis rate.
  useEffect(() => {
    const token = (seqRef.current += 1);
    setAnalysis(null);
    setError(null);
    setPlayhead(0);

    const load = async (url: string): Promise<{ samples: Float32Array; duration: number } | null> => {
      const context = getDecodeContext();
      if (!context) return null;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load audio stream (HTTP ${response.status})`);
      const buffer = await decodeAudio(context, await response.arrayBuffer());
      const channels = Math.min(2, buffer.numberOfChannels);
      const mix = new Float32Array(buffer.length);
      for (let c = 0; c < channels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < buffer.length; i += 1) mix[i] += data[i] / channels;
      }
      const mono = resample(mix, buffer.sampleRate, ANALYSIS_RATE);
      return { samples: mono, duration: mono.length / ANALYSIS_RATE };
    };

    (async () => {
      try {
        const [newer, older] = await Promise.all([load(newerUrl), load(olderUrl)]);
        if (token !== seqRef.current) return;
        if (!newer || !older) {
          setError('Web Audio is not available in this browser — try Chrome, Edge, Firefox or Safari.');
          return;
        }
        setNewerPcm(newer);
        setOlderPcm(older);
      } catch (err) {
        if (token !== seqRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not decode the audio proxy.');
      }
    })();

    return () => {
      seqRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [newerAssetId, olderAssetId, newerUrl, olderUrl]);

  // Run the spectral comparison in a worker whenever inputs/settings change.
  useEffect(() => {
    if (!newerPcm || !olderPcm) return;
    const token = (analysisSeqRef.current += 1);
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../audio/analysis-worker.ts', import.meta.url), { type: 'module' });
    }
    const worker = workerRef.current;
    worker.onmessage = (event: MessageEvent) => {
      const { id, ok, result, error: workerError } = event.data as {
        id: number;
        ok: boolean;
        result?: AudioDiffResult;
        error?: string;
      };
      if (id !== analysisSeqRef.current) return;
      setAnalyzing(false);
      if (ok && result) {
        setAnalysis(result);
        setError(null);
      } else {
        setError(workerError ? `Analysis failed: ${workerError}` : 'Analysis failed.');
      }
    };
    setAnalyzing(true);
    const options: AudioDiffOptions = {
      fftSize: DEFAULT_FFT_SIZE,
      hopSize: DEFAULT_HOP_SIZE,
      slackDb: sensitivity,
      levelMatch,
    };
    const v1 = olderPcm.samples.slice();
    const v2 = newerPcm.samples.slice();
    worker.postMessage(
      { id: token, v1, v2, sampleRate: ANALYSIS_RATE, options },
      [v1.buffer, v2.buffer],
    );
  }, [newerPcm, olderPcm, sensitivity, levelMatch]);

  // Sync the two <audio> transports.
  useEffect(() => {
    const one = audioNewerRef.current;
    const two = audioOlderRef.current;
    if (!one || !two) return;
    const sync = () => {
      setPlayhead(one.currentTime || 0);
      if (Math.abs(one.currentTime - two.currentTime) > 0.08) two.currentTime = one.currentTime;
    };
    one.addEventListener('timeupdate', sync);
    return () => one.removeEventListener('timeupdate', sync);
  }, [newerPcm, olderPcm]);

  const duration = analysis?.duration ?? 0;

  const fadeIn = (samples: Float32Array, seconds: number, rate: number): Float32Array => {
    const out = samples.slice();
    const n = Math.min(out.length, Math.round(seconds * rate));
    for (let i = 0; i < n; i += 1) out[i] *= i / n;
    return out;
  };

  const togglePlay = () => {
    const one = audioNewerRef.current;
    const two = audioOlderRef.current;
    if (!one || !two) {
      setError('Load audio proxies before starting playback.');
      return;
    }
    if (playing) {
      one.pause();
      two.pause();
      setPlaying(false);
    } else {
      void Promise.all([one.play().catch(() => {}), two.play().catch(() => {})]).then(() => setPlaying(true));
    }
  };

  const seek = (time: number) => {
    const next = Math.max(0, Math.min(duration || 0, time));
    setPlayhead(next);
    if (audioNewerRef.current) audioNewerRef.current.currentTime = next;
    if (audioOlderRef.current) audioOlderRef.current.currentTime = next;
  };

  const readout = useMemo(() => {
    if (!analysis || !duration || analysis.windows.length === 0) return null;
    const wi = Math.min(analysis.windows.length - 1, Math.floor((playhead * ANALYSIS_RATE) / analysis.hopSize));
    const w = analysis.windows[Math.max(0, wi)];
    return { cls: w.cls, centroid1: w.centroid1, centroid2: w.centroid2 };
  }, [analysis, playhead, duration]);

  return (
    <section className="df-surf" ref={surfRef} data-testid="audio-diff-map">
      {error && (
        <div className="df-error" data-testid="df-audio-error">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <div className="df-audio-stage" ref={stageRef}>
        <div className="df-audio-rows">
          <div className="df-wave-row" ref={newerLaneRef}>
            {newerPcm ? (
              <WaveformLane
                samples={fadeIn(newerPcm.samples, 0.01, ANALYSIS_RATE)}
                sampleRate={ANALYSIS_RATE}
                duration={newerPcm.duration}
                windows={analysis?.windows ?? []}
                hopSize={analysis?.hopSize ?? DEFAULT_HOP_SIZE}
                color="#8fd6ea"
                playhead={playhead}
                onSeek={seek}
              />
            ) : (
              <div className="df-wave-empty">Awaiting reviewed audio</div>
            )}
            {/* Only the newest version is annotatable — pins drop on its lane. */}
            <AnnotationCanvas
              projectId={projectId}
              leg={leg}
              assetId={newerAssetId}
              playheadMs={Math.round(playhead * 1000)}
              onSeek={(ms) => seek(ms / 1000)}
              timelineVersionId={timelineVersionId}
              headerRef={annotationHeaderRef}
              surfaceRef={newerLaneRef}
              dropLine
            />
          </div>
          <div className="df-wave-row">
            {olderPcm ? (
              <WaveformLane
                samples={fadeIn(olderPcm.samples, 0.01, ANALYSIS_RATE)}
                sampleRate={ANALYSIS_RATE}
                duration={olderPcm.duration}
                windows={analysis?.windows ?? []}
                hopSize={analysis?.hopSize ?? DEFAULT_HOP_SIZE}
                color="#efb0b4"
                playhead={playhead}
                onSeek={seek}
              />
            ) : (
              <div className="df-wave-empty">Awaiting older audio</div>
            )}
          </div>
          <div className="df-wave-row df-wave-diff">
            <span className="df-pane-label df-diff-label">Δ</span>
            {analysis ? (
              <DiffStrip
                windows={analysis.windows}
                sampleRate={analysis.sampleRate}
                hopSize={analysis.hopSize}
                duration={analysis.duration}
                playhead={playhead}
                onSeek={seek}
              />
            ) : (
              <div className="df-wave-empty">Load both versions to scan the difference</div>
            )}
          </div>
        </div>
        {analyzing && (
          <div className="df-scan-overlay" data-testid="df-audio-scanning">
            <span className="df-scan-pill"><i className="df-pulse" /> SCANNING AUDIO…</span>
          </div>
        )}
        <div className="df-legend">
          <span><i className="df-chip blue" />Added</span>
          <span><i className="df-chip red" />Removed</span>
          <span><i className="df-chip grey" />Common</span>
        </div>
        <FullscreenButton targetRef={surfRef} className="df-fs" />
        <button
          type="button"
          className="df-play-overlay"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          data-testid="df-audio-play-overlay"
        >
          {playing ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
        </button>
      </div>

      {analysis && analysis.windows.length > 0 && (
        <div className="df-audio-spectral">
          <SpectralMap result={analysis} playhead={playhead} onSeek={seek} />
        </div>
      )}

      <div className="df-transport">
        <input type="range" min="0" max={duration || 1} step="0.001" value={Math.min(playhead, duration || 1)} onChange={(event) => seek(Number(event.target.value))} aria-label="Playback position" className="df-seek" data-testid="df-audio-seek" />
        <span className="df-time">{formatAudioTime(playhead)} / {formatAudioTime(duration)}</span>
      </div>

      <div className="df-foot">
        <span>{formatSeconds(analysis?.stats.addedSeconds ?? 0)} added / {formatSeconds(analysis?.stats.removedSeconds ?? 0)} removed</span>
        <span>{readout ? CLASS_LABELS_BY_CLS[readout.cls] : '—'}</span>
      </div>

      {(newerPcm || olderPcm) && (
        <div className="df-hidden" aria-hidden="true">
          {newerPcm && <audio ref={audioNewerRef} src={newerUrl} preload="auto" data-testid="df-audio-a" />}
          {olderPcm && <audio ref={audioOlderRef} src={olderUrl} preload="auto" data-testid="df-audio-b" />}
        </div>
      )}
    </section>
  );
}