/* ============================================================
   VIRTÙ — Checkout JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ── STEPS ──────────────────────────────────
  let currentStep = 1;

  function goToStep(step) {
    for (let i = 1; i <= 3; i++) {
      const section = document.getElementById(`step${i}`);
      const content = document.getElementById(`step${i}Content`);
      const summary = document.getElementById(`step${i}Summary`);
      const stepEl  = document.querySelector(`[data-step="${i}"]`);
      const editBtn = document.getElementById(`editStep${i}`);

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

  // ── STEP 1: IDENTIFICAÇÃO ──────────────────
  document.getElementById('nextStep1')?.addEventListener('click', () => {
    const firstName = document.getElementById('firstName')?.value.trim();
    const email     = document.getElementById('email')?.value.trim();
    const phone     = document.getElementById('phone')?.value.trim();
    const cpf       = document.getElementById('cpf')?.value.trim();

    if (!firstName || !email || !phone || !cpf) {
      highlightEmptyFields(['firstName', 'lastName', 'email', 'phone', 'cpf']);
      return;
    }

    // Preenche resumo da etapa 1
    const lastName = document.getElementById('lastName')?.value.trim();
    const sumEl = document.getElementById('step1SummaryText');
    if (sumEl) sumEl.textContent = `${firstName} ${lastName} · ${email} · ${phone}`;

    goToStep(2);
  });

  document.getElementById('editStep1')?.addEventListener('click', () => goToStep(1));

  // ── STEP 2: ENTREGA ────────────────────────
  document.getElementById('nextStep2')?.addEventListener('click', () => {
    const cep  = document.getElementById('cep')?.value.trim();
    const street = document.getElementById('street')?.value.trim();
    const number = document.getElementById('number')?.value.trim();

    if (!cep || !street || !number) {
      highlightEmptyFields(['cep', 'street', 'number', 'city', 'neighborhood']);
      return;
    }

    const city  = document.getElementById('city')?.value.trim();
    const state = document.getElementById('state')?.value;
    const selectedShipping = document.querySelector('input[name="shipping"]:checked')?.closest('.shipping-option');
    const shippingName = selectedShipping?.querySelector('.shipping-option__name')?.textContent || 'Frete Grátis';

    const sumEl = document.getElementById('step2SummaryText');
    if (sumEl) sumEl.textContent = `${street}, ${number} · ${city}/${state} · ${cep} · ${shippingName}`;

    goToStep(3);
  });

  document.getElementById('editStep2')?.addEventListener('click', () => goToStep(2));

  // ── BUSCA CEP (simulação) ──────────────────
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

      const set = (id, val) => { const el = document.getElementById(id); if (el && val) { el.value = val; el.classList.add('success'); } };
      set('street',       data.logradouro);
      set('neighborhood', data.bairro);
      set('city',         data.localidade);

      const stateEl = document.getElementById('state');
      if (stateEl && data.uf) stateEl.value = data.uf;

      document.getElementById('number')?.focus();
    } catch {
      cepInput?.classList.add('error');
    } finally {
      btn.textContent = 'Buscar';
      btn.disabled = false;
    }
  });

  // Formata CEP ao digitar
  document.getElementById('cep')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    this.value = v;
    this.classList.remove('error', 'success');
  });

  // ── HIGHLIGHT CAMPOS VAZIOS ────────────────
  function highlightEmptyFields(ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) {
        el.classList.add('error');
        el.addEventListener('input', () => el.classList.remove('error'), { once: true });
      }
    });

    const firstEmpty = ids.map(id => document.getElementById(id)).find(el => el && !el.value.trim());
    firstEmpty?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstEmpty?.focus();
  }

  // ── PAYMENT TABS ───────────────────────────
  document.querySelectorAll('.payment-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.payment-tab').forEach(t => {
        t.classList.remove('payment-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.payment-panel').forEach(p => p.classList.add('payment-panel--hidden'));

      tab.classList.add('payment-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const panelId = tab.getAttribute('aria-controls');
      document.getElementById(panelId)?.classList.remove('payment-panel--hidden');

      // Ajusta total para Pix (5% desconto)
      const totalEl = document.getElementById('checkoutTotal');
      if (totalEl) {
        if (tab.dataset.tab === 'pix') {
          totalEl.textContent = 'R$ 574,75';
          totalEl.title = '5% desconto Pix';
        } else {
          totalEl.textContent = 'R$ 605,00';
          totalEl.title = '';
        }
      }
    });
  });

  // ── CARD PREVIEW ───────────────────────────
  const cardNumber = document.getElementById('cardNumber');
  const cardName   = document.getElementById('cardName');
  const cardExpiry = document.getElementById('cardExpiry');

  cardNumber?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 16);
    v = v.replace(/(.{4})/g, '$1 ').trim();
    this.value = v;
    const preview = document.getElementById('previewNumber');
    if (preview) preview.textContent = v || '•••• •••• •••• ••••';

    // Detecta bandeira
    const brand = document.getElementById('previewBrand');
    if (brand) {
      const num = v.replace(/\s/g, '');
      if (num.startsWith('4')) brand.textContent = 'VISA';
      else if (/^5[1-5]/.test(num)) brand.textContent = 'MASTERCARD';
      else if (num.startsWith('3')) brand.textContent = 'AMEX';
      else brand.textContent = 'CARTÃO';
    }
  });

  cardName?.addEventListener('input', function () {
    const preview = document.getElementById('previewName');
    if (preview) preview.textContent = this.value.toUpperCase() || 'SEU NOME';
  });

  cardExpiry?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    this.value = v;
    const preview = document.getElementById('previewExpiry');
    if (preview) preview.textContent = v || 'MM/AA';
  });

  // Formata CPF
  document.getElementById('cpf')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    this.value = v;
  });

  // Formata telefone
  document.getElementById('phone')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/^(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
    this.value = v;
  });

  // ── SUBMIT PEDIDO ───────────────────────────
  document.getElementById('submitOrder')?.addEventListener('click', () => {
    const firstName = document.getElementById('firstName')?.value.trim();
    const activeTab = document.querySelector('.payment-tab--active')?.dataset.tab;

    // Validação básica do cartão
    if (activeTab === 'cartao') {
      const num = document.getElementById('cardNumber')?.value.trim();
      const name = document.getElementById('cardName')?.value.trim();
      const exp  = document.getElementById('cardExpiry')?.value.trim();
      const cvv  = document.getElementById('cardCvv')?.value.trim();
      if (!num || !name || !exp || !cvv) {
        highlightEmptyFields(['cardNumber', 'cardName', 'cardExpiry', 'cardCvv']);
        return;
      }
    }

    // Anima botão
    const btn = document.getElementById('submitOrder');
    if (btn) {
      btn.innerHTML = 'Processando…';
      btn.disabled = true;
    }

    // Simula processamento
    setTimeout(() => {
      const modal = document.getElementById('successModal');
      const nameEl = document.getElementById('successName');
      const orderEl = document.getElementById('successOrder');

      if (nameEl) nameEl.textContent = firstName || 'cliente';
      if (orderEl) orderEl.textContent = Math.floor(100000 + Math.random() * 900000);

      modal?.classList.add('open');
      modal?.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }, 1800);
  });

  // Fecha modal de sucesso ao clicar fora (não necessário mas boa UX)
  document.getElementById('successModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('successModal')) {
      // Não fecha — leva para catálogo pelo botão
    }
  });

  // ── INIT ────────────────────────────────────
  goToStep(1);

});
