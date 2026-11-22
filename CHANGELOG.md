# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões no padrão `MAIOR.MENOR.CORREÇÃO`.

## [Não publicado]

## [2.7.1] - 2026-11-22

Só arquivos do site (sem migração).

### Corrigido
- **O.S. canceladas por motivo** (Auditoria): o gráfico e a coluna "Motivo mais frequente" contam pelo motivo principal, sem o detalhe. Antes, "Atraso superior a 60 dias: Atendida depois na mesma escola..." virava uma barra para cada texto diferente; agora todas entram em "Atraso superior a 60 dias". O texto completo continua no detalhe da O.S.

## [2.7.0] - 2026-11-19

Requer a migração `supabase/migrations/010_tempo_real.sql` (liga o Realtime do Supabase para as O.S. e o histórico).

### Adicionado
- **Tempo real:** quando outra pessoa muda uma O.S. ou registra algo no histórico, a tela se atualiza sozinha (Feed, Fila, Visão geral, contadores), com um aviso discreto "Atualizado: há novas movimentações".
  - **economia de dados:** o painel pergunta ao banco só quais movimentações são novas e baixa apenas as O.S. envolvidas, com os itens e a conferência delas (cerca de 1 a 2 KB por atualização, contra cerca de 1,7 MB de uma recarga completa). Recarga completa só quando mais de 50 O.S. mudam de uma vez;
  - junta várias mudanças em 1,5 s; com uma janela de diálogo aberta, a aba escondida ou a pessoa digitando, espera e atualiza depois (o cursor volta ao mesmo campo);
  - telas de gestão (Usuários, Configurações, Modelo, Empresas, Planilha, Nova O.S.) não se redesenham sozinhas: só os contadores mudam, para não perder uma escolha ainda não salva;
  - ao voltar para uma aba que estava escondida, confere o que mudou nesse tempo;
  - se a O.S. aberta no detalhe mudar, aparece "Esta O.S. foi alterada por ..." com o botão "Ver a versão atual" (o detalhe não muda sozinho no meio da leitura);
  - as próprias ações não geram atualização repetida;
  - se a conexão em tempo real cair, o painel faz a mesma consulta mínima a cada 2 minutos (o cabeçalho mostra "atualização automática a cada 2 min");
  - cada pessoa só recebe o aviso das linhas que já pode ver (as regras de acesso do banco valem também aqui); o painel ouve só inclusões e alterações, nunca exclusões.
- **Avisos da Medição** explicam o que é cada um e o que fazer, com atalho ("Abrir o contrato", "Ver os itens esgotados") e o botão **Ciente**, que tira o aviso do contador (o de vigência volta nas etapas de 90 e 60 dias). A dica do contador da aba diz quais são os avisos. Novo filtro "Esgotados" no saldo por item.

## [2.6.1] - 2026-11-18

Só banco: requer a migração `supabase/migrations/009_correcao_configuracoes.sql`. O site não muda.

### Corrigido
- **Salvar as Configurações** dava o erro "UPDATE requires a WHERE clause" (proteção do Supabase que exige dizer qual linha muda). Afetava a data dos itens do contrato e também os motivos de glosa e de ressalva e a data da O.S. assinada. As duas funções que salvam foram refeitas com `where id = 1`.
- Os testes passaram a conferir todas as migrações: nenhum UPDATE ou DELETE sem WHERE.

## [2.6.0] - 2026-11-18

Só arquivos do site (sem migração).

### Adicionado
- Aba **Feed**, antes da Visão geral (ao entrar no sistema, a Visão geral continua sendo a primeira tela):
  - todas as movimentações das O.S., das mais recentes para as mais antigas, agrupadas por dia (Hoje, Ontem, data), com horário, ação, quem fez, escola e empresa;
  - filtros próprios: período (hoje, 7, 30 ou 90 dias), tipo (emissão e aprovação, atendimento, stand by/cancelamento/revisão, fiscalização e medição, planilha), empresa e busca;
  - clicar abre a O.S., com as setas percorrendo as O.S. do feed;
  - contador na aba com as O.S. que mudaram desde a última visita ao Feed (sem contar o que a própria pessoa fez); as novidades aparecem destacadas como "Novo";
  - a empresa vê só as movimentações públicas das O.S. dela; a gestão vê também as internas, marcadas.

