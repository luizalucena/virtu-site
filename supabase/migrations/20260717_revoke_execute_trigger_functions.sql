-- =====================================================================
-- MIGRATION: hardening — revoga EXECUTE das funções de TRIGGER — 2026-07-17
-- =====================================================================
-- Advisors 0028/0029: funções SECURITY DEFINER expostas via /rest/v1/rpc.
-- Funções que RETORNAM trigger não devem ser chamadas por RPC (só disparam
-- pelo trigger, que roda no contexto do owner — independe do grant do papel).
-- Revogar EXECUTE de anon/authenticated/PUBLIC é defense-in-depth, sem risco
-- funcional (as triggers continuam disparando normalmente).
--
-- NÃO mexe nas funções de negócio (validar_cupom, rastrear_pedido,
-- stock_do_produto, is_virtu_admin) nem nas RPCs de admin guardadas por
-- is_virtu_admin() — essas precisam continuar chamáveis.
-- =====================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, PUBLIC', r.fn);
  END LOOP;
END $$;

SELECT 'Migration 20260717: EXECUTE das funções de trigger revogado (anon/authenticated) ✓' AS resultado;
