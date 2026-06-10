-- =============================================================
-- MIGRATION: Fix dupla dedução de estoque + Realtime nas tabelas
--            críticas + dedup fluxo_caixa por pedido
--
-- Problemas corrigidos:
--   1. fn_pedido_pago_para_fluxo() chamava comprar_variacao()
--      ao mesmo tempo que trg_pedido_pago_baixa_estoque → dois
--      débitos de estoque para cada pedido PIX confirmado
--   2. Tabelas críticas não estavam na publicação Realtime →
--      admin não recebia atualizações em tempo real
--   3. Sem índice único em fluxo_caixa.pedido_id → risco de
--      entradas duplicadas de receita para o mesmo pedido
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Reescreve fn_pedido_pago_para_fluxo
--    Remove chamadas a comprar_variacao() (agora tratadas
--    exclusivamente pelo trigger trg_pedido_pago_baixa_estoque)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_pedido_pago_para_fluxo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor   NUMERIC;
  v_metodo  TEXT;
BEGIN
  -- Só age na transição → 'pago'
  IF NEW.status IS DISTINCT FROM 'pago' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pago' THEN
    RETURN NEW;  -- já processado: idempotência
  END IF;

  v_valor  := COALESCE(NEW.valor_total, 0);
  v_metodo := COALESCE(NEW.metodo_pagamento, 'desconhecido');

  -- Insere entrada de receita (ON CONFLICT garante idempotência)
  INSERT INTO fluxo_caixa (
    tipo,
    descricao,
    valor,
    metodo_pagamento,
    pedido_id,
    criado_em
  )
  VALUES (
    'entrada',
    'Venda #' || NEW.id,
    v_valor,
    v_metodo,
    NEW.id,
    NOW()
  )
  ON CONFLICT (pedido_id) WHERE pedido_id IS NOT NULL
  DO NOTHING;

  -- Marca e-mail como pendente de envio (se ainda não enviado)
  UPDATE pedidos
  SET    email_enviado = COALESCE(email_enviado, false)
  WHERE  id = NEW.id
    AND  email_enviado IS NULL;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Índice único: garante no máximo uma entrada de receita
--    por pedido na tabela fluxo_caixa
-- ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_fluxo_caixa_pedido_unico
  ON fluxo_caixa (pedido_id)
  WHERE pedido_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Habilita Realtime nas tabelas críticas do painel admin
--    (adiciona à publicação supabase_realtime)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pedidos',
    'produtos',
    'fluxo_caixa',
    'clientes_perfil',
    'cupons',
    'avaliacoes',
    'bazar_pecas'
  ])
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE %I',
        t
      );
    EXCEPTION WHEN duplicate_object THEN
      -- Tabela já estava na publicação: OK
      NULL;
    END;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. Corrige pedidos 'pago' antigos sem email_enviado definido
--    (evita que o trigger re-envie e-mails já enviados)
-- ────────────────────────────────────────────────────────────
UPDATE pedidos
SET    email_enviado = true
WHERE  status = 'pago'
  AND  email_enviado IS NULL;
