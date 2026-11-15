// Types shared by the background, the UI and the dev harness. Discovery
// mirrors the server's (server/src/types.ts).

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Discovery {
  id: string;
  sessionId: string;
  pageKey: string;
  figureId: string;
  title: string;
  concept: string;
  subject: string;
  summary: string;
  figureLabel: string;
  visualizable: number;
  pageNumber: number | null;
  heading: string;
  /** page photo stored by the server (cropped to the page) */
  photoUrl: string;
  pageCorners: [number, number][];
  figureBox: Box;
  thumb: string;
  ctx: {
    figure: { rect: Box; description: string; concept?: string; subject?: string };
    params: Record<string, { value: number; unit?: string }>;
    equations: string[];
    page: { number: number | null; heading: string };
  };
  ts: number;
}

export type SoundMode = 'voice' | 'chime' | 'off';

export interface Settings {
  scanIntervalMs: number;
  sounds: SoundMode;
  autoOpen: boolean;
  showPipeline: boolean;
}

export const DEFAULT_SETTINGS: Settings = { scanIntervalMs: 2000, sounds: 'voice', autoOpen: true, showPipeline: false };

export interface GlassesStatus {
  /** glasses connected and the session has capabilities */
  connected: boolean;
  hasCamera: boolean;
  scanning: boolean;
  lastCaptureAt: number | null;
  /** short human-readable state of the last frame: "looking", "hold steady", "found …" */
  lastResult: string;
  error: string | null;
  /** a manual look (button / Look now) failed even after a retry: why, plus how to try again */
  failure: string | null;
  /** takePhoto latency (capture + upload) over the last 20 frames, ms */
  capture: { n: number; p50: number; p90: number; last: number } | null;
}

export type CaptureReason = 'scan' | 'button' | 'voice';

/** one frame through the pipeline, for the developer pipeline view */
export interface FrameTrace {
  id: string;
  reason: CaptureReason;
  startedAt: number;
  /** ms per stage: capture (takePhoto incl. upload), then the server's download/gate/understand/decide */
  timings: Record<string, number>;
  status: string;
  photoUrl?: string;
  detail?: string;
  gate?: { sharpness: number; decision: string; reason: string | null };
  discoveries?: string[];
}
