// Visualization modules available to the phone, keyed by registry vizId,
// plus the printed figure variants (coloured / lifted-away) used for the wash.
import * as THREE from 'three';
// @ts-ignore — v1 JS modules
import { pendulumChapter } from '../../viz/chapters/pendulum.js';
// @ts-ignore
import { magnetChapter } from '../../viz/chapters/magnet.js';
// @ts-ignore
import { surfaceChapter } from '../../viz/chapters/surface.js';
// @ts-ignore
import { renderChapter } from '../../viz/pages.js';

const VIZ: Record<string, any> = { pendulum: pendulumChapter, magnet: magnetChapter, surface: surfaceChapter };

// phone framing per visualization (target height/depth, polar angle, zoom)
(pendulumChapter as any).phoneView = { y: 0.62, z: -0.2, polar: 1.02, az: 0.1, zoom: 0.78 };
(magnetChapter as any).phoneView = { y: 0.1, z: -0.45, polar: 0.8, az: 0.18, zoom: 0.8 };
(surfaceChapter as any).phoneView = { y: 0.4, z: -0.4, polar: 0.9, az: -0.2, zoom: 0.82 };

export const chapterFor = (vizId: string) => {
  const ch = VIZ[vizId];
  return {
    ...ch,
    createViz(env: any) {
      const v = ch.createViz(env);
      v.phoneView = ch.phoneView;
      // phone-sized layout tweaks for the handwritten notes
      // equations and readouts move into a margin strip under the header
      const margin: Record<string, string[]> = { pendulum: ['eq1', 'eq2'], magnet: ['gauss', 'falloff'], surface: ['tan', 'fx'] };
      v.marginNotes = (margin[ch.id] || []).map((k) => v.notes[k]).filter(Boolean);
      return v;
    },
  };
};

const cache = new Map<string, { rect: THREE.Vector4; colored: THREE.Texture; ghost: THREE.Texture }>();
export function chapterTextures(ch: any) {
  if (!cache.has(ch.id)) {
    const r: any = renderChapter(ch);
    r.left.dispose();
    r.right.dispose();
    cache.set(ch.id, { rect: r.rect, colored: r.colored, ghost: r.ghost });
  }
  return cache.get(ch.id)!;
}
