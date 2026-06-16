/**
 * VIRTÙ — Edge Function: processar-pagamento  (v31 — ASAAS)
 * Recebe dados do checkout, chama o ASAAS v3 e salva o pedido no Supabase.
 *
 * Segurança:
 *   - Cartão: dados tokenizados via ASAAS (PCI-DSS) — nosso servidor repassa
 *             dados criptografados diretamente ao ASAAS, nunca os armazena
 *   - Preços: recalculados no servidor a partir do banco (anti-tampering)
 *   - Fidelidade: desconto de R$100 validado server-side
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   ASAAS_API_KEY        — access_token do ASAAS (nunca vai ao frontend)
 *   ASAAS_SANDBOX        — 'true' para sandbox, 'false' para produção
 *   SUPABASE_URL         — Injetada automaticamente pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Injetada automaticamente
 *   SUPABASE_ANON_KEY    — Injetada automaticamente
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS / Security ─────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://wearvirtu.com';

const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age':       '86400',
};

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

// ── AJUSTE POR MÉTODO — espelho de AJUSTE_METODO no frontend ──
// PIX: −5% sobre o subtotal (desconto); Débito/Crédito: +10% (acréscimo).
// O frete NÃO sofre ajuste — é custo fixo de logística.
// Edite aqui E no checkout.js de forma sincronizada.
const AJUSTE_METODO: Record<string, number> = {
  pix:    -0.05,  // 5% de DESCONTO
  debito:  0.10,  // 10% de ACRÉSCIMO
  cartao:  0.10,  // 10% de ACRÉSCIMO
};

// ── Helpers ──────────────────────────────────────────────────
function sanitize(val: unknown, maxLen = 255): string {
  return String(val ?? '').trim().replace(/[<>"'`]/g, '').slice(0, maxLen);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

/** Base URL da API ASAAS (sandbox ou produção) */
function asaasBase(): string {
  const sandbox = Deno.env.get('ASAAS_SANDBOX');
  return sandbox === 'true'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';
}

/** Headers padrão para todas as chamadas ASAAS */
function asaasHeaders(): Record<string, string> {
  return {
    'access_token':  Deno.env.get('ASAAS_API_KEY') ?? '',
    'Content-Type':  'application/json',
    'User-Agent':    'Virtu-EF/1.0',
  };
}

