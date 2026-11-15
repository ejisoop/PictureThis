// The reference visualizations, ported to the runtime contract. They are the
// few-shot examples in the code-generation prompt and seed the cache.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Example {
  id: string;
  concept: string;
  aliases: string[];
  title: string;
  summary: string;
  /** what the printed figure looked like, as page understanding would describe it */
  figure: string;
  file: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'pendulum', concept: 'simple-pendulum', aliases: ['pendulum', 'pendulum-motion', 'simple-harmonic-pendulum'],
    title: 'The simple pendulum', summary: 'A live pendulum you can drag, with its θ(t) plotted against the small-angle prediction.',
    figure: 'Side view of a pendulum: stand, string of length L = 1.6 m, bob displaced by θ = 30°, forces mg and T drawn; a θ(t) graph below.',
    file: 'pendulum.js',
  },
  {
    id: 'magnet', concept: 'bar-magnet-field', aliases: ['magnetic-field-lines', 'bar-magnet', 'magnetic-dipole-field'],
    title: 'Field of a bar magnet', summary: 'Field lines rise around a 3D bar magnet; drag the compass to probe B.',
    figure: 'A bar magnet (N/S) with curved field lines looping from N to S, and a compass needle aligned with the field.',
    file: 'magnet.js',
  },
  {
    id: 'surface', concept: 'function-surface', aliases: ['surface-plot', 'contour-map', 'partial-derivatives', 'gradient', 'function-of-two-variables'],
    title: 'A surface and its contours', summary: 'The contour map rises into the surface z = f(x, y); drag a point to see the tangent plane and gradient.',
    figure: 'Contour map of f(x, y) = sin x cos y on [−π, π]², with labelled level curves.',
    file: 'surface.js',
  },
  {
    id: 'projectile', concept: 'projectile-motion', aliases: ['projectile', 'projectile-trajectory', 'two-dimensional-kinematics'],
    title: 'Projectile motion', summary: 'Launch a ball along the printed trajectory and watch v split into vx and vy.',
    figure: 'Parabolic trajectory from the origin with velocity vectors v and components vx, vy drawn at several points; launch angle θ0.',
    file: 'projectile.js',
  },
];

export const KNOWN_CONCEPTS = EXAMPLES.map((e) => e.concept);
const DIR = join(import.meta.dir, '..', '..', 'examples');

export function exampleCode(e: Example): string | null {
  const p = join(DIR, e.file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

export function exampleForConcept(concept: string): Example | null {
  return EXAMPLES.find((e) => e.concept === concept || e.aliases.includes(concept)) ?? null;
}
