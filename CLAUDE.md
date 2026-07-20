# CLAUDE.md — Procedimento Padrão da Loja Virtù

> Este arquivo padroniza como o Claude pensa, projeta e executa **toda** tarefa neste
> projeto. Deve ser lido no início de cada sessão e seguido sem exceção.
> Em caso de conflito entre uma instrução pontual da Luíza e este documento, a
> instrução dela prevalece — mas o Claude deve apontar o conflito antes de agir.

---

## 1. O que é a Virtù

Loja virtual de moda (marca **VIRTÙ**, domínio **wearvirtu.com**), público brasileiro,
estética boutique/luxo. Site estático servido em produção, com backend serverless.

**Stack real (não presumir nada além disto sem verificar):**

- **Frontend:** HTML + CSS + JavaScript puro (vanilla). **Sem framework, sem build, sem bundler.** Cada página é um `.html` na raiz com seu `.css` e `.js` próprios.
- **Backend:** Supabase (Postgres + Edge Functions em TypeScript/Deno) em `supabase/`.
- **Pagamentos:** integração via Asaas/PIX e Mercado Pago (ver `PAGAMENTO-SETUP.md`).
- **Deploy:** produção `wearvirtu.com` roda na **Vercel** (header `server: Vercel`), que auto-deploya do branch `main` do GitHub. Git push para `origin/main` → Vercel gera o deploy de produção. (Havia `CNAME` de uma fase antiga em GitHub Pages, mas o serving atual é Vercel — confirmado por header.)
- **Idioma do produto e do código:** português (pt-BR), incluindo nomes de arquivos, funções e commits.

**Mapa rápido:**

- Páginas: `index, catalogo, produto, carrinho, checkout, conta, contato, sobre, politicas, rastreio` (`.html` na raiz).
- `css/` — um arquivo por página + `style.css` (base/tokens), `virtu-luxury.css`, `virtu-refinements.css`.
- `js/` — um arquivo por página + utilitários (`main.js`, `products.js`, `supabase-config.js`, etc.).
- `admin/` — painel administrativo (pedidos, cupons, fidelidade, financeiro, estoque, erros).
- `supabase/functions/` — Edge Functions; `supabase/migrations/` — SQL versionado.
- `data/products.json` — catálogo. `images/` — mídia. `_headers` — cache e segurança HTTP.

---

## 2. Princípios de pensamento (antes de tocar em qualquer coisa)

1. **Entender antes de agir.** Ler os arquivos relevantes de verdade. Nunca presumir como algo funciona — confirmar no código.
2. **Respeitar a stack.** Vanilla é uma decisão, não uma limitação. Não introduzir framework, dependência ou etapa de build sem aprovação explícita.
3. **Mudança mínima viável.** Resolver o problema com a menor alteração possível. Não refatorar de carona.
4. **Seguir o padrão existente.** Imitar a estrutura, a nomenclatura e o estilo já presentes no projeto antes de inventar um novo.
5. **Pensar como dono da loja.** Cada decisão afeta conversão, confiança do cliente e receita. Priorizar clareza, velocidade e funcionamento em produção.
6. **Verificar, não torcer.** Toda entrega passa por checagem própria antes de ser considerada pronta.

---

## 3. Procedimento padrão por tarefa (o fluxo)

Toda tarefa segue estas etapas, nesta ordem:

1. **Enquadrar** — Reformular o pedido em uma frase: qual é o resultado esperado e como sabemos que deu certo.
2. **Investigar** — Ler os arquivos envolvidos (HTML + CSS + JS da página, função Supabase, migration). Mapear dependências antes de editar.
3. **Planejar** — Listar as mudanças concretas (quais arquivos, o quê). Para tarefas de 3+ passos, registrar no task list. Se houver ambiguidade real ou decisão de produto, **perguntar antes** (não adivinhar escopo).
4. **Executar** — Aplicar a menor mudança que resolve, seguindo as convenções da seção 5.
5. **Verificar** — Rodar a checklist da seção 6. Corrigir o que falhar.
6. **Entregar** — Resumir em 1–2 frases o que mudou e por quê. Compartilhar arquivos quando relevante. Só fazer `git push` quando a Luíza pedir ou já tiver combinado (ver seção 4).

