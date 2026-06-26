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
- **Deploy:** Git push para `origin` (GitHub Pages, domínio próprio via `CNAME`).
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

- **Push = deploy.** `origin` publica em produção (GitHub Pages). Não dar `git push` por conta própria — confirmar com a Luíza, salvo combinação prévia.
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

### Auditoria de segurança — 26/06/2026

**✅ Resolvido (já em produção):**
- **C1 — Vazamento de pedidos:** a policy `rastreio_por_uuid` (`SELECT public USING(true)`) deixava a anon key ler TODA a tabela `pedidos` (CPF, endereço, telefone). Removida. Rastreio agora usa a função `rastrear_pedido(uuid)` (`SECURITY DEFINER`, só colunas não sensíveis) + polling no `rastreio.html`. Migration `20260625_fix_rls_seguranca.sql`.
- **C2 — Controle de admin:** confirmado OK. `is_virtu_admin()` (allowlist = `wearvirtu@gmail.com` + `service_role`) protege produtos, configuracoes, cupons, fluxo_caixa, config_fidelidade, bazar_pecas e pedidos. **O login do painel TEM que ser `wearvirtu@gmail.com`** — mudar a allowlist na função se trocar.
- **A1 — Webhook de pagamento:** `asaas-webhook` agora é fail-closed (sem `ASAAS_WEBHOOK_TOKEN` → recusa 503; token errado → 401). Secret setado e testado em produção.
- **Cupons:** removida a leitura pública da tabela (`cupons_admin_read` só admin). A loja valida por RPC `validar_cupom` (`SECURITY DEFINER`). Migration `20260625_cupons_leitura_admin.sql`.
- **Mercado Pago:** integração removida do código (função `pix-webhook` deletada do repo; gateway agora é só ASAAS via `processar-pagamento` + `asaas-webhook`).

**⚠️ AÇÃO PENDENTE (só a Luíza, no painel — sem ferramenta automatizada):**
- **Supabase → Edge Functions:** deletar a função publicada **`pix-webhook`** (MP, já removida do código mas ainda no ar).
- **Supabase → Manage secrets:** deletar `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` (não usados).
- **Supabase → Authentication → Settings:** ativar **"Leaked password protection"**.
- **GitHub Pages × `_headers`:** o deploy é GitHub Pages, que **ignora** o `_headers` — HSTS/CSP/X-Frame não valem em produção. Avaliar migrar para Cloudflare/Netlify Pages (aplicam o arquivo nativamente) ou replicar via `<meta http-equiv>`.
- **Funções placeholder publicadas** (`smart-responder`, `virtusite`, `clever-service`) — conferir se são lixo de teste e deletar.
- **Git:** `origin/staging` e `origin/main` divergiram (push direto no `main` durante a auditoria). Alinhar os dois branches quando puder.

### Token do GitHub — limpeza local feita (24/06/2026)
- O Personal Access Token que estava exposto foi removido do `.git/config` e do `.claude/settings.local.json`; o remote agora usa URL limpa (`https://github.com/luizalucena/virtu-site.git`), as credenciais passam pelo Keychain do macOS (`credential.helper osxkeychain`) e `.claude/` entrou no `.gitignore`.
  - **AÇÃO PENDENTE (só a Luíza pode fazer):** o token antigo ainda é válido no GitHub até ser revogado. Revogar em GitHub → Settings → Developer settings → Personal access tokens, e gerar um novo se precisar. No próximo `git push`, autenticar com o token novo (ele será salvo no Keychain automaticamente).

- Manter esta lista atualizada conforme riscos surgirem ou forem resolvidos.
