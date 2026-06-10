-- =============================================================
-- MIGRATION: Correções da varredura de bugs — 2026-06-10
--
-- Bugs corrigidos:
--   1. Índice único para idempotência do pix-webhook: evita que o
--      mesmo payment_id seja processado mais de uma vez caso o MP
--      dispare o webhook repetidamente.
--
--   2. Índice para acelerar lookup de pedido por payment_id
--      (usado no pix-webhook a cada notificação).
--
--   3. send-order-email: corrige envio do e-mail de confirmação
--      para pedidos PIX — a função agora é chamada pelo pix-webhook
--      após a confirmação do pagamento.
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Índice de lookup rápido: pedidos por payment_id
--    (o webhook faz .eq('payment_id', paymentId) a cada call)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_payment_id
  ON pedidos (payment_id)
  WHERE payment_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Índice de lookup rápido: carrinhos_abandonados por telefone
--    (usado em checkRecovery e recuperação de carrinho)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_carrinhos_abandonados_telefone
  ON carrinhos_abandonados (telefone)
  WHERE recuperado = false;

-- ────────────────────────────────────────────────────────────
-- 3. Garante que pedidos não têm email_enviado NULL (default false)
--    Isto evita que a flag seja ignorada em queries de filtragem.
-- ────────────────────────────────────────────────────────────
UPDATE pedidos
SET email_enviado = false
WHERE email_enviado IS NULL;

ALTER TABLE pedidos
  ALTER COLUMN email_enviado SET DEFAULT false;
