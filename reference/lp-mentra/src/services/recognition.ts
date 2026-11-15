// Recognition pipeline: photo in, page + regions + concept matches out.
// The interface is what a real cloud service would expose. The mock below
// runs the same stages with realistic latencies, but "reads" the page from
// ground truth, judging what it can see from the simulated camera geometry.
import type { Photo, PipelineResult, RecognizedRegion, PageRect, SkipReason } from '../shared/types';
import { matchConcepts } from './registry';
import { SPREADS } from '../viz/pagedata';
// @ts-ignore — v1 JS module
import { pageHeight, PAGE_W, PAGE_H } from '../viz/book.js';

export type StageName = 'upload' | 'page' | 'layout' | 'recognize' | 'match';
export interface StageEvent {
  photoId: string;
  stage: StageName;
  status: 'start' | 'done' | 'skip';
  ms?: number;
  detail?: string;
}

export interface RecognitionPipeline {
  analyze(photo: Photo, onStage?: (e: StageEvent) => void): Promise<PipelineResult>;
}

/** Simulation-only: what the camera could physically see when a photo was taken. */
export interface SimFrame {
  spreadIndex: number;
  turning: boolean;
  angularVelocity: number; // rad/s of the head at capture
  width: number;
  height: number;
  /** project a book-space point to photo pixels; null if behind the camera */
  project(x: number, y: number, z: number): [number, number] | null;
  cameraPos: [number, number, number];
}
export interface SimOracle {
  frame(photoId: string): SimFrame | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const surfY = (x: number) => pageHeight(Math.min(1, Math.abs(x) / PAGE_W));

export interface Latencies {
  upload: number;
  page: number;
  layout: number;
  recognize: number;
  match: number;
}
export const DEFAULT_LATENCIES: Latencies = { upload: 140, page: 90, layout: 160, recognize: 260, match: 40 };

export class MockRecognitionPipeline implements RecognitionPipeline {
  constructor(private oracle: SimOracle, public latencies: Latencies = { ...DEFAULT_LATENCIES }, public speed = 1) {}

  private async stage<T>(photoId: string, stage: StageName, emit: ((e: StageEvent) => void) | undefined, work: () => T | Promise<T>, detail?: (r: T) => string): Promise<T> {
    emit?.({ photoId, stage, status: 'start' });
    const t0 = performance.now();
    const base = this.latencies[stage] * (0.8 + Math.random() * 0.4);
    const r = await work();
    const spent = performance.now() - t0;
    await sleep(Math.max(0, base - spent) / this.speed);
    emit?.({ photoId, stage, status: 'done', ms: Math.round(Math.max(base, spent)), detail: detail?.(r) });
    return r;
  }

