-- =====================================================================
-- 004 · Fase planilha: a planilha continua sendo a fonte até a virada
--
-- Requer a 003. Enquanto a planilha estiver ativa (sistema_config.planilha_ativa = true):
--  · a sincronização volta a espelhar a planilha, inclusive trazendo as O.S. NOVAS criadas nela;
--  · a emissão pelo sistema fica desligada (o banco recusa);
--  · empresas, modelo, usuários, base de entidades e auditoria já funcionam.
-- Na virada, rode no SQL Editor:  select public.encerrar_planilha();
-- A partir daí a sincronização é recusada e a emissão pelo sistema é liberada.
--
-- Execute uma única vez no SQL Editor do Supabase (Ctrl+A e depois Run).
-- =====================================================================
begin;

-- Sincronização: espelha a planilha (inclui O.S. novas), sem tocar nas O.S. emitidas no sistema
create or replace function public.sincronizar_os(payload jsonb, origem text default 'apps-script')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int; v_ins int; v_rem int; v_alt int; v_conf text[];
begin
  if not public._planilha_ativa() then
    raise exception 'A planilha foi encerrada em %. A sincronização está desligada: as O.S. agora são emitidas e atualizadas só no sistema.',
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
    raise exception 'Status desconhecido na planilha: %',
      (select string_agg(distinct coalesce(status, '(vazio)'), ', ') from _novo where st not in ('Emitida','Stand by','Atendida','Cancelada')); end if;
  -- proteção: uma linha da planilha nunca substitui uma O.S. emitida no sistema
  select array_agg(n.chave) into v_conf from _novo n join os o on o.chave = n.chave and not o.legado;
  if v_conf is not null then raise exception 'A planilha tem O.S. com a mesma chave de O.S. emitidas no sistema: %', array_to_string(v_conf, ', '); end if;

  select count(*) into v_total from _novo;

  -- histórico: O.S. novas e mudanças de status (como antes)
  insert into os_historico (chave, empresa, status_anterior, status_novo)
  select n.chave, n.empresa, o.status, n.st from _novo n left join os o on o.chave = n.chave
  where o.chave is null or (o.legado and o.status is distinct from n.st);
  get diagnostics v_alt = row_count;
  insert into os_eventos (os_id, quem_nome, perfil, acao, detalhe)
  select o.id, 'Planilha geral', null, 'atualizada pela planilha', 'Status: ' || coalesce(o.status, 'vazio') || ' → ' || n.st
  from _novo n join os o on o.chave = n.chave and o.legado where o.status is distinct from n.st;

  -- antigas que saíram da planilha
  delete from os o where o.legado and not exists (select 1 from _novo n where n.chave = o.chave);
  get diagnostics v_rem = row_count;

  -- atualiza as que já existem
  update os o set numero = n.numero, empresa = n.empresa, status = n.st, prioridade = n.prioridade, criada_em = n.criada_em, prazo = n.prazo,
         atendida_em = n.atendida_em, splits = n.splits, descricao = n.descricao, escola = n.escola, entidade = n.entidade, inep = n.inep, gre = n.gre,
         municipio = n.municipio, zona = n.zona, endereco = n.endereco, id_sei = n.id_sei, observacoes = n.observacoes, justificativa = n.justificativa,
         motivo_cancelamento = n.motivo_cancelamento, sincronizado_em = now(),
         standby_por = case when n.st = 'Stand by' then coalesce(o.standby_por, 'empresa') end,
         standby_motivo = case when n.st = 'Stand by' then coalesce(nullif(trim(n.justificativa), ''), o.standby_motivo, 'Convertido do status "Problema" da planilha') end,
         entidade_id = coalesce(o.entidade_id, (select e.id from entidades e where e.ativo and e.inep = n.inep and (select count(*) from entidades e2 where e2.ativo and e2.inep = n.inep) = 1))
  from _novo n where o.chave = n.chave and o.legado;

  -- traz as O.S. novas criadas na planilha
  insert into os (chave, numero, empresa, status, prioridade, criada_em, prazo, atendida_em, splits, descricao, escola, entidade, inep, gre, municipio, zona,
                  endereco, id_sei, observacoes, justificativa, motivo_cancelamento, sincronizado_em, legado, standby_por, standby_motivo, entidade_id)
  select n.chave, n.numero, n.empresa, n.st, n.prioridade, n.criada_em, n.prazo, n.atendida_em, n.splits, n.descricao, n.escola, n.entidade, n.inep, n.gre, n.municipio, n.zona,
         n.endereco, n.id_sei, n.observacoes, n.justificativa, n.motivo_cancelamento, now(), true,
         case when n.st = 'Stand by' then 'empresa' end,
         case when n.st = 'Stand by' then coalesce(nullif(trim(n.justificativa), ''), 'Convertido do status "Problema" da planilha') end,
         (select e.id from entidades e where e.ativo and e.inep = n.inep and (select count(*) from entidades e2 where e2.ativo and e2.inep = n.inep) = 1)
  from _novo n where not exists (select 1 from os o where o.chave = n.chave);
  get diagnostics v_ins = row_count;
  -- garante que as O.S. da planilha também recebam a empresa no cadastro de empresas
  insert into empresas (nome) select distinct empresa from _novo where empresa is not null on conflict do nothing;

  insert into sincronizacoes (registros, inseridos, removidos, status_alterados, origem) values (v_total, v_ins, v_rem, v_alt, origem);
  return jsonb_build_object('registros', v_total, 'inseridos', v_ins, 'removidos', v_rem, 'status_alterados', v_alt, 'ignoradas', 0, 'ignoradas_chaves', '[]'::jsonb);
