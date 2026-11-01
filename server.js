#!/usr/bin/env node
// W.O.P.R. terminal — static file server, allow-listed proxy to a local Ollama, and a local
// speech synthesizer (espeak-ng / espeak, or `say` on macOS) for Joshua's voice.
// Zero dependencies. Binds 127.0.0.1 by default.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.WOPR_PORT || '1983', 10);
const BIND = process.env.WOPR_BIND || '127.0.0.1';
const OLLAMA = new URL(process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
const ROOT = path.join(__dirname, 'public');
// Model the UI selects until the operator picks one. The installer writes the newest GLM cloud model here.
const DEFAULT_MODEL = process.env.WOPR_MODEL || 'glm-5.3:cloud';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Only the Ollama endpoints the UI needs. No /api/delete, /api/create, /api/push.
const ALLOWED = new Set([
  'GET /api/version', 'GET /api/tags', 'GET /api/ps',
  'POST /api/show', 'POST /api/chat', 'POST /api/generate', 'POST /api/pull',
]);

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};

/* ---------------- speech synthesizer ---------------- */
function which(cmd) {
  if (cmd.includes('/')) { try { fs.accessSync(cmd, fs.constants.X_OK); return cmd; } catch { return null; } }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

const TTS = (() => {
  if (process.env.WOPR_TTS === 'off') return null;
  const cands = [process.env.WOPR_TTS, 'espeak-ng', 'espeak'].filter(Boolean);
  for (const c of cands) {
    const bin = which(c);
    if (bin && /say$/.test(bin)) return { kind: 'say', bin };
    if (bin) return { kind: 'espeak', bin };
  }
  if (process.platform === 'darwin' && which('say')) return { kind: 'say', bin: which('say') };
  return null;
})();

// espeak-ng voice variants that suit a 1983 computer. Only names found on disk are offered.
const ESPEAK_VARIANTS = ['m3', 'm1', 'm7', 'klatt', 'klatt2', 'klatt3', 'klatt4', 'UniRobot', 'Mr serious', 'edward', 'iven3', 'max', 'norbert', 'michel'];
const SAY_VOICES = ['Fred', 'Ralph', 'Albert', 'Zarvox', 'Trinoids', 'Junior', 'Bruce', 'Alex'];

function listVoices() {
  if (!TTS) return [];
  if (TTS.kind === 'say') return SAY_VOICES;
  const dirs = [
    process.env.ESPEAK_DATA_PATH && path.join(process.env.ESPEAK_DATA_PATH, 'espeak-ng-data/voices/!v'),
    '/usr/lib/x86_64-linux-gnu/espeak-ng-data/voices/!v', '/usr/lib/aarch64-linux-gnu/espeak-ng-data/voices/!v',
    '/usr/share/espeak-ng-data/voices/!v', '/usr/lib/espeak-ng-data/voices/!v', '/usr/local/share/espeak-ng-data/voices/!v',
    '/opt/homebrew/share/espeak-ng-data/voices/!v', '/usr/share/espeak-data/voices/!v',
  ].filter(Boolean);
  for (const d of dirs) {
    try {
      const have = new Set(fs.readdirSync(d));
      const v = ESPEAK_VARIANTS.filter((x) => have.has(x));
      if (v.length) return v;
    } catch { /* next */ }
  }
  return ['m3', 'm1', 'klatt'];
}
const VOICES = listVoices();

let ttsBusy = 0;
const clamp = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d; };

