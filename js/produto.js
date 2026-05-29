/* ============================================================
   VIRTÙ — Produto JavaScript
   ============================================================ */

/* ── CONVERTE URL DO GOOGLE DRIVE ──────────── */
function convertDriveUrl(url) {
  if (!url) return url;
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2 && url.includes('drive.google.com')) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  const m4 = url.match(/uc\?export=view&id=([^&]+)/);
  if (m4) return `https://lh3.googleusercontent.com/d/${m4[1]}`;
  return url;
}

/* ── RENDERIZAR CORES (módulo — acessível por VirtuStock.init) ── */
function _renderCores(lista) {
  const coresContainer = document.getElementById('coresContainer');
  const selectedColorEl = document.getElementById('selectedColor');
  if (!coresContainer || !lista || !lista.length) return;
  coresContainer.innerHTML = lista.map((c, i) => {
    const isLight = /off.?wh|branco|white|creme|marfim/i.test(c.nome);
    return `<button class="produto-cor${i === 0 ? ' produto-cor--active' : ''}"
             data-cor="${c.nome}"
             style="background:${c.hex}${isLight ? ';border:1px solid #ddd' : ''}"
             aria-label="${c.nome}"
             aria-pressed="${i === 0 ? 'true' : 'false'}"></button>`;
  }).join('');
  if (selectedColorEl) selectedColorEl.textContent = lista[0].nome;
}

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
    const parcela = preco / 12;
    const parcelaEl = document.querySelector('.produto-parcelamento');
    if (parcelaEl) parcelaEl.textContent = `ou 12x de ${fmt(parcela)} sem juros`;

    // Cores — renderiza p.cores imediatamente como base.
    // VirtuStock sobrescreve depois se houver variações configuradas.
    if (p.cores && p.cores.length > 0) {
      _renderCores(p.cores);
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

    // Sticky bar — nome e preço
    const stickyName  = document.querySelector('.sticky-buy-bar__name');
    const stickyPrice = document.querySelector('.sticky-buy-bar__price');
    if (stickyName)  stickyName.textContent  = p.nome;
    if (stickyPrice) stickyPrice.textContent = fmt(preco);

    // Galeria de imagens — monta thumbnails dinamicamente
    const imagens = (Array.isArray(p.imagens) && p.imagens.length
      ? p.imagens
      : (p.imagem_url ? [p.imagem_url] : [])
    ).map(convertDriveUrl);

    if (imagens.length) {
      const thumbsContainer = document.querySelector('.galeria-thumbs');
      const mainImg         = document.getElementById('mainImg');

      // ── Função local que troca a imagem principal ──
      // Pré-carrega a imagem antes de exibir, evitando flash do conteúdo anterior
      function _showImage(url) {
        if (!mainImg) return;
        // Fade out
        mainImg.style.transition = 'opacity 0.15s ease';
        mainImg.style.opacity    = '0';
        // Pré-carrega
        const preload = new Image();
        preload.onload = () => {
          const existing = mainImg.querySelector('img.galeria-main__real-img');
          if (existing) {
            existing.src = url;
          } else {
            mainImg.innerHTML = `<img class="galeria-main__real-img"
              src="${url}" alt="Foto do produto" />`;
          }
          // Só revela quando a imagem está pronta
          mainImg.style.opacity = '1';
        };
        preload.onerror = () => {
          // Mesmo com erro, restaura opacidade
          mainImg.style.opacity = '1';
        };
        preload.src = url;
      }

      // Exibe a primeira imagem
      _showImage(imagens[0]);

      // Re-renderiza thumbnails
      if (thumbsContainer) {
        thumbsContainer.innerHTML = imagens.map((url, i) => `
          <button class="galeria-thumb${i === 0 ? ' galeria-thumb--active' : ''}"
                  data-index="${i}" data-url="${url}"
                  style="background:url('${url}') center/cover no-repeat;background-size:cover;"
                  role="listitem" aria-label="Foto ${i + 1}" aria-pressed="${i === 0}">
          </button>
        `).join('');

        // Bind clique direto em cada thumb (simples e confiável)
        thumbsContainer.querySelectorAll('.galeria-thumb').forEach(btn => {
          btn.addEventListener('click', () => {
            thumbsContainer.querySelectorAll('.galeria-thumb').forEach(b => {
              b.classList.remove('galeria-thumb--active');
              b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('galeria-thumb--active');
            btn.setAttribute('aria-pressed', 'true');
            _showImage(btn.dataset.url);
          });
        });
      }
    }

    // Compre Junto — carrega peças reais do Supabase
    const secCompreJunto = document.querySelector('.compre-junto');
    if (secCompreJunto) {
      const ids = p.compre_junto;
      if (Array.isArray(ids) && ids.length > 0) {
        await renderCompreJunto(p, ids);
      } else {
        secCompreJunto.style.display = 'none'; // sem sugestões → oculta a secção
      }
    }

    // Peças Relacionadas — carrega automaticamente da mesma categoria
    await renderPecasRelacionadas(produtoId, p.categoria);

    // Revela o layout com fade-in (elimina flash do conteúdo hardcoded)
    const layout = document.getElementById('produtoLayout');
    if (layout) requestAnimationFrame(() => { layout.style.opacity = '1'; });

    return p;
  } catch (err) {
    console.error('[Produto] Erro ao carregar produto:', err);
    return null;
  }
}

/* ── PEÇAS RELACIONADAS — renderização dinâmica ── */
async function renderPecasRelacionadas(currentId, categoria) {
  try {
    const secao  = document.querySelector('.voce-gosta');
    const grid   = secao?.querySelector('.destaques__grid');
    if (!secao || !grid) return;

    const fmt = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const heartSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

    // 1) Busca até 4 da mesma categoria, excluindo o atual
    let { data: rel } = await supabaseClient
      .from('produtos')
      .select('id, nome, categoria, preco_original, preco_desconto, imagem_url, imagem_placeholder, nova_colecao, destaque')
      .eq('ativo', true)
      .eq('categoria', categoria)
      .neq('id', currentId)
      .limit(4);

    rel = rel || [];

    // 2) Se menos de 4, completa com outros produtos
    if (rel.length < 4) {
      const excludeIds = [currentId, ...rel.map(p => p.id)];
      const { data: extra } = await supabaseClient
        .from('produtos')
        .select('id, nome, categoria, preco_original, preco_desconto, imagem_url, imagem_placeholder, nova_colecao, destaque')
        .eq('ativo', true)
        .not('id', 'in', `(${excludeIds.map(i => `"${i}"`).join(',')})`)
        .limit(4 - rel.length);
      if (extra) rel = [...rel, ...extra];
    }

    if (rel.length === 0) { secao.style.display = 'none'; return; }

    const cardHTML = p => {
      const preco  = p.preco_desconto ?? p.preco_original;
      const bg     = p.imagem_url
        ? `url('${p.imagem_url}') center/cover no-repeat`
        : (p.imagem_placeholder || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)');
      const badge  = p.nova_colecao
        ? `<span class="product-card__badge">Novo</span>`
        : p.destaque
          ? `<span class="product-card__badge">Mais Vendido</span>`
          : '';
      const cat = p.categoria ? p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1) : '';
      const label = p.imagem_url ? '' : `<span style="font-family:var(--font-display);font-size:12px;color:rgba(0,0,0,0.2);letter-spacing:2px;text-transform:uppercase;">foto</span>`;
      return `
        <article class="product-card">
          <div class="product-card__image-wrap">
            <div class="product-card__placeholder" style="background:${bg};width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${label}</div>
            ${badge}
            <button class="product-card__wishlist" aria-label="Favoritar">${heartSVG}</button>
            <div class="product-card__quick-add"><button class="product-card__quick-btn">+ Adicionar ao carrinho</button></div>
          </div>
          <div class="product-card__info">
            <p class="product-card__category">${cat}</p>
            <h3 class="product-card__name"><a href="produto.html?id=${p.id}">${p.nome}</a></h3>
            <div class="product-card__price"><span class="product-card__price-current">${fmt(preco)}</span></div>
          </div>
        </article>`;
    };

    grid.innerHTML = rel.map(cardHTML).join('');

    // Handlers dinâmicos — wishlist e quick-add
    grid.querySelectorAll('.product-card__wishlist').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        btn.classList.toggle('active');
      });
    });
    grid.querySelectorAll('.product-card__quick-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        // Salva no localStorage
        const card = btn.closest('[data-id]') || btn.closest('.product-card');
        const prodId    = card?.dataset?.id || '';
        const prodNome  = card?.querySelector('.product-card__name')?.textContent?.trim() || 'Produto';
        const prodPreco = parseFloat(card?.querySelector('.product-card__price')?.textContent?.replace(/\D/g, '').replace(',', '.') || '0') / 100;
        const CART_KEY = 'virtu_cart';
        try {
          const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
          const idx = cart.findIndex(i => i.id === prodId);
          if (idx >= 0) { cart[idx].qty = (cart[idx].qty || 1) + 1; }
          else { cart.push({ id: prodId, nome: prodNome, preco: prodPreco, qty: 1 }); }
          localStorage.setItem(CART_KEY, JSON.stringify(cart));
        } catch {}
        const orig = btn.innerHTML;
        btn.innerHTML = '✓ Adicionado!';
        btn.style.cssText = 'background:var(--color-navy);color:white;';
        const badge = document.getElementById('cartBadge');
        if (badge) { badge.textContent = (parseInt(badge.textContent) || 0) + 1; badge.hidden = false; }
        setTimeout(() => { btn.innerHTML = orig; btn.style.cssText = ''; }, 1400);
      });
    });

  } catch (err) {
    console.warn('[Produto] Erro ao carregar peças relacionadas:', err);
  }
}

