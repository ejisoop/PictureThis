// Minimal spatial UI: handwritten floating notes, paper control strips,
// the illustrated hand cursor and the intro hint.
import gsap from 'gsap';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// ---- handwritten notes anchored in 3D -------------------------------------
export function makeNote(html, { cls = '', anchor = 'center' } = {}) {
  const el = document.createElement('div');
  el.className = `note ${cls} anchor-${anchor}`;
  el.innerHTML = `<span class="ink">${html}</span>`;
  const obj = new CSS2DObject(el);
  if (anchor === 'left') obj.center.set(0, 0.5);
  obj.userData.ink = el.firstChild;
  el.style.opacity = '0';
  obj.reveal = (delay = 0, dur = 0.7) => {
    gsap.killTweensOf([el, el.firstChild]);
    gsap.set(el, { opacity: 1 });
    return gsap.fromTo(el.firstChild, { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% 0% -20% 0)', duration: dur, delay, ease: 'power2.inOut' });
  };
  obj.hide = (delay = 0) => gsap.to(el, { opacity: 0, duration: 0.35, delay });
  obj.set = (h) => {
    if (obj.userData.last !== h) {
      el.firstChild.innerHTML = h;
      obj.userData.last = h;
    }
  };
  return obj;
}

// ---- paper control strip ----------------------------------------------------
export function makePanel(title, controls) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = `<div class="panel-tab">${title}</div>`;
  const api = {};
  for (const c of controls) {
    if (c.type === 'slider') {
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = `<div class="lbl">${c.label}</div>
        <div class="track"><svg class="pencil" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M1 5 Q 25 4 50 5.5 T 99 5" /></svg>
        ${(c.ticks || []).map((t) => `<span class="tick" style="left:${((t.v - c.min) / (c.max - c.min)) * 100}%"><i></i>${t.label}</span>`).join('')}
        <div class="knob"></div></div>
        <div class="val"></div>`;
      el.appendChild(row);
      const track = row.querySelector('.track');
      const knob = row.querySelector('.knob');
      const val = row.querySelector('.val');
      let value = c.value;
      const fmt = c.format || ((v) => v.toFixed(2));
      const place = (v, animate) => {
        const p = (v - c.min) / (c.max - c.min);
        gsap.to(knob, { left: `${p * 100}%`, duration: animate ? 0.45 : 0.08, ease: animate ? 'elastic.out(1,0.6)' : 'none' });
        val.textContent = fmt(v);
      };
      const setFromX = (clientX) => {
        const r = track.getBoundingClientRect();
        let p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        let v = c.min + p * (c.max - c.min);
        if (c.step) v = Math.round(v / c.step) * c.step;
        if (c.snap) for (const t of c.ticks || []) if (Math.abs(v - t.v) < c.snap) v = t.v;
        value = v;
        place(v, false);
        c.onChange(v);
      };
      track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        track.setPointerCapture(e.pointerId);
        row.classList.add('active');
        document.body.classList.add('pinching');
        setFromX(e.clientX);
        const mv = (ev) => setFromX(ev.clientX);
        const up = () => {
          row.classList.remove('active');
          document.body.classList.remove('pinching');
          track.removeEventListener('pointermove', mv);
          track.removeEventListener('pointerup', up);
          track.removeEventListener('pointercancel', up);
        };
        track.addEventListener('pointermove', mv);
        track.addEventListener('pointerup', up);
        track.addEventListener('pointercancel', up);
      });
      place(value, true);
      api[c.key] = { set: (v) => { value = v; place(v, true); }, get: () => value };
    } else if (c.type === 'buttons') {
      const row = document.createElement('div');
      row.className = 'btn-row';
      for (const b of c.items) {
        const btn = document.createElement('button');
        btn.className = 'pbtn' + (b.toggle ? ' toggle' : '');
        btn.innerHTML = `<span class="ico">${b.icon || ''}</span><span>${b.label}</span>`;
        if (b.toggle && b.value) btn.classList.add('on');
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          gsap.fromTo(btn, { scale: 0.9 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.5)' });
          if (b.toggle) {
            b.value = !b.value;
            btn.classList.toggle('on', b.value);
            b.onChange(b.value, btn);
          } else b.onClick(btn);
        });
        row.appendChild(btn);
        if (b.key) api[b.key] = { el: btn, set: (v, lbl) => { if (b.toggle) { b.value = v; btn.classList.toggle('on', v); } if (lbl) btn.innerHTML = lbl; } };
      }
      el.appendChild(row);
    } else if (c.type === 'hint') {
      const p = document.createElement('div');
      p.className = 'panel-hint';
      p.innerHTML = c.text;
      el.appendChild(p);
    }
  }
  el.style.opacity = '0';
  const wrap = document.createElement('div');
  wrap.className = 'panel-wrap';
  wrap.appendChild(el);
  const obj = new CSS2DObject(wrap);
  obj.center.set(0, 0.5);
  obj.panelEl = el;
  obj.api = api;
  obj.reveal = (delay = 0) => {
    gsap.set(el, { opacity: 1 });
    const kids = el.children;
    gsap.fromTo(el, { rotate: -4, y: 30, clipPath: 'inset(0 0 100% 0)' }, { rotate: -1.2, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.9, delay, ease: 'power3.out' });
    gsap.fromTo(kids, { opacity: 0, x: -10 }, { opacity: 1, x: 0, stagger: 0.07, delay: delay + 0.25, duration: 0.5 });
  };
  obj.hide = () => gsap.to(el, { opacity: 0, y: 20, duration: 0.35 });
  return obj;
}

