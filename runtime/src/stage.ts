// The sandboxed 3D stage: the student's page photo, flattened onto a sheet of
// paper lying in the scene, with the generated visualization lifting off it.
// Ported from the concept demo's PhoneStage. The printed-figure "colour wash"
// and "ghost" variants are now derived from the photo in the page shader
// instead of being drawn by hand for each chapter.
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
// @ts-ignore — v1 JS
import { lineMaterials } from './sketch.js';
import { squareToQuad, quadAspect, type Quad } from './geom';
import type { NormBox } from './protocol';

export const PAGE_H = 2.8;

export interface Interactive {
  object: THREE.Object3D;
  onDown?: (hit: THREE.Intersection, ray: THREE.Ray) => void;
  onDrag?: (ray: THREE.Ray, e: PointerEvent) => void;
  onUp?: () => void;
  onHover?: (on: boolean) => void;
}

export interface ViewHint {
  /** height of the camera target above the page, in figure heights */
  lift?: number;
  polar?: number;
  azimuth?: number;
  /** >1 = further away */
  zoom?: number;
}

export interface StageHooks {
  onError: (phase: 'enter' | 'exit' | 'update' | 'runtime', e: unknown) => void;
  onState: (s: 'photo' | 'lifting' | 'interactive' | 'folding') => void;
  onTouch: (kind: 'grab' | 'orbit') => void;
}

