/* ============================================================
   VIRTÙ — Checkout JavaScript
   Frete: Todo o Nordeste. Frete grátis automático para Grande JP.
   Pagamento: Mercado Pago via Supabase Edge Function
   ============================================================ */

// ── MERCADO PAGO PUBLIC KEY ──────────────────────────────────
// Substitua pelo seu Public Key do Mercado Pago (sandbox ou produção)
// Este valor é SEGURO no frontend — apenas o Access Token é secreto.
const MP_PUBLIC_KEY = 'APP_USR-757eb00b-89bd-4f45-85e3-5c183644a3bd';

// URL da Edge Function do Supabase
const EDGE_FUNCTION_URL = 'https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/processar-pagamento';

// ── CONSTANTES DE FRETE ──────────────────────────────────────
const FRETE_STANDARD  = 10.00;  // Entrega padrão em João Pessoa / Grande JP
const FRETE_NORDESTE  = 18.00;  // Entrega padrão no restante do Nordeste
const FRETE_MOTOBOY   = 15.00;  // Motoboy em João Pessoa
const CEP_JP_MIN      = 58000000; // João Pessoa cidade (motoboy + FRETEGRATIS válido)
const CEP_JP_MAX      = 58099999;
const NORDESTE_STATES = ['AL','BA','CE','MA','PB','PE','PI','RN','SE'];

// ── ESTADO GLOBAL DO CHECKOUT ───────────────────────────────
let freteValorSelecionado = FRETE_STANDARD;
let freteBase             = FRETE_STANDARD; // frete sem cupom (referência)
let baseTotal             = 0;              // subtotal + gift wrap, sem frete
let mpInstance            = null;
let freteCalculado        = false;          // flag: frete foi calculado com sucesso

// ── ESTADO DO CUPOM ─────────────────────────────────────────
let cupomAplicado = null; // { codigo, tipo, valor } ou null

