-- VIRTÙ — Notificação de reposição ("Avise-me quando chegar")
--
-- A captura (avisos_reposicao) já existe no front (stock.js). Faltava CUMPRIR
-- a promessa: enviar o e-mail quando a peça volta ao estoque. Este cron varre
-- os avisos pendentes cujo produto/variação já tem estoque>0 e chama a edge
-- function notificar-reposicao (1 e-mail por aviso), marcando notificado=true.

create or replace function public.fn_processar_avisos_reposicao()
returns integer
language plpgsql
security definer
set search_path = public, net
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select a.id, a.email, a.produto_id, a.tamanho, a.cor_nome, p.nome as nome_produto
    from public.avisos_reposicao a
    join public.produtos p on p.id = a.produto_id
    where coalesce(a.notificado, false) = false
      and a.email is not null
      and exists (
        select 1 from public.variacoes v
        where v.produto_id = a.produto_id
          and coalesce(v.ativo, true) = true
          and v.estoque > 0
          and (a.tamanho  is null or v.tamanho  = a.tamanho)
          and (a.cor_nome is null or v.cor_nome = a.cor_nome)
      )
    order by a.criado_em
    limit 100
  loop
    perform net.http_post(
      url     => 'https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/notificar-reposicao',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjUxMjYsImV4cCI6MjA5NTMwMTEyNn0.C6KgUunebmFrOnfp5nT49JdxBZviC4DegGfHlj2JU2I'
      ),
      body    => jsonb_build_object(
        'aviso_id',     r.id,
        'email',        r.email,
        'nome_produto', r.nome_produto,
        'produto_url',  'https://www.wearvirtu.com/produto.html?id=' || r.produto_id,
        'tamanho',      r.tamanho,
        'cor_nome',     r.cor_nome
      )
    );
    update public.avisos_reposicao
       set notificado = true, notificado_em = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.fn_processar_avisos_reposicao() from anon, authenticated;

select cron.schedule(
  'processar-avisos-reposicao',
  '*/30 * * * *',
  $$ select public.fn_processar_avisos_reposicao(); $$
);