  async analyze(photo: Photo, emit?: (e: StageEvent) => void): Promise<PipelineResult> {
    const timings: Record<string, number> = {};
    const f = this.oracle.frame(photo.id);
    const res: PipelineResult = { photoId: photo.id, regions: [], matches: [], timings };
    if (!f) return { ...res, skipped: 'no-page' };

    await this.stage(photo.id, 'upload', emit, () => null, () => `${photo.width}×${photo.height} jpeg`);

    // --- page localization + frame quality --------------------------------
    const spread = SPREADS[f.spreadIndex];
    const pageQuad = (x0: number, x1: number) => [
      f.project(x0, surfY(x0), -PAGE_H / 2), f.project(x1, surfY(x1), -PAGE_H / 2),
      f.project(x1, surfY(x1), PAGE_H / 2), f.project(x0, surfY(x0), PAGE_H / 2),
    ];
    const skip = (why: SkipReason, detail: string) => {
      emit?.({ photoId: photo.id, stage: 'page', status: 'skip', detail });
      return { ...res, skipped: why };
    };
    const gate = this.frameGate(f);
    if (f.turning) return skip('page-turning', 'page is turning');
    if (f.angularVelocity > 1.0) return skip('motion-blur', `motion blur (${f.angularVelocity.toFixed(2)} rad/s)`);
    if (gate.cos < 0.42) return skip('too-oblique', `page too oblique (${Math.round((Math.acos(gate.cos) * 180) / Math.PI)}°)`);
    if (gate.visible < 0.3 || gate.area < 0.08) return skip('no-page', 'no page in view');

    const scan = await this.stage(photo.id, 'page', emit, () => this.dewarp(photo, f), () => `page found · p.${spread.pageNumber} · dewarped`);
    res.pageId = spread.pageId;
    res.pageNumber = spread.pageNumber;
    res.pageQuad = pageQuad(-PAGE_W, PAGE_W).map((p) => p ?? [0, 0]) as [number, number][];
    res.scanUrl = scan.url;
    res.scanSize = { width: scan.width, height: scan.height };
    res.paperTone = scan.tone;

    // --- layout + recognition ---------------------------------------------
    const regions = await this.stage(photo.id, 'layout', emit, () => {
      return spread.regions
        .map((r) => {
          const v = this.regionVisibility(f, r.rect);
          return { r, v };
        })
        .filter(({ v }) => v.visible > 0.15);
    }, (r) => `${r.length} region${r.length === 1 ? '' : 's'}`);

    res.regions = await this.stage(photo.id, 'recognize', emit, () =>
      regions.map(({ r, v }): RecognizedRegion => {
        const readable = v.conf > 0.35;
        return {
          kind: r.kind,
          rect: r.rect,
          quad: v.quad,
          confidence: v.conf,
          text: readable ? r.text : undefined,
          latex: readable ? r.latex : undefined,
          figureClass: v.conf > 0.2 ? r.figureClass : undefined,
          caption: readable ? r.caption : undefined,
        };
      }), (rs) => {
        const figs = rs.filter((x) => x.kind === 'figure' && x.figureClass);
        return figs.length ? figs.map((x) => `${x.figureClass} ${(x.confidence * 100) | 0}%`).join(', ') : 'text only';
      });

    res.matches = await this.stage(photo.id, 'match', emit, () => matchConcepts(res.regions), (m) => (m.length ? `${m[0].conceptId} ${(m[0].confidence * 100) | 0}%` : 'no concept'));
    return res;
  }

