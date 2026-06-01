-- ============================================================
-- DIAGNÓSTICO: Produtos com dados incompletos
-- Execute no Supabase SQL Editor para ver o estado atual
-- ============================================================

SELECT
  p.id,
  p.nome,
  p.categoria,
  CASE WHEN p.imagem_url IS NOT NULL AND p.imagem_url != '' THEN '✓' ELSE '✗ SEM IMAGEM' END AS imagem_url,
  CASE WHEN p.imagens IS NOT NULL AND jsonb_array_length(p.imagens) > 0 THEN '✓ (' || jsonb_array_length(p.imagens) || ')' ELSE '✗ SEM IMAGENS[]' END AS imagens_array,
  CASE WHEN p.cores IS NOT NULL AND jsonb_array_length(p.cores) > 0 THEN '✓' ELSE '✗ SEM CORES' END AS cores_pcores,
  COALESCE(v.total_variacoes, 0) AS variacoes_no_stock,
  p.ativo
FROM produtos p
LEFT JOIN (
  SELECT produto_id, COUNT(*) AS total_variacoes
  FROM variacoes
  WHERE ativo = true
  GROUP BY produto_id
) v ON v.produto_id = p.id
ORDER BY p.nome;