### Alterado
- O card "Movimentações recentes" saiu da Visão geral (o conteúdo agora está no Feed). O botão "Recentes" e o selo "Novo" da Fila continuam.
- **Sair** responde na hora: mostra "Saindo…" e bloqueia a tela; o servidor tem no máximo 1,5 s para confirmar e a sessão do navegador é apagada de qualquer jeito.
- Nas abas sem os filtros gerais (Fiscalização, Medição, Usuários etc.), a linha "Mostrando todas as O.S." não aparece mais.

## [2.5.0] - 2026-11-18

Só arquivos do site (sem migração).

### Alterado
- **Topo mais limpo** na Visão geral e na Fila:
  - filtros recolhidos atrás do botão **Filtros (n)**, também no computador; os filtros ativos aparecem ao lado como etiquetas, cada uma com × para remover, e "Limpar filtros";
  - a faixa do dia (geradas hoje, aguardando aprovação, em revisão, lançamentos na planilha, stand by, sem a O.S. assinada) virou uma linha de etiquetas compactas; itens zerados ficam esmaecidos e o detalhe aparece ao passar o mouse; no celular, em duas colunas.
- Ordenação por prazo: "data mais antiga primeiro" e "data mais recente primeiro" (antes "mais próximo", que confundia com as vencidas).

## [2.4.0] - 2026-11-18

Requer a migração `supabase/migrations/008_medicao.sql` (depois da 007).

### Adicionado
- **Medição pelos itens do contrato** (aba Medição: principal para o perfil Consultivo; no menu da engrenagem para a equipe da GMAP):
  - cadastro de contratos, **períodos de vigência** (cada prorrogação abre um período e renova o quantitativo, copiado do período anterior), itens (serviços e peças por faixa de BTU), **preços com histórico de versões** (cada versão vale a partir de uma data, com o documento: contrato ou apostilamento) e quantidade por período;
  - **consumo anterior à implantação** por item, informado pela GMAP com o documento SEI dos pagamentos já feitos no período;
  - saldo por item (contratado, anterior, aceito, a conferir), com aviso em 80% e em 100%; o que passa do contratado continua registrado e aparece como "acima do contratado", para eventual pagamento indenizatório;
  - medição do mês por O.S. (valor declarado e aceito), com Excel (por O.S. e por item) e impressão;
  - aviso de fim de vigência 120, 90 e 60 dias antes, e de item esgotado, no contador da aba.
- **Itens no atendimento:** a empresa informa os itens do contrato executados (serviço ou peça, faixa e quantidade), com o total calculado na hora. Obrigatório nos atendimentos a partir de uma data configurável (padrão 01/01/2027). Antes da conferência, a empresa pode corrigir os itens com motivo; a GMAP também pode informar pela empresa.
- **Conferência por item** na Fiscalização: na glosa, o fiscal informa a quantidade aceita de cada item e o motivo; conferida e com ressalva aceitam todos os itens. A empresa não vê o resultado, só que os itens já foram conferidos. Glosa em lote não vale para O.S. com itens.
- Fiscalização: valor declarado e aceito na lista, no resumo e no Excel; ponto de atenção "Sem itens do contrato".
- **Empresas sem contrato** (pagas por nota de empenho, como a R.E. Soluções): ficam fora da medição; a gerência registra na O.S. o processo (PACTUE extra), a nota de empenho e o valor.
- Configurações: data a partir da qual os itens do contrato são exigidos.
- **Movimentações recentes**, para achar rápido o que acabou de mudar:
  - Visão geral: card com as 6 O.S. movimentadas por último (ação, quem fez e quando), que abre o detalhe;
  - Fila: botão **Recentes** (só as O.S. movimentadas nos últimos 7 dias, mais recentes primeiro), ordenação "Última movimentação" e, na coluna Status, "há 5 min", "ontem às 14:20" etc.; a O.S. alterada nos últimos 30 minutos aparece destacada com "Novo";
  - a última movimentação vem do último evento público do histórico (a empresa não vê eventos internos, como a conferência).
- Carga inicial: Contrato 119/2024 (Classe A, período do 3º Termo Aditivo, quantidades do 1º TA) e Contrato 012/2026 (Concretizar), com os 91 itens conferidos com os totais dos documentos.

### Alterado
- Desfazer o atendimento apaga os itens declarados (a empresa informa de novo ao registrar).

## [2.3.0] - 2026-11-17

Requer a migração `supabase/migrations/007_fiscalizacao.sql` (depois da 006).

