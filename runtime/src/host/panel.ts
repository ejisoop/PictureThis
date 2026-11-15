// The paper control strip from the concept demo (viz/ui.js makePanel), rebuilt
// for the host side of the sandbox: same DOM and classes, but values travel to
// the module by postMessage and slider readouts come back formatted by it.
import gsap from 'gsap';
import type { ControlSpec } from '../protocol';
import { sanitizeLabel } from './sanitize';

export interface PanelApi {
  el: HTMLElement;
  display(key: string, text: string, value?: number | boolean): void;
  label(key: string, label: string, icon?: string): void;
}

export function renderPanel(controls: ControlSpec[], send: (key: string, value: number | boolean | null) => void): PanelApi {
  const el = document.createElement('div');
  el.className = 'panel';
  const sliders = new Map<string, { place: (v: number, animate: boolean) => void; val: HTMLElement }>();
  const buttons = new Map<string, { btn: HTMLButtonElement; state: { value: boolean } }>();
  let row: HTMLDivElement | null = null;

  for (const c of controls.slice(0, 12)) {
    if (c.type === 'slider') {
      row = null;
      const min = Number(c.min), max = Number(c.max);
      if (!(max > min)) continue;
      const r = document.createElement('div');
      r.className = 'slider';
      const ticks = (c.ticks ?? []).slice(0, 8).filter((t) => Number.isFinite(t.v) && t.v >= min && t.v <= max);
      r.innerHTML = `<div class="lbl"></div>
        <div class="track"><svg class="pencil" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M1 5 Q 25 4 50 5.5 T 99 5" /></svg>
        ${ticks.map((t) => `<span class="tick" style="left:${((t.v - min) / (max - min)) * 100}%"><i></i><b></b></span>`).join('')}
        <div class="knob"></div></div>
        <div class="val"></div>`;
      r.querySelector('.lbl')!.innerHTML = sanitizeLabel(c.label);
      r.querySelectorAll('.tick b').forEach((b, i) => ((b as HTMLElement).textContent = String(ticks[i].label).slice(0, 16)));
      el.appendChild(r);
      const track = r.querySelector<HTMLElement>('.track')!;
      const knob = r.querySelector<HTMLElement>('.knob')!;
      const val = r.querySelector<HTMLElement>('.val')!;
      val.textContent = c.display;
      const place = (v: number, animate: boolean) => {
        const p = Math.min(1, Math.max(0, (v - min) / (max - min)));
        gsap.to(knob, { left: `${p * 100}%`, duration: animate ? 0.45 : 0.08, ease: animate ? 'elastic.out(1,0.6)' : 'none' });
      };
      const setFromX = (clientX: number) => {
        const b = track.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (clientX - b.left) / b.width));
        let v = min + p * (max - min);
        if (c.step) v = Math.round(v / c.step) * c.step;
        if (c.snap) for (const t of ticks) if (Math.abs(v - t.v) < c.snap) v = t.v;
        v = Math.min(max, Math.max(min, v));
        place(v, false);
        send(c.key, v);
      };
      track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        track.setPointerCapture(e.pointerId);
        r.classList.add('active');
        setFromX(e.clientX);
        const mv = (ev: PointerEvent) => setFromX(ev.clientX);
        const up = () => {
          r.classList.remove('active');
          track.removeEventListener('pointermove', mv);
          track.removeEventListener('pointerup', up);
          track.removeEventListener('pointercancel', up);
        };
        track.addEventListener('pointermove', mv);
        track.addEventListener('pointerup', up);
        track.addEventListener('pointercancel', up);
      });
      place(c.value, true);
      sliders.set(c.key, { place, val });
    } else {
      if (!row) {
        row = document.createElement('div');
        row.className = 'btn-row';
        el.appendChild(row);
      }
      const btn = document.createElement('button');
      btn.className = 'pbtn' + (c.type === 'toggle' ? ' toggle' : '');
      const state = { value: c.type === 'toggle' ? !!c.value : false };
      const setLabel = (label: string, icon?: string) => {
        btn.innerHTML = `<span class="ico"></span><span></span>`;
        (btn.firstChild as HTMLElement).textContent = (icon ?? '').slice(0, 3);
        (btn.lastChild as HTMLElement).innerHTML = sanitizeLabel(label);
      };
      setLabel(c.label, c.icon);
      if (state.value) btn.classList.add('on');
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        gsap.fromTo(btn, { scale: 0.9 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.5)' });
        if (c.type === 'toggle') {
          state.value = !state.value;
          btn.classList.toggle('on', state.value);
          send(c.key, state.value);
        } else send(c.key, null);
      });
      row.appendChild(btn);
      buttons.set(c.key, { btn, state });
      buttons.get(c.key)!.btn.dataset.key = c.key;
      (buttons.get(c.key) as any).setLabel = setLabel;
    }
  }

  return {
    el,
    display(key, text, value) {
      const s = sliders.get(key);
      if (s) {
        s.val.textContent = String(text).slice(0, 40);
        if (typeof value === 'number' && Number.isFinite(value)) s.place(value, true);
      }
      const b = buttons.get(key);
      if (b && typeof value === 'boolean') {
        b.state.value = value;
        b.btn.classList.toggle('on', value);
      }
    },
    label(key, label, icon) {
      const b = buttons.get(key) as any;
      b?.setLabel(label, icon);
    },
  };
}
