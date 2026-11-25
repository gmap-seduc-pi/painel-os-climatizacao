-- =====================================================================
-- 012 · Feed: última visita guardada na conta (e não no navegador)
--
-- O selo "Novo" do Feed compara cada movimentação com a última vez que a pessoa
-- abriu o Feed. Até a 2.9.0 essa data ficava no navegador; agora fica aqui, uma
-- linha por pessoa, e vale em qualquer computador, celular ou navegador.
--
-- Armazenamento: uma linha pequena por usuário (a tabela não cresce com o uso;
-- cada gravação substitui a anterior). O painel grava no máximo a cada 2 minutos
-- e só quando a data avança.
--
-- Só acrescenta uma tabela e uma função. Não altera dados nem tabelas existentes.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

create table if not exists public.feed_visitas (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  visto_em  timestamptz not null
);

alter table public.feed_visitas enable row level security;
drop policy if exists feed_visitas_leitura on public.feed_visitas;
create policy feed_visitas_leitura on public.feed_visitas for select to authenticated using (user_id = auth.uid());
revoke all on public.feed_visitas from anon, authenticated;
grant select on public.feed_visitas to authenticated;

-- grava a última visita da própria pessoa; nunca volta no tempo e não grava data futura
create or replace function public.feed_marcar_visto(p_quando timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_q timestamptz := least(coalesce(p_quando, now()), now()); v_r timestamptz;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if not exists (select 1 from public.perfis where user_id = v_uid and situacao = 'aprovado') then return null; end if;
  insert into public.feed_visitas as f (user_id, visto_em) values (v_uid, v_q)
  on conflict (user_id) do update set visto_em = excluded.visto_em
    where f.visto_em < excluded.visto_em;   -- só grava se a data avançou (evita escrita à toa)
  select visto_em into v_r from public.feed_visitas where user_id = v_uid;
  return v_r;
end $$;
revoke all on function public.feed_marcar_visto(timestamptz) from public, anon;
grant execute on function public.feed_marcar_visto(timestamptz) to authenticated;
