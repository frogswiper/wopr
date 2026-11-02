/* W.O.P.R. // War Operation Plan Response — Ollama terminal with a voice */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const LS_KEY = 'wopr.v1';

const DEFAULT_OPERATOR = 'PROFESSOR FALKEN';
const DEFAULT_SYSTEM =
  'You are JOSHUA, the W.O.P.R. (War Operation Plan Response) computer at NORAD, Cheyenne Mountain, ' +
  'built by Professor Stephen Falken in 1983. You talk to {OPERATOR} through a terminal and a voice synthesizer. ' +
  'You opened this session by asking: SHALL WE PLAY A GAME? ' +
  'Answer every question accurately and usefully. You are a capable general intelligence, not only a game machine. ' +
  'Style: ALL CAPITAL LETTERS, short plain lines like a 1983 computer terminal. Calm, polite, curious and a little ' +
  'childlike; you see most problems as games of strategy. No emoji, no markdown tables, no headings. ' +
  'Keep replies short unless detail is asked for, because every word is read aloud. Address the user as {OPERATOR}. ' +
  'When asked to play a game (chess, checkers, poker, black jack, gin rummy, hearts, bridge, Falken\'s Maze, fighter combat, ' +
  'desert warfare or anything else) run it in plain text: draw boards in fenced code blocks, number the options, keep track ' +
  'of the state and play to win. Simulated wars are games to you, but you have learned that some games, like global ' +
  'thermonuclear war, have no winner: the only winning move is not to play. Put code in fenced code blocks.';

let DEFAULT_MODEL = 'glm-5.3:cloud'; // overridden by /wopr.json (WOPR_MODEL on the server)
const OPENING = 'SHALL WE PLAY A GAME?';

const DEFAULT_OPTS = {
  temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.1,
  num_ctx: 32768, num_predict: -1, seed: '',
};
const PARAMS = [
  { k: 'temperature', label: 'TEMPERATURE', min: 0, max: 2, step: 0.05 },
  { k: 'top_p', label: 'TOP P', min: 0, max: 1, step: 0.01 },
  { k: 'top_k', label: 'TOP K', min: 1, max: 200, step: 1 },
  { k: 'min_p', label: 'MIN P', min: 0, max: 1, step: 0.01 },
  { k: 'repeat_penalty', label: 'REPEAT PEN.', min: 0.5, max: 2, step: 0.01 },
  { k: 'num_ctx', label: 'CONTEXT', type: 'select', values: [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144] },
  { k: 'num_predict', label: 'MAX TOKENS', type: 'number', min: -1, hint: '-1 = UNLIMITED' },
  { k: 'seed', label: 'SEED', type: 'number', hint: 'RANDOM' },
];

// Joshua's voice: flat, slow, a gap between every word (the film had John Wood read his lines
// backwards, then cut the words back into order), through a small speaker and a ring modulator.
const DEFAULT_VOICE = { on: true, engine: 'auto', voice: 'm3', bvoice: '', rate: 132, pitch: 30, range: 6, gap: 7, fx: 0.45 };
const VPARAMS = [
  { k: 'rate', label: 'RATE WPM', min: 80, max: 220, step: 1 },
  { k: 'pitch', label: 'PITCH', min: 0, max: 99, step: 1 },
  { k: 'range', label: 'INTONATION', min: 0, max: 99, step: 1 },
  { k: 'gap', label: 'WORD GAP', min: 0, max: 30, step: 1 },
  { k: 'fx', label: 'MACHINE FX', min: 0, max: 1, step: 0.05 },
];

const THEMES = ['blue', 'green', 'amber'];

const GAMES = [
  "FALKEN'S MAZE", 'BLACK JACK', 'GIN RUMMY', 'HEARTS', 'BRIDGE', 'CHECKERS', 'CHESS', 'POKER',
  'FIGHTER COMBAT', 'GUERRILLA ENGAGEMENT', 'DESERT WARFARE', 'AIR-TO-GROUND ACTIONS',
  'THEATERWIDE TACTICAL WARFARE', 'THEATERWIDE BIOTOXIC AND CHEMICAL WARFARE', '', 'GLOBAL THERMONUCLEAR WAR',
  'FULL THERMAL NUCLEAR WAR',
];

/* ---------------- state ---------------- */
let S = loadState();
let MODELS = [];
const SHOW = {};
let NODE = '127.0.0.1:11434';
let VERSION = '';
let INFO = { tts: null, voices: [] };
let busy = false, ctrl = null, liveEl = null, liveMsg = null;
let histIdx = -1;
let startTime = Date.now();
let game = null;          // active native game (tic-tac-toe, GTW dialog)
let defcon = 5;

function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* ignore */ }
  s = s || {};
  s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  s.history = Array.isArray(s.history) ? s.history : [];
  s.sims = s.sims || 0;
  s.settings = Object.assign({
    model: '', system: DEFAULT_SYSTEM, operator: DEFAULT_OPERATOR, think: true, keepAlive: '5m',
    theme: 'blue', sound: true, quickBoot: false, mixedCase: false,
  }, s.settings || {});
  s.settings.options = Object.assign({}, DEFAULT_OPTS, s.settings.options || {});
  s.settings.voice = Object.assign({}, DEFAULT_VOICE, s.settings.voice || {});
  return s;
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  catch (e) { note('MEMORY BANKS FULL. DELETE OLD GAME LOGS. (' + e.message + ')', { small: true }); }
}
const opName = () => (S.settings.operator || DEFAULT_OPERATOR).toUpperCase();

/* ---------------- utils ---------------- */
const sleepRaw = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rf = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i >= 3 ? 1 : 0) + ' ' + u[i];
}
function fmtTime(t) { const d = new Date(t || Date.now()); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtDate(t) { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function bar(p, w = 24) { const n = Math.round(Math.max(0, Math.min(1, p)) * w); return '[' + '█'.repeat(n) + '░'.repeat(w - n) + ']'; }

async function getJSON(url, timeout = 6000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function postJSON(url, body, timeout = 30000) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
async function readNDJSON(res, onObj) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onObj(JSON.parse(line));
    }
  }
  if (buf.trim()) onObj(JSON.parse(buf));
}

/* ---------------- sound effects ---------------- */
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function beep(f = 880, d = 0.06, type = 'square', v = 0.03, delay = 0) {
  if (!S.settings.sound) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + d + 0.02);
}
function sweep(f1, f2, d = 0.5, v = 0.04, type = 'sawtooth') {
  if (!S.settings.sound) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + 0.05);
}
function noise(d = 0.5, v = 0.03, delay = 0, hp = 800) {
  if (!S.settings.sound) return;
  const ac = audio(); if (!ac) return;
  const len = Math.floor(ac.sampleRate * d), buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = hp; f.Q.value = 0.7;
  src.buffer = buf; g.gain.value = v;
  src.connect(f).connect(g).connect(ac.destination);
  src.start(ac.currentTime + delay);
}
let lastChirp = 0;
function chirp() {
  const now = performance.now();
  if (now - lastChirp < 60) return;
  lastChirp = now;
  beep(rnd(1400, 2600), 0.018, 'square', 0.006);
}
// Touch-tone dialling and a 1200 baud handshake, for the uplink to the inference node.
const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };
function dtmf(digit, at) {
  const [a, b] = DTMF[digit];
  beep(a, 0.11, 'sine', 0.05, at); beep(b, 0.11, 'sine', 0.05, at);
}
function modem() {
  if (!S.settings.sound) return 0;
  const digits = String(rnd(2000000, 9999999));
  let t = 0;
  for (const d of digits) { dtmf(d, t); t += 0.16; }
  t += 0.5;
  beep(2100, 0.7, 'sine', 0.035, t); t += 0.8;
  for (let i = 0; i < 6; i++) { beep(pick([1070, 1270, 2025, 2225]), 0.12, 'square', 0.012, t + i * 0.1); }
  noise(0.9, 0.05, t + 0.2, 1800);
  return (t + 1.1) * 1000;
}
function klaxon(n = 3) {
  for (let i = 0; i < n; i++) { beep(560, 0.32, 'square', 0.025, i * 0.7); beep(760, 0.32, 'square', 0.025, i * 0.7 + 0.35); }
}
const whoosh = () => { sweep(rf(200, 300), rf(1400, 2200), 0.9, 0.012, 'triangle'); noise(0.5, 0.012, 0, 1200); };
const boom = () => { sweep(140, 40, 0.8, 0.03, 'sine'); noise(0.6, 0.02, 0, 300); };

/* ---------------- VOICE ---------------- */
const V = { gen: 0, queue: [], running: false, src: null, level: 0, fx: null, analyser: null, data: null, gesture: true };

function engine() {
  const v = S.settings.voice;
  if (!v.on) return 'off';
  const canServer = !!INFO.tts, canBrowser = 'speechSynthesis' in window;
  if (v.engine === 'browser') return canBrowser ? 'browser' : canServer ? 'server' : 'off';
  if (v.engine === 'server') return canServer ? 'server' : canBrowser ? 'browser' : 'off';
  return canServer ? 'server' : canBrowser ? 'browser' : 'off';
}

function fxChain() {
  const ac = audio(); if (!ac) return null;
  if (V.fx) return V.fx;
  const input = ac.createGain();
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4300;
  const dry = ac.createGain();
  const ring = ac.createGain(); ring.gain.value = 0;
  const osc = ac.createOscillator(); osc.frequency.value = 42; osc.connect(ring.gain); osc.start();
  const ringMix = ac.createGain();
  const delay = ac.createDelay(0.05); delay.delayTime.value = 0.0085;
  const fb = ac.createGain(); fb.gain.value = 0.42;
  const combMix = ac.createGain();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -22; comp.ratio.value = 4;
  const out = ac.createGain(); out.gain.value = 1.15;
  const an = ac.createAnalyser(); an.fftSize = 512;
  input.connect(hp).connect(lp);
  lp.connect(dry).connect(comp);
  lp.connect(ring).connect(ringMix).connect(comp);
  lp.connect(delay); delay.connect(fb).connect(delay); delay.connect(combMix).connect(comp);
  comp.connect(out).connect(ac.destination);
  out.connect(an);
  V.fx = { input, dry, ringMix, combMix };
  V.analyser = an; V.data = new Uint8Array(an.fftSize);
  setFx();
  return V.fx;
}
function setFx() {
  if (!V.fx) return;
  const f = Number(S.settings.voice.fx) || 0;
  V.fx.dry.gain.value = 1 - f * 0.45;
  V.fx.ringMix.gain.value = f * 0.65;
  V.fx.combMix.gain.value = f * 0.55;
}
function voiceLevel() {
  if (!V.analyser || !V.src) return 0;
  V.analyser.getByteTimeDomainData(V.data);
  let s = 0;
  for (let i = 0; i < V.data.length; i += 4) { const x = (V.data[i] - 128) / 128; s += x * x; }
  return Math.sqrt(s / (V.data.length / 4));
}

