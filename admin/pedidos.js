/* ============================================================
   VIRTÙ Admin — Pedidos
   Ver, filtrar, atualizar status e código de rastreio
   ============================================================ */

(function () {
  'use strict';

  const PAGE_SIZE = 12;
  let _page = 1;
  let _filtroStatus = '';
  let _filtroBusca  = '';
  let _totalRows    = 0;

  const STATUS_LABELS = {
    pendente:   'Pendente',
    confirmado: 'Confirmado',
    pago:       'Pago',
    enviado:    'Enviado',
    entregue:   'Entregue',
    cancelado:  'Cancelado',
    recusado:   'Recusado',
  };

  const STATUS_COLORS = {
    pendente:   '#f59e0b',
    confirmado: '#14b8a6',
    pago:       '#22c55e',
    enviado:    '#3b82f6',
    entregue:   '#15803d',
    cancelado:  '#ef4444',
    recusado:   '#ef4444',
  };

  function fmt(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Número humano do pedido: WV + sequencial (WV1004). Fallback para
  // pedidos antigos sem numero_pedido (não deve ocorrer — backfill feito).
  function numeroWV(p) {
    return p && p.numero_pedido
      ? `WV${p.numero_pedido}`
      : `WV${String(p?.id ?? '').slice(-6).toUpperCase()}`;
  }

  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function statusBadge(status) {
    const color = STATUS_COLORS[status] || '#888';
    const label = STATUS_LABELS[status] || status;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>`;
  }

  function metodoPagto(p) {
    if (p.payment_method === 'pix')    return 'PIX';
    if (p.payment_method === 'cartao') return 'Cartão';
    if (p.payment_method === 'debito') return 'Débito';
    return p.payment_method || '—';
  }

  async function carregarKPIs() {
    try {
      const { data, error } = await supabaseClient.from('pedidos').select('status');
      if (error) throw error;
      if (!data) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('kpiPedidosTotal',    data.length);
      set('kpiPedidosPendente', data.filter(r => r.status === 'pendente').length);
      set('kpiPedidosPago',     data.filter(r => r.status === 'pago').length);
      set('kpiPedidosEnviado',  data.filter(r => r.status === 'enviado' || r.status === 'entregue').length);
    } catch (err) {
      console.error('[Pedidos KPIs]', err.message);
    }
  }

  async function carregarPedidos() {
    const tbody = document.getElementById('pedidosTbody');
    const paginacao = document.getElementById('pedidosPaginacao');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#888">Carregando…</td></tr>';

    try {
      let query = supabaseClient
        .from('pedidos')
        .select('id,numero_pedido,nome_cliente,email_cliente,status,payment_method,total,criado_em,codigo_rastreio', { count: 'exact' })
        .order('criado_em', { ascending: false })
        .range((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE - 1);

      if (_filtroStatus) query = query.eq('status', _filtroStatus);
      if (_filtroBusca)  query = query.or(`nome_cliente.ilike.%${_filtroBusca}%,email_cliente.ilike.%${_filtroBusca}%`);

      const { data, count, error } = await query;
      _totalRows = count || 0;

      if (error) throw error;

      if (!data?.length) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#888">Nenhum pedido encontrado.</td></tr>';
        if (paginacao) paginacao.innerHTML = '';
        return;
      }

    if (tbody) {
      tbody.innerHTML = data.map(p => `
        <tr style="cursor:pointer;transition:background .15s" onmouseover="this.style.background='#faf9f7'" onmouseout="this.style.background=''" onclick="window._pedidosAbrirModal('${escHtml(p.id)}')">
          <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1A2744">${escHtml(numeroWV(p))}</td>
          <td style="padding:10px 12px;font-size:13px">${escHtml(p.nome_cliente) || '—'}</td>
          <td style="padding:10px 12px;font-size:13px;color:#666">${escHtml(p.email_cliente) || '—'}</td>
          <td style="padding:10px 12px">${statusBadge(p.status)}</td>
          <td style="padding:10px 12px;font-size:12px;color:#888">${metodoPagto(p)}</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#C4934A">${fmt(p.total)}</td>
          <td style="padding:10px 12px;font-size:12px;color:#999">${fmtDate(p.criado_em)}</td>
        </tr>`).join('');
    }

    const totalPages = Math.ceil(_totalRows / PAGE_SIZE);
    if (paginacao) {
      if (totalPages <= 1) { paginacao.innerHTML = ''; return; }
      let html = `<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:16px">`;
      html += `<button onclick="window._pedidosPagina(${_page - 1})" ${_page === 1 ? 'disabled' : ''} style="padding:6px 12px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">‹</button>`;
      for (let i = 1; i <= totalPages; i++) {
        const active = i === _page;
        html += `<button onclick="window._pedidosPagina(${i})" style="padding:6px 12px;border:1px solid ${active ? '#1A2744' : '#ddd'};border-radius:4px;background:${active ? '#1A2744' : '#fff'};color:${active ? '#fff' : '#333'};cursor:pointer;font-size:13px">${i}</button>`;
      }
      html += `<button onclick="window._pedidosPagina(${_page + 1})" ${_page >= totalPages ? 'disabled' : ''} style="padding:6px 12px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">›</button></div>`;
      paginacao.innerHTML = html;
    }
    } catch (err) {
      console.error('[Pedidos carregarPedidos]', err.message);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#c62828">
        ⚠️ Erro ao carregar pedidos: ${err.message}<br>
        <button onclick="carregarPedidos && carregarPedidos()" style="margin-top:8px;padding:6px 14px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">Tentar novamente</button>
      </td></tr>`;
    }
  }

  window._pedidosPagina = function (n) {
    const totalPages = Math.ceil(_totalRows / PAGE_SIZE);
    if (n < 1 || n > totalPages) return;
    _page = n;
    carregarPedidos();
  };

  window._pedidosAbrirModal = async function (id) {
    const overlay = document.getElementById('pedidoModalOverlay');
    const body    = document.getElementById('pedidoModalBody');
    if (!overlay || !body) return;
    body.innerHTML = '<p style="text-align:center;padding:32px;color:#888">Carregando…</p>';
    overlay.style.display = 'flex';

    try {
      const { data: p, error } = await supabaseClient.from('pedidos').select('*').eq('id', id).single();
      if (error || !p) { body.innerHTML = '<p style="color:#ef4444;padding:16px">Erro ao carregar pedido.</p>'; return; }

      const itens = Array.isArray(p.itens) ? p.itens : [];
      const itensHtml = itens.length
        ? itens.map(it => `<tr><td style="padding:6px 8px">${escHtml(it.nome||'—')}</td><td style="padding:6px 8px;text-align:center">${escHtml(it.tamanho||'—')}</td><td style="padding:6px 8px;text-align:center">${it.qty||1}</td><td style="padding:6px 8px;text-align:right">${fmt(it.preco)}</td></tr>`).join('')
        : '<tr><td colspan="4" style="padding:8px;color:#888">Sem itens registrados</td></tr>';

      const statusOptions = Object.keys(STATUS_LABELS).map(s => `<option value="${s}" ${p.status===s?'selected':''}>${STATUS_LABELS[s]}</option>`).join('');
      const pidSafe = escHtml(p.id);

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div>
            <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Pedido</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:#1A2744">${escHtml(numeroWV(p))}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#999">${fmtDate(p.criado_em)}</p>
          </div>
          <div style="text-align:right">${statusBadge(p.status)}<p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#C4934A">${fmt(p.total)}</p><p style="margin:2px 0 0;font-size:12px;color:#888">${p.payment_method==='cartao'&&p.parcelas>1?`Cartão ${p.parcelas}x`:metodoPagto(p)}</p></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:13px">
          <div><p style="margin:0 0 2px;color:#888;font-size:11px;text-transform:uppercase">Cliente</p><p style="margin:0;font-weight:500">${escHtml(p.nome_cliente)||'—'}</p><p style="margin:2px 0 0;color:#666">${escHtml(p.email_cliente)||'—'}</p><p style="margin:2px 0 0;color:#666">${escHtml(p.telefone)||'—'}</p></div>
          <div><p style="margin:0 0 2px;color:#888;font-size:11px;text-transform:uppercase">Endereço</p><p style="margin:0;color:#333">${escHtml(p.rua||'')}, ${escHtml(p.numero||'')}${p.complemento?', '+escHtml(p.complemento):''}</p><p style="margin:2px 0 0;color:#666">${escHtml(p.bairro||'')} — ${escHtml(p.cidade||'')}/${escHtml(p.estado||'')}</p><p style="margin:2px 0 0;color:#666">CEP ${escHtml(p.cep||'—')}</p></div>
        </div>
        <p style="margin:0 0 8px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Itens</p>
        <table width="100%" style="font-size:13px;border-collapse:collapse;margin-bottom:16px">
          <thead><tr style="background:#f9f6f2"><th style="padding:6px 8px;text-align:left;color:#888;font-weight:600">Produto</th><th style="padding:6px 8px;text-align:center;color:#888;font-weight:600">Tam.</th><th style="padding:6px 8px;text-align:center;color:#888;font-weight:600">Qtd.</th><th style="padding:6px 8px;text-align:right;color:#888;font-weight:600">Preço</th></tr></thead>
          <tbody>${itensHtml}</tbody>
        </table>
        <div style="text-align:right;margin-bottom:16px;font-size:13px">
          ${Number(p.desconto)>0?`<p style="margin:2px 0;color:#2e7d32">Desconto: − ${fmt(p.desconto)}</p>`:''}
          ${p.cupom_codigo?`<p style="margin:2px 0;font-size:12px;color:#555">Cupom: <strong style="color:#2e7d32">${escHtml(p.cupom_codigo)}</strong></p>`:''}
          ${Number(p.frete)>0?`<p style="margin:2px 0;color:#555">Frete: ${fmt(p.frete)}</p>`:'<p style="margin:2px 0;color:#2e7d32">Frete grátis</p>'}
          <p style="margin:4px 0 0;font-weight:700;font-size:15px;color:#1A2744">Total: ${fmt(p.total)}</p>
          ${p.parcelas&&p.parcelas>1?`<p style="margin:4px 0 0;font-size:12px;color:#888">Cartão parcelado em <strong>${p.parcelas}×</strong></p>`:''}
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <label style="display:block;font-size:12px;color:#888;margin-bottom:6px;text-transform:uppercase">Atualizar Status</label>
            <div style="display:flex;gap:8px">
              <select id="modalStatusSelect" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px">${statusOptions}</select>
              <button onclick="window._pedidosSalvarStatus('${pidSafe}')" style="padding:8px 14px;background:#1A2744;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">Salvar</button>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:#888;margin-bottom:6px;text-transform:uppercase">Código de Rastreio</label>
            <div style="display:flex;gap:8px">
              <input type="text" id="modalRastreioInput" value="${escHtml(p.codigo_rastreio||'')}" placeholder="Ex: BR123456789" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px">
              <button onclick="window._pedidosSalvarRastreio('${pidSafe}')" style="padding:8px 14px;background:#C4934A;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">Salvar</button>
            </div>
            ${p.codigo_rastreio?'<p style="margin:4px 0 0;font-size:11px;color:#22c55e">✓ Código registrado</p>':''}
          </div>
        </div>
        <div id="pedidoModalFeedback" style="margin-top:12px;font-size:13px;min-height:20px"></div>`;
    } catch (err) {
      body.innerHTML = `<p style="color:#ef4444;padding:16px">⚠️ Erro ao carregar pedido: ${escHtml(err.message)}</p>`;
    }
  };

  window._pedidosSalvarStatus = async function (id) {
    const select   = document.getElementById('modalStatusSelect');
    const feedback = document.getElementById('pedidoModalFeedback');
    const btnSalvar = document.querySelector(`button[onclick*="_pedidosSalvarStatus('${id}')"]`);
    if (!select) return;

    // Proteção contra clique duplo
    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = '…'; }
    if (feedback) feedback.innerHTML = '<span style="color:#888">Salvando…</span>';

    try {
      const { error } = await supabaseClient.from('pedidos').update({ status: select.value }).eq('id', id);
      if (error) throw error;
      if (feedback) feedback.innerHTML = `<span style="color:#22c55e">✓ Status atualizado para <strong>${STATUS_LABELS[select.value]}</strong>.${select.value === 'pago' ? ' Estoque e financeiro atualizados automaticamente.' : ''}</span>`;
      carregarPedidos(); carregarKPIs();
    } catch (err) {
      if (feedback) feedback.innerHTML = `<span style="color:#ef4444">⚠️ Erro: ${err.message}</span>`;
    } finally {
      if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = 'Salvar'; }
    }
  };

  window._pedidosSalvarRastreio = async function (id) {
    const input    = document.getElementById('modalRastreioInput');
    const feedback = document.getElementById('pedidoModalFeedback');
    const btnSalvar = document.querySelector(`button[onclick*="_pedidosSalvarRastreio('${id}')"]`);
    if (!input) return;

    const codigo = input.value.trim();
    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = '…'; }
    if (feedback) feedback.innerHTML = '<span style="color:#888">Salvando…</span>';

    try {
      const updates = { codigo_rastreio: codigo || null };
      if (codigo) updates.status = 'enviado';
      const { error } = await supabaseClient.from('pedidos').update(updates).eq('id', id);
      if (error) throw error;
      if (feedback) feedback.innerHTML = codigo
        ? '<span style="color:#22c55e">✓ Código de rastreio salvo. Status → Enviado.</span>'
        : '<span style="color:#888">Código removido.</span>';
      carregarPedidos(); carregarKPIs();
    } catch (err) {
      if (feedback) feedback.innerHTML = `<span style="color:#ef4444">⚠️ Erro: ${err.message}</span>`;
    } finally {
      if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = 'Salvar'; }
    }
  };

  let _realtimePedidosAtivo = false;

  window.pedidosInit = function () {
    const sf = document.getElementById('pedidosFiltroStatus');
    const bi = document.getElementById('pedidosBusca');
    // Usa { once: false } implícito mas impede listeners duplicados com flag
    if (sf && !sf.dataset.listenerBound) {
      sf.dataset.listenerBound = '1';
      sf.addEventListener('change', () => { _filtroStatus = sf.value; _page = 1; carregarPedidos(); });
    }
    let t;
    if (bi && !bi.dataset.listenerBound) {
      bi.dataset.listenerBound = '1';
      bi.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { _filtroBusca = bi.value.trim(); _page = 1; carregarPedidos(); }, 400);
      });
    }
    const overlay = document.getElementById('pedidoModalOverlay');
    if (overlay && !overlay.dataset.listenerBound) {
      overlay.dataset.listenerBound = '1';
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    }

    // ── Realtime: inicia apenas uma vez ─────────────────────────
    if (!_realtimePedidosAtivo) {
      _realtimePedidosAtivo = true;
      try {
        supabaseClient
          .channel('admin-pedidos-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
            carregarKPIs();
            carregarPedidos();
            _setRealtimeStatus(true);
          })
          .subscribe(status => {
            _setRealtimeStatus(status === 'SUBSCRIBED');
            if (status === 'CHANNEL_ERROR') {
              console.warn('[Pedidos Realtime] Canal com erro — Supabase irá reconectar automaticamente.');
            }
          });
      } catch (err) {
        _realtimePedidosAtivo = false;
        console.warn('[Pedidos Realtime]', err.message);
      }
    }

    carregarKPIs();
    carregarPedidos();

    // Exportar CSV
    const btnCSV = document.getElementById('btnExportarCSV');
    if (btnCSV && !btnCSV._csvBound) {
      btnCSV._csvBound = true;
      btnCSV.addEventListener('click', async () => {
        btnCSV.disabled = true;
        btnCSV.textContent = 'Gerando…';
        try {
          const filtroStatus = document.getElementById('pedidosFiltroStatus')?.value || '';
          let query = supabaseClient
            .from('pedidos')
            .select('id,numero_pedido,nome_cliente,email_cliente,telefone,total,status,payment_method,codigo_rastreio,criado_em,itens')
            .order('criado_em', { ascending: false });
          if (filtroStatus) query = query.eq('status', filtroStatus);

          const { data, error } = await query;
          if (error) throw error;

          // Build CSV
          const escape = (v) => {
            const s = String(v ?? '').replace(/"/g, '""');
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
          };
          const header = ['Pedido','ID','Nome','E-mail','Telefone','Total','Status','Pagamento','Rastreio','Data'];
          const rows = (data || []).map(p => [
            numeroWV(p),
            p.id,
            p.nome_cliente || '',
            p.email_cliente || '',
            p.telefone || '',
            Number(p.total || 0).toFixed(2).replace('.',','),
            p.status || '',
            p.payment_method || '',
            p.codigo_rastreio || '',
            p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '',
          ].map(escape).join(','));

          const csv = [header.join(','), ...rows].join('\r\n');
          const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          const date = new Date().toISOString().slice(0,10);
          a.href     = url;
          a.download = `pedidos-virtu-${date}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          alert('Erro ao exportar: ' + e.message);
        } finally {
          btnCSV.disabled = false;
          btnCSV.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar CSV`;
        }
      });
    }
  };

  // Indicador visual de conexão ao vivo
  function _setRealtimeStatus(ok) {
    const el = document.getElementById('pedidosRealtimeStatus');
    if (!el) return;
    el.style.background = ok ? '#22c55e' : '#f59e0b';
    el.title = ok ? 'Ao vivo — atualizações em tempo real ativas' : 'Conectando…';
  }
})();
