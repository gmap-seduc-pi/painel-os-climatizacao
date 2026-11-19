-- =====================================================================
-- 010 · Tempo real
--
-- Liga o "Realtime" do Supabase para as tabelas das O.S. e do histórico.
-- Assim, quando alguém muda uma O.S. (ou registra algo no histórico), a tela
-- de quem está com o painel aberto se atualiza sozinha.
-- As regras de acesso continuam valendo: cada pessoa só recebe o aviso das
-- linhas que já pode ver (a empresa, só as O.S. dela e os eventos públicos).
-- O aviso só diz "algo mudou"; o painel então busca os dados pelo caminho normal.
--
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;   -- no Supabase ela já existe; isto só vale para bancos de teste
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'os') then
    alter publication supabase_realtime add table public.os;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'os_eventos') then
    alter publication supabase_realtime add table public.os_eventos;
  end if;
end $$;
