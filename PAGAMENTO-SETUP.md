# Virtù — Guia de Configuração de Pagamentos

## Pré-requisitos
- Conta no [Mercado Pago](https://www.mercadopago.com.br) ✓
- Supabase CLI instalado: `npm install -g supabase`
- Projeto Supabase já criado ✓

---

## PASSO 1 — Tabela de Pedidos no Supabase

1. Acesse **Supabase → SQL Editor**
2. Cole e execute o conteúdo de `supabase/migrations/20260526_pedidos.sql`
3. Confirme que a tabela `pedidos` aparece em **Table Editor**

---

## PASSO 2 — Credenciais do Mercado Pago

### 2.1 Obtenha suas chaves
1. Acesse [mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel)
2. Crie um aplicativo ou use o existente
3. Copie:
   - **Public Key** (começa com `TEST-` em sandbox ou `APP_USR-` em produção)
   - **Access Token** (começa com `TEST-` ou `APP_USR-`)

### 2.2 Configure o frontend
Abra `js/checkout.js` e substitua na linha 10:
```js
const MP_PUBLIC_KEY = 'SEU_PUBLIC_KEY_AQUI';
```

### 2.3 Configure o segredo da Edge Function
```bash
# No terminal, dentro da pasta do projeto:
supabase secrets set MP_ACCESS_TOKEN="SEU_ACCESS_TOKEN_AQUI"
```

**⚠️ NUNCA coloque o Access Token no frontend. Ele fica apenas no servidor.**

---

## PASSO 3 — Deploy da Edge Function

```bash
# Faça login no Supabase CLI
supabase login

# Vincule ao seu projeto (use o Project ID do Supabase Dashboard)
supabase link --project-ref SEU_PROJECT_ID

# Faça o deploy da função
supabase functions deploy processar-pagamento --no-verify-jwt
```

### Anote a URL da função:
```
https://SEU-PROJETO.supabase.co/functions/v1/processar-pagamento
```

### Configure a URL no frontend
Abra `js/checkout.js` e substitua na linha 15:
```js
const EDGE_FUNCTION_URL = 'https://SEU-PROJETO.supabase.co/functions/v1/processar-pagamento';
```

---

## PASSO 4 — Teste em Sandbox

Use os cartões de teste do Mercado Pago:

| Situação   | Número               | Nome          | Validade | CVV |
|------------|----------------------|---------------|----------|-----|
| Aprovado   | 5031 4332 1540 6351  | APRO          | 11/25    | 123 |
| Recusado   | 5031 4332 1540 6351  | OTHE          | 11/25    | 123 |
| Pendente   | 5031 4332 1540 6351  | CONT          | 11/25    | 123 |

Para PIX em sandbox, qualquer valor funciona — o QR Code é gerado mas não processa pagamento real.

### CEPs para testar o frete:
- ✅ `58020-000` (João Pessoa) → Frete R$ 10,00
- ✅ `58032-100` (Bessa, JP)   → Frete R$ 10,00  
- ❌ `01310-100` (São Paulo)    → "Entregamos apenas em João Pessoa"
- ❌ `20040-020` (Rio de Janeiro) → mensagem de erro

---

## PASSO 5 — Ir para Produção

1. No painel do Mercado Pago, troque para **credenciais de produção**
2. Substitua `MP_PUBLIC_KEY` no `checkout.js` pela chave de produção
3. Execute `supabase secrets set MP_ACCESS_TOKEN="ACCESS_TOKEN_PRODUCAO"`
4. Faça novo deploy: `supabase functions deploy processar-pagamento --no-verify-jwt`

---

## Monitoramento de Pedidos

Os pedidos ficam na tabela `pedidos` do Supabase com os campos:
- `status`: pendente → pago → recusado
- `payment_id`: ID do Mercado Pago (para consultas no painel deles)
- `pix_qr_code`: código copia e cola (quando PIX)

Para ver pedidos: **Supabase → Table Editor → pedidos**

---

## Fluxo Técnico Resumido

```
FRONTEND                    EDGE FUNCTION              MERCADO PAGO
────────                    ─────────────              ────────────
1. User clica Finalizar
2. [Cartão] MP SDK          
   tokeniza dados do cartão
   → retorna token seguro
3. Envia payload ─────────► 4. Recebe payload
                               5. Chama MP API ───────► 6. Processa pagamento
                               7. Salva pedido no DB ◄─── 8. Retorna status/QR
8. Retorna resultado ◄──────
9. [PIX] Exibe QR Code
   [Cartão] Aprovado/Recusado
10. Decrementa estoque
11. Limpa carrinho
```