end $$;

-- Emissão pelo sistema: só depois da virada
create or replace function public._exigir_emissao_ativa()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public._planilha_ativa() then
    raise exception 'A emissão pelo sistema ainda não foi ativada. Enquanto a planilha estiver em uso, as O.S. são emitidas nela.'; end if;
end $$;
revoke all on function public._exigir_emissao_ativa() from public, anon, authenticated;

-- inclui a checagem no início da solicitação (o resto da função é o mesmo da 003)
create or replace function public.os_solicitar(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v jsonb; v_num text; v_id bigint; v_emitida boolean := false;
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a equipe da GMAP emite O.S.'; end if;
  perform public._exigir_emissao_ativa();
  v := public._validar_os(p_dados);
  v_num := public._proximo_numero();
  insert into public.os (chave, numero, empresa, status, legado, solicitado_por, solicitado_nome, solicitado_em)
  values (v_num, v_num, v->>'empresa', 'Aguardando aprovação', false, a.user_id, coalesce(a.nome, a.email), now())
  returning id into v_id;
  perform public._aplicar_os(v_id, v);
  perform public._evento(v_id, 'solicitou', 'Nº ' || v_num || ' reservado. ' || case when (v->>'fora_area')::boolean then 'Empresa fora da área sugerida. ' else '' end
    || 'Origem: ' || (v->>'origem') || coalesce(' ' || (v->>'origem_num'), ''), true);
  if a.perfil = 'gmap' then
    perform public._emitir(v_id);
    perform public._evento(v_id, 'emitiu', 'Emitida diretamente pela gerência. Prazo ' || public._dm((select prazo from public.os where id = v_id)));
    v_emitida := true;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'emitida', v_emitida);
end $$;

-- Mensagem das O.S. da planilha, sem data fixa (a virada acontece quando a gerência decidir)
create or replace function public._os_para_acao(p_id bigint)
returns public.os language plpgsql security definer set search_path = public as $$
declare o public.os;
begin
  select * into o from public.os where id = p_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  if o.legado and public._planilha_ativa() then
    raise exception 'Esta O.S. veio da planilha e ainda é atualizada por ela até a virada para o sistema. Faça a alteração na planilha.'; end if;
  return o;
end $$;
revoke all on function public._os_para_acao(bigint) from public, anon, authenticated;

-- Virada: encerra a planilha e libera a emissão pelo sistema
create or replace function public.encerrar_planilha()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public._planilha_ativa() then return 'A planilha já estava encerrada.'; end if;
  update public.sistema_config set planilha_ativa = false, planilha_encerrada_em = now() where id = 1;
  return 'Planilha encerrada e emissão pelo sistema ativada. A partir de agora, todas as O.S. (novas e antigas) são atualizadas só no sistema.';
end $$;

revoke all on function public.os_solicitar(jsonb) from public, anon;
grant execute on function public.os_solicitar(jsonb) to authenticated;
revoke all on function public.sincronizar_os(jsonb, text), public.encerrar_planilha() from public, anon, authenticated;
grant execute on function public.sincronizar_os(jsonb, text) to service_role;

commit;
