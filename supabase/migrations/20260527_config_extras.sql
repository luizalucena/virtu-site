-- ============================================================
-- VIRTÙ — Adiciona campos editáveis à tabela configuracoes
-- Execute no Supabase SQL Editor
-- ============================================================

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS diferenciais JSONB DEFAULT '[
    {"titulo":"Frete Grátis","descricao":"Nas compras acima de R$399"},
    {"titulo":"Parcelamento","descricao":"Até 6x sem juros no cartão"},
    {"titulo":"Trocas Fáceis","descricao":"Até 30 dias para trocar"},
    {"titulo":"Atendimento","descricao":"Via WhatsApp, de seg. a sáb."}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS faq_items JSONB DEFAULT '[
    {"pergunta":"Como funciona a troca?","resposta":"Você tem 30 dias a partir do recebimento para solicitar troca ou devolução. O frete de retorno é por nossa conta.","link":""},
    {"pergunta":"Prazo de entrega?","resposta":"Entregamos apenas em João Pessoa. Frete padrão em 3–5 dias úteis.","link":""},
    {"pergunta":"As roupas têm garantia?","resposta":"Sim! Oferecemos garantia de qualidade contra defeitos de fabricação por 90 dias após a compra.","link":""},
    {"pergunta":"Parcelo em quantas vezes?","resposta":"Em até 6x sem juros no cartão de crédito. Pix tem 5% de desconto.","link":""}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS newsletter_titulo TEXT DEFAULT 'Seja a primeira a saber',
  ADD COLUMN IF NOT EXISTS newsletter_subtitulo TEXT DEFAULT 'Novidades, lançamentos exclusivos, conteúdo sobre moda intencional e ofertas especiais direto no seu e-mail. Sem spam, prometemos.',
  ADD COLUMN IF NOT EXISTS newsletter_beneficios JSONB DEFAULT '["10% off na primeira compra","Acesso antecipado a lançamentos","Frete grátis em datas especiais"]'::jsonb,
  ADD COLUMN IF NOT EXISTS pedido_msg_titulo TEXT DEFAULT 'Pedido Confirmado!',
  ADD COLUMN IF NOT EXISTS pedido_msg_corpo TEXT DEFAULT 'Obrigada pela sua compra, {nome}! Você receberá um e-mail de confirmação em breve.';

-- Confirma
SELECT 'Campos extras de configuracoes adicionados ✓' AS resultado;
