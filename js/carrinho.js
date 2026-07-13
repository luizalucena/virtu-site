/* ============================================================
   VIRTÙ — Carrinho JavaScript
   Lê itens do localStorage (chave: virtu_cart) e os renderiza
   ============================================================ */

/* ── CART STORAGE ──────────────────────────────────────────── */
const CART_KEY    = 'virtu_cart';
// Cupons validados via Supabase (não exponha códigos no frontend)

let freeShippingThreshold = 799;  // frete grátis Brasil ≥ R$799 (regra fixa; ver processar-pagamento/calcular-frete)
let discount              = 0;
let appliedCoupon         = null;
let appliedPct            = 0;    // % do cupom ativo (para recalcular ao remover item)
let appliedTipo           = null; // tipo do cupom ativo
let appliedValorFixo      = 0;    // valor fixo do cupom ativo
let giftWrap              = false;
let giftWrapPrice         = 15;   // sobrescrito pelo Supabase

/* ── CARREGAR CONFIGURAÇÕES DO SUPABASE ── */
(async () => {
  if (typeof supabaseClient === 'undefined') return;
  try {
    const { data: cfg } = await supabaseClient
      .from('configuracoes')
      .select('frete_gratis_acima, preco_embalagem_presente')
      .eq('id', 1)
      .maybeSingle();
    if (!cfg) return;

    if (cfg.frete_gratis_acima != null) {
      freeShippingThreshold = cfg.frete_gratis_acima != null ? parseFloat(cfg.frete_gratis_acima) : 799;
    }
    if (cfg.preco_embalagem_presente != null) {
      giftWrapPrice = parseFloat(cfg.preco_embalagem_presente) || 15;
      const label = document.getElementById('giftWrapPriceLabel');
      if (label) label.textContent = `+ ${formatCurrency(giftWrapPrice)}`;
    }

    // Re-renderiza o resumo com os valores corretos do admin
    updateSummary();
  } catch { /* mantém os valores padrão */ }
})();

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
    : `background:${item.imagem_placeholder || 'linear-gradient(160deg,#F4F1EA,#EAE4D9)'}`;

  const metaParts = [
    item.tamanho  ? `Tam: ${escHtml(item.tamanho)}`  : '',
    item.cor_nome ? escHtml(item.cor_nome) : ''
  ].filter(Boolean);
  const meta = item.sem_variacao
    ? '<span style="color:#c0392b;font-weight:500">Selecione tamanho e cor na página do produto</span>'
    : (metaParts.join(' · ') || escHtml(item.categoria || ''));

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
    // Verifica estoque baixo de cada item de forma assíncrona
    _verificarEstoqueBaixoNoCarrinho(items);
  }

  updateSummary();
}

/* ── VERIFICAÇÃO DE ESTOQUE BAIXO NO CARRINHO ───────────────── */
async function _verificarEstoqueBaixoNoCarrinho(items) {
  if (typeof supabaseClient === 'undefined') return;
  const variacaoIds = items
    .map((item, idx) => ({ idx, id: item.variacao_id }))
    .filter(x => x.id);
  if (!variacaoIds.length) return;

  try {
    const { data } = await supabaseClient
      .from('variacoes')
      .select('id, estoque')
      .in('id', variacaoIds.map(x => x.id));

    if (!data) return;

    const estoqueMap = {};
    data.forEach(v => { estoqueMap[v.id] = v.estoque; });

    variacaoIds.forEach(({ idx, id }) => {
      const estoque = estoqueMap[id];
      if (estoque == null) return;

      const itemEl = document.querySelector(`.cart-item[data-index="${idx}"]`);
      if (!itemEl) return;

      // Remove badge anterior se houver
      itemEl.querySelector('.cart-item__stock-badge')?.remove();

      if (estoque === 0) {
        const badge = document.createElement('p');
        badge.className = 'cart-item__stock-badge cart-item__stock-badge--esgotado';
        badge.textContent = 'Esgotado — remova ou troque';
        itemEl.querySelector('.cart-item__info')?.appendChild(badge);
      } else if (estoque <= 3) {
        const badge = document.createElement('p');
        badge.className = 'cart-item__stock-badge cart-item__stock-badge--urgente';
        badge.textContent = `Últimas ${estoque} unidade${estoque > 1 ? 's' : ''}!`;
        itemEl.querySelector('.cart-item__info')?.appendChild(badge);
      }
    });
  } catch { /* silencioso — não prejudica o carrinho */ }
}

