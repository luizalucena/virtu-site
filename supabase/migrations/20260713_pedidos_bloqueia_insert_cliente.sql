-- =====================================================================
-- MIGRATION: Bloqueia INSERT de pedidos pelo cliente (CRÍTICO) — 2026-07-13
-- =====================================================================
-- VULNERABILIDADE (pagamento fantasma):
--   A policy `pedidos_insert_seguro` (INSERT, roles {anon, authenticated})
--   tinha WITH CHECK = ((user_id IS NULL) OR (user_id = auth.uid())) e
--   NENHUMA restrição de `status`. Como a anon key é pública (está no
--   frontend), qualquer pessoa podia inserir um pedido direto na tabela:
--
--     POST /rest/v1/pedidos  { "status": "pago", "user_id": null, ... }
--
--   Isso contornava TODO o anti-fraude do edge function processar-pagamento
--   (recálculo de preço/frete/cupom/estoque + cobrança no ASAAS), criando um
--   pedido "pago" sem pagamento algum. Pior: o trigger
--   trg_pedido_pago_baixa_estoque baixa estoque no INSERT com status='pago',
--   e o de fidelidade contaria a "compra" — permitindo furto de estoque,
--   pedido fantasma e acúmulo fraudulento do prêmio de fidelidade.
--   Provado em produção: um INSERT anon passou pela RLS (falhou só por NOT
--   NULL de coluna omitida), não por violação de policy.
--
-- CORREÇÃO:
--   Nenhum fluxo legítimo insere em `pedidos` pelo cliente — a criação é
--   feita SEMPRE pelo edge function processar-pagamento usando a
--   service_role key (que ignora RLS). Portanto removemos a policy de INSERT
--   do cliente. Após isto:
--     • anon / authenticated (não-admin) → INSERT negado (default deny)
--     • service_role (edge function)      → continua inserindo (ignora RLS)
--     • admin                             → insere via pedidos_admin_full (ALL)
--
-- Reversível: para desfazer, recriar a policy com
--   CREATE POLICY pedidos_insert_seguro ON public.pedidos FOR INSERT
--   TO anon, authenticated
--   WITH CHECK ((user_id IS NULL) OR (user_id = auth.uid()));
-- (não recomendado — reabre o pagamento fantasma).
-- =====================================================================

DROP POLICY IF EXISTS pedidos_insert_seguro ON public.pedidos;

SELECT 'Migration 20260713: INSERT de pedidos pelo cliente bloqueado ✓' AS resultado;
