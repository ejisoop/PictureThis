// Simulation harness bootstrap: simulated Mentra Live glasses + the phone
// running the Living Pages miniapp (background layer + React UI layer).
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/eb-garamond/greek-400.css';
import '@fontsource/eb-garamond/greek-400-italic.css';
import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-600.css';
import './styles/harness.css';
import './styles/miniapp.css';

import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
// @ts-ignore — v1 JS modules
import { renderChapter } from './viz/pages.js';
// @ts-ignore
import { pendulumChapter } from './viz/chapters/pendulum.js';
// @ts-ignore
import { magnetChapter } from './viz/chapters/magnet.js';
// @ts-ignore
import { surfaceChapter } from './viz/chapters/surface.js';
// @ts-ignore
import { historyChapter } from './viz/chapters/history.js';
import { GlassesSim } from './harness/glasses';
import { Hud } from './harness/hud';
import { PhoneHost } from './harness/PhoneHost';
import { DemoDirector } from './harness/demo';
import { MockHost, registerMiniapp, createMentraUi } from './mentra/mock';
import { MockRecognitionPipeline } from './services/recognition';
import { livingPagesBackground, type BackgroundHandle, type Trace } from './background';

const SPREAD_CHAPTERS: any[] = [pendulumChapter, historyChapter, magnetChapter, surfaceChapter];
SPREAD_CHAPTERS[0].tabLabel = 'I';
SPREAD_CHAPTERS[2].tabLabel = 'II';
SPREAD_CHAPTERS[3].tabLabel = 'III';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

async function boot() {
  await Promise.all(
    ['400 40px "EB Garamond"', 'italic 400 40px "EB Garamond"', '500 40px "EB Garamond"', '600 40px "EB Garamond"', '500 40px Caveat', '600 40px Caveat'].map((f) => document.fonts.load(f)),
  ).catch(() => {});

  // ---- simulated glasses ------------------------------------------------------
  const sim = new GlassesSim($('#feed'));
  sim.setSpreads(SPREAD_CHAPTERS.map((ch) => {
    const r = renderChapter(ch);
    return { left: r.left, right: r.right };
  }), SPREAD_CHAPTERS);

  const hud = new Hud(sim, { feed: $('#feed'), strip: $('#pipeline'), caption: $('#speaker-caption'), led: $('#led'), log: $('#log') });
  const pipeline = new MockRecognitionPipeline(sim.oracle());
  const host = new MockHost();
  const mentra = createMentraUi(host);
  let bg: BackgroundHandle | null = null;

  const demo = new DemoDirector(sim, $('#narration'), $('#demo-touch'), {
    reset: () => {
      bg?.reset();
      host.closeUi();
      setTimeout(() => host.openUi(), 60);
    },
    setSpeed: (s) => {
      pipeline.speed = s;
      bg?.setSpeed(s);
    },
    openPhoneApp: () => host.openUi(),
  });

  const trace = (t: Trace) => {
    hud.trace(t);
    demo.trace(t);
    if (t.type === 'settings') hud.setShowPipeline(t.settings.showPipeline);
    if (t.type === 'status') {
      document.body.classList.toggle('scanning', t.status.scanning);
      $('#scan-state').textContent = t.status.scanning ? 'camera on · scanning' : 'scanning paused';
    }
  };

  // ---- the miniapp: background layer + UI layer --------------------------------
  await registerMiniapp(host, sim, (session) => {
    bg = livingPagesBackground({ pipeline, trace })(session);
  });
  host.openUi();
  createRoot($('#phone-root')).render(<PhoneHost host={host} mentra={mentra} battery={() => sim.battery()} />);

  // ---- glasses controls ---------------------------------------------------------
  const btn = $('#g-button');
  let downAt = 0, longTimer: ReturnType<typeof setTimeout> | null = null, longFired = false;
  btn.addEventListener('pointerdown', () => {
    downAt = performance.now();
    longFired = false;
    btn.classList.add('down');
    longTimer = setTimeout(() => {
      longFired = true;
      sim.pressButton('long');
    }, 650);
  });
  const release = () => {
    if (!downAt) return;
    btn.classList.remove('down');
    if (longTimer) clearTimeout(longTimer);
    if (!longFired) sim.pressButton('short');
    downAt = 0;
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  $('#g-voice').addEventListener('click', () => {
    hud.caption('“Hey Mentra, explain this.”', 'speech');
    sim.say('Hey Mentra, explain this');
  });
  $('#turn-prev').addEventListener('click', () => sim.turnTo(sim.spread - 1));
  $('#turn-next').addEventListener('click', () => sim.turnTo(sim.spread + 1));
  $('#mute').addEventListener('click', (e) => {
    sim.speaker.muted = !sim.speaker.muted;
    (e.currentTarget as HTMLElement).classList.toggle('off', sim.speaker.muted);
    (e.currentTarget as HTMLElement).querySelector('span')!.textContent = sim.speaker.muted ? 'speaker muted' : 'speaker on';
  });
  $('#toggle-pipeline').addEventListener('click', () => mentra.send('update-settings', { showPipeline: !hud.showPipeline }));
  window.addEventListener('pointerdown', () => sim.speaker.unlock(), { capture: true });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') void sim.turnTo(sim.spread + 1);
    else if (e.key === 'ArrowLeft') void sim.turnTo(sim.spread - 1);
    else if (e.key === 'c' || e.key === 'C') sim.pressButton('short');
  });

  // ---- presentation modes ---------------------------------------------------------
  const playBtn = $('#demo-play'), pauseBtn = $('#demo-pause'), speedSel = $<HTMLSelectElement>('#demo-speed');
  demo.onState = ({ playing, paused }) => {
    document.body.classList.toggle('demo-playing', playing);
    playBtn.innerHTML = playing ? '■ <span>Stop tour</span>' : '▶ <span>Play guided demo</span>';
    pauseBtn.textContent = paused ? '▶ resume' : '❚❚ pause';
  };
  playBtn.addEventListener('click', () => (demo.playing ? demo.stop() : void demo.play()));
  pauseBtn.addEventListener('click', () => demo.togglePause());
  speedSel.addEventListener('change', () => demo.setSpeed(+speedSel.value));

  // ---- loop -------------------------------------------------------------------------
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    sim.update(dt, now);
    hud.draw();
    $('#page-indicator').textContent = `${SPREAD_CHAPTERS[sim.spread].tabTitle}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.body.classList.add('ready');
  gsap.fromTo('.pane', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.15 });
  (window as any).__lp = { sim, host, demo, hud, gsap, bg: () => bg };
}
boot();
