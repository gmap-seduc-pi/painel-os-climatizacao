/**
 * Painel de O.S. de Climatização · GMAP | SEDUC-PI
 * Importação da planilha ENTIDADES (base de escolas e entidades) para o banco.
 *
 * Fica no MESMO projeto do Sincronizacao.gs (usa as mesmas propriedades SUPABASE_URL e SUPABASE_SECRET_KEY).
 * Propriedade nova:
 *      ENTIDADES_ID      ID da planilha ENTIDADES (o trecho entre /d/ e /edit no endereço)
 *      ENTIDADES_ABA     (opcional) nome da aba; padrão ENTIDADES
 *
 * Identificador de cada entidade: coluna "ID SISTEMA" na planilha ENTIDADES.
 * Se a coluna não existir, o script a cria no fim da planilha. Linhas sem ID recebem um código novo
 * (E00001, E00002...). Esse código nunca deve ser editado nem reaproveitado: é ele que liga as O.S.
 * à entidade, mesmo se o nome, o INEP ou o endereço mudarem.
 *
 * O que sai da planilha fica inativo no painel (não é apagado). Cada importação registra o que mudou,
 * e isso aparece em Auditoria dos dados > Base de entidades.
 */
const ENT_COLUNAS = {
  inep: 'INEP', nome: 'NOME ENTIDADE', municipio: 'MUNICIPIO', gre: 'GRE/CIDADE', tipologia: 'TIPOLOGIA', zona: 'ZONA', endereco: 'ENDEREÇOS'
};
const ENT_ID = 'ID SISTEMA';

function importarEntidadesComAviso() {
  const r = importarEntidades();
  SpreadsheetApp.getUi().alert('Base de entidades importada',
    `${r.linhas} entidades lidas · ${r.incluidas} novas · ${r.alteradas} alteradas · ${r.removidas} removidas · ${r.reativadas} reativadas` +
    (r.novos_ids ? `\n\n${r.novos_ids} linha(s) receberam código na coluna "${ENT_ID}".` : '') +
    (r.os_vinculadas ? `\n${r.os_vinculadas} O.S. antigas foram ligadas à base pelo INEP.` : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function importarEntidades() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Outra importação está em andamento.');
  try {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('ENTIDADES_ID');
    if (!id) throw new Error('Configure ENTIDADES_ID nas propriedades do script.');
    const aba = SpreadsheetApp.openById(id).getSheetByName(props.getProperty('ENTIDADES_ABA') || 'ENTIDADES');
    if (!aba) throw new Error('Aba ENTIDADES não encontrada.');
    const valores = aba.getDataRange().getValues();
    const cab = valores[0].map(normalizar);
    const idx = {};
    Object.keys(ENT_COLUNAS).forEach(k => { idx[k] = cab.indexOf(normalizar(ENT_COLUNAS[k])); });
    const faltando = ['nome', 'tipologia'].filter(k => idx[k] < 0).map(k => ENT_COLUNAS[k]);
    if (faltando.length) throw new Error('Colunas não encontradas na planilha ENTIDADES: ' + faltando.join(', '));

    // coluna ID SISTEMA: cria se não existir e preenche só as linhas sem código
    let colId = cab.indexOf(normalizar(ENT_ID));
    if (colId < 0) {
      colId = valores[0].length;
      aba.getRange(1, colId + 1).setValue(ENT_ID).setFontWeight('bold');
      valores.forEach(v => v[colId] = '');
    }
    let maior = 0;
    valores.slice(1).forEach(v => { const m = /^E(\d+)$/.exec(String(v[colId] || '').trim()); if (m) maior = Math.max(maior, +m[1]); });
    const novos = [];
    const linhas = [];
    for (let i = 1; i < valores.length; i++) {
      const v = valores[i];
      const nome = texto(v[idx.nome]);
      if (!nome) continue;
      let cod = String(v[colId] || '').trim();
      if (!cod) { cod = 'E' + String(++maior).padStart(5, '0'); v[colId] = cod; novos.push([i + 1, cod]); }
      const e = { id: cod };
      Object.keys(ENT_COLUNAS).forEach(k => { e[k] = idx[k] >= 0 ? texto(v[idx[k]]) : null; });
      linhas.push(e);
    }
    // grava os códigos novos antes de enviar (assim, se o envio falhar, os códigos já estão fixos)
    novos.forEach(([linha, cod]) => aba.getRange(linha, colId + 1).setValue(cod));
    SpreadsheetApp.flush();
    const r = chamarSupabase('importar_entidades', { payload: linhas });
    r.novos_ids = novos.length;
    console.log('Importação de entidades: ' + JSON.stringify(r));
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** Importação automática todo dia, de madrugada (execute uma vez). */
function instalarGatilhoEntidades() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importarEntidades').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importarEntidades').timeBased().everyDays(1).atHour(5).nearMinute(37).create();
  importarEntidades();
}
