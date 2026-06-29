-- =====================================================================
-- MIGRATION: Idempotência de pedidos (anti cobrança dupla) — A5
-- Auditoria 2026-06-29
-- =====================================================================
-- Problema (A5, Médio):
--   Em retry/timeout do checkout (resposta perdida após 25s, duplo
--   clique, voltar do navegador), o processar-pagamento podia criar
--   uma SEGUNDA cobrança no ASAAS para o mesmo carrinho → cobrança dupla.
--
-- Correção:
--   • Coluna `idempotency_key` em `pedidos` (chave gerada no checkout.js,
--     estável por tentativa via sessionStorage).
--   • A edge function, ao receber a chave, busca um pedido NÃO recusado
--     com a mesma chave; se existe, devolve a resposta original SEM nova
--     cobrança. 'recusado' é ignorado de propósito (permite refazer após
--     cartão negado).
--
-- Índice NÃO-único de propósito: pedidos 'recusado' podem repetir a mesma
--   chave em nova tentativa; a deduplicação é feita na função (filtra por
--   status). Apenas acelera a busca.
--
-- Aditiva e idempotente (ADD COLUMN/CREATE INDEX IF NOT EXISTS) — não
-- altera dados existentes nem quebra o fluxo atual (chave é opcional:
-- pedidos antigos e requisições sem a chave seguem funcionando).
-- =====================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS idx_pedidos_idempotency
  ON public.pedidos (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

SELECT 'Migration 20260629: idempotency_key adicionada em pedidos ✓' AS resultado;
