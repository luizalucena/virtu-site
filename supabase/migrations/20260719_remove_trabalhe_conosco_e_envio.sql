-- VIRTÙ — Remove "Trabalhe conosco" do produto e renomeia rastreio → "Envio e prazos"
-- Parte 3 do pré-lançamento.
--
-- ⚠️ ORDEM DE GO-LIVE: o DROP da coluna só é seguro DEPOIS de publicar o
-- frontend (politicas.html) e o admin (index.html + admin.js) que ainda
-- referenciam pol_trabalhe_conosco. Rodar este DROP com o código antigo no ar
-- quebra o "salvar configurações" do admin. Sequência correta:
--   1) push do frontend  2) deploy das edge functions  3) este DROP.
-- O update de pol_rastreio abaixo é seguro a qualquer momento.

-- 1. Atualiza o texto de "Envio e prazos" (antiga seção de rastreio),
--    sem promessa de rastreamento em tempo real.
update public.configuracoes
   set pol_rastreio = 'Preparamos e enviamos seu pedido em até 2 dias úteis após a confirmação do pagamento. Entregamos para todo o Brasil — o prazo de entrega varia conforme a sua região (Correios/transportadora). Na Grande João Pessoa, a entrega é expressa. Você recebe a confirmação por e-mail assim que o pedido é despachado.

Em caso de dúvidas sobre seu pedido, entre em contato pelo WhatsApp ou pelo e-mail informando o número do pedido (WV) recebido na confirmação de compra.'
 where id = 1;

-- 2. Remove definitivamente o campo "Trabalhe conosco".
alter table public.configuracoes
  drop column if exists pol_trabalhe_conosco;
