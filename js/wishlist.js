/* ============================================================
   VIRTÙ — Wishlist (Favoritos)
   Persiste no Supabase para usuários logados.
   Usa localStorage como fallback para visitantes.
   ============================================================ */
(function () {
  const LS_KEY = 'virtu_favoritos';

  // ── ESTADO LOCAL ──────────────────────────────────────────
  let _favoritos = new Set();   // produto_ids favoritados
  let _user = null;             // usuário logado (ou null)
  let _ready = false;           // carregamento inicial concluído

  // ── UTILS ─────────────────────────────────────────────────
  function lsGet() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); }
  }
  function lsSet(set) {
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  }

  // ── SUPABASE: carregar favoritos do usuário ───────────────
  async function carregarDoSupabase(userId) {
    if (!window.supabaseClient) return;
    const { data, error } = await window.supabaseClient
      .from('favoritos')
      .select('produto_id')
      .eq('user_id', userId);
    if (!error && data) {
      _favoritos = new Set(data.map(r => r.produto_id));
      lsSet(_favoritos); // sincroniza localStorage
    }
  }

  // ── SUPABASE: adicionar ───────────────────────────────────
  async function adicionarNoSupabase(produtoId) {
    if (!window.supabaseClient || !_user) return;
    await window.supabaseClient
      .from('favoritos')
      .upsert({ user_id: _user.id, produto_id: produtoId }, { onConflict: 'user_id,produto_id' });
  }

  // ── SUPABASE: remover ─────────────────────────────────────
  async function removerDoSupabase(produtoId) {
    if (!window.supabaseClient || !_user) return;
    await window.supabaseClient
      .from('favoritos')
      .delete()
      .eq('user_id', _user.id)
      .eq('produto_id', produtoId);
  }

  // ── TOGGLE ────────────────────────────────────────────────
  async function toggle(produtoId) {
    if (!produtoId) return false;

    const era = _favoritos.has(produtoId);
    if (era) {
      _favoritos.delete(produtoId);
      removerDoSupabase(produtoId);
    } else {
      _favoritos.add(produtoId);
      adicionarNoSupabase(produtoId);
    }
    lsSet(_favoritos);
    atualizarBotoes(produtoId);
    return !era; // true = agora é favorito
  }

  // ── VERIFICAR ─────────────────────────────────────────────
  function isFavorito(produtoId) {
    return _favoritos.has(produtoId);
  }

  // ── ATUALIZAR VISUAIS DE TODOS OS BOTÕES DA PÁGINA ────────
  function atualizarBotoes(produtoId) {
    const seletores = produtoId
      ? `[data-wishlist-id="${produtoId}"]`
      : '[data-wishlist-id]';

    document.querySelectorAll(seletores).forEach(btn => {
      const id = btn.dataset.wishlistId;
      const ativo = _favoritos.has(id);
      btn.classList.toggle('active', ativo);
      btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      btn.setAttribute('aria-label', ativo ? 'Remover dos favoritos' : 'Adicionar aos favoritos');

      // SVG: coração preenchido ou contorno
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', ativo ? 'currentColor' : 'none');
        svg.style.color = ativo ? '#c0392b' : '';
      }
    });
  }

  // ── INICIALIZAÇÃO ─────────────────────────────────────────
  async function init() {
    // Começa com localStorage enquanto Supabase carrega
    _favoritos = lsGet();
    atualizarBotoes();

    // Aguarda sessão do Supabase
    if (window.supabaseClient) {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (session?.user) {
        _user = session.user;
        await carregarDoSupabase(session.user.id);
        atualizarBotoes();
      }

      // Reage a login/logout
      window.supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          _user = session.user;
          // Salva favoritos locais no Supabase antes de sobrescrever com dados do servidor
          const localFavs = lsGet();
          await carregarDoSupabase(session.user.id);
          // Sincroniza localStorage → Supabase (itens favoritos antes de fazer login)
          for (const id of localFavs) {
            if (!_favoritos.has(id)) {
              _favoritos.add(id);
              adicionarNoSupabase(id);
            }
          }
          lsSet(_favoritos);
        } else {
          _user = null;
          _favoritos = lsGet();
        }
        atualizarBotoes();
      });
    }

    _ready = true;

    // Delega cliques em botões de coração da página inteira
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-wishlist-id]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      if (!_user) {
        // Redireciona para login se não estiver logado
        const id = btn.dataset.wishlistId;
        const lsTemp = lsGet();
        if (lsTemp.has(id)) { lsTemp.delete(id); } else { lsTemp.add(id); }
        lsSet(lsTemp);
        _favoritos = lsTemp;
        atualizarBotoes(id);

        // Mostra dica para fazer login
        const hint = document.createElement('div');
        hint.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1c2e3e;color:#fff;padding:0.75rem 1.5rem;font-size:0.8rem;letter-spacing:0.05em;z-index:9999;border-radius:2px;opacity:0;transition:opacity 0.3s';
        hint.textContent = 'Faça login para salvar favoritos permanentemente';
        document.body.appendChild(hint);
        requestAnimationFrame(() => { hint.style.opacity = '1'; });
        setTimeout(() => { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 300); }, 2500);
        return;
      }

      const id = btn.dataset.wishlistId;
      const agora = await toggle(id);

      // Feedback visual rápido
      btn.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 250, easing: 'ease-out' });
    });
  }

  // ── API PÚBLICA ───────────────────────────────────────────
  window.VirtuWishlist = {
    init,
    toggle,
    isFavorito,
    atualizarBotoes,
    getFavoritos: () => [..._favoritos],
    getUser: () => _user,
  };

  // Auto-init no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
