/* ============================================================
   VIRTÙ — Admin Panel JavaScript
   File System Access API: lê e salva products.json direto no disco
   ============================================================ */

// ── ESTADO GLOBAL ──────────────────────────
let DB = null;          // objeto products.json em memória
let fileHandle = null;  // referência ao arquivo aberto (File System API)
let filtroAtual = 'todos';
let editandoId  = null; // null = novo produto, string = editando existente

// ── DADOS DE EXEMPLO (fallback sem arquivo) ─
const EXEMPLO = {
  produtos: [
    { id:"vestido-athena", nome:"Vestido Athena", categoria:"vestidos", descricao:"Vestido midi com silhueta clássica.", composicao:"70% viscose, 30% poliéster", preco_original:420, preco_desconto:null, badge:"Novo", imagem_placeholder:"linear-gradient(135deg,#E8E0D5,#D4CCC0)", imagem_url:"", cores:[{nome:"Navy",hex:"#2B3F54"}], tamanhos:["PP","P","M","G","GG"], tamanhos_esgotados:[], destaque:true, novidade:true, ativo:true, estoque:15 },
    { id:"blusa-helena", nome:"Blusa Helena", categoria:"blusas", descricao:"Blusa de linho com decote V.", composicao:"100% linho", preco_original:195, preco_desconto:null, badge:"Novo", imagem_placeholder:"linear-gradient(135deg,#D5C8BA,#C4B8A8)", imagem_url:"", cores:[{nome:"Off-White",hex:"#F9F7F4"}], tamanhos:["PP","P","M","G","GG"], tamanhos_esgotados:["PP"], destaque:true, novidade:true, ativo:true, estoque:22 },
    { id:"calca-diana", nome:"Calça Diana", categoria:"calcas", descricao:"Calça wide leg de alfaiataria.", composicao:"65% poliéster, 35% viscose", preco_original:360, preco_desconto:280, badge:"Sale", imagem_placeholder:"linear-gradient(135deg,#3D5470,#2B3F54)", imagem_url:"", cores:[{nome:"Navy",hex:"#2B3F54"}], tamanhos:["PP","P","M","G","GG"], tamanhos_esgotados:["G"], destaque:false, novidade:false, ativo:true, estoque:8 }
  ],
  configuracoes: {
    nome_loja:"Virtù", slogan:"há virtude no vestir", instagram:"@wear.virtu", frete_gratis_acima:300, max_parcelas:6,
    banner_home:{ titulo_linha1:"Nova Coleção", titulo_linha2:"Outono 2025", subtitulo:"Peças que falam mais alto que qualquer tendência", cta_texto:"Explorar Coleção", cta_link:"catalogo.html" },
    banner_editorial:{ titulo:"há virtude no vestir", texto:"Cada peça da Virtù é pensada para mulheres que escolhem com intenção.", cta_texto:"Conhecer a Virtù", cta_link:"sobre.html" }
  }
};

