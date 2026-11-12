# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões no padrão `MAIOR.MENOR.CORREÇÃO`.

## [Não publicado]

## [1.1.6] - 2026-11-12

### Adicionado
- Fila de O.S.: barra de seleção com o total de selecionadas, "Ver só as selecionadas", "Imprimir" e "Limpar seleção". A seleção não depende mais da pesquisa: dá para desmarcar sem digitar o texto de novo.
- Aviso "N fora desta lista" quando há O.S. selecionadas que o filtro atual esconde, para evitar imprimir um lote sem perceber.
- No celular, a barra de seleção fica fixa no rodapé da tela.

## [1.1.5] - 2026-11-12

### Adicionado
- Visão geral, "Maiores atrasos em aberto": seletor "Ver por" O.S., Escola, GRE ou Município. Nos agrupamentos, mostra O.S. vencidas, maior atraso e atraso médio; clicar abre a fila já filtrada.

## [1.1.4] - 2026-11-12

### Alterado
- Telas de login, de solicitar acesso e de aviso: logotipo e textos centralizados.

## [1.1.3] - 2026-11-11

### Alterado
- Relatório sintético (Excel e PDF): removidas as colunas "Vencidas" e "A vencer", que quebravam o layout. Colunas: Total, Em aberto, Atendidas, Canceladas e % atendidas no prazo.

## [1.1.2] - 2026-11-11

### Corrigido
- Botão "Sair" não encerrava a sessão quando o servidor de login respondia com erro; agora a sessão do navegador é sempre apagada.
- Navegadores mantinham versões antigas dos arquivos do site em cache; os arquivos agora são carregados com o número da versão (`?v=1.1.2`).

## [1.1.1] - 2026-11-11

### Corrigido
- Relatório sintético (Excel e PDF): nova coluna "Canceladas", para que Total = Em aberto + Atendidas + Canceladas em todas as linhas.
- Relatório sintético: linha "Não informada" nas tabelas por prioridade e por GRE, para que as linhas sempre somem o total.
- Relatório sintético: nota explicando que Vencidas e A vencer são parte das Em aberto.

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
