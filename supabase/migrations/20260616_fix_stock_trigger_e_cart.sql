-- =====================================================================
-- MIGRATION: Fix trigger de estoque — compatibilidade com campo id/produto_id
-- 2026-06-16
-- =====================================================================
-- O carrinho salva itens com campo "id" (produto UUID) no localStorage.
-- O trigger fn_pedido_pago_baixa_estoque lia apenas item->>'produto_id',
-- que era NULL → UPDATE de estoque nunca executava.
--
-- Fix: usar COALESCE(item->>'produto_id', item->>'id') para suportar
-- tanto itens novos (com produto_id) quanto itens legados (só com id).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_pedido_pago_baixa_estoque()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item           JSONB;
  v_produto_id   TEXT;
  v_tamanho      TEXT;
  v_cor_nome     TEXT;
  v_qty          INTEGER;
  v_fallback_id  UUID;
BEGIN
  -- Só dispara na transição → 'pago'
  IF NEW.status IS DISTINCT FROM 'pago' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pago' THEN
    RETURN NEW;   -- já era pago: não debita de novo
  END IF;

  -- Itera os itens do pedido (array JSONB)
  FOR item IN
    SELECT * FROM jsonb_array_elements(COALESCE(NEW.itens, '[]'::jsonb))
  LOOP
    -- Suporta tanto { produto_id: ... } (novo) quanto { id: ... } (legado)
    v_produto_id := COALESCE(item->>'produto_id', item->>'id');
    v_tamanho    := COALESCE(item->>'tamanho',  '');
    v_cor_nome   := COALESCE(item->>'cor_nome', '');
    v_qty        := COALESCE((item->>'qty')::INTEGER, 1);

    -- Ignora itens sem produto identificável
    IF v_produto_id IS NULL OR v_produto_id = '' THEN
      CONTINUE;
    END IF;

    -- Debita variação correspondente (nunca abaixo de zero)
    UPDATE variacoes
    SET    estoque = GREATEST(0, estoque - v_qty)
    WHERE  produto_id = v_produto_id::UUID
      AND  tamanho    = v_tamanho
      AND  cor_nome   = v_cor_nome;

    -- Se não achou com tamanho+cor exatos, tenta só por produto_id
    -- (fallback para produtos sem variação de cor/tamanho)
    IF NOT FOUND THEN
      SELECT id INTO v_fallback_id
      FROM   variacoes
      WHERE  produto_id = v_produto_id::UUID
      LIMIT  1;

      IF v_fallback_id IS NOT NULL THEN
        UPDATE variacoes
        SET    estoque = GREATEST(0, estoque - v_qty)
        WHERE  id = v_fallback_id;
      END IF;
    END IF;

    -- O trigger trg_sync_produto_estoque atualiza produtos.estoque automaticamente
  END LOOP;

  RETURN NEW;
END;
$$;

-- Recriar o trigger (DROP IF EXISTS + CREATE para garantir atualização)
DROP TRIGGER IF EXISTS trg_pedido_pago_baixa_estoque ON pedidos;
CREATE TRIGGER trg_pedido_pago_baixa_estoque
AFTER UPDATE ON pedidos
FOR EACH ROW
EXECUTE FUNCTION fn_pedido_pago_baixa_estoque();

SELECT 'fix_stock_trigger: COALESCE(produto_id, id) aplicado ✓' AS resultado;
