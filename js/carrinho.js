/* ============================================================
   VIRTÙ — Carrinho JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ── NAVBAR SCROLL ──────────────────────────
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // ── MOBILE MENU ────────────────────────────
  const menuToggle  = document.getElementById('menuToggle');
  const mobileMenu  = document.getElementById('mobileMenu');
  const menuClose   = document.getElementById('menuClose');
  const menuOverlay = document.getElementById('menuOverlay');

  const openMenu  = () => { mobileMenu?.classList.add('open'); document.body.style.overflow = 'hidden'; menuToggle?.setAttribute('aria-expanded','true'); };
  const closeMenu = () => { mobileMenu?.classList.remove('open'); document.body.style.overflow = ''; menuToggle?.setAttribute('aria-expanded','false'); };

  menuToggle?.addEventListener('click', openMenu);
  menuClose?.addEventListener('click', closeMenu);
  menuOverlay?.addEventListener('click', closeMenu);

  // ── SEARCH OVERLAY ─────────────────────────
  const searchOverlay       = document.getElementById('searchOverlay');
  const searchToggle        = document.getElementById('searchToggle');
  const searchClose         = document.getElementById('searchClose');

  const openSearch  = () => { searchOverlay?.classList.add('open'); searchOverlay?.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100); };
  const closeSearch = () => { searchOverlay?.classList.remove('open'); searchOverlay?.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; };

  searchToggle?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeSearch(); } });

  // ── CÁLCULO DO CARRINHO ────────────────────
  const FREE_SHIPPING_THRESHOLD = 300;
  let discount = 0;

  function getItems() {
    return [...document.querySelectorAll('.cart-item:not([hidden])')];
  }

  function getItemTotal(item) {
    const price = parseInt(item.getAttribute('data-price') || 0);
    const qty   = parseInt(item.querySelector('.qty-input')?.value || 1);
    return price * qty;
  }

  function updateSummary() {
    const items    = getItems();
    const subtotal = items.reduce((sum, item) => sum + getItemTotal(item), 0);
    const total    = Math.max(0, subtotal - discount);
    const installment = total / 6;

    // Atualiza totais dos itens individuais
    items.forEach(item => {
      const itemTotal = getItemTotal(item);
      const totalEl = item.querySelector('.cart-item__total');
      if (totalEl) totalEl.textContent = formatCurrency(itemTotal);
    });

    // Atualiza resumo
    const subtotalEl = document.getElementById('summarySubtotal');
    const totalEl    = document.getElementById('summaryTotal');
    const installEl  = document.getElementById('summaryInstallments');
    const discLine   = document.getElementById('discountLine');
    const discEl     = document.getElementById('summaryDiscount');
    const shippingEl = document.getElementById('summaryShipping');

    if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
    if (totalEl)    totalEl.textContent    = formatCurrency(total);
    if (installEl)  installEl.textContent  = `ou 6x de ${formatCurrency(installment)} sem juros`;

    if (discLine) discLine.hidden = discount === 0;
    if (discEl)   discEl.textContent = `−${formatCurrency(discount)}`;

    // Frete
    const isFree = subtotal >= FREE_SHIPPING_THRESHOLD;
    if (shippingEl) {
      shippingEl.textContent = isFree ? 'Grátis ✦' : formatCurrency(25);
      shippingEl.className   = isFree ? 'cart-summary__shipping-free' : '';
    }

    // Progress bar frete grátis
    const fill = document.getElementById('freeShippingFill');
    const text = document.getElementById('freeShippingText');
    const pct  = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
    if (fill) fill.style.width = `${pct}%`;
    if (text) {
      if (isFree) {
        text.textContent = '🎉 Você ganhou frete grátis!';
        text.style.color = '#2e7d32';
      } else {
        const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
        text.textContent = `Falta ${formatCurrency(remaining)} para frete grátis`;
        text.style.color = '';
      }
    }

    // Estado vazio
    const cartEmpty = document.getElementById('cartEmpty');
    const cartLayout = document.getElementById('cartLayout');
    if (items.length === 0) {
      if (cartEmpty)  cartEmpty.hidden = false;
      if (cartLayout) cartLayout.style.display = 'none';
    }
  }

  function formatCurrency(value) {
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // ── QUANTIDADE ──────────────────────────────
  document.querySelectorAll('.cart-item').forEach(item => {
    const minus = item.querySelector('.qty-btn--minus');
    const plus  = item.querySelector('.qty-btn--plus');
    const input = item.querySelector('.qty-input');

    minus?.addEventListener('click', () => {
      const v = parseInt(input.value);
      if (v > 1) { input.value = v - 1; updateSummary(); }
    });

    plus?.addEventListener('click', () => {
      const v = parseInt(input.value);
      if (v < 10) { input.value = v + 1; updateSummary(); }
    });

    input?.addEventListener('change', () => {
      let v = parseInt(input.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 10) v = 10;
      input.value = v;
      updateSummary();
    });
  });

  // ── REMOVER ITEM ────────────────────────────
  document.querySelectorAll('.cart-item__remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.cart-item');
      if (!item) return;

      item.style.transition = 'opacity 0.3s, transform 0.3s, max-height 0.4s';
      item.style.opacity = '0';
      item.style.transform = 'translateX(-20px)';
      item.style.maxHeight = item.offsetHeight + 'px';

      setTimeout(() => {
        item.style.maxHeight = '0';
        item.style.padding = '0';
        item.style.margin  = '0';
        item.style.overflow = 'hidden';
        setTimeout(() => {
          item.remove();
          updateSummary();
        }, 400);
      }, 300);
    });
  });

  // ── CUPOM ───────────────────────────────────
  const VALID_COUPONS = { 'VIRTU10': 10, 'VIRTU20': 20, 'BEMVINDA': 15 };
  let appliedCoupon = null;

  document.getElementById('applyCoupon')?.addEventListener('click', () => {
    const input    = document.getElementById('couponInput');
    const feedback = document.getElementById('couponFeedback');
    const code     = input?.value.trim().toUpperCase();

    if (!code) { showFeedback('Por favor, insira um cupom.', 'error'); return; }
    if (appliedCoupon) { showFeedback('Já existe um cupom aplicado.', 'error'); return; }

    if (VALID_COUPONS[code]) {
      const pct = VALID_COUPONS[code];
      const items = getItems();
      const subtotal = items.reduce((sum, item) => sum + getItemTotal(item), 0);
      discount = Math.round(subtotal * pct / 100);
      appliedCoupon = code;
      showFeedback(`✓ Cupom ${code} aplicado! −${pct}% de desconto`, 'success');
      if (input) { input.disabled = true; }
      updateSummary();
    } else {
      showFeedback('Cupom inválido ou expirado.', 'error');
    }
  });

  function showFeedback(msg, type) {
    const fb = document.getElementById('couponFeedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = `cart-coupon__feedback cart-coupon__feedback--${type}`;
  }

  // ── QUICK ADD (SUGESTÕES) ───────────────────
  document.querySelectorAll('.product-card__quick-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Adicionado!';
      btn.style.cssText = 'background:var(--color-navy);color:white;';
      setTimeout(() => { btn.innerHTML = orig; btn.style.cssText = ''; }, 1400);
    });
  });

  document.querySelectorAll('.product-card__wishlist').forEach(btn => {
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); btn.classList.toggle('active'); });
  });

  // ── SCROLL REVEAL ──────────────────────────
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revealObs.unobserve(e.target); } });
  }, { threshold: 0.08 });

  document.querySelectorAll('.product-card').forEach((el, i) => {
    el.style.cssText = `opacity:0;transform:translateY(16px);transition:opacity 0.5s ease ${i*0.06}s,transform 0.5s ease ${i*0.06}s`;
    revealObs.observe(el);
  });

  const style = document.createElement('style');
  style.textContent = '.revealed{opacity:1!important;transform:translateY(0)!important}';
  document.head.appendChild(style);

  // ── INIT ────────────────────────────────────
  updateSummary();

});
