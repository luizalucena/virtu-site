/* ============================================================
   VIRTÙ — Módulo Bazar / Consignação (bazar.js)
   Depende: supabaseClient (js/supabase-config.js)
   ============================================================ */

// ── UTILITÁRIOS ───────────────────────────────────────────────
const fmtBRL = v =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toast(msg, tipo = 'success') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;max-width:360px;
    background:${tipo === 'error' ? '#fef2f2' : '#f0fdf4'};
    border:1px solid ${tipo === 'error' ? '#fecaca' : '#bbf7d0'};
    border-radius:8px;padding:12px 16px;font-size:13px;
    color:${tipo === 'error' ? '#c62828' : '#166534'};
    z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.12);
    display:flex;align-items:center;gap:10px;animation:slideIn .2s ease`;
  t.innerHTML = `<span>${tipo === 'error' ? '⚠️' : '✓'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ── ESTADO ───────────────────────────────────────────────────
let _todasPecas = [];
let _relatorioAtual = null;

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Proteção de login
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  });

  await carregarPecas();
  bindEventos();
  bindModal();
  iniciarRealtime();
});

// ── CARREGAR PEÇAS ────────────────────────────────────────────
async function carregarPecas() {
  const tbody = document.getElementById('bazarTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-light)">Carregando…</td></tr>`;

  try {
    const { data, error } = await supabaseClient
      .from('bazar_pecas')
      .select('*')
      .order('criado_em', { ascending: false });

    if (error) throw error;

    _todasPecas = data || [];
    renderTabela();
    calcularKPIs();
    document.getElementById('bazarCount').textContent = `${_todasPecas.length} peça(s)`;
  } catch (err) {
    console.error('[Bazar] carregarPecas:', err.message);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#c62828">Erro ao carregar: ${err.message}</td></tr>`;
    toast('Erro ao carregar peças: ' + err.message, 'error');
  }
}

// ── KPIs ──────────────────────────────────────────────────────
function calcularKPIs() {
  const vendidas    = _todasPecas.filter(p => p.status === 'vendido');
  const disponiveis = _todasPecas.filter(p => p.status === 'disponivel');
  // Somas com precisão numérica (evita ponto flutuante)
  const aPagar  = vendidas.reduce((s, p) => s + Math.round(Number(p.valor_consignataria) * 100), 0) / 100;
  const virtu   = vendidas.reduce((s, p) => s + Math.round(Number(p.valor_virtu) * 100), 0) / 100;

  document.getElementById('kpiTotal').textContent        = _todasPecas.length;
  document.getElementById('kpiDisponiveis').textContent  = disponiveis.length;
  document.getElementById('kpiVendidas').textContent     = vendidas.length;
  document.getElementById('kpiAPagar').textContent       = fmtBRL(aPagar);
  document.getElementById('kpiVirtu').textContent        = fmtBRL(virtu);
}

// ── RENDER TABELA ─────────────────────────────────────────────
function renderTabela() {
  const filtroNome   = document.getElementById('filtroConsignataria')?.value.toLowerCase().trim() || '';
  const filtroStatus = document.getElementById('filtroStatus')?.value || '';
  const filtroCat    = document.getElementById('filtroCategoria')?.value || '';

  const pecas = _todasPecas.filter(p => {
    if (filtroNome   && !p.consignataria.toLowerCase().includes(filtroNome) && !p.iniciais.toLowerCase().includes(filtroNome)) return false;
    if (filtroStatus && p.status !== filtroStatus) return false;
    if (filtroCat    && p.categoria !== filtroCat) return false;
    return true;
  });

  const tbody = document.getElementById('bazarTbody');

  if (!pecas.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2.5rem;color:var(--text-light)">Nenhuma peça encontrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = pecas.map(p => `
    <tr>
      <td><span class="bazar-sku">${p.sku}</span></td>
      <td>
        <strong style="display:block;font-size:0.85rem">${p.consignataria}</strong>
        <span style="font-size:0.72rem;color:var(--text-light)">${p.categoria}${p.tamanho ? ' · ' + p.tamanho : ''}${p.cor ? ' · ' + p.cor : ''}</span>
      </td>
      <td style="max-width:200px;word-break:break-word">${p.descricao}</td>
      <td style="font-weight:600;white-space:nowrap">${fmtBRL(p.preco_venda)}</td>
      <td>
        <div class="bazar-divisao">
          <span>Consig: <strong>${fmtBRL(p.valor_consignataria)}</strong></span>
          <span>Virtù: <strong>${fmtBRL(p.valor_virtu)}</strong></span>
        </div>
      </td>
      <td><span class="bazar-badge bazar-badge--${p.status}">${statusLabel(p.status)}</span></td>
      <td>
        <div class="bazar-actions">
          ${p.status === 'disponivel' ? `
            <button class="btn-bazar btn-bazar--sell" data-id="${p.id}" data-acao="vender" title="Marcar como vendido">Vender</button>
            <button class="btn-bazar btn-bazar--return" data-id="${p.id}" data-acao="devolver" title="Devolver à consignatária">Devolver</button>
          ` : ''}
          ${p.status === 'reservado' ? `
            <button class="btn-bazar btn-bazar--sell" data-id="${p.id}" data-acao="vender">Confirmar venda</button>
          ` : ''}
          <button class="btn-bazar" data-id="${p.id}" data-acao="editar" title="Editar peça">✎</button>
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', () => handleAcao(btn.dataset.acao, btn.dataset.id));
  });
}