// ── INICIALIZAÇÃO ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  DB = structuredClone(EXEMPLO);
  renderTable();
  bindEvents();
  setStatus('info', '💡 Clique em <strong>Abrir JSON</strong> para carregar o arquivo <code>data/products.json</code>. Editando dados de exemplo por enquanto.');
});

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
      document.getElementById('viewTitle').textContent = capitalize(view);
      if (view === 'configuracoes') populateConfig();
    });
  });

  // Abrir arquivo JSON
  document.getElementById('btnOpenFile')?.addEventListener('click', openFile);

  // Salvar arquivo JSON
  document.getElementById('btnSaveFile')?.addEventListener('click', saveFile);

  // Novo produto
  document.getElementById('btnNewProduct')?.addEventListener('click', () => openModal(null));

  // Fechar modal
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('btnCancelModal')?.addEventListener('click', closeModal);
  document.getElementById('modalOverlay')?.addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });

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
  document.getElementById('formPlaceholder')?.addEventListener('input', function() {
    document.getElementById('colorPreview').style.background = this.value;
  });

  // Preview de desconto (range ↔ campo de preço)
  document.getElementById('formPctDesconto')?.addEventListener('input', function() {
    const orig = parseFloat(document.getElementById('formPrecoOriginal')?.value) || 0;
    const pct  = parseInt(this.value);
    if (orig > 0 && pct > 0) {
      const desc = orig * (1 - pct / 100);
      document.getElementById('formPrecoDesconto').value = desc.toFixed(2);
    } else {
      document.getElementById('formPrecoDesconto').value = '';
    }
    updateDiscountPreview();
  });

  document.getElementById('formPrecoOriginal')?.addEventListener('input', updateDiscountPreview);
  document.getElementById('formPrecoDesconto')?.addEventListener('input', function() {
    const orig = parseFloat(document.getElementById('formPrecoOriginal')?.value) || 0;
    const desc = parseFloat(this.value);
    if (orig > 0 && desc > 0 && desc < orig) {
      const pct = Math.round((1 - desc / orig) * 100);
      document.getElementById('formPctDesconto').value = pct;
    } else {
      document.getElementById('formPctDesconto').value = 0;
    }
    updateDiscountPreview();
  });

  // Salvar config
  document.getElementById('btnSaveConfig')?.addEventListener('click', saveConfig);

  // ESC fecha modal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── ABRIR ARQUIVO (File System Access API) ──
async function openFile() {
  if (!('showOpenFilePicker' in window)) {
    // Fallback: input file clássico
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        DB = JSON.parse(text);
        renderTable();
        setStatus('success', `✓ Arquivo <strong>${file.name}</strong> carregado. Faça suas edições e clique em Salvar JSON para baixar o arquivo atualizado.`);
        toast('Arquivo carregado com sucesso!', 'success');
      } catch (e) {
        setStatus('error', `✗ Erro ao ler o arquivo: ${e.message}`);
        toast('Erro ao ler o JSON', 'error');
      }
    };
    input.click();
    return;
  }

  try {
    [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false
    });
    const file = await fileHandle.getFile();
    const text = await file.text();
    DB = JSON.parse(text);
    renderTable();
    setStatus('success', `✓ <strong>${file.name}</strong> aberto. Edições serão salvas diretamente neste arquivo.`);
    toast('Arquivo carregado!', 'success');
  } catch (e) {
    if (e.name !== 'AbortError') {
      setStatus('error', `✗ Erro: ${e.message}`);
      toast('Erro ao abrir arquivo', 'error');
    }
  }
}

