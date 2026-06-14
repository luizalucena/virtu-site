/**
 * VIRTÙ — Edge Function: notificar-status-pedido
 *
 * Disparada pelo trigger `trg_notificar_status_pedido` no banco
 * (ou manualmente pelo admin) quando o status de um pedido muda.
 *
 * Ações por status:
 *   confirmado / em preparação → e-mail ao cliente
 *   enviado / a caminho        → e-mail com link de rastreio
 *   entregue                   → e-mail de conclusão
 *
 * Input POST (via pg_net pelo trigger):
 *   pedido_id    string  — UUID do pedido
 *   status_novo  string  — novo status
 *   status_velho string  — status anterior
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
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
};

// ── Normaliza status para comparação ─────────────────────────────
function normStatus(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// ── Mapa de mensagens por status ─────────────────────────────────
interface StatusConfig {
  whatsapp: (nome: string, pedidoId: string, link: string) => string;
  emailSubject: string;
  emailBody: (nome: string, pedidoId: string, link: string) => string;
}

function getStatusConfig(statusNorm: string): StatusConfig | null {
  const id6 = (id: string) => id.slice(-6).toUpperCase();

  const configs: Record<string, StatusConfig> = {
    'confirmado': {
      whatsapp: (nome, id) =>
        `Oi ${nome}! 🎉\n\nSeu pedido *#${id6(id)}* foi confirmado e está sendo preparado com muito carinho!\n\nAssim que sair para entrega, você recebe uma nova mensagem com o rastreio. 📦\n\n_Qualquer dúvida é só chamar! 💛_`,
      emailSubject: 'Seu pedido foi confirmado! ✅',
      emailBody: (nome, id) => emailTemplate({
        titulo: 'Pedido Confirmado!',
        icon: '✅',
        subtitulo: `Olá, ${nome}!`,
        corpo: `Seu pedido <strong>#${id6(id)}</strong> foi confirmado e está sendo preparado com muito carinho pela nossa equipe.`,
        rodape: 'Assim que sair para entrega, você receberá um e-mail com o link de rastreio.',
        cta: null,
      }),
    },
    'em preparacao': {
      whatsapp: (nome, id) =>
        `Oi ${nome}! 🧵\n\nSeu pedido *#${id6(id)}* está em preparação! Nossa equipe está separando e embalando tudo com cuidado.\n\nVocê receberá uma nova mensagem assim que o pedido sair para entrega. 📦\n\n_Qualquer dúvida é só chamar! 💛_`,
      emailSubject: 'Seu pedido está sendo preparado 🧵',
      emailBody: (nome, id) => emailTemplate({
        titulo: 'Em Preparação',
        icon: '🧵',
        subtitulo: `Oi, ${nome}!`,
        corpo: `Seu pedido <strong>#${id6(id)}</strong> está sendo preparado pela nossa equipe com muito cuidado.`,
        rodape: 'Você receberá uma nova mensagem assim que o pedido sair para entrega.',
        cta: null,
      }),
    },
    'enviado': {
      whatsapp: (nome, id, link) =>
        `Oi ${nome}! 🚚\n\nSeu pedido *#${id6(id)}* saiu para entrega!\n\nAcompanhe em tempo real aqui:\n${link}\n\n_Qualquer dúvida é só chamar! 💛_`,
      emailSubject: 'Seu pedido está a caminho! 🚚',
      emailBody: (nome, id, link) => emailTemplate({
        titulo: 'Pedido Enviado!',
        icon: '🚚',
        subtitulo: `Boa notícia, ${nome}!`,
        corpo: `Seu pedido <strong>#${id6(id)}</strong> saiu para entrega e já está a caminho!`,
        rodape: 'Acompanhe o rastreio em tempo real clicando no botão abaixo.',
        cta: { texto: 'Rastrear meu pedido', href: link },
      }),
    },
    'a caminho': {
      whatsapp: (nome, id, link) =>
        `Oi ${nome}! 📦\n\nSeu pedido *#${id6(id)}* está a caminho e chegará em breve!\n\nRastreie aqui: ${link}\n\n_Qualquer dúvida é só chamar! 💛_`,
      emailSubject: 'Seu pedido está chegando! 📦',
      emailBody: (nome, id, link) => emailTemplate({
        titulo: 'A Caminho!',
        icon: '📦',
        subtitulo: `Quase lá, ${nome}!`,
        corpo: `Seu pedido <strong>#${id6(id)}</strong> está a caminho e chegará em breve.`,
        rodape: 'Acompanhe o rastreio clicando no botão abaixo.',
        cta: { texto: 'Rastrear meu pedido', href: link },
      }),
    },
    'entregue': {
      whatsapp: (nome, id) =>
        `Oi ${nome}! 🎁\n\nSeu pedido *#${id6(id)}* foi entregue! Esperamos que você ame cada peça. 💛\n\nSe precisar de qualquer ajuda com troca ou devolução, é só nos chamar!\n\n_Obrigada por escolher a Virtù ✨_`,
      emailSubject: 'Pedido entregue! Esperamos que você ame 💛',
      emailBody: (nome, id) => emailTemplate({
        titulo: 'Entregue com Amor!',
        icon: '🎁',
        subtitulo: `${nome}, seu pedido chegou!`,
        corpo: `Seu pedido <strong>#${id6(id)}</strong> foi entregue. Esperamos que você ame cada peça tanto quanto a gente amou preparar para você.`,
        rodape: 'Se precisar de ajuda com troca ou devolução em até 7 dias, é só nos chamar no WhatsApp.',
        cta: null,
      }),
    },
  };

  return configs[statusNorm] || null;
}

// ── Template de e-mail ────────────────────────────────────────────
interface EmailTemplateOpts {
  titulo: string;
  icon: string;
  subtitulo: string;
  corpo: string;
  rodape: string;
  cta: { texto: string; href: string } | null;
}

function emailTemplate(opts: EmailTemplateOpts): string {
  const ctaHtml = opts.cta
    ? `<div style="text-align:center;margin:32px 0 0">
        <a href="${opts.cta.href}"
           style="display:inline-block;padding:14px 36px;background:#1A2744;color:#fff;
                  text-decoration:none;font-family:Georgia,serif;font-size:14px;
                  letter-spacing:2px;text-transform:uppercase;border-radius:2px">
          ${opts.cta.texto}
        </a>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:Helvetica Neue,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;width:100%;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07)">

        <!-- Header -->
        <tr>
          <td style="background:#1A2744;padding:32px 40px;text-align:center">
            <p style="margin:0;font-family:Georgia,serif;font-size:22px;letter-spacing:6px;
                      text-transform:uppercase;color:#fff">VIRTÙ</p>
            <p style="margin:6px 0 0;font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.6);text-transform:uppercase">
              Moda Feminina
            </p>
          </td>
        </tr>

        <!-- Icon + Título -->
        <tr>
          <td style="padding:36px 40px 0;text-align:center">
            <p style="font-size:42px;margin:0">${opts.icon}</p>
            <h1 style="margin:12px 0 0;font-family:Georgia,serif;font-size:22px;
                       color:#1A2744;letter-spacing:1px">${opts.titulo}</h1>
          </td>
        </tr>

        <!-- Corpo -->
        <tr>
          <td style="padding:24px 40px 32px">
            <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6">
              ${opts.subtitulo}
            </p>
            <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.7">
              ${opts.corpo}
            </p>
            <p style="margin:0;font-size:13px;color:#888;line-height:1.6">
              ${opts.rodape}
            </p>
            ${ctaHtml}
          </td>
        </tr>

        <!-- Divisor -->
        <tr><td style="padding:0 40px"><hr style="border:none;border-top:1px solid #e8e4dc;margin:0"></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;text-align:center">
            <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:1.5px;text-transform:uppercase">
              © Virtù — wearvirtu.com
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#ccc">
              Dúvidas? Fale conosco pelo WhatsApp
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Handler principal ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');

    const body        = await req.json();
    const pedidoId    = body.pedido_id  || body.record?.id;
    const statusNovo  = body.status_novo  || body.record?.status;
    const statusVelho = body.status_velho || body.old_record?.status;

    if (!pedidoId || !statusNovo) {
      return json({ erro: 'pedido_id e status_novo são obrigatórios' }, 400);
    }

    // Evita reprocessamento se status não mudou
    if (statusNovo === statusVelho) {
      return json({ ok: true, msg: 'Status não mudou — ignorado' });
    }

    const statusNorm = normStatus(statusNovo);
    const config     = getStatusConfig(statusNorm);

    if (!config) {
      return json({ ok: true, msg: `Status "${statusNovo}" sem notificação configurada` });
    }

    // ── Busca dados do pedido ─────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: pedido, error: dbErr } = await supabase
      .from('pedidos')
      .select('id, cliente_nome, nome_cliente, cliente_email, email_cliente, telefone, cliente_telefone')
      .eq('id', pedidoId)
      .maybeSingle();

    if (dbErr || !pedido) {
      console.error('[notificar-status-pedido] Pedido não encontrado:', pedidoId);
      return json({ erro: 'Pedido não encontrado' }, 404);
    }

    const nome     = pedido.nome_cliente     || pedido.cliente_nome     || 'cliente';
    const email    = pedido.email_cliente    || pedido.cliente_email    || null;
    const telefone = pedido.telefone         || pedido.cliente_telefone || null;
    const primeiroNome = nome.trim().split(' ')[0];

    const linkRastreio = `https://wearvirtu.com/rastreio.html?id=${pedidoId}`;

    const erros: string[] = [];

    // ── E-mail ────────────────────────────────────────────────
    if (email && RESEND_KEY) {
      const html = config.emailBody(primeiroNome, pedidoId, linkRastreio);
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    'Virtù <contato@wearvirtu.com>',
            to:      [email],
            subject: config.emailSubject,
            html,
          }),
        });
        if (!resendRes.ok) {
          const err = await resendRes.json().catch(() => ({}));
          console.error('[notificar-status-pedido] Resend erro:', err);
          erros.push('email');
        } else {
          console.log(`[notificar-status-pedido] E-mail enviado para ${email.slice(0,3)}***`);
        }
      } catch (e) {
        console.error('[notificar-status-pedido] E-mail exception:', e);
        erros.push('email');
      }
    }

    return json({
      ok:     erros.length === 0,
      erros:  erros.length ? erros : undefined,
      status: statusNovo,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notificar-status-pedido] Erro inesperado:', msg);
    return json({ erro: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}
