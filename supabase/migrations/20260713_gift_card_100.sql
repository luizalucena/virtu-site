-- =====================================================================
-- MIGRATION: Gift Card R$100 — clientes fiéis (Virtù)
-- 2026-07-13
-- =====================================================================
-- Substitui o antigo desconto automático de R$100 (subtotal ≥ R$1.000,
-- sem gate) e o prêmio de fidelidade a cada 10 compras por um modelo de
-- GIFT CARD de uso único vitalício:
--
--   • Elegibilidade: cliente LOGADO com MAIS de 5 compras VÁLIDAS (≥ 6).
--   • "Compra válida" = pedido PAGO, contando NO MÁXIMO 1 por dia
--     (deduplica por data(dia) de pagamento — anti-fracionamento).
--     Pedidos cancelados/recusados/reembolsados NÃO contam.
--   • Benefício: R$100 de desconto em pedidos com subtotal ≥ R$459,00.
--   • USO ÚNICO VITALÍCIO: ao ser resgatado num pedido PAGO, o gift card
--     é considerado consumido para sempre. Se esse pedido for
--     cancelado/estornado, o consumo é revertido automaticamente (o
--     modelo deriva o consumo do próprio status do pedido — ver abaixo).
--
-- MODELO SEM ESTADO EXTRA (self-healing):
--   O "consumo" é DERIVADO da tabela `pedidos`, não guardado num flag
--   separado. Marcamos apenas `pedidos.gift_card_aplicado = true` no
--   pedido que usou o benefício. Assim:
--     - consumido (vitalício) ⇔ existe pedido PAGO com gift_card_aplicado.
--     - reversão em cancelamento/estorno é automática: o pedido deixa de
--       ter status 'pago' → o gift card volta a ficar disponível.
--     - PIX pendente não-expirado "segura" o benefício (em_uso) para
--       impedir uso paralelo; se expirar sem pagar, libera sozinho.
--
-- Toda a validação é feita no BACKEND (Edge Function processar-pagamento
-- chama gift_card_status via service_role e recomputa o total). O frontend
-- só EXIBE — nunca decide o desconto.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Coluna de rastreio no pedido
--    Marca o pedido que resgatou o gift card. Fonte de verdade do consumo.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS gift_card_aplicado BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice parcial: acelera a checagem de consumo/uso por cliente.
CREATE INDEX IF NOT EXISTS idx_pedidos_gift_card
  ON public.pedidos (user_id, status)
  WHERE gift_card_aplicado = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Função: gift_card_status(p_user_id)
--    Retorna elegibilidade e diagnóstico. SECURITY DEFINER para ler
--    `pedidos` ignorando RLS, mas só expõe agregados (sem PII).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gift_card_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Parâmetros do programa (constantes de negócio)
  c_min_compras   CONSTANT INTEGER       := 6;       -- MAIS de 5 → ≥ 6
  c_valor         CONSTANT NUMERIC(10,2) := 100.00;  -- desconto
  c_min_subtotal  CONSTANT NUMERIC(10,2) := 459.00;  -- pedido mínimo

  v_compras_validas INTEGER := 0;
  v_consumido       BOOLEAN := FALSE;
  v_em_uso          BOOLEAN := FALSE;
BEGIN
  -- Anti-sondagem: um cliente autenticado (auth.uid() não-nulo) só pode
  -- consultar o PRÓPRIO status. O backend (service_role) tem auth.uid()
  -- nulo e pode consultar qualquer user_id.
  IF p_user_id IS NULL
     OR (auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN jsonb_build_object(
      'elegivel', FALSE, 'compras_validas', 0, 'consumido', FALSE,
      'em_uso', FALSE, 'valor', c_valor, 'min_subtotal', c_min_subtotal,
      'min_compras', c_min_compras
    );
  END IF;

  -- Compras válidas: pedidos PAGOS, no máximo 1 por dia (distinct por data,
  -- fuso da loja). Cancelados/recusados/reembolsados ficam de fora.
  SELECT COUNT(DISTINCT ((criado_em AT TIME ZONE 'America/Recife')::date))
  INTO   v_compras_validas
  FROM   public.pedidos
  WHERE  user_id = p_user_id
    AND  status  = 'pago';

  -- Consumido (vitalício): já existe um pedido PAGO que usou o gift card.
  SELECT EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE user_id = p_user_id
      AND gift_card_aplicado = TRUE
      AND status = 'pago'
  ) INTO v_consumido;

  -- Em uso: existe um PIX pendente (não expirado) que já reservou o gift
  -- card. Bloqueia uso paralelo, mas libera sozinho quando o PIX expira.
  SELECT EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE user_id = p_user_id
      AND gift_card_aplicado = TRUE
      AND status = 'pendente'
      AND (pix_expires_at IS NULL OR pix_expires_at > NOW())
  ) INTO v_em_uso;

  RETURN jsonb_build_object(
    'elegivel',        (v_compras_validas >= c_min_compras) AND NOT v_consumido AND NOT v_em_uso,
    'compras_validas', v_compras_validas,
    'consumido',       v_consumido,
    'em_uso',          v_em_uso,
    'valor',           c_valor,
    'min_subtotal',    c_min_subtotal,
    'min_compras',     c_min_compras
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Permissões (padrão do projeto: revoga anon; libera authenticated +
--    service_role — igual a fidelidade_status).
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.gift_card_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gift_card_status(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Aposenta o programa antigo (a cada 10 compras → cupom R$150).
--    Não apagamos histórico (premios_fidelidade/config_fidelidade ficam),
--    apenas desativamos a geração automática de novos prêmios.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.config_fidelidade
SET ativo = FALSE, atualizado_em = NOW()
WHERE id = 1;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Frete grátis Brasil ≥ R$799 — alinha o valor exibido no carrinho
--    (carrinho.js lê configuracoes.frete_gratis_acima) com a regra fixa
--    das Edge Functions (processar-pagamento / calcular-frete).
--    Só atualiza se a coluna existir (defensivo).
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'configuracoes' AND column_name = 'frete_gratis_acima'
  ) THEN
    UPDATE public.configuracoes SET frete_gratis_acima = 799.00 WHERE id = 1;
  END IF;
END $$;

SELECT 'Gift Card R$100 (≥6 compras válidas, mín. R$459, uso único vitalício) + frete grátis ≥R$799 ✓' AS resultado;
