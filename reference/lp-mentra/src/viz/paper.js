// Canvas helpers for drawing printed textbook pages: paper, typography,
// equations and pencil-like sketch strokes.

export const PALETTE = {
  paper: '#f7f0e1',
  paperShade: '#ece2cc',
  ink: '#2f2b26',
  graphite: '#5a5650',
  sepia: '#8a6a4a',
  sage: '#9fb79a',
  sageDeep: '#6f8f6c',
  blue: '#9db7cf',
  blueDeep: '#6b8fb3',
  peach: '#f2b8a0',
  coral: '#e8907e',
  coralDeep: '#c96a5a',
  lavender: '#c4b5dc',
  lavenderDeep: '#8f7db5',
  yellow: '#f1d68c',
};

export const FONTS = {
  serif: '"EB Garamond", Georgia, serif',
  hand: 'Caveat, "EB Garamond", cursive',
};

// Deterministic PRNG so pages render identically every time.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let grainTile = null;
function getGrainTile() {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r();
    const d = (v - 0.5) * 22;
    img.data[i] = 128 + d;
    img.data[i + 1] = 128 + d;
    img.data[i + 2] = 128 + d * 0.9;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

// Fills a canvas with warm paper: base tone, grain, fibres, gutter shading.
export function paintPaper(ctx, w, h, { side = 'right', seed = 3 } = {}) {
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, w, h);

  // soft large-scale tone variation
  const r = rng(seed);
  for (let i = 0; i < 8; i++) {
    const x = r() * w, y = r() * h, rad = (0.2 + r() * 0.4) * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${r() > 0.5 ? '238,228,206' : '252,247,236'},0.1)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // grain
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = ctx.createPattern(getGrainTile(), 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // fibres
  ctx.save();
  ctx.strokeStyle = 'rgba(140,120,90,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, l = 6 + r() * 18, a = r() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r() * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();

  // gutter shadow toward the spine + gentle edge darkening
  const gx = side === 'right' ? 0 : w;
  const gut = ctx.createLinearGradient(gx, 0, side === 'right' ? w * 0.18 : w * 0.82, 0);
  gut.addColorStop(0, 'rgba(110,85,55,0.32)');
  gut.addColorStop(0.35, 'rgba(110,85,55,0.08)');
  gut.addColorStop(1, 'rgba(110,85,55,0)');
  ctx.fillStyle = gut;
  ctx.fillRect(0, 0, w, h);

  const ex = side === 'right' ? w : 0;
  const edge = ctx.createLinearGradient(ex, 0, side === 'right' ? w * 0.94 : w * 0.06, 0);
  edge.addColorStop(0, 'rgba(150,120,80,0.14)');
  edge.addColorStop(1, 'rgba(150,120,80,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  for (const [y0, y1] of [[0, h * 0.03], [h, h * 0.97]]) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(150,120,80,0.12)');
    g.addColorStop(1, 'rgba(150,120,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
  }
}

// ---- typography ---------------------------------------------------------

export function wrapParagraph(ctx, text, x, y, maxW, lineH, { justify = true, indent = 0 } = {}) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = [];
  let first = true;
  for (const w of words) {
    const test = [...cur, w].join(' ');
    const avail = maxW - (first ? indent : 0);
    if (ctx.measureText(test).width > avail && cur.length) {
      lines.push({ words: cur, indent: first ? indent : 0 });
      cur = [w];
      first = false;
    } else cur.push(w);
  }
  if (cur.length) lines.push({ words: cur, indent: first ? indent : 0, last: true });

  for (const ln of lines) {
    const lx = x + ln.indent;
    const avail = maxW - ln.indent;
    if (justify && !ln.last && ln.words.length > 1) {
      const wordsW = ln.words.reduce((s, w) => s + ctx.measureText(w).width, 0);
      const gap = (avail - wordsW) / (ln.words.length - 1);
      let cx = lx;
      for (const w of ln.words) {
        ctx.fillText(w, cx, y);
        cx += ctx.measureText(w).width + gap;
      }
    } else {
      ctx.fillText(ln.words.join(' '), lx, y);
    }
    y += lineH;
  }
  return y;
}

// ---- tiny math typesetter ------------------------------------------------
// tokens: string | {frac:[a,b]} | {sqrt:a} | {sup:a} | {sub:a} | {up:'text'} (upright)
// where a/b are token arrays.

function setFont(ctx, size, italic) {
  ctx.font = `${italic ? 'italic ' : ''}400 ${size}px ${FONTS.serif}`;
}

function measure(ctx, toks, size) {
  let w = 0, asc = size * 0.72, desc = size * 0.25;
  for (const t of toks) {
    const m = metrics(ctx, t, size);
    w += m.w;
    asc = Math.max(asc, m.asc);
    desc = Math.max(desc, m.desc);
  }
  return { w, asc, desc };
}