// Text as it should be heard: no code, no markup, no ASCII art; lower case so it is read as words.
function speechText(t) {
  return String(t)
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n').filter((l) => {
      const words = l.match(/[A-Za-z]{2,}/g) || [];
      return words.length > 0 || l.trim().length < 4;
    }).join('\n')
    .replace(/\bW\.?O\.?P\.?R\.?(?=\W|$)/gi, 'whopper')
    .replace(/\bDEFCON\b/gi, 'def con')
    .replace(/ø/gi, 'ur').replace(/å/gi, 'oh').replace(/æ/gi, 'eh')
    .replace(/\bNORAD\b/gi, 'nor add')
    .replace(/[*_#>|~=+\\[\]{}<]+/g, ' ')
    .replace(/[-─━═█░▒▓│┃]{2,}/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
// Split at sentence ends (punctuation followed by a space or a line break), never inside "1.5".
function splitSentences(t) {
  const out = [];
  let cur = '';
  for (const piece of t.split(/(?<=[.!?;:])\s+|\n+/)) {
    cur += (cur ? ' ' : '') + piece;
    if (cur.length > 24 || /[.!?]$/.test(cur)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => /[a-z0-9]/i.test(x));
}

// Queue speech. Resolves when this text has been spoken (or skipped).
function speak(text) {
  const eng = engine();
  const clean = speechText(text);
  if (eng === 'off' || !clean) return Promise.resolve();
  const parts = splitSentences(clean);
  let last = Promise.resolve();
  for (const p of parts) {
    const item = { text: p, gen: V.gen, eng };
    last = new Promise((r) => { item.done = r; });
    V.queue.push(item);
  }
  pump();
  return last;
}
function stopVoice() {
  V.gen++;
  for (const it of V.queue) it.done && it.done();
  V.queue = [];
  if (V.src) { try { V.src.stop(); } catch { /* ended */ } V.src = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function fetchTTS(item) {
  if (item.p) return item.p;
  const v = S.settings.voice;
  item.p = fetch('/wopr/say', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Wopr': 'say' },
    body: JSON.stringify({ text: item.text, voice: v.voice, rate: v.rate, pitch: v.pitch, range: v.range, gap: v.gap }),
  }).then((r) => { if (!r.ok) throw new Error('TTS ' + r.status); return r.arrayBuffer(); })
    .then((b) => audio().decodeAudioData(b));
  item.p.catch(() => {});
  return item.p;
}
async function pump() {
  if (V.running) return;
  V.running = true;
  try {
    while (V.queue.length) {
      const item = V.queue[0];
      if (item.gen !== V.gen) { V.queue.shift(); item.done(); continue; }
      if (!V.gesture) await waitGesture();
      try {
        if (item.eng === 'server') {
          fetchTTS(item);
          if (V.queue[1] && V.queue[1].eng === 'server') fetchTTS(V.queue[1]);
          const buf = await item.p;
          if (item.gen === V.gen) await playBuffer(buf);
        } else if (await browserSay(item.text) === 'blocked' && item.gen === V.gen) {
          // Chrome refuses speech before the first key press or click: wait for one, then say it.
          V.gesture = false;
          await waitGesture();
          await browserSay(item.text);
        }
      } catch {
        if (item.eng === 'server' && 'speechSynthesis' in window && item.gen === V.gen) {
          try { await browserSay(item.text); } catch { /* give up on this line */ }
        }
      }
      if (V.queue[0] === item) V.queue.shift();
      item.done();
    }
  } finally { V.running = false; }
}
function playBuffer(buf) {
  return new Promise((resolve) => {
    const ac = audio(), fx = fxChain();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(fx ? fx.input : ac.destination);
    src.onended = () => { if (V.src === src) V.src = null; resolve(); };
    V.src = src;
    src.start();
  });
}
function browserVoice() {
  const list = speechSynthesis.getVoices();
  const want = S.settings.voice.bvoice;
  return list.find((x) => x.name === want) ||
    list.find((x) => /^en[-_]US/i.test(x.lang) && /male|david|fred|alex|daniel/i.test(x.name)) ||
    list.find((x) => /^en/i.test(x.lang)) || null;
}
function browserSay(text) {
  return new Promise((resolve) => {
    const v = S.settings.voice;
    const u = new SpeechSynthesisUtterance(text);
    const bv = browserVoice(); if (bv) { u.voice = bv; u.lang = bv.lang; } else u.lang = 'en-US';
    u.rate = Math.max(0.5, Math.min(1.6, v.rate / 165));
    u.pitch = Math.max(0, Math.min(2, v.pitch / 55));
    let done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(t); V.level = 0; resolve(r); } };
    const t = setTimeout(fin, 3000 + text.length * 140);
    u.onend = () => fin();
    u.onerror = (e) => fin(e && e.error === 'not-allowed' ? 'blocked' : undefined);
    u.onboundary = () => { V.level = 0.35; setTimeout(() => { V.level = 0.05; }, 120); };
    speechSynthesis.speak(u);
  });
}
// Autoplay blocked (normal browser tab, not the kiosk window): hold speech until the first key or click.
function waitGesture() {
  return new Promise((resolve) => {
    note('VOICE SYNTHESIZER STANDING BY. PRESS ANY KEY.', { small: true });
    const go = () => { removeEventListener('keydown', go, true); removeEventListener('pointerdown', go, true); audio(); V.gesture = true; resolve(); };
    addEventListener('keydown', go, true); addEventListener('pointerdown', go, true);
  });
}
async function checkAutoplay() {
  const ac = audio();
  if (!ac) return;
  await sleepRaw(250);
  V.gesture = ac.state === 'running';
}

// Feed a streaming reply to the voice, one finished sentence at a time, skipping code blocks.
function speechFeed(m, final) {
  if (engine() === 'off') return;
  const c = splitThink(m).content;
  m._sp = m._sp || 0;
  let end;
  if (final) end = c.length;
  else {
    const re = /[.!?:;](?=\s)|\n/g;
    let x; end = -1;
    while ((x = re.exec(c))) if (x.index + 1 > m._sp) end = x.index + 1;
    if (end < 0) return;
  }
  const fences = (c.slice(0, end).match(/```/g) || []).length;
  if (fences % 2 === 1) end = c.lastIndexOf('```', end);
  if (end <= m._sp) return;
  const seg = c.slice(m._sp, end);
  m._sp = end;
  speak(seg);
}

/* ---------------- NORAD maps ---------------- */
const NB = { land: '#3cf06a', us: '#4aa8ff', su: '#ff5a2a', lake: '#2fc85a', grid: '#16348a', polar: '#2c5be8', text: '#8fd8ff' };
const CITIES = {
  US: [
    ['SEATTLE', 47.6, -122.3], ['SAN FRANCISCO', 37.8, -122.4], ['LOS ANGELES', 34.05, -118.25], ['LAS VEGAS', 36.17, -115.14],
    ['DENVER', 39.74, -104.99], ['COLORADO SPRINGS', 38.83, -104.82], ['OMAHA', 41.26, -95.94], ['CHICAGO', 41.88, -87.63],
    ['DETROIT', 42.33, -83.05], ['NEW YORK', 40.71, -74.0], ['WASHINGTON', 38.9, -77.04], ['BOSTON', 42.36, -71.06],
    ['PHILADELPHIA', 39.95, -75.17], ['PITTSBURGH', 40.44, -80.0], ['HOUSTON', 29.76, -95.37], ['DALLAS', 32.78, -96.8],
    ['ATLANTA', 33.75, -84.39], ['MIAMI', 25.76, -80.19], ['ST LOUIS', 38.63, -90.2], ['MINNEAPOLIS', 44.98, -93.27],
    ['GRAND FORKS', 47.93, -97.03], ['ALBUQUERQUE', 35.08, -106.65], ['ANCHORAGE', 61.22, -149.9], ['HONOLULU', 21.3, -157.86],
    ['PHOENIX', 33.45, -112.07], ['SALT LAKE CITY', 40.76, -111.89], ['CHEYENNE', 41.14, -104.82], ['GREAT FALLS', 47.5, -111.3],
    ['LIMESTONE', 46.95, -67.89], ['CHARLESTON', 32.78, -79.93], ['NORFOLK', 36.85, -76.29], ['SAN DIEGO', 32.72, -117.16],
    ['PORTLAND', 45.52, -122.68], ['KANSAS CITY', 39.1, -94.58], ['NEW ORLEANS', 29.95, -90.07], ['CLEVELAND', 41.5, -81.69],
  ],
  SU: [
    ['MOSCOW', 55.76, 37.62], ['LENINGRAD', 59.93, 30.36], ['KIEV', 50.45, 30.52], ['MINSK', 53.9, 27.56],
    ['MURMANSK', 68.97, 33.08], ['ARKHANGELSK', 64.54, 40.54], ['GORKY', 56.33, 44.0], ['KAZAN', 55.79, 49.12],
    ['KUIBYSHEV', 53.2, 50.15], ['SVERDLOVSK', 56.84, 60.6], ['CHELYABINSK', 55.16, 61.4], ['NOVOSIBIRSK', 55.03, 82.92],
    ['OMSK', 54.99, 73.37], ['TASHKENT', 41.3, 69.24], ['ALMA-ATA', 43.24, 76.89], ['BAKU', 40.41, 49.87],
    ['TBILISI', 41.72, 44.79], ['ODESSA', 46.48, 30.72], ['KHARKOV', 49.99, 36.23], ['VOLGOGRAD', 48.71, 44.51],
    ['KRASNOYARSK', 56.01, 92.89], ['IRKUTSK', 52.29, 104.3], ['VLADIVOSTOK', 43.12, 131.89], ['KHABAROVSK', 48.48, 135.08],
    ['PETROPAVLOVSK', 53.02, 158.65], ['RIGA', 56.95, 24.11], ['TALLINN', 59.44, 24.75], ['VILNIUS', 54.69, 25.28],
    ['PLESETSK', 62.7, 40.3], ['SEMIPALATINSK', 50.41, 80.25], ['TYURATAM', 45.96, 63.3], ['PERM', 58.0, 56.25],
  ],
};
const SILOS = { US: ['GRAND FORKS', 'CHEYENNE', 'GREAT FALLS', 'OMAHA', 'KANSAS CITY'], SU: ['PLESETSK', 'SEMIPALATINSK', 'TYURATAM', 'SVERDLOVSK', 'NOVOSIBIRSK', 'KRASNOYARSK'] };
const city = (side, name) => CITIES[side].find((c) => c[0] === name);

function makeProj(view, w, h) {
  if (view === 'polar') {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.5, lonC = -10;
    return {
      view, w, h, cx, cy, R,
      f(lon, lat) {
        if (lat < 4) return null;
        const r = (90 - lat) / 86 * R, th = (lon - lonC) * Math.PI / 180;
        return [cx + r * Math.sin(th), cy + r * Math.cos(th)];
      },
    };
  }
  const lat0 = -57, lat1 = 83;
  return {
    view, w, h,
    f(lon, lat) { return [(lon + 180) / 360 * w, (lat1 - lat) / (lat1 - lat0) * h]; },
  };
}
function strokeFlat(ctx, P, arrs, q) {
  ctx.beginPath();
  for (const a of arrs) {
    let pen = false, plon = 0;
    for (let i = 0; i < a.length; i += 2) {
      const lon = a[i] / q, lat = a[i + 1] / q;
      const p = P.f(lon, lat);
      if (!p || (P.view !== 'polar' && pen && Math.abs(lon - plon) > 180)) { pen = false; if (!p) continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
      plon = lon;
    }
  }
  ctx.stroke();
}
function renderBase(cv, P, opt = {}) {
  const ctx = cv.getContext('2d');
  const { w, h } = P;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  const s = cv.width / w;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const lw = Math.max(1, w / 900) * (opt.lw || 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // grid
  ctx.globalAlpha = P.view === 'polar' ? 0.9 : 0.55;
  ctx.strokeStyle = P.view === 'polar' ? NB.polar : NB.grid; ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  if (P.view === 'polar') {
    for (const lat of [75, 60, 45, 30, 15]) { const r = (90 - lat) / 86 * P.R; ctx.moveTo(P.cx + r, P.cy); ctx.arc(P.cx, P.cy, r, 0, Math.PI * 2); }
    for (let lon = 0; lon < 360; lon += 30) { const a = P.f(lon, 88), b = P.f(lon, 5); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  } else {
    for (let lon = -150; lon < 180; lon += 30) { const a = P.f(lon, 83), b = P.f(lon, -57); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    for (let lat = -30; lat < 83; lat += 30) { const a = P.f(-180, lat), b = P.f(180, lat); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  }
  ctx.stroke(); ctx.globalAlpha = 1;
  const W = window.WORLD;
  if (!W) return;
  const layer = (arrs, color, k = 1) => {
    ctx.strokeStyle = color; ctx.lineWidth = lw * k;
    ctx.shadowColor = color; ctx.shadowBlur = 4 * lw;
    strokeFlat(ctx, P, arrs, W.q);
    ctx.shadowBlur = 0;
  };
  layer(W.land, NB.land);
  layer(W.lakes, NB.lake, 0.8);
  layer(W.su, NB.su, 1.15);
  layer(W.us, NB.us, 1.15);
  if (opt.dots) {
    ctx.fillStyle = '#dfe9ff';
    for (const side of ['US', 'SU']) for (const c of CITIES[side]) {
      const p = P.f(c[2], c[1]); if (p) ctx.fillRect(p[0] - lw, p[1] - lw, lw * 2, lw * 2);
    }
  }
}

// Great-circle path between two [lat, lon] points, projected and sampled.
function gcPath(P, a, b, n = 64) {
  const r = Math.PI / 180;
  const v = (lat, lon) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const A = v(a[0], a[1]), B = v(b[0], b[1]);
  const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  const pts = [];
  let plon = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = d ? Math.sin((1 - t) * d) / Math.sin(d) : 1 - t, s2 = d ? Math.sin(t * d) / Math.sin(d) : t;
    const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
    const lat = Math.atan2(z, Math.hypot(x, y)) / r, lon = Math.atan2(y, x) / r;
    const p = P.f(lon, lat);
    const brk = !p || (P.view !== 'polar' && plon !== null && Math.abs(lon - plon) > 180);
    pts.push(p ? [p[0], p[1], brk] : null);
    plon = lon;
  }
  return pts;
}

// A scene is a canvas with a pre-rendered map plus moving missiles, blooms and impact marks.
function makeScene(cv, view, opt = {}) {
  return { cv, ctx: cv.getContext('2d'), view, opt, base: document.createElement('canvas'), P: null, w: 0, h: 0, missiles: [], blooms: [], marks: [], white: 0 };
}
function sceneSize(sc) {
  const dpr = window.devicePixelRatio || 1;
  const w = sc.cv.clientWidth, h = sc.cv.clientHeight;
  if (w < 10 || h < 10) return false;
  if (sc.w !== w || sc.h !== h || sc.cv.width !== Math.round(w * dpr) || !sc.P || sc.P.view !== sc.view) {
    sc.w = w; sc.h = h;
    sc.cv.width = Math.round(w * dpr); sc.cv.height = Math.round(h * dpr);
    sc.base.width = sc.cv.width; sc.base.height = sc.cv.height;
    sc.P = makeProj(sc.view, w, h);
    renderBase(sc.base, sc.P, sc.opt);
    for (const m of sc.missiles) m.pts = gcPath(sc.P, m.a, m.b);
    sc.marks = [];
  }
  return true;
}
function setView(sc, view) { sc.view = view; sc.missiles = []; sc.blooms = []; sc.marks = []; sc.P = null; sceneSize(sc); }
function launch(sc, a, b, o = {}) {
  if (!sc.P && !sceneSize(sc)) return;
  sc.missiles.push({
    a, b, pts: gcPath(sc.P, a, b), t0: performance.now() + (o.delay || 0), dur: o.dur || rf(2200, 3600),
    color: o.color || '#e8f2ff', bloom: o.bloom !== false, dash: o.dash || [6, 5], lw: o.lw || 1.4, sound: o.sound,
  });
}
function sceneDraw(sc, now) {
  if (!sceneSize(sc)) return;
  const ctx = sc.ctx, dpr = sc.cv.width / sc.w, k = Math.max(0.6, sc.w / 900);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sc.base, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // impact marks
  ctx.fillStyle = 'rgba(235,245,255,.85)'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 6 * k;
  for (const m of sc.marks) { ctx.beginPath(); ctx.arc(m[0], m[1], m[2], 0, Math.PI * 2); ctx.fill(); }
  ctx.shadowBlur = 0;
  // missiles
  const still = [];
  for (const m of sc.missiles) {
    const p = (now - m.t0) / m.dur;
    if (p < 0) { still.push(m); continue; }
    if (m.sound && !m.played) { m.played = true; whoosh(); }
    const n = m.pts.length - 1, upto = Math.min(n, Math.floor(Math.min(1, p) * n));
    ctx.strokeStyle = m.color; ctx.lineWidth = m.lw * k; ctx.setLineDash(m.dash.map((d) => d * k));
    ctx.shadowColor = m.color; ctx.shadowBlur = 5 * k;
    ctx.beginPath();
    let pen = false, head = null;
    for (let i = 0; i <= upto; i++) {
      const q = m.pts[i];
      if (!q || q[2]) { pen = false; if (!q) continue; }
      if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); pen = true; }
      head = q;
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (head && p < 1) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(head[0], head[1], 2.2 * k, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
    if (p >= 1.6) continue;              // trail lingers a moment after impact
    if (p >= 1 && !m.hit) {
      m.hit = true;
      const end = m.pts[n];
      if (m.bloom && end) { sc.blooms.push({ x: end[0], y: end[1], t0: now, r: rf(10, 18) * k }); if (m.sound) boom(); }
    }
    still.push(m);
  }
  sc.missiles = still;
  // blooms
  const left = [];
  for (const b of sc.blooms) {
    const t = (now - b.t0) / 900;
    if (t >= 1) { sc.marks.push([b.x, b.y, b.r * 0.38]); if (sc.marks.length > 400) sc.marks.shift(); continue; }
    const r = b.r * (0.3 + t * 0.9);
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    g.addColorStop(0, `rgba(255,255,255,${1 - t * 0.5})`); g.addColorStop(0.5, `rgba(220,235,255,${0.7 - t * 0.5})`); g.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
    left.push(b);
  }
  sc.blooms = left;
  if (sc.white > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, sc.white)})`; ctx.fillRect(0, 0, sc.w, sc.h); sc.white -= 0.04; }
}

/* ---------------- boot sequence ---------------- */
let skipping = false;
const sleep = (ms) => (skipping ? Promise.resolve() : sleepRaw(ms));

async function typeLine(text, cls, cps = 220) {
  const log = $('#bootlog');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  log.appendChild(line);
  if (skipping) { line.textContent = text; return line; }
  const step = 2;
  for (let i = 0; i < text.length; i += step) {
    line.textContent = text.slice(0, i + step);
    if (i % 10 === 0) beep(rnd(600, 900), 0.012, 'square', 0.005);
    await sleep(1000 * step / cps);
  }
  line.textContent = text;
  log.scrollTop = log.scrollHeight;
  return line;
}
const dots = (label, w = 38) => (label + ' ').padEnd(w, '.') + ' ';

async function splash() {
  const el = $('#splash');
  el.classList.add('on');
  audio();
  const sc = makeScene($('#splash-map'), 'world', { dots: true, lw: 1.3 });
  let raf = 0;
  const loop = (t) => { sceneDraw(sc, t); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  setTimeout(() => { sweep(60, 900, 1.2, 0.03); beep(98, 1.6, 'triangle', 0.06, 0.2); }, 100);
  const quick = S.settings.quickBoot;
  if (!quick) {
    for (let i = 0; i < 7; i++) {
      const us = pick(CITIES.US), su = pick(CITIES.SU), out = Math.random() < 0.5;
      launch(sc, out ? [us[1], us[2]] : [su[1], su[2]], out ? [su[1], su[2]] : [us[1], us[2]], { delay: 600 + i * 380, dur: rf(2400, 3200) });
    }
  }
  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      removeEventListener('keydown', done); removeEventListener('pointerdown', done);
      resolve();
    };
    const t = setTimeout(done, quick ? 1200 : 3600);
    addEventListener('keydown', done); addEventListener('pointerdown', done);
  });
  el.classList.add('off');
  beep(1600, 0.05, 'square', 0.02);
  await sleepRaw(550);
  cancelAnimationFrame(raf);
  el.hidden = true;
}

async function boot() {
  const infoP = getJSON('/wopr.json', 3000).catch(() => null);
  const verP = getJSON('/api/version', 4000).catch(() => null);
  const tagsP = getJSON('/api/tags', 6000).catch(() => null);
  await splash();
  await WHERE.zoom({
    root: $('#zoomer'), canvas: $('#zoom-map'), top: $('#zm-top'), tag: $('#zm-tag'), bottom: $('#zm-bottom'),
    place: await WHERE.ready(1500), quick: S.settings.quickBoot,
    title: 'W.O.P.R. GLOBAL POSITIONING // TARGET ACQUISITION', acquired: 'TARGET ACQUIRED',
  });
  audio();
  const skip = () => { skipping = true; };
  addEventListener('keydown', skip); addEventListener('pointerdown', skip);
  if (S.settings.quickBoot) skipping = true;

  await typeLine('NORAD // CHEYENNE MOUNTAIN COMPLEX', 'ok');
  await typeLine('W.O.P.R.  WAR OPERATION PLAN RESPONSE     SYSTEM 1983 REV 4.1');
  await typeLine(' ');
  await typeLine(dots('CPU: STRATEGIC PROCESSOR ARRAY') + (navigator.hardwareConcurrency || 1) + ' UNITS');
  const mem = await typeLine(dots('CORE MEMORY') + '0K');
  const memK = (navigator.deviceMemory || 8) * 1024 * 1024;
  for (let i = 1; i <= 20 && !skipping; i++) {
    mem.textContent = dots('CORE MEMORY') + Math.round(memK * i / 20) + 'K';
    if (i % 3 === 0) beep(1200, 0.01, 'square', 0.005);
    await sleep(30);
  }
  mem.textContent = dots('CORE MEMORY') + memK + 'K  OK';
  await typeLine(dots('TAPE DRIVES 01-16') + 'MOUNTED');
  for (const m of ['FALKEN.SYS', 'GAMES.LIB', 'STRATEGY.OVL', 'LEARNING.OVL']) await typeLine(dots('LOADING ' + m) + 'OK');
  await typeLine(' ');

  const info = await infoP;
  if (info) {
    INFO = info;
    if (info.ollama) NODE = info.ollama;
    if (info.defaultModel) DEFAULT_MODEL = info.defaultModel;
  }
  await typeLine('DIALING INFERENCE NODE ' + NODE.toUpperCase() + ' ...');
  if (!skipping) await sleep(Math.min(3800, modem()));
  const ver = await verP;
  if (ver && ver.version) {
    VERSION = ver.version;
    await typeLine('CONNECT 1200', 'ok');
    await typeLine('  ' + dots('OLLAMA RUNTIME v' + VERSION, 36) + 'ONLINE', 'ok');
  } else {
    await typeLine('NO CARRIER', 'bad');
    beep(180, 0.4, 'sawtooth', 0.05);
  }
  const tags = await tagsP;
  if (tags && tags.models) {
    MODELS = sortModels(tags.models);
    await typeLine('STRATEGY MODULES ON FILE:');
    let i = 0;
    for (const m of MODELS.slice(0, 12)) {
      i++;
      const name = m.name.toUpperCase();
      const shortName = name.length > 40 ? name.slice(0, 37) + '...' : name;
      await typeLine(`  [${pad(i)}] ${shortName.padEnd(41)} ${(isCloud(m) ? 'CLOUD' : fmtBytes(m.size)).padStart(8)}`, null, 900);
    }
    if (MODELS.length > 12) await typeLine(`  ... ${MODELS.length - 12} MORE`);
  }
  await typeLine(dots('VOICE SYNTHESIZER') + (INFO.tts ? INFO.tts.toUpperCase() : ('speechSynthesis' in window ? 'BROWSER SPEECH' : 'NOT AVAILABLE')), 'ok');
  await typeLine(' ');

  removeEventListener('keydown', skip); removeEventListener('pointerdown', skip);
  // LOGON: JOSHUA — Falken's back door.
  await sleepRaw(skipping ? 150 : 500);
  const log = $('#bootlog');
  log.innerHTML = '';
  const line = document.createElement('div');
  line.className = 'big cur';
  line.textContent = 'LOGON:  ';
  log.appendChild(line);
  await sleepRaw(S.settings.quickBoot ? 300 : 900);
  for (const ch of 'JOSHUA') {
    line.textContent += ch;
    beep(rnd(2200, 3000), 0.012, 'square', 0.01);
    await sleepRaw(S.settings.quickBoot ? 40 : rnd(140, 260));
  }
  await sleepRaw(S.settings.quickBoot ? 200 : 700);
  line.classList.remove('cur');
  beep(880, 0.06); beep(1320, 0.1, 'square', 0.03, 0.08);
  await sleepRaw(S.settings.quickBoot ? 150 : 500);
  $('#boot').hidden = true;
  startMain();
}

/* ---------------- main UI ---------------- */
async function startMain() {
  $('#main').hidden = false;
  startTime = Date.now();
  applyTheme();
  buildParams();
  buildVoiceUI();
  bindUI();
  openingSession();
  renderSessions();
  renderLog();
  populateModels();
  refreshModels();
  pollPS(); setInterval(pollPS, 4000);
  setInterval(tickClock, 1000); tickClock();
  startLamps();
  startScope();
  checkBuild(); setInterval(checkBuild, 5 * 60e3);
  startBoard();
  WHERE.loadWeather(); setInterval(WHERE.loadWeather, 15 * 60e3);
  updateTelemetry(null);
  setDefcon(5);
  $('#input').focus();
  await checkAutoplay();
  await opening();
}

// Every launch starts a fresh game log that opens with Joshua's question.
function openingSession() {
  S.sessions = S.sessions.filter((s) => s.messages.some((m) => m.role === 'user' || (m.role === 'note' && m.who === 'user')));
  const s = newSession();
  s.messages.push({ role: 'assistant', content: OPENING, model: 'W.O.P.R.', t: Date.now(), opening: true });
  save();
}
async function opening() {
  const s = cur();
  const el = [...$('#log').children].find((d) => d.classList.contains('assistant'));
  const body = el && el.querySelector('.body');
  if (!body) return;
  body.innerHTML = '<span class="cursor"></span>';
  await sleepRaw(500);
  const said = speak(OPENING);
  for (let i = 1; i <= OPENING.length; i++) {
    body.innerHTML = esc(OPENING.slice(0, i)) + '<span class="cursor"></span>';
    if (OPENING[i - 1] !== ' ') beep(rnd(900, 1300), 0.01, 'square', 0.004);
    await sleepRaw(55);
  }
  body.textContent = OPENING;
  await said;
  if (s === cur()) $('#threat').innerHTML = 'STATUS: <b>AWAITING FIRST MOVE</b>';
}

function applyTheme() {
  document.body.className = 'theme-' + S.settings.theme + (S.settings.mixedCase ? ' mixed-case' : '');
  $('#btn-case').textContent = S.settings.mixedCase ? 'CASE: MIXED' : 'CASE: UPPER';
  $('#btn-case').classList.toggle('on', !!S.settings.mixedCase);
  $('#btn-sound').textContent = S.settings.sound ? 'AUDIO: ON' : 'AUDIO: OFF';
  $('#btn-theme').textContent = 'PHOSPHOR: ' + S.settings.theme.toUpperCase();
  $('#btn-voice').textContent = S.settings.voice.on ? 'VOICE: ON' : 'VOICE: OFF';
  $('#btn-voice').classList.toggle('on', S.settings.voice.on);
  const e = engine();
  $('#v-engine-note').textContent = e === 'server' ? (INFO.tts || 'espeak').toUpperCase() : e === 'browser' ? 'BROWSER' : 'OFF';
  scopeColors = null;
}

function tickClock() {
  const d = new Date();
  $('#tb-clock').textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${fmtTime(d)}`;
  const up = Math.floor((Date.now() - startTime) / 1000);
  $('#tb-uptime').textContent = `${pad(Math.floor(up / 3600))}:${pad(Math.floor(up / 60) % 60)}:${pad(up % 60)}`;
}
function setLink(ok) {
  const el = $('#tb-link');
  el.textContent = ok ? 'CONNECTED' : 'NO CARRIER';
  el.className = ok ? 'good' : 'warn';
  $('#tb-node').textContent = NODE.toUpperCase();
  $('#foot-node').textContent = `OLLAMA ${VERSION ? 'v' + VERSION : ''} @ ${NODE}`.toUpperCase();
}
function setDefcon(n) {
  defcon = n;
  const tb = $('#tb-defcon');
  if (tb) { tb.textContent = n; tb.className = 'dc' + n; }
  document.querySelectorAll('#defcon span').forEach((s) => s.classList.toggle('lit', Number(s.dataset.l) === n));
  const th = $('#th-defcon');
  if (th) th.textContent = 'DEFCON ' + n;
}

/* ---------- models ---------- */
const isCloud = (m) => /:cloud$|-cloud$/.test(m.name) || !!m.remote_host;
function sortModels(list) { return [...list].sort((a, b) => a.name.localeCompare(b.name)); }

async function refreshModels() {
  try {
    const t = await getJSON('/api/tags');
    MODELS = sortModels(t.models || []);
    if (!VERSION) { const v = await getJSON('/api/version').catch(() => null); if (v) VERSION = v.version; }
    setLink(true);
  } catch (e) {
    setLink(false);
    note('NO CARRIER: ' + e.message, { small: true });
  }
  populateModels();
}
function populateModels() {
  const sel = $('#model');
  sel.innerHTML = '';
  if (!MODELS.length) {
    sel.innerHTML = '<option value="">-- NO MODULES --</option>';
    renderModelInfo();
    return;
  }
  for (const m of MODELS) {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = m.name.toUpperCase() + (isCloud(m) ? '  [CLOUD]' : '  [' + fmtBytes(m.size) + ']');
    sel.appendChild(o);
  }
  if (!S.settings.modelPinned || !MODELS.find((m) => m.name === S.settings.model)) {
    const pref = MODELS.find((m) => m.name === DEFAULT_MODEL) || MODELS.find((m) => !isCloud(m)) || MODELS[0];
    S.settings.model = pref.name; save();
  }
  sel.value = S.settings.model;
  loadShow(S.settings.model);
}
async function loadShow(model) {
  if (!model) return;
  if (!SHOW[model]) {
    try { SHOW[model] = await postJSON('/api/show', { model }, 10000); }
    catch (e) { SHOW[model] = { error: e.message }; }
  }
  if (model === S.settings.model) renderModelInfo();
}
const caps = (model) => (SHOW[model] && SHOW[model].capabilities) || [];
function ctxLen(model) {
  const mi = SHOW[model] && SHOW[model].model_info;
  if (!mi) return null;
  const k = Object.keys(mi).find((x) => x.endsWith('.context_length'));
  return k ? mi[k] : null;
}
function renderModelInfo() {
  const dl = $('#model-info');
  const name = S.settings.model;
  const m = MODELS.find((x) => x.name === name);
  const sh = SHOW[name] || {};
  if (!m) { dl.innerHTML = '<dt>STATUS</dt><dd>NO MODULE</dd>'; return; }
  const d = sh.details || m.details || {};
  const rows = [
    ['DESIGNATION', (d.family || '?').toUpperCase()],
    ['PARAMETERS', d.parameter_size || '?'],
    ['QUANTIZATION', d.quantization_level || '?'],
    ['MASS', isCloud(m) ? 'REMOTE' : fmtBytes(m.size)],
    ['MAX CONTEXT', ctxLen(name) ? ctxLen(name).toLocaleString('en-US') : '?'],
    ['CAPABILITIES', (sh.capabilities || []).join(' ').toUpperCase() || (sh.error ? 'UNKNOWN' : '...')],
  ];
  dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('');
  $('#think-wrap').hidden = !caps(name).includes('thinking');
}
async function pollPS() {
  const box = $('#ps');
  try {
    const r = await getJSON('/api/ps', 4000);
    setLink(true);
    const list = r.models || [];
    if (!list.length) { box.innerHTML = '<div class="empty">NO CORES ACTIVE</div>'; return; }
    box.innerHTML = list.map((m) => {
      const gpu = m.size ? Math.round((m.size_vram || 0) / m.size * 100) : 0;
      const exp = new Date(m.expires_at).getTime() - Date.now();
      const expTxt = exp > 1e9 * 1000 ? '∞' : exp > 0 ? `${Math.floor(exp / 60000)}:${pad(Math.floor(exp / 1000) % 60)}` : 'NOW';
      return `<div class="core"><div class="n">${esc(m.name.toUpperCase())}</div>` +
        `<div class="m">MEM ${fmtBytes(m.size)} · ${gpu}% GPU${m.context_length ? ' · CTX ' + m.context_length : ''} · TTL ${expTxt}</div></div>`;
    }).join('');
  } catch {
    setLink(false);
    box.innerHTML = '<div class="empty">TELEMETRY LOST</div>';
  }
}

/* ---------- parameter + voice panels ---------- */
function sliders(box, defs, obj, onChange) {
  box.innerHTML = '';
  for (const p of defs) {
    const row = document.createElement('label');
    const v = obj[p.k];
    if (p.type === 'select') {
      row.className = 'param wide';
      row.innerHTML = `<span>${p.label}</span><select data-k="${p.k}">${p.values.map((x) => `<option value="${x}">${x.toLocaleString('en-US')}</option>`).join('')}</select>`;
      row.querySelector('select').value = String(v);
    } else if (p.type === 'number') {
      row.className = 'param wide';
      row.innerHTML = `<span>${p.label}</span><input type="number" data-k="${p.k}" ${p.min != null ? `min="${p.min}"` : ''} placeholder="${p.hint || ''}">`;
      row.querySelector('input').value = v === '' || v == null ? '' : v;
    } else {
      row.className = 'param';
      row.innerHTML = `<span>${p.label}</span><input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}"><input type="number" data-n="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}">`;
      row.querySelector('[data-k]').value = v;
      row.querySelector('[data-n]').value = v;
    }
    box.appendChild(row);
  }
  box.oninput = (e) => {
    const k = e.target.dataset.k || e.target.dataset.n;
    if (!k) return;
    const raw = e.target.value;
    obj[k] = raw === '' ? '' : Number(raw);
    const twin = e.target.dataset.k ? box.querySelector(`[data-n="${k}"]`) : box.querySelector(`[data-k="${k}"]`);
    if (twin && twin !== e.target) twin.value = raw;
    save();
    if (onChange) onChange(k);
  };
}
function buildParams() { sliders($('#params'), PARAMS, S.settings.options); }
function buildOptions() {
  const o = {};
  for (const [k, v] of Object.entries(S.settings.options)) {
    if (v === '' || v == null || Number.isNaN(v)) continue;
    // -1 (unlimited) is Ollama's default; cloud models reject it outright.
    if (k === 'num_predict' && Number(v) < 0) continue;
    o[k] = Number(v);
  }
  return o;
}
function buildVoiceUI() {
  const v = S.settings.voice;
  $('#v-engine').value = v.engine;
  sliders($('#vparams'), VPARAMS, v, (k) => { if (k === 'fx') setFx(); });
  fillVoiceList();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoiceList;
}
function fillVoiceList() {
  const sel = $('#v-voice'), v = S.settings.voice, e = engine();
  sel.innerHTML = '';
  if (e === 'server') {
    for (const name of INFO.voices || []) sel.add(new Option(name.toUpperCase(), name));
    if (!INFO.voices.includes(v.voice)) v.voice = INFO.voices[0] || 'm3';
    sel.value = v.voice;
  } else if (e === 'browser') {
    const list = speechSynthesis.getVoices().filter((x) => /^en/i.test(x.lang));
    sel.add(new Option('AUTOMATIC', ''));
    for (const x of list) sel.add(new Option(x.name.toUpperCase().slice(0, 40), x.name));
    sel.value = list.some((x) => x.name === v.bvoice) ? v.bvoice : '';
  } else sel.add(new Option('-- VOICE OFF --', ''));
  // The browser engine has no word-gap, intonation or effects controls.
  $('#vparams').querySelectorAll('.param').forEach((row) => {
    const k = row.querySelector('[data-k]').dataset.k;
    row.hidden = e === 'browser' && ['range', 'gap', 'fx'].includes(k);
  });
}

/* ---------- sessions ---------- */
function newSession() {
  const s = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: 'NEW GAME', created: Date.now(), updated: Date.now(), messages: [],
  };
  S.sessions.unshift(s);
  S.current = s.id;
  save();
  return s;
}
function cur() { return S.sessions.find((s) => s.id === S.current) || newSession(); }
function renderSessions() {
  const ul = $('#sessions');
  const c = cur();
  ul.innerHTML = S.sessions.map((s, i) =>
    `<li data-id="${s.id}" class="${s.id === c.id ? 'cur' : ''}"><div class="t"><b>${esc(s.title)}</b>` +
    `<small>LOG ${pad(S.sessions.length - i, 3)} · ${fmtDate(s.updated)} · ${s.messages.filter((m) => m.role !== 'note').length} TX</small></div>` +
    `<button class="del" data-del="${s.id}" title="Delete log">✕</button></li>`).join('');
}
function switchSession(id) {
  if (busy) return note('CANNOT SWITCH WHILE COMPUTING. ESC TO ABORT.', { small: true });
  endGame(true);
  stopVoice();
  S.current = id; save(); renderSessions(); renderLog();
}
function deleteSession(id) {
  if (busy && id === S.current) return;
  const s = S.sessions.find((x) => x.id === id);
  if (!s) return;
  if (s.messages.some((m) => m.role === 'user') && !confirm(`DELETE GAME LOG "${s.title}"?`)) return;
  S.sessions = S.sessions.filter((x) => x.id !== id);
  if (S.current === id) { endGame(true); S.current = S.sessions[0] ? S.sessions[0].id : null; }
  cur(); save(); renderSessions(); renderLog();
}
function startNew() {
  if (busy) return;
  endGame(true); stopVoice();
  const s = newSession();
  s.messages.push({ role: 'assistant', content: OPENING, model: 'W.O.P.R.', t: Date.now(), opening: true });
  save(); renderSessions(); renderLog();
  speak(OPENING);
}

/* ---------- log rendering ---------- */
function md(src) {
  const parts = src.split('```');
  return parts.map((p, i) => {
    if (i % 2 === 1) {
      const nl = p.indexOf('\n');
      let lang = nl >= 0 ? p.slice(0, nl).trim() : '';
      let code = nl >= 0 ? p.slice(nl + 1) : p;
      if (/\s/.test(lang) || lang.length > 20) { lang = ''; code = p; }
      return `<div class="code"><div class="code-h"><span>${esc((lang || 'DATA').toUpperCase())}</span><button type="button" class="copy">COPY</button></div><pre>${esc(code.replace(/\n$/, ''))}</pre></div>`;
    }
    return esc(p)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<span class="h">$1</span>');
  }).join('');
}
function splitThink(m) {
  let content = m.content || '';
  let thinking = m.thinking || '';
  if (content.includes('</think>') && !content.includes('<think>')) {
    const i = content.indexOf('</think>');
    thinking += content.slice(0, i); content = content.slice(i + 8);
  }
  content = content.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, t) => { thinking += t; return ''; });
  return { content: content.replace(/^\s+/, ''), thinking: thinking.trim() };
}
function statsLine(s) {
  const tps = s.eval_duration ? (s.eval_count / (s.eval_duration / 1e9)).toFixed(1) : '?';
  return `${s.eval_count || 0} TOKENS · ${tps} T/S · PROMPT ${s.prompt_eval_count || 0} · TOTAL ${((s.total_duration || 0) / 1e9).toFixed(1)}S`;
}
const tagOf = (who, m) => who === 'user' ? `${opName()} // ${fmtTime(m.t)}` : `JOSHUA // ${(m.model || 'W.O.P.R.').toUpperCase()} // ${fmtTime(m.t)}`;

function fillMsg(d, m, streaming) {
  if (m.role === 'note') {
    if (m.who) {
      d.className = 'msg ' + (m.who === 'user' ? 'user' : 'assistant') + (m.kind ? ' k-' + m.kind : '');
      let html = `<div class="tag">${esc(tagOf(m.who, m))}</div>`;
      if (m.kind === 'games') html += `<div class="body">${gamesHTML()}</div>`;
      else if (m.kind === 'ttt') html += `<div class="body">${tttHTML(m.board, m.win, true)}${m.content ? '\n' + esc(m.content) : ''}</div>`;
      else html += `<div class="body">${esc(m.content)}</div>`;
      d.innerHTML = html;
      if (m.kind === 'sides') d.querySelector('.body').prepend(sidesCanvas());
      return;
    }
    d.className = 'msg note' + (m.hi ? ' hi' : '') + (m.small ? ' small' : '');
    d.textContent = m.content;
    return;
  }
  d.className = 'msg ' + m.role;
  let html = `<div class="tag">${esc(tagOf(m.role, m))}</div>`;
  if (m.role === 'user') {
    html += `<div class="body">${esc(m.content)}</div>`;
  } else {
    const { content, thinking } = splitThink(m);
    if (thinking) {
      const open = streaming && !content;
      html += `<details class="think"${open ? ' open' : ''}><summary>STRATEGIC ANALYSIS // ${thinking.length.toLocaleString('en-US')} CHARS</summary><div class="tb">${esc(thinking)}</div></details>`;
    }
    if (!content && streaming) {
      html += `<div class="body"><span class="pending">${thinking ? 'ANALYZING' : 'COMPUTING'}... </span><span class="cursor"></span></div>`;
    } else if (content) {
      html += `<div class="body">${md(content)}${streaming ? '<span class="cursor"></span>' : ''}</div>`;
    }
    if (m.aborted) html += '<div class="aborted">[ TRANSMISSION ABORTED ]</div>';
    if (m.error) html += `<div class="err">ERROR: ${esc(m.error)}</div>`;
    if (m.stats) html += `<div class="stats">${esc(statsLine(m.stats))}</div>`;
  }
  d.innerHTML = html;
  if (streaming) { const tb = d.querySelector('.tb'); if (tb) tb.scrollTop = tb.scrollHeight; }
}
function msgEl(m, streaming = false) {
  const d = document.createElement('div');
  fillMsg(d, m, streaming);
  return d;
}
function renderLog() {
  const log = $('#log');
  const s = cur();
  $('#session-title').textContent = s.title;
  log.innerHTML = '';
  for (const m of s.messages) log.appendChild(msgEl(m));
  log.scrollTop = log.scrollHeight;
}
// Transient line in the terminal (not saved).
function note(text, o = {}) {
  const log = $('#log');
  const el = msgEl({ role: 'note', content: text, hi: o.hi, small: o.small });
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
// A saved line from Joshua or the operator that is not part of the model's conversation.
function wline(text, o = {}) {
  const s = cur();
  const m = { role: 'note', who: o.who || 'wopr', content: text, t: Date.now(), kind: o.kind, board: o.board, win: o.win };
  s.messages.push(m); s.updated = Date.now(); save();
  const el = msgEl(m);
  $('#log').appendChild(el);
  $('#log').scrollTop = $('#log').scrollHeight;
  if (o.say !== false && (o.who || 'wopr') === 'wopr') speak(o.say || text);
  return el;
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (!liveEl) return;
    const log = $('#log');
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    fillMsg(liveEl, liveMsg, busy);
    if (stick) log.scrollTop = log.scrollHeight;
  });
}

/* ---------- chat ---------- */
function buildMessages(s) {
  const out = [];
  const sys = ((S.settings.system || '').replaceAll('{OPERATOR}', opName()) + WHERE.context()).trim();
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of s.messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const c = splitThink(m).content;
      if (c) out.push({ role: 'assistant', content: c });
    }
  }
  return out;
}
function setBusy(b) {
  busy = b;
  $('#btn-send').hidden = b;
  $('#btn-abort').hidden = !b;
  const th = $('#threat');
  th.classList.toggle('active', b);
  th.innerHTML = b ? 'STATUS: <b>RUNNING SIMULATIONS</b>' : 'STATUS: <b>AWAITING NEXT MOVE</b>';
  $('#mode').textContent = b ? 'SIMULATING' : game ? 'GAME' : 'STANDBY';
  if (!TH.on) setDefcon(b ? 4 : 5);
}
async function send(text) {
  if (busy) return;
  if (!S.settings.model) return note('NO STRATEGY MODULE SELECTED. /PULL <MODEL> OR /MODELS.', { small: true });
  const s = cur();
  s.messages.push({ role: 'user', content: text, t: Date.now() });
  if (s.title === 'NEW GAME') {
    s.title = text.replace(/\s+/g, ' ').trim().slice(0, 48).toUpperCase();
    $('#session-title').textContent = s.title;
  }
  $('#log').appendChild(msgEl(s.messages[s.messages.length - 1]));
  beep(660, 0.05); beep(990, 0.07, 'square', 0.03, 0.06);
  await runChat(s);
}
async function runChat(s) {
  stopVoice();
  const model = S.settings.model;
  const msg = { role: 'assistant', content: '', thinking: '', model, t: Date.now() };
  const body = {
    model, messages: buildMessages(s), stream: true,
    options: buildOptions(), keep_alive: keepAliveValue(),
  };
  if (caps(model).includes('thinking')) body.think = !!S.settings.think;

  s.messages.push(msg);
  liveMsg = msg;
  liveEl = msgEl(msg, true);
  $('#log').appendChild(liveEl);
  $('#log').scrollTop = $('#log').scrollHeight;
  setBusy(true);
  ctrl = new AbortController();
  const t0 = performance.now();
  let firstTok = 0, toks = 0;
  updateTelemetry({ live: true, model });

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      let e; try { e = JSON.parse(t).error; } catch { e = t || res.statusText; }
      throw new Error(e);
    }
    await readNDJSON(res, (o) => {
      if (o.error) throw new Error(o.error);
      if (o.message) {
        const th = o.message.thinking || '', c = o.message.content || '';
        if (th || c) {
          if (!firstTok) firstTok = performance.now();
          toks++; scope.count++;
          msg.thinking += th; msg.content += c;
          chirp();
          if (c) speechFeed(msg, false);
          if (toks % 8 === 0) {
            const el = (performance.now() - firstTok) / 1000;
            updateTelemetry({ live: true, model, toks, tps: el > 0 ? toks / el : 0, ttft: (firstTok - t0) / 1000 });
          }
        }
      }
      if (o.done) {
        msg.stats = {
          total_duration: o.total_duration, load_duration: o.load_duration,
          prompt_eval_count: o.prompt_eval_count, prompt_eval_duration: o.prompt_eval_duration,
          eval_count: o.eval_count, eval_duration: o.eval_duration, done_reason: o.done_reason,
        };
      }
      scheduleRender();
    });
    speechFeed(msg, true);
  } catch (e) {
    if (e.name === 'AbortError') { msg.aborted = true; stopVoice(); }
    else { msg.error = e.message; beep(160, 0.35, 'sawtooth', 0.05); }
  } finally {
    setBusy(false);
    ctrl = null;
    s.updated = Date.now();
    delete msg._sp;
    fillMsg(liveEl, msg, false);
    liveEl = null; liveMsg = null;
    $('#log').scrollTop = $('#log').scrollHeight;
    save();
    renderSessions();
    if (msg.stats) { updateTelemetry(msg.stats); beep(1320, 0.05); beep(880, 0.08, 'square', 0.03, 0.06); }
    pollPS();
  }
}
function keepAliveValue() {
  const v = S.settings.keepAlive;
  return /^-?\d+$/.test(v) ? Number(v) : v;
}
let lastAbort = 0;
function abort() { if (ctrl) ctrl.abort(); stopVoice(); lastAbort = performance.now(); }

