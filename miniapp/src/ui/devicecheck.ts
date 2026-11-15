// Phase-1 spike, runnable on the phone: does WebGL work in this WebView, and
// does a sandboxed srcdoc iframe start the runtime and render frames?
import { SandboxHost } from '@lp/runtime/host';

const TEST_MODULE = `export default function create(lp) {
  const g = lp.figure.frame(1, 1);
  const m = new lp.THREE.Mesh(new lp.THREE.BoxGeometry(0.4, 0.4, 0.4), lp.sketch('coral'));
  m.position.y = 0.3; lp.edges(m); g.add(m);
  lp.controls([{ type: 'button', key: 'x', label: 'x', onClick() {} }]);
  return { root: g, enter() {}, exit() {}, update(dt) { m.rotation.y += dt; }, dispose() {} };
}`;

export interface DeviceReport {
  webgl2: boolean;
  webgl1: boolean;
  renderer: string;
  sandboxReady: boolean;
  sandboxLoaded: boolean;
  sandboxFps: number | null;
  sandboxError: string | null;
  ua: string;
  ms: number;
}

export async function deviceCheck(): Promise<DeviceReport> {
  const t0 = Date.now();
  const c = document.createElement('canvas');
  const gl2 = c.getContext('webgl2');
  const gl = gl2 ?? c.getContext('webgl');
  let renderer = '';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;bottom:0;width:120px;height:160px;opacity:0.01;pointer-events:none;';
  document.body.appendChild(box);
  const rep: DeviceReport = { webgl2: !!gl2, webgl1: !!gl, renderer, sandboxReady: false, sandboxLoaded: false, sandboxFps: null, sandboxError: null, ua: navigator.userAgent, ms: 0 };
  let host: SandboxHost | null = null;
  try {
    await new Promise<void>((resolve) => {
      const done = setTimeout(resolve, 9000);
      host = new SandboxHost(box, TEST_MODULE, {
        onLoaded: () => (rep.sandboxLoaded = true),
        onError: (ph, m) => (rep.sandboxError ??= `${ph}: ${m}`),
        onStats: (s) => {
          if (rep.sandboxLoaded && s.fps > 0) {
            rep.sandboxFps = Math.round(s.fps);
            clearTimeout(done);
            resolve();
          }
        },
      });
      host.ready().then(() => {
        rep.sandboxReady = true;
        return host!.load(null, [[0, 0], [1, 0], [1, 1], [0, 1]], { figure: { rect: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.6 }, description: '' }, params: {}, equations: [], page: { number: null, heading: '' } }, { instant: true });
      }).catch((e) => {
        rep.sandboxError = String(e?.message ?? e);
        clearTimeout(done);
        resolve();
      });
    });
  } finally {
    (host as SandboxHost | null)?.dispose();
    box.remove();
  }
  rep.ms = Date.now() - t0;
  return rep;
}
