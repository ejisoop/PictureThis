// Choreography presets: the demo's "draw on → gain depth → lift" sequence,
// packaged so generated code gets the same motion without timing it by hand.
// Each preset wraps `content` and returns { enter(tl, at), exit(tl, at) };
// both return the time (on tl) at which their motion ends.
import * as THREE from 'three';
import type gsap from 'gsap';
// @ts-ignore — v1 JS
import { setTreeOpacity } from './sketch.js';

export type Anchor = [number, number];
export interface Preset {
  group: THREE.Group;
  inner: THREE.Group;
  state: Record<string, number>;
  apply(): void;
  enter(tl: gsap.core.Timeline, at?: number): number;
  exit(tl: gsap.core.Timeline, at?: number): number;
}

/** ink tubes in a tree: drawn on with the rest of the content */
function inkIn(obj: THREE.Object3D) {
  const out: THREE.ShaderMaterial[] = [];
  obj.traverse((o: any) => {
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uProgress && o.userData.drawOn !== false) out.push(m);
  });
  return out;
}

function opacityAndInk(inner: THREE.Object3D, draw: number) {
  setTreeOpacity(inner, Math.min(1, draw * 1.4));
  for (const m of inkIn(inner)) m.uniforms.uProgress.value = draw;
}

function place(parent: THREE.Object3D, child: THREE.Object3D, at: Anchor) {
  child.position.set(at[0], 0.004, at[1]);
  parent.add(child);
}

/**
 * Pop-up-book fold. `content` is authored standing up: x right, y up off the
 * page, z toward the reader. It starts lying flat over the printed drawing
 * with its base on the hinge line at `at` (parent coords, x/z), and pops up.
 */
export function popUp(content: THREE.Object3D, o: { parent: THREE.Object3D; at?: Anchor; lean?: number }): Preset {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  inner.add(content);
  place(o.parent, group, o.at ?? [0, 0]);
  const y0 = group.position.y;
  const lean = o.lean ?? 0.06;
  const state = { draw: 0, depth: 0, lift: 0 };
  const apply = () => {
    group.rotation.x = -Math.PI / 2 + (Math.PI / 2 - lean) * state.lift;
    inner.scale.z = 0.02 + 0.98 * state.depth;
    group.position.y = y0 + 0.02 * state.depth;
    opacityAndInk(inner, state.draw);
  };
  group.visible = false;
  apply();
  const u = { onUpdate: apply };
  return {
    group, inner, state, apply,
    enter(tl, at = 0) {
      tl.add(() => { group.visible = true; }, at);
      tl.to(state, { draw: 1, duration: 0.9, ease: 'power1.inOut', ...u }, at);
      tl.to(state, { depth: 1, duration: 0.6, ease: 'power2.out', ...u }, at + 0.7);
      tl.to(state, { lift: 1, duration: 1.2, ease: 'back.out(1.6)', ...u }, at + 1.0);
      return at + 2.2;
    },
    exit(tl, at = 0) {
      tl.to(state, { lift: 0, duration: 0.8, ease: 'power2.in', ...u }, at + 0.2);
      tl.to(state, { depth: 0, duration: 0.4, ease: 'power2.in', ...u }, at + 0.9);
      tl.to(state, { draw: 0, duration: 0.5, ...u }, at + 1.2);
      tl.add(() => { group.visible = false; }, at + 1.75);
      return at + 1.75;
    },
  };
}

/**
 * Rises straight up out of the page. `content` is authored in page space:
 * x right, y up off the page, z down the page, origin at `at`.
 * `height` lifts the whole thing above the paper once risen.
 */
