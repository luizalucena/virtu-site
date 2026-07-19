-- VIRTÙ — Número de pedido sequencial "WV" (WV1001, WV1002, …)
-- Cria um número humano e sequencial para exibir nos e-mails e no admin.
-- NÃO substitui o id (uuid) — é apenas um rótulo de exibição.
-- Começa em 1001 e nunca colide com pedidos existentes (backfill por data).

-- 1. Sequence começando em 1001
create sequence if not exists public.pedidos_numero_seq
  as integer
  start with 1001
  increment by 1;

-- 2. Coluna de exibição
alter table public.pedidos
  add column if not exists numero_pedido integer;

-- 3. Backfill dos pedidos já existentes, em ordem de criação (1001, 1002, …)
with ordenados as (
  select id, (row_number() over (order by criado_em, id) + 1000) as num
  from public.pedidos
  where numero_pedido is null
)
update public.pedidos p
   set numero_pedido = o.num
  from ordenados o
 where p.id = o.id;

-- 4. Avança a sequence para acima do maior número já usado (evita colisão)
select setval(
  'public.pedidos_numero_seq',
  greatest(1001, coalesce((select max(numero_pedido) from public.pedidos), 1000) + 1),
  false
);

-- 5. Novos pedidos recebem o próximo número automaticamente
alter table public.pedidos
  alter column numero_pedido set default nextval('public.pedidos_numero_seq');

-- 6. Unicidade + posse da sequence pela coluna
create unique index if not exists pedidos_numero_pedido_key
  on public.pedidos(numero_pedido);

alter sequence public.pedidos_numero_seq
  owned by public.pedidos.numero_pedido;

-- 7. O INSERT do pedido é feito pela Edge Function via service_role.
grant usage, select on sequence public.pedidos_numero_seq to service_role;
