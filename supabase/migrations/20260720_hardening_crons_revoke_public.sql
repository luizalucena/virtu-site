-- VIRTÙ — Hardening: revoga EXECUTE de PUBLIC nas funções de cron
-- (o revoke anterior tirava só de anon/authenticated, mas o grant PUBLIC padrão
--  ainda deixava anon/authenticated chamarem via RPC e disparar os envios cedo).
-- As funções continuam executáveis pelo pg_cron (owner). Fecha lints 0028/0029.

revoke execute on function public.fn_processar_carrinhos_abandonados() from public;
revoke execute on function public.fn_processar_avisos_reposicao()      from public;
