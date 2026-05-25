/* ============================================================
   VIRTÙ — Catálogo JavaScript
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
  const catSidebar       = document.getElementById('catSidebar');
  const filterToggleMobile = document.getElementById('filterToggleMobile');

  // Criar overlay da sidebar
  const sidebarOverlay = document.createElement('div');
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

  // ── TAMANHOS ───────────────────────────────
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.size-grid')?.querySelectorAll('.size-btn').forEach(b => b.classList.remove('size-btn--active'));
      btn.classList.toggle('size-btn--active');
      applyFilters();
    });
  });

  // ── CORES ──────────────────────────────────
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('color-btn--active');
      applyFilters();
    });
  });

  // ── FILTRO POR CATEGORIA (PILLS) ───────────
  const catPills = document.querySelectorAll('.cat-pill');
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catPills.forEach(p => p.classList.remove('cat-pill--active'));
      pill.classList.add('cat-pill--active');

      const cat = pill.getAttribute('data-cat');
      const catTitle = document.getElementById('catTitle');
      const breadcrumb = document.getElementById('breadcrumbCurrent');

      if (catTitle) catTitle.textContent = cat === 'todas' ? 'Todas as Peças' : pill.textContent.replace(' ✦','');
      if (breadcrumb) breadcrumb.textContent = cat === 'todas' ? 'Todas as peças' : pill.textContent.replace(' ✦','');

      applyFilters();
    });
  });

  // ── PREÇO RANGE ────────────────────────────
  const priceMin = document.getElementById('priceMin');
  const priceMax = document.getElementById('priceMax');
  const priceMinLabel = document.getElementById('priceMinLabel');
  const priceMaxLabel = document.getElementById('priceMaxLabel');
  const priceFill = document.getElementById('priceRangeFill');

  function updatePriceRange() {
    const min = parseInt(priceMin?.value || 0);
    const max = parseInt(priceMax?.value || 800);
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
    const activeCat = document.querySelector('.cat-pill--active')?.getAttribute('data-cat') || 'todas';
    const minPrice  = parseInt(priceMin?.value || 0);
    const maxPrice  = parseInt(priceMax?.value || 800);

    const products = document.querySelectorAll('.product-card[data-cat]');
    let visibleCount = 0;

    products.forEach(product => {
      const cat   = product.getAttribute('data-cat');
      const price = parseInt(product.getAttribute('data-price') || 0);
      const isSale = product.querySelector('.product-card__badge--sale') !== null;

      const matchCat   = activeCat === 'todas' || activeCat === cat || (activeCat === 'sale' && isSale);
      const matchPrice = price >= minPrice && price <= maxPrice;

      const shouldShow = matchCat && matchPrice;
      product.classList.toggle('product-card--hidden', !shouldShow);
      if (shouldShow) visibleCount++;
    });

    // Atualiza contagem
    const sortCount = document.getElementById('sortCount');
    const catCount  = document.getElementById('catCount');
    if (sortCount) sortCount.innerHTML = `Exibindo <strong>${visibleCount}</strong> produto${visibleCount !== 1 ? 's' : ''}`;
    if (catCount)  catCount.textContent = `${visibleCount} produto${visibleCount !== 1 ? 's' : ''}`;

    // Sem resultados
    const noResults = document.getElementById('noResults');
    if (noResults) noResults.hidden = visibleCount > 0;
  }

  // ── LIMPAR FILTROS ─────────────────────────
  function clearAllFilters() {
    catPills.forEach(p => p.classList.remove('cat-pill--active'));
    document.querySelector('[data-cat="todas"]')?.classList.add('cat-pill--active');
    if (priceMin) priceMin.value = 0;
    if (priceMax) priceMax.value = 800;
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('size-btn--active'));
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('color-btn--active'));
    document.querySelectorAll('.filter-option input').forEach(cb => cb.checked = false);
    const firstCb = document.querySelector('.filter-option input');
    if (firstCb) firstCb.checked = true;
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
    grid?.classList.replace('products-grid--2', 'products-grid--4');
    view4.classList.add('view-btn--active'); view4.setAttribute('aria-pressed','true');
    view2?.classList.remove('view-btn--active'); view2?.setAttribute('aria-pressed','false');
  });

  view2?.addEventListener('click', () => {
    grid?.classList.replace('products-grid--4', 'products-grid--2');
    view2.classList.add('view-btn--active'); view2.setAttribute('aria-pressed','true');
    view4?.classList.remove('view-btn--active'); view4?.setAttribute('aria-pressed','false');
  });

  // ── ORDENAÇÃO ──────────────────────────────
  document.getElementById('sortSelect')?.addEventListener('change', function () {
    const products = [...document.querySelectorAll('.product-card[data-cat]')];
    const grid = document.getElementById('productsGrid');

    products.sort((a, b) => {
      const pa = parseInt(a.getAttribute('data-price') || 0);
      const pb = parseInt(b.getAttribute('data-price') || 0);
      if (this.value === 'price-asc')  return pa - pb;
      if (this.value === 'price-desc') return pb - pa;
      return 0;
    });

    products.forEach(p => grid?.appendChild(p));
  });

  // ── CARREGAMENTO DINÂMICO DO JSON ─────────
  // Carrega os produtos e depois aplica filtros de URL
  async function initProducts() {
    // Descobre filtro da URL antes de carregar
    const params   = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');

    // Mapeia "novidades" e "sale" para filtros especiais
    let filtroInicial = {};
    if (catParam === 'novidades') filtroInicial = { novidade: true };
    else if (catParam === 'sale') filtroInicial = { sale: true };

    // Renderiza os cards no grid via VirtuProducts
    await VirtuProducts.renderGrid('productsGrid', filtroInicial);

    // Aplica filtro de categoria via pill (ativa a pill correta)
    if (catParam) {
      const pill = document.querySelector(`[data-cat="${catParam}"]`);
      if (pill) {
        pill.click();
        pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        // Categoria específica sem pill (ex: ?cat=vestidos)
        applyFilters();
      }
    } else {
      applyFilters();
    }
  }

  initProducts();

});
