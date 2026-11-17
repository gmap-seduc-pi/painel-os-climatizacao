-- =====================================================================
-- 006 · Perfil Consultivo e gestão de usuários
--
--  · o perfil "Diretoria" passa a se chamar "Consultivo", com uma função
--    (Diretoria, Fiscal de contrato...). Só consulta e exporta: não emite,
--    não edita e não altera O.S. Quem era Diretoria vira Consultivo/Diretoria;
--  · cada usuário pode corrigir o próprio nome;
--  · a gerência pode editar nome, perfil, empresa e função de qualquer usuário
--    (menos o próprio perfil) e excluir usuários, vendo antes o que será afetado.
--    O histórico das O.S. guarda o nome de quem agiu, então não se perde.
--
-- Rodar uma vez no SQL Editor do Supabase, depois da 005. Pode rodar de novo
-- sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Perfil Consultivo (substitui Diretoria) e função
-- ---------------------------------------------------------------------
alter table public.perfis add column if not exists funcao text;
alter table public.perfis drop constraint if exists perfis_perfil_check;
update public.perfis set perfil = 'consultivo', funcao = coalesce(nullif(trim(funcao), ''), 'Diretoria') where perfil = 'diretoria';
alter table public.perfis add constraint perfis_perfil_check check (perfil in ('gmap','tecnico','consultivo','empresa'));
alter table public.perfis drop constraint if exists perfis_funcao_check;
alter table public.perfis add constraint perfis_funcao_check check (funcao is null or char_length(trim(funcao)) between 2 and 60);

-- gestão = vê todas as O.S. (gerência, técnicos e consultivo)
create or replace function public.eh_gestao()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo and p.perfil in ('gmap','tecnico','consultivo'))
$$;

-- texto padrão de perfil para o histórico de usuários
create or replace function public._perfil_txt(p_perfil text, p_empresa text, p_funcao text)
returns text language sql immutable as $$
  select case p_perfil when 'gmap' then 'GMAP (gerência)' when 'tecnico' then 'Técnico GMAP'
                       when 'consultivo' then 'Consultivo' || coalesce(' (' || nullif(trim(p_funcao), '') || ')', '')
                       when 'empresa' then 'Empresa' || coalesce(' (' || p_empresa || ')', '') else p_perfil end
$$;

-- Cadastro pelo site: aceita Consultivo com função (e "diretoria" de páginas antigas em cache)
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_perfil text := m->>'perfil';
  v_empresa text := nullif(trim(m->>'empresa'), '');
  v_funcao text := nullif(trim(m->>'funcao'), '');
begin
  if v_perfil is null then return new; end if;
  if v_perfil = 'diretoria' then v_perfil := 'consultivo'; v_funcao := coalesce(v_funcao, 'Diretoria'); end if;
  if v_perfil not in ('gmap','tecnico','consultivo','empresa') then raise exception 'Perfil inválido.'; end if;
  if v_perfil = 'empresa' and v_empresa is null then raise exception 'Informe a empresa.'; end if;
  if v_perfil = 'consultivo' and v_funcao is null then raise exception 'Informe a função (Diretoria, Fiscal de contrato...).'; end if;
  if v_perfil <> 'empresa' then v_empresa := null; end if;
  if v_perfil <> 'consultivo' then v_funcao := null; end if;
  insert into public.perfis (user_id, email, nome, perfil, empresa, funcao, situacao)
  values (new.id, new.email, nullif(trim(m->>'nome'), ''), v_perfil, v_empresa, left(v_funcao, 60), 'pendente')
  on conflict (user_id) do nothing;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (new.id, new.id, 'solicitou', public._perfil_txt(v_perfil, v_empresa, v_funcao));
  return new;
end $$;

-- Aprovação: aceita Consultivo; a função vem do pedido (a gerência ajusta depois em "Editar")
create or replace function public.decidir_usuario(p_usuario uuid, p_acao text, p_perfil text default null, p_empresa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_situacao text;
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  if p_usuario = auth.uid() then raise exception 'Você não pode alterar o próprio acesso.'; end if;
  if p_acao not in ('aprovar','recusar','bloquear','reativar') then raise exception 'Ação inválida.'; end if;
  if p_perfil = 'diretoria' then p_perfil := 'consultivo'; end if;
  v_situacao := case p_acao when 'aprovar' then 'aprovado' when 'reativar' then 'aprovado' when 'recusar' then 'recusado' else 'bloqueado' end;
  if p_acao = 'aprovar' then
    if p_perfil not in ('gmap','tecnico','consultivo','empresa') then raise exception 'Perfil inválido.'; end if;
    if p_perfil = 'empresa' and nullif(trim(p_empresa), '') is null then raise exception 'Informe a empresa.'; end if;
    update public.perfis set perfil = p_perfil, empresa = case when p_perfil = 'empresa' then trim(p_empresa) end,
           funcao = case when p_perfil = 'consultivo' then coalesce(funcao, 'Consultivo') end,
           situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  else
    update public.perfis set situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  end if;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, p_acao, case when p_acao = 'aprovar' then public._perfil_txt(p_perfil, p_empresa, null) end);