/* ── RESUMO DO PEDIDO ──────────────────────────────────────── */
function updateSummary() {
  const items       = getCart();
  const subtotal    = items.reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);
  const giftExtra   = giftWrap ? giftWrapPrice : 0;
  const baseParaFrete = subtotal + giftExtra;

  // Recalcula desconto com base no subtotal atual (corrige bug ao remover itens)
  if (appliedCoupon && appliedPct > 0) {
    discount = Math.round(subtotal * appliedPct / 100);
  } else if (appliedCoupon && appliedValorFixo > 0) {
    discount = Math.min(appliedValorFixo, subtotal);
  }

  const isFree      = baseParaFrete >= freeShippingThreshold;
  const total       = Math.max(0, subtotal - discount + giftExtra); // frete calculado no checkout
  const installment = total / 12;

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
  // Prévia do parcelado no cartão: +5% (taxa) arredondado ,90, ÷12.
  // Indicativo (sem frete — o frete é calculado no checkout).
  const arredondar90 = v => {
    const arred = Math.floor((v - 0.90) + 0.5 + 1e-9);
    return Math.round((arred + 0.90) * 100) / 100;
  };
  const cardTotalCart = arredondar90(total * 1.05);
  const installmentUp = Math.floor((cardTotalCart / 12) * 100) / 100;
  set('summaryInstallments', total > 0 ? `ou 12x de ${formatCurrency(installmentUp)} no cartão` : '');

  const discLine = document.getElementById('discountLine');
  const discEl   = document.getElementById('summaryDiscount');
  if (discLine) discLine.hidden  = discount === 0;
  if (discEl)   discEl.textContent = `−${formatCurrency(discount)}`;

  const shippingEl = document.getElementById('summaryShipping');
  if (shippingEl) {
    if (subtotal === 0) { shippingEl.textContent = '—'; shippingEl.className = ''; }
    else if (isFree)   { shippingEl.textContent = 'Grátis ✦'; shippingEl.className = 'cart-summary__shipping-free'; }
    else               { shippingEl.textContent = 'A calcular'; shippingEl.className = 'cart-summary__shipping-pending'; }
  }

  // Barra de frete grátis
  const fill = document.getElementById('freeShippingFill');
  const text = document.getElementById('freeShippingText');
  const pct  = Math.min(100, (baseParaFrete / freeShippingThreshold) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (text) {
    if (isFree && baseParaFrete > 0) {
      text.textContent = 'Frete grátis em todo o Brasil';
      text.style.color = '#2e7d32';
    } else if (baseParaFrete > 0) {
      const remaining = freeShippingThreshold - baseParaFrete;
      text.textContent = `Falta ${formatCurrency(remaining)} para frete grátis em todo o Brasil`;
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
        // Redireciona para a página do produto para selecionar tamanho/cor
        const prodId = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
        if (prodId) { window.location.href = `produto.html?id=${prodId}`; return; }
        const orig = btn.innerHTML;
        btn.innerHTML = '✓ Adicionado!';
        btn.style.cssText = 'background:var(--color-navy);color:white;';
        setTimeout(() => { btn.innerHTML = orig; btn.style.cssText = ''; }, 1400);
      });
    });
    // wishlist.js gerencia os corações via event delegation global

    // Scroll reveal
    const revealObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revealObs.unobserve(e.target); } });
    }, { threshold: 0.08 });

    if (!document.getElementById('vt-reveal-style')) {
      const style = document.createElement('style');
      style.id = 'vt-reveal-style';
      style.textContent = '.revealed{opacity:1!important;transform:translateY(0)!important}';
      document.head.appendChild(style);
    }

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
  add(product, tamanho, corNome, corHex, variacaoId) {
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
        variacao_id:         variacaoId || null,
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

    // Valida cupom no Supabase (seguro — não expõe lista de cupons no frontend)
    showFeedback('Verificando cupom…', 'info');
    (async () => {
      try {
        if (typeof supabaseClient === 'undefined') throw new Error('Supabase não disponível');
        const { data, error } = await supabaseClient.rpc('validar_cupom', { p_codigo: code });
        if (error || !data || !data.valido) {
          showFeedback(data?.erro || 'Cupom inválido ou expirado.', 'error');
          return;
        }
        const tipo     = data.tipo || 'percentual';
        const valor    = data.valor || 0;
        const subtotal = getCart().reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);
        // Calcula desconto conforme tipo
        if (tipo === 'percentual') {
          discount = Math.round(subtotal * valor / 100);
        } else if (tipo === 'fixo') {
          discount = Math.min(valor, subtotal);
        } else {
          discount = 0; // frete: tratado no checkout
        }
        appliedCoupon    = code;
        appliedPct       = tipo === 'percentual' ? valor : 0;
        appliedValorFixo = tipo === 'fixo'       ? valor : 0;
        appliedTipo      = tipo;
        const label = tipo === 'percentual' ? `−${valor}%` : tipo === 'fixo' ? `−R$${valor}` : 'Frete grátis';
        showFeedback(`✓ Cupom ${code} aplicado! ${label}`, 'success');
        if (input) input.disabled = true;
        localStorage.setItem('virtu_coupon', JSON.stringify({ code, tipo, pct: tipo === 'percentual' ? valor : 0, valor, discount }));
        updateSummary();
      } catch (err) {
        console.warn('[Carrinho] Erro ao validar cupom:', err);
        showFeedback('Erro ao verificar cupom. Tente novamente.', 'error');
      }
    })();
  });

  // Embalagem para presente
  document.getElementById('giftWrapCheck')?.addEventListener('change', function () {
    giftWrap = this.checked;
    // Salva no localStorage para o checkout ler
    localStorage.setItem('virtu_gift', JSON.stringify({ ativo: giftWrap, preco: giftWrapPrice }));
    updateSummary();
  });

  // Sugestões
  loadSuggestions();

  // ── AUTH GATE: bloqueia checkout se não logado ───────────────
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
          window.location.href = 'checkout.html';
        } else {
          sessionStorage.setItem('vt_redirect_after_login', 'checkout.html');
          window.location.href = 'conta.html?redirect=checkout';
        }
      } catch {
        window.location.href = 'checkout.html';
      }
    });
  }
});
