// SQLite cache of validated visualizations, keyed by page key + figure id +
// runtime version (pages are static and shared across students). Also stores
// discoveries (with their page photo) so the phone can reopen them later.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';
import type { Discovery, VizRecord } from './types';

mkdirSync(env.dataDir, { recursive: true });
const db = new Database(join(env.dataDir, 'living-pages.sqlite'), { create: true });
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`CREATE TABLE IF NOT EXISTS viz (key TEXT PRIMARY KEY, page_key TEXT, figure_id TEXT, runtime TEXT, record TEXT, png BLOB, created INTEGER);
CREATE TABLE IF NOT EXISTS discovery (id TEXT PRIMARY KEY, session TEXT, page_key TEXT, record TEXT, photo BLOB, created INTEGER);
CREATE TABLE IF NOT EXISTS stage_log (ts INTEGER, session TEXT, stage TEXT, ms REAL, detail TEXT);`);

export const vizKey = (pageKey: string, figureId: string, runtime: string) => `${pageKey}|${figureId}|${runtime}`;

export function getViz(key: string): VizRecord | null {
  const r = db.query('SELECT record FROM viz WHERE key = ?').get(key) as { record: string } | null;
  return r ? (JSON.parse(r.record) as VizRecord) : null;
}
export function putViz(rec: VizRecord, png: Buffer | null) {
  db.query('INSERT OR REPLACE INTO viz (key, page_key, figure_id, runtime, record, png, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    rec.key, rec.pageKey, rec.figureId, rec.runtimeVersion, JSON.stringify(rec), png, rec.createdAt
  );
}
export function deleteViz(key: string) {
  db.query('DELETE FROM viz WHERE key = ?').run(key);
}
export function vizPng(key: string): Buffer | null {
  const r = db.query('SELECT png FROM viz WHERE key = ?').get(key) as { png: Uint8Array | null } | null;
  return r?.png ? Buffer.from(r.png) : null;
}
export function listViz(limit = 100) {
  return (db.query('SELECT record FROM viz ORDER BY created DESC LIMIT ?').all(limit) as { record: string }[]).map((r) => JSON.parse(r.record) as VizRecord);
}

export function putDiscovery(d: Discovery, photo: Buffer) {
  db.query('INSERT OR REPLACE INTO discovery (id, session, page_key, record, photo, created) VALUES (?, ?, ?, ?, ?, ?)').run(d.id, d.sessionId, d.pageKey, JSON.stringify(d), photo, d.ts);
}
export function getDiscovery(id: string): Discovery | null {
  const r = db.query('SELECT record FROM discovery WHERE id = ?').get(id) as { record: string } | null;
  return r ? (JSON.parse(r.record) as Discovery) : null;
}
export function discoveryPhoto(id: string): Buffer | null {
  const r = db.query('SELECT photo FROM discovery WHERE id = ?').get(id) as { photo: Uint8Array } | null;
  return r ? Buffer.from(r.photo) : null;
}
export function recentDiscoveries(limit = 500): Discovery[] {
  return (db.query('SELECT record FROM discovery ORDER BY created DESC LIMIT ?').all(limit) as { record: string }[]).map((r) => JSON.parse(r.record));
}

/** removes one discovery (and its page photo); only the session that found it may delete it */
export function deleteDiscovery(session: string, id: string): Discovery | null {
  const r = db.query('SELECT record FROM discovery WHERE id = ? AND session = ?').get(id, session) as { record: string } | null;
  if (!r) return null;
  db.query('DELETE FROM discovery WHERE id = ?').run(id);
  return JSON.parse(r.record) as Discovery;
}

export function discoveriesForSession(session: string): Discovery[] {
  return (db.query('SELECT record FROM discovery WHERE session = ? ORDER BY created DESC').all(session) as { record: string }[]).map((r) => JSON.parse(r.record));
}

export function logStage(session: string, stage: string, ms: number, detail = '') {
  db.query('INSERT INTO stage_log (ts, session, stage, ms, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), session, stage, ms, detail);
  console.log(`[${session.slice(0, 8)}] ${stage.padEnd(10)} ${ms.toFixed(0).padStart(6)} ms ${detail}`);
}
export function stageSummary() {
  return db.query("SELECT stage, COUNT(*) n, AVG(ms) avg, MIN(ms) min, MAX(ms) max FROM stage_log WHERE ts > ? GROUP BY stage").all(Date.now() - 24 * 3600_000);
}
