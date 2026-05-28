/* ============================================================
   VIRTÙ — Checkout JavaScript
   Frete: Todo o Nordeste. Frete grátis (FRETEGRATIS) apenas para Grande JP.
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

// ── ESTADO DO CUPOM ─────────────────────────────────────────
let cupomAplicado = null; // { codigo, tipo, valor } ou null

document.addEventListener('DOMContentLoaded', () => {

  const CART_KEY = 'virtu_cart';

  function formatCurrency(v) {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
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
        const bg = item.imagem_placeholder
          ? `background:${item.imagem_placeholder}`
          : 'background:linear-gradient(135deg,#E8E0D5,#D4CCC0)';
        return `
          <div class="checkout-order-item">
            <div class="checkout-order-item__img" style="${bg}"></div>
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

        // Se cupom de frete e CEP já digitado fora de JP, rejeitar
        if (data.tipo === 'frete') {
          const cepAtual = parseInt((document.getElementById('cep')?.value || '').replace(/\D/g, ''), 10);
          const cepPreenchido = !isNaN(cepAtual) && cepAtual > 0;
          const isJPCep = cepAtual >= CEP_JP_MIN && cepAtual <= CEP_JP_MAX;
          if (cepPreenchido && !isJPCep) {
            setMsg('Este cupom de frete grátis é válido apenas para João Pessoa (CEPs 58000–58099).', 'erro');
            btn.disabled = false;
            if (btn.textContent === '…') btn.textContent = 'Aplicar';
            return;
          }
        }

        let labelDesc;
        if (data.tipo === 'frete') {
          labelDesc = 'Frete grátis para João Pessoa!';
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
      const parcela = total / i;
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}x de ${formatCurrency(parcela)} (sem juros)`;
      if (i === 1) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ── CARREGA DADOS INICIAIS DO SUPABASE ───────────────────
  (async () => {
    renderOrderSummary(getCart());
    await initCupom(); // campo de cupom no resumo do pedido
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
        stepEl.querySelector('.checkout-step__num').textContent = '✓';
      } else {
        section.classList.add('checkout-section--locked');
        content?.setAttribute('hidden', '');
        summary?.setAttribute('hidden', '');
        editBtn?.setAttribute('hidden', '');
        stepEl?.classList.remove('checkout-step--active', 'checkout-step--done');
        stepEl.querySelector('.checkout-step__num').textContent = i;
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

    if (!firstName || !email || !cpf || !phone) {
      highlightEmptyFields(['firstName', 'email', 'cpf', 'phone']);
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

    if (!cepRaw || !street || !number || !city) {
      highlightEmptyFields(['cep', 'street', 'number', 'city', 'neighborhood']);
      return;
    }

    // Garante que o frete foi calculado
    if (document.getElementById('freteResult')?.style.display === 'none') {
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

  async function calcularFrete(cep) {
    const num         = parseInt(cep.replace(/\D/g, ''), 10);
    const freteResult = document.getElementById('freteResult');
    const freteMsg    = document.getElementById('freteMsg');
    const uf          = document.getElementById('state')?.value || '';

    if (!NORDESTE_STATES.includes(uf)) {
      // Estado fora do Nordeste ✗
      freteResult.style.display = 'none';
      showFreteMsg('No momento, entregamos apenas para estados do Nordeste.', 'error');
      freteBase = 0;
      updateTotalWithFrete(0);
      return;
    }

    // Nordeste válido ✓
    freteResult.style.display = 'block';
    freteMsg.style.display    = 'none';

    // Motoboy apenas em João Pessoa cidade
    const isJP = num >= CEP_JP_MIN && num <= CEP_JP_MAX;
    const motoboyOption = [...document.querySelectorAll('.shipping-option')]
      .find(el => el.querySelector('[value="motoboy"]'));
    if (motoboyOption) {
      motoboyOption.style.display = isJP ? '' : 'none';
    }
    // Se motoboy estava selecionado mas não está disponível, volta para padrão
    const motoboyRadio = document.querySelector('[value="motoboy"]');
    if (motoboyRadio?.checked && !isJP) {
      const stdRadio = document.querySelector('[value="standard"]');
      if (stdRadio) stdRadio.checked = true;
    }

    // Preço padrão: R$10 para João Pessoa, R$18 para restante do Nordeste
    const fretePadrao = isJP ? FRETE_STANDARD : FRETE_NORDESTE;
    const stdPriceEl  = document.getElementById('shippingStdPrice');
    if (stdPriceEl) stdPriceEl.textContent = `R$ ${fretePadrao.toFixed(2).replace('.', ',')}`;

    // Delivery time hint
    const stdTimeEl = document.getElementById('shippingStdTime');
    if (stdTimeEl) stdTimeEl.textContent = isJP ? '2–4 dias úteis' : '5–10 dias úteis';

    freteBase = fretePadrao;
    updateTotalWithFrete(fretePadrao);
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

  // Atualiza frete ao trocar opção de envio
  document.addEventListener('change', e => {
    if (e.target.name === 'shipping') {
      const val = e.target.value;
      const cepNum2 = parseInt((document.getElementById('cep')?.value || '').replace(/\D/g, ''), 10);
      const isJP2   = cepNum2 >= CEP_JP_MIN && cepNum2 <= CEP_JP_MAX;
      if (val === 'motoboy') {
        freteBase = FRETE_MOTOBOY;
      } else {
        freteBase = isJP2 ? FRETE_STANDARD : FRETE_NORDESTE;
      }
      updateTotalWithFrete(freteBase);
    }
  });

  // Formata CEP
  document.getElementById('cep')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    this.value = v;
    this.classList.remove('error', 'success');
    // Esconde frete anterior ao digitar novo CEP
    document.getElementById('freteResult').style.display = 'none';
    document.getElementById('freteMsg').style.display    = 'none';
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

    // Garante que o frete foi calculado e CEP é do Nordeste
    const cepRaw = document.getElementById('cep')?.value.replace(/\D/g, '');
    if (!cepRaw) { alert('Informe o CEP de entrega.'); goToStep(2); return; }
    const ufEntrega = document.getElementById('state')?.value || '';
    if (!NORDESTE_STATES.includes(ufEntrega)) {
      alert('No momento, entregamos apenas para estados do Nordeste.'); goToStep(2); return;
    }
    // Cupom de frete grátis só vale para João Pessoa cidade
    const cepNumFinal = parseInt(cepRaw, 10);
    if (cupomAplicado?.tipo === 'frete' && !(cepNumFinal >= CEP_JP_MIN && cepNumFinal <= CEP_JP_MAX)) {
      alert('O cupom de frete grátis (FRETEGRATIS) é válido apenas para entregas em João Pessoa (CEPs 58000‑58099).\nRemova o cupom ou altere o endereço de entrega.'); goToStep(2); return;
    }

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

    // ── Monta payload base ───────────────────────
    const payload = {
      tipo:          isPix ? 'pix' : 'cartao',
      total:         finalTotal,
      subtotal:      baseTotal,
      frete:         freteReal,
      desconto:      descontoCupom + (isPix ? +(totalBruto * 0.05).toFixed(2) : 0),
      cupom_codigo:  cupomAplicado?.codigo || null,
      itens:         cart,
      cliente,
      endereco,
    };

    // ── Cartão: envia dados ao servidor para tokenizar (evita CORS) ──────
    if (!isPix) {
      const expiry   = document.getElementById('cardExpiry')?.value.split('/') || [];
      const expiryMM = (expiry[0] || '').trim();
      const expiryYY = expiry[1] ? '20' + expiry[1].trim() : '';

      payload.dadosCartao = {
        numero: document.getElementById('cardNumber')?.value.replace(/\s/g, ''),
        mes:    expiryMM,
        ano:    expiryYY,
        cvv:    document.getElementById('cardCvv')?.value.trim(),
        nome:   document.getElementById('cardName')?.value.trim(),
        cpf:    cliente.cpf.replace(/\D/g, ''),
      };
      payload.parcelas = parseInt(document.getElementById('installments')?.value || '1', 10);
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

      // Decrementa estoque (independente do gateway)
      if (typeof supabaseClient !== 'undefined' && cart.length) {
        const decrements = cart
          .filter(i => i.variacao_id)
          .map(i => supabaseClient.rpc('comprar_variacao', {
            p_variacao_id: i.variacao_id,
            p_quantidade:  i.qty || 1,
          }));
        await Promise.allSettled(decrements);
      }

      // Registra uso do cupom (se houver)
      if (cupomAplicado?.codigo && typeof supabaseClient !== 'undefined') {
        try { await supabaseClient.rpc('usar_cupom', { p_codigo: cupomAplicado.codigo }); } catch {}
      }

      // Limpa carrinho
      localStorage.removeItem('virtu_cart');
      localStorage.removeItem('virtu_gift');
      if (typeof window.updateCartBadge === 'function') window.updateCartBadge();

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
            // Substitui placeholders: {nome} e {numero}
            const corpo = cfg.pedido_msg_corpo
              .replace(/\{nome\}/g, nome || 'cliente')
              .replace(/\{numero\}/g, num);
            bodyEl.innerHTML = corpo;
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
  }

  // ── INIT ──────────────────────────────────────────────────
  goToStep(1);
});
