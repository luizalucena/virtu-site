/* ============================================================
   VIRTÙ — Conta do Cliente
   Supabase Auth: login, cadastro, logout, pedidos, dados
   ============================================================ */

// XSS prevention helper
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * LGPD — Mascara CPF para exibição: 123.***.***-00
 * Apenas os 3 primeiros e os 2 últimos dígitos ficam visíveis.
 */
function maskCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return '';
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

document.addEventListener('DOMContentLoaded', () => {

  // ── REFS ────────────────────────────────────────────────────
  const authSection    = document.getElementById('authSection');
  const accountSection = document.getElementById('accountSection');

  // Auth forms
  const tabLogin   = document.getElementById('tabLogin');
  const tabSignup  = document.getElementById('tabSignup');
  const formLogin  = document.getElementById('formLogin');
  const formSignup = document.getElementById('formSignup');

  // Sidebar info
  const sidebarInitial = document.getElementById('sidebarInitial');
  const sidebarName    = document.getElementById('sidebarName');
  // sidebarEmail removido do layout — elemento não existe no HTML

  // Nav buttons
  const navPedidos    = document.getElementById('navPedidos');
  const navFavoritos  = document.getElementById('navFavoritos');
  const navFidelidade = document.getElementById('navFidelidade');
  const navDados      = document.getElementById('navDados');
  const navLogout     = document.getElementById('navLogout');

  // Content views
  const viewPedidos    = document.getElementById('viewPedidos');
  const viewFavoritos  = document.getElementById('viewFavoritos');
  const viewFidelidade = document.getElementById('viewFidelidade');
  const viewDados      = document.getElementById('viewDados');
  const pedidosList    = document.getElementById('pedidosList');

  // Dados form
  const dadosNome     = document.getElementById('dadosNome');
  const dadosTel      = document.getElementById('dadosTel');
  const dadosEmail    = document.getElementById('dadosEmailRO');
  const dadosSenha    = document.getElementById('dadosSenha');
  const dadosSenhaConf= document.getElementById('dadosSenhaConf');
  const dadosMsg      = document.getElementById('dadosMsg');
  const formDados     = document.getElementById('dadosForm');

  // Auth dot (navbar)
  const authDot = document.getElementById('authDot');

  // ── UTILS ───────────────────────────────────────────────────
  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent   = text;
    el.className     = `conta-form__msg conta-form__msg--${type}`;
    el.style.display = 'block';
  }
  function hideMsg(el) {
    if (!el) return;
    el.style.display = 'none';
    el.textContent   = '';
  }
  function fmtPrice(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  // ── AUTH STATE ──────────────────────────────────────────────
  const loadingEl = document.getElementById('contaLoading');

  function hideLoading() {
    if (loadingEl) loadingEl.style.display = 'none';
  }

  async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    hideLoading();
    if (session) {
      enterAccount(session.user);
    } else {
      showAuthSection();
    }
  }

  // Parâmetro de redirecionamento pós-login (ex: vindo do checkout)
  const redirectAfterLogin = new URLSearchParams(window.location.search).get('redirect');

  supabaseClient.auth.onAuthStateChange((event, session) => {
    hideLoading();
    if (session) {
      // Se acabou de fazer login e há uma URL de redirecionamento → vai direto
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && redirectAfterLogin) {
        // Valida para aceitar apenas URLs relativas do próprio site (evita open redirect)
        const dest = redirectAfterLogin.replace(/^\/+/, '');
        if (dest && !dest.startsWith('http') && /^[\w\-./]+\.html/.test(dest)) {
          window.location.href = dest;
          return;
        }
      }
      enterAccount(session.user);
      authDot?.classList.add('navbar__account-dot--visible');
    } else {
      showAuthSection();
      authDot?.classList.remove('navbar__account-dot--visible');
    }
  });

  function showAuthSection() {
    authSection?.removeAttribute('hidden');
    accountSection?.setAttribute('hidden', '');
    authDot?.classList.remove('navbar__account-dot--visible');
  }

  function enterAccount(user) {
    authSection?.setAttribute('hidden', '');
    accountSection?.removeAttribute('hidden');

    // Sidebar
    const nome = (user.user_metadata?.nome || '').trim() || 'Cliente';

    // Iniciais: primeira letra de cada palavra (máx 2)
    const initials = nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w.charAt(0).toUpperCase())
      .join('');

    // Troca o ícone pelas iniciais
    const icon     = document.getElementById('sidebarIcon');
    const initialsEl = document.getElementById('sidebarInitials');
    if (icon)       icon.style.display     = 'none';
    if (initialsEl) { initialsEl.textContent = initials; initialsEl.style.display = 'inline'; }

    if (sidebarName)  sidebarName.textContent = nome;
    // Email permanece oculto (removido do layout)

    // Dados form pre-fill (nome e telefone apenas — email só na abertura da aba)
    if (dadosNome) dadosNome.value = user.user_metadata?.nome     || '';
    if (dadosTel)  dadosTel.value  = user.user_metadata?.telefone || '';

    // Gold dot navbar
    authDot?.classList.add('navbar__account-dot--visible');

    // Load pedidos by default
    loadPedidos(user.email);
    showView('pedidos');
  }

  // ── TAB SWITCH ──────────────────────────────────────────────
  tabLogin?.addEventListener('click', () => {
    tabLogin.classList.add('conta-tab--active');
    tabSignup?.classList.remove('conta-tab--active');
    formLogin?.removeAttribute('hidden');
    formSignup?.setAttribute('hidden', '');
  });

  tabSignup?.addEventListener('click', () => {
    tabSignup.classList.add('conta-tab--active');
    tabLogin?.classList.remove('conta-tab--active');
    formSignup?.removeAttribute('hidden');
    formLogin?.setAttribute('hidden', '');
  });

  // ── LOGIN ───────────────────────────────────────────────────
  formLogin?.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const msgEl    = document.getElementById('loginMsg');
    const btn      = formLogin.querySelector('.conta-form__submit');

    hideMsg(msgEl);
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = error.message?.includes('Invalid login credentials')
          ? 'E-mail ou senha incorretos.'
          : error.message;
        showMsg(msgEl, msg, 'erro');
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
      // Se sucesso: onAuthStateChange oculta a seção de auth automaticamente
    } catch (err) {
      showMsg(msgEl, 'Erro de conexão. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  // ── SIGNUP ──────────────────────────────────────────────────
  formSignup?.addEventListener('submit', async e => {
    e.preventDefault();
    const nome     = document.getElementById('signupNome')?.value.trim();
    const email    = document.getElementById('signupEmail')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    const msgEl    = document.getElementById('signupMsg');
    const btn      = formSignup.querySelector('.conta-form__submit');

    hideMsg(msgEl);

    if (password.length < 6) {
      showMsg(msgEl, 'A senha deve ter pelo menos 6 caracteres.', 'erro');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Criando conta…';

    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { nome } }
    });

    if (error) {
      const msg = error.message?.includes('already registered')
        ? 'Este e-mail já está cadastrado. Faça login.'
        : error.message;
      showMsg(msgEl, msg, 'erro');
      btn.disabled = false;
      btn.textContent = 'Criar Conta';
    } else {
      showMsg(msgEl,
        'Conta criada! Verifique seu e-mail para confirmar o cadastro.',
        'ok');
      btn.disabled = false;
      btn.textContent = 'Criar Conta';
    }
  });

  // ── ESQUECI A SENHA ─────────────────────────────────────────
  document.getElementById('btnEsqueciSenha')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail')?.value.trim();
    const msgEl = document.getElementById('loginMsg');

    if (!email) {
      showMsg(msgEl, 'Digite seu e-mail acima para redefinir a senha.', 'erro');
      return;
    }

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/conta.html'
    });

    if (error) {
      showMsg(msgEl, error.message, 'erro');
    } else {
      showMsg(msgEl, 'Link de redefinição enviado para ' + email, 'ok');
    }
  });

  // ── LOGOUT ──────────────────────────────────────────────────
  navLogout?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    // onAuthStateChange handles UI
  });

  // ── VIEW SWITCH ─────────────────────────────────────────────
  function showView(view) {
    viewPedidos?.setAttribute('hidden', '');
    viewFavoritos?.setAttribute('hidden', '');
    viewFidelidade?.setAttribute('hidden', '');
    viewDados?.setAttribute('hidden', '');

    [navPedidos, navFavoritos, navFidelidade, navDados].forEach(b =>
      b?.classList.remove('conta-nav__item--active')
    );

    if (view === 'pedidos') {
      viewPedidos?.removeAttribute('hidden');
      navPedidos?.classList.add('conta-nav__item--active');
    } else if (view === 'favoritos') {
      viewFavoritos?.removeAttribute('hidden');
      navFavoritos?.classList.add('conta-nav__item--active');
    } else if (view === 'fidelidade') {
      viewFidelidade?.removeAttribute('hidden');
      navFidelidade?.classList.add('conta-nav__item--active');
    } else if (view === 'dados') {
      viewDados?.removeAttribute('hidden');
      navDados?.classList.add('conta-nav__item--active');
    }
  }

  navPedidos?.addEventListener('click', () => showView('pedidos'));

  navFavoritos?.addEventListener('click', async () => {
    showView('favoritos');
    await loadFavoritos();
  });

  navFidelidade?.addEventListener('click', async () => {
    showView('fidelidade');
    await loadFidelidade();
  });

  navDados?.addEventListener('click', async () => {
    showView('dados');
    await carregarPerfilEFidelidade();
  });

  // Marca o campo como editado pelo usuário para evitar sobrescrita
  dadosEmail?.addEventListener('input', () => {
    if (dadosEmail) dadosEmail.dataset.userEdited = '1';
  });

  // ── PEDIDOS ─────────────────────────────────────────────────
  async function loadPedidos(email) {
    if (!pedidosList) return;

    pedidosList.innerHTML = '<p style="color:var(--color-text-light);font-size:0.88rem">Carregando pedidos…</p>';

    const emailLower = email.toLowerCase();
    const { data: pedidos, error } = await supabaseClient
      .from('pedidos')
      .select('*')
      .or(`email_cliente.eq.${emailLower},cliente_email.eq.${emailLower}`)
      .order('criado_em', { ascending: false });

    if (error) {
      pedidosList.innerHTML = `
        <div class="conta-empty">
          <p class="conta-empty__title" style="color:#ef4444">Não foi possível carregar seus pedidos</p>
          <p>Tente recarregar a página. Se o problema persistir, entre em contato.</p>
        </div>`;
      return;
    }
    if (!pedidos?.length) {
      pedidosList.innerHTML = `
        <div class="conta-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          <p class="conta-empty__title">Nenhum pedido ainda</p>
          <p>Explore a coleção e encontre peças que combinam com você.</p>
          <a href="catalogo.html">Ver coleção</a>
        </div>`;
      return;
    }

    pedidosList.innerHTML = pedidos.map(p => renderPedido(p)).join('');
  }

  function renderPedido(p) {
    const statusLabel = {
      pago: 'Pago', pendente: 'Pendente', recusado: 'Recusado',
      cancelado: 'Cancelado', reembolsado: 'Reembolsado'
    };
    // Suporta tanto o schema novo (status, total, payment_method) quanto nomes legados
    const statusClass = p.status || p.status_pagamento || 'pendente';
    const label       = statusLabel[statusClass] || statusClass;

    // Itens: pode ser array ou JSON string
    let itens = [];
    try {
      itens = Array.isArray(p.itens) ? p.itens : JSON.parse(p.itens || '[]');
    } catch (_) {}

    const itensHtml = itens.map(it => `
      <div class="conta-pedido__item">
        <div class="conta-pedido__item-img"
          style="${(it.imagem_url || it.imagem) ? `background-image:url('${escHtml(it.imagem_url || it.imagem)}');background-size:cover;background-position:center` : ''}">
        </div>
        <div>
          <div class="conta-pedido__item-name">${escHtml(it.nome || it.name || 'Produto')}</div>
          <div class="conta-pedido__item-meta">
            ${it.tamanho ? `Tam: ${escHtml(it.tamanho)}` : ''}
            ${it.cor_nome || it.cor ? ` · Cor: ${escHtml(it.cor_nome || it.cor)}` : ''}
            ${(it.qty || it.quantidade) ? ` · Qtd: ${escHtml(String(it.qty || it.quantidade))}` : ''}
          </div>
        </div>
      </div>`).join('');

    const total  = fmtPrice(p.total || p.valor_total);
    const pm     = p.payment_method || p.metodo_pagamento || '';
    const method = pm === 'pix'    ? 'PIX' :
                   pm === 'cartao' || pm === 'credito' ? 'Cartão de crédito' :
                   pm === 'debito' ? 'Cartão de débito' : pm;

    return `
      <div class="conta-pedido">
        <div class="conta-pedido__header">
          <div>
            <div class="conta-pedido__num">Pedido <strong>#${p.id?.toString().slice(-6) || p.id}</strong></div>
            <div class="conta-pedido__date">${fmtDate(p.criado_em)}</div>
          </div>
          <span class="conta-pedido__status conta-pedido__status--${statusClass}">${label}</span>
        </div>
        <div class="conta-pedido__body">
          <div class="conta-pedido__items">${itensHtml || '<div class="conta-pedido__item-meta">Detalhes não disponíveis</div>'}</div>
          <div class="conta-pedido__footer">
            <span class="conta-pedido__total">Total: ${total}</span>
            <span class="conta-pedido__method">${method}</span>
          </div>
          ${(statusClass === 'pago' || statusClass === 'enviado') && p.id ? `
          <div class="conta-pedido__actions">
            <a href="rastreio.html?id=${p.id}" class="conta-pedido__rastreio" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              Rastrear pedido
            </a>
          </div>` : ''}
        </div>
      </div>`;
  }

  // ── FAVORITOS ────────────────────────────────────────────────
  async function loadFavoritos() {
    const el = document.getElementById('favoritosList');
    if (!el) return;

    el.innerHTML = '<p style="color:var(--color-text-light);font-size:0.88rem;padding:1rem 0">Carregando favoritos…</p>';

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: favs, error } = await supabaseClient
      .from('favoritos')
      .select('produto_id, criado_em')
      .eq('user_id', user.id)
      .order('criado_em', { ascending: false });

    if (error || !favs?.length) {
      el.innerHTML = `
        <div class="conta-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <p class="conta-empty__title">Nenhum favorito ainda</p>
          <p>Clique no coração nas peças que você gostar para salvá-las aqui.</p>
          <a href="catalogo.html">Explorar coleção</a>
        </div>`;
      return;
    }

    // Busca dados dos produtos favoritos
    const ids = favs.map(f => f.produto_id);
    const { data: produtos } = await supabaseClient
      .from('produtos')
      .select('id, nome, categoria, preco_original, preco_desconto, imagem_url, imagem_placeholder')
      .in('id', ids)
      .eq('ativo', true);

    if (!produtos?.length) {
      el.innerHTML = `<p style="color:var(--color-text-light);font-size:0.85rem">Alguns produtos favoritos podem ter sido removidos da loja.</p>`;
      return;
    }

    const fmt = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    el.innerHTML = `<div class="favoritos-grid">${produtos.map(p => {
      const preco = p.preco_desconto ?? p.preco_original;
      const temDesc = !!p.preco_desconto;
      const img = p.imagem_url
        ? `background:url('${p.imagem_url}') center/cover no-repeat`
        : `background:${p.imagem_placeholder || 'linear-gradient(160deg,#F4F1EA,#EAE4D9)'}`;
      return `
        <div class="favorito-card">
          <a href="produto.html?id=${p.id}" class="favorito-card__img" style="${img}">
            <button class="favorito-card__remove" data-wishlist-id="${p.id}"
              aria-label="Remover dos favoritos" aria-pressed="true"
              title="Remover dos favoritos">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
          </a>
          <div class="favorito-card__info">
            <p class="favorito-card__cat">${(p.categoria || '').charAt(0).toUpperCase() + (p.categoria || '').slice(1)}</p>
            <h3 class="favorito-card__nome"><a href="produto.html?id=${p.id}">${p.nome}</a></h3>
            <div class="favorito-card__preco">
              <span class="favorito-card__preco-atual">${fmt(preco)}</span>
              ${temDesc ? `<span class="favorito-card__preco-orig">${fmt(p.preco_original)}</span>` : ''}
            </div>
            <a href="produto.html?id=${p.id}" class="favorito-card__btn">Ver peça</a>
          </div>
        </div>`;
    }).join('')}</div>`;

    // Atualiza corações (todos marcados como ativos) e adiciona listener para remover
    el.querySelectorAll('.favorito-card__remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.wishlistId;
        if (window.VirtuWishlist) await window.VirtuWishlist.toggle(id);
        // Remove o card da tela imediatamente
        btn.closest('.favorito-card')?.remove();
        // Se não há mais favoritos, mostra estado vazio
        if (!el.querySelector('.favorito-card')) await loadFavoritos();
      });
    });
  }

  // ── CARREGA PERFIL (clientes_perfil) ─────────────────────────
  async function carregarPerfilEFidelidade() {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;

      // Perfil complementar (CPF, WhatsApp)
      const { data: perfil } = await supabaseClient
        .from('clientes_perfil')
        .select('cpf, whatsapp')
        .eq('id', user.id)
        .maybeSingle();

      const cpfEl = document.getElementById('dadosCpf');
      if (cpfEl && perfil?.cpf && !cpfEl.value) {
        cpfEl.dataset.cpfOriginal = perfil.cpf;
        cpfEl.placeholder = maskCpf(perfil.cpf) + '  (deixe em branco para manter)';
      }
      if (dadosTel && perfil?.whatsapp && !dadosTel.value) dadosTel.value = perfil.whatsapp;
    } catch (e) {
      console.warn('[Conta] Erro ao carregar perfil:', e);
    }

    // Máscara CPF
    const cpfEl = document.getElementById('dadosCpf');
    if (cpfEl && !cpfEl.dataset.maskSet) {
      cpfEl.dataset.maskSet = '1';
      cpfEl.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '').slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, '$1.$2')
             .replace(/(\d{3})(\d)/, '$1.$2')
             .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        this.value = v;
      });
    }
  }

  // ── TELA DE BENEFÍCIO VIRTÙ (desconto automático por pedido) ──
  async function loadFidelidade() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    // O card de benefício é estático no HTML — não precisa de chamada ao DB.
    // Carrega apenas o histórico de pedidos da cliente.
    await loadHistoricoFidelidade(user);
  }

  /** Formata data curta: dd/mm/aaaa */
  function fmtDataCurta(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        timeZone: 'America/Recife',
      });
    } catch { return String(iso).slice(0, 10); }
  }

  /** Carrega tabela de pedidos completos na view de fidelidade */
  async function loadHistoricoFidelidade(user) {
    const el = document.getElementById('fidelHistoricoList');
    const totalEl = document.getElementById('fidelTotalCompras');
    if (!el) return;

    el.innerHTML = '<p style="padding:1.5rem;font-size:0.85rem;color:#AFA99F;text-align:center">Carregando histórico…</p>';

    try {
      const email = user.email;
      const { data: pedidos, error } = await supabaseClient
        .from('pedidos')
        .select('id, criado_em, status, total, payment_method, itens')
        .or(`email_cliente.eq.${email},cliente_email.eq.${email},user_id.eq.${user.id}`)
        .order('criado_em', { ascending: false })
        .limit(50);

      if (error) throw error;

      const pagos = (pedidos || []).filter(p => p.status === 'pago');
      if (totalEl) totalEl.textContent = `${pagos.length} compra${pagos.length !== 1 ? 's' : ''} confirmada${pagos.length !== 1 ? 's' : ''}`;

      if (!pedidos?.length) {
        el.innerHTML = `
          <div style="padding:2.5rem;text-align:center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E2DDD7" stroke-width="1.2" style="margin-bottom:12px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p style="font-size:0.88rem;color:#AFA99F;margin:0">Nenhum pedido encontrado ainda.</p>
            <a href="catalogo.html" style="display:inline-block;margin-top:12px;font-size:0.78rem;color:#1a2a4a;font-weight:500">Explorar coleção →</a>
          </div>`;
        return;
      }

      const statusLabel = s => ({
        pago:      '<span style="background:#ECFDF5;color:#065F46;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:600">✓ Pago</span>',
        pendente:  '<span style="background:#FEF9C3;color:#854D0E;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:600">⏳ Pendente</span>',
        recusado:  '<span style="background:#FEF2F2;color:#991B1B;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:600">✕ Recusado</span>',
      }[s] || `<span style="font-size:0.7rem;color:#9E9690">${escHtml(s)}</span>`);

      const metodoPagto = m => ({
        pix:    'PIX',
        cartao: 'Cartão',
        boleto: 'Boleto',
      }[m] || (m || '—'));

      let cicloCount = 0;
      const linhas = pedidos.map((p, idx) => {
        const isPago = p.status === 'pago';
        if (isPago) cicloCount++;
        const numPedido = String(p.id).slice(-6).toUpperCase();
        const data = new Date(p.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
        const itensCount = Array.isArray(p.itens) ? p.itens.length : '–';
        const totalFmt = fmtPrice(p.total);
        const ciclo = isPago ? `<span style="font-size:0.7rem;color:#9E9690;font-weight:500">#${cicloCount}</span>` : '–';
        return `<tr style="${idx % 2 === 0 ? '' : 'background:#fafaf8'}">
          <td style="padding:0.85rem 1rem;font-size:0.78rem;color:#9E9690">${data}</td>
          <td style="padding:0.85rem 1rem;font-size:0.8rem;font-family:'Courier New',monospace;color:#1a2a4a;font-weight:600">#${numPedido}</td>
          <td style="padding:0.85rem 1rem;font-size:0.78rem;color:#4A4440">${itensCount} ${Number(itensCount) === 1 ? 'item' : 'itens'}</td>
          <td style="padding:0.85rem 1rem;font-size:0.82rem;color:#1a2a4a;font-weight:500">${totalFmt}</td>
          <td style="padding:0.85rem 1rem;font-size:0.78rem;color:#6E6660">${metodoPagto(p.payment_method)}</td>
          <td style="padding:0.85rem 1rem">${statusLabel(p.status)}</td>
          <td style="padding:0.85rem 1rem;text-align:center">${ciclo}</td>
        </tr>`;
      }).join('');

      el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:580px">
          <thead>
            <tr style="background:#1a2a4a;color:rgba(255,255,255,.85)">
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Data</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Pedido</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Itens</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Total</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Pagamento</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase">Status</th>
              <th style="padding:0.75rem 1rem;text-align:center;font-size:0.7rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase" title="Nº da compra no ciclo de fidelidade">Ciclo</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>`;
    } catch (e) {
      console.error('[Fidelidade Histórico]', e);
      el.innerHTML = '<p style="padding:1.5rem;font-size:0.82rem;color:#c62828;text-align:center">Erro ao carregar histórico. Tente novamente.</p>';
    }
  }

  // ── DADOS PESSOAIS ───────────────────────────────────────────
  formDados?.addEventListener('submit', async e => {
    e.preventDefault();
    hideMsg(dadosMsg);

    const nome     = dadosNome?.value.trim();
    const telefone = dadosTel?.value.trim();
    const senha    = dadosSenha?.value;
    const senhaConf= dadosSenhaConf?.value;

    if (senha && senha !== senhaConf) {
      showMsg(dadosMsg, 'As senhas não coincidem.', 'erro');
      return;
    }
    if (senha && senha.length < 6) {
      showMsg(dadosMsg, 'A nova senha deve ter pelo menos 6 caracteres.', 'erro');
      return;
    }

    const btn = formDados.querySelector('.conta-dados__save');
    btn.disabled    = true;
    btn.textContent = 'Salvando…';

    try {
      const novoEmail = dadosEmail?.value.trim();
      // Só altera email se o campo foi preenchido com um valor diferente do atual
      const { data: { user: currentUser } } = await supabaseClient.auth.getUser();
      const emailMudou = novoEmail && novoEmail !== currentUser?.email;

      const updates = { data: { nome, telefone } };
      if (senha)      updates.password = senha;
      if (emailMudou) updates.email    = novoEmail;

      const { error } = await supabaseClient.auth.updateUser(updates);

      if (error) {
        showMsg(dadosMsg, error.message, 'erro');
      } else {
        // Salva CPF e WhatsApp em clientes_perfil
        // Se o campo CPF estiver vazio, usa o valor original armazenado (LGPD: campo mostra mascarado)
        const cpfEl2   = document.getElementById('dadosCpf');
        const cpfTyped = cpfEl2?.value.trim();
        const cpf      = cpfTyped || cpfEl2?.dataset.cpfOriginal || null;
        const whatsapp = telefone || null;
        if (currentUser && (cpf || whatsapp || nome)) {
          try {
            await supabaseClient
              .from('clientes_perfil')
              .upsert({
                id:       currentUser.id,
                nome:     nome   || null,
                cpf:      cpf,
                whatsapp: whatsapp,
              }, { onConflict: 'id' });
          } catch { /* não bloqueia */ }
        }

        const msgEmail = emailMudou
          ? ' Verifique o novo e-mail para confirmar a alteração.'
          : '';
        showMsg(dadosMsg, 'Dados atualizados com sucesso!' + msgEmail, 'ok');
        if (dadosSenha)     dadosSenha.value     = '';
        if (dadosSenhaConf) dadosSenhaConf.value = '';

        // Mantém o email que o usuário digitou no campo (não deixa voltar o antigo)
        if (dadosEmail && emailMudou) {
          dadosEmail.value = novoEmail;
          dadosEmail.dataset.userEdited = '1'; // continua protegido contra sobrescrita
        } else if (dadosEmail) {
          delete dadosEmail.dataset.userEdited;
        }

        // Update sidebar name
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
          const nomeAtualizado = (user.user_metadata?.nome || '').trim() || 'Cliente';
          if (sidebarName) sidebarName.textContent = nomeAtualizado;
          const newInitials = nomeAtualizado.split(/\s+/).filter(Boolean).slice(0,2).map(w => w.charAt(0).toUpperCase()).join('');
          const initialsEl2 = document.getElementById('sidebarInitials');
          if (initialsEl2) initialsEl2.textContent = newInitials;
        }
      }
    } catch (err) {
      showMsg(dadosMsg, 'Erro de conexão. Tente novamente.', 'erro');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Salvar Alterações';
    }
  });

  // ── NAVBAR SCROLL ───────────────────────────────────────────
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // ── MOBILE MENU ─────────────────────────────────────────────
  const menuToggle  = document.getElementById('menuToggle');
  const mobileMenu  = document.getElementById('mobileMenu');
  const menuClose   = document.getElementById('menuClose');
  const menuOverlay = document.getElementById('menuOverlay');

  const openMenu  = () => { mobileMenu?.classList.add('open'); document.body.style.overflow = 'hidden'; menuToggle?.setAttribute('aria-expanded','true'); };
  const closeMenu = () => { mobileMenu?.classList.remove('open'); document.body.style.overflow = ''; menuToggle?.setAttribute('aria-expanded','false'); };

  menuToggle?.addEventListener('click', openMenu);
  menuClose?.addEventListener('click', closeMenu);
  menuOverlay?.addEventListener('click', closeMenu);

  // ── SEARCH OVERLAY ──────────────────────────────────────────
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
    if (e.key === 'Escape') { closeMenu(); closeSearch(); }
  });

  // ── INIT ────────────────────────────────────────────────────
  checkAuth();

});
