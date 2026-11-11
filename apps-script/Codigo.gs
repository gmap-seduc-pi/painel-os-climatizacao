/**
 * CONSOLIDADOR DE ORDENS DE SERVIÇO - 4 EMPRESAS
 * ------------------------------------------------
 * Copia os dados das 4 planilhas de origem para a aba "Consolidado"
 * desta planilha mestre, substituindo tudo a cada execução.
 *
 * CONFIGURE os itens dentro de CONFIG abaixo e a propriedade PLANILHAS_ORIGEM antes de rodar.
 *
 * Ajustes out/2026 (trechos marcados com "NOVO"):
 *  - a coluna "BAIXE O PDF" agora é copiada com o link, e não só com o texto;
 *  - o menu "Painel O.S." do painel de acompanhamento é criado junto com o menu "Atualizar";
 *  - leitura de link de chip do Drive pela API do Planilhas (serviço avançado Google Sheets API)
 *  - função diagnosticarPdf() para conferir como o link do PDF está gravado nas planilhas das empresas.
 */

const CONFIG = {
  // Cole aqui o ID de cada planilha de origem.
  // O ID é o trecho da URL entre /d/ e /edit
  // Ex: https://docs.google.com/spreadsheets/d/ESTE_TRECHO_AQUI/edit
  // Os IDs das planilhas das empresas ficam fora do código, nas Propriedades do script,
  // na propriedade PLANILHAS_ORIGEM (veja manual/IMPLANTACAO.md). Assim o código pode
  // ficar no GitHub sem expor os endereços das planilhas.

  nomeAbaOrigem: "OrdensServiço",   // nome da aba dentro de cada planilha de origem
  nomeAbaDestino: "Consolidado",    // aba que será criada/sobrescrita na planilha mestre

  cabecalhos: [
    "CRIADA EM", "PRAZO", "PRIORIDADE", "DIAS ABERTA",
    "STATUS", "DATA DO ATENDIMENTO", "Nº DA OS", "QTD. SPLITS",
    "DESCRIÇÃO DA O.S.", "ID SEI", "ENTIDADE SOLICITANTE", "GREº", "ENDEREÇO",
    "GOOGLE MAPS", "MUNICÍPIO", "ZONA", "BAIXE O PDF",
    "JUSTIFICATIVA DA EMPRESA", "OBSERVAÇÕES", "MOTIVO DO CANCELAMENTO","ESCOLA","INEP",
    "EMPRESA" // coluna extra adicionada por este script
  ],

  // NOVO (link do PDF): posição da coluna "BAIXE O PDF" (coluna Q = 17ª coluna).
  colunaPdf: 17,
};

/**
 * Função principal - roda manualmente ou via gatilho automático.
 */
