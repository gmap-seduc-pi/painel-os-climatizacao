-- =====================================================================
-- 002 · Cadastro aberto com aprovação da GMAP
-- Quem se cadastra pelo site fica "pendente" e não vê nada até um usuário
-- GMAP aprovar. Só a GMAP aprova, recusa, bloqueia e reativa.
-- Execute uma única vez no SQL Editor do Supabase.
-- =====================================================================

-- 1. Situação do acesso. "ativo" passa a ser calculado: só quem está aprovado.
alter table public.perfis
  add column if not exists situacao text not null default 'aprovado'
    check (situacao in ('pendente','aprovado','recusado','bloqueado')),
  add column if not exists decidido_por uuid references auth.users(id) on delete set null,
  add column if not exists decidido_em  timestamptz;

-- Usuários já desativados antes desta migração continuam bloqueados.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'perfis'
               and column_name = 'ativo' and is_generated = 'NEVER') then
    update public.perfis set situacao = 'bloqueado' where ativo = false;
    alter table public.perfis drop column ativo;
    alter table public.perfis add column ativo boolean generated always as (situacao = 'aprovado') stored;
  end if;
end $$;

-- 2. Registro de todas as decisões sobre acessos (auditoria)
create table if not exists public.perfis_log (
  id         bigserial primary key,
  registrado_em timestamptz not null default now(),
  feito_por  uuid,
  usuario    uuid not null,
  acao       text not null,
  detalhe    text
);
alter table public.perfis_log enable row level security;
drop policy if exists perfis_log_leitura on public.perfis_log;
create policy perfis_log_leitura on public.perfis_log for select to authenticated using (public.eh_gmap());
revoke all on public.perfis_log from anon;
grant select on public.perfis_log to authenticated;

-- 3. Ao se cadastrar pelo site, o usuário ganha um perfil PENDENTE com o que pediu.
--    Usuários criados pelo painel do Supabase (sem esses dados) não ganham perfil automático.
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_perfil text := m->>'perfil';
  v_empresa text := nullif(trim(m->>'empresa'), '');
begin
  if v_perfil is null then
    return new;
  end if;
  if v_perfil not in ('gmap','diretoria','empresa') then
    raise exception 'Perfil inválido.';
  end if;
  if v_perfil = 'empresa' and v_empresa is null then
    raise exception 'Informe a empresa.';
  end if;
  if v_perfil <> 'empresa' then v_empresa := null; end if;

  insert into public.perfis (user_id, email, nome, perfil, empresa, situacao)
  values (new.id, new.email, nullif(trim(m->>'nome'), ''), v_perfil, v_empresa, 'pendente')
  on conflict (user_id) do nothing;

  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (new.id, new.id, 'solicitou', v_perfil || coalesce(' / ' || v_empresa, ''));
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- 4. Lista de empresas para o formulário de cadastro (só os nomes; visível sem login)
create or replace function public.empresas_disponiveis()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct empresa from public.os where empresa is not null order by 1
$$;
revoke all on function public.empresas_disponiveis() from public;
grant execute on function public.empresas_disponiveis() to anon, authenticated;

-- 5. Gestão de usuários (somente GMAP)
create or replace function public.listar_usuarios()
returns table (user_id uuid, email text, nome text, perfil text, empresa text, situacao text,
               criado_em timestamptz, decidido_em timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à GMAP.'; end if;
  return query
    select p.user_id, p.email, p.nome, p.perfil, p.empresa, p.situacao, p.criado_em, p.decidido_em,
           (select max(a.acessado_em) from public.acessos a where a.user_id = p.user_id)
    from public.perfis p
    order by case p.situacao when 'pendente' then 0 else 1 end, p.criado_em desc;
end $$;

create or replace function public.decidir_usuario(p_usuario uuid, p_acao text, p_perfil text default null, p_empresa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_situacao text;
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à GMAP.'; end if;
  if p_usuario = auth.uid() then raise exception 'Você não pode alterar o próprio acesso.'; end if;
  if p_acao not in ('aprovar','recusar','bloquear','reativar') then raise exception 'Ação inválida.'; end if;

  v_situacao := case p_acao when 'aprovar' then 'aprovado' when 'reativar' then 'aprovado'
                            when 'recusar' then 'recusado' else 'bloqueado' end;

  if p_acao = 'aprovar' then
    if p_perfil not in ('gmap','diretoria','empresa') then raise exception 'Perfil inválido.'; end if;
    if p_perfil = 'empresa' and nullif(trim(p_empresa), '') is null then raise exception 'Informe a empresa.'; end if;
    update public.perfis set perfil = p_perfil,
           empresa = case when p_perfil = 'empresa' then trim(p_empresa) end,
           situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now()
     where user_id = p_usuario;
  else
    update public.perfis set situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now()
     where user_id = p_usuario;
  end if;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, p_acao,
          case when p_acao = 'aprovar' then p_perfil || coalesce(' / ' || p_empresa, '') end);
end $$;

revoke all on function public.listar_usuarios(), public.decidir_usuario(uuid, text, text, text) from public, anon;
grant execute on function public.listar_usuarios(), public.decidir_usuario(uuid, text, text, text) to authenticated;
