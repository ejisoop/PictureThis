// PictureThis dev harness: the real miniapp (background loop + phone UI)
// against a mock Mentra session, with photo sources and a pipeline view.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-600.css';
import './harness.css';
import { createMock } from './mock';
import { livingPagesBackground } from '../../miniapp/src/background/core';
import type { FrameTrace } from '../../miniapp/src/shared/types';
import { squareToQuad, applyH, type Quad } from '@lp/runtime/host';

const SERVER = (new URLSearchParams(location.search).get('server') ?? 'http://localhost:8787').replace(/\/$/, '');

// ---- photo source --------------------------------------------------------------
type Source = { kind: 'none' } | { kind: 'eval'; file: string } | { kind: 'upload'; name: string; blob: Blob } | { kind: 'webcam' };
let source: Source = { kind: 'none' };
let video: HTMLVideoElement | null = null;
async function currentPhoto(): Promise<Blob | null> {
  if (source.kind === 'eval') return (await fetch(`/evals/pages/${encodeURIComponent(source.file)}`)).blob();
  if (source.kind === 'upload') return source.blob;
  if (source.kind === 'webcam' && video && video.videoWidth) {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')!.drawImage(video, 0, 0);
    return new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.88));
  }
  return null;
}

// ---- record server responses for the pipeline view (debug mode) -------------------
const frameResponses = new Map<string, any>(); // photoUrl → /v1/frames JSON
const origFetch = window.fetch.bind(window);
(window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/v1/frames') && init?.body) {
    const body = JSON.parse(String(init.body));
    const res = await origFetch(input, { ...init, body: JSON.stringify({ ...body, debug: true }) });
    res.clone().json().then((j) => frameResponses.set(body.photoUrl, j)).catch(() => {});
    return res;
  }
  return origFetch(input, init);
};

// ---- mock session + the real background --------------------------------------------------
type Caption = { text: string; kind: 'voice' | 'chime'; at: number } | null;
const bus = new EventTarget();
const emit = (type: string, detail: unknown) => bus.dispatchEvent(new CustomEvent(type, { detail }));
let colorScheme: 'light' | 'dark' = 'light';
const mock = createMock({
  server: SERVER,
  photo: currentPhoto,
  captureDelayMs: () => 350, // camera + BLE/WiFi transfer stand-in
  events: {
    speak: (text) => emit('caption', { text, kind: 'voice', at: Date.now() }),
    play: () => emit('caption', { text: '♪ chime', kind: 'chime', at: Date.now() }),
    uiOpen: (open) => emit('ui', open),
  },
});
(window as any).__lpHarness = {
  bridge: () => mock.bridge(),
  mentraOS: () => ({
    platform: 'harness',
    miniappDeveloperMode: true,
    safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 },
    capsuleMenu: { top: 53, right: 382, bottom: 85, left: 295, width: 87, height: 32 },
    colorScheme,
  }),
};
const traces: (FrameTrace & { at: number })[] = [];
const bg = livingPagesBackground(mock.session, {
  server: SERVER,
  onTrace: (t) => {
    traces.unshift({ ...t, at: Date.now() });
    traces.length = Math.min(traces.length, 60);
    emit('trace', t);
  },
});

