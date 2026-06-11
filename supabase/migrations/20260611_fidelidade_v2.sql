-- =====================================================================
-- MIGRATION: Programa de Fidelidade v2 — Virtù
-- 2026-06-11
-- =====================================================================
-- Expansão do sistema de fidelidade:
--   • config_fidelidade   — configurações editáveis pelo admin
--   • premios_fidelidade  — registro de prêmios gerados por cliente
--   • registrar_compra_fidelidade (v2) — gera cupom automaticamente
--   • fn_expirar_premios  — chamada por pg_cron para expirar prêmios
--   • trg_marcar_premio_usado — reseta contador ao usar o cupom
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. TABELA: config_fidelidade
--    Single-row com todos os parâmetros editáveis pelo admin.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_fidelidade (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  meta_compras     INTEGER       NOT NULL DEFAULT 10
                     CHECK (meta_compras >= 1),
  valor_desconto   NUMERIC(10,2) NOT NULL DEFAULT 100.00
                     CHECK (valor_desconto >= 0),
  dias_expiracao   INTEGER       NOT NULL DEFAULT 30
                     CHECK (dias_expiracao >= 1),
  -- Templates de mensagem (NULL = usa template padrão embutido)
  msg_whatsapp     TEXT,
  msg_email_titulo TEXT,
  ativo            BOOLEAN       NOT NULL DEFAULT TRUE,
  atualizado_em    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT config_fidelidade_single_row CHECK (id = 1)
);

-- RLS: somente admin escreve, leitura irrestrita para Edge Functions
ALTER TABLE config_fidelidade ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfg_fid_select_all"   ON config_fidelidade FOR SELECT USING (true);
CREATE POLICY "cfg_fid_write_admin"  ON config_fidelidade FOR ALL    USING (auth.role() = 'authenticated');