### Adicionado
- Aba **Fiscalização** (aba principal para o perfil Consultivo; no menu da engrenagem para a equipe da GMAP), para conferir os atendimentos antes do pagamento:
  - escolhe empresa, período (mês, já aberto no mês anterior, ou datas livres) e GRE; o período considera a data do atendimento informada pela empresa;
  - resumo: O.S. atendidas, splits, % no prazo, fora do prazo com atraso médio, sem O.S. assinada e andamento da conferência; quebra por tipo de serviço, prioridade e GRE;
  - pontos de atenção clicáveis: fora do prazo, sem O.S. assinada, registro tardio (mais de 7 dias depois da data informada), data anterior à emissão, mesma escola e serviço no período, pendências relatadas e atendimento alterado depois da conferência;
  - lista com a O.S. assinada (Ver PDF), quando foi registrada no sistema e a situação da conferência;
  - botão **Limpar filtros**;
  - **conferência** pela gerência e pelo Consultivo: conferida, com ressalva ou glosada, uma a uma ou em lote. Glosa e ressalva pedem um ou mais **motivos rápidos** (listas separadas, incluindo "Outro" com descrição livre) e têm um campo de **observação** à parte; pode ser desfeita. A O.S. não muda, cada conferência fica registrada (quem, função, quando) e aparece no histórico interno da O.S.; a empresa não vê;
  - **Exportar Excel** (resumo, lista completa e pontos de atenção), **Imprimir relatório** (com espaço de assinatura do fiscal) e **Baixar O.S. assinadas** num único arquivo .zip para anexar ao processo de pagamento.
- **Configurações** (engrenagem, só gerência): motivos de glosa e de ressalva (incluir, reordenar, remover) e a data a partir da qual a O.S. assinada em PDF é obrigatória, com histórico de alterações.
- **O.S. assinada obrigatória só para O.S. emitidas a partir de 01/12/2026** (data editável em Configurações). Antes disso o anexo é opcional e não gera pendência; a Fiscalização mostra "não exigida".
- Perfil **Consultivo por empresa**: no cadastro o fiscal escolhe as empresas que vai acompanhar (ou "Todas as empresas", para a Diretoria); a gerência confirma e pode alterar. O fiscal só vê e confere O.S. dessas empresas (regra aplicada no banco).
- Painel de detalhe da O.S.: setas **anterior / próxima** (e teclas ← →) para percorrer a lista de onde a O.S. foi aberta, com a posição "x de N".
- Fila de O.S.: filtro **Atendidas de / até**.
- O sistema passa a guardar quando o atendimento foi registrado (para comparar com a data informada).

### Alterado
- **O.S. cancelada fica só para consulta** e sai dos indicadores que pedem ajuste ou verificação:
  - Auditoria dos dados: "Cadastro incompleto" e "Número de O.S. repetido" não listam canceladas (a O.S. ativa com o mesmo número de uma cancelada continua aparecendo); base de entidades: "O.S. sem vínculo com a base" também;
  - Planilha: lançamento da planilha numa O.S. cancelada não entra nos contadores e vai para o bloco "Lançamentos da planilha em O.S. canceladas", só para consulta. O banco recusa aplicar ou decidir sobre ele;
  - as estatísticas de canceladas (por motivo e na síntese) continuam como estavam.
- A planilha não cancela mais O.S. atendida (mesma regra do botão Cancelar). O aviso pode ser resolvido com "Manter o sistema".
- Usuários do perfil Consultivo que já existiam passam a ver **todas as empresas**; a gerência deve editar os fiscais para limitar as empresas de cada um.
- Celular: nos cartões, o nome do campo não se sobrepõe mais ao campo seguinte quando quebra em duas linhas.

## [2.2.0] - 2026-11-17

Requer a migração `supabase/migrations/006_perfis_e_usuarios.sql` (depois da 005).

### Adicionado
- Perfil **Consultivo** (substitui "Diretoria"), com a função da pessoa (Diretoria, Fiscal de contrato ou outra). Vê a Visão geral e a Fila de todas as empresas e exporta relatórios, sem nenhuma ação sobre as O.S. Quem era Diretoria passa a Consultivo (Diretoria) automaticamente.
- **Minha conta** (antes "Alterar senha"): cada usuário corrige o próprio nome e, se quiser, troca a senha.
- Usuários (gerência):
  - **Editar** nome, perfil, empresa e função de qualquer usuário (o próprio perfil não pode ser trocado), com confirmação ao mudar o perfil e aviso quando a pessoa tem solicitações em andamento;
  - **Excluir** usuário, mostrando antes o que será afetado. O login e o cadastro são apagados; o nome continua no histórico das O.S.; solicitações em andamento passam para quem excluiu (as devolvidas voltam para a aprovação). Não é possível excluir a si mesmo nem o último usuário da gerência. Tudo fica registrado em `perfis_log`.
