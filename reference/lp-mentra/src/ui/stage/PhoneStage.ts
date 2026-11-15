// The phone's 3D stage: the student's flattened page photo lying flat, with
// the matching visualization lifting off it. Touch-first controls.
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
// @ts-ignore — v1 JS modules
import { PAGE_W, PAGE_H } from '../../viz/book.js';
// @ts-ignore
import { lineMaterials } from '../../viz/sketch.js';
// @ts-ignore
import { makePanel } from '../../viz/ui.js';
import type { Detection } from '../../shared/types';
import { chapterFor, chapterTextures } from './chapters';

const PAPER = new THREE.Color('#f7f0e1');

export interface StageEvents {
  onEntered?: () => void;
  onExited?: () => void;
  onPanel?: (el: HTMLElement | null, title: string) => void;
}

export class PhoneStage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 0.5, 0.05, 50);
  css = new CSS2DRenderer();
  controls: OrbitControls;
  anchor: { group: THREE.Group; point: (x: number, z: number, lift?: number) => THREE.Vector3; bounds: { x0: number; x1: number; z0: number; z1: number } };
  viz: any = null;
  panel: any = null;
  active = false;
  busy = false;
  private page: THREE.Mesh;
  private U: Record<string, THREE.IUniform>;
  private raf = 0;
  private timer = new THREE.Timer();
  private ray = new THREE.Raycaster();
  private drag: any = null;
  private hovered: any = null;
  private lastTap = 0;
  private photoTex: THREE.Texture | null = null;
  detection: Detection | null = null;
  /** fraction of the screen the bottom sheet covers: content is shifted up by half of it */
  viewShift = { v: 0 };
  private marginEl: HTMLDivElement;

  constructor(private host: HTMLElement, private events: StageEvents = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.css.domElement.className = 'stage-css';
    host.appendChild(this.css.domElement);
    this.marginEl = document.createElement('div');
    this.marginEl.className = 'margin-notes';
    host.appendChild(this.marginEl);

    this.scene.add(new THREE.HemisphereLight('#fff8ec', '#c9b9a0', 1.5));
    const sun = new THREE.DirectionalLight('#fff1dc', 1.9);
    sun.position.set(-2.2, 6.5, 3.2);
    sun.target.position.set(PAGE_W / 2, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 14 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.01;
    this.scene.add(sun, sun.target);

    // the page photo
    const group = new THREE.Group();
    this.scene.add(group);
    this.anchor = {
      group,
      point: (x, z, lift = 0) => new THREE.Vector3(x, 0.003 + lift, z),
      bounds: { x0: 0, x1: PAGE_W, z0: -PAGE_H / 2, z1: PAGE_H / 2 },
    };
    const { mat, uniforms } = this.pageMaterial();
    this.U = uniforms;
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H).rotateX(-Math.PI / 2).translate(PAGE_W / 2, 0, 0), mat);
    this.page.receiveShadow = true;
    group.add(this.page);
    // a soft card shadow under the photo
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W + 0.25, PAGE_H + 0.25).rotateX(-Math.PI / 2).translate(PAGE_W / 2 + 0.04, -0.01, 0.05), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.08 }));
    group.add(sh);

    this.ray.params.Line = { threshold: 0.01 };
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = 1.25;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.enabled = false;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setView('photo', 0);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  private pageMaterial() {
    const uniforms: Record<string, THREE.IUniform> = {
      uDiagRect: { value: new THREE.Vector4() },
      uDiagColor: { value: null },
      uDiagGhost: { value: null },
      uColorMix: { value: 0 },
      uWipe: { value: 0 },
      uGhost: { value: 0 },
      uGlow: { value: 0 },
      uMarks: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uTime: { value: 0 },
      uReveal: { value: 0 },
    };
    const blank = new THREE.DataTexture(new Uint8Array([247, 240, 225, 255]), 1, 1);
    blank.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#2c2620', transparent: true, map: blank });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec4 uDiagRect; uniform sampler2D uDiagColor, uDiagGhost;
          uniform float uColorMix, uWipe, uGhost, uGlow, uMarks, uTime, uReveal; uniform vec3 uTint;`)
        .replace('#include <map_fragment>', `
          vec4 texel = texture2D(map, vMapUv);
          vec2 duv = (vMapUv - uDiagRect.xy) / uDiagRect.zw;
          if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0 && uDiagRect.z > 0.0) {
            float aspect = uDiagRect.z / uDiagRect.w * ${(PAGE_W / PAGE_H).toFixed(4)};
            vec2 c = (duv - 0.5) * vec2(aspect, 1.0);
            float r = length(c);
            float n = fract(sin(dot(floor(duv*90.0), vec2(12.9898,78.233)))*43758.5453);
            float wipe = smoothstep(uWipe, uWipe - 0.12, r + n*0.04);
            // printed-page variants, toned to match the photo's paper
            vec3 col = texture2D(uDiagColor, duv).rgb * uTint;
            texel.rgb = mix(texel.rgb, col, wipe * uColorMix * 0.92);
            vec3 gh = texture2D(uDiagGhost, duv).rgb * uTint;
            texel.rgb = mix(texel.rgb, gh, uGhost);
            texel.rgb += vec3(1.0, 0.82, 0.55) * (uGlow * 0.14 * smoothstep(0.62, 0.2, r));
            float bx = min(min(duv.x, 1.0-duv.x), min(duv.y, 1.0-duv.y));
            float corner = (1.0 - smoothstep(0.0, 0.01, abs(bx - 0.01))) * step(0.82, min(abs(duv.x-0.5), abs(duv.y-0.5))*2.0);
            texel.rgb = mix(texel.rgb, vec3(0.79, 0.42, 0.35), corner * uMarks);
          }
          diffuseColor *= texel;
          diffuseColor.a *= uReveal;
        `);
    };
    return { mat, uniforms };
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.css.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.applyShift();
    if (!this.active) this.setView('photo', 0);
  }

  private applyShift() {
    const r = this.host.getBoundingClientRect();
    if (this.viewShift.v > 0.001) this.camera.setViewOffset(r.width, r.height, 0, r.height * this.viewShift.v, r.width, r.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** camera presets: flat scan (photo) or a 3/4 view for exploring */
  private viewParams(kind: 'photo' | 'explore') {
    const a = this.camera.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    if (kind === 'photo') {
      // fit the page top-down with a small margin
      const dh = (PAGE_H * 0.54) / tanH;
      const dw = (PAGE_W * 0.54) / (tanH * a);
      return { target: new THREE.Vector3(PAGE_W / 2, 0, 0), dist: Math.max(dh, dw), polar: 0.0001, az: 0 };
    }
    const dw = (PAGE_W * 0.62) / (tanH * a);
    const vp = this.viz?.phoneView;
    return { target: new THREE.Vector3(PAGE_W / 2, vp?.y ?? 0.35, vp?.z ?? -0.25), dist: Math.max(4.2, dw * (vp?.zoom ?? 1)), polar: vp?.polar ?? 0.9, az: vp?.az ?? 0.15 };
  }

  setView(kind: 'photo' | 'explore', duration = 1.4) {
    const v = this.viewParams(kind);
    const to = new THREE.Vector3().setFromSpherical(new THREE.Spherical(v.dist, v.polar, v.az)).add(v.target);
    if (!duration) {
      this.camera.position.copy(to);
      this.controls.target.copy(v.target);
      this.camera.lookAt(v.target);
      return;
    }
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const t0 = this.controls.target.clone();
    const st = { k: 0 };
    gsap.to(st, {
      k: 1,
      duration,
      ease: 'power3.inOut',
      onUpdate: () => {
        const t = t0.clone().lerp(v.target, st.k);
        const s = new THREE.Spherical(THREE.MathUtils.lerp(s0.radius, v.dist, st.k), THREE.MathUtils.lerp(s0.phi, v.polar, st.k), THREE.MathUtils.lerp(s0.theta, v.az, st.k));
        this.controls.target.copy(t);
        this.camera.position.copy(new THREE.Vector3().setFromSpherical(s).add(t));
        this.camera.lookAt(t);
      },
    });
  }

  resetView() {
    this.setView(this.active ? 'explore' : 'photo', 0.9);
  }

  /** load a detection: the flattened page photo + the chapter's figure variants */
  async load(det: Detection) {
    this.clearViz();
    this.detection = det;
    const tex = await new THREE.TextureLoader().loadAsync(det.scanUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.photoTex?.dispose();
    this.photoTex = tex;
    const m = this.page.material as THREE.MeshLambertMaterial;
    m.map = tex;
    m.needsUpdate = true;
    const ch = chapterFor(det.renderPlan.vizId);
    const t = chapterTextures(ch);
    this.U.uDiagRect.value.copy(t.rect);
    this.U.uDiagColor.value = t.colored;
    this.U.uDiagGhost.value = t.ghost;
    const [r, g, b] = det.paperTone;
    this.U.uTint.value.set(Math.min(1.1, r / PAPER.r), Math.min(1.1, g / PAPER.g), Math.min(1.1, b / PAPER.b));
    for (const k of ['uColorMix', 'uWipe', 'uGhost', 'uGlow', 'uMarks']) this.U[k].value = 0;
    this.viz = ch.createViz({
      anchor: this.anchor,
      params: det.renderPlan.params,
      setPlayLabel: (paused: boolean) => this.panel?.api.play?.set(null, `<span class="ico">${paused ? '▶' : '❚❚'}</span><span>${paused ? 'play' : 'pause'}</span>`),
      setClimbLabel: (on: boolean) => this.panel?.api.climb?.set(null, `<span class="ico">${on ? '■' : '⛰'}</span><span>${on ? 'stop' : 'climb ∇f'}</span>`),
    });
    this.setView('photo', 0);
  }

  /** photo fades in, corner marks find the figure */
  async showPhoto() {
    this.U.uReveal.value = 0;
    await gsap.to(this.U.uReveal, { value: 1, duration: 0.7, ease: 'power2.out' });
    await gsap.to(this.U.uMarks, { value: 1, duration: 0.5, ease: 'power2.out' });
  }

  /** the hero moment: colour wash → drawing traces itself → lifts off the photo */
  activate() {
    if (this.active || this.busy || !this.viz) return Promise.resolve();
    this.busy = true;
    this.active = true;
    const U = this.U;
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.busy = false;
          this.controls.enabled = true;
          this.events.onEntered?.();
          resolve();
        },
      });
      tl.to(U.uGlow, { value: 1, duration: 0.5, ease: 'sine.out' }, 0);
      tl.set(U.uColorMix, { value: 1 }, 0);
      tl.fromTo(U.uWipe, { value: 0 }, { value: 1.3, duration: 1.1, ease: 'power2.inOut' }, 0.1);
      tl.to(U.uMarks, { value: 0, duration: 0.6 }, 0.9);
      const t = this.viz.enter(tl, 0.55);
      tl.to(U.uGhost, { value: 1, duration: 0.7, ease: 'power2.inOut' }, 1.25);
      tl.to(U.uGlow, { value: 0.2, duration: 1.0 }, 1.4);
      tl.add(() => this.setView('explore', 2.0), 0.6);
      tl.to(this.viewShift, { v: 0.16, duration: 2.0, ease: 'power3.inOut', onUpdate: () => this.applyShift() }, 0.6);
      this.panel = makePanel('', this.viz.controls);
      this.viz.panel = this.panel;
      tl.add(() => {
        this.events.onPanel?.(this.panel.panelEl, '');
        this.panel.reveal(0);
      }, t);
    });
  }

  deactivate() {
    if (!this.active || this.busy) return Promise.resolve();
    this.busy = true;
    this.controls.enabled = false;
    this.panel?.hide();
    const U = this.U;
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.active = false;
          this.busy = false;
          this.events.onPanel?.(null, '');
          this.events.onExited?.();
          resolve();
        },
      });
      const t = this.viz.exit(tl, 0);
      tl.to(U.uGhost, { value: 0, duration: 0.6, ease: 'power2.inOut' }, t - 0.4);
      tl.to(U.uWipe, { value: 0, duration: 0.8, ease: 'power2.inOut' }, t);
      tl.to(U.uGlow, { value: 0, duration: 0.6 }, t + 0.2);
      this.setView('photo', 1.8);
      gsap.to(this.viewShift, { v: 0, duration: 1.8, ease: 'power3.inOut', onUpdate: () => this.applyShift() });
    });
  }

  clearViz() {
    gsap.killTweensOf(this.U.uReveal);
    if (this.viz) {
      this.viz.dispose();
      this.viz = null;
    }
    this.events.onPanel?.(null, '');
    this.panel = null;
    this.active = false;
    this.busy = false;
    this.controls.enabled = false;
    this.drag = null;
    this.viewShift.v = 0;
    this.applyShift();
  }

  // ---- input --------------------------------------------------------------
  private setRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
  }
  private pick() {
    if (!this.active || !this.viz) return null;
    const objs = this.viz.interactives.map((i: any) => i.object);
    const hit = this.ray.intersectObjects(objs, false)[0];
    return hit ? { item: this.viz.interactives.find((i: any) => i.object === hit.object), hit } : null;
  }
  private onDown(e: PointerEvent) {
    const now = performance.now();
    if (now - this.lastTap < 300) this.resetView();
    this.lastTap = now;
    this.setRay(e);
    const p = this.pick();
    if (!p) return;
    this.controls.enabled = false; // veto the orbit for this gesture
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.drag = p.item;
    p.item.onDown?.(p.hit, this.ray.ray);
    this.host.dispatchEvent(new CustomEvent('lp-touch', { bubbles: true, detail: { kind: 'grab' } }));
  }
  private onMove(e: PointerEvent) {
    this.setRay(e);
    if (this.drag) {
      this.drag.onDrag?.(this.ray.ray, e);
      return;
    }
    if (e.pointerType === 'mouse') {
      const p = this.pick();
      const item = p?.item ?? null;
      if (item !== this.hovered) {
        this.hovered?.onHover?.(false);
        item?.onHover?.(true);
        this.hovered = item;
      }
    }
  }
  private onUp(e: PointerEvent) {
    if (!this.drag) return;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    this.drag.onUp?.();
    this.drag = null;
    this.controls.enabled = this.active;
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.U.uTime.value += dt;
    this.viz?.update(dt);
    const mn: any[] = this.viz?.marginNotes ?? [];
    if (mn.length) {
      mn.forEach((n) => (n.visible = false));
      const html = mn.map((n) => `<div class="${n.element.className.replace('note', 'mnote')}">${n.userData.last ?? n.userData.ink.innerHTML}</div>`).join('');
      if (html !== this.marginEl.dataset.html) {
        this.marginEl.innerHTML = html;
        this.marginEl.dataset.html = html;
      }
    }
    this.marginEl.classList.toggle('show', this.active && !this.busy);
    this.controls.update();
    const res = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(res);
    for (const m of lineMaterials) m.resolution.copy(res);
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clearViz();
    this.photoTex?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css.domElement.remove();
  }
}