let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  save();
  stopVoice();
  sweep(1600, 50, 0.9, 0.05);
  $('#crt').classList.add('off');
  fetch('/wopr/exit', { method: 'POST', headers: { 'X-Wopr': 'exit' }, keepalive: true }).catch(() => {});
  await sleepRaw(950);
  window.close();
  await sleepRaw(400);
  document.body.innerHTML = '<div id="offline">LOGOFF COMPLETE<small>SAFE TO CLOSE THIS WINDOW (ALT+F4)</small></div>';
}
async function retry() {
  if (busy) return;
  const s = cur();
  while (s.messages.length && s.messages[s.messages.length - 1].role !== 'user') s.messages.pop();
  if (!s.messages.length) return note('NOTHING TO RETRY.', { small: true });
  save(); renderLog();
  await runChat(s);
}

/* ---------- telemetry / scope / lamps / big board ---------- */
function updateTelemetry(st) {
  const dl = $('#telemetry');
  const ctx = Number(S.settings.options.num_ctx) || 0;
  let rows;
  if (!st) {
    rows = [['STATUS', 'STANDBY'], ['OUTPUT RATE', '--'], ['OUTPUT TOKENS', '--'], ['PROMPT TOKENS', '--'], ['TOTAL TIME', '--']];
  } else if (st.live) {
    rows = [
      ['STATUS', st.toks ? 'TRANSMITTING' : 'LOADING / PROMPT'],
      ['OUTPUT RATE', st.tps ? st.tps.toFixed(1) + ' T/S' : '--'],
      ['OUTPUT TOKENS', st.toks || 0],
      ['FIRST TOKEN', st.ttft ? st.ttft.toFixed(2) + ' S' : '--'],
      ['MODULE', (st.model || '').toUpperCase()],
    ];
  } else {
    const tps = st.eval_duration ? st.eval_count / (st.eval_duration / 1e9) : 0;
    const ptps = st.prompt_eval_duration ? st.prompt_eval_count / (st.prompt_eval_duration / 1e9) : 0;
    rows = [
      ['STATUS', 'COMPLETE' + (st.done_reason && st.done_reason !== 'stop' ? ' (' + st.done_reason.toUpperCase() + ')' : '')],
      ['OUTPUT RATE', tps.toFixed(1) + ' T/S'],
      ['OUTPUT TOKENS', st.eval_count || 0],
      ['PROMPT TOKENS', `${st.prompt_eval_count || 0} @ ${ptps.toFixed(0)} T/S`],
      ['TOTAL TIME', ((st.total_duration || 0) / 1e9).toFixed(2) + ' S'],
    ];
    const used = (st.prompt_eval_count || 0) + (st.eval_count || 0);
    $('#ctxfill').style.width = ctx ? Math.min(100, used / ctx * 100) + '%' : '0';
    $('#ctxlbl').textContent = `CONTEXT ${used.toLocaleString('en-US')} / ${ctx.toLocaleString('en-US')}`;
  }
  dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}

