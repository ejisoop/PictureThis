// Types shared by the background layer, the UI layer and the services.
// Page coordinates: x runs from the spine (0) to the outer edge of the right
// page (PAGE_W); negative x is the left page. z runs from the top (−H/2) down.

export interface PageRect {
  x0: number;
  z0: number;
  w: number;
  h: number;
}

/** A still from the glasses camera, as `session.camera.takePhoto()` returns it. */
export interface Photo {
  id: string;
  url: string; // blob: URL, standing in for the upload URL Mentra returns
  width: number;
  height: number;
  timestamp: number;
  reason: CaptureReason;
}

export type CaptureReason = 'scan' | 'button' | 'voice';

export type RegionKind = 'text' | 'equation' | 'figure' | 'caption';

export interface RecognizedRegion {
  kind: RegionKind;
  rect: PageRect;
  /** quad in photo pixels (tl, tr, br, bl) */
  quad: [number, number][];
  confidence: number;
  text?: string;
  latex?: string;
  figureClass?: string;
  caption?: string;
}

export type SkipReason = 'motion-blur' | 'no-page' | 'too-oblique' | 'page-turning';

export interface PipelineResult {
  photoId: string;
  skipped?: SkipReason;
  pageId?: string;
  pageNumber?: number;
  pageQuad?: [number, number][];
  scanUrl?: string; // flattened right page, "perspective-corrected"
  scanSize?: { width: number; height: number };
  paperTone?: [number, number, number]; // average paper colour in the scan, 0..1
  regions: RecognizedRegion[];
  matches: ConceptMatch[];
  timings: Record<string, number>;
}

export interface ConceptMatch {
  conceptId: string;
  confidence: number;
  regionIndex: number | null; // null = matched from text only
  params: Record<string, number>;
  why: string;
}

export type RendererKind = 'interactive3d' | 'generatedVideo' | 'hybrid';

export interface RenderPlan {
  renderer: RendererKind;
  vizId: string;
  params: Record<string, number>;
  videoPrompt: string; // composed for the future video-generation path
}

/** A concept that passed every gate and was delivered to the phone. */
export interface Detection {
  id: string;
  pageId: string;
  pageNumber: number;
  conceptId: string;
  title: string;
  subject: string;
  figureLabel: string;
  summary: string;
  confidence: number;
  timestamp: number;
  pagePhoto: string; // original captured frame
  pageQuad: [number, number][];
  scanUrl: string;
  scanSize: { width: number; height: number };
  paperTone: [number, number, number];
  regionBox: PageRect;
  extracted: { text: string[]; equations: string[]; parameters: Record<string, number> };
  renderPlan: RenderPlan;
}

export type AudioMode = 'on' | 'quiet' | 'off';

export interface Settings {
  scanIntervalMs: number;
  audio: AudioMode;
  autoOpen: boolean;
  showPipeline: boolean;
  rendererOverride: RendererKind | null; // debug: force the mock video path
}

export interface GlassesStatus {
  connected: boolean;
  battery: number;
  scanning: boolean;
  lastCaptureAt: number | null;
}
