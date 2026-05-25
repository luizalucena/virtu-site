/* ============================================================
   VIRTÙ — Contato JavaScript
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
  const searchOverlay = document.getElementById('searchOverlay');
  const searchToggle  = document.getElementById('searchToggle');
  const searchClose   = document.getElementById('searchClose');

  const openSearch  = () => { searchOverlay?.classList.add('open'); searchOverlay?.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100); };
  const closeSearch = () => { searchOverlay?.classList.remove('open'); searchOverlay?.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; };

  searchToggle?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeSearch(); } });

  // ── CONTADOR DE CARACTERES ─────────────────
  const textarea  = document.getElementById('cMessage');
  const charCount = document.getElementById('charCount');
  const MAX_CHARS = 500;

  textarea?.addEventListener('input', () => {
    const len = textarea.value.length;
    if (charCount) {
      charCount.textContent = len;
      charCount.style.color = len > MAX_CHARS * 0.9 ? '#c62828' : '';
    }
    if (textarea.value.length > MAX_CHARS) {
      textarea.value = textarea.value.slice(0, MAX_CHARS);
    }
  });

  // ── FORMULÁRIO DE CONTATO ──────────────────
  document.getElementById('contactForm')?.addEventListener('submit', function (e) {
    e.preventDefault();

    const name    = document.getElementById('cName')?.value.trim();
    const email   = document.getElementById('cEmail')?.value.trim();
    const message = document.getElementById('cMessage')?.value.trim();

    if (!name || !email || !message) {
      ['cName', 'cEmail', 'cMessage'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
          el.style.borderColor = '#c62828';
          el.addEventListener('input', () => { el.style.borderColor = ''; }, { once: true });
        }
      });
      return;
    }

    // Feedback visual no botão
    const btn = document.getElementById('contactSubmit');
    if (btn) {
      btn.innerHTML = 'Enviando…';
      btn.disabled = true;
    }

    // Simula envio
    setTimeout(() => {
      const success = document.getElementById('contactSuccess');
      if (success) success.hidden = false;
      if (btn) { btn.innerHTML = '✓ Enviado'; }
      this.reset();
      if (charCount) charCount.textContent = '0';
      success?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 1200);
  });

  // ── NEWSLETTER ─────────────────────────────
  document.getElementById('newsletterForm')?.addEventListener('submit', function (e) {
    e.preventDefault();

    const name  = document.getElementById('nlName')?.value.trim();
    const email = document.getElementById('nlEmail')?.value.trim();

    if (!name || !email) {
      ['nlName', 'nlEmail'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
          el.style.borderColor = '#f44336';
          el.addEventListener('input', () => { el.style.borderColor = ''; }, { once: true });
        }
      });
      return;
    }

    // Simula assinatura
    setTimeout(() => {
      const success = document.getElementById('nlSuccess');
      if (success) success.hidden = false;
      this.reset();
    }, 800);
  });

  // ── SCROLL REVEAL ──────────────────────────
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('revealed'); revealObs.unobserve(e.target); }
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.contato-info__block, .contato-faq').forEach((el, i) => {
    el.style.cssText = `opacity:0;transform:translateY(16px);transition:opacity 0.5s ease ${i*0.07}s,transform 0.5s ease ${i*0.07}s`;
    revealObs.observe(el);
  });

  const style = document.createElement('style');
  style.textContent = '.revealed{opacity:1!important;transform:translateY(0)!important}';
  document.head.appendChild(style);

});
