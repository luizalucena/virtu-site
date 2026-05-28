/* ============================================================
   VIRTÙ — Catálogo JavaScript
   Filtros: categoria, tamanho, cor e preço — todos funcionais
   Tamanhos e cores carregados do Supabase (configuracoes)
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
  const searchToggleDesktop = document.getElementById('searchToggleDesktop');
  const searchClose         = document.getElementById('searchClose');

  const openSearch  = () => { searchOverlay?.classList.add('open'); searchOverlay?.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100); };
  const closeSearch = () => { searchOverlay?.classList.remove('open'); searchOverlay?.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; };

  searchToggle?.addEventListener('click', openSearch);
  searchToggleDesktop?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeSearch(); closeSidebar(); }
  });

  // ── FILTRO MOBILE (SIDEBAR DRAWER) ─────────
  const catSidebar         = document.getElementById('catSidebar');
  const filterToggleMobile = document.getElementById('filterToggleMobile');
  const sidebarOverlay     = document.createElement('div');
  sidebarOverlay.className = 'cat-sidebar-overlay';
  document.body.appendChild(sidebarOverlay);

  const openSidebar  = () => { catSidebar?.classList.add('open'); sidebarOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const closeSidebar = () => { catSidebar?.classList.remove('open'); sidebarOverlay.classList.remove('open'); document.body.style.overflow = ''; };

  filterToggleMobile?.addEventListener('click', openSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  // ── TOGGLE BLOCOS SIDEBAR ──────────────────
  document.querySelectorAll('.sidebar-block__title').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle');
      const content  = document.getElementById(targetId);
      const isOpen   = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !isOpen);
      content?.classList.toggle('sidebar-block__content--hidden', isOpen);
    });
  });

  // ── FILTRO POR CATEGORIA (PILLS + SIDEBAR CHECKBOXES) ──
  // Mapa texto do checkbox → data-cat do pill
  const catMap = {
    'Todas': 'todas', 'Vestidos': 'vestidos',
    'Blusas': 'blusas', 'Calças': 'calcas', 'Essenciais': 'essenciais'
  };

  // Sincroniza sidebar checkboxes com o pill ativo
  function syncSidebarCheckboxes(activeCatValue) {
    document.querySelectorAll('#filtro-cat .filter-option input[type="checkbox"]').forEach(cb => {
      const label = cb.closest('.filter-option')?.querySelector('span')?.textContent.trim();
      cb.checked = (catMap[label] || 'todas') === activeCatValue;
    });
  }

  const catPills = document.querySelectorAll('.cat-pill');
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catPills.forEach(p => p.classList.remove('cat-pill--active'));
      pill.classList.add('cat-pill--active');
      const cat = pill.getAttribute('data-cat');
      const catTitle   = document.getElementById('catTitle');
      const breadcrumb = document.getElementById('breadcrumbCurrent');
      if (catTitle)   catTitle.textContent   = cat === 'todas' ? 'Todas as Peças' : pill.textContent.replace(' ✦','');
      if (breadcrumb) breadcrumb.textContent = cat === 'todas' ? 'Todas as peças' : pill.textContent.replace(' ✦','');
      syncSidebarCheckboxes(cat);
      applyFilters();
    });
  });

  // Sidebar checkboxes → ativam o pill correspondente (comportamento radio)
  document.querySelectorAll('#filtro-cat .filter-option input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (!cb.checked) { cb.checked = true; return; } // não deixa desmarcar
      const label    = cb.closest('.filter-option')?.querySelector('span')?.textContent.trim();
      const catValue = catMap[label] || 'todas';
      // Ativa o pill correspondente (dispara evento e sincroniza tudo)
      const targetPill = document.querySelector(`.cat-pill[data-cat="${catValue}"]`);
      if (targetPill) { targetPill.click(); return; }
      // Fallback: aplica direto se não encontrar pill
      catPills.forEach(p => p.classList.remove('cat-pill--active'));
      syncSidebarCheckboxes(catValue);
      applyFilters();
    });
  });

  // ── PREÇO RANGE ────────────────────────────
  const priceMin      = document.getElementById('priceMin');
  const priceMax      = document.getElementById('priceMax');
  const priceMinLabel = document.getElementById('priceMinLabel');
  const priceMaxLabel = document.getElementById('priceMaxLabel');
  const priceFill     = document.getElementById('priceRangeFill');

  function updatePriceRange() {
    const min   = parseInt(priceMin?.value || 0);
    const max   = parseInt(priceMax?.value || 800);
    const total = 800;
    if (priceMinLabel) priceMinLabel.textContent = `R$ ${min}`;
    if (priceMaxLabel) priceMaxLabel.textContent = `R$ ${max}`;
    if (priceFill) {
      priceFill.style.left  = `${(min / total) * 100}%`;
      priceFill.style.right = `${100 - (max / total) * 100}%`;
    }
    applyFilters();
  }

  priceMin?.addEventListener('input', () => {
    if (parseInt(priceMin.value) > parseInt(priceMax.value)) priceMin.value = priceMax.value;
    updatePriceRange();
  });
  priceMax?.addEventListener('input', () => {
    if (parseInt(priceMax.value) < parseInt(priceMin.value)) priceMax.value = priceMin.value;
    updatePriceRange();
  });

  updatePriceRange();

  // ── LÓGICA PRINCIPAL DE FILTROS ────────────
  function applyFilters() {
    const activeCat  = document.querySelector('.cat-pill--active')?.getAttribute('data-cat') || 'todas';
    const minPrice   = parseInt(priceMin?.value || 0);
    const maxPrice   = parseInt(priceMax?.value || 800);

    // Tamanhos ativos
    const activeSizes = [...document.querySelectorAll('#sizeGrid .size-btn.size-btn--active')]
      .map(b => b.dataset.size || b.textContent.trim());

    // Cores ativas (hex, minúsculas)
    const activeColors = [...document.querySelectorAll('#colorGrid .color-btn.color-btn--active')]
      .map(b => (b.dataset.hex || '').toLowerCase());

    const products = document.querySelectorAll('.product-card[data-cat]');
    let visibleCount = 0;

    products.forEach(product => {
      const cat    = product.getAttribute('data-cat');
      const price  = parseInt(product.getAttribute('data-price') || 0);
      const sizes  = (product.getAttribute('data-sizes')  || '').split(',').filter(Boolean);
      const colors = (product.getAttribute('data-colors') || '').split(',').filter(Boolean).map(c => c.toLowerCase());
      const isSale      = !!product.querySelector('.product-card__badge--sale');
      const isEssencial = product.getAttribute('data-essencial') === 'true' || cat === 'essenciais';

      const matchCat   = activeCat === 'todas'
        || activeCat === cat
        || (activeCat === 'sale'       && isSale)
        || (activeCat === 'essenciais' && isEssencial);
      const matchPrice = price >= minPrice && price <= maxPrice;
      // Nenhum filtro de tamanho ativo → mostra tudo; senão verifica interseção
      const matchSize  = activeSizes.length === 0  || activeSizes.some(s  => sizes.includes(s));
      // Nenhum filtro de cor ativo → mostra tudo; senão verifica interseção
      const matchColor = activeColors.length === 0 || activeColors.some(c => colors.includes(c));

      const shouldShow = matchCat && matchPrice && matchSize && matchColor;
      product.classList.toggle('product-card--hidden', !shouldShow);
      if (shouldShow) visibleCount++;
    });

    // Atualiza contagem
    const sortCount = document.getElementById('sortCount');
    const catCount  = document.getElementById('catCount');
    if (sortCount) sortCount.innerHTML = `Exibindo <strong>${visibleCount}</strong> produto${visibleCount !== 1 ? 's' : ''}`;
    if (catCount)  catCount.textContent = `${visibleCount} produto${visibleCount !== 1 ? 's' : ''}`;

    const noResults = document.getElementById('noResults');
    if (noResults) noResults.hidden = visibleCount > 0;
  }

  // ── LIMPAR FILTROS ─────────────────────────
  function clearAllFilters() {
    catPills.forEach(p => p.classList.remove('cat-pill--active'));
    document.querySelector('[data-cat="todas"]')?.classList.add('cat-pill--active');
    if (priceMin) priceMin.value = 0;
    if (priceMax) priceMax.value = 800;
    document.querySelectorAll('#sizeGrid  .size-btn').forEach(b  => b.classList.remove('size-btn--active'));
    document.querySelectorAll('#colorGrid .color-btn').forEach(b => b.classList.remove('color-btn--active'));
    syncSidebarCheckboxes('todas');
    updatePriceRange();
    applyFilters();
  }

  document.getElementById('clearFilters')?.addEventListener('click', clearAllFilters);
  document.getElementById('clearFilters2')?.addEventListener('click', clearAllFilters);

  // ── VIEW TOGGLE (4 ou 2 colunas) ──────────
  const view4 = document.getElementById('view4');
  const view2 = document.getElementById('view2');
  const grid  = document.getElementById('productsGrid');

  view4?.addEventListener('click', () => {
    grid?.classList.replace('products-grid--2','products-grid--4');
    view4.classList.add('view-btn--active');     view4.setAttribute('aria-pressed','true');
    view2?.classList.remove('view-btn--active'); view2?.setAttribute('aria-pressed','false');
  });
  view2?.addEventListener('click', () => {
    grid?.classList.replace('products-grid--4','products-grid--2');
    view2.classList.add('view-btn--active');     view2.setAttribute('aria-pressed','true');
    view4?.classList.remove('view-btn--active'); view4?.setAttribute('aria-pressed','false');
  });

  // ── ORDENAÇÃO ──────────────────────────────
  document.getElementById('sortSelect')?.addEventListener('change', function () {
    const prods = [...document.querySelectorAll('.product-card[data-cat]')];
    prods.sort((a, b) => {
      const pa = parseInt(a.getAttribute('data-price') || 0);
      const pb = parseInt(b.getAttribute('data-price') || 0);
      if (this.value === 'price-asc')  return pa - pb;
      if (this.value === 'price-desc') return pb - pa;
      return 0;
    });
    prods.forEach(p => grid?.appendChild(p));
  });

  // ── TAMANHOS E CORES: DELEGAÇÃO DE EVENTOS ──
  // (funciona mesmo após render dinâmico)
  document.getElementById('sizeGrid')?.addEventListener('click', e => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    btn.classList.toggle('size-btn--active');
    applyFilters();
  });

  document.getElementById('colorGrid')?.addEventListener('click', e => {
    const btn = e.target.closest('.color-btn');
    if (!btn) return;
    btn.classList.toggle('color-btn--active');
    applyFilters();
  });

  // ── CARREGAR FILTROS DINÂMICOS DO SUPABASE ──
  async function loadFiltrosDinamicos() {
    const cfg = await VirtuProducts.getConfig();

    // Tamanhos
    const tamanhos = cfg?.filtros_tamanhos || ['PP','P','M','G','GG','XG'];
    const sizeGrid = document.getElementById('sizeGrid');
    if (sizeGrid) {
      sizeGrid.innerHTML = tamanhos.map(t =>
        `<button class="size-btn" data-size="${t}">${t}</button>`
      ).join('');
    }

    // Cores
    const cores = cfg?.filtros_cores || [
      {nome:'Azul Âncora',hex:'#2B3F54'},{nome:'Dourado',hex:'#C4934A'},
      {nome:'Cru',hex:'#E8D5B5'},{nome:'Preto',hex:'#1a1a1a'},
      {nome:'Off-White',hex:'#F9F7F4'},{nome:'Cinza',hex:'#6E6660'},
      {nome:'Terracota',hex:'#8B6F5E'},{nome:'Rosa',hex:'#D4A5A5'}
    ];
    const colorGrid = document.getElementById('colorGrid');
    if (colorGrid) {
      colorGrid.innerHTML = cores.map(c => {
        const hex = c.hex.toLowerCase();
        const isLight = ['#f9f7f4','#e8d5b5','#ffffff','#ffffff'].includes(hex);
        return `<button class="color-btn" style="background:${c.hex}${isLight ? ';border:1px solid #ccc' : ''}"
                  title="${c.nome}" aria-label="${c.nome}" data-hex="${hex}"></button>`;
      }).join('');
    }
  }

  // ── INIT PRINCIPAL ─────────────────────────
  async function initProducts() {
    const params   = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');

    let filtroInicial = {};
    if (catParam === 'novidades') filtroInicial = { novidade: true };
    else if (catParam === 'sale') filtroInicial = { sale: true };

    // Carrega filtros dinâmicos e produtos em paralelo (mesma chamada fetchAll, cache compartilhado)
    await Promise.all([
      loadFiltrosDinamicos(),
      VirtuProducts.renderGrid('productsGrid', filtroInicial)
    ]);

    if (catParam) {
      const pill = document.querySelector(`[data-cat="${catParam}"]`);
      if (pill) {
        pill.click();
        pill.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
      } else {
        applyFilters();
      }
    } else {
      applyFilters();
    }
  }

  initProducts();

});
