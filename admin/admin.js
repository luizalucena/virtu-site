/* ============================================================
   VIRTÙ — Admin Panel JavaScript (Supabase Edition)
   Todas as alterações são salvas automaticamente no banco de dados.
   Requer: supabase CDN + js/supabase-config.js carregados antes
   ============================================================ */

// ── ESTADO GLOBAL ──────────────────────────
let DB = { produtos: [], configuracoes: {} };
let filtroAtual = 'todos';
let editandoId  = null;

// Conjunto de IDs de produtos com operação em curso — previne race conditions
const _productOps = new Set();

// ── RECUPERAÇÃO DE SENHA — detecção do token ────────────────
// Lido de forma síncrona, antes de o supabase-js limpar a URL. Cobre o fluxo
// implícito (#type=recovery), PKCE (?code) e link expirado (#error=).
const _admHp = (() => { try { return new URLSearchParams(location.hash.replace(/^#/, '')); } catch { return new URLSearchParams(); } })();
const _admQp = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const _admRecoveryError = _admHp.get('error') || _admQp.get('error');
let   _admRecoveryFlow  = _admHp.get('type') === 'recovery' || _admQp.get('type') === 'recovery' || !!_admRecoveryError;
let   _admRecoveryDone  = false;
const ADMIN_RECOVERY_REDIRECT = window.location.origin + '/admin/index.html';
// PKCE defensivo: troca o code por sessão (o evento decide a ação).
if (_admQp.get('code')) {
  try { supabaseClient.auth.exchangeCodeForSession(window.location.href).catch(() => {}); } catch { /* ignore */ }
}

// ── CONVERTE URL DO GOOGLE DRIVE ────────────
// Usa lh3.googleusercontent.com/d/{ID} — único formato que funciona
// como CSS background-image sem redirect/CORS
function convertDriveUrl(url) {
  if (!url) return url;
  // /file/d/{ID}/view  ou  /file/d/{ID}
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  // ?id={ID} ou &id={ID}
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2 && url.includes('drive.google.com')) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  // Já está no formato lh3 ou uc?export — extrai o ID se possível
  const m3 = url.match(/lh3\.googleusercontent\.com\/d\/([^/?&]+)/);
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`;
  const m4 = url.match(/uc\?export=view&id=([^&]+)/);
  if (m4) return `https://lh3.googleusercontent.com/d/${m4[1]}`;
  return url;
}

// ── GALERIA DE FOTOS: GERENCIA INPUTS ───────
function getGaleriaUrls() {
  return [...document.querySelectorAll('.galeria-url-input')]
    .map(i => convertDriveUrl(i.value.trim()))
    .filter(Boolean);
}

function buildGaleriaRows(imagens = []) {
  const container = document.getElementById('galeriaInputs');
  if (!container) return;
  container.innerHTML = '';
  const lista = imagens.length ? imagens : [''];
  lista.forEach((url, idx) => addGaleriaRow(url, idx + 1));
}

function addGaleriaRow(url = '', num = null) {
  const container = document.getElementById('galeriaInputs');
  if (!container) return;
  const current = container.querySelectorAll('.galeria-input-row').length;
  if (current >= 5) return;
  const n = num ?? current + 1;
  const row = document.createElement('div');
  row.className = 'galeria-input-row';
  row.style.cssText = 'display:flex;gap:0.5rem;align-items:center';
  row.innerHTML = `
    <span style="font-size:0.72rem;color:#888;min-width:16px">${n}</span>
    <input type="url" class="admin-input galeria-url-input" placeholder="URL da foto ${n}" style="flex:1" value="${url}" />
    <div class="galeria-preview-dot" style="width:28px;height:28px;border-radius:4px;border:1px solid #e0d8d0;flex-shrink:0;background:${url ? `url('${convertDriveUrl(url)}') center/cover` : '#f5f0eb'}"></div>
    ${n > 1 ? `<button type="button" class="galeria-remove-btn" title="Remover" style="font-size:0.85rem;color:#c0a080;background:none;border:none;cursor:pointer;padding:0 4px">✕</button>` : ''}
  `;
  // Preview ao sair do campo
  const input = row.querySelector('.galeria-url-input');
  const preview = row.querySelector('.galeria-preview-dot');
  input?.addEventListener('blur', () => {
    const v = convertDriveUrl(input.value.trim());
    preview.style.background = v ? `url('${v}') center/cover` : '#f5f0eb';
    input.value = v; // substitui pelo URL convertido
  });
  // Remover linha — e reexibir botão de adicionar se ficou abaixo do limite
  row.querySelector('.galeria-remove-btn')?.addEventListener('click', () => {
    row.remove();
    const remaining = container.querySelectorAll('.galeria-input-row').length;
    if (remaining < 5) {
      const btnAdd = document.getElementById('btnAddFoto');
      if (btnAdd) btnAdd.style.display = '';
    }
  });
  container.appendChild(row);
}

// ── INICIALIZAÇÃO ───────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Verifica autenticação antes de mostrar o painel
  await verificarAuth();
});

// ── AUTH: VERIFICAR SESSÃO E PAPEL ──────────
async function verificarAuth() {
  // Fluxo de recuperação tem prioridade: mostra a tela de nova senha (ou o
  // bloco de link expirado) e NÃO entra no painel automaticamente.
  if (_admRecoveryError)     { mostrarRecovery(true);  bindRecoveryEvents(); }
  else if (_admRecoveryFlow) { mostrarRecovery(false); bindRecoveryEvents(); }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!_admRecoveryFlow) await roteiaPorPapel(session);

  // Escuta mudanças de estado de autenticação
  supabaseClient.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') {
      _admRecoveryFlow = true;
      mostrarRecovery(false);
      bindRecoveryEvents();
      return;
    }
    if (_admRecoveryFlow && !_admRecoveryDone) {
      mostrarRecovery(!!_admRecoveryError);
      bindRecoveryEvents();
      return;
    }
    roteiaPorPapel(s);
  });
}

// ── RECUPERAÇÃO: tela de nova senha ─────────
function mostrarRecovery(expirado) {
  const login = document.getElementById('loginScreen');
  const rec   = document.getElementById('recoveryScreen');
  if (login) { login.classList.add('login-screen--hidden'); login.style.display = 'none'; }
  if (rec)   { rec.style.display = ''; rec.classList.remove('login-screen--hidden'); }
  const form    = document.getElementById('recoveryForm');
  const expired = document.getElementById('recoveryExpired');
  if (expirado) {
    if (form)    form.style.display = 'none';
    if (expired) expired.style.display = '';
  } else {
    if (form)    form.style.display = '';
    if (expired) expired.style.display = 'none';
    document.getElementById('recoveryPassword')?.focus();
  }
}

let _recoveryEventsBound = false;
function bindRecoveryEvents() {
  if (_recoveryEventsBound) return;
  _recoveryEventsBound = true;

  // Salvar nova senha
  document.getElementById('recoveryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1  = document.getElementById('recoveryPassword')?.value || '';
    const p2  = document.getElementById('recoveryPasswordConf')?.value || '';
    const err = document.getElementById('recoveryError');
    const btn = document.getElementById('recoveryBtn');
    if (err) err.textContent = '';

    if (p1.length < 8) { if (err) err.textContent = 'A senha deve ter pelo menos 8 caracteres.'; return; }
    if (p1 !== p2)     { if (err) err.textContent = 'As senhas não coincidem.'; return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    let error = null;
    try { ({ error } = await supabaseClient.auth.updateUser({ password: p1 })); }
    catch (ex) { error = ex; }

    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('session') || m.includes('expired') || m.includes('jwt') ||
          m.includes('token') || m.includes('not authenticated') || m.includes('auth session')) {
        mostrarRecovery(true);
      } else if (err) {
        err.textContent = 'Não foi possível salvar. Tente novamente.';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
      return;
    }

    // Sucesso: encerra o recovery e entra no painel (revalidando o papel).
    _admRecoveryDone = true;
    if (btn) btn.textContent = 'Senha salva ✓';
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
    const rec = document.getElementById('recoveryScreen');
    setTimeout(async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (rec) { rec.style.display = 'none'; rec.classList.add('login-screen--hidden'); }
      await roteiaPorPapel(session);
    }, 1200);
  });

  // Reenviar link (bloco expirado)
  document.getElementById('recoveryResendForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recoveryResendEmail')?.value.trim();
    const msg   = document.getElementById('recoveryResendMsg');
    const btn   = document.getElementById('recoveryResendBtn');
    if (msg) msg.textContent = '';
    if (!email) { if (msg) msg.textContent = 'Digite seu e-mail.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: ADMIN_RECOVERY_REDIRECT });
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar novo link'; }
    if (msg) {
      msg.style.color = error ? '' : '#2e7d32';
      msg.textContent = error
        ? 'Não foi possível enviar. Tente novamente.'
        : 'Enviamos um novo link para ' + email + '. Verifique a caixa de entrada (e o spam).';
    }
  });
}

// Só o admin da loja (is_virtu_admin no banco) acessa o painel. O backend
// (RLS + guard nas RPCs) já bloqueia os dados; esta é a barreira no frontend.
async function ehAdmin() {
  try {
    const { data, error } = await supabaseClient.rpc('is_virtu_admin');
    return !error && data === true;
  } catch { return false; }
}

async function roteiaPorPapel(session) {
  if (session && await ehAdmin()) {
    mostrarAdmin();
    return;
  }
  if (session) {
    // Logada, mas não é admin → desloga, mostra login e avisa.
    mostrarLogin();
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.textContent = 'Acesso restrito ao administrador da loja.';
    const btn = document.getElementById('loginBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
    await supabaseClient.auth.signOut();
    return;
  }
  mostrarLogin();
}

function mostrarLogin() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.remove('login-screen--hidden');
  }
  bindLoginEvents();
}

