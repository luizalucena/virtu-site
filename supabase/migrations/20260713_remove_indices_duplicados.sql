-- =====================================================================
-- MIGRATION: Remove índices duplicados (B4) — auditoria 2026-07-13
-- =====================================================================
-- O advisor de performance (lint 0009_duplicate_index) apontou 4 pares de
-- índices IDÊNTICOS (mesma tabela, mesma coluna, btree, não-únicos). Índices
-- duplicados só ocupam espaço e tornam INSERT/UPDATE mais lentos, sem ganho
-- de leitura. Mantemos um de cada par (o nome mais descritivo) e removemos o
-- redundante.
--
-- Verificado antes de aplicar (pg_index): todos non-unique / non-primary /
-- definição idêntica ao par mantido — portanto a remoção não altera nenhuma
-- garantia de unicidade nem quebra consulta (o índice remanescente cobre o
-- mesmo caso).
--
-- Reversível: para desfazer, recriar os índices removidos com a definição
-- documentada abaixo (idêntica à do par mantido).
--   idx_ca_telefone        = btree (telefone)      em carrinhos_abandonados
--   pedidos_email_idx      = btree (email_cliente) em pedidos
--   pedidos_payment_id_idx = btree (payment_id)    em pedidos
--   pedidos_status_idx     = btree (status)        em pedidos
-- =====================================================================

-- carrinhos_abandonados.telefone  (mantém idx_carrinhos_abandonados_telefone)
DROP INDEX IF EXISTS public.idx_ca_telefone;

-- pedidos.email_cliente  (mantém idx_pedidos_email_cliente)
DROP INDEX IF EXISTS public.pedidos_email_idx;

-- pedidos.payment_id  (mantém idx_pedidos_payment_id)
DROP INDEX IF EXISTS public.pedidos_payment_id_idx;

-- pedidos.status  (mantém idx_pedidos_status)
DROP INDEX IF EXISTS public.pedidos_status_idx;

SELECT 'Migration 20260713: 4 índices duplicados removidos ✓' AS resultado;
