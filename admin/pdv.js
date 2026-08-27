/* ============================================================
   VIRTÙ — Garimpo PDV (pdv.js)
   Venda presencial da linha Wear Virtù.

   Contrato com o banco:
     • Catálogo   → tabela `variacoes` + `produtos` (fonte da verdade
                    de nome, tamanho, cor e preço — nada é hardcoded).
     • Venda      → RPC `registrar_venda_presencial` (atômica: valida,
                    dá baixa no estoque e grava o pedido pago).
     • Cancelar   → RPC `cancelar_venda_presencial` (devolve estoque e
                    remove o lançamento do fluxo de caixa).

   O front NUNCA envia preço. Manda apenas variacao_id + qty; o
   servidor recalcula tudo e devolve os totais oficiais.

   Dependências: supabase CDN + js/supabase-config.js.
   ============================================================ */

(() => {
  'use strict';

  /* ══════════ ESTADO ══════════ */
  const CART_KEY = 'virtu_pdv_carrinho';

  // Ajuste por método — ESPELHO de AJUSTE_METODO em processar-pagamento
  // (site) e de registrar_venda_presencial (banco). Mantenha os três
  // sincronizados: o servidor é a autoridade, isto é só a prévia na tela.
  //   PIX e dinheiro → à vista, custo quase zero → 3% de desconto
  //   crédito/débito → preço de tabela (a taxa do cartão já está embutida)
  const AJUSTE_METODO = { pix: -0.03, dinheiro: -0.03, credito: 0, debito: 0 };

  // Taxas da maquininha (Ton) para o repasse dos juros do parcelado.
  // Fonte real: configuracoes.taxas_cartao_ton (editável no painel). Isto
  // é só o fallback caso a config falte/quebre — espelha
  // taxas_cartao_ton_default() do banco (faixa "Ton Mega+ até R$3 mil").
  //   avista   = taxa do crédito à vista, já embutida no preço de tabela
  //   parcelado[n] = taxa total da Ton no parcelamento em n vezes
  const TAXAS_TON_FALLBACK = {
    avista: 0.0386,
    parcelado: { 2: 0.0986, 3: 0.1124, 4: 0.1259, 5: 0.1392, 6: 0.1522 }
  };

  let _variacoes = [];          // [{id, produto_id, tamanho, cor_nome, cor_hex, estoque, ativo, produto:{…}}]
  let _porId     = new Map();   // variacao_id → variação
  let _carrinho  = [];          // [{variacao_id, qty}]
  let _pagamento = null;        // 'pix' | 'dinheiro' | 'credito' | 'debito'
  let _parcelas  = 1;           // parcelas do crédito (1 = à vista)
  let _taxasTon  = null;        // taxas da Ton vindas da config (ou null → fallback)
  let _categoria = 'todas';
  let _busca     = '';
  let _canal     = null;
  let _enviando  = false;

  /* ══════════ UTILITÁRIOS ══════════ */

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Toda a aritmética de dinheiro é feita em CENTAVOS (inteiros).
  // Isso elimina qualquer erro de ponto flutuante nas somas.
  //
  // Aceita três origens sem se confundir:
  //   • número vindo do JS          → 109.9
  //   • string JSON do Postgres     → "109.90"
  //   • digitação em pt-BR          → "1.329,50" · "129,5" · "1329"
  function paraCentavos(valor) {
    if (valor === null || valor === undefined || valor === '') return 0;

    if (typeof valor === 'number') {
      return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
    }

    let s = String(valor).trim();

    // Formato JSON/Postgres puro (ponto como decimal, sem milhar)
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    }

    // Digitação humana: mantém só dígitos, vírgula, ponto e sinal
    s = s.replace(/[^\d.,-]/g, '');
    if (!s) return 0;

    const negativo = s.startsWith('-');
    s = s.replace(/-/g, '');

    // O último separador só é decimal se sobrarem 1 ou 2 dígitos depois.
    // Assim "1.329,50" → 132950 e "1.329" → 132900 (milhar, não decimal).
    const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    let inteiro = s, decimais = '';

    if (sep !== -1) {
      const cauda = s.slice(sep + 1);
      if (/^\d{1,2}$/.test(cauda)) { inteiro = s.slice(0, sep); decimais = cauda; }
    }

    inteiro  = inteiro.replace(/[.,]/g, '') || '0';
    decimais = (decimais + '00').slice(0, 2);

    const centavos = Number(inteiro) * 100 + Number(decimais);
    if (!Number.isFinite(centavos)) return 0;

    return negativo ? -centavos : centavos;
  }

  function fmt(centavos) {
    return (centavos / 100).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL'
    });
  }

  function hora(iso) {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  function toast(msg, tipo = 'sucesso') {
    document.querySelector('.pdv-toast')?.remove();
    const t = document.createElement('div');
    t.className = `pdv-toast${tipo === 'erro' ? ' pdv-toast--erro' : ''}`;
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function mostrarErro(msg) {
    const el = document.getElementById('pdvErro');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  const ORDEM_TAM = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'U',
                     '34', '36', '38', '40', '42', '44', '46', '48'];

  function ordenarTamanho(a, b) {
    const ia = ORDEM_TAM.indexOf(a), ib = ORDEM_TAM.indexOf(b);
    if (ia === -1 && ib === -1) return String(a).localeCompare(b, 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }

  /* ══════════ CARRINHO (localStorage) ══════════ */

  function carregarCarrinho() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      _carrinho = Array.isArray(bruto)
        ? bruto.filter(i => i && i.variacao_id).map(i => ({
            variacao_id: String(i.variacao_id),
            qty: Math.max(1, Math.min(50, parseInt(i.qty, 10) || 1))
          }))
        : [];
    } catch { _carrinho = []; }
  }

  function salvarCarrinho() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(_carrinho)); } catch {}
  }

  function estoqueDe(variacaoId) {
    return _porId.get(variacaoId)?.estoque ?? 0;
  }

  function precoCentavosDe(variacaoId) {
    const v = _porId.get(variacaoId);
    if (!v || !v.produto) return 0;
    const bruto = v.produto.preco_desconto ?? v.produto.preco_original;
    return paraCentavos(bruto);
  }

  function adicionar(variacaoId) {
    const v = _porId.get(variacaoId);
    if (!v) return;

    const item = _carrinho.find(i => i.variacao_id === variacaoId);
    const atual = item ? item.qty : 0;

    if (atual + 1 > v.estoque) {
      toast(`Só resta${v.estoque === 1 ? '' : 'm'} ${v.estoque} un. de ${v.produto?.nome} ${v.tamanho} / ${v.cor_nome}.`, 'erro');
      return;
    }

    if (item) item.qty = atual + 1;
    else _carrinho.push({ variacao_id: variacaoId, qty: 1 });

    salvarCarrinho();
    renderCarrinho();
    mostrarErro('');
  }

  function alterarQty(variacaoId, delta) {
    const item = _carrinho.find(i => i.variacao_id === variacaoId);
    if (!item) return;

    const nova = item.qty + delta;

    if (nova <= 0) {
      _carrinho = _carrinho.filter(i => i.variacao_id !== variacaoId);
    } else if (nova > estoqueDe(variacaoId)) {
      toast(`Estoque disponível: ${estoqueDe(variacaoId)} un.`, 'erro');
      return;
    } else {
      item.qty = nova;
    }

    salvarCarrinho();
    renderCarrinho();
  }

  function limparCarrinho() {
    _carrinho = [];
    _parcelas = 1;
    salvarCarrinho();
    const desc = document.getElementById('pdvDesconto');
    const receb = document.getElementById('pdvRecebido');
    if (desc)  desc.value = '';
    if (receb) receb.value = '';
    mostrarErro('');
    renderCarrinho();
  }

  /* ══════════ CÁLCULO DOS TOTAIS (em centavos) ══════════ */

  /**
   * Arredondamento estético: leva ao múltiplo terminado em ",90" mais
   * próximo. Espelha arredondar90() do site e arredondar_90() do banco.
   * Trabalha em centavos inteiros — sem ponto flutuante.
   */
  function arredondar90(centavos) {
    return Math.round((centavos - 90) / 100) * 100 + 90;
  }

  /** Total já com o ajuste do método aplicado (em centavos). */
  function totalDoMetodo(baseCentavos, metodo) {
    const ajuste = AJUSTE_METODO[metodo] ?? 0;
    if (!ajuste || baseCentavos <= 0) return baseCentavos;
    return arredondar90(Math.round(baseCentavos * (1 + ajuste)));
  }

  /* ─── Juros do parcelamento no crédito (repasse do excedente) ─── */

  function taxasTon()   { return _taxasTon || TAXAS_TON_FALLBACK; }
  function taxaAvista() { return taxasTon()?.avista ?? TAXAS_TON_FALLBACK.avista; }
  function taxaParcela(n) {
    const t = taxasTon()?.parcelado || {};
    // aceita chave numérica ou string ("2" | 2)
    const v = t[n] ?? t[String(n)];
    return (typeof v === 'number' && v > 0 && v < 1) ? v : null;
  }

  /** Maior nº de parcelas com taxa configurada (1x sempre existe). */
  function maxParcelas() {
    const t = taxasTon()?.parcelado || {};
    let max = 1;
    for (let n = 2; n <= 12; n++) if (taxaParcela(n) != null) max = n;
    return max;
  }

  /**
   * Total do crédito para n parcelas, em centavos. À vista (n≤1) é a
   * base exata — igual ao crédito de hoje. De 2x em diante repassa só
   * o excedente da taxa da Ton, igualando o líquido ao do crédito à
   * vista:  cobrado = base × (1 − taxa_avista) ÷ (1 − taxa_n)  → ,90.
   * É DIVISÃO. Espelha o cálculo de registrar_venda_presencial.
   */
  function totalCredito(baseCentavos, n) {
    if (baseCentavos <= 0 || n <= 1) return baseCentavos;
    const taxa = taxaParcela(n);
    if (taxa == null) return baseCentavos;   // sem taxa → não inventa juros
    const bruto = Math.round(baseCentavos * (1 - taxaAvista()) / (1 - taxa));
    return arredondar90(bruto);
  }

  function calcularTotais() {
    let subtotal = 0;
    let pecas = 0;

    for (const item of _carrinho) {
      subtotal += precoCentavosDe(item.variacao_id) * item.qty;
      pecas += item.qty;
    }

    const descontoBruto = paraCentavos(document.getElementById('pdvDesconto')?.value);
    const desconto = Math.max(0, Math.min(descontoBruto, subtotal));

    // base = o que a cliente pagaria no cartão à vista (tabela − desconto)
    const base = subtotal - desconto;

    // No crédito, o total depende do parcelamento; nos demais, do método.
    let total;
    if (_pagamento === 'credito')  total = totalCredito(base, _parcelas);
    else if (_pagamento)           total = totalDoMetodo(base, _pagamento);
    else                           total = base;

    return { subtotal, desconto, base, total, ajuste: base - total, pecas };
  }

  /* ══════════ CARREGAMENTO DE DADOS ══════════ */

  async function carregarEstoque() {
    const { data, error } = await supabaseClient
      .from('variacoes')
      .select('id, produto_id, tamanho, cor_nome, cor_hex, estoque, ativo, produtos(nome, categoria, preco_original, preco_desconto, ativo)');

    if (error) {
      console.error('[PDV] Erro ao carregar estoque:', error.message);
      document.getElementById('pdvGrade').innerHTML =
        '<p class="pdv-sem-resultado">Não foi possível carregar o estoque. Toque em “Recarregar”.</p>';
      return;
    }

    _variacoes = (data || [])
      .map(v => ({ ...v, produto: v.produtos }))
      .filter(v => v.ativo && v.produto && v.produto.ativo);

    _porId = new Map(_variacoes.map(v => [v.id, v]));

    // Remove do carrinho itens que sumiram do catálogo
    const antes = _carrinho.length;
    _carrinho = _carrinho.filter(i => _porId.has(i.variacao_id));
    if (_carrinho.length !== antes) salvarCarrinho();

    renderCategorias();
    renderGrade();
    renderCarrinho();
    renderKpiEstoque();
  }

  // Taxas da Ton para o repasse dos juros — configuráveis no painel
  // (configuracoes.taxas_cartao_ton). Se faltar/quebrar, fica no
  // TAXAS_TON_FALLBACK; o servidor recalcula tudo de qualquer forma.
  async function carregarTaxas() {
    try {
      const { data, error } = await supabaseClient
        .from('configuracoes')
        .select('taxas_cartao_ton')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      const t = data?.taxas_cartao_ton;
      _taxasTon = (t && t.parcelado) ? t : null;
    } catch (e) {
      console.warn('[PDV] Taxas da Ton não carregadas, usando fallback:', e?.message || e);
      _taxasTon = null;
    }
  }

  /* ══════════ RENDER: CATEGORIAS ══════════ */

  function renderCategorias() {
    const el = document.getElementById('pdvCategorias');
    if (!el) return;

    const cats = [...new Set(_variacoes.map(v => v.produto.categoria).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const rotulo = c => c.charAt(0).toUpperCase() + c.slice(1);

    el.innerHTML = [
      `<button type="button" class="pdv-chip${_categoria === 'todas' ? ' pdv-chip--ativo' : ''}" data-cat="todas">Todas</button>`,
      ...cats.map(c =>
        `<button type="button" class="pdv-chip${_categoria === c ? ' pdv-chip--ativo' : ''}" data-cat="${escHtml(c)}">${escHtml(rotulo(c))}</button>`
      )
    ].join('');
  }

  /* ══════════ RENDER: GRADE DE PEÇAS ══════════ */

  function renderGrade() {
    const grade = document.getElementById('pdvGrade');
    if (!grade) return;

    const ocultarEsgotados = document.getElementById('pdvOcultarEsgotados')?.checked;
    const termo = _busca.trim().toLowerCase();

    // Agrupa variações por produto
    const produtos = new Map();

    for (const v of _variacoes) {
      if (_categoria !== 'todas' && v.produto.categoria !== _categoria) continue;

      const alvo = `${v.produto.nome} ${v.tamanho} ${v.cor_nome} ${v.produto.categoria || ''}`.toLowerCase();
      if (termo && !alvo.includes(termo)) continue;

      if (ocultarEsgotados && v.estoque <= 0) continue;

      if (!produtos.has(v.produto_id)) {
        produtos.set(v.produto_id, { nome: v.produto.nome, categoria: v.produto.categoria, produto: v.produto, vars: [] });
      }
      produtos.get(v.produto_id).vars.push(v);
    }

    if (produtos.size === 0) {
      grade.innerHTML = `<p class="pdv-sem-resultado">${
        termo || _categoria !== 'todas'
          ? 'Nenhuma peça encontrada com esse filtro.'
          : 'Nenhuma peça disponível no estoque.'
      }</p>`;
      return;
    }

    const ordenadas = [...produtos.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    grade.innerHTML = ordenadas.map(p => {
      const precoCheio  = paraCentavos(p.produto.preco_original);
      const precoAtual  = paraCentavos(p.produto.preco_desconto ?? p.produto.preco_original);
      const temDesconto = p.produto.preco_desconto != null && precoAtual < precoCheio;

      const vars = p.vars
        .slice()
        .sort((a, b) =>
          ordenarTamanho(a.tamanho, b.tamanho) ||
          String(a.cor_nome).localeCompare(b.cor_nome, 'pt-BR'))
        .map(v => {
          const noCarrinho = _carrinho.find(i => i.variacao_id === v.id)?.qty ?? 0;
          const restante   = v.estoque - noCarrinho;
          const esgotado   = restante <= 0;
          const baixo      = restante > 0 && restante <= 2;

          return `
            <button type="button"
              class="pdv-var${baixo ? ' pdv-var--baixo' : ''}"
              data-variacao="${escHtml(v.id)}"
              ${esgotado ? 'disabled' : ''}
              title="${escHtml(`${p.nome} — ${v.tamanho} / ${v.cor_nome} · ${restante} disponível(is)`)}">
              <span class="pdv-var__tam">${escHtml(v.tamanho)}</span>
              <span class="pdv-var__cor">
                <span class="pdv-var__dot" style="background:${escHtml(v.cor_hex || '#ffffff')}"></span>
                ${escHtml(v.cor_nome)}
              </span>
              <span class="pdv-var__qtd">${restante}</span>
            </button>`;
        }).join('');

      return `
        <article class="pdv-peca">
          <div class="pdv-peca__topo">
            <div>
              <h3 class="pdv-peca__nome">${escHtml(p.nome)}</h3>
              <span class="pdv-peca__cat">${escHtml(p.categoria || 'Peça')}</span>
            </div>
            <div class="pdv-peca__preco">
              ${temDesconto ? `<s>${fmt(precoCheio)}</s>` : ''}
              ${fmt(precoAtual)}
            </div>
          </div>
          <div class="pdv-variacoes">${vars}</div>
        </article>`;
    }).join('');
  }

  /* ══════════ RENDER: CARRINHO E TOTAIS ══════════ */

  function renderCarrinho() {
    const box = document.getElementById('pdvCarrinho');
    if (!box) return;

    if (_carrinho.length === 0) {
      box.innerHTML = '<p class="pdv-vazio">Toque numa peça ao lado para começar a venda.</p>';
    } else {
      box.innerHTML = _carrinho.map(item => {
        const v = _porId.get(item.variacao_id);
        if (!v) return '';

        const precoUn = precoCentavosDe(item.variacao_id);
        const subItem = precoUn * item.qty;
        const noLimite = item.qty >= v.estoque;

        return `
          <div class="pdv-item" data-variacao="${escHtml(v.id)}">
            <div>
              <p class="pdv-item__nome">${escHtml(v.produto.nome)}</p>
              <p class="pdv-item__meta">
                <span class="pdv-var__dot" style="background:${escHtml(v.cor_hex || '#ffffff')}"></span>
                ${escHtml(v.tamanho)} · ${escHtml(v.cor_nome)} · ${fmt(precoUn)}
              </p>
            </div>
            <div class="pdv-item__sub">${fmt(subItem)}</div>
            <div class="pdv-item__acoes">
              <button type="button" class="pdv-qtd-btn" data-menos="${escHtml(v.id)}" aria-label="Remover uma unidade">−</button>
              <span class="pdv-item__qtd">${item.qty}</span>
              <button type="button" class="pdv-qtd-btn" data-mais="${escHtml(v.id)}" ${noLimite ? 'disabled' : ''} aria-label="Adicionar uma unidade">+</button>
            </div>
            ${noLimite ? `<p class="pdv-item__limite">Todo o estoque desta variação (${v.estoque} un.) está na venda.</p>` : ''}
          </div>`;
      }).join('');
    }

    renderTotais();
    renderGrade();  // atualiza os contadores "restante" nos chips
  }

  function renderTotais() {
    const { subtotal, desconto, base, total, ajuste, pecas } = calcularTotais();

    const texto = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    };

    texto('pdvSubtotal', fmt(subtotal));
    texto('pdvTotal',    fmt(total));
    texto('pdvTotalBtn', ` · ${fmt(total)}`);
    texto('pdvQtdPecas', pecas > 0 ? `(${pecas} peça${pecas > 1 ? 's' : ''})` : '');

    // Linha do desconto à vista (PIX / dinheiro) — ajuste > 0
    const linhaAjuste = document.getElementById('pdvLinhaAjuste');
    if (linhaAjuste) {
      const mostra = ajuste > 0;
      linhaAjuste.hidden = !mostra;
      if (mostra) {
        const pct = Math.abs((AJUSTE_METODO[_pagamento] ?? 0) * 100);
        texto('pdvAjusteLabel', `Desconto à vista (${pct.toFixed(0)}%)`);
        texto('pdvAjuste', `− ${fmt(ajuste)}`);
      }
    }

    // Linha dos juros do parcelamento (crédito 2x+) — ajuste < 0
    const linhaJuros = document.getElementById('pdvLinhaJuros');
    if (linhaJuros) {
      const juros = ajuste < 0 ? -ajuste : 0;
      const mostra = _pagamento === 'credito' && _parcelas >= 2 && juros > 0;
      linhaJuros.hidden = !mostra;
      if (mostra) {
        texto('pdvJurosLabel', `Juros do parcelamento (${_parcelas}×)`);
        texto('pdvJuros', `+ ${fmt(juros)}`);
      }
    }

    // Prévia do valor em cada forma de pagamento — a cliente pergunta
    // "quanto fica no PIX?" e a resposta fica na tela, sem precisar clicar.
    // No crédito, mostra o total do parcelamento selecionado.
    document.querySelectorAll('[data-valor-pag]').forEach(el => {
      const metodo = el.getAttribute('data-valor-pag');
      if (base <= 0) { el.textContent = ''; return; }
      el.textContent = metodo === 'credito'
        ? fmt(totalCredito(base, _parcelas))
        : fmt(totalDoMetodo(base, metodo));
    });

    // Aviso quando o desconto foi truncado no subtotal
    const inputDesc = document.getElementById('pdvDesconto');
    if (inputDesc && paraCentavos(inputDesc.value) > subtotal && subtotal > 0) {
      mostrarErro('O desconto não pode ser maior que o subtotal.');
    }

    renderParcelas(base);
    renderTroco(total);

    const btn = document.getElementById('btnConfirmar');
    if (btn) {
      btn.disabled = !(_carrinho.length > 0 && total > 0 && !!_pagamento) || _enviando;
    }
  }

  function renderParcelas(baseCentavos) {
    const bloco  = document.getElementById('pdvBlocoParcelas');
    const select = document.getElementById('pdvParcelas');
    if (!bloco || !select) return;

    bloco.hidden = _pagamento !== 'credito';
    if (bloco.hidden) return;

    const maxN = maxParcelas();
    if (_parcelas > maxN) _parcelas = maxN;

    // Cada opção mostra o total do parcelamento, para a cliente ver o
    // valor final e comparar com o à vista — nada de pegadinha.
    const opcoes = [];
    for (let n = 1; n <= maxN; n++) {
      const tot     = totalCredito(baseCentavos, n);
      const parcela = Math.floor(tot / n);
      const rotulo  = n === 1
        ? `1× à vista — ${fmt(tot)}`
        : `${n}× de ${fmt(parcela)} — total ${fmt(tot)}`;
      opcoes.push(`<option value="${n}"${n === _parcelas ? ' selected' : ''}>${rotulo}</option>`);
    }
    select.innerHTML = opcoes.join('');

    const totalSel = totalCredito(baseCentavos, _parcelas);

    // Resto da divisão: a última parcela absorve os centavos.
    const parcela = Math.floor(totalSel / _parcelas);
    const resto   = totalSel - parcela * _parcelas;
    const hint = document.getElementById('pdvHintParcela');
    if (hint) {
      hint.textContent = resto > 0
        ? `Última parcela: ${fmt(parcela + resto)} (arredondamento).`
        : '';
    }

    // Aviso discreto de que à vista sai mais barato (quando há juros).
    const avista = document.getElementById('pdvHintAvista');
    if (avista) {
      const aVistaCentavos = totalCredito(baseCentavos, 1);
      const economia = totalSel - aVistaCentavos;
      const mostra = _parcelas >= 2 && economia > 0;
      avista.hidden = !mostra;
      avista.textContent = mostra
        ? `À vista sai por ${fmt(aVistaCentavos)} — a cliente economiza ${fmt(economia)}.`
        : '';
    }
  }

  function renderTroco(totalCentavos) {
    const bloco = document.getElementById('pdvBlocoTroco');
    const hint  = document.getElementById('pdvTroco');
    if (!bloco || !hint) return;

    bloco.hidden = _pagamento !== 'dinheiro';
    if (bloco.hidden) { hint.textContent = ''; return; }

    const recebido = paraCentavos(document.getElementById('pdvRecebido')?.value);

    if (recebido <= 0) {
      hint.textContent = '';
      hint.className = 'pdv-hint';
    } else if (recebido < totalCentavos) {
      hint.textContent = `Faltam ${fmt(totalCentavos - recebido)}.`;
      hint.className = 'pdv-hint pdv-hint--falta';
    } else {
      hint.textContent = `Troco: ${fmt(recebido - totalCentavos)}`;
      hint.className = 'pdv-hint pdv-hint--ok';
    }
  }

  function renderKpiEstoque() {
    const total = _variacoes.reduce((s, v) => s + (v.estoque || 0), 0);
    const el = document.getElementById('kpiEstoque');
    if (el) el.textContent = `${total} peça${total === 1 ? '' : 's'}`;
  }

  /* ══════════ CONFIRMAR VENDA ══════════ */

  async function confirmarVenda() {
    if (_enviando) return;

    const { total, subtotal, desconto } = calcularTotais();

    if (_carrinho.length === 0) { mostrarErro('Adicione ao menos uma peça.'); return; }
    if (!_pagamento)            { mostrarErro('Escolha a forma de pagamento.'); return; }
    if (total <= 0)             { mostrarErro('O total da venda precisa ser maior que zero.'); return; }

    if (_pagamento === 'dinheiro') {
      const recebido = paraCentavos(document.getElementById('pdvRecebido')?.value);
      if (recebido > 0 && recebido < total) {
        mostrarErro('O valor recebido é menor que o total da venda.');
        return;
      }
    }

    _enviando = true;
    mostrarErro('');

    // Estado de "enviando" sem destruir os filhos do botão
    // (#pdvTotalBtn precisa continuar existindo para renderTotais).
    const btn      = document.getElementById('btnConfirmar');
    const btnTexto = document.getElementById('pdvBtnTexto');
    const btnTotal = document.getElementById('pdvTotalBtn');
    btn.disabled = true;
    if (btnTexto) btnTexto.textContent = 'Registrando venda…';
    if (btnTotal) btnTotal.hidden = true;

    try {
      const { data, error } = await supabaseClient.rpc('registrar_venda_presencial', {
        p_itens: _carrinho.map(i => ({ variacao_id: i.variacao_id, qty: i.qty })),
        p_pagamento: _pagamento,
        p_desconto: desconto / 100,
        p_cliente_nome: document.getElementById('pdvCliente')?.value?.trim() || null,
        p_cliente_telefone: document.getElementById('pdvTelefone')?.value?.trim() || null,
        p_parcelas: _pagamento === 'credito' ? _parcelas : null,
        p_observacao: document.getElementById('pdvObs')?.value?.trim() || null
      });

      if (error) throw new Error(error.message);

      if (!data?.sucesso) {
        mostrarErro(data?.erro || 'Não foi possível registrar a venda.');
        await carregarEstoque();
        return;
      }

      // Confere se o total exibido bateu com o total oficial do servidor.
      const totalServidor = paraCentavos(data.total);
      if (totalServidor !== total) {
        toast('Atenção: o total foi recalculado pelo servidor. Confira o recibo.', 'erro');
      }

      mostrarRecibo(data, subtotal);
      limparCarrinho();
      ['pdvCliente', 'pdvTelefone', 'pdvObs'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      _pagamento = null;
      _parcelas  = 1;
      document.querySelectorAll('#pdvPagamentos .pdv-pag')
        .forEach(b => b.classList.remove('pdv-pag--ativo'));

      await Promise.all([carregarEstoque(), carregarVendasHoje()]);
      toast(`Venda ${data.codigo || ''} registrada — ${fmt(totalServidor)}.`);

    } catch (err) {
      console.error('[PDV] Erro ao registrar venda:', err);
      mostrarErro(`Erro ao registrar a venda: ${err.message}. Nada foi baixado do estoque.`);
    } finally {
      _enviando = false;
      if (btnTexto) btnTexto.textContent = 'Confirmar venda';
      if (btnTotal) btnTotal.hidden = false;
      renderTotais();
    }
  }

  /* ══════════ RECIBO ══════════ */

  function mostrarRecibo(venda, subtotalLocal) {
    const modal = document.getElementById('pdvRecibo');
    const corpo = document.getElementById('pdvReciboCorpo');
    if (!modal || !corpo) return;

    const itens = Array.isArray(venda.itens) ? venda.itens : [];
    const subtotal = paraCentavos(venda.subtotal ?? subtotalLocal);
    const desconto = paraCentavos(venda.desconto);
    const juros    = paraCentavos(venda.juros);
    const total    = paraCentavos(venda.total);

    const linhas = itens.map(i => `
      <div class="pdv-recibo__l">
        <span>${escHtml(i.qty)}× ${escHtml(i.nome)} — ${escHtml(i.tamanho)} / ${escHtml(i.cor_nome)}</span>
        <strong>${fmt(paraCentavos(i.subtotal))}</strong>
      </div>`).join('');

    const parcelaTxt = venda.parcelas && venda.parcelas > 1
      ? ` (${venda.parcelas}× de ${fmt(Math.floor(total / venda.parcelas))})`
      : '';

    corpo.innerHTML = `
      <h3 id="pdvReciboTitulo">Venda confirmada</h3>
      <p class="pdv-recibo__cod">${escHtml(venda.codigo || '')} · ${hora(venda.criado_em)} · Garimpo Virtù</p>
      <div class="pdv-recibo__linhas">${linhas}</div>
      <div class="pdv-recibo__totais">
        <div class="pdv-recibo__l"><span>Subtotal</span><strong>${fmt(subtotal)}</strong></div>
        ${desconto > 0 ? `<div class="pdv-recibo__l"><span>Desconto</span><strong>− ${fmt(desconto)}</strong></div>` : ''}
        ${juros > 0 ? `<div class="pdv-recibo__l"><span>Juros do parcelamento (${escHtml(venda.parcelas)}×)</span><strong>+ ${fmt(juros)}</strong></div>` : ''}
        <div class="pdv-recibo__l"><span>Pagamento</span><strong>${escHtml(venda.pagamento_rotulo || '')}${parcelaTxt}</strong></div>
        <div class="pdv-recibo__total"><span>Total</span><strong>${fmt(total)}</strong></div>
      </div>`;

    modal.hidden = false;
  }

  function fecharRecibo() {
    const modal = document.getElementById('pdvRecibo');
    if (modal) modal.hidden = true;
  }

  /* ══════════ VENDAS DE HOJE ══════════ */

  function inicioDoDiaISO() {
    const agora = new Date();
    agora.setHours(0, 0, 0, 0);
    return agora.toISOString();
  }

  async function carregarVendasHoje() {
    const box = document.getElementById('pdvVendasHoje');
    if (!box) return;

    const { data, error } = await supabaseClient
      .from('pedidos')
      .select('id, codigo, total, status, payment_method, parcelas, criado_em, itens, cliente_nome')
      .eq('external_reference', 'garimpo-pdv')
      .gte('criado_em', inicioDoDiaISO())
      .order('criado_em', { ascending: false });

    if (error) {
      console.error('[PDV] Erro ao carregar vendas:', error.message);
      box.innerHTML = '<p class="pdv-vazio">Não foi possível carregar as vendas de hoje.</p>';
      return;
    }

    const vendas = data || [];
    const validas = vendas.filter(v => v.status !== 'cancelado');

    // KPIs (também em centavos)
    const totalCents = validas.reduce((s, v) => s + paraCentavos(v.total), 0);
    const pecas = validas.reduce((s, v) =>
      s + (Array.isArray(v.itens) ? v.itens.reduce((n, i) => n + (parseInt(i.qty, 10) || 0), 0) : 0), 0);
    const ticket = validas.length ? Math.round(totalCents / validas.length) : 0;

    document.getElementById('kpiTotal').textContent  = fmt(totalCents);
    document.getElementById('kpiVendas').textContent = String(validas.length);
    document.getElementById('kpiPecas').textContent  = String(pecas);
    document.getElementById('kpiTicket').textContent = fmt(ticket);
    document.getElementById('pdvVendasTag').textContent = String(validas.length);

    if (vendas.length === 0) {
      box.innerHTML = '<p class="pdv-vazio">Nenhuma venda registrada hoje.</p>';
      return;
    }

    const rotuloPagto = v => {
      if (v.payment_method === 'pix')      return 'PIX';
      if (v.payment_method === 'dinheiro') return 'Dinheiro';
      if (v.payment_method === 'debito')   return 'Débito';
      if (v.payment_method === 'cartao')   return v.parcelas > 1 ? `Crédito ${v.parcelas}×` : 'Crédito';
      return v.payment_method || '—';
    };

    box.innerHTML = vendas.map(v => {
      const nPecas = Array.isArray(v.itens)
        ? v.itens.reduce((n, i) => n + (parseInt(i.qty, 10) || 0), 0) : 0;
      const cancelada = v.status === 'cancelado';

      return `
        <div class="pdv-venda-item${cancelada ? ' pdv-venda-item--cancelada' : ''}">
          <p class="pdv-venda-item__cod">${escHtml(v.codigo || '—')}</p>
          <p class="pdv-venda-item__meta">
            ${hora(v.criado_em)} · ${nPecas} peça${nPecas === 1 ? '' : 's'} · ${escHtml(rotuloPagto(v))}${cancelada ? ' · cancelada' : ''}
          </p>
          <p class="pdv-venda-item__total">${fmt(paraCentavos(v.total))}</p>
          <p class="pdv-venda-item__acao">
            ${cancelada ? '' : `<button type="button" class="pdv-link-btn" data-cancelar="${escHtml(v.id)}">Cancelar</button>`}
          </p>
        </div>`;
    }).join('');
  }

  async function cancelarVenda(pedidoId) {
    const ok = window.confirm(
      'Cancelar esta venda? As peças voltam para o estoque e o lançamento sai do financeiro.'
    );
    if (!ok) return;

    const { data, error } = await supabaseClient.rpc('cancelar_venda_presencial', {
      p_pedido_id: pedidoId
    });

    if (error || !data?.sucesso) {
      toast(data?.erro || error?.message || 'Não foi possível cancelar a venda.', 'erro');
      return;
    }

    toast(`Venda ${data.codigo || ''} cancelada. Estoque devolvido.`);
    await Promise.all([carregarEstoque(), carregarVendasHoje()]);
  }

  /* ══════════ REALTIME ══════════ */

  function iniciarRealtime() {
    const dot = document.getElementById('realtimeDot');

    if (_canal) { try { supabaseClient.removeChannel(_canal); } catch {} }

    _canal = supabaseClient
      .channel(`pdv-garimpo-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'variacoes' }, payload => {
        const v = payload.new;
        if (!v || !v.id) { carregarEstoque(); return; }

        const local = _porId.get(v.id);
        if (!local) { carregarEstoque(); return; }

        local.estoque  = v.estoque;
        local.tamanho  = v.tamanho;
        local.cor_nome = v.cor_nome;
        local.cor_hex  = v.cor_hex;
        local.ativo    = v.ativo;

        // Se o estoque caiu abaixo do que está no carrinho, ajusta.
        const item = _carrinho.find(i => i.variacao_id === v.id);
        if (item && item.qty > v.estoque) {
          if (v.estoque <= 0) {
            _carrinho = _carrinho.filter(i => i.variacao_id !== v.id);
            toast(`${local.produto?.nome} ${local.tamanho}/${local.cor_nome} esgotou e saiu da venda.`, 'erro');
          } else {
            item.qty = v.estoque;
            toast(`Quantidade ajustada: restam ${v.estoque} un. de ${local.produto?.nome}.`, 'erro');
          }
          salvarCarrinho();
        }

        renderCarrinho();
        renderKpiEstoque();
      })
      .subscribe(status => {
        if (!dot) return;
        const ok = status === 'SUBSCRIBED';
        dot.classList.toggle('realtime-dot--live', ok);
        dot.title = ok ? 'Estoque sincronizado em tempo real' : 'Reconectando ao Realtime…';
      });
  }

  /* ══════════ EVENTOS ══════════ */

  function ligarEventos() {
    // Clique numa variação (grade) — event delegation
    document.getElementById('pdvGrade')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-variacao]');
      if (!btn || btn.disabled) return;
      adicionar(btn.getAttribute('data-variacao'));
      btn.classList.add('pdv-var--pulse');
      setTimeout(() => btn.classList.remove('pdv-var--pulse'), 500);
    });

    // Quantidade no carrinho
    document.getElementById('pdvCarrinho')?.addEventListener('click', e => {
      const mais  = e.target.closest('[data-mais]');
      const menos = e.target.closest('[data-menos]');
      if (mais)  alterarQty(mais.getAttribute('data-mais'), +1);
      if (menos) alterarQty(menos.getAttribute('data-menos'), -1);
    });

    // Cancelar venda
    document.getElementById('pdvVendasHoje')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-cancelar]');
      if (btn) cancelarVenda(btn.getAttribute('data-cancelar'));
    });

    // Categorias
    document.getElementById('pdvCategorias')?.addEventListener('click', e => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      _categoria = chip.getAttribute('data-cat');
      renderCategorias();
      renderGrade();
    });

    // Busca
    let debounce;
    document.getElementById('pdvBusca')?.addEventListener('input', e => {
      clearTimeout(debounce);
      const valor = e.target.value;
      debounce = setTimeout(() => { _busca = valor; renderGrade(); }, 160);
    });

    document.getElementById('pdvOcultarEsgotados')?.addEventListener('change', renderGrade);

    // Formas de pagamento
    document.getElementById('pdvPagamentos')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-pag]');
      if (!btn) return;
      _pagamento = btn.getAttribute('data-pag');
      document.querySelectorAll('#pdvPagamentos .pdv-pag').forEach(b =>
        b.classList.toggle('pdv-pag--ativo', b === btn));
      mostrarErro('');
      renderTotais();
    });

    // Campos de dinheiro: aceitam vírgula (teclado pt-BR) e recusam letras
    document.querySelectorAll('[data-moeda]').forEach(campo => {
      campo.addEventListener('input', () => {
        const limpo = campo.value.replace(/[^\d.,]/g, '');
        if (limpo !== campo.value) campo.value = limpo;
        mostrarErro('');
        renderTotais();
      });
    });
    document.getElementById('pdvParcelas')?.addEventListener('change', e => {
      _parcelas = parseInt(e.target.value, 10) || 1;
      renderTotais();
    });

    document.getElementById('btnLimparCarrinho')?.addEventListener('click', limparCarrinho);
    document.getElementById('btnConfirmar')?.addEventListener('click', confirmarVenda);
    document.getElementById('btnRecarregar')?.addEventListener('click', async () => {
      await Promise.all([carregarEstoque(), carregarVendasHoje()]);
      toast('Estoque e vendas atualizados.');
    });

    // Recibo
    document.querySelectorAll('[data-fechar-recibo]').forEach(el =>
      el.addEventListener('click', fecharRecibo));
    document.getElementById('btnImprimirRecibo')?.addEventListener('click', () => window.print());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') fecharRecibo();
    });

    // Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = 'index.html';
    });
  }

  /* ══════════ INICIALIZAÇÃO ══════════ */

  document.addEventListener('DOMContentLoaded', async () => {
    // Guarda de sessão — mesma do restante do painel
    const { data: sessao } = await supabaseClient.auth.getSession();
    if (!sessao?.session) { window.location.href = 'index.html'; return; }

    // Guarda de admin: só a conta da Virtù opera o PDV
    const { data: ehAdmin } = await supabaseClient.rpc('is_virtu_admin');
    if (!ehAdmin) {
      await supabaseClient.auth.signOut();
      window.location.href = 'index.html';
      return;
    }

    carregarCarrinho();
    ligarEventos();

    await Promise.all([carregarTaxas(), carregarEstoque(), carregarVendasHoje()]);
    iniciarRealtime();
  });

})();
