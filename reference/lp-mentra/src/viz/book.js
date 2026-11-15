// The open textbook: curved pages, page block, cloth cover, fore-edge chapter
// tabs and a page-turn animation driven by a bent "sheet" mesh.
import * as THREE from 'three';
import gsap from 'gsap';
import { PALETTE, FONTS } from './paper.js';

export const PAGE_W = 2.1;
export const PAGE_H = 2.8;
export const CANVAS_W = 1536;
export const CANVAS_H = 2048;
const COVER = 0.035;
const BASE = 0.17;

// Height of a page surface at normalised distance u from the spine (0..1).
export function pageHeight(u) {
  return BASE + 0.07 * (1 - Math.exp(-8 * u)) - 0.03 * u * u * u;
}
function pageSlope(u) {
  return (0.07 * 8 * Math.exp(-8 * u) - 0.09 * u * u) / PAGE_W;
}

// World position (book-local) of a point on the right page given page coords.
export function rightPagePoint(x, z, lift = 0) {
  return new THREE.Vector3(x, pageHeight(x / PAGE_W) + lift, z);
}

function buildPageGeometry(side, segs = 72) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; // texture u, 0 = left edge of image
    const d = side === 'right' ? t : 1 - t; // distance from spine
    const x = side === 'right' ? t * PAGE_W : (t - 1) * PAGE_W;
    const y = pageHeight(d);
    pos.push(x, y, -PAGE_H / 2, x, y, PAGE_H / 2);
    uv.push(t, 1, t, 0);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function stripedEdgeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 2) {
    ctx.fillStyle = `rgba(120,100,70,${0.05 + Math.random() * 0.1})`;
    ctx.fillRect(0, y, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function clothTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8fa88e';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(i, 0, 1, 256);
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    ctx.fillRect(0, i, 256, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function tabTexture(label, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 0, 256, 40);
  ctx.font = `600 64px ${FONTS.serif}`;
  ctx.fillStyle = 'rgba(47,43,38,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 170, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Book {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // cover + gutter
    const cloth = clothTexture();
    const coverMat = new THREE.MeshLambertMaterial({ map: cloth, color: '#a9bfa6' });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W * 2 + 0.16, COVER, PAGE_H + 0.14), coverMat);
    cover.position.y = COVER / 2;
    cover.castShadow = cover.receiveShadow = true;
    this.group.add(cover);
    const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.42, BASE - COVER - 0.004, PAGE_H - 0.02), new THREE.MeshLambertMaterial({ map: stripedEdgeTexture(), color: '#f3ead8' }));
    gutter.position.y = COVER + (BASE - COVER - 0.004) / 2;
    this.group.add(gutter);

    // page blocks
    const edgeTex = stripedEdgeTexture();
    const blockMat = new THREE.MeshLambertMaterial({ map: edgeTex, color: '#fbf5e8' });
    const blockTop = BASE + 0.034;
    for (const s of [-1, 1]) {
      const w = PAGE_W * 0.9;
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, blockTop - COVER, PAGE_H - 0.01), blockMat);
      block.position.set(s * (PAGE_W - w / 2), COVER + (blockTop - COVER) / 2, 0);
      block.receiveShadow = true;
      this.group.add(block);
    }

    // pages
    this.leftMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#2c2620' });
    this.rightMat = this._makeRightMaterial();
    this.left = new THREE.Mesh(buildPageGeometry('left'), this.leftMat);
    this.right = new THREE.Mesh(buildPageGeometry('right'), this.rightMat);
    for (const p of [this.left, this.right]) {
      p.receiveShadow = true;
      this.group.add(p);
    }

    // turning sheet (hidden until a turn)
    this.sheetSegs = 56;
    this.sheetGeo = buildPageGeometry('right', this.sheetSegs);
    this.sheetFrontMat = new THREE.MeshLambertMaterial({ side: THREE.FrontSide });
    this.sheetBackMat = new THREE.MeshLambertMaterial({ side: THREE.BackSide });
    this.sheetFront = new THREE.Mesh(this.sheetGeo, this.sheetFrontMat);
    this.sheetBack = new THREE.Mesh(this.sheetGeo, this.sheetBackMat);
    this.sheet = new THREE.Group();
    this.sheet.add(this.sheetFront, this.sheetBack);
    this.sheet.visible = false;
    this.sheetFront.castShadow = true;
    this.group.add(this.sheet);

    this.tabs = [];
    this.turning = false;
  }

  _makeRightMaterial() {
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#2c2620' });
    const u = (this.diagramUniforms = {
      uDiagRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDiagColor: { value: null },
      uDiagGhost: { value: null },
      uColorMix: { value: 0 },
      uWipe: { value: 0 },
      uGhost: { value: 0 },
      uGlow: { value: 0 },
      uHover: { value: 0 },
      uTime: { value: 0 },
      uHintAmt: { value: 1 },
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec4 uDiagRect; uniform sampler2D uDiagColor; uniform sampler2D uDiagGhost;
          uniform float uColorMix, uWipe, uGhost, uGlow, uHover, uTime, uHintAmt;`
        )
        .replace(
          '#include <map_fragment>',
          `
          vec4 texel = texture2D(map, vMapUv);
          vec2 duv = (vMapUv - uDiagRect.xy) / uDiagRect.zw;
          if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0 && uDiagRect.z > 0.0) {
            float aspect = uDiagRect.z / uDiagRect.w * ${(PAGE_W / PAGE_H).toFixed(4)};
            vec2 c = (duv - 0.5) * vec2(aspect, 1.0);
            float r = length(c);
            float n = fract(sin(dot(floor(duv*90.0), vec2(12.9898,78.233)))*43758.5453);
            float wipe = smoothstep(uWipe, uWipe - 0.12, r + n*0.04);
            vec4 col = texture2D(uDiagColor, duv);
            texel.rgb = mix(texel.rgb, col.rgb, wipe * uColorMix);
            vec4 gh = texture2D(uDiagGhost, duv);
            texel.rgb = mix(texel.rgb, gh.rgb, uGhost);
            float edge = smoothstep(0.62, 0.2, r);
            texel.rgb += vec3(1.0, 0.82, 0.55) * (uGlow * 0.16 * edge);
            float bx = min(min(duv.x, 1.0-duv.x), min(duv.y, 1.0-duv.y));
            float corner = (1.0 - smoothstep(0.0, 0.012, abs(bx - 0.012))) *
               step(0.84, min(abs(duv.x-0.5), abs(duv.y-0.5))*2.0) ;
            float pulse = 0.55 + 0.45 * sin(uTime * 2.2);
            texel.rgb = mix(texel.rgb, vec3(0.78, 0.55, 0.42), corner * (0.35 + 0.65*uHover) * pulse * (1.0 - uGhost) * uHintAmt);
          }
          diffuseColor *= texel;
          `
        );
    };
    return m;
  }

  _prepTex(tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.needsUpdate = true;
    return tex;
  }

  setLeft(tex) {
    this.leftMat.map = this._prepTex(tex);
    this.leftMat.needsUpdate = true;
  }
  setRight(tex) {
    this.rightMat.map = this._prepTex(tex);
    this.rightMat.needsUpdate = true;
  }
  setDiagram(rectUV, colorTex, ghostTex) {
    const u = this.diagramUniforms;
    u.uDiagRect.value.copy(rectUV);
    u.uDiagColor.value = colorTex ? this._prepTex(colorTex) : null;
    u.uDiagGhost.value = ghostTex ? this._prepTex(ghostTex) : null;
  }

  addTabs(chapters, onSelect) {
    const colors = [PALETTE.peach, PALETTE.yellow, PALETTE.blue, PALETTE.lavender];
    chapters.forEach((ch, i) => {
      const tex = tabTexture(ch.tabLabel || ['I', 'II', 'III', 'IV'][i], colors[i % colors.length]);
      const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(0.26, 0.2).rotateX(-Math.PI / 2);
      const tab = new THREE.Mesh(geo, mat);
      const z = -1.05 + i * 0.3;
      tab.position.set(PAGE_W + 0.06, pageHeight(1) - 0.012, z);
      tab.castShadow = true;
      tab.userData = { chapterIndex: i, baseX: PAGE_W + 0.06, onSelect };
      this.group.add(tab);
      this.tabs.push(tab);
    });
  }

  setActiveTab(i) {
    this.tabs.forEach((t, j) => {
      gsap.to(t.position, { x: t.userData.baseX + (i === j ? 0.07 : 0), duration: 0.6, ease: 'power3.out' });
    });
  }

  hoverTab(tab) {
    this.tabs.forEach((t) => {
      gsap.to(t.position, { y: pageHeight(1) - 0.012 + (t === tab ? 0.02 : 0), duration: 0.25 });
    });
  }

  // Bend the sheet: s=0 lying on the right, s=1 lying on the left.
  _layoutSheet(s) {
    const pos = this.sheetGeo.attributes.position;
    const N = this.sheetSegs;
    const du = 1 / N;
    const lift = Math.sin(Math.PI * s);
    let x = 0, y = BASE + 0.002;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      if (i > 0) {
        const um = (i - 0.5) / N;
        const a0 = Math.atan(pageSlope(um) * PAGE_W);
        const a = a0 * (1 - s) + (Math.PI - a0) * s - 0.95 * lift * Math.pow(um, 1.4) * (s < 0.5 ? 1 : 1) + lift * 0.18;
        x += Math.cos(a) * PAGE_W * du;
        y += Math.sin(a) * PAGE_W * du;
      }
      pos.setXYZ(i * 2, x, y + 0.003, -PAGE_H / 2);
      pos.setXYZ(i * 2 + 1, x, y + 0.003, PAGE_H / 2);
      void u;
    }
    pos.needsUpdate = true;
    this.sheetGeo.computeVertexNormals();
    this.sheetGeo.computeBoundingSphere();
  }

  // dir: +1 = forward (right page flips to the left). Textures are page textures.
  turn(dir, { oldLeft, oldRight, newLeft, newRight }, duration = 1.35) {
    return new Promise((resolve) => {
      this.turning = true;
      const back = (t) => {
        const c = t.clone();
        c.repeat.x = -1;
        c.offset.x = 1;
        c.needsUpdate = true;
        return this._prepTex(c);
      };
      if (dir > 0) {
        this.sheetFrontMat.map = this._prepTex(oldRight);
        this.sheetBackMat.map = back(newLeft);
        this.setRight(newRight);
      } else {
        this.sheetFrontMat.map = this._prepTex(newRight);
        this.sheetBackMat.map = back(oldLeft);
        this.setLeft(newLeft);
      }
      this.sheetFrontMat.needsUpdate = this.sheetBackMat.needsUpdate = true;
      const st = { s: dir > 0 ? 0 : 1 };
      this._layoutSheet(st.s);
      this.sheet.visible = true;
      gsap.to(st, {
        s: dir > 0 ? 1 : 0,
        duration,
        ease: 'power2.inOut',
        onUpdate: () => this._layoutSheet(st.s),
        onComplete: () => {
          if (dir > 0) this.setLeft(newLeft);
          else this.setRight(newRight);
          this.sheet.visible = false;
          if (this.sheetBackMat.map) this.sheetBackMat.map.dispose();
          this.turning = false;
          resolve();
        },
      });
    });
  }
}
