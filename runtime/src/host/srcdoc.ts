// Builds the sandbox iframe document for one generated module.
// CSP: no network at all (default-src 'none'); inline scripts/styles only;
// fonts and images only from data:/blob:. The iframe itself is
// sandbox="allow-scripts" (opaque origin, no same-origin access).
import { RUNTIME_JS, RUNTIME_CSS } from '../../dist/bundle';

export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:";

/**
 * Turns the contract's `export default function create(lp, ctx) {…}` into a
 * global the runtime can call. Throws if the module isn't in that shape.
 */
export function moduleToScript(code: string): string {
  const m = /export\s+default\s+function\b/.exec(code);
  if (!m) throw new Error('module must contain `export default function create(lp, ctx)`');
  if (/^\s*(import|export)\b/m.test(code.slice(0, m.index) + code.slice(m.index + m[0].length))) throw new Error('only one export (the default function) is allowed, and no imports');
  const body = code.slice(0, m.index) + 'window.__LP_CREATE = function' + code.slice(m.index + m[0].length);
  return body.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

export function buildSrcdoc(code: string, opts: { test?: boolean } = {}): string {
  let mod: string;
  try {
    mod = `"use strict";\n${moduleToScript(code)}`;
  } catch (e) {
    mod = `window.__LP_LOAD_ERROR = ${JSON.stringify((e as Error).message)};`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${RUNTIME_CSS}</style></head><body><div id="stage"></div>
<script>window.__LP_TEST=${opts.test ? 'true' : 'false'};window.addEventListener('error',function(e){if(!window.__LP_CREATE&&!window.__LP_LOAD_ERROR)window.__LP_LOAD_ERROR=String(e.message||e.error)});</script>
<script>${mod}</script>
<script>${RUNTIME_JS.replace(/<\/(script)/gi, '<\\/$1')}</script>
</body></html>`;
}
