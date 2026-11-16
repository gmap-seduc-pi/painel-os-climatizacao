-- =====================================================================
-- 003 · Emissão de O.S. no sistema (versão 2.0.0 do painel)
--
-- O que muda:
--  · perfil "tecnico" (Técnico GMAP);
--  · O.S. nascem no sistema: solicitação (com número/ano), aprovação da gerência, revisão,
--    atendimento com PDF, stand by, cancelamento, histórico com nome de quem fez;
--  · status novos: Emitida, Stand by, Atendida, Cancelada (Pendente e Em andamento viram
--    Emitida; Problema vira Stand by);
--  · base de entidades importada da planilha ENTIDADES, contatos dos responsáveis,
--    empresas (área e e-mail), modelo editável da O.S., fila de e-mails;
--  · até o encerramento da planilha (30/11), as O.S. antigas continuam sendo atualizadas
--    só pela planilha e ficam somente para consulta no sistema.
--
-- Execute uma única vez no SQL Editor do Supabase (Ctrl+A e depois Run).
-- Tudo roda numa transação: se algo der errado, nada é alterado.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Perfil Técnico GMAP e funções de permissão
-- ---------------------------------------------------------------------
alter table public.perfis drop constraint if exists perfis_perfil_check;
alter table public.perfis add constraint perfis_perfil_check check (perfil in ('gmap','tecnico','diretoria','empresa'));

-- gestão = vê todas as O.S. (gerência, técnicos e diretoria)
create or replace function public.eh_gestao()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo and p.perfil in ('gmap','tecnico','diretoria'))
$$;
-- equipe = quem emite e audita (gerência e técnicos)
create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo and p.perfil in ('gmap','tecnico'))
$$;
revoke all on function public.eh_equipe() from public, anon;
grant execute on function public.eh_equipe() to authenticated;

-- Cadastro pelo site: aceita também o perfil Técnico GMAP
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_perfil text := m->>'perfil';
  v_empresa text := nullif(trim(m->>'empresa'), '');
begin
  if v_perfil is null then return new; end if;
  if v_perfil not in ('gmap','tecnico','diretoria','empresa') then raise exception 'Perfil inválido.'; end if;
  if v_perfil = 'empresa' and v_empresa is null then raise exception 'Informe a empresa.'; end if;
  if v_perfil <> 'empresa' then v_empresa := null; end if;
  insert into public.perfis (user_id, email, nome, perfil, empresa, situacao)
  values (new.id, new.email, nullif(trim(m->>'nome'), ''), v_perfil, v_empresa, 'pendente')
  on conflict (user_id) do nothing;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (new.id, new.id, 'solicitou', v_perfil || coalesce(' / ' || v_empresa, ''));
  return new;
end $$;

create or replace function public.decidir_usuario(p_usuario uuid, p_acao text, p_perfil text default null, p_empresa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_situacao text;
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  if p_usuario = auth.uid() then raise exception 'Você não pode alterar o próprio acesso.'; end if;
  if p_acao not in ('aprovar','recusar','bloquear','reativar') then raise exception 'Ação inválida.'; end if;
  v_situacao := case p_acao when 'aprovar' then 'aprovado' when 'reativar' then 'aprovado' when 'recusar' then 'recusado' else 'bloqueado' end;
  if p_acao = 'aprovar' then
    if p_perfil not in ('gmap','tecnico','diretoria','empresa') then raise exception 'Perfil inválido.'; end if;
    if p_perfil = 'empresa' and nullif(trim(p_empresa), '') is null then raise exception 'Informe a empresa.'; end if;
    update public.perfis set perfil = p_perfil, empresa = case when p_perfil = 'empresa' then trim(p_empresa) end,
           situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  else
    update public.perfis set situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  end if;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, p_acao, case when p_acao = 'aprovar' then p_perfil || coalesce(' / ' || p_empresa, '') end);
end $$;

