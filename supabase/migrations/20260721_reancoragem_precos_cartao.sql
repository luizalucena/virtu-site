-- VIRTÙ — Reancoragem de preços: o preço de tabela passa a ser o preço de CARTÃO
--
-- Modelo novo (ver AJUSTE_METODO em processar-pagamento/index.ts e checkout.js):
--   Cartão/Débito = preço de tabela (sem acréscimo)
--   PIX           = preço de tabela × 0,95 (5% de desconto à vista)
--
-- Para PRESERVAR a margem (antes: base = PIX, cartão = base×1,05), os preços
-- cadastrados sobem ×1,05 — assim o cartão volta a valer o de antes e o PIX
-- fica ≈ o valor-base anterior.
--
-- ⚠️ APLICAR JUNTO com o deploy do novo AJUSTE_METODO (frontend + backend).
--    Rodar isto ANTES do código novo geraria preço reancorado + acréscimo
--    antigo de +5% = dupla marcação. Rodar o código novo SEM isto derrubaria
--    a margem em ~5%. Os dois vão ao ar na mesma janela.

update public.produtos set
  preco_original = round(preco_original * 1.05, 2),
  preco_desconto = case when preco_desconto is not null
                        then round(preco_desconto * 1.05, 2)
                        else null end;
