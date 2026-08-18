-- =============================================================
-- MIGRATION: PDV Garimpo — ajuste por método de pagamento
--
-- Aplicada em produção em duas etapas (20260818142133 e
-- 20260818142805). Este arquivo consolida o estado final.
--
-- PROBLEMA: o PDV cobrava o preço de tabela em qualquer método,
-- enquanto o site dá 3% de desconto no PIX. A cliente do Garimpo
-- perdia o desconto que teria comprando online.
--
-- REGRA (espelha AJUSTE_METODO em processar-pagamento e pdv.js):
--   PIX e dinheiro → 3% de desconto à vista (custo quase zero)
--   crédito/débito → preço de tabela (taxa do cartão já embutida)
--
-- Ordem: subtotal → desconto manual → base → ajuste → ,90
--
-- O arredondamento ,90 só entra quando HÁ ajuste. Sem ajuste o
-- total é exatamente a base — arredondar inventaria centavos
-- (2x R$189,90 = R$379,80 viraria R$379,90) e faria a tela do
-- PDV divergir do valor cobrado.
--
-- Os três lugares que definem preço precisam andar juntos:
--   supabase/functions/processar-pagamento/index.ts  (site)
--   js/checkout.js                                   (site)
--   admin/pdv.js + esta função                       (PDV)
-- =============================================================

