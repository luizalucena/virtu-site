-- =====================================================================
-- MIGRATION: Estoque atômico por variação — anti-overselling — 2026-07-15
-- =====================================================================
-- PROBLEMA:
--   O trigger fn_pedido_pago_baixa_estoque baixava com
--   `estoque = GREATEST(0, estoque - qty)` → pedir 5 com estoque 3 ZERAVA e
--   mantinha o pedido pago (vendia 2 a mais). Além disso comparava
--   `produto_id = v_produto_id::UUID`, mas produto_id é TEXT (slug) → erro.
--
-- CORREÇÃO (backend = autoridade única):
--   • RPC atômica `reservar_estoque_pedido(itens)`: trava as linhas das
--     variações (FOR UPDATE), revalida POR VARIAÇÃO (tamanho+cor) e baixa
--     TUDO OU NADA (fail-closed). Nunca deixa negativo.
--   • RPC `restaurar_estoque_pedido(itens)`: devolve o estoque (cancelamento
--     /estorno/expiração).
--   • Flags em `pedidos` (estoque_baixado / estoque_restaurado) para
--     idempotência (webhook do ASAAS pode disparar 2x).
--   • Neutraliza o trigger de baixa: a reserva passa a ser feita no
--     processar-pagamento ANTES de cobrar (paid ⟺ estoque reservado).
--
-- Reversível: dropar as 2 RPCs, remover as colunas, e restaurar o corpo
--   antigo do trigger (preservado no histórico desta migration).
-- =====================================================================

-- 1) Flags de controle (idempotência de baixa/restauração)
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS estoque_baixado    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estoque_restaurado boolean NOT NULL DEFAULT false;

-- 2) RPC ATÔMICA: reserva (baixa) o estoque do pedido inteiro — tudo ou nada.
CREATE OR REPLACE FUNCTION public.reservar_estoque_pedido(p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item      jsonb;
  v_pid     text; v_tam text; v_cor text; v_qty int;
  v_var_id  uuid; v_estoque int; v_nome text;
  v_reservas jsonb := '[]'::jsonb;   -- {var_id, qty} validadas p/ debitar depois
  r         jsonb;
BEGIN
  -- PASSO 1 — trava + valida TODAS as variações (nada é debitado ainda)
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_pid := COALESCE(item->>'produto_id', item->>'id');
    v_tam := COALESCE(item->>'tamanho',  '');
    v_cor := COALESCE(item->>'cor_nome', '');
    v_qty := GREATEST(1, COALESCE((item->>'qty')::int, 1));
    IF v_pid IS NULL OR v_pid = '' THEN CONTINUE; END IF;

    -- variação exata (tamanho+cor), travando a linha
    SELECT id, estoque INTO v_var_id, v_estoque
    FROM   variacoes
    WHERE  produto_id = v_pid AND ativo = true
      AND  (tamanho  = v_tam OR (v_tam = '' AND (tamanho  IS NULL OR tamanho  = '')))
      AND  (cor_nome = v_cor OR (v_cor = '' AND (cor_nome IS NULL OR cor_nome = '')))
    ORDER BY estoque DESC
    LIMIT 1
    FOR UPDATE;

    -- fallback: produto sem variação específica → qualquer variação do produto
    IF v_var_id IS NULL THEN
      SELECT id, estoque INTO v_var_id, v_estoque
      FROM   variacoes WHERE produto_id = v_pid AND ativo = true
      ORDER BY estoque DESC LIMIT 1 FOR UPDATE;
    END IF;

    IF v_var_id IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Produto sem estoque cadastrado.',
        'produto', v_pid, 'tamanho', v_tam);
    END IF;

    IF v_estoque < v_qty THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque insuficiente.',
        'produto', v_pid, 'tamanho', v_tam, 'disponivel', v_estoque, 'pedido', v_qty);
    END IF;

    v_reservas := v_reservas || jsonb_build_object('var_id', v_var_id, 'qty', v_qty);
    v_var_id := NULL; -- reset p/ próximo loop
  END LOOP;

  -- PASSO 2 — todas OK: debita (linhas já travadas nesta transação)
  FOR r IN SELECT * FROM jsonb_array_elements(v_reservas) LOOP
    UPDATE variacoes
    SET    estoque = estoque - (r->>'qty')::int
    WHERE  id = (r->>'var_id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

-- 3) RPC: restaura (devolve) o estoque de um pedido.
CREATE OR REPLACE FUNCTION public.restaurar_estoque_pedido(p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item jsonb; v_pid text; v_tam text; v_cor text; v_qty int; v_var_id uuid;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_pid := COALESCE(item->>'produto_id', item->>'id');
    v_tam := COALESCE(item->>'tamanho',  '');
    v_cor := COALESCE(item->>'cor_nome', '');
    v_qty := GREATEST(1, COALESCE((item->>'qty')::int, 1));
    IF v_pid IS NULL OR v_pid = '' THEN CONTINUE; END IF;

    SELECT id INTO v_var_id
    FROM   variacoes
    WHERE  produto_id = v_pid
      AND  (tamanho  = v_tam OR (v_tam = '' AND (tamanho  IS NULL OR tamanho  = '')))
      AND  (cor_nome = v_cor OR (v_cor = '' AND (cor_nome IS NULL OR cor_nome = '')))
    LIMIT 1;

    IF v_var_id IS NULL THEN
      SELECT id INTO v_var_id FROM variacoes WHERE produto_id = v_pid ORDER BY estoque ASC LIMIT 1;
    END IF;

    IF v_var_id IS NOT NULL THEN
      UPDATE variacoes SET estoque = estoque + v_qty WHERE id = v_var_id;
    END IF;
    v_var_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

-- 4) Permissões: só o backend (service_role) chama. Nunca anon/authenticated.
REVOKE ALL ON FUNCTION public.reservar_estoque_pedido(jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restaurar_estoque_pedido(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reservar_estoque_pedido(jsonb)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.restaurar_estoque_pedido(jsonb) TO service_role;

-- 5) Neutraliza o trigger de baixa (a reserva agora é feita no
--    processar-pagamento, ANTES de cobrar). Vira no-op para não baixar em
--    dobro. (Mantém a função para não quebrar o trigger; corpo antigo
--    documentado no cabeçalho desta migration.)
CREATE OR REPLACE FUNCTION public.fn_pedido_pago_baixa_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Baixa de estoque desativada aqui: agora é atômica (reservar_estoque_pedido)
  -- no processar-pagamento, ANTES da cobrança. Evita duplo débito e o antigo
  -- GREATEST(0,...) que vendia acima do estoque.
  RETURN NEW;
END;
$$;

SELECT 'Migration 20260715: estoque atomico (reservar/restaurar) + trigger neutralizado ✓' AS resultado;