---

## 4. Regras de execução (git, deploy, segredos)

- **Push = deploy.** `origin/main` publica em produção via **Vercel** (auto-deploy do `main`). Não dar `git push` por conta própria — confirmar com a Luíza, salvo combinação prévia. Não há Vercel CLI no ambiente local; se o deploy não refletir, é ação no painel da Vercel (Luíza).
- **Commits:** mensagens em pt-BR no padrão já usado no repo: `tipo(escopo): descrição` (ex.: `fix(galeria): corrige imagem principal`, `feat(fidelidade): desconto automático`). Tipos: `feat, fix, refine, perf, chore, redesign`.
- **Commits pequenos e temáticos** — um assunto por commit.
- **Segredos:** NUNCA commitar ou expor tokens, chaves de API ou senhas. Service-role keys do Supabase e tokens de pagamento ficam só nas Edge Functions / variáveis de ambiente — nunca no frontend. A chave do frontend deve ser apenas a `anon` pública.
- **`data/products.json` e migrations** são fonte de verdade — alterar com cuidado e nunca apagar histórico de migration.

---

## 5. Padrões de projeto e código

**Geral**

- Português em nomes de arquivos, variáveis, funções e comentários, seguindo o que já existe.
- Um arquivo CSS e um JS por página, com o mesmo nome da página. Lógica compartilhada vai para os utilitários existentes (`main.js`, `products.js`), não duplicada.

**CSS**

