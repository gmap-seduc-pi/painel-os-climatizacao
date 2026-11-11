-- =====================================================================
-- Painel de O.S. de Climatização · GMAP | SEDUC-PI
-- Estrutura do banco (Supabase / PostgreSQL)
-- Execute este arquivo inteiro no SQL Editor do Supabase, uma única vez.
-- Pode ser executado de novo sem perder dados (comandos idempotentes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ordens de serviço (espelho da aba consolidada da planilha)
-- ---------------------------------------------------------------------
create table if not exists public.os (
  chave                text primary key,          -- "Nº DA OS|EMPRESA" (o número pode se repetir entre empresas)
  numero               text not null,
  empresa              text not null,
  status               text,
  prioridade           text,
  criada_em            date,
  prazo                date,
  atendida_em          date,
  splits               integer,
  descricao            text,
  escola               text,
  entidade             text,
  inep                 text,
  gre                  text,
  municipio            text,
  zona                 text,
  endereco             text,
  id_sei               text,
  observacoes          text,
  justificativa        text,
  motivo_cancelamento  text,
  sincronizado_em      timestamptz not null default now()
);
create index if not exists os_empresa_idx on public.os (empresa);
create index if not exists os_inep_idx    on public.os (inep);
create index if not exists os_status_idx  on public.os (status);

-- ---------------------------------------------------------------------
-- 2. Perfis de acesso (um registro por usuário)
--    perfil: 'gmap' | 'diretoria' | 'empresa'
--    empresa: obrigatório quando perfil = 'empresa', com o nome EXATAMENTE
--             como aparece na coluna EMPRESA da planilha (ex.: 'CLASSE A')
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nome       text,
  perfil     text not null check (perfil in ('gmap','diretoria','empresa')),
  empresa    text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  constraint empresa_obrigatoria check (perfil <> 'empresa' or empresa is not null)
);

-- ---------------------------------------------------------------------
-- 3. Histórico de mudança de status (gerado a cada sincronização)
-- ---------------------------------------------------------------------
create table if not exists public.os_historico (
  id               bigserial primary key,
  chave            text not null,
  empresa          text,
  status_anterior  text,
  status_novo      text,
  registrado_em    timestamptz not null default now()
);
create index if not exists os_hist_chave_idx on public.os_historico (chave);

-- ---------------------------------------------------------------------
-- 4. Registro das sincronizações e dos acessos
-- ---------------------------------------------------------------------
create table if not exists public.sincronizacoes (
  id            bigserial primary key,
  executada_em  timestamptz not null default now(),
  registros     integer not null,
  inseridos     integer not null,
  removidos     integer not null,
  status_alterados integer not null,
  origem        text
);

create table if not exists public.acessos (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid(),
  acessado_em timestamptz not null default now(),
  agente      text
);

-- ---------------------------------------------------------------------
-- 5. Funções auxiliares de permissão
--    security definer: leem a tabela de perfis sem depender das regras dela
-- ---------------------------------------------------------------------
create or replace function public.meu_perfil()
returns table (perfil text, empresa text)
language sql stable security definer set search_path = public as $$
  select p.perfil, p.empresa from public.perfis p
  where p.user_id = auth.uid() and p.ativo
$$;

create or replace function public.eh_gestao()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p
                 where p.user_id = auth.uid() and p.ativo and p.perfil in ('gmap','diretoria'))
$$;

create or replace function public.eh_gmap()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p
                 where p.user_id = auth.uid() and p.ativo and p.perfil = 'gmap')
$$;

-- ---------------------------------------------------------------------
-- 6. Regras de acesso por linha (RLS)
-- ---------------------------------------------------------------------
alter table public.os             enable row level security;
alter table public.perfis         enable row level security;
alter table public.os_historico   enable row level security;
alter table public.sincronizacoes enable row level security;
alter table public.acessos        enable row level security;

-- O.S.: GMAP e diretoria veem tudo; empresa vê só as próprias. Ninguém escreve pelo app.
drop policy if exists os_leitura on public.os;
create policy os_leitura on public.os for select to authenticated using (
  public.eh_gestao()
  or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = os.empresa)
);

-- Perfis: cada usuário lê o próprio; GMAP lê todos (gestão de usuários fica no painel do Supabase).
drop policy if exists perfis_leitura on public.perfis;
create policy perfis_leitura on public.perfis for select to authenticated
  using (user_id = auth.uid() or public.eh_gmap());

