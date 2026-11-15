// Simulated glasses speakers: soft earcons via Web Audio and short spoken
// lines via speechSynthesis. Captions are emitted so the demo works muted.
type CaptionFn = (text: string | null, kind: 'speech' | 'earcon') => void;

export class GlassesSpeaker {
  private ctx: AudioContext | null = null;
  muted = false;
  onCaption: CaptionFn = () => {};

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    void this.ctx?.resume();
  }

  play(url: string) {
    const name = url.replace('earcon://', '');
    this.onCaption(name === 'discovery' ? '♪ soft chime' : name === 'hold' ? '♪ “hold steady” tone' : '♪ tick', 'earcon');
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    if (name === 'discovery') {
      this.rustle(t, 0.25);
      this.bell(t + 0.08, 659.25, 0.16, 1.4); // E5
      this.bell(t + 0.24, 987.77, 0.12, 1.8); // B5
    } else if (name === 'hold') {
      this.bell(t, 392, 0.09, 0.6, 'triangle');
      this.bell(t + 0.22, 349.23, 0.08, 0.7, 'triangle');
    } else {
      this.bell(t, 1318.5, 0.05, 0.15);
    }
  }

  speak(text: string): Promise<void> {
    this.onCaption(`“${text}”`, 'speech');
    if (this.muted || !('speechSynthesis' in window)) return new Promise((r) => setTimeout(r, 1200));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1.05;
      u.volume = 0.8;
      const v = speechSynthesis.getVoices().find((x) => /en[-_](US|GB)/.test(x.lang) && /female|samantha|google us/i.test(x.name)) ?? speechSynthesis.getVoices().find((x) => x.lang.startsWith('en'));
      if (v) u.voice = v;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(resolve, 4000);
    });
  }

  private bell(t: number, f: number, gain: number, decay: number, type: OscillatorType = 'sine') {
    const c = this.ctx!;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    o2.type = 'sine';
    o2.frequency.value = f * 2.01;
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(c.destination);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.05);
    o2.stop(t + decay + 0.05);
  }

  private rustle(t: number, dur: number) {
    const c = this.ctx!;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2) * (0.6 + 0.4 * Math.sin(i * 0.002));
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }
}
