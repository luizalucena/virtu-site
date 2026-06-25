/* produto-share.js — Botão de compartilhar produto no WhatsApp */
(function () {
  // Aguarda o produto carregar (produto.js é assíncrono)
  var attempts = 0;
  var timer = setInterval(function () {
    attempts++;
    if (attempts > 40) { clearInterval(timer); return; }

    // Pega o nome do produto do título da página ou OG tag
    var name = document.querySelector('meta[property="og:title"]')?.content
      || document.title.split(' — ')[0] || 'Produto';

    // Pega URL do produto (com ID)
    var url = window.location.href;

    // Encontra o container de ações do produto
    var actions = document.querySelector('.produto-acoes, .product-actions, #addToCartBtn')?.parentElement;
    if (!actions) return;

    // Evita duplicata
    if (document.getElementById('vt-share-wa')) { clearInterval(timer); return; }

    clearInterval(timer);

    // CSS
    var css = document.createElement('style');
    css.textContent = '#vt-share-wa { display:flex; align-items:center; gap:10px; background:transparent; color:#2B3F54; border:1.5px solid #2B3F54; border-radius:14px; padding:13px 24px; font-family:Cormorant Garamond,Georgia,serif; font-size:13px; letter-spacing:.12em; text-transform:uppercase; cursor:pointer; width:100%; justify-content:center; margin-top:12px; transition:background .25s,color .25s,box-shadow .25s; text-decoration:none; }'
      + '#vt-share-wa:hover { background:#2B3F54; color:#FAF8F5; box-shadow:0 8px 22px rgba(26,38,64,.16); }'
      + '#vt-share-wa:hover svg { fill:#C4934A; }'
      + '#vt-share-wa svg { width:18px; height:18px; fill:#C4934A; flex-shrink:0; transition:fill .25s; }';
    document.head.appendChild(css);

    // Botão — sem número de destino: abre WhatsApp para a cliente escolher o contato
    var msg = 'Olha esse produto da Virtù: ' + name + ' — ' + url;
    var btn = document.createElement('a');
    btn.id = 'vt-share-wa';
    btn.href = 'https://wa.me/?text=' + encodeURIComponent(msg);
    btn.target = '_blank'; btn.rel = 'noopener noreferrer';
    btn.innerHTML = '<svg viewBox="0 0 32 32"><path d="M16 0C7.16 0 0 7.16 0 16c0 2.82.74 5.46 2.03 7.75L0 32l8.52-2A16 16 0 1016 0zm0 29.25a13.21 13.21 0 01-6.73-1.84l-.48-.29-4.99 1.18 1.2-4.87-.31-.5A13.2 13.2 0 012.75 16C2.75 8.69 8.69 2.75 16 2.75S29.25 8.69 29.25 16 23.31 29.25 16 29.25zm7.26-9.93c-.4-.2-2.35-1.16-2.72-1.3-.37-.13-.63-.2-.9.2-.26.4-1.03 1.3-1.26 1.56-.23.27-.46.3-.86.1-.4-.2-1.68-.62-3.2-1.98-1.18-1.06-1.98-2.36-2.22-2.76-.23-.4-.02-.61.17-.81.18-.18.4-.46.6-.7.2-.23.27-.4.4-.66.13-.27.07-.5-.03-.7-.1-.2-.9-2.16-1.23-2.96-.32-.77-.65-.67-.9-.68l-.76-.01c-.27 0-.7.1-1.06.5-.37.4-1.4 1.36-1.4 3.32s1.43 3.85 1.63 4.12c.2.27 2.8 4.28 6.8 6 .95.41 1.69.66 2.27.84.95.3 1.82.26 2.5.16.76-.11 2.35-.96 2.69-1.89.33-.93.33-1.73.23-1.89-.1-.16-.37-.27-.76-.46z"/></svg>'
      + ' Compartilhar no WhatsApp';
    actions.appendChild(btn);
  }, 300);
})();