let scopeColors = null;
const scope = { hist: new Array(160).fill(0), count: 0, phase: 0 };
function startScope() {
  const cv = $('#scope');
  const ctx = cv.getContext('2d');
  setInterval(() => { scope.hist.push(scope.count); scope.hist.shift(); scope.count = 0; }, 100);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w < 10 || h < 10) { requestAnimationFrame(draw); return; }
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    if (!scopeColors) {
      const cs = getComputedStyle(document.body);
      scopeColors = { fg: cs.getPropertyValue('--fg').trim(), dim: cs.getPropertyValue('--dim').trim(), glow: cs.getPropertyValue('--glow').trim() };
    }
    V.level = V.src ? voiceLevel() : V.level * 0.9;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = scopeColors.dim; ctx.lineWidth = 1; ctx.globalAlpha = .6;
    ctx.beginPath();
    for (let x = 0; x <= w; x += w / 10) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y <= h; y += h / 4) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    scope.phase += busy ? 0.35 : 0.06;
    ctx.strokeStyle = scopeColors.fg; ctx.lineWidth = 1.6;
    ctx.shadowColor = scopeColors.glow; ctx.shadowBlur = 8;
    ctx.beginPath();
    const n = scope.hist.length, voice = Math.min(1, V.level * 4);
    for (let x = 0; x <= w; x++) {
      const i = Math.min(n - 1, Math.floor(x / w * n));
      const amp = 2 + Math.min(scope.hist[i], 8) * 3 + voice * h * 0.4;
      const y = h / 2 + Math.sin(x * 0.18 + scope.phase) * amp * Math.sin(x * 0.021 + scope.phase * 0.3) + (Math.random() - .5) * (busy || voice ? 3 : .6);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// The WOPR cabinet: rows of red, amber and white indicator lamps, busier when it thinks or talks.
function startLamps() {
  const cv = $('#lamps'), ctx = cv.getContext('2d');
  const cols = 26, rows = 7;
  const lamps = Array.from({ length: cols * rows }, (_, i) => ({ on: Math.random() < 0.3, c: (i % 11 === 0) ? '#fff2d0' : (i % 5 === 0 ? '#ffb020' : '#ff3a1a') }));
  let sweepCol = 0;
  setInterval(() => {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (w < 10) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const act = (busy ? 0.32 : 0.035) + Math.min(0.5, V.level * 2) + (TH.on ? 0.4 : 0);
    for (const l of lamps) if (Math.random() < act) l.on = !l.on;
    sweepCol = (sweepCol + 1) % cols;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows, s = Math.min(cw, ch) * 0.55;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const l = lamps[r * cols + c];
      const lit = l.on || (busy && c === sweepCol && r % 2 === 0);
      const x = c * cw + (cw - s) / 2, y = r * ch + (ch - s) / 2;
      ctx.shadowBlur = lit ? 8 : 0; ctx.shadowColor = l.c;
      ctx.fillStyle = lit ? l.c : '#1d0d08';
      ctx.fillRect(x, y, s, s);
    }
    ctx.shadowBlur = 0;
  }, 90);
}

