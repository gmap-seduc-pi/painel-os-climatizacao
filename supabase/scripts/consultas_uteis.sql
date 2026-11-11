-- Últimas sincronizações
select executada_em, registros, inseridos, removidos, status_alterados, origem
from public.sincronizacoes order by id desc limit 20;

-- Acessos dos últimos 30 dias por usuário
select p.email, p.perfil, p.empresa, count(*) as acessos, max(a.acessado_em) as ultimo
from public.acessos a join public.perfis p on p.user_id = a.user_id
where a.acessado_em > now() - interval '30 days'
group by 1,2,3 order by ultimo desc;

-- Histórico de status de uma O.S.
select registrado_em, status_anterior, status_novo
from public.os_historico where chave = '317/2025|CLASSE A' order by id;

-- O.S. que mudaram para Atendida nos últimos 7 dias
select h.registrado_em, h.chave, h.status_anterior
from public.os_historico h
where h.status_novo = 'Atendida' and h.registrado_em > now() - interval '7 days'
order by h.registrado_em desc;
