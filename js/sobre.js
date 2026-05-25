/* ============================================================
   VIRTÙ — Sobre JavaScript
   Carrega conteúdo dinâmico do Supabase e inicializa interações
   ============================================================ */

// SVGs dos ícones para cada seção (índice 0→3)
const VALOR_ICONS = [
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`
];

const ENVIO_ICONS = [
  `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.02"/></svg>`
];

const PAGAMENTO_ICONS = [
  `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>`,
  `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h10M7 11h4"/><path d="M17 11h.01"/></svg>`
];

document.addEventListener('DOMContentLoaded', async () => {

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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeSearch(); }
  });

  // ── CARREGAR CONTEÚDO DO SUPABASE ──────────
  try {
    const { data: cfg } = await supabaseClient
      .from('configuracoes')
      .select('sobre')
      .eq('id', 1)
      .maybeSingle();

    if (cfg?.sobre) {
      applySobreContent(cfg.sobre);
    }
  } catch (err) {
    console.warn('[Virtù/sobre] Erro ao carregar conteúdo do Supabase:', err.message);
    // Página continua com os conteúdos padrão do HTML
  }

  // ── INICIALIZA ANIMAÇÕES APÓS CARREGAR ──────
  initCounters();
  initScrollReveal();

  // ── NEWSLETTER ─────────────────────────────
  initNewsletter();

});

// ── APLICA CONTEÚDO DO SUPABASE NA PÁGINA ──
function applySobreContent(s) {
  const setText = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const setHtml = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = val;
  };

  // Hero
  if (s.hero) {
    setText('sobreHeroEyebrow',   s.hero.eyebrow);
    setText('sobreHeroTitulo1',   s.hero.titulo_linha1);
    setText('sobreHeroTitulo2',   s.hero.titulo_linha2);
    setText('sobreHeroSubtitulo', s.hero.subtitulo);
  }

  // Manifesto
  if (s.manifesto) {
    const m = s.manifesto;
    setText('sobreManifestoTitulo',     m.titulo);
    setText('sobreManifestoP1',         m.paragrafo1);
    setText('sobreManifestoP2',         m.paragrafo2);
    setText('sobreManifestoP3',         m.paragrafo3);
    setText('sobreManifestoQuote',      m.quote_texto ? `"${m.quote_texto}"` : '');
    setText('sobreManifestoQuoteAutor', m.quote_autor ? `— ${m.quote_autor}` : '');
    // Imagem do manifesto
    const imgEl = document.getElementById('sobreManifestoImg');
    if (imgEl) {
      if (m.imagem_url) {
        imgEl.style.background = `url('${m.imagem_url}') center/cover no-repeat`;
      }
      // Se não tiver URL, mantém o gradiente padrão do CSS
    }
  }

  // Valores — re-renderiza os 4 cards
  if (s.valores?.length) {
    const grid = document.getElementById('valoresGrid');
    if (grid) {
      grid.innerHTML = s.valores.map((v, i) => `
        <article class="sobre-valor">
          <div class="sobre-valor__icon" aria-hidden="true">
            ${VALOR_ICONS[i] || VALOR_ICONS[0]}
          </div>
          <h3 class="sobre-valor__title">${escHtml(v.titulo)}</h3>
          <p class="sobre-valor__text">${escHtml(v.texto)}</p>
        </article>
      `).join('');
    }
  }

  // Fundadora
  if (s.fundadora) {
    const f = s.fundadora;
    setText('sobreFundadoraTitulo1', f.titulo_linha1);
    setText('sobreFundadoraTitulo2', f.titulo_linha2);
    setText('sobreFundadoraP1',      f.paragrafo1);
    setText('sobreFundadoraP2',      f.paragrafo2);
    const fImg = document.getElementById('sobreFundadoraImg');
    if (fImg && f.imagem_url) {
      fImg.style.background = `url('${f.imagem_url}') center/cover no-repeat`;
    }
  }

  // Números — re-renderiza
  if (s.numeros?.length) {
    const grid = document.getElementById('numerosGrid');
    if (grid) {
      grid.innerHTML = s.numeros.map(n => `
        <div class="sobre-numero">
          <span class="sobre-numero__value" data-target="${n.valor}">0</span>
          <span class="sobre-numero__label">${escHtml(n.label)}</span>
        </div>
      `).join('');
    }
  }

  // Envio — re-renderiza
  if (s.envio?.length) {
    const grid = document.getElementById('envioGrid');
    if (grid) {
      grid.innerHTML = s.envio.map((e, i) => `
        <div class="envio-card${i === 2 ? ' envio-card--destaque' : ''}">
          <div class="envio-card__icon" aria-hidden="true">
            ${ENVIO_ICONS[i] || ENVIO_ICONS[0]}
          </div>
          <h3 class="envio-card__title">${escHtml(e.titulo)}</h3>
          <p class="envio-card__text">${escHtml(e.texto)}</p>
        </div>
      `).join('');
    }
  }

  // Pagamento — re-renderiza
  if (s.pagamento?.length) {
    const grid = document.getElementById('pagamentoGrid');
    if (grid) {
      grid.innerHTML = s.pagamento.map((p, i) => `
        <div class="pagamento-item${i === 2 ? ' pagamento-item--destaque' : ''}">
          <div class="pagamento-item__icon" aria-hidden="true">
            ${PAGAMENTO_ICONS[i] || PAGAMENTO_ICONS[0]}
          </div>
          <h3 class="pagamento-item__title">${escHtml(p.titulo)}</h3>
          <p class="pagamento-item__text">${escHtml(p.texto)}</p>
        </div>
      `).join('');
    }
  }
}

