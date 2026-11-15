// PictureThis UI layer: React in the phone's WebView. It reaches the glasses
// only through the background (mentra.* channels) and fetches visualizations
// straight from the PictureThis server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MiniappHeader, useCapsuleHeaderStyle, useHistoryState, useSafeArea } from '@mentra/miniapp/ui';
import type { AppState } from '../shared/channels';
import type { Discovery, FrameTrace, GlassesStatus, Settings, SoundMode } from '../shared/types';
import { Explore, type ExploreView } from './explore';
import { fetchPrompt, serverUrl, type VizRecord } from './api';
import { deviceCheck, type DeviceReport } from './devicecheck';
import logoUrl from '../../icon.png';

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

type Toast = { kind: 'discovery' | 'revisit' | 'replayed'; d: Discovery } | null;

export function App() {
  const { insets } = useSafeArea();
  const capsuleStyle = useCapsuleHeaderStyle();
  const [status, setStatus] = useState<GlassesStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [server, setServer] = useState('');
  const [dets, setDets] = useState<Discovery[]>([]);
  const [traces, setTraces] = useState<FrameTrace[]>([]);
  const [openId, setOpenId] = useHistoryState<string | null>('explore', null);
  const [settingsOpen, setSettingsOpen] = useHistoryState('settings', false);
  const [toast, setToast] = useState<Toast>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  /** the discovery row currently swiped open to show its Delete button */
  const [swiped, setSwiped] = useState<string | null>(null);
  const [rawPhoto, setRawPhoto] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [view, setView] = useState<ExploreView | null>(null);
  const [devShow, setDevShow] = useState<'code' | 'prompt' | 'errors' | null>(null);
  const [promptText, setPromptText] = useState('');
  const [devReport, setDevReport] = useState<DeviceReport | 'running' | null>(null);
  const [homeViz, setHomeViz] = useState<VizRecord | null>(null);
  const regenOnOpen = useRef(false);
  const stageHost = useRef<HTMLDivElement>(null);
  const sheetHost = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // px of the screen the UI covers above (header) and below (controls sheet)
  const topInset = () => (headRef.current?.getBoundingClientRect().bottom ?? 90) + 6;
  const bottomInset = () => {
    const el = sheetRef.current;
    if (el) return Math.max(0, window.innerHeight - el.getBoundingClientRect().top) + 6;
    return Math.round(window.innerHeight * 0.4); // the sheet appears once the model is up
  };
  const explore = useRef<Explore | null>(null);
  const openRef = useRef(openId);
  const settingsRef = useRef(settings);
  const detsRef = useRef(dets);
  openRef.current = openId;
  settingsRef.current = settings;
  detsRef.current = dets;

  // ---- state from the background --------------------------------------------
  useEffect(() => {
    let alive = true;
    const load = () =>
      mentra
        .request('get-state', {}, { timeout: 5000 })
        .then((st: AppState) => {
          if (!alive) return;
          setStatus(st.status);
          setSettings(st.settings);
          setDets(st.discoveries);
          setServer(st.server);
        })
        .catch(() => alive && setTimeout(load, 1500));
    load();
    const offs = [
      mentra.on('status', setStatus),
      mentra.on('settings', setSettings),
      mentra.on('trace', (t) => setTraces((ts) => [t, ...ts].slice(0, 12))),
      mentra.on('discovery', ({ discovery, replayed }) => {
        setDets((d) => (d.some((x) => x.id === discovery.id) ? d : [discovery, ...d]));
        setToast({ kind: replayed ? 'replayed' : 'discovery', d: discovery });
        if ((settingsRef.current?.autoOpen ?? true) && !openRef.current) setTimeout(() => !openRef.current && setOpenId(discovery.id), replayed ? 900 : 1400);
      }),
      mentra.on('revisit', ({ discoveryId }) => {
        const d = detsRef.current.find((x) => x.id === discoveryId);
        setHighlight(discoveryId);
        if (d && openRef.current !== discoveryId) setToast({ kind: 'revisit', d });
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, []);

  const forget = (d: Discovery) => {
    setSwiped(null);
    setDets((ds) => ds.filter((x) => x.id !== d.id));
    setToast((t) => (t?.d.id === d.id ? null : t));
    if (highlight === d.id) setHighlight(null);
    mentra.send('forget-discovery', { discoveryId: d.id });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- explore lifecycle follows openId (so the back gesture works) ------------
  const det = dets.find((d) => d.id === openId) ?? null;
  useEffect(() => {
    if (!openId || !det || !server || !stageHost.current) return;
    mentra.send('discovery-opened', { discoveryId: openId });
    setToast(null);
    setSheetOpen(true);
    setDevShow(null);
    setRawPhoto(serverUrl(server, det.photoUrl));
    const rawTimer = setTimeout(() => setRawPhoto(null), 1300);
    const ex = new Explore(stageHost.current, server, det, setView, {
      autoPlay: true,
      topInset,
      bottomInset,
    });
    explore.current = ex;
    void ex.start(regenOnOpen.current ? { force: true, noTemplate: true } : {});
    regenOnOpen.current = false;
    return () => {
      clearTimeout(rawTimer);
      ex.dispose();
      if (explore.current === ex) explore.current = null;
      setView(null);
      setRawPhoto(null);
    };
  }, [openId, det?.id, server]);

  // keep the model framed between the header and the sheet as the sheet opens/closes
  useEffect(() => {
    if (view?.state !== 'interactive') return;
    const t = setTimeout(() => explore.current?.layout(topInset(), bottomInset()), 520);
    return () => clearTimeout(t);
  }, [view?.state, sheetOpen]);

  useEffect(() => {
    const host = sheetHost.current;
    const el = view?.panel;
    if (host && el && el.parentElement !== host) {
      host.innerHTML = '';
      host.appendChild(el);
    }
  }, [view?.panel, view?.state]);

  const open = useCallback((d: Discovery) => openRef.current !== d.id && setOpenId(d.id), [setOpenId]);
  const goHome = useCallback(async () => {
    await explore.current?.close();
    history.back();
  }, []);
  const upd = (p: Partial<Settings>) => mentra.send('update-settings', p);
  // developer tools act on the open discovery, or else the most recent one
  const devDet = det ?? dets[0] ?? null;
  const devViz = view?.viz ?? homeViz;
  useEffect(() => {
    if (!settingsOpen || det || !dets[0] || !server) return;
    setHomeViz(null);
    fetch(`${server}/v1/discoveries/${dets[0].id}/visualization`).then((r) => (r.ok ? r.json() : null)).then(setHomeViz).catch(() => setHomeViz(null));
  }, [settingsOpen, det?.id, dets[0]?.id, server]);
  const scanning = !!status?.scanning;
  const toggleScan = () => mentra.send('set-scanning', { scanning: !scanning });
  const st = view?.state;

  return (
    <div className="lp-root" style={{ paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
      <div className={`lp-app ${openId ? 'exploring' : 'home'}`}>
        {/* home ------------------------------------------------------------------ */}
        <section className="home-screen">
          <MiniappHeader title={<span className="app-title"><img className="app-logo" src={logoUrl} alt="" />PictureThis</span>} />
          <div className="app-sub">
            {status ? (
              status.error ? <span className="err">{status.error}</span> : !status.connected ? 'waiting for your Mentra Live…' : !status.hasCamera ? 'these glasses have no camera' : <>Mentra Live{scanning ? <span className="rec"> · camera on</span> : ' · paused'}</>
            ) : 'connecting…'}
          </div>
          <div className={`scan-card ${scanning ? 'on' : 'off'}`}>
            <div className="scan-orb"><i /><i /><i /></div>
            <div className="scan-text">
              <b>{scanning ? 'Looking at your page…' : 'Scanning paused'}</b>
              <span>{scanning ? 'Read as usual. I’ll chime when something can come alive.' : 'Tap to resume, or hold the glasses button.'}</span>
              {scanning && status?.lastResult && <span className="last">{status.lastResult}</span>}
            </div>
            <button className={`switch ${scanning ? 'on' : ''}`} aria-label="Scanning" onClick={toggleScan}><i /></button>
          </div>
          {status?.failure && (
            <div className="capture-fail" role="alert">
              <span>{status.failure}</span>
              <button onClick={() => mentra.send('capture-now', { at: Date.now() })}>Try again</button>
            </div>
          )}
          <div className="section-label">Discoveries <span>{dets.length ? `${dets.length} found` : ''}</span></div>
          <div className="disc-list">
            {dets.length === 0 && <div className="empty">Nothing yet. When your glasses spot a figure I can bring to life, it’ll appear here.</div>}
            {dets.map((d) => (
              <SwipeRow key={d.id} open={swiped === d.id} onOpenChange={(o) => setSwiped(o ? d.id : null)} onDelete={() => forget(d)} label={d.title}>
                <button className={`disc-card ${highlight === d.id ? 'hl' : ''}`} onClick={() => (swiped ? setSwiped(null) : open(d))}>
                  <img className="thumb" src={d.thumb} alt="" />
                  <span className="dc-body">
                    <b>{d.title}</b>
                    <span>{d.pageNumber ? `p. ${d.pageNumber} · ` : ''}{d.figureLabel} · {ago(d.ts)}</span>
                  </span>
                  <span className="dc-go">›</span>
                </button>
              </SwipeRow>
            ))}
          </div>
          <div className="home-foot">
            <button className="ghost-btn" onClick={() => mentra.send('capture-now', { at: Date.now() })}>◎ Look now</button>
            <button className="ghost-btn" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          </div>
          {settings?.showPipeline && <PipelineStrip traces={traces} />}
        </section>

        {/* explore --------------------------------------------------------------- */}
        <section className="explore-screen">
          <div className="stage-host" ref={stageHost} />
          {rawPhoto && (
            <div className="raw-photo">
              <img src={rawPhoto} alt="photo from your glasses" />
              <span>from your glasses · flattening the page…</span>
            </div>
          )}
          <header className="explore-head" ref={headRef} style={capsuleStyle}>
            <button className="back" onClick={goHome} aria-label="Back">‹</button>
            {det && (
              <div className="eh-title">
                <b>{view?.viz?.title || det.title}</b>
                <span>Your page{det.pageNumber ? ` ${det.pageNumber}` : ''} · {det.figureLabel}</span>
              </div>
            )}
            <button className={`scan-pill ${scanning ? 'on' : ''}`} onClick={toggleScan} aria-label="Pause scanning"><i />{scanning ? 'scanning' : 'paused'}</button>
            <button className="back tools" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button>
          </header>
          {(st === 'generating' || st === 'photo-loading') && (
            <div className="sketching">
              <svg className="pencil" viewBox="0 0 120 46"><path d="M5 32 C 20 6, 35 42, 50 20 S 80 2, 95 28 S 110 36, 115 14" /></svg>
              <b>Sketching your visualization…</b>
              <span>{view?.progress.message}</span>
              <div className="bar"><i style={{ width: `${Math.round((view?.progress.fraction ?? 0) * 100)}%` }} /></div>
            </div>
          )}
          {st === 'failed' && (
            <div className="couldnt">
              <b>{view?.failure ?? 'Couldn’t animate this one.'}</b>
              <span>Your page is still here. You can try sketching it again.</span>
              {view?.errors.length ? <span className="why">{view.errors[view.errors.length - 1].slice(0, 160)}</span> : null}
              <button onClick={() => explore.current?.generate({ force: true, noTemplate: true })}>✎ Try again</button>
            </div>
          )}
          {(st === 'photo' || st === 'ready') && (
            <div className="photo-actions">
              <button className="bring" onClick={() => explore.current?.play()}><span>✦</span> Bring to life</button>
            </div>
          )}
          {st === 'interactive' && (
            <div className={`sheet ${sheetOpen ? 'open' : ''}`} ref={sheetRef}>
              <button className="sheet-handle" onClick={() => setSheetOpen((o) => !o)}><i /> {sheetOpen ? 'hide controls' : 'controls'}</button>
              <div className="sheet-body" ref={sheetHost} />
              <button className="fold" onClick={() => explore.current?.fold()}>↧ Back to page</button>
            </div>
          )}
        </section>

        {/* discovery card ------------------------------------------------------------- */}
        <div className={`toast ${toast ? 'show' : ''}`}>
          {toast && (
            <button className="toast-card" onClick={() => open(toast.d)}>
              <img className="thumb" src={toast.d.thumb} alt="" />
              <span className="dc-body">
                <em>{toast.kind === 'revisit' ? 'You’ve explored this page' : toast.kind === 'replayed' ? 'Found while the app was closed' : 'Found on your page'}</em>
                <b>{toast.d.title}</b>
                <span>{toast.d.pageNumber ? `p. ${toast.d.pageNumber} · ` : ''}{toast.d.figureLabel}</span>
              </span>
              <span className="dc-go">{toast.kind === 'revisit' ? 'Open' : '✦'}</span>
            </button>
          )}
        </div>

        {/* settings ----------------------------------------------------------------------- */}
        <div className={`settings ${settingsOpen ? 'open' : ''}`} onClick={() => setSettingsOpen(false)}>
          {settings && (
            <div className="settings-card" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 30 + insets.bottom }}>
              <div className="sheet-grip" />
              <h3>Settings</h3>
              <label className="row">
                <span>Look at the page every <b>{(settings.scanIntervalMs / 1000).toFixed(1)} s</b></span>
                <input type="range" min={1000} max={6000} step={250} value={settings.scanIntervalMs} onChange={(e) => upd({ scanIntervalMs: +e.target.value })} />
              </label>
              <div className="row">
                <span>Sounds from the glasses</span>
                <div className="seg">
                  {(['voice', 'chime', 'off'] as SoundMode[]).map((m) => (
                    <button key={m} className={settings.sounds === m ? 'on' : ''} onClick={() => upd({ sounds: m })}>{m === 'voice' ? 'Chime + voice' : m === 'chime' ? 'Chime only' : 'Off'}</button>
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
                  <span>Show pipeline view</span>
                  <input type="checkbox" checked={settings.showPipeline} onChange={(e) => upd({ showPipeline: e.target.checked })} />
                </label>
                <div className="row">
                  <span>Server: <i>{server}</i></span>
                  {view?.viz && <div>{view.viz.source} · {view.viz.model} · {view.viz.attempts} attempt(s) · {Math.round((view.viz.timings.total ?? 0) / 100) / 10} s</div>}
                  {view?.stats && <div>{view.stats.fps.toFixed(0)} fps · {view.stats.drawCalls} draws · {Math.round(view.stats.triangles / 1000)}k tris</div>}
                  <div className="dev-target">{devDet ? <>for <b>{devDet.title}</b>{det ? '' : ' (most recent)'}{devViz ? ` · ${devViz.source}` : ' · not generated yet'}</> : 'Code, prompt and regenerate need a discovery first.'}</div>
                  <button className="small" disabled={!devViz} onClick={() => setDevShow(devShow === 'code' ? null : 'code')}>generated code</button>
                  <button className="small" disabled={!devViz} onClick={async () => {
                    if (devShow === 'prompt') return setDevShow(null);
                    const p = devViz && (await fetchPrompt(server, devViz.key));
                    setPromptText(p ? `${p.system}\n\n---- user ----\n${p.user}` : '(no prompt: this one came from a template)');
                    setDevShow('prompt');
                  }}>Gemini prompt</button>
                  <button className="small" disabled={!view?.errors.length && !devViz?.validation?.errors?.length} onClick={() => setDevShow(devShow === 'errors' ? null : 'errors')}>errors ({view?.errors.length || devViz?.validation?.errors?.length || 0})</button>
                  <button className="small" disabled={!devDet} onClick={() => {
                    setSettingsOpen(false);
                    if (det) explore.current?.generate({ force: true, noTemplate: true });
                    else if (devDet) { regenOnOpen.current = true; setTimeout(() => setOpenId(devDet.id), 350); }
                  }}>regenerate</button>
                  <button className="small" onClick={() => mentra.send('forget-discoveries', { at: Date.now() })}>forget discoveries</button>
                  <button className="small" disabled={devReport === 'running'} onClick={async () => { setDevReport('running'); setDevReport(await deviceCheck()); }}>device check</button>
                </div>
                {devReport && (
                  <pre className="code-view">{devReport === 'running' ? 'checking WebGL and the sandbox…' : [
                    `WebGL2 ${devReport.webgl2 ? 'yes' : 'NO'} · WebGL1 ${devReport.webgl1 ? 'yes' : 'NO'}`,
                    `GPU ${devReport.renderer || '?'}`,
                    `sandbox iframe: started ${devReport.sandboxReady ? 'yes' : 'NO'} · module loaded ${devReport.sandboxLoaded ? 'yes' : 'NO'} · ${devReport.sandboxFps ?? '?'} fps`,
                    devReport.sandboxError ? `sandbox error: ${devReport.sandboxError}` : '',
                    `takePhoto (capture+upload): ${status?.capture ? `p50 ${status.capture.p50} ms · p90 ${status.capture.p90} ms · last ${status.capture.last} ms (n=${status.capture.n})` : 'no frames yet'}`,
                    devReport.ua,
                  ].filter(Boolean).join('\n')}</pre>
                )}
                {devShow === 'code' && <pre className="code-view">{devViz?.code}</pre>}
                {devShow === 'prompt' && <pre className="code-view">{promptText}</pre>}
                {devShow === 'errors' && <pre className="code-view">{[...(view?.errors ?? []), ...(devViz?.validation?.errors ?? [])].join('\n') || 'no errors'}</pre>}
              </details>
              <p className="privacy"><b>Privacy.</b> While scanning, the glasses send photos of your page to the PictureThis server for analysis. They are not stored, except the page crops of your discoveries. You can pause scanning at any time, here or by holding the glasses button.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Swipe left to delete. A short swipe snaps open to reveal a Delete button;
 * a long swipe (past half the row) deletes straight away. Vertical drags are
 * left to the list's scroll.
 */
const REVEAL = 88;
function SwipeRow({ open, onOpenChange, onDelete, label, children }: { open: boolean; onOpenChange: (o: boolean) => void; onDelete: () => void; label: string; children: React.ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState<number | null>(null); // live offset while dragging
  const [leaving, setLeaving] = useState(false);
  const g = useRef<{ id: number; x: number; y: number; base: number; mode: 'undecided' | 'swipe' | 'scroll' } | null>(null);
  const suppressClick = useRef(false);
  const width = () => rowRef.current?.getBoundingClientRect().width ?? 320;
  const remove = () => {
    setLeaving(true);
    setDx(-width());
    setTimeout(onDelete, 220);
  };
  const onDown = (e: React.PointerEvent) => {
    if (leaving || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: open ? -REVEAL : 0, mode: 'undecided' };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (s.mode === 'undecided') {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.mode = Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
      if (s.mode === 'swipe') rowRef.current?.setPointerCapture(e.pointerId);
    }
    if (s.mode !== 'swipe') return;
    // rubber-band past the right edge
    const x = s.base + mx;
    setDx(x > 0 ? x * 0.2 : x);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.mode !== 'swipe') return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const x = dx ?? s.base;
    setDx(null);
    if (x < -width() * 0.5) remove();
    else onOpenChange(x < -REVEAL / 2);
  };
  const x = dx ?? (open ? -REVEAL : 0);
  return (
    <div className={`disc-row ${leaving ? 'leaving' : ''}`} ref={rowRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClickCapture={(e) => suppressClick.current && (e.stopPropagation(), e.preventDefault())}>
      <button className="dc-del" style={{ width: Math.max(REVEAL, -x), visibility: x < 0 ? 'visible' : 'hidden' }} onClick={remove} tabIndex={open ? 0 : -1} aria-label={`Delete ${label}`}>
        Delete
      </button>
      <div className="dc-slide" style={{ transform: `translateX(${x}px)`, transition: dx === null ? 'transform 0.25s cubic-bezier(.2,.9,.3,1)' : 'none' }}>
        {children}
      </div>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = { capture: '#9db7cf', upload: '#c4b5dc', download: '#c4b5dc', gate: '#f1d68c', understand: '#e8907e', decide: '#9fb79a' };

function PipelineStrip({ traces }: { traces: FrameTrace[] }) {
  return (
    <div className="pipeline">
      <h4>Pipeline</h4>
      {traces.length === 0 && <div>no frames yet</div>}
      {traces.map((t) => {
        const parts = ['capture', 'download', 'gate', 'understand', 'decide'].filter((k) => t.timings[k]);
        const total = parts.reduce((s, k) => s + t.timings[k], 0) || 1;
        return (
          <div className="row" key={t.id}>
            <span>{t.reason === 'scan' ? '·' : '◎'}</span>
            <span className="bars">{parts.map((k) => <i key={k} title={`${k} ${Math.round(t.timings[k])} ms`} style={{ width: `${(t.timings[k] / total) * 100}%`, background: STAGE_COLORS[k] }} />)}</span>
            <span className="st">{t.status} {Math.round(total)}ms</span>
          </div>
        );
      })}
    </div>
  );
}
