// Chat: end-to-end encrypted messages and documents between GSECL employees.
// Encryption happens in the app (window.Chat, ChatBridge.kt); this page sends and receives plain text through it
// and keeps its copy of the messages encrypted on the phone (Connect.cacheSet). The service sees only ciphertext.
// Uses $, esc, fmt, show() from index.html and conCall, conAsk, conName, conAvatar, conLoadDirectory, C from connect.js.

const H = {
  ready: false, kid: '', err: '', busy: false, sending: false,
  convs: [], msgs: {}, last: 0, v: '', read: {}, notes: {},       // notes: {conv: [system lines]}
  reads: {}, readSent: {},                                        // reads: {conv: {emp: read up to id}} from the service
  mode: 'list', open: 0, q: '', sel: new Set(), title: '', act: 0, safety: null, info: '',
  timer: 0, syncing: false, loaded: false,
  outbox: [], flushing: false, fastUntil: 0,                      // messages shown at once and sent in the background, in order
};
const hasChat = () => typeof window.Chat !== 'undefined' && hasConnect();
const chMe = () => { try { return String(JSON.parse(Native.account() || '{}').emp_no || ''); } catch (e) { return ''; } };
const chAsk = fn => conAsk(fn).then(r => { let data = null; if (r.ok) { try { data = JSON.parse(r.body || '{}'); } catch (e) { data = {}; } } return {ok: r.ok, data, error: r.error}; });
const chEmp = emp => (C.dir?.employees || []).find(e => String(e.emp_no) === String(emp)) || {emp_no: emp, full_name: 'Employee ' + emp};
const chName = emp => String(emp) === chMe() ? 'You' : conName(chEmp(emp).full_name);
const chConv = id => H.convs.find(c => c.id === +id);
const chTitle = c => c.kind === 'group' ? c.title : conName(chEmp(c.members.find(m => m !== chMe()) || chMe()).full_name);
const chTime = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short'}); };
const chSize = b => b > 1048576 ? fmt(b / 1048576, 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const chUnread = c => (H.msgs[c.id] || []).filter(m => m.id > (H.read[c.id] || 0) && m.from !== chMe()).length;

// ---------------------------------------------------------------- stored copy (encrypted by the app)

function chLoadStore() {
  if (H.loaded || !hasChat()) return;
  H.loaded = true;
  const s = conSaved('chat_meta');
  if (s) Object.assign(H, {last: s.data.last || 0, v: '', convs: s.data.convs || [], read: s.data.read || {}, reads: s.data.reads || {}});
  H.convs.forEach(c => { const m = conSaved('chat_c_' + c.id); H.msgs[c.id] = m ? m.data : []; });
}
let chSaveT = 0;
function chSave(convIds) {
  Connect.cacheSet('chat_meta', JSON.stringify({last: H.last, convs: H.convs, read: H.read, reads: H.reads}));
  (convIds || []).forEach(id => Connect.cacheSet('chat_c_' + id, JSON.stringify((H.msgs[id] || []).filter(m => m.id > 0).slice(-1000))));
}

// ---------------------------------------------------------------- service

async function chSetup() {
  if (H.ready || H.busy || !hasChat()) return;
  H.busy = true;
  const r = await chAsk(id => Chat.setup(id));
  H.busy = false;
  if (r.ok) { H.ready = true; H.kid = r.data.kid; H.err = ''; chSync(); } else H.err = r.error;
  chRender();
}

/** New messages and conversation changes; repeats while the service says there are more. */
async function chSync() {
  if (!H.ready || H.syncing) return;
  H.syncing = true;
  try {
    for (let round = 0; round < 10; round++) {
      const r = await chAsk(id => Chat.sync(id, H.last, H.v || ''));
      if (!r.ok) { H.err = r.error; break; }
      H.err = '';
      const d = r.data;
      if (d.same) break;
      if (d.convs) H.convs = d.convs;
      let readsChanged = false;
      if (d.reads) { readsChanged = JSON.stringify(d.reads) !== JSON.stringify(H.reads); H.reads = d.reads; }
      const touched = new Set();
      (d.msgs || []).forEach(m => {
        const l = H.msgs[m.conv] || (H.msgs[m.conv] = []), i = l.findIndex(x => x.id === m.id);
        if (i >= 0) { l[i] = Object.assign(l[i], m); touched.add(m.conv); return; }
        const tmp = m.from === chMe() ? l.findIndex(x => x.id < 0 && x.pending && x.t === m.t) : -1;   // my message, still being confirmed
        if (tmp >= 0) l[tmp] = m; else l.push(m);
        if (m.conv === H.open && m.from !== chMe()) H.fastUntil = Date.now() + 30e3;   // a conversation going on: look more often
        touched.add(m.conv);
      });
      H.last = Math.max(H.last, d.last || 0); H.v = d.v || '';
      if (H.open && $('v-chat').classList.contains('on')) H.read[H.open] = Math.max(H.read[H.open] || 0, ...(H.msgs[H.open] || []).map(m => m.id), 0);
      chSave([...touched]);
      Chat.seen(H.last);
      if (touched.size || d.convs || readsChanged) chRender();
      if (!d.more) break;
    }
  } finally { H.syncing = false; chBadge(); }
  chMarkRead();
}

/**
 * How often to look: an open chat every 3 s (1.5 s for half a minute after a message either way), the chat list
 * every 6 s, elsewhere a minute (only once chat is used).
 */
function chTick() {
  clearTimeout(H.timer);
  const on = $('v-chat')?.classList.contains('on');
  const every = on && H.mode === 'conv' ? (Date.now() < H.fastUntil ? 1500 : 3e3) : on ? 6e3 : H.convs.length ? 60e3 : 0;
  if (!every || document.hidden) return;
  H.timer = setTimeout(async () => { await chSync(); chTick(); }, every);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && H.ready) { chSync(); chTick(); } });

