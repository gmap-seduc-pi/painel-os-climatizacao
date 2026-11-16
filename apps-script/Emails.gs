/**
 * Painel de O.S. de Climatização · GMAP | SEDUC-PI
 * Envio dos avisos por e-mail às empresas (O.S. emitida, alterada, cancelada).
 *
 * Este script fica num projeto SEPARADO, criado com a conta gerenciagmap@gmail.com
 * (script.google.com > Novo projeto), porque os e-mails saem da conta dona do script.
 *
 * Propriedades do script:
 *      SUPABASE_URL          https://SEU-PROJETO.supabase.co
 *      SUPABASE_SECRET_KEY   chave secreta do Supabase (a mesma usada na planilha)
 *      PAINEL_URL            https://gmap-seduc-pi.github.io/painel-os-climatizacao/
 *      RESPONDER_PARA        (opcional) e-mail que recebe as respostas das empresas
 *
 * Execute uma vez instalarGatilhoEmails() e autorize. A cada 5 minutos o script lê a fila de avisos
 * do painel, envia pelo Gmail e marca cada aviso como "Enviado". Se o envio falhar, tenta de novo
 * nas próximas rodadas; depois de 5 falhas, o aviso fica como "Falhou" (aparece na aba Empresas).
 * Limite do Gmail gratuito: cerca de 100 e-mails por dia, mais do que suficiente para o volume de O.S.
 */
function enviarAvisos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const painel = props.getProperty('PAINEL_URL') || '';
    const responder = props.getProperty('RESPONDER_PARA') || '';
    const cota = MailApp.getRemainingDailyQuota();
    if (cota < 1) { console.warn('Cota diária de e-mails esgotada; os avisos seguem na fila até amanhã.'); return; }
    const fila = chamarSupabase('emails_pendentes', { p_limite: Math.min(20, cota) }) || [];
    fila.forEach(m => {
      try {
        const corpo = 'Olá,\n\n' + m.assunto + '.\n\n' + (m.corpo || '') +
          '\n\nVeja os detalhes e registre o atendimento no Painel de O.S.: ' + painel +
          '\n\nGerência de Material e Patrimônio (GMAP) · SEDUC-PI\nMensagem automática do Painel de O.S. de Climatização.';
        const op = { name: 'GMAP · SEDUC-PI' };
        if (responder) op.replyTo = responder;
        MailApp.sendEmail(m.para, '[Painel de O.S.] ' + m.assunto, corpo, op);
        chamarSupabase('email_resultado', { p_id: m.id, p_ok: true, p_erro: null });
      } catch (e) {
        chamarSupabase('email_resultado', { p_id: m.id, p_ok: false, p_erro: String(e.message || e) });
      }
    });
    if (fila.length) console.log(`${fila.length} aviso(s) processado(s).`);
  } finally {
    lock.releaseLock();
  }
}

/** Cria o gatilho de 5 em 5 minutos (execute uma vez e autorize). */
function instalarGatilhoEmails() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'enviarAvisos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarAvisos').timeBased().everyMinutes(5).create();
  enviarAvisos();
}

/** Teste: envia um e-mail para a própria conta, para conferir a autorização. */
function testarEnvio() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[Painel de O.S.] Teste de envio', 'Se você recebeu esta mensagem, o envio de avisos está funcionando.');
}

/** Chama uma função do banco com a chave secreta. */
function chamarSupabase(funcao, corpo) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL'), chave = props.getProperty('SUPABASE_SECRET_KEY');
  if (!url || !chave) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas propriedades do script.');
  const headers = { apikey: chave };
  if (chave.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + chave;
  const resp = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + funcao, {
    method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(corpo), muteHttpExceptions: true
  });
  const codigo = resp.getResponseCode(), texto = resp.getContentText();
  if (codigo >= 300) {
    let msg = texto; try { msg = JSON.parse(texto).message || texto; } catch (e) {}
    throw new Error(`Supabase respondeu ${codigo}: ${String(msg).slice(0, 500)}`);
  }
  return texto ? JSON.parse(texto) : null;
}