/* ── COMPRE JUNTO — renderização dinâmica ───── */
async function renderCompreJunto(produtoPrincipal, sugestoesIds) {
  try {
    const { data: sugestoes } = await supabaseClient
      .from('produtos')
      .select('id, nome, preco_original, preco_desconto, imagem_url, imagem_placeholder')
      .in('id', sugestoesIds)
      .eq('ativo', true);

    if (!sugestoes || sugestoes.length === 0) {
      document.querySelector('.compre-junto')?.style.setProperty('display', 'none');
      return;
    }

    const fmt  = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const bg   = p => p.imagem_url
      ? `url('${p.imagem_url}') center/cover no-repeat`
      : (p.imagem_placeholder || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)');

    const precoPrincipal = produtoPrincipal.preco_desconto ?? produtoPrincipal.preco_original;
    let total = precoPrincipal;

    const cardHTML = (p, tag) => {
      const preco = p.preco_desconto ?? p.preco_original;
      return `
        <div class="compre-junto__card">
          <a href="produto.html?id=${p.id}" style="display:block">
            <div class="compre-junto__img" style="background:${bg(p)}"></div>
          </a>
          <div class="compre-junto__tag">${tag}</div>
          <p class="compre-junto__name">${p.nome}</p>
          <p class="compre-junto__price">${fmt(preco)}</p>
        </div>`;
    };

    let mainHTML = cardHTML(produtoPrincipal, 'Este produto');
    sugestoes.forEach(s => {
      total += s.preco_desconto ?? s.preco_original;
      mainHTML += `<span class="compre-junto__plus" aria-hidden="true">+</span>` + cardHTML(s, 'Sugestão');
    });

    const qtd = 1 + sugestoes.length;
    const mainEl  = document.querySelector('.compre-junto__main');
    const totalEl = document.querySelector('.compre-junto__total');
    const labelEl = document.querySelector('.compre-junto__total-label');
    const addBtn  = document.getElementById('addAllBtn');
    const econEl  = document.querySelector('.compre-junto__economia');

    if (mainEl)  mainEl.innerHTML = mainHTML;
    if (totalEl) totalEl.textContent = fmt(total);
    if (labelEl) labelEl.textContent = `Total dos ${qtd} itens`;
    if (addBtn)  addBtn.textContent  = `Adicionar os ${qtd} ao carrinho`;
    if (econEl)  econEl.style.display = 'none'; // economia calculada futuramente

    // Clicar em "Adicionar os X ao carrinho" → adiciona todos ao localStorage
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const CART_KEY = 'virtu_cart';
        let cart = [];
        try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch {}

        const toAdd = [produtoPrincipal, ...sugestoes];
        toAdd.forEach(item => {
          const preco = item.preco_desconto ?? item.preco_original;
          const existing = cart.findIndex(c => c.id === item.id);
          if (existing >= 0) {
            cart[existing].qty = (cart[existing].qty || 1) + 1;
          } else {
            cart.push({ id: item.id, nome: item.nome, preco, tamanho: '', cor_nome: '', qty: 1 });
          }
        });
        localStorage.setItem(CART_KEY, JSON.stringify(cart));

        const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
        const badge = document.getElementById('cartBadge');
        if (badge) { badge.textContent = totalQty; badge.hidden = false; }

        const orig = addBtn.textContent;
        addBtn.textContent = `✓ ${qtd} peças adicionadas!`;
        addBtn.disabled = true;
        setTimeout(() => { addBtn.textContent = orig; addBtn.disabled = false; }, 2000);
      });
    }

  } catch (err) {
    console.warn('[Produto] Erro ao carregar Compre Junto:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  // ── CARREGAR DADOS DO PRODUTO ───────────────
  const _urlId = new URLSearchParams(window.location.search).get('id');
  let _produtoCarregado = null;
  if (_urlId && typeof supabaseClient !== 'undefined') {
    _produtoCarregado = await carregarProduto(_urlId);
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
    if (e.key === 'Escape') { closeMenu(); closeSearch(); }
  });

  // ── SETAS MOBILE DA GALERIA ────────────────
  // (o clique nas thumbs e a lógica principal ficam dentro de loadProduct)
  const prevBtn = document.getElementById('galPrev');
  const nextBtn = document.getElementById('galNext');

  prevBtn?.addEventListener('click', () => {
    const thumbs = [...document.querySelectorAll('.galeria-thumb')];
    const active = thumbs.findIndex(t => t.classList.contains('galeria-thumb--active'));
    const prev = (active - 1 + thumbs.length) % thumbs.length;
    thumbs[prev]?.click();
  });
  nextBtn?.addEventListener('click', () => {
    const thumbs = [...document.querySelectorAll('.galeria-thumb')];
    const active = thumbs.findIndex(t => t.classList.contains('galeria-thumb--active'));
    const next = (active + 1) % thumbs.length;
    thumbs[next]?.click();
  });

  // ── SELETOR DE CORES (event delegation) ────
  // Usa delegação de eventos no container para funcionar mesmo
  // quando o VirtuStock ou carregarProduto substituem o HTML interno.
  const selectedColorLabel = document.getElementById('selectedColor');
  let selectedColor = document.querySelector('.produto-cor--active')
                        ?.getAttribute('aria-label') || '';

  document.getElementById('coresContainer')?.addEventListener('click', e => {
    const btn = e.target.closest('.produto-cor');
    if (!btn || btn.disabled) return;
    document.querySelectorAll('#coresContainer .produto-cor')
      .forEach(b => b.classList.remove('produto-cor--active'));
    btn.classList.add('produto-cor--active');
    selectedColor = btn.getAttribute('aria-label') || btn.dataset.cor || '';
    if (selectedColorLabel) selectedColorLabel.textContent = selectedColor;
  });

  // ── SELETOR DE TAMANHOS (event delegation) ─
  const selectedSizeEl = document.getElementById('selectedSize');
  const sizeAlert      = document.getElementById('sizeAlert');
  let selectedSize     = null;

  document.querySelector('.produto-tamanhos')?.addEventListener('click', e => {
    const btn = e.target.closest('.produto-tamanho');
    if (!btn || btn.disabled || btn.classList.contains('produto-tamanho--esgotado')) return;

    document.querySelectorAll('.produto-tamanho')
      .forEach(b => b.classList.remove('produto-tamanho--selected'));
    btn.classList.add('produto-tamanho--selected');
    selectedSize = btn.textContent.trim();

    if (selectedSizeEl) selectedSizeEl.textContent = selectedSize;
    if (sizeAlert) sizeAlert.hidden = true;

    // Feedback de estoque baixo
    if (btn.getAttribute('data-stock') === 'low') {
      let stockMsg = document.getElementById('stockMsg');
      if (!stockMsg) {
        stockMsg = document.createElement('p');
        stockMsg.id = 'stockMsg';
        stockMsg.style.cssText = 'font-size:0.8rem;margin-top:0.25rem;color:#C4934A';
        document.querySelector('.produto-tamanhos')?.after(stockMsg);
      }
      stockMsg.textContent = '⚡ Últimas unidades disponíveis!';
    } else {
      const msg = document.getElementById('stockMsg');
      if (msg) msg.textContent = '';
    }
  });

  // ── ADD TO CART ────────────────────────────
  let cartCount = (() => { try { return JSON.parse(localStorage.getItem('virtu_cart') || '[]').reduce((s, i) => s + (i.qty || 1), 0); } catch { return 0; } })();
  const cartBadge    = document.getElementById('cartBadge');
  if (cartBadge && cartCount > 0) cartBadge.textContent = cartCount;
  const addToCartBtn = document.getElementById('btnComprar');
  const buyNowBtn    = document.getElementById('buyNowBtn');
  const stickyAddBtn = document.getElementById('stickyAddBtn');

  function validateAndAdd(redirect = false) {
    if (!selectedSize) {
      if (sizeAlert) {
        sizeAlert.hidden = false;
        sizeAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        sizeAlert.animate([
          { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
          { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' }
        ], { duration: 400, easing: 'ease' });
      }
      return false;
    }

    // ── Gravar no localStorage (lido por carrinho.js) ──
    const CART_KEY = 'virtu_cart';
    const nome  = document.querySelector('[data-produto-nome]')?.textContent?.trim() || '';
    const preco = parseFloat(document.querySelector('[data-preco]')?.dataset?.preco) || 0;
    const cor   = document.querySelector('#coresContainer .produto-cor--active')
                    ?.getAttribute('aria-label') || selectedColor || '';
    const imgBg = document.getElementById('mainPlaceholder')?.style?.background || '';

    let cart = [];
    try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch {}

    const idx = cart.findIndex(i =>
      i.id === _urlId && i.tamanho === selectedSize && i.cor_nome === cor
    );
    if (idx >= 0) {
      cart[idx].qty = (cart[idx].qty || 1) + 1;
    } else {
      cart.push({
        id:                  _urlId || 'produto',
        nome,
        tamanho:             selectedSize,
        cor_nome:            cor,
        preco,
        imagem_placeholder:  imgBg,
        qty:                 1
      });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(cart));

    // Atualiza badge
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    if (cartBadge) { cartBadge.textContent = totalQty; cartBadge.hidden = false; }

    if (redirect) {
      window.location.href = 'carrinho.html';
      return true;
    }

    // Feedback visual no botão
    if (addToCartBtn) {
      const orig = addToCartBtn.innerHTML;
      addToCartBtn.innerHTML = '✓ Adicionado ao carrinho';
      addToCartBtn.style.background = 'var(--color-navy, #2B3F54)';
      addToCartBtn.disabled = true;
      setTimeout(() => {
        addToCartBtn.innerHTML = orig;
        addToCartBtn.style.background = '';
        addToCartBtn.disabled = false;
      }, 2000);
    }
    return true;
  }

  // Quando VirtuStock está ativo com stock configurado ele trata o btnComprar.
  // Nesses casos produto.js não adiciona listener extra para evitar duplicação.
  addToCartBtn?.addEventListener('click', () => {
    if (typeof VirtuStock !== 'undefined' && VirtuStock.getVariacoes().size > 0) return;
    validateAndAdd(false);
  });
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

  // ── GUIA DE TAMANHOS → politicas.html#tamanhos ─
  document.getElementById('openGuia')?.addEventListener('click', () => {
    window.open('politicas.html#tamanhos', '_blank');
  });

  // ── STICKY BUY BAR ─────────────────────────
  const stickyBar     = document.querySelector('.sticky-buy-bar');
  const productActions = document.querySelector('.produto-acoes');

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
    VirtuStock.init(_urlId, (_resultado, _variacao) => {
      // Item já foi salvo no localStorage pelo stock.js.
      // Dá feedback visual e vai para o carrinho.
      const btn = document.getElementById('btnComprar');
      if (btn) {
        btn.textContent = '✓ Adicionado ao carrinho!';
        btn.style.background = 'var(--color-navy)';
        btn.disabled = true;
      }
      setTimeout(() => { window.location.href = 'carrinho.html'; }, 900);
    })
    .then(() => {
      // ── Cores: usa variacoes se existirem, senão cai em p.cores ──
      const variacoes = VirtuStock.getVariacoes();

      if (variacoes.size > 0) {
        // Fonte primária: variacoes do Supabase
        const coresMap = new Map();
        variacoes.forEach(v => {
          if (!coresMap.has(v.cor_nome)) coresMap.set(v.cor_nome, v.cor_hex);
        });

        const lista = [...coresMap.entries()].map(([nome, hex]) => ({ nome, hex }));
        _renderCores(lista);

        // Pré-seleciona a primeira cor no VirtuStock
        if (lista.length > 0) {
          selectedColor = lista[0].nome;
          if (selectedColorLabel) selectedColorLabel.textContent = lista[0].nome;
          VirtuStock.selecionarCor(lista[0].nome);
        }
      } else {
        // Fallback: p.cores do produto (produto sem gestão de stock)
        const fallback = _produtoCarregado?.cores || [];
        _renderCores(fallback);
        if (fallback.length > 0) {
          selectedColor = fallback[0].nome;
          if (selectedColorLabel) selectedColorLabel.textContent = fallback[0].nome;
        }
      }

      // Atualiza estado visual dos tamanhos (esgotado/disponível)
      VirtuStock.atualizarUI();
    })
    .catch(err => {
      console.warn('[Produto] Erro ao inicializar stock:', err);
    });
  }

});
