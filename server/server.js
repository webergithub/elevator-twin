#!/usr/bin/env node
/* elevator-api — backend for the elevator digital twin (PR-BE-1/2/5)
 *
 * Zero runtime dependencies: node:http + node:sqlite (Node >= 22).
 * Deploy = scp this file + `pm2 start server.js --name elevator-api`.
 *
 * Design principle P-1: this service is OPTIONAL. The frontend must work fully
 * without it; nothing here is on the critical path of running a simulation.
 */
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';
const PORT = +(process.env.ELV_PORT || 3600);
const HOST = process.env.ELV_HOST || '127.0.0.1';
const DB_PATH = process.env.ELV_DB || path.join(__dirname, 'elevator.db');
const MAX_BODY = 1 << 20;        // P-5: 1 MB per request
const RATE_WRITES = 30;          // P-5: writes per IP per minute
const MAX_PAX_ROWS = 3000;       // P-5: ledger rows per run
const DB_SOFT_CAP = 500 * 1024 * 1024;

/* ── storage ────────────────────────────────────────────── */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS runs(
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, ver TEXT,
    seed INTEGER, hour INTEGER, floors INTEGER, elevs INTEGER,
    pop INTEGER, demand REAL, traffic TEXT, algo TEXT,
    sim_seconds REAL, kpi_json TEXT, note TEXT);
  CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);
  CREATE TABLE IF NOT EXISTS run_pax(
    run_id TEXT NOT NULL, pid INTEGER, from_f INTEGER, to_f INTEGER,
    spawn_s REAL, wait_s REAL, journey_s REAL);
  CREATE INDEX IF NOT EXISTS run_pax_run ON run_pax(run_id);
  CREATE TABLE IF NOT EXISTS scenarios(
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
    name TEXT, cfg_json TEXT NOT NULL, hits INTEGER DEFAULT 0);
