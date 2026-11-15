// PictureThis background logic, independent of the SDK entry so the dev
// harness can run the exact same loop against a mock session.
//
// Runs in a bare JS engine: no DOM, no performance, no Node. Only fetch,
// timers, localStorage/session.storage, atob/btoa, crypto.randomUUID.
import type { CaptureReason, Discovery, FrameTrace, GlassesStatus, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { AppState } from '../shared/channels';
import { chimeDataUrl } from './chime';

/** The subset of MiniappSession this app uses (structurally typed). */
export interface LpSession {
  capabilities: { [k: string]: unknown } | null;
  camera: {
    takePhoto(o: { size?: 'low' | 'medium' | 'high' | 'max'; compress?: 'none' | 'low' | 'medium' | 'high'; sound?: boolean; timeoutMs?: number; mode?: 'photo' | 'text'; transferMethod?: 'auto' | 'direct' | 'ble' }): Promise<{ photoUrl: string; mimeType: string; size: number; requestId: string }>;
  };
  input: {
    onButtonPress(h: (d: { buttonId: string; pressType: 'short' | 'long' }) => void): () => void;
    /** temple touch gestures (single_tap, double_tap, long_press, swipe_up/down…) */
    onTouch?(h: (d: { kind: string }) => void): () => void;
  };
  speaker: { play(o: { audioUrl: string; volume?: number; stopOtherAudio?: boolean }): Promise<void>; speak(text: string, o?: { stopOtherAudio?: boolean }): Promise<unknown> };
  storage: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };
  ui: {
    isOpen(): boolean;
    onOpen(cb: () => void): () => void;
    onClose(cb: () => void): () => void;
    send(channel: string, payload: unknown): void;
    on(channel: string, cb: (p: any) => void): () => void;
    handle(channel: string, h: (p: any) => unknown): () => void;
  };
}

export interface BackgroundConfig {
  server: string;
  /** called with each frame trace (the harness shows these even with the UI closed) */
  onTrace?: (t: FrameTrace) => void;
}

const MAX_DISCOVERIES = 40;

