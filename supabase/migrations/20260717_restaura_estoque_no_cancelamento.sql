-- =====================================================================
-- MIGRATION: devolve estoque ao CANCELAR/RECUSAR pedido — 2026-07-17
-- =====================================================================
-- LACUNA CORRIGIDA:
--   A restauração de estoque só era disparada pelo webhook do ASAAS
--   (estorno/vencimento). Quando o ADMIN muda o status de um pedido para
--   'cancelado'/'recusado' pelo painel (UPDATE direto em pedidos), o estoque
--   reservado (estoque_baixado=true) NÃO era devolvido → ficava preso.
--
-- CORREÇÃO:
--   Trigger BEFORE UPDATE que, ao entrar em 'cancelado'/'recusado', devolve o
--   estoque via restaurar_estoque_pedido() e marca estoque_restaurado=true.
--   Idempotente pela flag: se o webhook (restaurar_estoque_por_payment) já
--   restaurou, NEW.estoque_restaurado já vem true e o trigger não age — e
--   vice-versa. Não há duplo débito/crédito.
--
-- Reversível: DROP TRIGGER + DROP FUNCTION.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_pedido_cancelado_restaura_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Só age na TRANSIÇÃO para cancelado/recusado, com estoque baixado e ainda
  -- não restaurado. A flag garante idempotência com o fluxo do webhook.
  IF NEW.status IN ('cancelado', 'recusado')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(NEW.estoque_baixado, false) = true
     AND COALESCE(NEW.estoque_restaurado, false) = false
  THEN
    PERFORM public.restaurar_estoque_pedido(NEW.itens);
    NEW.estoque_restaurado := true;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_pedido_cancelado_restaura_estoque() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pedido_cancelado_restaura ON public.pedidos;
CREATE TRIGGER trg_pedido_cancelado_restaura
  BEFORE UPDATE OF status ON public.pedidos
  FOR EACH ROW
  WHEN (NEW.status IN ('cancelado', 'recusado')
        AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_pedido_cancelado_restaura_estoque();

SELECT 'Migration 20260717: trigger de restauração de estoque no cancelamento ✓' AS resultado;
