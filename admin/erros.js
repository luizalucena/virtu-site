/* ============================================================
   VIRTÙ Admin — Erros em Produção
   Lê a tabela logs_erros do Supabase e exibe com filtros.
   ============================================================ */

const SUPABASE_URL  = 'https://oxivtnuxnghpddwawfdr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNzgxMzMsImV4cCI6MjA2NDc1NDEzM30.5hFVFhvJoHgMdZJK0etqbDFvnBY9OVlOmVDWHMdxahY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let _todosLogs = [];

function fmtData(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Recife',
    });
  } catch { return String(iso).slice(0, 16); }
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Auth guard ────────────────────────────────────────────────

async function guardAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return false; }
  const el = document.getElementById('sidebarUser');
  if (el) el.textContent = session.user.email;
  return true;
}

// ── Carrega logs do Supabase ──────────────────────────────────

async function carregarLogs() {
  const body = document.getElementById('errosBody');
  if (body) body.innerHTML = '<tr><td colspan="5" class="err-empty">Carregando…</td></tr>';

  const { data, error } = await supabase
    .from('logs_erros')
    .select('id, tipo, mensagem, stack, pagina, linha, coluna, criado_em, user_agent')
    .order('criado_em', { ascending: false })
    .limit(500);

  if (error) {
    if (body) body.innerHTML = `<tr><td colspan="5" class="err-empty" style="color:#991B1B">Erro ao carregar logs: ${escHtml(error.message)}</td></tr>`;
    return;
  }

  _todosLogs = data || [];
  popularFiltroPagina(_todosLogs);
  aplicarFiltros();
}

// ── Popula select de páginas ──────────────────────────────────

function popularFiltroPagina(logs) {
  const sel = document.getElementById('filtroPagina');
  if (!sel) return;
  const paginas = [...new Set(logs.map(l => l.pagina).filter(Boolean))].sort();
  // Mantém apenas o <option> inicial
  sel.innerHTML = '<option value="">Todas as páginas</option>';
  paginas.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
}

// ── Aplica filtros e renderiza ────────────────────────────────

function aplicarFiltros() {
  const tipo   = document.getElementById('filtroTipo')?.value   || '';
  const pagina = document.getElementById('filtroPagina')?.value || '';
  const data   = document.getElementById('filtroData')?.value   || '';

  let lista = [..._todosLogs];
  if (tipo)   lista = lista.filter(l => l.tipo === tipo);
  if (pagina) lista = lista.filter(l => l.pagina === pagina);
  if (data)   lista = lista.filter(l => l.criado_em && l.criado_em.startsWith(data));

  renderTabela(lista);
  renderMetricas(lista);
}

// ── Renderiza métricas ────────────────────────────────────────

function renderMetricas(lista) {
  const agora    = new Date();
  const h24      = new Date(agora - 86400000);
  const logs24   = lista.filter(l => new Date(l.criado_em) >= h24);
  const jsErrors = lista.filter(l => l.tipo === 'js_error' || l.tipo === 'promise_rejection');
  const checkout = lista.filter(l => l.mensagem && l.mensagem.toLowerCase().includes('checkout'));
  const paginas  = new Set(lista.map(l => l.pagina).filter(Boolean));

  const el = id => document.getElementById(id);
  if (el('stat24h'))     el('stat24h').textContent     = logs24.length;
  if (el('statJs'))      el('statJs').textContent      = jsErrors.length;
  if (el('statCheckout')) el('statCheckout').textContent = checkout.length;
  if (el('statPaginas')) el('statPaginas').textContent = paginas.size;
}

// ── Renderiza tabela ──────────────────────────────────────────

function renderTabela(lista) {
  const tbody = document.getElementById('errosBody');
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="err-empty">Nenhum erro encontrado para os filtros selecionados.</td></tr>';
    return;
  }

  const tipoBadge = t => {
    const map = {
      js_error:          ['JS Error', 'js_error'],
      promise_rejection: ['Promise', 'promise_rejection'],
      capturado:         ['Capturado', 'capturado'],
    };
    const [label, cls] = map[t] || [t || '?', 'outro'];
    return `<span class="err-badge err-badge--${cls}">${escHtml(label)}</span>`;
  };

  tbody.innerHTML = lista.map(l => {
    const temStack = !!(l.stack && l.stack.trim());
    const msgEl = temStack
      ? `<span class="err-mensagem" title="${escHtml(l.mensagem)}" data-id="${escHtml(l.id)}" data-msg="${escHtml(l.mensagem)}" data-stack="${escHtml(l.stack || '')}">${escHtml((l.mensagem || '').slice(0, 120))}</span>`
      : `<span class="err-mensagem" title="${escHtml(l.mensagem)}">${escHtml((l.mensagem || '').slice(0, 120))}</span>`;

    return `<tr>
      <td>${tipoBadge(l.tipo)}</td>
      <td>${msgEl}</td>
      <td><span class="err-pagina" title="${escHtml(l.pagina)}">${escHtml(l.pagina || '—')}</span></td>
      <td style="white-space:nowrap;color:#9e9690;font-size:0.72rem">${fmtData(l.criado_em)}</td>
      <td style="color:#9e9690;font-size:0.72rem">${l.linha ? `L${l.linha}:C${l.coluna || 0}` : '—'}</td>
    </tr>`;
  }).join('');

  // Eventos de click para abrir modal de stack trace
  tbody.querySelectorAll('[data-stack]').forEach(el => {
    el.addEventListener('click', () => abrirStack(el.dataset.msg, el.dataset.stack));
  });
}

// ── Modal de stack trace ──────────────────────────────────────

function abrirStack(msg, stack) {
  const modal   = document.getElementById('stackModal');
  const titulo  = document.getElementById('stackTitulo');
  const conteudo = document.getElementById('stackConteudo');
  if (!modal) return;
  if (titulo)   titulo.textContent  = msg;
  if (conteudo) conteudo.textContent = stack || '(sem stack trace)';
  modal.classList.add('open');
}

// ── Limpar todos os logs ──────────────────────────────────────

async function limparLogs() {
  if (!confirm('Apagar TODOS os logs de erros? Esta ação não pode ser desfeita.')) return;
  const { error } = await supabase
    .from('logs_erros')
    .delete()
    .gte('id', '00000000-0000-0000-0000-000000000000'); // deleta tudo (RLS de admin necessário)
  if (error) {
    alert('Erro ao limpar: ' + error.message);
  } else {
    _todosLogs = [];
    aplicarFiltros();
  }
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  if (!await guardAuth()) return;
  await carregarLogs();

  document.getElementById('filtroTipo')   ?.addEventListener('change', aplicarFiltros);
  document.getElementById('filtroPagina') ?.addEventListener('change', aplicarFiltros);
  document.getElementById('filtroData')   ?.addEventListener('change', aplicarFiltros);
  document.getElementById('btnRefresh')   ?.addEventListener('click',  carregarLogs);
  document.getElementById('btnLimpar')    ?.addEventListener('click',  limparLogs);
  document.getElementById('stackClose')   ?.addEventListener('click', () => {
    document.getElementById('stackModal')?.classList.remove('open');
  });
  document.getElementById('stackModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });
});
