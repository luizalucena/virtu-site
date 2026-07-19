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
 *   PAYMENT_RECEIVED  — PIX compensado
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

// Eventos que DEVOLVEM o estoque reservado (pedido não vai adiante):
// PIX vencido, estorno, chargeback, exclusão, reversão.
const EVENTOS_RESTAURA_ESTOQUE = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_REVERSED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_REFUND_IN_PROGRESS',
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
    // Fail-closed: sem token configurado, recusamos tudo. Evita que alguém
    // que descubra a URL pública forje um PAYMENT_CONFIRMED e marque pedidos
    // como pagos (fraude / baixa de estoque indevida).
    if (!WEBHOOK_TOKEN) {
      console.error('[asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado — recusando por segurança');
      return json({ erro: 'Webhook não configurado' }, 503);
    }
    const tokenRecebido = req.headers.get('asaas-access-token') || '';
    if (tokenRecebido !== WEBHOOK_TOKEN) {
      console.error('[asaas-webhook] Token inválido — possível requisição forjada');
      return json({ erro: 'Não autorizado' }, 401);
    }

    const body = await req.json();
    const evento     = String(body.event    ?? '');
    const paymentObj = body.payment as Record<string, unknown> | undefined;

    console.log(`[asaas-webhook] Evento recebido: ${evento}`);

    // ── Restauração de estoque (vencido/estorno/chargeback/exclusão) ──
    // RPC atômica devolve o estoque reservado UMA vez (idempotente por flag).
    if (EVENTOS_RESTAURA_ESTOQUE.has(evento)) {
      const pid = String(paymentObj?.id ?? '');
      if (!pid) return json({ erro: 'payload inválido' }, 400);
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      // status permitido pela constraint pedidos_status_check
      const novoStatus = 'cancelado';
      const { data: res, error: resErr } = await supabase
        .rpc('restaurar_estoque_por_payment', { p_payment_id: pid, p_status: novoStatus });
      if (resErr) {
        console.error('[asaas-webhook] Erro na restauração de estoque:', resErr.message);
        return json({ erro: 'Falha ao restaurar estoque' }, 500);
      }
      console.log(`[asaas-webhook] ${evento}:`, JSON.stringify(res));
      return json({ ok: true, ...(res as Record<string, unknown>) });
    }

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
      })
      .eq('asaas_payment_id', asaasPaymentId)
      .eq('status', 'pendente')  // condição atômica
      .select('id, user_id, itens, subtotal')
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

    const pedidoId      = pedidoAtualizado.id       as string;
    const userId        = pedidoAtualizado.user_id  as string | null;
    const itens         = (pedidoAtualizado.itens   as any[]) || [];
    const pedidoSubtotal = Number(pedidoAtualizado.subtotal ?? 0);

    console.log(`[asaas-webhook] ${evento}: pedido ${pedidoId} → pago`);

    // ── Estoque ──────────────────────────────────────────────
    // O decremento de estoque é feito atomicamente pelo trigger
    // trg_pedido_pago_baixa_estoque (AFTER UPDATE ON pedidos).
    // NÃO chamar comprar_variacao aqui — causaria duplo débito.
    console.log(`[asaas-webhook] Estoque: delegado ao trigger DB (trg_pedido_pago_baixa_estoque)`);

    // ── Gift Card ────────────────────────────────────────────
    // Nada a fazer aqui: a contagem de compras válidas é DERIVADA dos
    // pedidos pagos (gift_card_status), e o consumo do gift card já foi
    // marcado em `pedidos.gift_card_aplicado` na criação do pedido. Ao
    // virar 'pago' agora, o consumo passa a valer automaticamente; se for
    // cancelado/estornado depois, o benefício é liberado de volta sozinho.
    void pedidoSubtotal;

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
