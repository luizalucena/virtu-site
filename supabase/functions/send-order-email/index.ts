/**
 * send-order-email — Virtù
 * Dispara dois e-mails automáticos após confirmação de pedido:
 *   1. Para o cliente: confirmação premium (boutique) com itens, resumo e entrega
 *   2. Para a loja (wearvirtu@gmail.com): notificação de novo pedido PAGO
 *
 * Pode ser chamado com dados completos (de processar-pagamento) ou apenas
 * com { pedido_id, status } (de asaas-webhook) — neste caso busca os dados no DB.
 *
 * Chamado por:
 *   - processar-pagamento: após confirmar pagamento (status pago ou pendente)
 *   - asaas-webhook: após PIX/cartão confirmado pelo ASAAS (status pago)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';

// Chamado apenas server-to-server (processar-pagamento / asaas-webhook); origin
// é null → cai na produção. Allowlist centralizada em _shared/cors.ts.
const corsHeaders = buildCorsHeaders(null);

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

// ── Paleta oficial (só estas cores no e-mail) ────────────────────────
const NAVY   = '#1a2a4a';
const GOLD   = '#b8943f';
const CREAM  = '#faf8f5';
const WHITE  = '#ffffff';
const INK    = '#2b2b2b';
const MUTED  = '#5a5a5a';
const LINE   = '#ece7db'; // divisória fina (equivalente sólido a navy .12 sobre creme)

const SERIF = "Georgia,'Times New Roman',serif";
const SANS  = "'Helvetica Neue',Arial,sans-serif";

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
    // Se só veio pedido_id (chamada do asaas-webhook), busca tudo no banco.
    let {
      pedido_id,
      numero_pedido,
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
      numero_pedido     = pedido.numero_pedido ?? numero_pedido;
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

    // Detalhes de uma peça: "Cor  ·  Tam M  ·  Qtd 2"
    function detalheItem(it: Record<string, unknown>): string {
      const qtd = it.qty || it.quantidade || 1;
      return [
        it.cor_nome || it.cor,
        it.tamanho ? `Tam ${it.tamanho}` : '',
        `Qtd ${qtd}`,
      ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');
    }

    const pedidoNum = numero_pedido
      ? `WV${numero_pedido}`
      : (pedido_id ? `WV${String(pedido_id).slice(-6).toUpperCase()}` : 'WV------');

    const metodoPagto =
      metodo_pagamento === 'pix'    ? 'PIX' :
      metodo_pagamento === 'cartao' ? `Cartão de crédito${Number(parcelas) > 1 ? ` (${parcelas}x)` : ''}` :
      metodo_pagamento === 'debito' ? 'Cartão de débito' :
      metodo_pagamento || '—';

    const primeiroNome = (cliente?.nome || 'Cliente').split(' ')[0];

    // Overline de seção (uppercase, letter-spacing, discreto)
    const overline = (txt: string) =>
      `<p style="margin:0 0 12px;font-family:${SANS};font-size:11px;letter-spacing:2px;color:${MUTED};text-transform:uppercase">${txt}</p>`;

    // ── 1. E-mail premium para o cliente ────────────────────────────
    const itensHtmlCliente = (itens ?? []).map((it: Record<string, unknown>) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid ${LINE};font-family:${SERIF};font-size:15px;color:${NAVY};line-height:1.4;vertical-align:top">
          ${it.nome || it.name || 'Produto'}
          <div style="font-family:${SANS};font-size:12px;color:${MUTED};margin-top:5px;letter-spacing:.02em">${detalheItem(it)}</div>
        </td>
        <td style="padding:14px 0 14px 12px;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:14px;color:${INK};text-align:right;white-space:nowrap;vertical-align:top">
          ${fmtBRL(Number(it.preco || 0))}
        </td>
      </tr>`).join('');

    const descontoRow = Number(desconto) > 0
      ? `<tr>
           <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${MUTED}">Desconto</td>
           <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${INK};text-align:right">− ${fmtBRL(Number(desconto))}</td>
         </tr>`
      : '';

    const freteTxt = Number(frete) === 0 ? 'Grátis' : fmtBRL(Number(frete));

    const htmlCliente = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Pedido confirmado — Virtù</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background-color:${CREAM}">
    <tr><td align="center" style="padding:32px 16px 48px">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${WHITE};border-radius:16px;overflow:hidden;border:1px solid ${LINE}">

        <!-- fio superior navy -->
        <tr><td style="height:3px;line-height:3px;font-size:0;background-color:${NAVY}">&nbsp;</td></tr>

        <!-- cabeçalho tipográfico -->
        <tr><td align="center" style="padding:46px 40px 32px;background-color:${WHITE}">
          <div style="font-family:${SERIF};font-size:30px;letter-spacing:9px;color:${NAVY};font-weight:400;padding-left:9px">VIRTÙ</div>
          <div style="width:44px;height:1px;line-height:1px;font-size:0;background-color:${GOLD};margin:18px auto 0">&nbsp;</div>
          <div style="font-family:${SANS};font-size:11px;letter-spacing:3px;color:${MUTED};text-transform:uppercase;margin-top:20px">Pedido confirmado</div>
          <div style="font-family:${SANS};font-size:16px;letter-spacing:2px;color:${GOLD};font-weight:700;margin-top:7px">${pedidoNum}</div>
        </td></tr>

        <!-- saudação -->
        <tr><td style="padding:8px 40px 0;background-color:${WHITE}">
          <p style="margin:0 0 10px;font-family:${SERIF};font-size:20px;color:${NAVY};font-weight:400">Olá, ${primeiroNome}.</p>
          <p style="margin:0;font-family:${SANS};font-size:14px;color:${MUTED};line-height:1.75">Recebemos o seu pedido e já estamos preparando tudo com muito cuidado. Avisaremos por e-mail assim que ele for despachado.</p>
        </td></tr>

        <!-- itens -->
        <tr><td style="padding:34px 40px 0;background-color:${WHITE}">
          ${overline('Itens do pedido')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itensHtmlCliente}</table>
        </td></tr>

        <!-- resumo -->
        <tr><td style="padding:28px 40px 0;background-color:${WHITE}">
          ${overline('Resumo')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${MUTED}">Subtotal</td>
              <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${INK};text-align:right">${fmtBRL(Number(subtotal ?? total))}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${MUTED}">Frete</td>
              <td style="padding:5px 0;font-family:${SANS};font-size:13px;color:${INK};text-align:right">${freteTxt}</td>
            </tr>
            ${descontoRow}
            <tr><td colspan="2" style="padding:12px 0 0"><div style="height:1px;line-height:1px;font-size:0;background-color:${LINE}">&nbsp;</div></td></tr>
            <tr>
              <td style="padding:14px 0 0;font-family:${SERIF};font-size:16px;color:${NAVY}">Total</td>
              <td style="padding:14px 0 0;font-family:${SANS};font-size:18px;font-weight:700;color:${GOLD};text-align:right">${fmtBRL(Number(total))}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:6px 0 0;font-family:${SANS};font-size:12px;color:${MUTED}">Pagamento via ${metodoPagto}</td>
            </tr>
          </table>
        </td></tr>

        <!-- entrega -->
        <tr><td style="padding:30px 40px 0;background-color:${WHITE}">
          ${overline('Entrega')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};width:80px;vertical-align:top">Nome</td>
              <td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK}">${cliente?.nome || '—'}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};vertical-align:top">CPF</td>
              <td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK}">${maskCpf(cliente?.cpf)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};vertical-align:top">Endereço</td>
              <td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK};line-height:1.6">${formatEndereco(endereco)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- fecho -->
        <tr><td style="padding:30px 40px 42px;background-color:${WHITE}">
          <div style="border-top:1px solid ${LINE};padding-top:26px">
            <p style="margin:0;font-family:${SANS};font-size:13px;color:${MUTED};line-height:1.75;text-align:center">Seu pedido está sendo preparado com todo o cuidado.<br>Você receberá um novo e-mail assim que ele for enviado.</p>
          </div>
        </td></tr>

      </table>

      <!-- rodapé -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
        <tr><td align="center" style="padding:26px 20px 0">
          <p style="margin:0;font-family:${SANS};font-size:12px;color:${MUTED}">© Virtù · Moda Feminina · <a href="${SITE_URL}" style="color:${MUTED};text-decoration:none">wearvirtu.com</a></p>
          <p style="margin:9px 0 0;font-family:${SANS};font-size:12px;color:${MUTED}">Dúvidas? <a href="mailto:${STORE_EMAIL}" style="color:${GOLD};text-decoration:none">${STORE_EMAIL}</a></p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;

    // ── 2. E-mail de notificação para a loja (coerente com o do cliente) ──
    const itensHtmlLoja = (itens ?? []).map((it: Record<string, unknown>) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-family:${SERIF};font-size:14px;color:${NAVY};vertical-align:top">
          ${it.nome || it.name || 'Produto'}
          <div style="font-family:${SANS};font-size:12px;color:${MUTED};margin-top:4px">${detalheItem(it)}</div>
        </td>
        <td style="padding:12px 0 12px 12px;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:13px;color:${INK};text-align:right;white-space:nowrap;vertical-align:top">${fmtBRL(Number(it.preco || 0))}</td>
      </tr>`).join('');

    const enderecoStr = endereco
      ? `${endereco.rua || ''}, ${endereco.numero || ''} — ${endereco.bairro || ''}, ${endereco.cidade || ''}/${endereco.estado || ''} · CEP ${endereco.cep || ''}`
      : '—';

    const htmlLoja = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Novo pedido — Virtù</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background-color:${CREAM}">
    <tr><td align="center" style="padding:32px 16px 48px">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${WHITE};border-radius:16px;overflow:hidden;border:1px solid ${LINE}">

        <tr><td style="height:3px;line-height:3px;font-size:0;background-color:${NAVY}">&nbsp;</td></tr>

        <tr><td align="center" style="padding:40px 40px 24px;background-color:${WHITE}">
          <div style="font-family:${SERIF};font-size:26px;letter-spacing:8px;color:${NAVY};padding-left:8px">VIRTÙ</div>
          <div style="width:40px;height:1px;line-height:1px;font-size:0;background-color:${GOLD};margin:16px auto 0">&nbsp;</div>
          <div style="font-family:${SANS};font-size:11px;letter-spacing:3px;color:${MUTED};text-transform:uppercase;margin-top:18px">Novo pedido</div>
          <div style="font-family:${SANS};font-size:16px;letter-spacing:2px;color:${GOLD};font-weight:700;margin-top:6px">${pedidoNum}</div>
        </td></tr>

        <tr><td align="center" style="padding:2px 40px 0;background-color:${WHITE}">
          <p style="margin:0;font-family:${SANS};font-size:15px;color:${NAVY}"><strong style="color:${GOLD};font-weight:700">${fmtBRL(Number(total))}</strong> · ${metodoPagto}</p>
        </td></tr>

        <tr><td style="padding:30px 40px 0;background-color:${WHITE}">
          ${overline('Cliente')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};width:80px;vertical-align:top">Nome</td><td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK}">${cliente?.nome || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};vertical-align:top">E-mail</td><td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK}">${cliente?.email || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};vertical-align:top">Telefone</td><td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK}">${cliente?.telefone || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};vertical-align:top">Endereço</td><td style="padding:4px 0;font-family:${SANS};font-size:13px;color:${INK};line-height:1.6">${enderecoStr}</td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 40px 0;background-color:${WHITE}">
          ${overline('Itens')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itensHtmlLoja}</table>
        </td></tr>

        <tr><td style="padding:18px 40px 0;background-color:${WHITE}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:${SERIF};font-size:15px;color:${NAVY}">Total</td>
              <td style="text-align:right;font-family:${SANS};font-size:17px;font-weight:700;color:${GOLD}">${fmtBRL(Number(total))}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:32px 40px 42px;background-color:${WHITE}">
          <a href="${SITE_URL}/admin/" style="display:inline-block;background-color:${NAVY};color:${CREAM};text-decoration:none;padding:14px 34px;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;border-radius:10px">Abrir painel admin</a>
        </td></tr>

      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
        <tr><td align="center" style="padding:24px 20px 0">
          <p style="margin:0;font-family:${SANS};font-size:12px;color:${MUTED}">© Virtù · wearvirtu.com</p>
        </td></tr>
      </table>

    </td></tr>
  </table>
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
          from:     FROM_EMAIL,
          to:       [cliente.email],
          reply_to: STORE_EMAIL,
          subject:  `Pedido ${pedidoNum} confirmado — obrigada por comprar na Virtù`,
          html:     htmlCliente,
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
          from:     FROM_EMAIL,
          to:       [STORE_EMAIL],
          reply_to: STORE_EMAIL,
          subject:  `Novo pedido ${pedidoNum} — ${fmtBRL(Number(total))} (${metodoPagto})`,
          html:     htmlLoja,
        }),
      }));
    }

    if (emails.length === 0) {
      console.log(`[send-order-email] Status '${status}' — nenhum e-mail enviado (aguardando confirmação)`);
      return json({ ok: true, enviados: 0, msg: 'Aguardando confirmação de pagamento' });
    }

    const results = await Promise.allSettled(emails);
    const errors: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        // Erro de rede / timeout
        const msg = (r as PromiseRejectedResult).reason?.message ?? 'Erro de rede';
        errors.push(`email[${i}]: ${msg}`);
        console.error(`[send-order-email] email[${i}] rede erro:`, msg);
      } else {
        // Verifica status HTTP da resposta do Resend (4xx = bad request, rate limit, etc.)
        const res = (r as PromiseFulfilledResult<Response>).value;
        if (!res.ok) {
          let bodyText = '';
          try { bodyText = await res.text(); } catch { /* ignore */ }
          const msg = `HTTP ${res.status} — ${bodyText.slice(0, 200)}`;
          errors.push(`email[${i}]: ${msg}`);
          console.error(`[send-order-email] email[${i}] Resend erro:`, msg);
        } else {
          console.log(`[send-order-email] email[${i}] enviado com sucesso (HTTP ${res.status})`);
        }
      }
    }

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
