-- =====================================================================
-- 007 · Fiscalização dos atendimentos
--
--  · guarda quando o atendimento foi registrado no sistema (para comparar com
--    a data informada pela empresa e apontar registros feitos muito depois);
--  · conferência de cada O.S. atendida pela gerência ou pelo perfil Consultivo
--    (fiscais de contrato): conferida, com ressalva ou glosada, com motivos de
--    uma lista editável e observação. A O.S. em si não muda; cada conferência
--    fica registrada (quem, quando, função) e a empresa não vê;
--  · Consultivo vê só as empresas que fiscaliza (ou todas, como a Diretoria);
--  · a O.S. assinada (PDF) passa a ser exigida só nas O.S. emitidas a partir de
--    uma data configurável (01/12/2026); antes disso é opcional;
--  · configurações da gerência: motivos de glosa e de ressalva e essa data;
--  · O.S. cancelada fica só para consulta: a planilha não a altera, e O.S.
--    atendida não pode ser cancelada pela planilha.
--
-- Rodar uma vez no SQL Editor do Supabase, depois da 006. Pode rodar de novo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quando o atendimento foi registrado no sistema
-- ---------------------------------------------------------------------
alter table public.os add column if not exists atendido_registrado_em timestamptz;

create or replace function public._registro_atendimento()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'Atendida' and (old.status is distinct from 'Atendida' or new.atendida_em is distinct from old.atendida_em
                                  or new.pdf_caminho is distinct from old.pdf_caminho) then
    new.atendido_registrado_em := now();
  elsif new.status <> 'Atendida' then
    new.atendido_registrado_em := null;
  end if;
  return new;
end $$;
drop trigger if exists os_registro_atendimento on public.os;
create trigger os_registro_atendimento before update on public.os for each row execute function public._registro_atendimento();
revoke all on function public._registro_atendimento() from public, anon, authenticated;

-- atendimentos já registrados pelo sistema: pega a data do histórico (os da planilha ficam sem)
update public.os o set atendido_registrado_em = e.quando
  from (select os_id, max(quando) quando from public.os_eventos
        where acao in ('registrou atendimento','corrigiu atendimento','aplicou mudança da planilha','anexou a O.S. assinada') group by os_id) e
 where e.os_id = o.id and o.status = 'Atendida' and o.atendido_registrado_em is null and not coalesce(o.legado, false);

-- ---------------------------------------------------------------------
-- 2. Conferência pelos fiscais
-- ---------------------------------------------------------------------
create table if not exists public.os_conferencias (
  id         bigserial primary key,
  os_id      bigint not null references public.os(id) on delete cascade,
  situacao   text not null check (situacao in ('conferida','ressalva','glosada','pendente')),
  obs        text,
  quem       uuid,
  quem_nome  text,
  perfil     text,
  funcao     text,
  motivos    text[] not null default '{}',
  em         timestamptz not null default now()
);
alter table public.os_conferencias add column if not exists motivos text[] not null default '{}';
create index if not exists os_conferencias_os_idx on public.os_conferencias (os_id, id desc);
alter table public.os_conferencias enable row level security;
-- (políticas e função de conferência na parte 4, depois da visibilidade por empresa)

-- ---------------------------------------------------------------------
-- 3. Configurações da gerência: motivos e data da exigência do PDF
-- ---------------------------------------------------------------------
alter table public.sistema_config add column if not exists pdf_obrigatorio_desde date not null default date '2026-12-01';
alter table public.sistema_config add column if not exists motivos_glosa text[] not null default array[
  'Sem assinatura do responsável na escola', 'Quantidade de splits atendidos inconsistente', 'Serviço não executado ou incompleto',
  'Atendimento fora do prazo sem justificativa aceita', 'O.S. assinada ilegível ou de outra unidade', 'Duplicidade com outra O.S.'];
alter table public.sistema_config add column if not exists motivos_ressalva text[] not null default array[
  'Assinatura ou carimbo ilegível', 'Data da O.S. assinada diferente da informada', 'Pendência relatada pela empresa a acompanhar',
  'Informação incompleta na O.S. assinada'];

