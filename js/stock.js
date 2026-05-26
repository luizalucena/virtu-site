/* ============================================================
   VIRTÙ — Stock.js  |  Módulo Público de Controlo de Stock
   ============================================================
   Responsabilidades:
     1. Carregar o stock inicial de um produto via Supabase RPC.
     2. Subscrever mudanças em tempo real via Supabase Realtime.
     3. Atualizar a interface do utilizador (botões, badges, seletores)
        sem necessidade de recarregar a página.
     4. Executar compras de forma atómica via RPC comprar_variacao.

   Dependências: supabase CDN + js/supabase-config.js carregados antes.
   Expõe:        window.VirtuStock  (objeto global)
   ============================================================ */

const VirtuStock = (() => {

  /* ── ESTADO INTERNO ────────────────────────────────────── */
  // Map de variacaoId → { tamanho, cor_nome, cor_hex, estoque, disponivel }
  let _variacoes     = new Map();
  let _channel       = null;   // canal Realtime ativo
  let _produtoId     = null;   // produto atualmente monitorado
  let _tamSelecionado = null;
  let _corSelecionada = null;

  /* ── UTILITÁRIOS ────────────────────────────────────────── */
  function log(msg, ...args) {
    console.log(`[VirtuStock] ${msg}`, ...args);
  }

  function formatCurrency(v) {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }

  /* ── 1. CARREGAR STOCK INICIAL ──────────────────────────── */
  /**
   * Busca todas as variações ativas de um produto no Supabase
   * e popula o estado interno.
   *
   * @param {string} produtoId - UUID do produto
   * @returns {Promise<Map>}   - Map de variacaoId → dados
   */
  async function carregarStock(produtoId) {
    _produtoId = produtoId;
    _variacoes.clear();

    try {
      const { data, error } = await supabaseClient.rpc('stock_do_produto', {
        p_produto_id: produtoId
      });

      if (error) throw error;

      (data || []).forEach(v => {
        _variacoes.set(v.variacao_id, {
          tamanho:   v.tamanho,
          cor_nome:  v.cor_nome,
          cor_hex:   v.cor_hex,
          estoque:   v.estoque,
          disponivel: v.disponivel
        });
      });

      log(`Stock carregado: ${_variacoes.size} variações para produto ${produtoId}`);
      return _variacoes;

    } catch (err) {
      console.error('[VirtuStock] Erro ao carregar stock:', err.message);
      return new Map();
    }
  }

  /* ── 2. SUBSCRIÇÃO REALTIME ─────────────────────────────── */
  /**
   * Abre um canal WebSocket para a tabela `variacoes`.
   * Quando o stock de QUALQUER variação deste produto mudar
   * (seja por compra, seja pelo admin), a UI atualiza
   * instantaneamente — sem recarregar a página.
   *
   * @param {string}   produtoId  - UUID do produto a monitorar
   * @param {Function} onMudanca  - callback(variacaoAtualizada)
   */
  function iniciarRealtime(produtoId, onMudanca) {
    // Encerra canal anterior se existir
    pararRealtime();

    _channel = supabaseClient
      .channel(`stock-produto-${produtoId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',          // apenas mudanças (não INSERT/DELETE)
          schema: 'public',
          table:  'variacoes',
          filter: `produto_id=eq.${produtoId}`
        },
        (payload) => {
          const v = payload.new;

          // Atualiza o estado interno
          _variacoes.set(v.id, {
            tamanho:   v.tamanho,
            cor_nome:  v.cor_nome,
            cor_hex:   v.cor_hex,
            estoque:   v.estoque,
            disponivel: v.estoque > 0
          });

          log(`Realtime: ${v.tamanho}/${v.cor_nome} → estoque=${v.estoque}`);

          // Notifica o chamador
          if (typeof onMudanca === 'function') {
            onMudanca({
              variacao_id: v.id,
              tamanho:     v.tamanho,
              cor_nome:    v.cor_nome,
              estoque:     v.estoque,
              disponivel:  v.estoque > 0
            });
          }
        }
      )
      .subscribe((status) => {
        log(`Canal Realtime: ${status}`);
      });

    return _channel;
  }

  /** Cancela a subscrição Realtime ativa */
  function pararRealtime() {
    if (_channel) {
      supabaseClient.removeChannel(_channel);
      _channel = null;
    }
  }

  /* ── 3. QUERIES SOBRE O ESTADO ──────────────────────────── */

  /** Retorna array de tamanhos únicos disponíveis (com estoque > 0) */
  function tamanhosdisponiveis() {
    const tam = new Set();
    _variacoes.forEach(v => {
      if (v.estoque > 0) tam.add(v.tamanho);
    });
    const ordem = ['PP','P','M','G','GG','U'];
    return [...tam].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  }

  /** Retorna array de cores disponíveis para um dado tamanho */
  function coresParaTamanho(tamanho) {
    const cores = [];
    _variacoes.forEach((v, id) => {
      if (v.tamanho === tamanho) {
        cores.push({ variacao_id: id, cor_nome: v.cor_nome, cor_hex: v.cor_hex, disponivel: v.disponivel });
      }
    });
    return cores;
  }

  /** Retorna a variação para a combinação tamanho + cor selecionada */
  function variacaoSelecionada() {
    if (!_tamSelecionado || !_corSelecionada) return null;
    for (const [id, v] of _variacoes) {
      if (v.tamanho === _tamSelecionado && v.cor_nome === _corSelecionada) {
        return { variacao_id: id, ...v };
      }
    }
    return null;
  }

  /** Estoque atual de uma variação específica */
  function estoqueDeVariacao(variacaoId) {
    return _variacoes.get(variacaoId)?.estoque ?? 0;
  }

  /* ── 4. SELEÇÃO DE TAMANHO E COR (UI) ───────────────────── */

  function selecionarTamanho(tamanho) {
    _tamSelecionado = tamanho;
    _corSelecionada = null;  // reset da cor ao trocar de tamanho
  }

  function selecionarCor(corNome) {
    _corSelecionada = corNome;
  }

  /* ── 5. COMPRA ATÓMICA ──────────────────────────────────── */
  /**
   * Chama a RPC comprar_variacao no Supabase.
   * Esta função usa SELECT FOR UPDATE no servidor:
   * garante que duas compras simultâneas do último item
   * resultam em apenas UMA bem-sucedida.
   *
   * @param {string} variacaoId  - UUID da variação a comprar
   * @param {number} quantidade  - Unidades desejadas (padrão 1)
   * @returns {Promise<{sucesso, erro?, estoque_restante?}>}
   */
  async function comprar(variacaoId, quantidade = 1) {
    if (!variacaoId) {
      return { sucesso: false, erro: 'Selecione um tamanho e uma cor.' };
    }

    try {
      const { data, error } = await supabaseClient.rpc('comprar_variacao', {
        p_variacao_id: variacaoId,
        p_quantidade:  quantidade
      });

      if (error) throw error;

      if (data?.sucesso) {
        // Atualiza o estado local imediatamente (antes do Realtime chegar)
        const v = _variacoes.get(variacaoId);
        if (v) {
          v.estoque   = data.estoque_restante;
          v.disponivel = data.estoque_restante > 0;
        }
        log(`Compra OK: variacao=${variacaoId} | restante=${data.estoque_restante}`);
      } else {
        log(`Compra negada: ${data?.erro}`);
      }

      return data;

    } catch (err) {
      console.error('[VirtuStock] Erro na compra:', err.message);
      return { sucesso: false, erro: 'Erro de comunicação. Tente novamente.' };
    }
  }

  /* ── 6. ATUALIZAÇÃO DE UI ───────────────────────────────── */
  /**
   * Atualiza os seletores de tamanho, cor e o botão de compra
   * com base no estado atual do stock.
   *
   * Espera a seguinte estrutura HTML na página de produto:
   *   [data-tam="P"]         → botão de tamanho
   *   [data-cor="Preto"]     → botão de cor
   *   #btnComprar            → botão principal de compra
   *   #stockInfo             → texto de stock disponível
   */
  function atualizarUI() {
    // ── Tamanhos ─────────────────────────────────────────
    document.querySelectorAll('[data-tam]').forEach(btn => {
      const tam  = btn.getAttribute('data-tam');
      const temStock = [..._variacoes.values()].some(v => v.tamanho === tam && v.estoque > 0);

      btn.classList.toggle('esgotado',  !temStock);
      btn.classList.toggle('selecionado', tam === _tamSelecionado);
      btn.disabled = !temStock;
    });

    // ── Cores ─────────────────────────────────────────────
    document.querySelectorAll('[data-cor]').forEach(btn => {
      const cor = btn.getAttribute('data-cor');
      let disponivel = false;

      if (_tamSelecionado) {
        for (const v of _variacoes.values()) {
          if (v.tamanho === _tamSelecionado && v.cor_nome === cor && v.estoque > 0) {
            disponivel = true; break;
          }
        }
      }

      btn.classList.toggle('esgotado',   !disponivel);
      btn.classList.toggle('selecionado', cor === _corSelecionada);
      btn.disabled = !disponivel || !_tamSelecionado;
    });

    // ── Botão de compra ───────────────────────────────────
    const btnComprar = document.getElementById('btnComprar');
    const stockInfo  = document.getElementById('stockInfo');
    const variacao   = variacaoSelecionada();

    if (btnComprar) {
      if (!_tamSelecionado || !_corSelecionada) {
        btnComprar.textContent = 'Selecione tamanho e cor';
        btnComprar.disabled    = true;
        btnComprar.classList.remove('esgotado');
      } else if (!variacao || variacao.estoque === 0) {
        btnComprar.textContent = 'Esgotado';
        btnComprar.disabled    = true;
        btnComprar.classList.add('esgotado');
      } else {
        btnComprar.textContent = 'Adicionar ao Carrinho';
        btnComprar.disabled    = false;
        btnComprar.classList.remove('esgotado');
      }
    }

    // ── Info de stock ─────────────────────────────────────
    if (stockInfo && variacao) {
      if (variacao.estoque === 0) {
        stockInfo.textContent = 'Esgotado';
        stockInfo.className   = 'stock-info stock-info--esgotado';
      } else if (variacao.estoque <= 3) {
        stockInfo.textContent = `Últimas ${variacao.estoque} unidade${variacao.estoque > 1 ? 's' : ''}!`;
        stockInfo.className   = 'stock-info stock-info--urgente';
      } else {
        stockInfo.textContent = 'Em stock';
        stockInfo.className   = 'stock-info stock-info--disponivel';
      }
    } else if (stockInfo) {
      stockInfo.textContent = '';
    }
  }

  /* ── 7. INICIALIZAÇÃO COMPLETA ──────────────────────────── */
  /**
   * Ponto de entrada principal — chamada única na página de produto.
   *
   * @param {string}   produtoId   - UUID do produto
   * @param {Function} [onCompra]  - callback após compra bem-sucedida
   *
   * Exemplo de uso em produto.js:
   *   await VirtuStock.init('uuid-do-produto', (resultado) => {
   *     // adicionar ao carrinho local, redirecionar, etc.
   *   });
   */
  async function init(produtoId, onCompra) {
    // 1. Carrega stock inicial
    await carregarStock(produtoId);

    // 2. Atualiza UI com dados iniciais
    atualizarUI();

    // 3. Subscreve Realtime — UI atualiza quando qualquer coisa mudar
    iniciarRealtime(produtoId, (_variacao) => {
      atualizarUI();
    });

    // 4. Bind dos cliques de tamanho
    document.querySelectorAll('[data-tam]').forEach(btn => {
      btn.addEventListener('click', () => {
        selecionarTamanho(btn.getAttribute('data-tam'));
        atualizarUI();
      });
    });

    // 5. Bind dos cliques de cor
    document.querySelectorAll('[data-cor]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) {
          selecionarCor(btn.getAttribute('data-cor'));
          atualizarUI();
        }
      });
    });

    // 6. Bind do botão de compra
    const btnComprar = document.getElementById('btnComprar');
    if (btnComprar) {
      btnComprar.addEventListener('click', async () => {
        const variacao = variacaoSelecionada();
        if (!variacao) return;

        // Estado de loading
        const textoOriginal    = btnComprar.textContent;
        btnComprar.textContent = 'A processar…';
        btnComprar.disabled    = true;

        const resultado = await comprar(variacao.variacao_id);

        if (resultado?.sucesso) {
          // Adiciona ao carrinho local (localStorage)
          adicionarAoCarrinhoLocal(variacao, produtoId);

          if (typeof onCompra === 'function') onCompra(resultado, variacao);
        } else {
          // Mostra erro ao utilizador
          const msgEl = document.getElementById('stockMensagem');
          if (msgEl) {
            msgEl.textContent = resultado?.erro || 'Não foi possível concluir. Tente novamente.';
            msgEl.className   = 'stock-mensagem stock-mensagem--erro';
            setTimeout(() => { msgEl.textContent = ''; }, 4000);
          }
          btnComprar.textContent = textoOriginal;
          btnComprar.disabled    = false;
        }

        // Atualiza UI com novo estado
        atualizarUI();
      });
    }

    log(`Init completo para produto ${produtoId}`);
  }

  /* ── 8. INTEGRAÇÃO COM CARRINHO (localStorage) ──────────── */
  function adicionarAoCarrinhoLocal(variacao, produtoId) {
    if (typeof VirtuCart === 'undefined') return;

    // Busca os dados do produto do cache VirtuProducts (se disponível)
    const produto = {
      id:                  produtoId,
      nome:                document.querySelector('[data-produto-nome]')?.textContent?.trim() || 'Produto',
      categoria:           document.querySelector('[data-produto-categoria]')?.textContent?.trim() || '',
      preco_original:      parseFloat(document.querySelector('[data-preco]')?.getAttribute('data-preco') || 0),
      preco_desconto:      null,
      imagem_url:          document.querySelector('[data-produto-imagem]')?.src || '',
      imagem_placeholder:  ''
    };

    const totalCart = VirtuCart.add(produto, variacao.tamanho, variacao.cor_nome, variacao.cor_hex);
    log(`Adicionado ao carrinho. Total de itens: ${totalCart}`);

    // Feedback visual no badge da navbar
    const badge = document.getElementById('cartBadge');
    if (badge) {
      badge.textContent = totalCart;
      badge.hidden      = false;
      badge.classList.add('pulse');
      setTimeout(() => badge.classList.remove('pulse'), 600);
    }
  }

  /* ── API PÚBLICA ────────────────────────────────────────── */
  return {
    init,
    carregarStock,
    iniciarRealtime,
    pararRealtime,
    comprar,
    atualizarUI,
    selecionarTamanho,
    selecionarCor,
    variacaoSelecionada,
    tamanhosdisponiveis,
    coresParaTamanho,
    estoqueDeVariacao,
    getVariacoes: () => _variacoes
  };

})();
