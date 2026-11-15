// UI layer of the Living Pages miniapp: a React app in the phone's WebView.
// It reaches the glasses only through the `mentra` messaging object.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MentraUi } from '../mentra/mock';
import type { Detection, GlassesStatus, Settings, AudioMode } from '../shared/types';
import { PhoneStage } from './stage/PhoneStage';
import { Interactive3DRenderer, GeneratedVideoRenderer, type ConceptRenderer, type RenderState } from './renderers';

const MentraCtx = createContext<MentraUi>(null!);
export const useMentra = () => useContext(MentraCtx);

export function MentraProvider({ mentra, children }: { mentra: MentraUi; children: React.ReactNode }) {
  useEffect(() => mentra.ready(), [mentra]);
  return <MentraCtx.Provider value={mentra}>{children}</MentraCtx.Provider>;
}

const emit = (type: string, detail: Record<string, unknown> = {}) => window.dispatchEvent(new CustomEvent('lp-ui', { detail: { type, ...detail } }));
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : `${Math.round(s / 60)} min ago`;
};

type Toast = { kind: 'discovery' | 'revisit' | 'replayed'; det: Detection } | null;

export function App() {
  const mentra = useMentra();
  const [status, setStatus] = useState<GlassesStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dets, setDets] = useState<Detection[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rstate, setRstate] = useState<RenderState>('loading');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [rawPhoto, setRawPhoto] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const stageHost = useRef<HTMLDivElement>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const sheetHost = useRef<HTMLDivElement>(null);
  const stage = useRef<PhoneStage | null>(null);
  const renderer = useRef<ConceptRenderer | null>(null);
  const openRef = useRef<string | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const detsRef = useRef<Detection[]>([]);
  openRef.current = openId;
  settingsRef.current = settings;
  detsRef.current = dets;

  // ---- stage lives as long as the WebView --------------------------------
  useEffect(() => {
    const s = new PhoneStage(stageHost.current!, {
      onPanel: (el) => setPanelEl(el),
      onEntered: () => emit('entered'),
      onExited: () => emit('exited'),
    });
    stage.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const host = sheetHost.current;
    if (host && panelEl && panelEl.parentElement !== host) {
      host.innerHTML = '';
      host.appendChild(panelEl);
    }
  }, [panelEl, rstate]);

  // ---- state from the background ------------------------------------------
  useEffect(() => {
    let alive = true;
    mentra.request('get-state', {}).then((st) => {
      if (!alive) return;
      setStatus(st.status);
      setSettings(st.settings);
      setDets(st.detections);
    });
    const offs = [
      mentra.on('status', setStatus),
      mentra.on('settings', setSettings),
      mentra.on('discovery', ({ detection, replayed }) => {
        setDets((d) => (d.some((x) => x.id === detection.id) ? d : [detection, ...d]));
        setToast({ kind: replayed ? 'replayed' : 'discovery', det: detection });
        emit('toast', { id: detection.id });
        if ((settingsRef.current?.autoOpen ?? true) && !openRef.current) setTimeout(() => open(detection), replayed ? 900 : 1400);
      }),
      mentra.on('revisit', ({ detectionId }) => {
        const det = detsRef.current.find((d) => d.id === detectionId);
        setHighlight(detectionId);
        if (det && openRef.current !== detectionId) setToast({ kind: 'revisit', det });
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [mentra]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- open / close a discovery -------------------------------------------
  const open = useCallback(async (det: Detection) => {
    if (openRef.current === det.id) return;
    setToast(null);
    setOpenId(det.id);
    openRef.current = det.id;
    setSheetOpen(true);
    renderer.current?.dispose();
    const kind = settingsRef.current?.rendererOverride ?? det.renderPlan.renderer;
    renderer.current = kind === 'interactive3d' ? new Interactive3DRenderer(stage.current!, setRstate) : new GeneratedVideoRenderer(videoHost.current!, (s) => setRstate(s));
    mentra.send('detection-opened', { detectionId: det.id });
    emit('opening', { id: det.id });
    // the raw glasses photo first, then the flattened scan
    setRawPhoto(det.pagePhoto);
    setRstate('loading');
    await new Promise((r) => setTimeout(r, 1100));
    if (openRef.current !== det.id) return;
    await renderer.current.mount(det);
    setRawPhoto(null);
    await new Promise((r) => setTimeout(r, 450));
    if (openRef.current !== det.id) return;
    await renderer.current.play();
  }, [mentra]);

  const goHome = useCallback(async () => {
    if (renderer.current && stage.current?.active) await renderer.current.close();
    renderer.current?.dispose();
    renderer.current = null;
    setOpenId(null);
    openRef.current = null;
    setRawPhoto(null);
    emit('home');
  }, []);

  useEffect(() => {
    (window as any).__lpPhone = {
      stage: () => stage.current,
      open: (id: string) => {
        const d = detsRef.current.find((x) => x.id === id) ?? detsRef.current[0];
        if (d) void open(d);
      },
      home: () => goHome(),
      fold: () => renderer.current?.close(),
      lift: () => renderer.current?.play(),
      settings: (on: boolean) => setSettingsOpen(on),
    };
  }, [open, goHome]);

  const det = dets.find((d) => d.id === openId) ?? null;
  const upd = (p: Partial<Settings>) => mentra.send('update-settings', p);

  return (
    <div className={`lp-app ${openId ? 'exploring' : 'home'}`}>
      {/* home ---------------------------------------------------------------- */}
      <section className="home-screen">
        <header className="app-head">
          <div className="app-title">Living Pages</div>
          <div className="app-sub">{status ? <>Mentra Live · {status.battery}%{status.scanning ? <span className="rec"> · camera on</span> : ' · paused'}</> : 'connecting…'}</div>
        </header>
        <div className={`scan-card ${status?.scanning ? 'on' : 'off'}`}>
          <div className="scan-orb"><i /><i /><i /></div>
          <div className="scan-text">
            <b>{status?.scanning ? 'Looking at your page…' : 'Scanning paused'}</b>
            <span>{status?.scanning ? 'Read as usual. I’ll chime when something can come alive.' : 'Tap to resume, or long-press the glasses button.'}</span>
          </div>
          <button className={`switch ${status?.scanning ? 'on' : ''}`} aria-label="Scanning" onClick={() => mentra.send('set-scanning', { scanning: !status?.scanning })}><i /></button>
        </div>
        <div className="section-label">Discoveries <span>{dets.length ? `${dets.length} this session` : ''}</span></div>
        <div className="disc-list">
          {dets.length === 0 && <div className="empty">Nothing yet. When your glasses spot a figure I can bring to life, it’ll appear here.</div>}
          {dets.map((d) => (
            <button key={d.id} className={`disc-card ${highlight === d.id ? 'hl' : ''}`} onClick={() => open(d)}>
              <Thumb det={d} />
              <span className="dc-body">
                <b>{d.title}</b>
                <span>p. {d.pageNumber} · {d.figureLabel} · {ago(d.timestamp)}</span>
              </span>
              <span className="dc-go">›</span>
            </button>
          ))}
        </div>
        <div className="home-foot">
          <button className="ghost-btn" onClick={() => mentra.send('capture-now', {})}>◎ Look now</button>
          <button className="ghost-btn" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        </div>
      </section>

      {/* explore ------------------------------------------------------------- */}
      <section className="explore-screen">
        <div className="stage-host" ref={stageHost} />
        <div className="video-host" ref={videoHost} />
        {rawPhoto && (
          <div className="raw-photo">
            <img src={rawPhoto} alt="photo from your glasses" />
            <span>from your glasses · flattening the page…</span>
          </div>
        )}
        <header className="explore-head">
          <button className="back" onClick={goHome}>‹</button>
          {det && (
            <div className="eh-title">
              <b>{det.title}</b>
              <span>Your page {det.pageNumber} · {det.figureLabel}</span>
            </div>
          )}
        </header>
        {det && rstate === 'photo' && (
          <div className="photo-actions">
            <button className="bring" onClick={() => renderer.current?.play()}><span>✦</span> Bring to life</button>
          </div>
        )}
        {det && rstate === 'interactive' && (
          <div className={`sheet ${sheetOpen ? 'open' : ''}`}>
            <button className="sheet-handle" onClick={() => setSheetOpen((o) => !o)}><i /> {sheetOpen ? 'hide controls' : 'controls'}</button>
            <div className="sheet-body" ref={sheetHost} />
            <button className="fold" onClick={() => renderer.current?.close()}>↧ Back to page</button>
          </div>
        )}
      </section>

      {/* discovery toast ------------------------------------------------------ */}
      <div className={`toast ${toast ? 'show' : ''}`}>
        {toast && (
          <button className="toast-card" onClick={() => open(toast.det)}>
            <Thumb det={toast.det} />
            <span className="dc-body">
              <em>{toast.kind === 'revisit' ? 'You’ve explored this page' : toast.kind === 'replayed' ? 'Found while the app was closed' : 'Found on your page'}</em>
              <b>{toast.det.title}</b>
              <span>p. {toast.det.pageNumber} · {toast.det.figureLabel}</span>
            </span>
            <span className="dc-go">{toast.kind === 'revisit' ? 'Open' : '✦'}</span>
          </button>
        )}
      </div>

      {/* settings -------------------------------------------------------------- */}
      <div className={`settings ${settingsOpen ? 'open' : ''}`} onClick={() => setSettingsOpen(false)}>
        {settings && (
          <div className="settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <h3>Settings</h3>
            <label className="row">
              <span>Look at the page every <b>{(settings.scanIntervalMs / 1000).toFixed(1)} s</b></span>
              <input type="range" min={1000} max={4000} step={100} value={settings.scanIntervalMs} onChange={(e) => upd({ scanIntervalMs: +e.target.value })} />
            </label>
            <div className="row">
              <span>Sounds from the glasses</span>
              <div className="seg">
                {(['on', 'quiet', 'off'] as AudioMode[]).map((m) => (
                  <button key={m} className={settings.audio === m ? 'on' : ''} onClick={() => upd({ audio: m })}>{m === 'on' ? 'Chime + voice' : m === 'quiet' ? 'Chime only' : 'Off'}</button>
                ))}
              </div>
            </div>
            <label className="row toggle">
              <span>Open discoveries automatically</span>
              <input type="checkbox" checked={settings.autoOpen} onChange={(e) => upd({ autoOpen: e.target.checked })} />
            </label>
            <details className="dev">
              <summary>Developer</summary>
              <label className="row toggle">
                <span>Show recognition pipeline</span>
                <input type="checkbox" checked={settings.showPipeline} onChange={(e) => upd({ showPipeline: e.target.checked })} />
              </label>
              <label className="row toggle">
                <span>Use generated video (mock provider)</span>
                <input type="checkbox" checked={settings.rendererOverride === 'generatedVideo'} onChange={(e) => upd({ rendererOverride: e.target.checked ? 'generatedVideo' : null })} />
              </label>
              {det && <pre className="prompt">{det.renderPlan.videoPrompt}</pre>}
            </details>
            <p className="privacy">Frames from your glasses are analysed and discarded. Nothing is stored except the pages you choose to explore.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ det }: { det: Detection }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      const b = det.regionBox, s = det.scanSize;
      const sx = (b.x0 / 2.1) * s.width, sy = ((b.z0 + 1.4) / 2.8) * s.height, sw = (b.w / 2.1) * s.width, sh = (b.h / 2.8) * s.height;
      const k = Math.max(c.width / sw, c.height / sh);
      ctx.drawImage(img, sx + (sw - c.width / k) / 2, sy + (sh - c.height / k) / 2, c.width / k, c.height / k, 0, 0, c.width, c.height);
    };
    img.src = det.scanUrl;
  }, [det]);
  return <canvas className="thumb" ref={ref} width={120} height={120} />;
}
