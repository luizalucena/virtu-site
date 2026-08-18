-- =============================================================
-- MIGRATION: PDV Garimpo — venda presencial da linha Wear Virtù
--
-- Cria:
--   • registrar_venda_presencial()  — venda atômica: valida, trava,
--     dá baixa no estoque das variações e grava o pedido (status 'pago').
--     O trigger trg_pedido_pago_fluxo cria a entrada no fluxo de caixa.
--   • cancelar_venda_presencial()   — desfaz uma venda do PDV: devolve
--     o estoque (via trg_pedido_cancelado_restaura) e apaga a entrada
--     do fluxo de caixa (venda que não aconteceu).
--
-- Notas de projeto:
--   • O cliente envia APENAS variacao_id + qty. Nome, tamanho, cor e
--     preço são lidos do banco pelo servidor — o front NUNCA define
--     valor. Isso garante que soma, tamanho, cor e nome nunca divergem.
--   • Quantidades repetidas da mesma variação são agregadas antes da
--     validação, evitando vender 2× o último item.
--   • Validação e baixa acontecem em dois passos: nada é deduzido
--     antes de TODOS os itens passarem na checagem (RETURN dentro de
--     função não faz rollback da transação).
--   • Ambas as funções exigem is_virtu_admin().
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Registrar venda presencial
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_venda_presencial(
  p_itens             JSONB,
  p_pagamento         TEXT,
  p_desconto          NUMERIC  DEFAULT 0,
  p_cliente_nome      TEXT     DEFAULT NULL,
  p_cliente_telefone  TEXT     DEFAULT NULL,
  p_parcelas          INTEGER  DEFAULT NULL,
  p_observacao        TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pag        TEXT;
  v_metodo     TEXT;
  v_rotulo     TEXT;
  v_parcelas   SMALLINT;
  v_desconto   NUMERIC(10,2);
  v_subtotal   NUMERIC(10,2) := 0;
  v_total      NUMERIC(10,2);
  v_itens      JSONB := '[]'::JSONB;
  v_pecas      INTEGER := 0;
  v_preco      NUMERIC(10,2);
  v_sub_item   NUMERIC(10,2);
  v_pedido     pedidos%ROWTYPE;
  r            RECORD;   -- item agregado vindo do payload
  d            RECORD;   -- dados reais da variação (fonte da verdade)
  b            JSONB;    -- item já validado, no passo da baixa
BEGIN
  ---------------------------------------------------------------
  -- 1.1 Autorização
  ---------------------------------------------------------------
  IF NOT is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;

  ---------------------------------------------------------------
  -- 1.2 Forma de pagamento
  ---------------------------------------------------------------
  v_pag := lower(trim(COALESCE(p_pagamento, '')));

  IF v_pag NOT IN ('pix', 'dinheiro', 'credito', 'debito') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Forma de pagamento inválida.');
  END IF;

  -- payment_method segue o vocabulário já usado em admin/pedidos.js
  v_metodo := CASE v_pag WHEN 'credito' THEN 'cartao' ELSE v_pag END;
  v_rotulo := CASE v_pag
                WHEN 'pix'      THEN 'PIX'
                WHEN 'dinheiro' THEN 'Dinheiro'
                WHEN 'credito'  THEN 'Cartão de crédito'
                WHEN 'debito'   THEN 'Cartão de débito'
              END;

  v_parcelas := CASE
                  WHEN v_pag = 'credito'
                  THEN GREATEST(1, LEAST(12, COALESCE(p_parcelas, 1)))::SMALLINT
                  ELSE NULL
                END;

  ---------------------------------------------------------------
  -- 1.3 Payload de itens
  ---------------------------------------------------------------
  IF p_itens IS NULL
     OR jsonb_typeof(p_itens) <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Nenhuma peça na venda.');
  END IF;

  ---------------------------------------------------------------
  -- 1.4 PASSO 1 — validar tudo (nada é deduzido ainda)
  --      As linhas ficam travadas (FOR UPDATE) até o fim da
  --      transação, em ordem determinística por id (anti-deadlock).
  ---------------------------------------------------------------
  FOR r IN
    SELECT x.variacao_id, SUM(x.qty)::INTEGER AS qty
    FROM (
      SELECT (i->>'variacao_id')::UUID AS variacao_id,
             GREATEST(1, LEAST(50, COALESCE(NULLIF(i->>'qty','')::INTEGER, 1))) AS qty
      FROM   jsonb_array_elements(p_itens) i
      WHERE  NULLIF(i->>'variacao_id', '') IS NOT NULL
    ) x
    GROUP BY x.variacao_id
    ORDER BY x.variacao_id
  LOOP
    SELECT v.id,
           v.produto_id,
           v.tamanho,
           v.cor_nome,
           v.cor_hex,
           v.estoque,
           v.ativo                                        AS var_ativo,
           p.nome,
           p.ativo                                        AS prod_ativo,
           ROUND(COALESCE(p.preco_desconto, p.preco_original), 2) AS preco
    INTO   d
    FROM   variacoes v
    JOIN   produtos  p ON p.id = v.produto_id
    WHERE  v.id = r.variacao_id
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'Peça não encontrada no estoque.');
    END IF;

    IF NOT d.var_ativo OR NOT d.prod_ativo THEN
      RETURN jsonb_build_object(
        'sucesso', false,
        'erro', format('%s (%s / %s) está inativa e não pode ser vendida.',
                       d.nome, d.tamanho, d.cor_nome));
    END IF;

    IF d.preco IS NULL OR d.preco <= 0 THEN
      RETURN jsonb_build_object(
        'sucesso', false,
        'erro', format('%s está sem preço cadastrado.', d.nome));
    END IF;

    IF d.estoque < r.qty THEN
      RETURN jsonb_build_object(
        'sucesso', false,
        'erro', format('Estoque insuficiente: %s %s / %s — restam %s, pedidas %s.',
                       d.nome, d.tamanho, d.cor_nome, d.estoque, r.qty),
        'variacao_id', d.id,
        'disponivel',  d.estoque);
    END IF;

    v_preco    := d.preco;
    v_sub_item := ROUND(v_preco * r.qty, 2);
    v_subtotal := v_subtotal + v_sub_item;
    v_pecas    := v_pecas + r.qty;

    -- Snapshot imutável do item. As chaves produto_id / tamanho /
    -- cor_nome / qty são exatamente as que restaurar_estoque_pedido()
    -- procura ao repor o estoque num cancelamento.
    v_itens := v_itens || jsonb_build_object(
      'produto_id',  d.produto_id,
      'id',          d.produto_id,
      'variacao_id', d.id,
      'nome',        d.nome,
      'tamanho',     d.tamanho,
      'cor_nome',    d.cor_nome,
      'cor_hex',     d.cor_hex,
      'preco',       v_preco,
      'qty',         r.qty,
      'subtotal',    v_sub_item
    );
  END LOOP;

  IF jsonb_array_length(v_itens) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Nenhuma peça válida na venda.');
  END IF;

  ---------------------------------------------------------------
  -- 1.5 Totais (aritmética exata em NUMERIC, arredondada a 2 casas)
  ---------------------------------------------------------------
  v_subtotal := ROUND(v_subtotal, 2);
  v_desconto := ROUND(GREATEST(0, LEAST(COALESCE(p_desconto, 0), v_subtotal)), 2);
  v_total    := ROUND(v_subtotal - v_desconto, 2);

  IF v_total <= 0 THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'O total da venda precisa ser maior que zero.');
  END IF;

  ---------------------------------------------------------------
  -- 1.6 PASSO 2 — baixa no estoque (só agora, tudo validado)
  ---------------------------------------------------------------
  FOR b IN SELECT * FROM jsonb_array_elements(v_itens)
  LOOP
    UPDATE variacoes
    SET    estoque = estoque - (b->>'qty')::INTEGER
    WHERE  id = (b->>'variacao_id')::UUID;
  END LOOP;

  ---------------------------------------------------------------
  -- 1.7 Pedido (status 'pago' → trg_pedido_pago_fluxo lança no caixa)
  ---------------------------------------------------------------
  INSERT INTO pedidos (
    cliente_nome, nome_cliente,
    cliente_email, email_cliente,
    cliente_telefone, telefone,
    itens, subtotal, desconto, frete, total,
    status, payment_method, payment_status, parcelas,
    external_reference, observacao, observacao_interna,
    estoque_baixado, estoque_restaurado
  )
  VALUES (
    COALESCE(NULLIF(trim(p_cliente_nome), ''), 'Cliente Garimpo'),
    COALESCE(NULLIF(trim(p_cliente_nome), ''), 'Cliente Garimpo'),
    'garimpo@wearvirtu.com',
    'garimpo@wearvirtu.com',
    NULLIF(trim(p_cliente_telefone), ''),
    NULLIF(trim(p_cliente_telefone), ''),
    v_itens, v_subtotal, v_desconto, 0, v_total,
    'pago', v_metodo, 'confirmado', v_parcelas,
    'garimpo-pdv',
    NULLIF(trim(p_observacao), ''),
    format('Venda presencial — Garimpo Virtù (%s)', v_rotulo),
    TRUE, FALSE
  )
  RETURNING * INTO v_pedido;

  ---------------------------------------------------------------
  -- 1.8 Ajusta o rótulo do lançamento criado pelo trigger
  ---------------------------------------------------------------
  UPDATE fluxo_caixa
  SET    categoria = 'Venda Garimpo',
         descricao = format('Venda presencial %s — %s',
                            COALESCE(v_pedido.codigo, ''), v_rotulo)
  WHERE  pedido_id = v_pedido.id;

  RETURN jsonb_build_object(
    'sucesso',       true,
    'pedido_id',     v_pedido.id,
    'codigo',        v_pedido.codigo,
    'numero_pedido', v_pedido.numero_pedido,
    'subtotal',      v_subtotal,
    'desconto',      v_desconto,
    'total',         v_total,
    'pecas',         v_pecas,
    'pagamento',     v_pag,
    'pagamento_rotulo', v_rotulo,
    'parcelas',      v_parcelas,
    'itens',         v_itens,
    'criado_em',     v_pedido.criado_em
  );

