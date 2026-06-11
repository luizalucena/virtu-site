/**
 * VIRTÙ — Edge Function: notificar-abandono-carrinho
 * Envia WhatsApp automático para a cliente quando detecta abandono de carrinho.
 *
 * Chamado diretamente de carrinho-abandonado.js via supabaseClient.functions.invoke()
 * após salvar o registro em carrinhos_abandonados.
 *
 * Input POST:
 *   telefone       string  — número com DDI (ex: "5583999990000")
 *   nome?          string  — nome da cliente (fallback: "cliente")
 *   email?         string  — e-mail da cliente
 *   itens          array   — itens do carrinho: [{ nome, tamanho, cor_nome, qty, preco }]
 *   total          number  — valor total do carrinho
 *   url_recuperacao string — link direto para retomar o carrinho
 *   abandono_id?   string  — ID na tabela carrinhos_abandonados para marcar como enviado
 *
 * Variáveis de ambiente necessárias:
 *   ZAPI_INSTANCE_ID, ZAPI_TOKEN  — credenciais da Z-API
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — para atualizar o registro
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Chamado server-to-server (Edge Function); sem necessidade de CORS amplo.
const corsHeaders = {
  'Access-Control-Allow-Origin':  'https://wearvirtu.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE_ID');
    const ZAPI_TOKEN    = Deno.env.get('ZAPI_TOKEN');

    if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
      console.error('[notificar-abandono-carrinho] Credenciais Z-API não configuradas');
      return json({ erro: 'Serviço não configurado' }, 500);
    }

    const body = await req.json();
    const { telefone, nome, email, itens, total, url_recuperacao, abandono_id } = body;

    // ── Validação mínima ─────────────────────────────────────────────
    if (!telefone || String(telefone).replace(/\D/g, '').length < 10) {
      return json({ erro: 'Telefone inválido ou ausente' }, 400);
    }

    if (!url_recuperacao) {
      return json({ erro: 'url_recuperacao é obrigatória' }, 400);
    }

    const primeiroNome = nome ? nome.trim().split(' ')[0] : 'cliente';
    const totalFmt     = Number(total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // ── Formata lista de itens ───────────────────────────────────────
    const itensArr = Array.isArray(itens) ? itens : [];
    const itensFormatados = itensArr.map((it: Record<string, unknown>) => {
      const nome_item = String(it.nome || it.name || 'Produto');
      const tam       = it.tamanho ? ` | Tam: ${it.tamanho}` : '';
      const cor       = (it.cor_nome || it.cor) ? ` | Cor: ${it.cor_nome || it.cor}` : '';
      const qty       = Number(it.qty || it.quantidade || 1);
      const preco     = Number(it.preco || it.preco_desconto || 0);
      const precoFmt  = preco > 0 ? ` — ${preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '';
      const qtyStr    = qty > 1 ? ` × ${qty}` : '';
      return `• ${nome_item}${tam}${cor}${qtyStr}${precoFmt}`;
    }).join('\n');

    // ── Monta mensagem WhatsApp ──────────────────────────────────────
    // Mensagem direta, personalizada, com itens e link de retomada
    const mensagem = [
      `Oi ${primeiroNome}! 👋`,
      '',
      `Você deixou ${itensArr.length > 1 ? 'alguns itens' : 'um item'} no seu carrinho da Virtù. 🛍️`,
      '',
      itensFormatados || '• Itens no carrinho',
      '',
      `💰 *Total: ${totalFmt}*`,
      '',
      `Quando quiser retomar, é só clicar aqui:\n${url_recuperacao}`,
      '',
      `_Seus itens ficam reservados. Qualquer dúvida é só chamar! 💛_`,
    ].join('\n');

    // ── Envio via Z-API ──────────────────────────────────────────────
    const zapiUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

    const zapiRes = await fetch(zapiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone:   String(telefone),
        message: mensagem,
      }),
    });

    const zapiBody = await zapiRes.json().catch(() => ({}));

    if (!zapiRes.ok) {
      console.error('[notificar-abandono-carrinho] Z-API erro:', zapiRes.status, JSON.stringify(zapiBody));
      return json({ ok: false, erro: 'Falha no envio WhatsApp', detalhe: zapiBody }, 502);
    }

    // ── Marca registro como enviado ──────────────────────────────────
    if (abandono_id) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );

        await supabase
          .from('carrinhos_abandonados')
          .update({
            whatsapp_enviado: true,
            enviado_em:       new Date().toISOString(),
          })
          .eq('id', abandono_id);
      } catch (dbErr) {
        // Não bloqueia — o WA já foi enviado; apenas loga
        console.warn('[notificar-abandono-carrinho] Falha ao marcar enviado no DB:', dbErr);
      }
    }

    console.log(`[notificar-abandono-carrinho] WA enviado para ${String(telefone).slice(0, 4)}****`);
    return json({ ok: true });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notificar-abandono-carrinho] Erro inesperado:', msg);
    return json({ erro: msg }, 500);
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
