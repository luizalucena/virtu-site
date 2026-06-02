-- ============================================================
-- Habilitar RLS em produtos e configuracoes
-- Leitura pública; escrita apenas para usuários autenticados (admin)
-- ============================================================

-- PRODUTOS
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "produtos_leitura_publica"
  ON produtos FOR SELECT
  USING (true);

CREATE POLICY "produtos_escrita_autenticado"
  ON produtos FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- CONFIGURACOES
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "configuracoes_leitura_publica"
  ON configuracoes FOR SELECT
  USING (true);

CREATE POLICY "configuracoes_escrita_autenticado"
  ON configuracoes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
