/**
 * VIRTÙ — Edge Function: asaas-webhook
 * Recebe eventos do ASAAS e processa confirmações de pagamento em tempo real.
 *
 * Configurar no painel ASAAS:
 *   Dashboard → Integrações → Webhooks → Nova URL
 *   URL: https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/asaas-webhook
 *   Eventos: PAYMENT_CONFIRMED, PAYMENT_RECEIVED
 *
 * Variáveis de ambiente necessárias:
 *   ASAAS_WEBHOOK_TOKEN     — Token de autenticação do webhook (configurado no ASAAS)
 *   SUPABASE_URL            — Injetada automaticamente
 *   SUPABASE_SERVICE_ROLE_KEY — Injetada automaticamente
 *   SUPABASE_ANON_KEY       — Injetada automaticamente
 *
 * Eventos tratados:
 *   PAYMENT_CONFIRMED — cartão/débito aprovado imediatamente
 *   PAYMENT_RECEIVED  — PIX ou boleto compensado
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

// Eventos ASAAS que indicam pagamento confirmado
const EVENTOS_PAGAMENTO_CONFIRMADO = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
]);

Deno.serve(async (req) => {
  // Webhook é POST server-to-server; sem CORS necessário
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: securityHeaders });
  }
  if (req.method !== 'POST') {
    return json({ erro: 'Método não permitido' }, 405);
  }

  try {
    // ── Validação do token de autenticação ASAAS ─────────────
    // O ASAAS envia o header "asaas-access-token" em cada notificação.
    // Configure ASAAS_WEBHOOK_TOKEN no Supabase Secrets.
    const WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN');
    if (WEBHOOK_TOKEN) {
      const tokenRecebido = req.headers.get('asaas-access-token') || '';
      if (tokenRecebido !== WEBHOOK_TOKEN) {
        console.error('[asaas-webhook] Token inválido — possível requisição forjada');
        return json({ erro: 'Não autorizado' }, 401);
      }
    } else {
      console.warn('[asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado — validação desativada');
    }

    const body = await req.json();
    const evento     = String(body.event    ?? '');
    const paymentObj = body.payment as Record<string, unknown> | undefined;

    console.log(`[asaas-webhook] Evento recebido: ${evento}`);

    // ── Filtra apenas eventos de confirmação de pagamento ────
    if (!EVENTOS_PAGAMENTO_CONFIRMADO.has(evento)) {
      return json({ ok: true, msg: `Evento "${evento}" ignorado` });
    }

    // O objeto payment vem embutido no body da notificação ASAAS
    const asaasPaymentId = String(paymentObj?.id ?? '');
    if (!asaasPaymentId) {
      console.error('[asaas-webhook] payment.id ausente no payload');
      return json({ erro: 'payload inválido' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Atualização atômica do pedido ────────────────────────
    // Só atualiza se ainda estiver 'pendente' (evita processamento duplo).
    const { data: pedidoAtualizado, error: updateErr } = await supabase
      .from('pedidos')
      .update({
        status:         'pago',
        payment_status: 'RECEIVED',
        email_enviado:  false,    // força reenvio do e-mail de confirmação
      })
      .eq('asaas_payment_id', asaasPaymentId)
      .eq('status', 'pendente')  // condição atômica
      .select('id, user_id, itens')
      .maybeSingle();

    if (updateErr) {
      console.error('[asaas-webhook] Erro ao atualizar pedido:', updateErr.message);
      return json({ erro: 'Falha ao atualizar pedido' }, 500);
    }

    if (!pedidoAtualizado) {
      // Pedido não encontrado ou já estava pago → idempotente
      console.log(`[asaas-webhook] Nenhuma ação: asaas_payment_id=${asaasPaymentId} (não encontrado ou já pago)`);
      return json({ ok: true, msg: 'Pedido já processado ou não encontrado' });
    }

    const pedidoId = pedidoAtualizado.id as string;
    const userId   = pedidoAtualizado.user_id as string | null;
    const itens    = (pedidoAtualizado.itens as any[]) || [];

    console.log(`[asaas-webhook] ${evento}: pedido ${pedidoId} → pago`);

    // ── Decremento de estoque (fire-and-forget) ──────────────
    // Só itens com variacao_id definido
    const variacaoItems = itens.filter((i: any) => i.variacao_id);
    if (variacaoItems.length > 0) {
      try {
        await Promise.allSettled(
          variacaoItems.map((i: any) =>
            supabase.rpc('comprar_variacao', {
              p_variacao_id: i.variacao_id,
              p_quantidade:  i.qty || 1,
            })
          )
        );
        console.log(`[asaas-webhook] Estoque decrementado: ${variacaoItems.length} variação(ões)`);
      } catch (stockErr) {
        console.error('[asaas-webhook] Erro ao decrementar estoque:', stockErr);
      }
    }

    // ── Fidelidade: registra a compra confirmada ─────────────
    if (userId) {
      try {
        const { data: fidData, error: fidErr } = await supabase
          .rpc('registrar_compra_fidelidade', { p_user_id: userId });

        if (fidErr) {
          console.error('[asaas-webhook] Fidelidade erro:', fidErr.message);
        } else {
          console.log(`[asaas-webhook] Fidelidade: compras_pagas=${fidData?.compras_pagas}`);

          // Se prêmio gerado → notifica a cliente por e-mail
          if (fidData?.desconto_100 === true && fidData?.codigo) {
            const SB_URL   = Deno.env.get('SUPABASE_URL');
            const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
            if (SB_URL && ANON_KEY) {
              fetch(`${SB_URL}/functions/v1/notificar-premio-fidelidade`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
                body: JSON.stringify({
                  user_id:  userId,
                  codigo:   fidData.codigo,
                  validade: fidData.validade,
                }),
              }).catch(e => console.error('[asaas-webhook] Premio dispatch erro:', e));
            }
          }
        }
      } catch (fidEx) {
        console.error('[asaas-webhook] Fidelidade exception:', fidEx);
      }
    }

    // ── E-mail de confirmação ao cliente + admin ─────────────
    const SB_URL   = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    if (SB_URL && ANON_KEY) {
      fetch(`${SB_URL}/functions/v1/send-order-email`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          pedido_id: pedidoId,
          status:    'pago',
        }),
      }).catch(e => console.error('[asaas-webhook] Email dispatch erro:', e));
    }

    return json({ ok: true, pedido_id: pedidoId });

  } catch (err) {
    console.error('[asaas-webhook] Erro inesperado:', err);
    return json({ erro: 'Erro interno' }, 500);
  }
});