-- ---------------------------------------------------------------------
-- 2. Configuração: a planilha segue ativa para as O.S. antigas até o encerramento
-- ---------------------------------------------------------------------
create table if not exists public.sistema_config (
  id int primary key default 1 check (id = 1),
  planilha_ativa boolean not null default true,
  planilha_encerrada_em timestamptz
);
insert into public.sistema_config (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Base de entidades (importada da planilha ENTIDADES), mudanças e contatos
-- ---------------------------------------------------------------------
create table if not exists public.entidades (
  id            text primary key,            -- coluna "ID SISTEMA" da planilha (não muda nunca)
  inep          text,
  nome          text not null,
  tipologia     text,
  tipo          text not null default 'escola' check (tipo in ('escola','outra')),
  municipio     text,
  gre           text,
  zona          text,
  endereco      text,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create index if not exists entidades_inep_idx on public.entidades (inep);

create table if not exists public.entidades_mudancas (
  id           bigserial primary key,
  importado_em timestamptz not null default now(),
  entidade_id  text,
  nome         text,
  tipo         text not null,     -- incluída, alterada, removida, reativada
  campo        text,
  antes        text,
  depois       text
);

create table if not exists public.entidade_contatos (
  entidade_id       text primary key references public.entidades(id) on delete cascade,
  nome              text not null,
  contato           text not null,
  atualizado_por    text,
  atualizado_por_id uuid,
  atualizado_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Empresas: área sugerida (GREs e municípios) e e-mail que recebe os avisos
-- ---------------------------------------------------------------------
create table if not exists public.empresas (
  nome         text primary key,
  email        text,
  ativa        boolean not null default true,
  gres         text[] not null default '{}',
  municipios   text[] not null default '{}',
  alterado_por text,
  alterado_em  timestamptz
);
insert into public.empresas (nome) select distinct empresa from public.os where empresa is not null on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Modelo editável da O.S. (listas de opções, regras e campos adicionais)
-- ---------------------------------------------------------------------
create table if not exists public.os_modelo (
  id                   int primary key default 1 check (id = 1),
  versao               int not null default 1,
  motivos              jsonb not null,
  ambientes            jsonb not null,
  motivos_cancelamento jsonb not null,
  motivo_outro         boolean not null default true,
  campos               jsonb not null,
  perguntas            jsonb not null default '[]',
  alterado_por         text,
  alterado_em          timestamptz
);
create table if not exists public.os_modelo_log (
  id        bigserial primary key,
  versao    int not null,
  quando    timestamptz not null default now(),
  quem      uuid,
  quem_nome text,
  resumo    text,
  modelo    jsonb
);
insert into public.os_modelo (id, motivos, ambientes, motivos_cancelamento, campos)
select 1,
  (select jsonb_agg(jsonb_build_object('id', 'm' || i, 'texto', t, 'ativo', true) order by t collate "C") from unnest(array[
    'Atender denúncia','Determinação da gerência','Devolução de equipamentos','Inauguração da entidade','Proximidade de evento importante',
    'Recebimento de novos equipamentos','Reformas e manutenções prediais','Substituição patrimonial']) with ordinality as x(t, i)),
  (select jsonb_agg(jsonb_build_object('id', 'a' || i, 'texto', t, 'ativo', true)) from unnest(array[
    'Administrativo','Área esportiva','Auditório','Biblioteca','Cozinha','Dormitório','Laboratório de ciências','Laboratório de costura',
    'Laboratório de enfermagem','Laboratório de informática','Laboratório de matemática','Laboratório de panificação','Laboratório de robótica',
    'Pátio','Refeitório','Sala AEE','Sala de aula','Sala dos professores','Sala EPT','Sala mediação tecnológica','Saúde digital','Vestiário']) with ordinality as x(t, i)),
  (select jsonb_agg(jsonb_build_object('id', 'c' || i, 'texto', t, 'ativo', true)) from unnest(array[
    'Atraso superior a 60 dias','Demanda duplicada','Demanda já estava atendida','Direção contratou serviço particular',
    'Erro no preenchimento','Infraestrutura inadequada','Solicitação da gerência']) with ordinality as x(t, i)),
  '{"ambientes":{"obrigatorio":false},"responsavel":{"obrigatorio":false},"descricao":{"obrigatorio":false}}'::jsonb
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 6. O.S.: identificador estável, campos da emissão e status novos
-- ---------------------------------------------------------------------
alter table public.os add column if not exists id bigint generated by default as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'os_id_key') then
    alter table public.os add constraint os_id_key unique (id);
  end if;
end $$;
alter table public.os
  add column if not exists legado            boolean not null default true,
  add column if not exists entidade_id       text references public.entidades(id) on delete set null,
  add column if not exists origem            text check (origem in ('redmine','sei','gerencia')),
  add column if not exists origem_num        text,
  add column if not exists motivos           text[] not null default '{}',
  add column if not exists ambientes         jsonb not null default '[]',
  add column if not exists resp_nome         text,
  add column if not exists resp_contato      text,
  add column if not exists respostas         jsonb not null default '[]',
  add column if not exists modelo_versao     int,
  add column if not exists fora_area         boolean not null default false,
  add column if not exists fora_just         text,
  add column if not exists revisao           boolean not null default false,
  add column if not exists revisao_sugestao  text,
  add column if not exists revisao_nome      text,
  add column if not exists revisao_em        timestamptz,
  add column if not exists standby_motivo    text,
  add column if not exists standby_por       text check (standby_por in ('empresa','gmap')),
  add column if not exists pendencias        text,
  add column if not exists pdf_nome          text,
  add column if not exists pdf_caminho       text,
  add column if not exists solicitado_por    uuid,
  add column if not exists solicitado_nome   text,
  add column if not exists solicitado_em     timestamptz,
  add column if not exists aprovado_por      uuid,
  add column if not exists aprovado_nome     text,
  add column if not exists aprovado_em       timestamptz,
  add column if not exists atendido_por      uuid,
  add column if not exists atendido_nome     text,
  add column if not exists devolucao_obs     text;
alter table public.os alter column legado set default false;
create index if not exists os_entidade_idx on public.os (entidade_id);
-- número/ano das O.S. emitidas no sistema é único (as antigas podem repetir número entre empresas)
create unique index if not exists os_numero_sistema_idx on public.os (numero) where not legado;

-- conversão dos status (aprovada pela gerência em 12/11/2026)
update public.os set status = 'Emitida' where status in ('Pendente','Em andamento');
update public.os set status = 'Stand by', standby_por = 'empresa',
       standby_motivo = coalesce(nullif(trim(justificativa), ''), 'Convertido do status "Problema" da planilha')
 where status = 'Problema';
alter table public.os drop constraint if exists os_status_check;
alter table public.os add constraint os_status_check
  check (status is null or status in ('Aguardando aprovação','Devolvida','Recusada','Emitida','Stand by','Atendida','Cancelada'));

-- ---------------------------------------------------------------------
-- 7. Histórico de cada O.S. (quem fez, com nome e perfil) e fila de e-mails
-- ---------------------------------------------------------------------
create table if not exists public.os_eventos (
  id        bigserial primary key,
  os_id     bigint not null references public.os(id) on delete cascade,
  quando    timestamptz not null default now(),
  quem      uuid,
  quem_nome text,
  perfil    text,
  acao      text not null,
  detalhe   text,
  interno   boolean not null default false   -- interno: a empresa não vê
);
create index if not exists os_eventos_os_idx on public.os_eventos (os_id);

create table if not exists public.email_fila (
  id         bigserial primary key,
  criado_em  timestamptz not null default now(),
  os_id      bigint,
  empresa    text,
  para       text,
  assunto    text not null,
  corpo      text,
  situacao   text not null default 'Na fila' check (situacao in ('Na fila','Enviado','Falhou','Sem e-mail cadastrado')),
  tentativas int not null default 0,
  enviado_em timestamptz,
  erro       text
);

-- ---------------------------------------------------------------------
-- 8. Regras de acesso (leitura). Nenhuma escrita direta: tudo passa pelas funções.
-- ---------------------------------------------------------------------
alter table public.sistema_config     enable row level security;
alter table public.entidades          enable row level security;
alter table public.entidades_mudancas enable row level security;
alter table public.entidade_contatos  enable row level security;
alter table public.empresas           enable row level security;
alter table public.os_modelo          enable row level security;
alter table public.os_modelo_log      enable row level security;
alter table public.os_eventos         enable row level security;
alter table public.email_fila         enable row level security;

drop policy if exists os_leitura on public.os;
create policy os_leitura on public.os for select to authenticated using (
  public.eh_gestao()
  or (exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = os.empresa)
      and os.status not in ('Aguardando aprovação','Devolvida','Recusada'))
);
drop policy if exists cfg_leitura on public.sistema_config;
create policy cfg_leitura on public.sistema_config for select to authenticated using (exists (select 1 from public.meu_perfil()));
drop policy if exists ent_leitura on public.entidades;
create policy ent_leitura on public.entidades for select to authenticated using (exists (select 1 from public.meu_perfil()));
drop policy if exists entm_leitura on public.entidades_mudancas;
create policy entm_leitura on public.entidades_mudancas for select to authenticated using (public.eh_equipe());
drop policy if exists entc_leitura on public.entidade_contatos;
create policy entc_leitura on public.entidade_contatos for select to authenticated using (public.eh_equipe());
drop policy if exists emp_leitura on public.empresas;
create policy emp_leitura on public.empresas for select to authenticated using (
  public.eh_gestao() or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = empresas.nome));
drop policy if exists mod_leitura on public.os_modelo;
create policy mod_leitura on public.os_modelo for select to authenticated using (exists (select 1 from public.meu_perfil()));
drop policy if exists modl_leitura on public.os_modelo_log;
create policy modl_leitura on public.os_modelo_log for select to authenticated using (public.eh_equipe());
drop policy if exists evt_leitura on public.os_eventos;
create policy evt_leitura on public.os_eventos for select to authenticated using (
  public.eh_gestao()
  or (not os_eventos.interno and exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa
                                          where o.id = os_eventos.os_id and o.status not in ('Aguardando aprovação','Devolvida','Recusada'))));
drop policy if exists mail_leitura on public.email_fila;
create policy mail_leitura on public.email_fila for select to authenticated using (public.eh_equipe());

revoke all on public.sistema_config, public.entidades, public.entidades_mudancas, public.entidade_contatos, public.empresas,
              public.os_modelo, public.os_modelo_log, public.os_eventos, public.email_fila from anon, authenticated;
grant select on public.sistema_config, public.entidades, public.entidades_mudancas, public.entidade_contatos, public.empresas,
                public.os_modelo, public.os_modelo_log, public.os_eventos, public.email_fila to authenticated;