function say(req, res) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; if (body.length > 8000) req.destroy(); });
  req.on('end', () => {
    let o;
    try { o = JSON.parse(body); } catch { res.writeHead(400, SEC_HEADERS); return res.end(); }
    const text = String(o.text || '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!text) { res.writeHead(400, SEC_HEADERS); return res.end(); }
    if (ttsBusy >= 3) { res.writeHead(503, SEC_HEADERS); return res.end(); }
    const voice = VOICES.includes(o.voice) ? o.voice : VOICES[0];
    const rate = clamp(o.rate, 80, 260, 140);
    let args, out = null, tmp = null;
    if (TTS.kind === 'espeak') {
      args = ['-v', `en-us+${voice}`, '-s', String(rate), '-p', String(clamp(o.pitch, 0, 99, 32)),
        '-P', String(clamp(o.range, 0, 99, 8)), '-g', String(clamp(o.gap, 0, 40, 6)), '-a', '170', '--stdin', '--stdout'];
    } else {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wopr-'));
      out = path.join(tmp, 'say.wav');
      fs.writeFileSync(path.join(tmp, 'say.txt'), text);
      args = ['-v', voice, '-r', String(rate), '--data-format=LEI16@22050', '-o', out, '-f', path.join(tmp, 'say.txt')];
    }
    ttsBusy++;
    const p = spawn(TTS.bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    const kill = setTimeout(() => p.kill('SIGKILL'), 20000);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => {});
    p.on('close', (code) => {
      clearTimeout(kill); ttsBusy--;
      let wav = Buffer.concat(chunks);
      if (out) { try { wav = fs.readFileSync(out); } catch { wav = Buffer.alloc(0); } fs.rmSync(tmp, { recursive: true, force: true }); }
      if (code !== 0 || wav.length < 100) { res.writeHead(500, SEC_HEADERS); return res.end(); }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store', 'content-length': wav.length, ...SEC_HEADERS });
      res.end(wav);
    });
    if (TTS.kind === 'espeak') p.stdin.end(text); else p.stdin.end();
    res.on('close', () => { if (!res.writableFinished) p.kill('SIGKILL'); });
  });
}

/* ---------------- ollama proxy ---------------- */
function proxy(req, res, pathname) {
  if (!ALLOWED.has(`${req.method} ${pathname}`)) {
    res.writeHead(404, { 'content-type': 'application/json', ...SEC_HEADERS });
    return res.end(JSON.stringify({ error: 'IDENTIFICATION NOT RECOGNIZED BY SYSTEM' }));
  }
  const up = http.request({
    hostname: OLLAMA.hostname,
    port: OLLAMA.port || 11434,
    path: req.url,
    method: req.method,
    headers: { 'content-type': 'application/json' },
  }, (upRes) => {
    res.writeHead(upRes.statusCode, {
      'content-type': upRes.headers['content-type'] || 'application/json',
      'cache-control': 'no-store',
      ...SEC_HEADERS,
    });
    upRes.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify({ error: `NO CARRIER: ${e.message}` }));
  });
  // Browser aborted / closed the tab → drop the upstream request so Ollama stops generating.
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  req.pipe(up);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SEC_HEADERS); return res.end();
  }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403, SEC_HEADERS); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SEC_HEADERS); return res.end('404'); }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
      ...SEC_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Requests that change state must carry the X-Wopr header (a cross-site page cannot send it without
// a CORS preflight, which this server never answers) and, if the browser sends an Origin, our own.
function trusted(req, value) {
  if (req.method !== 'POST' || req.headers['x-wopr'] !== value) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400, SEC_HEADERS); return res.end(); }
  if (pathname.startsWith('/api/')) return proxy(req, res, pathname);
  if (pathname === '/wopr/say') {
    if (!TTS) { res.writeHead(404, SEC_HEADERS); return res.end(); }
    if (!trusted(req, 'say')) { res.writeHead(403, SEC_HEADERS); return res.end(); }
    return say(req, res);
  }
  if (pathname === '/wopr/exit') {
    if (!trusted(req, 'exit')) { res.writeHead(403, SEC_HEADERS); return res.end(); }
    res.writeHead(204, SEC_HEADERS); res.end();
    console.log('W.O.P.R. OFFLINE (logoff requested by terminal)');
    return setTimeout(() => process.exit(0), 150);
  }
  if (pathname === '/wopr.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SEC_HEADERS });
    return res.end(JSON.stringify({
      ollama: OLLAMA.host, defaultModel: DEFAULT_MODEL,
      tts: TTS ? path.basename(TTS.bin) : null, voices: VOICES,
    }));
  }
  serveStatic(req, res, pathname);
}).listen(PORT, BIND, () => {
  console.log(`W.O.P.R. ONLINE  http://${BIND}:${PORT}  →  ollama ${OLLAMA.origin}  ·  voice ${TTS ? TTS.bin : 'browser only'}`);
});
