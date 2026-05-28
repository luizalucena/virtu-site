-- ============================================================
-- VIRTÙ — Guia de Tamanhos editável
-- Execute no Supabase SQL Editor
-- ============================================================

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS guia_tamanhos JSONB DEFAULT
    '[
      {"tamanho":"PP","busto":"80–84","cintura":"60–64","quadril":"86–90"},
      {"tamanho":"P", "busto":"84–88","cintura":"64–68","quadril":"90–94"},
      {"tamanho":"M", "busto":"88–92","cintura":"68–72","quadril":"94–98"},
      {"tamanho":"G", "busto":"92–96","cintura":"72–76","quadril":"98–102"},
      {"tamanho":"GG","busto":"96–100","cintura":"76–80","quadril":"102–106"}
    ]'::jsonb,
  ADD COLUMN IF NOT EXISTS guia_tamanhos_obs TEXT DEFAULT
    'Medidas em centímetros. Caso esteja entre dois tamanhos, recomendamos o maior.';

SELECT 'Colunas guia_tamanhos adicionadas ✓' AS resultado;