// ---- React ---------------------------------------------------------------------------------
function Harness() {
  const [files, setFiles] = useState<string[]>([]);
  const [src, setSrc] = useState<Source>({ kind: 'none' });
  const [preview, setPreview] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(true);
  const [phoneKey, setPhoneKey] = useState(0);
  const [caption, setCaption] = useState<Caption>(null);
  const [, setTick] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [scanning, setScanning] = useState(true);
  const [hasCamera, setHasCamera] = useState(true);
  const [dark, setDark] = useState(false);
  const [explore, setExplore] = useState<Record<string, { state: string; t: number; source?: string }[]>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const phoneRef = useRef<HTMLIFrameElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  useEffect(() => {
    fetch('/evals/pages').then((r) => r.json()).then(setFiles);
    fetch(`${SERVER}/v1/health`).then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    const on = (t: string, f: (e: any) => void) => {
      const h = (e: Event) => f((e as CustomEvent).detail);
      bus.addEventListener(t, h);
      return () => bus.removeEventListener(t, h);
    };
    const offs = [
      on('trace', () => {
        setTick((x) => x + 1);
        bg.then((b) => setScanning(b.state().status.scanning));
      }),
      on('caption', (c) => {
        setCaption(c);
        setTimeout(() => setCaption((x) => (x === c ? null : x)), 3500);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // explore events from the phone iframe (generation → render timing)
  useEffect(() => {
    const w = phoneRef.current?.contentWindow;
    if (!w) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setExplore((x) => ({ ...x, [d.discoveryId]: [...(x[d.discoveryId] ?? []), d].slice(-20) }));
    };
    w.addEventListener('lp-explore', h);
    return () => w.removeEventListener('lp-explore', h);
  }, [phoneKey, phoneOpen]);

  const pick = async (s: Source) => {
    source = s;
    setSrc(s);
    if (s.kind !== 'webcam' && video) {
      (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      video = null;
    }
    if (s.kind === 'webcam') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080, facingMode: 'environment' } });
      video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setPreview(null);
    } else {
      const b = await currentPhoto();
      setPreview(b ? URL.createObjectURL(b) : null);
    }
  };

  const press = (kind: 'down' | 'up') => {
    if (kind === 'down') {
      held.current = false;
      hold.current = setTimeout(() => {
        held.current = true;
        mock.press('long');
        setTimeout(() => bg.then((b) => setScanning(b.state().status.scanning)), 50);
      }, 650);
    } else {
      if (hold.current) clearTimeout(hold.current);
      if (!held.current) mock.press('short');
    }
  };

  const togglePhone = () => {
    if (phoneOpen) mock.closeUi();
    setPhoneOpen(!phoneOpen);
    setPhoneKey((k) => k + 1);
  };

  const selected = traces.find((t) => t.id === sel) ?? null;
  const resp = selected?.photoUrl ? frameResponses.get(selected.photoUrl) : null;

  return (
    <div className="h-root">
      <header className="h-top">
        <div className="brand"><span className="mark">✦</span> PictureThis <em>dev harness</em></div>
        <div className="h-status">
          server {health ? (health.ok ? <b className="ok">● {SERVER}</b> : <b className="bad">● unreachable</b>) : '…'}
          {health?.ok && <span> · vision <i>{health.visionModel}</i> · code <i>{health.codeModel}</i> · runtime {health.runtime}{health.gemini ? '' : ' · NO GEMINI KEY'}</span>}
        </div>
      </header>
      <main className="h-main">
        {/* glasses ---------------------------------------------------------------------- */}
        <section className="pane glasses">
          <div className="pane-label"><b>The glasses</b> — what Mentra Live’s camera sees</div>
          <div className="sources">
            <select value={src.kind === 'eval' ? src.file : ''} onChange={(e) => e.target.value && pick({ kind: 'eval', file: e.target.value })}>
              <option value="">— eval page —</option>
              {files.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <label className="btn">upload<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick({ kind: 'upload', name: f.name, blob: f }); }} /></label>
            <button className="btn" onClick={() => pick({ kind: 'webcam' })}>webcam</button>
            <button className="btn quiet" onClick={() => pick({ kind: 'none' })}>look away</button>
          </div>
          <div className="feed">
            <video ref={videoRef} muted playsInline style={{ display: src.kind === 'webcam' ? 'block' : 'none' }} />
            {src.kind !== 'webcam' && (preview ? <img src={preview} alt="" /> : <div className="nothing">no page in view — pick an eval page, upload a photo or use the webcam</div>)}
            <div className={`led ${scanning ? 'on' : ''}`}>{scanning ? 'camera on · scanning' : 'paused'}</div>
            {caption && <div className={`speaker ${caption.kind}`}>{caption.kind === 'voice' ? '🔈 ' : ''}{caption.text}</div>}
          </div>
          <div className="glasses-bar">
            <button className="gbtn" onPointerDown={() => press('down')} onPointerUp={() => press('up')} onPointerLeave={() => hold.current && clearTimeout(hold.current)}>
              <span className="dot" /><span><b>Glasses button</b><em>tap = look now · hold = pause</em></span>
            </button>
            <label className="chk"><input type="checkbox" checked={hasCamera} onChange={(e) => { setHasCamera(e.target.checked); mock.setHasCamera(e.target.checked); }} /> has camera</label>
            <label className="chk"><input type="checkbox" checked={dark} onChange={(e) => { colorScheme = e.target.checked ? 'dark' : 'light'; setDark(e.target.checked); setPhoneKey((k) => k + 1); mock.closeUi(); }} /> dark</label>
          </div>
        </section>

        {/* phone ------------------------------------------------------------------------- */}
        <section className="pane phone-pane">
          <div className="pane-label"><b>The phone</b> — PictureThis inside the Mentra app <button className="btn quiet" onClick={togglePhone}>{phoneOpen ? 'close app' : 'open app'}</button></div>
          <div className="phone">
            {phoneOpen ? <iframe key={phoneKey} ref={phoneRef} src="/phone" title="phone" /> : <div className="phone-off">PictureThis is closed.<br />Discoveries found now are queued and replayed when you reopen it.</div>}
          </div>
        </section>

        {/* pipeline ---------------------------------------------------------------------- */}
        <section className="pane pipeline-pane">
          <div className="pane-label"><b>Pipeline</b> — capture → gate → understand → chime → generate → render</div>
          <div className="timeline">
            {traces.map((t) => <TraceRow key={t.id} t={t} sel={t.id === sel} onClick={() => setSel(t.id === sel ? null : t.id)} explore={explore} resp={t.photoUrl ? frameResponses.get(t.photoUrl) : null} />)}
            {!traces.length && <div className="empty">Frames appear here as the glasses capture them.</div>}
          </div>
          {selected && <TraceDetail t={selected} resp={resp} />}
        </section>
      </main>
    </div>
  );
}

