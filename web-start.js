// GSECL Connect for the web: start-up and sign-in. The app's own scripts (marked type="text/x-app" by the build)
// are started only after the person is signed in, the weekly e-mailed code is confirmed and the first password is
// replaced, as in the Android app's sign-in screen (LoginActivity).
(() => {
  'use strict';
  // Never inside another site's frame (that site could trick taps into the app).
  if (window.top !== window.self) { try { window.top.location = window.self.location.href; } catch (e) { document.documentElement.innerHTML = ''; } return; }
  const S = () => window.webSession, api = (a, p) => window.webApi(a, p || {});
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- start the app's scripts in order
  async function startApp() {
    const ov = $('webLogin'); if (ov) ov.remove();
    document.documentElement.classList.add('web-ready');
    const list = [...document.querySelectorAll('script[type="text/x-app"]')];
    for (const old of list) {
      const s = document.createElement('script');
      if (old.dataset.src) {
        s.src = old.dataset.src;
        await new Promise(ok => { s.onload = ok; s.onerror = ok; document.body.appendChild(s); });
      } else { s.textContent = old.textContent; document.body.appendChild(s); }
      old.remove();
    }
    // This browser's figures are copies of what the Android phones sent: never sent back as its own readings
    // (that would make old data look new). Live sharing and the generation readings are left to the phones.
    window.liveMine = () => {};
    window.genPush = () => {};
    // FOIS lists shared by other devices are kept for the next visit.
    if (typeof window.kLiveFois === 'function') { const f = window.kLiveFois; window.kLiveFois = c => { if (c && c.obj) window.webKeepFois(c.obj); return f(c); }; }
    window.dispatchEvent(new Event('load'));
    if (window.webAfterStart) window.webAfterStart();
  }

  // ---------------------------------------------------------------- sign-in screen
  const L = { mode: 'signin', method: 'email', codeSent: false, busy: false, masked: '', totp: false, sms: false, inApp: false };
  const TITLES = { signin: 'Sign in', first: 'Register / first sign-in', reset: 'Reset password', verify: 'Confirm it is you', newpw: 'Choose your password', change: 'Change password', waiting: 'Waiting for approval' };
  const INFO = {
    signin: 'Use your GSECL employee number and GSECL Connect password.',
    first: 'Enter your employee number. A 6-digit code is e-mailed to the address registered for you; then you choose your own password.',
    reset: 'Enter your employee number. A 6-digit code is e-mailed to the address registered for you; then you choose a new password.',
    verify: '', newpw: 'Your e-mail is confirmed. Choose your new password: at least 8 characters, with letters and numbers, without your employee number.',
    change: 'Changing the password signs you out on your other devices.',
    waiting: 'Your registration has been sent to the super administrator. You can use GSECL Connect once it is approved; you will get an e-mail. Then tap “Check again”.',
  };
  /** A registration waiting for (or refused) approval by a super administrator. */
  const waits = () => { const a = ((S().user || {}).approval) || 'approved'; return a !== 'approved'; };

  function build() {
    const box = document.createElement('div');
    box.id = 'webLogin';
    box.innerHTML = `<div class="wl-col">
      <div class="wl-logo"><img src="gsecl_logo.png" alt="GSECL"></div>
      <h1>GSECL Connect</h1><div class="wl-org">GUJARAT STATE ELECTRICITY CORPORATION LTD.</div><div class="wl-bar"></div>
      <div class="wl-sub">Generation · DSM · Coal · Safety · Employees</div>
      <form class="wl-card" id="wlForm" autocomplete="on" novalidate>
        <h2 id="wlTitle"></h2><div class="wl-line"></div><p id="wlInfo"></p>
        <input id="wlEmp" name="username" autocomplete="username" placeholder="Employee number" autocapitalize="off" spellcheck="false">
        <input id="wlPass" name="password" type="password" autocomplete="current-password" placeholder="Password">
        <input id="wlCur" type="password" autocomplete="current-password" placeholder="Current password">
        <input id="wlNew" type="password" autocomplete="new-password" placeholder="New password">
        <input id="wlNew2" type="password" autocomplete="new-password" placeholder="New password again">
        <input id="wlOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code from your e-mail">
        <a id="wlForgot" class="wl-link wl-right">Forgot password?</a>
        <a id="wlResend" class="wl-link">Didn’t get the code? Send a new one</a>
        <a id="wlTotp" class="wl-link">Use the code from Google Authenticator instead</a>
        <a id="wlSms" class="wl-link">Send the code by SMS instead</a>
        <a id="wlMail" class="wl-link">Send the code by e-mail instead</a>
        <button id="wlGo" type="submit" class="wl-btn"></button>
        <button id="wlDev" type="button" class="wl-btn wl-orange" hidden>Request approval for this device</button>
        <p id="wlRegNote" class="wl-note">New user, or signing in for the first time?</p>
        <button id="wlReg" type="button" class="wl-reg">Register / first sign-in with e-mail code</button>
        <p id="wlMsg" class="wl-msg"></p>
        <a id="wlBack" class="wl-link">‹ Back to sign-in with password</a>
        <a id="wlLeave" class="wl-link"></a>
      </form>
      <p class="wl-foot">🔒 Secure sign-in · codes go only to your registered e-mail or mobile</p>
      <p class="wl-foot">For GSECL employees. Sign in with your employee number.<br>Developed by A D Bhatt, EE, GSECL</p>
      <p class="wl-foot wl-ios" id="wlIos" hidden>On iPhone: tap <b>Share</b> › <b>Add to Home Screen</b> to open GSECL Connect like an app.</p>
    </div>`;
    document.body.appendChild(box);
    $('wlForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
    $('wlForgot').onclick = () => startCode('reset');
    $('wlReg').onclick = () => startCode('first');
    $('wlResend').onclick = () => requestCode();
    $('wlTotp').onclick = () => useTotp();
    $('wlSms').onclick = () => requestCode('sms');
    $('wlMail').onclick = () => requestCode('email');
    $('wlBack').onclick = () => { const e = $('wlEmp').value; show('signin'); $('wlEmp').value = e; };
    $('wlLeave').onclick = () => leave();
    $('wlDev').onclick = () => requestDevice();
    $('wlEmp').addEventListener('input', () => { if (L.codeSent && (L.mode === 'first' || L.mode === 'reset')) { L.codeSent = false; refresh(); } });
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches);
    $('wlIos').hidden = !ios;
    api('ping').then(r => { if (r.ok && r.data && r.data.sms && !S().isLoggedIn) { L.sms = true; refresh(); } });
  }

  function show(mode) {
    if (!$('webLogin')) build();
    L.mode = mode; L.codeSent = false; L.method = mode === 'verify' && L.totp ? 'totp' : 'email';
    const vis = { signin: ['wlEmp', 'wlPass', 'wlForgot', 'wlReg', 'wlRegNote'], first: ['wlEmp', 'wlBack'], reset: ['wlEmp', 'wlBack'],
      verify: ['wlOtp', 'wlResend', 'wlLeave'], newpw: ['wlNew', 'wlNew2', 'wlLeave'], change: ['wlCur', 'wlNew', 'wlNew2', 'wlLeave'], waiting: ['wlLeave'] }[mode];
    ['wlEmp', 'wlPass', 'wlCur', 'wlNew', 'wlNew2', 'wlOtp', 'wlResend', 'wlBack', 'wlLeave', 'wlForgot', 'wlReg', 'wlRegNote'].forEach(i => { $(i).hidden = !vis.includes(i); });
    $('wlDev').hidden = true;
    $('wlTitle').textContent = TITLES[mode];
    $('wlInfo').textContent = INFO[mode];
    $('wlGo').textContent = { signin: 'Sign in', first: 'Send code to my e-mail', reset: 'Send code to my e-mail', verify: 'Verify', newpw: 'Save password', change: 'Save password', waiting: 'Check again' }[mode];
    if (mode === 'waiting' && ((S().user || {}).approval) === 'rejected') $('wlInfo').textContent = 'Your registration for GSECL Connect was not approved. Please contact the administrator.';
    $('wlLeave').textContent = mode === 'change' ? 'Cancel' : 'Sign out';
    ['wlPass', 'wlCur', 'wlNew', 'wlNew2', 'wlOtp'].forEach(i => { $(i).value = ''; });
    say('', false); refresh();
  }

  function refresh() {
    if (!$('webLogin')) return;
    const byNumber = L.mode === 'first' || L.mode === 'reset', codeStep = L.mode === 'verify' || byNumber, sent = L.mode === 'verify' || L.codeSent;
    if (byNumber) { $('wlOtp').hidden = !L.codeSent; $('wlGo').textContent = L.codeSent ? 'Verify' : 'Send code to my e-mail'; }
    $('wlTotp').hidden = !(codeStep && L.method !== 'totp' && ((L.mode === 'verify' && L.totp) || L.mode === 'reset'));
    $('wlSms').hidden = !(codeStep && L.method !== 'sms' && L.sms);
    $('wlMail').hidden = !(codeStep && L.method !== 'email' && sent);
    if (codeStep) $('wlResend').hidden = !(sent && L.method !== 'totp');
    $('wlOtp').placeholder = { totp: '6-digit code from Google Authenticator', sms: '6-digit code from the SMS' }[L.method] || '6-digit code from your e-mail';
    if (L.mode === 'verify') $('wlInfo').textContent = ({ totp: 'Enter the 6-digit code shown for GSECL Connect in Google Authenticator.', sms: 'A 6-digit code is sent by SMS to your registered mobile.' }[L.method]
      || 'A 6-digit code is e-mailed to your registered e-mail address' + (L.masked ? ' (' + L.masked + ')' : '') + '.') + ' This is asked at every sign-in and once a week on each device.';
  }

  function say(t, err) { const m = $('wlMsg'); if (!m) return; m.textContent = t; m.className = 'wl-msg' + (err ? ' wl-err' : ''); m.hidden = !t; }
  function working(on, note) { L.busy = on; $('wlGo').disabled = on; if (on) say(note || '', false); }

  function submit() {
    if (L.busy) return;
    if (L.mode === 'signin') return signIn();
    if (L.mode === 'first' || L.mode === 'reset') return L.codeSent ? verifyCode(true) : requestCode();
    if (L.mode === 'verify') return verifyCode(false);
    if (L.mode === 'waiting') return checkApproval();
    return savePassword();
  }

  async function signIn() {
    const emp = $('wlEmp').value.trim(), pass = $('wlPass').value;
    if (!emp || !pass) return say('Enter your employee number and password.', true);
    working(true, 'Signing in…');
    const r = await api('login', { emp_no: emp, password: pass });
    working(false);
    if (!r.ok || !r.data.token || !r.data.user) { $('wlDev').hidden = r.code !== 409; return say(r.error || 'Sign-in failed.', true); }
    S().signIn(r.data.token, r.data.user, false);
    L.masked = r.data.otp_email && r.data.otp_email !== 'null' ? r.data.otp_email : '';
    L.totp = !!r.data.otp_totp; L.sms = !!(r.data.otp_sms && r.data.otp_sms !== 'null');
    show('verify');
    if (!L.totp) requestCode('email');
  }

  async function requestDevice() {
    if (L.busy) return;
    const emp = $('wlEmp').value.trim(), pass = $('wlPass').value;
    if (!emp || !pass) return say('Enter your employee number and password, then tap “Request approval for this device”.', true);
    working(true, 'Sending the request…');
    const r = await api('device_request', { emp_no: emp, password: pass });
    working(false);
    if (r.ok) $('wlDev').hidden = true;
    say(r.ok ? (r.data.message || 'Request sent.') : (r.error || 'The request could not be sent.'), !r.ok);
  }

  function startCode(mode) { if (L.busy) return; const e = $('wlEmp').value; show(mode); $('wlEmp').value = e; if (e.trim()) requestCode(); else $('wlEmp').focus(); }
  function useTotp() {
    if (L.busy) return;
    L.method = 'totp';
    if (L.mode === 'first' || L.mode === 'reset') { if (!$('wlEmp').value.trim()) { L.method = 'email'; return say('Enter your employee number first.', true); } L.codeSent = true; }
    refresh(); say('', false); $('wlOtp').focus();
  }

  async function requestCode(channel) {
    channel = channel || L.method;
    if (L.busy || channel === 'totp') return;
    const emp = $('wlEmp').value.trim(), byNumber = L.mode === 'first' || L.mode === 'reset';
    if (byNumber && !emp) return say('Enter your employee number first.', true);
    working(true, channel === 'sms' ? 'Sending the code by SMS…' : 'Sending the code…');
    const r = byNumber ? await api('login_otp_request', { emp_no: emp, purpose: L.mode === 'reset' ? 'reset' : 'first', channel }) : await api('request_otp', { channel });
    working(false);
    say(r.ok ? (r.data.message || 'The code was sent.') : (r.error || 'The code could not be sent.') + (r.code === 409 && byNumber ? '\n\nTo ask for this device, go back, sign in with your password and tap “Request approval for this device”.' : ''), !r.ok);
    if (r.ok) { L.codeSent = true; L.method = channel; refresh(); $('wlOtp').focus(); }
  }

  async function verifyCode(login) {
    const code = $('wlOtp').value.trim(), emp = $('wlEmp').value.trim();
    if (login && !emp) return say('Enter your employee number.', true);
    if (code.length !== 6) return say(L.method === 'totp' ? 'Enter the 6-digit code from Google Authenticator.' : 'Enter the 6-digit code you received.', true);
    const how = L.method === 'totp' ? 'totp' : 'code';
    working(true, 'Checking the code…');
    const r = login ? await api('login_otp_verify', { emp_no: emp, otp: code, method: how, purpose: L.mode === 'reset' ? 'reset' : 'first' }) : await api('verify_otp', { otp: code, method: how });
    working(false);
    if (!r.ok || !r.data.token || !r.data.user) return say(r.error || 'The code could not be checked.', true);
    S().signIn(r.data.token, r.data.user, true);
    if (S().mustChange) show('newpw'); else if (waits()) show('waiting'); else startApp();
  }

  async function savePassword() {
    const nw = $('wlNew').value;
    if (L.mode === 'change' && !$('wlCur').value) return say('Enter your current password.', true);
    if (!nw) return say('Enter the new password.', true);
    if (nw !== $('wlNew2').value) return say('The two new passwords do not match.', true);
    working(true, 'Saving…');
    const p = { new_password: nw }; if (L.mode === 'change') p.current_password = $('wlCur').value;
    const r = await api('change_password', p);
    working(false);
    if (!r.ok || !r.data.token) return say(r.error || 'Could not change the password.', true);
    S().passwordChanged(r.data.token);
    if (r.data.pending_approval) { const u = S().user || {}; u.approval = r.data.pending_approval; S().updateUser(u); show('waiting'); return say(r.data.message || '', false); }
    if (L.inApp) { $('webLogin').remove(); L.inApp = false; window.webToast && window.webToast('Password changed'); } else startApp();
  }

  /** Waiting for approval: asks the service again (the answer of "me" says approved, pending or rejected). */
  async function checkApproval() {
    working(true, 'Checking…');
    const r = await api('me');
    working(false);
    if (!r.ok || !r.data || !r.data.user) return say(r.error || 'Could not check. Try again in a moment.', true);
    S().updateUser(r.data.user);
    if (!waits()) return startApp();
    show('waiting');
    say(r.data.user.approval === 'rejected' ? 'Not approved.' : 'Not approved yet. You will get an e-mail when it is.', r.data.user.approval === 'rejected');
  }

  function leave() {
    if (L.mode === 'change' && L.inApp) { $('webLogin').remove(); L.inApp = false; return; }
    S().signOut(false); L.masked = ''; show('signin');
  }

  window.webLogin = { change() { L.inApp = true; show('change'); } };

  // ---------------------------------------------------------------- start
  (async () => {
    try { await window.webStore.init(); } catch (e) { /* storage blocked: sign-in each time */ }
    const s = S();
    const why = s.reason; s.reason = '';
    if (window.webStore.temporary) setTimeout(() => { const f = document.querySelector('#webLogin .wl-foot'); if (f) f.insertAdjacentHTML('beforebegin', '<p class="wl-foot">This browser is not keeping data for the app (private browsing?): you will be asked to sign in on every visit.</p>'); }, 0);
    if (!s.isLoggedIn) { show('signin'); if (why) say(/blocked/i.test(why) ? why : 'You were signed out: the password was changed, the account was updated, or it was signed in on another device. Please sign in again.', true); return; }
    if (!s.otpFresh) { L.totp = !!((s.user || {}).two_step || {}).totp; show('verify'); if (!L.totp) say('Tap “Didn’t get the code? Send a new one” for a code by e-mail.', false); return; }
    if (s.mustChange) return show('newpw');
    if (waits()) { show('waiting'); return checkApproval(); }
    startApp();
  })();

  // Offline copy of the app's files; a new version published on the site is taken up at once (one reload).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
  }
})();
