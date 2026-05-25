/* ============================================================
   VIRTÙ — Sobre JavaScript
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

  const openMenu  = () => {
    mobileMenu?.classList.add('open');
    document.body.style.overflow = 'hidden';
    menuToggle?.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    mobileMenu?.classList.remove('open');
    document.body.style.overflow = '';
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', openMenu);
  menuClose?.addEventListener('click', closeMenu);
  menuOverlay?.addEventListener('click', closeMenu);

  // ── SEARCH OVERLAY ─────────────────────────
  const searchOverlay       = document.getElementById('searchOverlay');
  const searchToggle        = document.getElementById('searchToggle');
  const searchToggleDesktop = document.getElementById('searchToggleDesktop');
  const searchClose         = document.getElementById('searchClose');

  const openSearch = () => {
    searchOverlay?.classList.add('open');
    searchOverlay?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => searchOverlay?.querySelector('.search-overlay__input')?.focus(), 100);
  };
  const closeSearch = () => {
    searchOverlay?.classList.remove('open');
    searchOverlay?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  searchToggle?.addEventListener('click', openSearch);
  searchToggleDesktop?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });

  // Fechar com Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeSearch(); }
  });

  // ── CONTAGEM ANIMADA ────────────────────────
  function animateCounter(el, target, duration = 1600) {
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
      const current = Math.round(eased * target);
      el.textContent = current.toLocaleString('pt-BR');
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    const counterObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const target = parseInt(e.target.getAttribute('data-target'));
          animateCounter(e.target, target);
          counterObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('.sobre-numero__value[data-target]').forEach(el => {
      counterObs.observe(el);
    });
  }

  // ── SCROLL REVEAL ──────────────────────────
  if ('IntersectionObserver' in window) {
    const style = document.createElement('style');
    style.textContent = '.revealed { opacity:1 !important; transform:translateY(0) !important; }';
    document.head.appendChild(style);

    const revealObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });

    const revealTargets = document.querySelectorAll(
      '.sobre-valor, .envio-card, .pagamento-item, .sobre-manifesto__text p, .sobre-fundadora__text p'
    );
    revealTargets.forEach((el, i) => {
      el.style.cssText = `opacity:0;transform:translateY(20px);transition:opacity 0.55s ease ${i * 0.07}s, transform 0.55s ease ${i * 0.07}s`;
      revealObs.observe(el);
    });
  }

  // ── NEWSLETTER ─────────────────────────────
  const newsletterForm  = document.getElementById('newsletterForm');
  const newsletterEmail = document.getElementById('newsletterEmail');
  const newsletterMsg   = document.getElementById('newsletterMsg');

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = newsletterEmail?.value.trim();
      const btn   = newsletterForm.querySelector('.sobre-newsletter__btn');
      const label = btn?.querySelector('.btn-label');
      const load  = btn?.querySelector('.btn-loading');

      // Validação básica
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMsg('Por favor, insira um e-mail válido.', 'error');
        newsletterEmail?.focus();
        return;
      }

      // Loading state
      if (label) label.hidden = true;
      if (load)  load.hidden  = false;
      if (btn)   btn.disabled = true;

      try {
        /*
         * INTEGRAÇÃO MAILCHIMP
         * ─────────────────────
         * Substitua MAILCHIMP_ACTION_URL pela URL do seu formulário Mailchimp.
         * Para encontrar: Mailchimp → Audience → Signup forms → Embedded forms
         * Copie a URL do atributo "action" do form e cole abaixo.
         *
         * Exemplo:
         * https://seudomain.us1.list-manage.com/subscribe/post?u=XXXXX&id=XXXXX
         *
         * Como JSONP não funciona com fetch por CORS, usamos um iframe oculto
         * que é a técnica padrão para formulários Mailchimp sem backend.
         */
        const MAILCHIMP_URL = ''; // ← Cole sua URL aqui

        if (!MAILCHIMP_URL) {
          // Modo demonstração (enquanto URL não está configurada)
          await new Promise(r => setTimeout(r, 1000));
          showMsg('✓ E-mail cadastrado com sucesso! Bem-vinda ao círculo Virtù.', 'success');
          newsletterEmail.value = '';
          return;
        }

        // Submissão real via JSONP (método padrão Mailchimp)
        const url = new URL(MAILCHIMP_URL.replace('/post?', '/post-json?'));
        url.searchParams.set('EMAIL', email);
        url.searchParams.set('b_' + url.searchParams.get('u') + '_' + url.searchParams.get('id'), ''); // honeypot

        const cbName = 'mc_cb_' + Date.now();
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          window[cbName] = (data) => {
            delete window[cbName];
            script.remove();
            if (data.result === 'success') {
              showMsg('✓ ' + data.msg, 'success');
              newsletterEmail.value = '';
              resolve();
            } else {
              showMsg(data.msg.replace(/\d+ - /, ''), 'error');
              resolve();
            }
          };
          url.searchParams.set('c', cbName);
          script.src = url.toString();
          script.onerror = reject;
          document.head.appendChild(script);
          setTimeout(reject, 8000);
        });

      } catch {
        showMsg('Algo deu errado. Tente novamente em instantes.', 'error');
      } finally {
        if (label) label.hidden = false;
        if (load)  load.hidden  = true;
        if (btn)   btn.disabled = false;
      }
    });
  }

  function showMsg(text, type = '') {
    if (!newsletterMsg) return;
    newsletterMsg.textContent = text;
    newsletterMsg.className = 'sobre-newsletter__msg' + (type ? ' ' + type : '');
  }

});