function chBadge() {
  const n = H.convs.reduce((t, c) => t + chUnread(c), 0), el = $('chatCnt');
  if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; }
}

/** Tells the service this chat has been read up to its newest message (only while it is on screen). */
function chMarkRead() {
  const c = chConv(H.open);
  if (!c || H.mode !== 'conv' || document.hidden || !$('v-chat')?.classList.contains('on')) return;
  const me = chMe(), upto = Math.max(0, ...(H.msgs[c.id] || []).filter(m => m.from !== me).map(m => m.id));
  if (!upto || upto <= ((H.reads[c.id] || {})[me] || 0) || upto <= (H.readSent[c.id] || 0)) return;
  H.readSent[c.id] = upto;
  conCall('chat_read', {conv: c.id, upto}).then(r => { if (r.ok) { (H.reads[c.id] = H.reads[c.id] || {})[me] = r.data.upto; } else H.readSent[c.id] = 0; });
}

/** Ticks of an own message: ✓ on the server, grey ✓✓ read by some of a group, coloured ✓✓ read by everyone. */
function chTicks(c, m) {
  if (m.failed) return '<b class="chtk bad" title="Not sent">⚠</b>';
  if (m.pending || m.id < 0) return '<b class="chtk wait" title="Sending">🕓</b>';
  const others = c.members.filter(x => x !== chMe()), rd = H.reads[c.id] || {}, n = others.filter(x => (rd[x] || 0) >= m.id).length;
  if (!others.length) return '';
  if (n === others.length) return '<b class="chtk rd" title="Read">✓✓</b>';
  return n ? `<b class="chtk" title="Read by ${n} of ${others.length}">✓✓</b>` : '<b class="chtk" title="Sent">✓</b>';
}
function chReadInfo(c, m) {
  const others = c.members.filter(x => x !== chMe()), rd = H.reads[c.id] || {};
  const yes = others.filter(x => (rd[x] || 0) >= m.id), no = others.filter(x => (rd[x] || 0) < m.id);
  if (c.kind === 'direct') return `<div class="chri">${yes.length ? '✓✓ Read' : '✓ Sent, not read yet'}</div>`;
  return `<div class="chri"><b>Read by ${yes.length} of ${others.length}</b>${yes.length ? '<br>✓✓ ' + yes.map(e => esc(chName(e))).join(', ') : ''}${no.length ? '<br>Not yet: ' + no.map(e => esc(chName(e))).join(', ') : ''}</div>`;
}

/** Send: the message is shown at once (🕓) and the box is free for the next; encrypting and sending go on behind. */
let chSeq = 0;
function chSend() {
  const box = $('chText'), text = (box?.value || '').trim(), c = chConv(H.open);
  if (!text || !c) return;
  const m = {id: -(++chSeq), conv: c.id, from: chMe(), at: Date.now(), t: text, ok: true, verified: true, pending: true, r: H.replying && H.act > 0 ? H.act : 0};
  (H.msgs[c.id] = H.msgs[c.id] || []).push(m);
  box.value = ''; box.style.height = 'auto';
  const hadReply = H.replying; H.act = 0; H.replying = false;
  if (hadReply) chRenderComposer();
  H.outbox.push(m);
  chPaint(true);
  const t = $('chText'); if (t) t.focus();
  chFlush();
}
async function chFlush() {
  if (H.flushing) return;
  H.flushing = true;
  try {
    while (H.outbox.length) {
      const m = H.outbox[0], c = chConv(m.conv);
      const r = c ? await chAsk(id => Chat.send(id, c.id, JSON.stringify(c.members), m.t, m.r || 0)) : {ok: false, error: 'Chat not found'};
      H.outbox.shift();
      const l = H.msgs[m.conv] || [], i = l.indexOf(m);
      if (!r.ok) { m.pending = false; m.failed = r.error || 'Not sent'; chPaint(); continue; }
      if (i >= 0) {
        const real = {id: r.data.id, conv: m.conv, from: m.from, at: r.data.at || m.at, t: m.t, ok: true, verified: true};
        if (m.r) real.r = m.r;
        if (l.some(x => x.id === r.data.id)) l.splice(i, 1); else l[i] = real;
      }
      if (c) chNotes(c, r.data);
      chSave([m.conv]); H.fastUntil = Date.now() + 30e3;
      chPaint();
    }
  } finally { H.flushing = false; }
  chSync(); chTick();
}
/** A message that could not be sent: tapped, it goes again. */
function chRetry(id) {
  const m = (H.msgs[H.open] || []).find(x => x.id === id);
  if (!m || !m.failed) return false;
  m.failed = ''; m.pending = true; m.at = Date.now();
  const l = H.msgs[H.open]; l.splice(l.indexOf(m), 1); l.push(m);
  H.outbox.push(m); chPaint(true); chFlush();
  return true;
}

