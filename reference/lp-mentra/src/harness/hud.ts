// Harness chrome around the glasses feed: pipeline overlay on the camera view,
// the glasses control bar (LED, button, voice, speaker captions) and the
// pipeline strip. None of this is part of the miniapp.
import gsap from 'gsap';
import type { Trace } from '../background';
import type { PipelineResult, PageRect } from '../shared/types';
import type { GlassesSim } from './glasses';
import { PAGE_W, PAGE_H, pageHeight } from './glasses';

const STAGES = [
  ['capture', 'capture'],
  ['upload', 'upload'],
  ['page', 'page found'],
  ['layout', 'regions'],
  ['recognize', 'recognized'],
  ['match', 'matched'],
  ['decision', 'phone'],
] as const;

const surfY = (x: number) => pageHeight(Math.min(1, Math.abs(x) / PAGE_W));

export class Hud {
  overlay: HTMLCanvasElement;
  showPipeline = true;
  private last: { result: PipelineResult; at: number; decision?: Trace & { type: 'decision' } } | null = null;
  private flashAt = -1;
  private skipText: { text: string; at: number } | null = null;
  private stageEls = new Map<string, HTMLElement>();
  private logEl: HTMLElement;

  constructor(private sim: GlassesSim, private root: { feed: HTMLElement; strip: HTMLElement; caption: HTMLElement; led: HTMLElement; log: HTMLElement }) {
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'feed-overlay';
    root.feed.appendChild(this.overlay);
    this.logEl = root.log;
    root.strip.innerHTML = STAGES.map(([k, label], i) => `${i ? '<span class="arrow">→</span>' : ''}<div class="stage" data-k="${k}"><b>${label}</b><span class="ms"></span><span class="detail"></span></div>`).join('');
    root.strip.querySelectorAll<HTMLElement>('.stage').forEach((el) => this.stageEls.set(el.dataset.k!, el));
    sim.speaker.onCaption = (text, kind) => this.caption(text, kind);
  }

  setShowPipeline(on: boolean) {
    this.showPipeline = on;
    document.body.classList.toggle('no-pipeline', !on);
  }

  private setStage(k: string, state: 'idle' | 'active' | 'done' | 'skip' | 'fail', ms?: number, detail?: string) {
    const el = this.stageEls.get(k);
    if (!el) return;
    el.dataset.state = state;
    (el.querySelector('.ms') as HTMLElement).textContent = ms !== undefined ? `${ms} ms` : '';
    if (detail !== undefined) (el.querySelector('.detail') as HTMLElement).textContent = detail;
  }

  trace(t: Trace) {
    if (t.type === 'capture') {
      this.flashAt = performance.now();
      for (const [k] of STAGES) this.setStage(k, 'idle', undefined, '');
      this.setStage('capture', 'done', 12, `${t.photo.reason === 'scan' ? 'auto' : t.photo.reason} · ${t.photo.width}×${t.photo.height}`);
      gsap.fromTo(this.root.led, { scale: 1.6 }, { scale: 1, duration: 0.4 });
    } else if (t.type === 'stage') {
      const e = t.event;
      this.setStage(e.stage, e.status === 'start' ? 'active' : e.status === 'skip' ? 'skip' : 'done', e.ms, e.detail);
      if (e.status === 'skip') {
        this.skipText = { text: e.detail ?? 'skipped', at: performance.now() };
        this.log(`skipped — ${e.detail}`, 'skip');
      }
    } else if (t.type === 'result') {
      if (!t.result.skipped) this.last = { result: t.result, at: performance.now() };
    } else if (t.type === 'decision') {
      if (this.last && this.last.result.photoId === t.photoId) this.last.decision = t;
      const ok = t.decision === 'deliver';
      const label: Record<string, string> = { deliver: 'sent to phone', wait: 'confirming', 'below-threshold': 'below threshold', 'already-delivered': 'already on phone', nothing: 'nothing to show', skipped: 'skipped', revisit: 'surfaced again' };
      if (t.decision !== 'skipped') {
        this.setStage('decision', ok ? 'done' : t.decision === 'wait' ? 'active' : 'fail', undefined, label[t.decision]);
        this.log(t.detail, t.decision);
      }
    }
  }

  private log(text: string, kind: string) {
    const li = document.createElement('div');
    li.className = `log-line k-${kind}`;
    const ts = new Date();
    li.innerHTML = `<time>${ts.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</time>${text}`;
    this.logEl.prepend(li);
    while (this.logEl.children.length > 7) this.logEl.lastElementChild!.remove();
  }

