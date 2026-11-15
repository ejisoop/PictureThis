// A mock MiniappSession + UI bridge matching the SDK shapes we use, so the
// miniapp's real background loop and real UI run in a browser without glasses.
import type { LpSession } from '../../miniapp/src/background/core';

type Cb = (p: any) => void;

export interface MockEvents {
  speak?: (text: string) => void;
  play?: (url: string) => void;
  uiOpen?: (open: boolean) => void;
}

export function createMock(o: { server: string; photo: () => Promise<Blob | null>; events: MockEvents; captureDelayMs?: () => number }) {
  let uiOpen = false;
  const bgListeners = new Map<string, Set<Cb>>(); // UI → background broadcast
  const rpc = new Map<string, (p: any) => unknown>();
  const uiListeners = new Map<string, Set<Cb>>(); // background → UI
  const openCbs = new Set<() => void>(), closeCbs = new Set<() => void>();
  const uiOpenCbs = new Set<() => void>(), uiCloseCbs = new Set<() => void>();
  let buttonCb: ((d: { buttonId: string; pressType: 'short' | 'long' }) => void) | null = null;
  const caps = { hasCamera: true as boolean, display: null };
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  const add = (m: Map<string, Set<Cb>>, k: string, cb: Cb) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(cb);
    return () => m.get(k)!.delete(cb);
  };

  const session: LpSession & { capabilities: any } = {
    capabilities: caps,
    camera: {
      async takePhoto() {
        await new Promise((r) => setTimeout(r, o.captureDelayMs?.() ?? 0));
        const blob = await o.photo();
        if (!blob) throw { code: 'INTERNAL', message: 'no photo source selected in the harness' };
        const res = await fetch(`${o.server}/v1/uploads`, { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
        if (!res.ok) throw { code: 'INTERNAL', message: `upload failed: HTTP ${res.status}` };
        return res.json();
      },
    },
    input: {
      onButtonPress(h) {
        buttonCb = h;
        return () => (buttonCb = null);
      },
    },
    speaker: {
      async play({ audioUrl }) {
        o.events.play?.(audioUrl);
        const a = new Audio(audioUrl);
        await a.play().catch(() => {});
        await new Promise((r) => (a.onended = r));
      },
      async speak(text) {
        o.events.speak?.(text);
        if ('speechSynthesis' in window) {
          await new Promise<void>((r) => {
            const u = new SpeechSynthesisUtterance(text);
            u.onend = () => r();
            u.onerror = () => r();
            speechSynthesis.speak(u);
            setTimeout(r, 8000);
          });
        }
        return { completed: true };
      },
    },
    storage: {
      async get(k) {
        return localStorage.getItem(`lp-harness:${k}`);
      },
      async set(k, v) {
        localStorage.setItem(`lp-harness:${k}`, String(v));
      },
    },
    ui: {
      isOpen: () => uiOpen,
      onOpen(cb) {
        openCbs.add(cb);
        if (uiOpen) cb();
        return () => openCbs.delete(cb);
      },
      onClose(cb) {
        closeCbs.add(cb);
        return () => closeCbs.delete(cb);
      },
      send(ch, p) {
        if (!uiOpen) return; // the real host drops sends when no WebView is bound
        for (const cb of uiListeners.get(ch) ?? []) setTimeout(() => cb(clone(p)));
      },
      on: (ch, cb) => add(bgListeners, ch, cb),
      handle(ch, h) {
        if (rpc.has(ch)) throw new Error(`handler for ${ch} already registered`);
        rpc.set(ch, h);
        return () => rpc.delete(ch);
      },
    },
  };

  /** what the phone page installs as `window.mentra` */
  function bridge() {
    let ready = false;
    const outbox: [string, unknown][] = [];
    const deliver = (ch: string, p: unknown) => {
      for (const cb of bgListeners.get(ch) ?? []) setTimeout(() => cb(clone(p)));
    };
    return {
      send(ch: string, p: unknown) {
        if (!ready) outbox.push([ch, p]);
        else deliver(ch, p);
      },
      on: (ch: string, cb: Cb) => add(uiListeners, ch, cb),
      async request(ch: string, p: unknown, opts?: { timeout?: number }) {
        const h = rpc.get(ch);
        if (!h) throw Object.assign(new Error(`no handler registered for ${ch}`), { name: 'MentraRpcError' });
        const run = Promise.resolve(h(clone(p))).then(clone);
        if (!opts?.timeout) return run;
        return Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'MentraRpcTimeoutError' })), opts.timeout))]);
      },
      onOpen(cb: () => void) {
        uiOpenCbs.add(cb);
        if (uiOpen) cb();
        return () => uiOpenCbs.delete(cb);
      },
      onClose(cb: () => void) {
        uiCloseCbs.add(cb);
        return () => uiCloseCbs.delete(cb);
      },
      ready() {
        if (ready) return;
        ready = true;
        for (const [ch, p] of outbox.splice(0)) deliver(ch, p);
        uiOpen = true;
        o.events.uiOpen?.(true);
        for (const cb of openCbs) cb();
        for (const cb of uiOpenCbs) cb();
      },
    };
  }

  return {
    session,
    bridge,
    /** the phone UI was closed (iframe removed) */
    closeUi() {
      if (!uiOpen) return;
      uiOpen = false;
      uiListeners.clear();
      uiOpenCbs.clear();
      uiCloseCbs.clear();
      o.events.uiOpen?.(false);
      for (const cb of closeCbs) cb();
    },
    press(pressType: 'short' | 'long') {
      buttonCb?.({ buttonId: 'main', pressType });
    },
    setHasCamera(v: boolean) {
      caps.hasCamera = v;
    },
  };
}