function statusLabel(s) {
  return { disponivel: 'Disponível', vendido: 'Vendido', devolvido: 'Devolvido', reservado: 'Reservado' }[s] || s;
}

// ── AÇÕES NA TABELA ───────────────────────────────────────────
async function handleAcao(acao, id) {
  const peca = _todasPecas.find(p => p.id === id);
  if (!peca) return;

  if (acao === 'editar') {
    abrirModal(peca);
    return;
  }

  const novoStatus = acao === 'vender' ? 'vendido' : 'devolvido';
  const campo = acao === 'vender' ? { vendido_em: new Date().toISOString() } : { devolvido_em: new Date().toISOString() };

  if (!confirm(`Marcar "${peca.sku} — ${peca.descricao}" como ${novoStatus}?`)) return;

  try {
    const { error } = await supabaseClient
      .from('bazar_pecas')
      .update({ status: novoStatus, ...campo })
      .eq('id', id);

    if (error) throw error;

    // Atualiza cache local imediatamente
    const idx = _todasPecas.findIndex(p => p.id === id);
    if (idx !== -1) _todasPecas[idx] = { ..._todasPecas[idx], status: novoStatus, ...campo };

    renderTabela();
    calcularKPIs();
    toast(`Peça ${peca.sku} marcada como ${novoStatus}.`);
  } catch (err) {
    console.error('[Bazar] handleAcao:', err.message);
    toast('Erro: ' + err.message, 'error');
  }
}

// ── BIND EVENTOS ─────────────────────────────────────────────
function bindEventos() {
  document.getElementById('btnRecarregar')?.addEventListener('click', carregarPecas);
  document.getElementById('btnNovaPeca')?.addEventListener('click', () => abrirModal(null));

  ['filtroConsignataria', 'filtroStatus', 'filtroCategoria'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderTabela);
    document.getElementById(id)?.addEventListener('change', renderTabela);
  });

  document.getElementById('btnGerararRelatorio')?.addEventListener('click', gerarRelatorio);
  document.getElementById('btnExportarRelatorio')?.addEventListener('click', exportarRelatorioCSV);
}

