-- ================================================================
-- Migration: adiciona colunas cupom_codigo e parcelas à tabela pedidos
-- Autor: Virtù QA — 2026-06-13
-- ================================================================
-- Estas colunas armazenam, por pedido:
--   cupom_codigo  TEXT        — código do cupom aplicado (ex: "VERAO10"), ou NULL
--   parcelas      SMALLINT    — nº de parcelas no cartão (1..12), ou NULL para PIX
-- ================================================================

-- Adiciona cupom_codigo se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos' AND column_name = 'cupom_codigo'
  ) THEN
    ALTER TABLE pedidos ADD COLUMN cupom_codigo TEXT;
    COMMENT ON COLUMN pedidos.cupom_codigo IS 'Código do cupom aplicado no pedido, ou NULL se nenhum';
  END IF;
END $$;

-- Adiciona parcelas se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos' AND column_name = 'parcelas'
  ) THEN
    ALTER TABLE pedidos ADD COLUMN parcelas SMALLINT;
    COMMENT ON COLUMN pedidos.parcelas IS 'Número de parcelas (1..12 para cartão, NULL para PIX)';
  END IF;
END $$;
