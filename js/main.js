/* ============================================================
   VIRTÙ — Main JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ──────────────────────────────────────────
  // 1. NAVBAR — scroll shadow
  // ──────────────────────────────────────────
  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
  }

  // ──────────────────────────────────────────
  // 2. MOBILE MENU
  // ──────────────────────────────────────────
  const menuToggle  = document.getElementById('menuToggle');
  const mobileMenu  = document.getElementById('mobileMenu');
  const menuClose   = document.getElementById('menuClose');
  const menuOverlay = document.getElementById('menuOverlay');

  function openMenu() {
    mobileMenu?.classList.add('open');
    document.body.style.overflow = 'hidden';
    menuToggle?.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    mobileMenu?.classList.remove('open');
    document.body.style.overflow = '';
    menuToggle?.setAttribute('aria-expanded', 'false');
  }

  menuToggle?.addEventListener('click', openMenu);
  menuClose?.addEventListener('click', closeMenu);
  menuOverlay?.addEventListener('click', closeMenu);

  // Fechar com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      closeSearch();
    }
  });

  // ──────────────────────────────────────────
  // 3. SEARCH OVERLAY
  // ──────────────────────────────────────────
  const searchOverlay       = document.getElementById('searchOverlay');
  const searchToggle        = document.getElementById('searchToggle');
  const searchToggleDesktop = document.getElementById('searchToggleDesktop');
  const searchClose         = document.getElementById('searchClose');

  function openSearch() {
    searchOverlay?.classList.add('open');
    searchOverlay?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      searchOverlay?.querySelector('.search-overlay__input')?.focus();
    }, 100);
  }

  function closeSearch() {
    searchOverlay?.classList.remove('open');
    searchOverlay?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  searchToggle?.addEventListener('click', openSearch);
  searchToggleDesktop?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);

  // Clicar fora do form fecha
  searchOverlay?.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
  });

  // ──────────────────────────────────────────
  // 4. HERO SLIDER
  // ──────────────────────────────────────────
  const heroSlider = document.getElementById('heroSlider');
  if (heroSlider) {
    const slides  = heroSlider.querySelectorAll('.hero__slide');
    const dots    = document.querySelectorAll('.hero__dot');
    const prevBtn = document.getElementById('heroPrev');
    const nextBtn = document.getElementById('heroNext');
    let current   = 0;
    let autoplay;

    function goToSlide(n) {
      slides[current].classList.remove('hero__slide--active');
      dots[current]?.classList.remove('hero__dot--active');
      dots[current]?.setAttribute('aria-selected', 'false');

      current = (n + slides.length) % slides.length;

      slides[current].classList.add('hero__slide--active');
      dots[current]?.classList.add('hero__dot--active');
      dots[current]?.setAttribute('aria-selected', 'true');
    }

    function startAutoplay() {
      autoplay = setInterval(() => goToSlide(current + 1), 5500);
    }

    function resetAutoplay() {
      clearInterval(autoplay);
      startAutoplay();
    }

    prevBtn?.addEventListener('click', () => { goToSlide(current - 1); resetAutoplay(); });
    nextBtn?.addEventListener('click', () => { goToSlide(current + 1); resetAutoplay(); });

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => { goToSlide(i); resetAutoplay(); });
    });

    // Swipe support
    let touchStartX = 0;
    heroSlider.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    heroSlider.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        goToSlide(diff > 0 ? current + 1 : current - 1);
        resetAutoplay();
      }
    });

    startAutoplay();
  }

  // ──────────────────────────────────────────
  // 5. PRODUCT CAROUSEL (Novidades)
  // ──────────────────────────────────────────
  const carousel = document.getElementById('novidadesCarousel');
  if (carousel) {
    const prevBtn = document.getElementById('novPrev');
    const nextBtn = document.getElementById('novNext');

    function getScrollAmount() {
      const card = carousel.querySelector('.product-card');
      return card ? card.offsetWidth + 20 : 280;
    }

    prevBtn?.addEventListener('click', () => {
      carousel.scrollBy({ left: -getScrollAmount() * 2, behavior: 'smooth' });
    });

    nextBtn?.addEventListener('click', () => {
      carousel.scrollBy({ left: getScrollAmount() * 2, behavior: 'smooth' });
    });
  }

  // ──────────────────────────────────────────
  // 6. WISHLIST TOGGLE
  // ──────────────────────────────────────────
  document.querySelectorAll('.product-card__wishlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.toggle('active');
      const isActive = btn.classList.contains('active');
      btn.setAttribute('aria-label', isActive ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
    });
  });

  // ──────────────────────────────────────────
  // 7. PRODUCT SWATCH SELECTION
  // ──────────────────────────────────────────
  document.querySelectorAll('.product-card__swatches').forEach(swatchGroup => {
    swatchGroup.querySelectorAll('.product-card__swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        swatchGroup.querySelectorAll('.product-card__swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });
  });

  // ──────────────────────────────────────────
  // 8. QUICK ADD TO CART
  // ──────────────────────────────────────────
  document.querySelectorAll('.product-card__quick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Redireciona para a página do produto para escolher cor e tamanho
      const prodId = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
      if (prodId) window.location.href = `produto.html?id=${prodId}`;
    });
  });

  // ──────────────────────────────────────────
  // 9. NEWSLETTER FORM
  // ──────────────────────────────────────────
  const newsletterForm    = document.getElementById('newsletterForm');
  const newsletterSuccess = document.getElementById('newsletterSuccess');
  const newsletterEmail   = document.getElementById('newsletterEmail');

  newsletterForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = newsletterEmail?.value.trim();

    if (!email || !email.includes('@')) {
      newsletterEmail?.focus();
      newsletterEmail?.classList.add('input--error');
      setTimeout(() => newsletterEmail?.classList.remove('input--error'), 2000);
      return;
    }

    // Simula envio
    newsletterForm.hidden = true;
    if (newsletterSuccess) newsletterSuccess.hidden = false;
  });

  // ──────────────────────────────────────────
  // 10. SCROLL REVEAL (Intersection Observer)
  // ──────────────────────────────────────────
  const observerOptions = {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px',
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Anima seções ao rolar
  document.querySelectorAll(
    '.diferencial, .categoria-card, .product-card, .editorial-banner__content, .newsletter__content, .insta-item'
  ).forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity 0.6s ease ${i * 0.05}s, transform 0.6s ease ${i * 0.05}s`;
    revealObserver.observe(el);
  });

  // CSS para .revealed
  const style = document.createElement('style');
  style.textContent = `.revealed { opacity: 1 !important; transform: translateY(0) !important; }`;
  document.head.appendChild(style);

  // ──────────────────────────────────────────
  // CARREGAMENTO DINÂMICO — products.json
  // ──────────────────────────────────────────
  if (typeof VirtuProducts !== 'undefined') {
    // Seção Novidades (carrossel)
    VirtuProducts.renderCarousel('novidadesCarousel', { novidade: true, limite: 5 });

    // Seção Destaques (grid)
    VirtuProducts.renderCarousel('destaquesGrid', { destaque: true, limite: 4 });

    // Aplica textos editáveis do banner (home)
    VirtuProducts.applyHomeBanners();
  }

});
