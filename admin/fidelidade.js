/* ============================================================
   VIRTÙ Admin — Programa de Fidelidade
   Gerenciamento de config_fidelidade + premios_fidelidade
   ============================================================ */

const SUPABASE_URL  = 'https://oxivtnuxnghpddwawfdr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNzgxMzMsImV4cCI6MjA2NDc1NDEzM30.5hFVFhvJoHgMdZJK0etqbDFvnBY9OVlOmVDWHMdxahY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Utils ──────────────────────────────────────────────────────

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
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setMsg(el, text, tipo) {
  if (!el) return;
  el.textContent = text;
  el.className = `fid-msg fid-msg--${tipo}`;
}

// ── Auth guard ─────────────────────────────────────────────────

async function guardAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return false;
  }
  const userEl = document.getElementById('sidebarUser');
  if (userEl) userEl.textContent = session.user.email;
  return true;
}

// ── Carregar métricas ─────────────────────────────────────────

async function carregarMetricas() {
  try {
    // Total clientes com pelo menos 1 compra
    const { count: totalClientes } = await supabase
      .from('clientes_perfil')
      .select('id', { count: 'exact', head: true })
      .gt('compras_pagas', 0);

    // Prêmios
    const { data: premios } = await supabase
      .from('premios_fidelidade')
      .select('id, usado, expirado, expira_em');

    const ativos   = (premios || []).filter(p => !p.usado && !p.expirado && new Date(p.expira_em) > new Date()).length;
    const totalPr  = (premios || []).length;
    const usados   = (premios || []).filter(p => p.usado).length;
    const expirados= (premios || []).filter(p => p.expirado).length;

    // Valor total emitido: busca via cupons vinculados
    const { data: cfg } = await supabase
      .from('config_fidelidade')
      .select('valor_desconto')
      .eq('id', 1)
      .maybeSingle();

    const valorUnitario = Number(cfg?.valor_desconto ?? 100);
    const valorTotal    = valorUnitario * totalPr;

    document.getElementById('statTotal').textContent    = totalClientes ?? 0;
    document.getElementById('statPremios').textContent  = totalPr;
    document.getElementById('statPremiosSub').textContent = `${usados} usados · ${expirados} expirados`;
    document.getElementById('statAtivos').textContent   = ativos;
    document.getElementById('statValor').textContent    = fmtBRL(valorTotal);
  } catch (e) {
    console.error('[Fidelidade Métricas]', e);
  }
}

// ── Carregar configurações ────────────────────────────────────

async function carregarConfig() {
  const { data, error } = await supabase
    .from('config_fidelidade')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) { console.error('[Config] Erro:', error.message); return; }

  if (data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('cfgMeta',        data.meta_compras);
    set('cfgValor',       data.valor_desconto);
    set('cfgDias',        data.dias_expiracao);
    set('cfgEmailTitulo', data.msg_email_titulo || '');

    const ativoEl = document.getElementById('cfgAtivo');
    if (ativoEl) ativoEl.checked = data.ativo !== false;
    const ativoLabel = document.getElementById('cfgAtivoLabel');
    if (ativoLabel) ativoLabel.textContent = data.ativo !== false ? 'Ativo' : 'Desativado';

    const statusEl = document.getElementById('statusAtivo');
    if (statusEl) statusEl.textContent = data.ativo !== false ? '● Programa ativo' : '○ Programa desativado';
    if (statusEl) statusEl.style.color = data.ativo !== false ? '#065F46' : '#991B1B';
  }
}

// ── Salvar configurações ──────────────────────────────────────

