/* ============================================================
   VIRTÙ — Módulo Financeiro (financeiro.js)
   Depende: supabaseClient (js/supabase-config.js)
   ============================================================ */

// ── CONSTANTES ────────────────────────────────────────────────
const PAGE_SIZE = 25;

// ── ESTADO ───────────────────────────────────────────────────
let _allRows   = [];   // cache local da página atual
let _page      = 1;
let _csvRows   = [];   // linhas parseadas do CSV antes de importar
let _csvHeaders= [];

// ── UTILITÁRIOS ───────────────────────────────────────────────
const fmt = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

function mesAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Hashing simples e determinístico para deduplicação de linhas CSV
function hashRow(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return 'csv_' + Math.abs(h).toString(36);
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Proteção de login (mesma do admin.js)
  const session = await supabaseClient.auth.getSession();
  if (!session?.data?.session) {
    window.location.href = 'index.html';
    return;
  }

  // Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  });

  // Filtro de mês padrão = mês atual
  document.getElementById('filtroMes').value = mesAtual();

  // Carrega dados
  await carregarKPIs();
  await carregarTabela();
  await popularCategorias();

  // Eventos dos filtros — recarrega tabela ao mudar
  ['filtroMes', 'filtroTipo', 'filtroOrigem', 'filtroCategoria'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { _page = 1; carregarTabela(); });
  });

  // Botões principais
  document.getElementById('btnNovoLancamento')?.addEventListener('click', abrirModalLancamento);
  document.getElementById('btnSyncPlanilha')?.addEventListener('click', abrirModalPlanilha);
  document.getElementById('btnExportarCSV')?.addEventListener('click', exportarCSV);

  // Bind modais
  bindModalLancamento();
  bindModalPlanilha();
});

// ── KPIs ──────────────────────────────────────────────────────
async function carregarKPIs() {
  const mes = document.getElementById('filtroMes')?.value || mesAtual();
  const [ano, m] = mes.split('-');
  const inicio = `${ano}-${m}-01`;
  const fim    = `${ano}-${m}-31`; // Supabase aceita além do mês, trata correto

  // Busca mês atual
  const { data: rows } = await supabaseClient
    .from('fluxo_caixa')
    .select('tipo, valor')
    .gte('data_lancamento', inicio)
    .lte('data_lancamento', fim);

  const entradas = (rows || []).filter(r => r.tipo === 'entrada');
  const saidas   = (rows || []).filter(r => r.tipo === 'saida');
  const totE = entradas.reduce((s, r) => s + Number(r.valor), 0);
  const totS = saidas  .reduce((s, r) => s + Number(r.valor), 0);
  const saldo = totE - totS;

  document.getElementById('kpiEntradas').textContent      = fmt(totE);
  document.getElementById('kpiEntradasCount').textContent = `${entradas.length} transação(ões)`;
  document.getElementById('kpiSaidas').textContent        = fmt(totS);
  document.getElementById('kpiSaidasCount').textContent   = `${saidas.length} transação(ões)`;

  const saldoEl = document.getElementById('kpiSaldo');
  saldoEl.textContent = fmt(Math.abs(saldo));
  saldoEl.className   = `fin-kpi__value ${saldo >= 0 ? 'fin-kpi__value--saldo-pos' : 'fin-kpi__value--saldo-neg'}`;

  // Saldo acumulado (todos os tempos)
  const { data: total } = await supabaseClient
    .from('fluxo_caixa')
    .select('tipo, valor');

  const totAcE = (total || []).filter(r => r.tipo === 'entrada').reduce((s, r) => s + Number(r.valor), 0);
  const totAcS = (total || []).filter(r => r.tipo === 'saida')  .reduce((s, r) => s + Number(r.valor), 0);
  const saldoAc = totAcE - totAcS;

  const saldoAcEl = document.getElementById('kpiSaldoTotal');
  saldoAcEl.textContent = fmt(Math.abs(saldoAc));
  saldoAcEl.className   = `fin-kpi__value ${saldoAc >= 0 ? 'fin-kpi__value--saldo-pos' : 'fin-kpi__value--saldo-neg'}`;
}

