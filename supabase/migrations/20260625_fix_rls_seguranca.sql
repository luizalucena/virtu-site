-- =====================================================================
-- MIGRATION: Correção de segurança RLS — auditoria 2026-06-25
-- =====================================================================
-- Estado verificado em produção antes desta migration:
--   • C2 (admin) JÁ estava corrigido: a função is_virtu_admin() (allowlist
--     wearvirtu@gmail.com + service_role) já protege produtos, configuracoes,
--     cupons, fluxo_caixa, config_fidelidade, bazar_pecas e pedidos (admin).
--     → Esta migration NÃO mexe nessas policies.
--
--   • C1 (vazamento de pedidos) AINDA estava aberto: a policy
--     "rastreio_por_uuid" (FOR SELECT, public, USING true) permitia à
--     anon key — que é pública (js/supabase-config.js) — ler TODAS as
--     linhas e colunas de `pedidos` (CPF, endereço, telefone, itens).
--     RLS controla LINHA, não COLUNA: limitar o SELECT no frontend não
--     impede um `select('*')` direto.
--
-- Esta migration corrige apenas o C1:
--   1. Remove a policy de leitura anônima total.
--   2. Cria a função rastrear_pedido(uuid) (SECURITY DEFINER) que devolve
--      SÓ colunas não sensíveis de UM pedido — para a página de rastreio.
--
-- ⚠️ AÇÃO COMPLEMENTAR (frontend): o rastreio.html foi ajustado para usar
--    .rpc('rastrear_pedido', { p_id }) + polling, em vez de
--    .from('pedidos').select(...) + realtime. Aplicar esta migration
--    ANTES de publicar o rastreio.html.
--
-- Idempotente: DROP IF EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- 1. Remove a leitura anônima total de pedidos (o vazamento)
DROP POLICY IF EXISTS "rastreio_por_uuid" ON public.pedidos;

-- 2. Função segura de rastreio: só colunas não sensíveis, por UUID.
--    SECURITY DEFINER ignora o RLS, mas só expõe as colunas listadas.
CREATE OR REPLACE FUNCTION public.rastrear_pedido(p_id uuid)
RETURNS TABLE (
  id              uuid,
  nome_cliente    text,
  cliente_nome    text,     -- alias legado consumido pelo rastreio.html
  status          text,
  criado_em       timestamptz,
  atualizado_em   timestamptz,
  codigo_rastreio text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id,
         nome_cliente,
         nome_cliente AS cliente_nome,
         status,
         criado_em,
         atualizado_em,
         codigo_rastreio
  FROM public.pedidos
  WHERE id = p_id;
$$;

-- O site (anon) e clientes logados podem chamar a função de rastreio.
GRANT EXECUTE ON FUNCTION public.rastrear_pedido(uuid) TO anon, authenticated;

-- Observações:
--   • As policies de SELECT do próprio cliente continuam ativas
--     (clientes_veem_proprios_pedidos / pedidos_cliente_proprios).
--   • O checkout segue funcionando (pedidos_insert_seguro — INSERT aberto).
--   • is_virtu_admin() (já existente) mantém o acesso total do admin.

SELECT 'Migration 20260625: C1 corrigido — rastreio_por_uuid removida + rastrear_pedido() criada ✓' AS resultado;
