-- =====================================================================
-- 005 · Observação da planilha depois da virada
--
-- Requer a 003 e a 004. Depois da virada (select public.encerrar_planilha();):
--  · a emissão é feita no sistema e a sincronização NÃO altera mais nenhuma O.S.;
--  · a planilha continua sendo lida (no fim da consolidação) só para comparar:
--      - O.S. nova lançada na planilha  → aparece na aba "Planilha" para importar;
--      - mudança feita na planilha numa O.S. que já está no sistema → a gerência aplica no sistema
--        (todos ou alguns campos) ou mantém o sistema, com justificativa;
--  · a aba "Planilha" e todas as decisões sobre ela são exclusivas da gerência;
--  · O.S. marcada como Atendida a partir da planilha fica "sem O.S. assinada" até alguém
--    (empresa ou gerência) anexar o PDF;
--  · a importação gera a O.S. no sistema com os dados da planilha, mantendo o número
--    (se estiver livre), a data de criação e o prazo de lá.
-- Para parar de observar a planilha de vez:  select public.encerrar_observacao();
--
-- Execute uma única vez no SQL Editor do Supabase (Ctrl+A e depois Run).
-- =====================================================================
begin;

alter table public.sistema_config
  add column if not exists observar_planilha boolean not null default true,
  add column if not exists planilha_observada_em timestamptz;

-- O.S. importadas guardam de onde vieram
alter table public.os
  add column if not exists chave_planilha  text,
  add column if not exists numero_planilha text,
  add column if not exists comprovante_pendente boolean not null default false;
create unique index if not exists os_chave_planilha_idx on public.os (chave_planilha) where chave_planilha is not null;

-- Lançamentos da planilha que precisam da equipe
create table if not exists public.planilha_pendencias (
  id            bigserial primary key,
  chave         text not null,                 -- "número|empresa" na planilha
  tipo          text not null check (tipo in ('nova','mudanca')),
  os_id         bigint references public.os(id) on delete cascade,
  numero        text,
  empresa       text,
  dados         jsonb not null,                -- linha da planilha (status já convertido)
  diferencas    jsonb not null default '[]',   -- [{campo, sistema, planilha}]
  assinatura    text not null,
  situacao      text not null default 'aberta' check (situacao in ('aberta','importada','descartada','aplicada','mantida','resolvida')),
  detectado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  decidido_por  text,
  decidido_em   timestamptz,
  obs           text,
  unique (chave, tipo)
);
alter table public.planilha_pendencias enable row level security;
drop policy if exists pend_leitura on public.planilha_pendencias;
create policy pend_leitura on public.planilha_pendencias for select to authenticated using (public.eh_gmap());
revoke all on public.planilha_pendencias from anon, authenticated;
grant select on public.planilha_pendencias to authenticated;