// ── TABELA ────────────────────────────────────────────────────
async function carregarTabela() {
  const tbody    = document.getElementById('fcTableBody');
  const countEl  = document.getElementById('fcCount');
  tbody.innerHTML = `<tr><td colspan="7" class="fin-empty">Carregando…</td></tr>`;

  // Monta filtros
  const mes     = document.getElementById('filtroMes')?.value;
  const tipo    = document.getElementById('filtroTipo')?.value;
  const origem  = document.getElementById('filtroOrigem')?.value;
  const categ   = document.getElementById('filtroCategoria')?.value;

  let query = supabaseClient
    .from('fluxo_caixa')
    .select('*', { count: 'exact' })
    .order('data_lancamento', { ascending: false })
    .order('criado_em',       { ascending: false });

  if (mes) {
    const [ano, m] = mes.split('-');
    query = query
      .gte('data_lancamento', `${ano}-${m}-01`)
      .lte('data_lancamento', `${ano}-${m}-31`);
  }
  if (tipo)   query = query.eq('tipo', tipo);
  if (origem) query = query.eq('origem', origem);
  if (categ)  query = query.eq('categoria', categ);

  // Paginação
  const from = (_page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data: rows, count, error } = await query;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="fin-empty" style="color:#c62828">Erro: ${error.message}</td></tr>`;
    return;
  }

  _allRows = rows || [];
  countEl.textContent = `${count ?? 0} registro(s)`;

  if (!_allRows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="fin-empty">Nenhum lançamento encontrado.</td></tr>`;
    renderPaginacao(0);
    return;
  }

  tbody.innerHTML = _allRows.map(r => `
    <tr>
      <td>${fmtDate(r.data_lancamento)}</td>
      <td><span class="fin-badge fin-badge--${r.tipo}">${r.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
      <td>${r.descricao}</td>
      <td>${r.categoria}</td>
      <td><span class="fin-badge fin-badge--${r.origem}">${r.origem}</span></td>
      <td style="text-align:right" class="fin-valor--${r.tipo}">${r.tipo === 'entrada' ? '+' : '−'} ${fmt(r.valor)}</td>
      <td>
        ${r.origem === 'manual' ? `
          <button class="fin-delete-btn" data-id="${r.id}" title="Excluir lançamento">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>` : ''}
      </td>
    </tr>`).join('');

  // Eventos de exclusão
  tbody.querySelectorAll('.fin-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => excluirLancamento(btn.dataset.id));
  });

  renderPaginacao(count ?? 0);
}

