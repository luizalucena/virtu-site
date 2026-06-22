/* ============================================================
   VIRTÙ Admin — Desconto Automático por Pedido
   Gerencia config_fidelidade (modo por-pedido: meta_compras = 0)
   ============================================================ */

const SUPABASE_URL  = 'https://oxivtnuxnghpddwawfdr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNzgxMzMsImV4cCI6MjA2NDc1NDEzM30.5hFVFhvJoHgMdZJK0etqbDFvnBY9OVlOmVDWHMdxahY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'America/Recife',
    });
  } catch { return String(iso).slice(0, 10); }
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setMsg(el, text, tipo) {
  if (!el) return;
  el.textContent = text;
  el.className = `fid-msg fid-msg--${tipo}`;
}

// ── Auth guard ────────────────────────────────────────────────

async function guardAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return false; }
  const userEl = document.getElementById('sidebarUser');
  if (userEl) userEl.textContent = session.user.email;
  return true;
}

// ── Carregar configuração ─────────────────────────────────────

async function carregarConfig() {
  const { data, error } = await supabase
    .from('config_fidelidade')
    .select('valor_minimo_premio, valor_desconto, ativo')
    .eq('id', 1)
    .single();

  if (error || !data) return;

  const minimo   = Number(data.valor_minimo_premio ?? 1000);
  const desconto = Number(data.valor_desconto ?? 100);
  const ativo    = data.ativo ?? true;

  // Preenche form
  const cfgMin = document.getElementById('cfgMinimo');
  const cfgVal = document.getElementById('cfgValor');
  const cfgAtivo = document.getElementById('cfgAtivo');
  const cfgAtivoLabel = document.getElementById('cfgAtivoLabel');
  if (cfgMin) cfgMin.value = minimo;
  if (cfgVal) cfgVal.value = desconto;
  if (cfgAtivo) cfgAtivo.checked = ativo;
  if (cfgAtivoLabel) cfgAtivoLabel.textContent = ativo ? 'Ativo' : 'Inativo';

  // Atualiza preview
  const prevDesc = document.getElementById('previewDesconto');
  const prevMin  = document.getElementById('previewMinimo');
  const prevStat = document.getElementById('previewStatus');
  if (prevDesc) prevDesc.textContent = desconto.toLocaleString('pt-BR');
  if (prevMin)  prevMin.textContent  = minimo.toLocaleString('pt-BR');
  if (prevStat) {
    prevStat.textContent = ativo ? 'Ativo' : 'Inativo';
    prevStat.style.color = ativo ? '#A8D5A2' : '#FCA5A5';
  }
}

// ── Salvar configuração ───────────────────────────────────────

async function salvarConfig(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSalvarConfig');
  const msgEl = document.getElementById('configMsg');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  const minimo   = parseFloat(document.getElementById('cfgMinimo')?.value || '1000');
  const desconto = parseFloat(document.getElementById('cfgValor')?.value || '100');
  const ativo    = document.getElementById('cfgAtivo')?.checked ?? true;

  if (isNaN(minimo) || minimo < 1 || isNaN(desconto) || desconto < 1) {
    setMsg(msgEl, 'Valores inválidos. Verifique os campos.', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Configuração'; }
    return;
  }

  const { error } = await supabase
    .from('config_fidelidade')
    .update({
      valor_minimo_premio: minimo,
      valor_desconto:      desconto,
      ativo,
      atualizado_em:       new Date().toISOString(),
    })
    .eq('id', 1);

  if (error) {
    setMsg(msgEl, 'Erro ao salvar: ' + error.message, 'err');
  } else {
    setMsg(msgEl, '✓ Configuração salva com sucesso!', 'ok');
    await carregarConfig();
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Salvar Configuração'; }
}

// ── Carregar métricas e pedidos ───────────────────────────────

async function carregarMetricas() {
  // Pedidos com desconto de fidelidade
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, criado_em, status, total, email_cliente, fidelidade_desconto')
    .eq('fidelidade_desconto', true)
    .order('criado_em', { ascending: false })
    .limit(100);

  if (error) { console.warn('[Admin Desconto]', error); return; }

  const todos = pedidos || [];
  const pagos = todos.filter(p => p.status === 'pago');

  // Busca o valor do desconto das configurações para calcular total descontado
  const { data: cfg } = await supabase
    .from('config_fidelidade')
    .select('valor_desconto')
    .eq('id', 1)
    .single();
  const desconto = Number(cfg?.valor_desconto ?? 100);

  const totalDescontado = pagos.length * desconto;

  // Pedidos últimos 30 dias
  const limite30 = new Date();
  limite30.setDate(limite30.getDate() - 30);
  const ultimos30 = pagos.filter(p => new Date(p.criado_em) >= limite30);

  // Atualiza métricas
  const elTotal  = document.getElementById('statTotal');
  const elValor  = document.getElementById('statValor');
  const el30d    = document.getElementById('stat30d');
  if (elTotal) elTotal.textContent = pagos.length;
  if (elValor) elValor.textContent = fmtBRL(totalDescontado);
  if (el30d)   el30d.textContent   = ultimos30.length;

  // Monta tabela
  const tbody = document.getElementById('tblPedidosBody');
  if (!tbody) return;

  if (!todos.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:2rem">Nenhum pedido com desconto automático ainda.</td></tr>';
    return;
  }

  const statusLabel = s => ({
    pago:     '<span style="background:#ECFDF5;color:#065F46;padding:2px 8px;border-radius:999px;font-size:0.68rem;font-weight:600">✓ Pago</span>',
    pendente: '<span style="background:#FEF9C3;color:#854D0E;padding:2px 8px;border-radius:999px;font-size:0.68rem;font-weight:600">⏳ Pendente</span>',
    recusado: '<span style="background:#FEF2F2;color:#991B1B;padding:2px 8px;border-radius:999px;font-size:0.68rem;font-weight:600">✕ Recusado</span>',
  }[s] || `<span style="font-size:0.68rem;color:#9E9690">${escHtml(s || '—')}</span>`);

  tbody.innerHTML = todos.slice(0, 50).map(p => `
    <tr>
      <td style="font-family:monospace;font-size:0.75rem;color:#6e6660">${escHtml(p.id?.slice(0,8) || '—')}…</td>
      <td style="color:#2b3f54">${escHtml(p.email_cliente || '—')}</td>
      <td style="color:#9e9690">${fmtData(p.criado_em)}</td>
      <td style="font-weight:500">${fmtBRL(p.total)}</td>
      <td style="color:#C4934A;font-weight:600">−${fmtBRL(desconto)}</td>
      <td>${statusLabel(p.status)}</td>
    </tr>
  `).join('');
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  if (!await guardAuth()) return;
  await carregarConfig();
  await carregarMetricas();

  document.getElementById('formConfig')?.addEventListener('submit', salvarConfig);
  document.getElementById('cfgAtivo')?.addEventListener('change', function () {
    const lbl = document.getElementById('cfgAtivoLabel');
    if (lbl) lbl.textContent = this.checked ? 'Ativo' : 'Inativo';
  });
});
