/* where.js — operator location, weather panel (Open-Meteo) and the LED-bitmap zoom intro.
 * Shared by SKYNET and W.O.P.R.; keep the two copies identical.
 *
 * Location, best first:
 *   manual   /weather <place> pins a place (geocoded by Open-Meteo)
 *   gps      browser geolocation, used only when it is precise (< 5 km: Wi-Fi / OS location service)
 *   ip       IP geolocation (BigDataCloud client API, no key)
 *   default  Hønefoss, Norway
 * Requires worldmap.js (and optionally detailmap.js) for the zoom.
 */
(function () {
  'use strict';
  const DEFAULT = { name: 'HØNEFOSS', country: 'NORWAY', lat: 60.1683, lon: 10.2565, src: 'default' };
  const PRECISE_M = 5000;
  let cfg = { get: () => null, set: () => {}, onChange: () => {}, beep: () => {}, sweep: () => {} };
  let locating = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function getJSON(url, timeout = 10000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function km(a, b) {
    const R = 6371, t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------------- location ---------------- */
  const place = () => cfg.get() || DEFAULT;

  function browserFix(timeout) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const t = setTimeout(() => resolve(null), timeout + 500);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); },
        () => { clearTimeout(t); resolve(null); },
        { enableHighAccuracy: true, timeout, maximumAge: 10 * 60e3 });
    });
  }
  // Without coordinates the BigDataCloud client endpoint geolocates the caller's IP address.
  async function bdc(lat, lon) {
    const q = lat == null ? '' : `latitude=${lat}&longitude=${lon}&`;
    const d = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}localityLanguage=en`, 8000);
    return { lat: d.latitude, lon: d.longitude, name: d.city || d.locality || d.principalSubdivision || '', country: d.countryName || '' };
  }
  // Local spelling (Hønefoss, not Honefoss) from Open-Meteo's geocoder, if it agrees on the spot.
  async function localName(p) {
    if (!p.name) return p.name;
    try {
      const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(p.name)}&count=5&language=en&format=json`, 6000);
      const g = (r.results || []).find((x) => km(p, { lat: x.latitude, lon: x.longitude }) < 30);
      return g ? g.name : p.name;
    } catch { return p.name; }
  }
  async function autoLocate() {
    const [fix, ip] = await Promise.all([browserFix(5000), bdc().catch(() => null)]);
    let p = null;
    if (fix && fix.acc <= PRECISE_M) {
      const r = await bdc(fix.lat, fix.lon).catch(() => ({ name: '', country: '' }));
      p = { lat: fix.lat, lon: fix.lon, acc: Math.round(fix.acc), name: r.name, country: r.country, src: 'gps' };
    } else if (ip && ip.lat != null) {
      p = { ...ip, src: 'ip' };
    } else if (fix) {
      const r = await bdc(fix.lat, fix.lon).catch(() => ({ name: '', country: '' }));
      p = { lat: fix.lat, lon: fix.lon, acc: Math.round(fix.acc), name: r.name, country: r.country, src: 'gps' };
    }
    if (!p) return place();
    p.name = (await localName(p) || `${p.lat.toFixed(2)} ${p.lon.toFixed(2)}`).toUpperCase();
    p.country = (p.country || '').toUpperCase();
    p.at = Date.now();
    const old = cfg.get();
    if (old && old.src === 'manual') return old;      // pinned while we were looking
    cfg.set(p);
    if (!old || old.name !== p.name || km(old, p) > 1) cfg.onChange(p);
    return p;
  }
  function locate(force) {
    const cur = cfg.get();
    if (cur && cur.src === 'manual' && !force) return Promise.resolve(cur);
    if (force && cur && cur.src === 'manual') cfg.set(null);
    if (!locating) locating = autoLocate().catch(() => place()).finally(() => { setTimeout(() => { locating = null; }, 0); });
    return locating;
  }
  // Best place known within `ms` (the boot zoom does not wait forever).
  async function ready(ms) {
    const p = locating || locate();
    return Promise.race([p, sleep(ms).then(place)]);
  }
  async function search(q) {
    const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`, 10000);
    const g = r.results && r.results[0];
    if (!g) return null;
    const p = { name: g.name.toUpperCase(), country: (g.country || '').toUpperCase(), lat: g.latitude, lon: g.longitude, src: 'manual', at: Date.now() };
    cfg.set(p); cfg.onChange(p);
    return p;
  }
  function srcLabel(p = place()) {
    return { gps: `POS ±${p.acc >= 1000 ? (p.acc / 1000).toFixed(1) + ' KM' : (p.acc || '?') + ' M'}`, ip: 'POS IP', manual: 'POS FIXED', default: 'POS DEFAULT' }[p.src] || 'POS ?';
  }

  /* ---------------- weather ---------------- */
  const WMO = {
    0: ['CLEAR', 'CLR'], 1: ['MAINLY CLEAR', 'CLR'], 2: ['PARTLY CLOUDY', 'PCLD'], 3: ['OVERCAST', 'OVC'], 45: ['FOG', 'FOG'], 48: ['FREEZING FOG', 'FOG'],
    51: ['LIGHT DRIZZLE', 'DRZ'], 53: ['DRIZZLE', 'DRZ'], 55: ['HEAVY DRIZZLE', 'DRZ'], 56: ['FREEZING DRIZZLE', 'FZDZ'], 57: ['FREEZING DRIZZLE', 'FZDZ'],
    61: ['LIGHT RAIN', 'RAIN'], 63: ['RAIN', 'RAIN'], 65: ['HEAVY RAIN', 'RAIN+'], 66: ['FREEZING RAIN', 'FZRA'], 67: ['FREEZING RAIN', 'FZRA'],
    71: ['LIGHT SNOW', 'SNOW'], 73: ['SNOW', 'SNOW'], 75: ['HEAVY SNOW', 'SNOW+'], 77: ['SNOW GRAINS', 'SNOW'],
    80: ['RAIN SHOWERS', 'SHWR'], 81: ['RAIN SHOWERS', 'SHWR'], 82: ['VIOLENT SHOWERS', 'SHWR+'], 85: ['SNOW SHOWERS', 'SNSH'], 86: ['SNOW SHOWERS', 'SNSH'],
    95: ['THUNDERSTORM', 'TSTM'], 96: ['THUNDERSTORM, HAIL', 'TSTM'], 99: ['THUNDERSTORM, HAIL', 'TSTM'],
  };
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const COMPASS_WORDS = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
  let WX = null;
  const $ = (id) => document.getElementById(id);

  async function loadWeather() {
    const P = place();
    if ($('wx-place')) $('wx-place').textContent = P.name;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
        '&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=7&wind_speed_unit=ms&timezone=auto';
      const d = await getJSON(u, 10000);
      d.at = Date.now(); d.place = P;
      WX = d;
    } catch (e) {
      if (!WX && $('wx-cond')) { $('wx-cond').textContent = 'NO CARRIER'; $('wx-kv').innerHTML = `<dt>LINK</dt><dd>${esc(String(e.message).toUpperCase().slice(0, 30))}</dd>`; }
      return null;
    }
    renderWeather();
    return WX;
  }
  function renderWeather() {
    if (!WX || !WX.current || !$('wx-temp')) return;
    const c = WX.current, cond = WMO[c.weather_code] || ['UNKNOWN', '?'];
    const dir = Math.round(((c.wind_direction_10m || 0) % 360) / 45) % 8;
    $('wx-place').textContent = WX.place.name;
    $('wx-temp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('wx-cond').textContent = cond[0];
    const arrow = `<span class="wx-arrow" style="display:inline-block;transform:rotate(${(c.wind_direction_10m || 0) + 180}deg)">↑</span>`;
    $('wx-kv').innerHTML =
      `<dt>WIND</dt><dd>${arrow} ${COMPASS[dir]} ${c.wind_speed_10m.toFixed(1)} M/S${c.wind_gusts_10m ? ' (' + Math.round(c.wind_gusts_10m) + ')' : ''}</dd>` +
      `<dt>FEELS</dt><dd>${Math.round(c.apparent_temperature)}°</dd>` +
      `<dt>HUMIDITY</dt><dd>${c.relative_humidity_2m}%</dd>` +
      `<dt>PRECIP</dt><dd>${(c.precipitation || 0).toFixed(1)} MM</dd>`;
    const h = WX.hourly || {}, cols = [];
    for (let i = 1; i < Math.min(7, (h.time || []).length); i++) {
      const ab = (WMO[h.weather_code[i]] || ['', '?'])[1];
      const pp = h.precipitation_probability ? h.precipitation_probability[i] : null;
      cols.push(`<div><b>${h.time[i].slice(11, 13)}</b><span>${Math.round(h.temperature_2m[i])}°</span><i>${ab}</i><small>${pp == null ? '' : pp + '%'}</small></div>`);
    }
    $('wx-hours').innerHTML = cols.join('');
    $('wx-time').textContent = `OBS ${(c.time || '').slice(11, 16)} · ${srcLabel(WX.place)}`;
  }
  function report() {
    if (!WX || !WX.current) return null;
    const c = WX.current, cond = (WMO[c.weather_code] || ['UNKNOWN'])[0];
    const dir = COMPASS_WORDS[Math.round(((c.wind_direction_10m || 0) % 360) / 45) % 8];
    return `${WX.place.name}. ${Math.round(c.temperature_2m)} DEGREES. ${cond}. WIND ${Math.round(c.wind_speed_10m)} METERS PER SECOND FROM THE ${dir}.`;
  }
  // One paragraph for the model's system prompt, so it can answer weather questions.
  function context() {
    if (!WX || !WX.current || Date.now() - WX.at > 3 * 3600e3) return '';
    const c = WX.current, cond = (WMO[c.weather_code] || ['UNKNOWN'])[0], h = WX.hourly || {};
    const next = (h.time || []).slice(1, 7).map((t, i) => `${t.slice(11, 16)} ${Math.round(h.temperature_2m[i + 1])}C ${(WMO[h.weather_code[i + 1]] || ['?'])[0]}`).join('; ');
    return `\n\nThe operator is in or near ${WX.place.name}, ${WX.place.country}. Weather feed (observed ${(c.time || '').replace('T', ' ')} local): ` +
      `${Math.round(c.temperature_2m)}C, feels ${Math.round(c.apparent_temperature)}C, ${cond}, wind ${c.wind_speed_10m.toFixed(1)} m/s ` +
      `from ${Math.round(c.wind_direction_10m)} deg, humidity ${c.relative_humidity_2m}%. Next hours: ${next}. ` +
      'Use this only when the operator asks about the weather or the location.';
  }

  /* ---------------- zoom intro ---------------- */
  function dms(v, pos, neg, w) {
    const a = Math.abs(v); let d = Math.floor(a), m = Math.round((a - d) * 60);
    if (m === 60) { d++; m = 0; }
    return `${String(d).padStart(w, '0')}°${pad(m)}'${v >= 0 ? pos : neg}`;
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // o: { root, canvas, top, tag, bottom, place, quick, colors: {land, water, river, target, lock},
  //      title, acquired }   Any key or click skips ahead.
  async function zoom(o) {
    const W0 = window.WORLD, DT = window.DETAIL;
    if (!W0 || !o.root) return;
    const col = Object.assign({ land: '#3fb4ff', water: '#04112c', river: '#0a3f9a', target: '#ff5a2a', lock: '#ffffff' }, o.colors || {});
    o.root.hidden = false;
    const P = o.place || place();
    const cv = o.canvas, W = innerWidth, H = innerHeight;
    const cell = Math.max(5, Math.round(W / 230));
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    cv.width = gw * cell; cv.height = gh * cell;
    const ctx = cv.getContext('2d');
    const off = document.createElement('canvas'); off.width = gw; off.height = gh;
    const g = off.getContext('2d');
    const pc = document.createElement('canvas'); pc.width = pc.height = cell;
    const pctx = pc.getContext('2d'), gap = Math.max(1, Math.round(cell / 4));
    pctx.fillStyle = 'rgba(0,0,0,.92)'; pctx.fillRect(cell - gap, 0, gap, cell); pctx.fillRect(0, cell - gap, cell, gap);
    const mask = ctx.createPattern(pc, 'repeat');
    const inDetail = DT && P.lon > DT.box[0] + 0.5 && P.lon < DT.box[2] - 0.5 && P.lat > DT.box[1] + 0.3 && P.lat < DT.box[3] - 0.3;
    const wStart = Math.min(360, 180 * gw / gh), wEnd = inDetail ? 2.4 : 14;
    const dur = o.quick ? 2200 : 6000, hold = o.quick ? 900 : 2300;
    if (o.bottom) o.bottom.textContent = '';

    const fill = (arrs, q, k, cosf, clon, clat) => {
      g.beginPath();
      for (const a of arrs) {
        let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
        const pts = [];
        for (let i = 0; i < a.length; i += 2) {
          const x = (a[i] / q - clon) * cosf * k + gw / 2, y = (clat - a[i + 1] / q) * k + gh / 2;
          pts.push(x, y);
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
        if (maxx < 0 || minx > gw || maxy < 0 || miny > gh || (maxx - minx < 0.3 && maxy - miny < 0.3)) continue;
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.closePath();
      }
      g.fill('evenodd');
    };
    const frame = (t) => {
      const e = ease(t);
      const w = Math.exp(Math.log(wStart) + (Math.log(wEnd) - Math.log(wStart)) * e);
      const c = ease(Math.min(1, t * 1.6));
      const clon = P.lon * c, clat = 12 + (P.lat - 12) * c;
      const cosf = Math.cos(clat * Math.PI / 180 * Math.min(1, e * 2));
      const k = gw / (w * cosf);
      g.fillStyle = col.water; g.fillRect(0, 0, gw, gh);
      g.fillStyle = col.land; fill(W0.land, W0.q, k, cosf, clon, clat);
      g.fillStyle = col.water; fill(W0.lakes, W0.q, k, cosf, clon, clat);
      if (DT && w < 45) {
        const [x0, y0, x1, y1] = DT.box;
        const bx0 = (x0 - clon) * cosf * k + gw / 2, bx1 = (x1 - clon) * cosf * k + gw / 2;
        const by0 = (clat - y1) * k + gh / 2, by1 = (clat - y0) * k + gh / 2;
        if (bx1 > 0 && bx0 < gw && by1 > 0 && by0 < gh) {
          g.save(); g.beginPath(); g.rect(bx0, by0, bx1 - bx0, by1 - by0); g.clip();
          g.fillStyle = col.water; g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
          g.fillStyle = col.land; fill(DT.land, DT.q, k, cosf, clon, clat);
          g.fillStyle = col.water; fill(DT.lakes, DT.q, k, cosf, clon, clat);
          if (w < 16) {
            g.strokeStyle = col.river; g.lineWidth = Math.min(1.2, 9 / w); g.beginPath();
            for (const a of DT.rivers) {
              for (let i = 0; i < a.length; i += 2) {
                const x = (a[i] / DT.q - clon) * cosf * k + gw / 2, y = (clat - a[i + 1] / DT.q) * k + gh / 2;
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
              }
            }
            g.stroke();
          }
          g.restore();
        }
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, gw * cell, gh * cell);
      ctx.fillStyle = mask; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22;
      ctx.drawImage(off, 0, 0, gw * cell, gh * cell);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const tx = ((P.lon - clon) * cosf * k + gw / 2) * cell, ty = ((clat - P.lat) * k + gh / 2) * cell;
      ctx.strokeStyle = col.target; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(cv.width, ty); ctx.moveTo(tx, 0); ctx.lineTo(tx, cv.height); ctx.stroke();
      ctx.globalAlpha = 1;
      const r = cell * (3 + 4 * (1 - e)), blink = t >= 1 && Math.floor(performance.now() / 180) % 2;
      ctx.strokeStyle = blink ? col.lock : col.target; ctx.lineWidth = 3; ctx.shadowColor = col.target; ctx.shadowBlur = 12;
      ctx.strokeRect(tx - r, ty - r, r * 2, r * 2); ctx.shadowBlur = 0;
      ctx.fillStyle = col.target; ctx.fillRect(Math.floor(tx / cell) * cell, Math.floor(ty / cell) * cell, cell - gap, cell - gap);
      if (o.tag) {
        o.tag.style.transform = `translate(${Math.round(tx + r + 12)}px, ${Math.round(ty - r)}px)`;
        o.tag.textContent = t >= 1 ? `${P.name}\n${P.country}` : `TRK ${pad(Math.round(t * 999), 3)}`;
      }
      if (o.top) {
        o.top.textContent = `${o.title || 'GLOBAL POSITIONING // TARGET ACQUISITION'}\n` +
          `CENTER ${dms(clat, 'N', 'S', 2)} ${dms(clon, 'E', 'W', 3)}    FIELD ${w.toFixed(w < 10 ? 2 : 1).padStart(6)} DEG    MAG x${Math.round(wStart / w)}    ${srcLabel(P)}`;
      }
    };

    let skip = false;
    const onKey = () => { skip = true; };
    addEventListener('keydown', onKey); addEventListener('pointerdown', onKey);
    cfg.sweep(80, 600, dur / 1000, 0.012, 'triangle');
    const t0 = performance.now();
    let lastTick = 0;
    await new Promise((resolve) => {
      const step = (now) => {
        const t = skip ? 1 : Math.min(1, (now - t0) / dur);
        frame(t);
        if (now - lastTick > 140 && t < 1) { lastTick = now; cfg.beep(300 + t * 1500, 0.015, 'square', 0.006); }
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    cfg.beep(1320, 0.08, 'square', 0.025); cfg.beep(1760, 0.12, 'square', 0.025, 0.12);
    if (o.bottom) o.bottom.textContent = `${o.acquired || 'TARGET ACQUIRED'}: ${P.name}${P.country ? ', ' + P.country : ''}\n${dms(P.lat, 'N', 'S', 2)}  ${dms(P.lon, 'E', 'W', 3)}`;
    const tEnd = performance.now() + (skip ? 500 : hold);
    await new Promise((resolve) => {
      const step = (now) => { frame(1); if (now < tEnd) requestAnimationFrame(step); else resolve(); };
      requestAnimationFrame(step);
    });
    removeEventListener('keydown', onKey); removeEventListener('pointerdown', onKey);
    o.root.classList.add('off');
    await sleep(450);
    o.root.hidden = true;
  }

  window.WHERE = {
    DEFAULT,
    setup(c) { cfg = Object.assign(cfg, c); },
    place, locate, ready, search, srcLabel,
    loadWeather, renderWeather, report, context, zoom,
  };
})();