async function chSendFile() {
  const c = chConv(H.open);
  if (!c || H.sending) return;
  const caption = ($('chText')?.value || '').trim();
  H.sending = true; chRenderComposer();
  const r = await chAsk(id => Chat.sendFile(id, c.id, JSON.stringify(c.members), caption));
  H.sending = false;
  if (r.ok) {
    if ($('chText')) $('chText').value = '';
    const l = H.msgs[c.id] || (H.msgs[c.id] = []);
    if (!l.some(m => m.id === r.data.id)) l.push({id: r.data.id, conv: c.id, from: chMe(), at: r.data.at, t: r.data.t || '', f: r.data.f, ok: true, verified: true});
    chNotes(c, r.data); chSave([c.id]); chRender(); chScroll();
  } else if (r.error !== 'cancelled') { H.err = r.error; chRender(); }
  else chRenderComposer();
}

/** Lines shown in the conversation about members who cannot read yet, or who changed phone. */
function chNotes(c, d) {
  const n = H.notes[c.id] || (H.notes[c.id] = []);
  (d.nokeys || []).forEach(e => n.push(`${chName(e)} has not opened Chat in the new app yet, so cannot read this message. It will be readable for messages sent after they do.`));
  (d.changed || []).forEach(e => n.push(`${chName(e)}'s security number changed (new phone or app reinstalled). Check it in chat info if in doubt.`));
}

async function chOpenWith(emp) {
  H.busy = true; chRender();
  const r = await conCall('chat_open', {with: emp});
  H.busy = false;
  if (!r.ok) { H.err = r.error; return chRender(); }
  chUpsert(r.data.conv); chGo('conv', r.data.conv.id);
}
function chUpsert(c) { const i = H.convs.findIndex(x => x.id === c.id); if (i >= 0) H.convs[i] = c; else H.convs.unshift(c); H.msgs[c.id] = H.msgs[c.id] || []; chSave([]); }

async function chGroupCreate() {
  const title = ($('chGroupName')?.value || '').trim();
  if (!title) { H.err = 'Give the group a name'; return chRender(); }
  if (!H.sel.size) { H.err = 'Choose at least one member'; return chRender(); }
  H.busy = true; chRender();
  const r = await conCall('chat_group_create', {title, members: [...H.sel]});
  H.busy = false;
  if (!r.ok) { H.err = r.error; return chRender(); }
  H.sel.clear(); chUpsert(r.data.conv); chGo('conv', r.data.conv.id);
}

async function chGroupUpdate(params) {
  H.busy = true; chRender();
  const r = await conCall('chat_group_update', Object.assign({id: H.open}, params));
  H.busy = false;
  if (!r.ok) { H.err = r.error; return chRender(); }
  if (params.leave) { H.convs = H.convs.filter(c => c.id !== H.open); chSave([]); return chGo('list'); }
  chUpsert(r.data.conv); H.sel.clear(); chGo('info', H.open);
}

async function chDelete(id) {
  if (!confirm('Delete this message for everyone?')) return;
  const r = await conCall('chat_delete', {id});
  if (!r.ok) { H.err = r.error; return chRender(); }
  const l = H.msgs[H.open] || [], m = l.find(x => x.id === id);
  if (m) { delete m.t; delete m.f; m.deleted = true; }
  H.act = 0; chSave([H.open]); chRender();
}

async function chOpenFile(id) {
  const m = (H.msgs[H.open] || []).find(x => x.id === id);
  if (!m || !m.f) return;
  m.opening = true; chRender();
  const r = await chAsk(cb => Chat.openFile(cb, id, JSON.stringify(m.f)));
  m.opening = false;
  if (!r.ok) H.err = r.error;
  chRender();
}

async function chSafety() {
  const c = chConv(H.open), other = c && c.members.find(m => m !== chMe());
  if (!other) return;
  H.safety = {busy: true}; chRender();
  const r = await chAsk(id => Chat.safety(id, other));
  H.safety = r.ok ? r.data : {error: r.error};
  chRender();
}

// ---------------------------------------------------------------- views

function chGo(mode, id) {
  H.mode = mode; H.err = ''; H.act = 0;
  if (id !== undefined) H.open = +id;
  if (mode === 'list' || mode === 'new' || mode === 'group') H.q = '';
  if (mode !== 'info') H.safety = null;
  if (mode === 'conv') { H.read[H.open] = Math.max(H.read[H.open] || 0, ...(H.msgs[H.open] || []).map(m => m.id), 0); chSave([]); chBadge(); }
  chRender(); window.scrollTo({top: 0});
  if (mode === 'conv') { chScroll(); chMarkRead(); }
  chTick();
}
const chScroll = () => setTimeout(() => { const el = $('chMsgs'); if (el) window.scrollTo({top: document.body.scrollHeight}); }, 30);
const chNearEnd = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 180;
/**
 * The open conversation, messages only: the header and the composer (with what is being typed and the keyboard)
 * stay as they are. Follows the newest message when the list was at its end (or toEnd).
 */
