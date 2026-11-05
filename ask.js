// "Ask" help button (top of the page): questions about GSECL and Gujarat's power system answered by AI (Google Gemini)
// from the app's own records (ask_data on the service): the figures come from the Sheet, the AI only reads and words them.
// Uses $, esc, conCall, hasConnect from the page.

const ASK = {open: false, busy: false, list: [], err: '', left: null};
const ASK_EG = ['What was Gujarat\'s peak demand yesterday?', 'Highest GSECL generation in the last 7 days?', 'Which units tripped this week, and why?',
  'Coal stock days at each station today?', 'PAF of WTPS 8 last month?', 'DGVCL peak drawal yesterday?'];

function askShow(open) {
  ASK.open = open;
  let box = $('askBox');
  if (!open) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'askBox'; box.className = 'askbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ask GSECL Connect'); document.body.appendChild(box); }
  askRender();
  setTimeout(() => { const i = $('askQ'); if (i) i.focus(); }, 50);
}

function askRender() {
  const box = $('askBox'); if (!box) return;
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  box.innerHTML = `<div class="ask-in"><div class="ask-h"><b>Ask GSECL Connect</b><span>AI · answers from the app's records</span><button class="ask-x" data-ask="close" aria-label="Close">✕</button></div>
    <div class="ask-l" id="askL">${ASK.list.length ? ASK.list.map(x => `<div class="ask-q">${esc(x.q)}</div>${x.a ? `<div class="ask-a">${md(x.a)}${x.src && x.src.length ? `<div class="ask-s">From: ${x.src.map(esc).join(' · ')}</div>` : ''}</div>` : '<div class="ask-a"><span class="sk" style="display:inline-block;width:140px;height:14px"></span></div>'}`).join('')
      : `<div class="ask-e">Ask about demand, generation, units, outages, coal, PAF, DSM or prices on any day the app has kept, for example:${ASK_EG.map(q => `<button class="chip" data-ask="eg">${esc(q)}</button>`).join('')}</div>`}
      ${ASK.err ? `<div class="alert err" style="margin:8px 0 0"><span>⚠</span><span>${esc(ASK.err)}</span></div>` : ''}</div>
    <div class="ask-f"><textarea id="askQ" rows="2" placeholder="Type your question…" ${ASK.busy ? 'disabled' : ''}></textarea><button class="btn" style="margin:0;background:var(--accent);color:#fff;border-color:var(--accent)" data-ask="send" ${ASK.busy ? 'disabled' : ''}>${ASK.busy ? '…' : 'Ask'}</button></div>
    <div class="ask-n">Written by AI (Google Gemini) from the figures GSECL Connect keeps; check important figures on the page itself.${ASK.left !== null ? ' ' + ASK.left + ' questions left today.' : ''}</div></div>`;
  const l = $('askL'); if (l) l.scrollTop = l.scrollHeight;
}

async function askSend(q) {
  q = String(q || '').trim();
  if (!q || ASK.busy) return;
  if (typeof hasConnect === 'function' && !hasConnect()) { ASK.err = 'Sign in to ask.'; return askRender(); }
  const history = ASK.list.filter(x => x.a).slice(-2).map(x => ({q: x.q, a: x.a}));
  const item = {q, a: ''}; ASK.list.push(item); ASK.busy = true; ASK.err = ''; askRender();
  const r = await conCall('ask_data', {q, history});
  ASK.busy = false;
  if (r.ok) { item.a = r.data.answer; item.src = r.data.sources || []; ASK.left = r.data.remaining; }
  else { ASK.list.pop(); ASK.err = /unknown action/i.test(r.error) ? 'The help assistant needs the updated service script (new Code.gs).' : r.error; }
  askRender();
}

document.addEventListener('click', e => {
  if (e.target.closest('#askBtn')) return askShow(!ASK.open);
  const b = e.target.closest('[data-ask]'); if (!b) { if (ASK.open && e.target.id === 'askBox') askShow(false); return; }
  if (b.dataset.ask === 'close') return askShow(false);
  if (b.dataset.ask === 'eg') return askSend(b.textContent);
  if (b.dataset.ask === 'send') { const i = $('askQ'); return askSend(i ? i.value : ''); }
});
document.addEventListener('keydown', e => { if (e.target && e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askSend(e.target.value); } });
// Android back closes the panel first
(() => { const prev = window.appBack; window.appBack = () => { if (ASK.open) { askShow(false); return true; } return typeof prev === 'function' ? prev() : false; }; })();
// the button shows once signed in to the service
setTimeout(function askBtnShow() { const b = $('askBtn'); if (b) b.hidden = !(typeof hasConnect === 'function' && hasConnect()); }, 800);
