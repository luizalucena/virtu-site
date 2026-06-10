-- ============================================================
-- VIRTÙ — Realtime + Correções de Integridade
-- Execute no Supabase SQL Editor
-- ============================================================

-- ── 1. HABILITA REALTIME NAS TABELAS CRÍTICAS ─────────────────
-- Permite que o admin receba atualizações ao vivo sem F5

ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE fluxo_caixa;
ALTER PUBLICATION supabase_realtime ADD TABLE produtos;

-- ── 2. GARANTE ÍNDICE DE DEDUPLICAÇÃO ÚNICO ─────────────────
-- A constraint UNIQUE (origem, fonte_id) já existe, mas o índice
-- precisa excluir NULLs (lançamentos manuais têm fonte_id = NULL)
-- para não bloquear múltiplos lançamentos manuais do mesmo admin.
-- Recria como partial index (apenas quando fonte_id IS NOT NULL).

DROP INDEX IF EXISTS fluxo_caixa_origem_fonte_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fc_origem_fonte_id
  ON fluxo_caixa (origem, fonte_id)
  WHERE fonte_id IS NOT NULL;

-- ── 3. GARANTE QUE O TRIGGER DE FLUXO AINDA ESTÁ ATIVO ───────
-- (idempotente — não falha se já existir)

CREATE OR REPLACE FUNCTION fn_pedido_pago_para_fluxo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'pago' AND OLD.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO fluxo_caixa
      (tipo, valor, descricao, categoria, data_lancamento, origem, pedido_id, fonte_id)
    VALUES (
      'entrada',
      NEW.total,
      'Venda #' || upper(substring(NEW.id::text, 1, 8)),
      'Venda Site',
      CURRENT_DATE,
      'site',
      NEW.id,
      'pedido_' || NEW.id::text
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_pago_fluxo ON pedidos;
CREATE TRIGGER trg_pedido_pago_fluxo
  AFTER UPDATE OF status ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION fn_pedido_pago_para_fluxo();

-- ── 4. TRIGGER DE BAIXA DE ESTOQUE AO MARCAR PEDIDO COMO PAGO ─
-- Quando status → 'pago', subtrai qty de cada item do estoque
-- usando a coluna estoque_variantes (JSONB) da tabela produtos.
-- Idempotente: só age na transição → 'pago'.

CREATE OR REPLACE FUNCTION fn_pedido_pago_baixa_estoque()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item        JSONB;
  v_produto_id  UUID;
  v_tamanho     TEXT;
  v_cor         TEXT;
  v_qty         INT;
  v_variantes   JSONB;
  v_chave       TEXT;
  v_atual       INT;
BEGIN
  -- Só processa a transição → 'pago'
  IF NEW.status = 'pago' AND OLD.status IS DISTINCT FROM 'pago' THEN
    -- Percorre cada item do pedido (array JSON)
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.itens)
    LOOP
      v_produto_id := (v_item->>'produto_id')::UUID;
      v_tamanho    := v_item->>'tamanho';
      v_cor        := v_item->>'cor_id';
      v_qty        := COALESCE((v_item->>'qty')::INT, 1);

      IF v_produto_id IS NULL THEN CONTINUE; END IF;

      -- Busca estoque_variantes atual
      SELECT estoque_variantes INTO v_variantes
      FROM produtos WHERE id = v_produto_id FOR UPDATE;

      IF v_variantes IS NULL THEN CONTINUE; END IF;

      -- Constrói chave da variante: cor__tamanho
      v_chave := COALESCE(v_cor, 'default') || '__' || COALESCE(v_tamanho, 'UN');

      -- Subtrai qtd (mínimo 0)
      v_atual := COALESCE((v_variantes->>v_chave)::INT, 0);
      v_variantes := jsonb_set(
        v_variantes,
        ARRAY[v_chave],
        to_jsonb(GREATEST(0, v_atual - v_qty))
      );

      UPDATE produtos
        SET estoque_variantes = v_variantes,
            atualizado_em     = NOW()
      WHERE id = v_produto_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_baixa_estoque ON pedidos;
CREATE TRIGGER trg_pedido_baixa_estoque
  AFTER UPDATE OF status ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION fn_pedido_pago_baixa_estoque();

-- ── CONFIRMAÇÃO ───────────────────────────────────────────────
SELECT 'Realtime + triggers + índice de deduplicação configurados ✓' AS status;