create table if not exists public.config_log (
  id bigserial primary key, quem uuid default auth.uid(), quem_nome text, em timestamptz not null default now(), detalhe text not null);
alter table public.config_log enable row level security;
drop policy if exists config_log_leitura on public.config_log;
create policy config_log_leitura on public.config_log for select to authenticated using (public.eh_gmap());
revoke all on public.config_log from anon, authenticated;
grant select on public.config_log to authenticated;

-- a O.S. exige o PDF assinado? (emitidas a partir da data configurada)
create or replace function public._exige_pdf(p_criada date)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_criada >= (select c.pdf_obrigatorio_desde from public.sistema_config c limit 1), false)
$$;
grant execute on function public._exige_pdf(date) to authenticated;

create or replace function public.config_salvar(p_motivos_glosa text[], p_motivos_ressalva text[], p_pdf_desde date)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); c public.sistema_config; g text[]; r text[]; mud text[] := '{}';
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera as configurações.'; end if;
  select array_agg(x order by o) into g from (select distinct on (lower(trim(x))) trim(x) x, o from unnest(p_motivos_glosa) with ordinality t(x, o) where trim(coalesce(x, '')) <> '' order by lower(trim(x)), o) s;
  select array_agg(x order by o) into r from (select distinct on (lower(trim(x))) trim(x) x, o from unnest(p_motivos_ressalva) with ordinality t(x, o) where trim(coalesce(x, '')) <> '' order by lower(trim(x)), o) s;
  if coalesce(cardinality(g), 0) = 0 or coalesce(cardinality(r), 0) = 0 then raise exception 'Deixe pelo menos um motivo em cada lista.'; end if;
  if exists (select 1 from unnest(g || r) x where char_length(x) > 120) then raise exception 'Cada motivo pode ter até 120 caracteres.'; end if;
  if exists (select 1 from unnest(g || r) x where lower(x) in ('outro', 'outros')) then raise exception '"Outro" já aparece sozinho na lista; não precisa cadastrar.'; end if;
  if p_pdf_desde is null then raise exception 'Informe a data a partir da qual a O.S. assinada é exigida.'; end if;
  select * into c from public.sistema_config limit 1 for update;
  if c.motivos_glosa is distinct from g then mud := mud || ('motivos de glosa: ' || array_to_string(g, '; ')); end if;
  if c.motivos_ressalva is distinct from r then mud := mud || ('motivos de ressalva: ' || array_to_string(r, '; ')); end if;
  if c.pdf_obrigatorio_desde is distinct from p_pdf_desde then mud := mud || ('O.S. assinada exigida a partir de ' || public._dm(c.pdf_obrigatorio_desde) || ' → ' || public._dm(p_pdf_desde)); end if;
  if cardinality(mud) = 0 then return; end if;
  update public.sistema_config set motivos_glosa = g, motivos_ressalva = r, pdf_obrigatorio_desde = p_pdf_desde;
  insert into public.config_log (quem, quem_nome, detalhe) values (a.user_id, coalesce(a.nome, a.email), array_to_string(mud, ' | '));
  -- O.S. que deixaram de exigir o PDF saem da lista de pendências
  update public.os set comprovante_pendente = false where comprovante_pendente and not public._exige_pdf(criada_em);
end $$;
revoke all on function public.config_salvar(text[], text[], date) from public, anon;
grant execute on function public.config_salvar(text[], text[], date) to authenticated;

-- PDF: atendimento só exige a O.S. assinada a partir da data configurada
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
  if v_pdf is null and public._exige_pdf(o.criada_em) then raise exception 'Anexe a O.S. assinada (PDF ou fotos).'; end if;
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
      || '. Depois: data ' || public._dm(v_data) || case when o.pdf_nome is distinct from v_pdf then ', PDF ' || coalesce(v_pdf, 'nenhum') else '' end
      || case when o.pendencias is distinct from v_pend then ', pendências "' || coalesce(v_pend, '') || '"' else '' end);
  else
    perform public._evento(p_id, 'registrou atendimento', 'Data ' || public._dm(v_data) || '. PDF: ' || coalesce(v_pdf, 'não anexado (não exigido para esta O.S.)') || coalesce('. Pendências: ' || v_pend, ''));
  end if;