function renderPaginacao(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pag = document.getElementById('fcPagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  pag.innerHTML = `
    <button id="pgPrev" ${_page <= 1 ? 'disabled' : ''}>← Anterior</button>
    <span>Página ${_page} de ${totalPages}</span>
    <button id="pgNext" ${_page >= totalPages ? 'disabled' : ''}>Próxima →</button>
  `;
  pag.querySelector('#pgPrev')?.addEventListener('click', () => { _page--; carregarTabela(); });
  pag.querySelector('#pgNext')?.addEventListener('click', () => { _page++; carregarTabela(); });
}

// ── CATEGORIAS (filtro dinâmico) ──────────────────────────────
async function popularCategorias() {
  const { data } = await supabaseClient
    .from('fluxo_caixa')
    .select('categoria');

  const cats = [...new Set((data || []).map(r => r.categoria))].sort();
  const sel  = document.getElementById('filtroCategoria');
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
}

// ── EXCLUSÃO ─────────────────────────────────────────────────
async function excluirLancamento(id) {
  if (!confirm('Excluir este lançamento manual?')) return;
  const { error } = await supabaseClient.from('fluxo_caixa').delete().eq('id', id);
  if (error) { alert('Erro ao excluir: ' + error.message); return; }
  await carregarKPIs();
  await carregarTabela();
}

// ── EXPORTAR CSV ─────────────────────────────────────────────
function exportarCSV() {
  if (!_allRows.length) { alert('Nenhum dado para exportar.'); return; }
  const header = 'Data,Tipo,Descrição,Categoria,Origem,Valor';
  const linhas = _allRows.map(r =>
    `"${fmtDate(r.data_lancamento)}","${r.tipo}","${r.descricao}","${r.categoria}","${r.origem}","${r.valor}"`
  );
  const csv  = [header, ...linhas].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `virtu-fluxo-${mesAtual()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════
// MODAL — NOVO LANÇAMENTO MANUAL
// ══════════════════════════════════════════════════════════════
function abrirModalLancamento() {
  document.getElementById('lData').value = new Date().toISOString().slice(0, 10);
  document.getElementById('formLancamento').reset();
  document.getElementById('lData').value = new Date().toISOString().slice(0, 10);
  document.getElementById('modalLancamento').classList.add('open');
}

function fecharModalLancamento() {
  document.getElementById('modalLancamento').classList.remove('open');
}

function bindModalLancamento() {
  document.getElementById('closeLancamento')  ?.addEventListener('click', fecharModalLancamento);
  document.getElementById('cancelLancamento') ?.addEventListener('click', fecharModalLancamento);
  document.getElementById('modalLancamento')  ?.addEventListener('click', e => {
    if (e.target === document.getElementById('modalLancamento')) fecharModalLancamento();
  });

  document.getElementById('formLancamento')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('submitLancamento');

    const tipo      = document.getElementById('lTipo').value;
    const valor     = parseFloat(document.getElementById('lValor').value);
    const descricao = document.getElementById('lDescricao').value.trim();
    const categoria = document.getElementById('lCategoria').value;
    const data      = document.getElementById('lData').value;

    if (!tipo || !valor || !descricao || !categoria || !data) {
      alert('Preencha todos os campos obrigatórios.'); return;
    }

    btn.textContent = 'Salvando…'; btn.disabled = true;

    const { error } = await supabaseClient.from('fluxo_caixa').insert({
      tipo, valor, descricao, categoria,
      data_lancamento: data,
      origem: 'manual',
      fonte_id: null   // lançamentos manuais não usam deduplicação
    });

    btn.textContent = 'Salvar Lançamento'; btn.disabled = false;

    if (error) { alert('Erro: ' + error.message); return; }

    fecharModalLancamento();
    await carregarKPIs();
    await carregarTabela();
  });
}

// ══════════════════════════════════════════════════════════════
// MODAL — SINCRONIZAR PLANILHA (CSV)
// ══════════════════════════════════════════════════════════════
function abrirModalPlanilha() {
  irParaStep(1);
  document.getElementById('csvFile').value = '';
  document.getElementById('csvUrl').value  = '';
  document.getElementById('modalPlanilha').classList.add('open');
}

function fecharModalPlanilha() {
  document.getElementById('modalPlanilha').classList.remove('open');
}

function irParaStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`planStep${i}`);
    if (el) el.hidden = (i !== n);
  });
}

function bindModalPlanilha() {
  document.getElementById('closePlanilha')  ?.addEventListener('click', fecharModalPlanilha);
  document.getElementById('cancelPlanilha') ?.addEventListener('click', fecharModalPlanilha);
  document.getElementById('btnFecharResultado')?.addEventListener('click', () => {
    fecharModalPlanilha();
    carregarKPIs();
    carregarTabela();
  });
  document.getElementById('btnVoltarStep1')?.addEventListener('click', () => irParaStep(1));
  document.getElementById('modalPlanilha') ?.addEventListener('click', e => {
    if (e.target === document.getElementById('modalPlanilha')) fecharModalPlanilha();
  });
  document.getElementById('btnSyncPlanilha')?.addEventListener('click', abrirModalPlanilha);
  document.getElementById('btnPreviewCSV') ?.addEventListener('click', carregarCSV);
  document.getElementById('btnImportarCSV')?.addEventListener('click', importarCSV);
}

