// Messages between the host page (React UI / harness / smoke test) and the
// sandboxed runtime iframe. Everything that crosses this boundary is plain,
// structured-cloneable data. The host must treat every inbound message as
// untrusted: generated code shares the iframe's realm with the runtime.
import type { Quad } from './geom';

export const RUNTIME_VERSION = '1.0.0';

/** Rectangle in normalised flattened-page coordinates (0..1, y down). */
export interface NormBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What generated code receives as `ctx`. */
export interface ModuleCtx {
  figure: { rect: NormBox; description: string; concept?: string; subject?: string };
  params: Record<string, { value: number; unit?: string } | number>;
  equations: string[];
  page: { number: number | null; heading: string };
}

export interface LoadMsg {
  type: 'load';
  /** decoded page photo; null = blank paper (smoke test) */
  photo: ImageBitmap | null;
  corners: Quad;
  ctx: ModuleCtx;
  /** start straight in the photo view without the raw→flat morph */
  instant?: boolean;
}

export type HostToSandbox =
  | LoadMsg
  | { type: 'play' }
  | { type: 'fold' }
  | { type: 'reset-view' }
  | { type: 'control'; key: string; value: number | boolean | null }
  | { type: 'layout'; top: number; bottom: number; sheet: number }
  | { type: 'test'; frames: number; screenshot?: boolean }
  /** after 'test': drive every control and draggable, run more frames, report errors */
  | { type: 'exercise'; frames: number }
  /** release the WebGL context before the host removes the iframe */
  | { type: 'dispose' };

export type ControlSpec =
  | { type: 'slider'; key: string; label: string; min: number; max: number; step?: number; value: number; display: string; ticks?: { v: number; label: string }[]; snap?: number }
  | { type: 'toggle'; key: string; label: string; icon?: string; value: boolean }
  | { type: 'button'; key: string; label: string; icon?: string };

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export interface TestReport {
  frames: number;
  meshes: number;
  inkLines: number;
  notes: number;
  controls: number;
  nanObjects: string[];
  errors: string[];
  hasEnterExit: boolean;
  /** fraction of the model's height that sat below the paper (the runtime lifts it automatically) */
  belowPaper: number;
  png?: string;
}

export type SandboxToHost =
  | { type: 'ready'; version: string }
  | { type: 'loaded'; title?: string }
  | { type: 'controls'; controls: ControlSpec[] }
  | { type: 'display'; key: string; display: string; value?: number | boolean }
  | { type: 'label'; key: string; label: string; icon?: string }
  | { type: 'state'; state: 'photo' | 'lifting' | 'interactive' | 'folding' }
  | { type: 'touch'; kind: 'grab' | 'orbit' }
  | { type: 'stats'; stats: FrameStats }
  | { type: 'error'; phase: 'create' | 'enter' | 'exit' | 'update' | 'runtime' | 'control'; message: string; stack?: string }
  | { type: 'test-report'; report: TestReport }
  | { type: 'exercise-report'; errors: string[]; nanObjects: string[]; escaped?: string[]; steps: number };
