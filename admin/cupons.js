/* ============================================================
   VIRTÙ — Admin de Cupons
   ============================================================ */

'use strict';

// ── Estado ─────────────────────────────────────────────────
let todosOsCupons = [];
let filtroAtualCupons   = 'todos';

// ── Inicialização ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Verificar autenticação
  if (typeof supabaseClient === 'undefined') {
    alert('Erro: Supabase não configurado.');
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  await carregarCupons();
  bindEventos();
});

// ── Carregar cupons do banco ───────────────────────────────
async function carregarCupons() {
  setStatus('Carregando cupons…');
  try {
    const { data, error } = await supabaseClient
      .from('cupons')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    todosOsCupons = data || [];
    renderStats();
    renderTabela();
    setStatus('');
  } catch (e) {
    setStatus(`Erro ao carregar: ${e.message}`);
  }
}

// ── Estatísticas ───────────────────────────────────────────
function renderStats() {
  const total   = todosOsCupons.length;
  const ativos  = todosOsCupons.filter(c => c.ativo && !expirado(c)).length;
  const inativos= todosOsCupons.filter(c => !c.ativo || expirado(c)).length;
  const usos    = todosOsCupons.reduce((s, c) => s + (c.usos || 0), 0);

  setText('statTotal',  total);
  setText('statAtivos', ativos);
  setText('statInativos', inativos);
  setText('statUsos',   usos);
  setText('cuponsCount', `${total} cupom${total !== 1 ? 's' : ''}`);
}