function consolidarPlanilhas() {
  const planilhaMestre = SpreadsheetApp.getActiveSpreadsheet();
  let abaDestino = planilhaMestre.getSheetByName(CONFIG.nomeAbaDestino);

  if (!abaDestino) {
    abaDestino = planilhaMestre.insertSheet(CONFIG.nomeAbaDestino);
  }

  abaDestino.clear();
  abaDestino.getRange(1, 1, 1, CONFIG.cabecalhos.length).setValues([CONFIG.cabecalhos]);
  abaDestino.getRange("G:G").setNumberFormat("@");
  abaDestino.getRange("H:H").setNumberFormat("0");
  abaDestino.getRange("A:B").setNumberFormat("dd/MM/yyyy");
  abaDestino.getRange("F:F").setNumberFormat("dd/MM/yyyy");
  abaDestino.setFrozenRows(1);

  const planilhas = planilhasOrigem_();
  let todasAsLinhas = [];
  let todosOsLinks = []; // NOVO (link do PDF): um link (ou "") para cada linha importada
  let erros = [];

const statusCell = abaDestino.getRange(1, CONFIG.cabecalhos.length + 2);

  planilhas.forEach(function (origem, i) {
    statusCell.setValue(
      "⏳ Processando " +
      (i + 1) + "/" + planilhas.length +
      " - " + origem.nomeEmpresa
      );

        SpreadsheetApp.flush();

    try {
      const ss = SpreadsheetApp.openById(origem.id);
      const aba = ss.getSheetByName(CONFIG.nomeAbaOrigem);

      if (!aba) {
        erros.push("Aba '" + CONFIG.nomeAbaOrigem + "' não encontrada em: " + origem.nomeEmpresa);
        return;
      }

      const ultimaLinha = aba.getLastRow();
      if (ultimaLinha < 2) return; // só cabeçalho, sem dados

      const numColunas = CONFIG.cabecalhos.length - 1; // -1 pois EMPRESA não existe na origem
      const dados = aba.getRange(2, 1, ultimaLinha - 1, numColunas).getDisplayValues();

      // NOVO (link do PDF): lê o hiperlink da coluna do PDF, seja link inserido no texto
      // (Inserir > Link) ou fórmula =HYPERLINK("url"; "texto").
      const faixaPdf = aba.getRange(2, CONFIG.colunaPdf, ultimaLinha - 1, 1);
      const ricosPdf = faixaPdf.getRichTextValues();
      const formulasPdf = faixaPdf.getFormulas();
      let viaApi = null; // preenchido só se algum link não for encontrado pelo jeito simples

      // Filtra linhas pela coluna L (ENTIDADE SOLICITANTE, índice 10) preenchida
      // e adiciona coluna EMPRESA
      const INDICE_COLUNA_FILTRO = 10; // Coluna L = "ENTIDADE SOLICITANTE"
      dados.forEach(function (linha, i) {

  if (linha[0] instanceof Date) {
  Logger.log(
    "CRIADA EM: " +
    Utilities.formatDate(
      linha[0],
      Session.getScriptTimeZone(),
      "dd/MM/yyyy HH:mm:ss"
    )
  );
}

  const valorFiltro = linha[INDICE_COLUNA_FILTRO];
  const preenchida =
    valorFiltro !== "" &&
    valorFiltro !== null &&
    valorFiltro !== undefined;

  if (preenchida) {
    todasAsLinhas.push(linha.concat([origem.nomeEmpresa]));
    // NOVO (link do PDF): tenta o jeito simples; se não achar e a célula tem texto,
    // consulta a API do Google Planilhas (necessária para "chips" de arquivo do Drive).
    let urlPdf = extrairLinkPdf_(ricosPdf[i][0], formulasPdf[i][0]);
    if (!urlPdf && linha[CONFIG.colunaPdf - 1]) {
      if (viaApi === null) viaApi = linksPdfViaApi_(origem.id, CONFIG.nomeAbaOrigem, CONFIG.colunaPdf, 2, ultimaLinha - 1) || [];
      urlPdf = viaApi[i] || "";
    }
    todosOsLinks.push(urlPdf);
  }
});
    } catch (e) {
      erros.push("Erro ao acessar '" + origem.nomeEmpresa + "': " + e.message);
    }
  });

  if (todasAsLinhas.length > 0) {
    abaDestino.getRange(2, 1, todasAsLinhas.length, CONFIG.cabecalhos.length).setValues(todasAsLinhas);
    gravarLinksPdf_(abaDestino, todasAsLinhas, todosOsLinks); // NOVO (link do PDF)
  }

  // Registra horário da última atualização e eventuais erros numa célula de status
  
  if (erros.length > 0) {
    statusCell.setValue("⚠ Última atualização: " + new Date().toLocaleString("pt-BR") +
      " | ERROS: " + erros.join(" | "));
  } else {
    statusCell.setValue("✅ Última atualização: " + new Date().toLocaleString("pt-BR") +
      " | " + todasAsLinhas.length + " linhas importadas");
  }

  Logger.log("Consolidação concluída. Linhas: " + todasAsLinhas.length);
  if (erros.length > 0) Logger.log("Erros: " + erros.join(" | "));

  // Painel de O.S.: envia ao banco só se as 4 empresas foram lidas sem erro,
  // para não apagar do painel as O.S. de uma empresa que falhou nesta rodada.
  if (erros.length === 0 && todasAsLinhas.length > 0 && typeof sincronizar === "function") {
    SpreadsheetApp.flush();
    try {
      sincronizar();
    } catch (e) {
      Logger.log("Painel: falha na sincronização: " + e.message);
    }
  } else if (erros.length > 0) {
    Logger.log("Painel: sincronização não executada porque houve erro na consolidação.");
  }

  return todasAsLinhas.length;
}

