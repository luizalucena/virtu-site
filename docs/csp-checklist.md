# Checklist — aplicar Content-Security-Policy (CSP) no site

> Status: **CSP ainda NÃO aplicada nas páginas.** O GitHub Pages ignora o `_headers`,
> então em produção o site hoje não serve CSP/X-Frame/nosniff. Este guia é para
> ativar a proteção via `<meta>` quando o visual estiver fechado — testando página a
> página para não quebrar o checkout.
>
> Origem dos valores: varredura dos recursos externos reais do site (13/07/2026).
> Único `fetch()` externo do front = `viacep.com.br` (autocompletar de CEP).

## 1. Tag a colar no `<head>` de cada `.html` (após `<meta charset>`)

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://oxivtnuxnghpddwawfdr.supabase.co https://lh3.googleusercontent.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://oxivtnuxnghpddwawfdr.supabase.co wss://oxivtnuxnghpddwawfdr.supabase.co https://viacep.com.br; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';">
```

Notas:
- `frame-ancestors 'none'` = anti-clickjacking (equivale ao X-Frame-Options, que `<meta>` não suporta).
- `X-Content-Type-Options: nosniff` **não** dá para meta — só via header real (Cloudflare/Netlify).
- Alternativa sem editar cada página: migrar hosting para **Cloudflare/Netlify Pages**, que aplicam o `_headers` nativamente (já corrigido com o viacep). Aí não precisa de `<meta>`.

## 2. Modo seguro para começar (recomendado)

Troque `Content-Security-Policy` por **`Content-Security-Policy-Report-Only`**: o navegador
**só reporta** as violações no Console, **sem bloquear**. Navegue o site inteiro, colete os
avisos, ajuste o CSP até zerar, e só então mude para o modo que bloqueia.

## 3. Como testar cada página

Abra a página → **F12 → Console**. Violação de CSP aparece em vermelho:
`Refused to connect/load '...' because it violates the following Content Security Policy directive: "..."`.
**Console limpo + função ok = aprovado.**

## 4. Checklist por página

- [ ] **index.html** — imagens dos produtos (Supabase/Drive), fontes, barra de anúncio, newsletter
- [ ] **catalogo.html** — grade com imagens, filtros de cor/tamanho, swatches
- [ ] **produto.html** — galeria (principal + hover), avaliações carregam, "Adicionar ao carrinho", compartilhar
- [ ] **carrinho.html** — itens renderizam, mudar quantidade, remover
- [ ] **checkout.html** ⭐ CRÍTICO:
  - [ ] digitar CEP → endereço preenche sozinho (`fetch` ao viacep)
  - [ ] opções de frete aparecem (edge function calcular-frete)
  - [ ] gerar PIX → QR aparece
  - [ ] formulário de cartão aceita e envia
  - [ ] finalizar um pedido de teste ponta a ponta
- [ ] **conta.html** — login, cadastro, esqueci a senha, histórico de pedidos
- [ ] **contato.html** — FAQ carrega, enviar mensagem, inscrever newsletter
- [ ] **rastreio.html** — rastrear pedido por código
- [ ] **404.html** — abre e estiliza
- [ ] **admin/** (index, pedidos, stock, cupons, fidelidade, financeiro, bazar, erros, carrinhos) — login e cada painel carrega/salva

## 5. Se algo quebrar
1. O erro do Console diz a diretiva (`connect-src`, `img-src`, …) e a URL bloqueada.
2. Adicione a origem na diretiva certa e recarregue.
3. Emergência: **remova a `<meta>`** da página — volta ao estado atual, nenhum dado afetado.

## 6. Origens permitidas (referência)
| Diretiva | Origens | Por quê |
|---|---|---|
| script-src | self, `cdn.jsdelivr.net`, unsafe-inline | Supabase JS + scripts inline |
| style-src | self, `fonts.googleapis.com`, unsafe-inline | Google Fonts + estilos inline |
| img-src | self, data:, blob:, `…supabase.co`, `lh3.googleusercontent.com` | imagens locais, Storage e Google Drive |
| font-src | self, `fonts.gstatic.com` | Google Fonts |
| connect-src | self, `…supabase.co`, `wss://…supabase.co`, `viacep.com.br` | REST/Realtime Supabase + CEP |

Links externos (`wa.me`, `instagram.com`, `pinterest.com`, `correios`) são `<a href>` de
navegação — CSP não bloqueia clique em link, então não precisam de diretiva.
