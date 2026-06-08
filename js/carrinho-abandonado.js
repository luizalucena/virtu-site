/**
 * carrinho-abandonado.js — Virtù
 * Detecta abandono de carrinho e salva no Supabase para follow-up via WhatsApp.
 *
 * Fluxo:
 *  1. Carrinho.html  → exit intent popup captura WhatsApp → salva abandono
 *  2. Checkout.html  → usuário preenche telefone mas sai → salva abandono
 *  3. Admin recebe notificação e envia WhatsApp (manual ou via webhook automático)
 */

(function () {
  'use strict';

  const CART_KEY      = 'virtu_cart';
  const ABANDONO_KEY  = 'virtu_abandono_saved';  // evita duplicatas na sessão
  const POPUP_KEY     = 'virtu_popup_shown';      // mostra popup só 1x por sessão
  const WHATSAPP_VIRTU = '5583999947734';         // número da loja para o link de recuperação

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

  function formatPhone(raw) {
    // Garante formato internacional sem +
    return raw.replace(/\D/g, '').replace(/^0/, '55');
  }

  function buildRecoveryUrl() {
    return window.location.origin + '/carrinho.html?recuperar=1';
  }

  function getCheckoutData() {
    return {
      nome:     ((document.getElementById('firstName')?.value || '') + ' ' +
                 (document.getElementById('lastName')?.value  || '')).trim(),
      email:    document.getElementById('email')?.value   || '',
      telefone: document.getElementById('phone')?.value   || '',
    };
  }

  function alreadySaved() {
    return sessionStorage.getItem(ABANDONO_KEY) === '1';
  }

  function markSaved() {
    sessionStorage.setItem(ABANDONO_KEY, '1');
  }

  /* ─── Salvar no Supabase ──────────────────────────────────── */

  async function saveAbandono({ nome, email, telefone, origem }) {
    if (alreadySaved()) return;
    const tel = formatPhone(telefone);
    if (!tel || tel.length < 10) return;

    markSaved();

    const cart    = getCart();
    const total   = calcTotal(cart);
    const url_rec = buildRecoveryUrl();

    try {
      await supabaseClient.from('carrinhos_abandonados').insert({
        telefone:        tel,
        nome:            nome || null,
        email:           email || null,
        itens:           cart,
        valor_total:     total,
        origem:          origem || 'carrinho',
        url_recuperacao: url_rec,
      });

      // Dispara webhook automático (se configurado no admin)
      dispararWebhook({ nome, telefone: tel, email, itens: cart, total, url: url_rec });

    } catch (err) {
      console.warn('[Virtù] Erro ao salvar abandono:', err.message);
    }
  }

  /* ─── Webhook automático ──────────────────────────────────── */

  async function dispararWebhook(dados) {
    try {
      const { data: cfg } = await supabaseClient
        .from('configuracoes')
        .select('webhook_whatsapp, abandono_mensagem')
        .eq('id', 1)
        .maybeSingle();

      const webhookUrl = cfg?.webhook_whatsapp;
      if (!webhookUrl) return;

      const mensagem = (cfg?.abandono_mensagem || 'Olá {nome}! Vocà deixou itens no carrinho da Virtù: {link}')
        .replace('{nome}',  dados.nome  || 'cliente')
        .replace('{link}',  dados.url)
        .replace('{total}', 'R$ ' + dados.total.toFixed(2));

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone:  dados.telefone,
          nome:      dados.nome,
          email:     dados.email,
          mensagem:  mensagem,
          itens:     dados.itens,
          total:     dados.total,
          url:       dados.url,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch { /* webhook falhou silenciosamente */ }
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
        <p id="vt-abandono-sub">Deixe seu WhatsApp e te lembramos quando vocà quiser retomar.</p>
        <form id="vt-abandono-form" novalidate>
          <input
            type="tel"
            id="vt-abandono-phone"
            placeholder="(83) 99999-9999"
            inputmode="numeric"
            maxlength="15"
            required
            autocomplete="tel"
            aria-label="Seu WhatsApp"
          />
          <button type="submit" id="vt-abandono-btn">Salvar meu carrinho 💬</button>
        </form>
        <p id="vt-abandono-msg" role="alert" aria-live="polite"></p>
        <p id="vt-abandono-disclaimer">Só enviamos 1 mensagem. Nada de spam.</p>
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
      #vt-abandono-phone {
        border:1px solid #ddd;border-radius:4px;padding:12px 14px;
        font-size:15px;outline:none;width:100%;box-sizing:border-box;
        font-family:inherit;
      }
      #vt-abandono-phone:focus { border-color:#C4934A; }
      #vt-abandono-btn {
        background:#25D366;color:#fff;border:none;border-radius:4px;
        padding:13px;font-size:14px;font-weight:600;cursor:pointer;
        font-family:inherit;transition:background .2s;
      }
      #vt-abandono-btn:hover { background:#1da851; }
      #vt-abandono-msg { font-size:12px;color:#27ae60;margin:8px 0 0;min-height:16px; }
      #vt-abandono-disclaimer { font-size:11px;color:#bbb;margin:10px 0 0; }
      @media(max-width:440px){
        #vt-abandono-popup{padding:32px 20px 22px;}
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Formata o campo de telefone
    const phoneInput = document.getElementById('vt-abandono-phone');
    phoneInput?.addEventListener('input', function () {
      let v = this.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 7) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length > 0) v = `(${v}`;
      this.value = v;
    });

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
      const telefone = phoneInput?.value || '';
      const btn = document.getElementById('vt-abandono-btn');
      const msg = document.getElementById('vt-abandono-msg');

      if (telefone.replace(/\D/g,'').length < 10) {
        msg.textContent = 'Digite um número válido com DDD.';
        msg.style.color = '#c62828';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Salvando…';

      await saveAbandono({ telefone, origem: 'exit_popup' });

      btn.textContent = '✓ Salvo!';
      msg.textContent = 'Perfeito! Te avisamos no WhatsApp. 😊';
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
      if (document.visibilityState === 'hidden' && !popupTriggered) {
        // Não mostra popup no mobile, mas registra se tiver telefone salvo
        const tel = localStorage.getItem('virtu_telefone') || '';
        if (tel) saveAbandono({ telefone: tel, origem: 'carrinho_mobile' });
      }
    });
  }

  function watchCheckout() {
    const cart = getCart();
    if (!cart.length) return;

    function trySave() {
      const { nome, email, telefone } = getCheckoutData();
      if (telefone) {
        // Persiste para possível uso em próximas sessões
        localStorage.setItem('virtu_telefone', telefone);
        localStorage.setItem('virtu_nome',     nome);
        localStorage.setItem('virtu_email',    email);
        saveAbandono({ nome, email, telefone, origem: 'checkout' });
      }
    }

    // Guarda telefone enquanto digita (para capturar mesmo sem submit)
    document.getElementById('phone')?.addEventListener('blur', () => {
      const tel = document.getElementById('phone')?.value || '';
      if (tel.replace(/\D/g,'').length >= 10) {
        localStorage.setItem('virtu_telefone', tel);
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

    const tel = localStorage.getItem('virtu_telefone');
    if (!tel) return;

    try {
      // Atualiza o registro mais recente desse telefone como recuperado
      await supabaseClient
        .from('carrinhos_abandonados')
        .update({ recuperado: true, recuperado_em: new Date().toISOString() })
        .eq('telefone', formatPhone(tel))
        .eq('recuperado', false)
        .order('created_at', { ascending: false })
        .limit(1);
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
