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

-- ===== Versão 2.0.0: emissão de O.S. =====

-- O.S. emitidas no sistema, por status
select status, count(*) from public.os where not legado group by 1 order by 1;

-- Solicitações aguardando aprovação, das mais antigas para as mais novas
select numero, empresa, escola, solicitado_nome, solicitado_em from public.os
where status = 'Aguardando aprovação' order by solicitado_em;

-- Histórico completo de uma O.S. (troque o número)
select e.quando at time zone 'America/Sao_Paulo' as quando, e.quem_nome, e.perfil, e.acao, e.detalhe, e.interno
from public.os_eventos e join public.os o on o.id = e.os_id where o.numero = '1541/2026' order by e.quando;

-- Avisos por e-mail que falharam ou empresas sem e-mail
select criado_em, empresa, para, assunto, situacao, tentativas, erro from public.email_fila
where situacao in ('Falhou', 'Sem e-mail cadastrado') order by id desc;

-- Última importação da base de entidades e o que mudou
select importado_em, tipo, nome, campo, antes, depois from public.entidades_mudancas order by id desc limit 50;

-- Situação da planilha (planilha_ativa = true: fase planilha; false: emissão pelo sistema)
select * from public.sistema_config;

-- VIRADA PARA O SISTEMA: rode só depois da última consolidação e sincronização
-- select public.encerrar_planilha();
