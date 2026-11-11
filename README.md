# Painel de O.S. de Climatização

Painel gerencial das ordens de serviço de climatização das escolas da rede estadual, mantido pela Gerência de Material e Patrimônio (GMAP) da SEDUC-PI.

- **Visão geral:** O.S. em aberto, vencidas, a vencer e cumprimento de prazo por empresa e prioridade.
- **Fila de O.S.:** consulta, filtros, detalhe, impressão de O.S. única ou em lote e relatórios em Excel e PDF.
- **Auditoria dos dados** (só GMAP): provável backlog artificial, duplicidades, canceladas por motivo e falhas de preenchimento.

Perfis: **GMAP** e **diretoria** veem todas as empresas; cada **empresa** vê só as próprias O.S. A separação é feita no banco (RLS), não no navegador.

## Como funciona

```
Planilhas das empresas ──► Codigo.gs (consolida) ──► aba "Consolidado"
                                  │
                                  └─► Sincronizacao.gs ──► Supabase (PostgreSQL + RLS) ──► site em docs/
```

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `docs/` | Site do painel (HTML, CSS e JavaScript puros). O nome `docs` é exigido pelo GitHub Pages |
| `apps-script/` | Cópia versionada do código do Apps Script da planilha geral |
| `supabase/migrations/` | Estrutura do banco, uma alteração por arquivo numerado, aplicadas em ordem |
| `supabase/scripts/` | Rotinas de administração (usuários, consultas de acompanhamento) |
| `manual/` | Manual de implantação e manutenção |
| `.github/` | Modelos de solicitação de melhoria, de correção e de revisão |

## Implantação

Siga o passo a passo em [`manual/IMPLANTACAO.md`](manual/IMPLANTACAO.md).

## Regras do repositório

1. **Nenhum segredo no repositório.** A chave secreta do Supabase e os IDs das planilhas ficam nas Propriedades do script do Apps Script. O `docs/config.js` contém só a URL e a chave **pública**, que pode ser exposta porque o banco protege os dados por perfil.
2. **Nenhum dado no repositório.** Planilhas, exportações e relatórios (`.xlsx`, `.csv`, `.pdf`) não são versionados.
3. **Alterações por branch e pull request.** A branch `main` é a versão publicada. Toda mudança nasce em uma branch, passa por pull request e é revisada pela outra pessoa da equipe antes de entrar.
4. **O Apps Script é editado lá e copiado para cá.** Depois de alterar e testar no editor do Apps Script, copie o arquivo para `apps-script/` no mesmo pull request.
5. **Banco só por migração.** Nunca edite uma migração já aplicada. Crie `supabase/migrations/NNN_descricao.sql`, aplique no SQL Editor e registre no `CHANGELOG.md`.
6. **Toda versão publicada entra no `CHANGELOG.md`** e recebe uma tag (`v1.0.0`, `v1.1.0`...).

## Padrão de mensagens de commit

`tipo: descrição curta no imperativo`

| Tipo | Quando usar | Exemplo |
|---|---|---|
| `feat` | Nova funcionalidade | `feat: adiciona filtro por zona` |
| `fix` | Correção de erro | `fix: corrige cálculo de O.S. a vencer` |
| `docs` | Só documentação | `docs: atualiza passo de cadastro de usuários` |
| `style` | Visual, sem mudar regra | `style: ajusta cores dos cartões de auditoria` |
| `refactor` | Reorganização sem mudar comportamento | `refactor: separa funções de exportação` |
| `db` | Migração do banco | `db: adiciona coluna zona ao histórico` |
| `chore` | Manutenção geral | `chore: atualiza versão do Chart.js` |

## Versionamento

Versão no formato `MAIOR.MENOR.CORREÇÃO`:
- **CORREÇÃO** (1.0.**1**): conserto sem mudança visível de comportamento;
- **MENOR** (1.**1**.0): funcionalidade nova compatível com o que existe;
- **MAIOR** (**2**.0.0): mudança que exige ação dos usuários ou da implantação (ex.: nova coluna obrigatória na planilha).

## Responsáveis

Equipe técnica da GMAP | SEDUC-PI.
