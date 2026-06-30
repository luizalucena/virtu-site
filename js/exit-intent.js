/* ============================================================
   VIRTÙ — Exit Intent Pop-up
   Aparece quando o visitante tenta sair da página.
   Mostra um cupom de desconto configurado pelo admin.
   Não aparece no checkout nem mais de uma vez por sessão.
   ============================================================ */
(function () {
  const SESSION_KEY = 'virtu_exit_shown';
  const PAGE_KEY    = 'virtu_exit_dismissed';

  // Não exibir no checkout nem se já foi mostrado nesta sessão
  if (sessionStorage.getItem(SESSION_KEY)) return;
  if (window.location.pathname.includes('checkout')) return;

  let popup = null;
  let triggered = false;

  // ── CRIAR POPUP ────────────────────────────────────────────
  async function buildPopup() {
    // Busca configurações do admin
    let titulo    = 'Espera! Não vá ainda...';
    let subtitulo = 'Aqui está um presente exclusivo para você:';
    let codigo    = 'FICA10';
    let desconto  = 10;

    try {
      if (typeof supabaseClient !== 'undefined') {
        const { data } = await supabaseClient
          .from('configuracoes')
          .select('cupom_saida_ativo, cupom_saida_titulo, cupom_saida_subtitulo, cupom_saida_codigo, cupom_saida_desconto')
          .eq('id', 1)
          .maybeSingle();

        if (data) {
          if (!data.cupom_saida_ativo) return; // desativado pelo admin
          titulo    = data.cupom_saida_titulo    || titulo;
          subtitulo = data.cupom_saida_subtitulo || subtitulo;
          codigo    = data.cupom_saida_codigo    || codigo;
          desconto  = data.cupom_saida_desconto  || desconto;
        }
      }
    } catch (_) {}

    // Monta o HTML
    const el = document.createElement('div');
    el.id = 'exitIntentOverlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Oferta especial');
    el.innerHTML = `
      <div class="exit-popup">
        <button class="exit-popup__close" id="exitClose" aria-label="Fechar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>

        <div class="exit-popup__left">
          <div class="exit-popup__ornament" aria-hidden="true"></div>
          <p class="exit-popup__overline">Oferta exclusiva</p>
          <h2 class="exit-popup__title">${titulo}</h2>
          <p class="exit-popup__sub">${subtitulo}</p>

          <div class="exit-popup__coupon">
            <span class="exit-popup__coupon-code" id="exitCupomCode">${codigo}</span>
            <button class="exit-popup__coupon-copy" id="exitCopiar" aria-label="Copiar cupom">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copiar
            </button>
          </div>

          <p class="exit-popup__desconto">${desconto}% de desconto na sua primeira compra</p>

          <a href="catalogo.html" class="exit-popup__cta" id="exitCta">
            Quero meu desconto →
          </a>

          <button class="exit-popup__skip" id="exitSkip">
            Não, obrigada
          </button>
        </div>

        <div class="exit-popup__right" aria-hidden="true">
          <div class="exit-popup__img-bg"></div>
          <div class="exit-popup__img-overlay">
            <p class="exit-popup__img-text">
              <em>Há virtude<br>no vestir</em>
            </p>
          </div>
        </div>
      </div>
    `;

    // Estilos inline para não depender de arquivo CSS separado
    const style = document.createElement('style');
    style.textContent = `
      #exitIntentOverlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.65);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
        opacity: 0; transition: opacity 0.35s ease;
        backdrop-filter: blur(3px);
      }
      #exitIntentOverlay.visible { opacity: 1; }

      .exit-popup {
        display: grid; grid-template-columns: 1.1fr 0.9fr;
        max-width: 680px; width: 100%;
        background: #fff;
        position: relative;
        transform: translateY(20px);
        transition: transform 0.35s ease;
        overflow: hidden;
      }
      #exitIntentOverlay.visible .exit-popup { transform: translateY(0); }

      .exit-popup__close {
        position: absolute; top: 1rem; right: 1rem; z-index: 2;
        background: rgba(255,255,255,0.9); border: none; cursor: pointer;
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: #15233f; transition: background 0.15s;
      }
      .exit-popup__close:hover { background: #fff; }

      .exit-popup__left {
        padding: 2.5rem 2rem;
        display: flex; flex-direction: column; gap: 0.6rem;
        position: relative;
      }

      .exit-popup__ornament {
        position: absolute; top: -40px; left: -40px;
        width: 120px; height: 120px; border-radius: 50%;
        border: 1px solid rgba(184, 148, 63,0.15);
        pointer-events: none;
      }

      .exit-popup__overline {
        font-size: 0.62rem; letter-spacing: 0.2em;
        text-transform: uppercase; color: #b8943f;
        font-family: 'Jost', sans-serif;
      }

      .exit-popup__title {
        font-family: 'Cormorant Garamond', serif;
        font-style: italic; font-size: 1.65rem;
        color: #15233f; font-weight: 300; line-height: 1.2;
        margin-top: 0.25rem;
      }

      .exit-popup__sub {
        font-size: 0.82rem; color: #888; line-height: 1.5;
        margin-bottom: 0.5rem;
      }

      .exit-popup__coupon {
        display: flex; align-items: center; gap: 0.5rem;
        background: #faf9f7; border: 1.5px dashed #b8943f;
        padding: 0.7rem 1rem; margin-block: 0.25rem;
      }

      .exit-popup__coupon-code {
        font-family: 'Jost', monospace; font-size: 1.1rem;
        font-weight: 600; letter-spacing: 0.15em;
        color: #15233f; flex: 1;
      }

      .exit-popup__coupon-copy {
        display: flex; align-items: center; gap: 0.3rem;
        background: none; border: 1px solid #b8943f;
        color: #b8943f; padding: 0.3rem 0.7rem;
        font-size: 0.7rem; letter-spacing: 0.08em;
        text-transform: uppercase; cursor: pointer;
        font-family: 'Jost', sans-serif;
        transition: all 0.15s; white-space: nowrap;
      }
      .exit-popup__coupon-copy:hover { background: #b8943f; color: #fff; }

      .exit-popup__desconto {
        font-size: 0.75rem; color: #999;
      }

      .exit-popup__cta {
        display: block; text-align: center;
        padding: 0.9rem; margin-top: 0.5rem;
        background: #15233f; color: #fff;
        font-size: 0.7rem; letter-spacing: 0.18em;
        text-transform: uppercase; text-decoration: none;
        font-family: 'Jost', sans-serif;
        transition: background 0.2s;
      }
      .exit-popup__cta:hover { background: #0e1a32; }

      .exit-popup__skip {
        background: none; border: none; cursor: pointer;
        font-size: 0.72rem; color: #bbb; text-align: center;
        font-family: 'Jost', sans-serif;
        text-decoration: underline; text-underline-offset: 3px;
        margin-top: 0.25rem;
        transition: color 0.15s;
      }
      .exit-popup__skip:hover { color: #888; }

      .exit-popup__right {
        position: relative; overflow: hidden; min-height: 320px;
      }

      .exit-popup__img-bg {
        position: absolute; inset: 0;
        background: linear-gradient(160deg, #1a2a4a 0%, #14223c 40%, #b8943f 100%);
      }

      .exit-popup__img-overlay {
        position: absolute; inset: 0;
        display: flex; align-items: flex-end;
        padding: 2rem 1.5rem;
        background: linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 60%);
      }

      .exit-popup__img-text em {
        font-family: 'Cormorant Garamond', serif;
        font-size: 1.6rem; color: rgba(255,255,255,0.9);
        font-weight: 300; line-height: 1.2;
      }

      @media (max-width: 600px) {
        .exit-popup { grid-template-columns: 1fr; }
        .exit-popup__right { display: none; }
        .exit-popup__left { padding: 2rem 1.5rem; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(el);

    // Anima entrada
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('visible'));
    });

    popup = el;

    // Fechar
    const fechar = () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 350);
      sessionStorage.setItem(SESSION_KEY, '1');
    };

    document.getElementById('exitClose')?.addEventListener('click', fechar);
    document.getElementById('exitSkip')?.addEventListener('click', fechar);
    el.addEventListener('click', e => { if (e.target === el) fechar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); }, { once: true });

    // Copiar código
    document.getElementById('exitCopiar')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(codigo).catch(() => {});
      const btn = document.getElementById('exitCopiar');
      if (btn) { btn.textContent = '✓ Copiado!'; setTimeout(() => { btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`; }, 2000); }
    });

    // CTA: salva o cupom no localStorage e vai para o catálogo
    document.getElementById('exitCta')?.addEventListener('click', () => {
      // Pré-carrega o cupom para aplicar no carrinho
      try {
        localStorage.setItem('virtu_exit_coupon', JSON.stringify({ code: codigo, pct: desconto }));
      } catch (_) {}
      fechar();
    });
  }

  // ── DETECTAR SAÍDA — DESKTOP (mouse sai pelo topo) ─────────
  function onMouseLeave(e) {
    if (triggered) return;
    if (e.clientY > 5) return; // só dispara quando vai para o topo (fechar aba/barra URL)
    triggered = true;
    document.removeEventListener('mouseleave', onMouseLeave);
    buildPopup();
    sessionStorage.setItem(SESSION_KEY, '1');
  }

  // ── DETECTAR SAÍDA — MOBILE (troca de aba) ─────────────────
  function onVisibilityChange() {
    if (triggered) return;
    if (document.visibilityState !== 'hidden') return;
    triggered = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    buildPopup();
    sessionStorage.setItem(SESSION_KEY, '1');
  }

  // Aguarda 5s antes de ativar (não interrompe quem acabou de chegar)
  setTimeout(() => {
    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }, 5000);

})();
