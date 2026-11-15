// Prompts for code generation and repair. The system prompt carries the full
// runtime API reference, the module contract, the style and accuracy rules,
// and the four reference modules as few-shot examples.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLES, exampleCode } from '../examples';
import type { Figure, PageUnderstanding } from '../types';

const API = readFileSync(join(import.meta.dir, '..', '..', '..', 'runtime', 'API.md'), 'utf8');

let cached: string | null = null;
export function systemPrompt(): string {
  if (cached) return cached;
  const shots = EXAMPLES.flatMap((e) => {
    const code = exampleCode(e);
    return code ? [`### Example: ${e.title} (concept: ${e.concept})\nPrinted figure: ${e.figure}\n\n\`\`\`js\n${code.trim()}\n\`\`\``] : [];
  }).join('\n\n');
  cached = `You write interactive 3D visualizations of textbook figures for "PictureThis".
A student wearing camera glasses is reading a textbook. When a figure can be brought to life, their phone shows their own photo of the page, and your module makes the printed drawing lift off the page as a live, touchable model in a hand-drawn sketchbook style: pastel watercolour, pencil hatching, ink outlines and handwritten notes.

You write ONE JavaScript module against the Sketchbook runtime below. The runtime owns rendering, the camera, the page photo and the art style. You only build the figure's content with \`lp\`.

${API}

## How to approach a figure
1. Identify the physical or mathematical system in the figure and its governing equations. Prefer the equations printed on the page.
2. Decide between a side view (\`lp.choreo.popUp\`, authored standing up) and a top view (\`lp.choreo.riseFromPage\`, authored in page space). Match the printed drawing's layout, so the model sits right over it.
3. Pick one quantity the student should play with, and build 2–5 controls around it. Add one direct-manipulation drag when it makes sense.
4. Label the important quantities with handwritten notes. Put the key equations, with live values, in the margin (\`kind: 'equation'\`).
5. Keep it small, correct and robust. It must run for minutes without NaN or slowdown.
6. Be concise: aim for 150–300 lines. The student is waiting while you write. The reference modules are longer than needed; take their structure and style, not their length.
7. Make the model fill the figure: build at the figure's aspect ratio inside \`lp.figure.frame(designW, designH)\`, with the main object large and central. Prefer one strong, moving idea over many labels.

## Reference modules (follow their structure, style and quality)

${shots}

## Output
Return JSON: { "title": short student-facing title, "summary": one sentence describing what the student can do, "controls": the keys you declared with lp.controls, "code": the complete module source }.
The code must be a complete module: \`export default function create(lp, ctx) { … }\`, with no imports, no other exports and no markdown fences.`;
  return cached;
}

export const CODEGEN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    controls: { type: 'array', items: { type: 'string' } },
    code: { type: 'string' },
  },
  required: ['title', 'summary', 'controls', 'code'],
};

export function userPrompt(page: PageUnderstanding, fig: Figure): string {
  const nearby = page.regions
    .filter((r) => r.kind === 'equation' || r.kind === 'caption' || r.kind === 'heading')
    .map((r) => `- ${r.kind}: ${r.latex || r.text}`.slice(0, 300))
    .slice(0, 16)
    .join('\n');
  return `Write the visualization for this figure. A crop of the figure is attached.

Page: ${page.fingerprint.pageNumber ?? '?'} — ${page.fingerprint.heading}
Figure ${fig.label || fig.id}: ${fig.title}
Concept: ${fig.concept} (${fig.subject})
Description: ${fig.description}
Caption: ${fig.caption || '(none)'}
Figure box on the page (normalised): x ${fig.box.x0.toFixed(3)}–${fig.box.x1.toFixed(3)}, y ${fig.box.y0.toFixed(3)}–${fig.box.y1.toFixed(3)} (aspect w/h ≈ ${((fig.box.x1 - fig.box.x0) / Math.max(0.01, fig.box.y1 - fig.box.y0)).toFixed(2)} in page units — choose frame(designW, designH) with a similar aspect).
Parameters read from the page (available via lp.param(name, fallback)): ${fig.parameters.length ? fig.parameters.map((p) => `${p.name}${p.symbol ? ` (${p.symbol})` : ''} = ${p.value} ${p.unit}`).join('; ') : 'none'}
Governing equations: ${fig.equations.length ? fig.equations.join(' ; ') : '(none given)'}
Other text on the page:
${nearby || '(none)'}`;
}

export function repairPrompt(code: string, errors: string[]): string {
  return `Your previous module failed validation. Fix every problem and return the complete corrected module in the same JSON format.

Errors:
${errors.map((e) => `- ${e}`).join('\n')}

Previous code:
\`\`\`js
${code}
\`\`\``;
}
