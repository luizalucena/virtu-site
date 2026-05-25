/* ============================================================
   VIRTÙ — Adicionar coluna "sobre" na tabela configuracoes
   Execute este script no SQL Editor do Supabase:
   supabase.com → seu projeto → SQL Editor → New query
   ============================================================ */

-- 1. Adiciona a coluna "sobre" (JSONB) se ainda não existir
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS sobre JSONB DEFAULT '{}'::jsonb;

-- 2. Preenche com os conteúdos padrão da página Sobre
UPDATE configuracoes
SET sobre = '{
  "hero": {
    "eyebrow": "Nossa história",
    "titulo_linha1": "Há virtude",
    "titulo_linha2": "no vestir",
    "subtitulo": "A Virtù nasceu da crença de que a moda pode ser, ao mesmo tempo, intencional, elegante e verdadeiramente sua."
  },
  "manifesto": {
    "titulo": "O que é Virtù?",
    "paragrafo1": "Na filosofia do Renascimento, virtù era a capacidade humana de agir com excelência, de transformar o ordinário em extraordinário por meio da intenção e da forma.",
    "paragrafo2": "Para nós, vestir-se bem é um ato de cuidado — consigo mesma, com o tempo que você habita, com a imagem que você escolhe apresentar ao mundo. Não é sobre seguir tendências. É sobre encontrar peças que conversam com quem você já é.",
    "paragrafo3": "Cada coleção da Virtù é pensada para mulheres que apreciam o detalhe, que preferem menos e melhor, e que entendem que elegância verdadeira prescinde de esforço aparente.",
    "quote_texto": "A elegância não é ser notada, é ser lembrada.",
    "quote_autor": "Giorgio Armani",
    "imagem_url": ""
  },
  "valores": [
    {
      "titulo": "Curadoria rigorosa",
      "texto": "Cada peça passa por uma seleção criteriosa de caimento, tecido e acabamento. Não vendemos quantidade — vendemos escolhas certas."
    },
    {
      "titulo": "Intenção em cada detalhe",
      "texto": "Do corte ao etiquetamento, tudo é pensado para que a experiência de receber, vestir e usar uma peça Virtù seja memorável."
    },
    {
      "titulo": "Atemporal sobre efêmero",
      "texto": "Trabalhamos com silhuetas que resistem às estações. Investir em Virtù é construir um guarda-roupa que dura e envelhece bem."
    },
    {
      "titulo": "Presença real",
      "texto": "Acreditamos no relacionamento humano. Nosso atendimento é próximo, honesto e sem scripts — porque você merece uma resposta de verdade."
    }
  ],
  "fundadora": {
    "titulo_linha1": "Uma visão de moda",
    "titulo_linha2": "com propósito",
    "paragrafo1": "A Virtù foi criada por uma mulher que, cansada de peças que não duravam além de uma estação, decidiu construir a loja que ela própria queria encontrar: com curadoria impecável, sem ruído, sem o barulho das tendências passageiras.",
    "paragrafo2": "A proposta sempre foi simples: oferecer peças que fazem você se sentir bem vestida sem precisar de explicação — porque a própria peça já diz tudo.",
    "imagem_url": ""
  },
  "numeros": [
    { "valor": 2000, "label": "Clientes satisfeitas" },
    { "valor": 150,  "label": "Peças em catálogo" },
    { "valor": 30,   "label": "Dias de devolução grátis" },
    { "valor": 98,   "label": "% de avaliações positivas" }
  ],
  "envio": [
    {
      "titulo": "Correios PAC",
      "texto": "Prazo de 5 a 12 dias úteis. Economize no frete com entrega confiável para todo o Brasil."
    },
    {
      "titulo": "Correios SEDEX",
      "texto": "Prazo de 1 a 5 dias úteis. Para quem não quer esperar para estrear sua nova peça."
    },
    {
      "titulo": "Frete grátis",
      "texto": "Em compras acima de R$ 300. Frete grátis automático no checkout — sem cupom necessário."
    },
    {
      "titulo": "Trocas e devoluções",
      "texto": "Até 30 dias após o recebimento, sem custo. Sua satisfação é nossa prioridade."
    }
  ],
  "pagamento": [
    {
      "titulo": "Cartão de crédito",
      "texto": "Visa, Mastercard, Elo e Amex. Parcelamento em até 6x sem juros."
    },
    {
      "titulo": "Cartão de débito",
      "texto": "Débito à vista com todas as principais bandeiras aceitas."
    },
    {
      "titulo": "Pix",
      "texto": "Pagamento instantâneo com aprovação imediata. Mais rápido e sem taxas."
    },
    {
      "titulo": "Boleto bancário",
      "texto": "Vencimento em 3 dias úteis. Aprovação após confirmação de pagamento."
    }
  ]
}'::jsonb
WHERE id = 1;