document.getElementById('formConfig')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnSalvarConfig');
  const msg = document.getElementById('configMsg');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  msg.className = 'fid-msg';

  try {
    const meta  = parseInt(document.getElementById('cfgMeta')?.value || '10', 10);
    const valor = parseFloat(document.getElementById('cfgValor')?.value || '100');
    const dias  = parseInt(document.getElementById('cfgDias')?.value || '30', 10);
    const ativo = document.getElementById('cfgAtivo')?.checked ?? true;
    const titulo= document.getElementById('cfgEmailTitulo')?.value.trim() || null;

    if (!meta || meta < 1)  throw new Error('Meta de compras inválida.');
    if (!valor || valor < 1) throw new Error('Valor de desconto inválido.');
    if (!dias || dias < 1)   throw new Error('Dias de expiração inválidos.');

    const { error } = await supabase
      .from('config_fidelidade')
      .upsert({
        id:               1,
        meta_compras:     meta,
        valor_desconto:   valor,
        dias_expiracao:   dias,
        ativo,
        msg_email_titulo: titulo,
        atualizado_em:    new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) throw error;

    setMsg(msg, '✓ Configurações salvas com sucesso!', 'ok');
    await carregarMetricas(); // atualiza valor total
  } catch (err) {
    setMsg(msg, `Erro: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Configurações';
    setTimeout(() => msg.className = 'fid-msg', 4000);
  }
});

// Toggle label do checkbox ativo
document.getElementById('cfgAtivo')?.addEventListener('change', function () {
  const lbl = document.getElementById('cfgAtivoLabel');
  if (lbl) lbl.textContent = this.checked ? 'Ativo' : 'Desativado';
});

// ── Expirar prêmios manualmente ───────────────────────────────

document.getElementById('btnExpirarManual')?.addEventListener('click', async () => {
  if (!confirm('Executar fn_expirar_premios() agora?\n\nIsto vai expirar prêmios vencidos e zerar contadores das clientes afetadas.')) return;
  const btn = document.getElementById('btnExpirarManual');
  btn.disabled = true;
  btn.textContent = 'Executando…';
  try {
    const { data, error } = await supabase.rpc('fn_expirar_premios');
    if (error) throw error;
    alert(`✓ Concluído!\n${data?.expirados ?? 0} prêmio(s) expirado(s).`);
    await carregarMetricas();
    await carregarClientes();
    await carregarHistoricoPremios();
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Expirar agora';
  }
});

// ── Tabela de clientes em progresso ──────────────────────────

async function carregarClientes() {
  const tbody = document.getElementById('tblClientesBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:1.5rem">Carregando…</td></tr>';

  try {
    // Busca perfis com pelo menos 1 compra
    const { data: perfis, error: perfErr } = await supabase
      .from('clientes_perfil')
      .select('id, nome, compras_pagas, atualizado_em')
      .gt('compras_pagas', 0)
      .order('compras_pagas', { ascending: false })
      .limit(100);

    if (perfErr) throw perfErr;

    // Busca prêmios ativos para cruzar
    const { data: premiosAtivos } = await supabase
      .from('premios_fidelidade')
      .select('user_id, codigo, expira_em')
      .eq('usado', false)
      .eq('expirado', false)
      .gt('expira_em', new Date().toISOString());

    const premioMap = {};
    (premiosAtivos || []).forEach(p => { premioMap[p.user_id] = p; });

    // Lê configuração para meta
    const { data: cfg } = await supabase
      .from('config_fidelidade')
      .select('meta_compras')
      .eq('id', 1)
      .maybeSingle();
    const meta = cfg?.meta_compras ?? 10;

    if (!perfis?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:2rem">Nenhuma cliente no programa ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = perfis.map(p => {
      const progresso = p.compras_pagas % meta;
      const pct       = Math.min((progresso / meta) * 100, 100);
      const premio    = premioMap[p.id];
      const premioHtml = premio
        ? `<span style="font-family:'Courier New',monospace;font-size:0.78rem;color:#1e2e3e;font-weight:700">${escHtml(premio.codigo)}</span><br/><span style="font-size:0.67rem;color:#9e9690">Expira ${fmtData(premio.expira_em)}</span>`
        : '<span style="color:#aaa;font-size:0.78rem">—</span>';

      return `<tr>
        <td>
          <p style="margin:0;font-size:0.85rem;font-weight:500;color:#2b3f54">${escHtml(p.nome || 'Sem nome')}</p>
          <p style="margin:2px 0 0;font-size:0.7rem;color:#aaa">${p.id.slice(0, 8)}…</p>
        </td>
        <td style="font-size:0.88rem;color:#2b3f54;font-weight:500">${progresso} <span style="color:#aaa;font-weight:400">/ ${meta}</span></td>
        <td style="min-width:110px">
          <div class="fid-progress-bar">
            <div class="fid-progress-bar__fill" style="width:${pct}%"></div>
          </div>
          <span style="font-size:0.65rem;color:#aaa;margin-top:2px;display:block">${pct.toFixed(0)}%</span>
        </td>
        <td>${premioHtml}</td>
        <td style="font-size:0.82rem;color:#6e6660">${p.compras_pagas}</td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error('[Clientes]', err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#c62828;padding:1.5rem">Erro: ${escHtml(err.message)}</td></tr>`;
  }
}

// ── Tabela de histórico de prêmios ────────────────────────────

async function carregarHistoricoPremios() {
  const tbody = document.getElementById('tblPremiosBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:1.5rem">Carregando…</td></tr>';

  try {
    const { data: premios, error } = await supabase
      .from('premios_fidelidade')
      .select('id, codigo, user_id, gerado_em, expira_em, usado, expirado, ciclo')
      .order('gerado_em', { ascending: false })
      .limit(200);

    if (error) throw error;

    // Busca nomes dos usuários
    const userIds = [...new Set((premios || []).map(p => p.user_id))];
    let nomeMap = {};
    if (userIds.length) {
      const { data: perfis } = await supabase
        .from('clientes_perfil')
        .select('id, nome')
        .in('id', userIds);
      (perfis || []).forEach(p => { nomeMap[p.id] = p.nome || 'Sem nome'; });
    }

    if (!premios?.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:2rem">Nenhum prêmio emitido ainda.</td></tr>';
      return;
    }

    const statusBadge = (p) => {
      if (p.usado)    return '<span class="badge badge--usado">✓ Usado</span>';
      if (p.expirado || new Date(p.expira_em) < new Date())
                      return '<span class="badge badge--expirado">Expirado</span>';
      return '<span class="badge badge--ativo">● Ativo</span>';
    };

    tbody.innerHTML = premios.map(p => `
      <tr>
        <td style="font-family:'Courier New',monospace;font-size:0.8rem;font-weight:700;color:#1e2e3e">${escHtml(p.codigo)}</td>
        <td style="font-size:0.82rem;color:#4a4440">${escHtml(nomeMap[p.user_id] || '–')}</td>
        <td style="font-size:0.78rem;color:#6e6660">${fmtData(p.gerado_em)}</td>
        <td style="font-size:0.78rem;color:#6e6660">${fmtData(p.expira_em)}</td>
        <td>${statusBadge(p)}</td>
        <td style="font-size:0.78rem;color:#9e9690;text-align:center">${p.ciclo || 1}º</td>
      </tr>`).join('');

  } catch (err) {
    console.error('[Prêmios]', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#c62828;padding:1.5rem">Erro: ${escHtml(err.message)}</td></tr>`;
  }
}

// ── Init ──────────────────────────────────────────────────────

(async () => {
  const ok = await guardAuth();
  if (!ok) return;

  await Promise.all([
    carregarConfig(),
    carregarMetricas(),
    carregarClientes(),
    carregarHistoricoPremios(),
  ]);
})();