// ── CONTAGEM ANIMADA ────────────────────────
function initCounters() {
  if (!('IntersectionObserver' in window)) return;

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

function animateCounter(el, target, duration = 1600) {
  const start = performance.now();
  const tick = (now) => {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target).toLocaleString('pt-BR');
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── SCROLL REVEAL ──────────────────────────
function initScrollReveal() {
  if (!('IntersectionObserver' in window)) return;

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

  const targets = document.querySelectorAll(
    '.sobre-valor, .envio-card, .pagamento-item, .sobre-manifesto__text p, .sobre-fundadora__text p'
  );
  targets.forEach((el, i) => {
    el.style.cssText = `opacity:0;transform:translateY(20px);transition:opacity 0.55s ease ${i * 0.07}s, transform 0.55s ease ${i * 0.07}s`;
    revealObs.observe(el);
  });
}

// ── NEWSLETTER ─────────────────────────────
function initNewsletter() {
  const form  = document.getElementById('newsletterForm');
  const email = document.getElementById('newsletterEmail');
  const msg   = document.getElementById('newsletterMsg');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val  = email?.value.trim();
    const btn  = form.querySelector('.sobre-newsletter__btn');
    const lbl  = btn?.querySelector('.btn-label');
    const load = btn?.querySelector('.btn-loading');

    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      showMsg(msg, 'Por favor, insira um e-mail válido.', 'error');
      email?.focus();
      return;
    }

    if (lbl)  lbl.hidden  = true;
    if (load) load.hidden = false;
    if (btn)  btn.disabled = true;

    try {
      const MAILCHIMP_URL = ''; // ← Cole aqui a URL do seu formulário Mailchimp

      if (!MAILCHIMP_URL) {
        // Modo demo (URL ainda não configurada)
        await new Promise(r => setTimeout(r, 900));
        showMsg(msg, '✓ Bem-vinda ao círculo Virtù! Você receberá novidades em breve.', 'success');
        email.value = '';
        return;
      }

      // Submissão real via JSONP (padrão Mailchimp sem backend)
      const url = new URL(MAILCHIMP_URL.replace('/post?', '/post-json?'));
      url.searchParams.set('EMAIL', val);
      const cbName = 'mc_cb_' + Date.now();
      await new Promise((resolve, reject) => {
        const script  = document.createElement('script');
        window[cbName] = (data) => {
          delete window[cbName];
          script.remove();
          if (data.result === 'success') {
            showMsg(msg, '✓ ' + data.msg, 'success');
            email.value = '';
          } else {
            showMsg(msg, data.msg.replace(/\d+ - /, ''), 'error');
          }
          resolve();
        };
        url.searchParams.set('c', cbName);
        script.src   = url.toString();
        script.onerror = reject;
        document.head.appendChild(script);
        setTimeout(reject, 8000);
      });

    } catch {
      showMsg(msg, 'Algo deu errado. Tente novamente.', 'error');
    } finally {
      if (lbl)  lbl.hidden  = false;
      if (load) load.hidden = true;
      if (btn)  btn.disabled = false;
    }
  });
}

function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className   = 'sobre-newsletter__msg' + (type ? ' ' + type : '');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
