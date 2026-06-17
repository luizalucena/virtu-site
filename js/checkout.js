/* ============================================================
   VIRTÙ — Checkout JavaScript
   Frete: Todo o Nordeste. Frete grátis automático para Grande JP.
   Pagamento: ASAAS v3 via Supabase Edge Function
   ============================================================ */

// URL da Edge Function do Supabase
const EDGE_FUNCTION_URL = 'https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/processar-pagamento';

// ── CONSTANTES DE FRETE ──────────────────────────────────────
// Valores de referência (cálculo real feito pelo Edge Function calcular-frete)
const FRETE_STANDARD  = 0;     // Grande JP: grátis
const FRETE_NORDESTE  = 18.00; // Restante do Nordeste
const FRETE_MOTOBOY   = 15.00; // Motoboy expresso em João Pessoa

// Grande JP — frete grátis: João Pessoa, Cabedelo, Santa Rita, Bayeux, Conde
const GRANDE_JP_RANGES = [
  { min: 58000000, max: 58099999 }, // João Pessoa
  { min: 58102000, max: 58109999 }, // Cabedelo
  { min: 58300000, max: 58339999 }, // Santa Rita
  { min: 58400000, max: 58419999 }, // Bayeux
  { min: 58065000, max: 58066999 }, // Conde
];
function isGrandeJP(cep) {
  const n = parseInt(String(cep).replace(/\D/g, ''), 10);
  return GRANDE_JP_RANGES.some(r => n >= r.min && n <= r.max);
}

const NORDESTE_STATES = ['AL','BA','CE','MA','PB','PE','PI','RN','SE'];

// ── ESTADO GLOBAL DO CHECKOUT ───────────────────────────────
let freteValorSelecionado = FRETE_STANDARD;
let freteBase             = FRETE_STANDARD; // frete sem cupom (referência)
let baseTotal             = 0;              // subtotal + gift wrap, sem frete
let freteCalculado        = false;          // flag: frete foi calculado com sucesso

// ── ESTADO DO CUPOM ─────────────────────────────────────────
let cupomAplicado = null; // { codigo, tipo, valor } ou null

// ── PROGRAMA DE FIDELIDADE ───────────────────────────────────
let descontoFidelidade = 0;    // R$150 quando aplicável na 10ª compra
let currentUserId      = null; // UUID do usuário autenticado

// ── AJUSTE POR MÉTODO DE PAGAMENTO ──────────────────────────
// Edite aqui (e no processar-pagamento/index.ts) quando mudar as regras.
//   PIX:    −5% sobre o subtotal (desconto)
//   Débito: +10% sobre o subtotal (acréscimo)
//   Crédito:+10% sobre o subtotal (acréscimo) — parcelamento divide o total
const AJUSTE_METODO = {
  pix:    -0.05,  // 5% de DESCONTO
  debito:  0.10,  // 10% de ACRÉSCIMO
  cartao:  0.10,  // 10% de ACRÉSCIMO
};

/**
 * Calcula o preço final aplicando o ajuste do método de pagamento.
 * O ajuste incide sobre o subtotalLiquido (produtos − descontos).
 * O frete é somado depois, sem ajuste — ele é custo fixo de logística.
 *
 * @param {number} subtotalLiquido  Subtotal após cupom e fidelidade
 * @param {number} freteReal        Valor do frete selecionado
 * @param {'pix'|'debito'|'cartao'} metodo
 * @param {number} [parcelas]       Número de parcelas (cartão, 1..12)
 * @returns {{ valorFinal, diff, ehDesconto, pct, valorPorParcela }}
 */
function calcularPreco(subtotalLiquido, freteReal, metodo, parcelas = 1) {
  const ajuste = AJUSTE_METODO[metodo] ?? 0;
  const sub    = Math.max(0, subtotalLiquido);

  // Subtotal ajustado arredondado para 2 casas
  const subAjustado  = Math.round(sub * (1 + ajuste) * 100) / 100;
  const valorFinal   = subAjustado + freteReal;
  const diff         = +(subAjustado - sub).toFixed(2); // negativo = desconto
  const n            = Math.max(1, Math.min(parseInt(parcelas) || 1, 12));

  return {
    valorFinal,
    diff,
    ehDesconto:     ajuste < 0,
    pct:            Math.abs(ajuste * 100),
    valorPorParcela: metodo === 'cartao' ? +(valorFinal / n).toFixed(2) : null,
  };
}

// Método de pagamento ativo (sincronizado com a aba selecionada)
let metodoAtivo = 'cartao'; // padrão: aba Cartão está ativa no HTML

// ── AUTH GATE: redireciona para login se não autenticada ─────
// Executa fora do DOMContentLoaded para bloquear o mais cedo possível.
(async function checkAuthGate() {
  try {
    // Aguarda supabaseClient estar disponível (pode carregar levemente depois)
    let tentativas = 0;
    while (typeof supabaseClient === 'undefined' && tentativas++ < 30) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (typeof supabaseClient === 'undefined') {
      window.location.href = 'conta.html?redirect=checkout.html';
      return;
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      window.location.href = 'conta.html?redirect=checkout.html';
      return;
    }
    // Auth OK → exibe o conteúdo (remove o anti-flash)
    document.body.style.opacity = '1';
  } catch {
    window.location.href = 'conta.html?redirect=checkout.html';
  }
})();

