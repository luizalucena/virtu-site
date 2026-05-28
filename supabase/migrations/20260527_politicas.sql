-- ============================================================
-- VIRTÙ — Adiciona conteúdo editável das Políticas
-- Execute no Supabase SQL Editor
-- ============================================================

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS pol_como_funciona TEXT DEFAULT
    'A Virtù é uma loja de moda feminina online, sediada em João Pessoa (PB). Realizamos entregas apenas na cidade de João Pessoa. Você escolhe suas peças no site, finaliza o pedido com pagamento seguro via Pix ou cartão de crédito, e entregamos na sua porta. Todos os pedidos são preparados com cuidado e embalados com a identidade Virtù.',

  ADD COLUMN IF NOT EXISTS pol_trocas TEXT DEFAULT
    E'**Direito de arrependimento (Compra Online)**\nVocê tem 7 dias corridos a partir do recebimento do produto para desistir da compra, sem precisar dar justificativa. O reembolso é integral, incluindo o frete.\n\n**Troca por tamanho ou cor**\nAceitamos troca por tamanho ou cor em até 30 dias após o recebimento, desde que a peça esteja sem uso, com etiquetas e na embalagem original. O frete de retorno é por nossa conta.\n\n**Defeito de fabricação**\nProdutos com defeito de fabricação têm cobertura de 90 dias conforme o Código de Defesa do Consumidor. Basta nos contatar pelo WhatsApp ou e-mail com foto do defeito.\n\n**Como solicitar**\nEntre em contato pelo WhatsApp ou pelo formulário de contato. Nosso time responde em até 24h úteis.',

  ADD COLUMN IF NOT EXISTS pol_rastreio TEXT DEFAULT
    'Após a confirmação do pagamento, seu pedido é preparado e enviado em até 2 dias úteis. Realizamos entregas apenas em João Pessoa (PB). Você receberá uma mensagem de confirmação quando o pedido sair para entrega. Em caso de dúvidas sobre seu pedido, entre em contato pelo WhatsApp ou pelo e-mail informando o número do pedido.',

  ADD COLUMN IF NOT EXISTS pol_privacidade TEXT DEFAULT
    E'A Virtù respeita sua privacidade. Coletamos apenas os dados necessários para processar seu pedido (nome, e-mail, CPF, endereço e telefone). Seus dados nunca são vendidos ou compartilhados com terceiros, exceto para operação do serviço (processamento de pagamento e entrega). Você pode solicitar a exclusão dos seus dados a qualquer momento pelo e-mail ou WhatsApp. Utilizamos cookies apenas para funcionamento do site.',

  ADD COLUMN IF NOT EXISTS pol_trabalhe_conosco TEXT DEFAULT
    'A Virtù é uma marca em crescimento e adoramos conhecer pessoas apaixonadas por moda. Se você tem interesse em fazer parte do nosso time — seja como produtora, fotógrafa, atendente ou em outra função — nos envie uma mensagem pelo WhatsApp ou e-mail com seu nome, área de interesse e um pouco sobre você.',

  ADD COLUMN IF NOT EXISTS pol_sustentabilidade TEXT DEFAULT
    'A Virtù acredita em moda com propósito. Trabalhamos com fornecedores que respeitam os trabalhadores e o meio ambiente, priorizamos tecidos naturais e duráveis, e apostamos em peças atemporais em vez de tendências descartáveis. Embalagens reutilizáveis e sem plástico desnecessário fazem parte do nosso compromisso.';

SELECT 'Colunas de políticas adicionadas ✓' AS resultado;
