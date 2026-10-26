// GSECL Connect for the web (iPhone, iPad, any browser): the Android app's bridges for the same pages.
//   Native  - account, trend history, saved settings, CSV / file hand-over, theme (no background work here)
//   Connect - calls to the GSECL Connect service (Apps Script), saved copies, files, contacts
//   Chat    - end-to-end encrypted chat, the same format as the Android app (WebCrypto instead of Java crypto)
//   Rake    - FOIS rakes as shared by the Android phones (a browser cannot read FOIS)
//   Dsm     - only the estimate and the weekly accounts from the Sheet (the SLDC PDFs are read on Android)
// The sign-in token, the employee record and saved copies are kept encrypted (AES-GCM, a key the browser keeps
// in IndexedDB and never lets out). Loaded by web-start.js before the app's own scripts.
(() => {
  'use strict';
  const CFG = window.GSECL_WEB || {};
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const r = atob(s), b = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; };
  const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let p = 0; a.forEach(x => { o.set(x, p); p += x.length; }); return o; };
  const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } } };

  // ---------------------------------------------------------------- IndexedDB (keys that never leave the browser)
  const idb = (() => {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((ok, no) => { const r = indexedDB.open('gsecl-connect', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
    const tx = (mode, fn) => db().then(d => new Promise((ok, no) => { const t = d.transaction('k', mode), s = t.objectStore('k'), q = fn(s); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); }));
    // Some browsers (private modes, locked-down profiles) never answer: give up after 3 s.
    const limit = p => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('IndexedDB not answering')), 3000))]);
    return { get: k => limit(tx('readonly', s => s.get(k))), put: (k, v) => limit(tx('readwrite', s => s.put(v, k))), del: k => limit(tx('readwrite', s => s.delete(k))) };
  })();

  // ---------------------------------------------------------------- encrypted store (decrypted copy in memory)
  const SS = {
    key: null, mem: {}, temporary: false,
    async init() {
      try {
        this.key = await idb.get('store');
        if (!this.key) { this.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await idb.put('store', this.key); }
      } catch (e) {
        // No lasting key store: this visit only (nothing is written, saved copies of an earlier visit are left alone).
        this.key = null; this.temporary = true; return;
      }
      const keys = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gc:')) keys.push(k); } } catch (e) { /* private mode */ }
      for (const k of keys) {
        try { const all = unb64(LS.get(k)); this.mem[k.slice(3)] = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, this.key, all.slice(12))); }
        catch (e) { LS.del(k); }                // made with a key this browser no longer has
      }
    },
    get(k) { return k in this.mem ? this.mem[k] : null; },
    set(k, v) {
      if (v === null || v === undefined) return this.del(k);
      this.mem[k] = String(v);
      if (!this.key) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(String(v))).then(c => { if (this.mem[k] === String(v)) LS.set('gc:' + k, b64(cat(iv, new Uint8Array(c)))); }).catch(() => {});
    },
    del(k) { delete this.mem[k]; LS.del('gc:' + k); },
    clear(prefix) { Object.keys(this.mem).filter(k => k.startsWith(prefix)).forEach(k => this.del(k)); },
  };

  // ---------------------------------------------------------------- session
  const OTP_DAYS = 7;
  const deviceId = (() => { let d = LS.get('gsecl_device'); if (!d || !/^[0-9a-f]{40}$/.test(d)) { d = [...crypto.getRandomValues(new Uint8Array(20))].map(x => x.toString(16).padStart(2, '0')).join(''); LS.set('gsecl_device', d); } return d; })();
  const deviceName = (() => { const u = navigator.userAgent; const m = /iPhone|iPad|Android|Macintosh|Windows/.exec(u); return ((m ? (m[0] === 'Macintosh' ? 'Mac' : m[0]) : 'Browser') + ' (web)').slice(0, 60); })();
  const Session = {
    get token() { return SS.get('token'); },
    get user() { try { return JSON.parse(SS.get('user') || 'null'); } catch (e) { return null; } },
    get isLoggedIn() { return !!(this.token && this.user); },
    get otpFresh() { return Date.now() - Number(SS.get('otp_at') || 0) < OTP_DAYS * 864e5 - 36e5; },
    get mustChange() { return !!(this.user && this.user.must_change_password); },
    signIn(token, user, verified) { SS.set('token', token); SS.set('user', JSON.stringify(user)); SS.set('otp_at', verified ? String(Date.now()) : '0'); },
    renew(t) { if (this.token) SS.set('token', t); },
    updateUser(u) { SS.set('user', JSON.stringify(u)); },
    passwordChanged(t) { const u = this.user || {}; u.must_change_password = false; SS.set('token', t); SS.set('user', JSON.stringify(u)); },
    otpExpired() { SS.set('otp_at', '0'); },
    /** Removes the sign-in and every saved copy; wipeChat also forgets this browser's chat keys. */
    signOut(wipeChat) {
      ['token', 'user', 'otp_at', 'fois'].forEach(k => SS.del(k)); SS.clear('cache:'); SS.clear('chat');
      if (wipeChat) idb.del('chat').catch(() => {});
    },
    get reason() { return LS.get('gsecl_signout') || ''; }, set reason(v) { if (v) LS.set('gsecl_signout', v); else LS.del('gsecl_signout'); },
    deviceId, deviceName,
  };

  // ---------------------------------------------------------------- the service
  const OWN_RECORD = ['me', 'home', 'update_profile', 'upload_photo', 'totp_confirm', 'totp_disable'];
  /** An out-of-date copy (the service answered 426): the offline cache is dropped and the page loaded again, once a minute at most. */
  async function freshCopy() {
    if (Date.now() - (Number(LS.get('gsecl_fresh_at')) || 0) < 60000) return;
    LS.set('gsecl_fresh_at', String(Date.now()));
    try { const regs = await navigator.serviceWorker?.getRegistrations?.(); await Promise.all((regs || []).map(r => r.unregister())); } catch (e) { /* none */ }
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (e) { /* none */ }
    location.reload();
  }
  async function api(action, params) {
    const url = CFG.scriptUrl;
    if (!url) return { ok: false, data: null, error: 'This copy of the web app is not configured (config.js).', code: 0 };
    const body = Object.assign({}, params || {}, { action });
    if (Session.token) body.token = Session.token;
    body.device_id = deviceId; body.device_name = deviceName;
    body.app_kind = 'web'; body.app_ver = CFG.version || '';   // the service can refuse an out-of-date copy and lists the versions in use
    let j;
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);
      const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
      clearTimeout(timer);
      const t = await r.text();
      if (!r.ok || !t.trim().startsWith('{')) return { ok: false, data: null, error: 'The GSECL Connect service did not respond correctly (' + r.status + '). Try again shortly.', code: r.status };
      j = JSON.parse(t);
    } catch (e) { return { ok: false, data: null, error: navigator.onLine === false ? 'No internet connection. Please check your network.' : 'The GSECL Connect service could not be reached. Try again shortly.', code: 0 }; }
    if (j.renew && action !== 'login') Session.renew(j.renew);
    if (j.success && j.data) {
      if (OWN_RECORD.includes(action) && j.data.user) Session.updateUser(j.data.user);
      if (action === 'batch') (j.data.results || []).forEach((x, i) => { const c = (params.calls || [])[i]; if (c && OWN_RECORD.includes(c.action) && x && x.data && x.data.user) Session.updateUser(x.data.user); });
      return { ok: true, data: j.data, error: '', code: 200 };
    }
    const code = Number(j.code) || 0;
    if (code === 401 && action !== 'login' && Session.token) { Session.reason = j.error || ''; Session.signOut(false); setTimeout(() => location.reload(), 50); }
    if (code === 428 && Session.token) { Session.otpExpired(); setTimeout(() => location.reload(), 50); }
    if (code === 426) freshCopy();
    return { ok: false, data: null, error: j.error || 'Something went wrong', code };
  }

  // ---------------------------------------------------------------- handing a file to the person (tap to open / save)
  function offer(name, blob, note) {
    const url = URL.createObjectURL(blob), box = document.createElement('div');
    box.className = 'web-offer';
    box.innerHTML = '<div class="web-offer-card"><b></b><span></span><div class="web-offer-btns"><a class="btn web-open" target="_blank" rel="noopener">Open</a><a class="btn web-save">Save</a><button class="btn web-close">Close</button></div></div>';
    box.querySelector('b').textContent = name;
    box.querySelector('span').textContent = note || ((blob.size / 1024 < 1024 ? Math.max(1, Math.round(blob.size / 1024)) + ' KB' : (blob.size / 1048576).toFixed(1) + ' MB') + ' · ready');
    const open = box.querySelector('.web-open'), save = box.querySelector('.web-save');
    open.href = url; save.href = url; save.download = name;
    const close = () => { box.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
    box.querySelector('.web-close').onclick = close; open.addEventListener('click', () => setTimeout(close, 500)); save.addEventListener('click', () => setTimeout(close, 500));
    box.addEventListener('click', e => { if (e.target === box) close(); });
    document.body.appendChild(box);
  }
  function toast(t) {
    const d = document.createElement('div'); d.className = 'web-toast'; d.textContent = t; document.body.appendChild(d);
    setTimeout(() => d.remove(), 2200);
  }
  const done = (fn, id, ok, body, error) => setTimeout(() => { if (window[fn]) window[fn](id, ok, body || '', error || ''); }, 0);
  const fileCache = {};
  async function serviceFile(fileId) {
    if (fileCache[fileId]) return fileCache[fileId];
    const r = await api('file', { id: fileId });
    if (!r.ok) throw new Error(r.error || 'Could not download the file');
    const f = { name: r.data.name || 'document', mime: r.data.mime_type || 'application/octet-stream', bytes: unb64(r.data.data) };
    if (f.bytes.length < 3e6) fileCache[fileId] = f;
    return f;
  }

  // ---------------------------------------------------------------- Connect
  const BLOCKED = ['login', 'change_password', 'request_otp', 'verify_otp', 'login_otp_request', 'login_otp_verify'];
  window.Connect = {
    call(id, action, paramsJson) {
      if (BLOCKED.includes(action)) return done('__connectDone', id, false, '', 'Not available here');
      let p = {}; try { p = JSON.parse(paramsJson || '{}'); } catch (e) { p = {}; }
      api(action, p).then(r => done('__connectDone', id, r.ok, r.ok ? JSON.stringify(r.data) : '', r.error));
    },
    cacheGet(key) { const s = SS.get('cache:' + key); if (!s) return ''; try { const o = JSON.parse(s); return JSON.stringify({ age: Math.floor((Date.now() - o.at) / 60000), body: o.body }); } catch (e) { return ''; } },
    cacheSet(key, body) { SS.set('cache:' + key, JSON.stringify({ at: Date.now(), body })); },
    readIds() { return LS.get('gsecl_read') || '[]'; },
    markRead(idsJson) { let a = []; try { a = JSON.parse(this.readIds()).concat(JSON.parse(idsJson)); } catch (e) { a = []; } LS.set('gsecl_read', JSON.stringify([...new Set(a.map(Number))].sort((x, y) => y - x).slice(0, 300))); },
    image(id, fileId) { serviceFile(fileId).then(f => done('__connectDone', id, true, 'data:' + (f.mime || 'image/jpeg') + ';base64,' + b64(f.bytes))).catch(e => done('__connectDone', id, false, '', e.message)); },
    openFile(id, fileId) { serviceFile(fileId).then(f => { offer(f.name, new Blob([f.bytes], { type: f.mime })); done('__connectDone', id, true, ''); }).catch(e => done('__connectDone', id, false, '', e.message)); },
    openReport(id, day) {
      api('mgmt_report', { day }).then(r => {
        if (!r.ok) return done('__connectDone', id, false, '', r.error || 'Could not make the report');
        offer(r.data.name || 'GSECL_report.pdf', new Blob([unb64(r.data.data)], { type: 'application/pdf' })); done('__connectDone', id, true, '');
      });
    },
    copyText(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Copied'), () => toast('Could not copy')); },
    share(t) { if (navigator.share) navigator.share({ text: t }).catch(() => {}); else this.copyText(t); },
    dial(n) { location.href = 'tel:' + encodeURIComponent(n); },
    sms(n) { location.href = 'sms:' + encodeURIComponent(n); },
    whatsapp(m) { const d = String(m).replace(/\D/g, ''); window.open('https://wa.me/' + (d.length === 10 ? '91' + d : d), '_blank', 'noopener'); },
    email(a) { location.href = 'mailto:' + a; },
    saveContact(json) {
      let e = {}; try { e = JSON.parse(json); } catch (x) { return; }
      const s = k => (e[k] && e[k] !== 'null' ? String(e[k]).replace(/[\r\n;,]/g, ' ') : '');
      const v = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + s('full_name'), 'N:' + s('full_name') + ';;;;', s('designation') && 'TITLE:' + s('designation'), 'ORG:GSECL' + (s('station') ? ';' + s('station') : ''),
        s('mobile') && 'TEL;TYPE=CELL:' + s('mobile'), s('office_phone') && 'TEL;TYPE=WORK:' + s('office_phone'), s('email') && 'EMAIL:' + s('email'), 'END:VCARD'].filter(Boolean).join('\r\n');
      offer((s('full_name') || 'contact').replace(/[^\w .-]/g, '_') + '.vcf', new Blob([v], { type: 'text/vcard' }), 'Open to add to Contacts');
    },
    openAuthenticator(uri) { if (/^otpauth:\/\//.test(uri)) location.href = uri; },
    pendingNotice() { return ''; },
  };

  // ---------------------------------------------------------------- sources a browser cannot read: the copies the Android phones send
  // The GSECL feed, SLDC real-time data and SLDC outage list refuse other web sites. The Android phones send them to the
  // GSECL Connect service every ~2 minutes; the page gets those copies here exactly as if it had read the source itself.
  const RAW_FRESH = 20 * 60000;
  function rawSrcOf(url) {
    const u = String(url).split('?')[0];
    if (/dcsg\.gsecl\.in\/final_gsecl_digen\.txt$/i.test(u)) return 'feed';
    if (/ReadRealTimeData\.php$/i.test(u)) return 'rt';
    if (/ReadRealTimeData2\.php$/i.test(u)) return 'rt2';
    if (/shutdownplanning\.php$/i.test(u)) return 'out';
    return null;
  }
  const raw = { at: 0, data: {}, waiting: null };
  function rawGet(src) {
    if (Date.now() - raw.at < 45000 && raw.data[src]) return Promise.resolve(rawBody(src));
    if (!raw.waiting) raw.waiting = new Promise(r => setTimeout(r, 250)).then(() => api('src_raw', { srcs: ['feed', 'rt', 'rt2', 'out'] })).then(r => {
      raw.waiting = null;
      if (r.ok) { raw.data = r.data.data || {}; raw.at = Date.now(); }
      else if (/unknown action/i.test(r.error)) throw new Error('Live data needs the updated GSECL Connect script (new Code.gs).');
      else throw new Error(r.error || 'The GSECL Connect service did not answer');
    }, e => { raw.waiting = null; throw e; });
    return raw.waiting.then(() => rawBody(src));
  }
  function rawBody(src) {
    const x = raw.data[src];
    if (!x || Date.now() - x.at > RAW_FRESH) throw new Error('No recent reading: the Android phones send it every few minutes while their monitoring runs.');
    return src === 'out' ? outagesHtml(JSON.parse(x.body), x.at) : x.body;
  }
  /** The outage list (as the phones send it) in the layout of SLDC's page, so the page's own reader takes it. */
  function outagesHtml(list, at) {
    const e = t => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const d = new Date(at), p = n => String(n).padStart(2, '0');
    const head = '<tr><th>SR NO</th><th>UNIT</th><th>CAP</th><th>OUTAGE DTD</th><th>OUTAGE TIME</th><th>FORCE</th><th>PLAN</th><th>AVAILABLE</th><th>SCHEDULE DT.</th><th>REVISED EXPECTED DATE</th><th>REASON</th></tr>';
    const rows = list.map((o, i) => { const [dt, tm] = String(o.since || '').split(/\s+/), t = String(o.type || '').toLowerCase();
      return '<tr><td>' + (i + 1) + '</td><td>' + e(o.unit) + '</td><td>' + e(o.cap) + '</td><td>' + e(dt) + '</td><td>' + e(tm) + '</td><td>' + (t === 'forced' ? e(o.cap || 1) : '') + '</td><td>' + (t === 'planned' ? e(o.cap || 1) : '') +
        '</td><td></td><td></td><td>' + e(o.back) + '</td><td>' + e(o.reason || (t === 'rsd' ? 'RSD' : '')) + '</td></tr>'; }).join('');
    return '<html><body><p>UNIT OUTAGE DETAIL FOR DATE ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' AT ' + p(d.getHours()) + ':' + p(d.getMinutes()) + '</p><table><tr><td>STATE SECTOR</td></tr>' + head + rows + '</table></body></html>';
  }

  // ---------------------------------------------------------------- Native
  const HIST = 'gsecl_hist', HIST_KEEP = 10 * 864e5, HIST_GAP = 55000;
  const histLines = () => (LS.get(HIST) || '').split('\n').filter(Boolean);
  const histSave = lines => { const cut = Date.now() - HIST_KEEP; LS.set(HIST, lines.filter(l => +l.split(',')[0] >= cut).join('\n') + '\n'); };
  function histAppend(values) {
    if (values.every(v => v === '' || v === null || v === undefined || !isFinite(v))) return false;
    const l = histLines(), last = l.length ? +l[l.length - 1].split(',')[0] : 0, t = Date.now();
    if (t - last < HIST_GAP) return false;
    l.push(t + ',' + values.map(v => (v === '' || v === null || v === undefined || !isFinite(v) ? '' : String(+v))).join(','));
    histSave(l); return true;
  }
  window.Native = {
    account() { return JSON.stringify(Session.user || {}); },
    jsError(m) { console.error('Page script error:', m); },
    logout() { Session.signOut(true); location.reload(); },
    changePassword() { if (window.webLogin) window.webLogin.change(); },
    isSystemDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); },
    setBars(status) { let m = document.querySelector('meta[name=theme-color]'); if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); } m.content = status; },
    fetch(id, url, timeoutSec) {
      const src = rawSrcOf(url);
      if (src) return rawGet(src).then(b => done('__nativeDone', id, true, b), e => done('__nativeDone', id, false, '', e.message));
      if (/^https:\/\/(www\.)?(sldcguj\.com|dcsg\.gsecl\.in)\//i.test(url)) return done('__nativeDone', id, false, '', 'Shown in the Android app (this page of SLDC cannot be read from a browser)');
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), (timeoutSec || 30) * 1000);
      fetch(url, { signal: ctl.signal, cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(new Error('Source returned HTTP ' + r.status)))
        .then(b => done('__nativeDone', id, true, b), e => done('__nativeDone', id, false, '', 'Not readable from a browser; shown from the GSECL Connect service when another device has it'))
        .finally(() => clearTimeout(t));
    },
    fetchBytes(id, url, timeoutSec) {
      fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(b => done('__nativeDone', id, true, b64(b)), () => done('__nativeDone', id, false, '', 'Not readable from a browser'));
    },
    historyAppend(f, c, g) { return histAppend([f, c, g]); },
    historyAppend2(f, c, g, th, hy, so, wi) { return histAppend([f, c, g, th, hy, so, wi]); },
    historyAppend3(f, c, g, th, hy, so, wi, tot) { return histAppend([f, c, g, th, hy, so, wi, tot]); },
    historyRead(since) { const s = +since || 0; return histLines().filter(l => +l.split(',')[0] >= s).join('\n') + '\n'; },
    historyMerge(csv) {
      const have = histLines(), times = have.map(l => +l.split(',')[0]).sort((a, b) => a - b);
      const near = t => { let lo = 0, hi = times.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, d = times[m] - t; if (Math.abs(d) < HIST_GAP) return true; if (d < 0) lo = m + 1; else hi = m - 1; } return false; };
      const seen = new Set(), fresh = String(csv || '').split('\n').map(s => s.trim()).filter(Boolean).filter(l => { const t = +l.split(',')[0]; const b = Math.floor(t / HIST_GAP); if (!t || near(t) || seen.has(b)) return false; seen.add(b); return true; });
      if (!fresh.length) return 0;
      histSave(have.concat(fresh).sort((a, b) => +a.split(',')[0] - +b.split(',')[0])); return fresh.length;
    },
    historyInfo() { const l = histLines(); return l.length + ',' + (l.length ? l[0].split(',')[0] : 0) + ',' + (LS.get(HIST) || '').length; },
    historyClear() { LS.del(HIST); },
    unitHistoryRead() { return ''; },
    unitHistoryAppend() { return false; },
    storeGet(name) { return ['merit_history', 'settings'].includes(name) ? (LS.get('gsecl_store_' + name) || '') : ''; },
    storeSet(name, v) { if (['merit_history', 'settings'].includes(name)) LS.set('gsecl_store_' + name, v); },
    exportCsv(file, csv) { offer(file, new Blob(['﻿' + csv], { type: 'text/csv' })); return true; },
    // Android-only features: off here (their settings are hidden in the web version).
    appLock() { return 'none'; }, setAppLock() {},
    monitorMinutes() { return 0; }, monitorLastAt() { return 0; }, monitorSet() {},
    alertsPrefs() { return '0,0,0'; }, alertsPermitted() { return false; }, alertsSetPref() {}, alertsSetLabels() {}, alertsSetSldcMap() {}, alertsEvaluate() {},
    alertsHistory() { return '[]'; }, alertsHistoryClear() {},
    updateInfo() { return JSON.stringify({ current: CFG.version || 'web', web: true }); }, updateCheck() {}, updateInstall() {}, updateRequested() { return false; },
  };

  // ---------------------------------------------------------------- Rake: the FOIS list another device shared
  window.Rake = {
    cached() { return SS.get('fois') || JSON.stringify({ last_sync: '', rakes: [], indents: [] }); },
    // No FOIS here: the latest list an Android phone shared (kept from the last visit), and the newest one is asked for.
    refresh(id) { if (window.liveWant) window.liveWant('fois'); done('__rakeDone', id, true, this.cached()); },
    route(id) { done('__rakeDone', id, false, '', ''); },
    events() { return '[]'; },
    autoRefresh() { return false; }, setAutoRefresh() {}, wipe() { SS.del('fois'); },
  };
  window.webKeepFois = obj => { try { SS.set('fois', JSON.stringify(obj)); } catch (e) { /* too big */ } };

  // ---------------------------------------------------------------- Dsm: estimate and weekly accounts from the Sheet (web-dsm.js draws them)
  window.Dsm = {
    data() { return JSON.stringify({ fy: '', years: [], notices: [], rows: [] }); }, health() { return 'null'; }, healthAll() { return '{}'; },
    status() { return JSON.stringify({ running: false, message: '' }); }, stations() { return ''; }, setStations() {}, check() {}, backfill() {}, retry() {}, stop() {},
    reread() {}, week() { return '{}'; }, pendingWeek() { return ''; }, openPdf() {}, fetchYear() {}, fetchNotice() {},
  };

  // ---------------------------------------------------------------- Chat (end-to-end encrypted, same format as ChatCrypto.kt)
  const P256 = { name: 'ECDH', namedCurve: 'P-256' }, SIGN = { name: 'ECDSA', namedCurve: 'P-256' };
  const ZERO_IV = new Uint8Array(12);
  const myKid = () => deviceId.slice(0, 16), myEmp = () => String((Session.user || {}).emp_no || '');
  let chatKeys = null;
  async function keysMine() {
    if (chatKeys && chatKeys.owner === myEmp()) return chatKeys;
    let k = await idb.get('chat').catch(() => null);
    if (!k || k.owner !== myEmp()) {
      const ka = await crypto.subtle.generateKey(P256, false, ['deriveBits']), sg = await crypto.subtle.generateKey(SIGN, false, ['sign', 'verify']);
      k = { owner: myEmp(), ka: ka.privateKey, sg: sg.privateKey, kaPub: b64(await crypto.subtle.exportKey('spki', ka.publicKey)), sgPub: b64(await crypto.subtle.exportKey('spki', sg.publicKey)) };
      await idb.put('chat', k).catch(() => {});               // without IndexedDB: for this visit only
    }
    return (chatKeys = k);
  }
  const gcm = async (encrypt, keyBytes, iv, data, aad) => {
    const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [encrypt ? 'encrypt' : 'decrypt']);
    const p = { name: 'AES-GCM', iv, tagLength: 128 }; if (aad) p.additionalData = aad;
    return new Uint8Array(await (encrypt ? crypto.subtle.encrypt(p, k, data) : crypto.subtle.decrypt(p, k, data)));
  };
  const wrapKey = async (privKey, peerSpkiB64, saltBytes, kid) => {
    const peer = await crypto.subtle.importKey('spki', unb64(peerSpkiB64), P256, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privKey, 256);
    const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: enc.encode('gsecl-chat-wrap|' + kid) }, ikm, 256));
  };
  const aadOf = conv => enc.encode('gsecl-chat-v1|' + conv);
  const signedOf = (conv, eph, iv, ct) => enc.encode('gsecl-chat-v1|' + conv + '|' + eph + '|' + iv + '|' + ct);
  // ECDSA: Java uses DER, WebCrypto raw r||s.
  const derToRaw = der => {
    let p = 2; if (der[1] & 0x80) p += der[1] & 0x7f;
    const int = () => { p++; const len = der[p++]; let v = der.slice(p, p + len); p += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
    return cat(int(), int());
  };
  const rawToDer = raw => {
    const int = v => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; v = v.slice(i); if (v[0] & 0x80) v = cat(new Uint8Array([0]), v); return cat(new Uint8Array([2, v.length]), v); };
    const body = cat(int(raw.slice(0, 32)), int(raw.slice(32)));
    return cat(new Uint8Array([0x30, body.length]), body);
  };
  const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));

  async function seal(conv, plainBytes, recipients) {
    const me = await keysMine(), key = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = b64(await gcm(true, key, iv, plainBytes, aadOf(conv)));
    const eph = await crypto.subtle.generateKey(P256, true, ['deriveBits']), ephB = new Uint8Array(await crypto.subtle.exportKey('spki', eph.publicKey));
    const w = {};
    for (const [kid, ka] of recipients) w[kid] = b64(await gcm(true, await wrapKey(eph.privateKey, ka, ephB, kid), ZERO_IV, key));
    const ephS = b64(ephB), ivS = b64(iv);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.sg, signedOf(conv, ephS, ivS, ct)));
    return { v: 1, eph: ephS, iv: ivS, ct, w, sig: b64(rawToDer(sig)) };
  }
  async function openEnv(conv, env) {
    const me = await keysMine(), ephB = unb64(env.eph);
    const key = await gcm(false, await wrapKey(me.ka, env.eph, ephB, myKid()), ZERO_IV, unb64(env.k));
    return gcm(false, key, unb64(env.iv), unb64(env.ct), aadOf(conv));
  }
  async function verify(conv, env, sgPub) {
    try {
      const k = await crypto.subtle.importKey('spki', unb64(sgPub), SIGN, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, derToRaw(unb64(env.sig)), signedOf(conv, env.eph, env.iv, env.ct));
    } catch (e) { return false; }
  }
  async function safetyNumber(a, b) {
    const part = async p => { let h = await sha256(enc.encode('gsecl-safety|' + p[0] + '|' + [...p[1]].sort().join('|'))); for (let i = 0; i < 1024; i++) h = await sha256(cat(h, enc.encode(p[0]))); return h; };
    const [x, y] = [a, b].sort((m, n) => (m[0] < n[0] ? -1 : m[0] > n[0] ? 1 : 0));
    let digits = '';
    for (const h of [await part(x), await part(y)]) for (let i = 0; i < 6; i++) {
      const n = h[i * 5] * 4294967296 + h[i * 5 + 1] * 16777216 + h[i * 5 + 2] * 65536 + h[i * 5 + 3] * 256 + h[i * 5 + 4];
      digits += String(n % 100000).padStart(5, '0');
    }
    return digits.match(/.{5}/g).join(' ');
  }
  window.webChatCrypto = { seal, openEnv, verify, safetyNumber, derToRaw, rawToDer, keysMine };   // for tests

  const keyCache = {};
  async function chatApi(action, params) { const r = await api(action, params); if (!r.ok) throw new Error(r.error || 'The chat service did not answer'); return r.data; }
  async function keysOf(emps, maxAge) {
    const now = Date.now(), need = emps.filter(e => !keyCache[e] || keyCache[e].at < now - maxAge);
    if (need.length) {
      const list = (await chatApi('chat_keys', { emps: need })).keys || [];
      need.forEach(e => { keyCache[e] = { at: now, list: list.filter(k => k.emp === e) }; });
    }
    const o = {}; emps.forEach(e => { o[e] = keyCache[e] ? keyCache[e].list : []; }); return o;
  }
  function changedKeys(keys) {
    const changed = [];
    Object.entries(keys).forEach(([emp, l]) => {
      if (emp === myEmp() || !l.length) return;
      const now = l.map(k => k.kid + ':' + String(k.ka).slice(-16)).sort().join(','), before = LS.get('gsecl_ck_' + emp);
      if (before !== null && before !== now) changed.push(emp);
      LS.set('gsecl_ck_' + emp, now);
    });
    return changed;
  }
  async function recipients(members) {
    const keys = await keysOf(members, 5 * 60000), info = {};
    const missing = members.filter(m => m !== myEmp() && !(keys[m] || []).length); if (missing.length) info.nokeys = missing;
    const changed = changedKeys(keys); if (changed.length) info.changed = changed;
    const list = Object.values(keys).flat().map(k => [k.kid, k.ka]), me = await keysMine();
    if (!list.some(x => x[0] === myKid())) list.push([myKid(), me.kaPub]);
    const uniq = []; const seen = new Set(); list.forEach(x => { if (!seen.has(x[0])) { seen.add(x[0]); uniq.push(x); } });
    if (uniq.length > 330) throw new Error('This group has too many phones for one message');
    return { list: uniq, info };
  }
  const membersOf = json => { try { return [...new Set(JSON.parse(json).map(String).filter(Boolean))]; } catch (e) { return []; } };
  const chatDone = (id, p) => p.then(b => done('__connectDone', id, true, typeof b === 'string' ? b : JSON.stringify(b)), e => done('__connectDone', id, false, '', (e && e.message) || 'Chat error'));
  const MAX_FILE = 16 * 1024 * 1024;
  const chatBlobs = {};

  window.Chat = {
    setup(id) { chatDone(id, (async () => { const k = await keysMine(); await chatApi('chat_key_set', { ka: k.kaPub, sg: k.sgPub }); return { kid: myKid() }; })()); },
    sync(id, since, v) {
      chatDone(id, (async () => {
        const d = await chatApi('chat_sync', { since, v });
        if (d.same) return d;
        const msgs = d.msgs || [], senders = [...new Set(msgs.map(m => String(m.from)))];
        let keys = {}; try { keys = await keysOf(senders, 10 * 60000); } catch (e) { keys = {}; }
        const out = [];
        for (const m of msgs) {
          const o = { id: m.id, conv: m.conv, from: m.from, at: m.at };
          if (m.deleted) o.deleted = true;
          else if (!m.env) o.nokey = true;
          else {
            try {
              const plain = JSON.parse(dec.decode(await openEnv(m.conv, m.env)));
              o.t = plain.t || ''; o.ok = true; if (plain.f) o.f = plain.f; if ('r' in plain) o.r = plain.r;
              let s = (keys[m.from] || []).find(k => k.kid === m.kid);
              if (!s) { try { s = ((await keysOf([String(m.from)], 0))[m.from] || []).find(k => k.kid === m.kid); } catch (e) { s = null; } }
              o.verified = !!s && await verify(m.conv, m.env, s.sg);
            } catch (e) { o.ok = false; }
          }
          out.push(o);
        }
        d.msgs = out; return d;
      })());
    },
    send(id, conv, membersJson, text, reply) {
      chatDone(id, (async () => {
        if (!String(text).trim()) throw new Error('Type a message');
        if (text.length > 6000) throw new Error('The message is too long (6,000 characters at most)');
        const { list, info } = await recipients(membersOf(membersJson)), plain = { t: text }; if (reply > 0) plain.r = reply;
        const d = await chatApi('chat_send', { conv, env: await seal(conv, enc.encode(JSON.stringify(plain)), list) });
        return Object.assign(d, info);
      })());
    },
    /** Must be called from a tap (Safari opens the file chooser only then). */
    sendFile(id, conv, membersJson, caption) {
      const input = document.createElement('input'); input.type = 'file'; input.style.display = 'none'; document.body.appendChild(input);
      let settled = false;
      const finish = () => { input.remove(); window.removeEventListener('focus', onFocus); };
      const onFocus = () => setTimeout(() => { if (!settled && !(input.files && input.files.length)) { settled = true; finish(); done('__connectDone', id, false, '', 'cancelled'); } }, 1500);
      window.addEventListener('focus', onFocus);
      input.onchange = () => {
        const file = input.files && input.files[0]; settled = true; finish();
        if (!file) return done('__connectDone', id, false, '', 'cancelled');
        chatDone(id, (async () => {
          if (file.size > MAX_FILE) throw new Error('The document is larger than 16 MB');
          const bytes = new Uint8Array(await file.arrayBuffer()), key = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
          const cipher = await gcm(true, key, iv, bytes);
          const f = { n: (file.name || 'document').slice(0, 120), m: file.type || 'application/octet-stream', s: bytes.length, k: b64(key), i: b64(iv), h: b64(await sha256(bytes)) };
          const { list, info } = await recipients(membersOf(membersJson));
          const d = await chatApi('chat_send', { conv, env: await seal(conv, enc.encode(JSON.stringify({ t: caption, f })), list), blob: b64(cipher) });
          chatBlobs[d.id] = cipher;
          return Object.assign(d, info, { f, t: caption });
        })());
      };
      input.click();
    },
    openFile(id, msgId, fileJson) {
      chatDone(id, (async () => {
        const f = JSON.parse(fileJson);
        const cipher = chatBlobs[msgId] || unb64((await chatApi('chat_file', { id: msgId })).data);
        if (cipher.length < 3e6) chatBlobs[msgId] = cipher;
        const plain = await gcm(false, unb64(f.k), unb64(f.i), cipher);
        if (b64(await sha256(plain)) !== f.h) throw new Error('The document does not match what was sent');
        offer(f.n || 'document', new Blob([plain], { type: f.m || 'application/octet-stream' }));
        return {};
      })());
    },
    safety(id, emp) {
      chatDone(id, (async () => {
        const keys = await keysOf([myEmp(), emp], 0), mine = (keys[myEmp()] || []).map(k => k.ka + k.sg), theirs = (keys[emp] || []).map(k => k.ka + k.sg);
        if (!theirs.length) throw new Error('They have not opened chat in the new app yet');
        changedKeys(keys);
        return { number: await safetyNumber([myEmp(), mine], [emp, theirs]), mine: mine.length, theirs: theirs.length };
      })());
    },
    seen() {},
  };

  window.webApi = api; window.webSession = Session; window.webStore = SS; window.webOffer = offer; window.webToast = toast;
})();
