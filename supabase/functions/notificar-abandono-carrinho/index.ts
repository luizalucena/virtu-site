/**
 * VIRTÙ — Edge Function: notificar-abandono-carrinho
 * WhatsApp desabilitado — função desativada por segurança.
 * (Z-API não é autorizado pelo WhatsApp/Meta; risco de banimento da conta)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin':  'https://wearvirtu.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  console.log('[notificar-abandono-carrinho] WhatsApp desabilitado — função inativa');
  return new Response(
    JSON.stringify({ ok: true, msg: 'WhatsApp desabilitado — função inativa' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