let _eventsBound = false;
function mostrarAdmin() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.add('login-screen--hidden');
    setTimeout(() => loginScreen.style.display = 'none', 300);
  }
  setStatus('info', '⏳ Conectando ao banco de dados…');
  carregarDados();
  if (!_eventsBound) { bindEvents(); _eventsBound = true; }
  abrirViewPeloHash();
}

// Abre a view correspondente ao #hash (ex.: index.html#pedidos vindo de outra
// página do admin). Só aceita hash "simples" (uma palavra) — nunca tokens de
// auth (#type=recovery, #access_token, que têm '=').
function abrirViewPeloHash() {
  try {
    const h = (location.hash || '').replace(/^#/, '');
    if (!/^[a-z]+$/.test(h)) return;
    const btn = document.querySelector(`.admin-nav-btn[data-view="${h}"]`);
    if (btn) btn.click();
  } catch { /* ignore */ }
}

// ── AUTH: EVENTOS DE LOGIN ──────────────────
let _loginEventsBound = false;
function bindLoginEvents() {
  if (_loginEventsBound) return;
  _loginEventsBound = true;
  const form     = document.getElementById('loginForm');
  const errorEl  = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');

  // ── Esqueci minha senha ──────────────────
  document.getElementById('btnForgotAdmin')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail')?.value.trim();
    if (!email) {
      errorEl.style.color = '';
      errorEl.textContent = 'Digite seu e-mail acima para redefinir a senha.';
      return;
    }
    const btn = document.getElementById('btnForgotAdmin');
    const _t  = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: ADMIN_RECOVERY_REDIRECT });
    if (btn) { btn.disabled = false; btn.textContent = _t || 'Esqueci minha senha'; }
    if (error) {
      errorEl.style.color = '';
      errorEl.textContent = 'Não foi possível enviar. Tente novamente.';
    } else {
      errorEl.style.color = '#2e7d32';
      errorEl.textContent = 'Link de redefinição enviado para ' + email + '. Verifique a caixa de entrada (e o spam).';
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    if (!email || !password) {
      errorEl.textContent = 'Preencha o e-mail e a senha.';
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'A entrar…';
    errorEl.textContent = '';

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      const m = (error.message || '').toLowerCase();
      errorEl.textContent =
        m.includes('invalid login')      ? 'E-mail ou senha incorretos.' :
        m.includes('email not confirmed') ? 'Confirme seu e-mail antes de entrar.' :
        (m.includes('rate limit') || m.includes('for security')) ? 'Muitas tentativas. Aguarde e tente novamente.' :
        'Não foi possível entrar. Tente novamente.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
    }
    // Se sucesso, onAuthStateChange (roteiaPorPapel) valida o papel de admin.
  });
}

// ── CARREGAR DADOS DO SUPABASE ──────────────
async function carregarDados() {
  try {
    const [{ data: produtos, error: e1 }, { data: cfg, error: e2 }] = await Promise.all([
      supabaseClient.from('produtos').select('*').order('criado_em', { ascending: false }),
      supabaseClient.from('configuracoes').select('*').eq('id', 1).maybeSingle()
    ]);

    if (e1) throw e1;

    DB.produtos      = produtos || [];
    DB.configuracoes = cfg     || {};

    renderTable();
    const n = DB.produtos.length;
    setStatus('success', `✓ Conectado ao Supabase. <strong>${n}</strong> produto${n !== 1 ? 's' : ''} carregado${n !== 1 ? 's' : ''}.`);

    // ── Realtime: atualiza produtos e pedidos ao vivo ─────
    _initRealtime();
  } catch (e) {
    setStatus('error', `✗ Erro ao conectar: ${e.message}. Verifique as credenciais em <code>js/supabase-config.js</code>`);
    toast('Erro ao conectar ao banco de dados', 'error');
  }
}

// ── REALTIME ─────────────────────────────────
let _realtimeInitializado = false;
function _initRealtime() {
  if (_realtimeInitializado) return;
  _realtimeInitializado = true;

  const dot = document.getElementById('realtimeDot');
  const setDot = ok => {
    if (!dot) return;
    dot.style.background = ok ? '#22c55e' : '#f59e0b';
    dot.title = ok ? 'Ao vivo — dados em tempo real' : 'Reconectando…';
  };

  try {
    supabaseClient
      .channel('admin-main-live')
      // Produto alterado (estoque, preço, ativo)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, payload => {
        const currentView = document.querySelector('.admin-nav-btn--active')?.getAttribute('data-view');
        if (currentView === 'produtos' || currentView === 'stock') {
          // Atualiza apenas a linha afetada para não fazer reload completo
          const changed = payload.new || payload.old;
          if (changed?.id) {
            const idx = DB.produtos.findIndex(p => p.id === changed.id);
            if (idx !== -1 && payload.new) {
              DB.produtos[idx] = { ...DB.produtos[idx], ...payload.new };
            } else if (payload.eventType === 'INSERT' && payload.new) {
              DB.produtos.unshift(payload.new);
            } else if (payload.eventType === 'DELETE' && payload.old) {
              DB.produtos = DB.produtos.filter(p => p.id !== payload.old.id);
            }
            renderTable();
          }
        }
        setDot(true);
      })
      // Novo pedido chegou
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, () => {
        const currentView = document.querySelector('.admin-nav-btn--active')?.getAttribute('data-view');
        toast('🛍️ Novo pedido recebido!', 'success');
        if (currentView === 'pedidos' && typeof window.pedidosInit === 'function') {
          window.pedidosInit();
        }
        setDot(true);
      })
      .subscribe(status => {
        setDot(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Admin Realtime] Canal com erro — Supabase irá reconectar automaticamente.');
        }
      });
  } catch (err) {
    console.warn('[Admin Realtime]', err.message);
  }
}

// ── BIND DE EVENTOS ─────────────────────────
function bindEvents() {
  // Navegação sidebar
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('admin-nav-btn--active'));
      btn.classList.add('admin-nav-btn--active');
      const view = btn.getAttribute('data-view');
      document.querySelectorAll('.admin-view').forEach(v => v.classList.add('admin-view--hidden'));
      document.getElementById(`view${capitalize(view)}`)?.classList.remove('admin-view--hidden');
      // Títulos legíveis na topbar
      const viewTitles = { dashboard: 'Dashboard', produtos: 'Produtos', pedidos: 'Pedidos', sobre: 'Página Sobre', configuracoes: 'Configurações', stock: 'Controlo de Stock', avaliacoes: 'Avaliações de Clientes', funcionalidades: 'Funcionalidades', reposicao: 'Avisos de Reposição' };
      document.getElementById('viewTitle').textContent = viewTitles[view] || capitalize(view);
      // Ocultar/mostrar botão Novo Produto
      document.getElementById('btnNewProduct').style.display = view === 'produtos' ? '' : 'none';
      if (view === 'configuracoes') populateConfig();
      if (view === 'sobre')        populateSobre();
      if (view === 'avaliacoes')   carregarAvaliacoesAdmin();
      if (view === 'logs')         carregarLogsAdmin();
      if (view === 'pedidos') { if (typeof window.pedidosInit === 'function') window.pedidosInit(); }
      if (view === 'dashboard')    carregarDashboard();
      if (view === 'reposicao')    carregarReposicao();
    });
  });

  // Botão de logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    // onAuthStateChange irá mostrar o login automaticamente
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
      loginScreen.style.display = '';
      setTimeout(() => loginScreen.classList.remove('login-screen--hidden'), 10);
    }
  });

  // Botão recarregar (era "Abrir JSON")
  document.getElementById('btnOpenFile')?.addEventListener('click', async () => {
    setStatus('info', '⏳ Recarregando dados…');
    await carregarDados();
  });

  // Botão exportar backup (era "Salvar JSON")
  document.getElementById('btnSaveFile')?.addEventListener('click', exportarBackup);

  // Novo produto
  document.getElementById('btnNewProduct')?.addEventListener('click', () => openModal(null));

  // Fechar modal
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('btnCancelModal')?.addEventListener('click', closeModal);
  document.getElementById('modalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  // Salvar produto no modal
  document.getElementById('btnSaveProduct')?.addEventListener('click', saveProduct);

  // Busca
  document.getElementById('searchInput')?.addEventListener('input', renderTable);

  // Filtro pills
  document.querySelectorAll('.admin-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.admin-pill').forEach(p => p.classList.remove('admin-pill--active'));
      pill.classList.add('admin-pill--active');
      filtroAtual = pill.getAttribute('data-filter');
      renderTable();
    });
  });

  // Preview da cor de fundo
  document.getElementById('formPlaceholder')?.addEventListener('input', function () {
    document.getElementById('colorPreview').style.background = this.value;
  });

  // Preview de desconto (range ↔ campo de preço)
  document.getElementById('formPctDesconto')?.addEventListener('input', function () {
    const orig = parseFloat(document.getElementById('formPrecoOriginal')?.value) || 0;
    const pct  = parseInt(this.value);
    if (orig > 0 && pct > 0) {
      document.getElementById('formPrecoDesconto').value = (orig * (1 - pct / 100)).toFixed(2);
    } else {
      document.getElementById('formPrecoDesconto').value = '';
    }
    updateDiscountPreview();
  });

  document.getElementById('formPrecoOriginal')?.addEventListener('input', updateDiscountPreview);
  document.getElementById('formPrecoDesconto')?.addEventListener('input', function () {
    const orig = parseFloat(document.getElementById('formPrecoOriginal')?.value) || 0;
    const desc = parseFloat(this.value);
    if (orig > 0 && desc > 0 && desc < orig) {
      document.getElementById('formPctDesconto').value = Math.round((1 - desc / orig) * 100);
    } else {
      document.getElementById('formPctDesconto').value = 0;
    }
    updateDiscountPreview();
  });

  // Salvar config
  document.getElementById('btnSaveConfig')?.addEventListener('click', saveConfig);

  // Salvar sobre
  document.getElementById('btnSaveSobre')?.addEventListener('click', saveSobre);

  // ESC fecha modal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Botão adicionar foto
  document.getElementById('btnAddFoto')?.addEventListener('click', () => {
    const current = document.querySelectorAll('.galeria-input-row').length;
    if (current < 5) addGaleriaRow('', current + 1);
    if (current + 1 >= 5) document.getElementById('btnAddFoto').style.display = 'none';
  });
}

