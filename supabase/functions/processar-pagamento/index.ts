/**
 * VIRTÙ — Edge Function: processar-pagamento
 * Recebe dados do checkout, chama o Mercado Pago e salva o pedido no Supabase.
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
      total,       // number — valor final em R$
      subtotal,
      frete,
      desconto,
      itens,       // array do carrinho
      cliente,     // { nome, email, cpf, telefone }
      endereco,    // { cep, rua, numero, complemento, bairro, cidade, estado }
      // apenas para cartão:
      token,       // string — token gerado pelo MP SDK no frontend
      parcelas,    // number — 1..12
      // apenas para cartão (enviado pelo frontend):
      dadosCartao,  // { numero, mes, ano, cvv, nome, cpf }
    } = body;

    // ── Validações básicas ──────────────────────────────
    if (!tipo || !total || !cliente?.email) {
      return json({ erro: 'Dados incompletos.' }, 400);
    }

    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
    if (!MP_TOKEN) {
      return json({ erro: 'Gateway não configurado.' }, 500);
    }

    // ── Monta pagamento para o Mercado Pago ────────────
    const [firstName, ...rest] = (cliente.nome || 'Cliente').split(' ');
    const lastName = rest.join(' ') || firstName;

    const paymentBody: Record<string, unknown> = {
      transaction_amount: Number(Number(total).toFixed(2)),
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
      if (!dadosCartao) return json({ erro: 'Dados do cartão ausentes.' }, 400);

      // Tokeniza o cartão no servidor (evita CORS no browser)
      const tokenRes = await fetch('https://api.mercadopago.com/v1/card_tokens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MP_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          card_number:       dadosCartao.numero.replace(/\s/g, ''),
          expiration_month:  Number(dadosCartao.mes),
          expiration_year:   Number(dadosCartao.ano),
          security_code:     dadosCartao.cvv,
          cardholder: {
            name: dadosCartao.nome,
            identification: {
              type:   'CPF',
              number: (dadosCartao.cpf || cliente.cpf || '').replace(/\D/g, ''),
            },
          },
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.id) {
        console.error('[MP Token Error]', JSON.stringify(tokenData));
        return json({ erro: tokenData.cause?.[0]?.description || 'Erro ao validar cartão.' }, 400);
      }

      paymentBody.token          = tokenData.id;
      paymentBody.payment_type_id = 'credit_card';
      paymentBody.installments    = Number(parcelas) || 1;
    } else {
      return json({ erro: 'Tipo de pagamento inválido.' }, 400);
    }

    // ── Chama o Mercado Pago ────────────────────────────
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${MP_TOKEN}`,
        'Content-Type':   'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(paymentBody),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[MP Error]', JSON.stringify(mpData));
      return json({
        erro: mpData.message || 'Erro no gateway de pagamento.',
        detalhes: mpData,
      }, 502);
    }

    // ── Salva pedido no Supabase ────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const statusPedido =
      mpData.status === 'approved' ? 'pago' :
      mpData.status === 'rejected' ? 'recusado' : 'pendente';

    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        status:         statusPedido,
        payment_id:     String(mpData.id),
        payment_method: tipo,
        payment_status: mpData.status,
        subtotal:       subtotal ?? total,
        frete:          frete ?? 0,
        desconto:       desconto ?? 0,
        total,
        cep:            endereco?.cep,
        rua:            endereco?.rua,
        numero:         endereco?.numero,
        complemento:    endereco?.complemento,
        bairro:         endereco?.bairro,
        cidade:         endereco?.cidade,
        estado:         endereco?.estado,
        nome_cliente:   cliente.nome,
        email_cliente:  cliente.email,
        cpf_cliente:    cliente.cpf,
        telefone:       cliente.telefone,
        itens:          itens ?? [],
        // PIX extras
        pix_qr_code:    mpData.point_of_interaction?.transaction_data?.qr_code ?? null,
        pix_qr_base64:  mpData.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
        pix_expires_at: mpData.date_of_expiration ?? null,
      })
      .select('id')
      .single();

    if (dbError) console.error('[DB Error]', dbError.message);

    // ── Resposta ao frontend ────────────────────────────
    const resposta: Record<string, unknown> = {
      pedido_id:      pedido?.id ?? null,
      payment_id:     mpData.id,
      status:         mpData.status,           // approved | rejected | pending
      status_detail:  mpData.status_detail,
    };

    if (tipo === 'pix') {
      const txData = mpData.point_of_interaction?.transaction_data;
      resposta.qr_code        = txData?.qr_code;
      resposta.qr_code_base64 = txData?.qr_code_base64;
      resposta.expires_at     = mpData.date_of_expiration;
    }

    if (tipo === 'cartao') {
      resposta.mensagem = mpData.status === 'approved'
        ? 'Pagamento aprovado! 🎉'
        : mpData.status === 'rejected'
          ? `Pagamento recusado: ${mpData.status_detail}`
          : 'Pagamento em análise.';
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