  private frameGate(f: SimFrame) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 6; i++)
      for (let j = 0; j <= 6; j++) {
        const x = -PAGE_W + (2 * PAGE_W * i) / 6, z = -PAGE_H / 2 + (PAGE_H * j) / 6;
        pts.push([x, surfY(x), z]);
      }
    let inside = 0;
    for (const p of pts) {
      const q = f.project(...p);
      if (q && q[0] >= 0 && q[0] <= f.width && q[1] >= 0 && q[1] <= f.height) inside++;
    }
    const quad = [f.project(-PAGE_W, 0.2, -PAGE_H / 2), f.project(PAGE_W, 0.2, -PAGE_H / 2), f.project(PAGE_W, 0.2, PAGE_H / 2), f.project(-PAGE_W, 0.2, PAGE_H / 2)];
    const area = quad.every(Boolean) ? Math.min(1, polyArea(quad as [number, number][]) / (f.width * f.height)) : 0;
    const c = f.cameraPos;
    const len = Math.hypot(c[0], c[1] - 0.2, c[2]);
    return { visible: inside / pts.length, area, cos: (c[1] - 0.2) / len };
  }

  private regionVisibility(f: SimFrame, rect: PageRect) {
    let inside = 0, n = 0;
    for (let i = 0; i <= 5; i++)
      for (let j = 0; j <= 5; j++) {
        const x = rect.x0 + (rect.w * i) / 5, z = rect.z0 + (rect.h * j) / 5;
        const q = f.project(x, surfY(x), z);
        n++;
        if (q && q[0] >= 0 && q[0] <= f.width && q[1] >= 0 && q[1] <= f.height) inside++;
      }
    const corners: [number, number][] = [[rect.x0, rect.z0], [rect.x0 + rect.w, rect.z0], [rect.x0 + rect.w, rect.z0 + rect.h], [rect.x0, rect.z0 + rect.h]];
    const quad = corners.map(([x, z]) => f.project(x, surfY(x), z) ?? [0, 0]) as [number, number][];
    const areaFrac = polyArea(quad) / (f.width * f.height);
    const cx = rect.x0 + rect.w / 2, cz = rect.z0 + rect.h / 2;
    const d = [f.cameraPos[0] - cx, f.cameraPos[1] - surfY(cx), f.cameraPos[2] - cz];
    const cos = d[1] / Math.hypot(...d);
    const visible = inside / n;
    const conf =
      Math.pow(visible, 2.2) *
      (0.25 + 0.75 * smooth(0.012, 0.05, areaFrac)) *
      (0.3 + 0.7 * smooth(0.35, 0.62, cos)) *
      (1 - 0.6 * smooth(0.35, 1.0, f.angularVelocity));
    return { visible, quad, conf: Math.min(0.99, conf) };
  }

  /** Flatten the right page out of the photo, following the page's own curve. */
  private async dewarp(photo: Photo, f: SimFrame) {
    // load through <img> (blob: images are allowed where fetch may not be)
    const bmp = new Image();
    bmp.src = photo.url;
    await bmp.decode();
    const src = document.createElement('canvas');
    src.width = bmp.width;
    src.height = bmp.height;
    const sctx = src.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(bmp, 0, 0);
    const sp = sctx.getImageData(0, 0, src.width, src.height).data;
    const W = 600, H = 800, GX = 24, GZ = 32;
    // projected grid over the curved page
    const grid: [number, number][] = [];
    for (let j = 0; j <= GZ; j++)
      for (let i = 0; i <= GX; i++) {
        const x = (PAGE_W * i) / GX, z = -PAGE_H / 2 + (PAGE_H * j) / GZ;
        grid.push(f.project(x, surfY(x), z) ?? [-1, -1]);
      }
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const octx = out.getContext('2d')!;
    const img = octx.createImageData(W, H);
    const d = img.data;
    const sw = src.width, sh = src.height;
    let tr = 0, tg = 0, tb = 0, tn = 0;
    for (let y = 0; y < H; y++) {
      const gz = (y / (H - 1)) * GZ, j = Math.min(GZ - 1, Math.floor(gz)), fz = gz - j;
      for (let x = 0; x < W; x++) {
        const gx = (x / (W - 1)) * GX, i = Math.min(GX - 1, Math.floor(gx)), fx = gx - i;
        const a = grid[j * (GX + 1) + i], b = grid[j * (GX + 1) + i + 1], c = grid[(j + 1) * (GX + 1) + i], e = grid[(j + 1) * (GX + 1) + i + 1];
        const px = (a[0] * (1 - fx) + b[0] * fx) * (1 - fz) + (c[0] * (1 - fx) + e[0] * fx) * fz;
        const py = (a[1] * (1 - fx) + b[1] * fx) * (1 - fz) + (c[1] * (1 - fx) + e[1] * fx) * fz;
        const o = (y * W + x) * 4;
        if (px < 0 || py < 0 || px >= sw - 1 || py >= sh - 1) {
          d[o] = 236; d[o + 1] = 228; d[o + 2] = 212; d[o + 3] = 255; // out of frame: blank paper
          continue;
        }
        const x0 = px | 0, y0 = py | 0, ax = px - x0, ay = py - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
        for (let k = 0; k < 3; k++) {
          d[o + k] = (sp[p00 + k] * (1 - ax) + sp[p10 + k] * ax) * (1 - ay) + (sp[p01 + k] * (1 - ax) + sp[p11 + k] * ax) * ay;
        }
        d[o + 3] = 255;
        if (x > W * 0.9 && y > H * 0.2 && y < H * 0.8 && (x + y) % 7 === 0) {
          tr += d[o]; tg += d[o + 1]; tb += d[o + 2]; tn++;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    const url = await new Promise<string>((r) => out.toBlob((b) => r(URL.createObjectURL(b!)), 'image/jpeg', 0.9));
    const tone: [number, number, number] = tn ? [tr / tn / 255, tg / tn / 255, tb / tn / 255] : [0.93, 0.9, 0.84];
    return { url, width: W, height: H, tone };
  }
}

function polyArea(q: [number, number][]) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}