// ── PARSE CSV ─────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  // Detecta separador (vírgula ou ponto-e-vírgula)
  const sep = lines[0].includes(';') ? ';' : ',';

  function parseLine(line) {
    const result = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === sep && !inQ) { result.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]);
  const rows    = lines.slice(1).filter(l => l.trim()).map(parseLine);
  return { headers, rows };
}

async function carregarCSV() {
  const fileInput = document.getElementById('csvFile');
  const urlInput  = document.getElementById('csvUrl').value.trim();
  let text = '';

  if (fileInput.files.length > 0) {
    // Upload direto
    text = await fileInput.files[0].text();
  } else if (urlInput) {
    // Busca URL pública (precisa ser CORS-acessível)
    try {
      const res = await fetch(urlInput);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      alert('Não foi possível buscar a planilha. Certifique-se de que ela está pública e use o link de exportação CSV direto.\n\n' + err.message);
      return;
    }
  } else {
    alert('Selecione um arquivo CSV ou informe uma URL.');
    return;
  }

  const parsed = parseCSV(text);
  if (!parsed.headers.length || !parsed.rows.length) {
    alert('O arquivo não parece ser um CSV válido ou está vazio.');
    return;
  }

  _csvHeaders = parsed.headers;
  _csvRows    = parsed.rows;

  renderMapeamento();
  renderPreviewCSV();
  irParaStep(2);
}

// ── MAPEAMENTO DE COLUNAS ─────────────────────────────────────
const CAMPOS = [
  { id: 'mapData',      label: 'Data',      required: true },
  { id: 'mapTipo',      label: 'Tipo (entrada/saída)', required: true },
  { id: 'mapValor',     label: 'Valor',     required: true },
  { id: 'mapDescricao', label: 'Descrição', required: true },
  { id: 'mapCategoria', label: 'Categoria', required: false },
];

function renderMapeamento() {
  const grid = document.getElementById('colMapGrid');
  grid.innerHTML = CAMPOS.map(f => `
    <div>
      <label class="fin-label">${f.label}${f.required ? ' *' : ''}</label>
      <select class="fin-select" id="${f.id}">
        ${f.required ? '' : '<option value="">— ignorar —</option>'}
        ${_csvHeaders.map((h, i) => `<option value="${i}">${h}</option>`).join('')}
      </select>
    </div>`).join('');

  // Tenta auto-mapear por nome de coluna (case-insensitive)
  const autoMap = {
    mapData:      ['data', 'date', 'data_lancamento', 'dt'],
    mapTipo:      ['tipo', 'type', 'entrada/saida', 'entrada_saida'],
    mapValor:     ['valor', 'value', 'amount', 'quantia', 'vl'],
    mapDescricao: ['descricao', 'descrição', 'description', 'desc', 'historico', 'histórico'],
    mapCategoria: ['categoria', 'category', 'cat'],
  };

  Object.entries(autoMap).forEach(([selectId, aliases]) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    _csvHeaders.forEach((h, i) => {
      if (aliases.includes(h.toLowerCase().trim())) sel.value = i;
    });
  });
}

