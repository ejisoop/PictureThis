// The Visualization Registry: what we know how to bring to life, how to
// recognise it, and how to pull its starting parameters off the page.
// Adding a concept = one entry here + one visualization module.
import type { RecognizedRegion, ConceptMatch, RendererKind } from '../shared/types';

export interface RegistryEntry {
  conceptId: string;
  title: string;
  subject: string;
  vizId: string;
  renderer: RendererKind;
  triggers: { figureClasses: string[]; keywords: string[]; equations: RegExp[] };
  extract(text: string): Record<string, number>;
  spoken: string;
  summary: string;
}

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  return m ? parseFloat(m[1]) : undefined;
};

export const REGISTRY: RegistryEntry[] = [
  {
    conceptId: 'simple-pendulum',
    title: 'The simple pendulum',
    subject: 'Physics · Oscillations',
    vizId: 'pendulum',
    renderer: 'interactive3d',
    triggers: { figureClasses: ['pendulum-diagram'], keywords: ['pendulum', 'period', 'gravity', 'string'], equations: [/2\\pi\\sqrt/, /\\sin\\theta/] },
    extract(text) {
      const p: Record<string, number> = {};
      const L = num(/L\s*=\s*([\d.]+)\s*m/, text);
      const th = num(/θ\s*=\s*([\d.]+)\s*°/, text);
      if (L) p.L = L;
      if (th) p.theta0 = (th * Math.PI) / 180;
      return p;
    },
    spoken: 'Pendulum found. It’s on your phone.',
    summary: 'Set the swing going, change the string and gravity, and compare the real motion with the small-angle formula.',
  },
  {
    conceptId: 'bar-magnet-field',
    title: 'Field of a bar magnet',
    subject: 'Physics · Magnetism',
    vizId: 'magnet',
    renderer: 'interactive3d',
    triggers: { figureClasses: ['bar-magnet-field'], keywords: ['magnet', 'magnetic', 'field lines', 'compass'], equations: [/nabla\\cdot\\mathbf\{B\}/] },
    extract: () => ({}),
    spoken: 'Magnetic field found. Check your phone.',
    summary: 'See the field lines in 3D, drag a compass through the field and watch Earth’s field take over as the magnet weakens.',
  },
  {
    conceptId: 'surface-gradient',
    title: 'Surfaces & the gradient',
    subject: 'Calculus · Partial derivatives',
    vizId: 'surface',
    renderer: 'interactive3d',
    triggers: { figureClasses: ['contour-map'], keywords: ['gradient', 'partial derivative', 'contour', 'tangent plane'], equations: [/\\nabla f/, /\\sin\(kx\)/] },
    extract(text): Record<string, number> {
      // "f(x, y) = sin x cos y" → A = 1, k = 1; "f(x, y) = 2 sin 3x cos 3y" → A = 2, k = 3
      const m = text.match(/f\(x, y\) = ([\d.]*)\s*sin\s*([\d.]*)\s*x/);
      if (!m) return {};
      return { A: m[1] ? parseFloat(m[1]) : 1, k: m[2] ? parseFloat(m[2]) : 1 };
    },
    spoken: 'A surface to explore. It’s on your phone.',
    summary: 'Lift the contour map into a surface, then drag a point to see its tangent plane and gradient.',
  },
];

export const byConcept = (id: string) => REGISTRY.find((e) => e.conceptId === id)!;

/** Match recognised regions against the registry. */
export function matchConcepts(regions: RecognizedRegion[]): ConceptMatch[] {
  const pageText = regions.map((r) => [r.text, r.caption, r.latex].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const latex = regions.map((r) => r.latex || '').join(' ');
  const out: ConceptMatch[] = [];
  for (const e of REGISTRY) {
    const hits = e.triggers.keywords.filter((k) => pageText.includes(k)).length;
    const eqHits = e.triggers.equations.filter((re) => re.test(latex)).length;
    const support = Math.min(1, (hits + eqHits * 1.5) / 3);
    const figIdx = regions.findIndex((r) => r.kind === 'figure' && r.figureClass && e.triggers.figureClasses.includes(r.figureClass));
    const allText = regions.map((r) => `${r.caption ?? ''} ${r.text ?? ''}`).join(' ');
    if (figIdx >= 0) {
      const fig = regions[figIdx];
      const conf = fig.confidence * (0.88 + 0.12 * support);
      out.push({ conceptId: e.conceptId, confidence: conf, regionIndex: figIdx, params: e.extract(allText), why: `figure “${fig.figureClass}” + ${hits} keyword${hits === 1 ? '' : 's'}${eqHits ? ` + ${eqHits} equation` : ''}` });
    } else if (hits + eqHits > 0) {
      // the topic is mentioned, but there is no figure to bring to life
      out.push({ conceptId: e.conceptId, confidence: Math.min(0.45, 0.2 + 0.07 * (hits + eqHits)), regionIndex: null, params: {}, why: `text mentions only (${hits} keyword${hits === 1 ? '' : 's'}), no figure` });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
