-- ============================================================
-- VIRTÙ — Supabase Setup
-- Cole este SQL no SQL Editor do Supabase e clique em "Run"
-- ============================================================

-- ── TABELA DE PRODUTOS ──────────────────────
CREATE TABLE IF NOT EXISTS produtos (
  id                  TEXT PRIMARY KEY,
  nome                TEXT NOT NULL,
  categoria           TEXT NOT NULL,
  descricao           TEXT DEFAULT '',
  composicao          TEXT DEFAULT '',
  preco_original      DECIMAL(10,2) NOT NULL,
  preco_desconto      DECIMAL(10,2),
  badge               TEXT,
  imagem_url          TEXT DEFAULT '',
  imagem_placeholder  TEXT DEFAULT 'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
  cores               JSONB DEFAULT '[]',
  tamanhos            TEXT[] DEFAULT ARRAY['PP','P','M','G','GG'],
  tamanhos_esgotados  TEXT[] DEFAULT ARRAY[]::TEXT[],
  destaque            BOOLEAN DEFAULT false,
  novidade            BOOLEAN DEFAULT false,
  ativo               BOOLEAN DEFAULT true,
  estoque             INTEGER DEFAULT 0,
  criado_em           TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABELA DE CONFIGURAÇÕES (1 linha sempre) ─
CREATE TABLE IF NOT EXISTS configuracoes (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  nome_loja           TEXT DEFAULT 'Virtù',
  slogan              TEXT DEFAULT 'há virtude no vestir',
  instagram           TEXT DEFAULT '@wear.virtu',
  frete_gratis_acima  DECIMAL(10,2) DEFAULT 300,
  max_parcelas        INTEGER DEFAULT 6,
  banner_home         JSONB DEFAULT '{}',
  banner_editorial    JSONB DEFAULT '{}'
);

-- ── TRIGGER: atualiza atualizado_em automaticamente ─
CREATE OR REPLACE FUNCTION update_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_atualizado_em ON produtos;
CREATE TRIGGER trigger_atualizado_em
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION update_atualizado_em();

-- ── DESABILITA RLS para simplificar ─────────
-- (para adicionar autenticação no futuro, reabilitar e criar políticas)
ALTER TABLE produtos DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONFIGURAÇÕES INICIAIS
-- ============================================================
INSERT INTO configuracoes (id, nome_loja, slogan, instagram, frete_gratis_acima, max_parcelas, banner_home, banner_editorial)
VALUES (
  1,
  'Virtù',
  'há virtude no vestir',
  '@wear.virtu',
  300,
  6,
  '{"titulo_linha1":"Nova Coleção","titulo_linha2":"Outono 2025","subtitulo":"Peças que falam mais alto que qualquer tendência","cta_texto":"Explorar Coleção","cta_link":"catalogo.html"}',
  '{"titulo":"há virtude no vestir","texto":"Cada peça da Virtù é pensada para mulheres que escolhem com intenção.","cta_texto":"Conhecer a Virtù","cta_link":"sobre.html"}'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 12 PRODUTOS DA VIRTÙ
-- ============================================================
INSERT INTO produtos (id, nome, categoria, descricao, composicao, preco_original, preco_desconto, badge, imagem_url, imagem_placeholder, cores, tamanhos, tamanhos_esgotados, destaque, novidade, ativo, estoque)
VALUES
  (
    'vestido-athena', 'Vestido Athena', 'vestidos',
    'Vestido midi com silhueta clássica e caimento impecável. Ideal para ocasiões especiais ou para elevar o dia a dia.',
    '70% viscose, 30% poliéster', 420, null, 'Novo', '',
    'linear-gradient(135deg,#E8E0D5,#D4CCC0)',
    '[{"nome":"Navy","hex":"#2B3F54"},{"nome":"Off-White","hex":"#F9F7F4"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], true, true, true, 15
  ),
  (
    'blusa-helena', 'Blusa Helena', 'blusas',
    'Blusa de linho com decote V e mangas três quartos. Leveza e sofisticação em uma única peça.',
    '100% linho', 195, null, 'Novo', '',
    'linear-gradient(135deg,#D5C8BA,#C4B8A8)',
    '[{"nome":"Off-White","hex":"#F9F7F4"},{"nome":"Areia","hex":"#C4934A"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY['PP'], true, true, true, 22
  ),
  (
    'calca-diana', 'Calça Diana', 'calcas',
    'Calça wide leg de alfaiataria com cós alto. O equilíbrio perfeito entre conforto e elegância.',
    '65% poliéster, 35% viscose', 360, 280, 'Sale', '',
    'linear-gradient(135deg,#3D5470,#2B3F54)',
    '[{"nome":"Navy","hex":"#2B3F54"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY['G'], false, false, true, 8
  ),
  (
    'body-serena', 'Body Serena', 'essenciais',
    'Body canelado com decote quadrado. A base perfeita para qualquer look.',
    '95% algodão, 5% elastano', 145, null, null, '',
    'linear-gradient(135deg,#E2D5C8,#D4C4B5)',
    '[{"nome":"Creme","hex":"#F9F7F4"},{"nome":"Preto","hex":"#1A1A1A"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], false, true, true, 30
  ),
  (
    'vestido-sofia', 'Vestido Sofia', 'vestidos',
    'Vestido longo com fenda lateral e decote em V. Para quem não passa despercebida.',
    '100% seda vegetal', 580, 420, 'Sale', '',
    'linear-gradient(135deg,#C4934A,#B07830)',
    '[{"nome":"Dourado","hex":"#C4934A"}]',
    ARRAY['P','M','G'], ARRAY[]::TEXT[], true, false, true, 5
  ),
  (
    'blusa-iris', 'Blusa Iris', 'blusas',
    'Blusa transpassada de crepe com laço frontal. Feminilidade em estado puro.',
    '100% crepe de viscose', 230, null, 'Exclusivo', '',
    'linear-gradient(135deg,#D4C4B5,#C4B0A0)',
    '[{"nome":"Rosê","hex":"#D4B0A0"},{"nome":"Navy","hex":"#2B3F54"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], true, false, true, 18
  ),
  (
    'vestido-hera', 'Vestido Hera', 'vestidos',
    'Vestido evasê com bordado floral delicado na barra. Romanticismo com elegância.',
    '80% algodão, 20% poliéster', 490, null, 'Exclusivo', '',
    'linear-gradient(135deg,#F0EBE3,#E8E0D5)',
    '[{"nome":"Off-White","hex":"#F9F7F4"}]',
    ARRAY['PP','P','M','G'], ARRAY['PP'], false, true, true, 12
  ),
  (
    'calca-clio', 'Calça Clio', 'calcas',
    'Calça jogger de tricô com cintura elástica. Conforto sem abrir mão do estilo.',
    '60% algodão, 40% lã', 280, null, null, '',
    'linear-gradient(135deg,#9BA8B0,#7A8B96)',
    '[{"nome":"Cinza","hex":"#9BA8B0"},{"nome":"Creme","hex":"#F9F7F4"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], false, true, true, 20
  ),
  (
    'conjunto-nyx', 'Conjunto Nyx', 'essenciais',
    'Conjunto de saia midi e top coordenados. Versatilidade que multiplica o guarda-roupa.',
    '100% viscose premium', 520, 390, 'Mais Vendido', '',
    'linear-gradient(135deg,#2B3F54,#1E2E3E)',
    '[{"nome":"Navy","hex":"#2B3F54"},{"nome":"Preto","hex":"#1A1A1A"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], true, false, true, 10
  ),
  (
    'blusa-caliope', 'Blusa Calíope', 'blusas',
    'Blusa de ombro a ombro com elástico regulável. Elegância descomplicada para o dia a dia.',
    '100% algodão egípcio', 175, null, null, '',
    'linear-gradient(135deg,#E8D5C0,#D4C0A8)',
    '[{"nome":"Areia","hex":"#C4934A"},{"nome":"Branco","hex":"#FFFFFF"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], false, true, true, 25
  ),
  (
    'vestido-persefone', 'Vestido Perséfone', 'vestidos',
    'Vestido slip dress com renda na barra. Sensualidade sofisticada para noites especiais.',
    '90% seda, 10% elastano', 650, null, 'Exclusivo', '',
    'linear-gradient(135deg,#1A1A1A,#2B2B2B)',
    '[{"nome":"Preto","hex":"#1A1A1A"}]',
    ARRAY['P','M','G'], ARRAY['P'], true, true, true, 7
  ),
  (
    'calca-artemis', 'Calça Ártemis', 'calcas',
    'Calça pantalona de linho com bolsos laterais. Praticidade que não abre mão da elegância.',
    '100% linho', 320, 240, 'Sale', '',
    'linear-gradient(135deg,#C4B8A8,#B0A090)',
    '[{"nome":"Areia","hex":"#D4C4B5"},{"nome":"Off-White","hex":"#F9F7F4"}]',
    ARRAY['PP','P','M','G','GG'], ARRAY[]::TEXT[], false, false, true, 14
  )
ON CONFLICT (id) DO NOTHING;
