-- ============================================================
-- FIX: Blusa Carmen (blusa-helena) — Corrigir cores
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Remove TODAS as variações existentes (ativas ou não)
DELETE FROM variacoes WHERE produto_id = 'blusa-helena';

-- 2. Recria com as cores corretas
INSERT INTO variacoes (produto_id, tamanho, cor_nome, cor_hex, estoque, ativo) VALUES
  ('blusa-helena', 'PP', 'Preto',  '#1a1a1a', 10, true),
  ('blusa-helena', 'P',  'Preto',  '#1a1a1a', 10, true),
  ('blusa-helena', 'M',  'Preto',  '#1a1a1a', 10, true),
  ('blusa-helena', 'G',  'Preto',  '#1a1a1a', 10, true),
  ('blusa-helena', 'PP', 'Marrom', '#5C3A1E', 10, true),
  ('blusa-helena', 'P',  'Marrom', '#5C3A1E', 10, true),
  ('blusa-helena', 'M',  'Marrom', '#5C3A1E', 10, true),
  ('blusa-helena', 'G',  'Marrom', '#5C3A1E', 10, true);

-- 3. Atualiza também o campo p.cores no produto para consistência
UPDATE produtos
SET cores = '[{"nome":"Preto","hex":"#1a1a1a"},{"nome":"Marrom","hex":"#5C3A1E"}]'::jsonb
WHERE id = 'blusa-helena';

-- 4. Confirma o resultado
SELECT id, produto_id, tamanho, cor_nome, cor_hex, estoque, ativo
FROM variacoes
WHERE produto_id = 'blusa-helena'
ORDER BY cor_nome, tamanho;
