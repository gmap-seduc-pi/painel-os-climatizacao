-- =====================================================================
-- 014 · "Problema" no lugar de "Stand by", edição pelos técnicos e revisão
--
-- 1) Problema: a empresa ou a GMAP registra um problema que impede ou dispensa o
--    atendimento, escolhendo o tipo numa lista (editável no Modelo) e detalhando.
--    Internamente o status continua 'Stand by' (o valor é usado em várias regras);
--    só o nome na tela muda. O prazo continua correndo.
-- 2) Técnicos da GMAP passam a editar O.S. em aberto (antes só a gerência), com
--    o registro de cada campo alterado (antes e depois) no histórico.
-- 3) Revisão: a gerência pode colocar a O.S. em revisão para os técnicos
--    corrigirem; técnicos continuam sugerindo revisão. Técnicos e gerência
--    concluem (editando) ou encerram sem alterar, sempre com registro.
--
-- Não altera dados de O.S. existentes, a não ser preencher o tipo "Outro
-- problema" nas O.S. que hoje estão em stand by (o texto delas é mantido).
-- Cancelamento continua exclusivo da gerência.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

-- ---------- 1. lista de tipos de problema no Modelo ----------
alter table public.os_modelo add column if not exists problemas jsonb not null default '[]'::jsonb;
update public.os_modelo set problemas = '[
  {"id":"p1","texto":"Atendida por serviço particular contratado pela entidade","ativo":true},
  {"id":"p2","texto":"Demanda já atendida em outra O.S.","ativo":true},
  {"id":"p3","texto":"Endereço não encontrado","ativo":true},
  {"id":"p4","texto":"Escola fechada ou sem acesso ao local","ativo":true},
  {"id":"p5","texto":"Responsável da entidade não autorizou o serviço","ativo":true},
  {"id":"p6","texto":"Falta de infraestrutura no local (energia, ponto elétrico, suporte)","ativo":true},
  {"id":"p7","texto":"Equipamento não localizado ou já retirado","ativo":true},
  {"id":"p8","texto":"Dados da O.S. incorretos (serviço, quantidade ou ambiente)","ativo":true}
]'::jsonb
 where id = 1 and problemas = '[]'::jsonb;

-- ---------- 2. dados do problema e de quem pediu a revisão ----------
alter table public.os add column if not exists problema_tipo text;
alter table public.os add column if not exists problema_em timestamptz;
alter table public.os add column if not exists problema_nome text;
alter table public.os add column if not exists revisao_perfil text;

-- O.S. que já estão em stand by: tipo "Outro problema", data e nome do último registro de stand by
update public.os o
   set problema_tipo = 'Outro problema',
       problema_em = (select max(e.quando) from public.os_eventos e where e.os_id = o.id and e.acao = 'colocou em stand by'),
       problema_nome = (select e.quem_nome from public.os_eventos e where e.os_id = o.id and e.acao = 'colocou em stand by' order by e.quando desc limit 1)
 where o.status = 'Stand by' and o.problema_tipo is null;