export function riseFromPage(content: THREE.Object3D, o: { parent: THREE.Object3D; at?: Anchor; height?: number }): Preset {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  inner.add(content);
  place(o.parent, group, o.at ?? [0, 0]);
  const y0 = group.position.y;
  const state = { draw: 0, rise: 0 };
  const apply = () => {
    inner.scale.y = 0.02 + 0.98 * state.rise;
    group.position.y = y0 + (o.height ?? 0) * state.rise;
    opacityAndInk(inner, state.draw);
  };
  group.visible = false;
  apply();
  const u = { onUpdate: apply };
  return {
    group, inner, state, apply,
    enter(tl, at = 0) {
      tl.add(() => { group.visible = true; }, at);
      tl.to(state, { draw: 1, duration: 0.9, ease: 'power1.inOut', ...u }, at);
      tl.to(state, { rise: 1, duration: 1.3, ease: 'back.out(1.4)', ...u }, at + 0.75);
      return at + 2.05;
    },
    exit(tl, at = 0) {
      tl.to(state, { rise: 0, duration: 0.8, ease: 'power2.in', ...u }, at + 0.1);
      tl.to(state, { draw: 0, duration: 0.5, ...u }, at + 0.8);
      tl.add(() => { group.visible = false; }, at + 1.3);
      return at + 1.3;
    },
  };
}

/**
 * Unfolds from its centre line like a pop-up spread: starts flat and
 * squeezed along x, opens out while standing up. Authored like popUp.
 */
export function unfold(content: THREE.Object3D, o: { parent: THREE.Object3D; at?: Anchor; lean?: number }): Preset {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  inner.add(content);
  place(o.parent, group, o.at ?? [0, 0]);
  const lean = o.lean ?? 0.1;
  const state = { draw: 0, open: 0, lift: 0 };
  const apply = () => {
    group.rotation.x = -Math.PI / 2 + (Math.PI / 2 - lean) * state.lift;
    inner.scale.x = 0.08 + 0.92 * state.open;
    inner.scale.z = 0.02 + 0.98 * state.open;
    opacityAndInk(inner, state.draw);
  };
  group.visible = false;
  apply();
  const u = { onUpdate: apply };
  return {
    group, inner, state, apply,
    enter(tl, at = 0) {
      tl.add(() => { group.visible = true; }, at);
      tl.to(state, { draw: 1, duration: 0.7, ease: 'power1.inOut', ...u }, at);
      tl.to(state, { lift: 1, duration: 1.1, ease: 'back.out(1.5)', ...u }, at + 0.5);
      tl.to(state, { open: 1, duration: 1.1, ease: 'elastic.out(1,0.75)', ...u }, at + 0.8);
      return at + 2.0;
    },
    exit(tl, at = 0) {
      tl.to(state, { open: 0, duration: 0.6, ease: 'power2.in', ...u }, at);
      tl.to(state, { lift: 0, duration: 0.7, ease: 'power2.in', ...u }, at + 0.4);
      tl.to(state, { draw: 0, duration: 0.4, ...u }, at + 1.0);
      tl.add(() => { group.visible = false; }, at + 1.4);
      return at + 1.4;
    },
  };
}

/** Draws ink lines on one after another (uProgress 0 → 1). */
export function drawOn(lines: THREE.Object3D[], o: { stagger?: number; duration?: number } = {}) {
  const mats = lines.flatMap((l) => inkIn(l));
  const st = o.stagger ?? 0.12, d = o.duration ?? 0.9;
  for (const m of mats) m.uniforms.uProgress.value = 0;
  lines.forEach((l) => l.traverse((x) => (x.userData.drawOn = false)));
  return {
    enter(tl: gsap.core.Timeline, at = 0) {
      mats.forEach((m, i) => tl.fromTo(m.uniforms.uProgress, { value: 0 }, { value: 1, duration: d, ease: 'power1.inOut' }, at + i * st));
      return at + d + Math.max(0, mats.length - 1) * st;
    },
    exit(tl: gsap.core.Timeline, at = 0) {
      mats.forEach((m) => tl.to(m.uniforms.uProgress, { value: 0, duration: 0.5, ease: 'power1.in' }, at));
      return at + 0.5;
    },
  };
}
