-- ============================================================
-- VIRTÙ — Módulo Financeiro: tabela fluxo_caixa + trigger automático
-- Execute no Supabase SQL Editor
-- ============================================================

-- ── 1. TABELA PRINCIPAL ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fluxo_caixa (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT          NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  valor           NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  descricao       TEXT          NOT NULL,
  categoria       TEXT          NOT NULL DEFAULT 'Outros',
  data_lancamento DATE          NOT NULL DEFAULT CURRENT_DATE,
  origem          TEXT          NOT NULL CHECK (origem IN ('site', 'manual', 'planilha')),
  pedido_id       UUID          REFERENCES pedidos(id) ON DELETE SET NULL,
  -- fonte_id é usado para deduplicação:
  --   site      → 'pedido_<uuid>'
  --   planilha  → hash determinístico da linha CSV
  --   manual    → NULL (lançamentos manuais não deduplicam)
  fonte_id        TEXT,
  criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Garante que a mesma origem+fonte_id não seja inserida duas vezes
  UNIQUE (origem, fonte_id)
);

-- ── 2. ÍNDICES PARA PERFORMANCE DO DASHBOARD ─────────────────
CREATE INDEX IF NOT EXISTS idx_fc_data     ON fluxo_caixa (data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_fc_tipo     ON fluxo_caixa (tipo);
CREATE INDEX IF NOT EXISTS idx_fc_origem   ON fluxo_caixa (origem);
CREATE INDEX IF NOT EXISTS idx_fc_pedido   ON fluxo_caixa (pedido_id);

-- ── 3. ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE fluxo_caixa ENABLE ROW LEVEL SECURITY;

-- Admin autenticado tem acesso total
DROP POLICY IF EXISTS "fc_admin_all" ON fluxo_caixa;
CREATE POLICY "fc_admin_all"
  ON fluxo_caixa FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 4. FUNÇÃO + TRIGGER: pedido aprovado → entrada automática ─
--
-- Dispara APÓS UPDATE na tabela pedidos.
-- Só age quando status muda de qualquer valor PARA 'pago'.
-- UNIQUE (origem, fonte_id) garante idempotência: mesmo que o
-- trigger dispare duas vezes (ex.: retry de webhook), o segundo
-- INSERT é descartado silenciosamente via ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_pedido_pago_para_fluxo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- executa com privilégios do dono da função
AS $$
BEGIN
  -- Só processa a transição → 'pago'
  IF NEW.status = 'pago' AND OLD.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO fluxo_caixa
      (tipo, valor, descricao, categoria, data_lancamento, origem, pedido_id, fonte_id)
    VALUES (
      'entrada',
      NEW.total,
      'Venda #' || substring(NEW.id::text, 1, 8),   -- ex.: "Venda #a1b2c3d4"
      'Venda Site',
      CURRENT_DATE,
      'site',
      NEW.id,
      'pedido_' || NEW.id::text                      -- chave de deduplicação
    )
    ON CONFLICT (origem, fonte_id) DO NOTHING;       -- idempotente ✓
  END IF;

  RETURN NEW;
END;
$$;

-- Remove trigger antigo (se existir) antes de recriar
DROP TRIGGER IF EXISTS trg_pedido_pago_fluxo ON pedidos;

CREATE TRIGGER trg_pedido_pago_fluxo
  AFTER UPDATE OF status ON pedidos   -- só dispara quando 'status' muda
  FOR EACH ROW
  EXECUTE FUNCTION fn_pedido_pago_para_fluxo();

-- ── 5. BACKFILL: registra pedidos 'pago' que já existem ───────
--
-- Executa UMA VEZ para importar o histórico já existente na
-- tabela pedidos. ON CONFLICT garante que não duplica.
-- ─────────────────────────────────────────────────────────────
INSERT INTO fluxo_caixa
  (tipo, valor, descricao, categoria, data_lancamento, origem, pedido_id, fonte_id)
SELECT
  'entrada',
  total,
  'Venda #' || substring(id::text, 1, 8),
  'Venda Site',
  criado_em::date,
  'site',
  id,
  'pedido_' || id::text
FROM pedidos
WHERE status = 'pago'
ON CONFLICT (origem, fonte_id) DO NOTHING;

-- ── CONFIRMAÇÃO ───────────────────────────────────────────────
SELECT
  'fluxo_caixa criado + trigger ativo + backfill concluído ✓' AS resultado,
  count(*) AS pedidos_importados
FROM fluxo_caixa
WHERE origem = 'site';
