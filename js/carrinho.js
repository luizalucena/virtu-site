/* ============================================================
   VIRTÙ — Carrinho JavaScript
   Lê itens do localStorage (chave: virtu_cart) e os renderiza
   ============================================================ */

/* ── CART STORAGE ──────────────────────────────────────────── */
const CART_KEY = 'virtu_cart';
const FREE_SHIPPING_THRESHOLD = 300;
const VALID_COUPONS = { 'VIRTU10': 10, 'VIRTU20': 20, 'BEMVINDA': 15 };

let discount    = 0;
let appliedCoupon = null;

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartBadge();
}

function updateCartBadge() {
  const total = getCart().reduce((s, i) => s + (i.qty || 1), 0);
  const badge = document.getElementById('cartBadge');
  if (badge) { badge.textContent = total; badge.hidden = total === 0; }
}

/* ── UTILITÁRIOS ───────────────────────────────────────────── */
function formatCurrency(value) {
  return `R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showFeedback(msg, type) {
  const fb = document.getElementById('couponFeedback');
  if (!fb) return;
  fb.textContent = msg;
  fb.className = `cart-coupon__feedback cart-coupon__feedback--${type}`;
}

/* ── RENDER DE ITEM ────────────────────────────────────────── */
function renderCartItem(item, index) {
  const imgStyle = item.imagem_url
    ? `background:url('${escHtml(item.imagem_url)}') center/cover no-repeat`
    : `background:${item.imagem_placeholder || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)'}`;

  const meta = [
    item.tamanho  ? `Tam: ${escHtml(item.tamanho)}`  : '',
    item.cor_nome ? escHtml(item.cor_nome) : ''
  ].filter(Boolean).join(' · ') || escHtml(item.categoria || '');

  const preco      = item.preco || 0;
  const qty        = item.qty   || 1;
  const itemTotal  = preco * qty;

  return `
    <div class="cart-item" data-index="${index}" data-price="${preco}">
      <a class="cart-item__image" href="produto.html?id=${escHtml(item.id)}" aria-label="${escHtml(item.nome)}">
        <div class="cart-item__img-placeholder" style="${imgStyle}"></div>
      </a>
      <div class="cart-item__info">
        <a href="produto.html?id=${escHtml(item.id)}" class="cart-item__name">${escHtml(item.nome)}</a>
        <p class="cart-item__meta">${meta}</p>
        <p class="cart-item__price-mobile">${formatCurrency(preco)}</p>
      </div>
      <div class="cart-item__price">${formatCurrency(preco)}</div>
      <div class="cart-item__qty">
        <button class="qty-btn qty-btn--minus" aria-label="Diminuir quantidade">−</button>
        <input class="qty-input" type="number" value="${qty}" min="1" max="10" aria-label="Quantidade" />
        <button class="qty-btn qty-btn--plus" aria-label="Aumentar quantidade">+</button>
      </div>
      <div class="cart-item__total">${formatCurrency(itemTotal)}</div>
      <button class="cart-item__remove" aria-label="Remover ${escHtml(item.nome)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
}

/* ── BIND EVENTOS DOS ITENS ────────────────────────────────── */
function bindItemEvents() {
  document.querySelectorAll('.cart-item').forEach(itemEl => {
    const index = parseInt(itemEl.getAttribute('data-index'));
    const minus = itemEl.querySelector('.qty-btn--minus');
    const plus  = itemEl.querySelector('.qty-btn--plus');
    const input = itemEl.querySelector('.qty-input');
    const removeBtn = itemEl.querySelector('.cart-item__remove');

    minus?.addEventListener('click', () => changeQty(index, -1));
    plus?.addEventListener('click',  () => changeQty(index,  1));
    input?.addEventListener('change', () => {
      let v = parseInt(input.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 10) v = 10;
      input.value = v;
      setQty(index, v);
    });
    removeBtn?.addEventListener('click', () => removeItem(itemEl, index));
  });
}

function changeQty(index, delta) {
  const items = getCart();
  if (!items[index]) return;
  items[index].qty = Math.min(10, Math.max(1, (items[index].qty || 1) + delta));
  saveCart(items);
  renderCartItems();
}

function setQty(index, qty) {
  const items = getCart();
  if (!items[index]) return;
  items[index].qty = qty;
  saveCart(items);
  updateSummary();
}

function removeItem(itemEl, index) {
  itemEl.style.transition = 'opacity 0.3s, transform 0.3s, max-height 0.4s';
  itemEl.style.opacity    = '0';
  itemEl.style.transform  = 'translateX(-20px)';
  itemEl.style.maxHeight  = itemEl.offsetHeight + 'px';

  setTimeout(() => {
    itemEl.style.maxHeight = '0';
    itemEl.style.padding   = '0';
    itemEl.style.margin    = '0';
    itemEl.style.overflow  = 'hidden';
    setTimeout(() => {
      const items = getCart();
      items.splice(index, 1);
      saveCart(items);
      renderCartItems();
    }, 400);
  }, 300);
}

/* ── RENDERIZA TODOS OS ITENS ──────────────────────────────── */
function renderCartItems() {
  const items     = getCart();
  const listEl    = document.getElementById('cartItemsList');
  const headerEl  = document.getElementById('cartHeader');
  const emptyEl   = document.getElementById('cartEmpty');
  const couponEl  = document.getElementById('cartCoupon');
  const summaryEl = document.getElementById('cartSummary');

  if (items.length === 0) {
    if (listEl)    listEl.innerHTML = '';
    if (headerEl)  { headerEl.hidden = true; headerEl.setAttribute('aria-hidden', 'true'); }
    if (emptyEl)   emptyEl.hidden   = false;
    if (couponEl)  couponEl.hidden  = true;
    if (summaryEl) summaryEl.hidden = true;
  } else {
    if (listEl)    listEl.innerHTML = items.map((item, i) => renderCartItem(item, i)).join('');
    if (headerEl)  { headerEl.hidden = false; headerEl.removeAttribute('aria-hidden'); }
    if (emptyEl)   emptyEl.hidden   = true;
    if (couponEl)  couponEl.hidden  = false;
    if (summaryEl) summaryEl.hidden = false;
    bindItemEvents();
  }

  updateSummary();
}

/* ── RESUMO DO PEDIDO ──────────────────────────────────────── */
function updateSummary() {
  const items    = getCart();
  const subtotal = items.reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);
  const isFree   = subtotal >= FREE_SHIPPING_THRESHOLD;
  const shipping  = isFree ? 0 : (subtotal > 0 ? 25 : 0);
  const total    = Math.max(0, subtotal - discount + shipping);
  const installment = total / 6;

  // Totais por linha
  document.querySelectorAll('.cart-item').forEach(itemEl => {
    const idx  = parseInt(itemEl.getAttribute('data-index'));
    const item = items[idx];
    if (!item) return;
    const totalEl = itemEl.querySelector('.cart-item__total');
    if (totalEl) totalEl.textContent = formatCurrency((item.preco || 0) * (item.qty || 1));
  });

  // Resumo
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('summarySubtotal',    formatCurrency(subtotal));
  set('summaryTotal',       formatCurrency(total));
  set('summaryInstallments', total > 0 ? `ou 6x de ${formatCurrency(installment)} sem juros` : '');

  const discLine = document.getElementById('discountLine');
  const discEl   = document.getElementById('summaryDiscount');
  if (discLine) discLine.hidden  = discount === 0;
  if (discEl)   discEl.textContent = `−${formatCurrency(discount)}`;

  const shippingEl = document.getElementById('summaryShipping');
  if (shippingEl) {
    if (subtotal === 0) { shippingEl.textContent = 'Calculando…'; shippingEl.className = ''; }
    else if (isFree)   { shippingEl.textContent = 'Grátis ✦'; shippingEl.className = 'cart-summary__shipping-free'; }
    else               { shippingEl.textContent = formatCurrency(25); shippingEl.className = ''; }
  }

  // Barra de frete grátis
  const fill = document.getElementById('freeShippingFill');
  const text = document.getElementById('freeShippingText');
  const pct  = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (text) {
    if (isFree && subtotal > 0) {
      text.textContent = '🎉 Você ganhou frete grátis!';
      text.style.color = '#2e7d32';
    } else if (subtotal > 0) {
      const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
      text.textContent = `Falta ${formatCurrency(remaining)} para frete grátis`;
      text.style.color = '';
    } else {
      text.textContent = '';
    }
  }
}

/* ── SUGESTÕES (Supabase) ──────────────────────────────────── */
async function loadSuggestions() {
  const grid = document.getElementById('suggestionsGrid');
  if (!grid || typeof VirtuProducts === 'undefined') return;

  try {
    const { produtos } = await VirtuProducts.fetchAll();
    const shuffled = [...produtos].sort(() => Math.random() - 0.5).slice(0, 4);

    if (shuffled.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;font-family:var(--font-body);font-size:0.85rem;color:var(--color-text-light);padding:2rem 0">Nenhuma sugestão disponível no momento.</p>';
      return;
    }

    grid.innerHTML = shuffled.map(p => VirtuProducts.renderCard(p)).join('');

    grid.querySelectorAll('.product-card__quick-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const orig = btn.innerHTML;
        btn.innerHTML = '✓ Adicionado!';
        btn.style.cssText = 'background:var(--color-navy);color:white;';
        setTimeout(() => { btn.innerHTML = orig; btn.style.cssText = ''; }, 1400);
      });
    });
    grid.querySelectorAll('.product-card__wishlist').forEach(btn => {
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); btn.classList.toggle('active'); });
    });

    // Scroll reveal
    const revealObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revealObs.unobserve(e.target); } });
    }, { threshold: 0.08 });

    const style = document.createElement('style');
    style.textContent = '.revealed{opacity:1!important;transform:translateY(0)!important}';
    document.head.appendChild(style);

    grid.querySelectorAll('.product-card').forEach((el, i) => {
      el.style.cssText = `opacity:0;transform:translateY(16px);transition:opacity 0.5s ease ${i * 0.06}s,transform 0.5s ease ${i * 0.06}s`;
      revealObs.observe(el);
    });

  } catch (err) {
    console.error('[Carrinho] Erro ao carregar sugestões:', err);
    grid.innerHTML = '';
  }
}

/* ── EXPÕE API GLOBAL (para produto.html usar) ─────────────── */
window.VirtuCart = {
  add(product, tamanho, corNome, corHex) {
    const items = getCart();
    const existingIdx = items.findIndex(
      i => i.id === product.id && i.tamanho === tamanho && i.cor_nome === corNome
    );
    if (existingIdx >= 0) {
      items[existingIdx].qty = Math.min(10, (items[existingIdx].qty || 1) + 1);
    } else {
      items.push({
        id:                  product.id,
        nome:                product.nome,
        categoria:           product.categoria,
        tamanho:             tamanho  || '',
        cor_nome:            corNome  || '',
        cor_hex:             corHex   || '',
        preco:               product.preco_desconto ?? product.preco_original,
        imagem_url:          product.imagem_url         || '',
        imagem_placeholder:  product.imagem_placeholder || '',
        qty: 1
      });
    }
    saveCart(items);
    return items.reduce((s, i) => s + (i.qty || 1), 0);
  },
  getCount() { return getCart().reduce((s, i) => s + (i.qty || 1), 0); },
  clear()    { localStorage.removeItem(CART_KEY); updateCartBadge(); }
};

/* ── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // Navbar scroll
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // Mobile menu
  const menuToggle  = document.getElementById('menuToggle');
  const mobileMenu  = document.getElementById('mobileMenu');
  const menuClose   = document.getElementById('menuClose');
  const menuOverlay = document.getElementById('menuOverlay');

  const openMenu  = () => { mobileMenu?.classList.add('open'); document.body.style.overflow = 'hidden'; menuToggle?.setAttribute('aria-expanded','true'); };
  const closeMenu = () => { mobileMenu?.classList.remove('open'); document.body.style.overflow = ''; menuToggle?.setAttribute('aria-expanded','false'); };

  menuToggle?.addEventListener('click', openMenu);
  menuClose?.addEventListener('click',  closeMenu);
  menuOverlay?.addEventListener('click', closeMenu);

  // Search overlay
  const searchOverlay       = document.getElementById('searchOverlay');
  const searchToggle        = document.getElementById('searchToggle');
  const searchToggleDesktop = document.getElementById('searchToggleDesktop');
  const searchClose         = document.getElementById('searchClose');

  const openSearch  = () => {
    searchOverlay?.classList.add('open');
    searchOverlay?.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100);
  };
  const closeSearch = () => {
    searchOverlay?.classList.remove('open');
    searchOverlay?.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  };

  searchToggle?.addEventListener('click', openSearch);
  searchToggleDesktop?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeSearch(); }
  });

  // Badge + itens
  updateCartBadge();
  renderCartItems();

  // Cupom
  document.getElementById('applyCoupon')?.addEventListener('click', () => {
    const input = document.getElementById('couponInput');
    const code  = input?.value.trim().toUpperCase();

    if (!code)        { showFeedback('Por favor, insira um cupom.', 'error'); return; }
    if (appliedCoupon){ showFeedback('Já existe um cupom aplicado.', 'error'); return; }

    if (VALID_COUPONS[code]) {
      const pct      = VALID_COUPONS[code];
      const subtotal = getCart().reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);
      discount       = Math.round(subtotal * pct / 100);
      appliedCoupon  = code;
      showFeedback(`✓ Cupom ${code} aplicado! −${pct}% de desconto`, 'success');
      if (input) input.disabled = true;
      updateSummary();
    } else {
      showFeedback('Cupom inválido ou expirado.', 'error');
    }
  });

  // Sugestões
  loadSuggestions();
});
