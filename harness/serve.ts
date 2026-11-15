// Dev harness server: the harness page, the phone page (the real miniapp UI
// in an iframe, standing in for the Mentra WebView), and the eval photos.
//   bun --hot harness/serve.ts   → http://localhost:5173
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import harness from './index.html';
import phone from './phone.html';

const PAGES = join(import.meta.dir, '..', 'evals', 'pages');
const port = Number(process.env.HARNESS_PORT ?? 5173);

Bun.serve({
  port,
  development: true,
  routes: {
    '/': harness,
    '/phone': phone,
    '/evals/pages': () => Response.json(readdirSync(PAGES).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()),
    '/evals/pages/:file': (req) => {
      const f = decodeURIComponent(req.params.file);
      if (f.includes('/') || f.includes('..')) return new Response('no', { status: 400 });
      return new Response(Bun.file(join(PAGES, f)));
    },
  },
});
console.log(`Living Pages harness on http://localhost:${port}  (server: ${process.env.LP_SERVER ?? 'http://localhost:8787'})`);
