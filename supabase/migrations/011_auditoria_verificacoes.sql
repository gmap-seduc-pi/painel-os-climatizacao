-- =====================================================================
-- 011 · Auditoria dos dados: ocorrências verificadas
--
-- A gerência pode tirar da contagem uma ocorrência da Auditoria que, depois de
-- conferida, não se confirma (ex.: o atendimento posterior foi em outro ambiente).
-- Vale para: Provável backlog artificial (prov), Atendimento parcial posterior (parc),
-- Possível duplicidade em aberto (dup, por par de O.S.) e Número de O.S. repetido (rep).
--
-- Regras:
--   * só a gerência (perfil gmap) lê, marca e desfaz;
--   * o motivo é obrigatório (10 a 500 caracteres) e fica registrado com quem e quando;
--   * "assinatura" guarda as O.S. que serviram de evidência; se a evidência mudar
--     (ex.: novo atendimento na escola), o painel volta a contar a ocorrência;
--   * desfazer não apaga: marca a data e quem desfez (o histórico fica).
--
-- Só acrescenta uma tabela e duas funções. Não altera dados nem tabelas existentes.
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- =====================================================================

create table if not exists public.auditoria_verificacoes (
  id            bigserial primary key,
  verificacao   text not null check (verificacao in ('prov', 'parc', 'dup', 'rep')),
  os_id         bigint not null references public.os(id) on delete cascade,
  par_os_id     bigint references public.os(id) on delete cascade,
  assinatura    text not null,
  motivo        text not null check (char_length(motivo) between 10 and 500),
  quem          uuid,
  quem_nome     text,
  em            timestamptz not null default now(),
  desfeita_em   timestamptz,
  desfeita_por  text,
  desfeita_obs  text
);
create unique index if not exists auditoria_verificacoes_ativa
  on public.auditoria_verificacoes (verificacao, os_id, coalesce(par_os_id, 0)) where desfeita_em is null;

alter table public.auditoria_verificacoes enable row level security;
drop policy if exists auditoria_verificacoes_leitura on public.auditoria_verificacoes;
create policy auditoria_verificacoes_leitura on public.auditoria_verificacoes for select to authenticated using (public.eh_gmap());
revoke all on public.auditoria_verificacoes from anon, authenticated;
grant select on public.auditoria_verificacoes to authenticated;

-- marcar como verificada (tira da contagem)
create or replace function public.auditoria_desconsiderar(p_verificacao text, p_os bigint, p_par bigint, p_assinatura text, p_motivo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator(); v_os bigint := p_os; v_par bigint := p_par; v_ant bigint; v_id bigint; v_m text := trim(coalesce(p_motivo, ''));
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência marca ocorrências da auditoria.'; end if;
  if p_verificacao is null or p_verificacao not in ('prov', 'parc', 'dup', 'rep') then raise exception 'Esta verificação não pode ser desconsiderada.'; end if;
  if char_length(v_m) < 10 then raise exception 'Explique por que a ocorrência não se confirma (mínimo de 10 caracteres).'; end if;
  if char_length(v_m) > 500 then raise exception 'O motivo pode ter até 500 caracteres.'; end if;
  if trim(coalesce(p_assinatura, '')) = '' then raise exception 'Evidência não informada.'; end if;
  if p_verificacao = 'dup' then
    if v_par is null or v_par = v_os then raise exception 'Informe as duas O.S. do par.'; end if;
    if v_par < v_os then v_os := p_par; v_par := p_os; end if;   -- o par é guardado sempre na mesma ordem
  else
    v_par := null;
  end if;
  if not exists (select 1 from public.os where id = v_os) or (v_par is not null and not exists (select 1 from public.os where id = v_par)) then
    raise exception 'O.S. não encontrada.';
  end if;
  -- se já havia uma marcação ativa (evidência mudou e a pessoa conferiu de novo), a antiga fica no histórico
  select id into v_ant from public.auditoria_verificacoes
   where verificacao = p_verificacao and os_id = v_os and coalesce(par_os_id, 0) = coalesce(v_par, 0) and desfeita_em is null for update;
  if v_ant is not null then
    update public.auditoria_verificacoes set desfeita_em = now(), desfeita_por = coalesce(a.nome, a.email), desfeita_obs = 'Substituída por nova verificação'
     where id = v_ant;
  end if;
  insert into public.auditoria_verificacoes (verificacao, os_id, par_os_id, assinatura, motivo, quem, quem_nome)
  values (p_verificacao, v_os, v_par, trim(p_assinatura), v_m, a.user_id, coalesce(a.nome, a.email)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.auditoria_desconsiderar(text, bigint, bigint, text, text) from public, anon;
grant execute on function public.auditoria_desconsiderar(text, bigint, bigint, text, text) to authenticated;

-- voltar a contar
create or replace function public.auditoria_reconsiderar(p_id bigint, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.perfis := public._ator();
begin
  if a.perfil <> 'gmap' then raise exception 'Somente a gerência desfaz marcações da auditoria.'; end if;
  update public.auditoria_verificacoes set desfeita_em = now(), desfeita_por = coalesce(a.nome, a.email), desfeita_obs = nullif(trim(coalesce(p_obs, '')), '')
   where id = p_id and desfeita_em is null;
  if not found then raise exception 'Marcação não encontrada ou já desfeita.'; end if;
end $$;
revoke all on function public.auditoria_reconsiderar(bigint, text) from public, anon;
grant execute on function public.auditoria_reconsiderar(bigint, text) to authenticated;
