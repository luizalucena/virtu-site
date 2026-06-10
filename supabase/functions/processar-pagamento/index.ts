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

    if (dbError) throw new Error('[DB Insert] ' + dbError.message);

    // Decrementa estoque server-side (só cartão aprovado)
    // PIX: estoque decrementado pelo trigger fn_pedido_pago_para_fluxo quando pago
    if (pedido?.id && itens?.length && statusPedido === 'pago') {
      const decrements = (itens as any[])
        .filter((i) => i.variacao_id)
        .map((i) => supabase.rpc('comprar_variacao', {
          p_variacao_id: i.variacao_id,
          p_quantidade:  i.qty || 1,
        }));
      if (decrements.length > 0) await Promise.allSettled(decrements);
    }

    //  ── Notificação por e-mail (via send-order-email) ──
    try {
      const SUPABASE_URL  = Deno.env.get('SUPABASE_URL');
      const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY');
      if (SUPABASE_URL && ANON_KEY && pedido?.id) {
        // Delega toda lógica de e-mail (cliente + loja) para a Edge Function dedicada
        fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({
            pedido_id:        pedido.id,
            cliente,
            endereco,
            itens,
            total,
            subtotal,
            frete,
            desconto,
            metodo_pagamento: tipo,
            parcelas,
            status:           statusPedido,
          }),
        }).catch(e => console.error('[Email dispatch]', e));
      }
      // ─── BLOCO LEGADO REMOVIDO ─── (substituído por send-order-email)
      if (false) {
        const fmtBRL = (v: number) =>
          Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        const metodoPagto =
          tipo === 'pix'    ? 'PIX' :
          tipo === 'cartao' ? `Cartão de crédito${parcelas > 1 ? ` (${parcelas}x)` : ''}` : tipo;

        const statusLabel =
          statusPedido === 'pago'     ? '✅ Pago' :
          statusPedido === 'recusado' ? '❌ Recusado' : '⏳ Pendente';

        const itensHtml = (itens ?? []).map((it: Record<string, unknown>) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${it.nome || it.name || 'Produto'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.tamanho || '—'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.qty || it.quantidade || 1}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${fmtBRL(Number(it.preco || 0))}</td>
          </tr>`).join('');

        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Georgia,serif;background:#f5f2ee">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <!-- Header -->
    <div style="background:#1A2744;padding:28px 32px;text-align:center">
      <p style="margin:0;color:#C4934A;font-size:22px;letter-spacing:4px;font-style:italic">VIRTÙ</p>
      <p style="margin:8px 0 0;color:#fff;font-size:13px;letter-spacing:1px">NOVO PEDIDO RECEBIDO</p>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="margin:0 0 4px;font-size:13px;color:#888">Pedido</p>
      <p style="margin:0 0 20px;font-size:18px;font-weight:bold;color:#1A2744">#${String(pedido.id).slice(-6)}</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#333;margin-bottom:20px">
        <tr>
          <td style="padding:6px 0;color:#888;width:40%">Status</td>
          <td style="padding:6px 0"><strong>${statusLabel}</strong></td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#888">Pagamento</td>
          <td style="padding:6px 0">${metodoPagto}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#888">Cliente</td>
          <td style="padding:6px 0">${cliente.nome}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#888">E-mail</td>
          <td style="padding:6px 0">${cliente.email}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#888">Telefone</td>
          <td style="padding:6px 0">${cliente.telefone || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#888">Endereço</td>
          <td style="padding:6px 0">${endereco?.rua || ''}, ${endereco?.numero || ''} — ${endereco?.bairro || ''}, ${endereco?.cidade || ''}/${endereco?.estado || ''} · CEP ${endereco?.cep || ''}</td>
        </tr>
      </table>

      <!-- Itens -->
      <p style="margin:0 0 8px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px">Itens do pedido</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#333;margin-bottom:20px">
        <thead>
          <tr style="background:#f9f6f2">
            <th style="padding:6px 8px;text-align:left;font-weight:600;color:#888">Produto</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;color:#888">Tam.</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;color:#888">Qtd.</th>
            <th style="padding:6px 8px;text-align:right;font-weight:600;color:#888">Preço</th>
          </tr>
        </thead>
        <tbody>${itensHtml}</tbody>
      </table>

      <!-- Totais -->
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#333">
        <tr>
          <td style="padding:4px 0;color:#888">Subtotal</td>
          <td style="padding:4px 0;text-align:right">${fmtBRL(Number(subtotal ?? total))}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888">Frete</td>
          <td style="padding:4px 0;text-align:right">${Number(frete) === 0 ? 'Grátis' : fmtBRL(Number(frete))}</td>
        </tr>
        ${Number(desconto) > 0 ? `
        <tr>
          <td style="padding:4px 0;color:#888">Desconto</td>
          <td style="padding:4px 0;text-align:right;color:#2e7d32">− ${fmtBRL(Number(desconto))}</td>
        </tr>` : ''}
        <tr style="border-top:2px solid #1A2744">
          <td style="padding:10px 0 0;font-weight:bold;font-size:15px;color:#1A2744">Total</td>
          <td style="padding:10px 0 0;text-align:right;font-weight:bold;font-size:15px;color:#C4934A">${fmtBRL(Number(total))}</td>
        </tr>
      </table>
    </div>
    <!-- Footer -->
    <div style="background:#f9f6f2;padding:16px 32px;text-align:center">
      <p style="margin:0;font-size:11px;color:#aaa">Este e-mail foi gerado automaticamente pelo sistema Virtù.</p>
    </div>
  </div>
</body>
</html>`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    'Virtù Loja <notificacoes@wearvirtu.com>',
            to:      ['wearvirtu@gmail.com'],
            subject: `🛍️ Novo pedido #${String(pedido.id).slice(-6)} — ${statusLabel} · ${fmtBRL(Number(total))}`,
            html,
          }),
        });
      } // fecha if(false) do bloco legado
    } catch (emailErr) {
      // E-mail falhou mas o pedido já foi salvo — apenas loga, não interrompe
      console.error('[Email Error]', emailErr);
    }

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
