/**
 * VIRTÙ — Edge Function: notificar-reposicao
 * Envia o e-mail "sua peça voltou ao estoque" para quem se cadastrou em
 * avisos_reposicao, e marca notificado=true. Chamado pelo cron
 * fn_processar_avisos_reposicao (via pg_net), 1 chamada por aviso.
 *
 * Input POST: { aviso_id, email, nome_produto, produto_url, tamanho?, cor_nome? }
 *
 * Secrets: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';

const corsHeaders = buildCorsHeaders(null);
const securityHeaders = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':   "default-src 'none'",
};

const FROM_EMAIL  = 'Virtù <notificacoes@wearvirtu.com>';
const STORE_EMAIL = 'wearvirtu@gmail.com';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_KEY) return json({ ok: false, erro: 'RESEND_API_KEY ausente' }, 500);

    const body = await req.json();
    const avisoId     = body.aviso_id ?? null;
    const email       = String(body.email ?? '').trim();
    const nomeProduto = esc(body.nome_produto || 'Sua peça');
    const produtoUrl  = String(body.produto_url || 'https://www.wearvirtu.com/catalogo.html');
    const variacao    = [body.tamanho, body.cor_nome].filter(Boolean).map(esc).join(' · ');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, erro: 'e-mail inválido' }, 400);
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f2ee;font-family:Georgia,'Times New Roman',serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px 56px">
    <div style="text-align:center;margin-bottom:32px">
      <p style="margin:0;font-size:30px;color:#1A2744;letter-spacing:6px;font-style:italic">VIRTÙ</p>
      <div style="width:38px;height:1px;background:#C4934A;margin:12px auto 0"></div>
    </div>
    <div style="background:#fff;border-radius:2px;box-shadow:0 2px 12px rgba(0,0,0,.07);overflow:hidden">
      <div style="background:#1A2744;padding:36px 40px;text-align:center">
        <p style="margin:0 0 10px;font-size:26px">✨</p>
        <p style="margin:0;font-size:20px;color:#fff;letter-spacing:1.5px">Voltou ao estoque!</p>
      </div>
      <div style="padding:32px 40px;text-align:center">
        <p style="margin:0 0 8px;font-size:16px;color:#1A2744">A peça que você queria está disponível de novo:</p>
        <p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#1A2744">${nomeProduto}</p>
        ${variacao ? `<p style="margin:0 0 20px;font-size:13px;color:#999">${variacao}</p>` : '<div style="height:12px"></div>'}
        <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.6">
          As unidades são limitadas — garanta a sua antes que esgote de novo.
        </p>
        <a href="${esc(produtoUrl)}"
           style="display:inline-block;background:#C4934A;color:#fff;text-decoration:none;padding:15px 36px;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;border-radius:1px;font-family:Helvetica,Arial,sans-serif">
          Ver a peça →
        </a>
      </div>
    </div>
    <div style="text-align:center;padding:24px 0 0">
      <p style="margin:0;font-size:12px;color:#bbb">© Virtù — Moda Feminina · <a href="https://wearvirtu.com" style="color:#bbb;text-decoration:none">wearvirtu.com</a></p>
    </div>
  </div>
</body></html>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:     FROM_EMAIL,
        to:       [email],
        reply_to: STORE_EMAIL,
        subject:  `✨ Voltou! ${nomeProduto} está de novo na Virtù`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const t = await resendRes.text().catch(() => '');
      console.error('[notificar-reposicao] Resend erro:', resendRes.status, t.slice(0, 200));
      return json({ ok: false, erro: `Resend ${resendRes.status}` }, 500);
    }

    // Marca como notificado (idempotência do envio)
    if (avisoId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        await supabase
          .from('avisos_reposicao')
          .update({ notificado: true, notificado_em: new Date().toISOString() })
          .eq('id', avisoId);
      } catch (e) {
        console.warn('[notificar-reposicao] Falha ao marcar notificado:', e);
      }
    }

    return json({ ok: true });

  } catch (err) {
    console.error('[notificar-reposicao] Erro inesperado:', err);
    return json({ ok: false, erro: 'Erro interno' }, 500);
  }
});
