# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões no padrão `MAIOR.MENOR.CORREÇÃO`.

## [Não publicado]

## [1.1.0] - 2026-11-11

### Adicionado
- Tela "Solicitar acesso": a pessoa se cadastra e escolhe o perfil pretendido; o acesso fica pendente até a aprovação.
- Aba "Usuários" (só GMAP): aprovar, recusar, bloquear e reativar acessos, com contador de pedidos pendentes e último acesso de cada usuário.
- Registro de todas as decisões sobre acessos (`perfis_log`).
- Migração `002_cadastro_com_aprovacao.sql`.
- Aviso no registro de execução do Apps Script quando uma linha sem número de O.S. deixa de ser enviada ao painel.

### Alterado
- Situação do acesso passa a ser `pendente`, `aprovado`, `recusado` ou `bloqueado`; a coluna `ativo` agora é calculada.

## [1.0.0] - 2026-11-11

### Adicionado
- Painel com abas Visão geral, Fila de O.S. e Auditoria dos dados (só GMAP).
- Login por e-mail e senha, perfis GMAP, diretoria e empresa, com separação por empresa no banco (RLS).
- Relatórios sintético e analítico em Excel e PDF; impressão de O.S. única e em lote.
- Sincronização da aba "Consolidado" com o Supabase ao final da consolidação, só quando todas as empresas são lidas sem erro.
- Histórico de mudanças de status, registro de sincronizações e de acessos.
- Identidade visual do Governo do Piauí (assinatura da SEDUC, Montserrat e cores oficiais).

### Corrigido
- Função `sincronizar_os`: `DELETE` com cláusula `WHERE`, exigida pelo Supabase.

### Segurança
- IDs das planilhas das empresas movidos do código para a propriedade `PLANILHAS_ORIGEM` do Apps Script.