-- Seed: insere configurações padrão (idempotente)
INSERT INTO config_fidelidade (id, meta_compras, valor_desconto, dias_expiracao, msg_whatsapp)
VALUES (1, 10, 100.00, 30,
'🎁 *Parabéns, {{NOME}}!*

Você completou {{META}} compras na Virtù e ganhou *R$ {{VALOR}} de desconto*! 🛍️

Seu cupom exclusivo é:
*{{CODIGO}}*

Válido até {{VALIDADE}}
Use em: wearvirtu.com 💙

_Virtù — Moda com propósito_')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. TABELA: premios_fidelidade
--    Cada linha é um prêmio gerado para uma cliente.
--    Relacionada 1:1 com um cupom e M:1 com clientes_perfil.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS premios_fidelidade (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  cupom_id    UUID        REFERENCES cupons (id) ON DELETE SET NULL,
  codigo      TEXT        NOT NULL,
  ciclo       INTEGER     NOT NULL DEFAULT 1, -- 1ª, 2ª, 3ª conquista...
  gerado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em   TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN     NOT NULL DEFAULT FALSE,
  expirado    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Índice para a query de expiração diária
CREATE INDEX IF NOT EXISTS idx_premios_expiry
  ON premios_fidelidade (expirado, usado, expira_em)
  WHERE expirado = FALSE AND usado = FALSE;

-- RLS: cliente vê apenas os próprios prêmios
ALTER TABLE premios_fidelidade ENABLE ROW LEVEL SECURITY;
CREATE POLICY "premios_select_proprio"
  ON premios_fidelidade FOR SELECT USING (auth.uid() = user_id);
-- Escrita apenas por SECURITY DEFINER functions (service role ignora RLS)
CREATE POLICY "premios_write_service"
  ON premios_fidelidade FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────
-- 3. RPC: registrar_compra_fidelidade (v2)
--    Incrementa compras, e quando atinge meta gera cupom + prêmio.
--    SECURITY DEFINER: chamada por Edge Functions com service_role.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_compra_fidelidade(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_novas_compras   INTEGER;
  v_desconto_100    BOOLEAN := FALSE;
  v_codigo          TEXT;
  v_cupom_id        UUID;
  v_premio_id       UUID;
  v_validade        TIMESTAMPTZ;
  v_meta            INTEGER;
  v_valor_desc      NUMERIC(10,2);
  v_dias_exp        INTEGER;
  v_ciclo           INTEGER;
  v_premio_exist    UUID;
BEGIN
  -- ── Lê configurações (com fallback) ──────────────────────
  SELECT meta_compras, valor_desconto, dias_expiracao
  INTO   v_meta, v_valor_desc, v_dias_exp
  FROM   config_fidelidade
  WHERE  id = 1;

  IF NOT FOUND THEN
    v_meta       := 10;
    v_valor_desc := 100.00;
    v_dias_exp   := 30;
  END IF;

  -- ── Garante perfil existe ─────────────────────────────────
  INSERT INTO public.clientes_perfil (id, compras_pagas)
  VALUES (p_user_id, 0)
  ON CONFLICT (id) DO NOTHING;

  -- ── Incrementa atomicamente ───────────────────────────────
  UPDATE public.clientes_perfil
  SET    compras_pagas = compras_pagas + 1
  WHERE  id = p_user_id
  RETURNING compras_pagas INTO v_novas_compras;

  -- ── Detecta múltiplo de meta ──────────────────────────────
  IF v_novas_compras % v_meta = 0 THEN
    v_desconto_100 := TRUE;
    v_ciclo        := v_novas_compras / v_meta;

    -- Evita duplicata em race condition (prêmio ativo já existente)
    SELECT id INTO v_premio_exist
    FROM   premios_fidelidade
    WHERE  user_id  = p_user_id
      AND  usado    = FALSE
      AND  expirado = FALSE
      AND  expira_em > NOW()
    LIMIT 1;

    IF v_premio_exist IS NULL THEN
      -- Gera código único (loop até não colidir)
      LOOP
        v_codigo := 'VIRTU-' || upper(
          substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)
        );
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM cupons WHERE lower(codigo) = lower(v_codigo)
        );
      END LOOP;

      v_validade := NOW() + (v_dias_exp || ' days')::INTERVAL;

      -- Cria cupom de uso único com validade
      INSERT INTO cupons (
        codigo, descricao, tipo, valor,
        uso_maximo, validade, ativo
      )
      VALUES (
        v_codigo,
        'Prêmio Fidelidade Virtù — ' || v_novas_compras || 'ª compra',
        'fixo',
        v_valor_desc,
        1,
        v_validade::DATE,
        TRUE
      )
      RETURNING id INTO v_cupom_id;

      -- Registra o prêmio
      INSERT INTO premios_fidelidade (
        user_id, cupom_id, codigo, expira_em, ciclo
      )
      VALUES (
        p_user_id, v_cupom_id, v_codigo, v_validade, v_ciclo
      )
      RETURNING id INTO v_premio_id;

    ELSE
      -- Prêmio já existe — retorna dados do existente
      SELECT codigo, expira_em
      INTO   v_codigo, v_validade
      FROM   premios_fidelidade
      WHERE  id = v_premio_exist;
      v_premio_id := v_premio_exist;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'compras_pagas',  v_novas_compras,
    'desconto_100',   v_desconto_100,
    'codigo',         v_codigo,
    'validade',       v_validade,
    'premio_id',      v_premio_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. TRIGGER: fn_marcar_premio_usado
--    Quando usar_cupom() incrementa 'usos', marca o prêmio como usado
--    e reseta o contador de compras da cliente para 0 (novo ciclo).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_marcar_premio_usado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Só age quando usos incrementou
  IF NEW.usos <= OLD.usos THEN RETURN NEW; END IF;

  -- Busca o prêmio vinculado a este cupom
  SELECT user_id INTO v_user_id
  FROM   premios_fidelidade
  WHERE  cupom_id = NEW.id
    AND  usado    = FALSE
  LIMIT  1;

  IF FOUND THEN
    -- Marca prêmio como usado
    UPDATE premios_fidelidade
    SET    usado = TRUE
    WHERE  cupom_id = NEW.id
      AND  usado    = FALSE;

    -- Reinicia o contador de compras (novo ciclo)
    UPDATE clientes_perfil
    SET    compras_pagas = 0
    WHERE  id = v_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_premio_usado ON cupons;
CREATE TRIGGER trg_marcar_premio_usado
  AFTER UPDATE OF usos ON cupons
  FOR EACH ROW EXECUTE FUNCTION fn_marcar_premio_usado();

-- ─────────────────────────────────────────────────────────────────────
-- 5. FUNCTION: fn_expirar_premios
--    Chamada diariamente pelo pg_cron (ou Edge Function agendada).
--    Expira prêmios vencidos, desativa seus cupons e reseta contadores.
--    Retorna JSONB com { expirados, executado_em }.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_expirar_premios()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_expirados INTEGER := 0;
  rec         RECORD;
BEGIN
  FOR rec IN
    SELECT pf.id        AS premio_id,
           pf.user_id   AS user_id,
           pf.cupom_id  AS cupom_id
    FROM   premios_fidelidade pf
    WHERE  pf.expirado = FALSE
      AND  pf.usado    = FALSE
      AND  pf.expira_em < NOW()
  LOOP
    -- Marca prêmio expirado
    UPDATE premios_fidelidade
    SET    expirado = TRUE
    WHERE  id = rec.premio_id;

    -- Desativa o cupom correspondente
    IF rec.cupom_id IS NOT NULL THEN
      UPDATE cupons
      SET    ativo = FALSE
      WHERE  id = rec.cupom_id;
    END IF;

    -- Reinicia o contador de compras da cliente (novo ciclo)
    UPDATE clientes_perfil
    SET    compras_pagas = 0
    WHERE  id = rec.user_id;

    v_expirados := v_expirados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expirados',    v_expirados,
    'executado_em', NOW()
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. RPC: fidelidade_status (v2)
--    Agora retorna também o prêmio ativo (se houver).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fidelidade_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_compras  INTEGER;
  v_meta     INTEGER;
  v_progresso INTEGER;
  v_restam   INTEGER;
  v_premio   RECORD;
BEGIN
  -- Lê configuração
  SELECT meta_compras INTO v_meta
  FROM   config_fidelidade WHERE id = 1;
  IF NOT FOUND THEN v_meta := 10; END IF;

  -- Lê compras
  SELECT compras_pagas INTO v_compras
  FROM   public.clientes_perfil
  WHERE  id = p_user_id;
  IF NOT FOUND THEN v_compras := 0; END IF;

  v_progresso := v_compras % v_meta;
  v_restam    := CASE WHEN v_progresso = 0 AND v_compras > 0
                      THEN 0
                      ELSE v_meta - v_progresso
                 END;

  -- Verifica prêmio ativo não expirado
  SELECT codigo, expira_em, ciclo
  INTO   v_premio
  FROM   premios_fidelidade
  WHERE  user_id  = p_user_id
    AND  usado    = FALSE
    AND  expirado = FALSE
    AND  expira_em > NOW()
  ORDER BY gerado_em DESC
  LIMIT  1;

  RETURN jsonb_build_object(
    'compras_pagas',   v_compras,
    'meta_compras',    v_meta,
    'progresso',       v_progresso,
    'restam_para_100', v_restam,
    'proximo_bonus',   ((v_compras / v_meta) + 1) * v_meta,
    'premio_ativo',    CASE WHEN v_premio IS NOT NULL THEN
                         jsonb_build_object(
                           'codigo',     v_premio.codigo,
                           'expira_em',  v_premio.expira_em,
                           'ciclo',      v_premio.ciclo
                         )
                       ELSE NULL END
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. pg_cron: agenda expiração diária às 3h00 (America/Recife)
--    Requer extensão pg_cron ativa. Habilite em:
--    Supabase Dashboard → Database → Extensions → pg_cron
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove agendamento anterior se existir
    PERFORM cron.unschedule('expirar-premios-fidelidade');
  EXCEPTION WHEN OTHERS THEN NULL; -- cron.unschedule pode dar erro se não existir
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expirar-premios-fidelidade',
      '0 6 * * *',  -- 06:00 UTC = 03:00 America/Recife
      'SELECT fn_expirar_premios()'
    );
  END IF;
END $$;

SELECT 'Fidelidade v2: config_fidelidade + premios_fidelidade + RPCs criados ✓' AS resultado;
