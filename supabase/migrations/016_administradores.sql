-- =====================================================================
-- 016 · Administradores do sistema
--
-- Uma marca "administrador" em perfis, só para pessoas da gerência (perfil gmap).
-- As ações críticas passam a exigir a marca:
--   * Planilha: aplicar ou descartar diferença, lançar O.S. vinda da planilha;
--   * Empresas: salvar empresa (e-mail, GREs, municípios);
--   * Modelo da O.S.: salvar o modelo;
--   * Configurações: motivos de glosa e ressalva, PDF obrigatório, início da medição;
--   * Usuários: aprovar, recusar, bloquear, reativar, editar e excluir.
-- A gerência sem a marca continua vendo essas abas (somente leitura).
--
-- Proteções:
--   * nunca fica sem administrador: não dá para retirar a marca do último;
--   * para bloquear, excluir ou tirar da gerência um administrador, retire a marca antes;
--   * só um administrador dá ou retira a marca, e isso fica no histórico de usuários.
--
-- Como foi feito (para quem mexer no banco depois): cada função crítica foi
-- renomeada para _adm_<nome> (o corpo não muda) e ganhou uma função de mesmo nome
-- que confere a marca e chama a original. Para alterar uma dessas funções no
-- futuro, altere a _adm_<nome>. Se recriar a função de nome público, a conferência
-- da marca se perde (os testes do banco acusam).
--
-- O Apps Script não usa nenhuma dessas funções.
--
-- DEPOIS DE RODAR: marque os administradores (veja o manual, passo da 2.13).
-- Até lá, as ações acima ficam bloqueadas para todos.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

alter table public.perfis add column if not exists administrador boolean not null default false;
alter table public.perfis drop constraint if exists perfis_admin_gerencia;
alter table public.perfis add constraint perfis_admin_gerencia check (not administrador or perfil = 'gmap');

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo and p.perfil = 'gmap' and p.administrador)
$$;
revoke all on function public.eh_admin() from public, anon;
grant execute on function public.eh_admin() to authenticated;

create or replace function public._exige_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then
    raise exception 'Somente os administradores do sistema fazem esta alteração.';
  end if;
end $$;
revoke all on function public._exige_admin() from public, anon, authenticated;

-- alvo administrador: precisa retirar a marca antes
create or replace function public._alvo_nao_admin(p_usuario uuid, p_oque text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.perfis where user_id = p_usuario and administrador) then
    raise exception 'Esta pessoa é administradora do sistema. Retire a marca de administrador antes de %.', p_oque;
  end if;
end $$;
revoke all on function public._alvo_nao_admin(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- renomeia as funções críticas (só na primeira vez)
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select * from (values
      ('pendencia_aplicar',     'bigint, text[], text'),
      ('pendencia_decidir',     'bigint, text, text'),
      ('os_importar_planilha',  'bigint, jsonb'),
      ('empresa_salvar',        'text, text, text[], text[]'),
      ('modelo_salvar',         'jsonb'),
      ('config_salvar',         'text[], text[], date'),
      ('medicao_config_salvar', 'date'),
      ('decidir_usuario',       'uuid, text, text, text'),
      ('usuario_editar',        'uuid, text, text, text, text, text[], boolean'),
      ('usuario_excluir',       'uuid')) v(nome, args)
  loop
    if to_regprocedure(format('public._adm_%s(%s)', f.nome, f.args)) is null then
      execute format('alter function public.%I(%s) rename to %I', f.nome, f.args, '_adm_' || f.nome);
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', '_adm_' || f.nome, f.args);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- funções públicas: conferem a marca e chamam a original
-- ---------------------------------------------------------------------
create or replace function public.pendencia_aplicar(p_id bigint, p_campos text[], p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); return public._adm_pendencia_aplicar(p_id, p_campos, p_obs); end $$;

create or replace function public.pendencia_decidir(p_id bigint, p_acao text, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); perform public._adm_pendencia_decidir(p_id, p_acao, p_obs); end $$;

create or replace function public.os_importar_planilha(p_pendencia bigint, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); return public._adm_os_importar_planilha(p_pendencia, p_dados); end $$;

create or replace function public.empresa_salvar(p_nome text, p_email text, p_gres text[], p_municipios text[])
returns void language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); perform public._adm_empresa_salvar(p_nome, p_email, p_gres, p_municipios); end $$;

