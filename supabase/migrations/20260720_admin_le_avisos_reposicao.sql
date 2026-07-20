-- VIRTÙ — Admin pode LER todos os avisos de reposição (para a tela "Reposição")
-- A policy existente só deixa cada cliente ler os próprios avisos. O painel
-- (is_virtu_admin) precisa ver a demanda de todas as peças esgotadas.

create policy "Admin lê avisos de reposição"
  on public.avisos_reposicao
  for select
  to authenticated
  using (public.is_virtu_admin());
