-- =====================================================================
-- 009 · Correção: salvar as Configurações
--
-- No Supabase, toda alteração feita pelo site precisa dizer qual linha muda
-- (proteção "UPDATE requires a WHERE clause"). As duas funções que salvam as
-- Configurações alteravam a única linha de sistema_config sem dizer qual, e
-- por isso davam esse erro ao salvar:
--  · motivos de glosa e de ressalva e data da O.S. assinada (config_salvar);
--  · data a partir da qual os itens do contrato são exigidos (medicao_config_salvar).
-- Esta migração só refaz as duas funções com "where id = 1". Nada mais muda.
--
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

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
  update public.sistema_config set motivos_glosa = g, motivos_ressalva = r, pdf_obrigatorio_desde = p_pdf_desde where id = 1;
  insert into public.config_log (quem, quem_nome, detalhe) values (a.user_id, coalesce(a.nome, a.email), array_to_string(mud, ' | '));
  -- O.S. que deixaram de exigir o PDF saem da lista de pendências
  update public.os set comprovante_pendente = false where comprovante_pendente and not public._exige_pdf(criada_em);
end $$;

create or replace function public.medicao_config_salvar(p_desde date)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_ant date;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera as configurações.'; end if;
  if p_desde is null then raise exception 'Informe a data a partir da qual os itens são exigidos.'; end if;
  select medicao_desde into v_ant from public.sistema_config limit 1 for update;
  if v_ant = p_desde then return; end if;
  update public.sistema_config set medicao_desde = p_desde where id = 1;
  insert into public.config_log (quem, quem_nome, detalhe) values (a.user_id, coalesce(a.nome, a.email), 'Itens do contrato exigidos a partir de ' || public._dm(v_ant) || ' → ' || public._dm(p_desde));
end $$;