function renderPreviewCSV() {
  const preview  = document.getElementById('csvPreviewTable');
  const infoEl   = document.getElementById('csvInfo');
  const max5rows = _csvRows.slice(0, 5);

  preview.innerHTML = `
    <table>
      <thead><tr>${_csvHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${max5rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

  infoEl.textContent = `${_csvRows.length} linha(s) detectada(s). Exibindo as 5 primeiras.`;
}

// ── NORMALIZA VALOR DA PLANILHA ───────────────────────────────
function normalizarValor(str) {
  if (!str) return NaN;
  // Remove R$, espaços, converte vírgula decimal
  const clean = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
}

// ── NORMALIZA DATA DA PLANILHA ────────────────────────────────
function normalizarData(str) {
  if (!str) return null;
  str = str.trim();
  // DD/MM/AAAA → AAAA-MM-DD
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // AAAA-MM-DD (já no formato certo)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return null;
}

// ── NORMALIZA TIPO ────────────────────────────────────────────
function normalizarTipo(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['entrada', 'receita', 'credito', 'credit', 'in', '+'].includes(s)) return 'entrada';
  if (['saida', 'gasto', 'despesa', 'debito', 'debit', 'out', '-'].includes(s))  return 'saida';
  return null;
}

// ── IMPORTAR CSV → SUPABASE ───────────────────────────────────
async function importarCSV() {
  const colData  = parseInt(document.getElementById('mapData').value);
  const colTipo  = parseInt(document.getElementById('mapTipo').value);
  const colValor = parseInt(document.getElementById('mapValor').value);
  const colDesc  = parseInt(document.getElementById('mapDescricao').value);
  const colCat   = document.getElementById('mapCategoria').value;

  if ([colData, colTipo, colValor, colDesc].some(isNaN)) {
    alert('Mapeie os campos obrigatórios antes de importar.'); return;
  }

  const btn = document.getElementById('btnImportarCSV');
  btn.textContent = 'Importando…'; btn.disabled = true;

  const registros = [];
  const erros     = [];

  _csvRows.forEach((row, idx) => {
    const dataStr  = row[colData]  || '';
    const tipoStr  = row[colTipo]  || '';
    const valorStr = row[colValor] || '';
    const descStr  = row[colDesc]  || '';
    const catStr   = colCat !== '' ? (row[parseInt(colCat)] || 'Outros') : 'Outros';

    const data  = normalizarData(dataStr);
    const tipo  = normalizarTipo(tipoStr);
    const valor = normalizarValor(valorStr);
    const desc  = descStr.trim();

    if (!data || !tipo || isNaN(valor) || valor <= 0 || !desc) {
      erros.push(`Linha ${idx + 2}: dado inválido (data="${dataStr}", tipo="${tipoStr}", valor="${valorStr}")`);
      return;
    }

    // Chave determinística de deduplicação
    const fonteId = hashRow(`${data}|${tipo}|${valor}|${desc}`);

    registros.push({
      tipo,
      valor,
      descricao:       desc,
      categoria:       catStr.trim() || 'Outros',
      data_lancamento: data,
      origem:          'planilha',
      fonte_id:        fonteId,
    });
  });

  if (!registros.length) {
    btn.textContent = 'Importar registros →'; btn.disabled = false;
    alert('Nenhum registro válido encontrado.\n\n' + erros.slice(0, 5).join('\n'));
    return;
  }

  // Upsert em lotes de 100 (evita timeout)
  let inseridos = 0;
  const BATCH = 100;
  for (let i = 0; i < registros.length; i += BATCH) {
    const lote = registros.slice(i, i + BATCH);
    const { error } = await supabaseClient
      .from('fluxo_caixa')
      .upsert(lote, { onConflict: 'origem,fonte_id', ignoreDuplicates: true });
    if (error) { console.error('[importar]', error); erros.push(error.message); break; }
    inseridos += lote.length;
  }

  btn.textContent = 'Importar registros →'; btn.disabled = false;

  // Resultado
  document.getElementById('csvResultMsg').textContent =
    `${inseridos} registro(s) processado(s)`;
  document.getElementById('csvResultSub').textContent =
    erros.length
      ? `${erros.length} linha(s) ignorada(s) por dados inválidos ou já existentes.`
      : 'Nenhum erro. Duplicatas foram ignoradas automaticamente.';

  irParaStep(3);
}
