-- ============================================================
--  VIRTÙ — Sistema de Controlo de Stock Inteligente
--  Execute este arquivo completo no SQL Editor do Supabase
--  Ordem: rodar uma única vez, de cima para baixo.
-- ============================================================


-- ============================================================
-- SECÇÃO 1 — TABELA DE VARIAÇÕES (fonte da verdade do stock)
-- ============================================================
-- Cada linha representa uma combinação única de produto + tamanho + cor.
-- É aqui que o stock vive. Um produto com 3 tamanhos e 2 cores
-- terá até 6 linhas nesta tabela.

CREATE TABLE IF NOT EXISTS variacoes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id    TEXT        NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tamanho       TEXT        NOT NULL,          -- 'PP' | 'P' | 'M' | 'G' | 'GG' | 'U'
  cor_nome      TEXT        NOT NULL,          -- 'Preto', 'Bege', 'Branco'…
  cor_hex       TEXT        NOT NULL DEFAULT '#000000',
  estoque       INTEGER     NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Garante que não existem duas linhas com o mesmo produto + tamanho + cor
  UNIQUE (produto_id, tamanho, cor_nome)
);

-- Comentários descritivos
COMMENT ON TABLE  variacoes            IS 'Variações de produto com controlo de stock por tamanho e cor.';
COMMENT ON COLUMN variacoes.estoque    IS 'Unidades disponíveis para venda. Nunca negativo (CHECK constraint).';
COMMENT ON COLUMN variacoes.ativo      IS 'false = variação oculta no site sem apagar o registo.';

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS idx_variacoes_produto_id  ON variacoes (produto_id);
CREATE INDEX IF NOT EXISTS idx_variacoes_estoque      ON variacoes (produto_id, estoque);


-- ============================================================
-- SECÇÃO 2 — TRIGGER: atualiza atualizado_em automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variacoes_atualizado_em ON variacoes;
CREATE TRIGGER trg_variacoes_atualizado_em
  BEFORE UPDATE ON variacoes
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();


-- ============================================================
-- SECÇÃO 3 — ROW LEVEL SECURITY (RLS)
-- ============================================================
-- Regra: qualquer pessoa pode LER o stock (site público).
-- Apenas o admin autenticado pode ESCREVER.
-- As funções RPC usam SECURITY DEFINER e contornam o RLS
-- de forma controlada para operações atómicas.

ALTER TABLE variacoes ENABLE ROW LEVEL SECURITY;

-- Leitura pública (site, qualquer utilizador)
DROP POLICY IF EXISTS "variacoes_leitura_publica" ON variacoes;
CREATE POLICY "variacoes_leitura_publica" ON variacoes
  FOR SELECT USING (true);

-- Escrita restrita ao admin autenticado
DROP POLICY IF EXISTS "variacoes_escrita_admin" ON variacoes;
CREATE POLICY "variacoes_escrita_admin" ON variacoes
  FOR ALL USING (auth.role() = 'authenticated');


-- ============================================================
-- SECÇÃO 4 — TABELA DE PEDIDOS
-- ============================================================

