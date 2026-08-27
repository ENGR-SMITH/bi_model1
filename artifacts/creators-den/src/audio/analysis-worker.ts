// Web Worker that runs the spectral comparison off the main thread so the
// UI never freezes, even for longer files. Vite bundles this as a module
// worker; the heavy FFT/band work happens here and the result is posted back.
import { compareAudio, type AudioDiffOptions, type AudioDiffResult } from './dsp';

declare const self: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

type AnalysisRequest = {
  id: number;
  v1: Float32Array;
  v2: Float32Array;
  sampleRate: number;
  options: AudioDiffOptions;
};

type AnalysisResponse =
  | { id: number; ok: true; result: AudioDiffResult }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, v1, v2, sampleRate, options } = event.data;
  try {
    const result = compareAudio(v1, v2, sampleRate, options);
    const response: AnalysisResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: AnalysisResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export {};