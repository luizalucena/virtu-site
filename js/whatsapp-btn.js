/* whatsapp-btn.js — Virtù floating WhatsApp button */
(function () {
  const PHONE = '5583988171851';
  const MSG = 'Olá! Vim pelo site da Virtù e gostaria de mais informações.';
  if (document.getElementById('vt-wa-btn')) return;

  const css = document.createElement('style');
  css.textContent = [
    '#vt-wa-btn { position:fixed; bottom:24px; right:24px; width:56px; height:56px; background:#25D366; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(37,211,102,0.4); z-index:9990; text-decoration:none; transition:transform .2s,box-shadow .2s; }',
    '#vt-wa-btn:hover { transform:scale(1.1); box-shadow:0 6px 22px rgba(37,211,102,0.55); }',
    '#vt-wa-btn svg { width:30px; height:30px; fill:#fff; }',
    '#vt-wa-tip { position:fixed; bottom:90px; right:24px; background:#1a2030; color:#fff; font-size:12px; font-family:Cormorant Garamond,Georgia,serif; letter-spacing:.06em; padding:6px 12px; border-radius:3px; white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .2s; z-index:9989; }',
    '#vt-wa-btn:hover ~ #vt-wa-tip { opacity:1; }'
  ].join('');
  document.head.appendChild(css);

  const btn = document.createElement('a');
  btn.id = 'vt-wa-btn';
  btn.href = 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent(MSG);
  btn.target = '_blank'; btn.rel = 'noopener noreferrer';
  btn.setAttribute('aria-label', 'Falar no WhatsApp');
  btn.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.163 0 0 7.163 0 16c0 2.82.738 5.463 2.028 7.752L0 32l8.52-2A16 16 0 1016 0zm0 29.25a13.21 13.21 0 01-6.73-1.84l-.48-.29-4.99 1.18 1.2-4.87-.31-.5A13.2 13.2 0 012.75 16C2.75 8.69 8.69 2.75 16 2.75S29.25 8.69 29.25 16 23.31 29.25 16 29.25zm7.26-9.93c-.4-.2-2.35-1.16-2.72-1.3-.37-.13-.63-.2-.9.2-.26.4-1.03 1.3-1.26 1.56-.23.27-.46.3-.86.1-.4-.2-1.68-.62-3.2-1.98-1.18-1.06-1.98-2.36-2.22-2.76-.23-.4-.02-.61.17-.81.18-.18.4-.46.6-.7.2-.23.27-.4.4-.66.13-.27.07-.5-.03-.7-.1-.2-.9-2.16-1.23-2.96-.32-.77-.65-.67-.9-.68l-.76-.01c-.27 0-.7.1-1.06.5-.37.4-1.4 1.36-1.4 3.32s1.43 3.85 1.63 4.12c.2.27 2.8 4.28 6.8 6 .95.41 1.69.66 2.27.84.95.3 1.82.26 2.5.16.76-.11 2.35-.96 2.69-1.89.33-.93.33-1.73.23-1.89-.1-.16-.37-.27-.76-.46z"/></svg>';
  document.body.appendChild(btn);

  const tip = document.createElement('div');
  tip.id = 'vt-wa-tip'; tip.textContent = 'Falar no WhatsApp';
  document.body.appendChild(tip);
})();
