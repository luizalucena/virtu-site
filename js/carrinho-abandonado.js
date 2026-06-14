/**
 * carrinho-abandonado.js — Virtù
 * Detecta abandono de carrinho e salva no Supabase para follow-up via e-mail.
 *
 * Fluxo:
 *  1. Carrinho.html  → exit intent popup captura e-mail → salva abandono → envia e-mail
 *  2. Checkout.html  → usuário preenche e-mail mas sai → salva abandono → envia e-mail
 *  3. Admin visualiza carrinhos abandonados no painel
 *
 * Nota: WhatsApp removido — Z-API não é autorizado pelo WhatsApp/Meta (risco de ban).
 * Notificação via Resend (e-mail) apenas.
 */

(function () {
  'use strict';

  const CART_KEY     = 'virtu_cart';
  const ABANDONO_KEY = 'virtu_abandono_saved';  // evita duplicatas na sessão
  const POPUP_KEY    = 'virtu_popup_shown';     // mostra popup só 1x por sessão

  // Timer de abandono: dispara após MIN_INATIVIDADE ms sem interação
  const MIN_INATIVIDADE = 25 * 60 * 1000;  // 25 minutos
  let   _timerAbandono  = null;
  let   _timerIniciado  = false;

  /* ─── Utilitários ─────────────────────────────────────────── */

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
  }

  function calcTotal(cart) {
    return cart.reduce((sum, item) => {
      const price = item.preco_desconto || item.preco || item.price || 0;
      const qty   = item.qty || item.quantidade || 1;
      return sum + (price * qty);
    }, 0);
  }

  function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function buildRecoveryUrl() {
    return window.location.origin + '/carrinho.html?recuperar=1';
  }

  function getCheckoutData() {
    return {
      nome:  ((document.getElementById('firstName')?.value || '') + ' ' +
               (document.getElementById('lastName')?.value  || '')).trim(),
      email: (document.getElementById('email')?.value || '').trim(),
    };
  }

  function alreadySaved() {
    return sessionStorage.getItem(ABANDONO_KEY) === '1';
  }

  function markSaved() {
    sessionStorage.setItem(ABANDONO_KEY, '1');
  }

  /* ─── Salvar no Supabase ──────────────────────────────────── */

  async function saveAbandono({ nome, email, origem }) {
    if (alreadySaved()) return;
    if (!isValidEmail(email)) return; // e-mail é obrigatório para envio

    markSaved();

    const cart         = getCart();
    const total        = calcTotal(cart);
    const url_rec      = buildRecoveryUrl();
    const tempo_inicio = Number(sessionStorage.getItem('virtu_pagina_inicio') || Date.now());
    const tempo_min    = Math.round((Date.now() - tempo_inicio) / 60000); // minutos na página

    try {
      const { data: registro } = await supabaseClient
        .from('carrinhos_abandonados')
        .insert({
          email:           email.trim(),
          nome:            nome || null,
          itens:           cart,
          valor_total:     total,
          origem:          origem || 'carrinho',
          url_recuperacao: url_rec,
          tempo_abandono:  tempo_min,
        })
        .select('id')
        .maybeSingle();

      // Dispara notificação por e-mail via Edge Function
      dispararEmail({
        nome,
        email: email.trim(),
        itens: cart,
        total,
        url: url_rec,
        abandono_id: registro?.id,
      });

    } catch (err) {
      console.warn('[Virtù] Erro ao salvar abandono:', err.message);
    }
  }

  /* ─── Timer de inatividade (disparo automático) ────────────── */

  function iniciarTimerAbandono() {
    if (_timerIniciado || !getCart().length) return;
    _timerIniciado = true;

    // Salva timestamp de entrada na página
    if (!sessionStorage.getItem('virtu_pagina_inicio')) {
      sessionStorage.setItem('virtu_pagina_inicio', String(Date.now()));
    }

    function resetTimer() {
      clearTimeout(_timerAbandono);
      _timerAbandono = setTimeout(dispararAbandonoAutomatico, MIN_INATIVIDADE);
    }

    // Resets ao interagir com a página
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(ev => {
      document.addEventListener(ev, resetTimer, { passive: true });
    });

    // Inicia o timer imediatamente
    resetTimer();
  }

  async function dispararAbandonoAutomatico() {
    if (alreadySaved()) return;

    // Tenta usar dados já salvos em localStorage (preenchidos no checkout)
    const nome  = localStorage.getItem('virtu_nome')  || '';
    const email = localStorage.getItem('virtu_email') || '';

    if (isValidEmail(email)) {
      await saveAbandono({ nome, email, origem: 'timer_inatividade' });
    }
    // Se não tiver e-mail, o registro aguarda o popup ou a digitação no checkout
  }

  /* ─── Notificação por e-mail via Edge Function ────────────── */
  // Chama a EF notificar-abandono-carrinho que usa Resend para enviar e-mail.
  // WhatsApp removido — Z-API não autorizado pelo WhatsApp/Meta (risco de ban).

  async function dispararEmail(dados) {
    try {
      const { error } = await supabaseClient.functions.invoke(
        'notificar-abandono-carrinho',
        {
          body: {
            email:           dados.email,
            nome:            dados.nome        || null,
            itens:           dados.itens       || [],
            total:           dados.total       || 0,
            url_recuperacao: dados.url,
            abandono_id:     dados.abandono_id || null,
          },
        },
      );

      if (error) {
        console.warn('[Virtù] notificar-abandono-carrinho:', error.message || error);
      }

    } catch (err) {
      // Falha silenciosa — não prejudica a experiência da cliente
      console.warn('[Virtù] dispararEmail falhou:', err?.message);
    }
  }

  /* ─── Popup exit intent (página do carrinho) ─────────────── */

  function showExitPopup() {
    if (sessionStorage.getItem(POPUP_KEY)) return;
    sessionStorage.setItem(POPUP_KEY, '1');

    const overlay = document.createElement('div');
    overlay.id = 'vt-abandono-overlay';
    overlay.innerHTML = `
      <div id="vt-abandono-popup">
        <button id="vt-abandono-close" aria-label="Fechar">✕</button>
        <div id="vt-abandono-icon">🛍️</div>
        <h2 id="vt-abandono-title">Espera! Seus itens vão embora</h2>
        <p id="vt-abandono-sub">Deixe seu e-mail e te mandamos um lembrete para retomar sua compra.</p>
        <form id="vt-abandono-form" novalidate>
          <input
            type="email"
            id="vt-abandono-email"
            placeholder="seu@email.com"
            inputmode="email"
            required
            autocomplete="email"
            aria-label="Seu e-mail"
          />
          <button type="submit" id="vt-abandono-btn">Salvar meu carrinho 📧</button>
        </form>
        <p id="vt-abandono-msg" role="alert" aria-live="polite"></p>
        <p id="vt-abandono-disclaimer">Só enviamos 1 e-mail. Nada de spam.</p>
      </div>
    `;

    // Estilos inline para portabilidade
    const style = document.createElement('style');
    style.textContent = `
      #vt-abandono-overlay {
        display:none;position:fixed;inset:0;background:rgba(15,25,35,.7);
        z-index:99998;align-items:center;justify-content:center;padding:16px;
        animation:vtAbFadeIn .3s ease;
      }
      #vt-abandono-overlay.vt-ab-show { display:flex; }
      @keyframes vtAbFadeIn { from{opacity:0} to{opacity:1} }
      #vt-abandono-popup {
        background:#fff;border-radius:8px;max-width:400px;width:100%;
        padding:40px 32px 28px;position:relative;text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,.25);
        font-family:'Jost',Helvetica,Arial,sans-serif;
      }
      #vt-abandono-close {
        position:absolute;top:12px;right:14px;background:none;border:none;
        font-size:18px;cursor:pointer;color:#999;line-height:1;
      }
      #vt-abandono-icon { font-size:36px;margin-bottom:12px; }
      #vt-abandono-title {
        font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;
        font-weight:500;color:#1c2e3e;margin:0 0 10px;
      }
      #vt-abandono-sub { font-size:14px;color:#666;margin:0 0 20px;line-height:1.5; }
      #vt-abandono-form { display:flex;flex-direction:column;gap:10px; }
      #vt-abandono-email {
        border:1px solid #ddd;border-radius:4px;padding:12px 14px;
        font-size:15px;outline:none;width:100%;box-sizing:border-box;
        font-family:inherit;
      }
      #vt-abandono-email:focus { border-color:#C4934A; }
      #vt-abandono-btn {
        background:#2B3F54;color:#fff;border:none;border-radius:4px;
        padding:13px;font-size:14px;font-weight:600;cursor:pointer;
        font-family:inherit;transition:background .2s;
      }
      #vt-abandono-btn:hover { background:#1c2e3e; }
      #vt-abandono-msg { font-size:12px;color:#27ae60;margin:8px 0 0;min-height:16px; }
      #vt-abandono-disclaimer { font-size:11px;color:#bbb;margin:10px 0 0; }
      @media(max-width:440px){
        #vt-abandono-popup{padding:32px 20px 22px;}
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const emailInput = document.getElementById('vt-abandono-email');

    // Fechar ao clicar fora ou no X
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
    document.getElementById('vt-abandono-close')?.addEventListener('click', closePopup);

    function closePopup() {
      overlay.classList.remove('vt-ab-show');
      setTimeout(() => overlay.remove(), 300);
    }

    // Submit
    document.getElementById('vt-abandono-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim() || '';
      const btn = document.getElementById('vt-abandono-btn');
      const msg = document.getElementById('vt-abandono-msg');

      if (!isValidEmail(email)) {
        msg.textContent = 'Digite um e-mail válido.';
        msg.style.color = '#c62828';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Salvando…';

      await saveAbandono({ email, origem: 'exit_popup' });

      btn.textContent = '✓ Salvo!';
      msg.textContent = 'Perfeito! Te avisamos por e-mail. 📧';
      msg.style.color = '#27ae60';

      setTimeout(closePopup, 1800);
    });

    // Mostrar popup com delay leve
    requestAnimationFrame(() => {
      setTimeout(() => overlay.classList.add('vt-ab-show'), 80);
    });
  }

  /* ─── Watchers por página ─────────────────────────────────── */

  function watchCarrinho() {
    const cart = getCart();
    if (!cart.length) return;

    // Inicia timer de 25 min de inatividade
    iniciarTimerAbandono();

    let popupTriggered = false;

    // Desktop: mouse sai pela parte de cima
    document.addEventListener('mouseleave', (e) => {
      if (e.clientY <= 5 && !popupTriggered) {
        popupTriggered = true;
        showExitPopup();
      }
    });

    // Mobile: visibilidade oculta (troca de aba / home)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Para o timer quando sai da aba — o beforeunload cuida do registro
        clearTimeout(_timerAbandono);
        if (!popupTriggered) {
          const em = localStorage.getItem('virtu_email') || '';
          if (isValidEmail(em)) saveAbandono({ email: em, origem: 'carrinho_mobile' });
        }
      } else if (document.visibilityState === 'visible') {
        // Retornou à aba — reinicia o timer
        if (_timerIniciado && getCart().length) {
          clearTimeout(_timerAbandono);
          _timerAbandono = setTimeout(dispararAbandonoAutomatico, MIN_INATIVIDADE);
        }
      }
    });

    // Limpa timer quando converte (vai para checkout)
    document.querySelectorAll('a[href*="checkout"]').forEach(link => {
      link.addEventListener('click', () => clearTimeout(_timerAbandono));
    });
  }

  function watchCheckout() {
    const cart = getCart();
    if (!cart.length) return;

    // Inicia timer de 25 min também no checkout
    iniciarTimerAbandono();

    function trySave() {
      const { nome, email } = getCheckoutData();
      if (isValidEmail(email)) {
        // Persiste para possível uso em próximas sessões
        localStorage.setItem('virtu_nome',  nome);
        localStorage.setItem('virtu_email', email);
        saveAbandono({ nome, email, origem: 'checkout' });
      }
    }

    // Guarda e-mail enquanto digita (para capturar mesmo sem submit)
    document.getElementById('email')?.addEventListener('blur', () => {
      const em = document.getElementById('email')?.value?.trim() || '';
      if (isValidEmail(em)) {
        localStorage.setItem('virtu_email', em);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') trySave();
    });

    window.addEventListener('beforeunload', trySave);
  }

  /* ─── Marcar recuperação quando volta pelo link ───────────── */

  async function checkRecovery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('recuperar')) return;

    const email = localStorage.getItem('virtu_email');
    if (!isValidEmail(email)) return;

    try {
      // Busca o registro mais recente para aquele e-mail
      const { data: row } = await supabaseClient
        .from('carrinhos_abandonados')
        .select('id')
        .eq('email', email.trim())
        .eq('recuperado', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Atualiza apenas esse registro específico (evita UPDATE em cascata)
      if (row?.id) {
        await supabaseClient
          .from('carrinhos_abandonados')
          .update({ recuperado: true, recuperado_em: new Date().toISOString() })
          .eq('id', row.id);
      }
    } catch { /* silencioso */ }
  }

  /* ─── Init ────────────────────────────────────────────────── */

  function init() {
    // Aguarda supabaseClient estar disponível
    if (typeof supabaseClient === 'undefined') {
      setTimeout(init, 300);
      return;
    }

    checkRecovery();

    const path = window.location.pathname;

    if (path.includes('carrinho')) {
      watchCarrinho();
    } else if (path.includes('checkout')) {
      watchCheckout();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
