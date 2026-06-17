-- =====================================================================
-- MIGRATION: Programa de Fidelidade v3 — Virtù
-- 2026-06-17
-- =====================================================================
-- Alterações desta versão:
--   • valor_desconto: R$100 → R$150
--   • valor_minimo_premio: nova coluna — pedido mínimo R$499
--   • registrar_compra_fidelidade: aceita p_total e valida mínimo
--   • fidelidade_status: retorna valor_desconto e valor_minimo_premio
--
-- Regra de negócio:
--   Na 10ª compra (múltiplo de meta_compras), o prêmio SÓ é concedido
--   se p_total >= valor_minimo_premio (R$499).
--   Se não atingir o mínimo: contador é revertido para meta-1 e a
--   cliente precisa tentar novamente com um pedido qualificado.
--   O contador NÃO reseta — fica esperando.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Adiciona coluna valor_minimo_premio (se ainda não existir)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE config_fidelidade
  ADD COLUMN IF NOT EXISTS valor_minimo_premio NUMERIC(10,2) NOT NULL DEFAULT 499.00
    CHECK (valor_minimo_premio >= 0);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Atualiza configurações: R$150 de desconto, R$499 de mínimo
-- ─────────────────────────────────────────────────────────────────────
UPDATE config_fidelidade
SET
  valor_desconto      = 150.00,
  valor_minimo_premio = 499.00,
  atualizado_em       = NOW()
WHERE id = 1;

-- ─────────────────────────────────────────────────────────────────────
-- 3. registrar_compra_fidelidade v3
--    Nova assinatura: aceita p_total para verificar pedido mínimo.
--    p_total DEFAULT 0 = backward compat (chamadas sem o parâmetro
--    continuam funcionando, mas nunca vão gerar o prêmio automático
--    a menos que valor_minimo_premio = 0).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_compra_fidelidade(
  p_user_id UUID,
  p_total   NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_novas_compras   INTEGER;
  v_desconto_100    BOOLEAN := FALSE;
  v_aguardando      BOOLEAN := FALSE;
  v_codigo          TEXT;
  v_cupom_id        UUID;
  v_premio_id       UUID;
  v_validade        TIMESTAMPTZ;
  v_meta            INTEGER;
  v_valor_desc      NUMERIC(10,2);
  v_dias_exp        INTEGER;
  v_valor_minimo    NUMERIC(10,2);
  v_ciclo           INTEGER;
  v_premio_exist    UUID;
BEGIN
  -- ── Lê configurações (com fallback) ──────────────────────────
  SELECT meta_compras, valor_desconto, dias_expiracao,
         COALESCE(valor_minimo_premio, 499.00)
  INTO   v_meta, v_valor_desc, v_dias_exp, v_valor_minimo
  FROM   config_fidelidade
  WHERE  id = 1;

  IF NOT FOUND THEN
    v_meta          := 10;
    v_valor_desc    := 150.00;
    v_dias_exp      := 30;
    v_valor_minimo  := 499.00;
  END IF;

  -- ── Garante perfil existe ─────────────────────────────────────
  INSERT INTO public.clientes_perfil (id, compras_pagas)
  VALUES (p_user_id, 0)
  ON CONFLICT (id) DO NOTHING;

  -- ── Incrementa atomicamente ───────────────────────────────────
  UPDATE public.clientes_perfil
  SET    compras_pagas = compras_pagas + 1
  WHERE  id = p_user_id
  RETURNING compras_pagas INTO v_novas_compras;

  -- ── Detecta múltiplo de meta ──────────────────────────────────
  IF v_novas_compras % v_meta = 0 THEN

    -- ── Verifica pedido mínimo ────────────────────────────────
    IF p_total < v_valor_minimo THEN
      -- Pedido não atinge o mínimo: reverte o incremento.
      -- O contador fica em (meta - 1) aguardando compra qualificada.
      UPDATE public.clientes_perfil
      SET    compras_pagas = v_novas_compras - 1
      WHERE  id = p_user_id;

      v_novas_compras := v_novas_compras - 1;
      v_aguardando    := TRUE;

      RETURN jsonb_build_object(
        'compras_pagas',      v_novas_compras,
        'desconto_100',       FALSE,
        'aguardando_minimo',  TRUE,
        'valor_minimo',       v_valor_minimo,
        'codigo',             NULL,
        'validade',           NULL,
        'premio_id',          NULL
      );
    END IF;

    -- ── Pedido qualificado → concede prêmio ───────────────────
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
    'compras_pagas',      v_novas_compras,
    'desconto_100',       v_desconto_100,
    'aguardando_minimo',  v_aguardando,
    'codigo',             v_codigo,
    'validade',           v_validade,
    'premio_id',          v_premio_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fidelidade_status v3
--    Agora retorna também valor_desconto e valor_minimo_premio.
--    O campo restam_para_100 é mantido por compatibilidade com o frontend.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fidelidade_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_compras       INTEGER;
  v_meta          INTEGER;
  v_valor_desc    NUMERIC(10,2);
  v_valor_minimo  NUMERIC(10,2);
  v_progresso     INTEGER;
  v_restam        INTEGER;
  v_premio        RECORD;
BEGIN
  -- Lê configuração
  SELECT meta_compras,
         COALESCE(valor_desconto, 150.00),
         COALESCE(valor_minimo_premio, 499.00)
  INTO   v_meta, v_valor_desc, v_valor_minimo
  FROM   config_fidelidade WHERE id = 1;

  IF NOT FOUND THEN
    v_meta         := 10;
    v_valor_desc   := 150.00;
    v_valor_minimo := 499.00;
  END IF;

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
    'compras_pagas',      v_compras,
    'meta_compras',       v_meta,
    'progresso',          v_progresso,
    'restam_para_100',    v_restam,            -- mantido para compat. frontend
    'valor_desconto',     v_valor_desc,        -- R$150
    'valor_minimo_premio', v_valor_minimo,     -- R$499
    'proximo_bonus',      ((v_compras / v_meta) + 1) * v_meta,
    'premio_ativo',       CASE WHEN v_premio IS NOT NULL THEN
                            jsonb_build_object(
                              'codigo',     v_premio.codigo,
                              'expira_em',  v_premio.expira_em,
                              'ciclo',      v_premio.ciclo
                            )
                          ELSE NULL END
  );
END;
$$;

SELECT 'Fidelidade v3: R$150 + mínimo R$499 + fidelidade_status atualizado ✓' AS resultado;
