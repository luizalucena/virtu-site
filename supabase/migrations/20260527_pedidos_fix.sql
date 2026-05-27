-- ============================================================
-- VIRTÙ — Fix tabela pedidos (execute se já existir a tabela)
-- Adiciona colunas faltantes com segurança (IF NOT EXISTS)
-- ============================================================

-- Adiciona todas as colunas que podem estar faltando
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS atualizado_em     TIMESTAMPTZ   DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_id        TEXT,
  ADD COLUMN IF NOT EXISTS payment_method    TEXT,
  ADD COLUMN IF NOT EXISTS payment_status    TEXT,
  ADD COLUMN IF NOT EXISTS subtotal          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frete             NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total             NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cep               TEXT,
  ADD COLUMN IF NOT EXISTS rua               TEXT,
  ADD COLUMN IF NOT EXISTS numero            TEXT,
  ADD COLUMN IF NOT EXISTS complemento       TEXT,
  ADD COLUMN IF NOT EXISTS bairro            TEXT,
  ADD COLUMN IF NOT EXISTS cidade            TEXT,
  ADD COLUMN IF NOT EXISTS estado            TEXT,
  ADD COLUMN IF NOT EXISTS nome_cliente      TEXT,
  ADD COLUMN IF NOT EXISTS email_cliente     TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cliente       TEXT,
  ADD COLUMN IF NOT EXISTS telefone          TEXT,
  ADD COLUMN IF NOT EXISTS itens             JSONB         DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pix_qr_code       TEXT,
  ADD COLUMN IF NOT EXISTS pix_qr_base64     TEXT,
  ADD COLUMN IF NOT EXISTS pix_expires_at    TIMESTAMPTZ;

-- Garante a constraint de status (ignora se já existir)
DO $$
BEGIN
  ALTER TABLE pedidos
    ADD CONSTRAINT pedidos_status_check
    CHECK (status IN ('pendente','pago','recusado','cancelado','reembolsado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Índices úteis
CREATE INDEX IF NOT EXISTS pedidos_status_idx     ON pedidos (status);
CREATE INDEX IF NOT EXISTS pedidos_payment_id_idx ON pedidos (payment_id);
CREATE INDEX IF NOT EXISTS pedidos_email_idx      ON pedidos (email_cliente);

-- Trigger: atualiza atualizado_em automaticamente
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_atualizado_em ON pedidos;
CREATE TRIGGER trg_pedidos_atualizado_em
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- RLS
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_insert_anon" ON pedidos;
DROP POLICY IF EXISTS "pedidos_select_own"  ON pedidos;
DROP POLICY IF EXISTS "pedidos_all_auth"    ON pedidos;

CREATE POLICY "pedidos_insert_anon"
  ON pedidos FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "pedidos_all_auth"
  ON pedidos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "pedidos_select_own"
  ON pedidos FOR SELECT TO anon USING (true);

-- Confirma
SELECT 'Tabela pedidos configurada com sucesso ✓' AS resultado;
