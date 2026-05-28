-- ============================================================
-- VIRTÙ — Adiciona tipo 'frete' ao sistema de cupons
-- Execute no Supabase SQL Editor
-- ============================================================

-- Atualiza constraint para aceitar o novo tipo 'frete'
ALTER TABLE cupons DROP CONSTRAINT IF EXISTS cupons_tipo_check;
ALTER TABLE cupons ADD CONSTRAINT cupons_tipo_check
  CHECK (tipo IN ('percentual', 'fixo', 'frete'));

-- Cupom de frete grátis padrão
INSERT INTO cupons (codigo, descricao, tipo, valor, valor_minimo)
VALUES (
  'FRETEGRATIS',
  'Frete grátis — cupom permanente da loja',
  'frete',
  0,
  0
)
ON CONFLICT (codigo) DO NOTHING;

SELECT 'Tipo frete + cupom FRETEGRATIS criados ✓' AS resultado;