function metrics(ctx, t, size) {
  if (typeof t === 'string') {
    setFont(ctx, size, true);
    return { w: ctx.measureText(t).width, asc: size * 0.72, desc: size * 0.25 };
  }
  if (t.up !== undefined) {
    setFont(ctx, size, false);
    return { w: ctx.measureText(t.up).width, asc: size * 0.72, desc: size * 0.25 };
  }
  if (t.frac) {
    const a = measure(ctx, t.frac[0], size * 0.85), b = measure(ctx, t.frac[1], size * 0.85);
    return { w: Math.max(a.w, b.w) + size * 0.4, asc: a.asc + a.desc + size * 0.35, desc: b.asc + b.desc + size * 0.1 - size * 0.1 + size * 0.05 };
  }
  if (t.sqrt) {
    const a = measure(ctx, t.sqrt, size);
    return { w: a.w + size * 0.75, asc: a.asc + size * 0.15, desc: a.desc };
  }
  if (t.sup) {
    const a = measure(ctx, t.sup, size * 0.62);
    return { w: a.w + size * 0.06, asc: size * 0.4 + a.asc, desc: size * 0.2 };
  }
  if (t.sub) {
    const a = measure(ctx, t.sub, size * 0.62);
    return { w: a.w + size * 0.04, asc: size * 0.6, desc: size * 0.2 + a.desc };
  }
  return { w: 0, asc: 0, desc: 0 };
}

export function drawMath(ctx, toks, x, y, size, color = PALETTE.ink) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textBaseline = 'alphabetic';
  let cx = x;
  for (const t of toks) {
    const m = metrics(ctx, t, size);
    if (typeof t === 'string') {
      setFont(ctx, size, true);
      ctx.fillText(t, cx, y);
    } else if (t.up !== undefined) {
      setFont(ctx, size, false);
      ctx.fillText(t.up, cx, y);
    } else if (t.frac) {
      const s = size * 0.85;
      const a = measure(ctx, t.frac[0], s), b = measure(ctx, t.frac[1], s);
      const barY = y - size * 0.3;
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.12, barY);
      ctx.lineTo(cx + m.w - size * 0.12, barY);
      ctx.stroke();
      drawMath(ctx, t.frac[0], cx + (m.w - a.w) / 2, barY - size * 0.18 - a.desc, s, color);
      drawMath(ctx, t.frac[1], cx + (m.w - b.w) / 2, barY + size * 0.12 + b.asc, s, color);
    } else if (t.sqrt) {
      const a = measure(ctx, t.sqrt, size);
      const top = y - a.asc - size * 0.08;
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.05, y - size * 0.3);
      ctx.lineTo(cx + size * 0.2, y - size * 0.38);
      ctx.lineTo(cx + size * 0.38, y + a.desc * 0.6);
      ctx.lineTo(cx + size * 0.6, top);
      ctx.lineTo(cx + m.w, top);
      ctx.stroke();
      drawMath(ctx, t.sqrt, cx + size * 0.68, y, size, color);
    } else if (t.sup) {
      drawMath(ctx, t.sup, cx + size * 0.04, y - size * 0.42, size * 0.62, color);
    } else if (t.sub) {
      drawMath(ctx, t.sub, cx + size * 0.02, y + size * 0.2, size * 0.62, color);
    }
    cx += m.w;
  }
  ctx.restore();
  return cx - x;
}

export function mathWidth(ctx, toks, size) {
  return measure(ctx, toks, size).w;
}

// ---- sketch strokes -------------------------------------------------------

// Draws a polyline like a pencil: two slightly jittered passes.
export function sketchPath(ctx, pts, { width = 2, color = PALETTE.ink, passes = 2, jitter = 1.2, seed = 1, alpha = 1, dash = null, close = false } = {}) {
  const r = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = alpha * (p === 0 ? 0.9 : 0.45);
    ctx.lineWidth = width * (p === 0 ? 1 : 0.7);
    const ox = (r() - 0.5) * jitter, oy = (r() - 0.5) * jitter;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + ox + (r() - 0.5) * jitter * 0.4;
      const jy = y + oy + (r() - 0.5) * jitter * 0.4;
      i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export function sketchLine(ctx, x0, y0, x1, y1, opts = {}) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 30));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  sketchPath(ctx, pts, opts);
}

export function sketchCircle(ctx, cx, cy, r, opts = {}) {
  const pts = [];
  const n = 40;
  for (let i = 0; i <= n + 2; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  sketchPath(ctx, pts, opts);
}

export function sketchArrow(ctx, x0, y0, x1, y1, opts = {}) {
  sketchLine(ctx, x0, y0, x1, y1, opts);
  const a = Math.atan2(y1 - y0, x1 - x0);
  const hl = opts.head ?? 14;
  for (const s of [-1, 1]) {
    sketchLine(ctx, x1, y1, x1 - Math.cos(a + s * 0.42) * hl, y1 - Math.sin(a + s * 0.42) * hl, { ...opts, passes: 1 });
  }
}

// Watercolor blob: layered soft translucent fills with a darker edge.
export function watercolor(ctx, pathFn, color, { alpha = 0.35, seed = 2, spread = 4 } = {}) {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate((r() - 0.5) * spread, (r() - 0.5) * spread);
    ctx.globalAlpha = alpha * (0.35 + r() * 0.3);
    ctx.fillStyle = color;
    ctx.beginPath();
    pathFn(ctx);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pathFn(ctx);
  ctx.stroke();
  ctx.restore();
}

export function handText(ctx, text, x, y, size, color = PALETTE.graphite, { align = 'left', rotate = 0, alpha = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.globalAlpha = alpha;
  ctx.font = `500 ${size}px ${FONTS.hand}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function serif(ctx, size, { italic = false, weight = 400, color = PALETTE.ink } = {}) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONTS.serif}`;
  ctx.fillStyle = color;
}