CREATE TABLE IF NOT EXISTS pedidos (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome    TEXT        NOT NULL,
  cliente_email   TEXT        NOT NULL,
  cliente_telefone TEXT,
  itens           JSONB       NOT NULL,  -- [{variacao_id, produto_nome, tamanho, cor, quantidade, preco_unit}]
  subtotal        NUMERIC(10,2) NOT NULL,
  desconto        NUMERIC(10,2) NOT NULL DEFAULT 0,
  frete           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,
  cupom           TEXT,
  status          TEXT        NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','confirmado','pago','enviado','entregue','cancelado')),
  observacao      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  pedidos       IS 'Registo de todos os pedidos efetuados no site público.';
COMMENT ON COLUMN pedidos.itens IS 'Snapshot dos itens no momento da compra (JSONB para histórico imutável).';

ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

-- Apenas o admin lê/edita pedidos
DROP POLICY IF EXISTS "pedidos_admin" ON pedidos;
CREATE POLICY "pedidos_admin" ON pedidos
  FOR ALL USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS trg_pedidos_atualizado_em ON pedidos;
CREATE TRIGGER trg_pedidos_atualizado_em
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_pedidos_status    ON pedidos (status);
CREATE INDEX IF NOT EXISTS idx_pedidos_email     ON pedidos (cliente_email);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado_em ON pedidos (criado_em DESC);


-- ============================================================
-- SECÇÃO 5 — RPC: comprar_variacao  (OPERAÇÃO ATÓMICA)
-- ============================================================
-- Esta é a função mais crítica do sistema.
-- Resolve o problema de "dois clientes a comprar o último item"
-- usando SELECT FOR UPDATE — um bloqueio de linha a nível de
-- transação que o PostgreSQL garante ser exclusivo.
--
-- Fluxo:
--   1. Bloqueia a linha da variação (nenhuma outra transação
--      pode modificá-la enquanto esta não terminar).
--   2. Verifica se o estoque é suficiente.
--   3. Decrementa atomicamente.
--   4. Devolve sucesso ou erro — nunca vende o que não existe.
--
-- SECURITY DEFINER: corre com os privilégios do criador da
-- função (admin), pelo que ignora o RLS da tabela. Seguro
-- porque toda a lógica de validação está aqui dentro.

CREATE OR REPLACE FUNCTION comprar_variacao(
  p_variacao_id UUID,
  p_quantidade  INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estoque_atual INTEGER;
  v_produto_id    TEXT;
BEGIN
  -- Validação de entrada
  IF p_quantidade <= 0 THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro',    'Quantidade deve ser maior que zero.'
    );
  END IF;

  -- ── PASSO CRÍTICO: bloqueia a linha ──────────────────────
  -- SELECT FOR UPDATE garante exclusividade transacional.
  -- Se outra transação já bloqueou esta linha, esta espera.
  -- Resultado: apenas UMA transação por vez pode decrementar.
  SELECT estoque, produto_id
  INTO   v_estoque_atual, v_produto_id
  FROM   variacoes
  WHERE  id = p_variacao_id AND ativo = true
  FOR UPDATE;
  -- ─────────────────────────────────────────────────────────

  -- A variação não existe ou está inativa
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro',    'Variação não encontrada ou inativa.'
    );
  END IF;

  -- Estoque insuficiente
  IF v_estoque_atual < p_quantidade THEN
    RETURN jsonb_build_object(
      'sucesso',             false,
      'erro',                'Estoque insuficiente.',
      'estoque_disponivel',  v_estoque_atual
    );
  END IF;

  -- Decrementa atomicamente
  UPDATE variacoes
  SET    estoque = estoque - p_quantidade
  WHERE  id = p_variacao_id;

  RETURN jsonb_build_object(
    'sucesso',          true,
    'estoque_restante', v_estoque_atual - p_quantidade,
    'variacao_id',      p_variacao_id,
    'produto_id',       v_produto_id
  );

EXCEPTION WHEN OTHERS THEN
  -- Captura qualquer erro inesperado e devolve mensagem limpa
  RETURN jsonb_build_object(
    'sucesso', false,
    'erro',    SQLERRM
  );
END;
$$;

COMMENT ON FUNCTION comprar_variacao IS
  'Decrementa o stock de uma variação de forma atómica e segura contra compras simultâneas. Usa SELECT FOR UPDATE.';


-- ============================================================
-- SECÇÃO 6 — RPC: ajustar_estoque  (USO DO ADMIN)
-- ============================================================
-- Permite ao admin adicionar ou remover unidades com delta (+/-).
-- Exemplo: ajustar_estoque(id, +10) → entrada de 10 unidades
--          ajustar_estoque(id,  -3) → correção manual de -3
-- O CHECK constraint na tabela impede que o resultado fique negativo.

CREATE OR REPLACE FUNCTION ajustar_estoque(
  p_variacao_id UUID,
  p_delta       INTEGER  -- positivo = entrada, negativo = saída
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo_estoque INTEGER;
BEGIN
  UPDATE variacoes
  SET    estoque = estoque + p_delta
  WHERE  id = p_variacao_id
  RETURNING estoque INTO v_novo_estoque;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso',       true,
    'novo_estoque',  v_novo_estoque,
    'variacao_id',   p_variacao_id
  );

