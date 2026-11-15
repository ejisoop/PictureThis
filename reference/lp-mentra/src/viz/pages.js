// Renders a chapter's two printed pages (plus the colored and "lifted" variants
// of its figure) to canvases. Chapters describe content; this file does layout.
import * as THREE from 'three';
import { CANVAS_W, CANVAS_H, PAGE_W, PAGE_H } from './book.js';
import { paintPaper, wrapParagraph, drawMath, mathWidth, serif, handText, sketchPath, PALETTE, FONTS } from './paper.js';

export const pageToPx = (x, z) => [(x / PAGE_W) * CANVAS_W, ((z + PAGE_H / 2) / PAGE_H) * CANVAS_H];
export const PX_PER_UNIT = CANVAS_W / PAGE_W;

// Simple flowing layout for a printed text column.
export class PageWriter {
  constructor(ctx, { x = 190, width = CANVAS_W - 380, y = 230 } = {}) {
    Object.assign(this, { ctx, x, width, y });
    this.body = 41;
    this.lh = 59;
  }
  header(left, right, side) {
    const { ctx } = this;
    ctx.save();
    serif(ctx, 24, { color: PALETTE.graphite });
    ctx.letterSpacing = '4px';
    ctx.textAlign = side === 'left' ? 'left' : 'right';
    const x = side === 'left' ? this.x : this.x + this.width;
    ctx.fillText(left.toUpperCase(), x, 120);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(90,86,80,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x, 140);
    ctx.lineTo(this.x + this.width, 140);
    ctx.stroke();
    serif(ctx, 28, { color: PALETTE.graphite });
    ctx.textAlign = 'center';
    ctx.fillText(right, CANVAS_W / 2 + (side === 'left' ? -40 : 40), CANVAS_H - 85);
    ctx.restore();
  }
  title(num, text, kicker) {
    const { ctx } = this;
    if (kicker) {
      ctx.save();
      serif(ctx, 26, { color: PALETTE.sepia, italic: true });
      ctx.letterSpacing = '2px';
      ctx.fillText(kicker, this.x, this.y);
      ctx.restore();
      this.y += 74;
    }
    serif(ctx, 72, { weight: 500, color: PALETTE.ink });
    ctx.fillText(num, this.x, this.y);
    const nw = ctx.measureText(num + '  ').width;
    serif(ctx, 72, { weight: 500, italic: false, color: PALETTE.ink });
    const words = text.split(' ');
    let line = '', y = this.y, x = this.x + nw;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > this.width - (x - this.x)) {
        ctx.fillText(line, x, y);
        line = w;
        y += 76;
        x = this.x + nw;
      } else line = t;
    }
    ctx.fillText(line, x, y);
    this.y = y + 30;
    ctx.save();
    ctx.strokeStyle = PALETTE.sepia;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + 140, this.y);
    ctx.stroke();
    ctx.restore();
    this.y += 80;
  }
  para(text, { dropCap = false, indent = 44 } = {}) {
    const { ctx } = this;
    serif(ctx, this.body, { color: PALETTE.ink });
    if (dropCap) {
      const c = text[0];
      ctx.save();
      serif(ctx, 128, { weight: 500, color: PALETTE.sepia });
      ctx.fillText(c, this.x - 4, this.y + this.lh * 1.55);
      const cw = ctx.measureText(c).width + 14;
      ctx.restore();
      serif(ctx, this.body, { color: PALETTE.ink });
      // first three lines wrap around the drop cap
      const rest = text.slice(1);
      const words = rest.split(' ');
      let lines = 0, idx = 0;
      while (lines < 2 && idx < words.length) {
        let line = '';
        while (idx < words.length && ctx.measureText((line ? line + ' ' : '') + words[idx]).width < this.width - cw) {
          line = (line ? line + ' ' : '') + words[idx++];
        }
        const lw = line.split(' ');
        const total = lw.reduce((s, w) => s + ctx.measureText(w).width, 0);
        const gap = lw.length > 1 ? (this.width - cw - total) / (lw.length - 1) : 0;
        let lx = this.x + cw;
        for (const w of lw) {
          ctx.fillText(w, lx, this.y);
          lx += ctx.measureText(w).width + gap;
        }
        this.y += this.lh;
        lines++;
      }
      this.y = wrapParagraph(ctx, words.slice(idx).join(' '), this.x, this.y, this.width, this.lh, { indent: 0 });
    } else {
      this.y = wrapParagraph(ctx, text, this.x, this.y, this.width, this.lh, { indent });
    }
    this.y += 14;
  }
  eq(tokens, num, size = 52) {
    const { ctx } = this;
    this.y += 26;
    const w = mathWidth(ctx, tokens, size);
    const cy = this.y + size * 0.6;
    drawMath(ctx, tokens, this.x + (this.width - w) / 2, cy, size);
    if (num) {
      serif(ctx, 34, { color: PALETTE.graphite });
      ctx.textAlign = 'right';
      ctx.fillText(`(${num})`, this.x + this.width, cy);
      ctx.textAlign = 'left';
    }
    this.lastEqY = cy;
    this.y = cy + size * 0.9 + 22;
  }
  space(px) {
    this.y += px;
  }
}

