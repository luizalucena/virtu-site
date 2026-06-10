-- ============================================================
-- Virtù — carrinhos_abandonados: colunas extras + índices
-- Executar no Supabase SQL Editor
-- ============================================================

-- 1. Garantir que a tabela existe (idempotente)
CREATE TABLE IF NOT EXISTS carrinhos_abandonados (
  id              bigserial PRIMARY KEY,
  telefone        text        NOT NULL,
  nome            text,
  email           text,
  itens           jsonb       DEFAULT '[]',
  valor_total     numeric(10,2) DEFAULT 0,
  origem          text        DEFAULT 'carrinho',
  url_recuperacao text,
  recuperado      boolean     DEFAULT false,
  recuperado_em   timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- 2. Novas colunas para rastrear disparo de WhatsApp e tempo na página
ALTER TABLE carrinhos_abandonados
  ADD COLUMN IF NOT EXISTS whatsapp_enviado boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS enviado_em       timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_abandono   integer;   -- minutos que o cliente ficou na página

-- 3. Índices para queries frequentes do painel admin
CREATE INDEX IF NOT EXISTS idx_ca_telefone
  ON carrinhos_abandonados (telefone);

CREATE INDEX IF NOT EXISTS idx_ca_recuperado
  ON carrinhos_abandonados (recuperado)
  WHERE recuperado = false;

CREATE INDEX IF NOT EXISTS idx_ca_whatsapp_pendente
  ON carrinhos_abandonados (whatsapp_enviado, created_at)
  WHERE whatsapp_enviado = false AND recuperado = false;

-- 4. Row Level Security (admin lê tudo, público não acessa)
ALTER TABLE carrinhos_abandonados ENABLE ROW LEVEL SECURITY;

-- Permite service_role fazer tudo (Edge Functions usam service_role)
DROP POLICY IF EXISTS "service_role full access" ON carrinhos_abandonados;
CREATE POLICY "service_role full access"
  ON carrinhos_abandonados
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Permite INSERT anônimo (site insere sem autenticação)
DROP POLICY IF EXISTS "anon insert carrinhos" ON carrinhos_abandonados;
CREATE POLICY "anon insert carrinhos"
  ON carrinhos_abandonados
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Permite UPDATE anônimo apenas no próprio registro (para marcar como recuperado)
DROP POLICY IF EXISTS "anon update recovery" ON carrinhos_abandonados;
CREATE POLICY "anon update recovery"
  ON carrinhos_abandonados
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 5. Habilitar Realtime para o painel admin monitorar em tempo real
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'carrinhos_abandonados'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE carrinhos_abandonados;
  END IF;
END$$;

-- 6. Função utilitária: buscar carrinhos prontos para follow-up
--    (abandonados há mais de 20 min, não recuperados, WhatsApp ainda não enviado)
CREATE OR REPLACE FUNCTION carrinhos_para_followup()
RETURNS SETOF carrinhos_abandonados
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT *
  FROM carrinhos_abandonados
  WHERE recuperado       = false
    AND whatsapp_enviado = false
    AND telefone IS NOT NULL
    AND length(regexp_replace(telefone, '\D', '', 'g')) >= 10
    AND created_at <= now() - interval '20 minutes'
  ORDER BY created_at DESC;
$$;
