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

/* ── ESTOQUE REAL POR ITEM (autoridade: Supabase) ──────────────
   O backend (reservar_estoque_pedido) é a autoridade final; aqui
   espelhamos o estoque REAL de cada variação (produto + tamanho + cor)
   para não deixar o cliente pedir mais do que existe.               */
let _estoqueMap = {};   // chave do item → estoque (número). Ausente = desconhecido.

function _itemKey(item) {
  return `${item.id ?? item.produto_id ?? ''}|${item.tamanho ?? ''}|${item.cor_nome ?? ''}`;
}

// Limite de quantidade do item: estoque real se conhecido, senão 10 (fallback).
function _capDoItem(item) {
  const e = _estoqueMap[_itemKey(item)];
  return (typeof e === 'number') ? e : 10;
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
  const temImg = !!item.imagem_url;
  // Com foto: usa a imagem real. Sem foto: fallback elegante da marca
  // (creme + wordmark serif), NUNCA um bloco bege vazio.
  const imgStyle = temImg
    ? `background:url('${escHtml(item.imagem_url)}') center/cover no-repeat`
    : '';
  const imgInner = temImg ? '' : '<span class="cart-item__ph-mark">Virtù</span>';

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
  const cap        = _capDoItem(item);
  const maxAttr    = cap > 0 ? cap : 1;
  const atMax      = qty >= maxAttr;

  return `
    <div class="cart-item" data-index="${index}" data-price="${preco}">
      <a class="cart-item__image" href="produto.html?id=${escHtml(item.id)}" aria-label="${escHtml(item.nome)}">
        <div class="cart-item__img-placeholder${temImg ? '' : ' cart-item__img-placeholder--empty'}" style="${imgStyle}">${imgInner}</div>
      </a>
      <div class="cart-item__info">
        <a href="produto.html?id=${escHtml(item.id)}" class="cart-item__name">${escHtml(item.nome)}</a>
        <p class="cart-item__meta">${meta}</p>
        <p class="cart-item__price-mobile">${formatCurrency(preco)}</p>
      </div>
      <div class="cart-item__price">${formatCurrency(preco)}</div>
      <div class="cart-item__qty">
        <button class="qty-btn qty-btn--minus" aria-label="Diminuir quantidade">−</button>
        <input class="qty-input" type="number" value="${qty}" min="1" max="${maxAttr}" aria-label="Quantidade" />
        <button class="qty-btn qty-btn--plus" aria-label="Aumentar quantidade"${atMax ? ' disabled' : ''}>+</button>
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
      const items = getCart();
      const cap = Math.max(1, _capDoItem(items[index] || {}));
      let v = parseInt(input.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > cap) {
        v = cap;
        _toastCarrinho(`Só temos ${cap} unidade${cap > 1 ? 's' : ''} deste tamanho.`);
      }
      input.value = v;
      setQty(index, v);
    });
    removeBtn?.addEventListener('click', () => removeItem(itemEl, index));
  });
}

function changeQty(index, delta) {
  const items = getCart();
  if (!items[index]) return;
  const cap = Math.max(1, _capDoItem(items[index]));
  const alvo = (items[index].qty || 1) + delta;
  if (delta > 0 && alvo > cap) {
    _toastCarrinho(`Só temos ${cap} unidade${cap > 1 ? 's' : ''} deste tamanho.`);
  }
  items[index].qty = Math.min(cap, Math.max(1, alvo));
  saveCart(items);
  renderCartItems();
}

function setQty(index, qty) {
  const items = getCart();
  if (!items[index]) return;
  const cap = Math.max(1, _capDoItem(items[index]));
  items[index].qty = Math.min(cap, Math.max(1, qty));
  saveCart(items);
  renderCartItems();
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

/* ── SINCRONIZAÇÃO DE ESTOQUE DO CARRINHO (autoridade: Supabase) ──
   Busca o estoque REAL de cada variação (por produto + tamanho + cor,
   cobrindo também itens sem variacao_id), auto-ajusta quantidades que
   passaram do disponível, mostra badges e bloqueia o checkout quando
   algum item está esgotado ou acima do estoque.                      */
async function _verificarEstoqueBaixoNoCarrinho(items) {
  if (typeof supabaseClient === 'undefined' || !items.length) return;

  const produtoIds = [...new Set(items.map(i => i.id || i.produto_id).filter(Boolean))];
  if (!produtoIds.length) return;

  let data;
  try {
    const res = await supabaseClient
      .from('variacoes')
      .select('id, produto_id, tamanho, cor_nome, estoque, ativo')
      .in('produto_id', produtoIds);
    data = res.data;
  } catch { return; /* silencioso — não prejudica o carrinho */ }
  if (!data) return;

  // Resolve o estoque de cada item (exato por variacao_id; senão por
  // produto + tamanho + cor, com fallback para produto sem tamanho/cor).
  const novoMap = {};
  items.forEach(item => {
    const pid = item.id || item.produto_id;
    const tam = item.tamanho || '';
    const cor = item.cor_nome || '';
    const variacoesDoProduto = data.filter(v => v.produto_id === pid);

    let row = null;
    if (item.variacao_id) row = variacoesDoProduto.find(v => v.id === item.variacao_id);
    if (!row) {
      row = variacoesDoProduto.find(v => v.ativo !== false
        && (String(v.tamanho || '') === tam || !tam)
        && (String(v.cor_nome || '') === cor || !cor));
    }

    if (row) {
      novoMap[_itemKey(item)] = Number(row.estoque) || 0;
    } else if (variacoesDoProduto.length) {
      // produto tem variações, mas a combinação pedida não existe/está inativa
      novoMap[_itemKey(item)] = 0;
    }
    // produto sem variações no banco → desconhecido (não bloqueia; backend decide)
  });
  _estoqueMap = novoMap;

  // Auto-ajuste: reduz quantidade que passou do estoque real.
  let mudou = false;
  const atuais = getCart();
  atuais.forEach(item => {
    const e = _estoqueMap[_itemKey(item)];
    if (typeof e === 'number' && e > 0 && (item.qty || 1) > e) {
      item.qty = e;
      mudou = true;
    }
  });
  if (mudou) {
    saveCart(atuais);
    _toastCarrinho('Ajustamos a quantidade ao estoque disponível.');
    renderCartItems(); // re-render corrige valores; nova sync converge sem mudar nada
    return;
  }

  _aplicarEstadoEstoqueUI(getCart());
}

/* Aplica badges por item + limites do seletor + estado do botão de checkout. */
function _aplicarEstadoEstoqueUI(items) {
  let bloquear = false;

  items.forEach((item, idx) => {
    const itemEl = document.querySelector(`.cart-item[data-index="${idx}"]`);
    if (!itemEl) return;
    itemEl.querySelector('.cart-item__stock-badge')?.remove();

    const e = _estoqueMap[_itemKey(item)];
    const info  = itemEl.querySelector('.cart-item__info');
    const input = itemEl.querySelector('.qty-input');
    const plus  = itemEl.querySelector('.qty-btn--plus');
    if (typeof e !== 'number') return; // desconhecido → não interfere

    // Atualiza limites do seletor conforme o estoque real.
    if (input) input.max = e > 0 ? e : 1;
    if (plus)  plus.disabled = (item.qty || 1) >= e;

    if (e === 0) {
      bloquear = true;
      itemEl.classList.add('cart-item--indisponivel');
      const b = document.createElement('p');
      b.className = 'cart-item__stock-badge cart-item__stock-badge--esgotado';
      b.textContent = 'Esgotado — remova para continuar';
      info?.appendChild(b);
    } else if ((item.qty || 1) > e) {
      bloquear = true;
      const b = document.createElement('p');
      b.className = 'cart-item__stock-badge cart-item__stock-badge--esgotado';
      b.textContent = `Só há ${e} em estoque — ajuste a quantidade`;
      info?.appendChild(b);
    } else if (e <= 3) {
      const b = document.createElement('p');
      b.className = 'cart-item__stock-badge cart-item__stock-badge--urgente';
      b.textContent = `Últimas ${e} unidade${e > 1 ? 's' : ''}!`;
      info?.appendChild(b);
    }
  });

  _setCheckoutBloqueado(bloquear);
}

/* Habilita/bloqueia o botão "Finalizar Compra" conforme o estoque. */
function _setCheckoutBloqueado(bloquear) {
  const btn = document.getElementById('checkoutBtn');
  if (!btn) return;
  btn.dataset.bloqueado = bloquear ? '1' : '0';
  btn.classList.toggle('is-disabled', bloquear);
  btn.setAttribute('aria-disabled', bloquear ? 'true' : 'false');

  let aviso = document.getElementById('checkoutEstoqueAviso');
  if (bloquear) {
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.id = 'checkoutEstoqueAviso';
      aviso.className = 'cart-item__stock-badge cart-item__stock-badge--esgotado';
      aviso.style.cssText = 'margin-top:10px;text-align:center';
      aviso.textContent = 'Ajuste os itens sem estoque para finalizar a compra.';
      btn.insertAdjacentElement('afterend', aviso);
    }
  } else if (aviso) {
    aviso.remove();
  }
}

/* ── RESUMO DO PEDIDO ──────────────────────────────────────── */
function updateSummary() {
  const items       = getCart();
  const subtotal    = items.reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);
  const giftExtra   = giftWrap ? giftWrapPrice : 0;

  // Recalcula desconto com base no subtotal atual (corrige bug ao remover itens)
  if (appliedCoupon && appliedPct > 0) {
    discount = Math.round(subtotal * appliedPct / 100);
  } else if (appliedCoupon && appliedValorFixo > 0) {
    discount = Math.min(appliedValorFixo, subtotal);
  }

  // Frete grátis ≥799 é sobre o subtotal dos PRODUTOS (sem embalagem presente),
  // igual ao calcular-frete/processar-pagamento.
  const isFree      = subtotal >= freeShippingThreshold;
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
  // Prévia do parcelado no cartão: o preço de tabela JÁ é o de cartão (sem
  // acréscimo), ÷12. Indicativo (sem frete — o frete é calculado no checkout).
  const cardTotalCart = total;
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
  const pct  = Math.min(100, (subtotal / freeShippingThreshold) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (text) {
    if (isFree && subtotal > 0) {
      text.textContent = 'Frete grátis em todo o Brasil';
      text.style.color = '#2e7d32';
    } else if (subtotal > 0) {
      const remaining = freeShippingThreshold - subtotal;
      text.textContent = `Falta ${formatCurrency(remaining)} para frete grátis em todo o Brasil`;
      text.style.color = '';
    } else {
      text.textContent = '';
    }
  }
}

/* ── QUICK-ADD MODAL (sugestões: tamanho + cor + qtd sem sair) ─ */
function _fecharQa() {
  const m = document.getElementById('qaModal');
  if (m) { m.hidden = true; document.body.style.overflow = ''; }
}
function _qaError(msg) {
  const e = document.getElementById('qaError');
  if (!e) return;
  if (msg) { e.textContent = msg; e.hidden = false; } else { e.hidden = true; }
}
function _toastCarrinho(texto) {
  const t = document.createElement('div');
  t.textContent = texto;
  t.setAttribute('role', 'status');
  t.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);' +
    'background:var(--color-navy);color:var(--color-off-white);padding:12px 22px;border-radius:999px;' +
    'font-family:var(--font-body);font-size:0.85rem;box-shadow:0 8px 24px rgba(0,0,0,.14);z-index:1300;' +
    'opacity:0;max-width:90vw;text-align:center;transition:opacity .25s ease, transform .25s ease;';
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(8px)'; setTimeout(() => t.remove(), 300); }, 2600);
}
function _garantirQaModal() {
  let modal = document.getElementById('qaModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'qa-modal';
  modal.id = 'qaModal';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="qa-modal__overlay" data-qa-close></div>' +
    '<div class="qa-modal__panel" role="dialog" aria-modal="true" aria-labelledby="qaName">' +
      '<button class="qa-modal__close" data-qa-close aria-label="Fechar">&times;</button>' +
      '<div class="qa-modal__head"><div class="qa-modal__img" id="qaImg"></div>' +
        '<div><p class="qa-modal__name" id="qaName"></p><p class="qa-modal__price" id="qaPrice"></p></div></div>' +
      '<div class="qa-modal__field" id="qaSizesField"><span class="qa-modal__label">Tamanho</span>' +
        '<div class="qa-modal__chips" id="qaSizes"></div></div>' +
      '<div class="qa-modal__field" id="qaColorsField" hidden><span class="qa-modal__label">Cor</span>' +
        '<div class="qa-modal__chips" id="qaColors"></div></div>' +
      '<div class="qa-modal__field"><span class="qa-modal__label">Quantidade</span>' +
        '<div class="qa-modal__qty"><button type="button" id="qaMinus" aria-label="Diminuir">&minus;</button>' +
        '<span id="qaQty">1</span><button type="button" id="qaPlus" aria-label="Aumentar">+</button></div></div>' +
      '<p class="qa-modal__error" id="qaError" hidden></p>' +
      '<button class="btn btn--primary qa-modal__add" id="qaAdd">Adicionar ao carrinho</button>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-qa-close]').forEach(el => el.addEventListener('click', _fecharQa));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _fecharQa(); });
  return modal;
}
function abrirQuickAdd(product) {
  const modal = _garantirQaModal();
  const preco = product.preco_desconto ?? product.preco_original;
  const sizes = product.tamanhos || [];
  const cores = product.cores || [];
  const state = { size: sizes.length ? null : '', cor: cores.length > 1 ? null : (cores[0] || null), qty: 1 };

  const imgEl = modal.querySelector('#qaImg');
  imgEl.style.background = product.imagem_url
    ? `url('${product.imagem_url}') center/cover no-repeat`
    : 'var(--color-off-white)';
  modal.querySelector('#qaName').textContent  = product.nome || 'Produto';
  modal.querySelector('#qaPrice').textContent = formatCurrency(preco);

  // Tamanhos
  const sizesWrap = modal.querySelector('#qaSizes');
  sizesWrap.innerHTML = '';
  modal.querySelector('#qaSizesField').hidden = sizes.length === 0;
  sizes.forEach(t => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'qa-chip'; chip.textContent = t;
    chip.addEventListener('click', () => {
      sizesWrap.querySelectorAll('.qa-chip').forEach(c => c.classList.remove('qa-chip--active'));
      chip.classList.add('qa-chip--active'); state.size = t; _qaError(null);
    });
    sizesWrap.appendChild(chip);
  });

  // Cores (só se houver mais de uma; cor única é automática)
  const coresWrap = modal.querySelector('#qaColors');
  coresWrap.innerHTML = '';
  modal.querySelector('#qaColorsField').hidden = cores.length <= 1;
  if (cores.length > 1) {
    cores.forEach(c => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'qa-chip qa-chip--color';
      chip.innerHTML = `<span class="qa-chip__swatch" style="background:${escHtml(c.hex || '#ccc')}"></span>${escHtml(c.nome || '')}`;
      chip.addEventListener('click', () => {
        coresWrap.querySelectorAll('.qa-chip').forEach(x => x.classList.remove('qa-chip--active'));
        chip.classList.add('qa-chip--active'); state.cor = c; _qaError(null);
      });
      coresWrap.appendChild(chip);
    });
  }

  // Quantidade
  const qtyEl = modal.querySelector('#qaQty'); qtyEl.textContent = '1'; state.qty = 1;
  modal.querySelector('#qaMinus').onclick = () => { state.qty = Math.max(1, state.qty - 1); qtyEl.textContent = state.qty; };
  modal.querySelector('#qaPlus').onclick  = () => { state.qty = Math.min(10, state.qty + 1); qtyEl.textContent = state.qty; };

  // Adicionar
  modal.querySelector('#qaAdd').onclick = () => {
    if (sizes.length && !state.size)     { _qaError('Selecione um tamanho.'); return; }
    if (cores.length > 1 && !state.cor)  { _qaError('Selecione uma cor.');    return; }
    const cor = state.cor || {};
    for (let i = 0; i < state.qty; i++) {
      VirtuCart.add(product, state.size || '', cor.nome || '', cor.hex || '', null);
    }
    _fecharQa();
    renderCartItems();
    updateCartBadge();
    _toastCarrinho('Adicionado ao carrinho ✓');
  };

  _qaError(null);
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
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

    const _sugMap = {};
    shuffled.forEach(p => { _sugMap[p.id] = p; });

    grid.querySelectorAll('.product-card__quick-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const prodId = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
        const prod = _sugMap[prodId];
        if (prod) { abrirQuickAdd(prod); return; }               // seleção inline (tamanho/qtd)
        if (prodId) window.location.href = `produto.html?id=${prodId}`; // fallback
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
      // Bloqueio por estoque: algum item esgotado ou acima do disponível.
      if (checkoutBtn.dataset.bloqueado === '1') {
        _toastCarrinho('Ajuste os itens sem estoque antes de finalizar.');
        document.getElementById('checkoutEstoqueAviso')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
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
