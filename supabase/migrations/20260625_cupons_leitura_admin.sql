-- =====================================================================
-- MIGRATION: Cupons — remover leitura pública — 2026-06-25
-- =====================================================================
-- Antes: "cupons_public_read" (SELECT, public, USING true) deixava
--        qualquer visitante (anon key) listar TODOS os códigos de cupom.
-- A loja valida cupom via RPC validar_cupom() (SECURITY DEFINER), que
-- não depende da leitura direta da tabela. O painel admin lê a tabela
-- autenticado como is_virtu_admin().
--
-- Idempotente.
-- =====================================================================

DROP POLICY IF EXISTS "cupons_public_read" ON public.cupons;

CREATE POLICY "cupons_admin_read"
  ON public.cupons
  FOR SELECT
  TO authenticated
  USING (public.is_virtu_admin());

SELECT 'Cupons: leitura restrita ao admin (validar_cupom RPC inalterada) ✓' AS resultado;
