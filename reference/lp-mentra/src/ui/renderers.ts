// Renderer abstraction: how a detection becomes something to look at.
// Interactive3DRenderer is what the demo uses. The video path is stubbed with
// a mock provider so its UI states exist and can be reached from debug settings.
import gsap from 'gsap';
import type { Detection, RendererKind } from '../shared/types';
import type { PhoneStage } from './stage/PhoneStage';
import { MockVideoProvider, type VideoGenerationProvider, type VideoJobProgress } from '../services/video';

export type RenderState = 'loading' | 'photo' | 'lifting' | 'interactive' | 'folding' | 'generating' | 'ready-video';

export interface ConceptRenderer {
  readonly kind: RendererKind;
  mount(det: Detection): Promise<void>;
  /** bring it to life */
  play(): Promise<void>;
  /** fold back into the page */
  close(): Promise<void>;
  dispose(): void;
}

export class Interactive3DRenderer implements ConceptRenderer {
  readonly kind = 'interactive3d' as const;
  constructor(private stage: PhoneStage, private onState: (s: RenderState) => void) {}
  async mount(det: Detection) {
    this.onState('loading');
    await this.stage.load(det);
    await this.stage.showPhoto();
    this.onState('photo');
  }
  async play() {
    this.onState('lifting');
    await this.stage.activate();
    this.onState('interactive');
  }
  async close() {
    this.onState('folding');
    await this.stage.deactivate();
    this.onState('photo');
  }
  dispose() {
    this.stage.clearViz();
  }
}

/** Stub of the future generated-explainer path (mock provider, placeholder clip). */
export class GeneratedVideoRenderer implements ConceptRenderer {
  readonly kind = 'generatedVideo' as const;
  private root: HTMLElement;
  private det: Detection | null = null;
  private raf = 0;
  private img = new Image();
  constructor(host: HTMLElement, private onState: (s: RenderState, p?: VideoJobProgress) => void, private provider: VideoGenerationProvider = new MockVideoProvider()) {
    this.root = document.createElement('div');
    this.root.className = 'video-renderer';
    host.appendChild(this.root);
  }
  async mount(det: Detection) {
    this.det = det;
    this.img.src = det.scanUrl;
    await this.img.decode().catch(() => {});
    this.root.innerHTML = `<img class="vr-photo" src="${det.scanUrl}" alt="your page">`;
    this.onState('photo');
  }
  async play() {
    const det = this.det!;
    this.root.innerHTML = `
      <div class="vr-gen">
        <svg class="vr-pencil" viewBox="0 0 120 60"><path class="scribble" d="M5 40 C 20 10, 35 50, 50 25 S 80 5, 95 35 S 110 45, 115 20"/></svg>
        <div class="vr-title">Sketching your explainer…</div>
        <div class="vr-phase"></div>
        <div class="vr-bar"><i></i></div>
        <div class="vr-provider">${this.provider.name}</div>
      </div>`;
    this.onState('generating');
    const clip = await this.provider.generate(det.renderPlan.videoPrompt, { durationS: 8, aspect: '9:16' }, (p) => {
      this.onState('generating', p);
      const ph = this.root.querySelector('.vr-phase');
      if (ph) ph.textContent = p.phase;
      const bar = this.root.querySelector<HTMLElement>('.vr-bar i');
      if (bar) bar.style.width = `${p.progress * 100}%`;
    });
    this.root.innerHTML = `
      <canvas class="vr-canvas"></canvas>
      <div class="vr-badge">placeholder clip · mock provider</div>
      <div class="vr-controls"><button class="vr-play">❚❚</button><input class="vr-scrub" type="range" min="0" max="1000" value="0"><span class="vr-time">0:00</span></div>`;
    this.onState('ready-video');
    this.playback(clip.durationMs);
  }
  private playback(durMs: number) {
    const cv = this.root.querySelector<HTMLCanvasElement>('.vr-canvas')!;
    const scrub = this.root.querySelector<HTMLInputElement>('.vr-scrub')!;
    const btn = this.root.querySelector<HTMLButtonElement>('.vr-play')!;
    const time = this.root.querySelector<HTMLElement>('.vr-time')!;
    let t = 0, playing = true, last = performance.now();
    btn.onclick = () => {
      playing = !playing;
      btn.textContent = playing ? '❚❚' : '▶';
    };
    scrub.oninput = () => (t = (+scrub.value / 1000) * durMs);
    const det = this.det!;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const now = performance.now();
      if (playing) t = (t + (now - last)) % durMs;
      last = now;
      const r = cv.getBoundingClientRect();
      if (cv.width !== Math.round(r.width * 2)) {
        cv.width = Math.round(r.width * 2);
        cv.height = Math.round(r.height * 2);
      }
      const ctx = cv.getContext('2d')!;
      const k = t / durMs;
      ctx.fillStyle = '#f5ecda';
      ctx.fillRect(0, 0, cv.width, cv.height);
      // Ken Burns over the student's own figure, standing in for a generated clip
      const b = det.regionBox, s = det.scanSize;
      const sx = (b.x0 / 2.1) * s.width, sy = ((b.z0 + 1.4) / 2.8) * s.height, sw = (b.w / 2.1) * s.width, sh = (b.h / 2.8) * s.height;
      const zoom = 1 + 0.25 * Math.sin(k * Math.PI);
      const cw = sw / zoom, chh = sh / zoom;
      const dh = (cv.width * chh) / cw;
      ctx.drawImage(this.img, sx + (sw - cw) * k, sy + (sh - chh) * 0.5, cw, chh, 0, (cv.height - dh) / 2, cv.width, dh);
      ctx.fillStyle = `rgba(232,144,126,${0.12 + 0.1 * Math.sin(k * 12)})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.font = `600 ${cv.width * 0.06}px Caveat, cursive`;
      ctx.fillStyle = '#3a352f';
      ctx.fillText(det.title, cv.width * 0.06, cv.height * 0.2);
      scrub.value = String(Math.round(k * 1000));
      time.textContent = `0:0${Math.floor(t / 1000)}`;
    };
    draw();
  }
  async close() {
    cancelAnimationFrame(this.raf);
    if (this.det) this.root.innerHTML = `<img class="vr-photo" src="${this.det.scanUrl}" alt="your page">`;
    this.onState('photo');
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    gsap.killTweensOf(this.root);
    this.root.remove();
  }
}

/** Future: play a generated clip, then hand off to the live model. Not used yet. */
export class HybridRenderer implements ConceptRenderer {
  readonly kind = 'hybrid' as const;
  constructor(private video: GeneratedVideoRenderer, private live: Interactive3DRenderer) {}
  async mount(det: Detection) {
    await this.video.mount(det);
    await this.live.mount(det);
  }
  async play() {
    await this.video.play();
    // TODO: when the clip ends, cross-fade into the interactive model
    await this.live.play();
  }
  close() {
    return this.live.close();
  }
  dispose() {
    this.video.dispose();
    this.live.dispose();
  }
}
