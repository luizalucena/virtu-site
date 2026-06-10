-- =============================================================
-- MIGRATION: Sincronização completa de estoque
--
-- Problemas corrigidos:
--   1. produtos.estoque ficava dessincronizado quando o admin
--      ajustava variacoes.estoque via painel Stock
--   2. fn_pedido_pago_baixa_estoque tentava atualizar coluna
--      "estoque_variantes" que não existe → nenhuma venda
--      debitava estoque
--
-- Solução:
--   A. Trigger em variacoes → mantém produtos.estoque = SUM
--   B. Trigger em pedidos   → debita variacoes.estoque na venda
--   C. UPDATE inicial       → corrige discrepâncias existentes
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Limpa triggers / funções antigas (se existirem)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_pedido_pago_baixa_estoque ON pedidos;
DROP FUNCTION IF EXISTS fn_pedido_pago_baixa_estoque();

DROP TRIGGER IF EXISTS trg_sync_produto_estoque ON variacoes;
DROP FUNCTION IF EXISTS fn_sync_produto_estoque();

-- ────────────────────────────────────────────────────────────
-- 2. TRIGGER A: variacoes → produtos.estoque
--    Sempre que uma variação for inserida, atualizada ou
--    removida, recalcula o estoque agregado do produto.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_sync_produto_estoque()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_produto_id TEXT;
BEGIN
  -- DELETE: usa OLD; INSERT/UPDATE: usa NEW
  IF TG_OP = 'DELETE' THEN
    v_produto_id := OLD.produto_id;
  ELSE
    v_produto_id := NEW.produto_id;
  END IF;

  UPDATE produtos
  SET    estoque = (
           SELECT COALESCE(SUM(v.estoque), 0)
           FROM   variacoes v
           WHERE  v.produto_id = v_produto_id
             AND  v.ativo = true
         ),
         atualizado_em = NOW()
  WHERE  id = v_produto_id;

  RETURN NULL;  -- AFTER trigger: valor ignorado
END;
$$;

CREATE TRIGGER trg_sync_produto_estoque
AFTER INSERT OR UPDATE OR DELETE ON variacoes
FOR EACH ROW
EXECUTE FUNCTION fn_sync_produto_estoque();

-- ────────────────────────────────────────────────────────────
-- 3. TRIGGER B: pedidos → variacoes.estoque
--    Na transição de status → 'pago', debita o estoque de
--    cada variação envolvida no pedido.
--    O trigger A cuida de refletir isso em produtos.estoque.
-- ────────────────────────────────────────────────────────────
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
    v_produto_id := item->>'produto_id';
    v_tamanho    := COALESCE(item->>'tamanho',  '');
    v_cor_nome   := COALESCE(item->>'cor_nome', '');
    v_qty        := COALESCE((item->>'qty')::INTEGER, 1);

    -- Debita variação correspondente (nunca abaixo de zero)
    UPDATE variacoes
    SET    estoque = GREATEST(0, estoque - v_qty)
    WHERE  produto_id = v_produto_id
      AND  tamanho    = v_tamanho
      AND  cor_nome   = v_cor_nome;

    -- Se não achou com tamanho+cor exatos, tenta só por produto_id
    -- (fallback para produtos sem variação de cor/tamanho)
    -- Fallback: produto sem variação específica
    IF NOT FOUND THEN
      SELECT id INTO v_fallback_id
      FROM   variacoes
      WHERE  produto_id = v_produto_id
      LIMIT  1;

      IF v_fallback_id IS NOT NULL THEN
        UPDATE variacoes
        SET    estoque = GREATEST(0, estoque - v_qty)
        WHERE  id = v_fallback_id;
      END IF;
    END IF;

    -- O trigger trg_sync_produto_estoque atualiza produtos.estoque
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pedido_pago_baixa_estoque
AFTER UPDATE ON pedidos
FOR EACH ROW
EXECUTE FUNCTION fn_pedido_pago_baixa_estoque();

-- ────────────────────────────────────────────────────────────
-- 4. SINCRONIA INICIAL
--    Corrige todas as discrepâncias atuais entre
--    produtos.estoque e SUM(variacoes.estoque)
-- ────────────────────────────────────────────────────────────
UPDATE produtos p
SET    estoque = (
         SELECT COALESCE(SUM(v.estoque), 0)
         FROM   variacoes v
         WHERE  v.produto_id = p.id
           AND  v.ativo = true
       ),
       atualizado_em = NOW();
