// Background layer of the Living Pages miniapp. No DOM access: it only talks
// to the glasses through `session`, to services through their interfaces, and
// to the phone UI through typed channels.
import type { MiniappSession } from '../mentra/mock';
import type { RecognitionPipeline, StageEvent } from '../services/recognition';
import type { CaptureReason, Detection, GlassesStatus, PipelineResult, Settings, Photo } from '../shared/types';
import { byConcept } from '../services/registry';
import { buildVideoPrompt } from '../services/video';

export const CONFIDENCE_THRESHOLD = 0.8;
export const FRAMES_REQUIRED = 2;

export type Trace =
  | { type: 'capture'; photo: Photo }
  | { type: 'stage'; event: StageEvent }
  | { type: 'result'; result: PipelineResult; reason: CaptureReason }
  | { type: 'decision'; photoId: string; decision: 'deliver' | 'wait' | 'below-threshold' | 'already-delivered' | 'nothing' | 'skipped' | 'revisit'; detail: string; conceptId?: string }
  | { type: 'cue'; kind: 'discovery' | 'hold' | 'toggle'; spoken?: string }
  | { type: 'status'; status: GlassesStatus }
  | { type: 'settings'; settings: Settings };

export interface BackgroundDeps {
  pipeline: RecognitionPipeline;
  trace: (t: Trace) => void;
  initialSettings?: Partial<Settings>;
}

export interface BackgroundHandle {
  setSpeed(s: number): void;
  reset(): void;
}