// ── EXPORTAR BACKUP (JSON download) ────────
function exportarBackup() {
  const json = JSON.stringify(DB, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `virtu-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup exportado!', 'success');
}

// ── RENDERIZA TABELA ────────────────────────
function renderTable() {
  const tbody  = document.getElementById('productsTableBody');
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const empty  = document.getElementById('tableEmpty');
  if (!tbody) return;

  let lista = [...DB.produtos];

  // Filtro por categoria / status
  if (filtroAtual === 'inativos') {
    lista = lista.filter(p => !p.ativo);
  } else if (filtroAtual === 'essenciais') {
    // Mostra produtos marcados como Essencial (qualquer categoria) ou com categoria 'essenciais'
    lista = lista.filter(p => p.ativo && (p.essencial || p.categoria === 'essenciais'));
  } else if (filtroAtual !== 'todos') {
    lista = lista.filter(p => p.categoria === filtroAtual && p.ativo);
  }

  // Filtro por busca
  if (search) {
    lista = lista.filter(p =>
      p.nome.toLowerCase().includes(search) ||
      p.id.toLowerCase().includes(search) ||
      p.categoria.toLowerCase().includes(search)
    );
  }

  // Atualiza contagem
  const count = document.getElementById('productCount');
  if (count) count.textContent = `${lista.length} produto${lista.length !== 1 ? 's' : ''}`;

  if (lista.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  tbody.innerHTML = lista.map(p => {
    const precoFinal = p.preco_desconto ?? p.preco_original;
    const temDesc    = !!p.preco_desconto;
    const pct        = temDesc ? Math.round((1 - p.preco_desconto / p.preco_original) * 100) : 0;
    const stockClass = p.estoque === 0 ? 'stock-zero' : p.estoque <= 5 ? 'stock-low' : 'stock-ok';

    return `
      <tr>
        <td>
          <div class="prod-thumb" style="background:${p.imagem_url
            ? `url('${p.imagem_url}') center/cover`
            : p.imagem_placeholder || '#E8E0D5'};border-radius:4px;border:1px solid #eee"></div>
        </td>
        <td>
          <div class="prod-name">${escHtml(p.nome)}</div>
          <div class="prod-id">${escHtml(p.id)}</div>
        </td>
        <td><span class="badge-cat">${escHtml(p.categoria)}</span></td>
        <td>${temDesc
          ? `<span class="price-original">${fmt(p.preco_original)}</span>`
          : `<span class="price-normal">${fmt(p.preco_original)}</span>`}</td>
        <td>${temDesc
          ? `<span class="price-sale">${fmt(p.preco_desconto)}</span>`
          : '<span style="color:#ccc">—</span>'}</td>
        <td>${pct > 0
          ? `<span class="badge-discount">−${pct}%</span>`
          : '<span style="color:#ccc">—</span>'}</td>
        <td><span class="${stockClass}">${p.estoque ?? '—'}</span></td>
        <td>
          <span class="status-badge ${p.ativo ? 'status-badge--active' : 'status-badge--inactive'}">
            ${p.ativo ? '● Ativo' : '○ Inativo'}
          </span>
        </td>
        <td>
          <div class="admin-row-actions">
            <button class="admin-btn admin-btn--ghost admin-btn--sm" onclick="openModal('${p.id}')" title="Editar">✏️</button>
            <button class="admin-btn admin-btn--ghost admin-btn--sm" onclick="toggleAtivo('${p.id}')" title="${p.ativo ? 'Desativar' : 'Ativar'}">${p.ativo ? '🙈' : '👁️'}</button>
            <button class="admin-btn admin-btn--ghost admin-btn--sm" style="color:#c62828" onclick="deleteProduct('${p.id}')" title="Excluir">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ── ABRIR MODAL DE PRODUTO ──────────────────
function openModal(id) {
  editandoId = id;
  const modal = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');

  resetForm();

  if (id) {
    const p = DB.produtos.find(x => x.id === id);
    if (!p) return;
    title.textContent = `Editar — ${p.nome}`;
    document.getElementById('formId').value               = p.id;
    document.getElementById('formNome').value             = p.nome;
    document.getElementById('formCategoria').value        = p.categoria;
    document.getElementById('formBadge').value            = p.badge || '';
    document.getElementById('formPrecoOriginal').value    = p.preco_original;
    document.getElementById('formPrecoDesconto').value    = p.preco_desconto || '';
    document.getElementById('formEstoque').value          = p.estoque ?? '';
    // Galeria de imagens
    const imgs = p.imagens?.length ? p.imagens : (p.imagem_url ? [p.imagem_url] : []);
    buildGaleriaRows(imgs);
    document.getElementById('btnAddFoto').style.display = imgs.length >= 5 ? 'none' : '';
    document.getElementById('formPlaceholder').value      = p.imagem_placeholder || '';
    document.getElementById('formDescricao').value        = p.descricao || '';
    document.getElementById('formComposicao').value       = p.composicao || '';
    document.getElementById('formEntregaTrocas').value    = p.entrega_trocas || '';
    renderCompreJuntoPicker(p.compre_junto || [], p.id);
    document.getElementById('formDestaque').checked       = !!p.destaque;
    document.getElementById('formNovidade').checked       = !!p.novidade;
    document.getElementById('formEssencial').checked      = !!p.essencial;
    document.getElementById('formExclusivo').checked      = !!p.exclusivo;
    document.getElementById('formAtivo').checked          = p.ativo !== false;

    document.querySelectorAll('.admin-size-check input').forEach(cb => {
      cb.checked = (p.tamanhos || []).includes(cb.value);
    });

    document.getElementById('colorPreview').style.background = p.imagem_placeholder || '';
    updateDiscountPreview();
  } else {
    title.textContent = 'Novo Produto';
    document.getElementById('formAtivo').checked = true;
    document.querySelectorAll('.admin-size-check input').forEach(cb => cb.checked = true);
    buildGaleriaRows([]);
    document.getElementById('btnAddFoto').style.display = '';
    renderCompreJuntoPicker([], null);
  }

  modal?.classList.add('open');
  modal?.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('formNome')?.focus(), 100);
}

function closeModal() {
  document.getElementById('modalOverlay')?.classList.remove('open');
  document.getElementById('modalOverlay')?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  editandoId = null;
}

function resetForm() {
  ['formId','formNome','formPrecoOriginal','formPrecoDesconto','formEstoque',
   'formPlaceholder','formDescricao','formComposicao','formEntregaTrocas','formCompreJunto']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('formCategoria').value  = 'vestidos';
  document.getElementById('formBadge').value      = '';
  document.getElementById('formDestaque').checked  = false;
  document.getElementById('formNovidade').checked  = false;
  document.getElementById('formEssencial').checked = false;
  document.getElementById('formExclusivo').checked = false;
  document.getElementById('formAtivo').checked     = true;
  document.getElementById('formPctDesconto').value = 0;
  document.getElementById('colorPreview').style.background = '';
  document.getElementById('discountPreview').textContent   = '—';
  document.querySelectorAll('.admin-size-check input').forEach(cb => cb.checked = false);
  document.querySelectorAll('.admin-input.error').forEach(el => el.classList.remove('error'));
  buildGaleriaRows([]); // Limpa inputs de galeria
  const _busca = document.getElementById('compreJuntoBusca'); if (_busca) _busca.value = '';
  renderCompreJuntoPicker([], null);
}

/**
 * "Compre o look" — seletor de peças que combinam com o produto atual.
 * Renderiza checkboxes com o NOME das peças (não IDs), com busca. Sincroniza
 * a seleção no input escondido #formCompreJunto (salvo em produtos.compre_junto).
 */