export async function livingPagesBackground(session: LpSession, cfg: BackgroundConfig) {
  const server = cfg.server.replace(/\/$/, '');
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const status: GlassesStatus = { connected: false, hasCamera: false, scanning: true, lastCaptureAt: null, lastResult: 'starting', error: null, capture: null };
  const captureMs: number[] = [];
  let discoveries: Discovery[] = [];
  let pending: Discovery[] = []; // found while the UI was closed
  const cuedPages = new Set<string>(); // chime at most once per page
  let lastRevisitPage: string | null = null;
  let busy = false;
  let forced: CaptureReason | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sessionId = '';
  const chime = chimeDataUrl();

  // ---- UI handlers first: the host holds UI requests until setup settles --------
  const state = (): AppState => ({ status: { ...status }, settings: { ...settings }, discoveries: [...discoveries], server });
  session.ui.handle('get-state', () => state());
  const pushStatus = () => session.ui.send('status', { ...status });
  const persist = () => {
    void session.storage.set('settings', JSON.stringify(settings)).catch(() => {});
    void session.storage.set('discoveries', JSON.stringify(discoveries.slice(0, MAX_DISCOVERIES))).catch(() => {});
    void session.storage.set('cuedPages', JSON.stringify([...cuedPages].slice(-200))).catch(() => {});
  };

  session.ui.on('set-scanning', ({ scanning }) => setScanning(!!scanning, false));
  session.ui.on('capture-now', () => void capture('button'));
  session.ui.on('update-settings', (p: Partial<Settings>) => {
    if (typeof p.scanIntervalMs === 'number') settings.scanIntervalMs = Math.min(10000, Math.max(1000, p.scanIntervalMs));
    if (p.sounds === 'voice' || p.sounds === 'chime' || p.sounds === 'off') settings.sounds = p.sounds;
    if (typeof p.autoOpen === 'boolean') settings.autoOpen = p.autoOpen;
    if (typeof p.showPipeline === 'boolean') settings.showPipeline = p.showPipeline;
    session.ui.send('settings', { ...settings });
    persist();
    schedule();
  });
  session.ui.on('discovery-opened', ({ discoveryId }) => {
    pending = pending.filter((d) => d.id !== discoveryId);
  });
  session.ui.on('forget-discoveries', () => {
    discoveries = [];
    pending = [];
    cuedPages.clear();
    persist();
    void fetch(`${server}/v1/sessions/${encodeURIComponent(sessionId)}/reset`, { method: 'POST' }).catch(() => {});
  });
  session.ui.onOpen(() => {
    refreshCaps();
    pushStatus();
    session.ui.send('settings', { ...settings });
    // replay what was found while the phone UI was closed
    for (const d of pending.splice(0)) session.ui.send('discovery', { discovery: d, replayed: true });
  });

  // ---- restore ---------------------------------------------------------------------
  try {
    sessionId = (await session.storage.get('sessionId')) ?? '';
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await session.storage.set('sessionId', sessionId);
    }
    Object.assign(settings, JSON.parse((await session.storage.get('settings')) ?? '{}'));
    discoveries = JSON.parse((await session.storage.get('discoveries')) ?? '[]');
    for (const p of JSON.parse((await session.storage.get('cuedPages')) ?? '[]')) cuedPages.add(p);
  } catch {
    sessionId ||= crypto.randomUUID();
  }

  function refreshCaps() {
    const caps = session.capabilities;
    status.connected = !!caps;
    // hasCamera is documented but not typed by the SDK; treat it as a truthy flag
    status.hasCamera = !!caps && caps.hasCamera !== false;
  }

  // ---- input from the glasses -----------------------------------------------------
  // Short press / single tap = look now (works while paused: "manual mode").
  // Long press = pause or resume scanning. Every input is logged to the server
  // so it's easy to see what the glasses actually send.
  const lookNow = (via: string) => {
    logCapture('input', 0, `${via} → look now${status.scanning ? '' : ' (paused: manual look)'}${busy ? ' (queued: a photo is still arriving)' : ''}`);
    if (!status.scanning || busy) {
      status.lastResult = busy ? 'will look as soon as the current photo arrives' : 'looking now…';
      pushStatus();
    }
    // audible confirmation for manual looks, so the wearer knows the press registered
    if (!status.scanning && settings.sounds === 'voice') void session.speaker.speak('Looking.').catch(() => {});
    void capture('button');
  };
  const toggleScan = (via: string) => {
    logCapture('input', 0, `${via} → ${status.scanning ? 'pause' : 'resume'} scanning`);
    setScanning(!status.scanning, true);
  };
  session.input.onButtonPress(({ buttonId, pressType }) => {
    if (pressType === 'long') toggleScan(`button ${buttonId} long`);
    else lookNow(`button ${buttonId} ${pressType}`);
  });
  session.input.onTouch?.(({ kind }) => {
    if (kind === 'single_tap') lookNow(`touch ${kind}`);
    else if (kind === 'long_press') toggleScan(`touch ${kind}`);
    else logCapture('input', 0, `touch ${kind} (unused)`);
  });

  function setScanning(on: boolean, fromGlasses: boolean) {
    status.scanning = on;
    status.lastResult = on ? 'looking' : 'paused';
    if (fromGlasses && settings.sounds === 'voice') void session.speaker.speak(on ? 'Scanning on.' : 'Scanning paused.').catch(() => {});
    pushStatus();
    schedule();
  }

  // ---- capture loop ----------------------------------------------------------------------
  /** extra wait after camera failures, so we don't pile requests onto a busy camera/BLE link */
  let backoffMs = 0;
  /**
   * Photo delivery. 'auto' lets the glasses upload over Wi-Fi (falling back to
   * BLE). When that times out (the Mentra App gives up after ~30 s with
   * POLL_FAILED), switch to text mode over BLE: smaller, optimised for readable
   * pages, relayed through the phone. Try the fast path again after a while.
   */
  const DELIVERY = {
    auto: { size: 'medium', compress: 'medium' },
    text: { size: 'medium', compress: 'high', mode: 'text', transferMethod: 'ble' },
  } as const;
  let delivery: keyof typeof DELIVERY = 'auto';
  let deliveryOkCount = 0;
  let captureCount = 0;
  const logCapture = (stage: string, ms: number, detail: string) =>
    void fetch(`${server}/v1/log`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, stage, ms, detail }) }).catch(() => {});
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, settings.scanIntervalMs + backoffMs);
  }

  async function tick() {
    try {
      if (forced) {
        const r = forced;
        forced = null;
        await capture(r);
      } else if (status.scanning) await capture('scan');
    } finally {
      schedule();
    }
  }

  async function capture(reason: CaptureReason) {
    if (busy) {
      if (reason !== 'scan') forced = reason;
      return;
    }
    refreshCaps();
    if (!status.hasCamera) {
      status.lastResult = status.connected ? 'these glasses have no camera' : 'waiting for glasses';
      pushStatus();
      return;
    }
    busy = true;
    const used = delivery; // the delivery path this attempt uses
    const trace: FrameTrace = { id: crypto.randomUUID().slice(0, 8), reason, startedAt: Date.now(), timings: {}, status: 'capturing' };
    try {
      const t0 = Date.now();
      // resolves after the photo has been uploaded; we only ever forward the URL
      // 45 s: without Wi-Fi the glasses relay the photo over BLE, which is slow
      const photo = await session.camera.takePhoto({ ...DELIVERY[delivery], sound: false, timeoutMs: 45000 });
      trace.timings.capture = Date.now() - t0;
      captureMs.push(trace.timings.capture);
      if (captureMs.length > 20) captureMs.shift();
      const sorted = [...captureMs].sort((a, b) => a - b);
      status.capture = { n: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))], last: trace.timings.capture };
      trace.photoUrl = photo.photoUrl;
      status.lastCaptureAt = Date.now();
      backoffMs = 0;
      captureCount++;
      // log the first capture, every 10th, and every one in fallback mode (so delivery speed is visible on the server)
      if (captureCount === 1 || captureCount % 10 === 0 || used !== 'auto') logCapture('capture', trace.timings.capture, `ok via ${used} (${photo.size} bytes)`);
      // after a run of good BLE captures, try the faster path again
      if (delivery !== 'auto' && ++deliveryOkCount >= 15) {
        delivery = 'auto';
        deliveryOkCount = 0;
      }
      status.error = null;
      const t1 = Date.now();
      const res = await fetch(`${server}/v1/frames`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoUrl: photo.photoUrl, sessionId, ts: Date.now(), reason }),
      });
      const j = await res.json();
      trace.timings.server = Date.now() - t1;
      Object.assign(trace.timings, j.timings ?? {});
      trace.status = j.status ?? (res.ok ? 'ok' : 'error');
      trace.gate = j.gate;
      decide(j, reason, trace);
    } catch (e: any) {
      // camera errors are plain {code, message} objects
      const code = e?.code ?? '';
      // busy: the previous photo is still transferring; timeouts: slow link (BLE) — wait longer each time, up to 30 s
      backoffMs = /BUSY/.test(code) ? Math.max(backoffMs, 4000) : Math.min(30000, Math.max(5000, backoffMs * 2));
      if (/POLL_FAILED|TIMEOUT/.test(code) && delivery === 'auto') {
        delivery = 'text';
        deliveryOkCount = 0;
        backoffMs = 3000; // the next attempt uses the other path; no need to wait long
      }
      trace.status = 'error';
      trace.detail = `${code} ${e?.message ?? (typeof e === 'object' ? JSON.stringify(e) : e)}`.trim().slice(0, 300);
      // report to the server log so failures on real glasses are visible there
      logCapture('capture-FAIL', Date.now() - trace.startedAt, `${trace.detail} (via ${used}${used !== delivery ? `; next attempt via ${delivery}` : ''})`);
      if (code === 'PERMISSION_NOT_DECLARED' || code === 'PERMISSION_DENIED') {
        status.scanning = false;
        status.error = 'Camera permission is missing';
      } else if (code === 'NOT_CONNECTED') status.lastResult = 'glasses disconnected';
      else if (/BUSY/.test(code)) status.lastResult = 'camera busy, waiting…';
      else if (/TIMEOUT|POLL_FAILED/.test(code)) status.lastResult = delivery === 'text' ? 'photo upload timed out; switching to Bluetooth text mode' : `photo transfer timed out; retrying in ${Math.round((settings.scanIntervalMs + backoffMs) / 1000)} s`;
      else status.lastResult = `couldn’t take a photo (${code || 'error'}: ${String(e?.message ?? '').slice(0, 80)})`;
    } finally {
      busy = false;
      pushStatus();
      cfg.onTrace?.(trace);
      if (settings.showPipeline) session.ui.send('trace', trace);
    }
    if (forced) {
      const r = forced;
      forced = null;
      void capture(r);
    }
  }

  function decide(j: any, reason: CaptureReason, trace: FrameTrace) {
    const s: string = j.status;
    if (s === 'blurry') status.lastResult = 'hold steady';
    else if (s === 'waiting') status.lastResult = 'looking…';
    else if (s === 'no-page') status.lastResult = 'no page in view';
    else if (s === 'nothing') status.lastResult = 'nothing to bring to life here';
    else if (s === 'error') status.lastResult = 'server problem';
    if ((s === 'unchanged' || s === 'already') && j.knownDiscoveries?.length) {
      status.lastResult = 'already explored';
      // surface the earlier discovery once per page visit, without a chime
      if (j.pageKey !== lastRevisitPage) {
        lastRevisitPage = j.pageKey;
        session.ui.send('revisit', { discoveryId: j.knownDiscoveries[0] });
      }
    }
    if (s !== 'discovery') {
      if (reason !== 'scan' && settings.sounds === 'voice' && (s === 'blurry' || s === 'no-page')) void session.speaker.speak('Hold the page steady and try again.').catch(() => {});
      return;
    }
    lastRevisitPage = j.pageKey;
    const fresh: Discovery[] = (j.discoveries ?? []).filter((d: Discovery) => !discoveries.some((x) => x.id === d.id));
    if (!fresh.length) return;
    trace.discoveries = fresh.map((d) => d.title);
    discoveries = [...fresh, ...discoveries].slice(0, MAX_DISCOVERIES);
    status.lastResult = `found ${fresh[0].title}`;
    persist();
    cue(fresh[0]);
    for (const d of fresh) {
      if (session.ui.isOpen()) session.ui.send('discovery', { discovery: d, replayed: false });
      else pending.push(d);
    }
  }

  /** at most one chime per page, never again for a page already delivered */
  function cue(d: Discovery) {
    if (cuedPages.has(d.pageKey) || settings.sounds === 'off') return;
    cuedPages.add(d.pageKey);
    void session.speaker.play({ audioUrl: chime, volume: 0.8 }).then(() => {
      if (settings.sounds !== 'voice') return;
      const where = session.ui.isOpen() ? 'It’s on your phone.' : 'Open PictureThis on your phone.';
      return session.speaker.speak(`${d.title} can come alive. ${where}`);
    }).catch(() => {});
  }

  refreshCaps();
  status.lastResult = status.scanning ? 'looking' : 'paused';
  pushStatus();
  schedule();

  return {
    capture,
    setScanning: (on: boolean) => setScanning(on, false),
    state,
    stop: () => timer && clearTimeout(timer),
  };
}
