// PictureThis background logic, independent of the SDK entry so the dev
// harness can run the exact same loop against a mock session.
//
// Runs in a bare JS engine: no DOM, no performance, no Node. Only fetch,
// timers, localStorage/session.storage, atob/btoa, crypto.randomUUID.
import type { CaptureReason, Discovery, FrameTrace, GlassesStatus, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { AppState } from '../shared/channels';
import { chimeDataUrl, dingDataUrl, errorToneDataUrl } from './chime';

/** The subset of MiniappSession this app uses (structurally typed). */
export interface LpSession {
  capabilities: { [k: string]: unknown } | null;
  camera: {
    takePhoto(o: { size?: 'low' | 'medium' | 'high' | 'max'; compress?: 'none' | 'low' | 'medium' | 'high'; sound?: boolean; timeoutMs?: number; mode?: 'photo' | 'text'; transferMethod?: 'auto' | 'direct' | 'ble'; aeExposureDivisor?: number; isoCap?: number }): Promise<{ photoUrl: string; mimeType: string; size: number; requestId: string }>;
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
  const status: GlassesStatus = { connected: false, hasCamera: false, scanning: false, lastCaptureAt: null, lastResult: 'starting', error: null, failure: null, capture: null };
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
  const ding = dingDataUrl();
  const errorTone = errorToneDataUrl();
  /** the current manual look has already been retried once automatically */
  let manualRetried = false;
  /** a new manual request: start fresh (one automatic retry) and clear the old failure */
  const manualRequest = () => {
    manualRetried = false;
    status.failure = null;
  };
  /** a manual look gave up: tell the wearer why and how to try again */
  function manualFailed(why: string) {
    manualRetried = false;
    status.failure = `${why} Tap the glasses button or “Look now” to try again.`;
    status.lastResult = 'couldn’t get a photo';
    pushStatus();
    logCapture('manual-FAIL', 0, why);
    if (settings.sounds === 'voice') void session.speaker.speak('Couldn’t get that photo. Tap the button to try again.').catch(() => {});
    else if (settings.sounds === 'chime') void session.speaker.play({ audioUrl: errorTone, volume: 0.7 }).catch(() => {});
  }

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
  session.ui.on('capture-now', () => {
    manualRequest();
    void capture('button');
  });
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
  session.ui.on('forget-discovery', ({ discoveryId }) => {
    const d = discoveries.find((x) => x.id === discoveryId);
    discoveries = discoveries.filter((x) => x.id !== discoveryId);
    pending = pending.filter((x) => x.id !== discoveryId);
    // looking at that page again rediscovers it, with a chime
    if (d) {
      cuedPages.delete(d.pageKey);
      if (lastRevisitPage === d.pageKey) lastRevisitPage = null;
    }
    persist();
    void fetch(`${server}/v1/sessions/${encodeURIComponent(sessionId)}/discoveries/${encodeURIComponent(discoveryId)}`, { method: 'DELETE' }).catch(() => {});
  });
  session.ui.on('forget-discoveries', () => {
    discoveries = [];
    pending = [];
    cuedPages.clear();
    lastRevisitPage = null;
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
    // a ding confirms the press registered (the discovery chime is a different, two-note bell)
    if (settings.sounds !== 'off') void session.speaker.play({ audioUrl: ding, volume: 0.7 }).catch(() => {});
    manualRequest();
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
    // 'max' still comes back 1280x960 in scan-exposure mode (same as medium), just
    // as a bigger file: medium keeps uploads short for the same pixels
    auto: { size: 'medium', compress: 'medium' },
    text: { size: 'medium', compress: 'high', mode: 'text', transferMethod: 'ble' },
  } as const;
  /**
   * White pages blow out under auto-exposure. The glasses meter as usual, then
   * divide the metered exposure by aeExposureDivisor (scan mode). Without an
   * ISO cap the camera can win the brightness back with gain, so cap it too.
   * The server logs luma/clipped% per frame (stage_log 'gate'): aim for
   * clipped well under 5%. Raise the divisor / lower the cap if still washed out.
   */
  const EXPOSURE = { aeExposureDivisor: 4.5, isoCap: 300 } as const;
  let delivery: keyof typeof DELIVERY = 'auto';
  let deliveryOkCount = 0;
  let captureCount = 0;
  /**
   * When a capture times out the glasses are still busy with that photo (the
   * Mentra App stopped waiting, the glasses didn't), so any request before this
   * time is rejected with CAMERA_BUSY / BLE_TRANSFER_BUSY. Hold captures until then.
   */
  let cameraFreeAt = 0;
  const STUCK_PHOTO_MS = 20000;
  const BUSY_RETRY_MS = 5000;
  const logCapture = (stage: string, ms: number, detail: string) =>
    void fetch(`${server}/v1/log`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, stage, ms, detail }) }).catch(() => {});
  function schedule() {
    if (timer) clearTimeout(timer);
    const wait = forced ? 0 : settings.scanIntervalMs + backoffMs;
    timer = setTimeout(tick, Math.max(wait, cameraFreeAt - Date.now()));
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
    if (Date.now() < cameraFreeAt) {
      // the glasses are still finishing an earlier photo: a request now would just bounce
      if (reason !== 'scan') forced = reason;
      status.lastResult = `waiting for the glasses to finish the last photo (${Math.ceil((cameraFreeAt - Date.now()) / 1000)} s)…`;
      pushStatus();
      schedule();
      return;
    }
    refreshCaps();
    if (!status.hasCamera) {
      status.lastResult = status.connected ? 'these glasses have no camera' : 'waiting for glasses';
      pushStatus();
      if (reason !== 'scan') manualFailed(status.connected ? 'These glasses have no camera.' : 'Your glasses aren’t connected. Reconnect them in the Mentra app.');
      return;
    }
    busy = true;
    const used = delivery; // the delivery path this attempt uses
    const trace: FrameTrace = { id: crypto.randomUUID().slice(0, 8), reason, startedAt: Date.now(), timings: {}, status: 'capturing' };
    try {
      const t0 = Date.now();
      // resolves after the photo has been uploaded; we only ever forward the URL
      // 45 s: without Wi-Fi the glasses relay the photo over BLE, which is slow
      const photo = await session.camera.takePhoto({ ...DELIVERY[delivery], ...EXPOSURE, sound: false, timeoutMs: 45000 });
      trace.timings.capture = Date.now() - t0;
      captureMs.push(trace.timings.capture);
      if (captureMs.length > 20) captureMs.shift();
      const sorted = [...captureMs].sort((a, b) => a - b);
      status.capture = { n: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))], last: trace.timings.capture };
      trace.photoUrl = photo.photoUrl;
      status.lastCaptureAt = Date.now();
      backoffMs = 0;
      if (reason !== 'scan') manualRetried = false;
      status.failure = null;
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
      if (/BUSY/.test(code)) cameraFreeAt = Date.now() + BUSY_RETRY_MS;
      if (/POLL_FAILED|TIMEOUT/.test(code)) {
        // the timed-out photo is still transferring on the glasses: let it clear first
        cameraFreeAt = Date.now() + STUCK_PHOTO_MS;
        backoffMs = 0;
        if (delivery === 'auto') {
          delivery = 'text';
          deliveryOkCount = 0;
        }
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
      else if (/TIMEOUT|POLL_FAILED/.test(code)) status.lastResult = `photo ${used === 'auto' ? 'upload' : 'transfer'} timed out; ${delivery !== used ? 'switching to Bluetooth text mode, ' : ''}retrying in ${Math.round(STUCK_PHOTO_MS / 1000)} s`;
      else status.lastResult = `couldn’t take a photo (${code || 'error'}: ${String(e?.message ?? '').slice(0, 80)})`;
      // a manual look: retry once by itself (after the camera frees up), then tell the wearer
      if (reason !== 'scan' && !status.error) {
        if (!manualRetried && code !== 'NOT_CONNECTED') {
          manualRetried = true;
          forced = reason;
          cameraFreeAt = Math.max(cameraFreeAt, Date.now() + 2000);
          status.lastResult = `that didn’t work; trying once more in ${Math.ceil((cameraFreeAt - Date.now()) / 1000)} s…`;
        } else {
          manualFailed(
            code === 'NOT_CONNECTED' ? 'Your glasses disconnected.'
            : /TIMEOUT|POLL_FAILED/.test(code) ? 'The photo didn’t come through from the glasses. Check that they’re on Wi-Fi.'
            : /BUSY/.test(code) ? 'The camera was still busy with an earlier photo.'
            : code ? 'The glasses couldn’t take the photo.'
            : 'Couldn’t reach the PictureThis server. Check your phone’s connection.'
          );
        }
      }
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
    else if (s === 'error') {
      status.lastResult = 'server problem';
      if (reason !== 'scan') manualFailed('The PictureThis server couldn’t read that photo.');
    }
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
