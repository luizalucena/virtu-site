-- =====================================================================
-- MIGRATION: Segurança — travar RPCs SECURITY DEFINER expostas a anon
-- 2026-06-29
-- =====================================================================
-- Problema (confirmado no banco real): dezenas de funções SECURITY DEFINER
-- tinham EXECUTE para `anon` (a chave pública do site), driblando o RLS.
-- As perigosas:
--
--  LEITURA (vazamento):
--   • carrinhos_para_followup()       → SELECT * carrinhos_abandonados (PII!)
--   • relatorio_bazar_consignataria() → financeiro das consignatárias
--
--  ESCRITA (manipulação por anônimo — CRÍTICO):
--   • ajustar_estoque / definir_estoque / atualizar_variacao /
--     criar_variacao / toggle_ativo_variacao → anon altera o inventário
--   • comprar_variacao  → anon decrementa estoque (código morto no checkout)
--   • registrar_compra_fidelidade → anon gera prêmio R$150 sem comprar
--   • usar_cupom / fn_expirar_premios → anon mexe em cupons/prêmios
--
-- Estratégia:
--   • Funções de BACKEND (só Edge Functions): REVOKE de anon/authenticated,
--     GRANT só a service_role. (Triggers não dependem de EXECUTE.)
--   • Funções usadas pelo ADMIN logado (stock-admin.js, bazar.js):
--     adiciona guarda is_virtu_admin() interna e revoga anon.
--
-- Idempotente. Não apaga dados. Preserva exatamente a lógica original.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. BACKEND ONLY (service_role) — revoga anon/authenticated
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.registrar_compra_fidelidade(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.registrar_compra_fidelidade(uuid, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.carrinhos_para_followup() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.carrinhos_para_followup() TO service_role;

REVOKE ALL ON FUNCTION public.usar_cupom(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.usar_cupom(text) TO service_role;

REVOKE ALL ON FUNCTION public.comprar_variacao(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comprar_variacao(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.fn_expirar_premios() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_expirar_premios() TO service_role;

-- fidelidade_status: consulta de fidelidade — não usada por anon; mantém
-- authenticated (cliente logado vê a própria) e service_role.
REVOKE ALL ON FUNCTION public.fidelidade_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fidelidade_status(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. ADMIN ONLY — guarda is_virtu_admin() interna + revoga anon
--    (admin/stock-admin.js e admin/bazar.js rodam como admin autenticado)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ajustar_estoque(p_variacao_id uuid, p_delta integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_novo_estoque INTEGER;
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;

  UPDATE variacoes SET estoque = estoque + p_delta
  WHERE id = p_variacao_id
  RETURNING estoque INTO v_novo_estoque;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'novo_estoque', v_novo_estoque, 'variacao_id', p_variacao_id);
EXCEPTION WHEN check_violation THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', 'Operação resultaria em estoque negativo.');
END;
$$;

CREATE OR REPLACE FUNCTION public.definir_estoque(p_variacao_id uuid, p_novo_estoque integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;
  IF p_novo_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  UPDATE variacoes SET estoque = p_novo_estoque WHERE id = p_variacao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'novo_estoque', p_novo_estoque, 'variacao_id', p_variacao_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_ativo_variacao(p_variacao_id uuid, p_ativo boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;

  UPDATE variacoes SET ativo = p_ativo WHERE id = p_variacao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'variacao_id', p_variacao_id, 'ativo', p_ativo);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_variacao(p_produto_id text, p_tamanho text, p_cor_nome text, p_cor_hex text DEFAULT '#000000'::text, p_estoque integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;
  IF p_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  INSERT INTO variacoes (produto_id, tamanho, cor_nome, cor_hex, estoque)
  VALUES (p_produto_id, trim(p_tamanho), trim(p_cor_nome), trim(p_cor_hex), p_estoque);

  RETURN jsonb_build_object('sucesso', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Já existe uma variação com este tamanho e cor.', 'code', '23505');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_variacao(p_variacao_id uuid, p_tamanho text, p_cor_nome text, p_cor_hex text, p_estoque integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Não autorizado.');
  END IF;
  IF p_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  UPDATE variacoes
  SET tamanho = trim(p_tamanho), cor_nome = trim(p_cor_nome),
      cor_hex = trim(p_cor_hex), estoque = p_estoque
  WHERE id = p_variacao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'variacao_id', p_variacao_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

-- Revoga anon das 5 funções de estoque (CREATE OR REPLACE preserva grants).
-- Mantém authenticated (admin usa via stock-admin.js) + service_role.
-- A guarda is_virtu_admin() interna já bloqueia qualquer não-admin.
REVOKE ALL ON FUNCTION public.ajustar_estoque(uuid, integer)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.definir_estoque(uuid, integer)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_ativo_variacao(uuid, boolean)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.criar_variacao(text, text, text, text, integer)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atualizar_variacao(uuid, text, text, text, integer)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajustar_estoque(uuid, integer)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.definir_estoque(uuid, integer)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.toggle_ativo_variacao(uuid, boolean)                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.criar_variacao(text, text, text, text, integer)     TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.atualizar_variacao(uuid, text, text, text, integer) TO authenticated, service_role;

-- Relatório financeiro das consignatárias — admin only
CREATE OR REPLACE FUNCTION public.relatorio_bazar_consignataria(p_iniciais text)
RETURNS TABLE(
  consignataria text, total_pecas bigint, pecas_vendidas bigint,
  pecas_disponiveis bigint, total_vendas numeric, a_pagar numeric, comissao_virtu numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_virtu_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      MAX(bp.consignataria),
      COUNT(*),
      COUNT(*) FILTER (WHERE bp.status = 'vendido'),
      COUNT(*) FILTER (WHERE bp.status = 'disponivel'),
      COALESCE(SUM(bp.preco_venda)         FILTER (WHERE bp.status = 'vendido'), 0),
      COALESCE(SUM(bp.valor_consignataria) FILTER (WHERE bp.status = 'vendido'), 0),
      COALESCE(SUM(bp.valor_virtu)         FILTER (WHERE bp.status = 'vendido'), 0)
    FROM bazar_pecas bp
    WHERE UPPER(bp.iniciais) = UPPER(p_iniciais);
END;
$$;
REVOKE ALL ON FUNCTION public.relatorio_bazar_consignataria(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.relatorio_bazar_consignataria(text) TO authenticated, service_role;

-- gerar_sku_bazar: usado no admin/bazar.js — revoga anon, mantém admin
REVOKE ALL ON FUNCTION public.gerar_sku_bazar(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gerar_sku_bazar(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Fixa search_path nas funções SECURITY DEFINER que ainda não tinham
--    (advisor function_search_path_mutable). As de estoque já tinham.
-- ─────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.carrinhos_para_followup()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_criar_perfil_usuario()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_expirar_premios()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_marcar_premio_usado()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_notificar_status_pedido()               SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_registrar_uso_cupom_cliente()           SET search_path = public, pg_temp;
ALTER FUNCTION public.registrar_compra_fidelidade(uuid, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.usar_cupom(text)                           SET search_path = public, pg_temp;
ALTER FUNCTION public.validar_cupom(text, text)                  SET search_path = public, pg_temp;

SELECT 'RPCs sensíveis travadas para anon + guardas admin + search_path ✓' AS resultado;
