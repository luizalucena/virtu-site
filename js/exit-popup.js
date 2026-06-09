/* exit-popup.js — Virtù exit intent popup com cupom de frete grátis
 * Adicione em qualquer página: <script src="js/exit-popup.js"></script>
 * Não mostra de novo por 7 dias após o usuário fechar.
 */
(function () {
  var COUPON = 'FRETEGRATIS';
  var KEY = 'vt_exit_seen';
  var DAYS = 7;

  // Verifica cooldown
  var last = localStorage.getItem(KEY);
  if (last && (Date.now() - +last) / 86400000 < DAYS) return;

  // Evita duplicata (index.html tem inline)
  if (document.getElementById('vt-exit-overlay')) return;

  // CSS
  var s = document.createElement('style');
  s.textContent = [
    '#vt-exit-overlay{display:none;position:fixed;inset:0;background:rgba(10,12,18,.86);z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(3px)}',
    '#vt-exit-popup{background:#1a2030;border:1px solid rgba(201,169,110,.3);border-radius:4px;padding:48px 40px 36px;max-width:440px;width:90%;text-align:center;position:relative;animation:vtIn .35s ease}',
    '@keyframes vtIn{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:none}}',
    '#vt-close{position:absolute;top:12px;right:16px;background:none;border:none;color:rgba(255,255,255,.4);font-size:22px;cursor:pointer;line-height:1;padding:4px 6px}',
    '#vt-close:hover{color:#fff}',
    '#vt-eyebrow{font-family:Cormorant Garamond,Georgia,serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#c9a96e;margin:0 0 12px}',
    '#vt-headline{font-family:Cormorant Garamond,Georgia,serif;font-size:32px;font-weight:300;color:#fff;line-height:1.1;margin:0 0 16px;letter-spacing:.02em}',
    '#vt-divider{width:40px;height:1px;background:#c9a96e;margin:0 auto 16px}',
    '#vt-sub{font-size:13px;color:rgba(255,255,255,.7);margin:0 0 20px;font-family:Cormorant Garamond,Georgia,serif;letter-spacing:.05em}',
    '#vt-coupon-box{display:flex;align-items:center;border:1.5px dashed rgba(201,169,110,.6);border-radius:4px;overflow:hidden;margin-bottom:8px}',
    '#vt-coupon-code{flex:1;padding:14px 16px;font-family:Courier New,monospace;font-size:18px;letter-spacing:.15em;color:#c9a96e;font-weight:700}',
    '#vt-copy-btn{padding:14px 20px;background:rgba(201,169,110,.15);border:none;border-left:1.5px dashed rgba(201,169,110,.6);color:#c9a96e;cursor:pointer;font-size:13px;letter-spacing:.08em;font-family:Cormorant Garamond,Georgia,serif;transition:background .2s}',
    '#vt-copy-btn:hover{background:rgba(201,169,110,.3)}',
    '#vt-copied-msg{color:#c9a96e;font-size:12px;margin:0 0 16px;opacity:0;transition:opacity .3s;height:18px;font-family:Cormorant Garamond,Georgia,serif}',
    '#vt-cta{display:block;background:#c9a96e;color:#1a2030;padding:16px 32px;font-family:Cormorant Garamond,Georgia,serif;font-size:13px;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;transition:background .2s;margin-bottom:16px}',
    '#vt-cta:hover{background:#b8956a}',
    '#vt-dismiss{font-size:12px;color:rgba(255,255,255,.4);cursor:pointer;margin:0;font-family:Cormorant Garamond,Georgia,serif;letter-spacing:.08em;transition:color .2s}',
    '#vt-dismiss:hover{color:rgba(255,255,255,.7)}'
  ].join('');
  document.head.appendChild(s);

  // HTML
  var ov = document.createElement('div');
  ov.id = 'vt-exit-overlay';
  ov.innerHTML = '<div id="vt-exit-popup">'
    + '<button id="vt-close" aria-label="Fechar">&times;</button>'
    + '<p id="vt-eyebrow">Espere! Antes de ir&hellip;</p>'
    + '<h2 id="vt-headline">FRETE GR&Aacute;TIS<br>no seu pedido</h2>'
    + '<div id="vt-divider"></div>'
    + '<p id="vt-sub">Use o cupom abaixo ao finalizar sua compra:</p>'
    + '<div id="vt-coupon-box"><span id="vt-coupon-code">' + COUPON + '</span>'
    + '<button id="vt-copy-btn">Copiar</button></div>'
    + '<p id="vt-copied-msg">&#10004; Copiado!</p>'
    + '<a href="catalogo.html" id="vt-cta">Quero aproveitar &rarr;</a>'
    + '<p id="vt-dismiss">N&atilde;o, obrigado</p>'
    + '</div>';
  document.body.appendChild(ov);

  function close() {
    ov.style.display = 'none';
    localStorage.setItem(KEY, Date.now().toString());
  }

  function copy() {
    navigator.clipboard.writeText(COUPON).then(function () {
      var m = document.getElementById('vt-copied-msg');
      m.style.opacity = '1';
      setTimeout(function () { m.style.opacity = '0'; }, 2000);
    });
  }

  document.getElementById('vt-close').addEventListener('click', close);
  document.getElementById('vt-copy-btn').addEventListener('click', copy);
  document.getElementById('vt-dismiss').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

  // Exit intent: mouse sai pelo topo
  var shown = false;
  document.addEventListener('mouseleave', function (e) {
    if (!shown && e.clientY < 10) { shown = true; ov.style.display = 'flex'; }
  });

  // Mobile: mostra após 30s
  setTimeout(function () {
    if (!shown && window.innerWidth < 768) { shown = true; ov.style.display = 'flex'; }
  }, 30000);
})();
