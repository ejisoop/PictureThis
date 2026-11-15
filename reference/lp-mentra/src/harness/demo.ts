// Guided demo: a scripted ~80 s tour that drives the simulated head, the
// page turns and a few phone interactions, with narration. Pausable.
import gsap from 'gsap';
import type { GlassesSim } from './glasses';
import type { Trace } from '../background';

type Phone = { stage(): any; open(id?: string): void; home(): Promise<void>; settings(on: boolean): void };
const phone = (): Phone => (window as any).__lpPhone;

export class DemoDirector {
  playing = false;
  paused = false;
  speed = 1;
  private run = 0;
  private uiEvents: { type: string; at: number }[] = [];
  private delivered: { conceptId: string; at: number }[] = [];
  onState: (s: { playing: boolean; paused: boolean; step: string }) => void = () => {};

  constructor(private sim: GlassesSim, private narr: HTMLElement, private touch: HTMLElement, private hooks: { reset(): void; setSpeed(s: number): void; openPhoneApp(): void }) {
    window.addEventListener('lp-ui', (e) => this.uiEvents.push({ type: (e as CustomEvent).detail.type, at: performance.now() }));
  }

  trace(t: Trace) {
    if (t.type === 'decision' && t.decision === 'deliver' && t.conceptId) this.delivered.push({ conceptId: t.conceptId, at: performance.now() });
  }

  setSpeed(s: number) {
    this.speed = s;
    gsap.globalTimeline.timeScale(s);
    this.hooks.setSpeed(s);
  }

  togglePause() {
    if (!this.playing) return;
    this.paused = !this.paused;
    gsap.globalTimeline.paused(this.paused);
    this.onState({ playing: true, paused: this.paused, step: '' });
  }

  stop() {
    this.run++;
    this.playing = false;
    this.paused = false;
    gsap.globalTimeline.paused(false);
    this.sim.scripted = false;
    this.say(null);
    this.onState({ playing: false, paused: false, step: '' });
  }