export interface StageViz {
  root: THREE.Object3D;
  enter(tl: gsap.core.Timeline): void;
  exit(tl: gsap.core.Timeline): void;
  update(dt: number, t: number): void;
  dispose(): void;
  view?: ViewHint;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 0.5, 0.05, 60);
  css = new CSS2DRenderer();
  controls: OrbitControls;
  pageGroup = new THREE.Group();
  /** page size in world units: x ∈ [0, W], z ∈ [−H/2, H/2] */
  W = PAGE_H * 0.75;
  H = PAGE_H;
  figure: NormBox = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.6 };
  viz: StageViz | null = null;
  interactives: Interactive[] = [];
  active = false;
  busy = false;
  time = 0;
  frozen = false; // set by the test harness to drive frames manually
  updateFailures = 0;
  marginEl: HTMLDivElement;
  ghostNote: HTMLDivElement;
  private page: THREE.Mesh;
  private shadow: THREE.Mesh;
  U: Record<string, THREE.IUniform>;
  private raf = 0;
  private ray = new THREE.Raycaster();
  private drag: Interactive | null = null;
  private hovered: Interactive | null = null;
  private lastTap = 0;
  private photoTex: THREE.Texture | null = null;
  viewShift = { v: 0 };
  /** keep-above-the-paper: how far the model is raised so nothing sinks into the (opaque) page */
  lift = { target: 0, value: 0, acc: 0, below: 0 };
  private liftBox = new THREE.Box3();
  sheetShift = 0.16;
  /** screen px covered by the phone UI: header above, controls sheet below */
  insets = { top: 92, bottom: 330 };
  private last = performance.now();
  private statsAcc = { n: 0, ms: 0, t0: performance.now() };

  constructor(private host: HTMLElement, private hooks: StageHooks, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
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
    this.ghostNote = document.createElement('div');
    this.ghostNote.className = 'ghost-note';
    this.ghostNote.textContent = '↑ lifted from the page';
    host.appendChild(this.ghostNote);

    this.scene.add(new THREE.HemisphereLight('#fff8ec', '#c9b9a0', 1.5));
    const sun = new THREE.DirectionalLight('#fff1dc', 1.9);
    sun.position.set(-2.2, 6.5, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 14 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.01;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.scene.add(this.pageGroup);
    const { mat, uniforms } = this.pageMaterial();
    this.U = uniforms;
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0), mat);
    this.page.receiveShadow = true;
    this.pageGroup.add(this.page);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.08 }));
    this.pageGroup.add(this.shadow);
    this.setPageSize(this.W / this.H);

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
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = 1.25;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => this.hooks.onTouch('orbit'));

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setView('photo', 0);
  }
  private sun: THREE.DirectionalLight;

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.frozen) return;
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.frame(dt);
    };
    loop();
  }

  // ---- page --------------------------------------------------------------
  setPageSize(aspect: number) {
    this.H = PAGE_H;
    this.W = PAGE_H * Math.min(1.6, Math.max(0.4, aspect));
    this.page.scale.set(this.W, 1, this.H);
    this.shadow.scale.set(this.W + 0.25, 1, this.H + 0.25);
    this.shadow.position.set(-0.125 + 0.04, -0.01, 0.05);
    this.sun.target.position.set(this.W / 2, 0, 0);
  }

  /** world point on the page; x from the left edge, z from the top (−H/2) */
  point(x: number, z: number, lift = 0) {
    return new THREE.Vector3(x, 0.003 + lift, z);
  }
  /** normalised page (u right, v down) → world */
  uv(u: number, v: number, lift = 0) {
    return this.point(u * this.W, (v - 0.5) * this.H, lift);
  }
  figureWorld() {
    const f = this.figure;
    const x0 = f.x0 * this.W, x1 = f.x1 * this.W;
    const z0 = (f.y0 - 0.5) * this.H, z1 = (f.y1 - 0.5) * this.H;
    return { x0, z0, w: x1 - x0, h: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }

  private pageMaterial() {
    const uniforms: Record<string, THREE.IUniform> = {
      uH: { value: new THREE.Matrix3() },
      uDiagRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAspect: { value: 0.75 },
      uPaper: { value: new THREE.Color('#f7f0e1') },
      uFlat: { value: 1 },
      uColorMix: { value: 0 },
      uWipe: { value: 0 },
      uGhost: { value: 0 },
      uGlow: { value: 0 },
      uMarks: { value: 0 },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uHasPhoto: { value: 0 },
    };
    const blank = new THREE.DataTexture(new Uint8Array([247, 240, 225, 255]), 1, 1);
    blank.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#2c2620', transparent: true, map: blank });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform mat3 uH; uniform vec4 uDiagRect; uniform vec3 uPaper; uniform float uAspect;
          uniform float uFlat, uColorMix, uWipe, uGhost, uGlow, uMarks, uTime, uReveal, uHasPhoto;
          float lp_h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float lp_n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
            return mix(mix(lp_h(i),lp_h(i+vec2(1,0)),u.x), mix(lp_h(i+vec2(0,1)),lp_h(i+vec2(1,1)),u.x), u.y); }
          // paper grain so a plain photo still reads as paper
          float lp_grain(vec2 p){ return (lp_n(p*900.0)-0.5)*0.035 + (lp_n(p*40.0)-0.5)*0.03; }`
        )
        .replace(
          '#include <map_fragment>',
          `
          // page uv: u right, v down
          vec2 puv = vec2(vMapUv.x, 1.0 - vMapUv.y);
          vec3 hp = uH * vec3(puv, 1.0);
          vec2 photoUv = mix(puv, hp.xy / hp.z, uFlat);
          vec4 texel = texture2D(map, uHasPhoto > 0.5 ? photoUv : vMapUv);
          if (photoUv.x < 0.0 || photoUv.x > 1.0 || photoUv.y < 0.0 || photoUv.y > 1.0) texel = vec4(uPaper, 1.0);
          texel.rgb *= 1.0 + lp_grain(puv);
          vec2 duv = (puv - uDiagRect.xy) / uDiagRect.zw;
          if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0 && uDiagRect.z > 0.0) {
            float aspect = uDiagRect.z / uDiagRect.w * uAspect;
            vec2 c = (duv - 0.5) * vec2(aspect, 1.0);
            float r = length(c);
            float n = fract(sin(dot(floor(duv*90.0), vec2(12.9898,78.233)))*43758.5453);
            float wipe = smoothstep(uWipe, uWipe - 0.12, r + n*0.04);
            // how much this pixel is printed ink rather than paper
            float pl = max(dot(uPaper, vec3(0.299,0.587,0.114)), 0.2);
            float lum = dot(texel.rgb, vec3(0.299,0.587,0.114));
            float ink = clamp((pl - lum) / pl * 2.4, 0.0, 1.0);
            float sat = max(max(texel.r,texel.g),texel.b) - min(min(texel.r,texel.g),texel.b);
            // watercolour: pastel pigment pooled in blotches; ink lines pick up a deep tint
            float b1 = lp_n(duv * vec2(aspect, 1.0) * 3.0), b2 = lp_n(duv * vec2(aspect, 1.0) * 5.0 + 7.3);
            vec3 pig = mix(vec3(0.949,0.722,0.627), vec3(0.616,0.718,0.812), smoothstep(0.3, 0.7, b1));
            pig = mix(pig, vec3(0.624,0.718,0.604), smoothstep(0.55, 0.85, b2) * 0.8);
            vec3 deep = pig * 0.55 + vec3(0.12,0.09,0.07);
            float edge = smoothstep(0.0, 0.05, wipe) * (1.0 - smoothstep(0.05, 0.6, wipe));
            vec3 washed = mix(texel.rgb * mix(vec3(1.0), pig * 1.12, 0.38 + 0.12 * b2), mix(texel.rgb, deep, 0.55 * (1.0 - sat)), ink);
            washed = mix(washed, washed * pig, edge * 0.35);
            texel.rgb = mix(texel.rgb, washed, wipe * uColorMix);
            // ghost: the printed drawing fades back into the paper once it has lifted
            vec3 gh = mix(texel.rgb, uPaper * 0.97 + vec3(0.02,0.0,-0.02), 0.82 * ink);
            gh = mix(gh, uPaper, 0.25 * (1.0 - ink));
            texel.rgb = mix(texel.rgb, gh, uGhost);
            texel.rgb += vec3(1.0, 0.82, 0.55) * (uGlow * 0.14 * smoothstep(0.62, 0.2, r));
            // pencil corner marks
            float bx = min(min(duv.x, 1.0-duv.x), min(duv.y, 1.0-duv.y));
            float wob = (lp_n(duv * 40.0) - 0.5) * 0.006;
            float corner = (1.0 - smoothstep(0.0, 0.01, abs(bx - 0.012 + wob))) * step(0.78, min(abs(duv.x-0.5), abs(duv.y-0.5))*2.0);
            texel.rgb = mix(texel.rgb, vec3(0.79, 0.42, 0.35), corner * uMarks);
          }
          diffuseColor *= texel;
          diffuseColor.a *= uReveal;
        `
        );
    };
    return { mat, uniforms };
  }

  /** load the photo: flatten with the page corners, figure rect in page coords */
  load(photo: ImageBitmap | null, corners: Quad, figure: NormBox) {
    this.clearViz();
    this.figure = figure;
    const m = this.page.material as THREE.MeshLambertMaterial;
    if (photo) {
      const tex = new THREE.Texture(photo);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      this.photoTex?.dispose();
      this.photoTex = tex;
      m.map = tex;
      this.U.uHasPhoto.value = 1;
      this.U.uPaper.value.copy(paperTone(photo, corners));
      this.setPageSize(quadAspect(corners, photo.width, photo.height));
    } else {
      this.U.uHasPhoto.value = 0;
      this.setPageSize(0.75);
    }
    m.needsUpdate = true;
    const Hm = squareToQuad(corners);
    // three's Matrix3.set takes row-major arguments
    (this.U.uH.value as THREE.Matrix3).set(Hm[0], Hm[1], Hm[2], Hm[3], Hm[4], Hm[5], Hm[6], Hm[7], Hm[8]);
    this.U.uAspect.value = this.W / this.H;
    this.U.uDiagRect.value.set(figure.x0, figure.y0, figure.x1 - figure.x0, figure.y1 - figure.y0);
    for (const k of ['uColorMix', 'uWipe', 'uGhost', 'uGlow', 'uMarks']) this.U[k].value = 0;
    this.setView('photo', 0);
  }

  setViz(v: StageViz, interactives: Interactive[]) {
    this.viz = v;
    this.interactives = interactives;
    if (v.root && !v.root.parent) this.pageGroup.add(v.root);
  }

  /** raw photo morphs flat, then corner marks find the figure */
  async showPhoto(instant = false) {
    if (instant) {
      this.U.uReveal.value = 1;
      this.U.uFlat.value = 1;
      this.U.uMarks.value = 1;
      return;
    }
    this.U.uReveal.value = 0;
    this.U.uFlat.value = 0;
    await gsap.to(this.U.uReveal, { value: 1, duration: 0.5, ease: 'power2.out' });
    await gsap.to(this.U.uFlat, { value: 1, duration: 0.9, ease: 'power3.inOut' });
    await gsap.to(this.U.uMarks, { value: 1, duration: 0.5, ease: 'power2.out' });
  }

  // ---- camera -------------------------------------------------------------
  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.css.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.applyShift();
    if (!this.active && !this.busy) this.setView('photo', 0);
  }

  applyShift() {
    const r = this.host.getBoundingClientRect();
    if (this.viewShift.v > 0.001) this.camera.setViewOffset(r.width, r.height, 0, r.height * this.viewShift.v, r.width, r.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private viewParams(kind: 'photo' | 'explore') {
    const a = this.camera.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    if (kind === 'photo') {
      const dh = (this.H * 0.54) / tanH;
      const dw = (this.W * 0.54) / (tanH * a);
      return { target: new THREE.Vector3(this.W / 2, 0, 0), dist: Math.max(dh, dw), polar: 0.0001, az: 0 };
    }
    const f = this.figureWorld();
    const vh = this.viz?.view ?? {};
    const size = Math.max(f.w, f.h * 0.9, 1.1);
    const dw = (size * 0.48) / (tanH * a);
    const target = new THREE.Vector3(f.cx, (vh.lift ?? 0.35) * Math.max(f.h, 0.8), f.cz);
    return { target, dist: Math.max(1.8, dw) * (vh.zoom ?? 1), polar: vh.polar ?? 0.92, az: vh.azimuth ?? 0.15 };
  }

  setView(kind: 'photo' | 'explore', duration = 1.4) {
    this.moveCamera(this.viewParams(kind), duration);
  }

  moveCamera(v: { target: THREE.Vector3; dist: number; polar: number; az: number }, duration = 1.4) {
    this.controls.maxDistance = Math.max(9, v.dist * 1.6);
    const to = new THREE.Vector3().setFromSpherical(new THREE.Spherical(v.dist, v.polar, v.az)).add(v.target);
    gsap.killTweensOf(this.camTween);
    if (!duration) {
      this.camera.position.copy(to);
      this.controls.target.copy(v.target);
      this.camera.lookAt(v.target);
      return;
    }
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const t0 = this.controls.target.clone();
    // shortest way round in azimuth
    let az = v.az;
    while (az - s0.theta > Math.PI) az -= 2 * Math.PI;
    while (s0.theta - az > Math.PI) az += 2 * Math.PI;
    this.camTween.k = 0;
    gsap.to(this.camTween, {
      k: 1,
      duration,
      ease: 'power3.inOut',
      onUpdate: () => {
        const k = this.camTween.k;
        const t = t0.clone().lerp(v.target, k);
        const sp = new THREE.Spherical(THREE.MathUtils.lerp(s0.radius, v.dist, k), THREE.MathUtils.lerp(s0.phi, v.polar, k), THREE.MathUtils.lerp(s0.theta, az, k));
        this.controls.target.copy(t);
        this.camera.position.copy(new THREE.Vector3().setFromSpherical(sp).add(t));
        this.camera.lookAt(t);
      },
    });
  }
  private camTween = { k: 0 };

  /** vertical projection shift that centres content in the band between header and sheet */
  shiftForInsets() {
    const H = Math.max(1, this.host.getBoundingClientRect().height);
    return THREE.MathUtils.clamp((this.insets.bottom - this.insets.top) / (2 * H), -0.3, 0.3);
  }

  setInsets(top: number, bottom: number) {
    this.insets = { top: Math.max(0, top), bottom: Math.max(0, bottom) };
    if (this.active && !this.busy) {
      gsap.to(this.viewShift, { v: this.shiftForInsets(), duration: 0.5, ease: 'power2.inOut', onUpdate: () => this.applyShift() });
      this.fitModel(0.6, true);
    }
  }

  /** world-space bounds of the visible model (no outlines, hit areas or faded parts) */
  modelBox() {
    const box = new THREE.Box3();
    const root = this.viz?.root;
    if (!root) return box;
    root.updateMatrixWorld(true);
    root.traverse((o: any) => {
      if (!o.geometry || o.userData.isOutline || o.material?.visible === false) return;
      let p: THREE.Object3D | null = o;
      while (p) {
        if (!p.visible) return;
        p = p.parent;
      }
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent && (m.uniforms?.uOpacity?.value ?? m.opacity) < 0.15) return;
      o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox) box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    return box;
  }

  /**
   * Frame the model that was actually built (not the printed figure's box) so
   * it fits between the header and the controls sheet with a margin.
   */
  fitModel(duration = 1, keepAngle = false) {
    const box = this.modelBox();
    if (box.isEmpty()) return this.setView('explore', duration);
    const r = this.host.getBoundingClientRect();
    const H = Math.max(1, r.height);
    const band = THREE.MathUtils.clamp((H - this.insets.top - this.insets.bottom) / H, 0.3, 1);
    const target = box.getCenter(new THREE.Vector3());
    const vh = this.viz?.view ?? {};
    const cur = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const polar = keepAngle ? cur.phi : THREE.MathUtils.clamp(vh.polar ?? 0.92, 0.2, 1.2);
    const az = keepAngle ? cur.theta : vh.azimuth ?? 0.15;
    const tmp = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 0.01, 200);
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, polar, az));
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    let dist = Math.max(0.6, sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2) * band));
    for (let i = 0; i < 6; i++) {
      tmp.position.copy(target).addScaledVector(dir, dist);
      tmp.lookAt(target);
      tmp.updateMatrixWorld(true);
      let m = 0;
      for (const c of corners) {
        const p = c.clone().project(tmp);
        if (p.z > 1) {
          m = Math.max(m, 2);
          continue;
        }
        m = Math.max(m, Math.abs(p.x) / 0.86, Math.abs(p.y) / (band * 0.86));
      }
      dist *= THREE.MathUtils.clamp(m, 0.5, 2);
    }
    dist = THREE.MathUtils.clamp(dist * (vh.zoom ?? 1), 0.8, 30);
    this.moveCamera({ target, dist, polar, az }, duration);
  }

  resetView() {
    if (this.active) this.fitModel(0.9);
    else this.setView('photo', 0.9);
  }

  // ---- the hero moment -----------------------------------------------------
  /** colour wash → drawing traces itself → lifts off the photo */
  activate(onPanel: () => void) {
    if (this.active || this.busy || !this.viz) return Promise.resolve();
    this.busy = true;
    this.active = true;
    this.hooks.onState('lifting');
    const U = this.U;
    const viz = this.viz;
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.busy = false;
          this.controls.enabled = true;
          // now that the model is up, frame what was actually built
          this.fitModel(1.0);
          this.hooks.onState('interactive');
          resolve();
        },
      });
      tl.to(U.uGlow, { value: 1, duration: 0.5, ease: 'sine.out' }, 0);
      tl.set(U.uColorMix, { value: 1 }, 0);
      tl.fromTo(U.uWipe, { value: 0 }, { value: 1.3, duration: 1.1, ease: 'power2.inOut' }, 0.1);
      tl.to(U.uMarks, { value: 0, duration: 0.6 }, 0.9);
      const sub = gsap.timeline();
      try {
        viz.enter(sub);
      } catch (e) {
        this.hooks.onError('enter', e);
      }
      tl.add(sub, 0.55);
      const end = 0.55 + Math.max(sub.duration(), 1.2);
      tl.to(U.uGhost, { value: 1, duration: 0.7, ease: 'power2.inOut' }, 1.25);
      tl.add(() => this.ghostNote.classList.add('show'), 1.9);
      tl.to(U.uGlow, { value: 0.2, duration: 1.0 }, 1.4);
      tl.add(() => this.setView('explore', 2.0), 0.6);
      tl.to(this.viewShift, { v: this.shiftForInsets(), duration: 2.0, ease: 'power3.inOut', onUpdate: () => this.applyShift() }, 0.6);
      tl.add(onPanel, Math.min(end, 2.4));
      tl.set({}, {}, end);
    });
  }

  deactivate() {
    if (!this.active || this.busy || !this.viz) return Promise.resolve();
    this.busy = true;
    this.lift.target = 0;
    this.controls.enabled = false;
    this.hooks.onState('folding');
    this.ghostNote.classList.remove('show');
    const U = this.U;
    const viz = this.viz;
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.active = false;
          this.busy = false;
          this.hooks.onState('photo');
          resolve();
        },
      });
      const sub = gsap.timeline();
      try {
        viz.exit(sub);
      } catch (e) {
        this.hooks.onError('exit', e);
      }
      tl.add(sub, 0);
      const t = Math.max(sub.duration(), 0.8);
      tl.to(U.uGhost, { value: 0, duration: 0.6, ease: 'power2.inOut' }, Math.max(0, t - 0.6));
      tl.to(U.uWipe, { value: 0, duration: 0.8, ease: 'power2.inOut' }, t - 0.2);
      tl.to(U.uGlow, { value: 0, duration: 0.6 }, t);
      tl.to(U.uMarks, { value: 1, duration: 0.5 }, t + 0.4);
      this.setView('photo', 1.8);
      gsap.to(this.viewShift, { v: 0, duration: 1.8, ease: 'power3.inOut', onUpdate: () => this.applyShift() });
    });
  }

  clearViz() {
    this.lift = { target: 0, value: 0, acc: 0, below: 0 };
    gsap.killTweensOf(this.U.uReveal);
    if (this.viz) {
      try {
        this.viz.dispose();
      } catch (e) {
        this.hooks.onError('runtime', e);
      }
      this.viz.root?.parent?.remove(this.viz.root);
      this.viz = null;
    }
    this.interactives = [];
    this.active = false;
    this.busy = false;
    this.controls.enabled = false;
    this.drag = null;
    this.viewShift.v = 0;
    this.ghostNote.classList.remove('show');
    this.applyShift();
  }

  // ---- input ----------------------------------------------------------------
  private setRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
  }
  private pick() {
    if (!this.active || this.busy || !this.interactives.length) return null;
    const objs = this.interactives.map((i) => i.object);
    const hit = this.ray.intersectObjects(objs, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      const item = this.interactives.find((i) => i.object === o);
      if (item) return { item, hit };
      o = o.parent;
    }
    return null;
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
    this.guard(() => p.item.onDown?.(p.hit, this.ray.ray));
    this.hooks.onTouch('grab');
  }
  private onMove(e: PointerEvent) {
    this.setRay(e);
    if (this.drag) {
      const d = this.drag;
      this.guard(() => d.onDrag?.(this.ray.ray, e));
      return;
    }
    if (e.pointerType === 'mouse') {
      const item = this.pick()?.item ?? null;
      if (item !== this.hovered) {
        const prev = this.hovered;
        this.guard(() => prev?.onHover?.(false));
        this.guard(() => item?.onHover?.(true));
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
    const d = this.drag;
    this.drag = null;
    this.guard(() => d.onUp?.());
    this.controls.enabled = this.active;
  }
  private guard(fn: () => void) {
    try {
      fn();
    } catch (e) {
      this.hooks.onError('runtime', e);
    }
  }

  // ---- frame ------------------------------------------------------------------
  frame(dt: number) {
    const t0 = performance.now();
    this.time += dt;
    this.U.uTime.value += dt;
    if (this.viz && this.updateFailures < 3) {
      try {
        this.viz.update(dt, this.time);
      } catch (e) {
        this.updateFailures++;
        this.hooks.onError('update', e);
      }
    }
    this.keepAbovePaper(dt);
    this.marginEl.classList.toggle('show', this.active && !this.busy && this.marginEl.childElementCount > 0);
    this.controls.update();
    const res = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(res);
    for (const m of lineMaterials) m.resolution.copy(res);
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
    this.positionGhostNote();
    const ms = performance.now() - t0;
    this.statsAcc.n++;
    this.statsAcc.ms += ms;
  }

  /**
   * Generated models sometimes put parts below y = 0 (negative surface values,
   * things hanging under a pop-up's hinge); the opaque page hides them. Once
   * the model is up, measure it a few times a second and raise the whole model
   * just enough. The lift only grows while exploring and returns to 0 on fold.
   */
  private keepAbovePaper(dt: number) {
    const root = this.viz?.root;
    if (!root) return;
    this.lift.acc += dt;
    if (this.active && this.lift.acc > 0.25) {
      this.lift.acc = 0;
      root.updateMatrixWorld(true);
      this.liftBox.makeEmpty();
      root.traverse((o: any) => {
        if (!o.visible || !o.geometry || o.userData.isOutline || o.material?.visible === false) return;
        // skip anything mostly transparent (e.g. a fading ghost) and helper hit areas
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.transparent && (m.uniforms?.uOpacity?.value ?? m.opacity) < 0.15) return;
        o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox) return;
        this.liftBox.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      if (!this.liftBox.isEmpty()) {
        // world → page-group height, without our own current lift
        const minY = this.liftBox.min.y - this.pageGroup.position.y - root.position.y + this.lift.value;
        const height = Math.max(1e-3, this.liftBox.max.y - this.liftBox.min.y);
        this.lift.below = Math.max(0, -minY) / height;
        if (!this.busy && minY < -0.01) {
          const t = Math.min(1.5, -minY + 0.012);
          // a noticeable lift moves the model: reframe it
          if (t > this.lift.target + 0.05) setTimeout(() => this.active && !this.busy && this.fitModel(0.6, true), 400);
          this.lift.target = Math.max(this.lift.target, t);
        }
      }
    }
    if (!this.active) this.lift.target = 0;
    const next = this.lift.value + (this.lift.target - this.lift.value) * (1 - Math.exp(-6 * dt));
    if (Math.abs(next - this.lift.value) > 1e-5 || this.lift.value !== 0) {
      root.position.y += next - this.lift.value;
      this.lift.value = Math.abs(next) < 1e-5 && this.lift.target === 0 ? 0 : next;
    }
  }

  private positionGhostNote() {
    if (!this.ghostNote.classList.contains('show')) return;
    const f = this.figureWorld();
    const p = this.point(f.cx - f.w * 0.25, f.z0 + f.h * 0.92).project(this.camera);
    const r = this.host.getBoundingClientRect();
    this.ghostNote.style.transform = `translate(${((p.x + 1) / 2) * r.width}px, ${((1 - p.y) / 2) * r.height}px) rotate(-2deg)`;
  }

  /** collected once per second by the sandbox entry */
  takeStats() {
    const now = performance.now();
    const secs = (now - this.statsAcc.t0) / 1000;
    const s = {
      fps: secs > 0 ? this.statsAcc.n / secs : 0,
      frameMs: this.statsAcc.n ? this.statsAcc.ms / this.statsAcc.n : 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.statsAcc = { n: 0, ms: 0, t0: now };
    return s;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clearViz();
    this.photoTex?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** Typical paper colour inside the page quad: a bright percentile of sampled pixels. */
function paperTone(photo: ImageBitmap, q: Quad) {
  const c = new OffscreenCanvas(96, 96);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, 96, 96);
  const d = ctx.getImageData(0, 0, 96, 96).data;
  const H = squareToQuad(q);
  const px: [number, number, number, number][] = [];
  for (let i = 0; i < 400; i++) {
    const u = 0.08 + 0.84 * ((i % 20) / 19), v = 0.08 + 0.84 * (Math.floor(i / 20) / 19);
    const w = H[6] * u + H[7] * v + H[8];
    const x = Math.round(((H[0] * u + H[1] * v + H[2]) / w) * 95), y = Math.round(((H[3] * u + H[4] * v + H[5]) / w) * 95);
    if (x < 0 || y < 0 || x > 95 || y > 95) continue;
    const k = (y * 96 + x) * 4;
    px.push([d[k], d[k + 1], d[k + 2], d[k] + d[k + 1] + d[k + 2]]);
  }
  if (!px.length) return new THREE.Color('#f7f0e1');
  px.sort((a, b) => b[3] - a[3]);
  const top = px.slice(Math.floor(px.length * 0.1), Math.floor(px.length * 0.4) + 1);
  const avg = [0, 1, 2].map((j) => top.reduce((s, p) => s + p[j], 0) / top.length / 255);
  return new THREE.Color().setRGB(avg[0], avg[1], avg[2], THREE.SRGBColorSpace);
}