const COLORS: Record<string, string> = { capture: '#9db7cf', download: '#c4b5dc', gate: '#f1d68c', understand: '#e8907e', decide: '#9fb79a', generate: '#8f7db5', render: '#6f8f6c' };

function TraceRow({ t, sel, onClick, explore, resp }: { t: FrameTrace & { at: number }; sel: boolean; onClick: () => void; explore: Record<string, { state: string; t: number }[]>; resp: any }) {
  const stages: [string, number][] = (['capture', 'download', 'gate', 'understand', 'decide'] as const).filter((k) => t.timings[k]).map((k) => [k, t.timings[k]]);
  const chimeAt = stages.reduce((s, [, v]) => s + v, 0);
  // generation + render for discoveries on this frame
  for (const d of resp?.discoveries ?? []) {
    const ev = explore[d.id];
    const inter = ev?.find((e) => e.state === 'interactive');
    const ready = ev?.find((e) => e.state === 'ready');
    const t0 = t.startedAt + chimeAt;
    if (ready) stages.push(['generate', Math.max(0, ready.t - t0)]);
    if (ready && inter) stages.push(['render', inter.t - ready.t]);
    break;
  }
  const total = stages.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <button className={`trace ${sel ? 'sel' : ''} st-${t.status}`} onClick={onClick}>
      <span className="when">{new Date(t.at).toLocaleTimeString()}</span>
      <span className="why">{t.reason === 'scan' ? 'scan' : '◎ ' + t.reason}</span>
      <span className="bars">{stages.map(([k, v]) => <i key={k} title={`${k}: ${Math.round(v)} ms`} style={{ flexGrow: v / total, background: COLORS[k] }}>{v / total > 0.12 ? `${k} ${(v / 1000).toFixed(1)}s` : ''}</i>)}</span>
      <span className="status">{t.status}{t.status === 'discovery' ? ` · chime @ ${(chimeAt / 1000).toFixed(1)} s` : ''}</span>
    </button>
  );
}

