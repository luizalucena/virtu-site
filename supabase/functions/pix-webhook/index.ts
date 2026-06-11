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

// Webhook chamado server-to-server pelo Mercado Pago; CORS restrito por defesa em profundidade.
const corsHeaders = {
  'Access-Control-Allow-Origin':  'https://wearvirtu.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // ── Validação de assinatura HMAC (Mercado Pago) ──────────────
    // Configure em: MP Dashboard → Seu aplicativo → Webhooks → Chave secreta
    // Variável de ambiente: MP_WEBHOOK_SECRET
    const WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET');

    if (WEBHOOK_SECRET) {
      const xSignature = req.headers.get('x-signature') || '';
      const xRequestId = req.headers.get('x-request-id') || '';

      // Extrai ts e v1 do header "ts=...,v1=..."
      const sigParts: Record<string, string> = {};
      for (const part of xSignature.split(',')) {
        const [k, v] = part.split('=');
        if (k && v) sigParts[k.trim()] = v.trim();
      }

      const ts = sigParts['ts'];
      const v1 = sigParts['v1'];

      if (!ts || !v1) {
        console.error('[Webhook] x-signature ausente ou malformado');
        return json({ erro: 'Assinatura inválida' }, 401);
      }

      // Mensagem: id:[paymentId];request-id:[xRequestId];ts:[ts]
      const dataId   = String(body.data?.id ?? '');
      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts}`;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(WEBHOOK_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(manifest));
      const computed  = Array.from(new Uint8Array(sigBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (computed !== v1) {
        console.error('[Webhook] Assinatura HMAC inválida — possível webhook forjado');
        return json({ erro: 'Assinatura inválida' }, 401);
      }
    } else {
      // Secret não configurado — avisa mas não bloqueia (permite ativação gradual)
      console.warn('[Webhook] MP_WEBHOOK_SECRET não configurado — validação HMAC desativada');
    }

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

    // ── Update atômico: só atualiza se ainda estiver 'pendente' ─
    // Evita processamento duplo caso o MP dispare o webhook mais de uma vez.
    const { data: updatedRows, error: updateErr } = await supabase
      .from('pedidos')
      .update({ status: 'pago', payment_status: 'approved', email_enviado: false })
      .eq('payment_id', paymentId)
      .eq('status', 'pendente')  // condição atômica — só atualiza se ainda pendente
      .select('id')
      .maybeSingle();

    if (updateErr) {
      console.error('[Webhook] Erro ao atualizar pedido:', updateErr.message);
      return json({ erro: 'Falha ao atualizar pedido' }, 500);
    }

    if (!updatedRows) {
      // Nenhuma linha afetada — pedido não encontrado ou já estava pago
      console.log(`[Webhook] PIX ignorado (pedido já pago ou não encontrado) — payment_id ${paymentId}`);
      return json({ ok: true, msg: 'Pedido já processado ou não encontrado' });
    }

    const pedidoId = updatedRows.id;
    console.log(`[Webhook] PIX confirmado: pedido ${pedidoId} → pago`);

    // ── Fidelidade: incrementa compras_pagas da cliente ────
    // Busca user_id do pedido para registrar a compra confirmada
    try {
      const { data: pedidoRow } = await supabase
        .from('pedidos')
        .select('user_id')
        .eq('id', pedidoId)
        .maybeSingle();

      if (pedidoRow?.user_id) {
        const { error: fidErr } = await supabase
          .rpc('registrar_compra_fidelidade', { p_user_id: pedidoRow.user_id });
        if (fidErr) console.error('[Webhook] Fidelidade erro:', fidErr.message);
        else console.log(`[Webhook] Fidelidade registrada para user ${pedidoRow.user_id}`);
      }
    } catch (fidEx) {
      console.error('[Webhook] Fidelidade exception:', fidEx);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY');

    if (SUPABASE_URL && ANON_KEY) {
      // ── E-mail de confirmação para a cliente (fire-and-forget) ──
      fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ pedido_id: pedidoId, status: 'pago' }),
      }).catch(e => console.error('[Email PIX dispatch]', e));

      // ── Notificação WhatsApp admin (fire-and-forget) ──────────
      fetch(`${SUPABASE_URL}/functions/v1/notificar-pedido-admin`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ pedido_id: pedidoId }),
      }).catch(e => console.error('[WhatsApp PIX dispatch]', e));
    }

    return json({ ok: true, pedido_id: pedidoId });

  } catch (err) {
    console.error('[Webhook] Erro inesperado:', err);
    return json({ erro: 'Erro interno' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      ...securityHeaders,
      'Content-Type': 'application/json',
    },
  });
}
