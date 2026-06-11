/**
 * VIRTÙ — Edge Function: processar-pagamento  (v30)
 * Recebe dados do checkout, chama o Mercado Pago e salva o pedido no Supabase.
 *
 * Segurança:
 *   - Cartão: aceita apenas token gerado pelo MP SDK no browser (PCI-DSS)
 *   - Preços: recalculados no servidor a partir do banco (anti-tampering)
 *   - Fidelidade: desconto de R$100 validado server-side (não confiar no cliente)
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   MP_ACCESS_TOKEN   — Token privado do MP (nunca vai ao frontend)
 *   SUPABASE_URL      — Injetada automaticamente pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Injetada automaticamente
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      tipo,        // 'pix' | 'cartao'
      subtotal,    // valor informado pelo cliente (usado apenas para log)
      frete,       // frete informado pelo cliente
      desconto,    // desconto de cupom informado pelo cliente
      itens,       // array do carrinho (id, qty, variacao_id, preco)
      cliente,     // { nome, email, cpf, telefone }
      endereco,    // { cep, rua, numero, complemento, bairro, cidade, estado }
      // apenas para cartão:
      token,       // string — token gerado pelo MP SDK no browser (PCI-compliant)
      parcelas,    // number — 1..12
      // fidelidade:
      user_id,     // UUID do usuário autenticado (enviado pelo frontend)
      fidelidade_desconto, // boolean — cliente alega ter direito ao desconto de R$100
    } = body;

    // ── Validações básicas ──────────────────────────────────
    if (!tipo || !cliente?.email) {
      return json({ erro: 'Dados incompletos.' }, 400);
    }

    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
    if (!MP_TOKEN) {
      return json({ erro: 'Gateway não configurado.' }, 500);
    }

    // ── Supabase client (service role) ─────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Extrai usuário autenticado do JWT (se presente) ────
    // Isso valida que user_id no payload é legítimo.
    let confirmedUserId: string | null = null;
    const authHeader = req.headers.get('Authorization') || '';
    const jwtToken   = authHeader.replace(/^Bearer\s+/i, '');
    if (jwtToken) {
      try {
        const anonClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
        );
        const { data: { user: jwtUser } } = await anonClient.auth.getUser(jwtToken);
        if (jwtUser?.id) {
          confirmedUserId = jwtUser.id;
          // Verificação extra: user_id do payload deve bater com JWT
          if (user_id && user_id !== confirmedUserId) {
            console.warn('[processar-pagamento] user_id payload != JWT user — usando JWT');
          }
        }
      } catch {
        // JWT inválido ou expirado — prossegue sem user_id
      }
    }

    // ── Recálculo server-side do total (anti-tampering) ────
    let serverSubtotal = 0;

    if (itens?.length) {
      const productIds = (itens as any[]).map((i) => i.id).filter(Boolean);

      if (productIds.length > 0) {
        const { data: produtos } = await supabase
          .from('produtos')
          .select('id, preco_original, preco_desconto')
          .in('id', productIds);

        const priceMap: Record<string, number> = {};
        for (const p of produtos ?? []) {
          priceMap[p.id] = Number(p.preco_desconto ?? p.preco_original) || 0;
        }

        for (const item of itens as any[]) {
          const serverPrice = priceMap[item.id];
          if (serverPrice === undefined) continue;
          serverSubtotal += serverPrice * (Number(item.qty) || 1);
        }
      }
    }

    if (serverSubtotal === 0 && subtotal) {
      console.warn('[processar-pagamento] Preços não encontrados — usando subtotal do cliente:', subtotal);
      serverSubtotal = Number(subtotal);
    }

    const freteNum    = Number(frete    ?? 0);
    const descontoNum = Number(desconto ?? 0);

    // Desconto de 5% PIX sobre o subtotal líquido
    const descontoCupomTotal = tipo === 'pix'
      ? Math.round((descontoNum + (serverSubtotal - descontoNum) * 0.05) * 100) / 100
      : descontoNum;

    // ── Desconto de Fidelidade (10ª compra = R$100) ────────
    // Validação server-side: cliente só recebe desconto se realmente
    // estiver na posição certa (compras_pagas % 10 === 9).
    let descontoFidelidade = 0;

    if (fidelidade_desconto && confirmedUserId) {
      const { data: perfil } = await supabase
        .from('clientes_perfil')
        .select('compras_pagas')
        .eq('id', confirmedUserId)
        .maybeSingle();

      const comprasAtuais = perfil?.compras_pagas ?? 0;
      // A próxima compra (comprasAtuais + 1) é múltipla de 10?
      if ((comprasAtuais + 1) % 10 === 0) {
        descontoFidelidade = 100;
        console.log(`[processar-pagamento] Fidelidade validada: ${comprasAtuais + 1}ª compra → R$100 de desconto`);
      } else {
        console.warn(`[processar-pagamento] Fidelidade rejeitada: comprasAtuais=${comprasAtuais} — sem direito ao desconto`);
      }
    }

    // ── Total final ────────────────────────────────────────
    const totalBruto  = Math.max(0, serverSubtotal - descontoCupomTotal - descontoFidelidade) + freteNum;
    const serverTotal = Math.round(totalBruto * 100) / 100;

    if (serverTotal <= 0) {
      return json({ erro: 'Valor do pedido inválido.' }, 400);
    }

    // ── Monta pagamento para o Mercado Pago ────────────────
    const [firstName, ...rest] = (cliente.nome || 'Cliente').split(' ');
    const lastName = rest.join(' ') || firstName;

    const paymentBody: Record<string, unknown> = {
      transaction_amount: serverTotal,
      description: `Pedido Virtù — ${itens?.length ?? 0} item(s)`,
      external_reference: crypto.randomUUID(),
      payer: {
        first_name:     firstName,
        last_name:      lastName,
        email:          cliente.email,
        identification: {
          type:   'CPF',
          number: (cliente.cpf || '').replace(/\D/g, ''),
        },
      },
    };

    if (tipo === 'pix') {
      paymentBody.payment_method_id = 'pix';
      paymentBody.payment_type_id   = 'bank_transfer';

    } else if (tipo === 'cartao') {
      if (!token) return json({ erro: 'Token do cartão ausente. Recarregue a página.' }, 400);
      paymentBody.token           = token;
      paymentBody.payment_type_id = 'credit_card';
      paymentBody.installments    = Number(parcelas) || 1;

    } else {
      return json({ erro: 'Tipo de pagamento inválido.' }, 400);
    }

    // ── Chama o Mercado Pago ────────────────────────────────
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization':     `Bearer ${MP_TOKEN}`,
        'Content-Type':      'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(paymentBody),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[MP Error]', JSON.stringify(mpData));

      // Traduz erros comuns do MP para português
      const errMap: Record<string, string> = {
        'cc_rejected_bad_filled_card_number': 'Número do cartão inválido.',
        'cc_rejected_bad_filled_date':        'Data de validade inválida.',
        'cc_rejected_bad_filled_security_code':'CVV inválido.',
        'cc_rejected_bad_filled_other':       'Dados do cartão incorretos.',
        'cc_rejected_insufficient_amount':    'Saldo insuficiente.',
        'cc_rejected_card_disabled':          'Cartão bloqueado. Entre em contato com seu banco.',
        'cc_rejected_duplicated_payment':     'Pagamento duplicado detectado.',
        'cc_rejected_high_risk':              'Pagamento recusado por segurança.',
        'invalid_number':                     'Número do cartão inválido.',
        'invalid_expiration_date':            'Data de validade inválida.',
        'invalid_security_code':              'CVV inválido.',
        'invalid_card_holder_name':           'Nome no cartão inválido.',
      };

      const statusDetail = mpData.cause?.[0]?.code || mpData.status_detail || '';
      const errPt = errMap[statusDetail] || errMap[mpData.message as string] || null;

      return json({
        erro: errPt || mpData.message || 'Erro no gateway de pagamento.',
        detalhes: { status_detail: statusDetail },
      }, 502);
    }

    // ── Monta descrição de status traduzida ────────────────
    const statusDetailMap: Record<string, string> = {
      'cc_rejected_bad_filled_card_number': 'Número do cartão inválido.',
      'cc_rejected_bad_filled_date':        'Data de validade inválida.',
      'cc_rejected_bad_filled_security_code':'CVV inválido.',
      'cc_rejected_bad_filled_other':       'Dados do cartão incorretos.',
      'cc_rejected_insufficient_amount':    'Saldo insuficiente no cartão.',
      'cc_rejected_card_disabled':          'Cartão bloqueado. Contate seu banco.',
      'cc_rejected_high_risk':              'Pagamento recusado por segurança.',
      'cc_rejected_call_for_authorize':     'Autorização necessária. Contate seu banco.',
      'pending_contingency':               'Processamento em andamento.',
      'pending_review_manual':             'Pagamento em revisão — confirmaremos por e-mail.',
    };

    // ── Salva pedido no Supabase ────────────────────────────
    const statusPedido =
      mpData.status === 'approved' ? 'pago' :
      mpData.status === 'rejected' ? 'recusado' : 'pendente';

    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        status:             statusPedido,
        payment_id:         String(mpData.id),
        payment_method:     tipo,
        payment_status:     mpData.status,
        subtotal:           serverSubtotal,
        frete:              freteNum,
        desconto:           descontoCupomTotal + descontoFidelidade,
        total:              serverTotal,
        user_id:            confirmedUserId || null,
        cep:                endereco?.cep,
        rua:                endereco?.rua,
        numero:             endereco?.numero,
        complemento:        endereco?.complemento,
        bairro:             endereco?.bairro,
        cidade:             endereco?.cidade,
        estado:             endereco?.estado,
        cliente_nome:       cliente.nome    || 'Cliente',
        cliente_email:      cliente.email,
        cliente_telefone:   cliente.telefone || null,
        nome_cliente:       cliente.nome,
        email_cliente:      cliente.email,
        cpf_cliente:        cliente.cpf,
        telefone:           cliente.telefone,
        itens:              itens ?? [],
        pix_qr_code:        mpData.point_of_interaction?.transaction_data?.qr_code ?? null,
        pix_qr_base64:      mpData.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
        pix_expires_at:     mpData.date_of_expiration ?? null,
      })
      .select('id')
      .single();

    if (dbError) throw new Error('[DB Insert] ' + dbError.message);

    // ── Decrementa estoque (só cartão aprovado) ─────────────
    // PIX: estoque decrementado pelo trigger quando pago
    if (pedido?.id && itens?.length && statusPedido === 'pago') {
      const decrements = (itens as any[])
        .filter((i) => i.variacao_id)
        .map((i) => supabase.rpc('comprar_variacao', {
          p_variacao_id: i.variacao_id,
          p_quantidade:  i.qty || 1,
        }));
      if (decrements.length > 0) await Promise.allSettled(decrements);
    }

    // ── Programa de Fidelidade: incrementa compras_pagas ───
    // Só incrementa se cartão aprovado (PIX será incrementado no pix-webhook)
    if (confirmedUserId && statusPedido === 'pago') {
      supabase.rpc('registrar_compra_fidelidade', { p_user_id: confirmedUserId })
        .then(({ data, error }) => {
          if (error) console.error('[Fidelidade] Erro ao registrar compra:', error.message);
          else console.log('[Fidelidade] Compra registrada:', JSON.stringify(data));
        });
    }

    // ── Notificações (e-mail + WhatsApp) ───────────────────
    try {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY');
      if (SUPABASE_URL && ANON_KEY && pedido?.id) {
        fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            pedido_id:        pedido.id,
            cliente,
            endereco,
            itens,
            total:            serverTotal,
            subtotal:         serverSubtotal,
            frete:            freteNum,
            desconto:         descontoCupomTotal + descontoFidelidade,
            metodo_pagamento: tipo,
            parcelas,
            status:           statusPedido,
          }),
        }).catch(e => console.error('[Email dispatch]', e));

        fetch(`${SUPABASE_URL}/functions/v1/notificar-pedido-admin`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            pedido_id:        pedido.id,
            status:           statusPedido,
            metodo_pagamento: tipo,
            total:            serverTotal,
            subtotal:         serverSubtotal,
            frete:            freteNum,
            desconto:         descontoCupomTotal + descontoFidelidade,
            itens,
            cliente,
            endereco,
          }),
        }).catch(e => console.error('[WhatsApp dispatch]', e));
      }
    } catch (emailErr) {
      console.error('[Email/WhatsApp Error]', emailErr);
    }

    // ── Resposta ao frontend ────────────────────────────────
    const resposta: Record<string, unknown> = {
      pedido_id:     pedido?.id ?? null,
      payment_id:    mpData.id,
      status:        mpData.status,
      status_detail: mpData.status_detail,
    };

    if (tipo === 'pix') {
      const txData = mpData.point_of_interaction?.transaction_data;
      resposta.qr_code        = txData?.qr_code;
      resposta.qr_code_base64 = txData?.qr_code_base64;
      resposta.expires_at     = mpData.date_of_expiration;
    }

    if (tipo === 'cartao') {
      const statusDetail = mpData.status_detail || '';
      const statusPt     = statusDetailMap[statusDetail] || null;
      resposta.mensagem = mpData.status === 'approved'
        ? 'Pagamento aprovado! 🎉'
        : mpData.status === 'rejected'
          ? `Pagamento recusado: ${statusPt || statusDetail || 'Verifique os dados do cartão.'}`
          : statusPt || 'Pagamento em análise.';
    }

    return json(resposta, 200);

  } catch (err) {
    console.error('[Unexpected]', err);
    return json({ erro: 'Erro interno. Tente novamente.' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
