/**
 * VIRTÙ — Edge Function: notificar-pedido-admin
 * Envia notificação WhatsApp para a admin via Z-API quando um pedido é feito ou confirmado.
 *
 * Pode ser chamada com:
 *   { pedido_id: string }              → busca dados completos do pedido no DB
 *   { pedido_id, cliente, endereco,    → usa dados fornecidos diretamente (mais rápido,
 *     itens, total, ..., status }         sem roundtrip extra ao banco)
 *
 * Secrets necessários (Supabase Dashboard → Settings → Edge Functions → Secrets):
 *   ZAPI_INSTANCE_ID   — ID da instância Z-API (ex: "3ABC123...")
 *   ZAPI_TOKEN         — Token da instância Z-API
 *   ADMIN_WHATSAPP     — Número da admin com DDI+DDD (ex: "5583999947734")
 *   SUPABASE_URL       — Injetado automaticamente
 *   SUPABASE_SERVICE_ROLE_KEY — Injetado automaticamente
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID');
    const ZAPI_TOKEN    = Deno.env.get('ZAPI_TOKEN');
    const ADMIN_PHONE   = Deno.env.get('ADMIN_WHATSAPP') || '5583999947734';

    if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
      console.error('[WhatsApp] Secrets ZAPI_INSTANCE_ID e ZAPI_TOKEN não configurados');
      // Retorna 200 para não interromper o fluxo do pedido
      return json({ ok: false, msg: 'Z-API não configurado — pedido salvo normalmente' });
    }

    const body = await req.json();

    // ── Monta dados do pedido ──────────────────────────────
    let dados: Record<string, unknown> = { ...body };

    // Se só veio pedido_id (chamada do pix-webhook), busca tudo no banco
    if (body.pedido_id && !body.itens) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const { data: pedido, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', body.pedido_id)
        .single();

      if (error || !pedido) {
        console.error('[WhatsApp] Pedido não encontrado:', body.pedido_id, error?.message);
        return json({ ok: false, msg: 'Pedido não encontrado' });
      }

      dados = {
        pedido_id:        pedido.id,
        status:           pedido.status,
        metodo_pagamento: pedido.payment_method,
        total:            pedido.total,
        subtotal:         pedido.subtotal,
        frete:            pedido.frete,
        desconto:         pedido.desconto,
        itens:            pedido.itens || [],
        cliente: {
          nome:     pedido.cliente_nome || pedido.nome_cliente,
          email:    pedido.cliente_email || pedido.email_cliente,
          cpf:      pedido.cpf_cliente,
          telefone: pedido.cliente_telefone || pedido.telefone,
        },
        endereco: {
          cep:         pedido.cep,
          rua:         pedido.rua,
          numero:      pedido.numero,
          complemento: pedido.complemento,
          bairro:      pedido.bairro,
          cidade:      pedido.cidade,
          estado:      pedido.estado,
        },
      };
    }

    // ── Formata e envia a mensagem ─────────────────────────
    const mensagem = formatarMensagem(dados);

    const zapiRes = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: ADMIN_PHONE, message: mensagem }),
      },
    );

    const zapiData = await zapiRes.json().catch(() => ({}));

    if (!zapiRes.ok) {
      console.error('[WhatsApp Z-API]', zapiRes.status, JSON.stringify(zapiData));
      return json({ ok: false, msg: 'Falha ao enviar WhatsApp', detalhes: zapiData });
    }

    console.log('[WhatsApp] Notificação enviada →', ADMIN_PHONE, '| pedido:', dados.pedido_id);
    return json({ ok: true });

  } catch (err) {
    console.error('[WhatsApp Unexpected]', err);
    // Não quebra o fluxo do pedido
    return json({ ok: false, msg: 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────
// Formata a mensagem WhatsApp com todos os dados do pedido
// ─────────────────────────────────────────────────────────────
function formatarMensagem(d: Record<string, unknown>): string {
  const cliente  = (d.cliente  as Record<string, string> | null) ?? {};
  const endereco = (d.endereco as Record<string, string> | null) ?? {};
  const itens    = (d.itens    as Record<string, unknown>[] | null) ?? [];

  const fmtBRL = (v: unknown) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmtCPF = (cpf: string) => {
    const d = (cpf || '').replace(/\D/g, '');
    return d.length === 11
      ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
      : cpf || '—';
  };

  const pedidoShort = d.pedido_id
    ? String(d.pedido_id).slice(-6).toUpperCase()
    : '—';

  const statusLabel =
    d.status === 'pago'     ? '✅ PAGO'            :
    d.status === 'pendente' ? '⏳ PIX AGUARDANDO'  :
    d.status === 'recusado' ? '❌ RECUSADO'         :
    String(d.status || '—').toUpperCase();

  const metodoPagto =
    d.metodo_pagamento === 'pix'    ? '⚡ PIX'             :
    d.metodo_pagamento === 'cartao' ? '💳 Cartão de Crédito' :
    String(d.metodo_pagamento || '—');

  // Endereço
  const endLines = [
    endereco.rua && endereco.numero
      ? `${endereco.rua}, ${endereco.numero}${endereco.complemento ? ' – ' + endereco.complemento : ''}`
      : null,
    endereco.bairro || null,
    endereco.cidade && endereco.estado ? `${endereco.cidade}/${endereco.estado}` : null,
    endereco.cep ? `CEP: ${String(endereco.cep).replace(/(\d{5})(\d{3})/, '$1-$2')}` : null,
  ].filter(Boolean).join('\n');

  // Itens
  const itensLines = itens.map((it) => {
    const nome    = String(it.nome || it.name || 'Produto');
    const tam     = String(it.tamanho || it.size || '');
    const cor     = String(it.cor_nome || it.cor || '');
    const qty     = Number(it.qty || it.quantidade || 1);
    const preco   = fmtBRL(Number(it.preco || it.price || 0));
    const variante = [tam, cor].filter(Boolean).join(' / ');
    return `  • ${nome}${variante ? ` (${variante})` : ''} × ${qty} — ${preco}`;
  }).join('\n');

  const freteStr  = Number(d.frete || 0) === 0 ? 'Grátis' : fmtBRL(Number(d.frete));
  const descStr   = Number(d.desconto || 0) > 0
    ? `\n💸 *Desconto:* -${fmtBRL(Number(d.desconto))}` : '';

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' });

  return [
    `🛍️ *NOVO PEDIDO — VIRTÙ*`,
    `${statusLabel}`,
    ``,
    `📋 *Pedido #${pedidoShort}*`,
    `📅 ${agora}`,
    ``,
    `━━━━━━━━━━━━━━━━`,
    `👤 *CLIENTE*`,
    `Nome: ${cliente.nome || '—'}`,
    `📧 ${cliente.email || '—'}`,
    `📱 ${cliente.telefone || '—'}`,
    `🪪 CPF: ${fmtCPF(cliente.cpf || '')}`,
    ``,
    `━━━━━━━━━━━━━━━━`,
    `📍 *ENDEREÇO DE ENTREGA*`,
    endLines || '—',
    ``,
    `━━━━━━━━━━━━━━━━`,
    `🛒 *ITENS DO PEDIDO*`,
    itensLines || '  (nenhum item)',
    ``,
    `━━━━━━━━━━━━━━━━`,
    `💰 *VALORES*`,
    `Subtotal: ${fmtBRL(Number(d.subtotal ?? d.total))}`,
    `Frete: ${freteStr}${descStr}`,
    `*Total: ${fmtBRL(Number(d.total))}*`,
    ``,
    `${metodoPagto}`,
    `━━━━━━━━━━━━━━━━`,
    `_Virtù Admin_`,
  ].join('\n');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
