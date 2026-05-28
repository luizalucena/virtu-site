-- ============================================================
-- VIRTÙ — Auth de clientes: políticas RLS para pedidos
-- Execute no Supabase SQL Editor
-- ============================================================

-- Permite que um cliente autenticado leia apenas seus próprios pedidos
DROP POLICY IF EXISTS "pedidos_select_by_email" ON pedidos;
CREATE POLICY "pedidos_select_by_email"
  ON pedidos FOR SELECT TO authenticated
  USING (email_cliente = auth.email());

-- Permite que um cliente autenticado insira pedidos (já coberto por pedidos_insert_anon,
-- mas adicionamos explicitamente para authenticated também)
-- (já existe pedidos_insert_anon que cobre anon e authenticated)

-- Nota: a tabela auth.users é gerenciada pelo Supabase automaticamente.
-- Não é necessário criar tabela extra — usamos auth.users + user_metadata.
