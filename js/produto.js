/* ============================================================
   VIRTÙ — Produto JavaScript
   ============================================================ */

/* ── SANITIZAÇÃO HTML — previne XSS de dados do banco ── */
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  // Bloco "COR:" inteiro — é o .produto-opcao pai do coresContainer
  const coresBlock = coresContainer?.closest('.produto-opcao');

  if (!lista || !lista.length) {
    if (coresBlock) coresBlock.style.display = 'none';
    return;
  }

  if (coresBlock) coresBlock.style.display = '';
  if (!coresContainer) return;

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

    const fmt     = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtParc = v => fmt(Math.ceil(v * 100) / 100); // arredonda parcela para cima
    // Arredondamento estético ,90 (espelha checkout.js/processar-pagamento)
    const arredondar90 = v => {
      const arred = Math.floor((v - 0.90) + 0.5 + 1e-9);
      return Math.round((arred + 0.90) * 100) / 100;
    };
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    const preco = p.preco_desconto ?? p.preco_original;

    // Título e meta
    document.title = `${p.nome} — Virtù`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = p.descricao || `${p.nome} — Virtù`;

    // Helper: resolve Google Drive URLs for OG image
    function _cvDriveOg(u) {
      if (!u) return u;
      const m1 = u.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
      if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
      const m2 = u.match(/[?&]id=([^&]+)/);
      if (m2 && u.includes('drive.google.com')) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
      return u;
    }
    const imgOgUrl = _cvDriveOg(p.imagem_url || (Array.isArray(p.imagens) && p.imagens[0]) || '');

    // Determine availability from variacoes
    const temEstoque = p.variacoes
      ? p.variacoes.some(v => v.estoque > 0)
      : !p._esgotado;

    // OG tags dinâmicos (compartilhar no WhatsApp/Instagram)
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc  = document.querySelector('meta[property="og:description"]');
    const ogImg   = document.querySelector('meta[property="og:image"]');
    const ogUrl   = document.querySelector('meta[property="og:url"]');
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    const twDesc  = document.querySelector('meta[name="twitter:description"]');
    const twImg   = document.querySelector('meta[name="twitter:image"]');
    const ppAmt   = document.querySelector('meta[property="product:price:amount"]');
    const ppAvail = document.querySelector('meta[property="product:availability"]');
    if (ogTitle) ogTitle.content = `${p.nome} — Virtù`;
    if (ogDesc)  ogDesc.content  = p.descricao || `${p.nome} — Moda feminina atemporal. Virtù.`;
    if (ogImg  && imgOgUrl) ogImg.content  = imgOgUrl;
    if (ogUrl)   ogUrl.content   = `https://wearvirtu.com/produto.html?id=${p.id}`;
    if (twTitle) twTitle.content = `${p.nome} — Virtù`;
    if (twDesc)  twDesc.content  = p.descricao || `${p.nome} — Moda feminina atemporal.`;
    if (twImg  && imgOgUrl) twImg.content  = imgOgUrl;
    if (ppAmt)   ppAmt.content   = String(preco);
    if (ppAvail) ppAvail.content = temEstoque ? 'in stock' : 'out of stock';
    // canonical URL
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.href = `https://wearvirtu.com/produto.html?id=${p.id}`;

    // Schema.org Product (rich snippets no Google)
    const existingLd = document.getElementById('ld-product');
    if (existingLd) existingLd.remove();
    const ldScript = document.createElement('script');
    ldScript.type = 'application/ld+json';
    ldScript.id   = 'ld-product';
    const allImages = [imgOgUrl, ...(Array.isArray(p.imagens) ? p.imagens : [])].filter(Boolean);
    ldScript.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type':    'Product',
      name:        p.nome,
      description: p.descricao || '',
      image:       allImages.length > 1 ? allImages : (allImages[0] || ''),
      url:         `https://wearvirtu.com/produto.html?id=${p.id}`,
      sku:         String(p.id),
      brand:       { '@type': 'Brand', name: 'Virtù' },
      category:    p.categoria || '',
      offers: {
        '@type':           'Offer',
        price:             String(preco),
        priceCurrency:     'BRL',
        availability:      temEstoque
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        itemCondition:     'https://schema.org/NewCondition',
        url:               `https://wearvirtu.com/produto.html?id=${p.id}`,
        seller:            { '@type': 'Organization', name: 'Virtù' },
        ...(p.preco_desconto ? { highPrice: String(p.preco_original), lowPrice: String(p.preco_desconto) } : {}),
      },
    });
    document.head.appendChild(ldScript);

    // Schema.org BreadcrumbList (melhora rich snippets no Google)
    const existingBc = document.getElementById('ld-breadcrumb');
    if (existingBc) existingBc.remove();
    const cap2 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Produtos';
    const ldBc = document.createElement('script');
    ldBc.type = 'application/ld+json';
    ldBc.id   = 'ld-breadcrumb';
    ldBc.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type':    'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://wearvirtu.com/' },
        { '@type': 'ListItem', position: 2, name: cap2(p.categoria), item: `https://wearvirtu.com/catalogo.html?cat=${p.categoria || ''}` },
        { '@type': 'ListItem', position: 3, name: p.nome,     item: `https://wearvirtu.com/produto.html?id=${p.id}` },
      ],
    });
    document.head.appendChild(ldBc);

    // Breadcrumb visual
    const bcLinks = document.querySelectorAll('.breadcrumb__link');
    if (bcLinks[1]) {
      bcLinks[1].textContent = cap(p.categoria || 'Produtos');
      bcLinks[1].href = `catalogo.html?cat=${p.categoria || ''}`;
    }
    const bcAtual = document.querySelector('.breadcrumb__current');
    if (bcAtual) bcAtual.textContent = p.nome.toUpperCase();

    // Categoria (overline)
    const catEl = document.querySelector('[data-produto-categoria]');
    if (catEl) {
      catEl.textContent = cap(p.categoria || '') + (p.novidade ? ' · Nova Coleção' : '');
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

    // Parcelamento — usa preço do cartão (+5%, arredondado ,90) p/ bater com o strip
    const cardPreco = arredondar90(preco * 1.05);
    const parcela = cardPreco / 12;
    const parcelaEl = document.querySelector('.produto-parcelamento');
    if (parcelaEl) parcelaEl.textContent = `ou 12x de ${fmtParc(parcela)} no cartão`;

    // ── Strip de formas de pagamento e valores ─────────────
    // PIX = valor cheio (sem ajuste) | Crédito/Débito = +5% (taxa) no checkout
    const payStrip = document.getElementById('produtoPaymentStrip');
    if (payStrip && preco > 0) {
      const cardPrice = cardPreco;
      const parcela12 = cardPrice / 12;
      const fmtV = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      payStrip.innerHTML = `
        <div class="produto-payment-strip__row produto-payment-strip__row--pix">
          <span class="produto-payment-strip__metodo">PIX</span>
          <span class="produto-payment-strip__preco">${fmt(preco)}</span>
          <span class="produto-payment-strip__nota produto-payment-strip__nota--pix">à vista</span>
        </div>
        <div class="produto-payment-strip__row produto-payment-strip__row--card">
          <span class="produto-payment-strip__metodo">
            Crédito
            <small class="produto-payment-strip__parcelamento">até 12x de ${fmtV(parcela12)}</small>
          </span>
          <span class="produto-payment-strip__preco">${fmtV(cardPrice)}</span>
        </div>
        <div class="produto-payment-strip__row produto-payment-strip__row--debito">
          <span class="produto-payment-strip__metodo">Débito</span>
          <span class="produto-payment-strip__preco">${fmtV(cardPrice)}</span>
        </div>`;
      payStrip.style.display = '';
    }

    // Cores — renderiza p.cores imediatamente como base.
    // VirtuStock sobrescreve depois se houver variações configuradas.
    if (p.cores && p.cores.length > 0) {
      _renderCores(p.cores);
    }

    // Descrição
    const descEl = document.getElementById('acc-desc');
    if (descEl && p.descricao) {
      // escHtml impede XSS: converte < > & " ' em entidades HTML
      descEl.innerHTML = `<p>${escHtml(p.descricao).replace(/\n/g, '</p><p style="margin-top:var(--space-3);">')}</p>`;
    }

    // Composição & Cuidados
    const compEl = document.getElementById('acc-composicao');
    if (compEl && p.composicao) {
      compEl.innerHTML = p.composicao
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<p>${escHtml(l)}</p>`)
        .join('');
    }

    // Entrega & Trocas
    const entregaEl = document.getElementById('acc-entrega');
    if (entregaEl && p.entrega_trocas) {
      entregaEl.innerHTML = p.entrega_trocas
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<p>${escHtml(l)}</p>`)
        .join('');
    }
    // Se não há texto personalizado, mantém o HTML padrão que já está no produto.html

    // Sticky bar — nome e preço
    const stickyName  = document.querySelector('.sticky-buy-bar__name');
    const stickyPrice = document.querySelector('.sticky-buy-bar__price');
    if (stickyName)  stickyName.textContent  = p.nome;
    if (stickyPrice) stickyPrice.textContent = fmt(preco);

    // Coração de favorito — atribui ID para o wishlist.js reconhecer
    const wishlistBtn = document.getElementById('wishlistBtn');
    if (wishlistBtn) {
      wishlistBtn.dataset.wishlistId = p.id;
      // Atualiza visual se já carregado
      if (window.VirtuWishlist) window.VirtuWishlist.atualizarBotoes(p.id);
    }

    // Galeria de imagens — monta thumbnails dinamicamente
    const imagens = (Array.isArray(p.imagens) && p.imagens.length
      ? p.imagens
      : (p.imagem_url ? [p.imagem_url] : [])
    ).map(convertDriveUrl);

    if (imagens.length) {
      const thumbsContainer = document.querySelector('.galeria-thumbs');
      const mainImg         = document.getElementById('mainImg');

      // ── Função local que troca a imagem principal ──
      // USA background-image (mesma abordagem das thumbnails — garantidamente funciona)
      // Evita o problema de height:100% não resolver em filhos position:absolute
      // quando o pai tem altura derivada de aspect-ratio.
      function _showImage(url) {
        if (!mainImg) return;
        mainImg.style.transition = 'opacity 0.15s ease';
        mainImg.style.opacity    = '0';
        const preload = new Image();
        preload.onload = () => {
          mainImg.style.backgroundImage    = `url('${url}')`;
          mainImg.style.backgroundSize     = 'cover';
          mainImg.style.backgroundPosition = 'center';
          mainImg.style.backgroundRepeat   = 'no-repeat';
          // Esconde o placeholder estático (texto "foto do produto")
          const ph = mainImg.querySelector('.galeria-main__placeholder');
          if (ph) ph.style.visibility = 'hidden';
          mainImg.style.opacity = '1';
          mainImg.closest('.galeria-main')?.classList.add('img-loaded');
          mainImg.dataset.currentUrl = url; // usado pelo lightbox
        };
        preload.onerror = () => {
          mainImg.style.opacity = '1';
          mainImg.closest('.galeria-main')?.classList.add('img-loaded');
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
    } else {
      // Sem foto → encerra o skeleton e revela o placeholder boutique (.is-ph)
      document.querySelector('.galeria-main')?.classList.add('img-loaded');
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
      .select('id, nome, categoria, preco_original, preco_desconto, imagem_url, imagem_placeholder, novidade, destaque')
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
        .select('id, nome, categoria, preco_original, preco_desconto, imagem_url, imagem_placeholder, novidade, destaque')
        .eq('ativo', true)
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .limit(4 - rel.length);
      if (extra) rel = [...rel, ...extra];
    }

    if (rel.length === 0) { secao.style.display = 'none'; return; }

    const cardHTML = (p, i = 0) => {
      const preco  = p.preco_desconto ?? p.preco_original;
      const temImg = !!p.imagem_url;
      const phVariant = (i % 2 === 1) ? ' is-ph--navy' : '';
      const badge  = p.novidade
        ? `<span class="product-card__badge">Novo</span>`
        : p.destaque
          ? `<span class="product-card__badge">Mais Vendido</span>`
          : '';
      const cat = p.categoria ? p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1) : '';
      const phHtml = temImg
        ? `<div class="product-card__placeholder" style="background:url('${p.imagem_url}') center/cover no-repeat;width:100%;height:100%;"></div>`
        : `<div class="product-card__placeholder is-ph${phVariant}"></div>`;
      return `
        <article class="product-card" data-id="${p.id}">
          <a href="produto.html?id=${p.id}" class="product-card__image-link" tabindex="-1" aria-hidden="true">
            <div class="product-card__image-wrap">
              ${phHtml}
              ${badge}
              <button class="product-card__wishlist" data-wishlist-id="${p.id}" aria-label="Adicionar aos favoritos" aria-pressed="false">${heartSVG}</button>
              <div class="product-card__quick-add"><button class="product-card__quick-btn" data-id="${p.id}">+ Adicionar ao carrinho</button></div>
            </div>
          </a>
          <div class="product-card__info">
            <p class="product-card__category">${escHtml(cat)}</p>
            <h3 class="product-card__name"><a href="produto.html?id=${p.id}">${escHtml(p.nome)}</a></h3>
            <div class="product-card__price"><span class="product-card__price-current">${fmt(preco)}</span></div>
          </div>
        </article>`;
    };

    grid.innerHTML = rel.map((p, i) => cardHTML(p, i)).join('');

    // wishlist.js gerencia os corações via event delegation global
    // Quick-add: redireciona para a página do produto para seleção de tamanho/cor
    // (produtos de moda sempre exigem escolha de variação antes de ir ao carrinho)
    grid.querySelectorAll('.product-card__quick-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const card   = btn.closest('[data-id]') || btn.closest('.product-card');
        const prodId = card?.dataset?.id || '';
        if (prodId) {
          window.location.href = `produto.html?id=${prodId}`;
        }
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
    // Imagem real → background; sem foto → placeholder boutique (.is-ph) em vez de nude
    const imgAttr = p => p.imagem_url
      ? `class="compre-junto__img" style="background:url('${p.imagem_url}') center/cover no-repeat"`
      : `class="compre-junto__img is-ph"`;

    const precoPrincipal = produtoPrincipal.preco_desconto ?? produtoPrincipal.preco_original;
    let total = precoPrincipal;

    const cardHTML = (p, tag) => {
      const preco = p.preco_desconto ?? p.preco_original;
      return `
        <div class="compre-junto__card">
          <a href="produto.html?id=${p.id}" style="display:block">
            <div ${imgAttr(p)}></div>
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
          const existing = cart.findIndex(c => c.id === item.id && !c.tamanho && !c.cor_nome);
          if (existing >= 0) {
            cart[existing].qty = (cart[existing].qty || 1) + 1;
          } else {
            // Adiciona sem tamanho/cor — o cliente deve ajustar no carrinho
            cart.push({ id: item.id, nome: item.nome, preco, tamanho: null, cor_nome: null, qty: 1, sem_variacao: true });
          }
        });
        localStorage.setItem(CART_KEY, JSON.stringify(cart));

        const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
        const badge = document.getElementById('cartBadge');
        if (badge) { badge.textContent = totalQty; badge.hidden = false; }

        const orig = addBtn.textContent;
        addBtn.textContent = `✓ ${qtd} peças adicionadas!`;
        addBtn.disabled = true;
        // Avisa que tamanho/cor deve ser ajustado no carrinho
        const aviso = document.createElement('p');
        aviso.style.cssText = 'font-size:0.8em;color:#a07c5a;margin-top:0.5rem;text-align:center';
        aviso.textContent = 'Selecione tamanho e cor de cada peça no carrinho.';
        addBtn.parentNode.insertBefore(aviso, addBtn.nextSibling);
        setTimeout(() => { addBtn.textContent = orig; addBtn.disabled = false; aviso.remove(); }, 3000);
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
    if (_produtoCarregado) {
      renderBadgesExclusividade(_produtoCarregado);
      carregarAvaliacoes(_urlId);
      iniciarFormAvaliacao(_urlId);
    }
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
        stockMsg.style.cssText = 'font-size:0.8rem;margin-top:0.25rem;color:#b8943f';
        document.querySelector('.produto-tamanhos')?.after(stockMsg);
      }
      stockMsg.textContent = 'Últimas unidades disponíveis';
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
    const imgBg  = document.getElementById('mainPlaceholder')?.style?.background || '';
    // #mainImg é um <div> com background-image — lemos a URL do dataset.currentUrl
    const imgUrl = mainImg?.dataset?.currentUrl
                || (mainImg?.style?.backgroundImage || '').replace(/^url\(['"]?|['"]?\)$/g, '')
                || document.querySelector('#mainImg img')?.src || '';

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
        produto_id:          _urlId || 'produto', // campo lido pelo trigger de estoque
        nome,
        tamanho:             selectedSize,
        cor_nome:            cor,
        preco,
        imagem_url:          imgUrl,
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
      addToCartBtn.style.background = 'var(--color-navy, #1a2a4a)';
      addToCartBtn.disabled = true;
      setTimeout(() => {
        addToCartBtn.innerHTML = orig;
        addToCartBtn.style.background = '';
        addToCartBtn.disabled = false;
      }, 2000);
    }
    return true;
  }

  // Quando VirtuStock está ativo com stock configurado ele trata os botões de compra.
  // Nesses casos produto.js não adiciona listener extra para evitar duplicação.
  const _stockAtivo = () => typeof VirtuStock !== 'undefined' && VirtuStock.getVariacoes().size > 0;

  addToCartBtn?.addEventListener('click', () => {
    if (_stockAtivo()) return;
    validateAndAdd(false);
  });
  buyNowBtn?.addEventListener('click', () => {
    if (_stockAtivo()) return;
    validateAndAdd(true);
  });
  stickyAddBtn?.addEventListener('click', () => {
    if (_stockAtivo()) return;
    validateAndAdd(true);
  });

  // wishlist.js gerencia o coração via event delegation global

  // ── ACCORDION ──────────────────────────────
  document.querySelectorAll('.accordion-header').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item   = trigger.closest('.accordion-item');
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';

      // Fecha todos os outros
      document.querySelectorAll('.accordion-header').forEach(t => {
        t.setAttribute('aria-expanded', 'false');
        t.closest('.accordion-item')?.classList.remove('accordion-item--open');
        const tid = t.getAttribute('aria-controls');
        const tc  = document.getElementById(tid);
        tc?.classList.add('accordion-content--hidden');
      });

      // Abre o clicado se estava fechado
      if (!isOpen) {
        trigger.setAttribute('aria-expanded', 'true');
        item?.classList.add('accordion-item--open');
        const targetId = trigger.getAttribute('aria-controls');
        const content  = document.getElementById(targetId);
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
    // Em telas ≤900px a barra fica sempre visível (CSS); no desktop só ao rolar.
    let scrolledPast  = false;
    let actionsVisible = true;
    const mqMobile   = window.matchMedia('(max-width: 900px)');
    // Eleva o botão flutuante do WhatsApp sempre que o CTA principal estiver
    // na tela (visível OU já passamos por ele, e sempre no mobile) — assim o
    // FAB nunca cobre "Adicionar ao carrinho" / "Comprar agora".
    const syncWhatsApp = () => {
      const elevarWhats = scrolledPast || actionsVisible || mqMobile.matches;
      document.body.classList.toggle('sticky-bar-visible', elevarWhats);
    };
    const stickyObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        scrolledPast   = !e.isIntersecting;
        actionsVisible = e.isIntersecting;
        stickyBar.classList.toggle('visible', scrolledPast);
        syncWhatsApp();
      });
    }, { threshold: 0 });
    stickyObs.observe(productActions);
    mqMobile.addEventListener('change', syncWhatsApp);
    syncWhatsApp();
  }

  // Compre Junto: renderizado dinamicamente por renderCompreJunto() acima
  // wishlist.js e initCardEvents em products.js gerenciam os cards de peças relacionadas

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
  // Seleciona primeira miniatura (thumbs são carregadas dinamicamente em carregarProduto)

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

/* ============================================================
   BADGES DE EXCLUSIVIDADE
   ============================================================ */
function renderBadgesExclusividade(p) {
  const wrap = document.getElementById('produtoBadges');
  if (!wrap) return;

  const badges = [];

  if (p.exclusivo) {
    badges.push(`<span class="badge-exclusivo badge-exclusivo--gold">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      Peça exclusiva
    </span>`);
  }

  if (p.novidade) {
    badges.push(`<span class="badge-exclusivo badge-exclusivo--navy">Nova coleção</span>`);
  }

  if (p.badge && p.badge.toLowerCase().includes('sale')) {
    // já mostrado no badge normal
  }

  // Estoque baixo — verificado via variações se disponíveis
  const totalEstoque = p.estoque || 0;
  if (totalEstoque > 0 && totalEstoque <= 5 && !p.exclusivo) {
    badges.push(`<span class="badge-exclusivo badge-exclusivo--red">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Últimas unidades
    </span>`);
  }

  if (badges.length > 0) {
    wrap.innerHTML = badges.join('');
    wrap.removeAttribute('hidden');
  }
}

/* ============================================================
   AVALIAÇÕES DO PRODUTO
   ============================================================ */
function starsHtml(nota, size = 14) {
  return [1,2,3,4,5].map(i =>
    `<svg class="estrela ${i <= nota ? '' : 'estrela--vazia'}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>`
  ).join('');
}

async function carregarAvaliacoes(produtoId) {
  const lista  = document.getElementById('avaliacoesLista');
  const resumo = document.getElementById('ratingResumo');
  if (!lista || typeof supabaseClient === 'undefined') return;

  const { data, error } = await supabaseClient
    .from('avaliacoes')
    .select('*')
    .eq('produto_id', produtoId)
    .eq('aprovado', true)
    .order('criado_em', { ascending: false });

  if (error || !data?.length) {
    lista.innerHTML = `<p style="color:var(--color-text-light);font-size:0.85rem;font-style:italic">Seja a primeira a avaliar esta peça</p>`;
    return;
  }

  // Resumo
  const media = data.reduce((s, a) => s + a.nota, 0) / data.length;
  const notaFmt = media.toFixed(1);
  const count = data.length;

  document.getElementById('ratingNota').textContent = notaFmt;
  document.getElementById('ratingEstrelasResumo').innerHTML = starsHtml(Math.round(media));
  document.getElementById('ratingCount').textContent = `${count} avaliação${count !== 1 ? 'ões' : ''}`;
  resumo?.removeAttribute('hidden');

  // Rating inline (próximo ao preço)
  const inlineWrap = document.getElementById('produtoRatingInline');
  if (inlineWrap) {
    document.getElementById('ratingEstrelinhas').innerHTML = starsHtml(Math.round(media), 13);
    document.getElementById('ratingTextoInline').textContent = `${notaFmt} (${count} avaliação${count !== 1 ? 'ões' : ''})`;
    inlineWrap.style.display = 'block';
  }

  // Cards de avaliação
  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
  lista.innerHTML = data.map(a => {
    const nomeSeguro = escHtml(a.nome_cliente || 'Cliente');
    const inicial = nomeSeguro.charAt(0).toUpperCase();
    const avatar  = a.foto_cliente
      ? `<img src="${escHtml(a.foto_cliente)}" alt="${nomeSeguro}" loading="lazy" />`
      : inicial;
    return `
      <div class="avaliacao-card">
        <div class="avaliacao-card__header">
          <div class="avaliacao-card__avatar">${avatar}</div>
          <span class="avaliacao-card__nome">${nomeSeguro}</span>
          <span class="avaliacao-card__data">${fmtDate(a.criado_em)}</span>
        </div>
        <div class="avaliacao-card__estrelas">${starsHtml(a.nota)}</div>
        ${a.comentario ? `<p class="avaliacao-card__texto">${escHtml(a.comentario)}</p>` : ''}
        <p class="avaliacao-card__verificado">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          Compra verificada
        </p>
      </div>`;
  }).join('');
}

function iniciarFormAvaliacao(produtoId) {
  const form    = document.getElementById('formAvaliacao');
  const btns    = document.getElementById('estrelasBtns');
  const sucesso = document.getElementById('avaliacaoSucesso');
  if (!form || !btns) return;

  // Gera botões de estrela
  let notaSelecionada = 0;
  btns.innerHTML = [1,2,3,4,5].map(i =>
    `<button type="button" data-nota="${i}" aria-label="${i} estrela${i > 1 ? 's' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    </button>`
  ).join('');

  function highlightStars(nota) {
    btns.querySelectorAll('button').forEach((btn, idx) => {
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.style.fill   = idx < nota ? 'var(--color-gold)' : 'none';
        svg.style.stroke = idx < nota ? 'var(--color-gold)' : 'currentColor';
      }
    });
  }

  btns.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      notaSelecionada = parseInt(btn.dataset.nota);
      highlightStars(notaSelecionada);
    });
    btn.addEventListener('mouseenter', () => highlightStars(parseInt(btn.dataset.nota)));
    btn.addEventListener('mouseleave', () => highlightStars(notaSelecionada));
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nome      = document.getElementById('avNome')?.value.trim();
    const foto      = document.getElementById('avFoto')?.value.trim() || null;
    const comentario= document.getElementById('avComentario')?.value.trim();
    const btn       = document.getElementById('btnEnviarAvaliacao');

    if (!nome || !comentario) {
      ['avNome','avComentario'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) el.style.borderBottomColor = 'var(--color-error, #c62828)';
      });
      return;
    }
    if (notaSelecionada === 0) {
      btns.style.outline = '2px solid var(--color-error, #c62828)';
      setTimeout(() => btns.style.outline = '', 1500);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      if (typeof supabaseClient === 'undefined') throw new Error('Supabase não disponível');
      const { error } = await supabaseClient.from('avaliacoes').insert({
        produto_id:   produtoId,
        nome_cliente: nome,
        foto_cliente: foto,
        nota:         notaSelecionada,
        comentario,
        aprovado:     false,
      });
      if (error) throw error;
      form.style.display = 'none';
      if (sucesso) sucesso.style.display = 'block';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enviar avaliação';
      console.error('[Avaliações]', err);
    }
  });
}