// ── SALVAR ARQUIVO ──────────────────────────
async function saveFile() {
  const json = JSON.stringify(DB, null, 2);

  if (fileHandle) {
    // Salva diretamente no arquivo original (File System API)
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      setStatus('success', '✓ Arquivo salvo com sucesso! As mudanças já estão no seu products.json.');
      toast('Salvo com sucesso!', 'success');
    } catch (e) {
      setStatus('error', `✗ Erro ao salvar: ${e.message}`);
      toast('Erro ao salvar', 'error');
    }
    return;
  }

  // Fallback: download do arquivo
  if ('showSaveFilePicker' in window) {
    try {
      const newHandle = await window.showSaveFilePicker({
        suggestedName: 'products.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await newHandle.createWritable();
      await writable.write(json);
      await writable.close();
      fileHandle = newHandle;
      setStatus('success', '✓ Arquivo salvo! Substitua o arquivo <code>data/products.json</code> do seu projeto por este.');
      toast('Arquivo salvo!', 'success');
    } catch (e) {
      if (e.name !== 'AbortError') toast('Erro ao salvar', 'error');
    }
    return;
  }

  // Último fallback: download clássico
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'products.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('success', '✓ products.json baixado. Substitua o arquivo em <code>virtu-site/data/products.json</code>.');
  toast('JSON baixado!', 'success');
}

// ── RENDERIZA TABELA ────────────────────────
function renderTable() {
  const tbody  = document.getElementById('productsTableBody');
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const empty  = document.getElementById('tableEmpty');
  if (!tbody || !DB) return;

  let lista = DB.produtos || [];

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
          <div class="prod-thumb" style="background:${p.imagem_url ? `url('${p.imagem_url}') center/cover` : p.imagem_placeholder || '#E8E0D5'};border-radius:4px;border:1px solid #eee"></div>
        </td>
        <td>
          <div class="prod-name">${escHtml(p.nome)}</div>
          <div class="prod-id">${escHtml(p.id)}</div>
        </td>
        <td><span class="badge-cat">${escHtml(p.categoria)}</span></td>
        <td>${temDesc ? `<span class="price-original">${fmt(p.preco_original)}</span>` : `<span class="price-normal">${fmt(p.preco_original)}</span>`}</td>
        <td>${temDesc ? `<span class="price-sale">${fmt(p.preco_desconto)}</span>` : '<span style="color:#ccc">—</span>'}</td>
        <td>${pct > 0 ? `<span class="badge-discount">−${pct}%</span>` : '<span style="color:#ccc">—</span>'}</td>
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
  const modal  = document.getElementById('modalOverlay');
  const title  = document.getElementById('modalTitle');

  // Reset form
  resetForm();

  if (id) {
    // Editar
    const p = DB.produtos.find(x => x.id === id);
    if (!p) return;
    title.textContent = `Editar — ${p.nome}`;
    document.getElementById('formId').value              = p.id;
    document.getElementById('formNome').value            = p.nome;
    document.getElementById('formCategoria').value       = p.categoria;
    document.getElementById('formBadge').value           = p.badge || '';
    document.getElementById('formPrecoOriginal').value   = p.preco_original;
    document.getElementById('formPrecoDesconto').value   = p.preco_desconto || '';
    document.getElementById('formEstoque').value         = p.estoque ?? '';
    document.getElementById('formImagem').value          = p.imagem_url || '';
    document.getElementById('formPlaceholder').value     = p.imagem_placeholder || '';
    document.getElementById('formDescricao').value       = p.descricao || '';
    document.getElementById('formComposicao').value      = p.composicao || '';
    document.getElementById('formDestaque').checked      = !!p.destaque;
    document.getElementById('formNovidade').checked      = !!p.novidade;
    document.getElementById('formAtivo').checked         = p.ativo !== false;

    // Tamanhos
    document.querySelectorAll('.admin-size-check input').forEach(cb => {
      cb.checked = (p.tamanhos || []).includes(cb.value);
    });

    // Preview cor
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
  ['formId','formNome','formPrecoOriginal','formPrecoDesconto','formEstoque','formImagem','formPlaceholder','formDescricao','formComposicao']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('formCategoria').value = 'vestidos';
  document.getElementById('formBadge').value     = '';
  document.getElementById('formDestaque').checked = false;
  document.getElementById('formNovidade').checked = false;
  document.getElementById('formAtivo').checked    = true;
  document.getElementById('formPctDesconto').value = 0;
  document.getElementById('colorPreview').style.background = '';
  document.getElementById('discountPreview').textContent = '—';
  document.querySelectorAll('.admin-size-check input').forEach(cb => cb.checked = false);
  document.querySelectorAll('.admin-input.error').forEach(el => el.classList.remove('error'));
}

// ── SALVAR PRODUTO ──────────────────────────
function saveProduct() {
  const nome  = document.getElementById('formNome')?.value.trim();
  const preco = parseFloat(document.getElementById('formPrecoOriginal')?.value);

  if (!nome || !preco) {
    if (!nome) document.getElementById('formNome')?.classList.add('error');
    if (!preco) document.getElementById('formPrecoOriginal')?.classList.add('error');
    toast('Preencha os campos obrigatórios', 'error');
    return;
  }

  const desconto = parseFloat(document.getElementById('formPrecoDesconto')?.value) || null;
  const tamanhos = [...document.querySelectorAll('.admin-size-check input:checked')].map(cb => cb.value);

  const produto = {
    id:                editandoId || slugify(nome),
    nome,
    categoria:         document.getElementById('formCategoria')?.value,
    descricao:         document.getElementById('formDescricao')?.value.trim(),
    composicao:        document.getElementById('formComposicao')?.value.trim(),
    preco_original:    preco,
    preco_desconto:    desconto && desconto < preco ? desconto : null,
    badge:             document.getElementById('formBadge')?.value || null,
    imagem_url:        document.getElementById('formImagem')?.value.trim(),
    imagem_placeholder:document.getElementById('formPlaceholder')?.value.trim() || 'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
    cores:             editandoId ? (DB.produtos.find(p => p.id === editandoId)?.cores || []) : [],
    tamanhos:          tamanhos.length ? tamanhos : ['PP','P','M','G','GG'],
    tamanhos_esgotados:[],
    destaque:          document.getElementById('formDestaque')?.checked,
    novidade:          document.getElementById('formNovidade')?.checked,
    ativo:             document.getElementById('formAtivo')?.checked,
    estoque:           parseInt(document.getElementById('formEstoque')?.value) || 0
  };

  if (editandoId) {
    const idx = DB.produtos.findIndex(p => p.id === editandoId);
    if (idx !== -1) DB.produtos[idx] = produto;
    toast(`"${nome}" atualizado!`, 'success');
  } else {
    DB.produtos.unshift(produto); // adiciona no topo
    toast(`"${nome}" criado!`, 'success');
  }

  closeModal();
  renderTable();
  setStatus('info', '⚠️ Lembre-se de clicar em <strong>Salvar JSON</strong> para gravar as alterações no arquivo.');
}

// ── TOGGLE ATIVO ────────────────────────────
function toggleAtivo(id) {
  const p = DB.produtos.find(x => x.id === id);
  if (!p) return;
  p.ativo = !p.ativo;
  renderTable();
  toast(`"${p.nome}" ${p.ativo ? 'ativado' : 'desativado'}`, 'success');
  setStatus('info', '⚠️ Clique em <strong>Salvar JSON</strong> para gravar as alterações.');
}

// ── DELETAR PRODUTO ─────────────────────────
function deleteProduct(id) {
  const p = DB.produtos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Excluir "${p.nome}" permanentemente? Esta ação não pode ser desfeita.`)) return;
  DB.produtos = DB.produtos.filter(x => x.id !== id);
  renderTable();
  toast(`"${p.nome}" excluído`, 'error');
  setStatus('info', '⚠️ Clique em <strong>Salvar JSON</strong> para gravar as alterações.');
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
}

function saveConfig() {
  if (!DB.configuracoes) DB.configuracoes = {};
  const cfg = DB.configuracoes;
  cfg.nome_loja          = document.getElementById('cfgNomeLoja')?.value.trim();
  cfg.slogan             = document.getElementById('cfgSlogan')?.value.trim();
  cfg.instagram          = document.getElementById('cfgInstagram')?.value.trim();
  cfg.frete_gratis_acima = parseFloat(document.getElementById('cfgFrete')?.value) || 300;
  cfg.max_parcelas       = parseInt(document.getElementById('cfgParcelas')?.value) || 6;
  cfg.banner_home = {
    titulo_linha1: document.getElementById('cfgBannerL1')?.value.trim(),
    titulo_linha2: document.getElementById('cfgBannerL2')?.value.trim(),
    subtitulo:     document.getElementById('cfgBannerSub')?.value.trim(),
    cta_texto:     document.getElementById('cfgBannerCta')?.value.trim(),
    cta_link:      document.getElementById('cfgBannerCtaLink')?.value.trim()
  };
  cfg.banner_editorial = {
    titulo:    document.getElementById('cfgEditTitle')?.value.trim(),
    texto:     document.getElementById('cfgEditText')?.value.trim(),
    cta_texto: document.getElementById('cfgEditCta')?.value.trim(),
    cta_link:  document.getElementById('cfgEditCtaLink')?.value.trim()
  };
  toast('Configurações salvas na memória!', 'success');
  setStatus('info', '⚠️ Clique em <strong>Salvar JSON</strong> para gravar as alterações no arquivo.');
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
  const bar  = document.getElementById('statusBar');
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

// Expõe funções usadas em onclick inline na tabela
window.openModal     = openModal;
window.toggleAtivo   = toggleAtivo;
window.deleteProduct = deleteProduct;
