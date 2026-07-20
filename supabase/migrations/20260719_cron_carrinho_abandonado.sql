-- VIRTÙ — Recuperação de carrinho abandonado por CRON (envio com atraso)
--
-- Antes: o carrinho-abandonado.js disparava o e-mail NA HORA (agressivo e
-- não-confiável quando a aba fecha). Agora o cliente só registra o abandono e
-- este job envia ~1h depois, SÓ se a cliente não retomou nem comprou.
-- A flag email_enviado garante 1 e-mail por carrinho (sem duplicata).

create or replace function public.fn_processar_carrinhos_abandonados()
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
    select c.id, c.email, c.nome, c.itens, c.valor_total, c.url_recuperacao
    from public.carrinhos_abandonados c
    where coalesce(c.email_enviado, false) = false
      and coalesce(c.recuperado,    false) = false
      and c.email is not null
      and c.itens is not null
      and jsonb_array_length(c.itens) > 0
      -- janela: abandonado há mais de 1h e menos de 24h (não incomodar tarde)
      and c.created_at <= now() - interval '1 hour'
      and c.created_at >= now() - interval '24 hours'
      -- não enviar se já comprou depois de abandonar
      and not exists (
        select 1 from public.pedidos p
        where lower(p.email_cliente) = lower(c.email)
          and p.status in ('pago','confirmado','enviado','entregue')
          and p.criado_em >= c.created_at
      )
    order by c.created_at
    limit 50
  loop
    perform net.http_post(
      url     => 'https://oxivtnuxnghpddwawfdr.supabase.co/functions/v1/notificar-abandono-carrinho',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94aXZ0bnV4bmdocGRkd2F3ZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjUxMjYsImV4cCI6MjA5NTMwMTEyNn0.C6KgUunebmFrOnfp5nT49JdxBZviC4DegGfHlj2JU2I'
      ),
      body    => jsonb_build_object(
        'email',           r.email,
        'nome',            r.nome,
        'itens',           r.itens,
        'total',           r.valor_total,
        'url_recuperacao', coalesce(r.url_recuperacao, 'https://www.wearvirtu.com/carrinho.html?recuperar=1'),
        'abandono_id',     r.id
      )
    );
    -- marca já para não reprocessar no próximo tick (a EF também marca ao enviar)
    update public.carrinhos_abandonados
       set email_enviado = true, email_enviado_em = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.fn_processar_carrinhos_abandonados() from anon, authenticated;

-- Agenda a cada 15 minutos (só faz algo quando há carrinho elegível).
select cron.schedule(
  'processar-carrinhos-abandonados',
  '*/15 * * * *',
  $$ select public.fn_processar_carrinhos_abandonados(); $$
);
