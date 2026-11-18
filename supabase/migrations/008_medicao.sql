-- =====================================================================
-- 008 · Medição pelos itens do contrato
--
--  · contratos, períodos de vigência (cada prorrogação abre um período e
--    renova o quantitativo), itens (serviços e peças por faixa de BTU),
--    preços com histórico de versões e quantidade por período, com o consumo
--    anterior à implantação informado pela GMAP (com o documento SEI);
--  · a empresa declara os itens executados ao registrar o atendimento
--    (obrigatório a partir de uma data configurável); a GMAP também pode;
--  · o fiscal aceita ou glosa a quantidade de cada item na conferência;
--  · o saldo só avisa: o que passar do quantitativo continua sendo registrado
--    (para eventual pagamento indenizatório);
--  · empresas sem contrato (pagas por nota de empenho, como a R.E. Soluções)
--    ficam fora da medição: a O.S. guarda processo, empenho e valor;
--  · última movimentação de cada O.S. (do histórico), para a fila e a visão geral;
--  · carga inicial: contratos 119/2024 (Classe A, período do 3º TA) e
--    012/2026 (Concretizar), com os 91 itens.
--
-- Rodar uma vez no SQL Editor do Supabase, depois da 007. Pode rodar de novo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cadastro
-- ---------------------------------------------------------------------
create table if not exists public.contratos (
  id           bigserial primary key,
  empresa      text not null,
  numero       text not null,
  processo_sei text,
  documento_sei text,
  ativo        boolean not null default true,
  unique (empresa, numero)
);
create table if not exists public.contrato_periodos (
  id           bigserial primary key,
  contrato_id  bigint not null references public.contratos(id) on delete cascade,
  inicio       date not null,
  fim          date not null,
  instrumento  text not null,
  documento_sei text,
  check (fim >= inicio),
  unique (contrato_id, inicio)
);
create table if not exists public.contrato_itens (
  id           bigserial primary key,
  contrato_id  bigint not null references public.contratos(id) on delete cascade,
  grupo        text not null check (grupo in ('Serviço','Peça')),
  item         int not null check (item > 0),
  tipo         text not null,
  faixa        text not null,
  unidade      text not null default 'Unidade',
  ativo        boolean not null default true,
  unique (contrato_id, grupo, item)
);
create table if not exists public.item_precos (
  id           bigserial primary key,
  item_id      bigint not null references public.contrato_itens(id) on delete cascade,
  desde        date not null,
  valor        numeric(12,2) not null check (valor > 0),
  documento_sei text not null,
  unique (item_id, desde)
);
create table if not exists public.item_quantidades (
  item_id      bigint not null references public.contrato_itens(id) on delete cascade,
  periodo_id   bigint not null references public.contrato_periodos(id) on delete cascade,
  quantidade   int not null check (quantidade >= 0),
  consumo_anterior int not null default 0 check (consumo_anterior >= 0),
  consumo_doc  text,
  consumo_informado boolean not null default false,
  primary key (item_id, periodo_id)
);
create table if not exists public.contratos_log (
  id bigserial primary key, empresa text not null, quem uuid default auth.uid(), quem_nome text, em timestamptz not null default now(), detalhe text not null);

-- itens declarados na O.S. (a empresa vê os dela) e a conferência de cada item (a empresa não vê)
create table if not exists public.os_itens (
  id          bigserial primary key,
  os_id       bigint not null references public.os(id) on delete cascade,
  item_id     bigint not null references public.contrato_itens(id),
  quantidade  int not null check (quantidade between 1 and 999),
  declarado_nome text,
  declarado_em timestamptz not null default now(),
  unique (os_id, item_id)
);
create index if not exists os_itens_os_idx on public.os_itens (os_id);
-- a empresa vê só que os itens já foram conferidos (não vê o resultado): assim não tenta alterá-los
alter table public.os_itens add column if not exists conferido boolean not null default false;
create table if not exists public.os_itens_conf (
  os_item_id  bigint primary key references public.os_itens(id) on delete cascade,
  aceita      int not null check (aceita >= 0),
  motivo      text,
  quem_nome   text,
  em          timestamptz not null default now()
);

-- empresas sem contrato: pagamento por nota de empenho em cada processo
alter table public.os add column if not exists avulso_processo text;
alter table public.os add column if not exists avulso_empenho text;
alter table public.os add column if not exists avulso_valor numeric(12,2);

-- itens exigidos nos atendimentos a partir de (data configurável)
alter table public.sistema_config add column if not exists medicao_desde date not null default date '2027-01-01';

-- ---------------------------------------------------------------------
-- 2. Leitura (gerência, técnicos e fiscais das empresas; a empresa vê o próprio contrato)
-- ---------------------------------------------------------------------
create or replace function public.ve_contrato(p_empresa text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ve_empresa(p_empresa) or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = p_empresa)
$$;
grant execute on function public.ve_contrato(text) to authenticated;

alter table public.contratos enable row level security;
alter table public.contrato_periodos enable row level security;
alter table public.contrato_itens enable row level security;
alter table public.item_precos enable row level security;
alter table public.item_quantidades enable row level security;
alter table public.contratos_log enable row level security;
alter table public.os_itens enable row level security;
alter table public.os_itens_conf enable row level security;
drop policy if exists contratos_leitura on public.contratos;
create policy contratos_leitura on public.contratos for select to authenticated using (public.ve_contrato(empresa));
drop policy if exists periodos_leitura on public.contrato_periodos;
create policy periodos_leitura on public.contrato_periodos for select to authenticated using (
  exists (select 1 from public.contratos c where c.id = contrato_id and public.ve_contrato(c.empresa)));
drop policy if exists itens_leitura on public.contrato_itens;
create policy itens_leitura on public.contrato_itens for select to authenticated using (
  exists (select 1 from public.contratos c where c.id = contrato_id and public.ve_contrato(c.empresa)));
drop policy if exists precos_leitura on public.item_precos;
create policy precos_leitura on public.item_precos for select to authenticated using (
  exists (select 1 from public.contrato_itens i join public.contratos c on c.id = i.contrato_id where i.id = item_id and public.ve_contrato(c.empresa)));
-- quantitativo, saldo e histórico do cadastro: só quem fiscaliza
drop policy if exists quantidades_leitura on public.item_quantidades;
create policy quantidades_leitura on public.item_quantidades for select to authenticated using (
  exists (select 1 from public.contrato_itens i join public.contratos c on c.id = i.contrato_id where i.id = item_id and public.ve_empresa(c.empresa)));
drop policy if exists contratos_log_leitura on public.contratos_log;
create policy contratos_log_leitura on public.contratos_log for select to authenticated using (public.ve_empresa(empresa));
drop policy if exists os_itens_leitura on public.os_itens;
create policy os_itens_leitura on public.os_itens for select to authenticated using (
  exists (select 1 from public.os o where o.id = os_id and (public.ve_empresa(o.empresa)
          or exists (select 1 from public.meu_perfil() m where m.perfil = 'empresa' and m.empresa = o.empresa))));
drop policy if exists os_itens_conf_leitura on public.os_itens_conf;
create policy os_itens_conf_leitura on public.os_itens_conf for select to authenticated using (
  exists (select 1 from public.os_itens x join public.os o on o.id = x.os_id where x.id = os_item_id and public.ve_empresa(o.empresa)));
revoke all on public.contratos, public.contrato_periodos, public.contrato_itens, public.item_precos, public.item_quantidades,
              public.contratos_log, public.os_itens, public.os_itens_conf from anon, authenticated;
grant select on public.contratos, public.contrato_periodos, public.contrato_itens, public.item_precos, public.item_quantidades,
                public.contratos_log, public.os_itens, public.os_itens_conf to authenticated;
-- sem políticas de escrita: só pelas funções abaixo

