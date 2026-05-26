/* ============================================================
   VIRTÙ — Produto JavaScript
   ============================================================ */

/* ── CARREGAR PRODUTO DO SUPABASE ──────────── */
async function carregarProduto(produtoId) {
  try {
    const { data: p, error } = await supabaseClient
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (error || !p) {
      window.location.href = 'catalogo.html';
      return null;
    }

    const fmt = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    const preco = p.preco_desconto ?? p.preco_original;

    // Título e meta
    document.title = `${p.nome} — Virtù`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = p.descricao || `${p.nome} — Virtù`;

    // Breadcrumb
    const bcLinks = document.querySelectorAll('.breadcrumb__link');
    if (bcLinks[1]) {
      bcLinks[1].textContent = cap(p.categoria || 'Produtos');
      bcLinks[1].href = `catalogo.html?categoria=${p.categoria || ''}`;
    }
    const bcAtual = document.querySelector('.breadcrumb__current');
    if (bcAtual) bcAtual.textContent = p.nome.toUpperCase();

    // Categoria (overline)
    const catEl = document.querySelector('[data-produto-categoria]');
    if (catEl) {
      catEl.textContent = cap(p.categoria || '') + (p.nova_colecao ? ' · Nova Coleção' : '');
    }

    // Nome H1
    const nomeEl = document.querySelector('[data-produto-nome]');
    if (nomeEl) nomeEl.textContent = p.nome;

    // Preço atual
    const precoEl = document.querySelector('[data-preco]');
    if (precoEl) {
      precoEl.setAttribute('data-preco', preco);
      precoEl.textContent = fmt(preco);
    }

    // Preço original riscado
    const precoOrigEl = document.querySelector('.produto-preco-original');
    if (p.preco_desconto && p.preco_original) {
      if (precoOrigEl) {
        precoOrigEl.textContent = fmt(p.preco_original);
        precoOrigEl.style.display = '';
      }
    } else if (precoOrigEl) {
      precoOrigEl.style.display = 'none';
    }

    // Parcelamento
    const parcela = preco / 6;
    const parcelaEl = document.querySelector('.produto-parcelamento');
    if (parcelaEl) parcelaEl.textContent = `ou 6x de ${fmt(parcela)} sem juros`;

    // Cores
    const coresContainer = document.getElementById('coresContainer');
    const selectedColorEl = document.getElementById('selectedColor');
    if (coresContainer && p.cores && p.cores.length > 0) {
      coresContainer.innerHTML = p.cores.map((c, i) =>
        `<button class="produto-cor${i === 0 ? ' produto-cor--active' : ''}"
                 data-cor="${c.nome}"
                 style="background:${c.hex}${c.nome === 'Off-White' || c.nome === 'Off white' ? ';border:1px solid #ddd' : ''}"
                 aria-label="${c.nome}"
                 aria-pressed="${i === 0 ? 'true' : 'false'}"></button>`
      ).join('');
      if (selectedColorEl) selectedColorEl.textContent = p.cores[0].nome;
    }

    // Descrição
    const descEl = document.getElementById('acc-desc');
    if (descEl && p.descricao) {
      descEl.innerHTML = `<p>${p.descricao.replace(/\n/g, '</p><p style="margin-top:var(--space-3);">')}</p>`;
    }

    // Composição
    const compEl = document.getElementById('acc-composicao');
    if (compEl && p.composicao) {
      compEl.innerHTML = `<p>${p.composicao.replace(/\n/g, '<br/>')}</p>`;
    }

    // Imagem principal
    if (p.imagem_url) {
      const mainPlaceholder = document.getElementById('mainPlaceholder');
      if (mainPlaceholder) {
        mainPlaceholder.style.background = `url('${p.imagem_url}') center/cover no-repeat`;
        const label = mainPlaceholder.querySelector('.galeria-main__placeholder-label');
        if (label) label.style.display = 'none';
      }
    }

    return p;
  } catch (err) {
    console.error('[Produto] Erro ao carregar produto:', err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  // ── CARREGAR DADOS DO PRODUTO ───────────────
  const _urlId = new URLSearchParams(window.location.search).get('id');
  if (_urlId && typeof supabaseClient !== 'undefined') {
    await carregarProduto(_urlId);
  }

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
  const searchToggleDesktop = document.getElementById('searchToggleDesktop');
  const searchClose         = document.getElementById('searchClose');

  const openSearch  = () => { searchOverlay?.classList.add('open'); searchOverlay?.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100); };
  const closeSearch = () => { searchOverlay?.classList.remove('open'); searchOverlay?.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; };

  searchToggle?.addEventListener('click', openSearch);
  searchToggleDesktop?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeSearch(); closeGuia(); }
  });

  // ── GALERIA ────────────────────────────────
  const thumbs     = document.querySelectorAll('.gallery-thumb');
  const mainImage  = document.getElementById('mainImage');
  const prevBtn    = document.getElementById('galleryPrev');
  const nextBtn    = document.getElementById('galleryNext');
  let currentThumb = 0;

  // Paleta de cores de placeholder para simular imagens diferentes
  const placeholderColors = [
    '#D4C4B5', '#B8A99A', '#C9B8A8', '#E2D5C8', '#A89888'
  ];

  function setActiveThumb(index) {
    thumbs.forEach(t => t.classList.remove('gallery-thumb--active'));
    if (thumbs[index]) {
      thumbs[index].classList.add('gallery-thumb--active');
      // Atualiza imagem principal
      const bg = thumbs[index].style.background || `linear-gradient(135deg, ${placeholderColors[index % placeholderColors.length]} 0%, #8B7D6B 100%)`;
      if (mainImage) {
        mainImage.style.transition = 'opacity 0.3s ease';
        mainImage.style.opacity = '0';
        setTimeout(() => {
          mainImage.style.background = thumbs[index].style.background || `linear-gradient(135deg, ${placeholderColors[index % placeholderColors.length]} 0%, #8B7D6B 100%)`;
          mainImage.style.opacity = '1';
        }, 150);
      }
    }
    currentThumb = index;
  }

  thumbs.forEach((thumb, i) => {
    thumb.addEventListener('click', () => setActiveThumb(i));
    thumb.setAttribute('tabindex', '0');
    thumb.setAttribute('role', 'button');
    thumb.setAttribute('aria-label', `Ver imagem ${i + 1}`);
    thumb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveThumb(i); } });
  });

  // Setas mobile
  prevBtn?.addEventListener('click', () => {
    const prev = (currentThumb - 1 + thumbs.length) % thumbs.length;
    setActiveThumb(prev);
  });
  nextBtn?.addEventListener('click', () => {
    const next = (currentThumb + 1) % thumbs.length;
    setActiveThumb(next);
  });

  // Swipe no mobile
  if (mainImage) {
    let touchStartX = 0;
    mainImage.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    mainImage.addEventListener('touchend', e => {
      const delta = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(delta) > 50) {
        if (delta < 0) nextBtn?.click();
        else prevBtn?.click();
      }
    }, { passive: true });
  }

  // ── SELETOR DE CORES ───────────────────────
  const colorBtns    = document.querySelectorAll('.produto-cor');
  const selectedColorLabel = document.getElementById('selectedColor');

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('produto-cor--active'));
      btn.classList.add('produto-cor--active');
      if (selectedColorLabel) {
        selectedColorLabel.textContent = btn.getAttribute('aria-label') || btn.getAttribute('title') || 'Selecionada';
      }
    });
  });

  // ── SELETOR DE TAMANHOS ────────────────────
  const sizeBtns       = document.querySelectorAll('.produto-tamanho');
  const selectedSizeEl = document.getElementById('selectedSize');
  const sizeAlert      = document.getElementById('sizeAlert');
  let selectedSize     = null;

  sizeBtns.forEach(btn => {
    if (btn.classList.contains('produto-tamanho--esgotado')) return; // não clicável

    btn.addEventListener('click', () => {
      sizeBtns.forEach(b => b.classList.remove('produto-tamanho--selected'));
      btn.classList.add('produto-tamanho--selected');
      selectedSize = btn.textContent.trim();

      if (selectedSizeEl) selectedSizeEl.textContent = selectedSize;
      if (sizeAlert) sizeAlert.hidden = true;

      // Feedback de estoque
      const stock = btn.getAttribute('data-stock');
      showStockMessage(stock);
    });
  });

  function showStockMessage(stock) {
    let stockMsg = document.getElementById('stockMsg');
    if (!stockMsg) {
      stockMsg = document.createElement('p');
      stockMsg.id = 'stockMsg';
      stockMsg.style.cssText = 'font-size:0.8rem;margin-top:0.25rem;transition:opacity 0.3s';
      document.querySelector('.produto-tamanhos')?.after(stockMsg);
    }
    if (!stock || stock === 'normal') {
      stockMsg.textContent = '';
      return;
    }
    if (stock === 'low') {
      stockMsg.style.color = '#C4934A';
      stockMsg.textContent = '⚡ Últimas unidades disponíveis!';
    }
  }

  // ── ADD TO CART ────────────────────────────
  let cartCount = 0;
  const cartBadge    = document.getElementById('cartBadge');
  const addToCartBtn = document.getElementById('addToCartBtn');
  const buyNowBtn    = document.getElementById('buyNowBtn');
  const stickyAddBtn = document.getElementById('stickyAddBtn');

  function validateAndAdd(redirect = false) {
    if (!selectedSize) {
      if (sizeAlert) {
        sizeAlert.hidden = false;
        sizeAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        sizeAlert.animate([
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' }
        ], { duration: 400, easing: 'ease' });
      }
      return false;
    }

    // Incrementa badge
    cartCount++;
    if (cartBadge) cartBadge.textContent = cartCount;

    if (redirect) {
      window.location.href = 'carrinho.html';
      return true;
    }

    // Feedback visual no botão
    const btn = addToCartBtn;
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Adicionado ao carrinho';
      btn.style.background = 'var(--color-navy)';
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
    }

    return true;
  }

  addToCartBtn?.addEventListener('click', () => validateAndAdd(false));
  buyNowBtn?.addEventListener('click', () => validateAndAdd(true));
  stickyAddBtn?.addEventListener('click', () => validateAndAdd(true));

  // ── WISHLIST ───────────────────────────────
  const wishlistBtn = document.getElementById('wishlistBtn');
  wishlistBtn?.addEventListener('click', () => {
    wishlistBtn.classList.toggle('active');
    const isActive = wishlistBtn.classList.contains('active');
    wishlistBtn.setAttribute('aria-label', isActive ? 'Remover da lista de desejos' : 'Adicionar à lista de desejos');
    wishlistBtn.innerHTML = isActive ? '♥' : '♡';

    // Mini feedback
    wishlistBtn.animate([
      { transform: 'scale(1.3)' },
      { transform: 'scale(1)' }
    ], { duration: 300, easing: 'ease-out' });
  });

  // ── ACCORDION ──────────────────────────────
  document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const targetId = trigger.getAttribute('aria-controls');
      const content  = document.getElementById(targetId);
      const isOpen   = trigger.getAttribute('aria-expanded') === 'true';

      // Fecha todos os outros
      document.querySelectorAll('.accordion-trigger').forEach(t => {
        const tid = t.getAttribute('aria-controls');
        const tc  = document.getElementById(tid);
        t.setAttribute('aria-expanded', 'false');
        tc?.classList.add('accordion-content--hidden');
      });

      // Abre o clicado se estava fechado
      if (!isOpen) {
        trigger.setAttribute('aria-expanded', 'true');
        content?.classList.remove('accordion-content--hidden');
        // Scroll suave para visibilidade
        setTimeout(() => content?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
      }
    });
  });

  // ── GUIA DE TAMANHOS (MODAL) ───────────────
  const guiaModal = document.getElementById('guiaModal');
  const openGuia  = () => {
    guiaModal?.classList.add('open');
    guiaModal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('guiaClose')?.focus();
  };
  const closeGuia = () => {
    guiaModal?.classList.remove('open');
    guiaModal?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  document.getElementById('openGuia')?.addEventListener('click', openGuia);
  document.getElementById('guiaClose')?.addEventListener('click', closeGuia);
  guiaModal?.addEventListener('click', e => { if (e.target === guiaModal) closeGuia(); });

  // ── STICKY BUY BAR ─────────────────────────
  const stickyBar     = document.querySelector('.sticky-buy-bar');
  const productActions = document.querySelector('.produto-actions');

  if (stickyBar && productActions) {
    const stickyObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        stickyBar.classList.toggle('visible', !e.isIntersecting);
      });
    }, { threshold: 0 });
    stickyObs.observe(productActions);
  }

  // ── COMPRE JUNTO ───────────────────────────
  let bundleCount = 0;
  const bundleTotal = document.getElementById('bundleTotal');
  const bundlePrices = [420, 185, 195]; // preços dos itens do bundle
  const bundleBase   = bundlePrices.reduce((a, b) => a + b, 0);

  document.querySelectorAll('.bundle-check').forEach((cb, i) => {
    cb.addEventListener('change', () => {
      const total = bundlePrices.reduce((acc, price, idx) => {
        const checkbox = document.querySelectorAll('.bundle-check')[idx];
        return checkbox?.checked ? acc + price : acc;
      }, 0);
      if (bundleTotal) bundleTotal.textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    });
  });

  document.getElementById('bundleAddBtn')?.addEventListener('click', () => {
    const selected = [...document.querySelectorAll('.bundle-check')].filter(cb => cb.checked).length;
    if (selected === 0) return;
    cartCount += selected;
    if (cartBadge) cartBadge.textContent = cartCount;

    const btn = document.getElementById('bundleAddBtn');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `✓ ${selected} ${selected === 1 ? 'peça adicionada' : 'peças adicionadas'}!`;
      btn.disabled = true;
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
    }
  });

  // ── QUICK ADD (PEÇAS RELACIONADAS) ─────────
  document.querySelectorAll('.product-card__quick-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Adicionado!';
      btn.style.cssText = 'background:var(--color-navy);color:white;';
      cartCount++;
      if (cartBadge) cartBadge.textContent = cartCount;
      setTimeout(() => { btn.innerHTML = orig; btn.style.cssText = ''; }, 1400);
    });
  });

  document.querySelectorAll('.product-card__wishlist').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      btn.classList.toggle('active');
    });
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

  // ── INICIALIZAÇÃO ──────────────────────────
  // Seleciona primeira miniatura
  if (thumbs.length > 0) setActiveThumb(0);

  // Seleciona primeira cor ativa
  const firstColor = document.querySelector('.produto-cor');
  if (firstColor) firstColor.click();

  // ── VIRTU STOCK — Integração com Supabase ──
  if (_urlId && typeof VirtuStock !== 'undefined') {
    VirtuStock.init(_urlId, (resultado, variacao) => {
      const btnComprar = document.getElementById('btnComprar');
      if (btnComprar) {
        btnComprar.textContent = '✓ Adicionado! A ir para o carrinho…';
        btnComprar.style.background = 'var(--color-navy)';
      }
      setTimeout(() => { window.location.href = 'carrinho.html'; }, 1200);
    }).catch(err => {
      console.warn('[Produto] Erro ao inicializar stock:', err);
    });
  }

});
