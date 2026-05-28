-- VIRTÙ — Adiciona flag "essencial" na tabela de produtos
-- Permite marcar qualquer produto como Essencial independente da categoria

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS essencial BOOLEAN NOT NULL DEFAULT false;