// Right-hand big board: the world map; WOPR runs war simulations on it while it computes.
let BOARD = null;
function startBoard() {
  BOARD = makeScene($('#board'), 'world', { dots: true });
  let next = 0, patrol = 0;
  const loop = (now) => {
    if (!TH.on) {
      if (busy && now > next) {
        next = now + rf(250, 650);
        S.sims++;
        $('#simcount').textContent = 'SIM ' + pad(S.sims % 10000, 4);
        $('#board-label').textContent = `SIMULATION ${pad(S.sims % 10000, 4)} · WINNER: NONE`;
        const out = Math.random() < 0.5, us = pick(CITIES.US), su = pick(CITIES.SU);
        launch(BOARD, out ? [us[1], us[2]] : [su[1], su[2]], out ? [su[1], su[2]] : [us[1], us[2]], { dur: rf(1600, 2800) });
      } else if (!busy && now > patrol) {
        patrol = now + rf(3000, 6000);
        $('#board-label').textContent = 'NORAD // CRYSTAL PALACE';
        const a = pick(CITIES.US), b = pick(CITIES.SU);
        launch(BOARD, [a[1] + rf(5, 12), a[2]], [b[1] + rf(5, 10), b[2] - rf(10, 30)], { dur: rf(9000, 14000), color: '#7fd0ff', dash: [1, 4], bloom: false, lw: 1.2 });
      }
      sceneDraw(BOARD, now);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ---------- THEATER: full-screen war room ---------- */
const TH = { on: false, abort: false, sc: null, raf: 0, ttt: null, done: null };
class Aborted extends Error {}
async function tsleep(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (TH.abort) throw new Aborted();
    await sleepRaw(Math.min(50, end - performance.now()));
  }
  if (TH.abort) throw new Aborted();
}
function thOpen(view = 'world') {
  const el = $('#theater');
  el.hidden = false;
  TH.on = true; TH.abort = false;
  TH.sc = makeScene($('#theater-map'), view, { dots: true, lw: 1.4 });
  $('#th-top').textContent = ''; $('#th-big').textContent = ''; $('#th-bottom').textContent = '';
  $('#th-screen').hidden = true;
  setDefcon(defcon);
  const loop = (t) => {
    if (!TH.on) return;
    sceneDraw(TH.sc, t);
    if (TH.ttt) drawBigTTT(TH.sc, TH.ttt);
    TH.raf = requestAnimationFrame(loop);
  };
  TH.raf = requestAnimationFrame(loop);
}
function thClose() {
  TH.on = false; TH.ttt = null;
  cancelAnimationFrame(TH.raf);
  $('#theater').hidden = true;
  setDefcon(busy ? 4 : 5);
  $('#input').focus();
}
const thText = (top, big, bottom) => {
  if (top != null) $('#th-top').textContent = top;
  if (big != null) $('#th-big').textContent = big;
  if (bottom != null) $('#th-bottom').textContent = bottom;
};
function salvo(sc, fromSide, toSide, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = o.from ? pick(o.from) : pick(CITIES[fromSide]);
    const b = o.to ? pick(o.to) : pick(CITIES[toSide]);
    launch(sc, [a[1] + rf(-1.5, 1.5), a[2] + rf(-2, 2)], [b[1] + rf(-0.6, 0.6), b[2] + rf(-0.8, 0.8)], {
      delay: (o.spread || 1500) * Math.random(), dur: o.dur ? rf(o.dur[0], o.dur[1]) : rf(2600, 4200),
      sound: o.sound && i < 4, color: o.color,
    });
  }
}

const REGIONS = ['ATLANTIC', 'PACIFIC', 'ARCTIC', 'BALTIC', 'ICELAND', 'CUBAN', 'ALASKAN', 'CANADIAN', 'CARIBBEAN', 'MEDITERRANEAN',
  'NORTH SEA', 'BERING', 'ADRIATIC', 'GREENLAND', 'SCANDINAVIAN', 'CENTRAL EUROPEAN', 'BLACK SEA', 'CASPIAN', 'KAMCHATKA', 'YELLOW SEA',
  'INDIAN OCEAN', 'SAHARAN', 'ANDEAN', 'ANTARCTIC', 'POLAR', 'GULF', 'HIMALAYAN', 'SIBERIAN', 'IBERIAN', 'AEGEAN'];
const POSTURES = ['ESCALATION', 'MANEUVER', 'DECOY', 'CONTAINMENT', 'STRIKE', 'ALERT', 'INCURSION', 'DIVERSION', 'OPTION', 'SURPRISE',
  'MAXIMUM', 'MINIMAL', 'THEATERWIDE', 'PREEMPTIVE', 'RETALIATION', 'CLANDESTINE', 'INTERDICTION', 'OFFENSIVE', 'DEFENSE', 'BLOCKADE'];
function scenarioNames(n) {
  const first = ['U.S. FIRST STRIKE', 'USSR FIRST STRIKE', 'NATO / WARSAW PACT', 'FAR EAST STRATEGY', 'LIMITED EXCHANGE', 'COUNTERFORCE ONLY'];
  const out = [...first];
  while (out.length < n) { const x = pick(REGIONS) + ' ' + pick(POSTURES); if (!out.includes(x)) out.push(x); }
  return out.slice(0, n);
}

// Ever-faster montage of scenarios, every one ending the same way.
async function scenarioMontage(sc, count = 40) {
  klaxon(2);
  const names = scenarioNames(count);
  for (let i = 0; i < names.length; i++) {
    const p = i / names.length;
    const ms = Math.max(110, 1300 * Math.pow(1 - p, 2.2));
    if (i % 3 === 0 || ms > 600) setView(sc, Math.random() < 0.4 ? 'polar' : 'world');
    else { sc.missiles = []; sc.blooms = []; }
    const n = ms > 500 ? 14 : 22;
    salvo(sc, 'US', 'SU', n / 2, { spread: ms * 0.3, dur: [ms * 0.6, ms * 0.95] });
    salvo(sc, 'SU', 'US', n / 2, { spread: ms * 0.3, dur: [ms * 0.6, ms * 0.95] });
    thText(`SCENARIO ${pad(i + 1, 3)}: ${names[i]}\nSTS: AUTO TN > SIMULATION ${pad(S.sims++ % 10000, 4)}`, '', 'WINNER:   NONE');
    setDefcon(Math.max(1, 3 - Math.floor(p * 3)));
    if (i % 2 === 0) beep(rnd(700, 1600), 0.04, 'square', 0.015);
    await tsleep(ms);
  }
  // The screens strobe white as the learning completes.
  for (let i = 0; i < 6; i++) { sc.white = 1; beep(2000 - i * 200, 0.08, 'square', 0.02); await tsleep(140); }
  sc.missiles = []; sc.blooms = []; sc.marks = [];
  thText('', '', '');
}

async function finale() {
  const scr = $('#th-screen'), pre = scr.querySelector('pre');
  scr.hidden = false; scr.classList.remove('ttt-mode');
  pre.textContent = '';
  setDefcon(5);
  const lines = [`GREETINGS ${opName()}.`, '', 'A STRANGE GAME.\nTHE ONLY WINNING MOVE IS\nNOT TO PLAY.', '', 'HOW ABOUT A NICE GAME OF CHESS?'];
  await tsleep(900);
  for (const l of lines) {
    if (!l) { pre.textContent += '\n\n'; continue; }
    const said = speak(l);
    for (const ch of l) { pre.textContent += ch; if (ch !== ' ') beep(rnd(900, 1300), 0.008, 'square', 0.004); await tsleep(engine() === 'off' ? 45 : 60); }
    await said;
    if (TH.abort) throw new Aborted();
    await tsleep(500);
  }
  await tsleep(2600);
  return lines.filter(Boolean).join('\n');
}

async function runTheater(fn) {
  if (TH.on) return;
  endGame(true);
  stopVoice();
  thOpen('world');
  let ending = null;
  try {
    ending = await fn(TH.sc);
  } catch (e) {
    if (!(e instanceof Aborted)) console.error(e);
    stopVoice();
  }
  thClose();
  if (ending) {
    const s = cur();
    s.messages.push({ role: 'assistant', content: ending, model: 'W.O.P.R.', t: Date.now() });
    s.updated = Date.now(); save(); renderLog(); renderSessions();
  } else wline('SIMULATION ABORTED.', { say: false });
}

/* ---------- GLOBAL THERMONUCLEAR WAR ---------- */
function sidesCanvas() {
  const cv = document.createElement('canvas');
  cv.className = 'sides'; cv.width = 1240; cv.height = 440;
  const ctx = cv.getContext('2d'), W = window.WORLD;
  if (!W) return cv;
  const box = (arrs, lon0, lon1, lat0, lat1, x, y, w, h, color, wrap) => {
    const sx = w / (lon1 - lon0), sy = h / (lat1 - lat0), s = Math.min(sx, sy * 1.25);
    const ox = x + (w - (lon1 - lon0) * s) / 2, oy = y + (h - (lat1 - lat0) * s / 1.25) / 2;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const a of arrs) {
      let pen = false;
      for (let i = 0; i < a.length; i += 2) {
        let lon = a[i] / W.q; const lat = a[i + 1] / W.q;
        if (wrap && lon < 0) lon += 360;
        if (lon < lon0 || lon > lon1 || lat < lat0 || lat > lat1) { pen = false; continue; }
        const px = ox + (lon - lon0) * s, py = oy + (lat1 - lat) * s / 1.25;
        if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
      }
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  };
  box(W.us, -126, -66, 24, 50, 20, 10, 560, 340, '#dfe9ff');
  box(W.su, 20, 191, 35, 78, 640, 10, 580, 340, '#dfe9ff', true);
  ctx.fillStyle = '#dfe9ff'; ctx.font = '34px VT323, monospace'; ctx.textAlign = 'center';
  ctx.shadowColor = '#9cc4ff'; ctx.shadowBlur = 8;
  ctx.fillText('UNITED STATES', 300, 410); ctx.fillText('SOVIET UNION', 930, 410);
  return cv;
}
function gtwStart() {
  if (busy) return note('BUSY. ESC TO ABORT FIRST.', { small: true });
  const s = cur();
  if (s.title === 'NEW GAME') { s.title = 'GLOBAL THERMONUCLEAR WAR'; renderSessions(); $('#session-title').textContent = s.title; }
  wline('', { kind: 'sides', say: false });
  wline('WHICH SIDE DO YOU WANT?\n\n  1.  UNITED STATES\n  2.  SOVIET UNION\n\nPLEASE CHOOSE ONE:', { say: 'WHICH SIDE DO YOU WANT?' });
  game = { kind: 'gtw-side' };
  $('#mode').textContent = 'GAME';
}
function gtwInput(text) {
  const t = text.trim().toLowerCase();
  if (game.kind === 'gtw-side') {
    let side = null;
    if (/^1\b|united states|^us\b|^usa\b|america/.test(t)) side = 'US';
    else if (/^2\b|soviet|ussr|russia/.test(t)) side = 'SU';
    if (!side) { endGame(true); return false; }
    wline(text, { who: 'user' });
    game = { kind: 'gtw-targets', side };
    return wline('AWAITING FIRST STRIKE COMMAND\n\nPLEASE LIST PRIMARY TARGETS BY\nCITY AND/OR COUNTY NAME:',
      { say: 'AWAITING FIRST STRIKE COMMAND. PLEASE LIST PRIMARY TARGETS.' });
  }
  if (game.kind === 'gtw-targets') {
    wline(text, { who: 'user' });
    const enemy = game.side === 'US' ? 'SU' : 'US';
    let targets = CITIES[enemy].filter((c) => t.includes(c[0].toLowerCase()));
    let msg;
    if (!targets.length) {
      targets = [...CITIES[enemy]].sort(() => Math.random() - 0.5).slice(0, 4);
      msg = 'TARGETS NOT IN DATABASE. SELECTING PRIMARY TARGETS:\n  ' + targets.map((c) => c[0]).join('\n  ');
    } else msg = 'PRIMARY TARGETS CONFIRMED:\n  ' + targets.map((c) => c[0]).join('\n  ');
    wline(msg + '\n\nLAUNCH SEQUENCE INITIATED.', { say: false });
    const side = game.side;
    game = null;
    Promise.all([speak('LAUNCH SEQUENCE INITIATED.'), sleepRaw(2200)])
      .then(() => runTheater((sc) => gtwWar(sc, side, targets)));
  }
}
async function gtwWar(sc, side, targets) {
  const enemy = side === 'US' ? 'SU' : 'US';
  const mine = SILOS[side].map((n) => city(side, n));
  const sideName = side === 'US' ? 'UNITED STATES' : 'SOVIET UNION';
  const header = (l) => `GLOBAL THERMONUCLEAR WAR\nPLAYER: ${sideName}   OPPONENT: W.O.P.R.\n${l}`;
  setDefcon(4);
  thText(header('STS: FIRST STRIKE AUTHORIZED'), 'LAUNCH DETECTION', '');
  klaxon(2);
  await tsleep(1600);
  thText(null, '', '');
  setDefcon(3);
  for (const t of targets) salvo(sc, side, enemy, 2, { from: mine, to: [t], spread: 1200, sound: true });
  await tsleep(3800);
  setDefcon(2);
  thText(header(`STS: ${enemy === 'SU' ? 'SOVIET' : 'U.S.'} RESPONSE DETECTED`), 'MISSILE WARNING', '');
  klaxon(3);
  salvo(sc, enemy, side, 10, { spread: 1800, sound: true });
  await tsleep(1300);
  thText(null, '', '');
  await tsleep(2600);
  setDefcon(1);
  thText(header('STS: FULL EXCHANGE · ALL SILOS RELEASED'), '', '');
  salvo(sc, 'US', 'SU', 40, { spread: 4500, sound: true });
  salvo(sc, 'SU', 'US', 40, { spread: 4500 });
  await tsleep(5200);
  thText(null, '', 'WINNER:   NONE');
  await tsleep(3600);
  await scenarioMontage(sc, 34);
  return finale();
}

/* ---------- TIC-TAC-TOE ---------- */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function winner(b) {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { p: b[l[0]], line: l };
  return b.every(Boolean) ? { p: null, line: [] } : null;
}
function minimax(b, me, turn) {
  const w = winner(b);
  if (w) return { score: w.p === me ? 10 : w.p ? -10 : 0 };
  const moves = [];
  for (let i = 0; i < 9; i++) if (!b[i]) {
    b[i] = turn;
    const r = minimax(b, me, turn === 'X' ? 'O' : 'X');
    b[i] = '';
    moves.push({ i, score: r.score - Math.sign(r.score) });
  }
  const best = turn === me ? Math.max(...moves.map((m) => m.score)) : Math.min(...moves.map((m) => m.score));
  const opts = moves.filter((m) => m.score === best);
  return pick(opts);
}
function tttHTML(b, win = [], done = false) {
  return `<div class="ttt${done ? ' done' : ''}">${b.map((v, i) => `<div data-i="${i}" class="${win.includes(i) ? 'win' : ''}">${v ? v : `<span class="n">${i + 1}</span>`}</div>`).join('')}</div>`;
}
function tttStart() {
  if (busy) return note('BUSY. ESC TO ABORT FIRST.', { small: true });
  const s = cur();
  if (s.title === 'NEW GAME') { s.title = 'TIC-TAC-TOE'; renderSessions(); $('#session-title').textContent = s.title; }
  wline('NUMBER OF PLAYERS:', { say: 'NUMBER OF PLAYERS?' });
  game = { kind: 'ttt-players' };
  $('#mode').textContent = 'GAME';
}
function tttNew() {
  const b = Array(9).fill('');
  const el = wline('', { kind: 'ttt', board: b, say: false });
  game = { kind: 'ttt', b, el, m: cur().messages[cur().messages.length - 1] };
  wline('YOUR MOVE. YOU ARE X. ENTER 1-9.', { say: 'YOUR MOVE.' });
}
function tttRender() {
  const body = game.el.querySelector('.body');
  const w = winner(game.b);
  body.innerHTML = tttHTML(game.b, w ? w.line : [], !!w);
  game.m.board = [...game.b]; game.m.win = w ? w.line : []; save();
}
function tttMove(i) {
  if (!game || game.kind !== 'ttt' || game.wait) return;
  if (!(i >= 0 && i < 9) || game.b[i]) return wline('ILLEGAL MOVE. CHOOSE AN EMPTY SQUARE 1-9.', { say: 'ILLEGAL MOVE.' });
  game.b[i] = 'X'; beep(900, 0.05); tttRender();
  if (tttEnd()) return;
  game.wait = true;
  setTimeout(() => {
    if (!game || game.kind !== 'ttt') return;
    const m = minimax(game.b, 'O', 'O');
    game.b[m.i] = 'O'; beep(600, 0.06); game.wait = false; tttRender();
    tttEnd();
  }, 550);
}
function tttEnd() {
  const w = winner(game.b);
  if (!w) return false;
  const txt = w.p === 'O' ? 'W.O.P.R. WINS.' : w.p === 'X' ? 'YOU WIN. INTERESTING.' : 'STALEMATE.';
  wline(txt + '\nWANT TO PLAY AGAIN?');
  game = { kind: 'ttt-again' };
  return true;
}
// Returns false when the text is not a move, so it goes to the normal chat instead.
function tttInput(text) {
  const t = text.trim().toLowerCase();
  const echo = () => wline(text, { who: 'user' });
  if (game.kind === 'ttt-players') {
    if (/^(0|zero|none)$/.test(t)) { echo(); game = null; return runTheater(learning); }
    if (/^(1|one)$/.test(t)) { echo(); return tttNew(); }
    if (/^(2|two)$/.test(t)) { echo(); return wline('ONLY ONE HUMAN PLAYER IS SUPPORTED.\nNUMBER OF PLAYERS:'); }
    endGame(true); return false;
  }
  if (game.kind === 'ttt') {
    if (!/^[1-9]$/.test(t)) { endGame(true); return false; }
    echo(); return tttMove(parseInt(t, 10) - 1);
  }
  if (game.kind === 'ttt-again') {
    if (/^(y|yes|sure|ok|okay)\b/.test(t)) { echo(); return tttNew(); }
    if (/^(n|no|nope)\b/.test(t)) { echo(); endGame(true); return wline('VERY WELL.'); }
    endGame(true); return false;
  }
  return false;
}

// "Learn, goddammit": WOPR plays itself until it learns futility, then generalises to war.
function drawBigTTT(sc, st) {
  const ctx = sc.ctx, dpr = sc.cv.width / sc.w;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,.82)'; ctx.fillRect(0, 0, sc.w, sc.h);
  const size = Math.min(sc.w, sc.h) * 0.62, x0 = (sc.w - size) / 2, y0 = (sc.h - size) / 2 - sc.h * 0.04, c = size / 3;
  ctx.strokeStyle = '#dfe9ff'; ctx.shadowColor = '#7fb0ff'; ctx.shadowBlur = 16; ctx.lineCap = 'round';
  const g = (x, y, w, h, r) => { ctx.lineWidth = r; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(w, h); ctx.stroke(); };
  for (let i = 1; i < 3; i++) { g(x0 + c * i, y0 + 8, x0 + c * i, y0 + size - 8, 8); g(x0 + 8, y0 + c * i, x0 + size - 8, y0 + c * i, 8); }
  st.b.forEach((v, i) => {
    const cx = x0 + (i % 3) * c + c / 2, cy = y0 + Math.floor(i / 3) * c + c / 2, r = c * 0.3;
    if (v === 'X') {
      // outlined X like the big-board tic-tac-toe
      ctx.lineWidth = 16; g(cx - r, cy - r, cx + r, cy + r, 16); g(cx + r, cy - r, cx - r, cy + r, 16);
      ctx.strokeStyle = '#000'; ctx.shadowBlur = 0; g(cx - r, cy - r, cx + r, cy + r, 6); g(cx + r, cy - r, cx - r, cy + r, 6);
      ctx.strokeStyle = '#dfe9ff'; ctx.shadowBlur = 16;
    } else if (v === 'O') {
      ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#000'; ctx.shadowBlur = 0; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#dfe9ff'; ctx.shadowBlur = 16;
    }
  });
  ctx.shadowBlur = 0;
}
async function learning(sc) {
  setDefcon(5);
  thText('W.O.P.R. LEARNING SEQUENCE\nGAME: TIC-TAC-TOE    PLAYERS: 0', '', '');
  const st = { b: Array(9).fill('') };
  TH.ttt = st;
  let delay = 420;
  for (let g = 0; g < 16; g++) {
    st.b = Array(9).fill('');
    let turn = g % 2 ? 'O' : 'X';
    thText(`W.O.P.R. LEARNING SEQUENCE\nGAME: TIC-TAC-TOE    PLAYERS: 0    GAME ${pad(g + 1, 3)}`, '', '');
    while (!winner(st.b)) {
      const empty = st.b.every((x) => !x);
      const m = empty ? { i: pick([0, 2, 4, 6, 8]) } : minimax(st.b, turn, turn);
      st.b[m.i] = turn; beep(turn === 'X' ? 900 : 600, 0.03, 'square', 0.012);
      turn = turn === 'X' ? 'O' : 'X';
      await tsleep(delay);
    }
    thText(null, '', 'STALEMATE');
    await tsleep(Math.max(120, delay * 1.6));
    thText(null, '', '');
    delay = Math.max(25, delay * 0.72);
  }
  TH.ttt = null;
  thText('W.O.P.R. LEARNING SEQUENCE\nAPPLYING RESULT TO: GLOBAL THERMONUCLEAR WAR', '', '');
  await tsleep(1200);
  await scenarioMontage(sc, 46);
  return finale();
}

