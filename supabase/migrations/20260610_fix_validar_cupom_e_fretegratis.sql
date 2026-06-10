-- =============================================================
-- MIGRATION: Corrige validar_cupom + desativa cupom FRETEGRATIS
--
-- Problemas corrigidos:
--   1. validar_cupom() não tinha SET search_path = public
--      → lançava "relation cupons does not exist" para o frontend
--      → checkout mostrava "Erro ao validar o cupom. Tente novamente."
--      → causa: padrão de segurança do Postgres busca em schemas
--               diferentes quando search_path não é fixado
--
--   2. Cupom FRETEGRATIS desativado — Grande João Pessoa já recebe
--      frete grátis automaticamente via Edge Function de cálculo;
--      o cupom estava redundante e causando confusão
-- =============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Reescreve validar_cupom com search_path correto
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validar_cupom(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom cupons%ROWTYPE;
BEGIN
  SELECT * INTO v_cupom
    FROM cupons
    WHERE lower(codigo) = lower(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Cupom não encontrado.');
  END IF;

  IF NOT v_cupom.ativo THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom está desativado.');
  END IF;

  IF v_cupom.validade IS NOT NULL AND v_cupom.validade < CURRENT_DATE THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom expirou.');
  END IF;

  IF v_cupom.uso_maximo IS NOT NULL AND v_cupom.usos >= v_cupom.uso_maximo THEN
    RETURN jsonb_build_object('valido', false, 'erro', 'Este cupom atingiu o limite de usos.');
  END IF;

  RETURN jsonb_build_object(
    'valido',        true,
    'id',            v_cupom.id,
    'codigo',        v_cupom.codigo,
    'tipo',          v_cupom.tipo,
    'valor',         v_cupom.valor,
    'valor_minimo',  v_cupom.valor_minimo,
    'descricao',     v_cupom.descricao
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Desativa FRETEGRATIS
--    Grande JP já tem frete grátis automático. O checkout.js
--    agora exibe mensagem amigável quando freteBase = 0.
-- ────────────────────────────────────────────────────────────
UPDATE cupons
SET    ativo = false
WHERE  UPPER(codigo) = 'FRETEGRATIS';