function chPaint(toEnd) {
  const c = chConv(H.open), box = $('chMsgs');
  if (!c || H.mode !== 'conv' || !box) return chRender();
  const end = toEnd || chNearEnd();
  box.innerHTML = chMsgsHtml(c);
  const e = $('chErr'); if (e) e.innerHTML = H.err ? `<div class="alert err"><span>⚠</span><span>${esc(H.err)}</span></div>` : '';
  if (end) window.scrollTo({top: document.body.scrollHeight});
}

function chShow() {
  if (!hasChat()) return chRender();
  chLoadStore();
  if (!C.dir) conLoadDirectory(false).then(chRender);
  if (!H.ready) chSetup(); else chSync();
  chRender(); chTick();
}

function chRender() {
  const box = $('chatBody');
  if (!box) return;
  if (!hasChat()) { box.innerHTML = '<div class="card"><div class="empty">Sign in to GSECL Connect to use Chat.</div></div>'; return; }
  const err = H.err ? `<div class="alert err"><span>⚠</span><span>${esc(H.err)}</span></div>` : '';
  if (!H.ready && !H.convs.length) { box.innerHTML = err + (H.busy || !H.err ? '<div class="card"><h2>Setting up secure chat…</h2><div class="sk" style="height:90px"></div></div>' : `<button class="btn" data-hact="retry">Try again</button>`); return; }
  // the conversation on screen: only its messages are drawn again (no flicker, the keyboard stays open)
  if (H.mode === 'conv' && box.dataset.conv === String(H.open) && $('chMsgs') && $('chCompose')) return chPaint();
  box.innerHTML = (H.mode === 'conv' ? '' : err) + ({list: chListHtml, conv: chConvHtml, new: chNewHtml, group: chGroupHtml, info: chInfoHtml}[H.mode] || chListHtml)();
  box.dataset.conv = H.mode === 'conv' ? String(H.open) : '';
  if (H.mode === 'conv') { chRenderComposer(); const e = $('chErr'); if (e && H.err) e.innerHTML = err; }
  const s = $('chSearch');
  if (s) { s.addEventListener('input', () => { H.q = s.value; const l = $('chPeople'); if (l) l.innerHTML = chPeopleHtml(H.mode === 'group'); }); }
}

function chListHtml() {
  const list = [...H.convs].map(c => ({c, last: (H.msgs[c.id] || []).slice(-1)[0]})).sort((a, b) => (b.last?.at || b.c.updated_at || 0) - (a.last?.at || a.c.updated_at || 0));
  const q = H.q.trim().toLowerCase();
  const rows = list.filter(x => !q || chTitle(x.c).toLowerCase().includes(q)).map(({c, last}) => {
    const n = chUnread(c), other = c.kind === 'group' ? null : chEmp(c.members.find(m => m !== chMe()));
    const prev = !last ? 'No messages yet' : last.deleted ? 'Message deleted' : last.f ? '📎 ' + (last.f.n || 'Document') : last.t || (last.nokey ? '🔒 Not readable on this phone' : '');
    return `<div class="chrow" data-hact="open" data-harg="${c.id}">
      ${other ? conAvatar(other, 44) : `<span class="chgav">${esc((c.title || '?').slice(0, 1).toUpperCase())}</span>`}
      <div class="chm"><div class="chn"><b>${esc(chTitle(c))}</b><span>${last ? chTime(last.at) : ''}</span></div>
      <div class="chp"><span>${last && last.from === chMe() && !last.deleted ? chTicks(c, last) + ' ' : ''}${c.kind === 'group' && last && !last.deleted ? esc(chName(last.from)) + ': ' : ''}${esc(prev)}</span>${n ? `<i>${n}</i>` : ''}</div></div></div>`;
  }).join('');
  return `<div class="chhead"><div><b>Chat</b><span>🔒 End-to-end encrypted</span></div>
      <button class="btn" data-hact="new" style="color:var(--accent)">New chat</button><button class="btn" data-hact="group" style="color:var(--accent)">New group</button></div>
    ${H.convs.length > 6 ? `<input class="search" id="chSearch" placeholder="Search chats" value="${esc(H.q)}">` : ''}
    <div class="card" style="padding:4px 12px">${rows || '<div class="empty">No chats yet. Start one with “New chat”, or from a person in People (Connect).</div>'}</div>
    <div class="note-src">Messages and documents are encrypted on your phone and can be read only on the phones of the people in the chat. GSECL Connect's service and Google store only encrypted data and cannot read them. Messages are kept for a year.</div>`;
}

