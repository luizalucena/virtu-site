/* ============================================================
   VIRTÙ — Conta do Cliente
   Supabase Auth: login, cadastro, logout, pedidos, dados
   ============================================================ */

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
  const sidebarEmail   = document.getElementById('sidebarEmail');

  // Nav buttons
  const navPedidos = document.getElementById('navPedidos');
  const navDados   = document.getElementById('navDados');
  const navLogout  = document.getElementById('navLogout');

  // Content views
  const viewPedidos = document.getElementById('viewPedidos');
  const viewDados   = document.getElementById('viewDados');
  const pedidosList = document.getElementById('pedidosList');

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

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    hideLoading();
    if (session) {
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
    const nome = user.user_metadata?.nome || user.email.split('@')[0];

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

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      const msg = error.message?.includes('Invalid login credentials')
        ? 'E-mail ou senha incorretos.'
        : error.message;
      showMsg(msgEl, msg, 'erro');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
    // onAuthStateChange handles the rest
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
    viewDados?.setAttribute('hidden', '');

    navPedidos?.classList.remove('conta-nav__item--active');
    navDados?.classList.remove('conta-nav__item--active');

    if (view === 'pedidos') {
      viewPedidos?.removeAttribute('hidden');
      navPedidos?.classList.add('conta-nav__item--active');
    } else if (view === 'dados') {
      viewDados?.removeAttribute('hidden');
      navDados?.classList.add('conta-nav__item--active');
    }
  }

  navPedidos?.addEventListener('click', () => showView('pedidos'));
  navDados?.addEventListener('click', () => {
    showView('dados');
    // Email não é preenchido automaticamente — cliente digita se quiser alterar
  });

  // Marca o campo como editado pelo usuário para evitar sobrescrita
  dadosEmail?.addEventListener('input', () => {
    if (dadosEmail) dadosEmail.dataset.userEdited = '1';
  });

  // ── PEDIDOS ─────────────────────────────────────────────────
  async function loadPedidos(email) {
    if (!pedidosList) return;

    pedidosList.innerHTML = '<p style="color:var(--color-text-light);font-size:0.88rem">Carregando pedidos…</p>';

    const { data: pedidos, error } = await supabaseClient
      .from('pedidos')
      .select('*')
      .eq('email_cliente', email)
      .order('criado_em', { ascending: false });

    if (error || !pedidos?.length) {
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
    const statusClass = p.status_pagamento || 'pendente';
    const label       = statusLabel[statusClass] || statusClass;

    // Itens: pode ser array ou JSON string
    let itens = [];
    try {
      itens = Array.isArray(p.itens) ? p.itens : JSON.parse(p.itens || '[]');
    } catch (_) {}

    const itensHtml = itens.map(it => `
      <div class="conta-pedido__item">
        <div class="conta-pedido__item-img"
          style="${it.imagem ? `background-image:url('${it.imagem}');background-size:cover;background-position:center` : ''}">
        </div>
        <div>
          <div class="conta-pedido__item-name">${it.nome || it.name || 'Produto'}</div>
          <div class="conta-pedido__item-meta">
            ${it.tamanho ? `Tam: ${it.tamanho}` : ''}
            ${it.cor     ? ` · Cor: ${it.cor}` : ''}
            ${it.quantidade ? ` · Qtd: ${it.quantidade}` : ''}
          </div>
        </div>
      </div>`).join('');

    const total  = fmtPrice(p.valor_total);
    const method = p.metodo_pagamento === 'pix' ? 'PIX' :
                   p.metodo_pagamento === 'credito' ? 'Cartão de crédito' :
                   p.metodo_pagamento === 'debito'  ? 'Cartão de débito' :
                   p.metodo_pagamento || '';

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
        </div>
      </div>`;
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
        const nomeAtualizado = user.user_metadata?.nome || user.email.split('@')[0];
        if (sidebarName) sidebarName.textContent = nomeAtualizado;
        const newInitials = nomeAtualizado.split(/\s+/).filter(Boolean).slice(0,2).map(w => w.charAt(0).toUpperCase()).join('');
        const initialsEl2 = document.getElementById('sidebarInitials');
        if (initialsEl2) initialsEl2.textContent = newInitials;
      }
    }

    btn.disabled    = false;
    btn.textContent = 'Salvar Alterações';
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
