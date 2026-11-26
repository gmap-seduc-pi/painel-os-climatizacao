-- =====================================================================
-- 015 · Grade de serviços solicitados na emissão
--
-- Quem emite informa:
--   * os AMBIENTES e quantas máquinas há em cada um (obrigatório com a grade).
--     Cada linha pode ter uma identificação opcional (ex.: "01", "Bloco B"), e o
--     mesmo ambiente pode repetir com identificações diferentes;
--   * a GRADE de serviços solicitados: para cada serviço (preventiva, corretiva,
--     instalação, desinstalação), quantos serviços em cada faixa de potência (BTU).
--     As faixas são as dos contratos (9.000; 12.000 a 18.000; 22.000 a 30.000;
--     36.000 a 60.000, e outras que um contrato novo trouxer).
-- Regras:
--   * máquinas (splits) da O.S. = soma dos ambientes;
--   * serviços na grade >= máquinas (toda máquina precisa de ao menos um serviço;
--     uma máquina pode ter mais de um, ex.: desinstalar numa sala e instalar em outra);
--   * o "tipo de serviço" da O.S. passa a vir da grade;
--   * a edição registra no histórico a grade anterior e a nova.
-- O.S. antigas ficam sem grade (coluna vazia). O site antigo, ainda em cache,
-- continua emitindo pelo jeito antigo até ser atualizado.
--
-- Só acrescenta uma coluna e troca as funções de validação, gravação e edição.
-- Não altera nenhuma O.S. existente.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

alter table public.os add column if not exists solicitado jsonb;

-- texto curto da grade, para o histórico: "Preventiva: 12.000 a 18.000 BTU (3 serv.); Corretiva: 22.000 a 30.000 BTU (1 serv.)"
create or replace function public._txt_solicitado(s jsonb)
returns text language sql immutable set search_path = public as $$
  select coalesce((select string_agg(sv || ': ' || itens, '; ' order by ord)
    from (select x->>'servico' s0, min(case x->>'servico' when 'MANUT. PREVENTIVA' then 1 when 'MANUT. CORRETIVA' then 2 when 'INSTALAÇÃO' then 3 else 4 end) ord,
                 case x->>'servico' when 'MANUT. PREVENTIVA' then 'Preventiva' when 'MANUT. CORRETIVA' then 'Corretiva' when 'INSTALAÇÃO' then 'Instalação' else 'Desinstalação' end sv,
                 string_agg((x->>'faixa') || ' BTU (' || (x->>'qtd') || ' serv.)', ', ' order by x->>'faixa') itens
            from jsonb_array_elements(case when jsonb_typeof(s) = 'array' then s else '[]'::jsonb end) x group by x->>'servico') g), 'sem grade')
$$;

