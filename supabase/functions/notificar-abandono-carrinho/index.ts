/**
 * VIRTÙ — Edge Function: notificar-abandono-carrinho
 *
 * Envia e-mail de recuperação de carrinho abandonado via Resend.
 * (WhatsApp removido — Z-API não é autorizado pelo WhatsApp/Meta; risco de banimento)
 *
 * Input POST:
 *   email           string   — e-mail da cliente (obrigatório)
 *   nome?           string   — nome da cliente
 *   itens           array    — itens do carrinho
 *   total           number   — valor total do carrinho
 *   url_recuperacao string   — link para retomar o carrinho
 *   abandono_id?    string   — UUID do registro na tabela carrinhos_abandonados
 *
 * Secrets obrigatórios:
 *   RESEND_API_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (para marcar email_enviado)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function primeiroNome(nome: string | null | undefined): string {
  return (nome || 'cliente').trim().split(' ')[0];
}

function formatBRL(valor: number): string {
  return 'R$ ' + Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Template de e-mail de recuperação de carrinho ─────────────────────────

interface ItemCarrinho {
  nome?: string;
  cor_nome?: string;
  tamanho?: string;
  qty?: number;
  quantidade?: number;
  preco?: number;
  preco_desconto?: number;
  price?: number;
  imagem_url?: string;
}

function buildEmailHtml(vars: {
  nome: string;
  itens: ItemCarrinho[];
  total: number;
  url: string;
}): string {
  const primeiroN = primeiroNome(vars.nome);

  const itensHtml = vars.itens.map(item => {
    const nome    = escapeHtml(item.nome || 'Produto');
    const qty     = item.qty || item.quantidade || 1;
    const preco   = item.preco_desconto || item.preco || item.price || 0;
    const subtotal = formatBRL(preco * qty);
    const meta    = [item.cor_nome, item.tamanho].filter(Boolean).map(v => escapeHtml(String(v))).join(' · ');
    const imgHtml = item.imagem_url
      ? `<img src="${escapeHtml(item.imagem_url)}" alt="${nome}" width="64" height="64"
             style="width:64px;height:64px;object-fit:cover;border-radius:4px;flex-shrink:0;display:block" />`
      : `<div style="width:64px;height:64px;background:linear-gradient(135deg,#E8E0D5,#D4CCC0);border-radius:4px;flex-shrink:0"></div>`;

    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #F0EDE8">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="width:76px;vertical-align:top;padding-right:12px">${imgHtml}</td>
              <td style="vertical-align:top">
                <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1E2E3E">${nome}</p>
                ${meta ? `<p style="margin:0 0 4px;font-size:12px;color:#9E9690">${meta}</p>` : ''}
                <p style="margin:0;font-size:12px;color:#9E9690">Qtd: ${qty}</p>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap">
                <p style="margin:0;font-size:14px;font-weight:600;color:#1E2E3E">${subtotal}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Você esqueceu algo — Virtù</title>
</head>
<body style="margin:0;padding:0;background:#F5F2EE;font-family:'Helvetica Neue',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F2EE;padding:32px 16px">
<tr><td align="center">

  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

    <!-- Logo -->
    <tr>
      <td align="center" style="padding:32px 0 20px">
        <p style="margin:0;font-size:22px;letter-spacing:8px;font-weight:600;color:#2B3F54;font-family:Georgia,serif">VIRTÙ</p>
        <p style="margin:4px 0 0;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#9E9690">Moda com propósito</p>
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td style="background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06)">

        <!-- Cabeçalho azul -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#2B3F54;padding:36px 40px;text-align:center">
              <p style="margin:0 0 12px;font-size:32px">🛍️</p>
              <h1 style="margin:0 0 8px;font-size:22px;color:#FFFFFF;font-family:Georgia,serif;font-style:italic">
                ${escapeHtml(primeiroN)}, você esqueceu algo!
              </h1>
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.75);line-height:1.5">
                Você tem peças incríveis esperando no seu carrinho.
              </p>
            </td>
          </tr>
        </table>

        <!-- Corpo -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:32px 40px">

              <!-- Itens -->
              <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9E9690;font-weight:600">
                Seus itens
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${itensHtml}
              </table>

              <!-- Total -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px">
                <tr>
                  <td style="padding:12px 0;border-top:2px solid #1E2E3E">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:14px;font-weight:600;color:#1E2E3E">Total estimado</td>
                        <td style="text-align:right;font-size:16px;font-weight:700;color:#C4934A">${formatBRL(vars.total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(vars.url)}"
                       style="display:inline-block;background:#2B3F54;color:#ffffff;text-decoration:none;
                              font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;
                              padding:16px 40px;border-radius:4px">
                      Retomar meu carrinho →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#B0A8A0;text-align:center;line-height:1.6">
                Seus itens estão reservados por tempo limitado.<br/>
                Dúvidas? Fale conosco pelo WhatsApp.
              </p>

            </td>
          </tr>
        </table>

      </td>
    </tr>

    <!-- Rodapé -->
    <tr>
      <td align="center" style="padding:24px 0">
        <p style="margin:0;font-size:11px;color:#AFA99F">© 2026 Virtù · wearvirtu.com</p>
      </td>
    </tr>

  </table>
</td></tr>
</table>

</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const email  = (body.email || '').trim();
    const nome   = body.nome    || null;
    const itens  = Array.isArray(body.itens) ? body.itens : [];
    const total  = Number(body.total) || 0;
    const url    = body.url_recuperacao || 'https://wearvirtu.com/carrinho.html?recuperar=1';
    const abaId  = body.abandono_id    || null;

    // Validação básica
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, erro: 'e-mail inválido ou ausente' }, 400);
    }

    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_KEY) {
      console.warn('[abandono-carrinho] RESEND_API_KEY não configurado — e-mail não enviado');
      return json({ ok: true, msg: 'RESEND_API_KEY ausente — skipped' });
    }

    const primeiroN = primeiroNome(nome);
    const htmlEmail = buildEmailHtml({ nome: primeiroN, itens, total, url });

    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'Virtù <ola@wearvirtu.com>',
        to:      [email],
        subject: `${primeiroN}, você esqueceu algo no carrinho! 🛍️`,
        html:    htmlEmail,
      }),
    });

    if (!resendRes.ok) {
      const errData = await resendRes.json().catch(() => ({}));
      console.error('[abandono-carrinho] Resend erro:', resendRes.status, JSON.stringify(errData));
      return json({ ok: false, erro: `Resend ${resendRes.status}` }, 500);
    }

    console.log(`[abandono-carrinho] E-mail enviado para ${email.slice(0, 3)}***`);

    // Marca email_enviado no registro de abandono (se fornecido)
    if (abaId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        await supabase
          .from('carrinhos_abandonados')
          .update({ email_enviado: true })
          .eq('id', abaId);
      } catch (e) {
        console.warn('[abandono-carrinho] Falha ao marcar email_enviado:', e);
      }
    }

    return json({ ok: true, msg: 'E-mail de recuperação enviado' });

  } catch (err) {
    console.error('[abandono-carrinho] Erro inesperado:', err);
    return json({ ok: false, erro: 'Erro interno' }, 500);
  }
});
