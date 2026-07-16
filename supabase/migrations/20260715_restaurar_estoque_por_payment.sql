-- =====================================================================
-- MIGRATION: restaurar_estoque_por_payment — atômico + idempotente — 2026-07-15
-- =====================================================================
-- Usada pelo asaas-webhook quando um pagamento vence/estorna/é excluído.
-- Faz TUDO em uma transação (FOR UPDATE no pedido): só devolve o estoque se
-- ele foi baixado e ainda NÃO restaurado, e vira a flag na mesma operação.
-- Assim o webhook do ASAAS pode disparar N vezes → devolve o estoque UMA vez.
-- =====================================================================

-- NB: p_status precisa estar em pedidos_status_check
--     ('pendente','confirmado','pago','enviado','entregue','cancelado','recusado').
--     Vencimento/estorno/chargeback → 'cancelado'.
CREATE OR REPLACE FUNCTION public.restaurar_estoque_por_payment(
  p_payment_id text,
  p_status     text DEFAULT 'cancelado'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_itens jsonb;
BEGIN
  -- Trava o pedido; só age se baixado e não restaurado (idempotência atômica).
  SELECT id, itens
  INTO   v_id, v_itens
  FROM   pedidos
  WHERE  asaas_payment_id = p_payment_id
    AND  estoque_baixado = true
    AND  estoque_restaurado = false
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('restaurado', false, 'motivo', 'nada a restaurar');
  END IF;

  PERFORM public.restaurar_estoque_pedido(v_itens);

  UPDATE pedidos
  SET    estoque_restaurado = true,
         status             = p_status,
         payment_status     = p_status
  WHERE  id = v_id;

  RETURN jsonb_build_object('restaurado', true, 'pedido', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurar_estoque_por_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restaurar_estoque_por_payment(text, text) TO service_role;

SELECT 'Migration 20260715: restaurar_estoque_por_payment (atomico/idempotente) ✓' AS resultado;