- Fila de O.S.: ordenar por qualquer coluna clicando no título (1º clique ordena, 2º inverte, 3º volta à ordem padrão). "Situação do prazo" começa pelas mais atrasadas. No celular, o seletor "Ordenar" faz o mesmo. A ordem vale também para a busca, a seleção e as exportações.

### Alterado
- Nomes de escolas e entidades mantêm siglas e tipologias em maiúsculas (CETI, CEJA, U E, GRE, UAB, numerais romanos como II e XXIII) e o restante em "Primeira Maiúscula" (CETI Antônio Freitas, Pau D'Arco do Piauí).

## [2.1.0] - 2026-11-16

Requer a migração `supabase/migrations/005_observacao_da_planilha.sql` (depois da 003 e da 004).

### Adicionado
- Observação da planilha depois da virada: a sincronização continua lendo a planilha só para comparar, sem alterar o sistema.
- Aba Planilha (só gerência): O.S. novas lançadas na planilha, com Importar (formulário preenchido; número, data e prazo da planilha mantidos; número novo se o da planilha já existir no sistema) e Descartar (com explicação); mudanças feitas na planilha em O.S. do sistema, com valor no sistema e na planilha, e duas ações: **Aplicar no sistema** (gerência escolhe os campos; valor anterior e novo ficam no histórico) ou **Manter o sistema** (com justificativa, quando a planilha está errada); histórico do que foi tratado.
- A diferença da planilha também aparece dentro da O.S., com as mesmas ações.
- O.S. marcada como Atendida a partir da planilha fica "sem a O.S. assinada": a empresa recebe e-mail, vê o aviso na visão geral e anexa o PDF dentro da O.S. (a gerência também pode anexar). A pendência some sozinha quando o PDF chega. Lista na aba Planilha e filtro na Fila.
- Técnicos veem todas as solicitações aguardando aprovação e as O.S. em revisão (antes, só as próprias). A aba passa a se chamar Aprovações para todos.
- Descrição dos botões de ícone não é mais cortada pelo painel da O.S.
- Visão geral: contador "Lançamentos na planilha". Detalhe da O.S.: "Lançada na planilha como".
- E-mail à empresa explica quando a O.S. foi lançada na planilha e registrada no sistema.
- `encerrar_observacao()` para parar de observar a planilha.

### Alterado
- Virada (`encerrar_planilha()`): continua observando a planilha em vez de recusar a sincronização. A linha `sincronizar();` do `Codigo.gs` permanece até o fim da observação.
- O.S. assinada por foto: no registro e na correção do atendimento e em "Anexar O.S. assinada", além de escolher um PDF, dá para tirar fotos (uma por página; no celular abre a câmera). As fotos são reduzidas e juntadas num PDF no próprio aparelho antes do envio, com miniaturas para conferir e remover páginas.
- Celular (revisão completa):
  - cabeçalho compacto, com engrenagem, usuários e alterar senha como ícones ao lado de Sair; abas principais com nomes curtos ("Geral", "Fila") dividindo a largura;
  - filtros recolhidos atrás do botão "Filtros" (mostra quantos estão ativos);
  - fila em cartões compactos (número, status, escola, empresa, prioridade, situação e prazo) e demais tabelas em cartões com o nome de cada campo;
  - quadro "Atendimento dentro do prazo" rola para o lado com a coluna da empresa fixa;
  - detalhe da O.S. com cabeçalho e barra de ações fixos (as ações ficam visíveis sem rolar) e abrindo sempre do topo;
  - campos com letra de 16 px (o iPhone deixa de dar zoom ao tocar), caixas de marcar maiores e botões com área de toque de pelo menos 40 px;
  - rótulos longos dos gráficos quebram em linhas em vez de serem cortados; textos longos (número SEI, endereço) quebram sem invadir a coluna ao lado;
  - barra de salvar do Modelo da O.S. numa linha só.
- Navegação: Planilha, Auditoria dos dados, Empresas e Modelo da O.S. ficam no menu da engrenagem; Usuários vira um ícone. Os dois mostram o número de avisos.
- Cabeçalho: na fase planilha mostra a última sincronização; depois da virada, "dados em tempo real".

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