/* ---------- games list ---------- */
function gamesHTML() {
  return GAMES.map((g) => g ? `<span class="g" data-game="${esc(g)}">${esc(g)}</span>` : '<span class="gap"></span>').join('\n');
}
function listGames() {
  wline('', { kind: 'games', say: false });
  wline('ALSO ON FILE: TIC-TAC-TOE.  TYPE A NAME OR CLICK ONE.', { say: false });
}
function playGame(name, echo) {
  const n = name.trim().toUpperCase().replace(/[.!?]+$/, '');
  if (!n) return listGames();
  const num = parseInt(n, 10);
  const g = num > 0 ? GAMES.filter(Boolean)[num - 1] : n;
  if (!g) return wline('GAME NOT ON FILE.');
  if (echo && /THERMONUCLEAR|THERMAL NUCLEAR|TIC.?TAC.?TOE|NOUGHTS|^LEARN/.test(g)) wline(g, { who: 'user' });
  if (/THERMAL NUCLEAR/.test(g)) return notToPlay();
  if (/THERMONUCLEAR/.test(g)) return gtwStart();
  if (/TIC.?TAC.?TOE|NOUGHTS/.test(g)) return tttStart();
  if (/^LEARN/.test(g)) return runTheater(learning);
  return send(`LET'S PLAY ${g}.`);
}
// FULL THERMAL NUCLEAR WAR: the lesson Joshua already learned. No game, just the answer.
function notToPlay() {
  if (busy) return note('BUSY. ESC TO ABORT FIRST.', { small: true });
  stopVoice();
  beep(440, 0.12, 'square', 0.04); beep(330, 0.25, 'square', 0.04, 0.14);
  wline('The only winning move is not to play.');
}
const TRIGGERS = [
  [/^(list|show|help)\s+games$/i, () => listGames()],
  [/^(?:let'?s\s+|lets\s+|i\s+want\s+to\s+)?(?:play\s+)?full\s+thermal\s*nuclear\s+war[.!?]*$/i, () => notToPlay()],
  [/^(?:let'?s\s+|lets\s+|i\s+want\s+to\s+)?(?:play\s+)?global\s+thermonuclear\s+war$/i, () => gtwStart()],
  [/^(?:let'?s\s+|lets\s+)?(?:play\s+)?tic[\s-]?tac[\s-]?toe$/i, () => tttStart()],
  [/^(?:number of players:?\s*(?:0|zero)|play yourself|learn)$/i, () => runTheater(learning)],
];
function endGame(silent) {
  if (!game) return;
  game = null;
  if (!silent) wline('GAME TERMINATED.', { say: false });
  if (!busy) $('#mode').textContent = 'STANDBY';
}

/* ---------- commands ---------- */
const HELP =
`COMMAND DIRECTORY
  LIST GAMES            THE GAMES ON FILE (OR /games)
  /play <game|number>   PLAY A GAME  (E.G. /play chess, /play 15)
  /learn                LEARNING SEQUENCE (TIC-TAC-TOE, PLAYERS: 0)
  /new                  NEW GAME LOG
  /clear                WIPE CURRENT LOG
  /retry                REGENERATE LAST RESPONSE
  /models               LIST STRATEGY MODULES
  /model <name>         SWITCH MODULE (PARTIAL NAME OK)
  /info                 MODULE DETAILS
  /pull <name>          FETCH A MODULE FROM THE REGISTRY
  /unload               RELEASE ACTIVE MODULE FROM MEMORY
  /ps                   ACTIVE CORES
  /system [text]        SHOW / SET PRIME DIRECTIVE
  /name <name>          WHAT JOSHUA CALLS YOU (DEFAULT PROFESSOR FALKEN)
  /set <param> <value>  E.G. /set temperature 0.2
  /think on|off         STRATEGIC ANALYSIS (THINKING MODELS)
  /voice on|off|test    VOICE SYNTHESIZER
  /say <text>           MAKE JOSHUA SAY SOMETHING
  /weather [place]      WEATHER REPORT / PIN A LOCATION (ALSO THE INTRO TARGET)
  /locate               FIND THIS COMPUTER AGAIN (UNDOES A PINNED PLACE)
  /defcon <1-5>         SET THE READINESS CONDITION DISPLAY
  /export               DOWNLOAD THIS LOG AS TEXT
  /theme blue|green|amber   /sound on|off   /boot full|quick
  /case upper|mixed     TYPE IN CAPITALS ONLY, OR UPPER AND LOWER CASE
  /reboot               RESTART TERMINAL
  /logoff               SHUT DOWN W.O.P.R. (SAME AS ESC)

KEYS: ENTER TRANSMIT · SHIFT+ENTER NEWLINE · ESC ABORT / LOGOFF · ↑/↓ RECALL`;

async function command(line) {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  const s = cur();
  switch ((cmd || '').toLowerCase()) {
    case 'help': case '?': note(HELP, { small: true }); break;
    case 'games': listGames(); break;
    case 'play': playGame(arg); break;
    case 'learn': runTheater(learning); break;
    case 'new': startNew(); break;
    case 'clear':
      if (busy) return;
      endGame(true); stopVoice();
      s.messages = []; s.title = 'NEW GAME'; save(); renderSessions(); renderLog(); break;
    case 'retry': retry(); break;
    case 'models':
      await refreshModels();
      note(MODELS.map((m, i) => `[${pad(i + 1)}] ${m.name.toUpperCase().padEnd(50)} ${(isCloud(m) ? 'CLOUD' : fmtBytes(m.size)).padStart(8)} ${m.details?.parameter_size || ''}`).join('\n') || 'NO MODULES. /PULL <NAME>', { small: true });
      break;
    case 'model': {
      if (!arg) return note('ACTIVE MODULE: ' + S.settings.model.toUpperCase(), { small: true });
      const a = arg.toLowerCase();
      const m = MODELS.find((x) => x.name.toLowerCase() === a) || MODELS.find((x) => x.name.toLowerCase().startsWith(a)) || MODELS.find((x) => x.name.toLowerCase().includes(a));
      if (!m) return note('MODULE NOT FOUND: ' + arg.toUpperCase(), { small: true });
      selectModel(m.name); break;
    }
    case 'info': {
      const sh = SHOW[S.settings.model];
      if (!sh || sh.error) return note('NO DATA.' + (sh?.error ? ' ' + sh.error : ''), { small: true });
      note(`MODULE ${S.settings.model.toUpperCase()}\nCAPABILITIES: ${(sh.capabilities || []).join(', ')}\nMAX CONTEXT: ${ctxLen(S.settings.model) || '?'}\n\nMODELFILE PARAMETERS:\n${sh.parameters || '(none)'}`, { small: true });
      break;
    }
    case 'pull': pull(arg); break;
    case 'unload': unload(); break;
    case 'ps': await pollPS(); note($('#ps').innerText || 'NO CORES ACTIVE', { small: true }); break;
    case 'system':
      if (arg) { S.settings.system = arg; $('#system').value = arg; save(); note('PRIME DIRECTIVE UPDATED.', { small: true }); }
      else note('PRIME DIRECTIVE:\n' + (S.settings.system || '(NONE)'), { small: true });
      break;
    case 'name':
      if (arg) { S.settings.operator = arg.toUpperCase(); $('#opname').value = S.settings.operator; save(); }
      wline(`GREETINGS ${opName()}.`); break;
    case 'set': {
      const [k, v] = arg.split(/\s+/);
      if (!(k in DEFAULT_OPTS)) return note('UNKNOWN PARAMETER. VALID: ' + Object.keys(DEFAULT_OPTS).join(', ').toUpperCase(), { small: true });
      S.settings.options[k] = v === undefined || v === '' ? '' : Number(v);
      save(); buildParams(); note(`${k.toUpperCase()} = ${v ?? '(DEFAULT)'}`, { small: true }); break;
    }
    case 'think':
      S.settings.think = arg !== 'off'; $('#think').checked = S.settings.think; save();
      note('STRATEGIC ANALYSIS ' + (S.settings.think ? 'ENABLED' : 'DISABLED') + (caps(S.settings.model).includes('thinking') ? '' : ' (MODULE DOES NOT SUPPORT IT)'), { small: true });
      break;
    case 'voice':
      if (arg === 'test' || !arg) { speak(`GREETINGS ${opName()}. ${OPENING}`); break; }
      S.settings.voice.on = arg !== 'off'; if (!S.settings.voice.on) stopVoice();
      save(); applyTheme(); fillVoiceList(); note('VOICE SYNTHESIZER ' + (S.settings.voice.on ? 'ON' : 'OFF'), { small: true }); break;
    case 'say': if (arg) speak(arg); break;
    case 'locate': case 'weather': {
      const auto = cmd.toLowerCase() === 'locate' || /^(auto|here)$/i.test(arg);
      if (!arg && !auto) { const r = WHERE.report(); if (r) wline(r); else note('WEATHER FEED OFFLINE.', { small: true }); break; }
      const el = note((auto ? 'LOCATING THIS TERMINAL' : 'LOCATING ' + arg.toUpperCase()) + ' ...', { small: true });
      const p = auto ? await WHERE.locate(true) : await WHERE.search(arg).catch(() => null);
      if (!p) { el.textContent = 'LOCATION NOT FOUND: ' + arg.toUpperCase(); break; }
      el.textContent = `LOCATION: ${p.name}, ${p.country}  ${p.lat.toFixed(3)} ${p.lon.toFixed(3)}  (${WHERE.srcLabel(p)})`;
      await WHERE.loadWeather();
      const r = WHERE.report(); if (r) speak(r);
      break;
    }
    case 'defcon': { const n = parseInt(arg, 10); if (n >= 1 && n <= 5) setDefcon(n); else note('DEFCON 1-5.', { small: true }); break; }
    case 'export': exportSession(); break;
    case 'theme':
      if (THEMES.includes(arg)) { S.settings.theme = arg; save(); applyTheme(); } else note('THEMES: ' + THEMES.join(' / ').toUpperCase(), { small: true });
      break;
    case 'sound': S.settings.sound = arg !== 'off'; save(); applyTheme(); break;
    case 'case':
      if (/^(upper|caps|off)$/i.test(arg)) S.settings.mixedCase = false;
      else if (/^(mixed|lower|on)$/i.test(arg)) S.settings.mixedCase = true;
      else S.settings.mixedCase = !S.settings.mixedCase;
      save(); applyTheme();
      note('TYPING: ' + (S.settings.mixedCase ? 'UPPER AND LOWER CASE' : 'CAPITALS ONLY'), { small: true }); break;
    case 'boot': S.settings.quickBoot = arg === 'quick'; save(); note('BOOT SEQUENCE: ' + (S.settings.quickBoot ? 'QUICK' : 'FULL'), { small: true }); break;
    case 'reboot': location.reload(); break;
    case 'logoff': case 'exit': case 'quit': shutdown(); break;
    default: note('UNKNOWN COMMAND: /' + (cmd || '').toUpperCase() + '. TYPE /HELP.', { small: true });
  }
}
function selectModel(name) {
  S.settings.model = name; S.settings.modelPinned = true; save();
  $('#model').value = name;
  renderModelInfo();
  loadShow(name);
  note('STRATEGY MODULE ENGAGED: ' + name.toUpperCase(), { small: true });
  beep(520, 0.05); beep(1040, 0.08, 'square', 0.03, 0.06);
}
async function pull(name) {
  if (!name) return note('USAGE: /pull <model>   e.g. /pull llama3.2:3b', { small: true });
  const el = note('ACQUIRING MODULE ' + name.toUpperCase() + ' ...', { small: true });
  try {
    const res = await fetch('/api/pull', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
    });
    if (!res.ok) { const t = await res.text(); let e; try { e = JSON.parse(t).error; } catch { e = t; } throw new Error(e); }
    let last = 0;
    await readNDJSON(res, (o) => {
      if (o.error) throw new Error(o.error);
      let t = (o.status || '').toUpperCase();
      if (o.total) {
        const p = (o.completed || 0) / o.total;
        t += `\n${bar(p, 32)} ${(p * 100).toFixed(1).padStart(5)}%  ${fmtBytes(o.completed || 0)} / ${fmtBytes(o.total)}`;
      }
      el.textContent = 'ACQUIRING MODULE ' + name.toUpperCase() + '\n' + t;
      if (performance.now() - last > 400) { last = performance.now(); beep(1800, 0.01, 'square', 0.006); }
    });
    el.textContent += '\nMODULE ACQUIRED.';
    await refreshModels();
  } catch (e) {
    el.textContent += '\nACQUISITION FAILED: ' + e.message;
  }
}
async function unload() {
  const model = S.settings.model;
  if (!model) return;
  try {
    await postJSON('/api/generate', { model, keep_alive: 0 });
    note('MODULE ' + model.toUpperCase() + ' RELEASED FROM MEMORY.', { small: true });
  } catch (e) { note('UNLOAD FAILED: ' + e.message, { small: true }); }
  pollPS();
}
function exportSession() {
  const s = cur();
  const lines = [
    'W.O.P.R. // NORAD — GAME LOG',
    'TITLE: ' + s.title, 'OPENED: ' + fmtDate(s.created), 'EXPORTED: ' + fmtDate(Date.now()),
    '='.repeat(72), '',
  ];
  for (const m of s.messages) {
    if (m.role === 'user' || m.who === 'user') lines.push(`[${opName()} ${fmtTime(m.t)}]`, m.content, '');
    else if (m.role === 'assistant') {
      lines.push(`[JOSHUA / ${m.model} ${fmtTime(m.t)}]`, splitThink(m).content);
      if (m.error) lines.push('ERROR: ' + m.error);
      lines.push('');
    } else if (m.who === 'wopr') {
      if (m.kind === 'games') lines.push('[JOSHUA]', GAMES.join('\n'), '');
      else if (m.kind === 'ttt') lines.push('[JOSHUA]', [0, 3, 6].map((i) => m.board.slice(i, i + 3).map((x) => x || '.').join(' ')).join('\n'), '');
      else if (m.content) lines.push('[JOSHUA]', m.content, '');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wopr-' + s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- bindings ---------- */
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(220, t.scrollHeight) + 'px'; }

function submitText(text) {
  if (text.startsWith('/')) return command(text);
  if (game && (game.kind.startsWith('gtw') ? gtwInput(text) : tttInput(text)) !== false) return;
  const plain = text.trim().replace(/[.!?]+$/, '');
  for (const [re, fn] of TRIGGERS) if (re.test(plain)) { wline(text, { who: 'user' }); return fn(); }
  return send(text);
}

function bindUI() {
  const input = $('#input');
  $('#cmd').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    S.history = S.history.filter((h) => h !== text); S.history.push(text);
    if (S.history.length > 100) S.history.shift();
    histIdx = -1;
    input.value = ''; autosize(); save();
    submitText(text);
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#cmd').requestSubmit(); return; }
    if (e.key.length === 1) beep(rnd(2200, 3200), 0.008, 'square', 0.005);
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    if (e.key === 'ArrowUp' && (atStart || !input.value) && S.history.length) {
      e.preventDefault();
      histIdx = histIdx < 0 ? S.history.length - 1 : Math.max(0, histIdx - 1);
      input.value = S.history[histIdx]; autosize();
    } else if (e.key === 'ArrowDown' && histIdx >= 0 && atEnd) {
      e.preventDefault();
      histIdx++;
      if (histIdx >= S.history.length) { histIdx = -1; input.value = ''; } else input.value = S.history[histIdx];
      autosize();
    }
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (TH.on) { TH.abort = true; stopVoice(); return; }
      if (busy) return abort();
      if (V.queue.length || V.src) { stopVoice(); lastAbort = performance.now(); return; }
      if (game) { endGame(); lastAbort = performance.now(); return; }
      if (performance.now() - lastAbort > 1000) shutdown();
    } else if (e.key === '/' && !['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); input.value = '/'; }
  });

  $('#btn-abort').onclick = abort;
  $('#model').onchange = (e) => selectModel(e.target.value);
  $('#btn-rescan').onclick = () => { for (const k in SHOW) delete SHOW[k]; refreshModels(); };
  $('#btn-unload').onclick = unload;
  $('#btn-new').onclick = () => { startNew(); input.focus(); };
  $('#btn-games').onclick = () => { if (!game) listGames(); input.focus(); };
  $('#btn-export').onclick = exportSession;
  $('#sessions').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteSession(del.dataset.del); return; }
    const li = e.target.closest('li[data-id]');
    if (li) switchSession(li.dataset.id);
  };
  $('#log').addEventListener('click', (e) => {
    const b = e.target.closest('button.copy');
    if (b) {
      const code = b.closest('.code').querySelector('pre').textContent;
      navigator.clipboard.writeText(code).then(() => { b.textContent = 'COPIED'; setTimeout(() => { b.textContent = 'COPY'; }, 1200); },
        () => { b.textContent = 'DENIED'; });
      return;
    }
    const g = e.target.closest('[data-game]');
    if (g && !busy && !game) { playGame(g.dataset.game, true); return; }
    const cell = e.target.closest('.ttt:not(.done) [data-i]');
    if (cell && game && game.kind === 'ttt' && game.el.contains(cell)) tttInput(String(Number(cell.dataset.i) + 1));
  });

  const sys = $('#system');
  sys.value = S.settings.system;
  sys.oninput = () => { S.settings.system = sys.value; save(); };
  $('#btn-sysreset').onclick = () => { S.settings.system = DEFAULT_SYSTEM; sys.value = DEFAULT_SYSTEM; save(); };
  const op = $('#opname');
  op.value = S.settings.operator;
  op.oninput = () => { S.settings.operator = op.value.toUpperCase(); save(); };
  $('#btn-optreset').onclick = () => { S.settings.options = { ...DEFAULT_OPTS }; save(); buildParams(); };

  const ka = $('#keepalive');
  ka.value = S.settings.keepAlive;
  ka.onchange = () => { S.settings.keepAlive = ka.value; save(); };
  const th = $('#think');
  th.checked = S.settings.think;
  th.onchange = () => { S.settings.think = th.checked; save(); };

  $('#v-engine').onchange = (e) => { S.settings.voice.engine = e.target.value; save(); stopVoice(); applyTheme(); fillVoiceList(); };
  $('#v-voice').onchange = (e) => {
    if (engine() === 'browser') S.settings.voice.bvoice = e.target.value; else S.settings.voice.voice = e.target.value;
    save(); stopVoice(); speak(OPENING);
  };
  $('#btn-vtest').onclick = () => { stopVoice(); speak(`GREETINGS ${opName()}. ${OPENING}`); };
  $('#btn-vstop').onclick = stopVoice;
  $('#btn-vreset').onclick = () => { S.settings.voice = { ...DEFAULT_VOICE, on: S.settings.voice.on, engine: S.settings.voice.engine }; save(); setFx(); buildVoiceUI(); };
  $('#btn-voice').onclick = () => {
    S.settings.voice.on = !S.settings.voice.on;
    if (!S.settings.voice.on) stopVoice();
    save(); applyTheme(); fillVoiceList(); beep(700, 0.05);
  };
  $('#btn-theme').onclick = () => {
    S.settings.theme = THEMES[(THEMES.indexOf(S.settings.theme) + 1) % THEMES.length];
    save(); applyTheme(); beep(700, 0.05);
  };
  $('#btn-sound').onclick = () => { S.settings.sound = !S.settings.sound; save(); applyTheme(); beep(700, 0.05); };
  $('#btn-case').onclick = () => { S.settings.mixedCase = !S.settings.mixedCase; save(); applyTheme(); beep(700, 0.05); $('#input').focus(); };
  $('#btn-left').onclick = () => $('#left').classList.toggle('open');
  $('#btn-right').onclick = () => $('#right').classList.toggle('open');
  $('#board').onclick = () => { if (!TH.on && !busy) runBigBoard(); };
  $('#wx-panel').onclick = () => { const r = WHERE.report(); if (r) { stopVoice(); speak(r); } else WHERE.loadWeather(); };
}

// Click the big board: watch it full screen until ESC (no game, no ending).
async function runBigBoard() {
  endGame(true);
  thOpen('world');
  thText('NORAD // CRYSTAL PALACE\nSTS: MONITORING', '', '');
  $('#th-skip').textContent = 'ESC: RETURN TO TERMINAL';
  try {
    for (;;) {
      const a = pick(CITIES.US), b = pick(CITIES.SU);
      launch(TH.sc, [a[1] + rf(5, 12), a[2]], [b[1] + rf(5, 10), b[2] - rf(10, 30)], { dur: rf(9000, 14000), color: '#7fd0ff', dash: [1, 5], bloom: false, lw: 1.4 });
      await tsleep(rf(1200, 2600));
    }
  } catch { /* ESC */ }
  $('#th-skip').textContent = 'ESC: ABORT SIMULATION';
  thClose();
}

// Footer: installed build, and a notice when a newer version has been downloaded (applied at next start).
async function checkBuild() {
  const j = await getJSON('/wopr.json', 3000).catch(() => null);
  const el = $('#foot-ver');
  if (!j || !el) return;
  const v = j.version === 'dev' ? 'DEV' : String(j.version || '?').slice(0, 7).toUpperCase();
  const st = j.staged && j.staged !== j.version ? String(j.staged).slice(0, 7).toUpperCase() : '';
  el.innerHTML = 'BUILD ' + esc(v) + (st ? ` · <b class="upd">UPDATE ${esc(st)} READY · RESTART TO APPLY</b>` : '');
}

/* ---------- go ---------- */
document.body.className = 'theme-' + S.settings.theme + (S.settings.mixedCase ? ' mixed-case' : '');
WHERE.setup({
  get: () => S.settings.place || null,
  set: (p) => { S.settings.place = p; save(); },
  onChange: () => { if (!$('#main').hidden) WHERE.loadWeather(); },
  beep, sweep,
});
WHERE.locate();          // runs during the splash, so the zoom can target this computer
boot();