-- ---------------------------------------------------------------------
-- 3. Regras auxiliares
-- ---------------------------------------------------------------------
create or replace function public._item_preco(p_item bigint, p_data date)
returns numeric language sql stable security definer set search_path = public as $$
  select valor from public.item_precos where item_id = p_item and desde <= p_data order by desde desc limit 1
$$;
create or replace function public._periodo_de(p_contrato bigint, p_data date)
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.contrato_periodos where contrato_id = p_contrato and p_data between inicio and fim order by inicio desc limit 1
$$;
-- contrato ativo da empresa com período de vigência na data
create or replace function public._contrato_na_data(p_empresa text, p_data date)
returns bigint language sql stable security definer set search_path = public as $$
  select c.id from public.contratos c join public.contrato_periodos p on p.contrato_id = c.id
   where c.empresa = p_empresa and c.ativo and p_data between p.inicio and p.fim order by p.inicio desc limit 1
$$;
create or replace function public._exige_itens(p_empresa text, p_data date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_data >= (select medicao_desde from public.sistema_config limit 1) and public._contrato_na_data(p_empresa, p_data) is not null
$$;
grant execute on function public._exige_itens(text, date) to authenticated;
revoke all on function public._item_preco(bigint, date), public._periodo_de(bigint, date), public._contrato_na_data(text, date) from public, anon, authenticated;

-- quem cadastra: gerência, ou fiscal (Consultivo) da empresa
create or replace function public._pode_cadastrar(p_empresa text)
returns public.perfis language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator();
begin
  if a.perfil = 'gmap' or (a.perfil = 'consultivo' and public.ve_empresa(p_empresa)) then return a; end if;
  raise exception 'Somente a gerência e os fiscais da empresa alteram o contrato.';
end $$;
revoke all on function public._pode_cadastrar(text) from public, anon, authenticated;

create or replace function public._clog(p_empresa text, a public.perfis, p_det text)
returns void language sql security definer set search_path = public as $$
  insert into public.contratos_log (empresa, quem, quem_nome, detalhe) values (p_empresa, a.user_id, coalesce(a.nome, a.email), p_det)
$$;
revoke all on function public._clog(text, public.perfis, text) from public, anon, authenticated;

-- grava os itens declarados de uma O.S. atendida (substitui a lista); devolve o resumo para o histórico
create or replace function public._os_itens_gravar(p_os bigint, p_itens jsonb, a public.perfis)
returns text language plpgsql security definer set search_path = public as $$
declare o public.os; v_ct bigint; x jsonb; v_it public.contrato_itens; v_q int; txt text[] := '{}'; ids bigint[] := '{}';
begin
  select * into o from public.os where id = p_os;
  if o.atendida_em is null then raise exception 'Informe a data do atendimento antes dos itens.'; end if;
  if exists (select 1 from public.os_itens_conf c join public.os_itens i on i.id = c.os_item_id where i.os_id = p_os) then
    raise exception 'Os itens desta O.S. já foram conferidos pelo fiscal. Para alterar, a conferência precisa ser desfeita.'; end if;
  if jsonb_array_length(p_itens) > 0 then
    v_ct := public._contrato_na_data(o.empresa, o.atendida_em);
    if v_ct is null then raise exception 'A empresa não tem contrato vigente em % para declarar itens.', public._dm(o.atendida_em); end if;
  end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Itens demais nesta O.S.'; end if;
  delete from public.os_itens where os_id = p_os;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into v_it from public.contrato_itens where id = (x->>'item_id')::bigint;
    if v_it.id is null or v_it.contrato_id <> v_ct or not v_it.ativo then raise exception 'Item que não pertence ao contrato vigente da empresa.'; end if;
    begin v_q := (x->>'quantidade')::int; exception when others then v_q := null; end;
    if v_q is null or v_q < 1 or v_q > 999 or (x->>'quantidade')::numeric <> v_q then raise exception 'Quantidade inválida no item % %.', v_it.grupo, v_it.item; end if;
    if v_it.id = any(ids) then raise exception 'O item % % aparece mais de uma vez.', v_it.grupo, v_it.item; end if;
    if public._item_preco(v_it.id, o.atendida_em) is null then raise exception 'O item % % não tem preço vigente em %.', v_it.grupo, v_it.item, public._dm(o.atendida_em); end if;
    ids := ids || v_it.id;
    insert into public.os_itens (os_id, item_id, quantidade, declarado_nome) values (p_os, v_it.id, v_q, coalesce(a.nome, a.email));
    txt := txt || (v_q || ' x ' || lower(v_it.tipo) || ' ' || v_it.faixa || ' BTU');
  end loop;
  return case when cardinality(txt) = 0 then 'nenhum' else array_to_string(txt, '; ') end;
end $$;
revoke all on function public._os_itens_gravar(bigint, jsonb, public.perfis) from public, anon, authenticated;

-- conferência por item: conferida/ressalva aceitam tudo; glosa pede a quantidade aceita; desfazer limpa
create or replace function public._os_itens_conferir(o public.os, p_situacao text, p_itens jsonb, a public.perfis)
returns text language plpgsql security definer set search_path = public as $$
declare x record; v_ac int; v_mot text; txt text[] := '{}'; reduziu boolean := false;
begin
  if not exists (select 1 from public.os_itens where os_id = o.id) then return null; end if;
  if p_situacao = 'pendente' then
    delete from public.os_itens_conf where os_item_id in (select id from public.os_itens where os_id = o.id);
    update public.os_itens set conferido = false where os_id = o.id; return 'conferência dos itens desfeita'; end if;
  update public.os_itens set conferido = true where os_id = o.id;
  if p_situacao in ('conferida','ressalva') then
    insert into public.os_itens_conf (os_item_id, aceita, motivo, quem_nome)
      select id, quantidade, null, coalesce(a.nome, a.email) from public.os_itens where os_id = o.id
      on conflict (os_item_id) do update set aceita = excluded.aceita, motivo = null, quem_nome = excluded.quem_nome, em = now();
    return 'todos aceitos';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'A O.S. % tem itens declarados: glose uma por vez, informando a quantidade aceita de cada item.', coalesce(o.numero, o.id::text); end if;
  for x in select i.*, ci.tipo, ci.faixa from public.os_itens i join public.contrato_itens ci on ci.id = i.item_id where i.os_id = o.id order by i.id loop
    begin select (e->>'aceita')::int into v_ac from jsonb_array_elements(p_itens) e where (e->>'id')::bigint = x.id; exception when others then v_ac := null; end;
    select nullif(trim(coalesce(e->>'motivo', '')), '') into v_mot from jsonb_array_elements(p_itens) e where (e->>'id')::bigint = x.id;
    if v_ac is null then raise exception 'Informe a quantidade aceita de todos os itens.'; end if;
    if v_ac < 0 or v_ac > x.quantidade then raise exception 'A quantidade aceita de % % deve ficar entre 0 e %.', lower(x.tipo), x.faixa, x.quantidade; end if;
    if v_ac < x.quantidade then reduziu := true; txt := txt || (lower(x.tipo) || ' ' || x.faixa || ': ' || v_ac || ' de ' || x.quantidade || coalesce(' (' || v_mot || ')', '')); end if;
    insert into public.os_itens_conf (os_item_id, aceita, motivo, quem_nome) values (x.id, v_ac, case when v_ac < x.quantidade then v_mot end, coalesce(a.nome, a.email))
      on conflict (os_item_id) do update set aceita = excluded.aceita, motivo = excluded.motivo, quem_nome = excluded.quem_nome, em = now();
  end loop;
  if not reduziu then raise exception 'Na glosa, reduza a quantidade aceita de ao menos um item.'; end if;
  return 'aceitos ' || array_to_string(txt, '; ');
end $$;
revoke all on function public._os_itens_conferir(public.os, text, jsonb, public.perfis) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Atendimento com os itens e conferência por item
-- ---------------------------------------------------------------------
create or replace function public.os_atendimento(p_id bigint, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_data date; v_just text; v_pend text; v_pdf text; v_cam text; v_corr boolean; v_mot text; v_itens jsonb := p_dados->'itens'; v_ntxt text;
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
  if jsonb_typeof(v_itens) is distinct from 'array' then v_itens := null; end if;
  if v_itens is null and not v_corr and public._exige_itens(o.empresa, v_data) then
    raise exception 'Informe os itens do contrato executados neste atendimento (serviços e peças, com a quantidade).'; end if;
  update public.os set atendida_em = v_data, justificativa = v_just, pendencias = v_pend, pdf_nome = v_pdf, pdf_caminho = v_cam,
         status = 'Atendida', standby_motivo = null, standby_por = null,
         atendido_por = case when v_corr then atendido_por else a.user_id end, atendido_nome = case when v_corr then atendido_nome else coalesce(a.nome, a.email) end
   where id = p_id;
  if v_itens is not null then v_ntxt := public._os_itens_gravar(p_id, v_itens, a); end if;
  if v_corr then
    perform public._evento(p_id, 'corrigiu atendimento', 'Motivo: ' || v_mot || '. Antes: data ' || coalesce(public._dm(o.atendida_em), 'vazia')
      || case when o.pdf_nome is distinct from v_pdf then ', PDF ' || coalesce(o.pdf_nome, 'nenhum') else '' end
      || case when o.pendencias is distinct from v_pend then ', pendências "' || coalesce(o.pendencias, '') || '"' else '' end
      || '. Depois: data ' || public._dm(v_data) || case when o.pdf_nome is distinct from v_pdf then ', PDF ' || coalesce(v_pdf, 'nenhum') else '' end
      || case when o.pendencias is distinct from v_pend then ', pendências "' || coalesce(v_pend, '') || '"' else '' end || coalesce('. Itens: ' || v_ntxt, ''));
  else
    perform public._evento(p_id, 'registrou atendimento', 'Data ' || public._dm(v_data) || '. PDF: ' || coalesce(v_pdf, 'não anexado (não exigido para esta O.S.)') || coalesce('. Pendências: ' || v_pend, '') || coalesce('. Itens: ' || v_ntxt, ''));
  end if;
end $$;

-- itens de uma O.S. já atendida: a empresa (antes da conferência) ou a GMAP
create or replace function public.os_itens_salvar(p_id bigint, p_itens jsonb, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os; v_txt text; v_mot text := nullif(trim(coalesce(p_motivo, '')), ''); v_tinha boolean;
begin
  select * into o from public.os where id = p_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  if not (a.perfil = 'gmap' or (a.perfil = 'empresa' and a.empresa = o.empresa)) then raise exception 'Somente a empresa responsável ou a gerência informam os itens.'; end if;
  if o.status <> 'Atendida' then raise exception 'Os itens são informados em O.S. atendida.'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Lista de itens inválida.'; end if;
  v_tinha := exists (select 1 from public.os_itens where os_id = p_id);
  if v_tinha and length(coalesce(v_mot, '')) < 10 then raise exception 'Informe o motivo da alteração dos itens (mínimo de 10 caracteres).'; end if;
  if jsonb_array_length(p_itens) = 0 and public._exige_itens(o.empresa, o.atendida_em) then raise exception 'Este atendimento exige ao menos um item do contrato.'; end if;
  v_txt := public._os_itens_gravar(p_id, p_itens, a);
  perform public._evento(p_id, case when v_tinha then 'corrigiu itens' else 'informou itens' end,
    v_txt || coalesce('. Motivo: ' || v_mot, '') || case when a.perfil = 'gmap' then ' (pela GMAP)' else '' end);
end $$;
revoke all on function public.os_itens_salvar(bigint, jsonb, text) from public, anon;
grant execute on function public.os_itens_salvar(bigint, jsonb, text) to authenticated;

drop function if exists public.os_conferir(bigint[], text, text[], text);
create or replace function public.os_conferir(p_ids bigint[], p_situacao text, p_motivos text[] default '{}', p_obs text default null, p_itens jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_itxt text; v_obs text := nullif(trim(coalesce(p_obs, '')), ''); v_id bigint; o public.os; n int := 0;
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
    v_itxt := public._os_itens_conferir(o, p_situacao, case when cardinality(p_ids) = 1 then p_itens end, a);
    insert into public.os_conferencias (os_id, situacao, motivos, obs, quem, quem_nome, perfil, funcao)
    values (v_id, p_situacao, v_mot, v_obs, a.user_id, coalesce(a.nome, a.email), a.perfil, a.funcao);
    perform public._evento(v_id, 'conferiu', rot || case when cardinality(v_mot) > 0 then ': ' || array_to_string(v_mot, '; ') else '' end
                                              || coalesce(case when cardinality(v_mot) > 0 then '. Obs.: ' else ': ' end || v_obs, '') || coalesce('. Itens: ' || v_itxt, ''), true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.os_conferir(bigint[], text, text[], text, jsonb) from public, anon;
grant execute on function public.os_conferir(bigint[], text, text[], text, jsonb) to authenticated;

-- empresa sem contrato: processo PACTUE, nota de empenho e valor
create or replace function public.os_pagamento_avulso(p_id bigint, p_processo text, p_empenho text, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); o public.os;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência registra o pagamento por empenho.'; end if;
  select * into o from public.os where id = p_id for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  if exists (select 1 from public.contratos where empresa = o.empresa and ativo) then raise exception 'Esta empresa tem contrato: o pagamento segue a medição dos itens.'; end if;
  if p_valor is not null and p_valor <= 0 then raise exception 'O valor deve ser maior que zero.'; end if;
  update public.os set avulso_processo = nullif(trim(coalesce(p_processo, '')), ''), avulso_empenho = nullif(trim(coalesce(p_empenho, '')), ''), avulso_valor = p_valor where id = p_id;
  perform public._evento(p_id, 'registrou pagamento por empenho', 'Processo ' || coalesce(nullif(trim(p_processo), ''), '-') || ', empenho ' || coalesce(nullif(trim(p_empenho), ''), '-')
    || ', valor ' || coalesce(to_char(p_valor, 'FM999G999G990D00'), '-'), true);
end $$;
revoke all on function public.os_pagamento_avulso(bigint, text, text, numeric) from public, anon;
grant execute on function public.os_pagamento_avulso(bigint, text, text, numeric) to authenticated;

-- atendimento desfeito: os itens declarados deixam de valer (a empresa informa de novo ao registrar)
create or replace function public._os_itens_limpar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'Atendida' and new.status is distinct from 'Atendida' then delete from public.os_itens where os_id = new.id; end if;
  return new;
end $$;
drop trigger if exists os_itens_limpar on public.os;
create trigger os_itens_limpar after update of status on public.os for each row execute function public._os_itens_limpar();
revoke all on function public._os_itens_limpar() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Cadastro (gerência e fiscais da empresa), tudo com histórico
-- ---------------------------------------------------------------------
create or replace function public.contrato_salvar(p_id bigint, p_empresa text, p_numero text, p_processo text, p_documento text, p_ativo boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare a public.perfis; c public.contratos; v_id bigint;
begin
  if p_id is not null then select * into c from public.contratos where id = p_id; if c.id is null then raise exception 'Contrato não encontrado.'; end if; p_empresa := c.empresa; end if;
  a := public._pode_cadastrar(p_empresa);
  if not exists (select 1 from public.empresas where nome = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  if length(trim(coalesce(p_numero, ''))) < 3 then raise exception 'Informe o número do contrato.'; end if;
  if p_id is null then
    insert into public.contratos (empresa, numero, processo_sei, documento_sei, ativo) values (p_empresa, trim(p_numero), nullif(trim(p_processo), ''), nullif(trim(p_documento), ''), coalesce(p_ativo, true)) returning id into v_id;
    perform public._clog(p_empresa, a, 'Cadastrou o contrato ' || trim(p_numero));
  else
    update public.contratos set numero = trim(p_numero), processo_sei = nullif(trim(p_processo), ''), documento_sei = nullif(trim(p_documento), ''), ativo = coalesce(p_ativo, true) where id = p_id;
    perform public._clog(p_empresa, a, 'Alterou o contrato ' || c.numero || ': nº ' || trim(p_numero) || ', processo ' || coalesce(nullif(trim(p_processo), ''), '-')
      || case when c.ativo is distinct from coalesce(p_ativo, true) then case when p_ativo then ', reativado' else ', desativado' end else '' end);
    v_id := p_id;
  end if;
  return v_id;
end $$;

-- novo período (prorrogação) copia o quantitativo do período anterior, com consumo zerado
create or replace function public.periodo_salvar(p_id bigint, p_contrato bigint, p_inicio date, p_fim date, p_instrumento text, p_documento text)
returns bigint language plpgsql security definer set search_path = public as $$
declare a public.perfis; c public.contratos; p public.contrato_periodos; v_id bigint; v_ant bigint;
begin
  if p_id is not null then select * into p from public.contrato_periodos where id = p_id; if p.id is null then raise exception 'Período não encontrado.'; end if; p_contrato := p.contrato_id; end if;
  select * into c from public.contratos where id = p_contrato; if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  a := public._pode_cadastrar(c.empresa);
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Informe o início e o fim do período (o fim não pode ser antes do início).'; end if;
  if length(trim(coalesce(p_instrumento, ''))) < 3 then raise exception 'Informe o instrumento (ex.: Contrato, 3º Termo Aditivo).'; end if;
  if exists (select 1 from public.contrato_periodos where contrato_id = p_contrato and id is distinct from p_id and daterange(inicio, fim, '[]') && daterange(p_inicio, p_fim, '[]')) then
    raise exception 'O período se sobrepõe a outro período deste contrato.'; end if;
  if p_id is null then
    select id into v_ant from public.contrato_periodos where contrato_id = p_contrato and inicio < p_inicio order by inicio desc limit 1;
    insert into public.contrato_periodos (contrato_id, inicio, fim, instrumento, documento_sei) values (p_contrato, p_inicio, p_fim, trim(p_instrumento), nullif(trim(p_documento), '')) returning id into v_id;
    if v_ant is not null then
      insert into public.item_quantidades (item_id, periodo_id, quantidade) select item_id, v_id, quantidade from public.item_quantidades where periodo_id = v_ant;
    end if;
    perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ': novo período ' || public._dm(p_inicio) || ' a ' || public._dm(p_fim) || ' (' || trim(p_instrumento) || ')'
      || case when v_ant is not null then ', quantitativo copiado do período anterior' else '' end);
  else
    update public.contrato_periodos set inicio = p_inicio, fim = p_fim, instrumento = trim(p_instrumento), documento_sei = nullif(trim(p_documento), '') where id = p_id;
    perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ': período ' || public._dm(p.inicio) || ' a ' || public._dm(p.fim) || ' passou a ' || public._dm(p_inicio) || ' a ' || public._dm(p_fim) || ' (' || trim(p_instrumento) || ')');
    v_id := p_id;
  end if;
  return v_id;
end $$;

create or replace function public.item_salvar(p_id bigint, p_contrato bigint, p_grupo text, p_item int, p_tipo text, p_faixa text, p_unidade text, p_ativo boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare a public.perfis; c public.contratos; i public.contrato_itens; v_id bigint;
begin
  if p_id is not null then select * into i from public.contrato_itens where id = p_id; if i.id is null then raise exception 'Item não encontrado.'; end if; p_contrato := i.contrato_id; end if;
  select * into c from public.contratos where id = p_contrato; if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  a := public._pode_cadastrar(c.empresa);
  if p_grupo not in ('Serviço','Peça') then raise exception 'Escolha Serviço ou Peça.'; end if;
  if p_item is null or p_item < 1 then raise exception 'Informe o número do item no contrato.'; end if;
  if length(trim(coalesce(p_tipo, ''))) < 2 or length(trim(coalesce(p_faixa, ''))) < 2 then raise exception 'Informe o tipo e a faixa (BTU).'; end if;
  if exists (select 1 from public.contrato_itens where contrato_id = p_contrato and grupo = p_grupo and item = p_item and id is distinct from p_id) then
    raise exception 'Já existe o item % nos itens de %.', p_item, lower(p_grupo); end if;
  if p_id is null then
    insert into public.contrato_itens (contrato_id, grupo, item, tipo, faixa, unidade, ativo) values (p_contrato, p_grupo, p_item, trim(p_tipo), trim(p_faixa), coalesce(nullif(trim(p_unidade), ''), 'Unidade'), coalesce(p_ativo, true)) returning id into v_id;
    perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ': novo item ' || p_grupo || ' ' || p_item || ' (' || trim(p_tipo) || ', ' || trim(p_faixa) || ')');
  else
    update public.contrato_itens set grupo = p_grupo, item = p_item, tipo = trim(p_tipo), faixa = trim(p_faixa), unidade = coalesce(nullif(trim(p_unidade), ''), 'Unidade'), ativo = coalesce(p_ativo, true) where id = p_id;
    perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ': item ' || i.grupo || ' ' || i.item || ' (' || i.tipo || ', ' || i.faixa || ') passou a ' || p_grupo || ' ' || p_item || ' (' || trim(p_tipo) || ', ' || trim(p_faixa) || ')'
      || case when i.ativo is distinct from coalesce(p_ativo, true) then case when p_ativo then ', reativado' else ', desativado' end else '' end);
    v_id := p_id;
  end if;
  return v_id;
end $$;

-- preço: cada versão vale a partir de uma data, com o documento (contrato, apostilamento de reajuste)
create or replace function public.preco_salvar(p_item bigint, p_desde date, p_valor numeric, p_documento text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis; c public.contratos; i public.contrato_itens; v_ant numeric;
begin
  select * into i from public.contrato_itens where id = p_item; if i.id is null then raise exception 'Item não encontrado.'; end if;
  select * into c from public.contratos where id = i.contrato_id; a := public._pode_cadastrar(c.empresa);
  if p_desde is null then raise exception 'Informe a partir de quando o preço vale.'; end if;
  if p_valor is null or p_valor <= 0 or round(p_valor, 2) <> p_valor then raise exception 'Informe o valor unitário (maior que zero, até 2 casas decimais).'; end if;
  if length(trim(coalesce(p_documento, ''))) < 3 then raise exception 'Informe o documento que fixa o preço (ex.: SEI do contrato ou do apostilamento).'; end if;
  select valor into v_ant from public.item_precos where item_id = p_item and desde = p_desde;
  insert into public.item_precos (item_id, desde, valor, documento_sei) values (p_item, p_desde, p_valor, trim(p_documento))
    on conflict (item_id, desde) do update set valor = excluded.valor, documento_sei = excluded.documento_sei;
  perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ': preço de ' || i.grupo || ' ' || i.item || ' (' || i.tipo || ', ' || i.faixa || ') a partir de ' || public._dm(p_desde) || ': '
    || coalesce(to_char(v_ant, 'FM999G999G990D00') || ' → ', '') || to_char(p_valor, 'FM999G999G990D00') || ' (' || trim(p_documento) || ')');
end $$;

create or replace function public.quantidade_salvar(p_item bigint, p_periodo bigint, p_quantidade int, p_consumo int, p_consumo_doc text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis; c public.contratos; i public.contrato_itens; p public.contrato_periodos; q public.item_quantidades; v_doc text := nullif(trim(coalesce(p_consumo_doc, '')), '');
begin
  select * into i from public.contrato_itens where id = p_item; if i.id is null then raise exception 'Item não encontrado.'; end if;
  select * into p from public.contrato_periodos where id = p_periodo;
  if p.id is null or p.contrato_id <> i.contrato_id then raise exception 'Período não encontrado neste contrato.'; end if;
  select * into c from public.contratos where id = i.contrato_id; a := public._pode_cadastrar(c.empresa);
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Informe a quantidade contratada no período.'; end if;
  if p_consumo is not null and p_consumo < 0 then raise exception 'O consumo anterior não pode ser negativo.'; end if;
  if p_consumo is not null and length(coalesce(v_doc, '')) < 3 then raise exception 'Informe o documento SEI de onde saiu o consumo anterior (ex.: processo de pagamento).'; end if;
  select * into q from public.item_quantidades where item_id = p_item and periodo_id = p_periodo;
  insert into public.item_quantidades (item_id, periodo_id, quantidade, consumo_anterior, consumo_doc, consumo_informado)
    values (p_item, p_periodo, p_quantidade, coalesce(p_consumo, 0), v_doc, p_consumo is not null)
    on conflict (item_id, periodo_id) do update set quantidade = excluded.quantidade,
      consumo_anterior = case when p_consumo is null then item_quantidades.consumo_anterior else excluded.consumo_anterior end,
      consumo_doc = case when p_consumo is null then item_quantidades.consumo_doc else excluded.consumo_doc end,
      consumo_informado = item_quantidades.consumo_informado or p_consumo is not null;
  perform public._clog(c.empresa, a, 'Contrato ' || c.numero || ', período ' || public._dm(p.inicio) || ' a ' || public._dm(p.fim) || ': ' || i.grupo || ' ' || i.item || ' (' || i.tipo || ', ' || i.faixa || ')'
    || case when q.quantidade is distinct from p_quantidade then ', quantidade ' || coalesce(q.quantidade::text || ' → ', '') || p_quantidade else '' end
    || case when p_consumo is not null and (q.consumo_anterior is distinct from p_consumo or q.consumo_doc is distinct from v_doc or not coalesce(q.consumo_informado, false))
            then ', consumo anterior ' || coalesce(case when q.consumo_informado then q.consumo_anterior::text || ' → ' end, '') || p_consumo || ' (' || v_doc || ')' else '' end);
end $$;

create or replace function public.medicao_config_salvar(p_desde date)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_ant date;
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência altera as configurações.'; end if;
  if p_desde is null then raise exception 'Informe a data a partir da qual os itens são exigidos.'; end if;
  select medicao_desde into v_ant from public.sistema_config limit 1 for update;
  if v_ant = p_desde then return; end if;
  update public.sistema_config set medicao_desde = p_desde;
  insert into public.config_log (quem, quem_nome, detalhe) values (a.user_id, coalesce(a.nome, a.email), 'Itens do contrato exigidos a partir de ' || public._dm(v_ant) || ' → ' || public._dm(p_desde));
end $$;

do $$ declare f text; begin
  foreach f in array array['contrato_salvar(bigint, text, text, text, text, boolean)', 'periodo_salvar(bigint, bigint, date, date, text, text)',
    'item_salvar(bigint, bigint, text, int, text, text, text, boolean)', 'preco_salvar(bigint, date, numeric, text)',
    'quantidade_salvar(bigint, bigint, int, int, text)', 'medicao_config_salvar(date)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Última movimentação de cada O.S. (para achar rápido o que acabou de mudar)
--    Vem do último evento público do histórico (a empresa não vê eventos internos).
-- ---------------------------------------------------------------------
alter table public.os add column if not exists movimentada_em timestamptz;
alter table public.os add column if not exists movimentacao text;
alter table public.os add column if not exists movimentada_por text;
create index if not exists os_movimentada_idx on public.os (movimentada_em desc);
create or replace function public._os_movimento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.interno then
    update public.os set movimentada_em = new.quando, movimentacao = new.acao, movimentada_por = new.quem_nome
     where id = new.os_id and (movimentada_em is null or movimentada_em <= new.quando);
  end if;
  return new;
end $$;
drop trigger if exists os_eventos_movimento on public.os_eventos;
create trigger os_eventos_movimento after insert on public.os_eventos for each row execute function public._os_movimento();
revoke all on function public._os_movimento() from public, anon, authenticated;
update public.os o set movimentada_em = e.quando, movimentacao = e.acao, movimentada_por = e.quem_nome
  from (select distinct on (os_id) os_id, quando, acao, quem_nome from public.os_eventos where not interno order by os_id, quando desc, id desc) e
 where e.os_id = o.id and o.movimentada_em is distinct from e.quando;

-- ---------------------------------------------------------------------
-- 7. Carga inicial (só se ainda não houver contrato cadastrado para a empresa)
--    Classe A: Contrato 119/2024, período do 3º Termo Aditivo, quantidades do 1º TA.
--    Concretizar: Contrato 012/2026, sem aditivos (confirmar o fim da vigência).
-- ---------------------------------------------------------------------
do $$
declare v_ct bigint; v_per bigint; r record;
begin
  if exists (select 1 from public.empresas where nome = 'CLASSE A') and not exists (select 1 from public.contratos where empresa = 'CLASSE A') then
    insert into public.contratos (empresa, numero, processo_sei, documento_sei) values ('CLASSE A', '119/2024', '00011.030743/2024-61', '013896398');
  end if;
  if exists (select 1 from public.empresas where nome = 'CONCRETIZAR') and not exists (select 1 from public.contratos where empresa = 'CONCRETIZAR') then
    insert into public.contratos (empresa, numero, processo_sei, documento_sei) values ('CONCRETIZAR', '012/2026', '00011.054631/2025-86', '0022579616');
  end if;
  for r in select * from (values ('CLASSE A', '119/2024', date '2026-08-13', date '2027-08-13', '3º Termo Aditivo (prorrogação)', '0025789942', date '2024-08-13', 'Contrato 119/2024, SEI 013896398'),
                                 ('CONCRETIZAR', '012/2026', date '2026-02-25', date '2027-02-25', 'Contrato', '0022579616', date '2026-02-25', 'Contrato 012/2026, SEI 0022579616')) t(emp, num, ini, fim, instr, doc, desde, docp) loop
    select id into v_ct from public.contratos where empresa = r.emp and numero = r.num;
    if v_ct is null or exists (select 1 from public.contrato_periodos where contrato_id = v_ct) then continue; end if;
    insert into public.contrato_periodos (contrato_id, inicio, fim, instrumento, documento_sei) values (v_ct, r.ini, r.fim, r.instr, r.doc) returning id into v_per;
    insert into public.contrato_itens (contrato_id, grupo, item, tipo, faixa, unidade)
      select v_ct, x.grupo, x.item, x.tipo, x.faixa, x.unidade from (values
    ('CLASSE A','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.00,213),
    ('CLASSE A','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.00,1185),
    ('CLASSE A','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.00,153),
    ('CLASSE A','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.93,142),
    ('CLASSE A','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.00,790),
    ('CLASSE A','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.00,102),
    ('CLASSE A','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.50,213),
    ('CLASSE A','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.25,1185),
    ('CLASSE A','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.50,153),
    ('CLASSE A','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.00,213),
    ('CLASSE A','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.00,1185),
    ('CLASSE A','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.50,153),
    ('CLASSE A','Peça',10,'Gás','12.000 a 18.000','Unidade',157.50,142),
    ('CLASSE A','Peça',11,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.70,142),
    ('CLASSE A','Peça',12,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.60,142),
    ('CLASSE A','Peça',13,'Motor do ventilador','12.000 a 18.000','Unidade',224.00,142),
    ('CLASSE A','Peça',14,'Controle remoto','12.000 a 18.000','Unidade',100.80,142),
    ('CLASSE A','Peça',15,'Turbina','12.000 a 18.000','Unidade',217.00,142),
    ('CLASSE A','Peça',16,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.40,142),
    ('CLASSE A','Peça',17,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.00,142),
    ('CLASSE A','Peça',18,'Compressor','12.000 a 18.000','Unidade',952.00,142),
    ('CLASSE A','Peça',19,'Gás','22.000 a 30.000','Unidade',196.00,790),
    ('CLASSE A','Peça',20,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.50,790),
    ('CLASSE A','Peça',21,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.30,790),
    ('CLASSE A','Peça',22,'Motor do ventilador','22.000 a 30.000','Unidade',441.00,790),
    ('CLASSE A','Peça',23,'Controle remoto','22.000 a 30.000','Unidade',100.80,790),
    ('CLASSE A','Peça',24,'Turbina','22.000 a 30.000','Unidade',340.20,790),
    ('CLASSE A','Peça',25,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.00,790),
    ('CLASSE A','Peça',26,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.00,790),
    ('CLASSE A','Peça',27,'Compressor','22.000 a 30.000','Unidade',1218.00,790),
    ('CLASSE A','Peça',28,'Gás','36.000 a 60.000','Unidade',266.00,102),
    ('CLASSE A','Peça',29,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,102),
    ('CLASSE A','Peça',30,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,102),
    ('CLASSE A','Peça',31,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,102),
    ('CLASSE A','Peça',32,'Controle remoto','36.000 a 60.000','Unidade',105.00,102),
    ('CLASSE A','Peça',33,'Turbina','36.000 a 60.000','Unidade',455.00,102),
    ('CLASSE A','Peça',34,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.00,102),
    ('CLASSE A','Peça',35,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.00,102),
    ('CLASSE A','Peça',36,'Compressor','36.000 a 60.000','Unidade',3376.90,102),
    ('CONCRETIZAR','Serviço',1,'Instalação','9.000','Serviço',469.07,334),
    ('CONCRETIZAR','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.07,635),
    ('CONCRETIZAR','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.09,578),
    ('CONCRETIZAR','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.14,106),
    ('CONCRETIZAR','Serviço',5,'Desinstalação','9.000','Serviço',213.96,212),
    ('CONCRETIZAR','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.96,432),
    ('CONCRETIZAR','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.06,241),
    ('CONCRETIZAR','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.09,85),
    ('CONCRETIZAR','Serviço',9,'Manutenção preventiva','9.000','Serviço',325.55,612),
    ('CONCRETIZAR','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.55,1619),
    ('CONCRETIZAR','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.31,872),
    ('CONCRETIZAR','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.58,185),
    ('CONCRETIZAR','Serviço',13,'Manutenção corretiva','9.000','Serviço',595.09,349),
    ('CONCRETIZAR','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.09,569),
    ('CONCRETIZAR','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.10,331),
    ('CONCRETIZAR','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.64,128),
    ('CONCRETIZAR','Peça',10,'Gás','9.000','Unidade',126.02,35),
    ('CONCRETIZAR','Peça',11,'Placa eletrônica principal','9.000','Unidade',280.04,35),
    ('CONCRETIZAR','Peça',12,'Placa eletrônica receptora','9.000','Unidade',107.12,35),
    ('CONCRETIZAR','Peça',13,'Motor do ventilador','9.000','Unidade',199.53,35),
    ('CONCRETIZAR','Peça',14,'Controle remoto','9.000','Unidade',88.21,35),
    ('CONCRETIZAR','Peça',15,'Turbina','9.000','Unidade',136.52,35),
    ('CONCRETIZAR','Peça',16,'Serpentina para unidade condensadora','9.000','Unidade',770.11,35),
    ('CONCRETIZAR','Peça',17,'Serpentina para unidade evaporadora','9.000','Unidade',604.89,35),
    ('CONCRETIZAR','Peça',18,'Compressor','9.000','Unidade',686.80,35),
    ('CONCRETIZAR','Peça',19,'Gás','12.000 a 18.000','Unidade',157.52,57),
    ('CONCRETIZAR','Peça',20,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.75,57),
    ('CONCRETIZAR','Peça',21,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.62,57),
    ('CONCRETIZAR','Peça',22,'Motor do ventilador','12.000 a 18.000','Unidade',224.03,57),
    ('CONCRETIZAR','Peça',23,'Controle remoto','12.000 a 18.000','Unidade',100.81,57),
    ('CONCRETIZAR','Peça',24,'Turbina','12.000 a 18.000','Unidade',217.03,57),
    ('CONCRETIZAR','Peça',25,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.53,57),
    ('CONCRETIZAR','Peça',26,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.13,57),
    ('CONCRETIZAR','Peça',27,'Compressor','12.000 a 18.000','Unidade',952.14,57),
    ('CONCRETIZAR','Peça',28,'Gás','22.000 a 30.000','Unidade',196.03,33),
    ('CONCRETIZAR','Peça',29,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.57,33),
    ('CONCRETIZAR','Peça',30,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.24,33),
    ('CONCRETIZAR','Peça',31,'Motor do ventilador','22.000 a 30.000','Unidade',441.06,33),
    ('CONCRETIZAR','Peça',32,'Controle remoto','22.000 a 30.000','Unidade',100.81,33),
    ('CONCRETIZAR','Peça',33,'Turbina','22.000 a 30.000','Unidade',340.25,33),
    ('CONCRETIZAR','Peça',34,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.20,33),
    ('CONCRETIZAR','Peça',35,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.18,33),
    ('CONCRETIZAR','Peça',36,'Compressor','22.000 a 30.000','Unidade',1218.00,33),
    ('CONCRETIZAR','Peça',37,'Gás','36.000 a 60.000','Unidade',266.00,13),
    ('CONCRETIZAR','Peça',38,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,13),
    ('CONCRETIZAR','Peça',39,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,13),
    ('CONCRETIZAR','Peça',40,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,13),
    ('CONCRETIZAR','Peça',41,'Controle remoto','36.000 a 60.000','Unidade',105.00,13),
    ('CONCRETIZAR','Peça',42,'Turbina','36.000 a 60.000','Unidade',455.00,13),
    ('CONCRETIZAR','Peça',43,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.21,13),
    ('CONCRETIZAR','Peça',44,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.50,13),
    ('CONCRETIZAR','Peça',45,'Compressor','36.000 a 60.000','Unidade',3377.28,13)
      ) x(emp, grupo, item, tipo, faixa, unidade, valor, qtd) where x.emp = r.emp;
    insert into public.item_precos (item_id, desde, valor, documento_sei)
      select i.id, r.desde, x.valor, r.docp from public.contrato_itens i join (values
    ('CLASSE A','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.00,213),
    ('CLASSE A','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.00,1185),
    ('CLASSE A','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.00,153),
    ('CLASSE A','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.93,142),
    ('CLASSE A','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.00,790),
    ('CLASSE A','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.00,102),
    ('CLASSE A','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.50,213),
    ('CLASSE A','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.25,1185),
    ('CLASSE A','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.50,153),
    ('CLASSE A','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.00,213),
    ('CLASSE A','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.00,1185),
    ('CLASSE A','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.50,153),
    ('CLASSE A','Peça',10,'Gás','12.000 a 18.000','Unidade',157.50,142),
    ('CLASSE A','Peça',11,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.70,142),
    ('CLASSE A','Peça',12,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.60,142),
    ('CLASSE A','Peça',13,'Motor do ventilador','12.000 a 18.000','Unidade',224.00,142),
    ('CLASSE A','Peça',14,'Controle remoto','12.000 a 18.000','Unidade',100.80,142),
    ('CLASSE A','Peça',15,'Turbina','12.000 a 18.000','Unidade',217.00,142),
    ('CLASSE A','Peça',16,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.40,142),
    ('CLASSE A','Peça',17,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.00,142),
    ('CLASSE A','Peça',18,'Compressor','12.000 a 18.000','Unidade',952.00,142),
    ('CLASSE A','Peça',19,'Gás','22.000 a 30.000','Unidade',196.00,790),
    ('CLASSE A','Peça',20,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.50,790),
    ('CLASSE A','Peça',21,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.30,790),
    ('CLASSE A','Peça',22,'Motor do ventilador','22.000 a 30.000','Unidade',441.00,790),
    ('CLASSE A','Peça',23,'Controle remoto','22.000 a 30.000','Unidade',100.80,790),
    ('CLASSE A','Peça',24,'Turbina','22.000 a 30.000','Unidade',340.20,790),
    ('CLASSE A','Peça',25,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.00,790),
    ('CLASSE A','Peça',26,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.00,790),
    ('CLASSE A','Peça',27,'Compressor','22.000 a 30.000','Unidade',1218.00,790),
    ('CLASSE A','Peça',28,'Gás','36.000 a 60.000','Unidade',266.00,102),
    ('CLASSE A','Peça',29,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,102),
    ('CLASSE A','Peça',30,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,102),
    ('CLASSE A','Peça',31,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,102),
    ('CLASSE A','Peça',32,'Controle remoto','36.000 a 60.000','Unidade',105.00,102),
    ('CLASSE A','Peça',33,'Turbina','36.000 a 60.000','Unidade',455.00,102),
    ('CLASSE A','Peça',34,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.00,102),
    ('CLASSE A','Peça',35,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.00,102),
    ('CLASSE A','Peça',36,'Compressor','36.000 a 60.000','Unidade',3376.90,102),
    ('CONCRETIZAR','Serviço',1,'Instalação','9.000','Serviço',469.07,334),
    ('CONCRETIZAR','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.07,635),
    ('CONCRETIZAR','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.09,578),
    ('CONCRETIZAR','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.14,106),
    ('CONCRETIZAR','Serviço',5,'Desinstalação','9.000','Serviço',213.96,212),
    ('CONCRETIZAR','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.96,432),
    ('CONCRETIZAR','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.06,241),
    ('CONCRETIZAR','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.09,85),
    ('CONCRETIZAR','Serviço',9,'Manutenção preventiva','9.000','Serviço',325.55,612),
    ('CONCRETIZAR','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.55,1619),
    ('CONCRETIZAR','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.31,872),
    ('CONCRETIZAR','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.58,185),
    ('CONCRETIZAR','Serviço',13,'Manutenção corretiva','9.000','Serviço',595.09,349),
    ('CONCRETIZAR','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.09,569),
    ('CONCRETIZAR','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.10,331),
    ('CONCRETIZAR','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.64,128),
    ('CONCRETIZAR','Peça',10,'Gás','9.000','Unidade',126.02,35),
    ('CONCRETIZAR','Peça',11,'Placa eletrônica principal','9.000','Unidade',280.04,35),
    ('CONCRETIZAR','Peça',12,'Placa eletrônica receptora','9.000','Unidade',107.12,35),
    ('CONCRETIZAR','Peça',13,'Motor do ventilador','9.000','Unidade',199.53,35),
    ('CONCRETIZAR','Peça',14,'Controle remoto','9.000','Unidade',88.21,35),
    ('CONCRETIZAR','Peça',15,'Turbina','9.000','Unidade',136.52,35),
    ('CONCRETIZAR','Peça',16,'Serpentina para unidade condensadora','9.000','Unidade',770.11,35),
    ('CONCRETIZAR','Peça',17,'Serpentina para unidade evaporadora','9.000','Unidade',604.89,35),
    ('CONCRETIZAR','Peça',18,'Compressor','9.000','Unidade',686.80,35),
    ('CONCRETIZAR','Peça',19,'Gás','12.000 a 18.000','Unidade',157.52,57),
    ('CONCRETIZAR','Peça',20,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.75,57),
    ('CONCRETIZAR','Peça',21,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.62,57),
    ('CONCRETIZAR','Peça',22,'Motor do ventilador','12.000 a 18.000','Unidade',224.03,57),
    ('CONCRETIZAR','Peça',23,'Controle remoto','12.000 a 18.000','Unidade',100.81,57),
    ('CONCRETIZAR','Peça',24,'Turbina','12.000 a 18.000','Unidade',217.03,57),
    ('CONCRETIZAR','Peça',25,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.53,57),
    ('CONCRETIZAR','Peça',26,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.13,57),
    ('CONCRETIZAR','Peça',27,'Compressor','12.000 a 18.000','Unidade',952.14,57),
    ('CONCRETIZAR','Peça',28,'Gás','22.000 a 30.000','Unidade',196.03,33),
    ('CONCRETIZAR','Peça',29,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.57,33),
    ('CONCRETIZAR','Peça',30,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.24,33),
    ('CONCRETIZAR','Peça',31,'Motor do ventilador','22.000 a 30.000','Unidade',441.06,33),
    ('CONCRETIZAR','Peça',32,'Controle remoto','22.000 a 30.000','Unidade',100.81,33),
    ('CONCRETIZAR','Peça',33,'Turbina','22.000 a 30.000','Unidade',340.25,33),
    ('CONCRETIZAR','Peça',34,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.20,33),
    ('CONCRETIZAR','Peça',35,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.18,33),
    ('CONCRETIZAR','Peça',36,'Compressor','22.000 a 30.000','Unidade',1218.00,33),
    ('CONCRETIZAR','Peça',37,'Gás','36.000 a 60.000','Unidade',266.00,13),
    ('CONCRETIZAR','Peça',38,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,13),
    ('CONCRETIZAR','Peça',39,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,13),
    ('CONCRETIZAR','Peça',40,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,13),
    ('CONCRETIZAR','Peça',41,'Controle remoto','36.000 a 60.000','Unidade',105.00,13),
    ('CONCRETIZAR','Peça',42,'Turbina','36.000 a 60.000','Unidade',455.00,13),
    ('CONCRETIZAR','Peça',43,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.21,13),
    ('CONCRETIZAR','Peça',44,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.50,13),
    ('CONCRETIZAR','Peça',45,'Compressor','36.000 a 60.000','Unidade',3377.28,13)
      ) x(emp, grupo, item, tipo, faixa, unidade, valor, qtd) on x.emp = r.emp and x.grupo = i.grupo and x.item = i.item where i.contrato_id = v_ct;
    insert into public.item_quantidades (item_id, periodo_id, quantidade)
      select i.id, v_per, x.qtd from public.contrato_itens i join (values
    ('CLASSE A','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.00,213),
    ('CLASSE A','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.00,1185),
    ('CLASSE A','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.00,153),
    ('CLASSE A','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.93,142),
    ('CLASSE A','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.00,790),
    ('CLASSE A','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.00,102),
    ('CLASSE A','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.50,213),
    ('CLASSE A','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.25,1185),
    ('CLASSE A','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.50,153),
    ('CLASSE A','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.00,213),
    ('CLASSE A','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.00,1185),
    ('CLASSE A','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.50,153),
    ('CLASSE A','Peça',10,'Gás','12.000 a 18.000','Unidade',157.50,142),
    ('CLASSE A','Peça',11,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.70,142),
    ('CLASSE A','Peça',12,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.60,142),
    ('CLASSE A','Peça',13,'Motor do ventilador','12.000 a 18.000','Unidade',224.00,142),
    ('CLASSE A','Peça',14,'Controle remoto','12.000 a 18.000','Unidade',100.80,142),
    ('CLASSE A','Peça',15,'Turbina','12.000 a 18.000','Unidade',217.00,142),
    ('CLASSE A','Peça',16,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.40,142),
    ('CLASSE A','Peça',17,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.00,142),
    ('CLASSE A','Peça',18,'Compressor','12.000 a 18.000','Unidade',952.00,142),
    ('CLASSE A','Peça',19,'Gás','22.000 a 30.000','Unidade',196.00,790),
    ('CLASSE A','Peça',20,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.50,790),
    ('CLASSE A','Peça',21,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.30,790),
    ('CLASSE A','Peça',22,'Motor do ventilador','22.000 a 30.000','Unidade',441.00,790),
    ('CLASSE A','Peça',23,'Controle remoto','22.000 a 30.000','Unidade',100.80,790),
    ('CLASSE A','Peça',24,'Turbina','22.000 a 30.000','Unidade',340.20,790),
    ('CLASSE A','Peça',25,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.00,790),
    ('CLASSE A','Peça',26,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.00,790),
    ('CLASSE A','Peça',27,'Compressor','22.000 a 30.000','Unidade',1218.00,790),
    ('CLASSE A','Peça',28,'Gás','36.000 a 60.000','Unidade',266.00,102),
    ('CLASSE A','Peça',29,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,102),
    ('CLASSE A','Peça',30,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,102),
    ('CLASSE A','Peça',31,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,102),
    ('CLASSE A','Peça',32,'Controle remoto','36.000 a 60.000','Unidade',105.00,102),
    ('CLASSE A','Peça',33,'Turbina','36.000 a 60.000','Unidade',455.00,102),
    ('CLASSE A','Peça',34,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.00,102),
    ('CLASSE A','Peça',35,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.00,102),
    ('CLASSE A','Peça',36,'Compressor','36.000 a 60.000','Unidade',3376.90,102),
    ('CONCRETIZAR','Serviço',1,'Instalação','9.000','Serviço',469.07,334),
    ('CONCRETIZAR','Serviço',2,'Instalação','12.000 a 18.000','Serviço',476.07,635),
    ('CONCRETIZAR','Serviço',3,'Instalação','22.000 a 30.000','Serviço',595.09,578),
    ('CONCRETIZAR','Serviço',4,'Instalação','36.000 a 60.000','Serviço',945.14,106),
    ('CONCRETIZAR','Serviço',5,'Desinstalação','9.000','Serviço',213.96,212),
    ('CONCRETIZAR','Serviço',6,'Desinstalação','12.000 a 18.000','Serviço',213.96,432),
    ('CONCRETIZAR','Serviço',7,'Desinstalação','22.000 a 30.000','Serviço',420.06,241),
    ('CONCRETIZAR','Serviço',8,'Desinstalação','36.000 a 60.000','Serviço',658.09,85),
    ('CONCRETIZAR','Serviço',9,'Manutenção preventiva','9.000','Serviço',325.55,612),
    ('CONCRETIZAR','Serviço',10,'Manutenção preventiva','12.000 a 18.000','Serviço',325.55,1619),
    ('CONCRETIZAR','Serviço',11,'Manutenção preventiva','22.000 a 30.000','Serviço',446.31,872),
    ('CONCRETIZAR','Serviço',12,'Manutenção preventiva','36.000 a 60.000','Serviço',577.58,185),
    ('CONCRETIZAR','Serviço',13,'Manutenção corretiva','9.000','Serviço',595.09,349),
    ('CONCRETIZAR','Serviço',14,'Manutenção corretiva','12.000 a 18.000','Serviço',595.09,569),
    ('CONCRETIZAR','Serviço',15,'Manutenção corretiva','22.000 a 30.000','Serviço',665.10,331),
    ('CONCRETIZAR','Serviço',16,'Manutenção corretiva','36.000 a 60.000','Serviço',997.64,128),
    ('CONCRETIZAR','Peça',10,'Gás','9.000','Unidade',126.02,35),
    ('CONCRETIZAR','Peça',11,'Placa eletrônica principal','9.000','Unidade',280.04,35),
    ('CONCRETIZAR','Peça',12,'Placa eletrônica receptora','9.000','Unidade',107.12,35),
    ('CONCRETIZAR','Peça',13,'Motor do ventilador','9.000','Unidade',199.53,35),
    ('CONCRETIZAR','Peça',14,'Controle remoto','9.000','Unidade',88.21,35),
    ('CONCRETIZAR','Peça',15,'Turbina','9.000','Unidade',136.52,35),
    ('CONCRETIZAR','Peça',16,'Serpentina para unidade condensadora','9.000','Unidade',770.11,35),
    ('CONCRETIZAR','Peça',17,'Serpentina para unidade evaporadora','9.000','Unidade',604.89,35),
    ('CONCRETIZAR','Peça',18,'Compressor','9.000','Unidade',686.80,35),
    ('CONCRETIZAR','Peça',19,'Gás','12.000 a 18.000','Unidade',157.52,57),
    ('CONCRETIZAR','Peça',20,'Placa eletrônica principal','12.000 a 18.000','Unidade',371.75,57),
    ('CONCRETIZAR','Peça',21,'Placa eletrônica receptora','12.000 a 18.000','Unidade',138.62,57),
    ('CONCRETIZAR','Peça',22,'Motor do ventilador','12.000 a 18.000','Unidade',224.03,57),
    ('CONCRETIZAR','Peça',23,'Controle remoto','12.000 a 18.000','Unidade',100.81,57),
    ('CONCRETIZAR','Peça',24,'Turbina','12.000 a 18.000','Unidade',217.03,57),
    ('CONCRETIZAR','Peça',25,'Serpentina para unidade condensadora','12.000 a 18.000','Unidade',932.53,57),
    ('CONCRETIZAR','Peça',26,'Serpentina para unidade evaporadora','12.000 a 18.000','Unidade',875.13,57),
    ('CONCRETIZAR','Peça',27,'Compressor','12.000 a 18.000','Unidade',952.14,57),
    ('CONCRETIZAR','Peça',28,'Gás','22.000 a 30.000','Unidade',196.03,33),
    ('CONCRETIZAR','Peça',29,'Placa eletrônica principal','22.000 a 30.000','Unidade',479.57,33),
    ('CONCRETIZAR','Peça',30,'Placa eletrônica receptora','22.000 a 30.000','Unidade',277.24,33),
    ('CONCRETIZAR','Peça',31,'Motor do ventilador','22.000 a 30.000','Unidade',441.06,33),
    ('CONCRETIZAR','Peça',32,'Controle remoto','22.000 a 30.000','Unidade',100.81,33),
    ('CONCRETIZAR','Peça',33,'Turbina','22.000 a 30.000','Unidade',340.25,33),
    ('CONCRETIZAR','Peça',34,'Serpentina para unidade condensadora','22.000 a 30.000','Unidade',1365.20,33),
    ('CONCRETIZAR','Peça',35,'Serpentina para unidade evaporadora','22.000 a 30.000','Unidade',1246.18,33),
    ('CONCRETIZAR','Peça',36,'Compressor','22.000 a 30.000','Unidade',1218.00,33),
    ('CONCRETIZAR','Peça',37,'Gás','36.000 a 60.000','Unidade',266.00,13),
    ('CONCRETIZAR','Peça',38,'Placa eletrônica principal','36.000 a 60.000','Unidade',619.50,13),
    ('CONCRETIZAR','Peça',39,'Placa eletrônica receptora','36.000 a 60.000','Unidade',322.00,13),
    ('CONCRETIZAR','Peça',40,'Motor do ventilador','36.000 a 60.000','Unidade',579.60,13),
    ('CONCRETIZAR','Peça',41,'Controle remoto','36.000 a 60.000','Unidade',105.00,13),
    ('CONCRETIZAR','Peça',42,'Turbina','36.000 a 60.000','Unidade',455.00,13),
    ('CONCRETIZAR','Peça',43,'Serpentina para unidade condensadora','36.000 a 60.000','Unidade',3640.21,13),
    ('CONCRETIZAR','Peça',44,'Serpentina para unidade evaporadora','36.000 a 60.000','Unidade',3500.50,13),
    ('CONCRETIZAR','Peça',45,'Compressor','36.000 a 60.000','Unidade',3377.28,13)
      ) x(emp, grupo, item, tipo, faixa, unidade, valor, qtd) on x.emp = r.emp and x.grupo = i.grupo and x.item = i.item where i.contrato_id = v_ct;
    insert into public.contratos_log (empresa, quem_nome, detalhe) values (r.emp, 'Carga inicial (migração 008)', 'Contrato ' || r.num || ' com ' || (select count(*) from public.contrato_itens where contrato_id = v_ct) || ' itens, período ' || public._dm(r.ini) || ' a ' || public._dm(r.fim));
  end loop;
end $$;
