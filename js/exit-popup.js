/* ============================================================
   VIRTÙ — Pop-up de Saída (Exit Intent)
   Aparece quando o mouse sai pela parte superior da janela
   (usuário se dirige para fechar a aba ou mudar de página).
   Mostra apenas UMA vez por sessão.
   ============================================================ */
(function () {
  const SESSION_KEY = 'virtu_exit_popup_shown';

  // Não mostra se já apareceu nesta sessão
  if (sessionStorage.getItem(SESSION_KEY)) return;

  // Não mostra se o carrinho está vazio
  function carrinhoVazio() {
    try {
      const cart = JSON.parse(localStorage.getItem('virtu_cart') || '[]');
      return cart.length === 0;
    } catch { return true; }
  }
  if (carrinhoVazio()) return;

  const overlay   = document.getElementById('exitPopupOverlay');
  const closeBtn  = document.getElementById('exitPopupClose');
  const continuar = document.getElementById('exitPopupContinuar');
  const copiarBtn = document.getElementById('exitPopupCopiar');
  const copiado   = document.getElementById('exitPopupCopiado');
  const codigoEl  = document.getElementById('exitPopupCodigo');

  if (!overlay) return;

  // ── Carrega configuração do Supabase ──────────────────────
  async function carregarConfig() {
    if (typeof supabaseClient === 'undefined') return;
    try {
      const { data } = await supabaseClient
        .from('configuracoes')
        .select('popup_saida_ativo, popup_saida_codigo, popup_saida_desconto, popup_saida_titulo, popup_saida_subtitulo')
        .eq('id', 1)
        .maybeSingle();

      if (!data || data.popup_saida_ativo === false) return false;

      // Preenche o popup com os dados do admin
      const titulo    = document.getElementById('exitPopupTitulo');
      const subtitulo = document.getElementById('exitPopupSubtitulo');
      const desconto  = document.getElementById('exitPopupDesconto');

      if (titulo    && data.popup_saida_titulo)     titulo.textContent    = data.popup_saida_titulo;
      if (subtitulo && data.popup_saida_subtitulo)  subtitulo.textContent = data.popup_saida_subtitulo;
      if (codigoEl  && data.popup_saida_codigo)     codigoEl.value        = data.popup_saida_codigo;
      if (desconto  && data.popup_saida_desconto)   desconto.textContent  = `${data.popup_saida_desconto}% de desconto — código exclusivo`;

      return true;
    } catch { return true; } // falha silenciosa: mostra com valores padrão
  }

  // ── Abre o popup ──────────────────────────────────────────
  function abrirPopup() {
    sessionStorage.setItem(SESSION_KEY, '1');
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    // Trigger da animação no próximo frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('open'));
    });
  }

  // ── Fecha o popup ─────────────────────────────────────────
  function fecharPopup() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => overlay.setAttribute('hidden', ''), 320);
  }

  closeBtn?.addEventListener('click', fecharPopup);
  continuar?.addEventListener('click', fecharPopup);
  overlay.addEventListener('click', e => { if (e.target === overlay) fecharPopup(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharPopup(); });

  // ── Copiar código ─────────────────────────────────────────
  copiarBtn?.addEventListener('click', () => {
    const codigo = codigoEl?.value || '';
    navigator.clipboard?.writeText(codigo).catch(() => {
      // Fallback para navegadores sem clipboard API
      codigoEl?.select();
      document.execCommand('copy');
    });
    if (copiado) {
      copiado.textContent = '✓ Código copiado! Cole no checkout.';
      setTimeout(() => { if (copiado) copiado.textContent = ''; }, 3000);
    }
    copiarBtn.textContent = '✓ Copiado!';
    setTimeout(() => { if (copiarBtn) copiarBtn.textContent = 'Copiar'; }, 2000);
  });

  // ── Exit intent: mouse saindo pelo topo ───────────────────
  let triggered = false;
  let timer = null;

  // Desktop: mouseleave no topo da janela
  document.addEventListener('mouseleave', async (e) => {
    if (triggered) return;
    if (e.clientY > 20) return; // só se sair pelo topo (barra do browser)

    triggered = true;
    const ok = await carregarConfig();
    if (ok !== false) abrirPopup();
  });

  // Mobile: usuário rola para cima rapidamente (tentativa de sair)
  let lastScrollY = window.scrollY;
  let scrollUpSpeed = 0;
  window.addEventListener('scroll', () => {
    const delta = lastScrollY - window.scrollY;
    if (delta > 0) {
      scrollUpSpeed += delta;
      clearTimeout(timer);
      timer = setTimeout(() => { scrollUpSpeed = 0; }, 300);

      if (scrollUpSpeed > 200 && window.scrollY < 100 && !triggered) {
        triggered = true;
        carregarConfig().then(ok => { if (ok !== false) abrirPopup(); });
      }
    } else {
      scrollUpSpeed = 0;
    }
    lastScrollY = window.scrollY;
  }, { passive: true });

  // Fallback: tempo na página (45s sem interação com o carrinho)
  const idleTimer = setTimeout(async () => {
    if (triggered || carrinhoVazio()) return;
    triggered = true;
    const ok = await carregarConfig();
    if (ok !== false) abrirPopup();
  }, 45000);

  // Cancela o timer idle se o usuário interagir com o carrinho
  document.getElementById('cartItems')?.addEventListener('click', () => {
    clearTimeout(idleTimer);
  }, { once: true });

})();