export function livingPagesBackground(deps: BackgroundDeps) {
  return (session: MiniappSession): BackgroundHandle => {
    const { pipeline, trace } = deps;
    const settings: Settings = { scanIntervalMs: 1800, audio: 'on', autoOpen: true, showPipeline: true, rendererOverride: null, ...deps.initialSettings };
    const status: GlassesStatus = { connected: true, battery: session.device.battery(), scanning: true, lastCaptureAt: null };
    let detections: Detection[] = [];
    let pending: Detection[] = [];
    const streak = new Map<string, number>();
    const cuedPages = new Set<string>();
    const hintedPages = new Set<string>();
    let lastPageId: string | null = null;
    let quietKey: string | null = null; // avoid repeating the same log line every frame
    let busy = false;
    let forced: CaptureReason | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let speed = 1;

    const pushStatus = () => {
      status.battery = session.device.battery();
      session.ui.send('status', { ...status });
      trace({ type: 'status', status: { ...status } });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, settings.scanIntervalMs / speed);
    };

    async function tick() {
      if (forced) {
        const r = forced;
        forced = null;
        await capture(r);
      } else if (status.scanning) await capture('scan');
      schedule();
    }

    async function capture(reason: CaptureReason) {
      if (busy) {
        if (reason !== 'scan') forced = reason;
        return;
      }
      busy = true;
      try {
        const photo = await session.camera.takePhoto({ reason });
        status.lastCaptureAt = Date.now();
        trace({ type: 'capture', photo });
        const result = await pipeline.analyze(photo, (event) => trace({ type: 'stage', event }));
        trace({ type: 'result', result, reason });
        decide(result, photo, reason);
        pushStatus();
      } finally {
        busy = false;
      }
      if (forced) {
        const r = forced;
        forced = null;
        void capture(r);
      }
    }

    function decide(result: PipelineResult, photo: Photo, reason: CaptureReason) {
      const pid = photo.id;
      if (result.skipped) {
        trace({ type: 'decision', photoId: pid, decision: 'skipped', detail: result.skipped });
        if (reason !== 'scan' && settings.audio === 'on') void session.speaker.speak('Hold the page steady and try again.');
        return;
      }
      const pageId = result.pageId!;
      if (pageId !== lastPageId) {
        lastPageId = pageId;
        quietKey = null;
        streak.clear();
        const prev = detections.find((d) => d.pageId === pageId);
        if (prev) {
          session.ui.send('revisit', { detectionId: prev.id });
          trace({ type: 'decision', photoId: pid, decision: 'revisit', detail: `p.${result.pageNumber} already visualized — surfaced on phone, no cue`, conceptId: prev.conceptId });
          return;
        }
      }
      const fig = result.matches.find((m) => m.regionIndex !== null);
      if (!fig) {
        if (quietKey === `${pageId}|none`) return;
        quietKey = `${pageId}|none`;
        const t = result.matches[0];
        trace({ type: 'decision', photoId: pid, decision: t ? 'below-threshold' : 'nothing', detail: t ? `${t.conceptId} ${(t.confidence * 100) | 0}% — ${t.why}` : 'nothing to visualize on this page' });
        return;
      }
      const key = `${pageId}|${fig.conceptId}`;
      if (detections.some((d) => d.pageId === pageId && d.conceptId === fig.conceptId)) {
        if (quietKey === key) return;
        quietKey = key;
        trace({ type: 'decision', photoId: pid, decision: 'already-delivered', detail: `${fig.conceptId} already on the phone` });
        return;
      }
      if (fig.confidence >= CONFIDENCE_THRESHOLD) {
        const n = (streak.get(key) ?? 0) + 1;
        streak.set(key, n);
        const needed = reason === 'scan' ? FRAMES_REQUIRED : 1;
        if (n >= needed) deliver(result, photo, fig);
        else trace({ type: 'decision', photoId: pid, decision: 'wait', detail: `${fig.conceptId} ${(fig.confidence * 100) | 0}% — confirming (${n}/${needed} frames)`, conceptId: fig.conceptId });
      } else {
        streak.set(key, 0);
        trace({ type: 'decision', photoId: pid, decision: 'below-threshold', detail: `${fig.conceptId} ${(fig.confidence * 100) | 0}% < ${CONFIDENCE_THRESHOLD * 100}% — figure partly in view or at an angle`, conceptId: fig.conceptId });
        if (fig.confidence >= 0.3 && !hintedPages.has(pageId) && settings.audio !== 'off') {
          hintedPages.add(pageId);
          session.speaker.play('earcon://hold');
          trace({ type: 'cue', kind: 'hold' });
        }
      }
    }

    function deliver(result: PipelineResult, photo: Photo, m: PipelineResult['matches'][number]) {
      const e = byConcept(m.conceptId);
      const region = result.regions[m.regionIndex!];
      const extracted = {
        text: result.regions.filter((r) => r.text || r.caption).map((r) => (r.caption ?? r.text)!),
        equations: result.regions.filter((r) => r.latex).map((r) => r.latex!),
        parameters: m.params,
      };
      const figureLabel = region.caption?.match(/^Fig\. [\d.]+/)?.[0] ?? 'Figure';
      const base = { title: e.title, subject: e.subject, figureLabel, extracted };
      const det: Detection = {
        id: `det-${result.pageId}-${e.conceptId}`,
        pageId: result.pageId!,
        pageNumber: result.pageNumber!,
        conceptId: e.conceptId,
        title: e.title,
        subject: e.subject,
        figureLabel,
        summary: e.summary,
        confidence: m.confidence,
        timestamp: Date.now(),
        pagePhoto: photo.url,
        pageQuad: result.pageQuad!,
        scanUrl: result.scanUrl!,
        scanSize: result.scanSize!,
        paperTone: result.paperTone ?? [0.93, 0.9, 0.84],
        regionBox: region.rect,
        extracted,
        renderPlan: { renderer: settings.rendererOverride ?? e.renderer, vizId: e.vizId, params: m.params, videoPrompt: buildVideoPrompt(base) },
      };
      detections = [...detections, det];
      trace({ type: 'decision', photoId: photo.id, decision: 'deliver', detail: `${e.conceptId} ${(m.confidence * 100) | 0}% → sent to phone`, conceptId: e.conceptId });

      // audio: at most one cue per page; the wearer has no display
      if (!cuedPages.has(det.pageId) && settings.audio !== 'off') {
        cuedPages.add(det.pageId);
        session.speaker.play('earcon://discovery');
        let spoken: string | undefined;
        if (settings.audio === 'on') {
          spoken = session.ui.isOpen() ? e.spoken : `${e.spoken.split('.')[0]}. Open Living Pages on your phone.`;
          void session.speaker.speak(spoken);
        }
        trace({ type: 'cue', kind: 'discovery', spoken });
      }
      if (!session.ui.send('discovery', { detection: det, replayed: false })) pending.push(det);
    }

    // ---- inputs from the glasses ---------------------------------------------
    session.input.onButtonPress(({ pressType }) => {
      if (pressType === 'short') void capture('button');
      else setScanning(!status.scanning, true);
    });
    session.transcription.onTranscript(({ text, isFinal }) => {
      if (isFinal && /hey mentra.*(explain|show|what)/i.test(text)) void capture('voice');
    });

    function setScanning(on: boolean, fromGlasses = false) {
      status.scanning = on;
      if (fromGlasses && settings.audio !== 'off') {
        session.speaker.play('earcon://toggle');
        if (settings.audio === 'on') void session.speaker.speak(on ? 'Scanning on.' : 'Scanning paused.');
        trace({ type: 'cue', kind: 'toggle' });
      }
      pushStatus();
    }

    // ---- UI channel -------------------------------------------------------------
    session.ui.on('set-scanning', ({ scanning }) => setScanning(scanning));
    session.ui.on('capture-now', () => void capture('button'));
    session.ui.on('update-settings', (p) => {
      Object.assign(settings, p);
      session.ui.send('settings', { ...settings });
      trace({ type: 'settings', settings: { ...settings } });
      if (p.scanIntervalMs) schedule();
    });
    session.ui.on('detection-opened', () => {});
    session.ui.handle('get-state', () => ({ status: { ...status }, settings: { ...settings }, detections: [...detections] }));
    session.ui.onOpen(() => {
      pushStatus();
      session.ui.send('settings', { ...settings });
      // replay what was found while the phone UI was closed
      for (const d of pending.splice(0)) session.ui.send('discovery', { detection: d, replayed: true });
    });

    schedule();
    trace({ type: 'settings', settings: { ...settings } });
    return {
      setSpeed: (s) => {
        speed = s;
        schedule();
      },
      reset: () => {
        detections = [];
        pending = [];
        streak.clear();
        cuedPages.clear();
        hintedPages.clear();
        lastPageId = null;
        status.scanning = true;
        pushStatus();
      },
    };
  };
}