EXCEPTION WHEN check_violation THEN
  -- O CHECK (estoque >= 0) foi violado
  RETURN jsonb_build_object(
    'sucesso', false,
    'erro',    'Operação resultaria em estoque negativo.'
  );
END;
$$;


-- ============================================================
-- SECÇÃO 7 — RPC: definir_estoque  (USO DO ADMIN)
-- ============================================================
-- Define o valor absoluto do estoque (para quando o admin
-- conta o stock físico e quer sincronizar).

CREATE OR REPLACE FUNCTION definir_estoque(
  p_variacao_id  UUID,
  p_novo_estoque INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_novo_estoque < 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Estoque não pode ser negativo.');
  END IF;

  UPDATE variacoes
  SET    estoque = p_novo_estoque
  WHERE  id = p_variacao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Variação não encontrada.');
  END IF;

  RETURN jsonb_build_object(
    'sucesso',      true,
    'novo_estoque', p_novo_estoque,
    'variacao_id',  p_variacao_id
  );
END;
$$;


-- ============================================================
-- SECÇÃO 8 — RPC: stock_do_produto  (LEITURA PÚBLICA)
-- ============================================================
-- Retorna todas as variações ativas de um produto com o stock
-- atual. Usada pelo site público ao carregar a página de produto.

CREATE OR REPLACE FUNCTION stock_do_produto(p_produto_id TEXT)
RETURNS TABLE (
  variacao_id   UUID,
  tamanho       TEXT,
  cor_nome      TEXT,
  cor_hex       TEXT,
  estoque       INTEGER,
  disponivel    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id            AS variacao_id,
    tamanho,
    cor_nome,
    cor_hex,
    estoque,
    (estoque > 0) AS disponivel
  FROM  variacoes
  WHERE produto_id = p_produto_id
    AND ativo      = true
  ORDER BY
    CASE tamanho
      WHEN 'PP' THEN 1
      WHEN 'P'  THEN 2
      WHEN 'M'  THEN 3
      WHEN 'G'  THEN 4
      WHEN 'GG' THEN 5
      ELSE           6
    END,
    cor_nome;
$$;


-- ============================================================
-- SECÇÃO 9 — REALTIME: habilitar para a tabela variacoes
-- ============================================================
-- O Supabase Realtime transmite mudanças via WebSocket.
-- Esta linha adiciona variacoes ao conjunto de tabelas
-- monitoradas pelo sistema de publicação do PostgreSQL.

ALTER PUBLICATION supabase_realtime ADD TABLE variacoes;


-- ============================================================
-- SECÇÃO 10 — DADOS INICIAIS DE EXEMPLO
-- ============================================================
-- Descomente e adapte para popular variações nos seus produtos.
-- Substitua os UUIDs pelos IDs reais dos produtos no Supabase.

/*
DO $$
DECLARE
  v_produto_id UUID;
BEGIN
  -- Exemplo: Vestido Marilene
  SELECT id INTO v_produto_id FROM produtos WHERE nome ILIKE '%Marilene%' LIMIT 1;

  IF v_produto_id IS NOT NULL THEN
    INSERT INTO variacoes (produto_id, tamanho, cor_nome, cor_hex, estoque) VALUES
      (v_produto_id, 'PP', 'Preto',  '#1a1a1a', 3),
      (v_produto_id, 'P',  'Preto',  '#1a1a1a', 1),  -- ← 1 unidade: cenário do Exemplo 1
      (v_produto_id, 'M',  'Preto',  '#1a1a1a', 5),
      (v_produto_id, 'G',  'Preto',  '#1a1a1a', 2),
      (v_produto_id, 'PP', 'Bege',   '#C4A882', 4),
      (v_produto_id, 'P',  'Bege',   '#C4A882', 0),  -- ← esgotado
      (v_produto_id, 'M',  'Bege',   '#C4A882', 6)
    ON CONFLICT (produto_id, tamanho, cor_nome) DO NOTHING;
  END IF;
END $$;
*/


-- ============================================================
-- VERIFICAÇÃO FINAL
-- ============================================================
-- Execute esta query para confirmar que tudo foi criado:

SELECT
  table_name,
  (SELECT count(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS colunas
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('variacoes', 'pedidos')
ORDER BY table_name;