function TraceDetail({ t, resp }: { t: FrameTrace; resp: any }) {
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [viz, setViz] = useState<Record<string, any>>({});
  const page = resp?.page;
  useEffect(() => {
    for (const d of resp?.discoveries ?? []) {
      fetch(`${SERVER}/v1/visualizations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ discoveryId: d.id }) })
        .then((r) => r.json())
        .then((j) => {
          if (j.viz) setViz((v) => ({ ...v, [d.id]: j.viz }));
          else {
            const es = new EventSource(SERVER + j.events);
            const done = (ev: MessageEvent) => {
              const e = JSON.parse(ev.data);
              setViz((v) => ({ ...v, [d.id]: e.viz ?? { validation: { ok: false, errors: e.errors } } }));
              es.close();
            };
            es.addEventListener('done', done);
            es.addEventListener('failed', done);
            es.addEventListener('progress', (ev) => setViz((v) => ({ ...v, [d.id]: { progress: JSON.parse((ev as MessageEvent).data).message } })));
          }
        });
    }
  }, [resp]);
  // map page-space boxes onto the photo through the page corners
  const H = page ? squareToQuad(page.pageCorners as Quad) : null;
  const poly = (b: any) => H && [applyH(H, b.x0, b.y0), applyH(H, b.x1, b.y0), applyH(H, b.x1, b.y1), applyH(H, b.x0, b.y1)].map(([x, y]) => `${x * (img?.w ?? 1)},${y * (img?.h ?? 1)}`).join(' ');
  return (
    <div className="detail">
      <div className="d-photo">
        {t.photoUrl && <img src={t.photoUrl} alt="" onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        {img && page && (
          <svg viewBox={`0 0 ${img.w} ${img.h}`}>
            <polygon points={poly({ x0: 0, y0: 0, x1: 1, y1: 1 })!} className="pagequad" />
            {page.regions.map((r: any, i: number) => <polygon key={i} points={poly(r.box)!} className={`reg ${r.kind}`}><title>{r.kind}: {r.latex || r.text}</title></polygon>)}
            {page.figures.map((f: any, i: number) => <polygon key={'f' + i} points={poly(f.box)!} className={`fig ${f.visualizable >= 0.75 ? 'yes' : 'no'}`}><title>{f.title} {(f.visualizable * 100) | 0}%</title></polygon>)}
          </svg>
        )}
      </div>
      <div className="d-info">
        <div><b>gate</b> sharpness {t.gate?.sharpness} · {t.gate?.decision} {t.gate?.reason ?? ''}</div>
        <div><b>timings</b> {Object.entries(t.timings).map(([k, v]) => `${k} ${Math.round(v as number)}ms`).join(' · ')}</div>
        {t.detail && <div className="err">{t.detail}</div>}
        {page?.figures?.map((f: any) => <div key={f.id} className="figline"><b>{f.label || f.id}</b> {f.title} — {f.concept} · {(f.visualizable * 100) | 0}% <i>{f.why}</i></div>)}
        {(resp?.discoveries ?? []).map((d: any) => {
          const v = viz[d.id];
          return (
            <div key={d.id} className="viz">
              <div><b>visualization</b> {d.title}: {v?.progress ?? (v ? `${v.validation?.ok ? 'validated' : 'FAILED'} · ${v.source ?? ''} · ${v.attempts ?? 0} attempt(s) · ${Math.round((v.timings?.total ?? 0) / 100) / 10} s` : '…')}</div>
              {v?.validation?.errors?.length > 0 && <pre className="errs">{v.validation.errors.join('\n')}</pre>}
              {v?.screenshot && <img className="shot" src={SERVER + v.screenshot} alt="smoke test" />}
              {v?.code && <details><summary>generated code</summary><pre>{v.code}</pre></details>}
            </div>
          );
        })}
        {resp && <details><summary>Gemini JSON</summary><pre>{JSON.stringify(resp.raw ?? resp, null, 2)}</pre></details>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('harness')!).render(<Harness />);
