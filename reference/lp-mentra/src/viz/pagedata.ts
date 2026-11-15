// What is actually printed on each spread, in page coordinates. The mock
// recognition pipeline uses this as ground truth: it "reads" a region only
// when the simulated camera can see it well enough.
import type { PageRect, RegionKind } from '../shared/types';

export interface PrintedRegion {
  kind: RegionKind;
  rect: PageRect;
  text?: string;
  latex?: string;
  figureClass?: string;
  caption?: string;
}

export interface PrintedSpread {
  chapterId: string;
  pageId: string; // the right-hand page (where figures live)
  pageNumber: number;
  regions: PrintedRegion[];
}

const LEFT_TEXT: PageRect = { x0: -1.92, z0: -1.18, w: 1.74, h: 2.2 };

export const SPREADS: PrintedSpread[] = [
  {
    chapterId: 'pendulum',
    pageId: 'physics-ch4-p87',
    pageNumber: 87,
    regions: [
      { kind: 'text', rect: LEFT_TEXT, text: '4.2 The Simple Pendulum. A simple pendulum is an idealised system: a point mass m hangs from a fixed pivot on a light, inextensible string of length L. … the period depends only on the length of the string and the strength of gravity' },
      { kind: 'equation', rect: { x0: -1.4, z0: -0.18, w: 1.0, h: 0.16 }, latex: '\\frac{d^2\\theta}{dt^2} + \\frac{g}{L}\\sin\\theta = 0' },
      { kind: 'equation', rect: { x0: -1.3, z0: 0.12, w: 0.8, h: 0.16 }, latex: 'T = 2\\pi\\sqrt{L/g}' },
      { kind: 'figure', rect: { x0: 0.18, z0: -1.25, w: 1.74, h: 1.36 }, figureClass: 'pendulum-diagram', caption: 'Fig. 4.3 A pendulum of length L = 1.6 m displaced by θ = 30°.' },
      { kind: 'figure', rect: { x0: 0.33, z0: 0.46, w: 1.44, h: 0.56 }, figureClass: 'time-series-plot', caption: 'Fig. 4.4 Angular displacement θ(t).' },
    ],
  },
  {
    chapterId: 'history',
    pageId: 'physics-interlude-p211',
    pageNumber: 211,
    regions: [
      { kind: 'text', rect: LEFT_TEXT, text: 'Faraday’s Lines of Force. In the spring of 1820 … a compass needle swung away from north … lines of force around a magnet' },
      { kind: 'text', rect: { x0: 0.2, z0: -1.18, w: 1.7, h: 1.3 }, text: 'It was James Clerk Maxwell who finally gave Faraday’s pictures a mathematical form … electric and magnetic fields' },
      { kind: 'text', rect: { x0: 0.25, z0: 0.18, w: 1.55, h: 0.45 }, text: '“Nothing is too wonderful to be true, if it be consistent with the laws of nature.” — Michael Faraday' },
    ],
  },
  {
    chapterId: 'magnet',
    pageId: 'physics-ch7-p213',
    pageNumber: 213,
    regions: [
      { kind: 'text', rect: LEFT_TEXT, text: '7.1 Magnetic Fields of Permanent Magnets. Every magnet is surrounded by a magnetic field B … field lines never cross … a compass needle is itself a small magnet' },
      { kind: 'equation', rect: { x0: -1.5, z0: -0.25, w: 1.2, h: 0.2 }, latex: '\\mathbf{B}(\\mathbf{r}) = \\frac{\\mu_0}{4\\pi}\\frac{3(\\mathbf{m}\\cdot\\hat n)\\hat n - \\mathbf{m}}{r^3}' },
      { kind: 'equation', rect: { x0: -1.2, z0: 0.3, w: 0.6, h: 0.12 }, latex: '\\nabla\\cdot\\mathbf{B} = 0' },
      { kind: 'figure', rect: { x0: 0.13, z0: -1.25, w: 1.84, h: 1.62 }, figureClass: 'bar-magnet-field', caption: 'Fig. 7.2 Field lines around a bar magnet. A compass placed in the field points along B.' },
    ],
  },
  {
    chapterId: 'surface',
    pageId: 'calculus-ch12-p449',
    pageNumber: 449,
    regions: [
      { kind: 'text', rect: LEFT_TEXT, text: '12.3 Surfaces and Partial Derivatives. A function of two variables z = f(x, y) … the gradient points in the direction of steepest ascent … tangent plane' },
      { kind: 'equation', rect: { x0: -1.4, z0: -0.4, w: 1.0, h: 0.14 }, latex: 'f(x,y) = A\\sin(kx)\\cos(ky)' },
      { kind: 'equation', rect: { x0: -1.4, z0: 0.05, w: 1.0, h: 0.2 }, latex: '\\nabla f = (\\partial f/\\partial x, \\partial f/\\partial y)' },
      { kind: 'figure', rect: { x0: 0.15, z0: -1.27, w: 1.82, h: 1.66 }, figureClass: 'contour-map', caption: 'Fig. 12.4 Contour map of f(x, y) = sin x cos y on [−π, π]².' },
    ],
  },
];
