-- Adiciona coluna pol_termos à tabela configuracoes
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS pol_termos TEXT;
