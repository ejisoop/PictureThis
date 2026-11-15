// lp.board(): a graph-paper card that folds up off the page like a laptop lid
// (the pendulum's θ(t) card in the demo). Draw on it with the pencil helpers;
// call refresh() after drawing.
import * as THREE from 'three';
import type gsap from 'gsap';
// @ts-ignore — v1 JS
import { PALETTE, FONTS, sketchPath, sketchArrow } from './paper.js';
// @ts-ignore
import { addEdges } from './sketch.js';

export interface BoardOpts {
  parent: THREE.Object3D;
  /** hinge point (bottom-centre of the card when hinge = 'bottom'), parent x/z */
  at: [number, number];
  size: [number, number];
  hinge?: 'bottom' | 'top';
  /** how far it leans back once open (radians from vertical) */
  lean?: number;
  grid?: boolean;
  /** canvas width in px */
  px?: number;
}

export interface Axes {
  X: (x: number) => number;
  Y: (y: number) => number;
  box: { ox: number; oy: number; gw: number; gh: number };
}

export function makeBoard(o: BoardOpts) {
  const [w, h] = o.size;
  const cw = o.px ?? 1024;
  const chh = Math.max(64, Math.round(cw * (h / w)));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = chh;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const top = o.hinge === 'top';
  const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: '#2a2418', transparent: true, opacity: 0 });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, top ? -h / 2 : h / 2, 0), mat);
  card.castShadow = true;
  const edges = addEdges(card, { width: 1.2, opacity: 0.5 });
  const group = new THREE.Group();
  group.position.set(o.at[0], 0.006, o.at[1]);
  group.add(card);
  o.parent.add(group);
  const lean = o.lean ?? 0.42;
  const state = { open: 0, draw: 0 };
  const s = cw / 1024;

  const apply = () => {
    const flat = top ? Math.PI / 2 : -Math.PI / 2;
    group.rotation.x = flat + (top ? -1 : 1) * (Math.PI / 2 - lean) * state.open;
    mat.opacity = Math.min(1, state.draw * 1.6);
    edges.material.opacity = 0.5 * Math.min(1, state.draw * 1.6);
  };

  const board = {
    group,
    card,
    canvas,
    ctx,
    state,
    width: cw,
    height: chh,
    /** paper + light blue grid */
    clear() {
      ctx.fillStyle = '#f8f2e4';
      ctx.fillRect(0, 0, cw, chh);
      if (o.grid !== false) {
        ctx.save();
        ctx.strokeStyle = 'rgba(110,140,170,0.18)';
        ctx.lineWidth = 1.2 * s;
        const step = cw / 20;
        for (let x = step; x < cw; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chh); ctx.stroke(); }
        for (let y = step; y < chh; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(140,110,70,0.25)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, cw - 3, chh - 3);
    },
    /** pencil axes; returns maps from data to canvas pixels */
    axes(a: { x: [number, number]; y: [number, number]; xLabel?: string; yLabel?: string; color?: string; margin?: number }): Axes {
      const m = (a.margin ?? 90) * s;
      const ox = m, gw = cw - m - 50 * s;
      const top = 40 * s, bottom = chh - 50 * s;
      const gh = bottom - top;
      const X = (x: number) => ox + ((x - a.x[0]) / (a.x[1] - a.x[0])) * gw;
      const Y = (y: number) => bottom - ((y - a.y[0]) / (a.y[1] - a.y[0])) * gh;
      const ink = a.color ?? PALETTE.graphite;
      const y0 = Math.min(bottom, Math.max(top, Y(0)));
      const x0 = Math.min(ox + gw, Math.max(ox, X(0)));
      sketchArrow(ctx, ox - 8 * s, y0, ox + gw + 24 * s, y0, { color: ink, width: 2.6 * s, head: 14 * s, seed: 3 });
      sketchArrow(ctx, x0, bottom + 8 * s, x0, top - 22 * s, { color: ink, width: 2.6 * s, head: 14 * s, seed: 5 });
      ctx.save();
      ctx.font = `italic 400 ${34 * s}px ${FONTS.serif}`;
      ctx.fillStyle = ink;
      if (a.yLabel) ctx.fillText(a.yLabel, x0 + 14 * s, top + 4 * s);
      if (a.xLabel) { ctx.textAlign = 'right'; ctx.fillText(a.xLabel, ox + gw + 20 * s, y0 + 38 * s); }
      ctx.restore();
      return { X, Y, box: { ox, oy: y0, gw, gh } };
    },
    /** data polyline through an Axes map */
    plot(ax: Axes, pts: [number, number][], p: { color?: string; width?: number; dash?: number[]; sketchy?: boolean } = {}) {
      if (pts.length < 2) return;
      const px = pts.map(([x, y]) => [ax.X(x), ax.Y(y)] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
      if (p.sketchy) {
        sketchPath(ctx, px, { color: p.color ?? PALETTE.ink, width: (p.width ?? 3) * s, dash: p.dash ? p.dash.map((d) => d * s) : null, seed: 4 });
        return;
      }
      ctx.save();
      ctx.strokeStyle = p.color ?? PALETTE.coralDeep;
      ctx.lineWidth = (p.width ?? 4) * s;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (p.dash) ctx.setLineDash(p.dash.map((d) => d * s));
      ctx.beginPath();
      px.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    },
    dot(ax: Axes, x: number, y: number, p: { color?: string; r?: number } = {}) {
      ctx.save();
      ctx.fillStyle = p.color ?? PALETTE.coralDeep;
      ctx.beginPath();
      ctx.arc(ax.X(x), ax.Y(y), (p.r ?? 7) * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    /** handwritten text in canvas px (x, y), Caveat */
    text(str: string, x: number, y: number, p: { color?: string; size?: number; align?: CanvasTextAlign } = {}) {
      ctx.save();
      ctx.font = `600 ${(p.size ?? 40) * s}px ${FONTS.hand}`;
      ctx.fillStyle = p.color ?? PALETTE.graphite;
      ctx.textAlign = p.align ?? 'left';
      ctx.fillText(str, x * s, y * s);
      ctx.restore();
    },
    refresh() {
      tex.needsUpdate = true;
    },
    apply,
    enter(tl: gsap.core.Timeline, at = 0) {
      tl.to(state, { draw: 1, duration: 0.9, ease: 'power1.inOut', onUpdate: apply }, at);
      tl.to(state, { open: 1, duration: 1.1, ease: 'back.out(1.4)', onUpdate: apply }, at + 0.35);
      return at + 1.45;
    },
    exit(tl: gsap.core.Timeline, at = 0) {
      tl.to(state, { open: 0, duration: 0.7, ease: 'power2.in', onUpdate: apply }, at);
      tl.to(state, { draw: 0, duration: 0.5, onUpdate: apply }, at + 0.7);
      return at + 1.2;
    },
  };
  board.clear();
  board.refresh();
  apply();
  return board;
}