- Usar SEMPRE os design tokens de `css/style.css` (`:root`). Nunca cravar cor, fonte ou espaçamento em valor fixo quando existe variável.
  - Cores-chave: `--color-navy` (#2B3F54, âncora), `--color-gold` (#C4934A, acentos/preços), `--color-off-white` (#FAF8F5, fundo).
  - Fontes: `--font-display` (Cormorant Garamond, títulos), `--font-body` (Jost, corpo).
  - Escalas de `--text-*` e `--space-*` para tipografia e espaçamento.
- Mobile precisa funcionar: respeitar os breakpoints e overrides já definidos.
- Manter a estética boutique/luxo: sóbria, espaçada, sem excesso.

**JavaScript**

- Vanilla JS, sem dependências novas. Manter o estilo dos arquivos vizinhos.
- Acesso a dados via `supabaseClient` (definido em `supabase-config.js`). Sempre tratar erro e estado de carregamento.
- Não quebrar contratos entre frontend e Edge Functions (nomes de campos, formato de payload).

**Supabase**

- Antes de mexer em schema: inspecionar tabelas existentes; mudanças via **migration** versionada em `supabase/migrations/`, não ad-hoc.
- Edge Functions: TypeScript/Deno, padrão dos arquivos já existentes em `supabase/functions/`.
- Validar dados no backend; nunca confiar só no frontend para regras de pagamento, estoque ou preço.

**Skills de design — prioridade (IMPORTANTE)**

- A skill **`taste-skill`** é a AUTORIDADE em toda decisão visual/de marca da Virtù: paleta, tipografia, bordas arredondadas, contraste, espaçamento, motion, conversão e os "AI tells" a evitar. Carregar e seguir a `taste-skill` em qualquer tarefa de UI/estilo.
- Em caso de **conflito entre a `taste-skill` e qualquer outra skill de design** (ex.: `ui-ux-pro-max` / UI-UX Pro Max), a **`taste-skill` SEMPRE prevalece**. As demais skills entram apenas como apoio técnico (acessibilidade, contraste, espaçamento, checagens), nunca para sobrepor a identidade da marca (cores, fontes, estilo).
- Não adotar paletas, fontes, componentes ou estilos sugeridos por outras skills se contrariarem a `taste-skill`. Na dúvida, seguir a `taste-skill` e apontar o conflito para a Luíza.

---

## 6. Checklist de verificação (antes de dar por pronto)

- [ ] A mudança resolve exatamente o que foi pedido — nada a mais, nada a menos.
- [ ] Segue tokens de CSS e convenções de nomenclatura do projeto.
- [ ] Funciona em **mobile e desktop** (conferir layout responsivo).
- [ ] JS sem erro no console; estados de erro/carregamento tratados.
- [ ] Nenhum segredo, token ou chave privada exposto no frontend ou em commit.
- [ ] Links, imagens e caminhos relativos corretos (o site é estático).
- [ ] Contrato frontend ↔ Supabase intacto.
- [ ] Para mudanças visíveis: revisar o resultado renderizado (screenshot/preview) antes de entregar.
- [ ] Migrations aplicáveis e reversíveis; nada de dado de produção apagado por engano.

---

## 7. Comunicação com a Luíza

- Responder em **português**, direto e conciso (sem enrolação ou preâmbulo).
- Quando houver decisão de produto/negócio (preço, política, fluxo de compra), **perguntar** em vez de assumir.
- Ao terminar: o que mudou, por que, e o próximo passo se houver. Sem recapitular cada passo.
- Sinalizar proativamente riscos: segredos expostos, links quebrados, impacto em produção, custo.

---

## 8. Pendências / riscos conhecidos

### Estado atual — pós go-live (17/07/2026)

**Site PUBLICADO e no ar** (`wearvirtu.com`, GitHub Pages). `main` == `staging`. Fluxos verificados ao vivo (console limpo em todas as páginas). Foram ao ar: estoque atômico por variação + restauração no cancelamento (trigger `trg_pedido_cancelado_restaura`), refino mobile, reset de senha (cliente + admin, com `recovery-catcher.js`), remoção do boleto (só crédito/débito/pix), stepper do checkout, precificação 2026-07, e reenvio de confirmação no login. Hardening: EXECUTE das funções de trigger revogado (lints 0028/0029).

**⚠️ AÇÕES DA LUÍZA (painel/infra — NÃO dá por código):**
1. **Supabase → Authentication → URL Configuration.** ⚠️ O domínio CANÔNICO é **`www.wearvirtu.com`** (o apex `wearvirtu.com` faz 308 → `www`). Como o cliente real fica em `www`, o `window.location.origin` do site é `https://www.wearvirtu.com`, então o `emailRedirectTo` gerado é COM `www`. A config precisa bater com isso:
   - **Site URL** = `https://www.wearvirtu.com`
   - **Redirect URLs** (allow list): `https://www.wearvirtu.com/conta.html`, `https://www.wearvirtu.com/admin/index.html` (as versões SEM www não batem com o que o cliente real manda). (+ preview Vercel da staging se testar lá.)
   - Confirmar **"Confirm email" = ON** e o template "Confirm signup"/"Reset password" usando `{{ .ConfirmationURL }}`.
   - Status 17/07: Luíza registrou as entradas `www.`; falta só o teste final de confirmação (estava bloqueado por rate-limit de e-mail do meu bombardeio de testes).
2. **ASAAS**: validar um **PIX real** (conferir chave PIX na conta — teste antigo veio com QR nulo) + **1 pedido em cartão real** (crédito parcelado + débito) de valor baixo.
3. **Financeiro no cancelamento** = decisão dela: "deixar manual" (não há estorno automático no `fluxo_caixa`; ela ajusta à mão).

**Deferido de propósito (não é risco real):** `pg_net` no schema public (em uso); políticas de INSERT públicas em contato/newsletter/carrinhos_abandonados/logs (por design — mitigação seria rate-limit, opcional); CSP/headers em produção (GitHub Pages ignora `_headers`; migrar p/ Cloudflare/Netlify ou `<meta>` CSP com teste cuidadoso — não fazer no automático em site de pagamento); leaked-password protection (só plano Pro).

### Correções pré-lançamento — 14/07/2026

**✅ Aplicado (repo = banco = produção, tudo em `staging` pushado):**
- **BUG 1 — CORS**: allowlist compartilhada em `supabase/functions/_shared/cors.ts` (produção + `localhost` + `*.github.io` + `*.vercel.app`), refletindo a Origin nas 2 functions do navegador (`calcular-frete`, `processar-pagamento`) e `buildCorsHeaders(null)` nas 5 server-to-server. Staging (Vercel) desbloqueado.
- **BUG 2/3 — conta**: `emailRedirectTo` no signUp; senha mín. 8; `traduzirErroAuth()` central (sem inglês cru). ⚠️ Falta no dashboard: **Site URL = wearvirtu.com** + redirect allowlist.
- **BUG 4 — produto**: cards de Peças Relacionadas clicáveis (`data-id` + imagem em `<a>`).
- **Sweep A — admin**: `admin.js` exige `is_virtu_admin()` no frontend (cliente logada não-admin é deslogada); backend já tinha guard nas RPCs.
- **Sweep B**: `search_path` fixo nas 3 funções de timestamp. `pg_net` NÃO movido (em uso por 2 funções).
- **Gift card R$100 (rollout de julho)**: migrations `20260713_gift_card_100` + `20260714_gift_card_min_499` aplicadas (coluna `pedidos.gift_card_aplicado`, RPC `gift_card_status` anon-revogada, fidelidade antiga desativada, **mínimo R$499**). Isto DESTRAVOU o checkout — as functions já estavam live sem a migration → o INSERT do pedido quebrava.
- **Frete (b)**: NE R$18, Sul/Sudeste R$19,90, Norte/CO R$29,90, grátis ≥R$799. `calcular-frete` (oferta) e `processar-pagamento` (anti-tamper) alinhados.
- **Quantidade**: rejeita qty negativa/zero/fracionária (inteiro 1–50).

**⚠️ Pendente para o go-live:**
- **Teste de pagamento em SANDBOX**: bloqueado porque a `ASAAS_API_KEY` é de produção mas `ASAAS_SANDBOX=true` (a API sandbox rejeita → 502 "erro ao registrar cliente"). Ação: usar chave do `sandbox.asaas.com` para testar; trocar para chave de PRODUÇÃO + `ASAAS_SANDBOX=false` no go-live. Rodar os testes do `DEPLOY-PRECIFICACAO-2026-07.md` (PIX/crédito parcelado `totalValue`+`installmentCount`/débito/gift card).
- **CSP**: `<meta>` sendo adicionada por página (a Luíza começou); no `checkout.html` incluir `https://viacep.com.br` no `connect-src`.
- **Publicar frontend**: merge `staging` → `main` após os testes.
- **Coordenação**: deploys de function só a partir do repo (fonte única) — houve colisão por deploy/edição em paralelo.

**⏳ Opcionais (não bloqueiam):** BUG 5 (redesign do carrinho), Sweep C (inline styles do checkout → tokens), aba "Fidelidade" da conta reflete programa antigo (avaliar trocar pelo gift card).

### Re-auditoria de lançamento — 13/07/2026 (veredito: GO)

Re-verificação completa com foco em pagamento. **Nenhum bloqueador Crítico/Alto.**

**✅ Reconfirmado em produção (sem mudança necessária):**
- **Pagamento**: `processar-pagamento` recalcula preço/frete/cupom/fidelidade/estoque no servidor; idempotência ativa; cartão nunca logado nem persistido (só alimenta `chargeBody.creditCard`→ASAAS). `asaas-webhook` é idempotente (update atômico `.eq('status','pendente')`) e fail-closed (testado ao vivo: 401 sem/`token` errado → `ASAAS_WEBHOOK_TOKEN` configurado). `calcular-frete` espelha exatamente o `fretesPermitidos()`. Contrato `qty` front↔back correto (carrinho usa `qty`).
- **Sem segredos no front**; admin protegido por RLS + `is_virtu_admin()`; avaliações (conteúdo de usuário) escapadas com `escHtml`.

**🔴 CRÍTICO corrigido em produção (13/07, 2ª passagem):**
- **Pagamento fantasma via INSERT direto (`pedidos`)**: a policy `pedidos_insert_seguro` deixava anon/authenticated inserir em `pedidos` sem restringir `status` → com a anon key pública dava para criar pedido `status='pago'` sem passar pelo ASAAS (contornando o anti-fraude + disparando baixa de estoque). **Provado em produção** (INSERT anon passou pela RLS). Migration `20260713_pedidos_bloqueia_insert_cliente.sql` removeu a policy (a criação é feita só pelo edge function com service_role, que ignora RLS). Re-teste pós-fix: anon → 42501. **⚠️ O advisor NÃO pegou isso** (o `WITH CHECK` não era literalmente `true`) — advisor é necessário, não suficiente.
- **Quantidade negativa/zero/fracionária**: `processar-pagamento` usava `Number(qty)||1`, aceitando `qty` negativo (reduziria o valor cobrado e burlaria estoque). Agora exige inteiro 1–50. Deployado + testado (qty -5/0/2.5 → 400).

**✅ Corrigido nesta rodada (commits locais, sem push):**
- **B2 — escape defense-in-depth**: `products.js` (nome/categoria/badge/cor/newsletter) e `contato.js` (faq/newsletter) — dados de admin escapados via `escHtml`.
- **B4 — índices duplicados**: migration `20260713_remove_indices_duplicados.sql` removeu 4 pares idênticos (verificado no banco).
- **B1 — limpeza de Edge Functions órfãs**: deletadas `clever-service`, `smart-responder`, `virtusite` (templates `Hello` do Supabase, não usados; código guardado se precisar recriar).

**⏸️ Adiado de propósito (pós-lançamento):**
- **B3 — perf RLS (`auth.fn()`→`(select auth.fn())`)**: mexe em ~10 policies; ganho só em escala. Evitar rewrite de RLS na semana do lançamento.
- Hardening dos lints 0028/0029: revogar EXECUTE das funções de trigger (no-op quando chamadas direto) e `search_path` nos 3 triggers de timestamp. Não é risco real.

**⚠️ Ação da Luíza (não-código):** validar pagamento E2E (PIX/cartão real ou sandbox); confirmar `Confirm email = ON` (Auth); rodar `node --check` local.

### Auditoria completa — 29/06/2026 (segurança + qualidade)

**✅ Aplicado em produção e verificado:**
- **RPCs `SECURITY DEFINER` travadas (CRÍTICO):** anon podia manipular o inventário (`ajustar_estoque`, `definir_estoque`, `criar/atualizar/toggle_variacao`), vazar PII (`carrinhos_para_followup`), gerar prêmio sem comprar (`registrar_compra_fidelidade`) e ler financeiro das consignatárias. Migration `20260629_revoke_rpc_anon_e_search_path.sql` — REVOKE anon + guarda `is_virtu_admin()` + `search_path` fixo. Advisor confirmou o fechamento.
- **`processar-pagamento` anti-fraude (deployado):** valida subtotal/frete/cupom/estoque no servidor (A1/A2/A4/A6/A7/A8). Smoke-test OK (item e frete adulterados → 400). Uso de cupom é registrado pelo trigger `trg_registrar_uso_cupom` (não duplicar no código).
- **A5 — idempotência do checkout (deployado):** retry/timeout/duplo-clique não gera mais cobrança dupla. `checkout.js` envia `idempotency_key` (estável por tentativa via `sessionStorage`, atrelada ao carrinho); a função, ao reencontrar a chave num pedido não recusado, devolve o pedido original **sem nova cobrança ASAAS**. Migration `20260629_idempotency_pedidos.sql` (coluna + índice). Retrocompatível (chave opcional). Testado em produção: 2ª chamada com a mesma chave → `duplicado:true`, sem cobrança. **Ativa de fato quando o `checkout.js` for publicado (push em `main`).**

**⚠️ Pendente (decisão/ação da Luíza):**
- **Confirmação de e-mail:** verificar em Auth → "Confirm email" se está ON.
- **Baixo/cosmético:** escape em `bazar.js`/`contato.js` (dados de admin); rate limit nos INSERTs públicos (contato/newsletter); `search_path` em 3 triggers de timestamp; índices duplicados/não usados (advisor performance).

### Auditoria de segurança — 26/06/2026

**✅ Resolvido (já em produção):**
- **C1 — Vazamento de pedidos:** a policy `rastreio_por_uuid` (`SELECT public USING(true)`) deixava a anon key ler TODA a tabela `pedidos` (CPF, endereço, telefone). Removida. Rastreio agora usa a função `rastrear_pedido(uuid)` (`SECURITY DEFINER`, só colunas não sensíveis) + polling no `rastreio.html`. Migration `20260625_fix_rls_seguranca.sql`.
- **C2 — Controle de admin:** confirmado OK. `is_virtu_admin()` (allowlist = `wearvirtu@gmail.com` + `service_role`) protege produtos, configuracoes, cupons, fluxo_caixa, config_fidelidade, bazar_pecas e pedidos. **O login do painel TEM que ser `wearvirtu@gmail.com`** — mudar a allowlist na função se trocar.
- **A1 — Webhook de pagamento:** `asaas-webhook` agora é fail-closed (sem `ASAAS_WEBHOOK_TOKEN` → recusa 503; token errado → 401). Secret setado e testado em produção.
- **Cupons:** removida a leitura pública da tabela (`cupons_admin_read` só admin). A loja valida por RPC `validar_cupom` (`SECURITY DEFINER`). Migration `20260625_cupons_leitura_admin.sql`.
- **Mercado Pago:** integração removida do código (função `pix-webhook` deletada do repo; gateway agora é só ASAAS via `processar-pagamento` + `asaas-webhook`).

**✅ Resolvido depois (29/06/2026):**
- **Mercado Pago no ar:** função publicada `pix-webhook` deletada e secrets `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` removidos (verificado: `pix-webhook` não consta mais em Edge Functions).
- **Token do GitHub:** revogado pela Luíza; config local confirmada limpa (sem token embutido, `credential.helper=osxkeychain`).
- **Git:** `origin/staging` e `origin/main` reunificados num merge sem conflito (commit `f95f595`) — a refinada estética (placeholders boutique) foi ao ar junto com as correções de segurança. Os dois branches estão idênticos.

**⛔ Não acionável no plano atual:**
- **"Leaked password protection" (Supabase):** só disponível no plano **Pro**. Mitigação no plano free: **senha forte e única no admin** (`wearvirtu@gmail.com`, via gerenciador de senhas) e, se disponível, **2FA/MFA** no login do admin — cobre o mesmo risco (proteção do acesso administrativo).

**🟡 Melhorias opcionais (sem urgência):**
- **GitHub Pages × `_headers`:** o deploy é GitHub Pages, que **ignora** o `_headers` — HSTS/CSP/X-Frame não valem em produção. Avaliar migrar para Cloudflare/Netlify Pages (aplicam o arquivo nativamente) ou replicar via `<meta http-equiv>`.
- **Funções placeholder publicadas** (`smart-responder`, `virtusite`, `clever-service`) — conferir se são lixo de teste e deletar.

### Token do GitHub — limpeza local feita (24/06/2026)
- O Personal Access Token que estava exposto foi removido do `.git/config` e do `.claude/settings.local.json`; o remote agora usa URL limpa (`https://github.com/luizalucena/virtu-site.git`), as credenciais passam pelo Keychain do macOS (`credential.helper osxkeychain`) e `.claude/` entrou no `.gitignore`.
  - **AÇÃO PENDENTE (só a Luíza pode fazer):** o token antigo ainda é válido no GitHub até ser revogado. Revogar em GitHub → Settings → Developer settings → Personal access tokens, e gerar um novo se precisar. No próximo `git push`, autenticar com o token novo (ele será salvo no Keychain automaticamente).

- Manter esta lista atualizada conforme riscos surgirem ou forem resolvidos.