function chPeopleHtml(multi) {
  const q = H.q.trim().toLowerCase(), me = chMe();
  const all = (C.dir?.employees || []).filter(e => String(e.emp_no) !== me && !e.app_blocked);   // a blocked employee cannot read chat
  const hit = q ? all.filter(e => (e._s || (e._s = [e.full_name, e.emp_no, e.designation, e.department, e.station, e.station_short].filter(Boolean).join(' ').toLowerCase())).includes(q)) : all;
  const sel = multi ? [...H.sel].map(chEmp) : [];
  const show = (q ? hit : multi ? sel.concat(all.filter(e => !H.sel.has(String(e.emp_no)))) : all).slice(0, 60);
  if (!C.dir) return '<div class="sk" style="height:120px"></div>';
  return show.map(e => `<div class="chrow" data-hact="${multi ? 'pick' : 'with'}" data-harg="${esc(e.emp_no)}">${conAvatar(e, 38)}
      <div class="chm"><div class="chn"><b>${esc(conName(e.full_name))}</b>${multi ? `<span class="chk ${H.sel.has(String(e.emp_no)) ? 'on' : ''}">✓</span>` : ''}</div>
      <div class="chp"><span>${esc([e.designation, e.station_short || e.station].filter(Boolean).join(' · '))}</span></div></div></div>`).join('')
    + (hit.length > 60 ? `<div class="note-src">${hit.length - 60} more — type to narrow the list.</div>` : '') + (!hit.length ? '<div class="empty">No one found.</div>' : '');
}

function chNewHtml() {
  return `<div class="chips"><button class="chip" data-hact="list">‹ Chats</button></div>
    <div class="card"><h2>New chat</h2><input class="search" id="chSearch" placeholder="Search name, designation, station" value="${esc(H.q)}">
    <div id="chPeople">${chPeopleHtml(false)}</div></div>`;
}

function chGroupHtml() {
  const editing = H.mode === 'group' && H.info === 'add';
  return `<div class="chips"><button class="chip" data-hact="${editing ? 'info' : 'list'}">‹ ${editing ? 'Group info' : 'Chats'}</button></div>
    <div class="card"><h2>${editing ? 'Add members' : 'New group'}</h2>
    ${editing ? '' : `<input class="search" id="chGroupName" placeholder="Group name (e.g. WTPS Unit 8 O&M)" maxlength="60" value="${esc(H.title)}">`}
    <input class="search" id="chSearch" placeholder="Search people to add" value="${esc(H.q)}">
    <div class="muted" style="font-size:12.5px;margin:-4px 0 6px">${H.sel.size} selected</div>
    <div id="chPeople">${chPeopleHtml(true)}</div>
    <div style="margin-top:10px"><button class="btn" data-hact="${editing ? 'addgo' : 'create'}" style="background:var(--accent);color:#fff;border-color:var(--accent)">${H.busy ? 'Please wait…' : editing ? 'Add to group' : 'Create group'}</button></div></div>`;
}

function chConvHtml() {
  const c = chConv(H.open);
  if (!c) return '<div class="card"><div class="empty">Chat not found.</div></div>';
  const me = chMe();
  const sub = c.kind === 'group' ? c.members.length + ' members' : esc(chEmp(c.members.find(m => m !== me)).designation || '');
  const other = c.kind === 'group' ? null : chEmp(c.members.find(m => m !== me));
  return `<div class="chtop"><button class="chback" data-hact="list" aria-label="Back to chats">‹</button>${other ? conAvatar(other, 36) : `<span class="chgav" style="width:36px;height:36px;font-size:15px">${esc((c.title || '?').slice(0, 1).toUpperCase())}</span>`}
      <div data-hact="info" data-harg="${c.id}" style="flex:1;min-width:0;cursor:pointer"><b>${esc(chTitle(c))}</b><span>${sub} · 🔒 encrypted</span></div><button class="chback" data-hact="info" data-harg="${c.id}" aria-label="Chat info" style="font-size:18px">ⓘ</button></div>
    <div id="chErr"></div><div id="chMsgs">${chMsgsHtml(c)}</div>
    <div id="chCompose"></div>`;
}
/** The messages of a conversation (bubbles, day separators, ticks, replies, documents). */
function chMsgsHtml(c) {
  const me = chMe(), l = H.msgs[c.id] || [];
  let day = '', h = '';
  for (const m of l) {
    const d = new Date(m.at).toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'});
    if (d !== day) { h += `<div class="chday"><span>${d}</span></div>`; day = d; }
    const mine = m.from === me;
    let body;
    if (m.deleted) body = '<i class="muted">Message deleted</i>';
    else if (m.nokey) body = '<i class="muted">🔒 Sent before Chat was set up on this phone; it cannot be read here.</i>';
    else if (m.ok === false) body = '<i class="muted">⚠ This message could not be decrypted on this phone.</i>';
    else {
      const re = m.r ? l.find(x => x.id === m.r) : null;
      body = (re ? `<div class="chre"><b>${esc(chName(re.from))}</b> ${esc((re.t || (re.f ? '📎 ' + re.f.n : '')).slice(0, 80))}</div>` : '')
        + (m.f ? `<div class="chfile" data-hact="file" data-harg="${m.id}"><span class="ico">📄</span><div><b>${esc(m.f.n)}</b><span>${chSize(m.f.s)} · ${m.opening ? 'opening…' : 'tap to open'}</span></div></div>` : '')
        + (m.t ? `<div class="cht">${esc(m.t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>` : '');
    }
    h += `<div class="chb ${mine ? 'me' : ''}${m.pending ? ' new' : ''}${m.failed ? ' fail' : ''}" data-hact="msg" data-harg="${m.id}">
      ${c.kind === 'group' && !mine ? `<div class="chfrom">${esc(chName(m.from))}</div>` : ''}${body}
      <div class="chmeta">${m.failed ? '<span class="chfail">Not sent · tap to try again</span> ' : ''}${m.verified === false && !mine ? '<span title="Signature not checked">⚠ unverified · </span>' : ''}${new Date(m.at).toTimeString().slice(0, 5)}${mine && !m.deleted ? ' ' + chTicks(c, m) : ''}</div>
      ${H.act === m.id && !m.deleted && mine ? chReadInfo(c, m) : ''}
      ${H.act === m.id && !m.deleted && m.id > 0 ? `<div class="chacts">${m.t ? '<button data-hact="copy">Copy</button>' : ''}<button data-hact="reply">Reply</button>${mine ? '<button data-hact="del">Delete for everyone</button>' : ''}</div>` : ''}</div>`;
  }
  const notes = (H.notes[c.id] || []).map(n => `<div class="chnote">${esc(n)}</div>`).join('');
  return (h || '<div class="chnote">🔒 Messages are end-to-end encrypted. No one outside this chat, not even GSECL Connect, can read them.</div>') + notes;
}

