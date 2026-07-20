/**
 * mini-cart.js — Virtù
 * Gaveta lateral (slide-in) que abre ao adicionar uma peça, com nudge de
 * frete grátis e CTAs. Só na página de produto (único ponto de adição).
 *
 * API: window.VirtuMiniCart.open()  — chamado por produto.js e stock.js após add.
 * Fonte de verdade continua sendo o carrinho.html/checkout; aqui é só um atalho.
 */
(function () {
  'use strict';

  const CART_KEY   = 'virtu_cart';
  const FRETE_FREE = 799;          // frete grátis Brasil ≥ R$799 (Grande JP sempre grátis)
  let   _mounted   = false;

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
  }
  function precoItem(i) { return Number(i.preco_desconto ?? i.preco ?? i.price ?? 0); }
  function qtdItem(i)   { return Number(i.qty ?? i.quantidade ?? 1); }
  function fmt(v) {
    return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function mount() {
    if (_mounted) return;
    _mounted = true;

    const style = document.createElement('style');
    style.textContent = `
      #vt-mc-overlay{position:fixed;inset:0;background:rgba(20,30,50,.45);z-index:99990;opacity:0;
        visibility:hidden;transition:opacity .3s ease,visibility .3s ease;}
      #vt-mc-overlay.is-open{opacity:1;visibility:visible;}
      #vt-mc{position:fixed;top:0;right:0;left:auto;height:100%;width:min(390px,100vw);background:var(--color-off-white,#faf8f5);
        z-index:99991;transform:translateX(100%);transition:transform .34s cubic-bezier(.4,0,.2,1);
        display:flex;flex-direction:column;box-shadow:-8px 0 40px rgba(0,0,0,.14);font-family:var(--font-body,'Jost',sans-serif);box-sizing:border-box;}
      #vt-mc *{box-sizing:border-box;}
      #vt-mc.is-open{transform:translateX(0);}
      .vt-mc__head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px;border-bottom:1px solid rgba(26,42,74,.1);}
      .vt-mc__head p{margin:0;font-size:.86rem;letter-spacing:.06em;color:var(--color-navy,#1a2a4a);text-transform:uppercase;font-weight:600;}
      .vt-mc__head p svg{vertical-align:-2px;margin-right:6px;color:var(--color-gold,#b8943f);}
      .vt-mc__close{background:none;border:none;cursor:pointer;color:#8a8a8a;padding:4px;line-height:0;border-radius:999px;}
      .vt-mc__close:hover{color:var(--color-navy,#1a2a4a);}
      .vt-mc__ship{padding:14px 22px;background:#fff;border-bottom:1px solid rgba(26,42,74,.08);}
      .vt-mc__ship p{margin:0 0 8px;font-size:.76rem;color:var(--color-navy,#1a2a4a);letter-spacing:.02em;}
      .vt-mc__ship strong{color:var(--color-gold,#b8943f);font-weight:600;}
      .vt-mc__bar{height:5px;border-radius:999px;background:rgba(26,42,74,.1);overflow:hidden;}
      .vt-mc__bar span{display:block;height:100%;background:var(--color-gold,#b8943f);border-radius:999px;transition:width .4s ease;}
      .vt-mc__items{flex:1;overflow-y:auto;padding:8px 22px;}
      .vt-mc__empty{text-align:center;color:#9a9a9a;font-size:.86rem;padding:40px 0;}
      .vt-mc__item{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid rgba(26,42,74,.08);}
      .vt-mc__thumb{width:58px;height:74px;border-radius:10px;object-fit:cover;flex-shrink:0;background:linear-gradient(135deg,#efe9e0,#e2d9cc);}
      .vt-mc__it-name{margin:0 0 3px;font-size:.82rem;font-weight:600;color:var(--color-navy,#1a2a4a);line-height:1.3;}
      .vt-mc__it-meta{margin:0;font-size:.72rem;color:#8a8a8a;}
      .vt-mc__it-price{margin:6px 0 0;font-size:.8rem;color:var(--color-navy,#1a2a4a);}
      .vt-mc__foot{padding:18px 22px 22px;border-top:1px solid rgba(26,42,74,.1);background:#fff;}
      .vt-mc__sub{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;}
      .vt-mc__sub span:first-child{font-size:.8rem;color:#6a6a6a;letter-spacing:.03em;}
      .vt-mc__sub span:last-child{font-size:1.05rem;font-weight:600;color:var(--color-navy,#1a2a4a);}
      .vt-mc__pix{margin:0 0 14px;font-size:.72rem;color:#8a8a8a;}
      .vt-mc__pix strong{color:var(--color-gold,#b8943f);font-weight:600;}
      .vt-mc__btns{display:flex;flex-direction:column;gap:9px;}
      .vt-mc__btn{display:block;text-align:center;text-decoration:none;padding:13px;border-radius:10px;font-size:.8rem;
        letter-spacing:.08em;text-transform:uppercase;font-weight:600;cursor:pointer;transition:opacity .2s,background .2s;}
      .vt-mc__btn--primary{background:var(--color-navy,#1a2a4a);color:#fff;border:1px solid var(--color-navy,#1a2a4a);}
      .vt-mc__btn--primary:hover{opacity:.9;}
      .vt-mc__btn--ghost{background:transparent;color:var(--color-navy,#1a2a4a);border:1px solid rgba(26,42,74,.28);}
      .vt-mc__btn--ghost:hover{background:rgba(26,42,74,.05);}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'vt-mc-overlay';
    const drawer = document.createElement('aside');
    drawer.id = 'vt-mc';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Sacola');
    drawer.innerHTML = `
      <div class="vt-mc__head">
        <p><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>Adicionado à sacola</p>
        <button class="vt-mc__close" aria-label="Fechar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="vt-mc__ship" id="vtMcShip"></div>
      <div class="vt-mc__items" id="vtMcItems"></div>
      <div class="vt-mc__foot">
        <div class="vt-mc__sub"><span>Subtotal</span><span id="vtMcSub">R$ 0,00</span></div>
        <p class="vt-mc__pix"><strong>5% OFF no PIX</strong> · frete e descontos no checkout</p>
        <div class="vt-mc__btns">
          <a class="vt-mc__btn vt-mc__btn--primary" href="checkout.html">Finalizar compra</a>
          <a class="vt-mc__btn vt-mc__btn--ghost" href="carrinho.html">Ver sacola</a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener('click', close);
    drawer.querySelector('.vt-mc__close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function render() {
    const cart = getCart();
    const itemsEl = document.getElementById('vtMcItems');
    const subEl   = document.getElementById('vtMcSub');
    const shipEl  = document.getElementById('vtMcShip');
    if (!itemsEl) return;

    if (!cart.length) {
      itemsEl.innerHTML = '<p class="vt-mc__empty">Sua sacola está vazia.</p>';
      if (subEl) subEl.textContent = fmt(0);
      if (shipEl) shipEl.innerHTML = '';
      return;
    }

    let subtotal = 0;
    itemsEl.innerHTML = cart.map(i => {
      const p = precoItem(i), q = qtdItem(i);
      subtotal += p * q;
      const meta = [i.cor_nome, i.tamanho].filter(Boolean).map(escHtml).join(' · ');
      const thumb = i.imagem_url
        ? `<img class="vt-mc__thumb" src="${escHtml(i.imagem_url)}" alt="${escHtml(i.nome || '')}" loading="lazy">`
        : `<div class="vt-mc__thumb" style="${i.imagem_placeholder ? `background:${escHtml(i.imagem_placeholder)}` : ''}"></div>`;
      return `
        <div class="vt-mc__item">
          ${thumb}
          <div>
            <p class="vt-mc__it-name">${escHtml(i.nome || 'Produto')}</p>
            ${meta ? `<p class="vt-mc__it-meta">${meta}</p>` : ''}
            <p class="vt-mc__it-meta">Qtd: ${q}</p>
            <p class="vt-mc__it-price">${fmt(p * q)}</p>
          </div>
        </div>`;
    }).join('');

    if (subEl) subEl.textContent = fmt(subtotal);

    if (shipEl) {
      if (subtotal >= FRETE_FREE) {
        shipEl.innerHTML = `<p><strong>Você ganhou frete grátis!</strong> 🎉 (em todo o Brasil)</p>
          <div class="vt-mc__bar"><span style="width:100%"></span></div>`;
      } else {
        const falta = FRETE_FREE - subtotal;
        const pct = Math.min(100, Math.round((subtotal / FRETE_FREE) * 100));
        shipEl.innerHTML = `<p>Faltam <strong>${fmt(falta)}</strong> para frete grátis no Brasil · grátis já na Grande João Pessoa</p>
          <div class="vt-mc__bar"><span style="width:${pct}%"></span></div>`;
      }
    }
  }

  function open() {
    mount();
    render();
    document.body.style.overflow = 'hidden'; // trava o scroll do fundo
    requestAnimationFrame(() => {
      document.getElementById('vt-mc-overlay')?.classList.add('is-open');
      document.getElementById('vt-mc')?.classList.add('is-open');
    });
  }
  function close() {
    document.body.style.overflow = '';
    document.getElementById('vt-mc-overlay')?.classList.remove('is-open');
    document.getElementById('vt-mc')?.classList.remove('is-open');
  }

  window.VirtuMiniCart = { open, close, render };
})();