end $$;

-- O.S. cancelada fica só para consulta: a planilha não altera nem gera decisão sobre ela
create or replace function public.pendencia_decidir(p_id bigint, p_acao text, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); p public.planilha_pendencias; v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência decide sobre os lançamentos da planilha.'; end if;
  select * into p from public.planilha_pendencias where id = p_id for update;
  if p.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if p.situacao <> 'aberta' then raise exception 'Este lançamento já foi tratado.'; end if;
  if p.tipo = 'mudanca' and exists (select 1 from public.os where id = p.os_id and status = 'Cancelada') then
    raise exception 'A O.S. % está cancelada: fica só para consulta.', p.numero; end if;
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

-- planilha: "Atendida" aplicada só fica sem a O.S. assinada (e avisa a empresa) se ela for exigida
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
  if o.status = 'Cancelada' then raise exception 'A O.S. % está cancelada: fica só para consulta e a planilha não altera mais nada nela.', o.numero; end if;
  d := p.dados; v_quem := coalesce(a.nome, a.email);
  foreach v_c in array p_campos loop
    if not exists (select 1 from jsonb_array_elements(p.diferencas) x where x->>'campo' = v_c) then raise exception 'Campo sem diferença: %.', v_c; end if;
    v_n := v_n + 1;
    if v_c = 'Status' then
      v_status := d->>'status';
      if v_status not in ('Emitida','Stand by','Atendida','Cancelada') then raise exception 'Status da planilha inválido: %.', v_status; end if;
      if v_status = 'Cancelada' and o.status = 'Atendida' then
        raise exception 'A O.S. % já está atendida e não pode ser cancelada (nem pela planilha). Desmarque o campo Status.', o.numero; end if;
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
  if n.status = 'Atendida' and o.status <> 'Atendida' and n.pdf_caminho is null and public._exige_pdf(o.criada_em) then
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

-- a pendência some também quando a O.S. não exige o PDF
create or replace function public._comprovante_os()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.comprovante_pendente and (new.status <> 'Atendida' or not public._exige_pdf(new.criada_em)
     or (new.pdf_caminho is not null and new.pdf_caminho is distinct from old.pdf_caminho)) then
    new.comprovante_pendente := false;
  end if;
  return new;
end $$;
update public.os set comprovante_pendente = false where comprovante_pendente and not public._exige_pdf(criada_em);

-- ---------------------------------------------------------------------
-- 4. Consultivo vê só as empresas que fiscaliza
-- ---------------------------------------------------------------------
alter table public.perfis add column if not exists todas_empresas boolean not null default false;
alter table public.perfis add column if not exists empresas text[] not null default '{}';
do $$ begin
  -- quem já é Consultivo (Diretoria) continua vendo todas
  if not exists (select 1 from public.perfis where perfil = 'consultivo' and (todas_empresas or cardinality(empresas) > 0)) then
    update public.perfis set todas_empresas = true where perfil = 'consultivo';
  end if;
end $$;

-- o usuário atual vê as O.S. desta empresa?
create or replace function public.ve_empresa(p_empresa text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo and p.situacao = 'aprovado'
                   and (p.perfil in ('gmap','tecnico') or (p.perfil = 'consultivo' and (p.todas_empresas or p_empresa = any(p.empresas)))))
$$;
grant execute on function public.ve_empresa(text) to authenticated;

create or replace function public._empresas_txt(p_perfil text, p_todas boolean, p_emps text[])
returns text language sql immutable as $$
  select case when p_perfil <> 'consultivo' then '' when p_todas then ' · todas as empresas'
              when cardinality(p_emps) = 0 then ' · nenhuma empresa' else ' · empresas: ' || array_to_string(p_emps, ', ') end
$$;
revoke all on function public._empresas_txt(text, boolean, text[]) from public, anon, authenticated;

