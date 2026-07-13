# Deploy — Precificação 2026-07 (taxa 5%, ,90, frete nacional, gift card R$100)

> Mudanças commitadas no branch **staging** (commits `44c9767` + `cd35538`).
> **Nada foi aplicado em produção.** Este é o passo-a-passo para publicar
> quando a Luíza autorizar. Projeto Supabase de produção: `oxivtnuxnghpddwawfdr`.

## Ordem de execução (importante: banco antes das funções)

### 1. Aplicar a migration (cria gift card + desativa fidelidade antiga)
- Arquivo: `supabase/migrations/20260713_gift_card_100.sql`
- Cria coluna `pedidos.gift_card_aplicado`, RPC `gift_card_status`, desativa
  `config_fidelidade.ativo` e alinha `configuracoes.frete_gratis_acima = 799`.
- Reversível: a coluna e a RPC podem ser dropadas; o histórico de
  `premios_fidelidade`/`config_fidelidade` é preservado.
- Rodar via `supabase db push` (CLI) ou colar no SQL Editor. Confere o `SELECT`
  final imprimindo a mensagem de sucesso.

### 2. Deploy das Edge Functions
Deploy nesta ordem (todas dependem da migration acima):
- `processar-pagamento`  — taxa 5%, pipeline ,90, gift card, frete anti-tamper
- `calcular-frete`       — regiões nacionais + grátis ≥799
- `asaas-webhook`        — remove a fidelidade antiga (gift card auto-reverte)

`supabase functions deploy processar-pagamento calcular-frete asaas-webhook`

### 3. Verificar advisors de segurança
`get_advisors` (security + performance) — confirmar que a nova RPC não abriu
brecha (deve estar REVOKE anon, GRANT authenticated/service_role).

## Testes obrigatórios em SANDBOX antes do go-live (ASAAS sandbox = 'true')
- [ ] **PIX**: total = base, sem taxa; QR gerado. Total termina em ,90.
- [ ] **Crédito**: +5%, total ,90; parcelas somam exatamente o total (conferir
      no ASAAS que `totalValue`/`installmentCount` foi aceito — ⚠️ ponto novo).
- [ ] **Débito**: +5%, igual ao crédito à vista.
- [ ] **Frete**: CEP JP → grátis; NE <799 → R$18; SP <799 → R$29,90; Manaus <799
      → R$19,90; qualquer CEP com subtotal ≥799 → grátis.
- [ ] **Gift card**: cliente com ≥6 compras pagas em dias diferentes e subtotal
      ≥459 → −R$100 (1x). 5 pedidos pagos no mesmo dia → NÃO destrava. Após usar
      num pedido pago → não aplica de novo. Cancelar/estornar esse pedido →
      volta a ficar disponível.
- [ ] **Segurança**: forçar total/frete/gift card errados no payload → backend
      recomputa e cobra o valor certo (ou recusa o frete inválido).

## ⚠️ Pontos de atenção
- **ASAAS parcelado**: passamos a enviar `totalValue` + `installmentCount` (em
  vez de `value` + `installmentValue`) para a soma das parcelas bater exata.
  Confirmar no sandbox que o ASAAS aceita e divide corretamente antes da prod.
- **Frete Norte/CO (R$19,90) < Sul/Sudeste (R$29,90)** — valores informados;
  incomum, confirmar se é intencional.
- **Embalagem presente** não entra no subtotal de produtos para gift card (≥459)
  nem para frete grátis (≥799) — igual ao backend.

## 4. Publicar (só após sandbox OK)
- Merge `staging` → `main` (dispara GitHub Pages).
- Trocar `ASAAS_SANDBOX` para `false` quando for cobrar de verdade (se aplicável).
