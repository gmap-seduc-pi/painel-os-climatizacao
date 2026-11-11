# Manual de implantação e manutenção

Painel de O.S. de Climatização · GMAP | SEDUC-PI. Público: equipe técnica da GMAP.

## 1. Como funciona

```
Planilhas das empresas
      │  (Apps Script atual consolida)
      ▼
Planilha geral, aba "Consolidado"
      │  Apps Script de sincronização, a cada 5 minutos (chave secreta)
      ▼
Supabase (PostgreSQL)
  · tabela os            → espelho da planilha
  · tabela perfis        → quem acessa e com qual perfil
  · regras de acesso     → GMAP e diretoria veem tudo; empresa vê só as próprias O.S.
  · histórico de status, registro de sincronizações e de acessos
      │  login com e-mail e senha (chave pública)
      ▼
Site do painel (GitHub Pages, Netlify ou Vercel)
```

A planilha continua sendo a fonte. O painel é só consulta. A separação por empresa é feita **no banco**: mesmo que alguém altere o site no navegador, o banco só entrega as O.S. permitidas para aquele login.

### Conteúdo da pasta

| Pasta / arquivo | Para que serve |
|---|---|
| `supabase/migrations/` | Estrutura do banco, uma alteração por arquivo numerado |
| `supabase/scripts/usuarios.sql` | Modelo para cadastrar, alterar e bloquear usuários |
| `supabase/scripts/consultas_uteis.sql` | Consultas de acompanhamento (sincronizações, acessos, histórico) |
| `apps-script/Codigo.gs` | Consolidação das planilhas das empresas (chama a sincronização no final) |
| `apps-script/Sincronizacao.gs` | Código que envia a planilha para o banco |
| `docs/` | O site do painel (HTML, CSS e JavaScript, sem etapa de compilação) |

## 2. Criar o banco (Supabase)

1. Crie uma conta em supabase.com e um projeto novo. Região: **South America (São Paulo)**. Guarde a senha do banco.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/migrations/001_estrutura_inicial.sql` e execute. Pode executar de novo no futuro sem perder dados.
3. Em **Authentication**, nas configurações de cadastro:
   - **desative** a opção que permite novos usuários se cadastrarem sozinhos (só a GMAP cria usuários);
   - mantenha o login por **e-mail** ativo;
   - defina senha com **mínimo de 10 caracteres**.
4. Em **Project Settings > API** (ou **API Keys**), anote:
   - a **URL do projeto**;
   - a chave **pública** (`anon` ou `publishable`), que vai no site;
   - a chave **secreta** (`service_role` ou `sb_secret_...`), que vai **somente** no Apps Script.

> Plano gratuito: o Supabase pausa projetos sem atividade por 7 dias. A sincronização a cada 5 minutos mantém o projeto ativo.

## 3. Ligar a planilha ao banco (Apps Script)

1. Na planilha geral, abra **Extensões > Apps Script**.
2. Crie um arquivo `Sincronizacao.gs` e cole o conteúdo de `apps-script/Sincronizacao.gs`.
3. Em **Configurações do projeto > Propriedades do script**, adicione:

   | Propriedade | Valor |
   |---|---|
   | `SUPABASE_URL` | URL do projeto (ex.: `https://abcd.supabase.co`) |
   | `SUPABASE_SECRET_KEY` | chave secreta |
   | `ABA_CONSOLIDADA` | `Consolidado` (ou o nome exato da aba) |
   | `LINHA_CABECALHO` | só se os títulos não estiverem na linha 1 |

4. Menu na planilha (opcional): se o projeto já tem uma função `onOpen`, acrescente a linha `menuPainel();` dentro dela. Se não tem, crie:
   ```js
   function onOpen() { menuPainel(); }
   ```
5. Na mesma tela de propriedades, crie `PLANILHAS_ORIGEM` com a lista das planilhas das empresas, no formato:
   ```
   [{"id":"ID_DA_PLANILHA","nomeEmpresa":"CLASSE A"},{"id":"...","nomeEmpresa":"CONCRETIZAR"}]
   ```
   O ID é o trecho da URL da planilha entre `/d/` e `/edit`. Os IDs ficam fora do código para que o repositório no GitHub não exponha os endereços das planilhas.
6. Substitua o conteúdo de `Código.gs` pelo de `apps-script/Codigo.gs`. Ele consolida e, ao final, chama `sincronizar()` **somente se as quatro empresas foram lidas sem erro**. Assim uma falha de leitura nunca apaga do painel as O.S. de uma empresa.
7. Selecione a função `sincronizar`, clique em **Executar** e autorize. Confira no Supabase: **Table Editor > os** com todas as O.S. e **sincronizacoes** com uma linha.
8. Não é preciso criar outro gatilho: o gatilho existente de `consolidarPlanilhas` passa a atualizar o painel. A frequência do painel é a mesma da consolidação (`MINUTOS` em `criarGatilhoFrequente`).

### Regras da sincronização

- A chave de cada O.S. é **número + empresa** (o mesmo número pode existir em empresas diferentes).
- Se houver duas linhas com o mesmo número **e** a mesma empresa, a sincronização é recusada e o erro aparece no registro de execuções do Apps Script. Nada é apagado.
- Se a aba vier vazia, a sincronização é recusada para não apagar o banco.
- Colunas obrigatórias: `Nº DA OS`, `EMPRESA`, `STATUS`, `CRIADA EM`, `PRAZO`. Os títulos são comparados sem acento e sem diferença de maiúsculas. Se uma coluna for renomeada na planilha, ajuste o objeto `COLUNAS` no início do script.
- Cada mudança de status fica registrada em `os_historico`. A planilha só guarda o estado atual; o banco passa a guardar a evolução.

