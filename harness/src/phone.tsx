// The phone WebView stand-in: installs the host globals the Mentra UI SDK
// expects (window.MentraOS, window.mentra) from the harness, then mounts the
// miniapp's own UI entry unchanged.
const h = (window.parent as any).__lpHarness;
if (!h) throw new Error('open the harness at / — the phone page needs its parent');
(window as any).MentraOS = h.mentraOS();
(window as any).mentra = h.bridge();
if ((window as any).MentraOS.colorScheme === 'dark') document.documentElement.classList.add('dark');
await import('../../miniapp/src/ui/main');
export {};
