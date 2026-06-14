/**
 * send-order-email — Virtù
 * Dispara dois e-mails automáticos após confirmação de pedido:
 *   1. Para o cliente: confirmação premium com itens e link de rastreio
 *   2. Para a loja (wearvirtu@gmail.com): notificação de novo pedido PAGO
 *
 * Pode ser chamado com dados completos (de processar-pagamento) ou apenas
 * com { pedido_id, status } (de pix-webhook) — neste caso busca os dados no DB.
 *
 * Chamado por:
 *   - processar-pagamento: após confirmar pagamento (status pago ou pendente)
 *   - pix-webhook: após PIX confirmado (status pago)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Chamado apenas server-to-server (processar-pagamento / pix-webhook); CORS restrito.
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
  'Content-Security-Policy':   "default-src 'none'",
};

const SITE_URL    = 'https://wearvirtu.com';
const STORE_EMAIL = 'wearvirtu@gmail.com';
const FROM_EMAIL  = 'Virtù <notificacoes@wearvirtu.com>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_KEY) {
      return json({ erro: 'RESEND_API_KEY não configurada.' }, 500);
    }

    const body = await req.json();

    // ── Resolve dados do pedido ──────────────────────────────────────
    // Se só veio pedido_id (chamada do pix-webhook), busca tudo no banco.
    let {
      pedido_id,
      cliente,
      endereco,
      itens,
      total,
      subtotal,
      frete,
      desconto,
      metodo_pagamento,
      parcelas,
      status,
    } = body;

    if (pedido_id && !itens) {
      // Sem itens → chamada mínima do webhook; busca dados completos no DB
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const { data: pedido, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', pedido_id)
        .single();

      if (error || !pedido) {
        console.error('[send-order-email] Pedido não encontrado:', pedido_id, error?.message);
        return json({ erro: 'Pedido não encontrado no banco' }, 404);
      }

      // Mapeia colunas do banco para o formato esperado pelo template
      itens             = pedido.itens || [];
      total             = pedido.total;
      subtotal          = pedido.subtotal;
      frete             = pedido.frete;
      desconto          = pedido.desconto;
      metodo_pagamento  = pedido.payment_method || pedido.metodo_pagamento;
      parcelas          = pedido.parcelas;
      status            = status || pedido.status; // usa status do body se fornecido
      cliente = {
        nome:     pedido.cliente_nome  || pedido.nome_cliente,
        email:    pedido.cliente_email || pedido.email_cliente,
        cpf:      pedido.cpf_cliente,
        telefone: pedido.cliente_telefone || pedido.telefone,
      };
      endereco = {
        cep:         pedido.cep,
        rua:         pedido.rua,
        numero:      pedido.numero,
        complemento: pedido.complemento,
        bairro:      pedido.bairro,
        cidade:      pedido.cidade,
        estado:      pedido.estado,
      };
    }

    const fmtBRL = (v: number) =>
      Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Mascara CPF para exibição segura no e-mail: ***.NNN.NNN-**
    function maskCpf(cpf: string): string {
      const d = String(cpf || '').replace(/\D/g, '');
      if (d.length !== 11) return cpf || '—';
      return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
    }

    // Formata endereço completo da cliente para o e-mail de confirmação
    function formatEndereco(end: Record<string, unknown> | null | undefined): string {
      if (!end) return '—';
      const linha1 = [end.rua, end.numero, end.complemento].filter(Boolean).join(', ');
      const linha2 = [end.bairro, end.cidade, end.estado ? String(end.estado).toUpperCase() : ''].filter(Boolean).join(' — ');
      const cep    = end.cep ? `CEP ${String(end.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '';
      return [linha1, linha2, cep].filter(Boolean).join(' · ');
    }

    const pedidoNum = pedido_id ? String(pedido_id).slice(-6) : '------';

    const metodoPagto =
      metodo_pagamento === 'pix'    ? 'PIX' :
      metodo_pagamento === 'cartao' ? `Cartão de crédito${Number(parcelas) > 1 ? ` (${parcelas}x)` : ''}` :
      metodo_pagamento || '—';

    const primeiroNome = (cliente?.nome || 'Cliente').split(' ')[0];
    const rastreioUrl  = `${SITE_URL}/rastreio.html?id=${pedido_id}`;

    // ── 1. E-mail premium para o cliente ────────────────────────────
    const itensHtmlCliente = (itens ?? []).map((it: Record<string, unknown>) => `
      <tr>
        <td style="padding:12px 8px;border-bottom:1px solid #f0ebe4">
          <div style="font-size:13px;font-weight:600;color:#1A2744;line-height:1.4">
            ${it.nome || it.name || 'Produto'}
          </div>
          ${it.tamanho ? `<div style="font-size:11px;color:#999;margin-top:3px">Tam: ${it.tamanho}</div>` : ''}
          ${(it.cor_nome || it.cor) ? `<div style="font-size:11px;color:#999">Cor: ${it.cor_nome || it.cor}</div>` : ''}
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #f0ebe4;text-align:center;font-size:13px;color:#666">
          ${it.qty || it.quantidade || 1}
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #f0ebe4;text-align:right;font-size:13px;font-weight:600;color:#1A2744;white-space:nowrap">
          ${fmtBRL(Number(it.preco || 0))}
        </td>
      </tr>`).join('');

    const descontoRow = Number(desconto) > 0 ? `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#888">Desconto</td>
        <td style="padding:5px 0;font-size:13px;text-align:right;color:#2e7d32">− ${fmtBRL(Number(desconto))}</td>
      </tr>` : '';

    const freteLabel = Number(frete) === 0
      ? '<span style="color:#2e7d32">Grátis 🎉</span>'
      : fmtBRL(Number(frete));

    const htmlCliente = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pedido confirmado — Virtù</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ee;font-family:Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased">

  <div style="max-width:600px;margin:0 auto;padding:40px 16px 60px">

    <!-- Logotipo -->
    <div style="text-align:center;margin-bottom:36px">
      <p style="margin:0;font-size:34px;color:#1A2744;letter-spacing:7px;font-style:italic;font-weight:normal">VIRTÙ</p>
      <div style="width:40px;height:1px;background:#C4934A;margin:14px auto 0"></div>
    </div>

    <!-- Card principal -->
    <div style="background:#fff;border-radius:2px;box-shadow:0 2px 12px rgba(0,0,0,.07);overflow:hidden">

      <!-- Header azul -->
      <div style="background:#1A2744;padding:40px 40px 36px;text-align:center">
        <div style="width:52px;height:52px;border-radius:50%;background:rgba(196,147,74,.18);border:1.5px solid rgba(196,147,74,.4);margin:0 auto 18px;line-height:52px;font-size:22px;color:#C4934A;text-align:center">
          ✓
        </div>
        <p style="margin:0;font-size:22px;color:#fff;letter-spacing:2.5px;font-weight:normal">Pedido Confirmado</p>
        <p style="margin:10px 0 0;font-size:13px;color:#C4934A;letter-spacing:2px">#${pedidoNum}</p>
      </div>

      <!-- Saudação -->
      <div style="padding:32px 40px 0">
        <p style="margin:0 0 6px;font-size:17px;color:#1A2744;font-weight:normal">Olá, ${primeiroNome}!</p>
        <p style="margin:0;font-size:14px;color:#666;line-height:1.75">
          Recebemos o seu pedido e já estamos preparando tudo com muito cuidado para você.
          Assim que o seu pedido for enviado, você receberá o código de rastreio.
        </p>
      </div>

      <!-- Itens -->
      <div style="padding:28px 40px 0">
        <p style="margin:0 0 14px;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:2.5px">Itens do pedido</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <thead>
            <tr style="background:#f9f6f2">
              <th style="padding:9px 8px;text-align:left;font-size:10px;color:#aaa;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #f0ebe4">Produto</th>
              <th style="padding:9px 8px;text-align:center;font-size:10px;color:#aaa;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #f0ebe4">Qtd</th>
              <th style="padding:9px 8px;text-align:right;font-size:10px;color:#aaa;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #f0ebe4">Preço</th>
            </tr>
          </thead>
          <tbody>${itensHtmlCliente}</tbody>
        </table>
      </div>

      <!-- Totais -->
      <div style="padding:20px 40px 28px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#888">Subtotal</td>
            <td style="padding:5px 0;font-size:13px;text-align:right;color:#333">${fmtBRL(Number(subtotal ?? total))}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#888">Frete</td>
            <td style="padding:5px 0;font-size:13px;text-align:right">${freteLabel}</td>
          </tr>
          ${descontoRow}
          <tr>
            <td colspan="2"><div style="height:1px;background:#e8e0d6;margin:10px 0"></div></td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:16px;font-weight:bold;color:#1A2744">Total pago</td>
            <td style="padding:4px 0;font-size:16px;font-weight:bold;text-align:right;color:#C4934A">${fmtBRL(Number(total))}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:5px 0;font-size:12px;color:#aaa">Pagamento via ${metodoPagto}</td>
          </tr>
        </table>
      </div>

      <!-- Divisor pós-totais -->
      <div style="height:1px;background:#f0ebe4;margin:0 40px"></div>

      <!-- Dados de entrega: Nome completo, CPF e Endereço -->
      <div style="padding:24px 40px 28px">
        <p style="margin:0 0 12px;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:2.5px">Dados de entrega</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#aaa;width:35%;vertical-align:top">Nome</td>
            <td style="padding:6px 0;font-size:13px;color:#1A2744;font-weight:600">${cliente?.nome || '—'}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#aaa;vertical-align:top">CPF</td>
            <td style="padding:6px 0;font-size:13px;color:#555">${maskCpf(cliente?.cpf)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#aaa;vertical-align:top">Endereço</td>
            <td style="padding:6px 0;font-size:13px;color:#555;line-height:1.5">${formatEndereco(endereco)}</td>
          </tr>
        </table>
      </div>

      <!-- Divisor pré-CTA -->
      <div style="height:1px;background:#f0ebe4;margin:0 40px"></div>

      <!-- CTA Rastreio -->
      <div style="padding:32px 40px;text-align:center">
        <p style="margin:0 0 20px;font-size:13px;color:#888;line-height:1.6">
          Acompanhe o status do seu pedido em tempo real clicando no botão abaixo.
        </p>
        <a href="${rastreioUrl}"
           style="display:inline-block;background:#1A2744;color:#fff;text-decoration:none;padding:15px 36px;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;border-radius:1px;font-family:Helvetica,Arial,sans-serif">
          Rastrear meu pedido →
        </a>
        <p style="margin:14px 0 0;font-size:11px;color:#ccc">
          ou: <a href="${rastreioUrl}" style="color:#C4934A;text-decoration:none">${rastreioUrl}</a>
        </p>
      </div>

    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:28px 0 0">
      <p style="margin:0;font-size:12px;color:#bbb">
        © Virtù — Moda Feminina ·
        <a href="${SITE_URL}" style="color:#bbb;text-decoration:none">wearvirtu.com</a>
      </p>
      <p style="margin:6px 0 0;font-size:11px;color:#d5d0c8">
        Este e-mail foi gerado automaticamente. Dúvidas? Fale conosco pelo WhatsApp.
      </p>
    </div>

  </div>
</body>
</html>`;

    // ── 2. E-mail de notificação para a loja ────────────────────────
    const itensHtmlLoja = (itens ?? []).map((it: Record<string, unknown>) => `
      <tr>
        <td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:13px;color:#333">${it.nome || it.name || 'Produto'}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:#555">${it.tamanho || '—'}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:#555">${it.qty || it.quantidade || 1}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:right;font-size:13px;font-weight:600;color:#1A2744">${fmtBRL(Number(it.preco || 0))}</td>
      </tr>`).join('');

    const enderecoStr = endereco
      ? `${endereco.rua || ''}, ${endereco.numero || ''} — ${endereco.bairro || ''}, ${endereco.cidade || ''}/${endereco.estado || ''} · CEP ${endereco.cep || ''}`
      : '—';

    const htmlLoja = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Novo Pedido — Virtù</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ee;font-family:Georgia,'Times New Roman',serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:2px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:#1A2744;padding:26px 32px;text-align:center">
      <p style="margin:0;color:#C4934A;font-size:22px;letter-spacing:4px;font-style:italic">VIRTÙ</p>
      <p style="margin:8px 0 0;color:#fff;font-size:12px;letter-spacing:2px">🛍️ NOVO PEDIDO CONFIRMADO NO SITE</p>
    </div>

    <!-- Info principal -->
    <div style="padding:26px 32px 0">
      <div style="background:#f9f6f2;border-radius:2px;padding:14px 16px;margin-bottom:20px">
        <p style="margin:0;font-size:18px;color:#1A2744;font-weight:bold">Pedido #${pedidoNum}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#C4934A;font-weight:600">${fmtBRL(Number(total))} · ${metodoPagto}</p>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#333;margin-bottom:20px">
        <tr><td style="padding:5px 0;color:#888;width:38%">Cliente</td><td style="font-weight:600">${cliente?.nome || '—'}</td></tr>
        <tr><td style="padding:5px 0;color:#888">E-mail</td><td>${cliente?.email || '—'}</td></tr>
        <tr><td style="padding:5px 0;color:#888">Telefone</td><td>${cliente?.telefone || '—'}</td></tr>
        <tr><td style="padding:5px 0;color:#888">Endereço</td><td style="font-size:12px">${enderecoStr}</td></tr>
      </table>

      <!-- Itens -->
      <p style="margin:0 0 10px;font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:2px">Itens</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr style="background:#f9f6f2">
            <th style="padding:7px 8px;text-align:left;font-size:11px;color:#888;font-weight:600">Produto</th>
            <th style="padding:7px 8px;text-align:center;font-size:11px;color:#888;font-weight:600">Tam.</th>
            <th style="padding:7px 8px;text-align:center;font-size:11px;color:#888;font-weight:600">Qtd.</th>
            <th style="padding:7px 8px;text-align:right;font-size:11px;color:#888;font-weight:600">Preço</th>
          </tr>
        </thead>
        <tbody>${itensHtmlLoja}</tbody>
      </table>

      <!-- Total -->
      <div style="margin:16px 0 0;padding:14px 0 0;border-top:2px solid #1A2744;text-align:right">
        <span style="font-size:15px;font-weight:bold;color:#C4934A">Total: ${fmtBRL(Number(total))}</span>
      </div>
    </div>

    <!-- CTA admin -->
    <div style="padding:24px 32px;text-align:center">
      <a href="${SITE_URL}/admin/"
         style="display:inline-block;background:#C4934A;color:#fff;text-decoration:none;padding:12px 28px;font-size:12px;letter-spacing:2px;text-transform:uppercase;border-radius:1px;font-family:Helvetica,Arial,sans-serif">
        Abrir painel admin →
      </a>
    </div>

  </div>
</body>
</html>`;

    // ── Disparar os e-mails ──────────────────────────────────────────
    const emails: Promise<Response>[] = [];

    // E-mail para o cliente: apenas quando pedido pago E cliente tem e-mail
    if (status === 'pago' && cliente?.email) {
      emails.push(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [cliente.email],
          subject: `✅ Pedido #${pedidoNum} confirmado — Obrigada por comprar na Virtù!`,
          html:    htmlCliente,
        }),
      }));
    }

    // E-mail para a loja: APENAS quando pedido pago
    // (evita e-mail duplicado: PIX pendente → PIX confirmado)
    if (status === 'pago') {
      emails.push(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [STORE_EMAIL],
          subject: `🛍️ Novo pedido #${pedidoNum} — ${fmtBRL(Number(total))} (${metodoPagto})`,
          html:    htmlLoja,
        }),
      }));
    }

    if (emails.length === 0) {
      console.log(`[send-order-email] Status '${status}' — nenhum e-mail enviado (aguardando confirmação)`);
      return json({ ok: true, enviados: 0, msg: 'Aguardando confirmação de pagamento' });
    }

    const results = await Promise.allSettled(emails);
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => (r as PromiseRejectedResult).reason?.message ?? 'Erro desconhecido');


    return json({ ok: true, enviados: emails.length, erros: errors.length ? errors : undefined });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-order-email]', message);
    return json({ erro: message }, 500);
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
