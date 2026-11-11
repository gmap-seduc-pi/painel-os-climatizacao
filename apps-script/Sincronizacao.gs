/**
 * Painel de O.S. de Climatização · GMAP | SEDUC-PI
 * Sincronização da planilha consolidada com o banco (Supabase).
 *
 * Instalação (detalhes em manual/IMPLANTACAO.md):
 * 1. Na planilha consolidada: Extensões > Apps Script > crie um arquivo "Sincronizacao.gs" e cole este código.
 * 2. Configurações do projeto > Propriedades do script > adicione:
 *      SUPABASE_URL          https://SEU-PROJETO.supabase.co
 *      SUPABASE_SECRET_KEY   chave secreta (service_role ou sb_secret_...) do Supabase
 *      ABA_CONSOLIDADA       nome da aba (ex.: Consolidado)
 *      LINHA_CABECALHO       (opcional) número da linha de títulos; padrão 1
 * 3. Execute uma vez a função sincronizar() e autorize. A partir daí ela roda no final de
 *    consolidarPlanilhas() (Codigo.gs). instalarGatilho() é só uma alternativa, se um dia a
 *    sincronização precisar rodar independente da consolidação.
 *
 * A chave secreta fica só nas propriedades do script. Nunca coloque essa chave no site.
 */

// Títulos esperados na planilha (comparação sem acento, sem diferença de maiúsculas e espaços)
const COLUNAS = {
  numero: 'Nº DA OS',
  empresa: 'EMPRESA',
  status: 'STATUS',
  prioridade: 'PRIORIDADE',
  criada_em: 'CRIADA EM',
  prazo: 'PRAZO',
  atendida_em: 'DATA DO ATENDIMENTO',
  splits: 'QTD. SPLITS',
  descricao: 'DESCRIÇÃO DA O.S.',
  escola: 'ESCOLA',
  entidade: 'ENTIDADE SOLICITANTE',
  inep: 'INEP',
  gre: 'GREº',
  municipio: 'MUNICÍPIO',
  zona: 'ZONA',
  endereco: 'ENDEREÇO',
  id_sei: 'ID SEI',
  observacoes: 'OBSERVAÇÕES',
  justificativa: 'JUSTIFICATIVA DA EMPRESA',
  motivo_cancelamento: 'MOTIVO DO CANCELAMENTO'
};
const OBRIGATORIAS = ['numero', 'empresa', 'status', 'criada_em', 'prazo'];
const DATAS = ['criada_em', 'prazo', 'atendida_em'];
const FUSO = 'America/Sao_Paulo';

/** Adiciona o menu "Painel de O.S." (chame dentro do onOpen da planilha; veja o MANUAL). */
function menuPainel() {
  SpreadsheetApp.getUi().createMenu('Painel de O.S.')
    .addItem('Sincronizar agora', 'sincronizarComAviso')
    .addToUi();
}

function sincronizarComAviso() {
  const r = sincronizar();
  SpreadsheetApp.getUi().alert(
    'Sincronização concluída',
    `${r.registros} O.S. enviadas · ${r.inseridos} novas · ${r.removidos} removidas · ${r.status_alterados} com status alterado.`,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Lê a aba consolidada e substitui o conteúdo do banco. */
function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Outra sincronização está em andamento.');
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('SUPABASE_URL');
    const chave = props.getProperty('SUPABASE_SECRET_KEY');
    const nomeAba = props.getProperty('ABA_CONSOLIDADA') || 'Consolidado';
    const linhaCab = Number(props.getProperty('LINHA_CABECALHO') || 1);
    if (!url || !chave) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas propriedades do script.');

    const aba = SpreadsheetApp.getActive().getSheetByName(nomeAba);
    if (!aba) throw new Error(`Aba "${nomeAba}" não encontrada.`);
    const valores = aba.getDataRange().getValues();
    const cab = valores[linhaCab - 1].map(normalizar);

    const idx = {};
    Object.keys(COLUNAS).forEach(k => { idx[k] = cab.indexOf(normalizar(COLUNAS[k])); });
    const faltando = OBRIGATORIAS.filter(k => idx[k] < 0).map(k => COLUNAS[k]);
    if (faltando.length) throw new Error('Colunas obrigatórias não encontradas: ' + faltando.join(', '));

    const linhas = [];
    for (let i = linhaCab; i < valores.length; i++) {
      const v = valores[i];
      const numero = texto(v[idx.numero]);
      const empresa = texto(v[idx.empresa]);
      if (!numero || !empresa) continue; // linha vazia ou incompleta
      const o = { chave: numero + '|' + empresa };
      Object.keys(COLUNAS).forEach(k => {
        const bruto = idx[k] >= 0 ? v[idx[k]] : '';
        if (DATAS.indexOf(k) >= 0) o[k] = data(bruto);
        else if (k === 'splits') o[k] = inteiro(bruto);
        else o[k] = texto(bruto);
      });
      linhas.push(o);
    }
    if (!linhas.length) throw new Error('Nenhuma O.S. encontrada; nada foi enviado.');

    const headers = { apikey: chave };
    if (chave.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + chave; // chave service_role no formato antigo (JWT)
    const resp = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/sincronizar_os', {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify({ payload: linhas, origem: 'apps-script' }),
      muteHttpExceptions: true
    });
    const codigo = resp.getResponseCode();
    if (codigo >= 300) throw new Error(`Supabase respondeu ${codigo}: ${resp.getContentText().slice(0, 500)}`);
    const r = JSON.parse(resp.getContentText());
    console.log('Sincronização: ' + JSON.stringify(r));
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** Cria o gatilho de sincronização a cada 5 minutos (execute uma vez). */
function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  sincronizar();
}

// ---------- utilitários ----------
function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/º|ª/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}
function texto(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, 'dd/MM/yyyy');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s ? s : null;
}
function inteiro(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : null;
}
function data(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}