document.addEventListener('DOMContentLoaded', () => {

  const CART_KEY = 'virtu_cart';

  function formatCurrency(v) {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
  }

  // ── INICIALIZA MERCADO PAGO SDK ──────────────────────────
  try {
    if (typeof MercadoPago !== 'undefined') {
      mpInstance = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
    }
  } catch (e) {
    console.warn('[MP SDK] Não inicializado:', e.message);
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
    if (totalEl)    { totalEl.textContent = formatCurrency(total); totalEl.dataset.baseTotal = total; }
    if (installEl)  updateInstallments(total);
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

    if (cupomAplicado && cupomAplicado.tipo !== 'frete') {
      const desc = calcularDesconto(baseTotal);
      descontoLine.style.display  = '';
      if (descontoLabel) descontoLabel.textContent = `Desconto (${cupomAplicado.codigo})`;
      if (descontoEl)    descontoEl.textContent     = `−${formatCurrency(desc)}`;
    } else {
      descontoLine.style.display = 'none';
    }
  }

  // ── ATUALIZA TOTAL COM FRETE ─────────────────────────────
  function updateTotalWithFrete(freteValor) {
    freteValorSelecionado = freteValor;
    const frete   = freteEfetivo();
    const desconto= calcularDesconto(baseTotal);
    const total   = Math.max(0, baseTotal - desconto) + frete;
    const totalEl   = document.getElementById('checkoutTotal');
    const freteEl   = document.getElementById('checkoutFreteLabel');
    const installEl = document.getElementById('checkoutInstallments');

    atualizarLinhaDesconto();

    if (freteEl) {
      freteEl.textContent = frete === 0 ? 'Grátis' : formatCurrency(frete);
      freteEl.classList.toggle('checkout-order-summary__free', frete === 0);
    }
    if (totalEl) { totalEl.textContent = formatCurrency(total); totalEl.dataset.baseTotal = total; }
    if (installEl) updateInstallments(total);
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
        const { data, error } = await supabaseClient.rpc('validar_cupom', { p_codigo: codigo });
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

  // ── PARCELAS DINÂMICAS ───────────────────────────────────
  function updateInstallments(total) {
    const sel = document.getElementById('installments');
    if (!sel) return;
    const maxSemJuros = 12;
    sel.innerHTML = '';
    for (let i = 1; i <= maxSemJuros; i++) {
      const parcela = Math.round((total / i) * 100) / 100;
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}x de ${formatCurrency(parcela)} (sem juros)`;
      if (i === 1) opt.selected = true;
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
    if (sumEl) sumEl.textContent = `${firstName} ${lastName} · ${email} · ${cpf}`;
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

      // Desconto 5% no Pix
      const totalEl = document.getElementById('checkoutTotal');
      if (totalEl) {
        const base = parseFloat(totalEl.dataset.baseTotal || 0);
        if (base > 0) {
          const val = tab.dataset.tab === 'pix' ? base * 0.95 : base;
          totalEl.textContent = formatCurrency(val);
          totalEl.title = tab.dataset.tab === 'pix' ? '5% desconto Pix aplicado' : '';
          if (tab.dataset.tab === 'pix') updateInstallments(val);
        }
      }
    });
  });

  // ── CARD PREVIEW ─────────────────────────────────────────
  document.getElementById('cardNumber')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 16);
    v = v.replace(/(.{4})/g, '$1 ').trim();
    this.value = v;
    const num = v.replace(/\s/g, '');
    document.getElementById('previewNumber').textContent = v || '•••• •••• •••• ••••';
    const brand = document.getElementById('previewBrand');
    if (brand) {
      if (num.startsWith('4'))        brand.textContent = 'VISA';
      else if (/^5[1-5]/.test(num))  brand.textContent = 'MASTERCARD';
      else if (num.startsWith('3'))   brand.textContent = 'AMEX';
      else                            brand.textContent = 'CARTÃO';
    }
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
      alert('Seu carrinho está vazio. Adicione produtos antes de finalizar.');
      return;
    }

    // Boleto não implementado — bloqueia
    if (activeTab === 'boleto') {
      alert('Pagamento por boleto ainda não está disponível. Por favor, escolha PIX ou cartão de crédito.');
      return;
    }

    // Validação cartão
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

    // Garante que o frete foi calculado
    const cepRaw = document.getElementById('cep')?.value.replace(/\D/g, '');
    if (!cepRaw) { alert('Informe o CEP de entrega.'); goToStep(2); return; }
    if (!freteCalculado) { alert('Calcule o frete antes de continuar.'); goToStep(2); return; }

    btn.innerHTML = 'Processando…';
    btn.disabled  = true;

    // Monta dados do cliente e endereço
    const cart          = getCart();
    const isPix         = activeTab === 'pix';
    const descontoCupom = calcularDesconto(baseTotal);
    const freteReal     = freteEfetivo();
    const totalBruto    = Math.max(0, baseTotal - descontoCupom) + freteReal;
    const finalTotal    = isPix ? +(totalBruto * 0.95).toFixed(2) : +totalBruto.toFixed(2);

    const cliente = {
      nome:     `${document.getElementById('firstName')?.value.trim()} ${document.getElementById('lastName')?.value.trim()}`.trim(),
      email:    document.getElementById('email')?.value.trim(),
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
    const freteNome = document.querySelector('input[name="shipping"]:checked')
      ?.closest('label')
      ?.querySelector('.shipping-option__name')?.textContent?.trim()
      || document.querySelector('#freteOpcoes label')?.querySelector('span:first-of-type')?.textContent?.trim()
      || 'Entrega padrão';

    const payload = {
      tipo:               isPix ? 'pix' : 'cartao',
      total:              finalTotal,
      subtotal:           baseTotal,
      frete:              freteReal,
      frete_selecionado:  freteNome,
      desconto:           descontoCupom + (isPix ? +((baseTotal - descontoCupom) * 0.05).toFixed(2) : 0),
      cupom_codigo:       cupomAplicado?.codigo || null,
      itens:              cart,
      cliente,
      endereco,
    };

    // ── Cartão: tokeniza no browser via MP SDK (PCI-DSS compliant) ──────
    // Dados brutos do cartão NUNCA são enviados ao nosso servidor.
    if (!isPix) {
      if (!mpInstance) {
        throw new Error('SDK do Mercado Pago não carregou. Recarregue a página e tente novamente.');
      }

      const expiry   = document.getElementById('cardExpiry')?.value.split('/') || [];
      const expiryMM = (expiry[0] || '').trim();
      const expiryYY = expiry[1] ? '20' + expiry[1].trim() : '';

      btn.innerHTML = 'Validando cartão…';

      // Tokeniza diretamente com os servidores do Mercado Pago — nosso backend
      // só recebe um token opaco, nunca os dados do cartão.
      const tokenResult = await mpInstance.createCardToken({
        cardNumber:           document.getElementById('cardNumber')?.value.replace(/\s/g, ''),
        cardholderName:       document.getElementById('cardName')?.value.trim(),
        cardExpirationMonth:  expiryMM,
        cardExpirationYear:   expiryYY,
        securityCode:         document.getElementById('cardCvv')?.value.trim(),
        identificationType:   'CPF',
        identificationNumber: cliente.cpf.replace(/\D/g, ''),
      });

      if (!tokenResult?.id) {
        const errMsg = tokenResult?.cause?.[0]?.description
          || 'Não foi possível validar o cartão. Verifique os dados e tente novamente.';
        throw new Error(errMsg);
      }

      payload.token    = tokenResult.id;
      payload.parcelas = parseInt(document.getElementById('installments')?.value || '1', 10);
      btn.innerHTML    = 'Processando pagamento…';
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
      // (cartão: em processar-pagamento quando approved; PIX: em pix-webhook quando confirmado)

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
      if (result.status === 'approved') {
        exibirSucesso(cliente.nome.split(' ')[0], result.pedido_id);
      } else if (result.status === 'rejected') {
        btn.innerHTML = '🔒 Finalizar Pedido';
        btn.disabled  = false;
        alert(`Pagamento recusado: ${result.mensagem || 'Verifique os dados do cartão.'}`);
      } else {
        // in_process — cartão em análise
        exibirSucesso(cliente.nome.split(' ')[0], result.pedido_id, true);
      }

    } catch (err) {
      clearTimeout(timeoutId);
      console.error('[Checkout]', err);
      btn.innerHTML = '🔒 Finalizar Pedido';
      btn.disabled  = false;
      const msg = err.name === 'AbortError'
        ? 'Tempo esgotado (25s). Verifique sua conexão e tente novamente.'
        : (err.message || 'Erro desconhecido.');
      alert(`Erro ao processar pagamento: ${msg}\nTente novamente ou entre em contato.`);
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
});
