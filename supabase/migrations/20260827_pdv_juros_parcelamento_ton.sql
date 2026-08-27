-- =============================================================
-- MIGRATION: PDV Garimpo — repasse dos juros do parcelamento (Ton)
--
-- PROBLEMA: no crédito parcelado, a maquininha (Ton Mega+) cobra uma
-- taxa bem maior que a do crédito à vista. Até agora o PDV cobrava o
-- preço de tabela em qualquer nº de parcelas, então o excedente do
-- parcelamento saía do bolso da loja.
--
-- REGRA (decidida em 18/08/2026): o preço de tabela JÁ É o preço do
-- cartão à vista (embute ~3,86% da Ton). Crédito à vista, débito, PIX
-- e dinheiro seguem EXATAMENTE como estão. Só o parcelado de 2x em
-- diante encarece, repassando APENAS o excedente — o líquido do
-- parcelado iguala o líquido que a loja já receberia no crédito à vista:
--
--     cobrado(n) = base × (1 − taxa_avista) ÷ (1 − taxa_n)   →  ,90
--
-- É DIVISÃO, não multiplicação. base × (1 + taxa) dá errado.
--
-- TAXAS CONFIGURÁVEIS: a Ton muda de faixa conforme o faturamento
-- mensal. As taxas vivem em configuracoes.taxas_cartao_ton (JSONB,
-- editável pelo painel). A RPC (autoridade) e o pdv.js (prévia) leem
-- dali; se faltar/quebrar, ambos caem no fallback embutido abaixo,
-- que reflete a faixa "Ton Mega+ até R$ 3 mil" vigente hoje.
--
-- Ordem: subtotal → desconto manual → base → juros/ajuste → ,90
-- O arredondamento ,90 só entra quando há juros ou ajuste; sem eles
-- (1x, débito) o total é exatamente a base.
--
-- Os três lugares que definem preço andam juntos:
--   supabase/functions/processar-pagamento/index.ts  (site)
--   js/checkout.js                                   (site)
--   admin/pdv.js + esta função                       (PDV)
-- (O site não parcela com juros; esta regra é só do PDV.)
-- =============================================================

-- Faixa de taxas vigente — fonte única do fallback, usada tanto no
-- seed da coluna quanto na RPC. Atualize AQUI só se a faixa-padrão
-- mudar; o dia a dia é editado em configuracoes.taxas_cartao_ton.
CREATE OR REPLACE FUNCTION taxas_cartao_ton_default()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'avista', 0.0386,
    'parcelado', jsonb_build_object(
      '2', 0.0986,
      '3', 0.1124,
      '4', 0.1259,
      '5', 0.1392,
      '6', 0.1522
    )
  );
$$;

COMMENT ON FUNCTION taxas_cartao_ton_default()
IS 'Fallback das taxas da maquininha (Ton Mega+, faixa até R$3 mil). Espelha TAXAS_TON_FALLBACK do pdv.js. O valor operacional fica em configuracoes.taxas_cartao_ton.';

-- Coluna configurável no painel (só admin escreve; leitura já é
-- pública via config_publica_select). Semeada com a faixa atual.
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS taxas_cartao_ton JSONB;

UPDATE configuracoes
   SET taxas_cartao_ton = taxas_cartao_ton_default()
 WHERE id = 1
   AND taxas_cartao_ton IS NULL;

COMMENT ON COLUMN configuracoes.taxas_cartao_ton
IS 'Taxas da maquininha para o PDV: {avista, parcelado:{"2".."6"}} em fração (0.0986 = 9,86%). Editável pelo painel quando a faixa da Ton mudar.';

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
  v_taxas      JSONB;
  v_taxa_avista NUMERIC(6,4);
  v_taxa_n     NUMERIC(6,4);
  v_juros      NUMERIC(10,2) := 0;
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

  -- Ajuste por método — espelha AJUSTE_METODO do site e do pdv.js.
  -- (Só desconto à vista de PIX/dinheiro; crédito/débito = tabela.)
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

  -- Totais: subtotal → desconto manual → base → juros/ajuste → ,90
  v_subtotal := ROUND(v_subtotal, 2);
  v_desconto := ROUND(GREATEST(0, LEAST(COALESCE(p_desconto, 0), v_subtotal)), 2);
  v_base     := ROUND(v_subtotal - v_desconto, 2);

  IF v_base <= 0 THEN
    RETURN jsonb_build_object('sucesso', false,
      'erro', 'O total da venda precisa ser maior que zero.');
  END IF;

  -- Taxas da maquininha: config do painel, com fallback embutido.
  SELECT COALESCE(c.taxas_cartao_ton, taxas_cartao_ton_default())
    INTO v_taxas
    FROM configuracoes c
   WHERE c.id = 1;
  IF v_taxas IS NULL THEN
    v_taxas := taxas_cartao_ton_default();
  END IF;

  -- Total. Três caminhos, nesta prioridade:
  --   crédito 2x+  → repassa o excedente do parcelamento (divisão)
  --   PIX/dinheiro → desconto à vista de 3% (ajuste ≠ 0)
  --   1x / débito  → base exata (nada de arredondar e inventar centavos)
  IF v_pag = 'credito' AND v_parcelas >= 2 THEN
    v_taxa_avista := COALESCE((v_taxas->>'avista')::NUMERIC, 0.0386);
    v_taxa_n      := (v_taxas->'parcelado'->>v_parcelas::TEXT)::NUMERIC;
    IF v_taxa_n IS NULL OR v_taxa_n >= 1 THEN
      RETURN jsonb_build_object('sucesso', false,
        'erro', format('Taxa de parcelamento não configurada para %sx.', v_parcelas));
    END IF;
    v_total := arredondar_90(v_base * (1 - v_taxa_avista) / (1 - v_taxa_n));
    v_juros := ROUND(v_total - v_base, 2);
  ELSIF v_ajuste <> 0 THEN
    v_total := arredondar_90(v_base * (1 + v_ajuste));
  ELSE
    v_total := v_base;
  END IF;

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

  -- O desconto gravado no pedido dobra como ajuste do método: para
  -- PIX/dinheiro é positivo (desconto à vista); para crédito parcelado
  -- fica negativo (o excedente dos juros). Assim subtotal − desconto =
  -- total continua verdadeiro no admin e no financeiro.
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
    'juros',            v_juros,
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
IS 'PDV do Garimpo: registra venda presencial de forma atômica — valida, dá baixa no estoque e grava o pedido pago. Preço/nome/tamanho/cor vêm do banco. PIX/dinheiro têm 3% à vista; crédito parcelado (2x+) repassa só o excedente da taxa da Ton (configuracoes.taxas_cartao_ton).';

REVOKE ALL ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_venda_presencial(JSONB, TEXT, NUMERIC, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION taxas_cartao_ton_default() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION taxas_cartao_ton_default() TO authenticated, service_role;
