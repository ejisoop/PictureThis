// The phone and the Mentra host app around the miniapp: status bar, the host
// home screen with miniapp tiles, the splash, the capsule menu and the
// WebView lifecycle (the miniapp's React tree only exists while it is open).
import { useEffect, useState } from 'react';
import type { MockHost, MentraUi } from '../mentra/mock';
import { App, MentraProvider } from '../ui/App';

export function PhoneHost({ host, mentra, battery }: { host: MockHost; mentra: MentraUi; battery: () => number }) {
  const [open, setOpen] = useState(host.uiOpen);
  const [splash, setSplash] = useState(host.uiOpen);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const a = host.lifecycle.on('open-requested', () => {
      setSplash(true);
      setOpen(true);
    });
    const b = host.lifecycle.on('open', () => setTimeout(() => setSplash(false), 350));
    const c = host.lifecycle.on('close', () => setOpen(false));
    if (host.isReady()) setTimeout(() => setSplash(false), 350);
    const t = setInterval(() => setClock(new Date()), 15000);
    return () => {
      a();
      b();
      c();
      clearInterval(t);
    };
  }, [host]);

  return (
    <div className="phone">
      <div className="phone-screen">
        <div className="statusbar">
          <span>{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="island" />
          <span className="sb-right">◉ ▂▄▆ {battery()}%</span>
        </div>
        {open ? (
          <div className="webview">
            <MentraProvider mentra={mentra}>
              <App />
            </MentraProvider>
            <div className="capsule" title="Mentra host menu">
              <button aria-label="more">···</button>
              <i />
              <button aria-label="close miniapp" onClick={() => mentra.close()}>✕</button>
            </div>
            <div className={`splash ${splash ? 'show' : ''}`}>
              <div className="splash-mark">✦</div>
              <div className="splash-name">Living Pages</div>
            </div>
          </div>
        ) : (
          <HostHome onOpen={() => host.openUi()} battery={battery()} />
        )}
        <div className="home-indicator" />
      </div>
    </div>
  );
}

function HostHome({ onOpen, battery }: { onOpen: () => void; battery: number }) {
  const tiles = [
    { name: 'Living Pages', icon: '✦', live: true },
    { name: 'Live Captions', icon: '❝' },
    { name: 'Translation', icon: '⇄' },
    { name: 'Notes', icon: '✎' },
  ];
  return (
    <div className="host-home">
      <div className="hh-title">Mentra</div>
      <div className="hh-glasses">
        <span className="hh-g">⌐◨-◨</span>
        <span>
          <b>Mentra Live</b>
          <em>connected · {battery}%</em>
        </span>
      </div>
      <div className="hh-label">Miniapps</div>
      <div className="hh-grid">
        {tiles.map((t) => (
          <button key={t.name} className={`hh-tile ${t.live ? 'live' : ''}`} onClick={t.live ? onOpen : undefined}>
            <span className="ic">{t.icon}</span>
            <span className="nm">{t.name}</span>
            {t.live && <span className="running">running</span>}
          </button>
        ))}
      </div>
      <p className="hh-note">Living Pages keeps running in the background while it’s closed. Tap it to see what your glasses found.</p>
    </div>
  );
}
