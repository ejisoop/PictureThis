// Simulated Mentra Live: a head-mounted camera looking at the textbook.
// Renders the "camera feed", models head motion, captures stills, and keeps
// ground-truth frame data for the mock recognition pipeline.
import * as THREE from 'three';
import gsap from 'gsap';
// @ts-ignore — v1 JS modules
import { Book, PAGE_W, PAGE_H, pageHeight } from '../viz/book.js';
// @ts-ignore
import { sketchMaterial, addEdges, lineMaterials } from '../viz/sketch.js';
import type { GlassesDevice } from '../mentra/mock';
import type { CaptureReason, Photo } from '../shared/types';
import type { SimFrame, SimOracle } from '../services/recognition';
import { GlassesSpeaker } from './audio';

export const CAPTURE_W = 960;
export const CAPTURE_H = 540;

type Fn<T> = (p: T) => void;

function woodTexture(renderer: THREE.WebGLRenderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dccdb4';
  g.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y++) {
    const v = Math.sin(y * 0.045 + Math.sin(y * 0.011) * 3) * 0.5 + Math.sin(y * 0.31) * 0.2;
    g.fillStyle = `rgba(${v > 0 ? '150,115,75' : '245,230,205'},${Math.abs(v) * 0.09})`;
    g.fillRect(0, y, 1024, 1);
  }
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 1024;
    g.strokeStyle = `rgba(120,90,55,${0.04 + Math.random() * 0.06})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function props() {
  const g = new THREE.Group();
  const pencil = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), sketchMaterial({ color: '#f1d68c' }));
  const wood = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), sketchMaterial({ color: '#e9cfa8' }));
  wood.position.y = 0.83;
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), sketchMaterial({ color: '#f2b8a0' }));
  eraser.position.y = -0.8;
  pencil.add(body, wood, eraser);
  pencil.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
  addEdges(body, { width: 1 });
  pencil.rotation.set(Math.PI / 2, 0, 1.25);
  pencil.position.set(2.75, 0.05, 1.35);
  g.add(pencil);
  const mug = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.29, 0.62, 28, 1, true), sketchMaterial({ color: '#a9bfa6', side: THREE.DoubleSide as any, hatch: 0.45 }));
  cup.position.y = 0.31;
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.31, 28).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#b98a5c' }));
  tea.position.y = 0.5;
  mug.add(cup, tea);
  mug.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
  mug.position.set(-3.35, 0, -1.25);
  g.add(mug);
  return g;
}

export interface SpreadTextures {
  left: THREE.Texture;
  right: THREE.Texture;
}

export class GlassesSim implements GlassesDevice {
  readonly hasCamera = true;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 60);
  readonly book: any;
  readonly speaker = new GlassesSpeaker();
  spread = 0;
  turning = false;
  scripted = false;
  private spreads: SpreadTextures[] = [];
  private frames = new Map<string, SimFrame>();
  private rt = new THREE.WebGLRenderTarget(CAPTURE_W, CAPTURE_H, { colorSpace: THREE.SRGBColorSpace });
  private captureCam = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 60);
  private buttonCbs = new Set<Fn<{ pressType: 'short' | 'long' }>>();
  private transcriptCbs = new Set<Fn<{ text: string; isFinal: boolean }>>();
  private photoSeq = 0;
  private batteryLevel = 0.84;
  // head model
  gaze = new THREE.Vector3(0, 0.2, 0.05); // where the wearer is looking (book space)
  gazeTarget = this.gaze.clone();
  lean = 1;
  leanTarget = 1;
  private prevDir = new THREE.Vector3(0, -1, 0);
  angularVelocity = 0;
  private t = 0;
  onCapture: Fn<Photo> = () => {};
  onTurn: Fn<number> = () => {};
  private lastRender = 0;

  constructor(private canvasHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    canvasHost.appendChild(this.renderer.domElement);
    const bg = new THREE.Color('#e6ddd0');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 9, 22);
    this.scene.add(new THREE.HemisphereLight('#fff8ec', '#c4b49a', 1.45));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.0);
    sun.position.set(-3.2, 7.5, 3.6);
    sun.target.position.set(0.4, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4.2, right: 4.2, top: 3.4, bottom: -3.4, near: 2, far: 16 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015;
    this.scene.add(sun, sun.target);
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: woodTexture(this.renderer), color: '#efe6da' }));
    desk.receiveShadow = true;
    this.scene.add(desk, props());
    this.book = new Book(this.renderer);
    this.book.diagramUniforms.uHintAmt.value = 0;
    this.scene.add(this.book.group);
    this.batteryLevel = 0.84;
    new ResizeObserver(() => this.resize()).observe(canvasHost);
    this.resize();
    this.wireInput();
  }

  setSpreads(textures: SpreadTextures[], chapters: { tabTitle: string; tabLabel?: string }[]) {
    this.spreads = textures;
    this.book.setLeft(textures[0].left);
    this.book.setRight(textures[0].right);
    this.book.setDiagram(new THREE.Vector4(0, 0, 0, 0), null, null);
    this.book.addTabs(chapters, () => {});
    this.book.setActiveTab(0);
  }

  async turnTo(i: number) {
    if (this.turning || i === this.spread || i < 0 || i >= this.spreads.length) return;
    this.turning = true;
    const dir = i > this.spread ? 1 : -1;
    const o = this.spreads[this.spread], n = this.spreads[i];
    this.book.setActiveTab(i);
    this.spread = i;
    this.onTurn(i);
    await this.book.turn(dir, { oldLeft: o.left, oldRight: o.right, newLeft: n.left, newRight: n.right }, 1.2);
    this.turning = false;
  }

  /** Point the wearer's gaze at a spot in page coordinates. */
  lookAt(x: number, z: number, duration = 1.2, lean?: number) {
    gsap.to(this.gazeTarget, { x, z, duration, ease: 'power2.inOut' });
    if (lean !== undefined) gsap.to(this, { leanTarget: lean, duration, ease: 'power2.inOut' });
  }

  private wireInput() {
    const el = this.canvasHost;
    el.addEventListener('pointermove', (e) => {
      if (this.scripted) return;
      const r = el.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const my = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.gazeTarget.set(mx * 2.3, 0.2, 0.05 + my * 1.35);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.leanTarget = THREE.MathUtils.clamp(this.leanTarget * (1 + e.deltaY * 0.0012), 0.55, 1.35);
    }, { passive: false });
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.book.tabs, false)[0];
      if (hit) void this.turnTo(hit.object.userData.chapterIndex);
    });
  }

  private resize() {
    const r = this.canvasHost.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(cam: THREE.PerspectiveCamera, t: number) {
    // head: eyes above and in front of the book, looking at the gaze point
    const drift = new THREE.Vector3(Math.sin(t * 0.37) * 0.035 + Math.sin(t * 1.3) * 0.008, 0, Math.cos(t * 0.29) * 0.03);
    const g = this.gaze.clone().add(drift);
    const eye = new THREE.Vector3(g.x * 0.3, 2.85 * this.lean + 0.2, 2.0 * this.lean + g.z * 0.25 + 0.35);
    eye.y += Math.sin(t * 0.9) * 0.012; // breathing
    cam.position.copy(eye);
    cam.lookAt(g);
  }

  /** advance head model + render the live feed (throttled ~30 fps) */
  update(dt: number, now: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 4.2);
    this.gaze.lerp(this.gazeTarget, k);
    this.lean += (this.leanTarget - this.lean) * k;
    this.placeCamera(this.camera, this.t);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const av = dt > 0 ? dir.angleTo(this.prevDir) / dt : 0;
    this.prevDir.copy(dir);
    this.angularVelocity += (av - this.angularVelocity) * Math.min(1, dt * 10);
    this.book.diagramUniforms.uTime.value += dt;
    this.batteryLevel = Math.max(0.2, this.batteryLevel - dt * 0.00002);
    // fake motion blur on the feed
    const blur = Math.min(2.2, Math.max(0, this.angularVelocity - 0.25) * 1.6);
    this.renderer.domElement.style.filter = `blur(${blur.toFixed(2)}px) saturate(0.92) contrast(1.03)`;
    if (now - this.lastRender < 1000 / 30) return;
    this.lastRender = now;
    const res = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(res);
    for (const m of lineMaterials) m.resolution.copy(res);
    this.renderer.render(this.scene, this.camera);
  }

  /** project a book-space point with the live camera to CSS px of the feed */
  projectLive(x: number, y: number, z: number): [number, number] | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const r = this.canvasHost.getBoundingClientRect();
    return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
  }

  // ---- GlassesDevice --------------------------------------------------------
  async takePhoto(reason: CaptureReason): Promise<Photo> {
    const cam = this.captureCam;
    cam.aspect = CAPTURE_W / CAPTURE_H;
    cam.fov = this.camera.fov;
    cam.updateProjectionMatrix();
    this.placeCamera(cam, this.t);
    cam.updateMatrixWorld();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, cam);
    const px = new Uint8Array(CAPTURE_W * CAPTURE_H * 4);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, CAPTURE_W, CAPTURE_H, px);
    this.renderer.setRenderTarget(null);
    const c = document.createElement('canvas');
    c.width = CAPTURE_W;
    c.height = CAPTURE_H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(CAPTURE_W, CAPTURE_H);
    for (let y = 0; y < CAPTURE_H; y++) img.data.set(px.subarray((CAPTURE_H - 1 - y) * CAPTURE_W * 4, (CAPTURE_H - y) * CAPTURE_W * 4), y * CAPTURE_W * 4);
    ctx.putImageData(img, 0, 0);
    // sensor noise + slight vignette so it reads as a photo
    ctx.fillStyle = ctx.createRadialGradient(CAPTURE_W / 2, CAPTURE_H / 2, CAPTURE_H * 0.4, CAPTURE_W / 2, CAPTURE_H / 2, CAPTURE_W * 0.62);
    (ctx.fillStyle as CanvasGradient).addColorStop(0, 'rgba(0,0,0,0)');
    (ctx.fillStyle as CanvasGradient).addColorStop(1, 'rgba(40,30,20,0.18)');
    ctx.fillRect(0, 0, CAPTURE_W, CAPTURE_H);
    const url = await new Promise<string>((r) => c.toBlob((b) => r(URL.createObjectURL(b!)), 'image/jpeg', 0.86));

    const id = `ph-${++this.photoSeq}`;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const frame: SimFrame = {
      spreadIndex: this.spread,
      turning: this.turning,
      angularVelocity: this.angularVelocity,
      width: CAPTURE_W,
      height: CAPTURE_H,
      cameraPos: [cam.position.x, cam.position.y, cam.position.z],
      project: (x, y, z) => {
        const v = new THREE.Vector4(x, y, z, 1).applyMatrix4(vp);
        if (v.w <= 0) return null;
        return [((v.x / v.w + 1) / 2) * CAPTURE_W, ((1 - v.y / v.w) / 2) * CAPTURE_H];
      },
    };
    this.frames.set(id, frame);
    if (this.frames.size > 40) {
      const first = this.frames.keys().next().value!;
      this.frames.delete(first);
    }
    const photo: Photo = { id, url, width: CAPTURE_W, height: CAPTURE_H, timestamp: Date.now(), reason };
    this.onCapture(photo);
    return photo;
  }

  oracle(): SimOracle {
    return { frame: (id) => this.frames.get(id) };
  }

  onButton(cb: Fn<{ pressType: 'short' | 'long' }>) {
    this.buttonCbs.add(cb);
    return () => void this.buttonCbs.delete(cb);
  }
  pressButton(pressType: 'short' | 'long') {
    this.buttonCbs.forEach((f) => f({ pressType }));
  }
  onTranscript(cb: Fn<{ text: string; isFinal: boolean }>) {
    this.transcriptCbs.add(cb);
    return () => void this.transcriptCbs.delete(cb);
  }
  say(text: string) {
    this.transcriptCbs.forEach((f) => f({ text, isFinal: true }));
  }
  play(url: string) {
    this.speaker.play(url);
  }
  speak(text: string) {
    return this.speaker.speak(text);
  }
  battery() {
    return Math.round(this.batteryLevel * 100);
  }
}

export { PAGE_W, PAGE_H, pageHeight };