create or replace function public.modelo_salvar(p_modelo jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); return public._adm_modelo_salvar(p_modelo); end $$;

create or replace function public.config_salvar(p_motivos_glosa text[], p_motivos_ressalva text[], p_pdf_desde date)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); perform public._adm_config_salvar(p_motivos_glosa, p_motivos_ressalva, p_pdf_desde); end $$;

create or replace function public.medicao_config_salvar(p_desde date)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._exige_admin(); perform public._adm_medicao_config_salvar(p_desde); end $$;

create or replace function public.decidir_usuario(p_usuario uuid, p_acao text, p_perfil text default null, p_empresa text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._exige_admin();
  if p_acao in ('bloquear', 'recusar') then perform public._alvo_nao_admin(p_usuario, 'bloquear'); end if;
  perform public._adm_decidir_usuario(p_usuario, p_acao, p_perfil, p_empresa);
end $$;

create or replace function public.usuario_editar(p_usuario uuid, p_nome text, p_perfil text, p_empresa text default null, p_funcao text default null,
                                                 p_empresas text[] default '{}', p_todas boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._exige_admin();
  if p_perfil is distinct from 'gmap' then perform public._alvo_nao_admin(p_usuario, 'tirar da gerência'); end if;
  perform public._adm_usuario_editar(p_usuario, p_nome, p_perfil, p_empresa, p_funcao, p_empresas, p_todas);
end $$;

create or replace function public.usuario_excluir(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._exige_admin();
  perform public._alvo_nao_admin(p_usuario, 'excluir');
  return public._adm_usuario_excluir(p_usuario);
end $$;

revoke all on function public.pendencia_aplicar(bigint, text[], text), public.pendencia_decidir(bigint, text, text),
  public.os_importar_planilha(bigint, jsonb), public.empresa_salvar(text, text, text[], text[]), public.modelo_salvar(jsonb),
  public.config_salvar(text[], text[], date), public.medicao_config_salvar(date), public.decidir_usuario(uuid, text, text, text),
  public.usuario_editar(uuid, text, text, text, text, text[], boolean), public.usuario_excluir(uuid) from public, anon;
grant execute on function public.pendencia_aplicar(bigint, text[], text), public.pendencia_decidir(bigint, text, text),
  public.os_importar_planilha(bigint, jsonb), public.empresa_salvar(text, text, text[], text[]), public.modelo_salvar(jsonb),
  public.config_salvar(text[], text[], date), public.medicao_config_salvar(date), public.decidir_usuario(uuid, text, text, text),
  public.usuario_editar(uuid, text, text, text, text, text[], boolean), public.usuario_excluir(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- dar ou retirar a marca
-- ---------------------------------------------------------------------
create or replace function public.usuario_admin(p_usuario uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u public.perfis;
begin
  perform public._exige_admin();
  select * into u from public.perfis where user_id = p_usuario for update;
  if u.user_id is null then raise exception 'Usuário não encontrado.'; end if;
  if u.administrador = p_admin then return; end if;
  if p_admin then
    if u.perfil <> 'gmap' or not u.ativo then raise exception 'Só uma pessoa da gerência, com acesso ativo, pode ser administradora.'; end if;
  else
    perform 1 from public.perfis where administrador for update;   -- evita duas retiradas ao mesmo tempo
    if (select count(*) from public.perfis where administrador and ativo and user_id <> p_usuario) = 0 then
      raise exception 'O sistema precisa de ao menos um administrador. Marque outra pessoa antes de retirar esta.'; end if;
  end if;
  update public.perfis set administrador = p_admin where user_id = p_usuario;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, case when p_admin then 'virou administrador' else 'deixou de ser administrador' end,
          coalesce(u.nome, '(sem nome)') || ' <' || coalesce(u.email, '') || '>');
end $$;
revoke all on function public.usuario_admin(uuid, boolean) from public, anon;
grant execute on function public.usuario_admin(uuid, boolean) to authenticated;
