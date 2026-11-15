/**
 * Typed channel registry between the background (glasses loop) and the UI
 * (phone WebView). RPC channels are branded with Rpc<Req, Res>.
 */
import type { Rpc } from '@mentra/miniapp/ui';
import type { Discovery, FrameTrace, GlassesStatus, Settings } from './types';

export interface AppState {
  status: GlassesStatus;
  settings: Settings;
  discoveries: Discovery[];
  /** base URL of the PictureThis server (the UI fetches visualizations from it) */
  server: string;
}

export interface Channels {
  // background → UI
  status: GlassesStatus;
  settings: Settings;
  /** a new discovery; `replayed` = found while the UI was closed */
  discovery: { discovery: Discovery; replayed: boolean };
  /** the wearer is looking at a page that was already explored */
  revisit: { discoveryId: string };
  trace: FrameTrace;

  // UI → background
  'set-scanning': { scanning: boolean };
  'update-settings': Partial<Settings>;
  'capture-now': { at: number };
  'discovery-opened': { discoveryId: string };
  'forget-discoveries': { at: number };
  'forget-discovery': { discoveryId: string };

  // RPC
  'get-state': Rpc<Record<string, never>, AppState>;
}

declare global {
  // eslint-disable-next-line no-var
  var mentra: import('@mentra/miniapp/ui').MentraTyped<Channels>;
}
