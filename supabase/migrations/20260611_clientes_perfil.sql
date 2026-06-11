-- =============================================================
-- MIGRATION: clientes_perfil — perfil completo da cliente autenticada
-- 2026-06-11
-- =============================================================
-- Armazena dados complementares da cliente (Nome, CPF, WhatsApp,
-- Endereço) para checkout de 1 clique e programa de fidelidade.
-- Vinculada 1:1 com auth.users.
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela clientes_perfil
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes_perfil (
  id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nome            TEXT,
  cpf             TEXT,
  whatsapp        TEXT,
  -- endereço padrão
  cep             TEXT,
  rua             TEXT,
  numero          TEXT,
  complemento     TEXT,
  bairro          TEXT,
  cidade          TEXT,
  estado          CHAR(2),
  -- fidelidade
  compras_pagas   INTEGER NOT NULL DEFAULT 0,
  -- timestamps
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. RLS — cliente só vê/edita o próprio perfil
-- ────────────────────────────────────────────────────────────
ALTER TABLE clientes_perfil ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas o próprio usuário
CREATE POLICY "perfil_select_proprio"
  ON clientes_perfil FOR SELECT
  USING (auth.uid() = id);

-- Inserção: apenas o próprio usuário
CREATE POLICY "perfil_insert_proprio"
  ON clientes_perfil FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Atualização: apenas o próprio usuário
CREATE POLICY "perfil_update_proprio"
  ON clientes_perfil FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ────────────────────────────────────────────────────────────
-- 3. Trigger: atualiza atualizado_em automaticamente
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_atualizar_ts_perfil()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atualizar_ts_perfil ON clientes_perfil;
CREATE TRIGGER trg_atualizar_ts_perfil
  BEFORE UPDATE ON clientes_perfil
  FOR EACH ROW EXECUTE FUNCTION fn_atualizar_ts_perfil();

-- ────────────────────────────────────────────────────────────
-- 4. Trigger: cria perfil vazio ao criar usuário (opcional)
--    Facilita lookup sem INSERT prévio na conta.js
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_criar_perfil_usuario()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.clientes_perfil (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_criar_perfil_usuario ON auth.users;
CREATE TRIGGER trg_criar_perfil_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_criar_perfil_usuario();

-- ────────────────────────────────────────────────────────────
-- 5. RPC: incrementar compras e detectar 10ª (fidelidade)
--    Retorna se deve aplicar desconto de R$100.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_compra_fidelidade(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_novas_compras  INTEGER;
  v_desconto_100   BOOLEAN := FALSE;
BEGIN
  -- Garante que o perfil existe
  INSERT INTO public.clientes_perfil (id, compras_pagas)
  VALUES (p_user_id, 0)
  ON CONFLICT (id) DO NOTHING;

  -- Incrementa atomicamente
  UPDATE public.clientes_perfil
  SET    compras_pagas = compras_pagas + 1
  WHERE  id = p_user_id
  RETURNING compras_pagas INTO v_novas_compras;

  -- Detecta múltiplos de 10 (10ª, 20ª, 30ª…)
  IF v_novas_compras % 10 = 0 THEN
    v_desconto_100 := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'compras_pagas', v_novas_compras,
    'desconto_100',  v_desconto_100
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. RPC pública: retorna progresso de fidelidade da cliente
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fidelidade_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_compras INTEGER;
  v_restam  INTEGER;
BEGIN
  SELECT compras_pagas INTO v_compras
  FROM   public.clientes_perfil
  WHERE  id = p_user_id;

  IF NOT FOUND THEN
    v_compras := 0;
  END IF;

  v_restam := 10 - (v_compras % 10);
  IF v_restam = 10 THEN v_restam := 0; END IF; -- acabou de completar 10

  RETURN jsonb_build_object(
    'compras_pagas',   v_compras,
    'restam_para_100', v_restam,
    'proximo_bonus',   (v_compras / 10 + 1) * 10
  );
END;
$$;
