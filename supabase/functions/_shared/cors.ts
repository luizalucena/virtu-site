/**
 * VIRTÙ — CORS compartilhado das Edge Functions.
 *
 * Allowlist de origens (reflete a Origin da requisição só se casar; senão
 * cai na produção). Cobre:
 *   • Produção:  https://wearvirtu.com  e  https://www.wearvirtu.com
 *   • Dev local: http(s)://localhost:<porta>  e  http(s)://127.0.0.1:<porta>
 *   • Staging:   https://<qualquer>.github.io  (GitHub Pages de branch/projeto)
 *
 * Por que reflexão e não '*': mantém uma allowlist explícita (a Luíza pediu),
 * e o `Vary: Origin` evita cache cruzado de resposta CORS.
 * A segurança real das functions é server-side (recálculo de preço/frete,
 * token do webhook) — o CORS é só quem o navegador deixa LER a resposta.
 */

const PROD_ORIGINS = ['https://wearvirtu.com', 'https://www.wearvirtu.com'];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;      // dev local
    if (u.protocol === 'https:' && u.hostname.endsWith('.github.io')) return true;  // staging
  } catch {
    /* origin malformada → não permitida */
  }
  return false;
}

/** Headers de CORS com a Origin refletida (ou produção como padrão). */
export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allow = isAllowedOrigin(origin) ? origin! : PROD_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}
