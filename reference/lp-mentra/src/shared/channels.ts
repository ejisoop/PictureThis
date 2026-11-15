// Typed channel registry shared by the background and the UI layer, in the
// style of a MentraOS miniapp's src/shared/channels.ts. Names are plain strings
// on the wire; TypeScript checks the payloads.
import type { Detection, GlassesStatus, Settings } from './types';

export interface BackgroundToUi {
  'discovery': { detection: Detection; replayed: boolean };
  'revisit': { detectionId: string };
  'status': GlassesStatus;
  'settings': Settings;
}

export interface UiToBackground {
  'set-scanning': { scanning: boolean };
  'update-settings': Partial<Settings>;
  'capture-now': Record<string, never>;
  'detection-opened': { detectionId: string };
}

export interface UiRequests {
  'get-state': {
    req: Record<string, never>;
    res: { status: GlassesStatus; settings: Settings; detections: Detection[] };
  };
}

export type BgChannel = keyof BackgroundToUi;
export type UiChannel = keyof UiToBackground;
export type ReqChannel = keyof UiRequests;
