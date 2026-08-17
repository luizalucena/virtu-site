-- =============================================================
-- MIGRATION: Reconciliar estoque da Camisa Milena
-- 2026-08-13
-- =============================================================
-- Sintoma: produtos.estoque da camisa-milena estava 3, mas a soma
-- das variações é 2 (única variação: P / Marrom, 2 unidades).
-- Decisão da Luíza: o correto é 2 (não existe 3ª peça física).
--
-- produtos.estoque é derivado — o trigger trg_sync_produto_estoque
-- (ver 20260610_sync_estoque.sql) recalcula SUM(variacoes.estoque)
-- em qualquer INSERT/UPDATE/DELETE em variacoes. Portanto NÃO
-- escrevemos produtos.estoque à mão: damos um "toque" (UPDATE no-op)
-- na variação, e o trigger reconcilia produtos.estoque = 2.
-- =============================================================

UPDATE variacoes
SET    estoque = estoque      -- no-op: só dispara trg_sync_produto_estoque
WHERE  produto_id = 'camisa-milena';

-- Verificação (deve retornar estoque = 2)
SELECT id, estoque
FROM   produtos
WHERE  id = 'camisa-milena';
