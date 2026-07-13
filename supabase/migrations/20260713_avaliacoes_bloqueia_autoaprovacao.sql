-- =====================================================================
-- MIGRATION: Avaliações não podem ser auto-aprovadas pelo cliente — 2026-07-13
-- =====================================================================
-- VULNERABILIDADE (moderação furada / reputação):
--   A policy `avaliacoes_insert_publico` (INSERT, role public) tinha
--   WITH CHECK = true — sem restrição de coluna. Como a anon key é pública,
--   qualquer um podia inserir uma avaliação já com `aprovado = true`:
--
--     POST /rest/v1/avaliacoes { produto_id, nota:5, comentario, aprovado:true }
--
--   O produto.html exibe avaliações com `.eq('aprovado', true)`, então a
--   review falsa apareceria imediatamente, furando a moderação — permitindo
--   flood de avaliações falsas (positivas ou negativas) e spam.
--
-- CORREÇÃO:
--   O fluxo legítimo (js/produto.js) já insere com `aprovado: false`
--   (pendente). Restringimos o INSERT público a `aprovado IS NOT TRUE`
--   (aceita false/null, bloqueia true). A aprovação continua sendo só do
--   admin (policy avaliacoes_admin, is_virtu_admin()).
--
-- Reversível: recriar com WITH CHECK (true) — não recomendado.
-- =====================================================================

DROP POLICY IF EXISTS avaliacoes_insert_publico ON public.avaliacoes;

CREATE POLICY avaliacoes_insert_publico ON public.avaliacoes
  FOR INSERT
  TO public
  WITH CHECK (aprovado IS NOT TRUE);

SELECT 'Migration 20260713: avaliacoes nao podem ser auto-aprovadas ✓' AS resultado;