-- Arredondamento estético ,90 (espelha arredondar90() do frontend)
CREATE OR REPLACE FUNCTION arredondar_90(p_valor NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ROUND(FLOOR(p_valor - 0.90 + 0.5 + 1e-9) + 0.90, 2);
$$;

COMMENT ON FUNCTION arredondar_90(NUMERIC)
IS 'Leva o valor ao múltiplo terminado em ,90 mais próximo (empate para cima). Espelha arredondar90() do frontend.';

REVOKE ALL ON FUNCTION arredondar_90(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION arredondar_90(NUMERIC) TO authenticated, service_role;

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
  v_ajuste     NUMERIC(6,4);
  v_desconto   NUMERIC(10,2);
  v_subtotal   NUMERIC(10,2) := 0;
  v_base       NUMERIC(10,2);
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
  IF NOT is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;

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

  -- Ajuste por método — espelha AJUSTE_METODO do site e do pdv.js
  v_ajuste := CASE v_pag
                WHEN 'pix'      THEN -0.03
                WHEN 'dinheiro' THEN -0.03
                ELSE 0
              END;

  v_parcelas := CASE
                  WHEN v_pag = 'credito'
                  THEN GREATEST(1, LEAST(6, COALESCE(p_parcelas, 1)))::SMALLINT
                  ELSE NULL
                END;

  IF p_itens IS NULL
     OR jsonb_typeof(p_itens) <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Nenhuma peça na venda.');
  END IF;

  -- PASSO 1 — validar tudo (nada é deduzido ainda). As linhas ficam
  -- travadas até o fim da transação, em ordem determinística por id.
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
    SELECT v.id, v.produto_id, v.tamanho, v.cor_nome, v.cor_hex, v.estoque,
           v.ativo AS var_ativo, p.nome, p.ativo AS prod_ativo,
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
      RETURN jsonb_build_object('sucesso', false,
        'erro', format('%s (%s / %s) está inativa e não pode ser vendida.', d.nome, d.tamanho, d.cor_nome));
    END IF;

    IF d.preco IS NULL OR d.preco <= 0 THEN
      RETURN jsonb_build_object('sucesso', false,
        'erro', format('%s está sem preço cadastrado.', d.nome));
    END IF;

    IF d.estoque < r.qty THEN
      RETURN jsonb_build_object('sucesso', false,
        'erro', format('Estoque insuficiente: %s %s / %s — restam %s, pedidas %s.',
                       d.nome, d.tamanho, d.cor_nome, d.estoque, r.qty),
        'variacao_id', d.id, 'disponivel', d.estoque);
    END IF;

    v_preco    := d.preco;
    v_sub_item := ROUND(v_preco * r.qty, 2);
    v_subtotal := v_subtotal + v_sub_item;
    v_pecas    := v_pecas + r.qty;

    -- Snapshot imutável. As chaves produto_id / tamanho / cor_nome / qty
    -- são as que restaurar_estoque_pedido() procura num cancelamento.
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

  -- Totais: subtotal → desconto manual → base → ajuste do método → ,90
  v_subtotal := ROUND(v_subtotal, 2);
  v_desconto := ROUND(GREATEST(0, LEAST(COALESCE(p_desconto, 0), v_subtotal)), 2);
  v_base     := ROUND(v_subtotal - v_desconto, 2);

  IF v_base <= 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'O total da venda precisa ser maior que zero.');
  END IF;

  -- Sem ajuste (crédito/débito) o total é exatamente a base — nada de
  -- arredondar e criar centavos que a cliente não entende no balcão.
  v_total := CASE
               WHEN v_ajuste = 0 THEN v_base
               ELSE arredondar_90(v_base * (1 + v_ajuste))
             END;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'O total da venda precisa ser maior que zero.');
  END IF;

  -- PASSO 2 — baixa no estoque (só agora, tudo validado)
  FOR b IN SELECT * FROM jsonb_array_elements(v_itens)
  LOOP
    UPDATE variacoes
    SET    estoque = estoque - (b->>'qty')::INTEGER
    WHERE  id = (b->>'variacao_id')::UUID;
  END LOOP;

  -- O desconto gravado no pedido inclui o ajuste do método, para que
  -- subtotal − desconto = total continue verdadeiro no admin.
  INSERT INTO pedidos (
    cliente_nome, nome_cliente, cliente_email, email_cliente,
    cliente_telefone, telefone,
    itens, subtotal, desconto, frete, total,
    status, payment_method, payment_status, parcelas,
    external_reference, observacao, observacao_interna,
    estoque_baixado, estoque_restaurado
  )
  VALUES (
    COALESCE(NULLIF(trim(p_cliente_nome), ''), 'Cliente Garimpo'),
    COALESCE(NULLIF(trim(p_cliente_nome), ''), 'Cliente Garimpo'),
    'garimpo@wearvirtu.com', 'garimpo@wearvirtu.com',
    NULLIF(trim(p_cliente_telefone), ''), NULLIF(trim(p_cliente_telefone), ''),
    v_itens, v_subtotal, ROUND(v_subtotal - v_total, 2), 0, v_total,
    'pago', v_metodo, 'confirmado', v_parcelas,
    'garimpo-pdv',
    NULLIF(trim(p_observacao), ''),
    format('Venda presencial — Garimpo Virtù (%s)', v_rotulo),
    TRUE, FALSE
  )
  RETURNING * INTO v_pedido;

  UPDATE fluxo_caixa
  SET    categoria = 'Venda Garimpo',
         descricao = format('Venda presencial %s — %s', COALESCE(v_pedido.codigo, ''), v_rotulo)
  WHERE  pedido_id = v_pedido.id;

  RETURN jsonb_build_object(
    'sucesso',          true,
    'pedido_id',        v_pedido.id,
    'codigo',           v_pedido.codigo,
    'numero_pedido',    v_pedido.numero_pedido,
    'subtotal',         v_subtotal,
    'desconto',         v_desconto,
    'ajuste_metodo',    ROUND(v_base - v_total, 2),
    'total',            v_total,
    'pecas',            v_pecas,
    'pagamento',        v_pag,
    'pagamento_rotulo', v_rotulo,
    'parcelas',         v_parcelas,
    'itens',            v_itens,
    'criado_em',        v_pedido.criado_em
  );

EXCEPTION
  WHEN check_violation THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'A venda deixaria o estoque negativo. Recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT)
IS 'PDV do Garimpo: registra venda presencial de forma atômica — valida, dá baixa no estoque e grava o pedido pago. Preço, nome, tamanho e cor vêm sempre do banco. PIX/dinheiro têm 3% de desconto à vista.';

REVOKE ALL ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;