-- ---------------------------------------------------------------------
-- 9. PDF da O.S. assinada (Supabase Storage, pasta privada)
--    caminho: <id da O.S.>/<arquivo>.pdf · a empresa só envia e vê PDFs das próprias O.S.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('os-assinadas', 'os-assinadas', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

create or replace function public.pode_anexar_pdf(p_pasta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa
                 where o.id::text = p_pasta and o.status in ('Emitida','Stand by','Atendida') and not o.revisao)
$$;
create or replace function public.pode_ver_pdf(p_pasta text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestao() or exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa
                                       where o.id::text = p_pasta)
$$;
revoke all on function public.pode_anexar_pdf(text), public.pode_ver_pdf(text) from public, anon;
grant execute on function public.pode_anexar_pdf(text), public.pode_ver_pdf(text) to authenticated;

drop policy if exists os_pdf_envio on storage.objects;
create policy os_pdf_envio on storage.objects for insert to authenticated
  with check (bucket_id = 'os-assinadas' and public.pode_anexar_pdf((storage.foldername(name))[1]));
drop policy if exists os_pdf_leitura on storage.objects;
create policy os_pdf_leitura on storage.objects for select to authenticated
  using (bucket_id = 'os-assinadas' and public.pode_ver_pdf((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- 10. Funções internas (só são chamadas de dentro das outras funções)
-- ---------------------------------------------------------------------
-- usuário atual aprovado; erro se não houver
create or replace function public._ator()
returns public.perfis language plpgsql stable security definer set search_path = public as $$
declare p public.perfis;
begin
  select * into p from public.perfis where user_id = auth.uid() and ativo;
  if p.user_id is null then raise exception 'Acesso negado.'; end if;
  return p;
end $$;

create or replace function public._hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public._dias(p text) returns int language sql immutable as $$ select case p when 'Urgente' then 2 when 'Alta' then 10 when 'Normal' then 30 end $$;
create or replace function public._dm(d date) returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;
create or replace function public._planilha_ativa() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select planilha_ativa from public.sistema_config where id = 1), false) $$;

create or replace function public._evento(p_os bigint, p_acao text, p_detalhe text, p_interno boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis;
begin
  select * into a from public.perfis where user_id = auth.uid();
  insert into public.os_eventos (os_id, quem, quem_nome, perfil, acao, detalhe, interno)
  values (p_os, auth.uid(), coalesce(a.nome, a.email), a.perfil, p_acao, p_detalhe, p_interno);
end $$;

create or replace function public._email(p_os bigint, p_empresa text, p_assunto text, p_corpo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_para text;
begin
  select nullif(trim(email), '') into v_para from public.empresas where nome = p_empresa;
  insert into public.email_fila (os_id, empresa, para, assunto, corpo, situacao)
  values (p_os, p_empresa, v_para, p_assunto, p_corpo, case when v_para is null then 'Sem e-mail cadastrado' else 'Na fila' end);
end $$;

-- próximo número/ano: único entre todas as empresas; trava para não repetir em pedidos simultâneos
create or replace function public._proximo_numero()
returns text language plpgsql security definer set search_path = public as $$
declare v_ano text := to_char(public._hoje(), 'YYYY'); v_max int;
begin
  perform pg_advisory_xact_lock(hashtext('os_numero'));
  select coalesce(max(split_part(numero, '/', 1)::int), 0) into v_max
    from public.os where numero ~ ('^\d+/' || v_ano || '$');
  return (v_max + 1) || '/' || v_ano;
end $$;

-- confere os dados do formulário contra as regras e o modelo; devolve os dados normalizados
create or replace function public._validar_os(d jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m public.os_modelo; e public.entidades; emp public.empresas;
  v_serv text[]; v_mot text[]; v_outro text; v_amb jsonb := '[]'; a jsonb; v_chaves text[] := '{}'; v_chave text;
  v_rn text; v_rc text; v_resp jsonb := '[]'; q jsonb; val jsonb; v_txt text; v_fora boolean; v_splits int; v_soma int := 0; v_ambn text; v_q int;
  SERV constant text[] := array['MANUT. PREVENTIVA','MANUT. CORRETIVA','INSTALAÇÃO','DESINSTALAÇÃO'];
begin
  select * into m from public.os_modelo where id = 1;
  select * into e from public.entidades where id = d->>'entidade_id';
  if e.id is null or not e.ativo then raise exception 'Escolha a escola ou entidade na base.'; end if;
  select * into emp from public.empresas where nome = d->>'empresa' and ativa;
  if emp.nome is null then raise exception 'Escolha a empresa.'; end if;
  if coalesce(d->>'prioridade', '') not in ('Urgente','Alta','Normal') then raise exception 'Escolha a prioridade.'; end if;
  select coalesce(array_agg(s order by array_position(SERV, s)), '{}') into v_serv
    from (select distinct s from jsonb_array_elements_text(coalesce(d->'servicos', '[]')) s where s = any(SERV)) x;
  if cardinality(v_serv) = 0 then raise exception 'Marque ao menos um tipo de serviço.'; end if;
  if d->'splits' is not null and jsonb_typeof(d->'splits') <> 'null' then
    if jsonb_typeof(d->'splits') <> 'number' or (d->>'splits')::numeric <> floor((d->>'splits')::numeric) or (d->>'splits')::numeric not between 0 and 500 then
      raise exception 'Quantidade de splits inválida.'; end if;
    v_splits := (d->>'splits')::int;
  end if;
  if coalesce(d->>'origem', '') not in ('redmine','sei','gerencia') then raise exception 'Informe a origem da demanda.'; end if;
  if d->>'origem' <> 'gerencia' and nullif(trim(d->>'origem_num'), '') is null then
    raise exception 'Informe o número do %.', case d->>'origem' when 'sei' then 'processo SEI' else 'chamado no Redmine' end; end if;
  v_fora := not (e.gre = any(emp.gres) or e.municipio = any(emp.municipios));
  if v_fora and length(trim(coalesce(d->>'fora_just', ''))) < 10 then
    raise exception 'A empresa escolhida não atende esta GRE ou município. Justifique a escolha (mínimo de 10 caracteres).'; end if;
  -- motivos
  select coalesce(array_agg(distinct trim(t)), '{}') into v_mot from jsonb_array_elements_text(coalesce(d->'motivos', '[]')) t where trim(t) <> '';
  foreach v_txt in array v_mot loop
    if not exists (select 1 from jsonb_array_elements(m.motivos) o where o->>'texto' = v_txt and (o->>'ativo')::boolean) then
      raise exception 'Motivo inválido: %.', v_txt; end if;
  end loop;
  v_outro := nullif(trim(coalesce(d->>'motivo_outro', '')), '');
  if v_outro is not null and not m.motivo_outro then raise exception 'O motivo "Outro" não está habilitado no modelo.'; end if;
  if cardinality(v_mot) = 0 and v_outro is null then raise exception 'Informe ao menos um motivo da O.S.'; end if;
  if v_outro is not null and length(v_outro) < 3 then raise exception 'Descreva o outro motivo.'; end if;
  select coalesce(array_agg(t order by t), '{}') into v_mot from unnest(v_mot) t;
  if v_outro is not null then v_mot := v_mot || ('Outro: ' || v_outro); end if;
  -- ambientes
  for a in select * from jsonb_array_elements(coalesce(d->'ambientes', '[]')) loop
    v_ambn := trim(coalesce(a->>'ambiente', ''));
    if v_ambn <> 'Outro' and not exists (select 1 from jsonb_array_elements(m.ambientes) o where o->>'texto' = v_ambn and (o->>'ativo')::boolean) then
      raise exception 'Ambiente inválido: %.', v_ambn; end if;
    if v_ambn = 'Outro' then
      if length(trim(coalesce(a->>'outro', ''))) < 3 then raise exception 'Descreva o ambiente "Outro".'; end if;
      v_ambn := 'Outro: ' || trim(a->>'outro');
    end if;
    if coalesce(jsonb_typeof(a->'splits'), 'null') <> 'number' or (a->>'splits')::numeric <> floor((a->>'splits')::numeric) or (a->>'splits')::numeric not between 1 and 200 then
      raise exception 'Quantidade de splits inválida em %.', v_ambn; end if;
    v_q := (a->>'splits')::int;
    v_chave := upper(v_ambn);
    if v_chave = any(v_chaves) then raise exception 'Há ambiente repetido. Some as quantidades em uma linha só.'; end if;
    v_chaves := v_chaves || v_chave; v_soma := v_soma + v_q;
    v_amb := v_amb || jsonb_build_object('ambiente', v_ambn, 'splits', v_q);
  end loop;
  if coalesce((m.campos->'ambientes'->>'obrigatorio')::boolean, false) and jsonb_array_length(v_amb) = 0 then raise exception 'Informe ao menos um ambiente.'; end if;
  if jsonb_array_length(v_amb) > 0 then v_splits := v_soma; end if;
  -- responsável pela entidade
  v_rn := nullif(trim(coalesce(d->>'resp_nome', '')), ''); v_rc := nullif(trim(coalesce(d->>'resp_contato', '')), '');
  if coalesce((m.campos->'responsavel'->>'obrigatorio')::boolean, false) and (v_rn is null or v_rc is null) then
    raise exception 'Informe o nome e o contato do responsável pela entidade.'; end if;
  if (v_rn is null) <> (v_rc is null) then raise exception 'Informe o nome e o contato do responsável juntos.'; end if;
  if v_rc is not null and not (v_rc ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(regexp_replace(v_rc, '\D', '', 'g')) >= 10) then
    raise exception 'Contato do responsável inválido: use telefone com DDD ou e-mail.'; end if;
  if coalesce((m.campos->'descricao'->>'obrigatorio')::boolean, false) and length(trim(coalesce(d->>'observacoes', ''))) < 5 then
    raise exception 'Descreva o problema ou o serviço.'; end if;
  -- campos adicionais do modelo
  for q in select * from jsonb_array_elements(m.perguntas) where coalesce((value->>'ativo')::boolean, true) loop
    val := d->'respostas'->(q->>'id');
    if val is null or jsonb_typeof(val) = 'null' or (jsonb_typeof(val) = 'string' and trim(val #>> '{}') = '') or (jsonb_typeof(val) = 'array' and jsonb_array_length(val) = 0) then
      if coalesce((q->>'obrigatorio')::boolean, false) then raise exception 'Responda: %.', q->>'rotulo'; end if;
      continue;
    end if;
    if q->>'tipo' = 'multipla' then
      if jsonb_typeof(val) <> 'array' or exists (select 1 from jsonb_array_elements_text(val) x where not (q->'opcoes') ? x) then
        raise exception '%: opção inválida.', q->>'rotulo'; end if;
    else
      v_txt := trim(val #>> '{}');
      if q->>'tipo' = 'numero' and v_txt !~ '^-?\d+([.,]\d+)?$' then raise exception '%: informe um número.', q->>'rotulo'; end if;
      if q->>'tipo' = 'data' and v_txt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '%: data inválida.', q->>'rotulo'; end if;
      if q->>'tipo' = 'simnao' and v_txt not in ('Sim','Não') then raise exception '%: responda Sim ou Não.', q->>'rotulo'; end if;
      if q->>'tipo' = 'unica' and not (q->'opcoes') ? v_txt then raise exception '%: opção inválida.', q->>'rotulo'; end if;
      val := to_jsonb(left(v_txt, 2000));
    end if;
    v_resp := v_resp || jsonb_build_object('id', q->>'id', 'rotulo', q->>'rotulo', 'tipo', q->>'tipo', 'valor', val);
  end loop;
  return jsonb_build_object(
    'entidade_id', e.id, 'escola', e.nome, 'inep', e.inep, 'gre', e.gre, 'municipio', e.municipio, 'zona', e.zona, 'endereco', e.endereco,
    'empresa', emp.nome, 'prioridade', d->>'prioridade', 'descricao', array_to_string(v_serv, ', '), 'splits', v_splits,
    'observacoes', nullif(left(trim(coalesce(d->>'observacoes', '')), 2000), ''), 'origem', d->>'origem',
    'origem_num', nullif(trim(coalesce(d->>'origem_num', '')), ''), 'fora_area', v_fora, 'fora_just', case when v_fora then trim(d->>'fora_just') end,
    'motivos', to_jsonb(v_mot), 'ambientes', v_amb, 'resp_nome', v_rn, 'resp_contato', v_rc, 'respostas', v_resp, 'modelo_versao', m.versao);
end $$;

-- grava os dados validados na O.S. e guarda o responsável da entidade para sugerir na próxima
create or replace function public._aplicar_os(p_id bigint, v jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis;
begin
  update public.os set
    entidade_id = v->>'entidade_id', escola = v->>'escola', inep = v->>'inep', gre = v->>'gre', municipio = v->>'municipio',
    zona = v->>'zona', endereco = v->>'endereco', empresa = v->>'empresa', prioridade = v->>'prioridade', descricao = v->>'descricao',
    splits = (v->>'splits')::int, observacoes = v->>'observacoes', origem = v->>'origem', origem_num = v->>'origem_num',
    id_sei = case when v->>'origem' = 'sei' then v->>'origem_num' else id_sei end,
    fora_area = (v->>'fora_area')::boolean, fora_just = v->>'fora_just',
    motivos = array(select jsonb_array_elements_text(v->'motivos')), ambientes = v->'ambientes',
    resp_nome = v->>'resp_nome', resp_contato = v->>'resp_contato', respostas = v->'respostas', modelo_versao = (v->>'modelo_versao')::int
  where id = p_id;
  if v->>'resp_nome' is not null then
    select * into a from public.perfis where user_id = auth.uid();
    insert into public.entidade_contatos (entidade_id, nome, contato, atualizado_por, atualizado_por_id, atualizado_em)
    values (v->>'entidade_id', v->>'resp_nome', v->>'resp_contato', coalesce(a.nome, a.email), auth.uid(), now())
    on conflict (entidade_id) do update set nome = excluded.nome, contato = excluded.contato, atualizado_por = excluded.atualizado_por,
      atualizado_por_id = excluded.atualizado_por_id, atualizado_em = excluded.atualizado_em
    where entidade_contatos.nome is distinct from excluded.nome or entidade_contatos.contato is distinct from excluded.contato;
  end if;
end $$;

-- emissão: prazo começa hoje e a empresa entra na fila de avisos
create or replace function public._emitir(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.os; a public.perfis;
begin
  select * into a from public.perfis where user_id = auth.uid();
  update public.os set status = 'Emitida', criada_em = public._hoje(), prazo = public._hoje() + public._dias(prioridade),
         aprovado_por = auth.uid(), aprovado_nome = coalesce(a.nome, a.email), aprovado_em = now(), devolucao_obs = null
   where id = p_id returning * into o;
  perform public._email(o.id, o.empresa, 'Nova O.S. ' || o.numero || ' · ' || o.prioridade,
    'Prazo: ' || public._dm(o.prazo) || E'\nEscola/entidade: ' || o.escola || ' (' || coalesce(o.municipio, '') || ')' ||
    E'\nServiço: ' || coalesce(o.descricao, '') || coalesce(E'\nSplits: ' || o.splits, '') || coalesce(E'\nDescrição: ' || o.observacoes, '') ||
    coalesce(E'\nResponsável na entidade: ' || o.resp_nome || ' · ' || o.resp_contato, ''));
end $$;

-- carrega a O.S. para uma ação, travando a linha, e barra as antigas enquanto a planilha estiver ativa
create or replace function public._os_para_acao(p_id bigint)
returns public.os language plpgsql security definer set search_path = public as $$
declare o public.os;
begin
  select * into o from public.os where id = p_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  if o.legado and public._planilha_ativa() then
    raise exception 'Esta O.S. veio da planilha e ainda é atualizada por ela até o encerramento (30/11). Faça a alteração na planilha.'; end if;
  return o;
end $$;

-- ---------------------------------------------------------------------
-- 11. Funções da emissão (chamadas pelo site)
-- ---------------------------------------------------------------------
create or replace function public.os_solicitar(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v jsonb; v_num text; v_id bigint; v_emitida boolean := false;
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a equipe da GMAP emite O.S.'; end if;
  v := public._validar_os(p_dados);
  -- o número/ano é reservado na solicitação; se recusada, o número fica registrado como "Recusada"
  v_num := public._proximo_numero();
  insert into public.os (chave, numero, empresa, status, legado, solicitado_por, solicitado_nome, solicitado_em)
  values (v_num, v_num, v->>'empresa', 'Aguardando aprovação', false, a.user_id, coalesce(a.nome, a.email), now())
  returning id into v_id;
  perform public._aplicar_os(v_id, v);
  perform public._evento(v_id, 'solicitou', 'Nº ' || v_num || ' reservado. ' || case when (v->>'fora_area')::boolean then 'Empresa fora da área sugerida. ' else '' end
    || 'Origem: ' || (v->>'origem') || coalesce(' ' || (v->>'origem_num'), ''), true);
  if a.perfil = 'gmap' then   -- a gerência é quem aprova: quando ela mesma emite, a aprovação é imediata e fica registrada
    perform public._emitir(v_id);
    perform public._evento(v_id, 'emitiu', 'Emitida diretamente pela gerência. Prazo ' || public._dm((select prazo from public.os where id = v_id)));
    v_emitida := true;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'emitida', v_emitida);
end $$;

create or replace function public.os_reenviar(p_id bigint, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v jsonb;
begin
  o := public._os_para_acao(p_id);
  if o.solicitado_por is distinct from a.user_id then raise exception 'Só quem solicitou pode corrigir e reenviar.'; end if;
  if o.status not in ('Devolvida','Aguardando aprovação') then raise exception 'Esta solicitação não pode mais ser alterada.'; end if;
  v := public._validar_os(p_dados);
  perform public._aplicar_os(p_id, v);
  update public.os set status = 'Aguardando aprovação' where id = p_id;
  perform public._evento(p_id, 'reenviou', 'Solicitação corrigida e reenviada para aprovação', true);
end $$;

create or replace function public.os_decidir(p_id bigint, p_acao text, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência aprova a emissão.'; end if;
  o := public._os_para_acao(p_id);
  if o.status <> 'Aguardando aprovação' then raise exception 'Esta solicitação não está aguardando aprovação.'; end if;
  if p_acao = 'aprovar' then
    perform public._emitir(p_id);
    perform public._evento(p_id, 'aprovou', 'Prazo ' || public._dm((select prazo from public.os where id = p_id)) || coalesce('. ' || v_obs, ''));
  elsif p_acao in ('devolver','recusar') then
    if length(coalesce(v_obs, '')) < 5 then raise exception '%', case p_acao when 'devolver' then 'Escreva o que precisa ser corrigido.' else 'Informe o motivo da recusa.' end; end if;
    update public.os set status = case p_acao when 'devolver' then 'Devolvida' else 'Recusada' end, devolucao_obs = v_obs where id = p_id;
    perform public._evento(p_id, case p_acao when 'devolver' then 'devolveu' else 'recusou' end, v_obs, true);
  else raise exception 'Ação inválida.';
  end if;
  return jsonb_build_object('numero', o.numero);
end $$;

create or replace function public.os_atendimento(p_id bigint, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_data date; v_just text; v_pend text; v_pdf text; v_cam text; v_corr boolean; v_mot text;
begin
  o := public._os_para_acao(p_id);
  if a.perfil <> 'empresa' or o.empresa is distinct from a.empresa then raise exception 'Somente a empresa responsável registra o atendimento.'; end if;
  if o.revisao then raise exception 'Esta O.S. está em revisão pela GMAP. Aguarde a revisão para registrar o atendimento.'; end if;
  v_corr := o.status = 'Atendida';
  if not v_corr and o.status not in ('Emitida','Stand by') then raise exception 'Esta O.S. não está em aberto.'; end if;
  begin v_data := (p_dados->>'data')::date; exception when others then v_data := null; end;
  if v_data is null then raise exception 'Informe a data do atendimento.'; end if;
  if v_data > public._hoje() then raise exception 'A data do atendimento não pode ser futura.'; end if;
  v_just := nullif(trim(coalesce(p_dados->>'justificativa', '')), ''); v_pend := nullif(trim(coalesce(p_dados->>'pendencias', '')), '');
  if o.prazo is not null and v_data > o.prazo and length(coalesce(v_just, '')) < 10 then
    raise exception 'Atendimento depois do prazo: a justificativa é obrigatória (mínimo de 10 caracteres).'; end if;
  v_pdf := nullif(trim(coalesce(p_dados->>'pdf_nome', '')), ''); v_cam := nullif(trim(coalesce(p_dados->>'pdf_caminho', '')), '');
  if v_cam is not null and split_part(v_cam, '/', 1) <> o.id::text then raise exception 'Arquivo inválido.'; end if;
  if v_pdf is null and v_corr then v_pdf := o.pdf_nome; v_cam := o.pdf_caminho; end if;
  if v_pdf is null then raise exception 'Anexe a O.S. assinada em PDF.'; end if;
  v_mot := nullif(trim(coalesce(p_dados->>'motivo_correcao', '')), '');
  if v_corr and length(coalesce(v_mot, '')) < 10 then raise exception 'Informe o motivo da correção (mínimo de 10 caracteres).'; end if;
  update public.os set atendida_em = v_data, justificativa = v_just, pendencias = v_pend, pdf_nome = v_pdf, pdf_caminho = v_cam,
         status = 'Atendida', standby_motivo = null, standby_por = null,
         atendido_por = case when v_corr then atendido_por else a.user_id end, atendido_nome = case when v_corr then atendido_nome else coalesce(a.nome, a.email) end
   where id = p_id;
  if v_corr then
    perform public._evento(p_id, 'corrigiu atendimento', 'Motivo: ' || v_mot || '. Antes: data ' || coalesce(public._dm(o.atendida_em), 'vazia')
      || case when o.pdf_nome is distinct from v_pdf then ', PDF ' || coalesce(o.pdf_nome, 'nenhum') else '' end
      || case when o.pendencias is distinct from v_pend then ', pendências "' || coalesce(o.pendencias, '') || '"' else '' end
      || '. Depois: data ' || public._dm(v_data) || case when o.pdf_nome is distinct from v_pdf then ', PDF ' || v_pdf else '' end
      || case when o.pendencias is distinct from v_pend then ', pendências "' || coalesce(v_pend, '') || '"' else '' end);
  else
    perform public._evento(p_id, 'registrou atendimento', 'Data ' || public._dm(v_data) || '. PDF: ' || v_pdf || coalesce('. Pendências: ' || v_pend, ''));
  end if;
end $$;

create or replace function public.os_desfazer_atendimento(p_id bigint, p_just text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  o := public._os_para_acao(p_id);
  if a.perfil = 'empresa' and o.empresa is distinct from a.empresa then raise exception 'O.S. não encontrada.'; end if;
  if o.status <> 'Atendida' then raise exception 'Esta O.S. não está atendida.'; end if;
  if not (o.atendido_por = a.user_id or a.perfil = 'gmap') then raise exception 'Só quem registrou o atendimento ou a gerência pode desfazê-lo.'; end if;
  if length(trim(coalesce(p_just, ''))) < 10 then raise exception 'A justificativa é obrigatória (mínimo de 10 caracteres).'; end if;
  perform public._evento(p_id, 'desfez atendimento', 'Justificativa: ' || trim(p_just) || '. Atendimento desfeito: data ' || coalesce(public._dm(o.atendida_em), 'vazia')
    || ', PDF ' || coalesce(o.pdf_nome, 'nenhum'));
  update public.os set status = 'Emitida', atendida_em = null, atendido_por = null, atendido_nome = null where id = p_id;
end $$;

create or replace function public.os_standby(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  o := public._os_para_acao(p_id);
  if not (a.perfil in ('gmap','tecnico') or (a.perfil = 'empresa' and o.empresa = a.empresa)) then raise exception 'Sem permissão.'; end if;
  if o.status <> 'Emitida' then raise exception 'Só uma O.S. emitida pode entrar em stand by.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Descreva a pendência (mínimo de 10 caracteres).'; end if;
  update public.os set status = 'Stand by', standby_motivo = trim(p_motivo), standby_por = case when a.perfil = 'empresa' then 'empresa' else 'gmap' end where id = p_id;
  perform public._evento(p_id, 'colocou em stand by', trim(p_motivo) || '. O prazo continua correndo.');
end $$;

create or replace function public.os_retomar(p_id bigint, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  o := public._os_para_acao(p_id);
  if o.status <> 'Stand by' then raise exception 'Esta O.S. não está em stand by.'; end if;
  if not (a.perfil in ('gmap','tecnico') or (a.perfil = 'empresa' and o.empresa = a.empresa and o.standby_por = 'empresa')) then
    raise exception 'Só quem colocou em stand by ou a GMAP pode retomar.'; end if;
  perform public._evento(p_id, 'retomou', 'Saiu do stand by' || coalesce(': ' || nullif(trim(p_obs), ''), ''));
  update public.os set status = 'Emitida', standby_motivo = null, standby_por = null where id = p_id;
end $$;

create or replace function public.os_cancelar(p_id bigint, p_motivo text, p_texto text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_txt text := nullif(trim(coalesce(p_texto, '')), ''); v_m text;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência cancela O.S.'; end if;
  o := public._os_para_acao(p_id);
  if o.status = 'Atendida' then raise exception 'O.S. atendida não pode ser cancelada.'; end if;
  if o.status not in ('Emitida','Stand by') then raise exception 'Esta O.S. não pode ser cancelada.'; end if;
  if p_motivo is distinct from 'Outro motivo' and not exists (select 1 from public.os_modelo m, jsonb_array_elements(m.motivos_cancelamento) x
                                                             where x->>'texto' = p_motivo and (x->>'ativo')::boolean) then
    raise exception 'Escolha o motivo do cancelamento.'; end if;
  if p_motivo = 'Outro motivo' and length(coalesce(v_txt, '')) < 10 then raise exception 'Descreva o motivo (mínimo de 10 caracteres).'; end if;
  v_m := case when p_motivo = 'Outro motivo' then v_txt else p_motivo || coalesce(': ' || v_txt, '') end;
  update public.os set status = 'Cancelada', motivo_cancelamento = v_m, revisao = false where id = p_id;
  perform public._evento(p_id, 'cancelou', v_m);
  perform public._email(p_id, o.empresa, 'O.S. ' || o.numero || ' cancelada', 'Motivo: ' || v_m);
end $$;

create or replace function public.os_revisao(p_id bigint, p_sugestao text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a GMAP coloca O.S. em revisão.'; end if;
  o := public._os_para_acao(p_id);
  if o.status not in ('Emitida','Stand by') then raise exception 'Só O.S. em aberto podem entrar em revisão.'; end if;
  if o.revisao then raise exception 'Esta O.S. já está em revisão.'; end if;
  if length(trim(coalesce(p_sugestao, ''))) < 10 then raise exception 'Descreva a correção sugerida (mínimo de 10 caracteres).'; end if;
  update public.os set revisao = true, revisao_sugestao = trim(p_sugestao), revisao_nome = coalesce(a.nome, a.email), revisao_em = now() where id = p_id;
  perform public._evento(p_id, 'colocou em revisão', 'Sugestão: ' || trim(p_sugestao), true);
  perform public._evento(p_id, 'em revisão', 'A GMAP está revisando os dados desta O.S.');
end $$;

create or replace function public.os_encerrar_revisao(p_id bigint, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência encerra a revisão.'; end if;
  o := public._os_para_acao(p_id);
  if not o.revisao then raise exception 'Esta O.S. não está em revisão.'; end if;
  if length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Explique por que a sugestão não foi aplicada.'; end if;
  update public.os set revisao = false where id = p_id;
  perform public._evento(p_id, 'encerrou revisão sem alterar', trim(p_obs), true);
  perform public._evento(p_id, 'revisão concluída', 'Dados mantidos');
end $$;

create or replace function public.os_editar(p_id bigint, p_dados jsonb, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; n public.os; v jsonb; v_mud text[] := '{}';
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência edita O.S. emitidas.'; end if;
  o := public._os_para_acao(p_id);
  if o.status not in ('Emitida','Stand by') then raise exception 'Só O.S. em aberto podem ser editadas.'; end if;
  if length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da edição.'; end if;
  v := public._validar_os(p_dados);
  perform public._aplicar_os(p_id, v);
  update public.os set prazo = case when o.prioridade is distinct from prioridade then criada_em + public._dias(prioridade) else prazo end, revisao = false
   where id = p_id returning * into n;
  -- o que mudou, com antes e depois
  if o.empresa is distinct from n.empresa then v_mud := v_mud || format('Empresa: "%s" → "%s"', o.empresa, n.empresa); end if;
  if o.prioridade is distinct from n.prioridade then v_mud := v_mud || format('Prioridade: "%s" → "%s"', o.prioridade, n.prioridade); end if;
  if o.prazo is distinct from n.prazo then v_mud := v_mud || format('Prazo: %s → %s', public._dm(o.prazo), public._dm(n.prazo)); end if;
  if o.descricao is distinct from n.descricao then v_mud := v_mud || format('Serviço: "%s" → "%s"', o.descricao, n.descricao); end if;
  if o.splits is distinct from n.splits then v_mud := v_mud || format('Splits: %s → %s', coalesce(o.splits::text, 'vazio'), coalesce(n.splits::text, 'vazio')); end if;
  if o.escola is distinct from n.escola then v_mud := v_mud || format('Escola: "%s" → "%s"', o.escola, n.escola); end if;
  if o.motivos is distinct from n.motivos then v_mud := v_mud || format('Motivos: "%s" → "%s"', array_to_string(o.motivos, '; '), array_to_string(n.motivos, '; ')); end if;
  if o.ambientes is distinct from n.ambientes then v_mud := v_mud || ('Ambientes alterados: ' || coalesce((select string_agg((x->>'ambiente') || ' (' || (x->>'splits') || ')', ', ') from jsonb_array_elements(n.ambientes) x), 'nenhum')); end if;
  if o.observacoes is distinct from n.observacoes then v_mud := v_mud || 'Descrição alterada'::text; end if;
  if o.origem is distinct from n.origem or o.origem_num is distinct from n.origem_num then
    v_mud := v_mud || format('Origem: %s %s → %s %s', coalesce(o.origem, ''), coalesce(o.origem_num, ''), n.origem, coalesce(n.origem_num, '')); end if;
  if o.resp_nome is distinct from n.resp_nome or o.resp_contato is distinct from n.resp_contato then
    v_mud := v_mud || format('Responsável: "%s" → "%s"', coalesce(o.resp_nome, ''), coalesce(n.resp_nome, '')); end if;
  if o.respostas is distinct from n.respostas then v_mud := v_mud || 'Campos adicionais alterados'::text; end if;
  perform public._evento(p_id, 'editou', coalesce(nullif(array_to_string(v_mud, '; '), ''), 'Sem mudança de dados') || '. Motivo: ' || trim(p_obs));
  if o.revisao then perform public._evento(p_id, 'revisão concluída', 'Dados corrigidos pela gerência'); end if;
  if o.empresa is distinct from n.empresa then
    perform public._email(p_id, o.empresa, 'O.S. ' || o.numero || ' transferida para outra empresa', 'Esta O.S. não está mais sob sua responsabilidade.');
  end if;
  perform public._email(p_id, n.empresa, 'O.S. ' || n.numero || ' alterada', coalesce(nullif(array_to_string(v_mud, E'\n'), ''), 'Revisão concluída sem mudança de dados.'));
end $$;

-- aplica nas O.S. em aberto os dados atuais da base de entidades (campo vazio na base nunca apaga o da O.S.)
create or replace function public.os_aplicar_entidade(p_ids bigint[], p_obs text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; e public.entidades; v_mud text[]; n int := 0;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência aplica correções da base.'; end if;
  if length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  for o in select * from public.os where id = any(p_ids) and status in ('Emitida','Stand by') and not (legado and public._planilha_ativa()) for update loop
    select * into e from public.entidades where id = o.entidade_id and ativo;
    continue when e.id is null;
    v_mud := '{}';
    if nullif(trim(e.nome), '') is not null and o.escola is distinct from e.nome then v_mud := v_mud || format('Nome: "%s" → "%s"', o.escola, e.nome); end if;
    if nullif(trim(e.inep), '') is not null and o.inep is distinct from e.inep then v_mud := v_mud || format('INEP: "%s" → "%s"', o.inep, e.inep); end if;
    if nullif(trim(e.gre), '') is not null and o.gre is distinct from e.gre then v_mud := v_mud || format('GRE: "%s" → "%s"', o.gre, e.gre); end if;
    if nullif(trim(e.municipio), '') is not null and o.municipio is distinct from e.municipio then v_mud := v_mud || format('Município: "%s" → "%s"', o.municipio, e.municipio); end if;
    if nullif(trim(e.zona), '') is not null and o.zona is distinct from e.zona then v_mud := v_mud || format('Zona: "%s" → "%s"', o.zona, e.zona); end if;
    if nullif(trim(e.endereco), '') is not null and o.endereco is distinct from e.endereco then v_mud := v_mud || format('Endereço: "%s" → "%s"', o.endereco, e.endereco); end if;
    continue when cardinality(v_mud) = 0;
    update public.os set escola = coalesce(nullif(trim(e.nome), ''), escola), inep = coalesce(nullif(trim(e.inep), ''), inep), gre = coalesce(nullif(trim(e.gre), ''), gre),
           municipio = coalesce(nullif(trim(e.municipio), ''), municipio), zona = coalesce(nullif(trim(e.zona), ''), zona), endereco = coalesce(nullif(trim(e.endereco), ''), endereco)
     where id = o.id;
    perform public._evento(o.id, 'atualizou dados da escola', array_to_string(v_mud, '; ') || '. Motivo: ' || trim(p_obs));
    n := n + 1;
  end loop;
  return jsonb_build_object('atualizadas', n);
end $$;

create or replace function public.empresa_salvar(p_nome text, p_email text, p_gres text[], p_municipios text[])
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera os dados das empresas.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  update public.empresas set email = v_email, gres = coalesce(p_gres, '{}'), municipios = coalesce(p_municipios, '{}'),
         alterado_por = coalesce(a.nome, a.email), alterado_em = now()
   where nome = p_nome;
  if not found then raise exception 'Empresa não encontrada.'; end if;
end $$;

-- modelo da O.S.: só a gerência altera; cada versão fica no histórico com o modelo completo
create or replace function public.modelo_salvar(p_modelo jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); m public.os_modelo; k text; L jsonb; o jsonb; v_lista jsonb; v_perg jsonb := '[]'; q jsonb;
        v_nomes text[] := array['motivos','ambientes','motivos_cancelamento']; v_rot text[] := array['Motivos','Ambientes','Motivos de cancelamento'];
        v_novo jsonb := '{}'; v_res text[] := '{}'; v_ent text; v_sai text; i int; v_campos jsonb;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera o modelo da O.S.'; end if;
  select * into m from public.os_modelo where id = 1 for update;
  for i in 1..3 loop
    k := v_nomes[i]; L := p_modelo->k;
    if L is null or jsonb_typeof(L) <> 'array' then raise exception 'Lista inválida: %.', v_rot[i]; end if;
    v_lista := '[]';
    for o in select * from jsonb_array_elements(L) loop
      if length(trim(coalesce(o->>'texto', ''))) < 2 then raise exception 'Há opção vazia em %.', v_rot[i]; end if;
      v_lista := v_lista || jsonb_build_object('id', coalesce(nullif(o->>'id', ''), 'o' || substr(md5(random()::text), 1, 6)),
                                               'texto', left(trim(o->>'texto'), 80), 'ativo', coalesce((o->>'ativo')::boolean, true));
    end loop;
    if exists (select upper(x->>'texto') from jsonb_array_elements(v_lista) x where (x->>'ativo')::boolean group by 1 having count(*) > 1) then
      raise exception 'Há opção repetida em %.', v_rot[i]; end if;
    if not exists (select 1 from jsonb_array_elements(v_lista) x where (x->>'ativo')::boolean) then raise exception 'Deixe ao menos uma opção ativa em %.', v_rot[i]; end if;
    v_novo := v_novo || jsonb_build_object(k, v_lista);
    select string_agg(t, ', ') into v_ent from (select x->>'texto' t from jsonb_array_elements(v_lista) x where (x->>'ativo')::boolean
      except select x->>'texto' from jsonb_array_elements(to_jsonb(m) -> k) x where (x->>'ativo')::boolean) z;
    select string_agg(t, ', ') into v_sai from (select x->>'texto' t from jsonb_array_elements(to_jsonb(m) -> k) x where (x->>'ativo')::boolean
      except select x->>'texto' from jsonb_array_elements(v_lista) x where (x->>'ativo')::boolean) z;
    if v_ent is not null then v_res := v_res || (v_rot[i] || ': incluiu ' || v_ent); end if;
    if v_sai is not null then v_res := v_res || (v_rot[i] || ': desativou ' || v_sai); end if;
  end loop;
  for q in select * from jsonb_array_elements(coalesce(p_modelo->'perguntas', '[]')) loop
    if length(trim(coalesce(q->>'rotulo', ''))) < 3 then raise exception 'Toda pergunta precisa de um título.'; end if;
    if coalesce(q->>'tipo', '') not in ('texto','textolongo','numero','data','unica','multipla','simnao') then raise exception 'Tipo de pergunta inválido.'; end if;
    if q->>'tipo' in ('unica','multipla') and (select count(*) from jsonb_array_elements_text(coalesce(q->'opcoes', '[]')) t where trim(t) <> '') < 2 then
      raise exception 'A pergunta "%" precisa de pelo menos 2 opções.', q->>'rotulo'; end if;
    v_perg := v_perg || jsonb_build_object('id', coalesce(nullif(q->>'id', ''), 'q' || substr(md5(random()::text), 1, 6)), 'rotulo', left(trim(q->>'rotulo'), 120),
      'tipo', q->>'tipo', 'obrigatorio', coalesce((q->>'obrigatorio')::boolean, false), 'ajuda', left(trim(coalesce(q->>'ajuda', '')), 200),
      'opcoes', coalesce((select jsonb_agg(left(trim(t), 120)) from jsonb_array_elements_text(coalesce(q->'opcoes', '[]')) t where trim(t) <> ''), '[]'),
      'ativo', coalesce((q->>'ativo')::boolean, true));
  end loop;
  v_campos := jsonb_build_object('ambientes', jsonb_build_object('obrigatorio', coalesce((p_modelo#>>'{campos,ambientes,obrigatorio}')::boolean, false)),
                                 'responsavel', jsonb_build_object('obrigatorio', coalesce((p_modelo#>>'{campos,responsavel,obrigatorio}')::boolean, false)),
                                 'descricao', jsonb_build_object('obrigatorio', coalesce((p_modelo#>>'{campos,descricao,obrigatorio}')::boolean, false)));
  if v_perg is distinct from m.perguntas then v_res := v_res || 'campos adicionais alterados'::text; end if;
  if v_campos is distinct from m.campos or coalesce((p_modelo->>'motivo_outro')::boolean, true) is distinct from m.motivo_outro then v_res := v_res || 'regras dos campos alteradas'::text; end if;
  if cardinality(v_res) = 0 and v_novo->'motivos' = m.motivos and v_novo->'ambientes' = m.ambientes and v_novo->'motivos_cancelamento' = m.motivos_cancelamento then
    return jsonb_build_object('versao', m.versao, 'sem_mudanca', true); end if;
  if cardinality(v_res) = 0 then v_res := array['textos das opções ajustados']; end if;
  update public.os_modelo set versao = versao + 1, motivos = v_novo->'motivos', ambientes = v_novo->'ambientes', motivos_cancelamento = v_novo->'motivos_cancelamento',
         motivo_outro = coalesce((p_modelo->>'motivo_outro')::boolean, true), campos = v_campos, perguntas = v_perg,
         alterado_por = coalesce(a.nome, a.email), alterado_em = now()
   where id = 1 returning * into m;
  insert into public.os_modelo_log (versao, quem, quem_nome, resumo, modelo) values (m.versao, a.user_id, coalesce(a.nome, a.email), array_to_string(v_res, '; '), to_jsonb(m));
  return jsonb_build_object('versao', m.versao);
end $$;

-- ---------------------------------------------------------------------
-- 12. Funções usadas pelos scripts (somente com a chave secreta)
-- ---------------------------------------------------------------------
-- Sincronização com a planilha: até o encerramento, só atualiza as O.S. antigas.
-- Nunca toca nas O.S. emitidas no sistema e não cria O.S. novas a partir da planilha.
create or replace function public.sincronizar_os(payload jsonb, origem text default 'apps-script')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int; v_ins int := 0; v_rem int; v_alt int; v_ign text[];
begin
  if not public._planilha_ativa() then
    raise exception 'A planilha foi encerrada em %. A sincronização está desligada: as O.S. agora são atualizadas só no sistema.',
      (select to_char(planilha_encerrada_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') from public.sistema_config where id = 1); end if;
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) = 0 then
    raise exception 'Payload vazio: sincronização cancelada para não apagar os dados.'; end if;

  create temp table _novo on commit drop as
  select x.*, case when x.status in ('Pendente','Em andamento') then 'Emitida' when x.status = 'Problema' then 'Stand by' else x.status end as st
  from jsonb_to_recordset(payload) as x(
    chave text, numero text, empresa text, status text, prioridade text,
    criada_em date, prazo date, atendida_em date, splits integer, descricao text,
    escola text, entidade text, inep text, gre text, municipio text, zona text,
    endereco text, id_sei text, observacoes text, justificativa text, motivo_cancelamento text);

  if exists (select chave from _novo group by chave having count(*) > 1) then
    raise exception 'Há O.S. repetidas (mesmo número e empresa) na planilha: %',
      (select string_agg(chave, ', ') from (select chave from _novo group by chave having count(*) > 1) d); end if;
  if exists (select 1 from _novo where st not in ('Emitida','Stand by','Atendida','Cancelada')) then
    raise exception 'Status desconhecido na planilha: %', (select string_agg(distinct coalesce(status, '(vazio)'), ', ') from _novo where st not in ('Emitida','Stand by','Atendida','Cancelada')); end if;

  select count(*) into v_total from _novo;
  -- linhas novas na planilha são ignoradas: O.S. novas nascem no sistema
  select array_agg(n.chave order by n.chave) into v_ign from _novo n where not exists (select 1 from os o where o.chave = n.chave);

  -- histórico: mudanças de status das antigas
  insert into os_historico (chave, empresa, status_anterior, status_novo)
  select n.chave, n.empresa, o.status, n.st from _novo n join os o on o.chave = n.chave and o.legado where o.status is distinct from n.st;
  get diagnostics v_alt = row_count;
  insert into os_eventos (os_id, quem_nome, perfil, acao, detalhe)
  select o.id, 'Planilha geral', null, 'atualizada pela planilha', 'Status: ' || coalesce(o.status, 'vazio') || ' → ' || n.st
  from _novo n join os o on o.chave = n.chave and o.legado where o.status is distinct from n.st;

  -- antigas que saíram da planilha
  delete from os o where o.legado and not exists (select 1 from _novo n where n.chave = o.chave);
  get diagnostics v_rem = row_count;

  update os o set numero = n.numero, empresa = n.empresa, status = n.st, prioridade = n.prioridade, criada_em = n.criada_em, prazo = n.prazo,
         atendida_em = n.atendida_em, splits = n.splits, descricao = n.descricao, escola = n.escola, entidade = n.entidade, inep = n.inep, gre = n.gre,
         municipio = n.municipio, zona = n.zona, endereco = n.endereco, id_sei = n.id_sei, observacoes = n.observacoes, justificativa = n.justificativa,
         motivo_cancelamento = n.motivo_cancelamento, sincronizado_em = now(),
         standby_por = case when n.st = 'Stand by' then coalesce(o.standby_por, 'empresa') end,
         standby_motivo = case when n.st = 'Stand by' then coalesce(nullif(trim(n.justificativa), ''), o.standby_motivo, 'Convertido do status "Problema" da planilha') end,
         entidade_id = coalesce(o.entidade_id, (select e.id from entidades e where e.ativo and e.inep = n.inep and (select count(*) from entidades e2 where e2.ativo and e2.inep = n.inep) = 1))
  from _novo n where o.chave = n.chave and o.legado;

  insert into sincronizacoes (registros, inseridos, removidos, status_alterados, origem) values (v_total, v_ins, v_rem, v_alt, origem);
  return jsonb_build_object('registros', v_total, 'inseridos', v_ins, 'removidos', v_rem, 'status_alterados', v_alt,
                            'ignoradas', coalesce(cardinality(v_ign), 0), 'ignoradas_chaves', coalesce(to_jsonb(v_ign[1:30]), '[]'));
end $$;

-- Importação da planilha ENTIDADES (Apps Script). Registra o que mudou; quem sai fica inativo (não é apagado).
create or replace function public.importar_entidades(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_primeira boolean := not exists (select 1 from entidades); v_ins int; v_alt int; v_rem int; v_rea int; v_vinc int;
        ESCOLA constant text[] := array['CETI','CEJA | EJA','U E - FUND | EJA','CENTRO ESPECIALIZADO'];
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) < 10 then
    raise exception 'Importação cancelada: a planilha veio vazia ou incompleta.'; end if;
  create temp table _ent on commit drop as
  select nullif(trim(id), '') id, nullif(trim(inep), '') inep, nullif(trim(nome), '') nome, nullif(trim(tipologia), '') tipologia,
         nullif(trim(municipio), '') municipio, nullif(trim(gre), '') gre, nullif(trim(zona), '') zona, nullif(trim(endereco), '') endereco
  from jsonb_to_recordset(payload) as x(id text, inep text, nome text, tipologia text, municipio text, gre text, zona text, endereco text);
  if exists (select 1 from _ent where id is null or nome is null) then raise exception 'Há linha sem ID SISTEMA ou sem nome na planilha ENTIDADES.'; end if;
  if exists (select id from _ent group by id having count(*) > 1) then
    raise exception 'ID SISTEMA repetido na planilha ENTIDADES: %', (select string_agg(id, ', ') from (select id from _ent group by id having count(*) > 1) d); end if;

  if not v_primeira then
    insert into entidades_mudancas (entidade_id, nome, tipo) select n.id, n.nome, 'incluída' from _ent n where not exists (select 1 from entidades e where e.id = n.id);
    insert into entidades_mudancas (entidade_id, nome, tipo) select e.id, e.nome, 'removida' from entidades e where e.ativo and not exists (select 1 from _ent n where n.id = e.id);
    insert into entidades_mudancas (entidade_id, nome, tipo) select e.id, n.nome, 'reativada' from entidades e join _ent n on n.id = e.id where not e.ativo;
    insert into entidades_mudancas (entidade_id, nome, tipo, campo, antes, depois)
    select e.id, n.nome, 'alterada', c.campo, c.antes, c.depois from entidades e join _ent n on n.id = e.id,
      lateral (values ('nome', e.nome, n.nome), ('INEP', e.inep, n.inep), ('tipologia', e.tipologia, n.tipologia), ('município', e.municipio, n.municipio),
                      ('GRE', e.gre, n.gre), ('zona', e.zona, n.zona), ('endereço', e.endereco, n.endereco)) c(campo, antes, depois)
    where e.ativo and c.antes is distinct from c.depois;
  end if;
  select count(*) into v_ins from _ent n where not exists (select 1 from entidades e where e.id = n.id);
  select count(*) into v_rem from entidades e where e.ativo and not exists (select 1 from _ent n where n.id = e.id);
  select count(*) into v_rea from entidades e join _ent n on n.id = e.id where not e.ativo;
  select count(*) into v_alt from entidades e join _ent n on n.id = e.id
   where e.ativo and (e.nome, e.inep, e.tipologia, e.municipio, e.gre, e.zona, e.endereco) is distinct from (n.nome, n.inep, n.tipologia, n.municipio, n.gre, n.zona, n.endereco);

  insert into entidades (id, inep, nome, tipologia, tipo, municipio, gre, zona, endereco, ativo, atualizado_em)
  select id, inep, nome, tipologia, case when tipologia = any(ESCOLA) then 'escola' else 'outra' end, municipio, gre, zona, endereco, true, now() from _ent
  on conflict (id) do update set inep = excluded.inep, nome = excluded.nome, tipologia = excluded.tipologia, tipo = excluded.tipo, municipio = excluded.municipio,
    gre = excluded.gre, zona = excluded.zona, endereco = excluded.endereco, ativo = true,
    atualizado_em = case when (entidades.nome, entidades.inep, entidades.tipologia, entidades.municipio, entidades.gre, entidades.zona, entidades.endereco, entidades.ativo)
                          is distinct from (excluded.nome, excluded.inep, excluded.tipologia, excluded.municipio, excluded.gre, excluded.zona, excluded.endereco, true)
                         then now() else entidades.atualizado_em end;
  update entidades e set ativo = false, atualizado_em = now() where e.ativo and not exists (select 1 from _ent n where n.id = e.id);

  -- liga as O.S. antigas à base pelo INEP (só quando o INEP aponta para uma única entidade)
  update os o set entidade_id = e.id from entidades e
   where o.entidade_id is null and e.ativo and e.inep = o.inep and o.inep ~ '^\d{8}$'
     and (select count(*) from entidades e2 where e2.ativo and e2.inep = o.inep) = 1;
  get diagnostics v_vinc = row_count;
  return jsonb_build_object('linhas', (select count(*) from _ent), 'incluidas', v_ins, 'alteradas', v_alt, 'removidas', v_rem, 'reativadas', v_rea,
                            'os_vinculadas', v_vinc, 'primeira_importacao', v_primeira);
end $$;

-- Fila de e-mails (script na conta gerenciagmap@gmail.com)
create or replace function public.emails_pendentes(p_limite int default 20)
returns setof public.email_fila language sql security definer set search_path = public as $$
  select * from public.email_fila where situacao = 'Na fila' order by id limit greatest(1, least(p_limite, 100))
$$;
create or replace function public.email_resultado(p_id bigint, p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.email_fila set
    situacao = case when p_ok then 'Enviado' when tentativas + 1 >= 5 then 'Falhou' else 'Na fila' end,
    tentativas = tentativas + case when p_ok then 0 else 1 end,
    enviado_em = case when p_ok then now() end, erro = case when p_ok then null else left(p_erro, 500) end
  where id = p_id;
end $$;

-- Encerramento da planilha (30/11): rode no SQL Editor depois da última sincronização
create or replace function public.encerrar_planilha()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public._planilha_ativa() then return 'A planilha já estava encerrada.'; end if;
  update public.sistema_config set planilha_ativa = false, planilha_encerrada_em = now() where id = 1;
  return 'Planilha encerrada. As O.S. antigas agora são atualizadas só no sistema.';
end $$;

-- ---------------------------------------------------------------------
-- 13. Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public._ator(), public._hoje(), public._dias(text), public._dm(date), public._planilha_ativa(), public._evento(bigint, text, text, boolean),
  public._email(bigint, text, text, text), public._proximo_numero(), public._validar_os(jsonb), public._aplicar_os(bigint, jsonb), public._emitir(bigint),
  public._os_para_acao(bigint) from public, anon, authenticated;
revoke all on function public.os_solicitar(jsonb), public.os_reenviar(bigint, jsonb), public.os_decidir(bigint, text, text), public.os_atendimento(bigint, jsonb),
  public.os_desfazer_atendimento(bigint, text), public.os_standby(bigint, text), public.os_retomar(bigint, text), public.os_cancelar(bigint, text, text),
  public.os_revisao(bigint, text), public.os_encerrar_revisao(bigint, text), public.os_editar(bigint, jsonb, text), public.os_aplicar_entidade(bigint[], text),
  public.empresa_salvar(text, text, text[], text[]), public.modelo_salvar(jsonb) from public, anon;
grant execute on function public.os_solicitar(jsonb), public.os_reenviar(bigint, jsonb), public.os_decidir(bigint, text, text), public.os_atendimento(bigint, jsonb),
  public.os_desfazer_atendimento(bigint, text), public.os_standby(bigint, text), public.os_retomar(bigint, text), public.os_cancelar(bigint, text, text),
  public.os_revisao(bigint, text), public.os_encerrar_revisao(bigint, text), public.os_editar(bigint, jsonb, text), public.os_aplicar_entidade(bigint[], text),
  public.empresa_salvar(text, text, text[], text[]), public.modelo_salvar(jsonb) to authenticated;
revoke all on function public.sincronizar_os(jsonb, text), public.importar_entidades(jsonb), public.emails_pendentes(int), public.email_resultado(bigint, boolean, text),
  public.encerrar_planilha() from public, anon, authenticated;
grant execute on function public.sincronizar_os(jsonb, text), public.importar_entidades(jsonb), public.emails_pendentes(int), public.email_resultado(bigint, boolean, text)
  to service_role;

commit;
