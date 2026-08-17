-- =============================================================
-- MIGRATION: Padroniza hex de cor + sincroniza cadastro com variações
-- 2026-08-17
-- =============================================================
-- Contexto: a mesma cor tinha hexes diferentes entre peças (3 marrons,
-- 2 pretos) e produtos.cores/tamanhos (campos editoriais) estavam
-- desatualizados vs. variacoes (fonte da verdade). O filtro do catálogo
-- já passou a casar por NOME (ver fix(catalogo)); esta migration é o
-- polimento de dados: um hex por cor + cadastro batendo com o estoque.
--
-- Decisões de marca (Luíza): Preto = #1a1a1a, Marrom = #5c3a1e.
-- Ordem importa: (1) padroniza variacoes → (2) deriva cadastro delas.
-- Idempotente (dá pra rodar de novo sem efeito colateral).
-- =============================================================

-- ── 1. Um hex por cor nas variações (fonte da verdade) ──────────────
-- (Off White #ffffff e Grafite #9e9e9e já são únicos — não mexe.)
UPDATE variacoes SET cor_hex = '#1a1a1a'
WHERE cor_nome = 'Preto'  AND cor_hex IS DISTINCT FROM '#1a1a1a';

UPDATE variacoes SET cor_hex = '#5c3a1e'
WHERE cor_nome = 'Marrom' AND cor_hex IS DISTINCT FROM '#5c3a1e';

-- ── 2. Swatch Marrom do filtro do catálogo bate com a marca ─────────
-- (ajuste pontual só da entrada "Marrom" em configuracoes.filtros_cores;
--  as demais cores do filtro já estão corretas.)
UPDATE configuracoes
SET filtros_cores = (
  SELECT jsonb_agg(
           CASE WHEN lower(elem->>'nome') = 'marrom'
                THEN jsonb_set(elem, '{hex}', '"#5c3a1e"')
                ELSE elem END
           ORDER BY ord
         )
  FROM jsonb_array_elements(filtros_cores) WITH ORDINALITY AS a(elem, ord)
)
WHERE filtros_cores IS NOT NULL;

-- ── 3. produtos.cores / produtos.tamanhos derivados das variações ───
-- Remove cores/tamanhos fantasmas do cadastro editorial (Navy, Rosê,
-- Off-White antigo, GG/XG etc.), refletindo só o que existe em estoque.
-- COALESCE preserva o valor antigo se o produto não tiver variação em
-- estoque (evita esvaziar o cadastro por engano).
UPDATE produtos p
SET
  cores = COALESCE((
    SELECT jsonb_agg(c.obj ORDER BY c.nome)
    FROM (
      SELECT DISTINCT ON (v.cor_nome)
             v.cor_nome AS nome,
             jsonb_build_object('nome', v.cor_nome, 'hex', v.cor_hex) AS obj
      FROM   variacoes v
      WHERE  v.produto_id = p.id AND v.ativo = true
        AND  v.estoque > 0 AND v.cor_nome IS NOT NULL AND v.cor_nome <> ''
      ORDER  BY v.cor_nome, v.cor_hex
    ) c
  ), p.cores),
  tamanhos = COALESCE((
    -- produtos.tamanhos é text[] (não jsonb) → array_agg
    SELECT array_agg(t.tam ORDER BY t.ord)
    FROM (
      SELECT DISTINCT v.tamanho AS tam,
             array_position(ARRAY['PP','P','M','G','GG','XG'], v.tamanho) AS ord
      FROM   variacoes v
      WHERE  v.produto_id = p.id AND v.ativo = true
        AND  v.estoque > 0 AND v.tamanho IS NOT NULL AND v.tamanho <> ''
    ) t
  ), p.tamanhos),
  atualizado_em = NOW()
WHERE EXISTS (
  SELECT 1 FROM variacoes v
  WHERE v.produto_id = p.id AND v.ativo = true AND v.estoque > 0
);

-- ── Verificação (rodar após aplicar) ────────────────────────────────
-- 1) Cada cor com um único hex:
--    SELECT cor_nome, array_agg(DISTINCT cor_hex) FROM variacoes GROUP BY cor_nome;
--      esperado: Preto={#1a1a1a}, Marrom={#5c3a1e}, Off White={#ffffff}, Grafite={#9e9e9e}
-- 2) Cadastro batendo com estoque:
--    SELECT id, cores, tamanhos FROM produtos ORDER BY id;
