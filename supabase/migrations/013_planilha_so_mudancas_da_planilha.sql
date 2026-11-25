-- =====================================================================
-- 013 · Aba Planilha: avisar só o que mudou NA PLANILHA
--
-- Antes: a leitura comparava a planilha com o estado atual do sistema. Como a
-- planilha parou na virada, tudo o que mudava no sistema (atendimento, prazo,
-- cancelamento...) aparecia como se fosse "mudança na planilha".
--
-- Agora: o banco guarda a última leitura de cada linha da planilha (espelho) e só
-- avisa quando a planilha muda em relação à leitura anterior, e só nos campos em
-- que o valor novo da planilha é diferente do sistema.
--   * primeira leitura depois desta migração: só registra o espelho (nenhum aviso);
--   * pendências de "mudança" abertas hoje são encerradas como alarme falso
--     (decisão da gerência em 25/11/2026), com registro em "Já tratados";
--   * pendências de "O.S. nova na planilha" não mudam.
--
-- Só cria uma tabela e troca a função de leitura. Não altera nenhuma O.S.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

create table if not exists public.planilha_espelho (
  chave    text primary key,          -- "número|empresa" na planilha
  valores  jsonb not null,            -- campos comparados, como estavam na última leitura
  lido_em  timestamptz not null default now()
);
alter table public.planilha_espelho enable row level security;
revoke all on public.planilha_espelho from anon, authenticated;   -- uso interno do banco

-- pendências de mudança abertas hoje: alarmes da comparação antiga (sistema x planilha)
update public.planilha_pendencias
   set situacao = 'resolvida', decidido_por = 'Sistema (atualização 2.10)', decidido_em = now(), atualizado_em = now(),
       obs = 'Encerrada na atualização 2.10: a comparação antiga apontava como mudança da planilha o que tinha mudado no sistema.'
 where tipo = 'mudanca' and situacao = 'aberta';

create or replace function public._observar_planilha(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; o public.os; v_dados jsonb; v_pla jsonb; v_ant jsonb; v_sis jsonb; v_dif jsonb; v_ass text; p public.planilha_pendencias;
        v_novas int; v_mud int; v_c text; v_lista jsonb;
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
      -- O.S. nova lançada na planilha (igual a antes)
      v_ass := md5(v_dados::text);
      insert into public.planilha_pendencias (chave, tipo, numero, empresa, dados, assinatura)
      values (r.chave, 'nova', r.numero, r.empresa, v_dados, v_ass)
      on conflict (chave, tipo) do update set dados = excluded.dados, assinatura = excluded.assinatura, atualizado_em = now()
        where planilha_pendencias.situacao = 'aberta' and planilha_pendencias.assinatura <> excluded.assinatura;
      continue;
    end if;
    continue when o.status in ('Aguardando aprovação','Devolvida','Recusada');

    -- o que a planilha diz hoje, e o que o sistema diz, nos mesmos campos
    v_pla := jsonb_build_object(
      'Status', r.st, 'Data do atendimento', to_char(r.atendida_em, 'DD/MM/YYYY'),
      'Justificativa da empresa', nullif(trim(r.justificativa), ''), 'Motivo do cancelamento', nullif(trim(r.motivo_cancelamento), ''),
      'Prioridade', r.prioridade, 'Prazo', to_char(r.prazo, 'DD/MM/YYYY'));
    v_sis := jsonb_build_object(
      'Status', o.status, 'Data do atendimento', to_char(o.atendida_em, 'DD/MM/YYYY'),
      'Justificativa da empresa', nullif(trim(o.justificativa), ''), 'Motivo do cancelamento', nullif(trim(o.motivo_cancelamento), ''),
      'Prioridade', o.prioridade, 'Prazo', to_char(o.prazo, 'DD/MM/YYYY'));
    select valores into v_ant from public.planilha_espelho where chave = r.chave;

    if v_ant is null then
      -- primeira leitura desta linha: só guarda o espelho
      insert into public.planilha_espelho (chave, valores) values (r.chave, v_pla);
    elsif v_ant is distinct from v_pla then
      -- a planilha mudou: campos alterados nela cujo valor novo difere do sistema
      select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'anterior', v_ant->>k, 'planilha', v_pla->>k, 'sistema', v_sis->>k)), '[]')
        into v_dif
        from jsonb_object_keys(v_pla) k
       where (v_ant->>k) is distinct from (v_pla->>k) and (v_pla->>k) is distinct from (v_sis->>k);
      update public.planilha_espelho set valores = v_pla, lido_em = now() where chave = r.chave;
      if jsonb_array_length(v_dif) > 0 then
        select * into p from public.planilha_pendencias where chave = r.chave and tipo = 'mudanca';
        -- se já havia pendência aberta, junta: mantém campos antigos que ainda diferem do sistema
        if p.id is not null and p.situacao = 'aberta' then
          select coalesce(jsonb_agg(x), '[]') into v_lista
            from jsonb_array_elements(p.diferencas) x
           where not exists (select 1 from jsonb_array_elements(v_dif) y where y->>'campo' = x->>'campo')
             and (v_pla->>(x->>'campo')) is distinct from (v_sis->>(x->>'campo'));
          v_dif := v_lista || v_dif;
        end if;
        v_ass := md5(v_dif::text);
        if p.id is null then
          insert into public.planilha_pendencias (chave, tipo, os_id, numero, empresa, dados, diferencas, assinatura)
          values (r.chave, 'mudanca', o.id, coalesce(o.numero, r.numero), o.empresa, v_dados, v_dif, v_ass);
        else
          update public.planilha_pendencias set dados = v_dados, diferencas = v_dif, assinatura = v_ass, situacao = 'aberta', os_id = o.id,
                 atualizado_em = now(), decidido_por = null, decidido_em = null, obs = null
           where id = p.id;
        end if;
        continue;
      end if;
    end if;

    -- pendência aberta que deixou de fazer sentido (sistema e planilha coincidem em todos os campos dela)
    select * into p from public.planilha_pendencias where chave = r.chave and tipo = 'mudanca' and situacao = 'aberta';
    if p.id is not null and not exists (select 1 from jsonb_array_elements(p.diferencas) x
                                         where (v_pla->>(x->>'campo')) is distinct from (v_sis->>(x->>'campo'))) then
      update public.planilha_pendencias set situacao = 'resolvida', obs = 'Planilha e sistema voltaram a coincidir.', decidido_em = now(), atualizado_em = now()
       where id = p.id;
    end if;
  end loop;
  update public.sistema_config set planilha_observada_em = now() where id = 1;
  select count(*) filter (where tipo = 'nova'), count(*) filter (where tipo = 'mudanca') into v_novas, v_mud
    from public.planilha_pendencias where situacao = 'aberta';
  return jsonb_build_object('modo', 'observacao', 'registros', (select count(*) from _p), 'novas_abertas', v_novas, 'mudancas_abertas', v_mud,
                            'inseridos', 0, 'removidos', 0, 'status_alterados', 0, 'ignoradas', 0, 'ignoradas_chaves', '[]'::jsonb);
end $$;
revoke all on function public._observar_planilha(jsonb) from public, anon, authenticated;
