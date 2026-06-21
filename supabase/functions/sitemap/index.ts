/**
 * VIRTÙ — Edge Function: sitemap
 * Gera um sitemap.xml dinâmico com todas as páginas estáticas + todos
 * os produtos ativos do banco.  Invocada em:
 *   https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/sitemap
 *
 * O robots.txt aponta para esta URL como sitemap primário.
 * Cache de 24h no Cloudflare/CDN; regenerado a cada requisição pelo Supabase.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BASE_URL    = 'https://wearvirtu.com';
const TODAY       = new Date().toISOString().split('T')[0];

// Páginas estáticas do site
const STATIC_PAGES = [
  { loc: '/',               priority: '1.0', changefreq: 'weekly'  },
  { loc: '/catalogo.html',  priority: '0.9', changefreq: 'daily'   },
  { loc: '/sobre.html',     priority: '0.6', changefreq: 'monthly' },
  { loc: '/contato.html',   priority: '0.5', changefreq: 'monthly' },
  { loc: '/politicas.html', priority: '0.3', changefreq: 'yearly'  },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}

function urlEntry(loc: string, lastmod: string, priority: string, changefreq: string): string {
  return `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

Deno.serve(async (_req) => {
  // ── Busca todos os produtos ativos (publicados) ──────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: produtos, error } = await supabase
    .from('produtos')
    .select('id, atualizado_em, criado_em')
    .eq('publicado', true)
    .order('atualizado_em', { ascending: false });

  const entries: string[] = [];

  // Páginas estáticas
  for (const page of STATIC_PAGES) {
    entries.push(urlEntry(
      `${BASE_URL}${page.loc}`,
      TODAY,
      page.priority,
      page.changefreq,
    ));
  }

  // Páginas de produto (dinâmicas — Google indexa query parameters)
  if (!error && produtos?.length) {
    for (const p of produtos) {
      const lastmod = (p.atualizado_em || p.criado_em || TODAY).split('T')[0];
      entries.push(urlEntry(
        `${BASE_URL}/produto.html?id=${esc(p.id)}`,
        lastmod,
        '0.8',
        'weekly',
      ));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${entries.join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type':  'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
