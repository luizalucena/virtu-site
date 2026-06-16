-- ============================================================
-- VIRTÙ — Migration: Colunas ASAAS
-- Adiciona campos de integração ASAAS nas tabelas principais.
-- ============================================================

-- 1. Identificador de cliente no ASAAS (criado no primeiro pagamento)
ALTER TABLE clientes_perfil
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- 2. Identificador do pagamento no ASAAS (por pedido)
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT;

-- Índices para busca rápida (webhook lookup)
CREATE INDEX IF NOT EXISTS idx_clientes_perfil_asaas_customer_id
  ON clientes_perfil (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_asaas_payment_id
  ON pedidos (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;