/**
 * Lê a lista de planilhas das empresas da propriedade do script PLANILHAS_ORIGEM.
 * Formato: [{"id":"ID_DA_PLANILHA","nomeEmpresa":"NOME"}, ...]
 */
function planilhasOrigem_() {
  const bruto = PropertiesService.getScriptProperties().getProperty("PLANILHAS_ORIGEM");
  if (!bruto) throw new Error("Configure a propriedade do script PLANILHAS_ORIGEM com as planilhas das empresas.");
  const lista = JSON.parse(bruto);
  if (!Array.isArray(lista) || !lista.length) throw new Error("PLANILHAS_ORIGEM está vazia ou em formato inválido.");
  return lista;
}

/**
 * NOVO (link do PDF): devolve a URL do PDF de uma célula da planilha de origem,
 * ou "" quando a célula não tem link.
 */
function extrairLinkPdf_(rico, formula) {
  if (rico) {
    const direto = rico.getLinkUrl();
    if (direto) return direto;
    const trechos = rico.getRuns();
    for (let k = 0; k < trechos.length; k++) {
      const url = trechos[k].getLinkUrl();
      if (url) return url;
    }
  }
  // Fórmula =HYPERLINK("https://..."; "texto") ou com vírgula como separador
  const m = String(formula || "").match(/HYPERLINK\(\s*"([^"]+)"/i);
  return m ? m[1] : "";
}

/**
 * NOVO (link do PDF): lê os links da coluna do PDF pela API do Google Planilhas.
 * Pega o link do "chip" de arquivo do Drive (o que aparece ao digitar @), que o
 * SpreadsheetApp não entrega. Exige o serviço avançado "Google Sheets API" ativado
 * (Serviços > + > Google Sheets API). Devolve uma lista com uma URL (ou "") por linha,
 * ou null se o serviço não estiver ativado ou der erro.
 */
function linksPdfViaApi_(idPlanilha, nomeAba, coluna, primeiraLinha, quantidade) {
  if (typeof Sheets === "undefined") return null;
  try {
    const letra = letraDaColuna_(coluna);
    const faixa = "'" + String(nomeAba).replace(/'/g, "''") + "'!" +
      letra + primeiraLinha + ":" + letra + (primeiraLinha + quantidade - 1);
    const resp = Sheets.Spreadsheets.get(idPlanilha, {
      ranges: [faixa],
      fields: "sheets(data(rowData(values(hyperlink,chipRuns,textFormatRuns))))"
    });
    const dados = resp.sheets && resp.sheets[0] && resp.sheets[0].data && resp.sheets[0].data[0];
    const linhas = (dados && dados.rowData) || [];
    const urls = [];
    for (let i = 0; i < quantidade; i++) {
      const celula = linhas[i] && linhas[i].values && linhas[i].values[0];
      urls.push(urlDaCelulaApi_(celula));
    }
    return urls;
  } catch (e) {
    Logger.log("Sheets API: " + e.message);
    return null;
  }
}

function urlDaCelulaApi_(celula) {
  if (!celula) return "";
  if (celula.hyperlink) return celula.hyperlink;
  const chips = celula.chipRuns || [];
  for (let k = 0; k < chips.length; k++) {
    const c = chips[k].chip && chips[k].chip.richLinkProperties;
    if (c && c.uri) return c.uri;
  }
  const trechos = celula.textFormatRuns || [];
  for (let k = 0; k < trechos.length; k++) {
    const f = trechos[k].format;
    if (f && f.link && f.link.uri) return f.link.uri;
  }
  return "";
}

function letraDaColuna_(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * NOVO (link do PDF): regrava a coluna do PDF na aba Consolidado com texto + link.
 * Linhas sem link ficam só com o texto, como antes.
 */
function gravarLinksPdf_(abaDestino, linhas, links) {
  const idx = CONFIG.colunaPdf - 1;
  let algumLink = false;
  const ricos = linhas.map(function (linha, i) {
    const texto = String(linha[idx] || "");
    const url = links[i] || "";
    const b = SpreadsheetApp.newRichTextValue().setText(texto || (url ? "PDF" : ""));
    if (url) { b.setLinkUrl(url); algumLink = true; }
    return [b.build()];
  });
  if (algumLink) {
    abaDestino.getRange(2, CONFIG.colunaPdf, ricos.length, 1).setRichTextValues(ricos);
  }
}

/**
 * Cria um gatilho automático para rodar todos os dias às 7h.
 * Rode esta função UMA VEZ manualmente (Executar > criarGatilhoDiario)
 * para ativar a automação. Depois disso não precisa rodar de novo.
 */
function criarGatilhoDiario() {
  removerGatilhosExistentes();

  ScriptApp.newTrigger("consolidarPlanilhas")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log("Gatilho diário criado: rodará todos os dias por volta das 7h.");
}

/**
 * Cria um gatilho automático para rodar em intervalos curtos (quase contínuo).
 * Rode esta função UMA VEZ manualmente (Executar > criarGatilhoFrequente).
 *
 * Valores permitidos pelo Google para 'everyMinutes': 1, 5, 10, 15 ou 30.
 * Altere o número abaixo (MINUTOS) conforme a frequência desejada.
 */
function criarGatilhoFrequente() {
  const MINUTOS = 30; // troque para 1, 5, 10, 15 ou 30

  removerGatilhosExistentes();

  ScriptApp.newTrigger("consolidarPlanilhas")
    .timeBased()
    .everyMinutes(MINUTOS)
    .create();

  Logger.log("Gatilho frequente criado: rodará a cada " + MINUTOS + " minuto(s).");
}

/**
 * Remove todos os gatilhos existentes desta função, para não duplicar
 * (evita que o script rode 2x, 3x etc ao mesmo tempo por acúmulo de gatilhos).
 */
function removerGatilhosExistentes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "consolidarPlanilhas") {
      ScriptApp.deleteTrigger(t);
    }
  });
}
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Atualizar")
    .addItem("Atualizar Planilha", "executarConsolidacao")
    .addToUi();

  // Painel de O.S.: menu definido no arquivo Sincronizacao.gs.
  if (typeof menuPainel === "function") menuPainel();
}
function executarConsolidacao() {
  const ui = SpreadsheetApp.getUi();

  ui.alert(
    "Atualização",
    "A consolidação foi iniciada.\n\nClique em OK e aguarde a mensagem de confirmação.",
    ui.ButtonSet.OK
  );

  const total = consolidarPlanilhas();

  ui.alert(
    "✅ Finalizado!",
    total + " registros foram importados com sucesso.",
    ui.ButtonSet.OK
  );
}