create or replace function public._validar_os(d jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m public.os_modelo; e public.entidades; emp public.empresas;
  v_serv text[]; v_mot text[]; v_outro text; v_amb jsonb := '[]'; a jsonb; v_chaves text[] := '{}'; v_chave text;
  v_rn text; v_rc text; v_resp jsonb := '[]'; q jsonb; val jsonb; v_txt text; v_fora boolean; v_splits int; v_soma int := 0; v_ambn text; v_q int;
  v_sol jsonb := null; v_faixas text[]; r jsonb; v_maxs int := 0; v_id text;
  SERV constant text[] := array['MANUT. PREVENTIVA','MANUT. CORRETIVA','INSTALAÇÃO','DESINSTALAÇÃO'];
begin
  select * into m from public.os_modelo where id = 1;
  select * into e from public.entidades where id = d->>'entidade_id';
  if e.id is null or not e.ativo then raise exception 'Escolha a escola ou entidade na base.'; end if;
  select * into emp from public.empresas where nome = d->>'empresa' and ativa;
  if emp.nome is null then raise exception 'Escolha a empresa.'; end if;
  if coalesce(d->>'prioridade', '') not in ('Urgente','Alta','Normal') then raise exception 'Escolha a prioridade.'; end if;
  -- 2.12: grade de serviços solicitados (serviço x faixa de potência x quantidade de máquinas)
  if d->'solicitado' is not null and jsonb_typeof(d->'solicitado') = 'array' then
    select array_agg(distinct f) into v_faixas from (
      select unnest(array['9.000','12.000 a 18.000','22.000 a 30.000','36.000 a 60.000']) f
      union select faixa from public.contrato_itens where grupo = 'Serviço') z;
    v_sol := '[]';
    for r in select * from jsonb_array_elements(d->'solicitado') loop
      if not (r->>'servico') = any(SERV) then raise exception 'Serviço inválido na grade: %.', r->>'servico'; end if;
      if not (r->>'faixa') = any(v_faixas) then raise exception 'Faixa de potência inválida na grade: %.', r->>'faixa'; end if;
      if coalesce(jsonb_typeof(r->'qtd'), 'null') <> 'number' or (r->>'qtd')::numeric <> floor((r->>'qtd')::numeric) or (r->>'qtd')::numeric not between 1 and 500 then
        raise exception 'Quantidade inválida na grade (%, %).', r->>'servico', r->>'faixa'; end if;
      if exists (select 1 from jsonb_array_elements(v_sol) x where x->>'servico' = r->>'servico' and x->>'faixa' = r->>'faixa') then
        raise exception 'Serviço e faixa repetidos na grade.'; end if;
      v_sol := v_sol || jsonb_build_object('servico', r->>'servico', 'faixa', r->>'faixa', 'qtd', (r->>'qtd')::int);
    end loop;
    if jsonb_array_length(v_sol) = 0 then raise exception 'Informe, na grade, quantos serviços de cada tipo e potência são solicitados.'; end if;
    select coalesce(array_agg(s order by array_position(SERV, s)), '{}') into v_serv from (select distinct x->>'servico' s from jsonb_array_elements(v_sol) x) z;
    select sum((x->>'qtd')::int) into v_maxs from jsonb_array_elements(v_sol) x;   -- total de serviços
    select coalesce(jsonb_agg(x order by array_position(SERV, x->>'servico'), x->>'faixa'), '[]') into v_sol from jsonb_array_elements(v_sol) x;
  else
    -- site antigo (sem a grade): marca os tipos de serviço como antes
    select coalesce(array_agg(s order by array_position(SERV, s)), '{}') into v_serv
      from (select distinct s from jsonb_array_elements_text(coalesce(d->'servicos', '[]')) s where s = any(SERV)) x;
  end if;
  if cardinality(v_serv) = 0 then raise exception 'Marque ao menos um tipo de serviço.'; end if;
  if v_sol is not null then
    null;   -- com a grade, as máquinas vêm da soma dos ambientes (abaixo)
  elsif d->'splits' is not null and jsonb_typeof(d->'splits') <> 'null' then
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
    v_id := nullif(left(trim(coalesce(a->>'ident', '')), 40), '');
    v_chave := upper(v_ambn) || '|' || upper(coalesce(v_id, ''));
    if v_chave = any(v_chaves) then raise exception 'Há ambiente repetido (%). Some as quantidades em uma linha só ou diferencie pela identificação.', v_ambn || coalesce(' ' || v_id, ''); end if;
    v_chaves := v_chaves || v_chave; v_soma := v_soma + v_q;
    v_amb := v_amb || (jsonb_build_object('ambiente', v_ambn, 'splits', v_q) || case when v_id is null then '{}'::jsonb else jsonb_build_object('ident', v_id) end);
  end loop;
  if coalesce((m.campos->'ambientes'->>'obrigatorio')::boolean, false) and jsonb_array_length(v_amb) = 0 then raise exception 'Informe ao menos um ambiente.'; end if;
  if v_sol is not null then
    if jsonb_array_length(v_amb) = 0 then raise exception 'Informe os ambientes e quantas máquinas há em cada um.'; end if;
    if v_maxs < v_soma then
      raise exception 'A grade tem % serviço(s) para % máquina(s) nos ambientes. Cada máquina precisa de ao menos um serviço.', v_maxs, v_soma; end if;
    v_splits := v_soma;
  elsif jsonb_array_length(v_amb) > 0 then v_splits := v_soma; end if;
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
    'motivos', to_jsonb(v_mot), 'ambientes', v_amb, 'resp_nome', v_rn, 'resp_contato', v_rc, 'respostas', v_resp, 'modelo_versao', m.versao, 'solicitado', v_sol);
end $$;


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
    resp_nome = v->>'resp_nome', resp_contato = v->>'resp_contato', respostas = v->'respostas', modelo_versao = (v->>'modelo_versao')::int,
    solicitado = case when v ? 'solicitado' and jsonb_typeof(v->'solicitado') = 'array' then v->'solicitado' else solicitado end
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