drop policy if exists os_leitura on public.os;
create policy os_leitura on public.os for select to authenticated using (
  public.ve_empresa(os.empresa)
  or (exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = os.empresa)
      and os.status not in ('Aguardando aprovação','Devolvida','Recusada'))
);
drop policy if exists evt_leitura on public.os_eventos;
create policy evt_leitura on public.os_eventos for select to authenticated using (
  exists (select 1 from public.os o where o.id = os_eventos.os_id and public.ve_empresa(o.empresa))
  or (not os_eventos.interno and exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa
                                          where o.id = os_eventos.os_id and o.status not in ('Aguardando aprovação','Devolvida','Recusada'))));
drop policy if exists hist_leitura on public.os_historico;
create policy hist_leitura on public.os_historico for select to authenticated using (
  public.ve_empresa(os_historico.empresa)
  or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = os_historico.empresa));
drop policy if exists emp_leitura on public.empresas;
create policy emp_leitura on public.empresas for select to authenticated using (
  public.ve_empresa(empresas.nome) or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = empresas.nome));
create or replace function public.pode_ver_pdf(p_pasta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.os o where o.id::text = p_pasta and public.ve_empresa(o.empresa))
      or exists (select 1 from public.os o join public.meu_perfil() m on m.perfil = 'empresa' and m.empresa = o.empresa where o.id::text = p_pasta)
$$;

drop policy if exists conferencias_leitura on public.os_conferencias;
create policy conferencias_leitura on public.os_conferencias for select to authenticated using (
  exists (select 1 from public.os o where o.id = os_conferencias.os_id and public.ve_empresa(o.empresa)));
revoke all on public.os_conferencias from anon, authenticated;
grant select on public.os_conferencias to authenticated;
-- sem políticas de escrita: só pela função abaixo

drop function if exists public.os_conferir(bigint[], text, text);
create or replace function public.os_conferir(p_ids bigint[], p_situacao text, p_motivos text[] default '{}', p_obs text default null)
returns int language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_obs text := nullif(trim(coalesce(p_obs, '')), ''); v_id bigint; o public.os; n int := 0;
        v_mot text[] := coalesce((select array_agg(trim(x)) from unnest(p_motivos) x where trim(coalesce(x, '')) <> ''), '{}');
        rot text := case p_situacao when 'conferida' then 'Conferida' when 'ressalva' then 'Conferida com ressalva'
                                    when 'glosada' then 'Glosada' when 'pendente' then 'Conferência desfeita (volta para "a conferir")' end;
