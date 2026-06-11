-- =============================================================
-- MIGRATION: Segurança — RLS na tabela pedidos + índice external_reference
-- 2026-06-11
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Row Level Security na tabela pedidos
--
--    Política:
--      - Clientes autenticados veem apenas seus próprios pedidos
--        (compara email do JWT com cliente_email OU email_cliente)
--      - Qualquer usuário (inclusive anon) pode INSERIR um pedido
--        (checkout funciona sem login)
--      - UPDATE/DELETE apenas via service_role (Edge Functions)
--        → nenhuma política de UPDATE/DELETE para usuários normais
--          significa que auth users e anon não podem alterar pedidos
--
--    Nota: o service_role key usado nas Edge Functions bypassa o RLS
--    automaticamente — não é necessário nenhuma policy para ele.
-- ────────────────────────────────────────────────────────────

ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

-- Clientes veem apenas seus próprios pedidos
-- Suporta tanto o campo novo (cliente_email) quanto o legado (email_cliente)
CREATE POLICY "clientes_veem_proprios_pedidos"
  ON pedidos
  FOR SELECT
  USING (
    (auth.jwt() ->> 'email') IS NOT NULL
    AND (
      (auth.jwt() ->> 'email') = cliente_email
      OR (auth.jwt() ->> 'email') = email_cliente
    )
  );

-- Qualquer usuário (incluindo anônimo) pode criar pedido
-- (checkout não exige login)
CREATE POLICY "qualquer_um_pode_criar_pedido"
  ON pedidos
  FOR INSERT
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 2. RLS na tabela carrinhos_abandonados
--    (só admin/service_role deve ler/escrever — não expõe ao cliente)
-- ────────────────────────────────────────────────────────────

ALTER TABLE carrinhos_abandonados ENABLE ROW LEVEL SECURITY;

-- Apenas service_role acessa (Edge Functions de recuperação de carrinho)
-- Sem políticas de SELECT/UPDATE para usuários normais = bloqueio total para auth users e anon.
-- (O service_role bypassa o RLS automaticamente.)

-- ────────────────────────────────────────────────────────────
-- 3. Índice de external_reference no Mercado Pago
--    Salvo como UUID no pedido — permite reconciliação futura
-- ────────────────────────────────────────────────────────────

-- Garante que external_reference existe na tabela (adiciona se ausente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos' AND column_name = 'external_reference'
  ) THEN
    ALTER TABLE pedidos ADD COLUMN external_reference TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pedidos_external_reference
  ON pedidos (external_reference)
  WHERE external_reference IS NOT NULL;