-- Histórico de status: mesma regra das O.S.
drop policy if exists hist_leitura on public.os_historico;
create policy hist_leitura on public.os_historico for select to authenticated using (
  public.eh_gestao()
  or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = os_historico.empresa)
);

-- Sincronizações: qualquer usuário ativo vê quando foi a última atualização.
drop policy if exists sinc_leitura on public.sincronizacoes;
create policy sinc_leitura on public.sincronizacoes for select to authenticated
  using (exists (select 1 from public.meu_perfil()));

-- Acessos: o usuário registra o próprio acesso; só a GMAP consulta.
drop policy if exists acessos_insere on public.acessos;
create policy acessos_insere on public.acessos for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.meu_perfil()));
drop policy if exists acessos_leitura on public.acessos;
create policy acessos_leitura on public.acessos for select to authenticated using (public.eh_gmap());

-- Visitantes sem login não acessam nada.
revoke all on public.os, public.perfis, public.os_historico, public.sincronizacoes, public.acessos from anon;
grant select on public.os, public.perfis, public.os_historico, public.sincronizacoes, public.acessos to authenticated;
grant insert on public.acessos to authenticated;
grant usage, select on sequence public.acessos_id_seq to authenticated;

-- ---------------------------------------------------------------------
-- 7. Sincronização: substitui o conteúdo da tabela pelo da planilha,
--    em uma única transação, registrando as mudanças de status.
--    Só pode ser chamada com a chave secreta (service_role), usada pelo Apps Script.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_os(payload jsonb, origem text default 'apps-script')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_ins int; v_rem int; v_alt int;
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) = 0 then
    raise exception 'Payload vazio: sincronização cancelada para não apagar os dados.';
  end if;

  create temp table _novo on commit drop as
  select * from jsonb_to_recordset(payload) as x(
    chave text, numero text, empresa text, status text, prioridade text,
    criada_em date, prazo date, atendida_em date, splits integer, descricao text,
    escola text, entidade text, inep text, gre text, municipio text, zona text,
    endereco text, id_sei text, observacoes text, justificativa text, motivo_cancelamento text);

  if exists (select chave from _novo group by chave having count(*) > 1) then
    raise exception 'Há O.S. repetidas (mesmo número e empresa) na planilha: %',
      (select string_agg(chave, ', ') from (select chave from _novo group by chave having count(*) > 1) d);
  end if;

  select count(*) into v_total from _novo;

  -- histórico: O.S. novas e mudanças de status
  insert into os_historico (chave, empresa, status_anterior, status_novo)
  select n.chave, n.empresa, o.status, n.status
  from _novo n left join os o on o.chave = n.chave
  where o.chave is null or o.status is distinct from n.status;
  get diagnostics v_alt = row_count;

  select count(*) into v_rem from os o where not exists (select 1 from _novo n where n.chave = o.chave);
  select count(*) into v_ins from _novo n where not exists (select 1 from os o where o.chave = n.chave);

  delete from os where true;
  insert into os (chave, numero, empresa, status, prioridade, criada_em, prazo, atendida_em, splits, descricao,
                  escola, entidade, inep, gre, municipio, zona, endereco, id_sei, observacoes, justificativa,
                  motivo_cancelamento, sincronizado_em)
  select chave, numero, empresa, status, prioridade, criada_em, prazo, atendida_em, splits, descricao,
         escola, entidade, inep, gre, municipio, zona, endereco, id_sei, observacoes, justificativa,
         motivo_cancelamento, now()
  from _novo;

  insert into sincronizacoes (registros, inseridos, removidos, status_alterados, origem)
  values (v_total, v_ins, v_rem, v_alt, origem);

  return jsonb_build_object('registros', v_total, 'inseridos', v_ins, 'removidos', v_rem, 'status_alterados', v_alt);
end $$;

revoke all on function public.sincronizar_os(jsonb, text) from public, anon, authenticated;
grant execute on function public.sincronizar_os(jsonb, text) to service_role;
revoke all on function public.meu_perfil(), public.eh_gestao(), public.eh_gmap() from public, anon;
grant execute on function public.meu_perfil(), public.eh_gestao(), public.eh_gmap() to authenticated;