// ── RELATÓRIO ─────────────────────────────────────────────────
async function gerarRelatorio() {
  const iniciais = document.getElementById('relIniciais')?.value.trim().toUpperCase();
  if (!iniciais) { toast('Informe as iniciais da consignatária.', 'error'); return; }

  const grid   = document.getElementById('relatorioGrid');
  const vazio  = document.getElementById('relatorioVazio');
  const btnExp = document.getElementById('btnExportarRelatorio');

  grid.style.display = 'none';
  vazio.style.display = 'none';
  btnExp.style.display = 'none';
  _relatorioAtual = null;

  try {
    const { data, error } = await supabaseClient
      .rpc('relatorio_bazar_consignataria', { p_iniciais: iniciais });

    if (error) throw error;

    const r = data?.[0];
    if (!r || Number(r.total_pecas) === 0) {
      vazio.style.display = 'block';
      return;
    }

    _relatorioAtual = { ...r, iniciais };
    btnExp.style.display = '';

    grid.innerHTML = `
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Consignatária</p>
        <p class="bazar-rel-item__value" style="font-size:1rem">${r.consignataria}</p>
      </div>
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Total de peças</p>
        <p class="bazar-rel-item__value">${r.total_pecas}</p>
      </div>
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Vendidas</p>
        <p class="bazar-rel-item__value">${r.pecas_vendidas}</p>
      </div>
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Disponíveis</p>
        <p class="bazar-rel-item__value">${r.pecas_disponiveis}</p>
      </div>
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Total em vendas</p>
        <p class="bazar-rel-item__value">${fmtBRL(r.total_vendas)}</p>
      </div>
      <div class="bazar-rel-item bazar-rel-item--destaque">
        <p class="bazar-rel-item__label">A pagar (60%)</p>
        <p class="bazar-rel-item__value">${fmtBRL(r.a_pagar)}</p>
      </div>
      <div class="bazar-rel-item">
        <p class="bazar-rel-item__label">Comissão Virtù (40%)</p>
        <p class="bazar-rel-item__value">${fmtBRL(r.comissao_virtu)}</p>
      </div>`;
    grid.style.display = 'grid';
  } catch (err) {
    console.error('[Bazar] gerarRelatorio:', err.message);
    toast('Erro ao gerar relatório: ' + err.message, 'error');
  }
}