  private alive(id: number) {
    if (id !== this.run) throw new Error('demo-stopped');
  }
  private async wait(ms: number, id: number) {
    let left = ms;
    while (left > 0) {
      this.alive(id);
      await new Promise((r) => setTimeout(r, 50));
      if (!this.paused) left -= 50 * this.speed;
    }
  }
  private async until(pred: () => boolean, timeout: number, id: number) {
    const t0 = performance.now();
    while (!pred()) {
      this.alive(id);
      if (performance.now() - t0 > timeout) return false;
      await new Promise((r) => setTimeout(r, 80));
    }
    return true;
  }
  private say(text: string | null, step = '') {
    if (!text) {
      this.narr.classList.remove('show');
      return;
    }
    this.narr.innerHTML = `${step ? `<b>${step}</b>` : ''}${text}`;
    this.narr.classList.add('show');
    gsap.fromTo(this.narr, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 });
    this.onState({ playing: true, paused: this.paused, step });
  }
  private async tap(xFrac: number, yFrac: number, id: number) {
    this.touch.style.left = `${xFrac * 100}%`;
    this.touch.style.top = `${yFrac * 100}%`;
    gsap.fromTo(this.touch, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.3 });
    await this.wait(450, id);
    gsap.to(this.touch, { opacity: 0, duration: 0.4 });
  }
  private sinceUi(type: string, t0: number) {
    return this.uiEvents.some((e) => e.type === type && e.at >= t0);
  }
  private sinceDelivered(concept: string, t0: number) {
    return this.delivered.some((d) => d.conceptId === concept && d.at >= t0);
  }

  async play() {
    this.stop();
    const id = ++this.run;
    this.playing = true;
    this.sim.scripted = true;
    this.onState({ playing: true, paused: false, step: '' });
    try {
      await this.script(id);
    } catch (e) {
      if ((e as Error).message !== 'demo-stopped') console.error(e);
    } finally {
      if (id === this.run) this.stop();
    }
  }

  private async script(id: number) {
    const sim = this.sim;
    // reset the world
    this.hooks.openPhoneApp();
    await this.wait(300, id);
    await phone()?.home();
    for (let i = sim.spread; i > 0; i--) await sim.turnTo(i - 1);
    this.hooks.reset();
    sim.lookAt(-1.75, -0.95, 1.0, 0.55);

    this.say('A student opens their physics textbook, wearing Mentra Live. The glasses have a camera but no display: nothing appears in front of their eyes.', '1 · Reading');
    await this.wait(3200, id);
    sim.lookAt(-1.65, -0.35, 2.4, 0.55);
    await this.wait(2600, id);
    sim.lookAt(-1.55, 0.35, 2.4, 0.57);
    await this.wait(2600, id);

    let t0 = performance.now();
    this.say('Their eyes move to the figure. The glasses take a still every couple of seconds; when the figure is clear in two frames in a row, they chime.', '2 · Noticing');
    sim.lookAt(1.05, -0.45, 1.6, 0.86);
    await this.until(() => this.sinceDelivered('simple-pendulum', t0), 20000, id);
    this.say('On the phone, the photo of their own page is flattened, the figure is found, and the drawing lifts off the paper.', '3 · Coming alive');
    await this.until(() => this.sinceUi('entered', t0), 20000, id);
    await this.wait(1200, id);

    this.say('They pinch the bob and give it a big swing. The graph compares the real motion with the small-angle formula.', '4 · Exploring');
    await this.tap(0.55, 0.42, id);
    phone()?.stage()?.viz?.setAngle?.((150 * Math.PI) / 180);
    await this.wait(4200, id);
    this.say('Then they try it on the Moon.', '4 · Exploring');
    const v = phone()?.stage()?.viz;
    await this.tap(0.18, 0.8, id);
    if (v) {
      v.gTarget = 1.62;
      v.panel?.api.g?.set(1.62);
    }
    await this.wait(4200, id);

    this.say('Back to reading. They turn to an interlude on the history of fields: just text.', '5 · Nothing to show');
    await phone()?.home();
    await this.wait(800, id);
    await sim.turnTo(1);
    sim.lookAt(-1.0, -0.4, 1.6, 0.8);
    await this.wait(2600, id);
    sim.lookAt(1.0, -0.4, 2.2, 0.8);
    this.say('The pipeline still runs. It reads “magnet” and “compass”, but there is no figure to animate, so it stays below the threshold and the glasses stay silent.', '5 · Nothing to show');
    await this.wait(5200, id);

    t0 = performance.now();
    await sim.turnTo(2);
    this.say('Next chapter: a bar magnet and its field lines.', '6 · Magnetism');
    sim.lookAt(1.05, -0.5, 1.4, 0.86);
    await this.until(() => this.sinceDelivered('bar-magnet-field', t0), 20000, id);
    await this.until(() => this.sinceUi('entered', t0), 20000, id);
    await this.wait(1500, id);
    this.say('The printed field lines fan out around the magnet in 3D. They weaken the magnet and the compass turns toward Earth’s north.', '6 · Magnetism');
    await this.tap(0.5, 0.82, id);
    const m = phone()?.stage()?.viz;
    if (m) {
      m.setStrength(0.25);
      m.panel?.api.strength?.set(0.25);
    }
    await this.wait(4800, id);

    await phone()?.home();
    t0 = performance.now();
    await sim.turnTo(3);
    this.say('Over to calculus. A printed contour map…', '7 · Calculus');
    sim.lookAt(1.05, -0.45, 1.4, 0.86);
    await this.until(() => this.sinceDelivered('surface-gradient', t0), 20000, id);
    await this.until(() => this.sinceUi('entered', t0), 20000, id);
    await this.wait(1200, id);
    this.say('…rises into a surface. They ask the point to climb the gradient until it reaches a peak.', '7 · Calculus');
    const s = phone()?.stage()?.viz;
    await this.tap(0.7, 0.86, id);
    if (s) s.climbing = true;
    await this.wait(5200, id);

    await phone()?.home();
    this.say('Every discovery stays in this session’s list, ready to reopen. Turning back to a page that was already visualized brings it up again, with no second chime.', '8 · History');
    await sim.turnTo(2);
    sim.lookAt(1.05, -0.5, 1.2, 0.86);
    await this.wait(5600, id);
    this.say('That’s the tour. Now try it yourself: move the mouse over the camera view to look around, scroll to lean in, and turn pages with the tabs.', 'Your turn');
    await this.wait(6000, id);
  }
}