EXCEPTION
  WHEN check_violation THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'A venda deixaria o estoque negativo. Recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT)
IS 'PDV do Garimpo: registra venda presencial de forma atômica — valida, dá baixa no estoque das variações e grava o pedido pago. Preço, nome, tamanho e cor vêm sempre do banco.';

-- ────────────────────────────────────────────────────────────
-- 2. Cancelar venda presencial (desfaz venda registrada por engano)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancelar_venda_presencial(p_pedido_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido pedidos%ROWTYPE;
BEGIN
  IF NOT is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;

  SELECT * INTO v_pedido
  FROM   pedidos
  WHERE  id = p_pedido_id
    AND  external_reference = 'garimpo-pdv'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Venda do PDV não encontrada.');
  END IF;

  IF v_pedido.status = 'cancelado' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Esta venda já foi cancelada.');
  END IF;

  -- O trigger trg_pedido_cancelado_restaura devolve o estoque
  -- (só quando estoque_baixado = true e estoque_restaurado = false).
  UPDATE pedidos SET status = 'cancelado' WHERE id = p_pedido_id;

  -- A venda não aconteceu: remove a entrada do fluxo de caixa.
  DELETE FROM fluxo_caixa WHERE pedido_id = p_pedido_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'pedido_id', p_pedido_id,
    'codigo', v_pedido.codigo,
    'total_estornado', v_pedido.total);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION cancelar_venda_presencial(UUID)
IS 'PDV do Garimpo: cancela uma venda presencial, devolve o estoque e remove o lançamento do fluxo de caixa.';

-- ────────────────────────────────────────────────────────────
-- 3. Permissões — nunca anon
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cancelar_venda_presencial(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancelar_venda_presencial(UUID) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Índice para a listagem de vendas do PDV
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_garimpo_pdv
  ON pedidos (criado_em DESC)
  WHERE external_reference = 'garimpo-pdv';
