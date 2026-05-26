/* ============================================================
   VIRTÙ — Admin Panel JavaScript (Supabase Edition)
   Todas as alterações são salvas automaticamente no banco de dados.
   Requer: supabase CDN + js/supabase-config.js carregados antes
   ============================================================ */

// ── ESTADO GLOBAL ──────────────────────────
let DB = { produtos: [], configuracoes: {} };
let filtroAtual = 'todos';
let editandoId  = null;

// ── INICIALIZAÇÃO ───────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Verifica autenticação antes de mostrar o painel
  await verificarAuth();
});

// ── AUTH: VERIFICAR SESSÃO ──────────────────
async function verificarAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    mostrarAdmin();
  } else {
    mostrarLogin();
  }

  // Escuta mudanças de estado de autenticação
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) mostrarAdmin();
    else mostrarLogin();
  });
}

function mostrarLogin() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.remove('login-screen--hidden');
  }
  bindLoginEvents();
}

function mostrarAdmin() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.add('login-screen--hidden');
    setTimeout(() => loginScreen.style.display = 'none', 300);
  }
  setStatus('info', '⏳ Conectando ao banco de dados…');
  carregarDados();
  bindEvents();
}

// ── AUTH: EVENTOS DE LOGIN ──────────────────
function bindLoginEvents() {
  const form     = document.getElementById('loginForm');
  const errorEl  = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');

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
      errorEl.textContent = error.message.includes('Invalid login')
        ? 'E-mail ou senha incorretos.'
        : error.message;
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
    }
    // Se sucesso, onAuthStateChange cuida do resto automaticamente
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
    // e2 é ignorado se cfg vier null (tabela vazia é ok)

    DB.produtos      = produtos || [];
    DB.configuracoes = cfg     || {};

    renderTable();
    const n = DB.produtos.length;
    setStatus('success', `✓ Conectado ao Supabase. <strong>${n}</strong> produto${n !== 1 ? 's' : ''} carregado${n !== 1 ? 's' : ''}.`);
  } catch (e) {
    setStatus('error', `✗ Erro ao conectar: ${e.message}. Verifique as credenciais em <code>js/supabase-config.js</code>`);
    toast('Erro ao conectar ao banco de dados', 'error');
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
      const viewTitles = { produtos: 'Produtos', sobre: 'Página Sobre', configuracoes: 'Configurações', stock: 'Controlo de Stock' };
      document.getElementById('viewTitle').textContent = viewTitles[view] || capitalize(view);
      // Ocultar/mostrar botão Novo Produto
      document.getElementById('btnNewProduct').style.display = view === 'produtos' ? '' : 'none';
      if (view === 'configuracoes') populateConfig();
      if (view === 'sobre')        populateSobre();
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
    document.getElementById('formImagem').value           = p.imagem_url || '';
    document.getElementById('formPlaceholder').value      = p.imagem_placeholder || '';
    document.getElementById('formDescricao').value        = p.descricao || '';
    document.getElementById('formComposicao').value       = p.composicao || '';
    document.getElementById('formCompreJunto').value      = (p.compre_junto || []).join(', ');
    document.getElementById('formDestaque').checked       = !!p.destaque;
    document.getElementById('formNovidade').checked       = !!p.novidade;
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
   'formImagem','formPlaceholder','formDescricao','formComposicao','formCompreJunto']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('formCategoria').value  = 'vestidos';
  document.getElementById('formBadge').value      = '';
  document.getElementById('formDestaque').checked = false;
  document.getElementById('formNovidade').checked = false;
  document.getElementById('formAtivo').checked    = true;
  document.getElementById('formPctDesconto').value = 0;
  document.getElementById('colorPreview').style.background = '';
  document.getElementById('discountPreview').textContent   = '—';
  document.querySelectorAll('.admin-size-check input').forEach(cb => cb.checked = false);
  document.querySelectorAll('.admin-input.error').forEach(el => el.classList.remove('error'));
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
  const tamanhos = [...document.querySelectorAll('.admin-size-check input:checked')].map(cb => cb.value);

  // Preserva cores do produto existente
  const coresExistentes = editandoId
    ? (DB.produtos.find(p => p.id === editandoId)?.cores || [])
    : [];

  const produto = {
    id:                 editandoId || slugify(nome),
    nome,
    categoria:          document.getElementById('formCategoria')?.value,
    descricao:          document.getElementById('formDescricao')?.value.trim(),
    composicao:         document.getElementById('formComposicao')?.value.trim(),
    preco_original:     preco,
    preco_desconto:     (desconto && desconto < preco) ? desconto : null,
    badge:              document.getElementById('formBadge')?.value || null,
    imagem_url:         document.getElementById('formImagem')?.value.trim(),
    imagem_placeholder: document.getElementById('formPlaceholder')?.value.trim()
                          || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
    cores:              coresExistentes,
    tamanhos:           tamanhos.length ? tamanhos : ['PP','P','M','G','GG'],
    tamanhos_esgotados: [],
    destaque:           document.getElementById('formDestaque')?.checked,
    novidade:           document.getElementById('formNovidade')?.checked,
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
  }
}

// ── DELETAR PRODUTO NO SUPABASE ─────────────
async function deleteProduct(id) {
  const p = DB.produtos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Excluir "${p.nome}" permanentemente? Esta ação não pode ser desfeita.`)) return;

  try {
    const { error } = await supabaseClient
      .from('produtos')
      .delete()
      .eq('id', id);

    if (error) throw error;

    DB.produtos = DB.produtos.filter(x => x.id !== id);
    renderTable();
    toast(`"${p.nome}" excluído`, 'error');
    setStatus('info', `ℹ️ "${p.nome}" removido do banco de dados.`);
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
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
}

async function saveConfig() {
  const btnSave = document.getElementById('btnSaveConfig');
  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Salvando…'; }

  const cfg = {
    id:                 1,
    nome_loja:          document.getElementById('cfgNomeLoja')?.value.trim(),
    slogan:             document.getElementById('cfgSlogan')?.value.trim(),
    instagram:          document.getElementById('cfgInstagram')?.value.trim(),
    frete_gratis_acima: parseFloat(document.getElementById('cfgFrete')?.value) || 300,
    max_parcelas:       parseInt(document.getElementById('cfgParcelas')?.value) || 6,
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
      .filter(Boolean)
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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
