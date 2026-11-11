-- =====================================================================
-- Cadastro de perfis de acesso
-- 1) Crie o usuário em Authentication > Users > Add user > Create new user
--    (e-mail + senha temporária, marque "Auto Confirm User").
-- 2) Rode o comando abaixo trocando e-mail, nome, perfil e empresa.
--    perfil: 'gmap' | 'diretoria' | 'empresa'
--    empresa: só para perfil 'empresa', escrito EXATAMENTE como na coluna
--             EMPRESA da planilha: 'CLASSE A', 'CONCRETIZAR', 'R.E. SOLUÇÕES', 'NATAL COMPUTER'
-- =====================================================================

-- Exemplo: usuário da GMAP
insert into public.perfis (user_id, email, nome, perfil, empresa)
select id, email, 'Felipe Cavalcante', 'gmap', null
from auth.users where email = 'email.da.pessoa@exemplo.com'
on conflict (user_id) do update set nome = excluded.nome, perfil = excluded.perfil, empresa = excluded.empresa, ativo = true;

-- Exemplo: usuário de empresa
insert into public.perfis (user_id, email, nome, perfil, empresa)
select id, email, 'Responsável Classe A', 'empresa', 'CLASSE A'
from auth.users where email = 'contato@empresa.com.br'
on conflict (user_id) do update set nome = excluded.nome, perfil = excluded.perfil, empresa = excluded.empresa, ativo = true;

-- Bloquear um usuário imediatamente (sem apagar o histórico)
-- update public.perfis set ativo = false where email = 'pessoa@exemplo.com';

-- Conferir quem tem acesso
-- select email, nome, perfil, empresa, ativo from public.perfis order by perfil, empresa, email;

-- Conferir se os nomes de empresa dos perfis batem com a planilha
-- select distinct p.empresa, exists (select 1 from public.os o where o.empresa = p.empresa) as existe_na_planilha
-- from public.perfis p where p.perfil = 'empresa';
