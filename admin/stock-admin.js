/* ============================================================
   VIRTÙ — Stock Admin  |  Gestão de Stock no Painel Admin
   ============================================================
   Responsabilidades:
     - Listar variações de um produto com stock atual
     - Criar / editar variações (tamanho + cor + stock)
     - Ajuste de stock: entrada (+), saída (-) e valor absoluto
     - Monitorização em tempo real das mudanças de stock

   Integração: este ficheiro deve ser incluído no admin após
   supabase-config.js e admin.js.
   ============================================================ */

const VirtuStockAdmin = (() => {

  /* ── UTILITÁRIOS ─────────────────────────────────────────── */
  const TAMANHOS_ORDEM = ['PP', 'P', 'M', 'G', 'GG', 'U'];

  function formatEstoque(n) {
    if (n === 0) return '<span class="badge badge--esgotado">Esgotado</span>';
    if (n <= 3)  return `<span class="badge badge--urgente">${n} un.</span>`;
    return `<span class="badge badge--ok">${n} un.</span>`;
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg, tipo = 'sucesso') {
    const t = document.createElement('div');
    t.className = `admin-toast admin-toast--${tipo}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  /* ── 1. CARREGAR VARIAÇÕES DO PRODUTO ───────────────────── */
  /**
   * Busca todas as variações (ativas e inativas) de um produto.
   * Retorna array ordenado por tamanho e cor.
   */
  async function carregarVariacoes(produtoId) {
    const { data, error } = await supabaseClient
      .from('variacoes')
      .select('*')
      .eq('produto_id', produtoId)
      .order('cor_nome');

    if (error) {
      console.error('[StockAdmin] Erro ao carregar variações:', error.message);
      return [];
    }

    return (data || []).sort((a, b) => {
      const iA = TAMANHOS_ORDEM.indexOf(a.tamanho);
      const iB = TAMANHOS_ORDEM.indexOf(b.tamanho);
      if (iA !== iB) return iA - iB;
      return a.cor_nome.localeCompare(b.cor_nome);
    });
  }

  /* ── 2. RENDERIZAR TABELA DE STOCK ──────────────────────── */
  /**
   * Gera e injeta a tabela de gestão de stock no elemento destino.
   *
   * @param {string} produtoId    - UUID do produto
   * @param {string} containerId  - ID do elemento HTML de destino
   */
  async function renderTabelaStock(produtoId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<p class="admin-loading">A carregar variações…</p>';

    const variacoes = await carregarVariacoes(produtoId);

    if (variacoes.length === 0) {
      container.innerHTML = `
        <div class="admin-empty">
          <p>Nenhuma variação criada para este produto.</p>
          <button class="btn btn--primary btn--sm" onclick="VirtuStockAdmin.abrirModalNovaVariacao('${produtoId}')">
            + Adicionar Variação
          </button>
        </div>`;
      return;
    }

    const linhas = variacoes.map(v => `
      <tr class="${v.ativo ? '' : 'row--inativo'}" data-variacao-id="${v.id}">
        <td>
          <span class="color-dot" style="background:${escHtml(v.cor_hex)}" title="${escHtml(v.cor_nome)}"></span>
          ${escHtml(v.cor_nome)}
        </td>
        <td><span class="size-tag">${escHtml(v.tamanho)}</span></td>
        <td id="estoque-cell-${v.id}">${formatEstoque(v.estoque)}</td>
        <td>
          <div class="stock-controls">
            <button class="btn-stock btn-stock--minus" title="Remover unidades"
              onclick="VirtuStockAdmin.ajustarInline('${v.id}', -1)">−</button>
            <input type="number" class="stock-input" id="stock-input-${v.id}"
              value="${v.estoque}" min="0" max="9999"
              onchange="VirtuStockAdmin.definirInline('${v.id}')"/>
            <button class="btn-stock btn-stock--plus" title="Adicionar unidades"
              onclick="VirtuStockAdmin.ajustarInline('${v.id}', +1)">+</button>
          </div>
        </td>
        <td>
          <button class="btn-icon" title="Editar variação"
            onclick="VirtuStockAdmin.abrirModalEditar('${v.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon--danger" title="${v.ativo ? 'Desativar' : 'Ativar'} variação"
            onclick="VirtuStockAdmin.toggleAtivo('${v.id}', ${v.ativo})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${v.ativo
                ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
                : '<circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 22 4"/>'
              }
            </svg>
          </button>
        </td>
      </tr>`
    ).join('');

    container.innerHTML = `
      <div class="stock-header">
        <h3 class="stock-title">Gestão de Stock</h3>
        <button class="btn btn--ghost btn--sm"
          onclick="VirtuStockAdmin.abrirModalNovaVariacao('${produtoId}')">
          + Nova Variação
        </button>
      </div>
      <table class="admin-table stock-table">
        <thead>
          <tr>
            <th>Cor</th>
            <th>Tamanho</th>
            <th>Stock</th>
            <th>Ajuste Rápido</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>`;
  }

  /* ── 3. AJUSTE INLINE DE STOCK ──────────────────────────── */

  /**
   * Adiciona ou remove unidades via RPC ajustar_estoque.
   * Chame com delta positivo (entrada) ou negativo (saída).
   */
  async function ajustarInline(variacaoId, delta) {
    const inputEl = document.getElementById(`stock-input-${variacaoId}`);
    const cellEl  = document.getElementById(`estoque-cell-${variacaoId}`);

    const { data, error } = await supabaseClient.rpc('ajustar_estoque', {
      p_variacao_id: variacaoId,
      p_delta:       delta
    });

    if (error || !data?.sucesso) {
      showToast(data?.erro || error?.message || 'Erro ao ajustar stock.', 'erro');
      return;
    }

    const novo = data.novo_estoque;
    if (inputEl) inputEl.value = novo;
    if (cellEl)  cellEl.innerHTML = formatEstoque(novo);

    showToast(`Stock atualizado: ${novo} unidade${novo !== 1 ? 's' : ''}.`);
  }

  /**
   * Define o stock com o valor absoluto do input.
   */
  async function definirInline(variacaoId) {
    const inputEl = document.getElementById(`stock-input-${variacaoId}`);
    const cellEl  = document.getElementById(`estoque-cell-${variacaoId}`);
    const novoVal = parseInt(inputEl?.value ?? 0, 10);

    if (isNaN(novoVal) || novoVal < 0) {
      showToast('Valor inválido.', 'erro');
      return;
    }

    const { data, error } = await supabaseClient.rpc('definir_estoque', {
      p_variacao_id:  variacaoId,
      p_novo_estoque: novoVal
    });

    if (error || !data?.sucesso) {
      showToast(data?.erro || error?.message || 'Erro ao definir stock.', 'erro');
      return;
    }

    if (cellEl) cellEl.innerHTML = formatEstoque(novoVal);
    showToast(`Stock definido: ${novoVal} unidade${novoVal !== 1 ? 's' : ''}.`);
  }

  /* ── 4. ATIVAR / DESATIVAR VARIAÇÃO ─────────────────────── */
  async function toggleAtivo(variacaoId, ativoAtual) {
    const novoAtivo = !ativoAtual;

    const { error } = await supabaseClient
      .from('variacoes')
      .update({ ativo: novoAtivo })
      .eq('id', variacaoId);

    if (error) {
      showToast('Erro ao alterar estado da variação.', 'erro');
      return;
    }

    showToast(novoAtivo ? 'Variação ativada.' : 'Variação desativada.');

    // Re-renderiza a tabela para refletir o novo estado
    const tabela = document.querySelector('[data-produto-id-stock]');
    if (tabela) renderTabelaStock(tabela.dataset.produtoIdStock, tabela.id);
  }

  /* ── 5. MODAL: NOVA VARIAÇÃO ─────────────────────────────── */
  function abrirModalNovaVariacao(produtoId) {
    const modal = _getOuCriarModal();

    modal.querySelector('.modal-title').textContent = 'Nova Variação';
    modal.querySelector('.modal-body').innerHTML = `
      <form id="formNovaVariacao">
        <div class="form-group">
          <label>Tamanho *</label>
          <select name="tamanho" class="form-control" required>
            <option value="">Selecione…</option>
            ${TAMANHOS_ORDEM.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Nome da Cor *</label>
          <input type="text" name="cor_nome" class="form-control" placeholder="Ex: Preto, Bege, Off-White" required/>
        </div>
        <div class="form-group">
          <label>Cor (hex) *</label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input type="color" name="cor_hex" value="#000000" style="width:44px;height:36px;cursor:pointer;border:none;padding:0"/>
            <input type="text"  name="cor_hex_text" class="form-control" value="#000000" placeholder="#000000"
              style="flex:1" oninput="document.querySelector('[name=cor_hex]').value=this.value"/>
          </div>
        </div>
        <div class="form-group">
          <label>Estoque inicial *</label>
          <input type="number" name="estoque" class="form-control" value="0" min="0" required/>
        </div>
      </form>`;

    modal.querySelector('.btn-modal-salvar').onclick = () => salvarNovaVariacao(produtoId, modal);
    modal.hidden = false;
  }

  async function salvarNovaVariacao(produtoId, modal) {
    const form    = modal.querySelector('#formNovaVariacao');
    const dados   = Object.fromEntries(new FormData(form));
    const estoque = parseInt(dados.estoque, 10);

    if (!dados.tamanho || !dados.cor_nome || !dados.cor_hex) {
      showToast('Preencha todos os campos obrigatórios.', 'erro'); return;
    }

    const { error } = await supabaseClient.from('variacoes').insert({
      produto_id: produtoId,
      tamanho:    dados.tamanho.trim(),
      cor_nome:   dados.cor_nome.trim(),
      cor_hex:    dados.cor_hex.trim(),
      estoque:    isNaN(estoque) ? 0 : estoque
    });

    if (error) {
      showToast(
        error.code === '23505'
          ? 'Já existe uma variação com este tamanho e cor.'
          : error.message,
        'erro'
      );
      return;
    }

    modal.hidden = true;
    showToast('Variação criada com sucesso!');

    const tabela = document.querySelector('[data-produto-id-stock]');
    if (tabela) renderTabelaStock(tabela.dataset.produtoIdStock, tabela.id);
  }

  /* ── 6. MODAL: EDITAR VARIAÇÃO ───────────────────────────── */
  async function abrirModalEditar(variacaoId) {
    const { data: v, error } = await supabaseClient
      .from('variacoes').select('*').eq('id', variacaoId).single();

    if (error || !v) { showToast('Variação não encontrada.', 'erro'); return; }

    const modal = _getOuCriarModal();
    modal.querySelector('.modal-title').textContent = 'Editar Variação';
    modal.querySelector('.modal-body').innerHTML = `
      <form id="formEditarVariacao">
        <div class="form-group">
          <label>Tamanho *</label>
          <select name="tamanho" class="form-control" required>
            ${TAMANHOS_ORDEM.map(t =>
              `<option value="${t}" ${t === v.tamanho ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Nome da Cor *</label>
          <input type="text" name="cor_nome" class="form-control" value="${escHtml(v.cor_nome)}" required/>
        </div>
        <div class="form-group">
          <label>Cor (hex)</label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input type="color" name="cor_hex" value="${escHtml(v.cor_hex)}" style="width:44px;height:36px;cursor:pointer;border:none;padding:0"/>
            <input type="text"  name="cor_hex_text" class="form-control" value="${escHtml(v.cor_hex)}"
              style="flex:1" oninput="document.querySelector('[name=cor_hex]').value=this.value"/>
          </div>
        </div>
        <div class="form-group">
          <label>Stock Atual</label>
          <input type="number" name="estoque" class="form-control" value="${v.estoque}" min="0"/>
        </div>
      </form>`;

    modal.querySelector('.btn-modal-salvar').onclick = () => salvarEdicaoVariacao(variacaoId, modal);
    modal.hidden = false;
  }

  async function salvarEdicaoVariacao(variacaoId, modal) {
    const form    = modal.querySelector('#formEditarVariacao');
    const dados   = Object.fromEntries(new FormData(form));
    const estoque = parseInt(dados.estoque, 10);

    const { error } = await supabaseClient.from('variacoes').update({
      tamanho:  dados.tamanho.trim(),
      cor_nome: dados.cor_nome.trim(),
      cor_hex:  dados.cor_hex.trim(),
      estoque:  isNaN(estoque) ? 0 : estoque
    }).eq('id', variacaoId);

    if (error) { showToast(error.message, 'erro'); return; }

    modal.hidden = true;
    showToast('Variação atualizada!');

    const tabela = document.querySelector('[data-produto-id-stock]');
    if (tabela) renderTabelaStock(tabela.dataset.produtoIdStock, tabela.id);
  }

  /* ── 7. MODAL BASE (criado dinamicamente) ────────────────── */
  function _getOuCriarModal() {
    let modal = document.getElementById('stockModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'stockModal';
      modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('stockModal').hidden=true"></div>
        <div class="modal-box">
          <div class="modal-header">
            <h3 class="modal-title">Variação</h3>
            <button class="modal-close" onclick="document.getElementById('stockModal').hidden=true">×</button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer">
            <button class="btn btn--ghost" onclick="document.getElementById('stockModal').hidden=true">Cancelar</button>
            <button class="btn btn--primary btn-modal-salvar">Salvar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    return modal;
  }

  /* ── 8. REALTIME NO ADMIN ───────────────────────────────── */
  /**
   * O admin também recebe atualizações em tempo real.
   * Útil para ver compras a acontecer ao vivo no painel.
   */
  function iniciarRealtimeAdmin(produtoId) {
    return supabaseClient
      .channel(`admin-stock-${produtoId}`)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'variacoes',
        filter: `produto_id=eq.${produtoId}`
      }, (payload) => {
        const v = payload.new;
        const inputEl = document.getElementById(`stock-input-${v.id}`);
        const cellEl  = document.getElementById(`estoque-cell-${v.id}`);

        if (inputEl) inputEl.value = v.estoque;
        if (cellEl)  cellEl.innerHTML = formatEstoque(v.estoque);

        // Destaque visual para mostrar que mudou
        const row = document.querySelector(`[data-variacao-id="${v.id}"]`);
        if (row) {
          row.classList.add('row--changed');
          setTimeout(() => row.classList.remove('row--changed'), 2000);
        }
      })
      .subscribe();
  }

  /* ── API PÚBLICA ─────────────────────────────────────────── */
  return {
    renderTabelaStock,
    ajustarInline,
    definirInline,
    toggleAtivo,
    abrirModalNovaVariacao,
    abrirModalEditar,
    iniciarRealtimeAdmin,
    carregarVariacoes
  };

})();