  private captionTimer: ReturnType<typeof setTimeout> | null = null;
  caption(text: string | null, kind: 'speech' | 'earcon') {
    const el = this.root.caption;
    if (!text) return;
    el.innerHTML = `<span class="spk">🔈</span>${text}`;
    el.dataset.kind = kind;
    el.classList.add('show');
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => el.classList.remove('show'), kind === 'speech' ? 3600 : 1800);
  }

  draw() {
    const c = this.overlay;
    const r = this.root.feed.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const now = performance.now();
    // shutter
    const fa = (now - this.flashAt) / 260;
    if (fa >= 0 && fa < 1) {
      ctx.fillStyle = `rgba(255,252,240,${0.22 * (1 - fa)})`;
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - fa)})`;
      ctx.lineWidth = 2;
      const m = 14 + fa * 8;
      this.corners(ctx, m, m, r.width - 2 * m, r.height - 2 * m, 26);
    }
    if (!this.showPipeline) return;
    if (this.skipText && now - this.skipText.at < 1600) {
      ctx.globalAlpha = 1 - (now - this.skipText.at) / 1600;
      this.chip(ctx, r.width / 2, 34, this.skipText.text, '#8a6a4a', true);
      ctx.globalAlpha = 1;
    }
    const L = this.last;
    if (!L) return;
    const age = now - L.at;
    const alpha = age < 2600 ? 1 : Math.max(0, 1 - (age - 2600) / 900);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    // page outline (live-projected so it sticks to the book)
    const P = (x: number, z: number) => this.sim.projectLive(x, surfY(x) + 0.004, z);
    const quad = [P(-PAGE_W, -PAGE_H / 2), P(PAGE_W, -PAGE_H / 2), P(PAGE_W, PAGE_H / 2), P(-PAGE_W, PAGE_H / 2)];
    if (quad.every(Boolean)) {
      ctx.strokeStyle = 'rgba(107,143,179,0.85)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      quad.forEach((p, i) => (i ? ctx.lineTo(...p!) : ctx.moveTo(...p!)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      this.chip(ctx, quad[0]![0] + 46, quad[0]![1] - 14, `page ${L.result.pageNumber}`, '#6b8fb3');
    }
    const dec = L.decision;
    for (const reg of L.result.regions) {
      const isFig = reg.kind === 'figure';
      const conf = reg.confidence;
      const col = isFig ? (dec?.decision === 'deliver' && conf >= 0.8 ? '#6f8f6c' : conf >= 0.8 ? '#c96a5a' : '#b08a3e') : 'rgba(90,86,80,0.55)';
      const q = this.rectQuad(reg.rect);
      if (!q) continue;
      const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
      ctx.strokeStyle = col;
      ctx.lineWidth = isFig ? 2.2 : 1.1;
      this.corners(ctx, x0, y0, w, h, isFig ? 16 : 9);
      const label = isFig ? `${reg.figureClass ?? 'figure'} · ${(conf * 100) | 0}%` : reg.kind === 'equation' ? 'equation' : 'text';
      if (isFig || reg.kind === 'equation') this.chip(ctx, x0 + w / 2, y0 - 12, label, col);
    }
    if (dec && dec.decision === 'deliver') {
      const q = L.result.regions.find((x) => x.kind === 'figure');
      if (q) {
        const qq = this.rectQuad(q.rect);
        if (qq) this.chip(ctx, (qq[0][0] + qq[1][0]) / 2, Math.max(...qq.map((p) => p[1])) + 16, '✓ sent to phone', '#6f8f6c', true);
      }
    }
    ctx.globalAlpha = 1;
  }

  private rectQuad(rc: PageRect) {
    const P = (x: number, z: number) => this.sim.projectLive(x, surfY(x) + 0.004, z);
    const q = [P(rc.x0, rc.z0), P(rc.x0 + rc.w, rc.z0), P(rc.x0 + rc.w, rc.z0 + rc.h), P(rc.x0, rc.z0 + rc.h)];
    return q.every(Boolean) ? (q as [number, number][]) : null;
  }

  private corners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number) {
    s = Math.min(s, w / 3, h / 3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
      ctx.moveTo(cx + dx * s, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * s);
    }
    ctx.stroke();
  }

  private chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, col: string, strong = false) {
    ctx.font = `${strong ? 600 : 500} ${strong ? 14 : 12}px "EB Garamond", Georgia, serif`;
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(251,246,234,0.92)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}