function chRenderComposer() {
  const el = $('chCompose');
  if (!el) return;
  const keep = $('chText')?.value || '';
  const re = H.act && H.replying ? (H.msgs[H.open] || []).find(m => m.id === H.act) : null;
  el.innerHTML = `<div class="chcomp">${re ? `<div class="chre" style="grid-column:1/-1">Replying to <b>${esc(chName(re.from))}</b>: ${esc((re.t || '').slice(0, 60))} <span data-hact="noreply" style="float:right;cursor:pointer">✕</span></div>` : ''}
    <button class="chi" data-hact="attach" aria-label="Send a document" ${H.sending ? 'disabled' : ''}>📎</button>
    <textarea id="chText" rows="1" placeholder="${H.sending ? 'Sending the document…' : 'Message'}" maxlength="6000"></textarea>
    <button class="chi send" data-hact="send" aria-label="Send">➤</button></div>`;
  const t = $('chText');
  t.value = keep;
  t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; });
  t.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && matchMedia('(pointer: fine)').matches) { ev.preventDefault(); chSend(); } });
  // the send button keeps the keyboard up (its tap does not take the focus from the text box)
  el.querySelector('.send').addEventListener('pointerdown', ev => ev.preventDefault());
}

function chInfoHtml() {
  const c = chConv(H.open), me = chMe();
  if (!c) return '';
  const back = `<div class="chips"><button class="chip" data-hact="open" data-harg="${c.id}">‹ Chat</button></div>`;
  if (c.kind === 'direct') {
    const e = chEmp(c.members.find(m => m !== me)), s = H.safety;
    return back + `<div class="card"><div style="display:flex;gap:12px;align-items:center">${conAvatar(e, 56)}<div><b style="font-size:17px">${esc(conName(e.full_name))}</b>
      <div class="muted">${esc([e.designation, e.station_short || e.station].filter(Boolean).join(' · '))}</div></div></div></div>
      <div class="card"><h2>Security number</h2>
      <div class="muted" style="font-size:12.5px">Compare this number with ${esc(conName(e.full_name))} in person or on a call. If it is the same on both phones, your messages are encrypted only for each other's phones. It changes when either of you changes phone or reinstalls the app.</div>
      ${!s ? `<button class="btn" data-hact="safety" style="color:var(--accent);margin-top:8px">Show security number</button>`
        : s.busy ? '<div class="sk" style="height:60px;margin-top:8px"></div>' : s.error ? `<div class="alert err" style="margin-top:8px">${esc(s.error)}</div>`
        : `<div class="chsafe num">${esc(s.number)}</div><div class="note-src">Your phones: ${s.mine} · their phones: ${s.theirs}</div>`}</div>`;
  }
  const admin = c.admins.includes(me);
  return back + `<div class="card"><h2>${esc(c.title)} <span class="more muted" style="font-weight:500;font-size:11.5px">${c.members.length} members</span></h2>
    ${admin ? `<div style="display:flex;gap:8px;margin-bottom:8px"><input class="search" id="chRename" value="${esc(c.title)}" maxlength="60" style="margin:0"><button class="btn" data-hact="rename" style="color:var(--accent)">Rename</button></div>
      <button class="btn" data-hact="addm" style="color:var(--accent)">Add members</button>` : ''}
    ${c.members.map(m => { const e = chEmp(m); return `<div class="chrow" style="cursor:default">${conAvatar(e, 36)}<div class="chm"><div class="chn"><b>${esc(chName(m))}</b><span>${c.admins.includes(m) ? 'admin' : ''}</span></div>
      <div class="chp"><span>${esc([e.designation, e.station_short].filter(Boolean).join(' · '))}</span>${admin && m !== me ? `<span><a data-hact="mkadmin" data-harg="${esc(m)}" style="cursor:pointer;color:var(--accent);margin-right:10px">${c.admins.includes(m) ? '' : 'Make admin'}</a><a data-hact="rm" data-harg="${esc(m)}" style="cursor:pointer;color:var(--forced)">Remove</a></span>` : ''}</div></div></div>`; }).join('')}
    <button class="btn" data-hact="leave" style="color:var(--forced);margin-top:10px">Leave group</button></div>
    <div class="note-src">Members removed or leaving cannot read messages sent after that. New members can read only messages sent after they join.</div>`;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-hact]');
  if (!el || !$('v-chat').contains(el)) return;
  const a = el.dataset.hact, arg = el.dataset.harg;
  if (a !== 'msg') e.stopPropagation();
  switch (a) {
    case 'retry': H.err = ''; return chSetup();
    case 'list': return chGo('list');
    case 'new': return chGo('new');
    case 'group': H.sel.clear(); H.info = ''; H.title = ''; return chGo('group');
    case 'open': return chGo('conv', arg);
    case 'info': if (arg) H.open = +arg; H.info = ''; return chGo('info');
    case 'with': return chOpenWith(arg);
    case 'pick': { if ($('chGroupName')) H.title = $('chGroupName').value; H.sel.has(arg) ? H.sel.delete(arg) : H.sel.add(arg); const l = $('chPeople'); if (l) l.innerHTML = chPeopleHtml(true); const s = el.closest('.card').querySelector('.muted'); if (s) s.textContent = H.sel.size + ' selected'; return; }
    case 'create': return chGroupCreate();
    case 'addm': H.sel.clear(); H.info = 'add'; H.mode = 'group'; return chRender();
    case 'addgo': return H.sel.size ? chGroupUpdate({add: [...H.sel]}) : null;
    case 'rm': return confirm('Remove ' + chName(arg) + ' from the group?') && chGroupUpdate({remove: [arg]});
    case 'mkadmin': return chGroupUpdate({admin: [arg]});
    case 'rename': return chGroupUpdate({title: ($('chRename')?.value || '').trim()});
    case 'leave': return confirm('Leave this group? You will no longer receive its messages.') && chGroupUpdate({leave: true});
    case 'safety': return chSafety();
    case 'send': return chSend();
    case 'attach': return chSendFile();
    case 'file': return chOpenFile(+arg);
    case 'msg': if (e.target.closest('a,.chfile,.chacts')) return; if (chRetry(+arg)) return; if (+arg < 0) return; H.act = H.act === +arg ? 0 : +arg; H.replying = false; return chPaint();
    case 'copy': { const m = (H.msgs[H.open] || []).find(x => x.id === H.act); if (m && Connect.copyText) Connect.copyText(m.t || ''); H.act = 0; return chPaint(); }
    case 'reply': H.replying = true; chPaint(); chRenderComposer(); return $('chText')?.focus();
    case 'noreply': H.act = 0; H.replying = false; return chRenderComposer();
    case 'del': return chDelete(H.act);
  }
});