document.addEventListener('DOMContentLoaded', () => {

  const CART_KEY = 'virtu_cart';

  function formatCurrency(v) {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Mascara CPF para exibição conforme LGPD: 123.***.***-00
   * Os 3 dígitos iniciais e os 2 finais ficam visíveis; os do meio são ocultados.
   */
  function maskCpf(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    if (d.length !== 11) return cpf || '—';
    return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  }

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
  }

  // ── RENDERIZA RESUMO DO PEDIDO ───────────────────────────
  function renderOrderSummary(cart, freteGratis = 300) {
    const itemsEl    = document.getElementById('checkoutItems');
    const subtotalEl = document.getElementById('checkoutSubtotal');
    const freteEl    = document.getElementById('checkoutFreteLabel');
    const totalEl    = document.getElementById('checkoutTotal');
    const installEl  = document.getElementById('checkoutInstallments');

    if (!cart.length) return;

    if (itemsEl) {
      itemsEl.innerHTML = cart.map(item => {
        const imgStyle = item.imagem_url
          ? `background:url('${item.imagem_url}') center/cover no-repeat`
          : item.imagem_placeholder
            ? `background:${item.imagem_placeholder}`
            : 'background:linear-gradient(135deg,#E8E0D5,#D4CCC0)';
        return `
          <div class="checkout-order-item">
            <div class="checkout-order-item__img" style="${imgStyle}"></div>
            <div class="checkout-order-item__info">
              <p class="checkout-order-item__name">${item.nome || 'Produto'}</p>
              <p class="checkout-order-item__meta">${[item.cor_nome, item.tamanho].filter(Boolean).join(' · ')} · Qtd: ${item.qty || 1}</p>
            </div>
            <p class="checkout-order-item__price">${formatCurrency((item.preco || 0) * (item.qty || 1))}</p>
          </div>`;
      }).join('');
    }

    const subtotal = cart.reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);

    let giftExtra = 0;
    try {
      const gd = JSON.parse(localStorage.getItem('virtu_gift') || 'null');
      if (gd?.ativo) giftExtra = parseFloat(gd.preco) || 0;
    } catch {}

    baseTotal = subtotal + giftExtra;

    // Frete ainda não calculado (aguarda CEP)
    const frete   = 0;
    const total   = baseTotal + frete;

    if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
    if (freteEl)    { freteEl.textContent = '—'; freteEl.classList.remove('checkout-order-summary__free'); }
    // Armazena base para uso pela atualizarTaxaETotal(); o total exibido
    // será atualizado com a taxa após a função ser definida (chamada pelo frete).
    if (totalEl)    { totalEl.dataset.baseTotal = String(total); }
  }

  // ── CALCULA DESCONTO DO CUPOM (apenas tipos percentual/fixo) ──
  function calcularDesconto(subtotalParaDesconto) {
    if (!cupomAplicado || cupomAplicado.tipo === 'frete') return 0;
    if (cupomAplicado.tipo === 'percentual') {
      return Math.min(subtotalParaDesconto, subtotalParaDesconto * cupomAplicado.valor / 100);
    }
    return Math.min(subtotalParaDesconto, cupomAplicado.valor);
  }

  // ── FRETE EFETIVO (0 se cupom de frete ativo) ─────────────
  function freteEfetivo() {
    return (cupomAplicado?.tipo === 'frete') ? 0 : freteValorSelecionado;
  }

  // ── ATUALIZA LINHA DE DESCONTO NO RESUMO ─────────────────
  function atualizarLinhaDesconto() {
    const descontoLine  = document.getElementById('checkoutDescontoLine');
    const descontoLabel = document.getElementById('checkoutDescontoLabel');
    const descontoEl    = document.getElementById('checkoutDesconto');
    if (!descontoLine) return;

    const cupomDesc = calcularDesconto(baseTotal);
    const totalDesc = cupomDesc + descontoFidelidade;

    if (totalDesc > 0) {
      descontoLine.style.display = '';
      let label = '';
      const temCupom      = cupomAplicado && cupomAplicado.tipo !== 'frete';
      const temFidelidade = descontoFidelidade > 0;
      if (temCupom && temFidelidade) {
        label = `Descontos (${cupomAplicado.codigo} + Fidelidade 🎁)`;
      } else if (temCupom) {
        label = `Desconto (${cupomAplicado.codigo})`;
      } else if (temFidelidade) {
        label = 'Desconto Fidelidade 🎁';
      }
      if (descontoLabel) descontoLabel.textContent = label;
      if (descontoEl)    descontoEl.textContent     = `−${formatCurrency(totalDesc)}`;
    } else {
      descontoLine.style.display = 'none';
    }
  }

  // ── ATUALIZA TOTAL COM FRETE ─────────────────────────────
  function updateTotalWithFrete(freteValor) {
    freteValorSelecionado = freteValor;
    const frete   = freteEfetivo();
    const desconto = calcularDesconto(baseTotal);
    const totalBase = Math.max(0, baseTotal - desconto - descontoFidelidade) + frete;
    const freteEl   = document.getElementById('checkoutFreteLabel');
    const totalEl   = document.getElementById('checkoutTotal');

    atualizarLinhaDesconto();

    if (freteEl) {
      freteEl.textContent = frete === 0 ? 'Grátis' : formatCurrency(frete);
      freteEl.classList.toggle('checkout-order-summary__free', frete === 0);
    }

    // Salva base (sem taxa) no dataset para referência rápida
    if (totalEl) totalEl.dataset.baseTotal = String(totalBase);

    // Recalcula exibição de taxa + total com o método ativo
    atualizarTaxaETotal();
  }

  // ── ATUALIZA LINHA DE AJUSTE E TOTAL FINAL ────────────────
  // Chamada sempre que: frete muda, aba de pagamento muda, nº de parcelas muda.
  // PIX → desconto verde (−5%); Débito/Crédito → acréscimo laranja (+10%).
  function atualizarTaxaETotal() {
    const descontoCupom   = calcularDesconto(baseTotal);
    const freteReal       = freteEfetivo();
    const subtotalLiquido = Math.max(0, baseTotal - descontoCupom - descontoFidelidade);

    const totalEl   = document.getElementById('checkoutTotal');
    const taxaLine  = document.getElementById('checkoutTaxaLine');
    const taxaLabel = document.getElementById('checkoutTaxaLabel');
    const taxaEl    = document.getElementById('checkoutTaxaValor');
    const installEl = document.getElementById('checkoutInstallments');

    if (subtotalLiquido <= 0 && freteReal <= 0) {
      if (totalEl)  totalEl.textContent = formatCurrency(0);
      if (taxaLine) taxaLine.style.display = 'none';
      return;
    }

    const parcelas = parseInt(document.getElementById('installments')?.value || '1');
    const preco    = calcularPreco(subtotalLiquido, freteReal, metodoAtivo, parcelas);

    // ── Linha de ajuste (sempre visível quando há subtotal) ──
    if (taxaLine) taxaLine.style.display = '';

    if (preco.ehDesconto) {
      // PIX — desconto verde
      if (taxaLabel) taxaLabel.innerHTML =
        `🎉 Desconto PIX <span style="color:#999;font-size:.78rem;font-weight:400">(${preco.pct.toFixed(0)}% de desconto)</span>`;
      if (taxaEl) {
        taxaEl.textContent = `−${formatCurrency(Math.abs(preco.diff))}`;
        taxaEl.style.color = '#2e7d32';
      }
    } else {
      // Débito / Crédito — acréscimo laranja
      const eDebito   = metodoAtivo === 'debito';
      const labelHtml = eDebito
        ? `🏦 Acréscimo Débito <span style="color:#999;font-size:.78rem;font-weight:400">(+${preco.pct.toFixed(0)}%)</span>`
        : parcelas === 1
          ? `💳 Acréscimo Crédito <span style="color:#999;font-size:.78rem;font-weight:400">(+${preco.pct.toFixed(0)}%)</span>`
          : `💳 Acréscimo Crédito ${parcelas}x <span style="color:#999;font-size:.78rem;font-weight:400">(+${preco.pct.toFixed(0)}%)</span>`;
      if (taxaLabel) taxaLabel.innerHTML = labelHtml;
      if (taxaEl) {
        taxaEl.textContent = `+${formatCurrency(preco.diff)}`;
        taxaEl.style.color = '#C0824A';
      }
    }

    // ── Total final ────────────────────────────────────────
    if (totalEl) {
      totalEl.textContent        = formatCurrency(preco.valorFinal);
      totalEl.dataset.valorFinal = String(preco.valorFinal);
    }

    // ── Comparativo de formas de pagamento ─────────────────
    // Mostra o subtotal base + nota do ajuste que será aplicado
    const compareEl       = document.getElementById('checkoutPaymentCompare');
    const comparePixEl    = document.getElementById('comparePix');
    const compareCardEl   = document.getElementById('compareCard');
    const compareCardParc = document.getElementById('compareCardParc');
    const compareDebitoEl = document.getElementById('compareDebito');
    if (compareEl && subtotalLiquido > 0) {
      const baseComFrete  = subtotalLiquido + freteReal;
      const totalCard     = subtotalLiquido * 1.10 + freteReal;
      const parcela12     = totalCard / 12;
      if (comparePixEl)    comparePixEl.textContent    = formatCurrency(baseComFrete);
      if (compareCardEl)   compareCardEl.textContent   = formatCurrency(totalCard);
      if (compareDebitoEl) compareDebitoEl.textContent = formatCurrency(totalCard);
      if (compareCardParc) compareCardParc.textContent = `até 12x de ${formatCurrency(parcela12)}`;
      compareEl.style.display = '';
    } else if (compareEl) {
      compareEl.style.display = 'none';
    }

    // ── Atualiza seletor de parcelas (apenas no cartão) ────
    if (installEl && metodoAtivo === 'cartao') {
      updateInstallments(subtotalLiquido, freteReal);
    } else if (installEl && metodoAtivo !== 'cartao') {
      const installParentEl = document.getElementById('checkoutInstallments');
      if (installParentEl) installParentEl.textContent = '';
    }
  }

  // ── CUPOM: VALIDAÇÃO E APLICAÇÃO ─────────────────────────
  async function initCupom() {
    const form    = document.getElementById('cupomForm');
    const input   = document.getElementById('cupomInput');
    const btn     = document.getElementById('cupomBtn');
    const msg     = document.getElementById('cupomMsg');
    if (!form) return;

    function setMsg(texto, tipo) {
      if (!msg) return;
      msg.textContent = texto;
      msg.className = `checkout-cupom__msg checkout-cupom__msg--${tipo}`;
    }

    function removerCupom() {
      cupomAplicado = null;
      if (input) input.value = '';
      if (btn)   { btn.textContent = 'Aplicar'; btn.style.background = ''; }
      setMsg('', 'ok');
      atualizarLinhaDesconto();
      updateTotalWithFrete(freteBase); // restaura frete original
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const codigo = (input?.value || '').trim().toUpperCase();

      // Se já tem cupom aplicado, remover ao clicar em "Remover"
      if (cupomAplicado) { removerCupom(); return; }

      if (!codigo) { setMsg('Digite um código de cupom.', 'erro'); return; }

      btn.disabled    = true;
      btn.textContent = '…';
      setMsg('', 'ok');

      try {
        // Get user email for per-customer limit check
        const { data: { user } } = await supabaseClient.auth.getUser();
        const emailUser = user?.email || document.getElementById('emailInput')?.value?.trim() || null;
        const { data, error } = await supabaseClient.rpc('validar_cupom', { p_codigo: codigo, p_email: emailUser });
        if (error) throw error;

        if (!data.valido) {
          setMsg(data.erro || 'Cupom inválido.', 'erro');
          return;
        }

        // Verificar pedido mínimo
        if (data.valor_minimo > 0 && baseTotal < data.valor_minimo) {
          setMsg(`Pedido mínimo de ${formatCurrency(data.valor_minimo)} para este cupom.`, 'erro');
          return;
        }

        // Aplicar cupom
        cupomAplicado = { codigo: data.codigo, tipo: data.tipo, valor: data.valor };

        // Cupom de frete: verificar se frete já é grátis pela região
        if (data.tipo === 'frete') {
          if (freteBase === 0) {
            // Frete já é grátis automaticamente (ex: Grande João Pessoa)
            // Não precisa aplicar cupom — informa a cliente e encerra
            cupomAplicado = null;
            setMsg('✓ O frete para sua região já é gratuito! Não precisa de cupom.', 'ok');
            btn.disabled = false;
            if (btn.textContent === '…') btn.textContent = 'Aplicar';
            return;
          }
        }

        let labelDesc;
        if (data.tipo === 'frete') {
          labelDesc = 'Frete grátis!';
        } else if (data.tipo === 'percentual') {
          labelDesc = `${data.valor}% de desconto`;
        } else {
          labelDesc = `${formatCurrency(data.valor)} de desconto`;
        }

        setMsg(`✓ Cupom aplicado: ${labelDesc}`, 'ok');
        if (btn) { btn.textContent = 'Remover'; btn.style.background = '#c0392b'; }

        // Para tipo 'frete': zera o frete no display, mantém freteValorSelecionado como referência
        atualizarLinhaDesconto();
        updateTotalWithFrete(freteValorSelecionado); // usa freteEfetivo() internamente

      } catch (err) {
        setMsg('Erro ao validar o cupom. Tente novamente.', 'erro');
      } finally {
        btn.disabled = false;
        if (btn.textContent === '…') btn.textContent = 'Aplicar';
      }
    });
  }

  // ── PARCELAS DINÂMICAS (acréscimo fixo +10% sobre subtotal) ─
  // O total com acréscimo é sempre subtotalLiquido×1,10 + frete,
  // independente do número de parcelas — divide-se apenas pelo N.
  function updateInstallments(subtotalLiquido, freteReal) {
    const sel = document.getElementById('installments');
    if (!sel) return;
    const parcelaAtual = parseInt(sel.value || '1');
    const totalComAcrescimo = calcularPreco(subtotalLiquido, freteReal, 'cartao', 1).valorFinal;
    sel.innerHTML = '';
    for (let i = 1; i <= 12; i++) {
      const valParcela = +(totalComAcrescimo / i).toFixed(2);
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i === 1
        ? `1x de ${formatCurrency(totalComAcrescimo)} (+10%)`
        : `${i}x de ${formatCurrency(valParcela)} (+10% = ${formatCurrency(totalComAcrescimo)})`;
      if (i === parcelaAtual) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ── REDIRECIONA SE CARRINHO VAZIO ────────────────────────
  if (getCart().length === 0) {
    window.location.href = 'carrinho.html';
  }

  // ── CARREGA DADOS INICIAIS DO SUPABASE ───────────────────
  (async () => {
    renderOrderSummary(getCart());
    await initCupom(); // campo de cupom no resumo do pedido

    // Busca status de fidelidade da cliente autenticada
    try {
      if (typeof supabaseClient !== 'undefined') {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
          currentUserId = user.id;

          const { data: fid } = await supabaseClient
            .rpc('fidelidade_status', { p_user_id: user.id });

          if (fid) {
            const compras = fid.compras_pagas ?? 0;
            const restam  = fid.restam_para_100 ?? (10 - compras % 10);

            // Injeta banner de fidelidade acima do resumo do pedido
            const summaryEl = document.getElementById('checkoutOrderSummary') ||
                              document.querySelector('.checkout-order-summary') ||
                              document.getElementById('checkoutItems')?.closest('section, .checkout-section, aside');

            // Valores do programa (usa os do DB se disponíveis, senão fallback)
            const FIDVAL = Number(fid.valor_desconto      ?? 150);
            const FIDMIN = Number(fid.valor_minimo_premio ?? 499);

            if (summaryEl && restam > 0) {
              const pct = Math.min(100, ((compras % 10) / 10) * 100);

              // Monta mensagem diferenciada para 10ª compra (com verificação de mínimo)
              let msg;
              let bannerBg    = '#EFF6FF';
              let bannerBdr   = '#BFDBFE';
              let bannerTxt   = '#1E40AF';
              let barColor    = '#3B82F6';

              if (restam === 1 && compras % 10 === 9) {
                if (baseTotal >= FIDMIN) {
                  // Qualificada: aplica desconto
                  msg      = `🎁 Esta é sua <strong>10ª compra</strong>! <strong>R$${FIDVAL} de desconto</strong> aplicado automaticamente!`;
                  bannerBg  = '#D1FAE5'; bannerBdr = '#6EE7B7';
                  bannerTxt = '#065F46'; barColor  = '#059669';
                } else {
                  // Pedido mínimo não atingido
                  const falta = (FIDMIN - baseTotal).toFixed(2).replace('.', ',');
                  msg      = `🎁 Esta é sua <strong>10ª compra</strong>! Adicione mais <strong>R$ ${falta}</strong> em produtos para ganhar <strong>R$${FIDVAL} de desconto de fidelidade</strong> (mín. R$${FIDMIN}).`;
                  bannerBg  = '#FEF3C7'; bannerBdr = '#FDE68A';
                  bannerTxt = '#92400E'; barColor  = '#F59E0B';
                }
              } else {
                msg = `🏅 Programa Fidelidade — <strong>${compras % 10}/10 compras</strong>. Faltam <strong>${restam}</strong> para R$${FIDVAL} de desconto! (mín. R$${FIDMIN})`;
              }

              const banner = document.createElement('div');
              banner.id = 'fidelidadeBanner';
              banner.style.cssText = `
                background:${bannerBg};border:1px solid ${bannerBdr};
                border-radius:4px;padding:10px 14px;font-size:0.82rem;
                color:${bannerTxt};margin-bottom:12px;line-height:1.5;
              `;
              banner.innerHTML = `<div>${msg}</div>
                <div style="background:#E5E7EB;border-radius:100px;height:4px;margin-top:8px;overflow:hidden">
                  <div style="background:${barColor};height:100%;width:${pct}%;transition:width 0.4s"></div>
                </div>`;
              summaryEl.insertAdjacentElement('beforebegin', banner);
            }

            // Esta é a 10ª compra → aplica R$150 (somente se mínimo R$499 atingido)
            if (restam === 1 && compras > 0 && compras % 10 === 9) {
              if (baseTotal >= FIDMIN) {
                descontoFidelidade = FIDVAL;
                updateTotalWithFrete(freteValorSelecionado);
              }
              // Se não atingir mínimo: desconto não aplicado; DB também reverterá
              // o contador quando processar-pagamento chamar registrar_compra_fidelidade
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Fidelidade]', e);
    }

    // Auto-aplica cupom validado no carrinho
    try {
      const savedCoupon = JSON.parse(sessionStorage.getItem('virtu_coupon') || localStorage.getItem('virtu_coupon') || 'null');
      if (savedCoupon?.code && (savedCoupon?.pct || savedCoupon?.valor)) {
        const input = document.getElementById('cupomInput');
        if (input) input.value = savedCoupon.code;
        // Preserva tipo e valor exatos do cupom validado no carrinho
        const tipo  = savedCoupon.tipo  || 'percentual';
        const valor = tipo === 'percentual' ? (savedCoupon.pct || 0) : (savedCoupon.valor || 0);
        cupomAplicado = { codigo: savedCoupon.code, tipo, valor };
        const label = tipo === 'percentual' ? `${valor}% de desconto`
                    : tipo === 'fixo'       ? `R$${valor} de desconto`
                    : 'Frete grátis';
        const msgEl = document.getElementById('cupomMsg');
        if (msgEl) {
          msgEl.textContent = `✓ Cupom ${savedCoupon.code} aplicado — ${label}`;
          msgEl.style.color = '#27ae60';
          msgEl.style.display = 'block';
        }
        renderOrderSummary(getCart());
        // Atualiza linha de desconto imediatamente
        updateTotalWithFrete(freteValorSelecionado);
      }
    } catch {}
  })();

  // ── MENSAGEM INLINE (substitui alert) ────────────────────
  function showCheckoutMsg(msg, tipo = 'erro') {
    let el = document.getElementById('checkoutMsgInline');
    if (!el) {
      el = document.createElement('div');
      el.id = 'checkoutMsgInline';
      el.style.cssText = [
        'border-radius:4px', 'padding:12px 16px', 'font-size:0.83rem',
        'line-height:1.5', 'margin:12px 0', 'display:none',
      ].join(';');
      // Insere antes do botão de finalizar
      const submitBtn = document.getElementById('submitOrder');
      if (submitBtn?.parentNode) {
        submitBtn.parentNode.insertBefore(el, submitBtn);
      } else {
        document.body.appendChild(el);
      }
    }
    const styles = {
      erro:  { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
      aviso: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
      ok:    { bg: '#D1FAE5', color: '#065F46', border: '#6EE7B7' },
    };
    const s = styles[tipo] || styles.erro;
    el.style.background   = s.bg;
    el.style.color        = s.color;
    el.style.border       = `1px solid ${s.border}`;
    el.style.display      = 'block';
    el.textContent        = msg;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Auto-esconde mensagens de sucesso
    if (tipo === 'ok') setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  // ── STEPS ───────────────────────────────────────────────
  let currentStep = 1;

  function goToStep(step) {
    for (let i = 1; i <= 3; i++) {
      const section  = document.getElementById(`step${i}`);
      const content  = document.getElementById(`step${i}Content`);
      const summary  = document.getElementById(`step${i}Summary`);
      const stepEl   = document.querySelector(`[data-step="${i}"]`);
      const editBtn  = document.getElementById(`editStep${i}`);
      if (!section) continue;

      if (i === step) {
        section.classList.remove('checkout-section--locked');
        content?.removeAttribute('hidden');
        summary?.setAttribute('hidden', '');
        editBtn?.setAttribute('hidden', '');
        stepEl?.classList.add('checkout-step--active');
        stepEl?.classList.remove('checkout-step--done');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (i < step) {
        section.classList.remove('checkout-section--locked');
        content?.setAttribute('hidden', '');
        summary?.removeAttribute('hidden');
        editBtn?.removeAttribute('hidden');
        stepEl?.classList.remove('checkout-step--active');
        stepEl?.classList.add('checkout-step--done');
        const numEl1 = stepEl?.querySelector('.checkout-step__num');
        if (numEl1) numEl1.textContent = '✓';
      } else {
        section.classList.add('checkout-section--locked');
        content?.setAttribute('hidden', '');
        summary?.setAttribute('hidden', '');
        editBtn?.setAttribute('hidden', '');
        stepEl?.classList.remove('checkout-step--active', 'checkout-step--done');
        const numEl2 = stepEl?.querySelector('.checkout-step__num');
        if (numEl2) numEl2.textContent = i;
      }
    }
    currentStep = step;
  }

  // ── STEP 1: IDENTIFICAÇÃO ────────────────────────────────
  document.getElementById('nextStep1')?.addEventListener('click', () => {
    const firstName = document.getElementById('firstName')?.value.trim();
    const lastName  = document.getElementById('lastName')?.value.trim();
    const email     = document.getElementById('email')?.value.trim();
    const cpf       = document.getElementById('cpf')?.value.trim();
    const phone     = document.getElementById('phone')?.value.trim();

    if (!firstName || !lastName || !email || !cpf || !phone) {
      highlightEmptyFields(['firstName', 'lastName', 'email', 'cpf', 'phone']);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFreteMsg('E-mail inválido.', 'error');
      document.getElementById('email')?.classList.add('error');
      return;
    }
    if (cpf.replace(/\D/g, '').length !== 11) {
      showFreteMsg('CPF inválido — informe os 11 dígitos.', 'error');
      document.getElementById('cpf')?.classList.add('error');
      return;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      showFreteMsg('Telefone inválido.', 'error');
      document.getElementById('phone')?.classList.add('error');
      return;
    }

    const sumEl = document.getElementById('step1SummaryText');
    // LGPD: exibe CPF mascarado no resumo de confirmação
    if (sumEl) sumEl.textContent = `${firstName} ${lastName} · ${email} · ${maskCpf(cpf)}`;
    goToStep(2);
  });

  document.getElementById('editStep1')?.addEventListener('click', () => goToStep(1));

  // ── STEP 2: ENTREGA + FRETE ──────────────────────────────
  document.getElementById('nextStep2')?.addEventListener('click', () => {
    const cepRaw = document.getElementById('cep')?.value.replace(/\D/g, '');
    const street = document.getElementById('street')?.value.trim();
    const number = document.getElementById('number')?.value.trim();
    const city   = document.getElementById('city')?.value.trim();

    const neighborhood = document.getElementById('neighborhood')?.value.trim();
    if (!cepRaw || !street || !number || !city || !neighborhood) {
      highlightEmptyFields(['cep', 'street', 'number', 'city', 'neighborhood']);
      return;
    }

    // Garante que o frete foi calculado
    if (!freteCalculado) {
      showFreteMsg('Clique em "Buscar" para calcular o frete antes de continuar.', 'error');
      document.getElementById('lookupCep')?.focus();
      return;
    }

    const state = document.getElementById('state')?.value;
    const shippingName = document.querySelector('input[name="shipping"]:checked')
      ?.closest('.shipping-option')?.querySelector('.shipping-option__name')?.textContent || 'Entrega padrão';

    const sumEl = document.getElementById('step2SummaryText');
    if (sumEl) sumEl.textContent = `${street}, ${number} · ${city}/${state} · ${document.getElementById('cep')?.value} · ${shippingName}`;
    goToStep(3);
  });

  document.getElementById('editStep2')?.addEventListener('click', () => goToStep(2));

  // ── CEP: VALIDAÇÃO JOÃO PESSOA + VIACEP ─────────────────
  function showFreteMsg(msg, type = 'error') {
    const el = document.getElementById('freteMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
    el.style.color = type === 'error' ? 'var(--color-error, #c62828)' : 'var(--color-success, #2e7d32)';
  }

  const FRETE_EDGE = 'https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/calcular-frete';

  async function calcularFrete(cep) {
    const freteResult = document.getElementById('freteResult');
    const freteOpcoes = document.getElementById('freteOpcoes');
    const freteMsg    = document.getElementById('freteMsg');

    if (freteOpcoes) freteOpcoes.innerHTML = '<p style="font-size:0.82rem;color:#888;padding:0.5rem 0">Consultando transportadoras…</p>';
    if (freteResult) freteResult.style.display = 'block';
    if (freteMsg)    freteMsg.style.display    = 'none';

    const subtotal = getCart().reduce((s, i) => s + (i.preco || 0) * (i.qty || 1), 0);

    try {
      const res  = await fetch(FRETE_EDGE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep, valor: subtotal }),
      });
      const data = await res.json();

      if (data.error || !data.opcoes?.length) {
        if (freteResult) freteResult.style.display = 'none';
        showFreteMsg(data.error || 'Nenhuma opção de entrega disponível para este CEP.', 'error');
        freteCalculado = false;
        return;
      }

      // Renderiza cards de opção
      const cards = data.opcoes.map((op, i) => `
        <label class="shipping-option" style="cursor:pointer;display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;border:1px solid #e8ddd4;border-radius:4px;margin-bottom:0.5rem;background:#fff;transition:border-color 0.15s">
          <input type="radio" name="shipping" value="${op.id}" class="shipping-option__radio"
            data-preco="${op.preco}" ${i === 0 ? 'checked' : ''} style="accent-color:#1c2e3e;flex-shrink:0" />
          <div class="shipping-option__info" style="flex:1;min-width:0">
            <span class="shipping-option__name" style="display:block;font-size:0.85rem;font-weight:500;color:#1c2e3e">${op.nome}</span>
            <span class="shipping-option__time" style="display:block;font-size:0.75rem;color:#aaa;margin-top:0.1rem">${op.descricao ? op.descricao + ' · ' : ''}${op.prazo}</span>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span style="font-size:0.9rem;font-weight:600;color:${op.preco === 0 ? '#27ae60' : '#1c2e3e'}">${op.precoFormatado}</span>
            ${op.precoOriginal ? `<span style="display:block;font-size:0.72rem;color:#aaa;text-decoration:line-through">${op.precoOriginal}</span>` : ''}
          </div>
        </label>`).join('');

      if (freteOpcoes) freteOpcoes.innerHTML = cards;

      // Exibe o campo de cupom agora que o CEP e o frete são conhecidos
      const cupomWrap = document.getElementById('cupomWrap');
      if (cupomWrap) cupomWrap.style.display = '';

      // Seleciona a primeira opção por padrão
      const primeira = data.opcoes[0];
      freteBase = primeira.preco;
      freteCalculado = true;
      updateTotalWithFrete(primeira.preco);

      // Listener para troca de opção
      freteOpcoes?.querySelectorAll('input[name="shipping"]').forEach(radio => {
        radio.addEventListener('change', () => {
          freteBase = parseFloat(radio.dataset.preco) || 0;
          updateTotalWithFrete(freteBase);
        });
      });

    } catch (err) {
      console.error('[Frete]', err);
      if (freteResult) freteResult.style.display = 'none';
      showFreteMsg('Erro ao calcular frete. Verifique o CEP e tente novamente.', 'error');
      freteCalculado = false;
    }
  }

  document.getElementById('lookupCep')?.addEventListener('click', async () => {
    const cepInput = document.getElementById('cep');
    const cep = cepInput?.value.replace(/\D/g, '');
    if (cep.length !== 8) { cepInput?.classList.add('error'); return; }

    const btn = document.getElementById('lookupCep');
    btn.textContent = '...';
    btn.disabled = true;

    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) throw new Error('CEP não encontrado');

      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) { el.value = val; el.classList.add('success'); }
      };
      set('street',       data.logradouro);
      set('neighborhood', data.bairro);
      set('city',         data.localidade);
      const stateEl = document.getElementById('state');
      if (stateEl && data.uf) stateEl.value = data.uf;

      document.getElementById('number')?.focus();
    } catch {
      cepInput?.classList.add('error');
      showFreteMsg('CEP não encontrado. Verifique e tente novamente.', 'error');
    } finally {
      btn.textContent = 'Buscar';
      btn.disabled = false;
    }

    await calcularFrete(cep);
  });

  // Troca de opção de frete agora tratada dentro de calcularFrete() por listener dinâmico

  // Formata CEP
  document.getElementById('cep')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    this.value = v;
    this.classList.remove('error', 'success');
    // Esconde frete anterior ao digitar novo CEP
    freteCalculado = false;
    const _fr = document.getElementById('freteResult');
    const _fm = document.getElementById('freteMsg');
    if (_fr) _fr.style.display = 'none';
    if (_fm) _fm.style.display = 'none';
  });

  // ── LISTENER: MUDANÇA DE PARCELAS ────────────────────────
  // Quando a cliente troca o número de parcelas, recalcula a taxa
  // (cada opção tem taxa diferente: 1x = 4,99%, 12x = 16,97% etc.)
  document.getElementById('installments')?.addEventListener('change', () => {
    if (metodoAtivo === 'cartao') atualizarTaxaETotal();
  });

  // ── HIGHLIGHT CAMPOS VAZIOS ──────────────────────────────
  function highlightEmptyFields(ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) {
        el.classList.add('error');
        el.addEventListener('input', () => el.classList.remove('error'), { once: true });
      }
    });
    const first = ids.map(id => document.getElementById(id)).find(el => el && !el.value.trim());
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.focus();
  }

  // ── PAYMENT TABS ─────────────────────────────────────────
  document.querySelectorAll('.payment-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.payment-tab').forEach(t => {
        t.classList.remove('payment-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.payment-panel').forEach(p => p.classList.add('payment-panel--hidden'));
      tab.classList.add('payment-tab--active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById(tab.getAttribute('aria-controls'))?.classList.remove('payment-panel--hidden');

      // Atualiza método ativo e recalcula taxa + total
      metodoAtivo = tab.dataset.tab || 'cartao';
      atualizarTaxaETotal();
    });
  });

  // ── CARD PREVIEW ─────────────────────────────────────────
  // ── CARD PREVIEW — Crédito ───────────────────────────────
  function detectBrand(num) {
    if (num.startsWith('4'))       return 'VISA';
    if (/^5[1-5]/.test(num))      return 'MASTERCARD';
    if (num.startsWith('3'))       return 'AMEX';
    return 'CARTÃO';
  }

  document.getElementById('cardNumber')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 16);
    v = v.replace(/(.{4})/g, '$1 ').trim();
    this.value = v;
    document.getElementById('previewNumber').textContent = v || '•••• •••• •••• ••••';
    const brand = document.getElementById('previewBrand');
    if (brand) brand.textContent = detectBrand(v.replace(/\s/g, ''));
  });

  document.getElementById('cardName')?.addEventListener('input', function () {
    document.getElementById('previewName').textContent = this.value.toUpperCase() || 'SEU NOME';
  });

  document.getElementById('cardExpiry')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    this.value = v;
    document.getElementById('previewExpiry').textContent = v || 'MM/AA';
  });

  // ── CARD PREVIEW — Débito ────────────────────────────────
  document.getElementById('debitoNumber')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 16);
    v = v.replace(/(.{4})/g, '$1 ').trim();
    this.value = v;
    document.getElementById('previewNumberDebito').textContent = v || '•••• •••• •••• ••••';
    const brand = document.getElementById('previewBrandDebito');
    if (brand) brand.textContent = detectBrand(v.replace(/\s/g, ''));
  });

  document.getElementById('debitoName')?.addEventListener('input', function () {
    document.getElementById('previewNameDebito').textContent = this.value.toUpperCase() || 'SEU NOME';
  });

  document.getElementById('debitoExpiry')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    this.value = v;
    document.getElementById('previewExpiryDebito').textContent = v || 'MM/AA';
  });

  // Formata CPF e telefone
  document.getElementById('cpf')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    this.value = v;
  });
  document.getElementById('phone')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
    this.value = v;
  });

  // ── BOTÃO COPIAR PIX ─────────────────────────────────────
  document.getElementById('copiarPix')?.addEventListener('click', () => {
    const input = document.getElementById('pixCopiaECola');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = document.getElementById('copiarPix');
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  });

  // ── SUBMIT PEDIDO ─────────────────────────────────────────
  document.getElementById('submitOrder')?.addEventListener('click', async () => {
    const activeTab = document.querySelector('.payment-tab--active')?.dataset.tab;
    const btn = document.getElementById('submitOrder');

    // Validação: carrinho não pode estar vazio
    const cartCheck = getCart();
    if (!cartCheck || cartCheck.length === 0) {
      showCheckoutMsg('Seu carrinho está vazio. Adicione produtos antes de finalizar.', 'aviso');
      window.location.href = 'carrinho.html';
      return;
    }

    // Boleto não implementado — bloqueia
    if (activeTab === 'boleto') {
      showCheckoutMsg('Pagamento por boleto ainda não está disponível. Por favor, escolha PIX ou cartão de crédito.', 'aviso');
      return;
    }

    // Validação cartão crédito
    if (activeTab === 'cartao') {
      const num  = document.getElementById('cardNumber')?.value.trim();
      const name = document.getElementById('cardName')?.value.trim();
      const exp  = document.getElementById('cardExpiry')?.value.trim();
      const cvv  = document.getElementById('cardCvv')?.value.trim();
      if (!num || !name || !exp || !cvv) {
        highlightEmptyFields(['cardNumber', 'cardName', 'cardExpiry', 'cardCvv']);
        return;
      }
    }

    // Validação cartão débito
    if (activeTab === 'debito') {
      const num  = document.getElementById('debitoNumber')?.value.trim();
      const name = document.getElementById('debitoName')?.value.trim();
      const exp  = document.getElementById('debitoExpiry')?.value.trim();
      const cvv  = document.getElementById('debitoCvv')?.value.trim();
      if (!num || !name || !exp || !cvv) {
        highlightEmptyFields(['debitoNumber', 'debitoName', 'debitoExpiry', 'debitoCvv']);
        return;
      }
    }

    // Garante que o frete foi calculado
    const cepRaw = document.getElementById('cep')?.value.replace(/\D/g, '');
    if (!cepRaw) { showFreteMsg('Informe o CEP de entrega.', 'error'); goToStep(2); return; }
    if (!freteCalculado) { showFreteMsg('Clique em "Buscar" para calcular o frete antes de continuar.', 'error'); goToStep(2); return; }

    btn.innerHTML = 'Processando…';
    btn.disabled  = true;

    // Monta dados do cliente e endereço
    const cart            = getCart();
    const isPix           = activeTab === 'pix';
    const descontoCupom   = calcularDesconto(baseTotal);
    const freteReal       = freteEfetivo();

    // ── Calcula total final com ajuste por método ─────────
    // PIX −5%, Débito/Crédito +10% sobre o subtotalLiquido; frete sem ajuste.
    const subtotalLiquido = Math.max(0, baseTotal - descontoCupom - descontoFidelidade);
    const isDebito        = activeTab === 'debito';
    const metodoRepasse   = isPix ? 'pix' : isDebito ? 'debito' : 'cartao';
    const parcelasNum     = (isPix || isDebito) ? 1 : parseInt(document.getElementById('installments')?.value || '1', 10);
    const preco           = calcularPreco(subtotalLiquido, freteReal, metodoRepasse, parcelasNum);
    const finalTotal      = preco.valorFinal;

    // Email: usa SEMPRE o email da sessão autenticada como fonte autoritativa.
    // O campo do formulário pode ter sido editado pela cliente — isso evita
    // que notificações vão para um email diferente do login.
    let emailAuth = document.getElementById('email')?.value.trim() || '';
    try {
      const { data: { user: uAuth } } = await supabaseClient.auth.getUser();
      if (uAuth?.email) emailAuth = uAuth.email;
    } catch { /* usa valor do form como fallback */ }

    const cliente = {
      nome:     `${document.getElementById('firstName')?.value.trim()} ${document.getElementById('lastName')?.value.trim()}`.trim(),
      email:    emailAuth,
      cpf:      document.getElementById('cpf')?.value.trim(),
      telefone: document.getElementById('phone')?.value.trim(),
    };

    const endereco = {
      cep:         document.getElementById('cep')?.value.trim(),
      rua:         document.getElementById('street')?.value.trim(),
      numero:      document.getElementById('number')?.value.trim(),
      complemento: document.getElementById('complement')?.value.trim(),
      bairro:      document.getElementById('neighborhood')?.value.trim(),
      cidade:      document.getElementById('city')?.value.trim(),
      estado:      document.getElementById('state')?.value,
    };

    // ── Salva endereço para próxima compra ────────────────────
    if (typeof window.vtSalvarEndereco === 'function') {
      window.vtSalvarEndereco(endereco).catch(() => {});
    }

    // ── Monta payload base ───────────────────────
    const tipoEnvio = isPix ? 'pix' : isDebito ? 'debito' : 'cartao';

    const freteNome = document.querySelector('input[name="shipping"]:checked')
      ?.closest('label')
      ?.querySelector('.shipping-option__name')?.textContent?.trim()
      || document.querySelector('#freteOpcoes label')?.querySelector('span:first-of-type')?.textContent?.trim()
      || 'Entrega padrão';

    const payload = {
      tipo:                tipoEnvio,
      total:               finalTotal,
      subtotal:            baseTotal,
      frete:               freteReal,
      frete_selecionado:   freteNome,
      desconto:            descontoCupom,
      valor_sem_ajuste:    subtotalLiquido + freteReal,
      cupom_codigo:        cupomAplicado?.codigo || null,
      itens:               cart,
      cliente,
      endereco,
      user_id:             currentUserId || null,
      fidelidade_desconto: descontoFidelidade > 0,
    };

    // ── Cartão / Débito: inclui dados no payload para tokenização ASAAS ──
    // O ASAAS cuida da tokenização PCI no lado do servidor.
    if (!isPix) {
      // Lê os campos do painel correto (crédito ou débito)
      const numId    = isDebito ? 'debitoNumber'  : 'cardNumber';
      const nameId   = isDebito ? 'debitoName'    : 'cardName';
      const expiryId = isDebito ? 'debitoExpiry'  : 'cardExpiry';
      const cvvId    = isDebito ? 'debitoCvv'     : 'cardCvv';

      const expiry   = (document.getElementById(expiryId)?.value || '').split('/');
      const expiryMM = (expiry[0] || '').trim().padStart(2, '0');
      const expiryYY = expiry[1] ? '20' + expiry[1].trim() : '';

      payload.card_number       = document.getElementById(numId)?.value.replace(/\D/g, '');
      payload.card_holder_name  = document.getElementById(nameId)?.value.trim();
      payload.card_expiry_month = expiryMM;
      payload.card_expiry_year  = expiryYY;
      payload.card_cvv          = document.getElementById(cvvId)?.value.trim();
      payload.parcelas          = isDebito ? 1 : parseInt(document.getElementById('installments')?.value || '1', 10);
      btn.innerHTML = 'Processando pagamento…';
    }

    // ── Chama Edge Function ──────────────────────
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': `Bearer ${SUPABASE_KEY}` },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      const result = await res.json();

      if (!res.ok || result.erro) {
        throw new Error(result.erro || `Erro ${res.status}`);
      }

      // Nota: uso do cupom é registrado server-side pela edge function
      // (cartão/débito: em processar-pagamento quando CONFIRMED; PIX: em asaas-webhook quando RECEIVED)

      // Para PIX: mantém carrinho em backup — só limpa após confirmação real
      // Para Cartão aprovado: limpa imediatamente
      if (!isPix) {
        localStorage.removeItem('virtu_cart');
        localStorage.removeItem('virtu_gift');
        localStorage.removeItem('virtu_coupon');
        if (typeof window.updateCartBadge === 'function') window.updateCartBadge();
      } else {
        // Backup do carrinho em sessionStorage para recuperação se necessário
        sessionStorage.setItem('virtu_cart_pix_backup', localStorage.getItem('virtu_cart') || '[]');
      }

      // ── PIX: exibe QR Code ───────────────────────
      if (isPix) {
        document.getElementById('pixPending').style.display = 'none';
        document.getElementById('pixGerado').style.display  = 'block';

        const qrImg = document.getElementById('pixQrImg');
        if (qrImg && result.qr_code_base64) {
          qrImg.src = `data:image/png;base64,${result.qr_code_base64}`;
        }

        const pixInput = document.getElementById('pixCopiaECola');
        if (pixInput && result.qr_code) pixInput.value = result.qr_code;

        if (result.expires_at) {
          const exp = new Date(result.expires_at);
          document.getElementById('pixExpira').textContent =
            `Expira em: ${exp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        }

        btn.innerHTML = '✓ QR Code gerado!';
        btn.disabled  = false;
        // Agora que o pedido foi criado, limpa o carrinho
        localStorage.removeItem('virtu_cart');
        localStorage.removeItem('virtu_gift');
        localStorage.removeItem('virtu_coupon');
        sessionStorage.removeItem('virtu_cart_pix_backup');
        if (typeof window.updateCartBadge === 'function') window.updateCartBadge();
        return; // Não fecha — aguarda pagamento
      }

      // ── Cartão: feedback de aprovação ────────────
      // Status ASAAS: CONFIRMED | RECEIVED → aprovado; DECLINED → recusado
      if (['CONFIRMED', 'RECEIVED', 'PENDING'].includes(result.status)) {
        exibirSucesso(cliente.nome.split(' ')[0], result.pedido_id);
      } else if (result.status === 'DECLINED') {
        btn.innerHTML = '🔒 Finalizar Pedido';
        btn.disabled  = false;
        showCheckoutMsg(`Pagamento recusado: ${result.mensagem || 'Verifique os dados do cartão e tente novamente.'}`, 'erro');
      } else {
        // Outro status (AWAITING_RISK_ANALYSIS etc.) — trata como em análise
        exibirSucesso(cliente.nome.split(' ')[0], result.pedido_id, true);
      }

    } catch (err) {
      clearTimeout(timeoutId);
      console.error('[Checkout]', err);
      btn.innerHTML = '🔒 Finalizar Pedido';
      btn.disabled  = false;
      const msg = err.name === 'AbortError'
        ? 'Tempo esgotado (25s). Verifique sua conexão e tente novamente.'
        : (err.message || 'Erro desconhecido. Tente novamente.');
      showCheckoutMsg(`Não foi possível processar o pagamento: ${msg}`, 'erro');
    }
  });

  // ── MODAL DE SUCESSO ──────────────────────────────────────
  async function exibirSucesso(nome, pedidoId, emAnalise = false) {
    const modal   = document.getElementById('successModal');
    const nameEl  = document.getElementById('successName');
    const orderEl = document.getElementById('successOrder');
    const num     = pedidoId || Math.floor(100000 + Math.random() * 900000);

    if (nameEl)  nameEl.textContent  = nome || 'cliente';
    if (orderEl) orderEl.textContent = num;

    // Carrega mensagem personalizada do admin
    try {
      if (typeof supabaseClient !== 'undefined') {
        const { data: cfg } = await supabaseClient
          .from('configuracoes')
          .select('pedido_msg_titulo, pedido_msg_corpo')
          .eq('id', 1)
          .maybeSingle();

        if (cfg) {
          const titleEl = document.getElementById('successTitle');
          const bodyEl  = document.getElementById('successMsgCorpo');

          if (titleEl && cfg.pedido_msg_titulo) {
            titleEl.textContent = cfg.pedido_msg_titulo;
          }

          if (bodyEl && cfg.pedido_msg_corpo) {
            // Substitui placeholders — usa textContent para segurança (sem XSS)
            const corpo = cfg.pedido_msg_corpo
              .replace(/\{nome\}/g, nome || 'cliente')
              .replace(/\{numero\}/g, num);
            // Sanitização: só permite <b>, <strong>, <em>, <br> sem atributos
            const sanitized = corpo
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/&lt;(\/?(?:b|strong|em|br))&gt;/gi, '<$1>');
            bodyEl.innerHTML = sanitized;
          }
        }
      }
    } catch { /* mantém texto estático como fallback */ }

    if (emAnalise) {
      const txt = document.getElementById('successMsgCorpo');
      if (txt) txt.textContent = 'Seu pedido está em análise. Você receberá a confirmação por e-mail.';
    }

    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // ESC fecha o modal e restaura scroll
    const closeModal = () => {
      modal?.classList.remove('open');
      document.body.style.overflow = '';
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); }, { once: true });
    modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); }, { once: true });
  }

  // ── INIT ──────────────────────────────────────────────────
  goToStep(1);

  // ── PRÉ-PREENCHIMENTO: carrega perfil da cliente autenticada ─
  (async function preencherPerfil() {
    try {
      if (typeof supabaseClient === 'undefined') return;
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;

      const { data: perfil } = await supabaseClient
        .from('clientes_perfil')
        .select('nome, cpf, whatsapp, cep, rua, numero, complemento, bairro, cidade, estado')
        .eq('id', user.id)
        .maybeSingle();

      if (!perfil) return;

      // Dados de identificação
      if (perfil.nome) {
        const partes = perfil.nome.trim().split(' ');
        const first  = document.getElementById('firstName');
        const last   = document.getElementById('lastName');
        if (first && !first.value) first.value = partes[0] || '';
        if (last  && !last.value)  last.value  = partes.slice(1).join(' ') || '';
      }
      const emailEl = document.getElementById('email');
      if (emailEl && !emailEl.value) emailEl.value = user.email || '';

      const cpfEl = document.getElementById('cpf');
      if (cpfEl && !cpfEl.value && perfil.cpf) cpfEl.value = perfil.cpf;

      const phoneEl = document.getElementById('phone');
      if (phoneEl && !phoneEl.value && perfil.whatsapp) phoneEl.value = perfil.whatsapp;

      // Endereço
      if (perfil.cep) {
        const cepEl = document.getElementById('cep');
        if (cepEl && !cepEl.value) {
          const cepFmt = perfil.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
          cepEl.value = cepFmt;
        }
        if (perfil.rua)         { const el = document.getElementById('street');       if (el && !el.value) el.value = perfil.rua; }
        if (perfil.numero)      { const el = document.getElementById('number');       if (el && !el.value) el.value = perfil.numero; }
        if (perfil.complemento) { const el = document.getElementById('complement');   if (el && !el.value) el.value = perfil.complemento; }
        if (perfil.bairro)      { const el = document.getElementById('neighborhood'); if (el && !el.value) el.value = perfil.bairro; }
        if (perfil.cidade)      { const el = document.getElementById('city');         if (el && !el.value) el.value = perfil.cidade; }
        if (perfil.estado) {
          const el = document.getElementById('state');
          if (el && !el.value) el.value = perfil.estado;
        }
        // Calcula frete automaticamente se CEP salvo
        const cepRaw = perfil.cep.replace(/\D/g, '');
        if (cepRaw.length === 8) {
          await calcularFrete(cepRaw);
        }
      }
    } catch (e) {
      console.warn('[Checkout] Erro ao carregar perfil:', e);
    }
  })();

  // ── SALVAR / ATUALIZAR PERFIL após pedido (1-click checkout) ─
  window.vtSalvarEndereco = async function(endereco) {
    try {
      if (typeof supabaseClient === 'undefined') return;
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;

      // Dados extras coletados no step 1
      const nome     = `${document.getElementById('firstName')?.value.trim() || ''} ${document.getElementById('lastName')?.value.trim() || ''}`.trim();
      const cpf      = document.getElementById('cpf')?.value.trim()   || null;
      const whatsapp = document.getElementById('phone')?.value.trim() || null;

      await supabaseClient
        .from('clientes_perfil')
        .upsert({
          id:          user.id,
          nome:        nome   || null,
          cpf:         cpf,
          whatsapp:    whatsapp,
          cep:         endereco?.cep?.replace(/\D/g,'') || null,
          rua:         endereco?.rua         || null,
          numero:      endereco?.numero      || null,
          complemento: endereco?.complemento || null,
          bairro:      endereco?.bairro      || null,
          cidade:      endereco?.cidade      || null,
          estado:      endereco?.estado      || null,
        }, { onConflict: 'id' });
    } catch (e) {
      console.warn('[Checkout] Erro ao salvar perfil:', e);
    }
  };
});