create or replace function public.os_editar(p_id bigint, p_dados jsonb, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; n public.os; v jsonb; v_mud text[] := '{}';
        f text := 'O.S. em aberto';
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a GMAP edita O.S. emitidas.'; end if;
  o := public._os_para_acao(p_id);
  if o.status not in ('Emitida','Stand by') then raise exception 'Só O.S. em aberto podem ser editadas.'; end if;
  if length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da edição.'; end if;
  v := public._validar_os(p_dados);
  perform public._aplicar_os(p_id, v);
  update public.os set prazo = case when o.prioridade is distinct from prioridade then criada_em + public._dias(prioridade) else prazo end, revisao = false
   where id = p_id returning * into n;
  if o.empresa is distinct from n.empresa then v_mud := v_mud || format('Empresa: "%s" → "%s"', o.empresa, n.empresa); end if;
  if o.prioridade is distinct from n.prioridade then v_mud := v_mud || format('Prioridade: "%s" → "%s"', o.prioridade, n.prioridade); end if;
  if o.prazo is distinct from n.prazo then v_mud := v_mud || format('Prazo: %s → %s', public._dm(o.prazo), public._dm(n.prazo)); end if;
  if o.descricao is distinct from n.descricao then v_mud := v_mud || format('Serviço: "%s" → "%s"', coalesce(o.descricao, 'vazio'), coalesce(n.descricao, 'vazio')); end if;
  if o.solicitado is distinct from n.solicitado then v_mud := v_mud || ('Serviços solicitados: ' || public._txt_solicitado(o.solicitado) || ' → ' || public._txt_solicitado(n.solicitado)); end if;
  if o.splits is distinct from n.splits then v_mud := v_mud || format('Splits: %s → %s', coalesce(o.splits::text, 'vazio'), coalesce(n.splits::text, 'vazio')); end if;
  if o.escola is distinct from n.escola then v_mud := v_mud || format('Escola: "%s" → "%s"', coalesce(o.escola, 'vazio'), coalesce(n.escola, 'vazio')); end if;
  if o.inep is distinct from n.inep then v_mud := v_mud || format('INEP: %s → %s', coalesce(o.inep, 'vazio'), coalesce(n.inep, 'vazio')); end if;
  if o.endereco is distinct from n.endereco then v_mud := v_mud || format('Endereço: "%s" → "%s"', coalesce(o.endereco, 'vazio'), coalesce(n.endereco, 'vazio')); end if;
  if o.motivos is distinct from n.motivos then v_mud := v_mud || format('Motivos: "%s" → "%s"', coalesce(array_to_string(o.motivos, '; '), 'vazio'), coalesce(array_to_string(n.motivos, '; '), 'vazio')); end if;
  if o.ambientes is distinct from n.ambientes then v_mud := v_mud || ('Ambientes: ' || coalesce((select string_agg((x->>'ambiente') || coalesce(' ' || (x->>'ident'), '') || ' (' || (x->>'splits') || ' máq.)', ', ') from jsonb_array_elements(n.ambientes) x), 'nenhum')); end if;
  if o.observacoes is distinct from n.observacoes then
    v_mud := v_mud || format('Descrição: "%s" → "%s"', coalesce(left(o.observacoes, 150), 'vazio'), coalesce(left(n.observacoes, 150), 'vazio')); end if;
  if o.origem is distinct from n.origem or o.origem_num is distinct from n.origem_num then
    v_mud := v_mud || format('Origem: %s %s → %s %s', coalesce(o.origem, 'vazio'), coalesce(o.origem_num, ''), coalesce(n.origem, 'vazio'), coalesce(n.origem_num, '')); end if;
  if o.resp_nome is distinct from n.resp_nome or o.resp_contato is distinct from n.resp_contato then
    v_mud := v_mud || format('Responsável: "%s %s" → "%s %s"', coalesce(o.resp_nome, ''), coalesce(o.resp_contato, ''), coalesce(n.resp_nome, ''), coalesce(n.resp_contato, '')); end if;
  if o.respostas is distinct from n.respostas then v_mud := v_mud || 'Campos adicionais alterados'::text; end if;
  perform public._evento(p_id, 'editou', coalesce(nullif(array_to_string(v_mud, '; '), ''), 'Sem mudança de dados') || '. Motivo: ' || trim(p_obs)
                         || '. Editado por ' || coalesce(a.nome, a.email) || case when a.perfil = 'gmap' then ' (gerência)' else ' (técnico)' end);
  if o.revisao then perform public._evento(p_id, 'revisão concluída', 'Dados corrigidos pela GMAP'); end if;
  if o.empresa is distinct from n.empresa then
    perform public._email(p_id, o.empresa, 'O.S. ' || o.numero || ' transferida para outra empresa', 'Esta O.S. não está mais sob sua responsabilidade.');
  end if;
  perform public._email(p_id, n.empresa, 'O.S. ' || n.numero || ' alterada', coalesce(nullif(array_to_string(v_mud, E'\n'), ''), 'Revisão concluída sem mudança de dados.'));
end $$;


revoke all on function public._validar_os(jsonb) from public, anon, authenticated;
revoke all on function public._aplicar_os(bigint, jsonb) from public, anon, authenticated;
revoke all on function public._txt_solicitado(jsonb) from public, anon;
