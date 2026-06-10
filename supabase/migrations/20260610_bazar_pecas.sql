-- =============================================================
-- MIGRATION: Módulo Bazar (consignação)
--
-- Cria:
--   • Tabela bazar_pecas com colunas GENERATED para split 60/40
--   • Função gerar_sku_bazar() com advisory lock (concurrency-safe)
--   • Função relatorio_bazar_consignataria() para prestação de contas
--   • RLS: service_role e authenticated com acesso total
--   • Realtime habilitado em bazar_pecas
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela principal
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bazar_pecas (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               TEXT        NOT NULL UNIQUE,

  -- Consignatária
  consignataria     TEXT        NOT NULL,
  iniciais          TEXT        NOT NULL,           -- ex: "MS"

  -- Descrição da peça
  descricao         TEXT        NOT NULL,
  categoria         TEXT        NOT NULL DEFAULT 'Roupa',
  tamanho           TEXT,
  cor               TEXT,
  observacao        TEXT,

  -- Financeiro
  preco_venda       NUMERIC(10,2) NOT NULL CHECK (preco_venda > 0),
  valor_consignataria NUMERIC(10,2)
    GENERATED ALWAYS AS (ROUND(preco_venda * 0.60, 2)) STORED,
  valor_virtu       NUMERIC(10,2)
    GENERATED ALWAYS AS (ROUND(preco_venda * 0.40, 2)) STORED,

  -- Status
  status            TEXT        NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'vendido', 'devolvido', 'reservado')),

  -- Auditoria
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vendido_em        TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- 2. Trigger: mantém atualizado_em sincronizado
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_bazar_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := NOW();
  IF NEW.status = 'vendido' AND OLD.status IS DISTINCT FROM 'vendido' THEN
    NEW.vendido_em := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bazar_set_atualizado_em
BEFORE UPDATE ON bazar_pecas
FOR EACH ROW
EXECUTE FUNCTION fn_bazar_set_atualizado_em();

-- ────────────────────────────────────────────────────────────
-- 3. Gerador de SKU concurrency-safe via advisory lock
--    Uso: SELECT gerar_sku_bazar('MS')  → 'MS01', 'MS02', …
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION gerar_sku_bazar(p_iniciais TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iniciais  TEXT;
  v_lock_key  BIGINT;
  v_seq       INTEGER;
  v_sku       TEXT;
BEGIN
  v_iniciais := UPPER(TRIM(p_iniciais));

  IF v_iniciais = '' OR v_iniciais IS NULL THEN
    RAISE EXCEPTION 'Iniciais não podem ser vazias';
  END IF;

  -- Advisory lock por iniciais (serializa geração para o mesmo prefixo)
  v_lock_key := ('x' || md5(v_iniciais))::bit(63)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Próximo número da sequência
  SELECT COALESCE(
    MAX((regexp_match(sku, v_iniciais || '(\d+)'))[1]::int),
    0
  ) + 1
  INTO v_seq
  FROM bazar_pecas
  WHERE sku LIKE v_iniciais || '%';

  v_sku := v_iniciais || LPAD(v_seq::text, 2, '0');

  RETURN v_sku;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. Relatório por consignatária
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION relatorio_bazar_consignataria(p_iniciais TEXT)
RETURNS TABLE (
  consignataria       TEXT,
  iniciais_param      TEXT,
  total_pecas         BIGINT,
  pecas_vendidas      BIGINT,
  pecas_disponiveis   BIGINT,
  total_vendas        NUMERIC,
  a_pagar             NUMERIC,   -- 60 % para a consignatária
  comissao_virtu      NUMERIC    -- 40 % para a Virtù
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iniciais TEXT := UPPER(TRIM(p_iniciais));
BEGIN
  RETURN QUERY
  SELECT
    MAX(b.consignataria)                            AS consignataria,
    v_iniciais                                      AS iniciais_param,
    COUNT(*)                                        AS total_pecas,
    COUNT(*) FILTER (WHERE b.status = 'vendido')    AS pecas_vendidas,
    COUNT(*) FILTER (WHERE b.status = 'disponivel') AS pecas_disponiveis,
    COALESCE(SUM(b.preco_venda)
      FILTER (WHERE b.status = 'vendido'), 0)       AS total_vendas,
    ROUND(COALESCE(SUM(b.preco_venda)
      FILTER (WHERE b.status = 'vendido'), 0) * 0.60, 2)
                                                    AS a_pagar,
    ROUND(COALESCE(SUM(b.preco_venda)
      FILTER (WHERE b.status = 'vendido'), 0) * 0.40, 2)
                                                    AS comissao_virtu
  FROM bazar_pecas b
  WHERE UPPER(b.iniciais) = v_iniciais;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE bazar_pecas ENABLE ROW LEVEL SECURITY;

-- service_role: acesso irrestrito (Edge Functions, migrations)
CREATE POLICY "service_role_bazar_all"
  ON bazar_pecas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: acesso irrestrito (painel admin logado)
CREATE POLICY "authenticated_bazar_all"
  ON bazar_pecas
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 6. Realtime
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE bazar_pecas;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END;
$$;