end $$;

-- Lista de usuários para a gerência (agora com a função)
drop function if exists public.listar_usuarios();
create function public.listar_usuarios()
returns table (user_id uuid, email text, nome text, perfil text, empresa text, funcao text, situacao text,
               criado_em timestamptz, decidido_em timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à GMAP.'; end if;
  return query
    select p.user_id, p.email, p.nome, p.perfil, p.empresa, p.funcao, p.situacao, p.criado_em, p.decidido_em,
           (select max(a.acessado_em) from public.acessos a where a.user_id = p.user_id)
    from public.perfis p
    order by case p.situacao when 'pendente' then 0 else 1 end, p.criado_em desc;
end $$;

-- ---------------------------------------------------------------------
-- 2. Corrigir o próprio nome
-- ---------------------------------------------------------------------
create or replace function public.meu_nome(p_nome text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'); antes text;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if char_length(v) < 3 or char_length(v) > 120 then raise exception 'Informe o nome completo (de 3 a 120 caracteres).'; end if;
  select nome into antes from public.perfis where user_id = auth.uid();
  if not found then raise exception 'Usuário não encontrado.'; end if;
  if antes is not distinct from v then return v; end if;
  update public.perfis set nome = v where user_id = auth.uid();
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), auth.uid(), 'alterou o nome', coalesce(antes, '(vazio)') || ' → ' || v);
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. Gerência: o que a exclusão (ou a troca de perfil) afeta
-- ---------------------------------------------------------------------
create or replace function public.usuario_impacto(p_usuario uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u public.perfis;
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  select * into u from public.perfis where user_id = p_usuario;
  if u.user_id is null then raise exception 'Usuário não encontrado.'; end if;
  return jsonb_build_object(
    'nome', coalesce(u.nome, u.email), 'email', u.email, 'perfil', u.perfil, 'empresa', u.empresa, 'funcao', u.funcao, 'situacao', u.situacao,
    'ultimo_acesso', (select max(a.acessado_em) from public.acessos a where a.user_id = p_usuario),
    'solicitadas', (select count(*) from public.os where solicitado_por = p_usuario),
    'aguardando', (select count(*) from public.os where solicitado_por = p_usuario and status = 'Aguardando aprovação'),
    'devolvidas', (select count(*) from public.os where solicitado_por = p_usuario and status = 'Devolvida'),
    'atendimentos', (select count(*) from public.os where atendido_por = p_usuario),
    'acoes', (select count(*) from public.os_eventos where quem = p_usuario),
    'outros_gerentes', (select count(*) from public.perfis where perfil = 'gmap' and situacao = 'aprovado' and user_id <> p_usuario));
end $$;

-- ---------------------------------------------------------------------
-- 4. Gerência: editar nome, perfil, empresa e função de um usuário
-- ---------------------------------------------------------------------
create or replace function public.usuario_editar(p_usuario uuid, p_nome text, p_perfil text, p_empresa text default null, p_funcao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u public.perfis; v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
        v_emp text := nullif(trim(coalesce(p_empresa, '')), ''); v_fun text := nullif(trim(coalesce(p_funcao, '')), ''); mud text[] := '{}';
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  select * into u from public.perfis where user_id = p_usuario for update;
  if u.user_id is null then raise exception 'Usuário não encontrado.'; end if;
  if p_perfil not in ('gmap','tecnico','consultivo','empresa') then raise exception 'Perfil inválido.'; end if;
  if p_usuario = auth.uid() and p_perfil <> u.perfil then raise exception 'Você não pode alterar o próprio perfil. Peça a outra pessoa da gerência.'; end if;
  if char_length(v_nome) < 3 or char_length(v_nome) > 120 then raise exception 'Informe o nome completo (de 3 a 120 caracteres).'; end if;
  if p_perfil = 'empresa' and v_emp is null then raise exception 'Escolha a empresa.'; end if;
  if p_perfil = 'consultivo' and v_fun is null then raise exception 'Informe a função (Diretoria, Fiscal de contrato...).'; end if;
  if p_perfil <> 'empresa' then v_emp := null; end if;
  if p_perfil <> 'consultivo' then v_fun := null; end if;
  if v_fun is not null and char_length(v_fun) > 60 then raise exception 'A função pode ter até 60 caracteres.'; end if;
  if u.nome is distinct from v_nome then mud := mud || ('nome: ' || coalesce(u.nome, '(vazio)') || ' → ' || v_nome); end if;
  if u.perfil is distinct from p_perfil or u.empresa is distinct from v_emp or u.funcao is distinct from v_fun then
    mud := mud || ('perfil: ' || public._perfil_txt(u.perfil, u.empresa, u.funcao) || ' → ' || public._perfil_txt(p_perfil, v_emp, v_fun));
  end if;
  if cardinality(mud) = 0 then return; end if;
  update public.perfis set nome = v_nome, perfil = p_perfil, empresa = v_emp, funcao = v_fun where user_id = p_usuario;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe) values (auth.uid(), p_usuario, 'editou', array_to_string(mud, '; '));
end $$;

-- ---------------------------------------------------------------------
-- 5. Gerência: excluir usuário
--    · remove o login e o cadastro (não dá para desfazer);
--    · o nome continua no histórico das O.S. e no registro de usuários;
--    · solicitações dele ainda em andamento passam para quem excluiu
--      (as devolvidas voltam para a aprovação), para não ficarem sem dono.
-- ---------------------------------------------------------------------
create or replace function public.usuario_excluir(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u public.perfis; eu public.perfis; n_and int := 0; r record;
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  if p_usuario = auth.uid() then raise exception 'Você não pode excluir o próprio usuário.'; end if;
  select * into u from public.perfis where user_id = p_usuario for update;
  if u.user_id is null then raise exception 'Usuário não encontrado.'; end if;
  if u.perfil = 'gmap' and u.situacao = 'aprovado'
     and not exists (select 1 from public.perfis where perfil = 'gmap' and situacao = 'aprovado' and user_id <> p_usuario) then
    raise exception 'Não é possível excluir o último usuário da gerência.';
  end if;
  select * into eu from public.perfis where user_id = auth.uid();

  for r in select id, status from public.os where solicitado_por = p_usuario and status in ('Aguardando aprovação','Devolvida') for update loop
    update public.os set solicitado_por = auth.uid(), solicitado_nome = coalesce(eu.nome, eu.email),
           status = 'Aguardando aprovação' where id = r.id;
    perform public._evento(r.id, 'transferiu a solicitação',
      'Solicitante ' || coalesce(u.nome, u.email) || ' excluído do sistema' ||
      case when r.status = 'Devolvida' then '; a solicitação devolvida voltou para a aprovação' else '' end, true);
    n_and := n_and + 1;
  end loop;

  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, 'excluiu', coalesce(u.nome, '(sem nome)') || ' <' || coalesce(u.email, '') || '> · ' || public._perfil_txt(u.perfil, u.empresa, u.funcao)
          || case when n_and > 0 then ' · ' || n_and || ' solicitação(ões) em andamento transferida(s)' else '' end);

  -- arquivos enviados por ele ficam (são da O.S.); só desliga o vínculo com o login, se houver
  begin
    execute 'update storage.objects set owner = null where owner = $1' using p_usuario;
  exception when others then null;
  end;
  delete from auth.users where id = p_usuario;   -- apaga também o cadastro (perfis) e as sessões
  delete from public.perfis where user_id = p_usuario;
  return jsonb_build_object('transferidas', n_and);
end $$;

-- ---------------------------------------------------------------------
-- 6. Permissões
-- ---------------------------------------------------------------------
revoke all on function public.listar_usuarios(), public.meu_nome(text), public.usuario_impacto(uuid),
  public.usuario_editar(uuid, text, text, text, text), public.usuario_excluir(uuid) from public, anon;
grant execute on function public.listar_usuarios(), public.meu_nome(text), public.usuario_impacto(uuid),
  public.usuario_editar(uuid, text, text, text, text), public.usuario_excluir(uuid) to authenticated;
revoke all on function public._perfil_txt(text, text, text) from public, anon, authenticated;