/** Cria ou recupera cliente no ASAAS. Retorna o asaas_customer_id. */
async function upsertAsaasCustomer(params: {
  nome: string;
  email: string;
  cpf: string;
  telefone?: string;
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
}): Promise<string> {
  const { nome, email, cpf, telefone, supabase, userId } = params;

  // 1. Verifica se já existe um customer salvo no Supabase
  if (userId) {
    const { data: perfil } = await supabase
      .from('clientes_perfil')
      .select('asaas_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (perfil?.asaas_customer_id) {
      return perfil.asaas_customer_id;
    }
  }

  // 2. Tenta buscar pelo CPF no ASAAS
  const cpfClean = cpf.replace(/\D/g, '');
  const searchRes = await fetch(
    `${asaasBase()}/customers?cpfCnpj=${cpfClean}&limit=1`,
    { headers: asaasHeaders() },
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData?.data?.[0]?.id) {
      const existingId: string = searchData.data[0].id;
      // Persiste para evitar nova busca na próxima compra
      if (userId) {
        await supabase
          .from('clientes_perfil')
          .update({ asaas_customer_id: existingId })
          .eq('id', userId);
      }
      return existingId;
    }
  }

  // 3. Cria novo cliente no ASAAS
  const createRes = await fetch(`${asaasBase()}/customers`, {
    method:  'POST',
    headers: asaasHeaders(),
    body: JSON.stringify({
      name:       nome,
      email:      email,
      cpfCnpj:    cpfClean,
      mobilePhone: telefone ? telefone.replace(/\D/g, '') : undefined,
      notificationDisabled: true, // notificações gerenciadas pela Virtù via Resend
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    throw new Error(`ASAAS criar cliente: ${createData.errors?.[0]?.description || createData.error || 'Erro desconhecido'}`);
  }

  const newId: string = createData.id;

  // Persiste o customer_id no perfil do usuário
  if (userId) {
    await supabase
      .from('clientes_perfil')
      .update({ asaas_customer_id: newId })
      .eq('id', userId);
  }

  return newId;
}

// ── Handler principal ────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      tipo,               // 'pix' | 'cartao' | 'debito'
      subtotal,
      frete,
      desconto,
      itens,
      cliente,            // { nome, email, cpf, telefone }
      endereco,
      // cartão — enviados diretamente (ASAAS cuida da tokenização PCI)
      card_number,        // string — apenas dígitos
      card_holder_name,   // string
      card_expiry_month,  // string — MM
      card_expiry_year,   // string — YYYY
      card_cvv,           // string
      parcelas,           // number — 1..12
      // cupom
      cupom_codigo,
      // fidelidade
      user_id,
      fidelidade_desconto,
    } = body;

    // ── Validações de entrada ────────────────────────────────
    if (!tipo || !['pix', 'cartao', 'debito'].includes(tipo)) {
      return json({ erro: 'Tipo de pagamento inválido.' }, 400);
    }
    if (!cliente?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) {
      return json({ erro: 'E-mail inválido.' }, 400);
    }
    if (!cliente?.cpf || String(cliente.cpf).replace(/\D/g, '').length !== 11) {
      return json({ erro: 'CPF inválido.' }, 400);
    }
    if (itens && (itens as unknown[]).length > 50) {
      return json({ erro: 'Número de itens excede o limite permitido.' }, 400);
    }

    // Sanitiza campos de texto
    if (cliente.nome)     cliente.nome     = sanitize(cliente.nome, 120);
    if (cliente.telefone) cliente.telefone = String(cliente.telefone).replace(/\D/g, '').slice(0, 11);
    if (cliente.cpf)      cliente.cpf      = String(cliente.cpf).replace(/\D/g, '').slice(0, 11);
    if (endereco) {
      if (endereco.rua)         endereco.rua         = sanitize(endereco.rua, 200);
      if (endereco.complemento) endereco.complemento = sanitize(endereco.complemento, 100);
      if (endereco.bairro)      endereco.bairro      = sanitize(endereco.bairro, 100);
      if (endereco.cidade)      endereco.cidade      = sanitize(endereco.cidade, 100);
      if (endereco.cep)         endereco.cep         = String(endereco.cep).replace(/\D/g, '').slice(0, 8);
    }

    const ASAAS_KEY = Deno.env.get('ASAAS_API_KEY');
    if (!ASAAS_KEY) {
      return json({ erro: 'Gateway não configurado.' }, 500);
    }

    // ── Supabase service client ──────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Valida JWT → confirma user_id ────────────────────────
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
          if (user_id && user_id !== confirmedUserId) {
            console.warn('[processar-pagamento] user_id payload != JWT — usando JWT');
          }
        }
      } catch { /* JWT inválido — prossegue sem user_id */ }
    }

    // ── Recálculo server-side do subtotal (anti-tampering) ───
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
          const sp = priceMap[item.id];
          if (sp !== undefined) serverSubtotal += sp * (Number(item.qty) || 1);
        }
      }
    }
    if (serverSubtotal === 0 && subtotal) {
      console.warn('[processar-pagamento] Preços não encontrados — usando subtotal cliente:', subtotal);
      serverSubtotal = Number(subtotal);
    }

    const freteNum    = Number(frete    ?? 0);
    const descontoNum = Number(desconto ?? 0);

    // ── Desconto de Fidelidade (validação server-side) ───────
    let descontoFidelidade = 0;
    if (fidelidade_desconto && confirmedUserId) {
      const { data: perfil } = await supabase
        .from('clientes_perfil')
        .select('compras_pagas')
        .eq('id', confirmedUserId)
        .maybeSingle();

      const comprasAtuais = perfil?.compras_pagas ?? 0;
      if ((comprasAtuais + 1) % 10 === 0) {
        descontoFidelidade = 100;
        console.log(`[Fidelidade] Validada: ${comprasAtuais + 1}ª compra → R$100`);
      } else {
        console.warn(`[Fidelidade] Rejeitada: comprasAtuais=${comprasAtuais}`);
      }
    }

    // ── Calcula preço final com ajuste por método ───────────
    // PIX −5%, Débito/Crédito +10% sobre o subtotalLiquido.
    // O frete não sofre ajuste — é custo fixo de logística.
    const parcelasNum     = Math.max(1, Math.min(Number(parcelas) || 1, 12));
    const ajuste          = AJUSTE_METODO[tipo] ?? 0;
    const subtotalLiquido = Math.max(0, serverSubtotal - descontoNum - descontoFidelidade);
    const subAjustado     = Math.round(subtotalLiquido * (1 + ajuste) * 100) / 100;
    const serverTotal     = Math.max(0, subAjustado) + freteNum;

    if (serverTotal <= 0) {
      return json({ erro: 'Valor do pedido inválido.' }, 400);
    }

    // Cross-check ±2 centavos (tolerância para arredondamento client-side)
    const totalCliente = Number(body.total ?? 0);
    if (totalCliente > 0 && Math.abs(totalCliente - serverTotal) > 0.02) {
      console.warn(
        `[processar-pagamento] Divergência: cliente=${totalCliente} servidor=${serverTotal} ` +
        `(subtotalLiq=${subtotalLiquido}, ajuste=${(ajuste * 100).toFixed(0)}%, frete=${freteNum})`,
      );
    }

    // ── Cria / recupera cliente no ASAAS ────────────────────
    let asaasCustomerId: string;
    try {
      asaasCustomerId = await upsertAsaasCustomer({
        nome:     cliente.nome || 'Cliente',
        email:    cliente.email,
        cpf:      cliente.cpf,
        telefone: cliente.telefone,
        supabase,
        userId:   confirmedUserId,
      });
    } catch (custErr) {
      console.error('[ASAAS Cliente]', custErr);
      return json({ erro: 'Erro ao registrar cliente no gateway. Tente novamente.' }, 502);
    }

    // ── Monta cobrança ASAAS ─────────────────────────────────
    // Vencimento: hoje + 1 dia (PIX) ou hoje + 7 dias (cartão/débito)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (tipo === 'pix' ? 1 : 7));
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const externalRef = crypto.randomUUID();

    const chargeBody: Record<string, unknown> = {
      customer:          asaasCustomerId,
      billingType:       tipo === 'pix' ? 'PIX' : tipo === 'debito' ? 'DEBIT_CARD' : 'CREDIT_CARD',
      value:             serverTotal,
      dueDate:           dueDateStr,
      description:       `Pedido Virtù — ${(itens as any[])?.length ?? 0} item(s)`,
      externalReference: externalRef,
    };

    // Dados de cartão (ASAAS cuida da tokenização PCI v3)
    if (tipo === 'cartao' || tipo === 'debito') {
      if (!card_number || !card_holder_name || !card_expiry_month || !card_expiry_year || !card_cvv) {
        return json({ erro: 'Dados do cartão incompletos.' }, 400);
      }
      chargeBody.creditCard = {
        holderName:  sanitize(card_holder_name, 60),
        number:      String(card_number).replace(/\D/g, ''),
        expiryMonth: String(card_expiry_month).padStart(2, '0'),
        expiryYear:  String(card_expiry_year),
        ccv:         String(card_cvv).replace(/\D/g, ''),
      };
      chargeBody.creditCardHolderInfo = {
        name:      sanitize(cliente.nome, 120),
        email:     cliente.email,
        cpfCnpj:   cliente.cpf.replace(/\D/g, ''),
        phone:     cliente.telefone ? cliente.telefone.replace(/\D/g, '') : undefined,
        postalCode: endereco?.cep ? String(endereco.cep).replace(/\D/g, '') : undefined,
        addressNumber: endereco?.numero ? String(endereco.numero) : undefined,
      };
      if (tipo === 'cartao' && parcelasNum > 1) {
        chargeBody.installmentCount = parcelasNum;
        chargeBody.installmentValue = +(serverTotal / parcelasNum).toFixed(2);
      }
      chargeBody.remoteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
    }

    // ── Chama ASAAS: cria cobrança ───────────────────────────
    const chargeRes = await fetch(`${asaasBase()}/payments`, {
      method:  'POST',
      headers: asaasHeaders(),
      body:    JSON.stringify(chargeBody),
    });

    const chargeData = await chargeRes.json();

    if (!chargeRes.ok) {
      console.error('[ASAAS Cobrança]', JSON.stringify({ errors: chargeData.errors, status: chargeRes.status }));

      // Traduz erros comuns do ASAAS para português
      const errDesc = chargeData.errors?.[0]?.description || chargeData.error || '';
      const errMap: Record<string, string> = {
        'invalid_creditCard':              'Dados do cartão inválidos.',
        'creditCard_expiredDate':          'Cartão expirado.',
        'creditCard_number_invalid':       'Número do cartão inválido.',
        'creditCard_cvv_invalid':          'CVV inválido.',
        'creditCard_holderName_invalid':   'Nome no cartão inválido.',
        'creditCard_insufficientFunds':    'Saldo insuficiente.',
        'creditCard_card_disabled':        'Cartão bloqueado. Entre em contato com seu banco.',
        'creditCard_declined':             'Pagamento recusado pelo banco emissor.',
        'creditCard_duplicatePayment':     'Pagamento duplicado detectado.',
      };

      const errPt = errMap[chargeData.errors?.[0]?.code || '']
        || (errDesc.length < 200 ? errDesc : null)
        || 'Erro no gateway de pagamento.';

      return json({ erro: errPt }, 502);
    }

    const asaasPaymentId: string = chargeData.id;

    // ── Para PIX: busca QR Code ──────────────────────────────
    let pixQrCodeBase64: string | null = null;
    let pixPayload:      string | null = null;
    let pixExpiresAt:    string | null = null;

    if (tipo === 'pix') {
      try {
        const qrRes = await fetch(
          `${asaasBase()}/payments/${asaasPaymentId}/pixQrCode`,
          { headers: asaasHeaders() },
        );
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          pixQrCodeBase64 = qrData.encodedImage   || null;
          pixPayload      = qrData.payload         || null;
          pixExpiresAt    = qrData.expirationDate  || null;
        }
      } catch (qrErr) {
        console.error('[ASAAS QR]', qrErr);
        // Prossegue sem QR — pedido salvo normalmente
      }
    }

    // ── Determina status do pedido ───────────────────────────
    // ASAAS statuses: PENDING, CONFIRMED, RECEIVED, OVERDUE, REFUNDED, DECLINED
    const asaasStatus  = chargeData.status || '';
    const statusPedido =
      ['CONFIRMED', 'RECEIVED'].includes(asaasStatus) ? 'pago'     :
      ['DECLINED',  'REFUND_REQUESTED', 'REFUNDED'].includes(asaasStatus) ? 'recusado' :
      'pendente';

    // ── Salva pedido no Supabase ─────────────────────────────
    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        status:             statusPedido,
        payment_id:         asaasPaymentId,
        asaas_payment_id:   asaasPaymentId,
        payment_method:     tipo,
        payment_status:     asaasStatus,
        subtotal:           serverSubtotal,
        frete:              freteNum,
        desconto:           descontoNum + descontoFidelidade,
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
        cupom_codigo:       cupom_codigo ? String(cupom_codigo).trim().toUpperCase().slice(0, 50) : null,
        parcelas:           tipo === 'cartao' ? parcelasNum : null,
        pix_qr_code:        pixPayload      || null,
        pix_qr_base64:      pixQrCodeBase64 || null,
        pix_expires_at:     pixExpiresAt    || null,
      })
      .select('id')
      .single();

    if (dbError) throw new Error('[DB Insert] ' + dbError.message);

    // ── Decrementa estoque se pagamento aprovado imediatamente ──
    if (pedido?.id && itens?.length && statusPedido === 'pago') {
      const decrements = (itens as any[])
        .filter((i) => i.variacao_id)
        .map((i) => supabase.rpc('comprar_variacao', {
          p_variacao_id: i.variacao_id,
          p_quantidade:  i.qty || 1,
        }));
      if (decrements.length > 0) await Promise.allSettled(decrements);
    }

    // ── Fidelidade: incrementa contador se pagamento aprovado ──
    // PIX pendente → incrementado no asaas-webhook quando RECEIVED
    if (confirmedUserId && statusPedido === 'pago') {
      supabase.rpc('registrar_compra_fidelidade', { p_user_id: confirmedUserId })
        .then(async ({ data: fidData, error: fidErr }) => {
          if (fidErr) {
            console.error('[Fidelidade] Erro:', fidErr.message);
            return;
          }
          console.log('[Fidelidade] Compra registrada:', fidData?.compras_pagas);

          if (fidData?.desconto_100 === true && fidData?.codigo) {
            const SB_URL  = Deno.env.get('SUPABASE_URL');
            const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
            if (SB_URL && ANON_KEY) {
              fetch(`${SB_URL}/functions/v1/notificar-premio-fidelidade`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
                body: JSON.stringify({
                  user_id:  confirmedUserId,
                  codigo:   fidData.codigo,
                  validade: fidData.validade,
                  nome:     cliente?.nome  || null,
                  email:    cliente?.email || null,
                }),
              }).catch(e => console.error('[Premio dispatch]', e));
            }
          }
        });
    }

    // ── Notificações por e-mail (Resend via send-order-email) ──
    try {
      const SB_URL   = Deno.env.get('SUPABASE_URL');
      const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
      if (SB_URL && ANON_KEY && pedido?.id) {
        fetch(`${SB_URL}/functions/v1/send-order-email`, {
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
            desconto:         descontoNum + descontoFidelidade,
            metodo_pagamento: tipo,
            parcelas,
            status:           statusPedido,
          }),
        }).catch(e => console.error('[Email dispatch]', e));
      }
    } catch (emailErr) {
      console.error('[Email Error]', emailErr);
    }

    // ── Resposta ao frontend ─────────────────────────────────
    const resposta: Record<string, unknown> = {
      pedido_id:  pedido?.id ?? null,
      payment_id: asaasPaymentId,
      status:     asaasStatus,
    };

    if (tipo === 'pix') {
      resposta.qr_code_base64 = pixQrCodeBase64;
      resposta.qr_code        = pixPayload;
      resposta.expires_at     = pixExpiresAt;
    }

    if (tipo === 'cartao' || tipo === 'debito') {
      const aprovado = ['CONFIRMED', 'RECEIVED'].includes(asaasStatus);
      resposta.mensagem = aprovado
        ? 'Pagamento aprovado! 🎉'
        : asaasStatus === 'DECLINED'
          ? 'Pagamento recusado. Verifique os dados do cartão e tente novamente.'
          : 'Pagamento em análise. Confirmaremos por e-mail em breve.';
    }

    return json(resposta, 200);

  } catch (err) {
    console.error('[Unexpected]', err);
    return json({ erro: 'Erro interno. Tente novamente.' }, 500);
  }
});
