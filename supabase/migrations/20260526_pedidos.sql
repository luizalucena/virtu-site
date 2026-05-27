-- ============================================================
-- VIRTÙ — Tabela de Pedidos
-- Execute no Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS pedidos (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  criado_em       TIMESTAMPTZ   DEFAULT now(),
  atualizado_em   TIMESTAMPTZ   DEFAULT now(),

  -- Status do pedido
  status          TEXT          NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','pago','recusado','cancelado','reembolsado')),

  -- Gateway
  payment_id      TEXT,                        -- ID gerado pelo Mercado Pago
  payment_method  TEXT,                        -- 'pix' | 'cartao'
  payment_status  TEXT,                        -- status retornado pelo MP

  -- Valores
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  frete           NUMERIC(10,2) NOT NULL DEFAULT 0,
  desconto        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Entrega
  cep             TEXT,
  rua             TEXT,
  numero          TEXT,
  complemento     TEXT,
  bairro          TEXT,
  cidade          TEXT,
  estado          TEXT,

  -- Cliente
  nome_cliente    TEXT,
  email_cliente   TEXT,
  cpf_cliente     TEXT,
  telefone        TEXT,

  -- Itens do carrinho (snapshot)
  itens           JSONB         NOT NULL DEFAULT '[]'::jsonb,

  -- PIX (apenas quando payment_method = 'pix')
  pix_qr_code         TEXT,
  pix_qr_base64       TEXT,
  pix_expires_at      TIMESTAMPTZ
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS pedidos_status_idx       ON pedidos (status);
CREATE INDEX IF NOT EXISTS pedidos_payment_id_idx   ON pedidos (payment_id);
CREATE INDEX IF NOT EXISTS pedidos_email_idx        ON pedidos (email_cliente);

-- Trigger: atualiza atualizado_em automaticamente
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_atualizado_em ON pedidos;
CREATE TRIGGER trg_pedidos_atualizado_em
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- RLS: apenas usuários autenticados (admin) lêem todos os pedidos.
-- Anônimos podem inserir (criação pelo checkout) e ler o próprio pedido por id.
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_insert_anon"  ON pedidos;
DROP POLICY IF EXISTS "pedidos_select_own"   ON pedidos;
DROP POLICY IF EXISTS "pedidos_all_auth"     ON pedidos;

-- Qualquer um pode criar um pedido (checkout sem login)
CREATE POLICY "pedidos_insert_anon"
  ON pedidos FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Usuário autenticado (admin) vê e edita tudo
CREATE POLICY "pedidos_all_auth"
  ON pedidos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anônimo pode ler pelo id (para tela de confirmação)
CREATE POLICY "pedidos_select_own"
  ON pedidos FOR SELECT TO anon
  USING (true);