function exportarRelatorioCSV() {
  if (!_relatorioAtual) return;
  const r = _relatorioAtual;
  const csv = [
    'Consignatária,Total Peças,Vendidas,Disponíveis,Total Vendas,A Pagar (60%),Comissão Virtù (40%)',
    `"${r.consignataria}",${r.total_pecas},${r.pecas_vendidas},${r.pecas_disponiveis},${r.total_vendas},${r.a_pagar},${r.comissao_virtu}`
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `bazar-relatorio-${r.iniciais}-${new Date().toLocaleDateString('sv-SE')}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════
// MODAL — NOVA / EDITAR PEÇA
// ══════════════════════════════════════════════════════════════

function abrirModal(peca = null) {
  const isEdicao = !!peca?.id;
  document.getElementById('bazarModalTitulo').textContent = isEdicao ? 'Editar Peça' : 'Nova Peça';
  document.getElementById('formPecaId').value         = peca?.id || '';
  document.getElementById('formConsignataria').value  = peca?.consignataria || '';
  document.getElementById('formIniciais').value       = peca?.iniciais || '';
  document.getElementById('formDescricao').value      = peca?.descricao || '';
  document.getElementById('formCategoria').value      = peca?.categoria || 'Roupa';
  document.getElementById('formTamanho').value        = peca?.tamanho || '';
  document.getElementById('formCor').value            = peca?.cor || '';
  document.getElementById('formPreco').value          = peca?.preco_venda || '';
  document.getElementById('formObservacao').value     = peca?.observacao || '';

  if (isEdicao) {
    // Edição: mostra SKU existente fixo
    document.getElementById('skuPreviewWrap').style.display = '';
    document.getElementById('skuPreview').textContent = peca.sku;
    // Iniciais não editáveis em modo edição (SKU fixo)
    document.getElementById('formIniciais').disabled = true;
  } else {
    document.getElementById('skuPreviewWrap').style.display = 'none';
    document.getElementById('skuPreview').textContent = '—';
    document.getElementById('formIniciais').disabled = false;
  }

  atualizarPreviewDivisao();
  document.getElementById('bazarModalOverlay').classList.add('open');
}

function fecharModal() {
  document.getElementById('bazarModalOverlay').classList.remove('open');
}

function atualizarPreviewDivisao() {
  const preco = parseFloat(document.getElementById('formPreco')?.value) || 0;
  const wrap  = document.getElementById('divisaoPreviewWrap');
  if (preco > 0) {
    // Arredondamento preciso: centavos inteiros
    const consig = Math.round(preco * 0.60 * 100) / 100;
    const virtu  = Math.round(preco * 0.40 * 100) / 100;
    document.getElementById('prevConsignataria').textContent = fmtBRL(consig);
    document.getElementById('prevVirtu').textContent         = fmtBRL(virtu);
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
  }
}

function bindModal() {
  document.getElementById('btnModalClose')   ?.addEventListener('click', fecharModal);
  document.getElementById('btnModalCancelar')?.addEventListener('click', fecharModal);
  document.getElementById('bazarModalOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('bazarModalOverlay')) fecharModal();
  });

  document.getElementById('formPreco')?.addEventListener('input', atualizarPreviewDivisao);

  // Preview do SKU em tempo real (só para nova peça)
  let _skuTimer = null;
  document.getElementById('formIniciais')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
    clearTimeout(_skuTimer);
    const iniciais = e.target.value.trim();
    if (iniciais.length < 2) {
      document.getElementById('skuPreviewWrap').style.display = 'none';
      return;
    }
    _skuTimer = setTimeout(async () => {
      try {
        const { data, error } = await supabaseClient
          .rpc('gerar_sku_bazar', { p_iniciais: iniciais });
        if (!error && data) {
          document.getElementById('skuPreview').textContent = data;
          document.getElementById('skuPreviewWrap').style.display = '';
        }
      } catch (_) { /* silencia */ }
    }, 400);
  });

  // Submit do formulário
  document.getElementById('btnSalvarPeca')?.addEventListener('click', salvarPeca);
}

async function salvarPeca() {
  const id           = document.getElementById('formPecaId').value;
  const consignataria = document.getElementById('formConsignataria').value.trim();
  const iniciais     = document.getElementById('formIniciais').value.trim().toUpperCase();
  const descricao    = document.getElementById('formDescricao').value.trim();
  const categoria    = document.getElementById('formCategoria').value;
  const tamanho      = document.getElementById('formTamanho').value.trim() || null;
  const cor          = document.getElementById('formCor').value.trim() || null;
  const precoRaw     = parseFloat(document.getElementById('formPreco').value);
  const observacao   = document.getElementById('formObservacao').value.trim() || null;

  // Validações
  if (!consignataria) { toast('Informe o nome da consignatária.', 'error'); return; }
  if (iniciais.length < 2) { toast('Iniciais devem ter ao menos 2 letras.', 'error'); return; }
  if (!descricao)     { toast('Informe a descrição da peça.', 'error'); return; }
  if (!precoRaw || precoRaw <= 0) { toast('Informe um preço válido.', 'error'); return; }

  // Arredonda para 2 casas (evita erros de ponto flutuante)
  const preco_venda = Math.round(precoRaw * 100) / 100;

  const btn = document.getElementById('btnSalvarPeca');
  btn.textContent = 'Salvando…'; btn.disabled = true;

  try {
    if (id) {
      // ── EDIÇÃO ──
      const { error } = await supabaseClient
        .from('bazar_pecas')
        .update({ consignataria, descricao, categoria, tamanho, cor, preco_venda, observacao })
        .eq('id', id);
      if (error) throw error;
      toast('Peça atualizada com sucesso.');
    } else {
      // ── INSERÇÃO: pede SKU ao banco (concurrency-safe) ──
      const { data: sku, error: skuErr } = await supabaseClient
        .rpc('gerar_sku_bazar', { p_iniciais: iniciais });
      if (skuErr) throw skuErr;

      const { error } = await supabaseClient
        .from('bazar_pecas')
        .insert({ sku, consignataria, iniciais, descricao, categoria, tamanho, cor, preco_venda, observacao });
      if (error) throw error;
      toast(`Peça ${sku} cadastrada!`);
    }

    fecharModal();
    await carregarPecas();
  } catch (err) {
    console.error('[Bazar] salvarPeca:', err.message);
    toast('Erro ao salvar: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Salvar Peça'; btn.disabled = false;
  }
}

// ── REALTIME ─────────────────────────────────────────────────
function iniciarRealtime() {
  try {
    supabaseClient
      .channel('bazar-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bazar_pecas' }, payload => {
        // Atualiza cache local sem reload completo
        if (payload.eventType === 'INSERT' && payload.new) {
          _todasPecas.unshift(payload.new);
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          const idx = _todasPecas.findIndex(p => p.id === payload.new.id);
          if (idx !== -1) _todasPecas[idx] = payload.new;
        } else if (payload.eventType === 'DELETE' && payload.old) {
          _todasPecas = _todasPecas.filter(p => p.id !== payload.old.id);
        }
        renderTabela();
        calcularKPIs();
      })
      .subscribe();
  } catch (err) {
    console.warn('[Bazar Realtime]', err.message);
  }
}
