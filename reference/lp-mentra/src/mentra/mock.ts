// A small stand-in for the MentraOS miniapp SDK, shaped like the real
// two-layer API so the miniapp code can later be pointed at the real SDK:
//   background: registerMiniapp((session) => …) with session.camera / input /
//               speaker / transcription / ui
//   UI layer:   mentra.send / on / request / ready
// The harness provides a simulated pair of glasses (GlassesDevice) and plays
// the role of the Mentra host app (opening and closing the miniapp's WebView).
import type { BackgroundToUi, UiToBackground, UiRequests, BgChannel, UiChannel, ReqChannel } from '../shared/channels';
import type { CaptureReason, Photo } from '../shared/types';

type Fn<T = unknown> = (p: T) => void;

export interface GlassesDevice {
  takePhoto(reason: CaptureReason): Promise<Photo>;
  onButton(cb: Fn<{ pressType: 'short' | 'long' }>): () => void;
  onTranscript(cb: Fn<{ text: string; isFinal: boolean }>): () => void;
  play(url: string): void; // earcons are addressed as earcon://name
  speak(text: string): Promise<void>;
  battery(): number;
  hasCamera: boolean;
}

class Emitter {
  private m = new Map<string, Set<Fn<any>>>();
  on(k: string, f: Fn<any>) {
    if (!this.m.has(k)) this.m.set(k, new Set());
    this.m.get(k)!.add(f);
    return () => this.m.get(k)!.delete(f);
  }
  emit(k: string, p: unknown) {
    this.m.get(k)?.forEach((f) => f(p));
  }
}

// ---------------------------------------------------------------- host
/** Plays the Mentra phone app: owns the WebView lifecycle and the bridge. */
export class MockHost {
  uiOpen = false;
  readonly toUi = new Emitter();
  readonly toBg = new Emitter();
  readonly lifecycle = new Emitter();
  readonly handlers = new Map<string, (req: any) => Promise<any> | any>();
  private readyResolvers: (() => void)[] = [];
  private uiReady = false;
  private pendingFromUi: [string, unknown][] = [];

  isReady() {
    return this.uiReady;
  }
  openUi() {
    if (this.uiOpen) return;
    this.uiOpen = true;
    this.uiReady = false;
    this.lifecycle.emit('open-requested', null);
  }
  /** called by the UI layer once mounted (mentra.ready()) */
  markReady() {
    this.uiReady = true;
    this.lifecycle.emit('open', null);
    for (const [k, p] of this.pendingFromUi.splice(0)) this.toBg.emit(k, p);
    this.readyResolvers.splice(0).forEach((r) => r());
  }
  closeUi() {
    if (!this.uiOpen) return;
    this.uiOpen = false;
    this.uiReady = false;
    this.lifecycle.emit('close', null);
  }
  sendFromUi(k: string, p: unknown) {
    if (!this.uiReady) this.pendingFromUi.push([k, p]); // buffered until ready()
    else this.toBg.emit(k, p);
  }
  sendFromBg(k: string, p: unknown): boolean {
    if (!this.uiReady) return false; // silently dropped when no WebView is open
    this.toUi.emit(k, p);
    return true;
  }
}

// ---------------------------------------------------------------- background
export interface MiniappSession {
  capabilities: { hasCamera: boolean };
  camera: { takePhoto(opts?: { reason?: CaptureReason }): Promise<Photo> };
  input: { onButtonPress(cb: Fn<{ pressType: 'short' | 'long' }>): () => void };
  transcription: { onTranscript(cb: Fn<{ text: string; isFinal: boolean }>): () => void };
  speaker: { play(url: string): void; speak(text: string): Promise<void> };
  device: { battery(): number };
  ui: {
    isOpen(): boolean;
    send<K extends BgChannel>(ch: K, payload: BackgroundToUi[K]): boolean;
    on<K extends UiChannel>(ch: K, cb: Fn<UiToBackground[K]>): () => void;
    handle<K extends ReqChannel>(ch: K, fn: (req: UiRequests[K]['req']) => Promise<UiRequests[K]['res']> | UiRequests[K]['res']): void;
    onOpen(cb: () => void): () => void;
    onClose(cb: () => void): () => void;
  };
}

export function createSession(host: MockHost, glasses: GlassesDevice): MiniappSession {
  return {
    capabilities: { hasCamera: glasses.hasCamera },
    camera: { takePhoto: (o) => glasses.takePhoto(o?.reason ?? 'scan') },
    input: { onButtonPress: (cb) => glasses.onButton(cb) },
    transcription: { onTranscript: (cb) => glasses.onTranscript(cb) },
    speaker: { play: (u) => glasses.play(u), speak: (t) => glasses.speak(t) },
    device: { battery: () => glasses.battery() },
    ui: {
      isOpen: () => host.uiOpen,
      send: (ch, p) => host.sendFromBg(ch, p),
      on: (ch, cb) => host.toBg.on(ch, cb),
      handle: (ch, fn) => void host.handlers.set(ch, fn),
      onOpen: (cb) => host.lifecycle.on('open', cb),
      onClose: (cb) => host.lifecycle.on('close', cb),
    },
  };
}

export async function registerMiniapp(host: MockHost, glasses: GlassesDevice, handler: (s: MiniappSession) => Promise<void> | void) {
  await handler(createSession(host, glasses));
}

// ---------------------------------------------------------------- UI layer
export interface MentraUi {
  ready(): void;
  send<K extends UiChannel>(ch: K, payload: UiToBackground[K]): void;
  on<K extends BgChannel>(ch: K, cb: Fn<BackgroundToUi[K]>): () => void;
  request<K extends ReqChannel>(ch: K, req: UiRequests[K]['req']): Promise<UiRequests[K]['res']>;
  close(): void;
}

export function createMentraUi(host: MockHost): MentraUi {
  return {
    ready: () => host.markReady(),
    send: (ch, p) => host.sendFromUi(ch, p),
    on: (ch, cb) => host.toUi.on(ch, cb),
    request: async (ch, req) => {
      const h = host.handlers.get(ch);
      if (!h) throw new Error(`no handler for ${ch}`);
      return h(req);
    },
    close: () => host.closeUi(),
  };
}
