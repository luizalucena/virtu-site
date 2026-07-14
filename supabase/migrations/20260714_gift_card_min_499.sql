-- =====================================================================
-- MIGRATION: Gift Card — mínimo do pedido R$459 → R$499 (Virtù)
-- 2026-07-14
-- =====================================================================
-- Ajuste de regra de negócio: o desconto de R$100 do gift card passa a
-- exigir subtotal ≥ R$499,00 (antes R$459,00). Só muda a constante
-- c_min_subtotal em gift_card_status; o resto da função é idêntico ao
-- 20260713_gift_card_100.sql. Migration append-only (não altera a anterior).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.gift_card_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_min_compras   CONSTANT INTEGER       := 6;       -- MAIS de 5 → ≥ 6
  c_valor         CONSTANT NUMERIC(10,2) := 100.00;
  c_min_subtotal  CONSTANT NUMERIC(10,2) := 499.00;  -- pedido mínimo (era 459)
  v_compras_validas INTEGER := 0;
  v_consumido       BOOLEAN := FALSE;
  v_em_uso          BOOLEAN := FALSE;
BEGIN
  -- Anti-sondagem: cliente autenticado só consulta o próprio status;
  -- backend (service_role, auth.uid() nulo) consulta qualquer user_id.
  IF p_user_id IS NULL
     OR (auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN jsonb_build_object(
      'elegivel', FALSE, 'compras_validas', 0, 'consumido', FALSE,
      'em_uso', FALSE, 'valor', c_valor, 'min_subtotal', c_min_subtotal,
      'min_compras', c_min_compras
    );
  END IF;

  SELECT COUNT(DISTINCT ((criado_em AT TIME ZONE 'America/Recife')::date))
  INTO   v_compras_validas
  FROM   public.pedidos
  WHERE  user_id = p_user_id AND status = 'pago';

  SELECT EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE user_id = p_user_id AND gift_card_aplicado = TRUE AND status = 'pago'
  ) INTO v_consumido;

  SELECT EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE user_id = p_user_id AND gift_card_aplicado = TRUE AND status = 'pendente'
      AND (pix_expires_at IS NULL OR pix_expires_at > NOW())
  ) INTO v_em_uso;

  RETURN jsonb_build_object(
    'elegivel',        (v_compras_validas >= c_min_compras) AND NOT v_consumido AND NOT v_em_uso,
    'compras_validas', v_compras_validas,
    'consumido',       v_consumido,
    'em_uso',          v_em_uso,
    'valor',           c_valor,
    'min_subtotal',    c_min_subtotal,
    'min_compras',     c_min_compras
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gift_card_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gift_card_status(uuid) TO authenticated, service_role;