begin
  if a.perfil not in ('gmap','consultivo') then raise exception 'Somente a gerência e o perfil Consultivo registram a conferência.'; end if;
  if rot is null then raise exception 'Situação de conferência inválida.'; end if;
  if p_situacao in ('ressalva','glosada') and cardinality(v_mot) = 0 then raise exception 'Escolha ao menos um motivo.'; end if;
  if exists (select 1 from unnest(v_mot) x where x ~* '^outro:?\s*$') then raise exception 'Descreva o motivo "Outro".'; end if;
  if p_situacao = 'pendente' and length(coalesce(v_obs, '')) < 5 then raise exception 'Explique por que a conferência foi desfeita (mínimo de 5 caracteres).'; end if;
  if p_situacao in ('conferida','pendente') then v_mot := '{}'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Escolha ao menos uma O.S.'; end if;
  if cardinality(p_ids) > 500 then raise exception 'Confira no máximo 500 O.S. por vez.'; end if;
  foreach v_id in array p_ids loop
    select * into o from public.os where id = v_id;
    if o.id is null or not public.ve_empresa(o.empresa) then raise exception 'O.S. não encontrada.'; end if;
    if o.status <> 'Atendida' then raise exception 'A O.S. % não está atendida.', coalesce(o.numero, o.id::text); end if;
    insert into public.os_conferencias (os_id, situacao, motivos, obs, quem, quem_nome, perfil, funcao)
    values (v_id, p_situacao, v_mot, v_obs, a.user_id, coalesce(a.nome, a.email), a.perfil, a.funcao);
    perform public._evento(v_id, 'conferiu', rot || case when cardinality(v_mot) > 0 then ': ' || array_to_string(v_mot, '; ') else '' end
                                              || coalesce(case when cardinality(v_mot) > 0 then '. Obs.: ' else ': ' end || v_obs, ''), true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.os_conferir(bigint[], text, text[], text) from public, anon;
grant execute on function public.os_conferir(bigint[], text, text[], text) to authenticated;

-- cadastro: Consultivo informa as empresas que vai fiscalizar (ou todas)
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_perfil text := m->>'perfil';
  v_empresa text := nullif(trim(m->>'empresa'), '');
  v_funcao text := nullif(trim(m->>'funcao'), '');
  v_todas boolean := coalesce((m->>'todas_empresas')::boolean, false);
  v_emps text[] := coalesce((select array_agg(distinct trim(x)) from jsonb_array_elements_text(case when jsonb_typeof(m->'empresas') = 'array' then m->'empresas' else '[]'::jsonb end) x where trim(x) <> ''), '{}');
begin
  if v_perfil is null then return new; end if;
  if v_perfil = 'diretoria' then v_perfil := 'consultivo'; v_funcao := coalesce(v_funcao, 'Diretoria'); v_todas := true; end if;
  if v_perfil not in ('gmap','tecnico','consultivo','empresa') then raise exception 'Perfil inválido.'; end if;
  if v_perfil = 'empresa' and v_empresa is null then raise exception 'Informe a empresa.'; end if;
  if v_perfil = 'consultivo' and v_funcao is null then raise exception 'Informe a função (Diretoria, Fiscal de contrato...).'; end if;
  if v_perfil <> 'empresa' then v_empresa := null; end if;
  if v_perfil = 'consultivo' and m ? 'funcao' and not v_todas and cardinality(v_emps) = 0 and (m ? 'empresas' or m ? 'todas_empresas') then raise exception 'Escolha as empresas que vai fiscalizar (ou todas).'; end if;
  if v_perfil <> 'consultivo' then v_funcao := null; v_todas := false; v_emps := '{}'; end if;
  insert into public.perfis (user_id, email, nome, perfil, empresa, funcao, todas_empresas, empresas, situacao)
  values (new.id, new.email, nullif(trim(m->>'nome'), ''), v_perfil, v_empresa, left(v_funcao, 60), v_todas, v_emps, 'pendente')
  on conflict (user_id) do nothing;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (new.id, new.id, 'solicitou', public._perfil_txt(v_perfil, v_empresa, v_funcao) || public._empresas_txt(v_perfil, v_todas, v_emps));
  return new;
end $$;

-- aprovação: Consultivo precisa ter empresas definidas (ou todas)
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
    if p_perfil = 'consultivo' and not exists (select 1 from public.perfis where user_id = p_usuario and (todas_empresas or cardinality(empresas) > 0)) then
      raise exception 'Defina em "Editar" as empresas que esse usuário Consultivo vai ver.'; end if;
    update public.perfis set perfil = p_perfil, empresa = case when p_perfil = 'empresa' then trim(p_empresa) end,
           funcao = case when p_perfil = 'consultivo' then coalesce(funcao, 'Consultivo') end,
           todas_empresas = case when p_perfil = 'consultivo' then todas_empresas else false end,
           empresas = case when p_perfil = 'consultivo' then empresas else '{}' end,
           situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  else
    update public.perfis set situacao = v_situacao, decidido_por = auth.uid(), decidido_em = now() where user_id = p_usuario;
  end if;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe)
  values (auth.uid(), p_usuario, p_acao, case when p_acao = 'aprovar' then public._perfil_txt(p_perfil, p_empresa, null) end);
end $$;

