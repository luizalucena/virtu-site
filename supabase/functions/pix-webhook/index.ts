/**
 * VIRTÙ — Edge Function: pix-webhook
 * Recebe notificações do Mercado Pago sobre pagamentos PIX confirmados.
 * Quando aprovado: atualiza o pedido para 'pago', o que aciona:
 *   - fn_pedido_pago_para_fluxo → cria entrada no fluxo_caixa
 *   - fn_pedido_pago_para_fluxo → decrementa estoque das variações
 *
 * Configurar no painel do Mercado Pago:
 *   Webhook URL: https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/pix-webhook
 *   Eventos: payment
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body.type !== 'payment' || !body.data?.id) {
      return json({ ok: true, msg: 'Evento ignorado' });
    }

    const paymentId = String(body.data.id);
    const MP_TOKEN  = Deno.env.get('MP_ACCESS_TOKEN');

    if (!MP_TOKEN) {
      console.error('[Webhook] MP_ACCESS_TOKEN não configurado');
      return json({ erro: 'Gateway não configurado' }, 500);
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}` },
    });

    if (!mpRes.ok) {
      console.error('[Webhook] Falha ao consultar pagamento:', paymentId);
      return json({ erro: 'Falha ao consultar MP' }, 502);
    }

    const mpData = await mpRes.json();

    if (mpData.status !== 'approved' || mpData.payment_type_id !== 'bank_transfer') {
      return json({ ok: true, msg: `Status ${mpData.status} — sem ação` });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: pedido, error: findErr } = await supabase
      .from('pedidos')
      .select('id, status')
      .eq('payment_id', paymentId)
      .single();

    if (findErr || !pedido) {
      console.error('[Webhook] Pedido não encontrado:', paymentId);
      return json({ erro: 'Pedido não encontrado' }, 404);
    }

    if (pedido.status === 'pago') {
      return json({ ok: true, msg: 'Pedido já estava pago' });
    }

    const { error: updateErr } = await supabase
      .from('pedidos')
      .update({ status: 'pago', payment_status: 'approved', email_enviado: false })
      .eq('id', pedido.id);

    if (updateErr) {
      console.error('[Webhook] Erro ao atualizar pedido:', updateErr.message);
      return json({ erro: 'Falha ao atualizar pedido' }, 500);
    }

    console.log(`[Webhook] PIX confirmado: pedido ${pedido.id} → pago`);
    return json({ ok: true, pedido_id: pedido.id });

  } catch (err) {
    console.error('[Webhook] Erro inesperado:', err);
    return json({ erro: 'Erro interno' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
