-- =====================================================================
-- MIGRATION: Fixa search_path das funções de timestamp — 2026-07-14
-- =====================================================================
-- Lint 0011_function_search_path_mutable: funções sem search_path fixo
-- podem, em tese, ser induzidas a resolver objetos no schema errado.
-- São funções de trigger (atualizam colunas *_atualizado_em). Fixamos
-- search_path = public, pg_temp (mesmo padrão das demais SECURITY DEFINER
-- já corrigidas na migration 20260629).
--
-- Seguro: só define um parâmetro de configuração da função; não altera o
-- corpo nem o comportamento. Reversível com RESET search_path.
-- =====================================================================

ALTER FUNCTION public.set_clientes_perfil_atualizado_em() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_bazar_atualizado_em()            SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_atualizar_ts_perfil()            SET search_path = public, pg_temp;

SELECT 'Migration 20260714: search_path fixo nas 3 funcoes de timestamp ✓' AS resultado;
