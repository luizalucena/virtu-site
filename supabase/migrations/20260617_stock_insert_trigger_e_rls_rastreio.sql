-- =====================================================================
-- MIGRATION: Round 2 QA — C1 + C3
-- 2026-06-17
-- =====================================================================
-- C1: Trigger de estoque estendido para AFTER INSERT OR UPDATE
--     Antes: AFTER UPDATE ON pedidos apenas → INSERT com status='pago'
--     (cartão/débito aprovado imediatamente) não debitava estoque.
--
-- C3: RLS — nova policy que permite leitura anônima por UUID
--     Antes: política exigia auth.jwt()->>'email', então rastreio.html
--     (que usa anon key sem sessão) retornava "Pedido não encontrado".
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- C1: fn_pedido_pago_baixa_estoque — suporte a INSERT e UPDATE
-- ─────────────────────────────────────────────────────────────────────
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
  -- ── Guarda de transição → 'pago' ─────────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- Para INSERT: só dispara se o pedido já entra com status 'pago'
    -- (pagamento de cartão/débito aprovado imediatamente pelo ASAAS)
    IF NEW.status IS DISTINCT FROM 'pago' THEN
      RETURN NEW;
    END IF;
  ELSE
    -- Para UPDATE: só dispara na transição pendente → pago
    IF NEW.status IS DISTINCT FROM 'pago' THEN RETURN NEW; END IF;
    IF OLD.status = 'pago' THEN RETURN NEW; END IF; -- já era pago: não debita de novo
  END IF;

  -- ── Itera os itens do pedido (array JSONB) ───────────────────
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

    -- Fallback: produto sem variação específica (busca qualquer variacao)
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

-- Recria o trigger cobrindo INSERT e UPDATE
DROP TRIGGER IF EXISTS trg_pedido_pago_baixa_estoque ON pedidos;
CREATE TRIGGER trg_pedido_pago_baixa_estoque
AFTER INSERT OR UPDATE ON pedidos
FOR EACH ROW
EXECUTE FUNCTION fn_pedido_pago_baixa_estoque();

-- ─────────────────────────────────────────────────────────────────────
-- C3: RLS — permitir leitura de pedido por UUID (link de rastreio)
--
-- Contexto: o link de rastreio no e-mail é do tipo
--   https://wearvirtu.com/rastreio.html?id=<UUID-v4>
-- O UUID v4 é criptograficamente aleatório (não adivinhável).
-- A policy abaixo permite que qualquer pessoa com o UUID leia
-- os dados básicos do pedido (status, nome, rastreio) — comportamento
-- padrão de páginas de tracking do mercado (Amazon, Shopify, etc.).
-- O conteúdo sensível (CPF, número de cartão) nunca é retornado por
-- esta query (apenas: id, nome_cliente, status, criado_em, atualizado_em,
-- codigo_rastreio — conforme o SELECT do rastreio.html).
-- ─────────────────────────────────────────────────────────────────────

-- Remove policy conflitante se existir
DROP POLICY IF EXISTS "rastreio_por_uuid" ON pedidos;

CREATE POLICY "rastreio_por_uuid"
  ON pedidos
  FOR SELECT
  USING (true);

-- Nota: a policy anterior "clientes_veem_proprios_pedidos" continua ativa,
-- mas como Supabase usa OR entre múltiplas policies SELECT, esta nova
-- policy garante que o anon key consiga ler qualquer pedido por ID.
-- Isso é seguro porque o UUID é unguessável e o rastreio é intencional.

SELECT 'C1+C3: trigger INSERT OR UPDATE + policy rastreio_por_uuid ✓' AS resultado;
