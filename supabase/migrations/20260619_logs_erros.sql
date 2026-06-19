-- ============================================================
-- VIRTÙ — Migration: logs_erros
-- Pilar 3 — Monitoramento de Erros em Produção
-- Registra exceções JS capturadas por error-logger.js
-- ============================================================

-- ── Tabela principal ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.logs_erros (
  id          bigserial     PRIMARY KEY,
  criado_em   timestamptz   NOT NULL DEFAULT now(),
  tipo        text          NOT NULL CHECK (tipo IN ('js_error', 'promise_rejection')),
  mensagem    text,
  stack       text,
  pagina      text,
  linha       integer,
  coluna      integer,
  user_agent  text,
  user_id     uuid          REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── Índices ──────────────────────────────────────────────────
-- Pesquisa por data (análise recente)
CREATE INDEX IF NOT EXISTS logs_erros_criado_em_idx
  ON public.logs_erros (criado_em DESC);

-- Pesquisa por utilizador (rastrear cliente com problema)
CREATE INDEX IF NOT EXISTS logs_erros_user_id_idx
  ON public.logs_erros (user_id)
  WHERE user_id IS NOT NULL;

-- Pesquisa por tipo de erro
CREATE INDEX IF NOT EXISTS logs_erros_tipo_idx
  ON public.logs_erros (tipo);

-- ── RLS (Row Level Security) ─────────────────────────────────
ALTER TABLE public.logs_erros ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (anon ou autenticada) pode INSERIR erros
-- O error-logger.js usa a chave anon para isso
CREATE POLICY "logs_erros_insert_anon"
  ON public.logs_erros
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Apenas service_role (Admin) pode LER os logs
-- Nenhuma policy de SELECT para anon/authenticated = acesso negado por padrão

-- ── Retenção automática: purgar logs com mais de 90 dias ─────
-- (Cron via Supabase pg_cron — executar após criar a extensão)
-- SELECT cron.schedule('purgar-logs-erros', '0 3 * * 0',
--   $$DELETE FROM public.logs_erros WHERE criado_em < now() - INTERVAL '90 days'$$);

-- ── Comentários ──────────────────────────────────────────────
COMMENT ON TABLE  public.logs_erros            IS 'Erros JS capturados em produção pelo error-logger.js';
COMMENT ON COLUMN public.logs_erros.tipo       IS 'js_error = window.onerror | promise_rejection = unhandledrejection';
COMMENT ON COLUMN public.logs_erros.mensagem   IS 'Mensagem do erro (truncada a 500 chars)';
COMMENT ON COLUMN public.logs_erros.stack      IS 'Stack trace completo (truncado a 2000 chars)';
COMMENT ON COLUMN public.logs_erros.pagina     IS 'URL pathname da página onde o erro ocorreu';
COMMENT ON COLUMN public.logs_erros.user_agent IS 'User-Agent do browser (truncado a 300 chars)';
COMMENT ON COLUMN public.logs_erros.user_id    IS 'UUID da cliente logada no momento do erro (nullable)';