-- lista de usuários (agora com as empresas do Consultivo)
drop function if exists public.listar_usuarios();
create function public.listar_usuarios()
returns table (user_id uuid, email text, nome text, perfil text, empresa text, funcao text, todas_empresas boolean, empresas text[], situacao text,
               criado_em timestamptz, decidido_em timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à GMAP.'; end if;
  return query
    select p.user_id, p.email, p.nome, p.perfil, p.empresa, p.funcao, p.todas_empresas, p.empresas, p.situacao, p.criado_em, p.decidido_em,
           (select max(a.acessado_em) from public.acessos a where a.user_id = p.user_id)
    from public.perfis p
    order by case p.situacao when 'pendente' then 0 else 1 end, p.criado_em desc;
end $$;
revoke all on function public.listar_usuarios() from public, anon;
grant execute on function public.listar_usuarios() to authenticated;

-- editar usuário: agora com as empresas do Consultivo
drop function if exists public.usuario_editar(uuid, text, text, text, text);
create or replace function public.usuario_editar(p_usuario uuid, p_nome text, p_perfil text, p_empresa text default null, p_funcao text default null,
                                                 p_empresas text[] default '{}', p_todas boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare u public.perfis; v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
        v_emp text := nullif(trim(coalesce(p_empresa, '')), ''); v_fun text := nullif(trim(coalesce(p_funcao, '')), ''); mud text[] := '{}';
        v_emps text[] := coalesce((select array_agg(distinct trim(x) order by trim(x)) from unnest(p_empresas) x where trim(coalesce(x, '')) <> ''), '{}');
        v_todas boolean := coalesce(p_todas, false);
begin
  if not public.eh_gmap() then raise exception 'Acesso restrito à gerência.'; end if;
  select * into u from public.perfis where user_id = p_usuario for update;
  if u.user_id is null then raise exception 'Usuário não encontrado.'; end if;
  if p_perfil not in ('gmap','tecnico','consultivo','empresa') then raise exception 'Perfil inválido.'; end if;
  if p_usuario = auth.uid() and p_perfil <> u.perfil then raise exception 'Você não pode alterar o próprio perfil. Peça a outra pessoa da gerência.'; end if;
  if char_length(v_nome) < 3 or char_length(v_nome) > 120 then raise exception 'Informe o nome completo (de 3 a 120 caracteres).'; end if;
  if p_perfil = 'empresa' and v_emp is null then raise exception 'Escolha a empresa.'; end if;
  if p_perfil = 'consultivo' and v_fun is null then raise exception 'Informe a função (Diretoria, Fiscal de contrato...).'; end if;
  if p_perfil = 'consultivo' and not v_todas and cardinality(v_emps) = 0 then raise exception 'Escolha as empresas que esse usuário vai ver (ou todas).'; end if;
  if p_perfil <> 'empresa' then v_emp := null; end if;
  if p_perfil <> 'consultivo' then v_fun := null; v_todas := false; v_emps := '{}'; end if;
  if v_todas then v_emps := '{}'; end if;
  if v_fun is not null and char_length(v_fun) > 60 then raise exception 'A função pode ter até 60 caracteres.'; end if;
  if u.nome is distinct from v_nome then mud := mud || ('nome: ' || coalesce(u.nome, '(vazio)') || ' → ' || v_nome); end if;
  if u.perfil is distinct from p_perfil or u.empresa is distinct from v_emp or u.funcao is distinct from v_fun then
    mud := mud || ('perfil: ' || public._perfil_txt(u.perfil, u.empresa, u.funcao) || ' → ' || public._perfil_txt(p_perfil, v_emp, v_fun));
  end if;
  if (u.todas_empresas, u.empresas) is distinct from (v_todas, v_emps) and p_perfil = 'consultivo' then
    mud := mud || ('empresas:' || public._empresas_txt('consultivo', u.todas_empresas, u.empresas) || ' →' || public._empresas_txt('consultivo', v_todas, v_emps));
  end if;
  if cardinality(mud) = 0 then return; end if;
  update public.perfis set nome = v_nome, perfil = p_perfil, empresa = v_emp, funcao = v_fun, todas_empresas = v_todas, empresas = v_emps where user_id = p_usuario;
  insert into public.perfis_log (feito_por, usuario, acao, detalhe) values (auth.uid(), p_usuario, 'editou', array_to_string(mud, '; '));
end $$;
revoke all on function public.usuario_editar(uuid, text, text, text, text, text[], boolean) from public, anon;
grant execute on function public.usuario_editar(uuid, text, text, text, text, text[], boolean) to authenticated;