export function noteScribble(ctx, x, y, w, seed = 4) {
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([x + (w * i) / 12, y + Math.sin(i * 1.7 + seed) * 2.5]);
  sketchPath(ctx, pts, { color: PALETTE.graphite, width: 2.2, alpha: 0.55, seed });
}

export function caption(ctx, fig, text, x, y, w) {
  serif(ctx, 30, { color: PALETTE.ink });
  ctx.save();
  ctx.font = `600 30px ${FONTS.serif}`;
  ctx.fillStyle = PALETTE.sepia;
  ctx.fillText(fig, x, y);
  const fw = ctx.measureText(fig + '  ').width;
  ctx.restore();
  serif(ctx, 30, { italic: true, color: PALETTE.graphite });
  return wrapParagraph(ctx, text, x, y, w, 42, { justify: false, indent: fw });
}

function makeCanvas(w = CANVAS_W, h = CANVAS_H) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const tex = (c) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

// Builds all textures for a chapter. The diagram rect is defined in page
// coordinates by the chapter (x from spine, z from top=-H/2).
export function renderChapter(ch) {
  const left = makeCanvas();
  const lctx = left.getContext('2d');
  paintPaper(lctx, CANVAS_W, CANVAS_H, { side: 'left', seed: ch.seed });
  ch.drawLeft(lctx, new PageWriter(lctx));

  const right = makeCanvas();
  const rctx = right.getContext('2d');
  paintPaper(rctx, CANVAS_W, CANVAS_H, { side: 'right', seed: ch.seed + 11 });
  ch.drawRight(rctx, new PageWriter(rctx));

  if (!ch.diag) {
    return { left: tex(left), right: tex(right), colored: null, ghost: null, rect: new THREE.Vector4(0, 0, 0, 0), canvases: { left, right } };
  }
  // crop of bare paper (with text) under the figure
  const { x0, z0, w, h } = ch.diag;
  const [px0, py0] = pageToPx(x0, z0);
  const [px1, py1] = pageToPx(x0 + w, z0 + h);
  const cw = Math.round(px1 - px0), chh = Math.round(py1 - py0);
  const base = makeCanvas(cw, chh);
  base.getContext('2d').drawImage(right, Math.round(px0), Math.round(py0), cw, chh, 0, 0, cw, chh);

  // map page coords to crop pixels
  const P = (x, z) => {
    const [a, b] = pageToPx(x, z);
    return [a - Math.round(px0), b - Math.round(py0)];
  };
  const variant = (mode) => {
    const c = makeCanvas(cw, chh);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ch.drawDiagram(ctx, mode, P, PX_PER_UNIT);
    return c;
  };
  const printed = variant('print');
  rctx.drawImage(printed, Math.round(px0), Math.round(py0));
  const colored = variant('color');
  const ghost = variant('ghost');

  const rect = new THREE.Vector4(Math.round(px0) / CANVAS_W, 1 - (Math.round(py0) + chh) / CANVAS_H, cw / CANVAS_W, chh / CANVAS_H);
  return { left: tex(left), right: tex(right), colored: tex(colored), ghost: tex(ghost), rect, canvases: { left, right, colored, ghost } };
}

export { handText, PALETTE };