/**
 * NOVO (link do PDF): diagnóstico. Rode manualmente (selecione diagnosticarPdf e clique em Executar)
 * e abra o "Registro de execução". Para as 3 primeiras linhas com PDF de cada empresa,
 * mostra o texto da célula, o link encontrado e a fórmula, se houver.
 */
function diagnosticarPdf() {
  planilhasOrigem_().forEach(function (origem) {
    try {
      const aba = SpreadsheetApp.openById(origem.id).getSheetByName(CONFIG.nomeAbaOrigem);
      if (!aba || aba.getLastRow() < 2) { Logger.log(origem.nomeEmpresa + ": aba vazia ou não encontrada"); return; }
      const faixa = aba.getRange(2, CONFIG.colunaPdf, aba.getLastRow() - 1, 1);
      const textos = faixa.getDisplayValues();
      const ricos = faixa.getRichTextValues();
      const formulas = faixa.getFormulas();
      const viaApi = linksPdfViaApi_(origem.id, CONFIG.nomeAbaOrigem, CONFIG.colunaPdf, 2, textos.length);
      if (viaApi === null) Logger.log(origem.nomeEmpresa + ": Google Sheets API NÃO ativada (ou deu erro)");
      let mostradas = 0;
      for (let i = 0; i < textos.length && mostradas < 3; i++) {
        if (!textos[i][0]) continue;
        mostradas++;
        Logger.log(origem.nomeEmpresa + " | linha " + (i + 2) +
          " | texto: " + textos[i][0] +
          " | link encontrado: " + (extrairLinkPdf_(ricos[i][0], formulas[i][0]) || "NENHUM") +
          " | fórmula: " + (formulas[i][0] || "-") +
          " | via API: " + ((viaApi && viaApi[i]) || "NENHUM"));
      }
      if (!mostradas) Logger.log(origem.nomeEmpresa + ": nenhuma célula preenchida na coluna do PDF");
    } catch (e) {
      Logger.log(origem.nomeEmpresa + ": erro " + e.message);
    }
  });
}