-- ---------------------------------------------------------------------
-- Espelho da planilha (fase planilha, igual à 004)
-- ---------------------------------------------------------------------
create or replace function public._espelhar_planilha(payload jsonb, origem text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int; v_ins int; v_rem int; v_alt int; v_conf text[];
begin
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

-- ---------------------------------------------------------------------
-- Observação (depois da virada): só compara e registra pendências
-- ---------------------------------------------------------------------
create or replace function public._observar_planilha(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; o public.os; v_dados jsonb; v_dif jsonb; v_ass text; p public.planilha_pendencias; v_novas int; v_mud int;
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) = 0 then raise exception 'Payload vazio.'; end if;
  create temp table _p on commit drop as
  select x.*, case when x.status in ('Pendente','Em andamento') then 'Emitida' when x.status = 'Problema' then 'Stand by' else x.status end as st
  from jsonb_to_recordset(payload) as x(
    chave text, numero text, empresa text, status text, prioridade text,
    criada_em date, prazo date, atendida_em date, splits integer, descricao text,
    escola text, entidade text, inep text, gre text, municipio text, zona text,
    endereco text, id_sei text, observacoes text, justificativa text, motivo_cancelamento text);
  if exists (select chave from _p group by chave having count(*) > 1) then
    raise exception 'Há O.S. repetidas (mesmo número e empresa) na planilha: %',
      (select string_agg(chave, ', ') from (select chave from _p group by chave having count(*) > 1) d); end if;

  for r in select * from _p loop
    v_dados := to_jsonb(r) - 'st' || jsonb_build_object('status', r.st, 'status_planilha', r.status);
    select * into o from public.os where (chave = r.chave and legado) or chave_planilha = r.chave limit 1;
    if o.id is null then
      -- O.S. nova lançada na planilha
      v_ass := md5(v_dados::text);
      insert into public.planilha_pendencias (chave, tipo, numero, empresa, dados, assinatura)
      values (r.chave, 'nova', r.numero, r.empresa, v_dados, v_ass)
      on conflict (chave, tipo) do update set dados = excluded.dados, assinatura = excluded.assinatura, atualizado_em = now()
        where planilha_pendencias.situacao = 'aberta' and planilha_pendencias.assinatura <> excluded.assinatura;
      continue;
    end if;
    -- O.S. já no sistema: compara o que as empresas e a GMAP costumam mudar na planilha
    continue when o.status in ('Aguardando aprovação','Devolvida','Recusada');
    select coalesce(jsonb_agg(jsonb_build_object('campo', c.campo, 'sistema', c.sis, 'planilha', c.pla)), '[]') into v_dif
    from (values
      ('Status', o.status, r.st),
      ('Data do atendimento', to_char(o.atendida_em, 'DD/MM/YYYY'), to_char(r.atendida_em, 'DD/MM/YYYY')),
      ('Justificativa da empresa', nullif(trim(o.justificativa), ''), nullif(trim(r.justificativa), '')),
      ('Motivo do cancelamento', nullif(trim(o.motivo_cancelamento), ''), nullif(trim(r.motivo_cancelamento), '')),
      ('Prioridade', o.prioridade, r.prioridade),
      ('Prazo', to_char(o.prazo, 'DD/MM/YYYY'), to_char(r.prazo, 'DD/MM/YYYY'))
    ) c(campo, sis, pla) where c.sis is distinct from c.pla;
    select * into p from public.planilha_pendencias where chave = r.chave and tipo = 'mudanca';
    if jsonb_array_length(v_dif) = 0 then
      if p.id is not null and p.situacao = 'aberta' then
        update public.planilha_pendencias set situacao = 'resolvida', obs = 'Planilha e sistema voltaram a coincidir.', decidido_em = now(), atualizado_em = now() where id = p.id;
      end if;
      continue;
    end if;
    v_ass := md5(v_dif::text);
    if p.id is null then
      insert into public.planilha_pendencias (chave, tipo, os_id, numero, empresa, dados, diferencas, assinatura)
      values (r.chave, 'mudanca', o.id, coalesce(o.numero, r.numero), o.empresa, v_dados, v_dif, v_ass);
    elsif p.assinatura <> v_ass then
      update public.planilha_pendencias set dados = v_dados, diferencas = v_dif, assinatura = v_ass, situacao = 'aberta', os_id = o.id, atualizado_em = now(),
             decidido_por = null, decidido_em = null, obs = null where id = p.id;
    end if;
  end loop;
  update public.sistema_config set planilha_observada_em = now() where id = 1;
  select count(*) filter (where tipo = 'nova'), count(*) filter (where tipo = 'mudanca') into v_novas, v_mud
    from public.planilha_pendencias where situacao = 'aberta';
  return jsonb_build_object('modo', 'observacao', 'registros', (select count(*) from _p), 'novas_abertas', v_novas, 'mudancas_abertas', v_mud,
                            'inseridos', 0, 'removidos', 0, 'status_alterados', 0, 'ignoradas', 0, 'ignoradas_chaves', '[]'::jsonb);
end $$;

-- Sincronização: espelha na fase planilha; depois da virada, só observa
create or replace function public.sincronizar_os(payload jsonb, origem text default 'apps-script')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public._planilha_ativa() then return public._espelhar_planilha(payload, origem); end if;
  if coalesce((select observar_planilha from public.sistema_config where id = 1), false) then return public._observar_planilha(payload); end if;
  raise exception 'A planilha foi encerrada e não está mais sendo observada. As O.S. são emitidas e atualizadas só no sistema.';
end $$;

-- ---------------------------------------------------------------------
-- Emissão: mantém a data e o prazo já definidos (O.S. importada da planilha)
-- ---------------------------------------------------------------------
create or replace function public._emitir(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.os; a public.perfis;
begin
  select * into a from public.perfis where user_id = auth.uid();
  update public.os set status = 'Emitida', criada_em = coalesce(criada_em, public._hoje()), prazo = coalesce(prazo, public._hoje() + public._dias(prioridade)),
         aprovado_por = auth.uid(), aprovado_nome = coalesce(a.nome, a.email), aprovado_em = now(), devolucao_obs = null
   where id = p_id returning * into o;
  perform public._email(o.id, o.empresa,
    case when o.chave_planilha is not null then 'O.S. ' || o.numero || ' registrada no sistema (lançada na planilha) · ' || o.prioridade
         else 'Nova O.S. ' || o.numero || ' · ' || o.prioridade end,
    'Prazo: ' || public._dm(o.prazo) || E'\nEscola/entidade: ' || o.escola || ' (' || coalesce(o.municipio, '') || ')' ||
    E'\nServiço: ' || coalesce(o.descricao, '') || coalesce(E'\nSplits: ' || o.splits, '') || coalesce(E'\nDescrição: ' || o.observacoes, '') ||
    coalesce(E'\nResponsável na entidade: ' || o.resp_nome || ' · ' || o.resp_contato, '') ||
    case when o.chave_planilha is not null then E'\nEsta O.S. foi lançada na planilha geral' ||
      case when o.numero_planilha is distinct from o.numero then ' com o número ' || o.numero_planilha else '' end || '. A partir de agora, registre o atendimento no painel.' else '' end);
end $$;

-- Importa uma O.S. nova da planilha usando o formulário completo
create or replace function public.os_importar_planilha(p_pendencia bigint, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); p public.planilha_pendencias; v jsonb; v_num text; v_id bigint; v_criada date; v_prazo date; v_emitida boolean := false;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência importa O.S. da planilha.'; end if;
  perform public._exigir_emissao_ativa();
  select * into p from public.planilha_pendencias where id = p_pendencia for update;
  if p.id is null or p.tipo <> 'nova' then raise exception 'Lançamento da planilha não encontrado.'; end if;
  if p.situacao <> 'aberta' then raise exception 'Este lançamento já foi % .', p.situacao; end if;
  if exists (select 1 from public.os where chave_planilha = p.chave) then raise exception 'Esta O.S. da planilha já foi importada.'; end if;
  v := public._validar_os(p_dados);
  perform pg_advisory_xact_lock(hashtext('os_numero'));
  -- mantém o número da planilha se ele estiver livre no sistema
  if p.numero ~ '^\d+/\d{4}$' and not exists (select 1 from public.os where numero = p.numero) then v_num := p.numero; else v_num := public._proximo_numero(); end if;
  v_criada := coalesce((p.dados->>'criada_em')::date, public._hoje());
  v_prazo := coalesce((p.dados->>'prazo')::date, v_criada + public._dias(v->>'prioridade'));
  insert into public.os (chave, numero, empresa, status, legado, chave_planilha, numero_planilha, criada_em, prazo, solicitado_por, solicitado_nome, solicitado_em)
  values (v_num, v_num, v->>'empresa', 'Aguardando aprovação', false, p.chave, p.numero, v_criada, v_prazo, a.user_id, coalesce(a.nome, a.email), now())
  returning id into v_id;
  perform public._aplicar_os(v_id, v);
  perform public._evento(v_id, 'importou da planilha', 'Lançada na planilha como ' || p.numero || ' (' || p.empresa || ') em ' || coalesce(public._dm(v_criada), '?') ||
    '. Prazo da planilha mantido: ' || public._dm(v_prazo) || case when v_num <> p.numero then '. Número ' || p.numero || ' já existia no sistema; recebeu ' || v_num else '' end);
  if a.perfil = 'gmap' then
    perform public._emitir(v_id);
    perform public._evento(v_id, 'emitiu', 'Emitida diretamente pela gerência. Prazo ' || public._dm(v_prazo));
    v_emitida := true;
  end if;
  update public.planilha_pendencias set situacao = 'importada', os_id = v_id, decidido_por = coalesce(a.nome, a.email), decidido_em = now() where id = p.id;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'emitida', v_emitida, 'numero_mudou', v_num <> p.numero);
end $$;

-- Descartar um lançamento novo, ou manter o sistema diante de uma mudança da planilha (com justificativa)
create or replace function public.pendencia_decidir(p_id bigint, p_acao text, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); p public.planilha_pendencias; v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência decide sobre os lançamentos da planilha.'; end if;
  select * into p from public.planilha_pendencias where id = p_id for update;
  if p.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if p.situacao <> 'aberta' then raise exception 'Este lançamento já foi tratado.'; end if;
  if p_acao = 'descartar' and p.tipo = 'nova' then
    if length(coalesce(v_obs, '')) < 5 then raise exception 'Explique por que o lançamento não vai ser importado.'; end if;
    update public.planilha_pendencias set situacao = 'descartada', obs = v_obs, decidido_por = coalesce(a.nome, a.email), decidido_em = now() where id = p.id;
  elsif p_acao = 'manter' and p.tipo = 'mudanca' then
    if length(coalesce(v_obs, '')) < 5 then raise exception 'Explique por que o sistema vai ficar como está.'; end if;
    update public.planilha_pendencias set situacao = 'mantida', obs = v_obs, decidido_por = coalesce(a.nome, a.email), decidido_em = now() where id = p.id;
    perform public._evento(p.os_id, 'manteve o sistema',
      'A planilha dizia: ' || (select string_agg((d->>'campo') || ' "' || coalesce(d->>'planilha', 'vazio') || '"', '; ') from jsonb_array_elements(p.diferencas) d)
      || '. Justificativa: ' || v_obs, true);
  else raise exception 'Ação inválida para este lançamento.';
  end if;
end $$;

-- Aplicar no sistema os valores da planilha (todos ou só alguns campos). Só a gerência: equivale a editar a O.S.
create or replace function public.pendencia_aplicar(p_id bigint, p_campos text[], p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); p public.planilha_pendencias; o public.os; n public.os; d jsonb; v_c text; v_mud text[] := '{}'; v_n int := 0;
        v_status text; v_quem text;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência aplica no sistema as mudanças da planilha.'; end if;
  select * into p from public.planilha_pendencias where id = p_id for update;
  if p.id is null or p.tipo <> 'mudanca' then raise exception 'Lançamento não encontrado.'; end if;
  if p.situacao <> 'aberta' then raise exception 'Este lançamento já foi tratado.'; end if;
  if coalesce(cardinality(p_campos), 0) = 0 then raise exception 'Marque ao menos um campo para aplicar.'; end if;
  select * into o from public.os where id = p.os_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  d := p.dados; v_quem := coalesce(a.nome, a.email);
  foreach v_c in array p_campos loop
    if not exists (select 1 from jsonb_array_elements(p.diferencas) x where x->>'campo' = v_c) then raise exception 'Campo sem diferença: %.', v_c; end if;
    v_n := v_n + 1;
    if v_c = 'Status' then
      v_status := d->>'status';
      if v_status not in ('Emitida','Stand by','Atendida','Cancelada') then raise exception 'Status da planilha inválido: %.', v_status; end if;
      update public.os set status = v_status,
        standby_por = case when v_status = 'Stand by' then 'empresa' end,
        standby_motivo = case when v_status = 'Stand by' then coalesce(nullif(trim(d->>'justificativa'), ''), standby_motivo, 'Informado na planilha') end,
        atendido_nome = case when v_status = 'Atendida' then 'Planilha geral (aplicado por ' || v_quem || ')' when o.status = 'Atendida' then null else atendido_nome end,
        atendido_por = case when v_status = 'Atendida' or o.status = 'Atendida' then null else atendido_por end,
        revisao = case when v_status = 'Cancelada' then false else revisao end
      where id = o.id;
    elsif v_c = 'Data do atendimento' then update public.os set atendida_em = (d->>'atendida_em')::date where id = o.id;
    elsif v_c = 'Justificativa da empresa' then update public.os set justificativa = nullif(trim(d->>'justificativa'), '') where id = o.id;
    elsif v_c = 'Motivo do cancelamento' then update public.os set motivo_cancelamento = nullif(trim(d->>'motivo_cancelamento'), '') where id = o.id;
    elsif v_c = 'Prioridade' then
      if coalesce(d->>'prioridade', '') not in ('Urgente','Alta','Normal') then raise exception 'Prioridade da planilha inválida.'; end if;
      update public.os set prioridade = d->>'prioridade' where id = o.id;
    elsif v_c = 'Prazo' then update public.os set prazo = (d->>'prazo')::date where id = o.id;
    else raise exception 'Campo desconhecido: %.', v_c;
    end if;
    v_mud := v_mud || (v_c || ': "' || coalesce((select x->>'sistema' from jsonb_array_elements(p.diferencas) x where x->>'campo' = v_c), 'vazio')
                         || '" → "' || coalesce((select x->>'planilha' from jsonb_array_elements(p.diferencas) x where x->>'campo' = v_c), 'vazio') || '"');
  end loop;
  select * into n from public.os where id = o.id;
  if n.status = 'Cancelada' and nullif(trim(n.motivo_cancelamento), '') is null then
    update public.os set motivo_cancelamento = 'Cancelada na planilha' where id = o.id; end if;
  if n.status = 'Atendida' and n.atendida_em is null then raise exception 'Para aplicar "Atendida", aplique também a data do atendimento (ou registre o atendimento na O.S.).'; end if;
  if n.status = 'Atendida' and o.status <> 'Atendida' and n.pdf_caminho is null then
    update public.os set comprovante_pendente = true where id = o.id;
    perform public._email(o.id, o.empresa, 'O.S. ' || o.numero || ': envie a O.S. assinada',
      'O atendimento informado na planilha geral foi registrado no sistema em ' || public._dm(n.atendida_em) ||
      '. Falta anexar a O.S. assinada (PDF): abra a O.S. no painel e use "Anexar O.S. assinada".');
  end if;
  perform public._evento(o.id, 'aplicou mudança da planilha', array_to_string(v_mud, '; ') || coalesce('. ' || nullif(trim(p_obs), ''), ''));
  update public.planilha_pendencias set situacao = 'aplicada', obs = array_to_string(v_mud, '; ') || coalesce('. ' || nullif(trim(p_obs), ''), ''),
         decidido_por = v_quem, decidido_em = now() where id = p.id;
  return jsonb_build_object('aplicados', v_n);
end $$;

-- O.S. sem a O.S. assinada: a pendência some sozinha quando o PDF chega ou quando deixa de estar Atendida
create or replace function public._comprovante_os()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.comprovante_pendente and (new.status <> 'Atendida' or (new.pdf_caminho is not null and new.pdf_caminho is distinct from old.pdf_caminho)) then
    new.comprovante_pendente := false;
  end if;
  return new;
end $$;
drop trigger if exists os_comprovante on public.os;
create trigger os_comprovante before update on public.os for each row execute function public._comprovante_os();

create or replace function public.os_anexar_comprovante(p_id bigint, p_pdf_nome text, p_pdf_caminho text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  select * into o from public.os where id = p_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  if not (a.perfil = 'gmap' or (a.perfil = 'empresa' and a.empresa = o.empresa)) then raise exception 'Somente a empresa responsável ou a gerência anexam a O.S. assinada.'; end if;
  if not o.comprovante_pendente then raise exception 'Esta O.S. não está aguardando a O.S. assinada.'; end if;
  if nullif(trim(coalesce(p_pdf_caminho, '')), '') is null or split_part(p_pdf_caminho, '/', 1) <> o.id::text or p_pdf_caminho !~* '\.pdf$' then raise exception 'Envie o PDF da O.S. assinada.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'os-assinadas' and name = p_pdf_caminho) then raise exception 'O arquivo não chegou ao armazenamento. Tente de novo.'; end if;
  update public.os set pdf_nome = nullif(trim(p_pdf_nome), ''), pdf_caminho = p_pdf_caminho where id = o.id;
  perform public._evento(o.id, 'anexou a O.S. assinada', 'PDF: ' || coalesce(nullif(trim(p_pdf_nome), ''), p_pdf_caminho));
end $$;

-- envio do PDF: a gerência também pode enviar quando a O.S. aguarda a O.S. assinada
create or replace function public.pode_anexar_pdf(p_pasta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa
                 where o.id::text = p_pasta and o.status in ('Emitida','Stand by','Atendida') and not o.revisao)
      or exists (select 1 from public.os o where o.id::text = p_pasta and o.comprovante_pendente and public.eh_gmap())
$$;

-- Virada (mantém a observação) e fim da observação
create or replace function public.encerrar_planilha()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public._planilha_ativa() then return 'A planilha já estava encerrada.'; end if;
  update public.sistema_config set planilha_ativa = false, planilha_encerrada_em = now(), observar_planilha = true where id = 1;
  return 'Planilha encerrada e emissão pelo sistema ativada. A planilha continua sendo observada: O.S. novas e mudanças lançadas nela aparecem na aba Planilha.';
end $$;
create or replace function public.encerrar_observacao()
returns text language plpgsql security definer set search_path = public as $$
begin
  if public._planilha_ativa() then raise exception 'Faça a virada antes (select public.encerrar_planilha();).'; end if;
  update public.sistema_config set observar_planilha = false where id = 1;
  return 'A planilha deixou de ser observada. Agora pode apagar a linha sincronizar(); do Codigo.gs.';
end $$;

revoke all on function public._espelhar_planilha(jsonb, text), public._observar_planilha(jsonb), public._emitir(bigint) from public, anon, authenticated;
revoke all on function public.os_importar_planilha(bigint, jsonb), public.pendencia_decidir(bigint, text, text), public.pendencia_aplicar(bigint, text[], text) from public, anon;
grant execute on function public.os_importar_planilha(bigint, jsonb), public.pendencia_decidir(bigint, text, text), public.pendencia_aplicar(bigint, text[], text) to authenticated;
revoke all on function public.os_anexar_comprovante(bigint, text, text) from public, anon;
grant execute on function public.os_anexar_comprovante(bigint, text, text) to authenticated;
revoke all on function public._comprovante_os() from public, anon, authenticated;
revoke all on function public.sincronizar_os(jsonb, text), public.encerrar_planilha(), public.encerrar_observacao() from public, anon, authenticated;
grant execute on function public.sincronizar_os(jsonb, text) to service_role;

commit;