/** From People (Connect): "Message" on an employee's card. */
window.chatWith = emp => { show('chat'); if (!H.ready) chSetup().then(() => chOpenWith(emp)); else chOpenWith(emp); };
/** A tapped chat notification. */
window.chatOpenConv = conv => { show('chat'); if (conv && chConv(conv)) chGo('conv', conv); else chGo('list'); };

/** Android back: conversation → list → leave chat. */
const chPrevBack = window.appBack;
window.appBack = () => {
  if ($('v-chat')?.classList.contains('on') && H.mode !== 'list') { chGo(H.mode === 'info' ? 'conv' : 'list'); return true; }
  return chPrevBack ? chPrevBack() : false;
};

(function chStyle() {
  const s = document.createElement('style');
  s.textContent = `
  #v-chat .chhead { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  #v-chat .chhead > div { flex: 1; } #v-chat .chhead b { display: block; font-size: 20px; } #v-chat .chhead span { font-size: 12px; color: var(--muted); }
  .chrow { display: flex; gap: 11px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); cursor: pointer; }
  .chrow:first-child { border-top: 0; }
  .chm { flex: 1; min-width: 0; } .chn, .chp { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .chn b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .chn span { font-size: 11.5px; color: var(--muted); flex: none; }
  .chp span { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chp i { font-style: normal; background: var(--accent); color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700; padding: 0 7px; line-height: 19px; flex: none; }
  .chgav { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; font-weight: 700; font-size: 18px; background: linear-gradient(135deg, var(--brand2), var(--accent)); }
  .chk { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; color: transparent !important; font-size: 13px !important; }
  .chk.on { background: var(--accent); border-color: var(--accent); color: #fff !important; }
  #v-chat { --wa-bg: #efeae2; --wa-in: #ffffff; --wa-out: #d9fdd3; --wa-ink: #111b21; --wa-sub: #667781; --wa-bar: #f0f2f5; --wa-green: #00a884; }
  [data-theme="dark"] #v-chat { --wa-bg: #0b141a; --wa-in: #202c33; --wa-out: #005c4b; --wa-ink: #e9edef; --wa-sub: #8696a0; --wa-bar: #202c33; }
  .chtop { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; align-items: center; background: var(--wa-bar); color: var(--wa-ink); padding: 8px 10px; margin: -6px 0 0; border-radius: 12px 12px 0 0; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .chtop b { display: block; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .chtop span { font-size: 11.5px; color: var(--wa-sub); }
  .chback { border: 0; background: none; color: var(--wa-ink); font-size: 26px; line-height: 1; width: 34px; height: 36px; padding: 0; flex: none; }
  #chMsgs { display: flex; flex-direction: column; gap: 3px; padding: 10px 8px 84px; margin: 0; border-radius: 0 0 12px 12px; overflow-x: hidden; min-height: calc(100vh - 190px); background-color: var(--wa-bg);
    background-image: radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px); background-size: 18px 18px; }
  .chb { position: relative; max-width: 80%; align-self: flex-start; background: var(--wa-in); color: var(--wa-ink); border-radius: 8px; border-top-left-radius: 0; padding: 6px 8px 4px 9px; margin: 1px 0 1px 8px; box-shadow: 0 1px .5px rgba(11,20,26,.13); word-wrap: break-word; }
  .chb::before { content: ''; position: absolute; top: 0; left: -8px; border-top: 0 solid transparent; border-right: 8px solid var(--wa-in); border-bottom: 10px solid transparent; }
  .chb.me { align-self: flex-end; background: var(--wa-out); border-radius: 8px; border-top-right-radius: 0; margin: 1px 8px 1px 0; }
  .chb.me::before { left: auto; right: -8px; border-right: 0; border-left: 8px solid var(--wa-out); }
  .chb.new { animation: chIn .18s ease-out; } @keyframes chIn { from { opacity: .3; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .chb.fail { box-shadow: 0 0 0 1.5px #dc2626; cursor: pointer; } .chfail { color: #dc2626; font-weight: 600; }
  .cht { white-space: pre-wrap; font-size: 14.5px; line-height: 1.35; } .cht a { color: #027eb5; }
  .chfrom { font-size: 12.5px; font-weight: 700; color: #06cf9c; margin-bottom: 1px; }
  .chmeta { font-size: 11px; color: var(--wa-sub); text-align: right; margin-top: 1px; float: right; margin-left: 10px; position: relative; top: 4px; } .chb::after { content: ''; display: block; clear: both; }
  .chtk { font-weight: 700; letter-spacing: -.2em; color: var(--wa-sub); margin-left: 3px; } .chtk.rd { color: #53bdeb; } .chtk.wait { letter-spacing: 0; font-weight: 400; font-size: 10px; } .chtk.bad { color: #dc2626; letter-spacing: 0; }
  .chri { font-size: 12px; color: var(--muted); margin-top: 6px; border-top: 1px dashed var(--line); padding-top: 5px; }
  .chday { text-align: center; margin: 8px 0 4px; position: sticky; top: 58px; z-index: 2; } .chday span { font-size: 11.5px; color: var(--wa-sub); background: var(--wa-in); border-radius: 8px; padding: 4px 11px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  .chnote { font-size: 12px; color: #54656f; text-align: center; background: #ffeecd; border-radius: 8px; padding: 6px 10px; margin: 6px 10%; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  [data-theme="dark"] .chnote { background: #182229; color: #ffd279; }
  .chfile { display: flex; gap: 10px; align-items: center; background: rgba(0,0,0,.04); border-radius: 10px; padding: 8px 10px; cursor: pointer; margin-bottom: 4px; min-width: 200px; }
  .chfile .ico { font-size: 24px; } .chfile b { display: block; font-size: 13.5px; word-break: break-all; } .chfile span { font-size: 11.5px; color: var(--muted); }
  .chre { font-size: 12px; border-left: 3px solid var(--accent); background: rgba(0,0,0,.04); border-radius: 6px; padding: 4px 8px; margin-bottom: 4px; color: var(--muted); }
  .chacts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; } .chacts button { border: 1px solid var(--line); background: var(--card); color: var(--accent); border-radius: 8px; font: inherit; font-size: 12px; padding: 4px 8px; }
  .chcomp { position: fixed; left: 0; right: 0; bottom: 64px; z-index: 9; display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: end; padding: 6px 8px; background: var(--wa-bar); max-width: 760px; margin: 0 auto; }
  .chcomp textarea { font: inherit; font-size: 15.5px; border: 0; border-radius: 22px; padding: 10px 14px; resize: none; background: var(--wa-in); color: var(--wa-ink); max-height: 120px; outline: none; box-shadow: 0 1px .5px rgba(11,20,26,.1); }
  .chi { border: 0; background: none; font-size: 21px; width: 44px; height: 44px; border-radius: 50%; color: var(--wa-sub); }
  .chi.send { background: var(--wa-green); color: #fff; font-size: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.2); } .chi.send:active { transform: scale(.92); } .chi:disabled { opacity: .5; }
  .chp i { background: #25d366 !important; }
  .chsafe { font-size: 19px; letter-spacing: .06em; line-height: 1.7; font-weight: 700; margin: 10px 0 2px; word-spacing: 6px; }
  @media (min-width: 760px) { .chcomp { max-width: none; left: 10%; right: 10%; } }`;
  document.head.appendChild(s);
})();

if (hasChat()) { chLoadStore(); chBadge(); setTimeout(() => { if (!H.ready) chSetup().then(chTick); }, 4000); }
