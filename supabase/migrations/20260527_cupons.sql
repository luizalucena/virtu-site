-- ============================================================
-- VIRTÙ — Sistema de Cupons de Desconto
-- Execute no Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS cupons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        TEXT NOT NULL UNIQUE,
  descricao     TEXT,
  tipo          TEXT NOT NULL DEFAULT 'percentual'  -- 'percentual' | 'fixo'
                  CHECK (tipo IN ('percentual','fixo')),
  valor         NUMERIC(10,2) NOT NULL,
  valor_minimo  NUMERIC(10,2) DEFAULT 0,            -- pedido mínimo para usar
  uso_maximo    INT,                                 -- NULL = ilimitado
  usos          INT NOT NULL DEFAULT 0,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  validade      DATE,                               -- NULL = sem validade
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para busca rápida por código
CREATE INDEX IF NOT EXISTS idx_cupons_codigo ON cupons (lower(codigo));

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE cupons ENABLE ROW LEVEL SECURITY;

-- Leitura pública: apenas cupons ativos (para validação no checkout)
CREATE POLICY "cupons_public_read" ON cupons
  FOR SELECT USING (true);

-- Escrita: apenas usuários autenticados (admin)
CREATE POLICY "cupons_admin_write" ON cupons
  FOR ALL USING (auth.role() = 'authenticated');

-- ── RPC: validar cupom (chamado pelo checkout) ───────────────
CREATE OR REPLACE FUNCTION validar_cupom(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cupom cupons%ROWTYPE;
  v_erro  TEXT;
BEGIN
  SELECT * INTO v_cupom
    FROM cupons
    WHERE lower(codigo) = lower(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Cupom não encontrado.');
  END IF;

  IF NOT v_cupom.ativo THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom está desativado.');
  END IF;

  IF v_cupom.validade IS NOT NULL AND v_cupom.validade < CURRENT_DATE THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom expirou.');
  END IF;

  IF v_cupom.uso_maximo IS NOT NULL AND v_cupom.usos >= v_cupom.uso_maximo THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom atingiu o limite de usos.');
  END IF;

  RETURN jsonb_build_object(
    'valido',        true,
    'id',            v_cupom.id,
    'codigo',        v_cupom.codigo,
    'tipo',          v_cupom.tipo,
    'valor',         v_cupom.valor,
    'valor_minimo',  v_cupom.valor_minimo,
    'descricao',     v_cupom.descricao
  );
END;
$$;

-- ── RPC: registrar uso do cupom (chamado ao confirmar pedido) ─
CREATE OR REPLACE FUNCTION usar_cupom(p_codigo TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE cupons
    SET usos = usos + 1
    WHERE lower(codigo) = lower(trim(p_codigo))
      AND ativo = true;
END;
$$;

-- ── Cupons de exemplo ────────────────────────────────────────
INSERT INTO cupons (codigo, descricao, tipo, valor, valor_minimo, uso_maximo)
VALUES
  ('BOAS-VINDAS', 'Desconto de boas-vindas para novos clientes', 'percentual', 10, 0, NULL),
  ('FRETE10',     '10% de desconto no pedido',                   'percentual', 10, 100, NULL),
  ('VIP20',       'Desconto VIP de 20%',                         'percentual', 20, 200, NULL)
ON CONFLICT (codigo) DO NOTHING;

SELECT 'Tabela cupons criada ✓' AS resultado;
