# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões no padrão `MAIOR.MENOR.CORREÇÃO`.

## [Não publicado]

## [2.0.0] - 2026-11-16

Emissão de O.S. no sistema. Requer as migrações `003_emissao_de_os.sql` e `004_fase_planilha.sql` e os scripts novos.
Começa na **fase planilha**: a planilha segue como fonte e a emissão pelo sistema fica desligada até a virada (`select public.encerrar_planilha();`).

### Adicionado
- Perfil Técnico GMAP: emite e audita, sem acesso à aba Usuários.
- Nova O.S.: escola pela base de entidades, empresa sugerida pela área (fora da área exige justificativa), prioridade com prazo (Urgente 2, Alta 10, Normal 30 dias corridos), tipo de serviço, motivos (um ou mais), ambientes com splits, responsável pela entidade (sugerido na próxima O.S.), origem (Redmine, SEI ou gerência), campos adicionais do modelo, aviso de O.S. em aberto na mesma escola, rascunho guardado.
- Número/ano gerado na solicitação, em sequência única entre as empresas; recusadas mantêm o número.
- Aprovação da gerência antes da emissão (individual ou em lote), devolução para correção e recusa; a gerência emite direto. O prazo começa na aprovação.
- Ações na O.S. por perfil: registrar e corrigir atendimento (PDF assinado obrigatório, justificativa após o prazo), desfazer atendimento (sempre com justificativa), stand by e retomar, revisão sugerida pelo técnico, edição e cancelamento pela gerência (motivos da lista).
- Histórico de cada O.S. com nome e perfil de quem fez; eventos internos não aparecem para a empresa.
- Visão geral: O.S. geradas hoje, aguardando aprovação, em revisão e em stand by. O.S. em revisão saem das contagens.
- Abas Aprovações, Nova O.S., Empresas (área e e-mail de aviso, avisos enviados) e Modelo da O.S. (listas, regras, campos adicionais, pré-visualização e histórico de versões).
- Auditoria: seção Base de entidades (O.S. diferente da base com correção pela gerência, entidade removida, escola sem INEP, INEP repetido ou fora do padrão, campos vazios, O.S. sem vínculo, mudanças da última importação).
- PDF da O.S. assinada no armazenamento do Supabase (pasta privada), aberto por link temporário.
- Avisos por e-mail às empresas pela conta gerenciagmap@gmail.com (`apps-script/Emails.gs`).
- Importação diária da planilha ENTIDADES (`apps-script/Entidades.gs`), com a coluna ID SISTEMA.
- Avisos em destaque listando o que falta preencher; ações da O.S. em ícones com descrição.

### Alterado
- Status: Pendente e Em andamento viram Emitida; Problema vira Stand by.
- Sincronização com a planilha: na fase planilha, espelha a planilha como antes (inclusive O.S. novas) e nunca toca nas O.S. emitidas no sistema; as O.S. da planilha ficam só para consulta no sistema. Depois da virada, o banco recusa a sincronização.
- Fase planilha: abas Nova O.S. e Aprovações escondidas e emissão recusada pelo banco; empresas, modelo, usuários, base de entidades e auditoria já funcionam.

### Corrigido
- Botões e confirmações que dependiam do envio nativo de formulário ou de caixas do navegador não funcionavam em páginas protegidas; agora usam janelas próprias.

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
