/**
 * VIRTÙ — Edge Function: notificar-pedido-admin
 * WhatsApp desabilitado — função desativada por segurança.
 * (Z-API não é autorizado pelo WhatsApp/Meta; risco de banimento da conta)
 */

import { buildCorsHeaders } from '../_shared/cors.ts';

// Server-to-server → origin null cai na produção. Allowlist em _shared/cors.ts.
const corsHeaders = buildCorsHeaders(null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  console.log('[notificar-pedido-admin] WhatsApp desabilitado — apenas e-mail ativo');
  return new Response(
    JSON.stringify({ ok: true, msg: 'WhatsApp desabilitado — apenas e-mail ativo' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
