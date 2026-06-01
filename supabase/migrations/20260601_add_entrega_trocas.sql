-- ============================================================
-- Adiciona coluna entrega_trocas na tabela produtos
-- Execute no Supabase SQL Editor
-- ============================================================

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS entrega_trocas TEXT DEFAULT NULL;

-- Comentário: quando NULL, o site exibe o texto padrão de entrega/trocas
-- que está no produto.html. Quando preenchido, substitui esse texto padrão.