function renderCompreJuntoPicker(selectedIds, excludeId) {
  const wrap   = document.getElementById('compreJuntoPicker');
  const hidden = document.getElementById('formCompreJunto');
  const busca  = document.getElementById('compreJuntoBusca');
  if (!wrap) return;

  const sel = new Set(selectedIds || []);
  if (hidden) hidden.value = [...sel].join(', ');
  const todos = (DB.produtos || []).filter(p => p.id !== excludeId);

  function pinta(filtro) {
    const f = (filtro || '').trim().toLowerCase();
    const lista = todos.filter(p => !f || (p.nome || '').toLowerCase().includes(f));
    wrap.style.cssText = 'max-height:190px;overflow-y:auto;border:1px solid #e6e2da;border-radius:8px;padding:6px;background:#fff';
    if (!todos.length) { wrap.innerHTML = '<p style="margin:8px;color:#999;font-size:.85rem">Cadastre outras peças para montar looks.</p>'; return; }
    if (!lista.length) { wrap.innerHTML = '<p style="margin:8px;color:#999;font-size:.85rem">Nenhuma peça encontrada.</p>'; return; }
    wrap.innerHTML = lista.map(p => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:.88rem">
        <input type="checkbox" value="${escHtml(p.id)}" ${sel.has(p.id) ? 'checked' : ''} style="accent-color:#1a2a4a;flex-shrink:0">
        <span>${escHtml(p.nome)}</span>
        <span style="margin-left:auto;color:#c4c0b8;font-size:.72rem">${escHtml(p.id)}</span>
      </label>`).join('');
    wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
        if (hidden) hidden.value = [...sel].join(', ');
      });
    });
  }

  pinta('');
  if (busca) busca.oninput = () => pinta(busca.value);
}

/**
 * Tela "Avisos de Reposição" — mostra, por peça esgotada, quem pediu para ser
 * avisado quando voltar. O e-mail sai automático (cron notificar-reposicao).
 */
async function carregarReposicao() {
  const wrap = document.getElementById('reposicaoLista');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:#888;padding:8px">Carregando…</p>';
  try {
    const { data, error } = await supabaseClient
      .from('avisos_reposicao')
      .select('produto_id, email, tamanho, cor_nome, criado_em, notificado')
      .eq('notificado', false)
      .order('criado_em', { ascending: false });
    if (error) throw error;

    if (!data || !data.length) {
      wrap.innerHTML = '<p style="color:#888;padding:8px">Nenhum aviso pendente. Quando uma cliente clicar "Avise-me quando chegar" numa peça esgotada, ela aparece aqui.</p>';
      return;
    }

    const nomeDe = id => (DB.produtos.find(p => p.id === id)?.nome) || id;
    const grupos = {};
    data.forEach(a => { (grupos[a.produto_id] = grupos[a.produto_id] || []).push(a); });

    wrap.innerHTML = Object.entries(grupos)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([pid, avisos]) => {
        const itens = avisos.map(a => {
          const v = [a.tamanho, a.cor_nome].filter(Boolean).join(' · ');
          return `<div style="font-size:.82rem;padding:4px 0;border-bottom:1px solid #f2eee7">
            <span style="color:#1a2a4a">${escHtml(a.email)}</span>
            ${v ? `<span style="color:#999"> — ${escHtml(v)}</span>` : ''}
            <span style="color:#c4c0b8;float:right">${new Date(a.criado_em).toLocaleDateString('pt-BR')}</span>
          </div>`;
        }).join('');
        return `<div style="border:1px solid #e6e2da;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="color:#1a2a4a">${escHtml(nomeDe(pid))}</strong>
            <span style="background:#1a2a4a;color:#fff;border-radius:999px;padding:2px 10px;font-size:.75rem">${avisos.length} aguardando</span>
          </div>
          ${itens}
        </div>`;
      }).join('');
  } catch (e) {
    wrap.innerHTML = `<p style="color:#c0392b;padding:8px">Erro ao carregar avisos: ${escHtml(e.message || e)}</p>`;
  }
}

// ── SALVAR PRODUTO NO SUPABASE ──────────────
async function saveProduct() {
  const nome  = document.getElementById('formNome')?.value.trim();
  const preco = parseFloat(document.getElementById('formPrecoOriginal')?.value);

  if (!nome || !preco) {
    if (!nome)  document.getElementById('formNome')?.classList.add('error');
    if (!preco) document.getElementById('formPrecoOriginal')?.classList.add('error');
    toast('Preencha os campos obrigatórios', 'error');
    return;
  }

  const btnSave = document.getElementById('btnSaveProduct');
  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Salvando…'; }

  const desconto = parseFloat(document.getElementById('formPrecoDesconto')?.value) || null;
  if (desconto !== null && desconto >= preco) {
    toast('O preço de desconto deve ser menor que o preço original.', 'error');
    document.getElementById('formPrecoDesconto')?.classList.add('error');
    if (btnSave) { btnSave.disabled = false; btnSave.textContent = 'Salvar Produto'; }
    return;
  }
  const tamanhos = [...document.querySelectorAll('.admin-size-check input:checked')].map(cb => cb.value);

  // Preserva cores e tamanhos_esgotados do produto existente
  const produtoExistente = editandoId ? DB.produtos.find(p => p.id === editandoId) : null;
  const coresExistentes          = produtoExistente?.cores             || [];
  const tamanhosEsgotadosExist   = produtoExistente?.tamanhos_esgotados || [];

  const produto = {
    id:                 editandoId || slugify(nome),
    nome,
    categoria:          document.getElementById('formCategoria')?.value,
    descricao:          document.getElementById('formDescricao')?.value.trim(),
    composicao:         document.getElementById('formComposicao')?.value.trim(),
    entrega_trocas:     document.getElementById('formEntregaTrocas')?.value.trim() || null,
    preco_original:     preco,
    preco_desconto:     (desconto && desconto < preco) ? desconto : null,
    badge:              document.getElementById('formBadge')?.value || null,
    imagens:            getGaleriaUrls(),
    imagem_url:         getGaleriaUrls()[0] || '',
    imagem_placeholder: document.getElementById('formPlaceholder')?.value.trim()
                          || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
    cores:              coresExistentes,
    tamanhos:           tamanhos.length ? tamanhos : ['PP','P','M','G'],
    tamanhos_esgotados: tamanhosEsgotadosExist, // preserva dados de esgotamento gerenciados pelo estoque
    destaque:           document.getElementById('formDestaque')?.checked,
    novidade:           document.getElementById('formNovidade')?.checked,
    essencial:          document.getElementById('formEssencial')?.checked,
    exclusivo:          document.getElementById('formExclusivo')?.checked || false,
    ativo:              document.getElementById('formAtivo')?.checked,
    estoque:            parseInt(document.getElementById('formEstoque')?.value) || 0,
    compre_junto:       (document.getElementById('formCompreJunto')?.value || '')
                          .split(',').map(s => s.trim()).filter(Boolean)
  };

  try {
    const { data, error } = await supabaseClient
      .from('produtos')
      .upsert(produto, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    // Atualiza estado local sem re-fetch
    const idx = DB.produtos.findIndex(p => p.id === produto.id);
    if (idx !== -1) {
      DB.produtos[idx] = data;
    } else {
      DB.produtos.unshift(data);
    }

    closeModal();
    renderTable();
    toast(`"${nome}" ${editandoId ? 'atualizado' : 'criado'} com sucesso! ✓`, 'success');
    setStatus('success', `✓ "${nome}" salvo no banco de dados. O site público já reflete a mudança.`);
  } catch (e) {
    toast(`Erro ao salvar: ${e.message}`, 'error');
    setStatus('error', `✗ Erro ao salvar: ${e.message}`);
  } finally {
    if (btnSave) { btnSave.disabled = false; btnSave.textContent = 'Salvar Produto'; }
  }
}

// ── TOGGLE ATIVO NO SUPABASE ────────────────
async function toggleAtivo(id) {
  const p = DB.produtos.find(x => x.id === id);
  if (!p) return;

  // Previne clique duplo no botão da linha
  const opKey = `toggle-${id}`;
  if (_productOps.has(opKey)) return;
  _productOps.add(opKey);

  const novoAtivo = !p.ativo;

  try {
    const { error } = await supabaseClient
      .from('produtos')
      .update({ ativo: novoAtivo })
      .eq('id', id);

    if (error) throw error;

    p.ativo = novoAtivo;
    renderTable();
    toast(`"${p.nome}" ${novoAtivo ? 'ativado ✓' : 'desativado'}`, 'success');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  } finally {
    _productOps.delete(opKey);
  }
}

// ── DELETAR PRODUTO NO SUPABASE ─────────────
async function deleteProduct(id) {
  const p = DB.produtos.find(x => x.id === id);
  if (!p) return;

  // Previne duplo clique no botão de exclusão da linha
  const opKey = `delete-${id}`;
  if (_productOps.has(opKey)) return;

  if (!confirm(`Excluir "${p.nome}" permanentemente? Esta ação não pode ser desfeita.`)) return;

  _productOps.add(opKey);

  try {
    const { error } = await supabaseClient
      .from('produtos')
      .delete()
      .eq('id', id);

    if (error) throw error;

    DB.produtos = DB.produtos.filter(x => x.id !== id);
    renderTable();
    toast(`"${p.nome}" excluído`);
    setStatus('info', `ℹ️ "${p.nome}" removido do banco de dados.`);
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  } finally {
    _productOps.delete(opKey);
  }
}

// ── CONFIGURAÇÕES ───────────────────────────
function populateConfig() {
  const cfg = DB.configuracoes || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('cfgNomeLoja', cfg.nome_loja);
  set('cfgSlogan',   cfg.slogan);
  set('cfgInstagram',cfg.instagram);
  set('cfgFrete',    cfg.frete_gratis_acima);
  set('cfgParcelas', cfg.max_parcelas);
  set('cfgEmbalagem', cfg.preco_embalagem_presente);
  const b = cfg.banner_home || {};
  set('cfgBannerL1',    b.titulo_linha1);
  set('cfgBannerL2',    b.titulo_linha2);
  set('cfgBannerSub',   b.subtitulo);
  set('cfgBannerCta',   b.cta_texto);
  set('cfgBannerCtaLink', b.cta_link);
  const e = cfg.banner_editorial || {};
  set('cfgEditTitle',    e.titulo);
  set('cfgEditText',     e.texto);
  set('cfgEditCta',      e.cta_texto);
  set('cfgEditCtaLink',  e.cta_link);
  // Barra de anúncios
  const anuncioEl = document.getElementById('cfgAnuncio');
  if (anuncioEl) {
    anuncioEl.value = Array.isArray(cfg.anuncio_bar)
      ? cfg.anuncio_bar.join('\n')
      : (cfg.anuncio_bar || '');
  }
  // Informações de contato
  set('cfgEmailContato',    cfg.email_contato);
  set('cfgWhatsappNumero',  cfg.whatsapp_numero);
  set('cfgWhatsappLink',    cfg.whatsapp_link);
  set('cfgHorarioSemana',   cfg.horario_semana);
  set('cfgHorarioSabado',   cfg.horario_sabado);

  // Diferenciais
  const difs = cfg.diferenciais || [
    {titulo:'Frete Grátis',descricao:'Com o cupom FRETEGRATIS'},
    {titulo:'Parcelamento',descricao:'Até 12x no cartão · 5% OFF no PIX'},
    {titulo:'Trocas Fáceis',descricao:'Até 7 dias para trocar'},
    {titulo:'Atendimento',descricao:'Via WhatsApp, de seg. a sáb.'},
  ];
  const difWrap = document.getElementById('cfgDiferenciaisWrap');
  if (difWrap) {
    difWrap.innerHTML = difs.map((d, i) => `
      <div style="border:1px solid #eee;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem">
        <p style="font-size:0.8rem;color:#888;margin-bottom:0.5rem">Card ${i+1}</p>
        <div class="admin-form-group">
          <label class="admin-label">Título</label>
          <input type="text" class="admin-input" id="cfgDif${i}Titulo" value="${escHtml(d.titulo||'')}" />
        </div>
        <div class="admin-form-group">
          <label class="admin-label">Descrição</label>
          <input type="text" class="admin-input" id="cfgDif${i}Desc" value="${escHtml(d.descricao||'')}" />
        </div>
      </div>`).join('');
  }

  // FAQ
  const faqs = cfg.faq_items || [];
  const faqWrap = document.getElementById('cfgFaqWrap');
  if (faqWrap) {
    faqWrap.innerHTML = faqs.map((f, i) => `
      <div style="border:1px solid #eee;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem">
        <p style="font-size:0.8rem;color:#888;margin-bottom:0.5rem">Pergunta ${i+1}</p>
        <div class="admin-form-group">
          <label class="admin-label">Pergunta</label>
          <input type="text" class="admin-input" id="cfgFaq${i}P" value="${escHtml(f.pergunta||'')}" />
        </div>
        <div class="admin-form-group">
          <label class="admin-label">Resposta</label>
          <textarea class="admin-input admin-textarea" id="cfgFaq${i}R" rows="2">${f.resposta||''}</textarea>
        </div>
        <div class="admin-form-group">
          <label class="admin-label">Link (opcional — deixe vazio para expandir)</label>
          <input type="text" class="admin-input" id="cfgFaq${i}L" value="${f.link||''}" placeholder="https://..." />
        </div>
      </div>`).join('');
  }

  // Newsletter
  set('cfgNewsletterTitulo', cfg.newsletter_titulo);
  set('cfgNewsletterSub',    cfg.newsletter_subtitulo);
  const benefEl = document.getElementById('cfgNewsletterBeneficios');
  if (benefEl) benefEl.value = Array.isArray(cfg.newsletter_beneficios)
    ? cfg.newsletter_beneficios.join('\n') : (cfg.newsletter_beneficios || '');

  // Pedido confirmado
  set('cfgPedidoTitulo', cfg.pedido_msg_titulo);
  set('cfgPedidoCorpo',  cfg.pedido_msg_corpo);

  // E-mail de confirmação ao cliente
  const emailAtivoEl = document.getElementById('cfgEmailClienteAtivo');
  if (emailAtivoEl) emailAtivoEl.checked = cfg.email_cliente_ativo !== false;
  set('cfgEmailClienteAssunto',  cfg.email_cliente_assunto);
  set('cfgEmailClienteSaudacao', cfg.email_cliente_saudacao);
  set('cfgEmailClienteMensagem', cfg.email_cliente_mensagem);
  set('cfgEmailClienteRodape',   cfg.email_cliente_rodape);

  // Guia de Tamanhos
  set('cfgGuiaTamanhoObs', cfg.guia_tamanhos_obs);
  renderGuiaTamanhos(cfg.guia_tamanhos || [
    {tamanho:'PP',busto:'80–84',cintura:'60–64',quadril:'86–90'},
    {tamanho:'P', busto:'84–88',cintura:'64–68',quadril:'90–94'},
    {tamanho:'M', busto:'88–92',cintura:'68–72',quadril:'94–98'},
    {tamanho:'G', busto:'92–96',cintura:'72–76',quadril:'98–102'},
  ]);
  // Bind botão "+ Linha"
  const btnAddRow = document.getElementById('btnAddTamanhoRow');
  if (btnAddRow && !btnAddRow._bound) {
    btnAddRow._bound = true;
    btnAddRow.addEventListener('click', () => {
      const tbody = document.getElementById('guiaTamanhosTbody');
      if (tbody) tbody.insertAdjacentHTML('beforeend', guiaTamanhoRow({tamanho:'',busto:'',cintura:'',quadril:''}));
    });
  }

  // Filtros do Catálogo
  const tamanhosCfg = cfg.filtros_tamanhos || ['PP','P','M','G','XG'];
  const cfgFiltrosTam = document.getElementById('cfgFiltrosTamanhos');
  if (cfgFiltrosTam) cfgFiltrosTam.value = tamanhosCfg.join(',');

  const coresCfg = cfg.filtros_cores || [
    {nome:'Azul Âncora',hex:'#2B3F54'},{nome:'Dourado',hex:'#C4934A'},
    {nome:'Cru',hex:'#E8D5B5'},{nome:'Preto',hex:'#1a1a1a'},
    {nome:'Off-White',hex:'#F9F7F4'},{nome:'Cinza',hex:'#6E6660'},
    {nome:'Terracota',hex:'#8B6F5E'},{nome:'Rosa',hex:'#D4A5A5'}
  ];
  renderFiltrosCores(coresCfg);

  const btnAddCor = document.getElementById('btnAddCor');
  if (btnAddCor && !btnAddCor._bound) {
    btnAddCor._bound = true;
    btnAddCor.addEventListener('click', () => {
      document.getElementById('filtrosCorTbody')
        ?.insertAdjacentHTML('beforeend', filtrosCorRow({nome:'',hex:'#000000'}));
    });
  }

  // Políticas
  set('cfgPolComoFunciona',    cfg.pol_como_funciona);
  set('cfgPolTrocas',          cfg.pol_trocas);
  set('cfgPolRastreio',        cfg.pol_rastreio);
  set('cfgPolTermos',          cfg.pol_termos);
  set('cfgPolPrivacidade',     cfg.pol_privacidade);
  set('cfgPolSustentabilidade',cfg.pol_sustentabilidade);

  // Pop-up de Saída
  const popAtivo = document.getElementById('cfgPopupSaidaAtivo');
  if (popAtivo) popAtivo.checked = cfg.popup_saida_ativo !== false;
  set('cfgPopupSaidaTitulo',    cfg.popup_saida_titulo);
  set('cfgPopupSaidaSubtitulo', cfg.popup_saida_subtitulo);
  set('cfgPopupSaidaCodigo',    cfg.popup_saida_codigo);
  set('cfgPopupSaidaDesconto',  cfg.popup_saida_desconto ?? 10);
}

// ── Filtros de cores ────────────────────────
function filtrosCorRow(c) {
  return `<tr>
    <td style="padding:0.35rem 0.5rem;text-align:center">
      <input type="color" data-fc="hex" value="${c.hex||'#000000'}"
        style="width:32px;height:32px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none" />
    </td>
    <td style="padding:0.35rem 0.5rem">
      <input type="text" class="admin-input" data-fc="nome" value="${c.nome||''}" placeholder="Ex: Azul Âncora" style="min-width:130px" />
    </td>
    <td style="padding:0.35rem 0.5rem">
      <input type="text" class="admin-input" data-fc="hex-txt" value="${c.hex||''}" placeholder="#2B3F54" style="min-width:90px"
        oninput="const p=this.closest('tr').querySelector('[data-fc=hex]');if(p&&/^#[0-9a-fA-F]{6}$/.test(this.value))p.value=this.value" />
    </td>
    <td style="padding:0.35rem 0.5rem;text-align:center">
      <button type="button" onclick="this.closest('tr').remove()"
        style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem" title="Remover">✕</button>
    </td>
  </tr>`;
}

function renderFiltrosCores(cores) {
  const tbody = document.getElementById('filtrosCorTbody');
  if (!tbody) return;
  tbody.innerHTML = cores.map(filtrosCorRow).join('');
  // Sincroniza color picker → campo texto
  tbody.querySelectorAll('[data-fc="hex"]').forEach(picker => {
    picker.addEventListener('input', () => {
      const txt = picker.closest('tr').querySelector('[data-fc="hex-txt"]');
      if (txt) txt.value = picker.value;
    });
  });
}

function collectFiltrosCores() {
  return Array.from(document.querySelectorAll('#filtrosCorTbody tr')).map(tr => ({
    nome: tr.querySelector('[data-fc="nome"]')?.value.trim()    || '',
    hex:  tr.querySelector('[data-fc="hex-txt"]')?.value.trim() || tr.querySelector('[data-fc="hex"]')?.value || ''
  })).filter(c => c.nome && c.hex);
}

function guiaTamanhoRow(r) {
  const td = (name, val) =>
    `<td style="padding:0.35rem 0.5rem"><input type="text" class="admin-input" data-gt="${name}" value="${val||''}" style="min-width:70px" /></td>`;
  return `<tr>
    ${td('tamanho', r.tamanho)}
    ${td('busto',   r.busto)}
    ${td('cintura', r.cintura)}
    ${td('quadril', r.quadril)}
    <td style="padding:0.35rem 0.5rem;text-align:center">
      <button type="button" onclick="this.closest('tr').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem" title="Remover">✕</button>
    </td>
  </tr>`;
}

function renderGuiaTamanhos(rows) {
  const tbody = document.getElementById('guiaTamanhosTbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(guiaTamanhoRow).join('');
}

function collectGuiaTamanhos() {
  const rows = document.querySelectorAll('#guiaTamanhosTbody tr');
  return Array.from(rows).map(tr => {
    const get = name => tr.querySelector(`[data-gt="${name}"]`)?.value.trim() || '';
    return { tamanho: get('tamanho'), busto: get('busto'), cintura: get('cintura'), quadril: get('quadril') };
  }).filter(r => r.tamanho);
}

async function saveConfig() {
  const btnSave = document.getElementById('btnSaveConfig');
  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Salvando…'; }

  const cfg = {
    id:                 1,
    nome_loja:          document.getElementById('cfgNomeLoja')?.value.trim(),
    slogan:             document.getElementById('cfgSlogan')?.value.trim(),
    instagram:          document.getElementById('cfgInstagram')?.value.trim(),
    frete_gratis_acima:        parseFloat(document.getElementById('cfgFrete')?.value) || 300,
    max_parcelas:              parseInt(document.getElementById('cfgParcelas')?.value) || 6,
    preco_embalagem_presente:  parseFloat(document.getElementById('cfgEmbalagem')?.value) || 15,
    banner_home: {
      titulo_linha1: document.getElementById('cfgBannerL1')?.value.trim(),
      titulo_linha2: document.getElementById('cfgBannerL2')?.value.trim(),
      subtitulo:     document.getElementById('cfgBannerSub')?.value.trim(),
      cta_texto:     document.getElementById('cfgBannerCta')?.value.trim(),
      cta_link:      document.getElementById('cfgBannerCtaLink')?.value.trim()
    },
    banner_editorial: {
      titulo:    document.getElementById('cfgEditTitle')?.value.trim(),
      texto:     document.getElementById('cfgEditText')?.value.trim(),
      cta_texto: document.getElementById('cfgEditCta')?.value.trim(),
      cta_link:  document.getElementById('cfgEditCtaLink')?.value.trim()
    },
    anuncio_bar: (document.getElementById('cfgAnuncio')?.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    email_contato:   document.getElementById('cfgEmailContato')?.value.trim()   || null,
    whatsapp_numero: document.getElementById('cfgWhatsappNumero')?.value.trim() || null,
    whatsapp_link:   document.getElementById('cfgWhatsappLink')?.value.trim()   || null,
    horario_semana:  document.getElementById('cfgHorarioSemana')?.value.trim()  || null,
    horario_sabado:  document.getElementById('cfgHorarioSabado')?.value.trim()  || null,
    // Diferenciais
    diferenciais: [0,1,2,3].map(i => ({
      titulo:   document.getElementById(`cfgDif${i}Titulo`)?.value.trim() || '',
      descricao: document.getElementById(`cfgDif${i}Desc`)?.value.trim()  || '',
    })).filter(d => d.titulo),
    // FAQ
    faq_items: [0,1,2,3,4,5,6,7].map(i => {
      const p = document.getElementById(`cfgFaq${i}P`);
      if (!p) return null;
      return {
        pergunta: p.value.trim(),
        resposta: document.getElementById(`cfgFaq${i}R`)?.value.trim() || '',
        link:     document.getElementById(`cfgFaq${i}L`)?.value.trim() || '',
      };
    }).filter(Boolean).filter(f => f.pergunta),
    // Newsletter
    newsletter_titulo:     document.getElementById('cfgNewsletterTitulo')?.value.trim() || null,
    newsletter_subtitulo:  document.getElementById('cfgNewsletterSub')?.value.trim()    || null,
    newsletter_beneficios: (document.getElementById('cfgNewsletterBeneficios')?.value || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
    // Pedido confirmado
    pedido_msg_titulo: document.getElementById('cfgPedidoTitulo')?.value.trim() || null,
    pedido_msg_corpo:  document.getElementById('cfgPedidoCorpo')?.value.trim()  || null,
    // E-mail de confirmação ao cliente
    email_cliente_ativo:     document.getElementById('cfgEmailClienteAtivo')?.checked ?? true,
    email_cliente_assunto:   document.getElementById('cfgEmailClienteAssunto')?.value.trim()  || null,
    email_cliente_saudacao:  document.getElementById('cfgEmailClienteSaudacao')?.value.trim() || null,
    email_cliente_mensagem:  document.getElementById('cfgEmailClienteMensagem')?.value.trim() || null,
    email_cliente_rodape:    document.getElementById('cfgEmailClienteRodape')?.value.trim()   || null,
    // Guia de Tamanhos
    guia_tamanhos:     collectGuiaTamanhos(),
    guia_tamanhos_obs: document.getElementById('cfgGuiaTamanhoObs')?.value.trim() || null,
    // Filtros do Catálogo
    filtros_tamanhos: (document.getElementById('cfgFiltrosTamanhos')?.value || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    filtros_cores: collectFiltrosCores(),
    // Políticas
    pol_como_funciona:    document.getElementById('cfgPolComoFunciona')?.value.trim()    || null,
    pol_trocas:           document.getElementById('cfgPolTrocas')?.value.trim()           || null,
    pol_rastreio:         document.getElementById('cfgPolRastreio')?.value.trim()         || null,
    pol_termos:           document.getElementById('cfgPolTermos')?.value.trim()           || null,
    pol_privacidade:      document.getElementById('cfgPolPrivacidade')?.value.trim()      || null,
    pol_sustentabilidade: document.getElementById('cfgPolSustentabilidade')?.value.trim() || null,
    // Pop-up de Saída
    popup_saida_ativo:      document.getElementById('cfgPopupSaidaAtivo')?.checked ?? true,
    popup_saida_titulo:     document.getElementById('cfgPopupSaidaTitulo')?.value.trim()    || 'Espera! Não vá de mãos vazias.',
    popup_saida_subtitulo:  document.getElementById('cfgPopupSaidaSubtitulo')?.value.trim() || 'Use o código abaixo e ganhe desconto na sua primeira compra.',
    popup_saida_codigo:     (document.getElementById('cfgPopupSaidaCodigo')?.value.trim()   || 'FIQUEVIRTU').toUpperCase(),
    popup_saida_desconto:   parseInt(document.getElementById('cfgPopupSaidaDesconto')?.value) || 10,
  };

  try {
    const { error } = await supabaseClient
      .from('configuracoes')
      .upsert(cfg, { onConflict: 'id' });

    if (error) throw error;

    DB.configuracoes = cfg;
    toast('Configurações salvas! ✓', 'success');
    setStatus('success', '✓ Configurações atualizadas. O site público já reflete as mudanças.');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
    setStatus('error', `✗ Erro ao salvar configurações: ${e.message}`);
  } finally {
    if (btnSave) { btnSave.disabled = false; btnSave.textContent = 'Salvar Configurações'; }
  }
}

// ── PÁGINA SOBRE ────────────────────────────
function populateSobre() {
  const s = DB.configuracoes?.sobre || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

  // Hero
  const h = s.hero || {};
  set('sobreHeroEyebrow',   h.eyebrow);
  set('sobreHeroTitulo1',   h.titulo_linha1);
  set('sobreHeroTitulo2',   h.titulo_linha2);
  set('sobreHeroSubtitulo', h.subtitulo);

  // Manifesto
  const m = s.manifesto || {};
  set('sobreManifestoTitulo',     m.titulo);
  set('sobreManifestoP1',         m.paragrafo1);
  set('sobreManifestoP2',         m.paragrafo2);
  set('sobreManifestoP3',         m.paragrafo3);
  set('sobreManifestoQuote',      m.quote_texto);
  set('sobreManifestoQuoteAutor', m.quote_autor);
  set('sobreManifestoImg',        m.imagem_url);

  // Valores
  const v = s.valores || [];
  [1,2,3,4].forEach(i => {
    const val = v[i-1] || {};
    set(`sobreValor${i}Titulo`, val.titulo);
    set(`sobreValor${i}Texto`,  val.texto);
  });

  // Fundadora
  const f = s.fundadora || {};
  set('sobreFundadoraTitulo1', f.titulo_linha1);
  set('sobreFundadoraTitulo2', f.titulo_linha2);
  set('sobreFundadoraP1',      f.paragrafo1);
  set('sobreFundadoraP2',      f.paragrafo2);
  set('sobreFundadoraImg',     f.imagem_url);

  // Números
  const n = s.numeros || [];
  [1,2,3,4].forEach(i => {
    const num = n[i-1] || {};
    set(`sobreNum${i}Valor`, num.valor);
    set(`sobreNum${i}Label`, num.label);
  });

  // Envio
  const e = s.envio || [];
  [1,2,3,4].forEach(i => {
    const env = e[i-1] || {};
    set(`sobreEnvio${i}Titulo`, env.titulo);
    set(`sobreEnvio${i}Texto`,  env.texto);
  });

  // Pagamento
  const p = s.pagamento || [];
  [1,2,3,4].forEach(i => {
    const pag = p[i-1] || {};
    set(`sobrePag${i}Titulo`, pag.titulo);
    set(`sobrePag${i}Texto`,  pag.texto);
  });
}

async function saveSobre() {
  const btnSave = document.getElementById('btnSaveSobre');
  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Salvando…'; }

  const get = id => document.getElementById(id)?.value.trim() ?? '';
  const getNum = id => parseInt(document.getElementById(id)?.value) || 0;

  const sobre = {
    hero: {
      eyebrow:      get('sobreHeroEyebrow'),
      titulo_linha1: get('sobreHeroTitulo1'),
      titulo_linha2: get('sobreHeroTitulo2'),
      subtitulo:    get('sobreHeroSubtitulo')
    },
    manifesto: {
      titulo:      get('sobreManifestoTitulo'),
      paragrafo1:  get('sobreManifestoP1'),
      paragrafo2:  get('sobreManifestoP2'),
      paragrafo3:  get('sobreManifestoP3'),
      quote_texto: get('sobreManifestoQuote'),
      quote_autor: get('sobreManifestoQuoteAutor'),
      imagem_url:  get('sobreManifestoImg')
    },
    valores: [1,2,3,4].map(i => ({
      titulo: get(`sobreValor${i}Titulo`),
      texto:  get(`sobreValor${i}Texto`)
    })),
    fundadora: {
      titulo_linha1: get('sobreFundadoraTitulo1'),
      titulo_linha2: get('sobreFundadoraTitulo2'),
      paragrafo1:   get('sobreFundadoraP1'),
      paragrafo2:   get('sobreFundadoraP2'),
      imagem_url:   get('sobreFundadoraImg')
    },
    numeros: [1,2,3,4].map(i => ({
      valor: getNum(`sobreNum${i}Valor`),
      label: get(`sobreNum${i}Label`)
    })),
    envio: [1,2,3,4].map(i => ({
      titulo: get(`sobreEnvio${i}Titulo`),
      texto:  get(`sobreEnvio${i}Texto`)
    })),
    pagamento: [1,2,3,4].map(i => ({
      titulo: get(`sobrePag${i}Titulo`),
      texto:  get(`sobrePag${i}Texto`)
    }))
  };

  // Preserva o restante das configurações e atualiza apenas o campo "sobre"
  const cfgAtualizada = { ...DB.configuracoes, id: 1, sobre };

  try {
    const { error } = await supabaseClient
      .from('configuracoes')
      .upsert(cfgAtualizada, { onConflict: 'id' });

    if (error) throw error;

    DB.configuracoes = cfgAtualizada;
    toast('Página Sobre salva! ✓', 'success');
    setStatus('success', '✓ Conteúdo da página Sobre atualizado. O site já reflete as mudanças em wearvirtu.com/sobre');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
    setStatus('error', `✗ Erro ao salvar: ${e.message}`);
  } finally {
    if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Salvar Página Sobre'; }
  }
}

// ── UTILITÁRIOS ─────────────────────────────
function updateDiscountPreview() {
  const orig = parseFloat(document.getElementById('formPrecoOriginal')?.value) || 0;
  const desc = parseFloat(document.getElementById('formPrecoDesconto')?.value);
  const prev = document.getElementById('discountPreview');
  if (!prev) return;
  if (orig > 0 && desc > 0 && desc < orig) {
    const pct = Math.round((1 - desc / orig) * 100);
    prev.textContent = `−${pct}% → ${fmt(desc)}`;
    prev.style.color = '#C4934A';
  } else {
    prev.textContent = '—';
    prev.style.color = '#AFA99F';
  }
}

function setStatus(type, msg) {
  const bar   = document.getElementById('statusBar');
  const msgEl = document.getElementById('statusMsg');
  if (!bar || !msgEl) return;
  bar.className = `admin-status-bar${type === 'success' ? ' success' : type === 'error' ? ' error' : ''}`;
  msgEl.innerHTML = msg;
}

function toast(msg, type = 'default') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `admin-toast show${type !== 'default' ? ` ${type}` : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function fmt(v) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Expõe funções usadas em onclick inline
window.openModal     = openModal;
window.toggleAtivo   = toggleAtivo;
window.deleteProduct = deleteProduct;

/* ============================================================
   ADMIN — AVALIAÇÕES
   ============================================================ */
async function carregarAvaliacoesAdmin() {
  const lista   = document.getElementById('avaliacoesAdminLista');
  const filtroEl= document.getElementById('filtroAvaliacoes');
  if (!lista) return;

  lista.innerHTML = '<p style="color:#aaa;font-size:0.85rem">Carregando…</p>';
  const filtro = filtroEl?.value || 'todas';

  let query = supabaseClient
    .from('avaliacoes')
    .select('id, produto_id, nome_cliente, nota, comentario, aprovado, destaque, criado_em')
    .order('criado_em', { ascending: false });

  if (filtro === 'pendentes')  query = query.eq('aprovado', false);
  if (filtro === 'aprovadas')  query = query.eq('aprovado', true);
  if (filtro === 'destaque')   query = query.eq('destaque', true).eq('aprovado', true);

  const { data, error } = await query;
  if (error) { lista.innerHTML = `<p style="color:red">${error.message}</p>`; return; }
  if (!data?.length) { lista.innerHTML = '<p style="color:#aaa;font-size:0.85rem">Nenhuma avaliação encontrada.</p>'; return; }

  const fmtNota = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR');

  lista.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.82rem">
    <thead><tr style="border-bottom:2px solid #e0d8d0">
      <th style="text-align:left;padding:0.5rem">Cliente</th>
      <th style="text-align:left;padding:0.5rem">Produto ID</th>
      <th style="padding:0.5rem">Nota</th>
      <th style="text-align:left;padding:0.5rem">Comentário</th>
      <th style="padding:0.5rem">Data</th>
      <th style="padding:0.5rem">Status</th>
      <th style="padding:0.5rem">Ações</th>
    </tr></thead>
    <tbody>${data.map(a => `
      <tr style="border-bottom:1px solid #f0ebe4" id="av-row-${a.id}">
        <td style="padding:0.5rem;font-weight:500">${a.nome_cliente}</td>
        <td style="padding:0.5rem;color:#999;font-size:0.75rem">${a.produto_id?.slice(0,12) || '—'}</td>
        <td style="padding:0.5rem;text-align:center;color:#C4934A">${fmtNota(a.nota)}</td>
        <td style="padding:0.5rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.comentario || '—'}</td>
        <td style="padding:0.5rem;text-align:center;color:#999">${fmtDate(a.criado_em)}</td>
        <td style="padding:0.5rem;text-align:center">
          <span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:2px;background:${a.aprovado ? '#f0fdf4' : '#fef2f2'};color:${a.aprovado ? '#15803d' : '#b91c1c'}">${a.aprovado ? '✓ Aprovada' : '⏳ Pendente'}</span>
          ${a.destaque ? '<br><span style="font-size:0.65rem;color:#C4934A;margin-top:2px;display:block">⭐ Home</span>' : ''}
        </td>
        <td style="padding:0.5rem;text-align:center;white-space:nowrap">
          ${!a.aprovado ? `<button onclick="aprovarAvaliacao('${a.id}')" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:#1c2e3e;color:#fff;border:none;cursor:pointer;margin-right:4px">Aprovar</button>` : ''}
          ${a.aprovado && !a.destaque ? `<button onclick="destacarAvaliacao('${a.id}', true)" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:#C4934A;color:#fff;border:none;cursor:pointer;margin-right:4px">+ Home</button>` : ''}
          ${a.destaque ? `<button onclick="destacarAvaliacao('${a.id}', false)" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:#aaa;color:#fff;border:none;cursor:pointer;margin-right:4px">- Home</button>` : ''}
          <button onclick="excluirAvaliacao('${a.id}')" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:#fef2f2;color:#b91c1c;border:1px solid #b91c1c;cursor:pointer">✕</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Filtro — registra listener apenas uma vez (evita duplicatas sem { once })
  if (filtroEl && !filtroEl.dataset.avListenerBound) {
    filtroEl.dataset.avListenerBound = '1';
    filtroEl.addEventListener('change', carregarAvaliacoesAdmin);
  }

  // Botões do modal — registra cada listener apenas uma vez
  const btnNovaAv = document.getElementById('btnNovaAvaliacao');
  if (btnNovaAv && !btnNovaAv.dataset.avListenerBound) {
    btnNovaAv.dataset.avListenerBound = '1';
    btnNovaAv.addEventListener('click', () => {
      const modal = document.getElementById('modalAvaliacao');
      if (modal) { modal.style.display = 'flex'; }
    });
  }

  const btnFecharAv = document.getElementById('btnFecharModalAv');
  if (btnFecharAv && !btnFecharAv.dataset.avListenerBound) {
    btnFecharAv.dataset.avListenerBound = '1';
    btnFecharAv.addEventListener('click', () => {
      document.getElementById('modalAvaliacao').style.display = 'none';
    });
  }

  const btnSalvarAv = document.getElementById('btnSalvarAvaliacao');
  if (btnSalvarAv && !btnSalvarAv.dataset.avListenerBound) {
    btnSalvarAv.dataset.avListenerBound = '1';
    btnSalvarAv.addEventListener('click', async () => {
      const produto_id   = document.getElementById('avAdmProduto')?.value.trim();
      const nome_cliente = document.getElementById('avAdmNome')?.value.trim();
      const foto_cliente = document.getElementById('avAdmFoto')?.value.trim() || null;
      const nota         = parseInt(document.getElementById('avAdmNota')?.value || '5');
      const comentario   = document.getElementById('avAdmComentario')?.value.trim();
      const aprovado     = document.getElementById('avAdmAprovado')?.checked;
      const destaque     = document.getElementById('avAdmDestaque')?.checked;
      if (!produto_id || !nome_cliente) { toast('Preencha produto ID e nome', 'error'); return; }
      const { error } = await supabaseClient.from('avaliacoes').insert({ produto_id, nome_cliente, foto_cliente, nota, comentario, aprovado, destaque });
      if (error) { toast(error.message, 'error'); return; }
      toast('Avaliação adicionada!');
      document.getElementById('modalAvaliacao').style.display = 'none';
      carregarAvaliacoesAdmin();
    });
  }
}

// Conjunto de IDs de avaliações com operação em curso — previne race conditions
const _avaliacaoOps = new Set();

window.aprovarAvaliacao = async (id) => {
  const opKey = `aprovar-${id}`;
  if (_avaliacaoOps.has(opKey)) return;
  _avaliacaoOps.add(opKey);
  try {
    const { error } = await supabaseClient.from('avaliacoes').update({ aprovado: true }).eq('id', id);
    if (error) throw error;
    toast('Avaliação aprovada!');
    carregarAvaliacoesAdmin();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    _avaliacaoOps.delete(opKey);
  }
};

window.destacarAvaliacao = async (id, destaque) => {
  const opKey = `destacar-${id}`;
  if (_avaliacaoOps.has(opKey)) return;
  _avaliacaoOps.add(opKey);
  try {
    const { error } = await supabaseClient.from('avaliacoes').update({ destaque }).eq('id', id);
    if (error) throw error;
    toast(destaque ? '⭐ Adicionado à home!' : 'Removido da home');
    carregarAvaliacoesAdmin();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    _avaliacaoOps.delete(opKey);
  }
};

window.excluirAvaliacao = async (id) => {
  if (!confirm('Excluir esta avaliação?')) return;
  const opKey = `excluir-av-${id}`;
  if (_avaliacaoOps.has(opKey)) return;
  _avaliacaoOps.add(opKey);
  try {
    const { error } = await supabaseClient.from('avaliacoes').delete().eq('id', id);
    if (error) throw error;
    toast('Avaliação excluída');
    document.getElementById(`av-row-${id}`)?.remove();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    _avaliacaoOps.delete(opKey);
  }
};

/* ══════════════════════════════════════════
   DASHBOARD DE MÉTRICAS
   ══════════════════════════════════════════ */
async function carregarDashboard() {
  const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

  try {
    // Fetch em paralelo
    const [
      { data: pedidos },
      { count: clientes },
      { count: carrinhos },
      { count: cuponsAtivos },
      { data: fidelidadeRows },
      { data: varEstoque }
    ] = await Promise.all([
      supabaseClient.from('pedidos').select('id,total,status,nome_cliente,criado_em,pagamento').order('criado_em', { ascending: false }),
      supabaseClient.from('clientes_perfil').select('id', { count: 'exact', head: true }),
      supabaseClient.from('carrinhos_abandonados').select('id', { count: 'exact', head: true }),
      supabaseClient.from('cupons').select('id', { count: 'exact', head: true }).eq('ativo', true),
      supabaseClient.from('clientes_perfil').select('compras_total').gt('compras_total', 0),
      supabaseClient.from('variacoes').select('produto_id,tamanho,cor_nome,estoque').lte('estoque', 3).gt('estoque', 0).order('estoque', { ascending: true }),
    ]);

    const pagos = (pedidos || []).filter(p => ['confirmado','pago','em preparação','enviado','a caminho','entregue'].includes(p.status));
    const aEnviar = (pedidos || []).filter(p => ['confirmado','pago','em preparação'].includes(p.status));
    const receita = pagos.reduce((s, p) => s + Number(p.total || 0), 0);
    const ticket  = pagos.length ? receita / pagos.length : 0;

    // KPIs
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('dashReceita',    fmt(receita));
    set('dashPedidos',    pagos.length);
    set('dashCarrinhos',  carrinhos ?? '—');
    set('dashClientes',   clientes  ?? '—');
    set('dashTicket',     fmt(ticket));
    set('dashFidelidade', (fidelidadeRows || []).length);
    set('dashPendente',   aEnviar.length);
    set('dashCupons',     cuponsAtivos ?? '—');

    // Pedidos recentes (top 8)
    const tbody = document.getElementById('dashPedidosRecentes');
    if (tbody) {
      const recentes = (pedidos || []).slice(0, 8);
      const statusBadge = (s) => {
        const map = { pendente:'#f59e0b', confirmado:'#3b82f6', pago:'#22c55e', 'em preparação':'#8b5cf6', enviado:'#0ea5e9', 'a caminho':'#06b6d4', entregue:'#16a34a', cancelado:'#ef4444', recusado:'#dc2626' };
        return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:0.7rem;font-weight:600;background:${map[s]||'#ccc'}20;color:${map[s]||'#888'}">${s}</span>`;
      };
      tbody.innerHTML = recentes.map(p => `
        <tr>
          <td style="font-weight:600;color:#555;font-size:0.75rem">#${String(p.id).slice(-6).toUpperCase()}</td>
          <td>${p.nome_cliente || '—'}</td>
          <td>${statusBadge(p.status)}</td>
          <td style="text-align:right;font-weight:600">${fmt(p.total)}</td>
          <td style="color:#aaa;font-size:0.75rem">${p.criado_em ? new Date(p.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#aaa">Nenhum pedido ainda.</td></tr>';
    }

    // Estoque baixo
    const divEstoque = document.getElementById('dashEstoqueBaixo');
    if (divEstoque) {
      if ((varEstoque || []).length === 0) {
        divEstoque.innerHTML = '<span style="color:#16a34a">✓ Todos os produtos com estoque saudável.</span>';
      } else {
        divEstoque.innerHTML = `
          <table class="dash-table">
            <thead><tr><th>Produto ID</th><th>Tamanho</th><th>Cor</th><th style="text-align:right">Estoque</th></tr></thead>
            <tbody>
              ${varEstoque.slice(0, 12).map(v => `
                <tr>
                  <td style="font-size:0.75rem;color:#888">${v.produto_id?.slice(0,8) || '—'}</td>
                  <td>${v.tamanho || '—'}</td>
                  <td>${v.cor_nome || '—'}</td>
                  <td style="text-align:right;color:${v.estoque <= 1 ? '#dc2626' : '#f59e0b'};font-weight:700">${v.estoque}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`;
      }
    }
  } catch (e) {
    console.error('[Dashboard]', e);
  }
}

/* ============================================================
   LOGS DO SISTEMA — Pilar 3 (Monitoramento em Produção)
   ============================================================ */
async function carregarLogsAdmin() {
  const tbody   = document.getElementById('logsTbody');
  const resumoEl= document.getElementById('logsResumo');
  const vazioEl = document.getElementById('logsVazio');
  if (!tbody || typeof supabaseClient === 'undefined') return;

  const tipo   = document.getElementById('filtroLogsTipo')?.value || '';
  const pagina = document.getElementById('filtroLogsPagina')?.value || '';

  tbody.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:#aaa">Carregando…</td></tr>';

  try {
    let query = supabaseClient
      .from('logs_erros')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(200);

    if (tipo)   query = query.eq('tipo', tipo);
    if (pagina) query = query.like('pagina', `%${pagina}%`);

    const { data, error } = await query;
    if (error) throw error;

    // Resumo rápido (últimas 24h)
    const ontem = new Date(Date.now() - 86400000).toISOString();
    const recentes = (data || []).filter(l => l.criado_em >= ontem);
    const jsErros  = recentes.filter(l => l.tipo === 'js_error').length;
    const promErros= recentes.filter(l => l.tipo === 'promise_rejection').length;
    const checkoutErros = recentes.filter(l => (l.pagina || '').includes('checkout')).length;

    if (resumoEl) {
      const chip = (label, val, cor) =>
        `<div style="background:${cor};padding:0.75rem 1rem;border-radius:4px">
          <div style="font-size:1.5rem;font-weight:700;color:#1c2e3e">${val}</div>
          <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:#7a7068">${label}</div>
        </div>`;
      resumoEl.innerHTML =
        chip('Total últimas 24h', recentes.length, '#f5f2ee') +
        chip('JS Errors', jsErros, jsErros > 0 ? '#fef2f2' : '#f0fdf4') +
        chip('Promise Rejections', promErros, promErros > 0 ? '#fff7ed' : '#f0fdf4') +
        chip('Erros no Checkout', checkoutErros, checkoutErros > 0 ? '#fef2f2' : '#f0fdf4');
    }

    if (!data?.length) {
      tbody.innerHTML = '';
      if (vazioEl) vazioEl.style.display = 'block';
      return;
    }
    if (vazioEl) vazioEl.style.display = 'none';

    const fmtDt = iso => {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    };

    const tipoBadge = t => {
      const cor = t === 'js_error' ? '#fef2f2;color:#b91c1c' : '#fff7ed;color:#c2410c';
      return `<span style="background:${cor};padding:0.15rem 0.4rem;font-size:0.65rem;letter-spacing:0.06em;text-transform:uppercase;border-radius:2px">${t}</span>`;
    };

    tbody.innerHTML = data.map(l => {
      const msg   = (l.mensagem || '').slice(0, 120);
      const stack = l.stack ? l.stack.split('\n')[0].slice(0, 80) : '—';
      const pag   = (l.pagina || '—').replace('https://wearvirtu.com', '');
      const user  = l.user_id ? l.user_id.slice(0, 8) + '…' : '<span style="color:#ccc">anon</span>';
      return `<tr style="border-bottom:1px solid #f0ebe4">
        <td style="padding:0.5rem 0.75rem;white-space:nowrap;color:#7a7068;font-size:0.75rem">${fmtDt(l.criado_em)}</td>
        <td style="padding:0.5rem 0.75rem">${tipoBadge(l.tipo)}</td>
        <td style="padding:0.5rem 0.75rem;font-size:0.75rem;color:#1c2e3e;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.pagina || ''}">${pag}</td>
        <td style="padding:0.5rem 0.75rem;font-size:0.78rem;max-width:280px;word-break:break-word">${msg}</td>
        <td style="padding:0.5rem 0.75rem;font-size:0.72rem;color:#888">${user}</td>
        <td style="padding:0.5rem 0.75rem;font-size:0.68rem;color:#aaa;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.stack || ''}">${stack}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:1rem;color:#b91c1c;font-size:0.82rem">Erro ao carregar logs: ${e.message}</td></tr>`;
  }
}

// Limpar todos os logs (mantém apenas últimos 7 dias)
async function limparLogsAntigos() {
  if (!confirm('Apagar todos os logs com mais de 7 dias?')) return;
  try {
    const limite = new Date(Date.now() - 7 * 86400000).toISOString();
    const { error } = await supabaseClient
      .from('logs_erros')
      .delete()
      .lt('criado_em', limite);
    if (error) throw error;
    alert('Logs antigos removidos.');
    carregarLogsAdmin();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

/* ── Eventos: Logs view ─────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Filtros disparam reload
  ['filtroLogsTipo','filtroLogsPagina'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (document.getElementById('viewLogs')?.classList.contains('admin-view--hidden') === false) {
        carregarLogsAdmin();
      }
    });
  });
  document.getElementById('btnRecarregarLogs')?.addEventListener('click', carregarLogsAdmin);
  document.getElementById('btnLimparLogs')?.addEventListener('click', limparLogsAntigos);
});