-- ---------- 3. registrar e resolver problema ----------
create or replace function public.os_problema(p_id bigint, p_tipo text, p_detalhe text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_t text := trim(coalesce(p_tipo, '')); v_d text := nullif(trim(coalesce(p_detalhe, '')), ''); v_txt text;
begin
  o := public._os_para_acao(p_id);
  if not (a.perfil in ('gmap','tecnico') or (a.perfil = 'empresa' and o.empresa = a.empresa)) then raise exception 'Sem permissão.'; end if;
  if o.status <> 'Emitida' then raise exception 'Só uma O.S. emitida (em aberto) pode receber um problema.'; end if;
  if v_t = '' then raise exception 'Escolha o tipo de problema.'; end if;
  if v_t <> 'Outro problema' and not exists (select 1 from public.os_modelo m, jsonb_array_elements(m.problemas) x where x->>'texto' = v_t and (x->>'ativo')::boolean) then
    raise exception 'Escolha o tipo de problema na lista.'; end if;
  if v_t = 'Outro problema' and length(coalesce(v_d, '')) < 10 then raise exception 'Descreva o problema (mínimo de 10 caracteres).'; end if;
  if length(coalesce(v_d, '')) > 500 then raise exception 'O detalhe pode ter até 500 caracteres.'; end if;
  v_txt := case when v_t = 'Outro problema' then v_d else v_t || coalesce(': ' || v_d, '') end;
  update public.os set status = 'Stand by', standby_motivo = v_txt, standby_por = case when a.perfil = 'empresa' then 'empresa' else 'gmap' end,
         problema_tipo = v_t, problema_em = now(), problema_nome = coalesce(a.nome, a.email)
   where id = p_id;
  perform public._evento(p_id, 'registrou problema', v_txt || '. O prazo continua correndo.');
  if a.perfil <> 'empresa' then
    perform public._email(p_id, o.empresa, 'O.S. ' || o.numero || ': problema registrado pela GMAP', 'Problema: ' || v_txt || E'\nO prazo continua correndo. A GMAP avisa quando a O.S. for retomada.');
  end if;
end $$;

-- versão antiga (site ainda não atualizado no navegador): registra como "Outro problema"
create or replace function public.os_standby(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.os_problema(p_id, 'Outro problema', p_motivo);
end $$;

create or replace function public.os_retomar(p_id bigint, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  o := public._os_para_acao(p_id);
  if o.status <> 'Stand by' then raise exception 'Esta O.S. não está com problema registrado.'; end if;
  if not (a.perfil in ('gmap','tecnico') or (a.perfil = 'empresa' and o.empresa = a.empresa and o.standby_por = 'empresa')) then
    raise exception 'Só quem registrou o problema ou a GMAP pode retomar.'; end if;
  perform public._evento(p_id, 'resolveu o problema', 'Problema resolvido' || coalesce(': ' || v_obs, '') || '. A O.S. voltou a ficar em aberto.');
  update public.os set status = 'Emitida', standby_motivo = null, standby_por = null, problema_tipo = null, problema_em = null, problema_nome = null where id = p_id;
  if a.perfil <> 'empresa' then
    perform public._email(p_id, o.empresa, 'O.S. ' || o.numero || ' retomada', 'O problema registrado foi resolvido pela GMAP' || coalesce(': ' || v_obs, '') || E'.\nA O.S. está em aberto de novo.');
  end if;
end $$;

-- ---------- 4. revisão: gerência pede, técnicos corrigem; técnicos também sugerem ----------
create or replace function public.os_revisao(p_id bigint, p_sugestao text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a GMAP coloca O.S. em revisão.'; end if;
  o := public._os_para_acao(p_id);
  if o.status not in ('Emitida','Stand by') then raise exception 'Só O.S. em aberto podem entrar em revisão.'; end if;
  if o.revisao then raise exception 'Esta O.S. já está em revisão.'; end if;
  if length(trim(coalesce(p_sugestao, ''))) < 10 then raise exception 'Descreva o que precisa ser corrigido (mínimo de 10 caracteres).'; end if;
  update public.os set revisao = true, revisao_sugestao = trim(p_sugestao), revisao_nome = coalesce(a.nome, a.email), revisao_em = now(), revisao_perfil = a.perfil where id = p_id;
  perform public._evento(p_id, 'colocou em revisão', case when a.perfil = 'gmap' then 'Pedido da gerência: ' else 'Sugestão: ' end || trim(p_sugestao), true);
  perform public._evento(p_id, 'em revisão', 'A GMAP está revisando os dados desta O.S.');
end $$;

create or replace function public.os_encerrar_revisao(p_id bigint, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  if a.perfil not in ('gmap','tecnico') then raise exception 'Somente a GMAP encerra a revisão.'; end if;
  o := public._os_para_acao(p_id);
  if not o.revisao then raise exception 'Esta O.S. não está em revisão.'; end if;
  if length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Explique por que a O.S. não precisou de correção.'; end if;
  update public.os set revisao = false where id = p_id;
  perform public._evento(p_id, 'encerrou revisão sem alterar', trim(p_obs), true);
  perform public._evento(p_id, 'revisão concluída', 'Dados mantidos');
end $$;

-- ---------- 5. edição: gerência e técnicos, com cada mudança registrada (antes e depois) ----------
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
  if o.splits is distinct from n.splits then v_mud := v_mud || format('Splits: %s → %s', coalesce(o.splits::text, 'vazio'), coalesce(n.splits::text, 'vazio')); end if;
  if o.escola is distinct from n.escola then v_mud := v_mud || format('Escola: "%s" → "%s"', coalesce(o.escola, 'vazio'), coalesce(n.escola, 'vazio')); end if;
  if o.inep is distinct from n.inep then v_mud := v_mud || format('INEP: %s → %s', coalesce(o.inep, 'vazio'), coalesce(n.inep, 'vazio')); end if;
  if o.endereco is distinct from n.endereco then v_mud := v_mud || format('Endereço: "%s" → "%s"', coalesce(o.endereco, 'vazio'), coalesce(n.endereco, 'vazio')); end if;
  if o.motivos is distinct from n.motivos then v_mud := v_mud || format('Motivos: "%s" → "%s"', coalesce(array_to_string(o.motivos, '; '), 'vazio'), coalesce(array_to_string(n.motivos, '; '), 'vazio')); end if;
  if o.ambientes is distinct from n.ambientes then v_mud := v_mud || ('Ambientes: ' || coalesce((select string_agg((x->>'ambiente') || ' (' || (x->>'splits') || ')', ', ') from jsonb_array_elements(n.ambientes) x), 'nenhum')); end if;
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

-- ---------- 6. Modelo: a lista de problemas entra no salvamento (opcional, para não quebrar o site antigo) ----------
create or replace function public.modelo_salvar(p_modelo jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); m public.os_modelo; k text; L jsonb; o jsonb; v_lista jsonb; v_perg jsonb := '[]'; q jsonb;
        v_nomes text[] := array['motivos','ambientes','motivos_cancelamento','problemas']; v_rot text[] := array['Motivos','Ambientes','Motivos de cancelamento','Tipos de problema'];
        v_novo jsonb := '{}'; v_res text[] := '{}'; v_ent text; v_sai text; i int; v_campos jsonb;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera o modelo da O.S.'; end if;
  select * into m from public.os_modelo where id = 1 for update;
  for i in 1..4 loop
    k := v_nomes[i]; L := p_modelo->k;
    if k = 'problemas' and L is null then L := m.problemas; end if;   -- site antigo não envia a lista: mantém a atual
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
  if cardinality(v_res) = 0 and v_novo->'motivos' = m.motivos and v_novo->'ambientes' = m.ambientes and v_novo->'motivos_cancelamento' = m.motivos_cancelamento
     and v_novo->'problemas' = m.problemas then
    return jsonb_build_object('versao', m.versao, 'sem_mudanca', true); end if;
  if cardinality(v_res) = 0 then v_res := array['textos das opções ajustados']; end if;
  update public.os_modelo set versao = versao + 1, motivos = v_novo->'motivos', ambientes = v_novo->'ambientes', motivos_cancelamento = v_novo->'motivos_cancelamento',
         problemas = v_novo->'problemas',
         motivo_outro = coalesce((p_modelo->>'motivo_outro')::boolean, true), campos = v_campos, perguntas = v_perg,
         alterado_por = coalesce(a.nome, a.email), alterado_em = now()
   where id = 1 returning * into m;
  insert into public.os_modelo_log (versao, quem, quem_nome, resumo, modelo) values (m.versao, a.user_id, coalesce(a.nome, a.email), array_to_string(v_res, '; '), to_jsonb(m));
  return jsonb_build_object('versao', m.versao);
end $$;

revoke all on function public.os_problema(bigint, text, text) from public, anon;
grant execute on function public.os_problema(bigint, text, text) to authenticated;
