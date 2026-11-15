// Drives one "explore" session on the phone: the page photo in a sandbox,
// generation progress, swapping in the validated module, lift-off, controls,
// fold-back, and the watchdog fallback. Framework-agnostic; App.tsx renders
// the state it reports.
import { SandboxHost, renderPanel, type ControlSpec, type PanelApi, type FrameStats } from '@lp/runtime/host';
import type { Discovery } from '../shared/types';
import { requestViz, type VizRecord } from './api';
import { PLACEHOLDER_MODULE } from './placeholder';

export type ExploreState = 'photo-loading' | 'generating' | 'ready' | 'lifting' | 'interactive' | 'folding' | 'photo' | 'failed';

export interface ExploreView {
  state: ExploreState;
  progress: { message: string; fraction: number };
  viz: VizRecord | null;
  failure: string | null;
  errors: string[];
  stats: FrameStats | null;
  panel: HTMLElement | null;
}

const STAGE_FRACTION: Record<string, number> = { retry: 0.1, cache: 0.1, prompt: 0.12, writing: 0.2, static: 0.75, smoke: 0.82, repair: 0.5, store: 0.97 };

export class Explore {
  private photoHost: SandboxHost | null = null;
  private vizHost: SandboxHost | null = null;
  private panel: PanelApi | null = null;
  private cancelGen: (() => void) | null = null;
  private photo: Blob | null = null;
  private disposed = false;
  private writingTimer: ReturnType<typeof setInterval> | null = null;
  view: ExploreView = { state: 'photo-loading', progress: { message: '', fraction: 0 }, viz: null, failure: null, errors: [], stats: null, panel: null };

  constructor(
    private stageEl: HTMLElement,
    private server: string,
    private d: Discovery,
    private onView: (v: ExploreView) => void,
    private opts: { autoPlay: boolean; topInset: () => number; bottomInset: () => number }
  ) {}

