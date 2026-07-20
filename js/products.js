/* ============================================================
   VIRTÙ — Products.js
   Motor central: lê dados do Supabase e renderiza cards dinamicamente
   Requer: supabase CDN + js/supabase-config.js carregados antes
   ============================================================ */

const VirtuProducts = (() => {

  // Escapa texto do banco antes de injetar via innerHTML (defesa em profundidade).
  // Os dados vêm da tabela `produtos` (só admin escreve), mas escapamos mesmo
  // assim para não depender disso.
  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Cache de sessão (limpo a cada carregamento de página)
  let _cache = null;

  /* ── FETCH DO SUPABASE ──────────────────── */
  async function fetchAll() {
    if (_cache) return _cache;

    try {
      // Busca produtos, configurações e variações em paralelo
      const [
        { data: produtos, error: e1 },
        { data: cfg,      error: e2 },
        { data: variacoes           }
      ] = await Promise.all([
        supabaseClient.from('produtos').select('*').order('criado_em', { ascending: false }),
        supabaseClient.from('configuracoes').select('*').eq('id', 1).maybeSingle(),
        supabaseClient.from('variacoes').select('produto_id, cor_nome, cor_hex, tamanho').gt('estoque', 0)
      ]);

      if (e1) throw new Error(`Produtos: ${e1.message}`);

      // Monta mapa de cores e tamanhos reais por produto (a partir das variações em estoque)
      const coresPorProduto    = {};
      const tamanhosPorProduto = {};
      const produtosComEstoque = new Set();
      (variacoes || []).forEach(v => {
        produtosComEstoque.add(v.produto_id);
        // Cores — deduplica por nome E por hex normalizado (evita duplicatas como #000 vs #000000)
        if (v.cor_hex) {
          if (!coresPorProduto[v.produto_id]) coresPorProduto[v.produto_id] = [];
          const hexNorm = v.cor_hex.toLowerCase().trim();
          const nomeNorm = (v.cor_nome || '').toLowerCase().trim();
          const jaExiste = coresPorProduto[v.produto_id].some(c =>
            (c.hex || '').toLowerCase() === hexNorm ||
            (nomeNorm && c.nome.toLowerCase().trim() === nomeNorm)
          );
          if (!jaExiste) coresPorProduto[v.produto_id].push({ nome: v.cor_nome || '', hex: v.cor_hex });
        }
        // Tamanhos
        if (v.tamanho) {
          if (!tamanhosPorProduto[v.produto_id]) tamanhosPorProduto[v.produto_id] = [];
          if (!tamanhosPorProduto[v.produto_id].includes(v.tamanho)) {
            tamanhosPorProduto[v.produto_id].push(v.tamanho);
          }
        }
      });

      // Atualiza cores/tamanhos (variacoes em estoque) e marca esgotado
      // Deduplicação: mesma cor_nome → mantém apenas uma entrada (evita duplicatas por hex levemente diferente)
      (produtos || []).forEach(p => {
        if (coresPorProduto[p.id]?.length)    p.cores    = coresPorProduto[p.id];
        if (tamanhosPorProduto[p.id]?.length) p.tamanhos = tamanhosPorProduto[p.id];
        p._esgotado = !produtosComEstoque.has(p.id);
      });

      _cache = {
        produtos:       produtos || [],
        configuracoes:  cfg     || {}
      };

      return _cache;
    } catch (err) {
      console.error('[VirtuProducts] Erro ao buscar dados do Supabase:', err.message);
      return { produtos: [], configuracoes: {} };
    }
  }

  /* ── UTILITÁRIOS ────────────────────────── */
  function formatCurrency(value) {
    return `R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }

  function calcDesconto(original, desconto) {
    if (!desconto) return 0;
    return Math.round((1 - desconto / original) * 100);
  }

  function slugToUrl(id) {
    return `produto.html?id=${id}`;
  }

  /* ── RENDERIZA UM CARD ───────────────────── */
  function renderCard(produto, opts = {}) {
    // opts.index: posição na lista (0-based) — primeiros 4 items carregam eager
    // para melhorar o LCP (Largest Contentful Paint) no Google PageSpeed.
    const eagerLoad = typeof opts.index === 'number' && opts.index < 4;
    const { preco_original, preco_desconto, badge, nome, categoria,
            imagem_url, imagem_placeholder, id, cores } = produto;

    const precoFinal = preco_desconto ?? preco_original;
    const temDesconto = !!preco_desconto;
    const pct = calcDesconto(preco_original, preco_desconto);
    const link = slugToUrl(id);

    // Imagem: converte Drive → lh3, usa URL real se tiver, senão placeholder CSS
    function _cvDrive(u) {
      if (!u) return u;
      const m1 = u.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
      if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
      const m2 = u.match(/[?&]id=([^&]+)/);
      if (m2 && u.includes('drive.google.com')) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
      const m3 = u.match(/uc\?export=view&id=([^&]+)/);
      if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`;
      return u;
    }
    // Usa imagem_url; se vazio, pega o primeiro item do array imagens (galeria)
    const _primeiraImg = Array.isArray(produto.imagens) && produto.imagens.length
      ? produto.imagens[0] : null;
    const imgUrl = _cvDrive(imagem_url || _primeiraImg);
    // Placeholder boutique (creme/navy + marca em serif via CSS .is-ph) — nunca nude.
    // Alterna creme/navy por posição para dar ritmo à grade.
    const phVariant = (typeof opts.index === 'number' && opts.index % 2 === 1) ? ' is-ph--navy' : '';

    // ── IMAGEM RESPONSIVA: WebP via Supabase Transform + srcset ──
    // Para imagens no Supabase Storage → usa o endpoint render/image que
    // converte automaticamente para WebP e serve no tamanho certo.
    // Para Google Drive (lh3.googleusercontent.com) → URL normal com lazy.
    function _buildImgTag(url, eager) {
      if (!url) return '';
      const loadAttr     = eager ? 'eager'  : 'lazy';
      const priorityAttr = eager ? ' fetchpriority="high"' : '';
      const errFallback  = `this.style.display='none';this.closest('.product-card__image-wrap').classList.add('is-ph')`;
      // Detecta Supabase Storage: .../storage/v1/object/public/...
      const supaMatch = url.match(/^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/object\/public\/(.+)$/);
      if (supaMatch) {
        const [, origin, path] = supaMatch;
        const base = `${origin}/storage/v1/render/image/public/${path}`;
        // Gera srcset em 3 breakpoints com WebP + qualidade otimizada
        const s400  = `${base}?width=400&quality=75&format=webp`;
        const s800  = `${base}?width=800&quality=80&format=webp`;
        const s1200 = `${base}?width=1200&quality=85&format=webp`;
        return `<img src="${url}" srcset="${s400} 400w, ${s800} 800w, ${s1200} 1200w"
          sizes="(max-width: 480px) 45vw, (max-width: 768px) 30vw, (max-width: 1280px) 22vw, 18vw"
          alt="${escHtml(nome)}" class="product-card__img"
          loading="${loadAttr}" decoding="async"${priorityAttr}
          onerror="${errFallback}">`;
      }
      // URL externa (Google Drive, lh3, etc.)
      return `<img src="${url}" alt="${escHtml(nome)}" class="product-card__img"
        loading="${loadAttr}" decoding="async"${priorityAttr}
        onerror="${errFallback}">`;
    }

    const imgHtml    = _buildImgTag(imgUrl, eagerLoad);
    const wrapPhClass = imgUrl ? '' : ` is-ph${phVariant}`;

    // ── SEGUNDA IMAGEM: crossfade no hover ────────────────────
    // imagens[] é a galeria completa; imagens[0] é a principal,
    // imagens[1] (se existir) aparece ao passar o mouse — efeito crossfade via CSS.
    const _segundaImg = Array.isArray(produto.imagens) && produto.imagens.length > 1
      ? produto.imagens[1] : null;
    const hoverImgUrl = _segundaImg ? _cvDrive(_segundaImg) : null;
    const hoverImgHtml = hoverImgUrl
      ? `<img src="${hoverImgUrl}" alt="${escHtml(nome)} — vista alternativa"
           class="product-card__img product-card__img--hover"
           loading="lazy" decoding="async"
           aria-hidden="true">`
      : '';

    // Badge
    let badgeHtml = '';
    if (produto._esgotado) {
      badgeHtml = `<span class="product-card__badge product-card__badge--esgotado">Esgotado</span>`;
    } else if (badge === 'Sale' || temDesconto) {
      badgeHtml = `<span class="product-card__badge product-card__badge--sale">${pct > 0 ? `−${pct}%` : 'Sale'}</span>`;
    } else if (badge && badge !== 'Sale') {
      badgeHtml = `<span class="product-card__badge">${escHtml(badge)}</span>`;
    }

    // Swatches de cor (mantidos no DOM para filtros, ocultos via CSS luxury)
    const swatchesHtml = (cores || []).map((c, i) =>
      `<span class="product-card__swatch${i === 0 ? ' active' : ''}"
             style="background:${escHtml(c.hex)}${c.nome === 'Off-White' ? ';border:1px solid #ccc' : ''}"
             title="${escHtml(c.nome)}"></span>`
    ).join('');

    const precoHtml = temDesconto
      ? `<span class="product-card__price-current">${formatCurrency(precoFinal)}</span>
         <span class="product-card__price-old">${formatCurrency(preco_original)}</span>`
      : `<span class="product-card__price-current">${formatCurrency(precoFinal)}</span>`;

    const sizesAttr    = (produto.tamanhos || []).join(',');
    const colorsAttr   = (produto.cores    || []).map(c => (c.hex || '').toLowerCase()).join(',');
    const essencialAttr = produto.essencial ? 'true' : '';
    const novidadeAttr  = produto.novidade  ? 'true' : '';
    const destaqueAttr  = produto.destaque  ? 'true' : '';

    const dateAttr = produto.criado_em ? new Date(produto.criado_em).getTime() : 0;
    return `
      <article class="product-card" data-cat="${escHtml(categoria)}" data-price="${precoFinal}" data-id="${id}" data-sizes="${sizesAttr}" data-colors="${colorsAttr}" data-essencial="${essencialAttr}" data-novidade="${novidadeAttr}" data-destaque="${destaqueAttr}" data-date="${dateAttr}" role="listitem">
        <a href="${link}" class="product-card__image-link" tabindex="-1" aria-hidden="true">
          <div class="product-card__image-wrap${wrapPhClass}">
            ${imgHtml}
            ${hoverImgHtml}
            ${badgeHtml}
            <button class="product-card__wishlist" data-wishlist-id="${id}" aria-label="Adicionar aos favoritos" aria-pressed="false">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
            <div class="product-card__quick-add">
              <button class="product-card__quick-btn" data-id="${id}" ${produto._esgotado ? 'disabled style="opacity:0.5;cursor:default"' : ''}>+ ${produto._esgotado ? 'Esgotado' : 'Adicionar ao carrinho'}</button>
            </div>
          </div>
        </a>
        <div class="product-card__info">
          <p class="product-card__category">${escHtml((categoria || '').charAt(0).toUpperCase() + (categoria || '').slice(1))}</p>
          <h3 class="product-card__name"><a href="${link}">${escHtml(nome)}</a></h3>
          <div class="product-card__price">${precoHtml}</div>
          ${produto._esgotado ? '' : `<p class="product-card__payment">Até 12x no cartão · <strong>5% OFF no PIX</strong></p>`}
          ${swatchesHtml ? `<div class="product-card__swatches">${swatchesHtml}</div>` : ''}
        </div>
      </article>`;
  }

  /* ── RENDERIZA LISTA NO CONTAINER ─────────── */
  async function renderGrid(containerId, filtros = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Inject skeleton cards while data loads
    const SKELETON_COUNT = filtros.limite || 8;
    const skeletonCard = `
      <article class="product-card product-card--skeleton">
        <a class="product-card__img-wrap" tabindex="-1" aria-hidden="true">
          <span class="skeleton-block" style="width:100%;height:100%;border-radius:0;display:block;"></span>
        </a>
        <div class="product-card__info">
          <span class="skeleton-block skeleton-name"></span>
          <span class="skeleton-block skeleton-cat"></span>
          <span class="skeleton-block skeleton-price"></span>
        </div>
      </article>`;
    container.innerHTML = Array(SKELETON_COUNT).fill(skeletonCard).join('');

    const data = await fetchAll();
    if (!data) {
      container.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:3rem;font-family:var(--font-body);color:#c62828">Erro ao carregar produtos.</p>`;
      return;
    }

    let lista = data.produtos.filter(p => p.ativo);

    // Filtros
    if (filtros.categoria && filtros.categoria !== 'todas') {
      lista = lista.filter(p => p.categoria === filtros.categoria);
    }
    if (filtros.novidade)  lista = lista.filter(p => p.novidade);
    if (filtros.destaque)  lista = lista.filter(p => p.destaque);
    if (filtros.sale)      lista = lista.filter(p => !!p.preco_desconto);
    if (filtros.limite)    lista = lista.slice(0, filtros.limite);

    if (lista.length === 0) {
      container.innerHTML = `<div class="no-results" style="grid-column:1/-1;text-align:center;padding:4rem;font-family:var(--font-body);color:var(--color-text-light)">Nenhum produto encontrado.</div>`;
      return;
    }

    container.innerHTML = lista.map((p, i) => renderCard(p, { index: i })).join('');
    initCardEvents(container);
    return lista;
  }

  /* ── RENDERIZA CARROSSEL (home) ───────────── */
  async function renderCarousel(containerId, filtros = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = await fetchAll();
    if (!data) return;

    let lista = data.produtos.filter(p => p.ativo);
    if (filtros.novidade) lista = lista.filter(p => p.novidade);
    if (filtros.destaque) lista = lista.filter(p => p.destaque);
    if (filtros.limite)   lista = lista.slice(0, filtros.limite);

    container.innerHTML = lista.map((p, i) => renderCard(p, { index: i })).join('');
    initCardEvents(container);
  }

  /* ── CARREGA CONFIGURAÇÕES (home banners) ─── */
  async function getConfig() {
    const data = await fetchAll();
    return data?.configuracoes || null;
  }

  /* ── APLICA CONFIG DO BANNER NA HOME ──────── */
  async function applyHomeBanners() {
    const cfg = await getConfig();
    if (!cfg) return;

    // Banner principal hero
    const b = cfg.banner_home;
    const tl1 = document.getElementById('heroLine1');
    const tl2 = document.getElementById('heroLine2');
    const tsub = document.getElementById('heroSubtitle');
    const tcta = document.getElementById('heroCta');
    if (b) {
      if (tl1 && b.titulo_linha1) tl1.textContent = b.titulo_linha1;
      if (tl2 && b.titulo_linha2) {
        // Hífen isolado → travessão em span não-itálico (evita o efeito "torto" da fonte itálica)
        const SEP = '<span class="hero__dash"> &#8211; </span>';
        tl2.innerHTML = b.titulo_linha2
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // sanitiza
          .replace(/ - /g, SEP);
      }
      if (tsub && b.subtitulo)    tsub.textContent = b.subtitulo;
      if (tcta) { tcta.textContent = b.cta_texto; tcta.href = b.cta_link; }
    }

    // Banner editorial
    const e = cfg.banner_editorial;
    const etit = document.getElementById('editorialTitle');
    const etxt = document.getElementById('editorialText');
    const ecta = document.getElementById('editorialCta');
    if (e) {
      if (etit && e.titulo) etit.textContent = e.titulo;
      if (etxt && e.texto)  etxt.textContent = e.texto;
      if (ecta) { ecta.textContent = e.cta_texto; ecta.href = e.cta_link; }
    }
  }

  /* ── APLICA DIFERENCIAIS E NEWSLETTER NA HOME ─ */
  async function applyHomeExtras() {
    const cfg = await getConfig();
    if (!cfg) return;

    // Diferenciais
    const difs = cfg.diferenciais;
    if (Array.isArray(difs)) {
      difs.forEach((d, i) => {
        const t = document.getElementById(`dif${i}Titulo`);
        const p = document.getElementById(`dif${i}Desc`);
        if (t && d.titulo)   t.textContent = d.titulo;
        if (p && d.descricao) p.textContent = d.descricao;
      });
    }

    // Newsletter (index.html)
    const nTit = document.getElementById('newsletterTitulo');
    const nSub = document.getElementById('newsletterSubtitulo');
    if (nTit && cfg.newsletter_titulo)    nTit.textContent = cfg.newsletter_titulo;
    if (nSub && cfg.newsletter_subtitulo) nSub.textContent = cfg.newsletter_subtitulo;
    const nBen = document.getElementById('newsletterBeneficios');
    if (nBen && Array.isArray(cfg.newsletter_beneficios)) {
      nBen.innerHTML = cfg.newsletter_beneficios
        .map(b => `<li>${escHtml(b)}</li>`).join('');
    }
  }

  /* ── EVENTOS DOS CARDS ────────────────────── */
  function initCardEvents(container) {
    // Wishlist: gerenciado pelo wishlist.js via event delegation global (sem stopPropagation)

    // Quick add
    container.querySelectorAll('.product-card__quick-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        // Redireciona para a página do produto para escolher cor e tamanho
        const prodId = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
        if (prodId) window.location.href = `produto.html?id=${prodId}`;
      });
    });

    // Swatch hover
    container.querySelectorAll('.product-card__swatch').forEach(sw => {
      sw.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        sw.closest('.product-card__swatches')?.querySelectorAll('.product-card__swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
      });
    });

    // Scroll reveal
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(entries => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });

      container.querySelectorAll('.product-card').forEach((card, i) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(18px)';
        card.style.transition = `opacity 0.5s ease ${i * 0.06}s, transform 0.5s ease ${i * 0.06}s`;
        obs.observe(card);
      });
    }
  }

  // API pública
  return { fetchAll, renderGrid, renderCarousel, getConfig, applyHomeBanners, applyHomeExtras, renderCard, formatCurrency };

})();
