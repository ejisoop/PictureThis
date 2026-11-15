// Host-side controller for one sandboxed visualization. Framework-agnostic so
// the miniapp UI, the dev harness and tests all share it.
import type { Quad } from '../geom';
import type { ControlSpec, FrameStats, HostToSandbox, ModuleCtx, SandboxToHost, TestReport } from '../protocol';
import { buildSrcdoc } from './srcdoc';

export { buildSrcdoc, moduleToScript, SANDBOX_CSP } from './srcdoc';
export { renderPanel, type PanelApi } from './panel';
export { sanitizeLabel } from './sanitize';
export * from '../geom';
export * from '../protocol';

export type FailReason = 'create' | 'enter' | 'update' | 'stalled' | 'timeout' | 'photo';

export interface SandboxEvents {
  onLoaded?: () => void;
  onState?: (s: 'photo' | 'lifting' | 'interactive' | 'folding') => void;
  onControls?: (c: ControlSpec[]) => void;
  onDisplay?: (key: string, display: string, value?: number | boolean) => void;
  onLabel?: (key: string, label: string, icon?: string) => void;
  onError?: (phase: string, message: string, stack?: string) => void;
  onStats?: (s: FrameStats) => void;
  /** the watchdog gave up on this module: show "couldn't animate this one" */
  onFailed?: (reason: FailReason, message: string) => void;
  onTestReport?: (r: TestReport) => void;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');

export class SandboxHost {
  iframe: HTMLIFrameElement;
  failed = false;
  private lastBeat = 0;
  private loaded = false;
  private updateErrors = 0;
  private dog: ReturnType<typeof setInterval> | null = null;
  private readyP: Promise<void>;
  private onMsg = (ev: MessageEvent) => this.handle(ev);

  constructor(container: HTMLElement, code: string, private ev: SandboxEvents = {}, opts: { test?: boolean; readyTimeoutMs?: number } = {}) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', 'visualization');
    f.setAttribute('allow', '');
    f.className = 'lp-sandbox';
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;';
    let resolveReady!: () => void;
    this.readyP = new Promise<void>((res, rej) => {
      resolveReady = res;
      setTimeout(() => rej(new Error('sandbox did not start')), opts.readyTimeoutMs ?? 10000);
    });
    this.resolveReady = resolveReady;
    window.addEventListener('message', this.onMsg);
    f.srcdoc = buildSrcdoc(code, { test: opts.test });
    container.appendChild(f);
    this.iframe = f;
  }
  private resolveReady: () => void;

  private send(m: HostToSandbox, transfer: Transferable[] = []) {
    this.iframe.contentWindow?.postMessage(m, '*', transfer);
  }

  private fail(reason: FailReason, message: string) {
    if (this.failed) return;
    this.failed = true;
    this.ev.onFailed?.(reason, message);
  }

  private handle(e: MessageEvent) {
    if (e.source !== this.iframe.contentWindow) return;
    const m = e.data as SandboxToHost;
    if (!isObj(m) || typeof m.type !== 'string') return;
    this.lastBeat = performance.now();
    switch (m.type) {
      case 'ready':
        this.resolveReady();
        break;
      case 'loaded':
        this.loaded = true;
        this.ev.onLoaded?.();
        break;
      case 'state':
        if (['photo', 'lifting', 'interactive', 'folding'].includes(m.state)) this.ev.onState?.(m.state);
        break;
      case 'controls':
        if (Array.isArray(m.controls)) this.ev.onControls?.(m.controls.filter(isObj).slice(0, 12) as ControlSpec[]);
        break;
      case 'display':
        this.ev.onDisplay?.(str(m.key, 64), str(m.display, 40), typeof m.value === 'number' || typeof m.value === 'boolean' ? m.value : undefined);
        break;
      case 'label':
        this.ev.onLabel?.(str(m.key, 64), str(m.label, 120), str(m.icon, 4) || undefined);
        break;
      case 'stats':
        if (isObj(m.stats)) this.ev.onStats?.(m.stats as FrameStats);
        break;
      case 'error': {
        const phase = str(m.phase, 20), msg = str(m.message);
        this.ev.onError?.(phase, msg, str(m.stack, 4000) || undefined);
        if (phase === 'create' || phase === 'enter') this.fail(phase, msg);
        if (phase === 'update' && ++this.updateErrors >= 3) this.fail('update', msg);
        break;
      }
      case 'test-report':
        if (isObj(m.report)) this.ev.onTestReport?.(m.report as TestReport);
        break;
    }
  }

  ready() {
    return this.readyP;
  }

  /** decode the page photo here (the sandbox has no network) and hand it over */
  async load(photo: string | Blob | ImageBitmap | null, corners: Quad, ctx: ModuleCtx, o: { instant?: boolean } = {}) {
    await this.readyP;
    let bmp: ImageBitmap | null = null;
    if (photo) {
      try {
        if (photo instanceof ImageBitmap) bmp = photo;
        else {
          const blob = typeof photo === 'string' ? await (await fetch(photo)).blob() : photo;
          bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        }
      } catch (e) {
        this.fail('photo', `couldn't load the page photo: ${(e as Error).message}`);
        return;
      }
    }
    this.send({ type: 'load', photo: bmp, corners, ctx, instant: o.instant }, bmp ? [bmp] : []);
    this.startWatchdog();
  }

  private startWatchdog() {
    this.lastBeat = performance.now();
    if (this.dog) clearInterval(this.dog);
    this.dog = setInterval(() => {
      if (document.hidden) {
        this.lastBeat = performance.now();
        return;
      }
      const quiet = performance.now() - this.lastBeat;
      if (quiet > 3500) this.fail(this.loaded ? 'stalled' : 'timeout', `no frames for ${(quiet / 1000).toFixed(1)} s`);
    }, 1000);
  }

  play() { this.send({ type: 'play' }); }
  fold() { this.send({ type: 'fold' }); }
  resetView() { this.send({ type: 'reset-view' }); }
  control(key: string, value: number | boolean | null) { this.send({ type: 'control', key, value }); }
  layout(top: number, bottom: number, sheet: number) { this.send({ type: 'layout', top, bottom, sheet }); }
  test(frames = 120, screenshot = false) { this.send({ type: 'test', frames, screenshot }); }

  dispose() {
    if (this.dog) clearInterval(this.dog);
    window.removeEventListener('message', this.onMsg);
    // free the WebGL context now: browsers cap live contexts (~16) and only
    // reclaim those of removed iframes at GC time
    this.send({ type: 'dispose' });
    this.iframe.style.visibility = 'hidden';
    const f = this.iframe;
    setTimeout(() => f.remove(), 120);
  }
}
