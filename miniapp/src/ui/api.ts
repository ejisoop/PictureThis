// The UI's direct line to the PictureThis server (visualizations only;
// frames go through the background).
export interface VizRecord {
  key: string;
  source: 'cache' | 'template' | 'generated';
  code: string;
  title: string;
  summary: string;
  attempts: number;
  model: string;
  validation: { ok: boolean; errors: string[] };
  screenshot: string | null;
  prompt: { system: string; user: string } | null;
  timings: Record<string, number>;
  /** module ctx it was validated with (includes page parameters from the detailed pass) */
  ctx?: unknown;
}

export type GenEvent =
  | { type: 'progress'; stage: string; message: string; attempt?: number }
  | { type: 'done'; viz: VizRecord }
  | { type: 'failed'; errors: string[]; viz: VizRecord | null };

/**
 * Starts (or joins) generation and reports progress until done/failed.
 * A dropped stream (server restart, network blip) re-joins the job up to 4 times
 * before giving up. Returns a cancel fn.
 */
export function requestViz(server: string, discoveryId: string, o: { force?: boolean; noTemplate?: boolean }, on: (e: GenEvent) => void) {
  let es: EventSource | null = null;
  let cancelled = false;
  let finished = false;
  let retries = 0;
  const finish = (e: GenEvent) => {
    if (finished || cancelled) return;
    finished = true;
    es?.close();
    on(e);
  };
  const attempt = async (first: boolean) => {
    try {
      // only the first request may force a regeneration; retries join the running job
      const r = await fetch(`${server}/v1/visualizations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ discoveryId, ...(first ? o : { noTemplate: o.noTemplate }) }) });
      const j = await r.json();
      if (cancelled) return;
      if (!r.ok) return finish({ type: 'failed', errors: [j.error ?? `server said HTTP ${r.status}`], viz: null });
      if (j.viz) return finish({ type: 'done', viz: j.viz });
      es = new EventSource(server + j.events);
      es.addEventListener('progress', (ev) => !finished && on(JSON.parse((ev as MessageEvent).data)));
      for (const t of ['done', 'failed'] as const) es.addEventListener(t, (ev) => finish(JSON.parse((ev as MessageEvent).data)));
      es.onerror = () => {
        if (finished || cancelled) return;
        es?.close();
        retry('lost the connection to the server');
      };
    } catch (e) {
      if (!cancelled) retry(`couldn’t reach the server (${(e as Error).message})`);
    }
  };
  const retry = (why: string) => {
    if (++retries > 4) return finish({ type: 'failed', errors: [why], viz: null });
    on({ type: 'progress', stage: 'retry', message: 'reconnecting…' });
    setTimeout(() => !cancelled && !finished && attempt(false), 800 * retries);
  };
  void attempt(true);
  return () => {
    cancelled = true;
    es?.close();
  };
}

export async function fetchPrompt(server: string, key: string) {
  const r = await fetch(`${server}/v1/visualizations/prompt?key=${encodeURIComponent(key)}`);
  return r.ok ? ((await r.json()) as { system: string; user: string }) : null;
}

/**
 * Server-hosted files (discovery photos) are always loaded through the server
 * address the app is configured with: the URL the server wrote may be an
 * internal one when it runs behind a cloud proxy.
 */
export function serverUrl(server: string, url: string) {
  try {
    const u = new URL(url, server);
    return u.pathname.startsWith('/v1/') ? server.replace(/\/$/, '') + u.pathname + u.search : u.href;
  } catch {
    return url;
  }
}