// ── Tabela ─────────────────────────────────────────────────
function renderTabela() {
  const tbody = document.getElementById('cuponsTbody');
  if (!tbody) return;

  const lista = filtrarCupons();

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="cupons-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>
        <p>Nenhum cupom encontrado</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const exp     = expirado(c);
    const statusTxt = !c.ativo ? 'inativo' : exp ? 'expirado' : 'ativo';
    const badgeCls  = `badge badge--${statusTxt}`;
    const statusLabel = statusTxt === 'ativo' ? '● Ativo'
                      : statusTxt === 'expirado' ? '⚠ Expirado' : '○ Inativo';

    const descontoLabel = c.tipo === 'percentual'
      ? `<span class="badge badge--percentual">${c.valor}% off</span>`
      : `<span class="badge badge--fixo">R$ ${Number(c.valor).toFixed(2).replace('.',',')} off</span>`;

    const minLabel   = c.valor_minimo > 0 ? `R$ ${Number(c.valor_minimo).toFixed(2).replace('.',',')}` : '—';
    const usoLabel   = c.uso_maximo ? `${c.usos}/${c.uso_maximo}` : `${c.usos} usos`;
    const valLabel   = c.validade ? formatarData(c.validade) : 'Sem validade';

    const btnToggle = c.ativo && !exp
      ? `<button class="btn-icon btn-icon--toggle-off" onclick="toggleAtivo('${c.id}', false)" title="Desativar cupom">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          Desativar
        </button>`
      : `<button class="btn-icon btn-icon--toggle-on" onclick="toggleAtivo('${c.id}', true)" title="Ativar cupom">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Ativar
        </button>`;

    return `<tr>
      <td><span class="cupom-codigo">${c.codigo}</span></td>
      <td style="color:var(--text-light);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.descricao || '—'}</td>
      <td>${descontoLabel}</td>
      <td>${minLabel}</td>
      <td style="color:var(--text-light)">${usoLabel}</td>
      <td style="color:var(--text-light)">${valLabel}</td>
      <td><span class="${badgeCls}">${statusLabel}</span></td>
      <td>
        <div class="cupons-table__actions">
          ${btnToggle}
          <button class="btn-icon" onclick="editarCupom('${c.id}')" title="Editar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="btn-icon btn-icon--danger" onclick="excluirCupom('${c.id}', '${c.codigo}')" title="Excluir">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filtrarCupons() {
  return todosOsCupons.filter(c => {
    if (filtroAtualCupons === 'todos')      return true;
    if (filtroAtualCupons === 'ativo')      return c.ativo && !expirado(c);
    if (filtroAtualCupons === 'inativo')    return !c.ativo || expirado(c);
    if (filtroAtualCupons === 'percentual') return c.tipo === 'percentual';
    if (filtroAtualCupons === 'fixo')       return c.tipo === 'fixo';
    return true;
  });
}

function expirado(c) {
  if (!c.validade) return false;
  // Compara datas como strings YYYY-MM-DD para evitar problemas de fuso UTC vs local
  const hoje = new Date().toLocaleDateString('sv-SE'); // formato YYYY-MM-DD local
  return c.validade < hoje;
}

// ── Ativar / Desativar ─────────────────────────────────────
window.toggleAtivo = async function(id, novoEstado) {
  try {
    const { error } = await supabaseClient
      .from('cupons')
      .update({ ativo: novoEstado })
      .eq('id', id);

    if (error) throw error;

    const c = todosOsCupons.find(x => x.id === id);
    if (c) c.ativo = novoEstado;

    renderStats();
    renderTabela();
    showToast(novoEstado ? 'Cupom ativado ✓' : 'Cupom desativado ✓');
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
  }
};

// ── Editar ─────────────────────────────────────────────────
window.editarCupom = function(id) {
  const c = todosOsCupons.find(x => x.id === id);
  if (!c) return;

  document.getElementById('cupomModalTitle').textContent = 'Editar Cupom';
  document.getElementById('formCupomId').value    = c.id;
  document.getElementById('formCodigo').value     = c.codigo;
  document.getElementById('formDescricao').value  = c.descricao || '';
  document.getElementById('formTipo').value       = c.tipo;
  document.getElementById('formValor').value      = c.valor;
  document.getElementById('formMinimo').value     = c.valor_minimo || '';
  document.getElementById('formMaxUsos').value    = c.uso_maximo || '';
  document.getElementById('formValidade').value   = c.validade || '';
  document.getElementById('formAtivo').checked    = c.ativo;
  atualizarPrefixo();
  abrirModal();
};

// ── Excluir ────────────────────────────────────────────────
window.excluirCupom = async function(id, codigo) {
  if (!confirm(`Excluir o cupom "${codigo}" permanentemente? Esta ação não pode ser desfeita.`)) return;
  try {
    const { error } = await supabaseClient.from('cupons').delete().eq('id', id);
    if (error) throw error;
    todosOsCupons = todosOsCupons.filter(c => c.id !== id);
    renderStats();
    renderTabela();
    showToast('Cupom excluído.');
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
  }
};

// ── Salvar (criar ou editar) ───────────────────────────────
async function salvarCupom() {
  const id       = document.getElementById('formCupomId').value;
  const codigo   = document.getElementById('formCodigo').value.trim().toUpperCase().replace(/\s+/g, '');
  const desc     = document.getElementById('formDescricao').value.trim();
  const tipo     = document.getElementById('formTipo').value;
  const valor    = parseFloat(document.getElementById('formValor').value) || 0;
  const minimo   = parseFloat(document.getElementById('formMinimo').value) || 0;
  const maxUsos  = parseInt(document.getElementById('formMaxUsos').value)  || null;
  const validade = document.getElementById('formValidade').value || null;
  const ativo    = document.getElementById('formAtivo').checked;

  if (!codigo) { showToast('Informe o código do cupom.', 'error'); return; }
  if (tipo !== 'frete' && valor <= 0) { showToast('O valor do desconto deve ser maior que zero.', 'error'); return; }
  if (tipo === 'percentual' && valor > 100) { showToast('Desconto percentual não pode ultrapassar 100%.', 'error'); return; }

  const payload = { codigo, descricao: desc || null, tipo, valor, valor_minimo: minimo, uso_maximo: maxUsos, validade, ativo };

  try {
    const btnSalvar = document.getElementById('btnSalvarCupom');
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';

    let resp;
    if (id) {
      resp = await supabaseClient.from('cupons').update(payload).eq('id', id).select().single();
    } else {
      resp = await supabaseClient.from('cupons').insert(payload).select().single();
    }
    if (resp.error) throw resp.error;

    if (id) {
      const idx = todosOsCupons.findIndex(c => c.id === id);
      if (idx >= 0) todosOsCupons[idx] = resp.data;
    } else {
      todosOsCupons.unshift(resp.data);
    }

    renderStats();
    renderTabela();
    fecharModal();
    showToast(id ? 'Cupom atualizado ✓' : `Cupom "${codigo}" criado ✓`);
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
  } finally {
    const btn = document.getElementById('btnSalvarCupom');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Cupom'; }
  }
}

// ── Modal ──────────────────────────────────────────────────
function abrirModal() {
  document.getElementById('cupomModalOverlay')?.classList.add('open');
}
function fecharModal() {
  document.getElementById('cupomModalOverlay')?.classList.remove('open');
  resetModal();
}
function resetModal() {
  document.getElementById('cupomModalTitle').textContent = 'Novo Cupom';
  ['formCupomId','formCodigo','formDescricao','formValor','formMinimo','formMaxUsos','formValidade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('formTipo').value   = 'percentual';
  document.getElementById('formAtivo').checked = true;
  atualizarPrefixo();
}
function atualizarPrefixo() {
  const tipo = document.getElementById('formTipo')?.value;
  const prefix = document.getElementById('formValorPrefix');
  const valorRow = document.getElementById('formValor')?.closest('.admin-form-group');
  if (prefix) prefix.textContent = tipo === 'percentual' ? '%' : 'R$';
  // Para 'frete', esconde o campo de valor (não é necessário)
  if (valorRow) {
    valorRow.style.display = tipo === 'frete' ? 'none' : '';
    const input = document.getElementById('formValor');
    if (tipo === 'frete' && input) input.value = '0';
  }
}

// ── Bind de eventos ────────────────────────────────────────
function bindEventos() {
  document.getElementById('btnNovoCupom')?.addEventListener('click', () => {
    resetModal();
    abrirModal();
  });
  document.getElementById('btnModalClose')?.addEventListener('click', fecharModal);
  document.getElementById('btnModalCancelar')?.addEventListener('click', fecharModal);
  document.getElementById('cupomModalOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('cupomModalOverlay')) fecharModal();
  });
  document.getElementById('btnSalvarCupom')?.addEventListener('click', salvarCupom);
  document.getElementById('btnRecarregar')?.addEventListener('click', carregarCupons);
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  });

  // Tipo altera o prefixo e visibilidade do campo valor
  document.getElementById('formTipo')?.addEventListener('change', atualizarPrefixo);

  // Código em maiúsculas enquanto digita
  document.getElementById('formCodigo')?.addEventListener('input', function() {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
    this.setSelectionRange(pos, pos);
  });

  // Filtros
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroAtualCupons = btn.dataset.filter;
      renderTabela();
    });
  });
}

// ── Utilitários ────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setStatus(msg)   { const el = document.getElementById('adminStatus'); if (el) el.textContent = msg; }

function formatarData(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function showToast(msg, tipo = 'success') {
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    Object.assign(toast.style, {
      position:'fixed', bottom:'1.5rem', right:'1.5rem', padding:'0.75rem 1.25rem',
      borderRadius:'8px', fontFamily:"'Jost',sans-serif", fontSize:'0.85rem',
      zIndex:'9999', transition:'all 0.3s', maxWidth:'320px', lineHeight:'1.4'
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = tipo === 'error' ? '#c0392b' : '#27ae60';
  toast.style.color = '#fff';
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)'; }, 3000);
}
