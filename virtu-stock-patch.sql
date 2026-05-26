-- ============================================================
--  VIRTÙ — Stock Admin Patch  (execute após virtu-stock.sql)
--  Adiciona 3 funções RPC com SECURITY DEFINER que permitem ao
--  painel admin criar, editar e desativar variações sem
--  necessitar de sessão autenticada no Supabase.
--
--  Por que SECURITY DEFINER?
--    O cliente do site/admin usa a chave "anon". O RLS exige
--    auth.role() = 'authenticated' para escritas diretas.
--    As funções SECURITY DEFINER correm com permissões de
--    quem as criou (o owner do projeto), contornando o RLS
--    de forma controlada — toda a lógica de validação fica
--    dentro da função.
--
--  Execute uma única vez no SQL Editor do Supabase.
-- ============================================================


-- ── 1. CRIAR VARIAÇÃO ────────────────────────────────────────
CREATE OR REPLACE FUNCTION criar_variacao(
  p_produto_id TEXT,
  p_tamanho    TEXT,
  p_cor_nome   TEXT,
  p_cor_hex    TEXT    DEFAULT '#000000',
  p_estoque    INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  INSERT INTO variacoes (produto_id, tamanho, cor_nome, cor_hex, estoque)
  VALUES (p_produto_id, trim(p_tamanho), trim(p_cor_nome), trim(p_cor_hex), p_estoque);

  RETURN jsonb_build_object('sucesso', true);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro',    'Já existe uma variação com este tamanho e cor.',
      'code',    '23505'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION criar_variacao IS
  'Cria uma nova variação de produto (tamanho + cor + stock). SECURITY DEFINER: não exige sessão autenticada.';


-- ── 2. ATUALIZAR VARIAÇÃO ────────────────────────────────────
CREATE OR REPLACE FUNCTION atualizar_variacao(
  p_variacao_id UUID,
  p_tamanho     TEXT,
  p_cor_nome    TEXT,
  p_cor_hex     TEXT,
  p_estoque     INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  UPDATE variacoes
  SET
    tamanho  = trim(p_tamanho),
    cor_nome = trim(p_cor_nome),
    cor_hex  = trim(p_cor_hex),
    estoque  = p_estoque
  WHERE id = p_variacao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'variacao_id', p_variacao_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION atualizar_variacao IS
  'Atualiza tamanho, cor e stock de uma variação existente. SECURITY DEFINER: não exige sessão autenticada.';


-- ── 3. TOGGLE ATIVO / INATIVO ────────────────────────────────
CREATE OR REPLACE FUNCTION toggle_ativo_variacao(
  p_variacao_id UUID,
  p_ativo       BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE variacoes
  SET ativo = p_ativo
  WHERE id = p_variacao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso',      true,
    'variacao_id',  p_variacao_id,
    'ativo',        p_ativo
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM);
END;
$$;

COMMENT ON FUNCTION toggle_ativo_variacao IS
  'Ativa ou desativa uma variação sem a apagar. SECURITY DEFINER: não exige sessão autenticada.';


-- ── VERIFICAÇÃO ──────────────────────────────────────────────
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('criar_variacao', 'atualizar_variacao', 'toggle_ativo_variacao')
ORDER BY routine_name;
