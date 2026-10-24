
/* Any script error is shown briefly and recorded in the app's problem report (sent to the service). */
(function () {
  let n = 0;
  const report = (msg, show) => {
    if (n++ > 4) return;
    try { if (window.Native && Native.jsError) Native.jsError(String(msg).slice(0, 2000)); } catch (e) { /* no bridge */ }
    if (!show) return;
    const box = document.getElementById('jsErr') || Object.assign(document.createElement('div'), {id: 'jsErr'});
    box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;border-radius:10px;padding:8px 10px;font:12px system-ui';
    box.textContent = 'Something went wrong on this page; it has been reported. Please update the app. (' + String(msg).slice(0, 160) + ')';
    if (!box.parentNode) document.body ? document.body.appendChild(box) : document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box));
    setTimeout(() => box.remove(), 12000);
  };
  window.addEventListener('error', e => report((e.message || 'error') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || ''), true));
  window.addEventListener('unhandledrejection', e => report('rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason), false));
})();
