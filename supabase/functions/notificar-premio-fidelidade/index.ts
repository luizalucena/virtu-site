/**
 * VIRTÙ — Edge Function: notificar-premio-fidelidade
 *
 * Envia notificação por e-mail para a cliente ao ganhar prêmio de fidelidade.
 * (via Resend — template HTML premium)
 *
 * Input: POST {
 *   user_id  : string  — UUID da cliente
 *   codigo   : string  — Código do cupom gerado (ex: "VIRTU-A1B2C3D4")
 *   validade : string  — ISO date/datetime de expiração
 *   // Opcionais — se omitidos, busca no banco
 *   nome?    : string
 *   email?   : string
 * }
 *
 * Secrets obrigatórios:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados automaticamente)
 *   RESEND_API_KEY (e-mail)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS / Security ───────────────────────────────────────────────────

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

// ── Formatação ────────────────────────────────────────────────────────

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'America/Recife',
    });
  } catch { return String(iso).slice(0, 10); }
}

function primeiroNome(nome: string | null | undefined): string {
  return (nome || 'Cliente').split(' ')[0];
}

// ── Templates ─────────────────────────────────────────────────────────



/** E-mail HTML premium */
function buildEmailHtml(vars: {
  nome: string; codigo: string; validade: string;
  meta: number; valor: number;
}): string {
  const primeiroN = primeiroNome(vars.nome);
  const pct = Math.round((vars.valor / 100) * 100); // purely cosmetic

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Você ganhou R$ ${vars.valor.toFixed(0)} de desconto — Virtù</title>
</head>
<body style="margin:0;padding:0;background:#F5F2EE;font-family:'Helvetica Neue',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F2EE;padding:32px 16px">
<tr><td align="center">

  <!-- Container -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

    <!-- Topo com logo -->
    <tr>
      <td align="center" style="padding:32px 0 20px">
        <p style="margin:0;font-size:22px;letter-spacing:8px;font-weight:600;color:#2B3F54;font-family:Georgia,serif">VIRTÙ</p>
        <p style="margin:4px 0 0;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#9E9690">Moda com propósito</p>
      </td>
    </tr>

    <!-- Card principal -->
    <tr>
      <td style="background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06)">

        <!-- Banner dourado -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:linear-gradient(135deg,#1E2E3E 0%,#2B3F54 60%,#3D5470 100%);padding:40px 40px 32px;text-align:center">
              <p style="margin:0 0 12px;font-size:36px">🎁</p>
              <p style="margin:0 0 8px;font-size:28px;color:#C4934A;font-family:Georgia,serif;font-style:italic">Parabéns, ${escapeHtml(primeiroN)}!</p>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);letter-spacing:0.05em">Você desbloqueou seu prêmio de fidelidade</p>
            </td>
          </tr>
        </table>

        <!-- Corpo -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:36px 40px">

              <p style="margin:0 0 20px;font-size:15px;color:#4A4440;line-height:1.7">
                Você concluiu <strong>${vars.meta} compras confirmadas</strong> na Virtù!
                Como recompensa pelo seu carinho, preparamos um presente especial pra você:
              </p>

              <!-- Destaque do cupom -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#F9F6EF;border:2px dashed #C4934A;border-radius:8px;padding:28px;text-align:center">
                    <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9E9690">seu cupom exclusivo</p>
                    <p style="margin:0 0 16px;font-size:30px;font-family:'Courier New',monospace;font-weight:700;letter-spacing:0.1em;color:#1E2E3E">${escapeHtml(vars.codigo)}</p>
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td style="background:#2B3F54;border-radius:4px;padding:10px 32px">
                          <p style="margin:0;font-size:22px;font-weight:700;color:#C4934A">R$ ${vars.valor.toFixed(2).replace('.', ',')} OFF</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;font-size:12px;color:#9E9690">
                      ⏳ Válido até <strong style="color:#C4934A">${vars.validade}</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Como usar -->
              <p style="margin:28px 0 12px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#9E9690;font-weight:600">Como usar</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#F5F2EE;border-radius:6px;padding:16px 20px">
                    <p style="margin:0 0 8px;font-size:13px;color:#4A4440;line-height:1.6">1️⃣ Acesse <a href="https://wearvirtu.com/catalogo.html" style="color:#2B3F54;font-weight:600">wearvirtu.com</a> e escolha suas peças</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#4A4440;line-height:1.6">2️⃣ No checkout, insira o código <strong>${escapeHtml(vars.codigo)}</strong> no campo de cupom</p>
                    <p style="margin:0;font-size:13px;color:#4A4440;line-height:1.6">3️⃣ O desconto de <strong>R$ ${vars.valor.toFixed(2).replace('.', ',')}</strong> será aplicado automaticamente</p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">
                <tr>
                  <td align="center">
                    <a href="https://wearvirtu.com/catalogo.html" style="display:inline-block;background:#2B3F54;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:16px 40px;border-radius:4px">
                      Usar meu desconto agora
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#B0A8A0;text-align:center;line-height:1.6">
                Este cupom é de uso único e pessoal. Expira em ${vars.validade}.<br/>
                Dúvidas? <a href="mailto:wearvirtu@gmail.com" style="color:#B0A8A0">wearvirtu@gmail.com</a>
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { user_id, codigo, validade } = body;
    let { nome, email } = body;

    if (!user_id || !codigo) {
      return json({ ok: false, erro: 'user_id e codigo são obrigatórios' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Busca dados da cliente se não fornecidos ───────────
    if (!nome || !email) {
      const { data: perfil } = await supabase
        .from('clientes_perfil')
        .select('nome')
        .eq('id', user_id)
        .maybeSingle();

      if (!nome && perfil?.nome) nome = perfil.nome;

      if (!email) {
        const { data: userRow } = await supabase.auth.admin.getUserById(user_id);
        email = userRow?.user?.email ?? null;
      }
    }

    // ── Lê configurações do programa ───────────────────────
    const { data: cfg } = await supabase
      .from('config_fidelidade')
      .select('meta_compras, valor_desconto')
      .eq('id', 1)
      .maybeSingle();

    const meta         = cfg?.meta_compras  ?? 10;
    const valor        = Number(cfg?.valor_desconto ?? 150);
    const validadeFmt  = fmtData(validade);
    const primeiroN    = primeiroNome(nome);
    const errors: string[] = [];

    // ── E-mail para a cliente ────────────────────────────────
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');

    if (RESEND_KEY && email) {
      try {
        const htmlEmail = buildEmailHtml({
          nome: primeiroN, codigo, validade: validadeFmt, meta, valor,
        });

        const emailRes = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    'Virtù <ola@wearvirtu.com>',
            to:      [email],
            subject: `🎁 Parabéns ${primeiroN}! Você ganhou R$ ${valor.toFixed(0)} de desconto — Virtù`,
            html:    htmlEmail,
          }),
        });

        if (!emailRes.ok) {
          const errData = await emailRes.json().catch(() => ({}));
          console.error('[Premio Email]', emailRes.status, JSON.stringify(errData));
          errors.push('email: ' + emailRes.status);
        } else {
          console.log(`[Premio Email] Enviado para ${email}`);
        }
      } catch (e) {
        console.error('[Premio Email Exception]', e);
        errors.push('email: exception');
      }
    } else {
      if (!RESEND_KEY) console.warn('[Premio Email] RESEND_API_KEY não configurado — skipping');
      if (!email)      console.warn('[Premio Email] E-mail da cliente não disponível');
    }

    return json({
      ok:     errors.length === 0,
      erros:  errors.length > 0 ? errors : undefined,
      codigo,
      validade: validadeFmt,
    });

  } catch (err) {
    console.error('[Premio Fidelidade Unexpected]', err);
    return json({ ok: false, erro: 'Erro interno' }, 500);
  }
});