`);

/* ── helpers ────────────────────────────────────────────── */
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const hits = new Map();          // ip -> [timestamps]  (P-5 rate limit)

function rateOk(ip) {
  const t = now(), win = t - 60_000;
  const arr = (hits.get(ip) || []).filter(x => x > win);
  if (arr.length >= RATE_WRITES) { hits.set(ip, arr); return false; }
  arr.push(t); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => x > win)) hits.delete(k);
  return true;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',           // same-origin in prod via nginx; open for local dev
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0, done = false; const chunks = [];
    req.on('data', c => {
      if (done) return;                       // keep draining so the client still gets our response
      n += c.length;
      if (n > MAX_BODY) { done = true; chunks.length = 0; reject(Object.assign(new Error('payload too large'), { code: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

const num = (v, d = null) => (Number.isFinite(+v) ? +v : d);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null);

/* ── routes ─────────────────────────────────────────────── */
async function route(req, res, url) {
  const p = url.pathname.replace(/^\/elevator-api/, '') || '/';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

  if (req.method === 'OPTIONS') return send(res, 204, {});

  /* health — never fails hard, reports degraded instead (P-1 observability) */
  if (p === '/health' && req.method === 'GET') {
    let dbSize = 0, ok = true;
    try { dbSize = fs.statSync(DB_PATH).size; } catch { ok = false; }
    const runs = db.prepare('SELECT COUNT(*) c FROM runs').get().c;
    return send(res, 200, {
      status: ok && dbSize < DB_SOFT_CAP ? 'ok' : 'degraded',
      ver: VERSION, node: process.version, uptime_s: Math.round(process.uptime()),
      db_bytes: dbSize, runs,
    });
  }

  /* archive a run (P-3: seed + full config always stored, so it is replayable) */
  if (p === '/runs' && req.method === 'POST') {
    if (!rateOk(ip)) return send(res, 429, { error: 'rate limited' });
    const b = await readBody(req);
    const cfg = b.cfg || {}, kpi = b.kpi || {};
    if (!Number.isFinite(+cfg.seed)) return send(res, 400, { error: 'cfg.seed required (P-3 reproducibility)' });
    const id = str(b.id, 32) || rid();
    if (db.prepare('SELECT 1 FROM runs WHERE id=?').get(id)) return send(res, 200, { id, duplicate: true });
    db.prepare(`INSERT INTO runs(id,created_at,ver,seed,hour,floors,elevs,pop,demand,traffic,algo,sim_seconds,kpi_json,note)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, now(), str(b.ver, 32), num(cfg.seed, 0), num(cfg.startHour), num(cfg.floors), num(cfg.elevs),
      num(cfg.population), num(cfg.demand), str(cfg.traffic, 16), str(b.algo, 16),
      num(kpi.simClock, 0), JSON.stringify(kpi), str(b.note, 500));
    const pax = Array.isArray(b.pax) ? b.pax.slice(0, MAX_PAX_ROWS) : [];
    if (pax.length) {
      const ins = db.prepare('INSERT INTO run_pax(run_id,pid,from_f,to_f,spawn_s,wait_s,journey_s) VALUES(?,?,?,?,?,?,?)');
      for (const r of pax) ins.run(id, num(r.id, 0), num(r.from, 0), num(r.to, 0), num(r.spawn, 0), num(r.wait, 0), num(r.journey, 0));
    }
    return send(res, 201, { id, pax_rows: pax.length });
  }

  if (p === '/runs' && req.method === 'GET') {
    const lim = Math.min(200, num(url.searchParams.get('limit'), 50));
    const rows = db.prepare(`SELECT id,created_at,ver,seed,hour,floors,elevs,pop,demand,traffic,algo,sim_seconds,kpi_json,note
                             FROM runs ORDER BY created_at DESC LIMIT ?`).all(lim);
    return send(res, 200, { runs: rows.map(r => ({ ...r, kpi: JSON.parse(r.kpi_json || '{}'), kpi_json: undefined })) });
  }

  const mRun = p.match(/^\/runs\/([\w-]{1,32})$/);
  if (mRun && req.method === 'GET') {
    const r = db.prepare('SELECT * FROM runs WHERE id=?').get(mRun[1]);
    if (!r) return send(res, 404, { error: 'not found' });
    const pax = db.prepare('SELECT pid,from_f,to_f,spawn_s,wait_s,journey_s FROM run_pax WHERE run_id=?').all(mRun[1]);
    return send(res, 200, { ...r, kpi: JSON.parse(r.kpi_json || '{}'), kpi_json: undefined, pax });
  }

  /* named scenarios — the landing target for share links (PR-BE-5) */
  if (p === '/scenarios' && req.method === 'POST') {
    if (!rateOk(ip)) return send(res, 429, { error: 'rate limited' });
    const b = await readBody(req);
    if (!b.cfg || typeof b.cfg !== 'object') return send(res, 400, { error: 'cfg required' });
    const id = rid();
    db.prepare('INSERT INTO scenarios(id,created_at,name,cfg_json) VALUES(?,?,?,?)')
      .run(id, now(), str(b.name, 80) || 'untitled', JSON.stringify(b.cfg).slice(0, 4000));
    return send(res, 201, { id });
  }

  const mSc = p.match(/^\/scenarios\/([\w-]{1,32})$/);
  if (mSc && req.method === 'GET') {
    const r = db.prepare('SELECT * FROM scenarios WHERE id=?').get(mSc[1]);
    if (!r) return send(res, 404, { error: 'not found' });
    db.prepare('UPDATE scenarios SET hits=hits+1 WHERE id=?').run(mSc[1]);
    return send(res, 200, { id: r.id, name: r.name, cfg: JSON.parse(r.cfg_json), hits: r.hits + 1 });
  }

  return send(res, 404, { error: 'no such endpoint', path: p });
}

/* ── server ─────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  route(req, res, url).catch(err => {
    const code = err.code === 413 ? 413 : err.code === 400 ? 400 : 500;
    send(res, code, { error: err.message || 'internal error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`elevator-api v${VERSION} on http://${HOST}:${PORT}  db=${DB_PATH}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { db.close(); } catch {} server.close(() => process.exit(0)); });
}