## 4. Publicar o site

1. Edite `docs/config.js` com a URL do projeto e a chave **pública**. Nunca coloque a chave secreta nesse arquivo.
2. Opção A, **GitHub Pages**: crie um repositório, envie a pasta inteira e, em **Settings > Pages**, publique a partir da branch `main`, pasta `/docs`. O repositório pode ser público: ele não contém dados nem chaves secretas.
   Opção B, **Netlify ou Vercel**: arraste a pasta `docs` para criar o site.
3. No Supabase, em **Authentication > URL Configuration**, informe o endereço do site como **Site URL**.

## 5. Cadastrar usuários

1. **Authentication > Users > Add user > Create new user**: e-mail, senha temporária e marque **Auto Confirm User**.
2. No **SQL Editor**, use `supabase/scripts/usuarios.sql` para criar o perfil:
   - `gmap`: visão geral, fila de todas as empresas e aba de auditoria;
   - `diretoria`: visão geral e fila de todas as empresas;
   - `empresa`: visão geral e fila só da própria empresa. O nome da empresa precisa ser **idêntico** ao da coluna EMPRESA da planilha.
3. Envie o endereço do site e a senha temporária por um canal seguro e peça para a pessoa usar **Alterar senha** no primeiro acesso.
4. Usuário sem perfil, ou com `ativo = false`, não vê nada, mesmo que consiga fazer login.

**Esqueceu a senha:** em **Authentication > Users**, abra o usuário e defina uma nova senha temporária. (Recuperação automática por e-mail exige configurar um servidor de e-mail próprio no Supabase; pode ser feito depois.)

**Saída de alguém ou fim de contrato de empresa:** rode `update public.perfis set ativo = false where email = '...';`. O bloqueio é imediato.

## 6. Regras de negócio implementadas

| Regra | Como o painel calcula |
|---|---|
| Prazo | Coluna `PRAZO` da planilha, contado a partir de `CRIADA EM` |
| Vencida | O.S. em aberto (Pendente, Em andamento ou Problema) com prazo anterior à data de hoje (horário de Brasília) |
| A vencer | O.S. em aberto que vence em até 3 dias |
| Atendida no prazo | Data do atendimento até a data do prazo |
| Atendida antes da O.S. | Atendimento anterior à criação (chamado urgente regularizado depois). Conta como **dentro do prazo** |
| % no prazo | (no prazo + antes da O.S.) ÷ atendidas com datas válidas. Canceladas e atendidas sem data ficam fora |

Para mudar a janela de "a vencer", altere `AVENCER` no início de `docs/painel.js`.

### Aba Auditoria dos dados (só GMAP)

| Cartão | Critério |
|---|---|
| Provável backlog artificial | O.S. em aberto cuja escola (INEP) teve atendimento posterior que cobre todos os tipos de serviço pedidos, com quantidade de splits igual ou maior |
| Atendimento parcial posterior | Mesma situação, mas com outro serviço ou menos splits |
| Possível duplicidade em aberto | Outra O.S. em aberto na mesma escola com tipo de serviço em comum |
| Vencida ou com problema sem justificativa | Coluna de justificativa da empresa vazia |
| Atendida sem data de atendimento | Status Atendida com a data em branco |
| Cadastro incompleto | Falta data de criação, prazo, prioridade, município ou INEP |
| Número de O.S. repetido | Mesmo número em mais de um registro |
| Atendidas antes da emissão | Informativo e positivo: chamados urgentes regularizados depois |

A planilha não identifica o aparelho (tombamento ou número de série). Por isso o backlog artificial é **provável**: a confirmação final é com a empresa ou a escola.

## 7. Segurança: lista de conferência

- [ ] **Despublicar a planilha da web** (Arquivo > Compartilhar > Publicar na web > Interromper publicação). Enquanto estiver publicada, qualquer pessoa com o link baixa todas as O.S.
- [ ] Chave secreta só nas propriedades do Apps Script. Se vazar, gere outra no Supabase e atualize a propriedade.
- [ ] Cadastro público de usuários desativado no Supabase.
- [ ] Revisar a lista de perfis a cada mudança de equipe ou de contrato.
- [ ] Conferir os acessos de vez em quando (`supabase/scripts/consultas_uteis.sql`).

## 8. Teste de aceite (antes de liberar)

1. Login com usuário **GMAP**: três abas, todas as empresas, números iguais aos da planilha.
2. Login com usuário **diretoria**: duas abas, todas as empresas.
3. Login com usuário de **empresa**: duas abas, só as O.S. dela; sem filtro de empresa; exportações só com as O.S. dela.
4. Alterar um status na planilha de uma empresa, rodar **Atualizar > Atualizar Planilha** e conferir no painel.
5. Exportar relatório sintético e analítico (Excel e PDF) e imprimir uma O.S. e um lote.
6. Bloquear um usuário (`ativo = false`) e confirmar que ele não vê mais nada.

## 9. Manutenção

- Visual e textos: `docs/style.css` e `docs/index.html`. Cores do manual do Governo do Piauí: azul `#034ea2`, amarelo `#fdb913`, vermelho `#ef4123`, verde `#007932`, fonte Montserrat.
- Indicadores e telas: `docs/painel.js`.
- Login e carregamento dos dados: `docs/app.js`.
- Estrutura do banco: nunca edite uma migração já aplicada. Crie um arquivo novo em `supabase/migrations/` com o próximo número (ex.: `002_nova_coluna.sql`), aplique no SQL Editor e registre no `CHANGELOG.md`.