  private openedAt = Date.now();
  private reported = false;
  private report(event: 'rendered' | 'failed', reason?: string) {
    if (this.reported) return;
    this.reported = true;
    void fetch(`${this.server}/v1/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: this.d.sessionId, discoveryId: this.d.id, event, ms: Date.now() - this.openedAt, source: this.view.viz?.source, reason, errors: this.view.errors.slice(-8) }),
    }).catch(() => {});
  }

  private set(p: Partial<ExploreView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...p };
    this.onView(this.view);
    // for the dev harness's pipeline timeline (no-op in the Mentra WebView)
    window.dispatchEvent(new CustomEvent('lp-explore', { detail: { discoveryId: this.d.id, state: this.view.state, source: this.view.viz?.source, failure: this.view.failure, errors: this.view.errors, t: Date.now() } }));
  }

  async start(o: { force?: boolean; noTemplate?: boolean } = {}) {
    // 1. the page photo, flattened, with pencil corner marks
    this.set({ state: 'photo-loading' });
    try {
      this.photo = await (await fetch(this.d.photoUrl)).blob();
    } catch (e) {
      this.set({ state: 'failed', failure: 'Couldn’t load the page photo.', errors: [String((e as Error).message)] });
      this.report('failed', 'photo download');
      return;
    }
    if (this.disposed) return;
    this.photoHost = new SandboxHost(this.stageEl, PLACEHOLDER_MODULE, { onFailed: () => {} });
    await this.photoHost.load(this.photo, this.d.pageCorners as any, this.d.ctx as any);
    // 2. the visualization: cache hit, or generate with progress
    this.generate(o);
  }

  generate(o: { force?: boolean; noTemplate?: boolean } = {}) {
    this.cancelGen?.();
    this.set({ state: 'generating', progress: { message: 'looking at the figure', fraction: 0.05 }, failure: null, errors: [] });
    let creep = 0.2;
    this.cancelGen = requestViz(this.server, this.d.id, o, (e) => {
      if (e.type === 'progress') {
        const f = STAGE_FRACTION[e.stage] ?? this.view.progress.fraction;
        creep = Math.max(creep, f);
        this.set({ progress: { message: e.message, fraction: f } });
        // the writing stage is long: let the bar creep so it never looks stuck
        if (e.stage === 'writing' || e.stage === 'repair') {
          if (this.writingTimer) clearInterval(this.writingTimer);
          this.writingTimer = setInterval(() => {
            creep = Math.min(0.72, creep + (0.72 - creep) * 0.06);
            this.set({ progress: { message: this.view.progress.message, fraction: creep } });
          }, 700);
        }
      } else {
        if (this.writingTimer) clearInterval(this.writingTimer);
        if (e.type === 'done') void this.mount(e.viz);
        else {
          this.set({ state: 'failed', failure: 'Couldn’t animate this one.', errors: [...this.view.errors, ...e.errors], viz: e.viz });
          this.report('failed', `generation: ${e.errors[0] ?? ''}`);
        }
      }
    });
  }

  /** 3. swap in the validated module over the photo (instant photo, then lift) */
  private async mount(viz: VizRecord) {
    this.set({ viz, progress: { message: 'here it comes', fraction: 1 } });
    this.vizHost?.dispose();
    const host = new SandboxHost(this.stageEl, viz.code, {
      onLoaded: () => {
        // the module's iframe is now on top showing the same photo
        this.photoHost?.dispose();
        this.photoHost = null;
        host.layout(this.opts.topInset(), this.opts.bottomInset(), 0);
        this.set({ state: 'ready' });
        if (this.opts.autoPlay) setTimeout(() => this.play(), 250);
      },
      onState: (s) => {
        if (s === 'lifting') this.set({ state: 'lifting' });
        if (s === 'interactive') {
          this.set({ state: 'interactive', panel: this.panel?.el ?? null });
          this.report('rendered');
        }
        if (s === 'folding') this.set({ state: 'folding' });
        if (s === 'photo') this.set({ state: 'photo' });
      },
      onControls: (c: ControlSpec[]) => {
        this.panel = renderPanel(c, (key, value) => host.control(key, value));
        if (this.view.state === 'interactive') this.set({ panel: this.panel.el });
      },
      onDisplay: (k, d, v) => this.panel?.display(k, d, v),
      onLabel: (k, l, i) => this.panel?.label(k, l, i),
      onStats: (s) => (this.view.stats = s),
      onError: (phase, msg) => this.set({ errors: [...this.view.errors, `${phase}: ${msg}`].slice(-12) }),
      onFailed: (reason, msg) => this.fallback(msg, reason),
    });
    this.vizHost = host;
    await host.load(this.photo, this.d.pageCorners as any, (viz.ctx ?? this.d.ctx) as any, { instant: true });
  }

  /** the watchdog gave up: back to the photo, with an apology */
  private fallback(msg: string, reason = 'watchdog') {
    if (!this.photoHost && this.photo) {
      this.photoHost = new SandboxHost(this.stageEl, PLACEHOLDER_MODULE, {});
      void this.photoHost.load(this.photo, this.d.pageCorners as any, this.d.ctx as any, { instant: true });
    }
    this.vizHost?.dispose();
    this.vizHost = null;
    this.set({ state: 'failed', failure: 'Couldn’t animate this one.', errors: [...this.view.errors, `${reason}: ${msg}`], panel: null });
    this.report('failed', `${reason}: ${msg}`);
  }

  play() {
    if (this.view.state === 'ready' || this.view.state === 'photo') this.vizHost?.play();
  }
  fold() {
    if (this.view.state === 'interactive') this.vizHost?.fold();
  }
  resetView() {
    this.vizHost?.resetView();
  }
  /** header bottom and the height covered by the controls sheet, in px */
  layout(top: number, bottom: number) {
    this.vizHost?.layout(top, bottom, 0);
  }
  /** fold back if needed; resolves when the model is back in the page */
  async close() {
    if (this.view.state !== 'interactive') return;
    this.fold();
    await new Promise<void>((r) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (this.view.state === 'photo' || Date.now() - t0 > 2600) {
          clearInterval(iv);
          r();
        }
      }, 50);
    });
  }

  dispose() {
    this.disposed = true;
    this.cancelGen?.();
    if (this.writingTimer) clearInterval(this.writingTimer);
    this.photoHost?.dispose();
    this.vizHost?.dispose();
  }
}
