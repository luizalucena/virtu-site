-- Adiciona coluna de galeria de imagens ao produto
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagens text[] DEFAULT '{}';

-- Migra imagem_url existente para o array imagens (mantém retrocompat)
UPDATE produtos
SET imagens = ARRAY[imagem_url]
WHERE imagem_url IS NOT NULL
  AND imagem_url <> ''
  AND (imagens IS NULL OR imagens = '{}');
