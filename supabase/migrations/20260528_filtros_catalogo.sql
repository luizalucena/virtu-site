-- ============================================================
-- VIRTÙ — Filtros do Catálogo (tamanhos e cores disponíveis)
-- ============================================================

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS filtros_tamanhos JSONB DEFAULT '["PP","P","M","G","GG","XG"]'::jsonb,
  ADD COLUMN IF NOT EXISTS filtros_cores    JSONB DEFAULT '[
    {"nome":"Azul Âncora","hex":"#2B3F54"},
    {"nome":"Dourado","hex":"#C4934A"},
    {"nome":"Cru","hex":"#E8D5B5"},
    {"nome":"Preto","hex":"#1a1a1a"},
    {"nome":"Off-White","hex":"#F9F7F4"},
    {"nome":"Cinza","hex":"#6E6660"},
    {"nome":"Terracota","hex":"#8B6F5E"},
    {"nome":"Rosa","hex":"#D4A5A5"}
  ]'::jsonb;
