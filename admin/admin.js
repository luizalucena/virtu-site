/* ============================================================
   VIRTÙ — Admin Panel JavaScript (Supabase Edition)
   Todas as alterações são salvas automaticamente no banco de dados.
   Requer: supabase CDN + js/supabase-config.js carregados antes
   ============================================================ */

// ── ESTADO GLOBAL ──────────────────────────
let DB = { produtos: [], configuracoes: {} };
let filtroAtual = 'todos';
let editandoId  = null;

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
  // Remover linha
  row.querySelector('.galeria-remove-btn')?.addEventListener('click', () => row.remove());
  container.appendChild(row);
}

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
    document.getElementById('formCompreJunto').value      = (p.compre_junto || []).join(', ');
    document.getElementById('formDestaque').checked       = !!p.destaque;
    document.getElementById('formNovidade').checked       = !!p.novidade;
    document.getElementById('formEssencial').checked      = !!p.essencial;
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
   'formPlaceholder','formDescricao','formComposicao','formCompreJunto']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('formCategoria').value  = 'vestidos';
  document.getElementById('formBadge').value      = '';
  document.getElementById('formDestaque').checked  = false;
  document.getElementById('formNovidade').checked  = false;
  document.getElementById('formEssencial').checked = false;
  document.getElementById('formAtivo').checked     = true;
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
    imagens:            getGaleriaUrls(),
    imagem_url:         getGaleriaUrls()[0] || '',
    imagem_placeholder: document.getElementById('formPlaceholder')?.value.trim()
                          || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
    cores:              coresExistentes,
    tamanhos:           tamanhos.length ? tamanhos : ['PP','P','M','G','GG'],
    tamanhos_esgotados: [],
    destaque:           document.getElementById('formDestaque')?.checked,
    novidade:           document.getElementById('formNovidade')?.checked,
    essencial:          document.getElementById('formEssencial')?.checked,
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
    {titulo:'Parcelamento',descricao:'Até 12x sem juros no cartão'},
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
          <input type="text" class="admin-input" id="cfgDif${i}Titulo" value="${d.titulo||''}" />
        </div>
        <div class="admin-form-group">
          <label class="admin-label">Descrição</label>
          <input type="text" class="admin-input" id="cfgDif${i}Desc" value="${d.descricao||''}" />
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
          <input type="text" class="admin-input" id="cfgFaq${i}P" value="${f.pergunta||''}" />
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

  // Guia de Tamanhos
  set('cfgGuiaTamanhoObs', cfg.guia_tamanhos_obs);
  renderGuiaTamanhos(cfg.guia_tamanhos || [
    {tamanho:'PP',busto:'80–84',cintura:'60–64',quadril:'86–90'},
    {tamanho:'P', busto:'84–88',cintura:'64–68',quadril:'90–94'},
    {tamanho:'M', busto:'88–92',cintura:'68–72',quadril:'94–98'},
    {tamanho:'G', busto:'92–96',cintura:'72–76',quadril:'98–102'},
    {tamanho:'GG',busto:'96–100',cintura:'76–80',quadril:'102–106'},
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
  const tamanhosCfg = cfg.filtros_tamanhos || ['PP','P','M','G','GG','XG'];
  const cfgFiltrosTam = document.getElementById('cfgFiltrosTamanhos');
  if (cfgFiltrosTam) cfgFiltrosTam.value = tamanhosCfg.join(',');

  const coresCfg = cfg.filtros_cores || [
    {nome:'Azul Âncora',hex:'#2B3F54'},{nome:'Dourado',hex:'#C4934A'},
    {nome:'Cru',hex:'#E8D5B5'},{nome:'Preto',hex:'#1a1a1a'},
    {nome:'Off-White',hex:'#F9F7F4'},{nome:'Cinza',hex:'#6E6660'},
    {nome:'Terracota',hex:'#8B6F5E'},{nome:'Rosa',hex:'#D4A5A5'}
  ];
  renderFiltrosCores(coresCfg);

  if (!document.getElementById('btnAddCor')._bound) {
    document.getElementById('btnAddCor')._bound = true;
    document.getElementById('btnAddCor').addEventListener('click', () => {
      document.getElementById('filtrosCorTbody')
        ?.insertAdjacentHTML('beforeend', filtrosCorRow({nome:'',hex:'#000000'}));
    });
  }

  // Políticas
  set('cfgPolComoFunciona',    cfg.pol_como_funciona);
  set('cfgPolTrocas',          cfg.pol_trocas);
  set('cfgPolRastreio',        cfg.pol_rastreio);
  set('cfgPolPrivacidade',     cfg.pol_privacidade);
  set('cfgPolSustentabilidade',cfg.pol_sustentabilidade);
  set('cfgPolTrabalheConosco', cfg.pol_trabalhe_conosco);
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
    pol_privacidade:      document.getElementById('cfgPolPrivacidade')?.value.trim()      || null,
    pol_sustentabilidade: document.getElementById('cfgPolSustentabilidade')?.value.trim() || null,
    pol_trabalhe_conosco: document.getElementById('cfgPolTrabalheConosco')?.value.trim()  || null,
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
