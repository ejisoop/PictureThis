// Future path: a generated explainer clip instead of (or before) real-time 3D.
// Only the interface, a prompt builder and a mock provider exist for now.
import type { Detection } from '../shared/types';

export interface VideoJobProgress {
  phase: 'queued' | 'sketching' | 'animating' | 'finishing';
  progress: number; // 0..1
}
export interface GeneratedClip {
  kind: 'placeholder' | 'video';
  url?: string;
  durationMs: number;
  prompt: string;
}
export interface VideoGenerationProvider {
  readonly name: string;
  generate(prompt: string, opts: { durationS: number; aspect: '9:16' | '16:9' }, onProgress: (p: VideoJobProgress) => void): Promise<GeneratedClip>;
}

export function buildVideoPrompt(d: Pick<Detection, 'title' | 'subject' | 'figureLabel' | 'extracted'>, durationS = 8): string {
  const params = Object.entries(d.extracted.parameters)
    .map(([k, v]) => `${k} = ${Number.isInteger(v) ? v : v.toFixed(2)}`)
    .join(', ');
  return [
    `A ${durationS}-second vertical (9:16) explainer clip of “${d.title}” (${d.subject}).`,
    `Start from the printed textbook figure (${d.figureLabel}) lying on cream paper; the pencil drawing lifts off the page and animates in 3D.`,
    params ? `Use these values from the student’s page: ${params}.` : '',
    d.extracted.equations.length ? `Show the key equation handwritten beside the model: ${d.extracted.equations[0]}.` : '',
    'Style: pencil-and-watercolour textbook illustration, graphite outlines, soft pastel washes (sage, dusty blue, peach, lavender), warm natural light, no neon, no holograms.',
    'Camera: slow push-in, then a gentle orbit. No narration text on screen beyond the handwritten labels.',
  ].filter(Boolean).join(' ');
}

export class MockVideoProvider implements VideoGenerationProvider {
  readonly name = 'mock-video (placeholder)';
  async generate(prompt: string, opts: { durationS: number }, onProgress: (p: VideoJobProgress) => void): Promise<GeneratedClip> {
    const phases: VideoJobProgress['phase'][] = ['queued', 'sketching', 'animating', 'finishing'];
    const total = 4200;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / total);
        onProgress({ phase: phases[Math.min(3, Math.floor(p * 4))], progress: p });
        if (p >= 1) resolve();
        else setTimeout(tick, 80);
      };
      tick();
    });
    return { kind: 'placeholder', durationMs: opts.durationS * 1000, prompt };
  }
}