// ---- illustrated hand cursor (simulated hand tracking) ---------------------
const HAND_SVG = `
<svg viewBox="0 0 130 130" width="104" height="104">
  <defs><filter id="rough"><feTurbulence baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter></defs>
  <g class="pose open" filter="url(#rough)">
    <path class="o" d="M62 118 C 58 100, 66 86, 78 80 C 92 74, 104 86, 106 100 C 108 112, 100 122, 88 124 Z"/>
    <path class="f" d="M70 84 L 40 26"/><path class="f" d="M84 82 L 74 54"/><path class="f" d="M95 86 L 90 62"/><path class="f" d="M103 94 L 104 74"/>
    <path class="f" d="M66 104 C 52 98, 38 84, 24 62"/>
    <path class="o fill" d="M62 118 C 58 100, 66 86, 78 80 C 92 74, 104 86, 106 100 C 108 112, 100 122, 88 124 Z"/>
  </g>
  <g class="pose pinch" filter="url(#rough)">
    <path class="f" d="M70 84 C 52 62, 40 48, 30 40"/><path class="f" d="M84 82 L 76 58"/><path class="f" d="M95 86 L 90 64"/><path class="f" d="M103 94 L 104 76"/>
    <path class="f" d="M66 104 C 50 94, 38 74, 30 46"/>
    <path class="o fill" d="M62 118 C 58 100, 66 86, 78 80 C 92 74, 104 86, 106 100 C 108 112, 100 122, 88 124 Z"/>
  </g>
</svg>`;

export function createHandCursor() {
  const root = document.createElement('div');
  root.id = 'hand';
  root.innerHTML = `<div class="ring"></div><div class="spark"></div><div class="hand-art">${HAND_SVG}</div>`;
  document.body.appendChild(root);
  const ring = root.querySelector('.ring');
  const spark = root.querySelector('.spark');
  const art = root.querySelector('.hand-art');
  const xTo = gsap.quickTo(root, 'x', { duration: 0.12, ease: 'power3' });
  const yTo = gsap.quickTo(root, 'y', { duration: 0.12, ease: 'power3' });
  let state = 'idle';
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    root.style.display = 'block';
    xTo(e.clientX);
    yTo(e.clientY);
  });
  document.addEventListener('pointerleave', () => (root.style.display = 'none'));
  const api = {
    setHover(on, kind = '') {
      root.classList.toggle('hover', on);
      root.dataset.kind = kind;
    },
    pinch(on) {
      if (state === (on ? 'pinch' : 'idle')) return;
      state = on ? 'pinch' : 'idle';
      root.classList.toggle('pinching', on);
      gsap.to(ring, { scale: on ? 0.45 : 1, duration: 0.25, ease: 'back.out(3)' });
      gsap.to(art, { rotate: on ? -6 : 0, x: on ? -2 : 0, y: on ? -2 : 0, duration: 0.25 });
      if (on) gsap.fromTo(spark, { scale: 0.2, opacity: 0.9 }, { scale: 1.8, opacity: 0, duration: 0.5, ease: 'power2.out' });
    },
  };
  return api;
}
