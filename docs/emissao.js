/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Módulo de emissão: nova O.S., aprovação da gerência, revisão, atendimento, problema (status "Stand by" no banco), cancelamento,
   empresas (área e e-mail), histórico e auditoria da base de entidades.
   Todas as regras são conferidas no banco; esta tela só oferece as ações que o perfil pode fazer. */
window.iniciarEmissao = function (P) {
  const { CTX, $, esc, fmt, tc, nf, EMPN, PRIOS, SERV, SERVN, STB, PRB, ORIG, REF, GMAP, TEC, EQUIPE } = P;
  const MED = P.MED;   // itens do contrato (medição)
  const sb = CTX.sb;
  const EMPRESA = P.perfil.startsWith("emp:") ? P.perfil.slice(4) : null;
  const DIAS = { Urgente: 2, Alta: 10, Normal: 30 };
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const somaDias = (iso, n) => { const d = new Date(String(iso || "").slice(0, 10) + "T12:00:00"); if (isNaN(d)) return ""; d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };   // data ausente (O.S. antiga): sem cálculo
  const quando = s => s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const ha = s => { const h = Math.max(0, (Date.now() - new Date(s)) / 36e5); return h < 1 ? "há menos de 1 h" : h < 48 ? `há ${Math.floor(h)} h` : `há ${Math.floor(h / 24)} dias`; };
  const greCurta = g => String(g || "").replace(/^0?(\d+)ª - (.*)$/, (m, a, b) => a + "ª " + tc(b));
  const ents = () => CTX.entidades || [];
  const entPorId = id => ents().find(e => e.id === id);
  const emps = () => CTX.empresasCad || [];
  const atende = (emp, ent) => !!emp && !!ent && ((emp.gres || []).includes(ent.gre) || (emp.municipios || []).includes(ent.municipio));
  const planilhaAtiva = () => !!(CTX.config && CTX.config.planilha_ativa);
  const soPlanilha = o => o.legado && planilhaAtiva();   // O.S. antiga, ainda atualizada pela planilha
  const aguardando = () => P.solic().filter(o => o.status === "Aguardando aprovação");
  const emRevisao = () => P.todos().filter(o => o.revisao);
  const comProblema = () => P.todos().filter(o => o.status === "Stand by").sort((a, b) => String(a.problema_em || a.criada || "").localeCompare(String(b.problema_em || b.criada || "")));

  // ---------- avisos e diálogos ----------
  function aviso(msg, tipo) {
    let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.className = "toast on " + (tipo || ""); t.textContent = msg;
    clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 4200);
  }
  /* Diálogo com campos. "enviar" recebe os valores e devolve null (deu certo) ou a mensagem de erro.
     Não usa o envio nativo de formulário: funciona também em páginas incorporadas ou protegidas. */
  function dialogo({ titulo, texto, campos, botao, perigo, enviar }) {
    let d = $("dlg"); if (!d) { d = document.createElement("div"); d.id = "dlg"; d.className = "dlg"; document.body.appendChild(d); }
    const campo = c => {
      const lab = `<span>${esc(c.rot)}${c.obrig ? ' <i class="obr">obrigatório</i>' : ""}</span>`;
      const dica = c.dica ? `<small>${esc(c.dica)}</small>` : "";
      if (c.tipo === "textarea") return `<label class="fl">${lab}<textarea id="dc_${c.id}" rows="${c.linhas || 3}" maxlength="${c.max || 1000}">${esc(c.valor || "")}</textarea>${dica}</label>`;
      if (c.tipo === "select") return `<label class="fl"${c.oculto ? " hidden" : ""}>${lab}<select id="dc_${c.id}"><option value="">Selecione</option>${c.opcoes.map(o => { const v = typeof o === "object" ? o.v : o, t = typeof o === "object" ? o.t : o;
        return `<option value="${esc(v)}" ${v === c.valor ? "selected" : ""}>${esc(t)}</option>`; }).join("")}</select>${dica}</label>`;
      if (c.tipo === "checks") return `<div class="fl" id="dc_${c.id}"${c.oculto ? " hidden" : ""}>${lab}${c.opcoes.map(o => `<label class="chk1"><input type="checkbox" value="${esc(o.valor)}" ${o.marcado ? "checked" : ""}><span>${o.rotulo}</span></label>`).join("")}${dica}</div>`;
      if (c.tipo === "anexo") return UI.campoAnexo(c.id, lab, c.dica);
      if (c.tipo === "custom") return `<div class="fl" id="dc_${c.id}"${c.oculto ? " hidden" : ""}>${lab}${c.html}${dica}</div>`;
      if (c.tipo === "file") return `<label class="fl">${lab}<input type="file" id="dc_${c.id}" accept="${c.aceita || ""}">${dica}</label>`;
      return `<label class="fl"${c.oculto ? " hidden" : ""}>${lab}<input type="${c.tipo || "text"}" id="dc_${c.id}" value="${esc(c.valor || "")}" ${c.maxData ? `max="${c.maxData}"` : ""} ${c.max ? `maxlength="${c.max}"` : ""}>${dica}</label>`;
    };
    d.innerHTML = `<div class="dlgp" role="dialog" aria-modal="true" aria-labelledby="dTit" id="dBox"><h2 id="dTit">${esc(titulo)}</h2>${texto ? `<div class="sub">${texto}</div>` : ""}
      ${(campos || []).map(campo).join("")}<div class="lerr" id="dErr"></div>
      <div class="dlgb"><button type="button" class="btn" id="dCanc">Voltar</button><button type="submit" class="btn ${perigo ? "no" : "pri"}" id="dOk">${esc(botao || "Confirmar")}</button></div></div>`;
    d.classList.add("on");
    const fechar = () => d.classList.remove("on");
    $("dCanc").onclick = fechar;
    d.onclick = e => { if (e.target === d) fechar(); };
    const valores = () => { const v = {}; (campos || []).forEach(c => { const el = $("dc_" + c.id); v[c.id] = c.tipo === "custom" ? c.ler(el) : c.tipo === "anexo" ? UI.valorAnexo(el) : c.tipo === "file" ? el.files[0] || null : c.tipo === "checks" ? [...el.querySelectorAll("input:checked")].map(i => i.value) : el.value.trim(); }); return v; };
    (campos || []).forEach(c => { if (c.tipo === "anexo") UI.ligarAnexo($("dc_" + c.id)); if (c.tipo === "custom" && c.ligar) c.ligar($("dc_" + c.id)); });
    (campos || []).forEach(c => { if (c.aoMudar) $("dc_" + c.id).addEventListener("change", () => c.aoMudar(valores())); });
    const primeiro = d.querySelector("textarea,select,input:not([type=checkbox]):not([type=file])"); if (primeiro) setTimeout(() => primeiro.focus(), 50);
    UI.aoEnviar($("dBox"), async () => {
      const v = valores();
      const visivel = c => { const el = $("dc_" + c.id); const l = el && el.closest(".fl"); return !(l && l.hidden); };
      const falta = (campos || []).filter(c => c.obrig && visivel(c) && (Array.isArray(v[c.id]) ? !v[c.id].length : !v[c.id]));
      if (falta.length) return UI.alerta({ titulo: "Preencha antes de continuar", itens: falta.map(c => c.rot), campos: falta.map(c => $("dc_" + c.id)) });
      const curto = (campos || []).filter(c => c.min && v[c.id] && v[c.id].length < c.min);
      if (curto.length) return UI.alerta({ titulo: "Texto muito curto", itens: curto.map(c => `${c.rot}: escreva pelo menos ${c.min} caracteres.`), campos: curto.map(c => $("dc_" + c.id)) });
      $("dOk").disabled = true; $("dErr").textContent = "";
      let e;
      try { e = await enviar(v); } catch (x) { e = String(x.message || x); }
      if ($("dOk")) $("dOk").disabled = false;
      if (e === false) return;   // a própria ação desistiu (ex.: não confirmou): o diálogo continua aberto
      if (e) { $("dErr").textContent = e; return UI.alerta({ titulo: "Não foi possível concluir", itens: e }); }
      fechar();
    });
  }
  UI.dialogo = dialogo; UI.aviso = aviso;
  // O.S. assinada exigida só nas O.S. emitidas a partir da data configurada pela gerência
  const exigePdf = o => !!o.criada && o.criada >= ((CTX.config && CTX.config.pdf_obrigatorio_desde) || "2026-12-01");
  const DICA_ANEXO = "PDF ou fotos de cada página (no celular, \"Tirar foto\" abre a câmera). Até 10 MB.";
  async function subirAnexo(o, anexo) {
    let arq; try { arq = await UI.pdfDoAnexo(anexo); } catch (e) { return { erro: String(e.message || e) }; }
    const caminho = `${o.id}/${Date.now()}.pdf`;
    const up = await sb.storage.from("os-assinadas").upload(caminho, arq.blob, { contentType: "application/pdf" });
    return up.error ? { erro: "Não foi possível enviar o arquivo: " + up.error.message } : { caminho, nome: arq.nome };
  }
  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args);
    return error ? { erro: error.message } : { data };
  }
  async function depois(o, msg) { await P.recarregar(); aviso(msg, "ok"); if (o) P.openDet(o.id); }

  // ---------- visão geral: faixa do dia ----------
  function faixaHoje(L) {
    const hoje = L.filter(o => o.criada === REF && o.status !== "Cancelada").length;
    const ag = aguardando(), rev = emRevisao(), sb_ = L.filter(o => o.status === "Stand by");
    const itens = [{ v: hoje, l: EMPRESA ? "O.S. recebidas hoje" : "O.S. geradas hoje", h: EQUIPE && ag.length ? `+ ${ag.length} aguardando aprovação` : "emitidas na data de hoje", c: "info", go: () => P.verFila({ de: REF, ate: REF }) }];
    if (EQUIPE && !planilhaAtiva()) {
      const velha = ag.map(o => o.solicitado_em).sort()[0];
      itens.push({ v: ag.length, l: "Aguardando aprovação", h: velha ? "a mais antiga " + ha(velha) : "nenhuma pendente", c: ag.length ? "warn" : "", go: () => P.setView("aprov") });
      itens.push({ v: rev.length, l: "Em revisão pela GMAP", h: "fora das contagens até a revisão", c: rev.length ? "rev" : "", go: () => P.setView("aprov") });
    }
    const sc = semComprovante().filter(o => !EMPRESA || o.emp === EMPRESA);
    if ((GMAP || EMPRESA) && sc.length) itens.push({ v: sc.length, l: "Sem a O.S. assinada", h: EMPRESA ? "atendidas pela planilha: anexe o PDF" : "atendidas pela planilha, aguardando o PDF", c: "warn", go: () => P.verFila({ semComp: 1 }) });
    if (GMAP && observando()) { const pn = pendAbertas(); itens.push({ v: pn.length, l: "Lançamentos na planilha", h: pn.length ? `${pn.filter(x => x.tipo === "nova").length} O.S. novas · ${pn.filter(x => x.tipo === "mudanca").length} mudanças` : "nada a conferir", c: pn.length ? "warn" : "", go: () => P.setView("planilha") }); }
    itens.push({ v: sb_.length, l: "Com problema", h: EQUIPE ? "informado pela empresa ou pela GMAP" : "o prazo continua correndo", c: sb_.length ? "warn" : "", go: () => EQUIPE ? P.setView("aprov") : P.verFila({ status: "Stand by" }) });
    $("hoje").innerHTML = (EQUIPE && planilhaAtiva() ? `<div class="faixa info fase"><b>Fase planilha.</b> As O.S. continuam sendo emitidas e atualizadas na planilha geral e chegam aqui pela sincronização. A emissão pelo sistema será ativada na virada; até lá, já dá para cadastrar empresas, preparar o modelo e aprovar os técnicos.</div>` : "") + itens.map((x, i) => `<button class="hj ${x.c}${x.v ? "" : " zero"}" data-i="${i}" title="${esc(x.l + ": " + x.h)}"><b>${nf(x.v)}</b><span>${x.l}</span><small>${esc(x.h)}</small></button>`).join("");
    $("hoje").querySelectorAll(".hj").forEach(b => b.onclick = () => itens[+b.dataset.i].go());
  }
  const observando = () => !planilhaAtiva() && !!(CTX.config && CTX.config.observar_planilha);
  // O.S. cancelada fica só para consulta: lançamento da planilha nela não conta nem pede decisão
  const osDaPend = x => x.tipo === "mudanca" ? P.todos().find(o => String(o.id) === String(x.os_id)) : null;
  const pendCancelada = x => (osDaPend(x) || {}).status === "Cancelada";
  const pendTodas = () => (CTX.pendencias || []).filter(x => x.situacao === "aberta");
  const pendAbertas = () => pendTodas().filter(x => !pendCancelada(x));
  const pendCanceladas = () => pendTodas().filter(pendCancelada);
  const semComprovante = () => P.todos().filter(o => o.comprovante_pendente && o.status === "Atendida");
  const pendDaOS = o => pendAbertas().find(x => x.tipo === "mudanca" && String(x.os_id) === String(o.id));
  // mudança feita na planilha: aplicar no sistema (gerência) ou manter o sistema (equipe, com justificativa)
  function acaoPendencia(p, a, o) {
    if (!p) return;
    const voltar = async msg => { await P.recarregar(); aviso(msg, "ok"); if (o) P.openDet(o.id); };
    const os_ = osDaPend(p) || o;
    if (os_ && os_.status === "Cancelada") return UI.alerta({ titulo: "O.S. cancelada", itens: `A O.S. ${p.numero} está cancelada e fica só para consulta. A planilha não altera mais nada nela.` });
    // O.S. atendida não pode ser cancelada, nem pela planilha
    const bloqueado = d => d.campo === "Status" && os_ && os_.status === "Atendida" && (p.dados || {}).status === "Cancelada";
    const difs = (p.diferencas || []).filter(d => a !== "aplicar" || !bloqueado(d));
    if (a === "aplicar" && !difs.length) return UI.alerta({ titulo: "O.S. atendida não pode ser cancelada", itens: `A planilha marca a O.S. ${p.numero} como cancelada, mas ela já está atendida e não pode ser cancelada (nem pela planilha). Use "Manter o sistema" e registre o motivo.` });
    if (a === "aplicar") return dialogo({ titulo: `Aplicar no sistema a mudança da planilha (O.S. ${p.numero})`, botao: "Aplicar no sistema",
      texto: "Os campos marcados passam a ter o valor da planilha e o valor anterior fica no histórico da O.S. O que ficar desmarcado continua aparecendo como diferença."
        + ((p.diferencas || []).some(bloqueado) ? " <b>O Status \"Cancelada\" não aparece aqui: O.S. atendida não pode ser cancelada.</b>" : ""),
      campos: [{ id: "campos", rot: "Campos a aplicar", tipo: "checks", obrig: true,
                 opcoes: difs.map(d => ({ valor: d.campo, marcado: true, rotulo: `<b>${esc(d.campo)}:</b> ${esc(d.sistema || "vazio")} → <span class="novo">${esc(d.planilha || "vazio")}</span>` })) },
               { id: "obs", rot: "Observação (opcional)", tipo: "textarea", linhas: 2 }],
      enviar: async v => { const r = await rpc("pendencia_aplicar", { p_id: p.id, p_campos: v.campos, p_obs: v.obs || null }); if (r.erro) return r.erro; await voltar(`Mudança aplicada na O.S. ${p.numero}.`); return null; } });
    return dialogo({ titulo: `Manter o sistema (O.S. ${p.numero})`, botao: "Manter o sistema",
      texto: "O sistema fica como está e a diferença deixa de aparecer. Se a planilha mudar de novo, o aviso volta.",
      campos: [{ id: "obs", rot: "Por que o valor da planilha não vale", tipo: "textarea", obrig: true, min: 5 }],
      enviar: async v => { const r = await rpc("pendencia_decidir", { p_id: p.id, p_acao: "manter", p_obs: v.obs }); if (r.erro) return r.erro; await voltar("Registrado: o sistema foi mantido."); return null; } });
  }
  function contarAprov() {
    const tp = document.querySelector('.tab[data-v="planilha"]'); if (tp) { const n = pendAbertas().length + (GMAP ? semComprovante().length : 0); tp.innerHTML = "Planilha" + (n ? `<span class="cnt">${n}</span>` : ""); }
    const t = document.querySelector('.tab[data-v="aprov"]'); if (!t) return;
    const nProb = EQUIPE ? comProblema().length : 0;
    const n = (GMAP ? aguardando().length + emRevisao().length : P.solic().filter(o => o.solicitado_por === CTX.uid && o.status === "Devolvida").length + (TEC ? emRevisao().length : 0)) + nProb;
    t.innerHTML = "Aprovações" + (n ? `<span class="cnt">${n}</span>` : "");
  }

  // ---------- formulário: nova O.S., corrigir solicitação, editar O.S. emitida ----------
  const MOD = () => CTX.modelo || { motivos: [], ambientes: [], motivos_cancelamento: [], perguntas: [], motivo_outro: true, campos: { ambientes: {}, responsavel: {}, descricao: {} }, versao: 1 };
  const ativos = L => (L || []).filter(x => x.ativo).map(x => x.texto).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const contatoDe = id => (CTX.contatos || []).find(c => c.entidade_id === id);
  const CHAVE_RASC = "os-rascunho-" + CTX.uid;
  let F = {}, rascunho = null;
  try { rascunho = JSON.parse(localStorage.getItem(CHAVE_RASC) || "null"); } catch (e) { rascunho = null; }
  function guardarRasc() { try { rascunho ? localStorage.setItem(CHAVE_RASC, JSON.stringify(rascunho)) : localStorage.removeItem(CHAVE_RASC); } catch (e) {} marcarAbaNova(); }
  function marcarAbaNova() { const t = document.querySelector('.tab[data-v="nova"]'); if (t) t.innerHTML = "Nova O.S." + (rascunho ? ' <span class="rasc">rascunho</span>' : ""); }

  // dados do formulário a partir de uma O.S. existente
  const dadosDe = o => ({ entidade_id: o.entidade_id, empresa: o.emp, prioridade: o.prio, servicos: o.serv || [], splits: o.splits, observacoes: o.obs || "",
    origem: o.origem || "", origem_num: o.origem_num || "", fora_just: o.fora_just || "",
    motivos: (o.motivos || []).filter(m => !/^Outro: /.test(m)), motivo_outro: ((o.motivos || []).find(m => /^Outro: /.test(m)) || "").replace(/^Outro: /, ""),
    ambientes: (o.ambientes || []).map(a => /^Outro: /.test(a.ambiente) ? { ambiente: "Outro", outro: a.ambiente.replace(/^Outro: /, ""), splits: a.splits } : { ambiente: a.ambiente, outro: "", splits: a.splits }),
    resp_nome: o.resp_nome || "", resp_contato: o.resp_contato || "",
    respostas: Object.fromEntries((o.respostas || []).map(r => [r.id, r.valor])) });

  // dados de uma O.S. lançada na planilha, para o formulário de importação
  function dadosDaPlanilha(p) {
    const d = p.dados || {}, porInep = d.inep ? ents().filter(e => e.ativo && e.inep === String(d.inep)) : [];
    const desc = norm(d.descricao);
    const servicos = SERV.filter(s => desc.includes(norm(s)) || desc.includes(norm(SERVN[s] || "")));
    return { entidade_id: porInep.length === 1 ? porInep[0].id : null, empresa: emps().some(e => e.nome === p.empresa) ? p.empresa : "",
      prioridade: PRIOS.includes(d.prioridade) ? d.prioridade : "", servicos, splits: d.splits ?? null,
      observacoes: [d.observacoes].filter(Boolean).join("\n"), origem: d.id_sei ? "sei" : "", origem_num: d.id_sei || "",
      motivos: [], motivo_outro: "", ambientes: [], resp_nome: "", resp_contato: "", respostas: {}, fora_just: "" };
  }

  // partes do formulário que também aparecem na pré-visualização do modelo
  function htmlMotivos(m, pre) {
    return `<div class="chips-sel" id="nMot">${ativos(m.motivos).map(t => `<label><input type="checkbox" class="nMot" value="${esc(t)}" ${pre ? "" : ""}><span>${esc(t)}</span></label>`).join("")}
      ${m.motivo_outro ? `<label><input type="checkbox" id="nMotO"><span>Outro</span></label>` : ""}</div>
      ${m.motivo_outro ? `<input id="nMotOT" class="busca" placeholder="Descreva o outro motivo" maxlength="200" hidden>` : ""}`;
  }
  function htmlPergunta(q) {
    const lab = `${esc(q.rotulo)}${q.obrigatorio ? ' <i class="obr">obrigatório</i>' : ""}`, aj = q.ajuda ? `<small>${esc(q.ajuda)}</small>` : "", id = "q_" + q.id;
    if (q.tipo === "textolongo") return `<label class="fl"><span>${lab}</span><textarea id="${id}" rows="3" maxlength="2000"></textarea>${aj}</label>`;
    if (q.tipo === "numero") return `<label class="fl"><span>${lab}</span><input type="number" id="${id}" inputmode="decimal">${aj}</label>`;
    if (q.tipo === "data") return `<label class="fl"><span>${lab}</span><input type="date" id="${id}">${aj}</label>`;
    if (q.tipo === "unica") return `<label class="fl"><span>${lab}</span><select id="${id}"><option value="">Selecione</option>${q.opcoes.map(o => `<option>${esc(o)}</option>`).join("")}</select>${aj}</label>`;
    if (q.tipo === "multipla") return `<div class="fl" id="${id}"><span>${lab}</span><div class="chips-sel">${q.opcoes.map(o => `<label><input type="checkbox" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>${aj}</div>`;
    if (q.tipo === "simnao") return `<div class="fl" id="${id}"><span>${lab}</span><div class="seg">${["Sim", "Não"].map(o => `<label><input type="radio" name="${id}" value="${o}"><span>${o}</span></label>`).join("")}</div>${aj}</div>`;
    return `<label class="fl"><span>${lab}</span><input id="${id}" maxlength="300">${aj}</label>`;
  }
  const valorPergunta = q => {
    const el = $("q_" + q.id); if (!el) return "";
    if (q.tipo === "multipla") return [...el.querySelectorAll("input:checked")].map(i => i.value);
    if (q.tipo === "simnao") return (el.querySelector("input:checked") || {}).value || "";
    return el.value.trim();
  };
  function porValorPergunta(q, v) {
    const el = $("q_" + q.id); if (!el || v == null) return;
    if (q.tipo === "multipla") el.querySelectorAll("input").forEach(i => i.checked = (v || []).includes(i.value));
    else if (q.tipo === "simnao") el.querySelectorAll("input").forEach(i => i.checked = i.value === v);
    else el.value = v;
  }

  // edição de O.S. antiga (veio da planilha) ou sem escola ligada à base: mostra os dados atuais como referência
  function dadosAtuais(o) {
    const L = [["Escola / entidade", o.escola], ["INEP", o.inep], ["Município", o.mun], ["Endereço", o.end], ["Serviço", o.desc], ["Qtd. de splits", o.splits], ["Descrição / observações", o.obs]]
      .filter(x => x[1] != null && String(x[1]).trim() !== "");
    return `<div class="faixa info datual"><b>Dados atuais desta O.S.</b>${o.legado ? " (veio da planilha geral; alguns campos do formulário não existiam nela)" : ""}:
      <dl>${L.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join("")}</dl>
      <div class="mun">Use estes dados para preencher o formulário abaixo. O que mudar fica registrado no histórico, com o valor anterior e o novo.</div></div>`;
  }
  // sugere a escola da base: pelo INEP (se só uma bater, já seleciona) ou pelo começo do nome
  function sugerirEntidade(o) {
    const busca = $("nEnt"); if (!busca || F.ent) return;
    const inep = String(o.inep || "").replace(/\D/g, "");
    const porInep = inep.length >= 6 ? ents().filter(e => e.ativo && String(e.inep || "").replace(/\D/g, "") === inep) : [];
    if (porInep.length === 1) { F.ent = porInep[0]; mostrarEnt(); const s = $("nEntSel"); if (s) s.insertAdjacentHTML("beforeend", '<div class="mun">Escola encontrada na base pelo INEP da O.S. Confira antes de salvar.</div>'); return; }
    const nome = String(o.escola || "").split(/[\/(\-–]/)[0].trim().split(/\s+/).slice(0, 4).join(" ");
    if (nome.length >= 3) { busca.value = nome; busca.oninput && busca.oninput(); }
  }
  function renderNova(arg) {
    if (!EQUIPE) return;
    const modo = arg && arg.modo || "nova", o = arg && arg.o, pend = arg && arg.pend;
    if (modo === "editar" && !EQUIPE) return;
    const m = MOD();
    let ini = o ? dadosDe(o) : pend ? dadosDaPlanilha(pend) : null, recuperado = null;
    if (modo === "nova" && rascunho) { ini = rascunho.dados; recuperado = rascunho.salvo_em; }
    F = { modo, o, pend, ent: ini ? entPorId(ini.entidade_id) : null, sujo: false, pronto: false, respAuto: null };
    const numUsado = pend && P.todos().concat(P.solic()).some(x => x.numero === pend.numero);
    const tit = modo === "editar" ? `Editar O.S. nº ${o.os}` : modo === "reenviar" ? `Corrigir a solicitação nº ${o.os}` : modo === "importar" ? `Importar a O.S. ${pend.numero} da planilha` : "Nova O.S.";
    const exp = modo === "editar" ? "A empresa recebe um aviso com o que mudou. Se a prioridade mudar, o prazo é recalculado a partir da data de emissão. Tudo fica no histórico."
      : modo === "importar" ? `Os dados da planilha já estão preenchidos. Confira, complete o que falta (motivo, origem, ambientes) e envie. ${numUsado ? `O número ${esc(pend.numero)} já existe no sistema: esta O.S. vai receber um número novo e o da planilha fica registrado.` : `O número ${esc(pend.numero)} será mantido.`} A data de criação e o prazo da planilha (${fmt(pend.dados.criada_em) || "sem data"} · prazo ${fmt(pend.dados.prazo) || "a calcular"}) também são mantidos.` + (GMAP ? " Como gerência, a O.S. é emitida na hora." : " Depois vai para a aprovação da gerência.")
      : GMAP ? "Como gerência, a O.S. é emitida na hora: o número é gerado e o prazo começa hoje. A empresa recebe o aviso por e-mail."
      : "O número da O.S. é gerado no envio. A gerência aprova a emissão e o prazo só começa a contar na aprovação.";
    const pergs = m.perguntas.filter(q => q.ativo);
    $("v-nova").innerHTML = `<div class="card form" id="fNova">
      <h3>${esc(tit)}</h3><div class="d">${exp}</div>
      ${recuperado ? `<div class="faixa info" id="nRascAviso"><b>Rascunho recuperado</b> (salvo em ${quando(recuperado)}). Continue de onde parou. <button type="button" class="lnk" id="nRascDesc">Descartar rascunho</button></div>` : ""}
      ${o && o.revisao ? `<div class="faixa rev"><b>${o.revisao_perfil === "gmap" ? "Pedido da gerência" : "Sugestão da revisão"} (${esc(o.revisao_nome || "GMAP")}):</b> ${esc(o.revisao_sugestao || "")}</div>` : ""}
      ${o && modo === "editar" && o.status === "Stand by" ? `<div class="faixa warn"><b>Problema informado:</b> ${esc(o.standby_motivo || "")}. Corrigir a O.S. não resolve o problema sozinho: depois de salvar, marque "Problema resolvido" se for o caso.</div>` : ""}
      ${o && modo === "editar" && (o.legado || !o.entidade_id) ? dadosAtuais(o) : ""}
      ${o && o.status === "Devolvida" ? `<div class="faixa bad"><b>Devolvida pela gerência:</b> ${esc(o.devolucao_obs || "")}</div>` : ""}
      ${pend ? `<div class="faixa info"><b>Na planilha:</b> ${esc(pend.numero)} · ${esc(EMPN[pend.empresa] || pend.empresa)} · ${esc(tc(pend.dados.escola || ""))} (INEP ${esc(pend.dados.inep || "não informado")}) · ${esc(pend.dados.prioridade || "")} · ${esc(pend.dados.descricao || "")}${pend.dados.splits != null ? " · " + pend.dados.splits + " splits" : ""}${pend.dados.id_sei ? " · SEI " + esc(pend.dados.id_sei) : ""}${pend.dados.observacoes ? `<div class="mun">${esc(pend.dados.observacoes)}</div>` : ""}${!ini.entidade_id ? `<div><b>Escola não encontrada na base pelo INEP: escolha abaixo.</b></div>` : ""}</div>` : ""}
      <div class="fgrid">
        <div class="fcol full" id="bEnt"><label class="fl"><span>1. Escola ou entidade <i class="obr">obrigatório</i></span>
          <input id="nEnt" placeholder="Digite o nome, o INEP ou o município" autocomplete="off"></label>
          <div id="nEntRes" class="entres" hidden></div><div id="nEntSel"></div><div id="nDup"></div></div>
        <div class="fcol"><label class="fl"><span>2. Empresa <i class="obr">obrigatório</i></span><select id="nEmp"></select></label><div id="nFora"></div></div>
        <div class="fcol" id="bPrio"><span class="flt">3. Prioridade <i class="obr">obrigatório</i></span>
          <div class="seg" id="nPrio">${PRIOS.map(p => `<label><input type="radio" name="nPrio" value="${p}"><span>${p}<small>${DIAS[p]} dias</small></span></label>`).join("")}</div>
          <div class="mun" id="nPrazo"></div></div>
        <div class="fcol" id="bServ"><span class="flt">4. Tipo de serviço <i class="obr">obrigatório</i></span>
          <div class="chks">${SERV.map(s => `<label><input type="checkbox" class="nServ" value="${s}"> ${SERVN[s]}</label>`).join("")}</div></div>
        <div class="fcol"><label class="fl"><span>Quantidade de splits</span><input type="number" id="nSplits" min="0" max="500" step="1" inputmode="numeric"></label><div class="mun" id="nSplitsN"></div></div>
        <div class="fcol full" id="bMot"><span class="flt">5. Motivo da O.S. <i class="obr">obrigatório</i> <small class="mun">marque um ou mais</small></span>${htmlMotivos(m)}</div>
        <div class="fcol full" id="bAmb"><span class="flt">6. Ambientes ${m.campos.ambientes.obrigatorio ? '<i class="obr">obrigatório</i>' : '<small class="mun">opcional</small>'} <small class="mun">e a quantidade de splits em cada um</small></span>
          <div id="nAmb" class="amb"></div><button type="button" class="btn" id="nAmbAdd">+ Adicionar ambiente</button></div>
        <div class="fcol full" id="bResp"><span class="flt">7. Responsável pela entidade ${m.campos.responsavel.obrigatorio ? '<i class="obr">obrigatório</i>' : '<small class="mun">opcional</small>'}</span>
          <div class="fgrid2"><label class="fl"><span>Nome</span><input id="nRespN" maxlength="120" placeholder="Ex.: Maria Lima (diretora)"></label>
          <label class="fl"><span>Telefone ou e-mail</span><input id="nRespC" maxlength="120" placeholder="(86) 99999-9999"></label></div><div class="mun" id="nRespNota"></div></div>
        <div class="fcol full"><label class="fl"><span>8. Descrição do problema ou do serviço ${m.campos.descricao.obrigatorio ? '<i class="obr">obrigatório</i>' : ""}</span><textarea id="nObs" rows="3" maxlength="2000" placeholder="O que a empresa precisa saber para executar"></textarea></label></div>
        <div class="fcol"><label class="fl"><span>9. Origem da demanda <i class="obr">obrigatório</i></span><select id="nOrig"><option value="">Selecione</option>
          ${Object.entries(ORIG).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></div>
        <div class="fcol"><label class="fl"><span id="nOrigNL">Número</span><input id="nOrigN" maxlength="40"></label></div>
        ${pergs.length ? `<div class="fcol full"><span class="flt">Informações adicionais</span><div class="fgrid2">${pergs.map(htmlPergunta).join("")}</div></div>` : ""}
        ${modo === "editar" ? `<div class="fcol full"><label class="fl"><span>Motivo da edição <i class="obr">obrigatório</i></span><textarea id="nMotivo" rows="2" maxlength="500"></textarea></label></div>` : ""}
      </div>
      <div class="dlgb"><button type="button" class="btn" id="nCanc">${modo === "nova" ? "Limpar formulário" : "Cancelar"}</button>
        <button type="button" class="btn pri" id="nEnv">${modo === "editar" ? "Salvar alterações" : modo === "reenviar" ? "Reenviar para aprovação" : modo === "importar" ? (GMAP ? "Importar e emitir" : "Importar e enviar para aprovação") : GMAP ? "Emitir O.S." : "Enviar para aprovação"}</button></div></div>`;
    // busca da entidade
    const busca = $("nEnt"), res = $("nEntRes");
    if (modo === "editar" && o && !F.ent) setTimeout(() => sugerirEntidade(o), 0);
    busca.oninput = () => {
      const q = norm(busca.value); if (q.length < 2) { res.hidden = true; return; }
      const termos = q.split(/\s+/);
      const achou = ents().filter(e => e.ativo && termos.every(t => norm(e.nome + " " + e.inep + " " + e.municipio).includes(t))).slice(0, 12);
      res.hidden = false;
      res.innerHTML = achou.length ? achou.map(e => `<button type="button" data-id="${e.id}"><b>${esc(tc(e.nome))}</b>
        <span class="mun">${esc(tc(e.municipio || "Município não informado"))} · ${esc(greCurta(e.gre))} · ${e.inep && e.inep !== "S/INEP" ? "INEP " + esc(e.inep) : "sem INEP"}</span>
        <span class="badge ${e.tipo === "escola" ? "b-info" : "b-gray"}">${e.tipo === "escola" ? "Escola" : "Outra entidade"} · ${esc(e.tipologia)}</span></button>`).join("")
        : `<div class="empty">Nada encontrado. Confira a grafia ou procure pelo INEP.</div>`;
      res.querySelectorAll("button").forEach(b => b.onclick = () => { F.ent = entPorId(b.dataset.id); res.hidden = true; busca.value = ""; mostrarEnt(true); sujar(); });
    };
    $("nEmp").onchange = mostrarEmp;
    document.querySelectorAll('input[name="nPrio"]').forEach(r => r.onchange = mostrarPrazo);
    document.querySelectorAll(".nServ").forEach(c => c.onchange = mostrarDup);
    $("nOrig").onchange = mostrarOrig;
    if ($("nMotO")) $("nMotO").onchange = () => { $("nMotOT").hidden = !$("nMotO").checked; if ($("nMotO").checked) $("nMotOT").focus(); };
    $("nAmbAdd").onclick = () => { addAmb({}); sujar(); const s = $("nAmb").querySelector(".ambl:last-child select"); if (s) s.focus(); };
    ["nRespN", "nRespC"].forEach(i => $(i).addEventListener("input", () => { F.respAuto = null; $("nRespNota").textContent = ""; }));
    $("fNova").addEventListener("input", sujar); $("fNova").addEventListener("change", sujar);
    $("nCanc").onclick = async () => {
      if (modo === "nova") {
        if (F.sujo || rascunho) { if (!(await UI.confirmar({ titulo: "Limpar o formulário?", texto: "O que foi preenchido e o rascunho salvo serão apagados.", botao: "Limpar", perigo: true }))) return; }
        rascunho = null; guardarRasc(); return renderNova();
      }
      if (F.sujo && !(await sairDaNova())) return;
      F.sujo = false;
      if (modo === "editar") { P.setView("fila"); P.openDet(o.id); } else if (modo === "importar") P.setView("planilha"); else P.setView("aprov");
    };
    if ($("nRascDesc")) $("nRascDesc").onclick = async () => {
      if (!(await UI.confirmar({ titulo: "Descartar o rascunho?", texto: "O formulário volta a ficar em branco.", botao: "Descartar", perigo: true }))) return;
      rascunho = null; guardarRasc(); renderNova();
    };
    $("nEnv").onclick = enviarForm;
    mostrarEnt(false); preencher(ini); mostrarPrazo(); mostrarOrig(); mostrarDup();
    F.pronto = true; marcarAbaNova();
  }
  function sujar() {
    if (!F.pronto) return;
    F.sujo = true;
    if (F.modo === "nova") { rascunho = { dados: coletar(), salvo_em: new Date().toISOString() }; guardarRasc(); }   // salva sozinho: não se perde se a página fechar
  }
  function preencher(d) {
    if (!d) return;
    if (d.empresa) { $("nEmp").value = d.empresa; mostrarEmp(); }
    document.querySelectorAll('input[name="nPrio"]').forEach(r => r.checked = r.value === d.prioridade);
    document.querySelectorAll(".nServ").forEach(c => c.checked = (d.servicos || []).includes(c.value));
    $("nSplits").value = d.splits ?? "";
    $("nObs").value = d.observacoes || "";
    $("nOrig").value = d.origem || ""; $("nOrigN").value = d.origem_num || "";
    if ($("nForaJ")) $("nForaJ").value = d.fora_just || "";
    document.querySelectorAll(".nMot").forEach(c => c.checked = (d.motivos || []).includes(c.value));
    if ($("nMotO") && d.motivo_outro) { $("nMotO").checked = true; $("nMotOT").hidden = false; $("nMotOT").value = d.motivo_outro; }
    $("nAmb").innerHTML = ""; (d.ambientes || []).forEach(addAmb); totalAmb();
    $("nRespN").value = d.resp_nome || ""; $("nRespC").value = d.resp_contato || "";
    MOD().perguntas.filter(q => q.ativo).forEach(q => porValorPergunta(q, (d.respostas || {})[q.id]));
  }
  function coletar() {
    return {
      entidade_id: F.ent ? F.ent.id : null, empresa: $("nEmp").value, prioridade: (document.querySelector('input[name="nPrio"]:checked') || {}).value || "",
      servicos: [...document.querySelectorAll(".nServ:checked")].map(c => c.value), splits: $("nSplits").value === "" ? null : +$("nSplits").value,
      observacoes: $("nObs").value.trim(), origem: $("nOrig").value, origem_num: $("nOrigN").value.trim(), fora_just: $("nForaJ") ? $("nForaJ").value.trim() : "",
      motivos: [...document.querySelectorAll(".nMot:checked")].map(c => c.value), motivo_outro: $("nMotO") && $("nMotO").checked ? $("nMotOT").value.trim() : "",
      ambientes: [...document.querySelectorAll("#nAmb .ambl")].map(l => ({ ambiente: l.querySelector("select").value, outro: l.querySelector(".ambo").value.trim(), splits: l.querySelector(".ambq").value === "" ? null : +l.querySelector(".ambq").value })),
      resp_nome: $("nRespN").value.trim(), resp_contato: $("nRespC").value.trim(),
      respostas: Object.fromEntries(MOD().perguntas.filter(q => q.ativo).map(q => [q.id, valorPergunta(q)]))
    };
  }
  function addAmb(a) {
    const L = ativos(MOD().ambientes), l = document.createElement("div"); l.className = "ambl";
    l.innerHTML = `<select aria-label="Ambiente"><option value="">Ambiente</option>${L.map(t => `<option ${a.ambiente === t ? "selected" : ""}>${esc(t)}</option>`).join("")}<option ${a.ambiente === "Outro" ? "selected" : ""}>Outro</option></select>
      <input class="ambo" placeholder="Qual ambiente?" maxlength="80" value="${esc(a.outro || "")}" ${a.ambiente === "Outro" ? "" : "hidden"}>
      <input class="ambq" type="number" min="1" max="200" step="1" inputmode="numeric" placeholder="Splits" aria-label="Quantidade de splits" value="${a.splits ?? ""}">
      <button type="button" class="ib sm" data-tip="Remover ambiente" aria-label="Remover ambiente">${UI.icone("cancelar")}</button>`;
    l.querySelector("select").onchange = e => { l.querySelector(".ambo").hidden = e.target.value !== "Outro"; totalAmb(); };
    l.querySelector(".ambq").oninput = totalAmb;
    l.querySelector("button").onclick = () => { l.remove(); totalAmb(); sujar(); };
    $("nAmb").appendChild(l); totalAmb();
  }
  function totalAmb() {
    const q = [...document.querySelectorAll("#nAmb .ambq")], tem = q.length > 0, soma = q.reduce((s, i) => s + (+i.value || 0), 0);
    $("nSplits").readOnly = tem;
    if (tem) $("nSplits").value = soma;
    $("nSplitsN").textContent = tem ? "Calculada pela soma dos ambientes." : "";
  }
  function mostrarEnt(trocou) {
    const e = F.ent;
    $("nEntSel").innerHTML = e ? `<div class="entsel"><div><b>${esc(tc(e.nome))}</b> <span class="badge ${e.tipo === "escola" ? "b-info" : "b-gray"}">${e.tipo === "escola" ? "Escola" : "Outra entidade"} · ${esc(e.tipologia)}</span>
      <div class="mun">${e.inep && e.inep !== "S/INEP" ? "INEP " + esc(e.inep) + " · " : ""}${esc(greCurta(e.gre))} · ${esc(tc(e.municipio || ""))} · ${esc(e.zona || "")}</div>
      <div class="mun">${esc(e.endereco || "Endereço não informado")}</div></div><button type="button" class="btn" id="nTroca">Trocar</button></div>` : "";
    if ($("nTroca")) $("nTroca").onclick = () => { F.ent = null; mostrarEnt(true); $("nEnt").focus(); sujar(); };
    $("nEnt").hidden = !!e;
    const atual = $("nEmp").value, ativas = emps().filter(x => x.ativa !== false);
    const dentro = ativas.filter(x => atende(x, e)), fora = ativas.filter(x => !atende(x, e));
    $("nEmp").innerHTML = `<option value="">Selecione</option>` + (e
      ? `${dentro.length ? `<optgroup label="Atendem esta GRE ou município">${dentro.map(x => `<option value="${esc(x.nome)}">${esc(EMPN[x.nome] || x.nome)}</option>`).join("")}</optgroup>` : ""}
         <optgroup label="Outras empresas (exige justificativa)">${fora.map(x => `<option value="${esc(x.nome)}">${esc(EMPN[x.nome] || x.nome)}</option>`).join("")}</optgroup>`
      : ativas.map(x => `<option value="${esc(x.nome)}">${esc(EMPN[x.nome] || x.nome)}</option>`).join(""));
    if (atual) $("nEmp").value = atual;
    else if (e && dentro.length === 1) $("nEmp").value = dentro[0].nome;
    // responsável: sugere o último informado para esta entidade
    if (trocou) {
      const c = e && contatoDe(e.id), vazio = !$("nRespN").value && !$("nRespC").value;
      if (c && (vazio || F.respAuto)) {
        $("nRespN").value = c.nome; $("nRespC").value = c.contato; F.respAuto = e.id;
        $("nRespNota").textContent = `Preenchido com o último responsável informado para esta entidade (por ${c.atualizado_por || "GMAP"} em ${quando(c.atualizado_em).slice(0, 10)}). Confira e altere se mudou.`;
      } else if (F.respAuto) { $("nRespN").value = ""; $("nRespC").value = ""; F.respAuto = null; $("nRespNota").textContent = ""; }
    }
    mostrarEmp(); mostrarDup();
  }
  function mostrarEmp() {
    const emp = emps().find(x => x.nome === $("nEmp").value), e = F.ent;
    const fora = emp && e && !atende(emp, e);
    const v = $("nForaJ") ? $("nForaJ").value : "";
    $("nFora").innerHTML = fora ? `<div class="faixa warn"><b>${esc(EMPN[emp.nome] || emp.nome)} não atende ${esc(greCurta(e.gre))} nem ${esc(tc(e.municipio || ""))}.</b> Pode emitir em caso de urgência, com justificativa.
      <label class="fl"><span>Justificativa <i class="obr">obrigatório</i></span><textarea id="nForaJ" rows="2" maxlength="500">${esc(v)}</textarea></label></div>` : "";
  }
  function mostrarPrazo() {
    const p = (document.querySelector('input[name="nPrio"]:checked') || {}).value;
    if (!p) { $("nPrazo").textContent = "Urgente: 2 dias · Alta: 10 dias · Normal: 30 dias (corridos)."; return; }
    $("nPrazo").textContent = F.modo === "editar" ? (F.o.criada ? `Novo prazo: ${fmt(somaDias(F.o.criada, DIAS[p]))} (${DIAS[p]} dias corridos desde a emissão).` : "Esta O.S. não tem data de emissão: o prazo não é recalculado.")
      : `O prazo conta a partir da aprovação. Se aprovada hoje, vence em ${fmt(somaDias(REF, DIAS[p]))}.`;
  }
  function mostrarOrig() {
    const o = $("nOrig").value;
    $("nOrigNL").innerHTML = o === "sei" ? 'Nº do processo SEI <i class="obr">obrigatório</i>' : o === "redmine" ? 'Nº do chamado no Redmine <i class="obr">obrigatório</i>' : "Número (opcional)";
    $("nOrigN").placeholder = o === "sei" ? "00012.000000/2026-00" : o === "redmine" ? "Ex.: 48211" : "";
  }
  function mostrarDup() {
    const e = F.ent; if (!e) { $("nDup").innerHTML = ""; return; }
    const serv = [...document.querySelectorAll(".nServ:checked")].map(c => c.value);
    const abertas = P.todos().concat(P.solic()).filter(o => (o.entidade_id === e.id || (e.inep && e.inep !== "S/INEP" && o.inep === e.inep))
      && ["Emitida", "Stand by", "Aguardando aprovação"].includes(o.status) && (!F.o || o.id !== F.o.id));
    if (!abertas.length) { $("nDup").innerHTML = ""; return; }
    const mesmas = abertas.filter(o => !serv.length || o.serv.some(s => serv.includes(s)));
    $("nDup").innerHTML = `<div class="faixa ${mesmas.length ? "warn" : ""}"><b>${abertas.length} O.S. em aberto nesta entidade${mesmas.length && serv.length ? `, ${mesmas.length} com o mesmo tipo de serviço` : ""}.</b> Confira antes de emitir para evitar duplicidade:
      <ul>${abertas.slice(0, 5).map(o => `<li>${esc(o.os)} · ${esc(EMPN[o.emp] || o.emp)} · ${esc(UI.rotStatus(o.status))} · ${esc(o.serv.map(s => SERVN[s] || s).join(", "))}${o.criada ? " · emitida em " + fmt(o.criada) : ""}</li>`).join("")}</ul></div>`;
  }
  // confere tudo de uma vez e devolve a lista do que falta, com o campo a destacar
  function conferir(d, modo) {
    const m = MOD(), f = [];
    if (!d.entidade_id) f.push(["Escola ou entidade", $("bEnt")]);
    if (!d.empresa) f.push(["Empresa", $("nEmp")]);
    if (!d.prioridade) f.push(["Prioridade", $("nPrio")]);
    if (!d.servicos.length) f.push(["Tipo de serviço (marque ao menos um)", $("bServ")]);
    if (!d.motivos.length && !d.motivo_outro) f.push([$("nMotO") && $("nMotO").checked ? "Descrição do outro motivo" : "Motivo da O.S. (marque ao menos um)", $("nMotO") && $("nMotO").checked ? $("nMotOT") : $("nMot")]);
    if (d.motivo_outro && d.motivo_outro.length < 3) f.push(["Descrição do outro motivo", $("nMotOT")]);
    if (m.campos.ambientes.obrigatorio && !d.ambientes.length) f.push(["Ambientes (informe ao menos um)", $("bAmb")]);
    const linhas = [...document.querySelectorAll("#nAmb .ambl")];
    d.ambientes.forEach((a, i) => {
      if (!a.ambiente) f.push([`Ambiente da linha ${i + 1}`, linhas[i].querySelector("select")]);
      else if (a.ambiente === "Outro" && a.outro.length < 3) f.push([`Descrição do ambiente "Outro" (linha ${i + 1})`, linhas[i].querySelector(".ambo")]);
      if (!Number.isInteger(a.splits) || a.splits < 1) f.push([`Quantidade de splits do ambiente ${a.ambiente === "Outro" ? a.outro || "Outro" : a.ambiente || "da linha " + (i + 1)}`, linhas[i].querySelector(".ambq")]);
    });
    const chaves = d.ambientes.filter(a => a.ambiente).map(a => a.ambiente === "Outro" ? "O:" + a.outro.toUpperCase() : a.ambiente);
    if (new Set(chaves).size !== chaves.length) f.push(["Há ambiente repetido: some as quantidades em uma linha só", $("nAmb")]);
    if (m.campos.responsavel.obrigatorio && !d.resp_nome) f.push(["Nome do responsável pela entidade", $("nRespN")]);
    if ((m.campos.responsavel.obrigatorio || d.resp_nome) && !d.resp_contato) f.push(["Telefone ou e-mail do responsável", $("nRespC")]);
    if (!d.resp_nome && d.resp_contato) f.push(["Nome do responsável pela entidade", $("nRespN")]);
    if (d.resp_contato && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.resp_contato) || d.resp_contato.replace(/\D/g, "").length >= 10)) f.push(["Contato do responsável: use telefone com DDD ou e-mail", $("nRespC")]);
    if (m.campos.descricao.obrigatorio && d.observacoes.length < 5) f.push(["Descrição do problema ou do serviço", $("nObs")]);
    if (!d.origem) f.push(["Origem da demanda", $("nOrig")]);
    else if (d.origem !== "gerencia" && !d.origem_num) f.push([d.origem === "sei" ? "Número do processo SEI" : "Número do chamado no Redmine", $("nOrigN")]);
    if ($("nForaJ") && d.fora_just.length < 10) f.push(["Justificativa da empresa fora da área (mínimo de 10 caracteres)", $("nForaJ")]);
    m.perguntas.filter(q => q.ativo && q.obrigatorio).forEach(q => { const v = d.respostas[q.id]; if (Array.isArray(v) ? !v.length : !v) f.push([q.rotulo, $("q_" + q.id)]); });
    if (modo === "editar" && ($("nMotivo").value.trim().length < 5)) f.push(["Motivo da edição", $("nMotivo")]);
    return f;
  }
  async function enviarForm() {
    const { modo, o: alvo, pend } = F;   // guarda o modo: o recarregamento não pode trocar o formulário no meio do envio
    const d = coletar(), falta = conferir(d, modo);
    if (falta.length) return UI.alerta({ titulo: modo === "editar" ? "Faltam informações para salvar" : "Faltam informações para enviar a O.S.", itens: falta.map(x => x[0]), campos: falta.map(x => x[1]) });
    const motivo = $("nMotivo") ? $("nMotivo").value.trim() : "";
    $("nEnv").disabled = true;
    const r = modo === "editar" ? await rpc("os_editar", { p_id: alvo.id, p_dados: d, p_obs: motivo })
      : modo === "reenviar" ? await rpc("os_reenviar", { p_id: alvo.id, p_dados: d })
      : modo === "importar" ? await rpc("os_importar_planilha", { p_pendencia: pend.id, p_dados: d })
      : await rpc("os_solicitar", { p_dados: d });
    if ($("nEnv")) $("nEnv").disabled = false;
    if (r.erro) return UI.alerta({ titulo: "Não foi possível enviar", itens: r.erro });
    F.sujo = false;
    if (modo === "nova") { rascunho = null; guardarRasc(); }
    await P.recarregar();
    if (modo === "editar") { aviso(`O.S. ${alvo.os} alterada. A empresa foi avisada.`, "ok"); P.setView("fila"); P.openDet(alvo.id); }
    else if (modo === "importar") { aviso(`O.S. ${r.data.numero} importada da planilha${r.data.numero_mudou ? " com número novo" : ""}${r.data.emitida ? " e emitida." : ". Agora vai para a aprovação."}`, "ok"); P.setView("planilha"); }
    else if (r.data && r.data.emitida) { aviso(`O.S. nº ${r.data.numero} emitida. A empresa foi avisada por e-mail.`, "ok"); P.setView("fila"); P.openDet(r.data.id); }
    else { aviso(`O.S. nº ${r.data ? r.data.numero : ""} enviada para aprovação da gerência.`, "ok"); P.setView("aprov"); }
  }
  // ao sair da aba com o formulário preenchido: manter rascunho, descartar ou continuar
  async function sairDaNova() {
    if (!F.sujo) return true;
    if (F.modo === "nova") {
      const r = await UI.escolher({ titulo: "Você tem uma O.S. em preenchimento", texto: "O que fazer com o que já foi preenchido?",
        opcoes: [{ id: "ficar", rotulo: "Continuar preenchendo" }, { id: "descartar", rotulo: "Descartar", classe: "no" }, { id: "manter", rotulo: "Manter rascunho", classe: "pri" }] });
      if (r === "manter") { rascunho = { dados: coletar(), salvo_em: new Date().toISOString() }; guardarRasc(); F.sujo = false; return true; }
      if (r === "descartar") { rascunho = null; guardarRasc(); F.sujo = false; return true; }
      return false;
    }
    const r = await UI.escolher({ titulo: "Descartar as alterações?", texto: "As mudanças feitas neste formulário ainda não foram salvas.",
      opcoes: [{ id: "ficar", rotulo: "Continuar editando", classe: "pri" }, { id: "descartar", rotulo: "Descartar alterações", classe: "no" }] });
    if (r === "descartar") { F.sujo = false; return true; }
    return false;
  }

  // ---------- aprovações (gerência) e minhas solicitações (técnico) ----------
  let selAprov = new Set();
  function cartaoSolic(o, acoes) {
    const e = entPorId(o.entidade_id);
    const dup = P.todos().filter(x => ["Emitida", "Stand by"].includes(x.status) && (x.entidade_id === o.entidade_id) && x.serv.some(s => o.serv.includes(s)));
    return `<div class="sol ${o.fora_area ? "fora" : ""}" data-id="${o.id}">
      <div class="solh">${acoes && GMAP && o.status === "Aguardando aprovação" ? `<input type="checkbox" class="selA" ${selAprov.has(o.id) ? "checked" : ""} aria-label="Selecionar ${esc(o.os)}">` : ""}
        <b>${esc(o.os)}</b> <span class="badge ${STB[o.status]}">${esc(UI.rotStatus(o.status))}</span> <span class="badge ${PRB[o.prio] || "b-gray"}">${esc(o.prio)}</span>
        <span class="mun">por ${esc(o.solicitado_nome || "")} · ${ha(o.solicitado_em)}</span></div>
      <div class="esc">${esc(tc(o.escola || ""))}</div>
      <div class="mun">${esc(tc(o.mun || ""))} · ${esc(greCurta(o.gre))}${e && e.tipo !== "escola" ? " · " + esc(e.tipologia) : ""}</div>
      <div class="solg"><span><small>Empresa</small>${esc(EMPN[o.emp] || o.emp)}${o.fora_area ? ' <span class="badge b-warn">fora da área</span>' : ""}</span>
        <span><small>Serviço</small>${esc(o.serv.map(s => SERVN[s] || s).join(", "))}${o.splits != null ? ` · ${o.splits} split${o.splits === 1 ? "" : "s"}` : ""}</span>
        <span><small>Origem</small>${esc(ORIG[o.origem] || "")}${o.origem_num ? " nº " + esc(o.origem_num) : ""}</span>
        <span><small>Prazo se aprovada hoje</small>${fmt(somaDias(REF, DIAS[o.prio] || 30))}</span></div>
      ${o.obs ? `<div class="soltx">${esc(o.obs)}</div>` : ""}
      ${o.fora_area ? `<div class="faixa warn"><b>Justificativa da empresa fora da área:</b> ${esc(o.fora_just || "")}</div>` : ""}
      ${dup.length ? `<div class="faixa warn"><b>Atenção:</b> já há ${dup.length} O.S. em aberto nesta escola com o mesmo serviço (${dup.slice(0, 3).map(x => esc(x.os) + " · " + esc(EMPN[x.emp] || x.emp)).join("; ")}).</div>` : ""}
      ${o.status !== "Aguardando aprovação" && o.devolucao_obs ? `<div class="faixa ${o.status === "Devolvida" ? "bad" : ""}"><b>${o.status === "Devolvida" ? "O que corrigir" : "Motivo da recusa"}:</b> ${esc(o.devolucao_obs)}</div>` : ""}
      <div class="solb">${acoes || ""}<button class="btn" data-a="ver">Detalhes e histórico</button></div></div>`;
  }
  function renderAprov() {
    const S = P.solic(), ag = aguardando().sort((a, b) => a.solicitado_em.localeCompare(b.solicitado_em));
    const ACOES_G = `<button class="btn ok" data-a="aprovar">Aprovar</button><button class="btn" data-a="devolver">Devolver</button><button class="btn no" data-a="recusar">Recusar</button>`;
    let h = "";
    if (GMAP) {
      selAprov = new Set([...selAprov].filter(id => ag.some(o => o.id === id)));
      h += `<div class="card"><div class="lateh"><h3>Aguardando aprovação (${ag.length})</h3>
        ${ag.length ? `<div class="acoes"><label class="mun"><input type="checkbox" id="selTodas"> marcar todas</label><button class="btn ok" id="aprLote" ${selAprov.size ? "" : "disabled"}>Aprovar selecionadas (${selAprov.size})</button></div>` : ""}</div>
        <div class="d">Ao aprovar, a O.S. recebe o número, o prazo começa a contar e a empresa é avisada por e-mail. As mais antigas aparecem primeiro.</div>
        ${ag.length ? ag.map(o => cartaoSolic(o, ACOES_G)).join("") : '<div class="empty">Nenhuma solicitação aguardando aprovação.</div>'}</div>`;
      h += cartaoProblemas() + cartaoRevisao();
    } else {
      const dev = S.filter(o => o.status === "Devolvida" && o.solicitado_por === CTX.uid), rev = emRevisao();
      const minha = o => o.solicitado_por === CTX.uid;
      h += `<div class="card"><h3>Devolvidas para você corrigir (${dev.length})</h3><div class="d">Corrija o que a gerência pediu e reenvie.</div>
        ${dev.length ? dev.map(o => cartaoSolic(o, `<button class="btn pri" data-a="reenviar">Corrigir e reenviar</button>`)).join("") : '<div class="empty">Nenhuma solicitação devolvida para você.</div>'}</div>
        <div class="card"><h3>Aguardando aprovação da gerência (${ag.length})</h3><div class="d">Todas as solicitações da equipe, das mais antigas para as mais novas. Nas suas, você ainda pode corrigir enquanto aguardam.</div>
        ${ag.length ? ag.map(o => cartaoSolic(o, minha(o) ? `<span class="badge b-info">sua</span><button class="btn" data-a="reenviar">Corrigir</button>` : "")).join("") : '<div class="empty">Nenhuma solicitação aguardando aprovação.</div>'}</div>
        ${cartaoProblemas()}${cartaoRevisao()}`;
    }
    const rec = S.filter(o => o.status === "Recusada" && (GMAP || o.solicitado_por === CTX.uid));
    const devG = GMAP ? S.filter(o => o.status === "Devolvida") : [];
    if (devG.length) h += `<div class="card"><h3>Devolvidas aguardando correção do técnico (${devG.length})</h3>${devG.map(o => cartaoSolic(o, o.solicitado_por === CTX.uid ? `<button class="btn pri" data-a="reenviar">Corrigir e reenviar</button>` : "")).join("")}</div>`;
    h += `<details class="card"><summary><h3 style="display:inline">Recusadas (${rec.length})</h3></summary>${rec.length ? rec.map(o => cartaoSolic(o, "")).join("") : '<div class="empty">Nenhuma.</div>'}</details>`;
    $("v-aprov").innerHTML = h;
    const achar = el => P.find(el.closest("[data-id]").dataset.id);
    $("v-aprov").querySelectorAll("button[data-a]").forEach(b => b.onclick = () => {
      const o = achar(b), a = b.dataset.a;
      if (a === "ver") return P.openDet(o.id, [...$("v-aprov").querySelectorAll(".sol[data-id]")].map(x => x.dataset.id));
      if (a === "reenviar") return P.setView("nova", { modo: "reenviar", o });
      if (a === "editar") return P.setView("nova", { modo: "editar", o });
      if (a === "manter") return acaoManter(o);
      if (a === "abrir") return P.openDet(o.id, [...$("v-aprov").querySelectorAll(".probs tr[data-id]")].map(x => x.dataset.id));
      if (a === "resolver") return acao(o, "retomar");
      if (a === "canc") return cancelarComo(o, motivoCancDoProblema(o), `Problema informado: ${o.standby_motivo || ""}`);
      if (a === "sugcanc") return dialogo({ titulo: `Sugerir o cancelamento da O.S. ${o.os}`, botao: "Enviar sugestão à gerência",
        texto: "Só a gerência cancela O.S. A sugestão vai para a revisão, com o problema informado, e a gerência decide.",
        campos: [{ id: "sug", rot: "Por que cancelar", tipo: "textarea", obrig: true, min: 10, valor: `Sugiro cancelar. Problema: ${o.standby_motivo || ""}` }],
        enviar: async v => { const r = await rpc("os_revisao", { p_id: o.id, p_sugestao: v.sug }); if (r.erro) return r.erro; await P.recarregar(); aviso("Sugestão de cancelamento enviada à gerência.", "ok"); return null; } });
      decidir(o, a);
    });
    $("v-aprov").querySelectorAll("tr.r[data-id]").forEach(tr => tr.onclick = () => P.openDet(tr.dataset.id, [...$("v-aprov").querySelectorAll("tr.r[data-id]")].map(x => x.dataset.id)));
    $("v-aprov").querySelectorAll(".selA").forEach(c => c.onchange = () => { const id = +c.closest("[data-id]").dataset.id; c.checked ? selAprov.add(id) : selAprov.delete(id); renderAprov(); });
    if ($("selTodas")) { $("selTodas").checked = ag.length > 0 && ag.every(o => selAprov.has(o.id)); $("selTodas").onchange = () => { ag.forEach(o => $("selTodas").checked ? selAprov.add(o.id) : selAprov.delete(o.id)); renderAprov(); }; }
    if ($("aprLote")) $("aprLote").onclick = () => {
      const L = ag.filter(o => selAprov.has(o.id)); if (!L.length) return;
      dialogo({ titulo: `Aprovar ${L.length} solicitação(ões)`, texto: `Cada uma recebe um número e o prazo começa hoje. As empresas são avisadas por e-mail.<br>${L.map(o => esc(o.os) + " · " + esc(tc(o.escola || ""))).join("<br>")}`,
        botao: "Aprovar todas", enviar: async () => {
          const ok = [], falhas = [];
          for (const o of L) { const r = await rpc("os_decidir", { p_id: o.id, p_acao: "aprovar", p_obs: null }); r.erro ? falhas.push(o.os + ": " + r.erro) : ok.push(r.data.numero); }
          selAprov.clear(); await P.recarregar();
          aviso(`${ok.length} O.S. emitida(s): ${ok.join(", ")}` + (falhas.length ? ` · ${falhas.length} com erro` : ""), falhas.length ? "bad" : "ok");
          return falhas.length ? falhas.join(" | ") : null;
        } });
    };
  }
  // problemas informados (status "Stand by" no banco): a equipe trata corrigindo a O.S., resolvendo ou cancelando
  function cartaoProblemas() {
    const L = comProblema();
    const ib = (a, ic, t, c) => UI.botaoIcone(ic, t, c).replace(`data-acao="${ic}"`, `data-a="${a}"`);
    return `<div class="card probs"><h3>Problemas informados (${L.length})</h3><div class="d">O.S. em que a empresa ou a GMAP registrou um problema. O prazo continua correndo. Para tratar: corrija a O.S. (editar), marque o problema como resolvido ou ${GMAP ? "cancele" : "sugira o cancelamento à gerência"}.</div>
      ${L.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nº O.S.</th><th>Escola</th><th>Empresa</th><th>Problema</th><th></th></tr></thead><tbody>${L.map(o => `<tr data-id="${o.id}">
        <td><b>${esc(o.os)}</b><div class="mun">${o.sp ? esc(o.sp) : ""}</div></td><td><div class="esc">${esc(tc(o.escola || ""))}</div><div class="mun">${esc(tc(o.mun || ""))}</div></td><td>${esc(EMPN[o.emp] || o.emp)}</td>
        <td class="ev"><b>${esc(o.problema_tipo && o.problema_tipo !== "Outro problema" ? o.problema_tipo : "Outro problema")}</b><div>${esc(o.problema_tipo && o.problema_tipo !== "Outro problema" ? String(o.standby_motivo || "").replace(o.problema_tipo, "").replace(/^:\s*/, "") : o.standby_motivo || "")}</div>
          <div class="mun">${o.standby_por === "empresa" ? "Empresa" : "GMAP"}${o.problema_nome ? " · " + esc(o.problema_nome) : ""}${o.problema_em ? " · " + ha(o.problema_em) : ""}</div></td>
        <td><div class="acoes pacoes">${ib("abrir", "abrir", "Abrir a O.S.")}${ib("editar", "editar", "Editar (corrigir a O.S.)", "pri")}${ib("resolver", "retomar", "Problema resolvido (retomar)")}${GMAP ? ib("canc", "cancelar", "Cancelar a O.S.", "no") : (o.revisao ? "" : ib("sugcanc", "revisao", "Sugerir cancelamento à gerência"))}</div></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Nenhum problema informado.</div>'}</div>`;
  }
  function cartaoRevisao() {
    const rev = emRevisao();
    return `<div class="card revs"><h3>Em revisão (${rev.length})</h3><div class="d">O.S. que a gerência pediu para os técnicos corrigirem, ou com correção sugerida por um técnico. Ficam fora das contagens e a empresa não consegue registrar atendimento até a revisão terminar. Técnicos e gerência corrigem editando a O.S. ou encerram sem alterar.</div>
      ${rev.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nº O.S.</th><th>Escola</th><th>Empresa</th><th>O que verificar</th><th></th></tr></thead><tbody>${rev.map(o => `<tr data-id="${o.id}">
        <td><b>${esc(o.os)}</b></td><td><div class="esc">${esc(tc(o.escola || ""))}</div><div class="mun">${esc(tc(o.mun || ""))}</div></td><td>${esc(EMPN[o.emp] || o.emp)}</td>
        <td class="ev">${o.revisao_perfil === "gmap" ? '<span class="badge b-rev">pedido da gerência</span> ' : '<span class="badge b-gray">sugestão de técnico</span> '}${esc(o.revisao_sugestao || "")}<div class="mun">${esc(o.revisao_nome || "")} · ${ha(o.revisao_em)}</div></td>
        <td><div class="acoes"><button class="btn pri" data-a="editar">Editar O.S.</button><button class="btn" data-a="manter">Encerrar sem alterar</button></div></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Nenhuma O.S. em revisão.</div>'}</div>`;
  }
  // registrar problema: tipo da lista do Modelo + detalhe (obrigatório em "Outro problema")
  function registrarProblema(o) {
    const tipos = ativos(MOD().problemas || []).concat(["Outro problema"]);
    return dialogo({ titulo: `Registrar problema na O.S. ${o.os}`, botao: "Registrar problema",
      texto: (EMPRESA ? "Use quando algo impede ou dispensa o atendimento. A GMAP é avisada e decide: corrigir a O.S., marcar como resolvido ou cancelar."
        : "A empresa é avisada por e-mail. Depois, trate o problema: corrija a O.S., marque como resolvido ou cancele.") + " <b>O prazo continua correndo.</b>",
      campos: [{ id: "tipo", rot: "Tipo de problema", tipo: "select", opcoes: tipos, obrig: true },
        { id: "det", rot: "Detalhe", tipo: "textarea", dica: "Obrigatório em \"Outro problema\". Nos demais, ajuda a GMAP a decidir (ex.: quem informou, data, número da outra O.S.)." }],
      enviar: async v => {
        if (v.tipo === "Outro problema" && (v.det || "").trim().length < 10) return "Descreva o problema (mínimo de 10 caracteres).";
        let r = await rpc("os_problema", { p_id: o.id, p_tipo: v.tipo, p_detalhe: v.det || null });
        // banco ainda sem a migração 014: registra pelo caminho antigo, com o tipo no texto
        if (r.erro && /function|schema cache|does not exist/i.test(r.erro)) r = await rpc("os_standby", { p_id: o.id, p_motivo: v.tipo === "Outro problema" ? v.det : v.tipo + (v.det ? ": " + v.det : "") });
        if (r.erro) return r.erro;
        await depois(o, "Problema registrado."); return null;
      } });
  }
  // motivo de cancelamento sugerido a partir do tipo de problema (a pessoa pode trocar)
  function motivoCancDoProblema(o) {
    const t = String(o.problema_tipo || o.standby_motivo || "");
    return /particular|terceir/i.test(t) ? /particular|terceir|atendid/i : /outra O\.S\.|duplic/i.test(t) ? /duplicad/i : null;
  }
  function decidir(o, a) {
    const cfg = {
      aprovar: { titulo: `Aprovar ${o.os}`, texto: `A O.S. recebe o próximo número, o prazo de ${DIAS[o.prio]} dias começa hoje (vence em ${fmt(somaDias(REF, DIAS[o.prio]))}) e ${esc(EMPN[o.emp] || o.emp)} é avisada por e-mail.`, botao: "Aprovar e emitir",
        campos: [{ id: "obs", rot: "Observação (opcional)", tipo: "textarea", linhas: 2 }] },
      devolver: { titulo: `Devolver ${o.os} para correção`, texto: "O técnico vê o que precisa corrigir e reenvia.", botao: "Devolver",
        campos: [{ id: "obs", rot: "O que precisa ser corrigido", tipo: "textarea", obrig: true, min: 5 }] },
      recusar: { titulo: `Recusar ${o.os}`, texto: "A solicitação é encerrada sem emissão. Fica registrada no histórico.", botao: "Recusar", perigo: true,
        campos: [{ id: "obs", rot: "Motivo da recusa", tipo: "textarea", obrig: true, min: 5 }] }
    }[a];
    dialogo(Object.assign(cfg, { enviar: async v => {
      const r = await rpc("os_decidir", { p_id: o.id, p_acao: a, p_obs: v.obs || null }); if (r.erro) return r.erro;
      selAprov.delete(o.id); await P.recarregar();
      aviso(a === "aprovar" ? `O.S. nº ${r.data.numero} emitida. ${EMPN[o.emp] || o.emp} foi avisada.` : a === "devolver" ? `${o.os} devolvida ao técnico.` : `${o.os} recusada.`, "ok");
      if ($("drawer").classList.contains("on")) P.openDet(o.id);
      return null;
    } }));
  }
  function acaoManter(o) {
    dialogo({ titulo: `Encerrar a revisão de ${o.os} sem alterar`, texto: `Sugestão: ${esc(o.revisao_sugestao || "")}`, botao: "Manter os dados",
      campos: [{ id: "obs", rot: "Por que a sugestão não foi aplicada", tipo: "textarea", obrig: true, min: 5 }],
      enviar: async v => { const r = await rpc("os_encerrar_revisao", { p_id: o.id, p_obs: v.obs }); if (r.erro) return r.erro; await depois($("drawer").classList.contains("on") ? o : null, "Revisão encerrada. A O.S. voltou às contagens."); return null; } });
  }

  // ---------- detalhe da O.S.: faixas, ações e histórico ----------
  function faixaDetalhe(o) {
    const f = [];
    if (o.status === "Aguardando aprovação") f.push(`<div class="faixa warn"><b>Aguardando aprovação da gerência.</b> Solicitada por ${esc(o.solicitado_nome || "")} ${ha(o.solicitado_em)}. Ainda sem número e sem prazo.</div>`);
    if (o.status === "Devolvida") f.push(`<div class="faixa bad"><b>Devolvida para correção:</b> ${esc(o.devolucao_obs || "")}</div>`);
    if (o.status === "Recusada") f.push(`<div class="faixa"><b>Recusada:</b> ${esc(o.devolucao_obs || "")}</div>`);
    if (o.revisao) f.push(EQUIPE ? `<div class="faixa rev"><b>Em revisão.</b> ${o.revisao_perfil === "gmap" ? "Pedido da gerência" : "Sugestão"} de ${esc(o.revisao_nome || "")}: ${esc(o.revisao_sugestao || "")}. Fora das contagens até a GMAP corrigir (editar) ou encerrar a revisão.</div>`
      : `<div class="faixa rev"><b>Em revisão pela GMAP.</b> Os dados desta O.S. podem mudar. Aguarde a revisão para registrar o atendimento.</div>`);
    if (o.status === "Stand by") f.push(`<div class="faixa warn"><b>Problema informado pela ${o.standby_por === "empresa" ? "empresa" : "GMAP"}${o.problema_nome ? " (" + esc(o.problema_nome) + (o.problema_em ? ", " + ha(o.problema_em) : "") + ")" : ""}:</b> ${esc(o.standby_motivo || "")}. O prazo continua correndo.${EQUIPE ? " Para tratar: corrija a O.S. (editar), marque o problema como resolvido ou, se for o caso, cancele." : o.standby_por === "empresa" ? " A GMAP vai analisar." : ""}</div>`);
    if (o.comprovante_pendente && o.status === "Atendida") f.push(`<div class="faixa warn comp"><b>Falta a O.S. assinada.</b> O atendimento veio da planilha geral e foi registrado no sistema sem o PDF.
      ${GMAP || (EMPRESA && o.emp === EMPRESA) ? `<div class="solb"><button type="button" class="btn pri" data-acao="anexar">Anexar O.S. assinada</button></div>` : ""}</div>`);
    const pm = GMAP && pendDaOS(o);
    const pc = GMAP && o.status === "Cancelada" && pendTodas().find(x => x.tipo === "mudanca" && String(x.os_id) === String(o.id));
    if (pc) f.push(`<div class="faixa info plan"><b>A planilha tem dados diferentes desta O.S. cancelada</b> (detectado ${ha(pc.atualizado_em)}). Só para consulta: a O.S. cancelada não muda.
      ${(pc.diferencas || []).map(difTxt).join("")}</div>`);
    if (pm) f.push(`<div class="faixa warn plan"><b>A planilha está diferente do sistema</b> (detectado ${ha(pm.atualizado_em)}):
      ${(pm.diferencas || []).map(difTxt).join("")}
      <div class="solb"><button type="button" class="btn pri" data-acao="plan-aplicar">Aplicar no sistema</button><button type="button" class="btn" data-acao="plan-manter">Manter o sistema</button></div></div>`);
    if (soPlanilha(o)) f.push(`<div class="faixa info"><b>O.S. da planilha geral.</b> Até a virada para o sistema, ela continua sendo atualizada pela planilha e fica só para consulta aqui.</div>`);
    else if (o.legado) f.push(`<div class="mun">Importada da planilha geral.</div>`);
    return f.join("");
  }
  function botoesDetalhe(o) {
    const b = (a, t, c) => UI.botaoIcone(a, t, c), s = o.status, aberta = ["Emitida", "Stand by"].includes(s), h = [];
    if (o.pdf_caminho || o.pdf) h.push(b("pdf", "Ver a O.S. assinada (PDF)"));
    if (soPlanilha(o)) return h.join("");
    if (EMPRESA && o.emp === EMPRESA) {
      if (aberta && !o.revisao) h.push(b("atender", "Registrar atendimento", "pri"));
      if (s === "Emitida" && !o.revisao) h.push(b("standby", "Informar problema"));
      if (s === "Stand by" && o.standby_por === "empresa") h.push(b("retomar", "Problema resolvido (retomar)"));
      if (s === "Atendida") { h.push(b("corrigir", "Corrigir atendimento")); if (o.atendido_por === CTX.uid) h.push(b("desfazer", "Desfazer atendimento", "no")); }
    }
    if (EQUIPE) {
      if (s === "Aguardando aprovação" && GMAP) h.push(b("aprovar", "Aprovar e emitir", "ok"), b("devolver", "Devolver para correção"), b("recusar", "Recusar", "no"));
      if (["Aguardando aprovação", "Devolvida"].includes(s) && o.solicitado_por === CTX.uid) h.push(b("reenviar", s === "Devolvida" ? "Corrigir e reenviar" : "Corrigir solicitação", "pri"));
      if (aberta) h.push(b("editar", "Editar O.S.", o.revisao || s === "Stand by" ? "pri" : ""));
      if (aberta && o.revisao) h.push(b("manter", "Encerrar revisão sem alterar"));
      if (aberta && !o.revisao) h.push(b("revisao", GMAP ? "Pedir revisão aos técnicos" : "Sugerir correção (revisão)"));
      if (s === "Emitida") h.push(b("standby", "Registrar problema"));
      if (s === "Stand by") h.push(b("retomar", "Problema resolvido (retomar)"));
      if (aberta && GMAP) h.push(b("cancelar", "Cancelar O.S.", "no"));
      if (s === "Atendida" && (GMAP || o.atendido_por === CTX.uid)) h.push(b("desfazer", "Desfazer atendimento", "no"));
    }
    return h.join("");
  }
  function ligarDetalhe(o) {
    document.querySelectorAll("#det .plan button[data-acao], #det .comp button[data-acao]").forEach(bt => bt.onclick = () => acao(o, bt.dataset.acao));
    document.querySelectorAll("#dAcoes button[data-acao]").forEach(bt => bt.onclick = () => acao(o, bt.dataset.acao));
  }
  function acao(o, a) {
    const ok = msg => async r => { if (r.erro) return r.erro; await depois(o, msg); return null; };
    if (a === "aprovar" || a === "devolver" || a === "recusar") return decidir(o, a);
    if (a === "anexar") return dialogo({ titulo: `Anexar a O.S. assinada (O.S. ${o.os})`, botao: "Anexar",
      texto: `Atendimento registrado em ${fmt(o.atend)}, a partir da planilha geral. Envie o PDF da O.S. assinada pela escola.`,
      campos: [{ id: "pdf", rot: "O.S. assinada", tipo: "anexo", obrig: true, dica: DICA_ANEXO }],
      enviar: async v => {
        const s = await subirAnexo(o, v.pdf); if (s.erro) return s.erro;
        return ok("O.S. assinada anexada.")(await rpc("os_anexar_comprovante", { p_id: o.id, p_pdf_nome: s.nome, p_pdf_caminho: s.caminho }));
      } });
    if (a === "plan-aplicar" || a === "plan-manter") return acaoPendencia(pendDaOS(o), a === "plan-aplicar" ? "aplicar" : "manter", o);
    if (a === "pdf") return (async () => {
      if (!o.pdf_caminho || !sb.storage.from("os-assinadas").createSignedUrl) return UI.alerta({ titulo: "PDF indisponível", itens: o.pdf_caminho ? "Não foi possível abrir o arquivo agora." : "Esta O.S. não tem o arquivo guardado no sistema (registro anterior ao envio de PDF)." });
      const { data, error } = await sb.storage.from("os-assinadas").createSignedUrl(o.pdf_caminho, 300);
      if (error || !data) return UI.alerta({ titulo: "Não foi possível abrir o PDF", itens: error ? error.message : "Tente de novo." });
      window.open(data.signedUrl, "_blank", "noopener");
    })();
    if (a === "reenviar" || a === "editar") return (async () => { if (!(await P.podeSair())) return; P.closeDet(); P.setView("nova", { modo: a, o }); })();
    if (a === "manter") return acaoManter(o);
    if (a === "atender" || a === "corrigir") {
      const corr = a === "corrigir";
      // itens do contrato vigente na data do atendimento (exigidos a partir da data configurada); na correção, só se ainda não conferidos
      const atuais = corr ? MED.itensOS(o) : [];
      const dataIt = corr ? o.atend : REF;
      const campoIt = atuais.some(r => r.c) ? null : MED.campoItens(o, dataIt, atuais.map(r => ({ item_id: r.x.item_id, quantidade: r.x.quantidade })), MED.exige(o.emp, dataIt));
      if (campoIt) campoIt.data = dataIt;
      const itensMudaram = L => JSON.stringify(L.map(r => [r.item_id, r.quantidade]).sort()) !== JSON.stringify(atuais.map(r => [r.x.item_id, r.x.quantidade]).sort());
      return dialogo({ titulo: corr ? `Corrigir o atendimento da O.S. ${o.os}` : `Registrar atendimento da O.S. ${o.os}`,
        texto: corr ? "A correção fica registrada no histórico, com o valor anterior e o novo." : `Prazo: ${fmt(o.prazo)}. Se o atendimento for depois do prazo, a justificativa é obrigatória.`,
        botao: corr ? "Salvar correção" : "Registrar atendimento",
        campos: [{ id: "data", rot: "Data do atendimento", tipo: "date", obrig: true, valor: corr ? o.atend : REF, maxData: REF },
          { id: "just", rot: "Justificativa", tipo: "textarea", valor: corr ? o.just : "", dica: "Obrigatória se o atendimento for depois do prazo." },
          { id: "pend", rot: "Pendências ou problemas encontrados", tipo: "textarea", valor: corr ? o.pend : "", dica: "Ex.: aparelho sem conserto, falta de ponto elétrico." },
          { id: "pdf", rot: corr ? "Substituir a O.S. assinada (opcional)" : exigePdf(o) ? "O.S. assinada" : "O.S. assinada (opcional)", tipo: "anexo", obrig: !corr && exigePdf(o),
            dica: DICA_ANEXO + (corr && o.pdf ? " Atual: " + o.pdf : "") + (!corr && !exigePdf(o) ? ` Não obrigatória: esta O.S. foi emitida antes de ${fmt((CTX.config && CTX.config.pdf_obrigatorio_desde) || "2026-12-01")}, mas anexar ajuda a fiscalização.` : "") }]
          .concat(campoIt ? [campoIt] : [])
          .concat(corr ? [{ id: "motivo", rot: "Motivo da correção", tipo: "textarea", obrig: true, min: 10 }] : []),
        enviar: async v => {
          if (v.data > REF) return "A data do atendimento não pode ser futura.";
          let itens = null;
          if (campoIt) {
            if (MED.contratoNa(o.emp, v.data) !== MED.contratoNa(o.emp, campoIt.data)) return "A data escolhida cai em outro período do contrato: feche e registre de novo para ver os itens desse período.";
            const e = MED.validarItens(v.itens); if (e) return e;
            if (!v.itens.length && MED.exige(o.emp, v.data)) return `Informe os itens do contrato executados (exigidos nos atendimentos a partir de ${fmt(MED.medDesde())}).`;
            itens = corr ? (itensMudaram(v.itens) ? v.itens : null) : (v.itens.length ? v.itens : null);
          }
          if (o.prazo && v.data > o.prazo && (v.just || "").length < 10) return "Atendimento depois do prazo: escreva a justificativa (mínimo de 10 caracteres).";
          let pdf = null, caminho = null;
          if (v.pdf) { const s = await subirAnexo(o, v.pdf); if (s.erro) return s.erro; pdf = s.nome; caminho = s.caminho; }
          const r = await rpc("os_atendimento", { p_id: o.id, p_dados: { data: v.data, justificativa: v.just, pendencias: v.pend, pdf_nome: pdf, pdf_caminho: caminho, motivo_correcao: v.motivo || null, itens } });
          return ok(corr ? "Atendimento corrigido." : `Atendimento da O.S. ${o.os} registrado.`)(r);
        } });
    }
    if (a === "desfazer") return dialogo({ titulo: `Desfazer o atendimento da O.S. ${o.os}`, perigo: true, botao: "Desfazer atendimento",
      texto: "A O.S. volta para Emitida e o prazo original continua valendo. O atendimento desfeito fica no histórico.",
      campos: [{ id: "just", rot: "Justificativa", tipo: "textarea", obrig: true, min: 10 }],
      enviar: async v => ok("Atendimento desfeito.")(await rpc("os_desfazer_atendimento", { p_id: o.id, p_just: v.just })) });
    if (a === "standby") return registrarProblema(o);
    if (a === "retomar") return dialogo({ titulo: `Problema resolvido: retomar a O.S. ${o.os}`, botao: "Problema resolvido",
      texto: `Problema informado: ${esc(o.standby_motivo || "")}.<br>A O.S. volta a ficar em aberto.${EMPRESA ? "" : " A empresa é avisada por e-mail."}`,
      campos: [{ id: "obs", rot: "Como foi resolvido (opcional)", tipo: "textarea", linhas: 2 }],
      enviar: async v => ok("Problema resolvido: O.S. em aberto de novo.")(await rpc("os_retomar", { p_id: o.id, p_obs: v.obs })) });
    if (a === "cancelar") return dialogo({ titulo: `Cancelar a O.S. ${o.os}`, perigo: true, botao: "Cancelar O.S.",
      texto: "O cancelamento não pode ser desfeito. A empresa é avisada por e-mail.",
      campos: [{ id: "motivo", rot: "Motivo", tipo: "select", opcoes: ativos(MOD().motivos_cancelamento).concat(["Outro motivo"]), obrig: true },
        { id: "texto", rot: "Detalhe", tipo: "textarea", dica: "Obrigatório quando o motivo for \"Outro motivo\"." }],
      enviar: async v => {
        if (v.motivo === "Outro motivo" && (v.texto || "").length < 10) return "Descreva o motivo (mínimo de 10 caracteres).";
        return ok(`O.S. ${o.os} cancelada.`)(await rpc("os_cancelar", { p_id: o.id, p_motivo: v.motivo, p_texto: v.texto }));
      } });
    if (a === "revisao") return dialogo({ titulo: GMAP ? `Pedir revisão da O.S. ${o.os} aos técnicos` : `Sugerir correção da O.S. ${o.os}`, botao: GMAP ? "Pedir revisão" : "Sugerir correção",
      texto: "A O.S. sai das contagens e a empresa não consegue registrar atendimento até a revisão terminar. A empresa vê só que a O.S. está em revisão. Os técnicos e a gerência corrigem (editando) ou encerram a revisão sem alterar.",
      campos: [{ id: "sug", rot: GMAP ? "O que os técnicos devem verificar e corrigir" : "Correção sugerida", tipo: "textarea", obrig: true, min: 10, dica: "Diga o que está errado e, se souber, qual é o valor certo." }],
      enviar: async v => ok("O.S. em revisão. A equipe da GMAP vai corrigir.")(await rpc("os_revisao", { p_id: o.id, p_sugestao: v.sug })) });
  }
  const PERFIL_NOME = { gmap: "Gerência GMAP", tecnico: "Técnico GMAP", consultivo: "Consultivo", diretoria: "Diretoria", empresa: "Empresa" };
  const ACAO = { "atualizada pela planilha": "Atualizada pela planilha", "importou da planilha": "Importou da planilha", "aplicou mudança da planilha": "Aplicou no sistema a mudança da planilha", "manteve o sistema": "Manteve o sistema (mudança da planilha)", "anexou a O.S. assinada": "Anexou a O.S. assinada", "solicitou": "Solicitou a emissão", "reenviou": "Corrigiu e reenviou", "aprovou": "Aprovou e emitiu", "emitiu": "Emitiu", "devolveu": "Devolveu para correção", "recusou": "Recusou",
    "registrou atendimento": "Registrou o atendimento", "corrigiu atendimento": "Corrigiu o atendimento", "desfez atendimento": "Desfez o atendimento", "colocou em stand by": "Registrou problema (stand by)", "registrou problema": "Registrou problema", "resolveu o problema": "Problema resolvido",
    "retomou": "Retomou", "cancelou": "Cancelou", "colocou em revisão": "Colocou em revisão", "em revisão": "Em revisão pela GMAP", "revisão concluída": "Revisão concluída",
    "encerrou revisão sem alterar": "Encerrou a revisão sem alterar", "editou": "Editou a O.S.", "atualizou dados da escola": "Atualizou os dados da escola pela base" };
  async function historico(o) {
    const { data, error } = await sb.from("os_eventos").select("*").eq("os_id", o.id).order("quando");
    if (!$("dHist")) return;
    if (error) { $("dHist").innerHTML = `<div class="mun">Não foi possível carregar o histórico.</div>`; return; }
    const L = (data || []).slice();
    if (o.legado) L.unshift({ quando: null, quem_nome: "Planilha geral", acao: "importada", detalhe: `Importada com o status atual "${o.status}". O histórico anterior está na planilha.` });
    $("dHist").innerHTML = L.length ? L.map(e => `<div class="hi ${e.interno ? "int" : ""}"><div class="hq">${e.quando ? quando(e.quando) : "Na migração"}</div>
      <div><b>${esc(ACAO[e.acao] || tc(e.acao))}</b> · ${esc(e.quem_nome || "")}${e.perfil ? ` <span class="mun">(${esc(PERFIL_NOME[e.perfil] || e.perfil)})</span>` : ""}${e.interno && EQUIPE ? ' <span class="badge b-gray">interno</span>' : ""}${e.detalhe ? `<div class="mun">${esc(e.detalhe)}</div>` : ""}</div></div>`).join("")
      : `<div class="mun">Sem registros.</div>`;
  }

  // ---------- empresas: área sugerida e e-mail de aviso ----------
  async function renderEmpresas() {
    const L = P.todos(), E = emps();
    const gres = [...new Set(ents().map(e => e.gre).filter(g => g && g !== "SEDE"))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    $("v-emp").innerHTML = `<div class="card"><h3>Empresas contratadas</h3><div class="d">A área (GREs e municípios) é usada para sugerir a empresa na emissão. Emitir fora da área continua possível, com justificativa. Os avisos de O.S. emitida, alterada ou cancelada vão para o e-mail cadastrado.</div>
      <div class="emps">${E.map(e => { const ab = L.filter(o => o.emp === e.nome && ["Emitida", "Stand by"].includes(o.status)).length;
        return `<div class="empc" data-n="${esc(e.nome)}"><div class="lateh"><h3>${esc(EMPN[e.nome] || e.nome)}</h3>${GMAP ? '<button class="btn" data-a="editar">Editar</button>' : ""}</div>
          <div class="mun">${nf(ab)} O.S. em aberto</div>
          <div class="kv"><small>E-mail de aviso</small>${e.email ? esc(e.email) : '<span class="badge b-bad">sem e-mail: a empresa não recebe avisos</span>'}</div>
          <div class="kv"><small>GREs atendidas (${(e.gres || []).length})</small><div class="chips">${(e.gres || []).map(g => `<span class="chip">${esc(greCurta(g))}</span>`).join("") || '<span class="mun">nenhuma</span>'}</div></div>
          <div class="kv"><small>Municípios avulsos (${(e.municipios || []).length})</small><div class="chips">${(e.municipios || []).map(m => `<span class="chip">${esc(tc(m))}</span>`).join("") || '<span class="mun">nenhum</span>'}</div></div>
          ${e.alterado_em ? `<div class="mun">Alterado por ${esc(e.alterado_por || "")} em ${quando(e.alterado_em)}</div>` : ""}</div>`; }).join("")}</div>
      <div class="mun">GREs sem nenhuma empresa: ${gres.filter(g => !E.some(e => (e.gres || []).includes(g))).map(greCurta).join(", ") || "nenhuma"}</div></div>
      <div class="card"><h3>Avisos por e-mail</h3><div class="d">Enviados pela conta da GMAP. Cada aviso fica registrado aqui.</div><div id="emLista"><div class="mun">Carregando…</div></div></div>`;
    $("v-emp").querySelectorAll('button[data-a="editar"]').forEach(b => b.onclick = () => editarEmpresa(E.find(e => e.nome === b.closest("[data-n]").dataset.n), gres));
    const { data } = await sb.from("email_fila").select("*").order("id", { ascending: false }).limit(200);
    if (!$("emLista")) return;
    $("emLista").innerHTML = (data || []).length ? `<div class="tbl" style="max-height:50vh"><table><thead><tr><th>Quando</th><th>Empresa</th><th>Para</th><th>Assunto</th><th>Situação</th></tr></thead><tbody>${
      data.map(m => `<tr><td>${quando(m.criado_em)}</td><td>${esc(EMPN[m.empresa] || m.empresa)}</td><td>${esc(m.para || "")}</td><td>${esc(m.assunto)}<div class="mun">${esc(m.corpo || "")}</div></td>
        <td><span class="badge ${/Enviado/.test(m.situacao) ? "b-ok" : /fila/i.test(m.situacao) ? "b-info" : "b-bad"}">${esc(m.situacao)}</span></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Nenhum aviso enviado ainda. Aprove uma O.S. para ver o aviso aparecer aqui.</div>`;
  }
  function editarEmpresa(e, gres) {
    const muns = [...new Set(ents().map(x => x.municipio).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    let d = $("dlg"); if (!d) { d = document.createElement("div"); d.id = "dlg"; d.className = "dlg"; document.body.appendChild(d); }
    const ms = new Set(e.municipios || []);
    d.innerHTML = `<div class="dlgp larga" id="eBox" role="dialog" aria-modal="true"><h2>${esc(EMPN[e.nome] || e.nome)}</h2>
      <label class="fl"><span>E-mail que recebe os avisos</span><input type="email" id="eEmail" value="${esc(e.email || "")}" placeholder="exemplo@empresa.com.br"></label>
      <span class="flt">GREs atendidas</span><div class="chks col2">${gres.map(g => `<label><input type="checkbox" class="eGre" value="${esc(g)}" ${(e.gres || []).includes(g) ? "checked" : ""}> ${esc(greCurta(g))}</label>`).join("")}</div>
      <span class="flt">Municípios avulsos (fora das GREs marcadas)</span><input id="eMunQ" placeholder="Filtrar municípios" class="busca">
      <div class="chks col2 rolar" id="eMuns"></div>
      <div class="lerr" id="eErr"></div>
      <div class="dlgb"><button type="button" class="btn" id="eCanc">Voltar</button><button type="submit" class="btn pri" id="eOk">Salvar</button></div></div>`;
    const listar = () => { const q = norm($("eMunQ").value);
      $("eMuns").innerHTML = muns.filter(m => !q || norm(m).includes(q)).map(m => `<label><input type="checkbox" class="eMun" value="${esc(m)}" ${ms.has(m) ? "checked" : ""}> ${esc(tc(m))}</label>`).join("");
      $("eMuns").querySelectorAll(".eMun").forEach(c => c.onchange = () => c.checked ? ms.add(c.value) : ms.delete(c.value)); };
    $("eMunQ").oninput = listar; listar();
    d.classList.add("on");
    $("eCanc").onclick = () => d.classList.remove("on");
    d.onclick = ev => { if (ev.target === d) d.classList.remove("on"); };
    UI.aoEnviar($("eBox"), async () => {
      const email = $("eEmail").value.trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("eErr").textContent = "E-mail inválido."; return UI.alerta({ titulo: "E-mail inválido", itens: "Confira o endereço, por exemplo: avisos@empresa.com.br.", campos: [$("eEmail")] }); }
      $("eOk").disabled = true;
      const r = await rpc("empresa_salvar", { p_nome: e.nome, p_email: email, p_gres: [...d.querySelectorAll(".eGre:checked")].map(c => c.value), p_municipios: [...ms] });
      $("eOk").disabled = false;
      if (r.erro) { $("eErr").textContent = r.erro; return UI.alerta({ titulo: "Não foi possível salvar", itens: r.erro }); }
      d.classList.remove("on"); await P.recarregar(); aviso("Dados da empresa salvos.", "ok");
    });
  }

  // ---------- auditoria: base de entidades ----------
  let audE = "div", selE = new Set();
  function audEntidades(L) {
    if (!$("audEnt")) return;
    const E = ents(), ativos = E.filter(e => e.ativo), escolas = ativos.filter(e => e.tipo === "escola");
    const semInep = escolas.filter(e => !e.inep || e.inep === "S/INEP");
    const porInep = {}; ativos.forEach(e => { if (e.inep && e.inep !== "S/INEP") (porInep[e.inep] = porInep[e.inep] || []).push(e); });
    const repetido = Object.values(porInep).filter(v => v.length > 1).flat();
    const foraPadrao = escolas.filter(e => e.inep && e.inep !== "S/INEP" && !/^22\d{6}$/.test(e.inep));
    const vazios = ativos.filter(e => !e.nome || !e.municipio || !e.gre || !e.endereco);
    const abertas = L.filter(o => ["Emitida", "Stand by"].includes(o.status));
    const removidas = abertas.filter(o => o.entidade_id && !(entPorId(o.entidade_id) || {}).ativo);
    const C = [["escola", "nome"], ["inep", "inep"], ["gre", "gre"], ["mun", "municipio"], ["zona", "zona"], ["end", "endereco"]], ROT = { escola: "Nome", inep: "INEP", gre: "GRE", mun: "Município", zona: "Zona", end: "Endereço" };
    const difs = o => { const e = entPorId(o.entidade_id); if (!e || !e.ativo) return []; return C.filter(([k, ke]) => String(e[ke] ?? "").trim() !== "" && String(o[k] ?? "") !== String(e[ke])).map(([k, ke]) => [ROT[k], o[k], e[ke]]); };
    const diverg = abertas.filter(o => !soPlanilha(o) && difs(o).length);
    const divergPlan = planilhaAtiva() ? abertas.filter(o => soPlanilha(o) && difs(o).length).length : 0;
    const semVinc = L.filter(o => !o.entidade_id && o.status !== "Cancelada");
    const outras = ativos.filter(e => e.tipo !== "escola");
    const MUD = CTX.mudancas || [];
    const ultima = MUD.length ? MUD.map(m => m.importado_em).sort().pop() : null;
    const ent = e => [esc(tc(e.nome || "(sem nome)")), esc(e.inep || ""), esc(e.tipologia || ""), esc(tc(e.municipio || "")), esc(greCurta(e.gre))];
    const CARDS = [
      { id: "div", c: "r", n: diverg.length, t: "O.S. em aberto diferente da base", x: "Os dados da escola na O.S. não batem com a base atual. A O.S. não muda sozinha: a gerência decide. Campo vazio na base nunca apaga o dado da O.S." + (divergPlan ? ` Mais ${divergPlan} O.S. da planilha com diferença: corrija na planilha até a virada.` : "") },
      { id: "rem", c: "r", n: removidas.length, t: "Entidade removida da base", x: "O.S. em aberto ligadas a uma entidade que saiu da planilha ENTIDADES" },
      { id: "sem", c: "y", n: semInep.length, t: "Escola sem INEP", x: "Classificada como escola, mas sem INEP. Setores e entidades externas não entram aqui." },
      { id: "rep", c: "y", n: repetido.length, t: "INEP repetido", x: "O mesmo INEP em mais de uma linha da base" },
      { id: "pad", c: "y", n: foraPadrao.length, t: "INEP fora do padrão", x: "Escola com INEP que não tem 8 dígitos começando por 22 (Piauí)" },
      { id: "vaz", c: "y", n: vazios.length, t: "Campos obrigatórios vazios", x: "Falta nome, município, GRE ou endereço" },
      { id: "vin", c: "y", n: semVinc.length, t: "O.S. sem vínculo com a base", x: "O.S. antigas cuja escola não foi encontrada na base na importação" },
      { id: "mud", c: "g", n: MUD.length, t: "Mudanças na última importação", x: ultima ? "Importação de " + quando(ultima) : "Nenhuma importação registrada" },
      { id: "out", c: "g", n: outras.length, t: "Outras entidades", x: "Setores da sede, sedes de GRE, polos e entidades externas. Informativo." }];
    $("audEnt").innerHTML = `<h3 class="sec">Base de entidades</h3><div class="d">A planilha ENTIDADES continua sendo a fonte. Ela é importada periodicamente; as O.S. guardam os dados da escola do momento da emissão e só mudam com a decisão da gerência, registrada no histórico.</div>
      <div class="audg">${CARDS.map(c => `<div class="ac ${c.c} ${audE === c.id ? "on" : ""}" data-id="${c.id}"><div class="v">${nf(c.n)}</div><div class="t">${c.t}</div><div class="x">${c.x}</div></div>`).join("")}</div>
      <div class="card" id="audEntL"></div>`;
    $("audEnt").querySelectorAll(".ac").forEach(el => el.onclick = () => { audE = el.dataset.id; selE.clear(); audEntidades(L); });
    const c = CARDS.find(x => x.id === audE), tabEnt = R => `<div class="tbl" style="max-height:55vh"><table><thead><tr><th>Entidade</th><th>INEP</th><th>Tipologia</th><th>Município</th><th>GRE</th></tr></thead><tbody>${
      R.map(e => `<tr>${ent(e).map((v, i) => `<td>${i ? v : `<div class="esc">${v}</div>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const tabOS = (R, ev) => `<div class="tbl" style="max-height:55vh"><table><thead><tr>${audE === "div" && GMAP ? '<th><input type="checkbox" id="selEAll"></th>' : ""}<th>Nº O.S.</th><th>Empresa</th><th>Escola na O.S.</th><th>Status</th><th>${audE === "div" ? "Diferenças (O.S. → base)" : "Detalhe"}</th></tr></thead><tbody>${
      R.map(o => `<tr class="r" data-os="${o.id}">${audE === "div" && GMAP ? `<td><input type="checkbox" class="selE" ${selE.has(o.id) ? "checked" : ""}></td>` : ""}<td><b>${esc(o.os)}</b></td><td>${esc(EMPN[o.emp] || o.emp)}</td>
        <td><div class="esc">${esc(tc(o.escola || ""))}</div><div class="mun">${esc(tc(o.mun || ""))}</div></td><td><span class="badge ${STB[o.status]}">${esc(UI.rotStatus(o.status))}</span></td><td class="ev">${ev(o)}</td></tr>`).join("")}</tbody></table></div>`;
    let corpo = "";
    if (audE === "div") corpo = diverg.length ? tabOS(diverg, o => difs(o).map(([r, a, b]) => `<div><b>${r}:</b> ${esc(a || "(vazio)")} → <span class="novo">${esc(b || "(vazio)")}</span></div>`).join("")) : "";
    else if (audE === "rem") corpo = removidas.length ? tabOS(removidas, () => "A entidade não está mais na planilha. Confirme com a GRE se a escola foi fechada, renomeada ou unificada.") : "";
    else if (audE === "vin") corpo = semVinc.length ? tabOS(semVinc, o => "INEP " + esc(o.inep || "não informado")) : "";
    else if (audE === "mud") corpo = MUD.length ? `<div class="tbl" style="max-height:55vh"><table><thead><tr><th>Entidade</th><th>Mudança</th><th>Antes</th><th>Depois</th><th>O.S. em aberto</th></tr></thead><tbody>${
      MUD.map(m => `<tr><td><div class="esc">${esc(tc(m.nome || ""))}</div></td><td><span class="badge ${m.tipo === "removida" ? "b-bad" : m.tipo === "incluída" ? "b-ok" : "b-info"}">${esc(m.tipo)}</span> ${esc(m.campo || "")}</td>
        <td>${esc(m.antes || "")}</td><td>${esc(m.depois || "")}</td><td class="n">${nf(abertas.filter(o => o.entidade_id === m.entidade_id).length)}</td></tr>`).join("")}</tbody></table></div>` : "";
    else corpo = { sem: semInep, rep: repetido, pad: foraPadrao, vaz: vazios, out: outras }[audE].length ? tabEnt({ sem: semInep, rep: repetido.sort((a, b) => a.inep.localeCompare(b.inep)), pad: foraPadrao, vaz: vazios, out: outras }[audE]) : "";
    $("audEntL").innerHTML = `<div class="lateh"><div><h3>${c.t} (${nf(c.n)})</h3><div class="d">${c.x}${audE === "sem" || audE === "rep" || audE === "pad" || audE === "vaz" ? ". Corrija na planilha ENTIDADES; a próxima importação atualiza esta lista." : ""}</div></div>
      ${audE === "div" && GMAP && diverg.length ? `<button class="btn pri" id="aplE" ${selE.size ? "" : "disabled"}>Aplicar os dados da base nas selecionadas (${selE.size})</button>` : ""}</div>
      ${corpo || '<div class="empty">Nenhuma ocorrência.</div>'}`;
    $("audEntL").querySelectorAll("tr.r").forEach(tr => tr.onclick = e => { if (e.target.type === "checkbox") return; P.openDet(tr.dataset.os); });
    $("audEntL").querySelectorAll(".selE").forEach(c => c.onchange = () => { const id = +c.closest("tr").dataset.os; c.checked ? selE.add(id) : selE.delete(id); audEntidades(L); });
    if ($("selEAll")) { $("selEAll").checked = diverg.length > 0 && diverg.every(o => selE.has(o.id)); $("selEAll").onchange = () => { diverg.forEach(o => $("selEAll").checked ? selE.add(o.id) : selE.delete(o.id)); audEntidades(L); }; }
    if ($("aplE")) $("aplE").onclick = () => dialogo({ titulo: `Atualizar ${selE.size} O.S. com os dados da base`, botao: "Aplicar",
      texto: "Os dados da escola nessas O.S. passam a ser os da base atual. Cada O.S. registra no histórico o valor antigo e o novo. As empresas não são avisadas por e-mail.",
      campos: [{ id: "obs", rot: "Motivo", tipo: "textarea", obrig: true, min: 5, valor: "Atualização da base ENTIDADES" }],
      enviar: async v => { const r = await rpc("os_aplicar_entidade", { p_ids: [...selE], p_obs: v.obs }); if (r.erro) return r.erro; selE.clear(); await P.recarregar(); aviso(`${r.data.atualizadas} O.S. atualizada(s).`, "ok"); return null; } });
  }

  // ---------- modelo da O.S. (somente a gerência edita) ----------
  let M = null, mSujo = false;
  const TIPOS = { texto: "Texto curto", textolongo: "Texto longo", numero: "Número", data: "Data", unica: "Escolha única (lista)", multipla: "Múltipla escolha", simnao: "Sim ou não" };
  const LISTAS = [["motivos", "Motivos da O.S.", "Aparecem como opções para marcar; a O.S. exige ao menos um."], ["ambientes", "Ambientes", "Lista para informar onde estão os splits. \"Outro\" sempre existe, com descrição."],
    ["motivos_cancelamento", "Motivos de cancelamento", "Usados pela gerência ao cancelar. \"Outro motivo\" sempre existe, com descrição."],
    ["problemas", "Tipos de problema", "Usados pela empresa e pela GMAP ao registrar um problema na O.S. \"Outro problema\" sempre existe, com descrição."]];
  const novoId = p => p + Math.random().toString(36).slice(2, 8);
  function renderModelo() {
    if (!GMAP) return;
    if (!M) { M = JSON.parse(JSON.stringify(MOD())); mSujo = false; }
    if (!M.problemas) M.problemas = [];   // banco sem a migração 014
    const base = MOD();
    $("v-modelo").innerHTML = `<div class="card"><h3>Modelo da O.S.</h3>
      <div class="d">Versão ${base.versao}${base.alterado_por ? ` · alterada por ${esc(base.alterado_por)} em ${quando(base.alterado_em)}` : ""}. As mudanças valem para as próximas O.S.; cada O.S. já emitida guarda o que foi preenchido, com os textos daquele momento.</div>
      <div class="faixa warn" id="mAviso" ${mSujo ? "" : "hidden"}><b>Há alterações não salvas.</b> Salve no fim da página.</div></div>
      <div class="card"><h3>Listas de opções</h3><div class="d">Ficam em ordem alfabética automaticamente. Para tirar uma opção de uso, desmarque "ativa": as O.S. antigas continuam mostrando o texto.</div>
        <div class="mlistas">${LISTAS.map(([k, t, x]) => `<div class="mlista" data-k="${k}"><h4>${t}</h4><div class="mun">${x}</div>
          ${M[k].slice().sort((a, b) => a.texto.localeCompare(b.texto, "pt-BR")).map(o => `<div class="mopt ${o.ativo ? "" : "inativa"}" data-id="${esc(o.id)}">
            <input class="mtx" value="${esc(o.texto)}" maxlength="80" aria-label="Texto da opção"><label class="mun"><input type="checkbox" class="mat" ${o.ativo ? "checked" : ""}> ativa</label>
            ${o.novo ? `<button type="button" class="ib sm" data-a="rem" data-tip="Remover" aria-label="Remover">${UI.icone("cancelar")}</button>` : ""}</div>`).join("")}
          <div class="madd"><input class="mnova" placeholder="Nova opção" maxlength="80" aria-label="Nova opção em ${t}"><button type="button" class="btn" data-a="add">Adicionar</button></div>
          ${k === "motivos" ? `<label class="mun mchk"><input type="checkbox" id="mOutro" ${M.motivo_outro ? "checked" : ""}> Permitir "Outro" com descrição</label>` : ""}</div>`).join("")}</div></div>
      <div class="card"><h3>Regras dos campos</h3><div class="chks">
        <label><input type="checkbox" class="mreg" data-c="ambientes" ${M.campos.ambientes.obrigatorio ? "checked" : ""}> Ambientes obrigatórios</label>
        <label><input type="checkbox" class="mreg" data-c="responsavel" ${M.campos.responsavel.obrigatorio ? "checked" : ""}> Responsável pela entidade obrigatório</label>
        <label><input type="checkbox" class="mreg" data-c="descricao" ${M.campos.descricao.obrigatorio ? "checked" : ""}> Descrição obrigatória</label></div>
        <div class="mun">Escola, empresa, prioridade, tipo de serviço, motivo e origem são sempre obrigatórios: as regras de prazo, área e relatórios dependem deles.</div></div>
      <div class="card"><div class="lateh"><div><h3>Campos adicionais</h3><div class="d">Perguntas extras que aparecem no fim do formulário, em "Informações adicionais", e saem na O.S. impressa.</div></div>
        <button type="button" class="btn" id="mAddQ">+ Adicionar campo</button></div>
        ${M.perguntas.length ? M.perguntas.map((q, i) => `<div class="mq ${q.ativo ? "" : "inativa"}" data-i="${i}">
          <div class="mqh"><b>${i + 1}.</b><input class="mqr" value="${esc(q.rotulo)}" placeholder="Título do campo" maxlength="120" aria-label="Título do campo">
            <select class="mqt" aria-label="Tipo">${Object.entries(TIPOS).map(([v, t]) => `<option value="${v}" ${q.tipo === v ? "selected" : ""}>${t}</option>`).join("")}</select>
            <span class="mqb"><button type="button" class="ib sm" data-a="up" data-tip="Subir" aria-label="Subir" ${i ? "" : "disabled"}>${UI.icone("subir")}</button>
            <button type="button" class="ib sm" data-a="down" data-tip="Descer" aria-label="Descer" ${i < M.perguntas.length - 1 ? "" : "disabled"}>${UI.icone("descer")}</button>
            ${q.novo ? `<button type="button" class="ib sm" data-a="del" data-tip="Remover" aria-label="Remover">${UI.icone("cancelar")}</button>` : ""}</span></div>
          <div class="mqo"><label class="mun"><input type="checkbox" class="mqob" ${q.obrigatorio ? "checked" : ""}> obrigatório</label><label class="mun"><input type="checkbox" class="mqat" ${q.ativo ? "checked" : ""}> ativo</label>
            <input class="mqa" value="${esc(q.ajuda || "")}" placeholder="Texto de ajuda (opcional)" maxlength="200" aria-label="Texto de ajuda"></div>
          ${["unica", "multipla"].includes(q.tipo) ? `<label class="fl"><span>Opções (uma por linha)</span><textarea class="mqop" rows="3">${esc((q.opcoes || []).join("\n"))}</textarea></label>` : ""}</div>`).join("")
          : '<div class="empty">Nenhum campo adicional. Use "+ Adicionar campo".</div>'}</div>
      <div class="mbar"><button type="button" class="btn" id="mPrev">Pré-visualizar o formulário</button><span class="sp"></span>
        <button type="button" class="btn" id="mDesc" ${mSujo ? "" : "disabled"}>Descartar alterações</button><button type="button" class="btn pri" id="mSalvar" ${mSujo ? "" : "disabled"}>Salvar modelo</button></div>
      <div class="card"><h3>Histórico do modelo</h3><div id="mLog"><div class="mun">Carregando…</div></div></div>`;
    ligarModelo(); carregarLogModelo();
  }
  function ligarModelo() {
    const v = $("v-modelo"), mudou = re => { mSujo = true; if (re) renderModelo(); else { $("mSalvar").disabled = false; $("mDesc").disabled = false; $("mAviso").hidden = false; } };
    v.querySelectorAll(".mlista").forEach(box => {
      const k = box.dataset.k, achar = el => M[k].find(o => o.id === el.closest(".mopt").dataset.id);
      box.querySelectorAll(".mtx").forEach(i => i.oninput = () => { achar(i).texto = i.value; mudou(); });
      box.querySelectorAll(".mat").forEach(c => c.onchange = () => { achar(c).ativo = c.checked; mudou(true); });
      box.querySelectorAll('[data-a="rem"]').forEach(b => b.onclick = () => { M[k] = M[k].filter(o => o !== achar(b)); mudou(true); });
      const add = () => { const t = box.querySelector(".mnova").value.trim(); if (!t) return UI.alerta({ titulo: "Escreva a nova opção", itens: "Digite o texto antes de clicar em Adicionar.", campos: [box.querySelector(".mnova")] });
        if (M[k].some(o => norm(o.texto) === norm(t))) return UI.alerta({ titulo: "Opção repetida", itens: `"${t}" já existe nesta lista. Se estiver desativada, marque "ativa".`, campos: [box.querySelector(".mnova")] });
        M[k].push({ id: novoId("o"), texto: t, ativo: true, novo: true }); mudou(true); };
      box.querySelector('[data-a="add"]').onclick = add;
      box.querySelector(".mnova").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
    });
    if ($("mOutro")) $("mOutro").onchange = () => { M.motivo_outro = $("mOutro").checked; mudou(); };
    v.querySelectorAll(".mreg").forEach(c => c.onchange = () => { M.campos[c.dataset.c].obrigatorio = c.checked; mudou(); });
    $("mAddQ").onclick = () => { M.perguntas.push({ id: novoId("q"), rotulo: "", tipo: "texto", obrigatorio: false, ajuda: "", opcoes: [], ativo: true, novo: true }); mudou(true);
      const ult = [...document.querySelectorAll(".mqr")].pop(); if (ult) ult.focus(); };
    v.querySelectorAll(".mq").forEach(box => {
      const i = +box.dataset.i, q = M.perguntas[i];
      box.querySelector(".mqr").oninput = e => { q.rotulo = e.target.value; mudou(); };
      box.querySelector(".mqt").onchange = e => { q.tipo = e.target.value; mudou(true); };
      box.querySelector(".mqob").onchange = e => { q.obrigatorio = e.target.checked; mudou(); };
      box.querySelector(".mqat").onchange = e => { q.ativo = e.target.checked; mudou(true); };
      box.querySelector(".mqa").oninput = e => { q.ajuda = e.target.value; mudou(); };
      if (box.querySelector(".mqop")) box.querySelector(".mqop").oninput = e => { q.opcoes = e.target.value.split("\n").map(s => s.trim()).filter(Boolean); mudou(); };
      box.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === "del") M.perguntas.splice(i, 1);
        else { const j = a === "up" ? i - 1 : i + 1; [M.perguntas[i], M.perguntas[j]] = [M.perguntas[j], M.perguntas[i]]; }
        mudou(true);
      });
    });
    $("mPrev").onclick = previaModelo;
    $("mDesc").onclick = async () => { if (!(await UI.confirmar({ titulo: "Descartar as alterações do modelo?", botao: "Descartar", perigo: true }))) return; M = null; renderModelo(); };
    $("mSalvar").onclick = salvarModelo;
  }
  function conferirModelo() {
    const f = [];
    LISTAS.forEach(([k, t]) => {
      M[k].forEach(o => { if (o.texto.trim().length < 2) f.push(`${t}: há uma opção sem texto.`); });
      const at = M[k].filter(o => o.ativo).map(o => norm(o.texto)); if (new Set(at).size !== at.length) f.push(`${t}: há opção repetida.`);
      if (!M[k].some(o => o.ativo)) f.push(`${t}: deixe ao menos uma opção ativa.`);
    });
    M.perguntas.forEach((q, i) => {
      if (q.rotulo.trim().length < 3) f.push(`Campo adicional ${i + 1}: escreva o título.`);
      if (["unica", "multipla"].includes(q.tipo) && (q.opcoes || []).length < 2) f.push(`Campo "${q.rotulo || i + 1}": informe pelo menos 2 opções.`);
    });
    return f;
  }
  async function salvarModelo() {
    const f = conferirModelo();
    if (f.length) return UI.alerta({ titulo: "Corrija o modelo antes de salvar", itens: f });
    const limpo = JSON.parse(JSON.stringify(M)); ["motivos", "ambientes", "motivos_cancelamento", "problemas"].forEach(k => (limpo[k] || []).forEach(o => delete o.novo)); limpo.perguntas.forEach(q => delete q.novo);
    if (!(limpo.problemas || []).length) delete limpo.problemas;   // banco sem a migração 014: não envia a lista
    if (!(await UI.confirmar({ titulo: "Salvar o modelo da O.S.?", texto: "As mudanças valem para as próximas O.S. As já emitidas não mudam.", botao: "Salvar modelo" }))) return;
    $("mSalvar").disabled = true;
    const r = await rpc("modelo_salvar", { p_modelo: limpo });
    if (r.erro) { $("mSalvar").disabled = false; return UI.alerta({ titulo: "Não foi possível salvar o modelo", itens: r.erro }); }
    M = null; mSujo = false; await P.recarregar(); renderModelo();
    aviso(r.data && r.data.sem_mudanca ? "Nada mudou no modelo." : `Modelo salvo (versão ${r.data.versao}).`, "ok");
  }
  function previaModelo() {
    const m = M, pergs = m.perguntas.filter(q => q.ativo && q.rotulo.trim());
    let d = $("dlg"); if (!d) { d = document.createElement("div"); d.id = "dlg"; d.className = "dlg"; document.body.appendChild(d); }
    d.innerHTML = `<div class="dlgp larga prev"><h2>Pré-visualização</h2><div class="sub">Como os campos do modelo aparecem no formulário da O.S. (só para ver; nada é enviado).</div>
      <span class="flt">Motivo da O.S. <i class="obr">obrigatório</i></span>${htmlMotivos(m, true).replace(/id="nMot(O|OT)?"/g, "")}
      <span class="flt">Ambientes ${m.campos.ambientes.obrigatorio ? '<i class="obr">obrigatório</i>' : '<small class="mun">opcional</small>'}</span>
      <div class="ambl"><select><option>Ambiente</option>${ativos(m.ambientes).map(t => `<option>${esc(t)}</option>`).join("")}<option>Outro</option></select><input class="ambq" placeholder="Splits" type="number"></div>
      <span class="flt">Responsável pela entidade ${m.campos.responsavel.obrigatorio ? '<i class="obr">obrigatório</i>' : '<small class="mun">opcional</small>'}</span>
      <div class="fgrid2"><label class="fl"><span>Nome</span><input></label><label class="fl"><span>Telefone ou e-mail</span><input></label></div>
      ${pergs.length ? `<span class="flt">Informações adicionais</span><div class="fgrid2">${pergs.map(q => htmlPergunta(Object.assign({}, q, { id: "prev_" + q.id }))).join("")}</div>` : ""}
      <span class="flt">Motivos de cancelamento (na tela de cancelar)</span><div class="mun">${ativos(m.motivos_cancelamento).concat(["Outro motivo"]).map(esc).join(" · ")}</div>
      <span class="flt">Tipos de problema (na tela de registrar problema)</span><div class="mun">${ativos(m.problemas || []).concat(["Outro problema"]).map(esc).join(" · ")}</div>
      <div class="dlgb"><button type="button" class="btn pri" id="pvF">Fechar</button></div></div>`;
    d.classList.add("on"); $("pvF").onclick = () => d.classList.remove("on");
  }
  async function carregarLogModelo() {
    const { data } = await sb.from("os_modelo_log").select("*").order("id", { ascending: false }).limit(100);
    if (!$("mLog")) return;
    $("mLog").innerHTML = (data || []).length ? data.map(l => `<div class="hi"><div class="hq">${quando(l.quando)}</div><div><b>Versão ${l.versao}</b> · ${esc(l.quem_nome)}<div class="mun">${esc(l.resumo)}</div></div></div>`).join("")
      : '<div class="mun">Nenhuma alteração desde a versão inicial.</div>';
  }
  async function sairDoModelo() {
    if (!mSujo) return true;
    const r = await UI.escolher({ titulo: "O modelo tem alterações não salvas", texto: "Salve antes de sair ou descarte as mudanças.",
      opcoes: [{ id: "ficar", rotulo: "Continuar editando", classe: "pri" }, { id: "descartar", rotulo: "Descartar alterações", classe: "no" }] });
    if (r === "descartar") { M = null; mSujo = false; return true; }
    return false;
  }
  const podeSair = v => v === "nova" ? sairDaNova() : v === "modelo" ? sairDoModelo() : Promise.resolve(true);

  // uma diferença da planilha: o que estava na planilha, o que ela diz agora e o que o sistema tem
  // (avisos antigos, de antes da 2.10, não têm o valor anterior)
  const difTxt = d => "anterior" in d
    ? `<div><b>${esc(d.campo)}:</b> na planilha ${esc(d.anterior || "vazio")} → <span class="novo">${esc(d.planilha || "vazio")}</span> <span class="mun">(no sistema: ${esc(d.sistema || "vazio")})</span></div>`
    : `<div><b>${esc(d.campo)}:</b> no sistema ${esc(d.sistema || "vazio")} → na planilha <span class="novo">${esc(d.planilha || "vazio")}</span></div>`;
  const ibA = (a, ic, t, c) => UI.botaoIcone(ic, t, c).replace(`data-acao="${ic}"`, `data-a="${a}"`);
  // ---------- aba Planilha: lançamentos feitos na planilha depois da virada ----------
  function renderPlanilha() {
    const L = CTX.pendencias || [], novas = L.filter(x => x.tipo === "nova" && x.situacao === "aberta"), muds = pendAbertas().filter(x => x.tipo === "mudanca"), mudsC = pendCanceladas();
    const tratadas = L.filter(x => x.situacao !== "aberta").sort((a, b) => String(b.decidido_em || b.atualizado_em).localeCompare(String(a.decidido_em || a.atualizado_em))).slice(0, 80);
    const SIT = { importada: "b-ok", descartada: "b-gray", aplicada: "b-ok", mantida: "b-info", resolvida: "b-ok" };
    const usados = new Set(P.todos().concat(P.solic()).map(x => x.numero));
    $("v-planilha").innerHTML = `<div class="card"><h3>Planilha geral em observação</h3><div class="d">A emissão é feita no sistema. A planilha continua sendo lida no fim de cada consolidação só para comparar: nada nela muda o sistema sozinho.
      ${CTX.config && CTX.config.planilha_observada_em ? `Última leitura: ${quando(CTX.config.planilha_observada_em)}.` : "Ainda não houve leitura depois da virada."}</div></div>
      <div class="card"><h3>O.S. novas lançadas na planilha (${novas.length})</h3><div class="d">Importe para gerar a O.S. no sistema com os dados da planilha (número, data e prazo mantidos) ou descarte se foi lançada por engano.</div>
        ${novas.length ? novas.map(p => { const d = p.dados || {}; return `<div class="sol" data-p="${p.id}"><div class="solh"><b>${esc(p.numero)}</b> <span class="badge b-warn">Nova na planilha</span> <span class="badge ${PRB[d.prioridade] || "b-gray"}">${esc(d.prioridade || "sem prioridade")}</span>
          <span class="mun">detectada ${ha(p.detectado_em)}</span>${usados.has(p.numero) ? ' <span class="badge b-bad">número já usado no sistema</span>' : ""}</div>
          <div class="esc">${esc(tc(d.escola || ""))}</div><div class="mun">${esc(tc(d.municipio || ""))} · ${esc(greCurta(d.gre))} · INEP ${esc(d.inep || "não informado")}</div>
          <div class="solg"><span><small>Empresa</small>${esc(EMPN[p.empresa] || p.empresa)}</span><span><small>Serviço</small>${esc(d.descricao || "")}${d.splits != null ? " · " + d.splits + " splits" : ""}</span>
            <span><small>Criada / prazo</small>${fmt(d.criada_em) || "?"} · ${fmt(d.prazo) || "?"}</span><span><small>Status na planilha</small>${esc(d.status_planilha || d.status || "")}</span></div>
          ${d.observacoes ? `<div class="soltx">${esc(d.observacoes)}</div>` : ""}
          <div class="solb"><button class="btn pri" data-a="importar">Importar</button><button class="btn no" data-a="descartar">Descartar</button></div></div>`; }).join("") : '<div class="empty">Nenhuma O.S. nova na planilha.</div>'}</div>
      <div class="card"><h3>Mudanças feitas na planilha em O.S. do sistema (${muds.length})</h3><div class="d">Campos que alguém mudou na planilha depois da última leitura e que ficaram diferentes do sistema. O que muda só no sistema não aparece aqui. Nada muda sozinho: aplique no sistema os campos que estiverem certos na planilha ou mantenha o sistema, justificando. As mesmas ações aparecem dentro da O.S.</div>
        ${muds.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nº O.S.</th><th>Empresa</th><th>O que mudou</th><th></th></tr></thead><tbody>${muds.map(p => `<tr data-p="${p.id}" data-os="${p.os_id}">
          <td><b>${esc(p.numero)}</b><div class="mun">${ha(p.atualizado_em)}</div></td><td>${esc(EMPN[p.empresa] || p.empresa)}</td>
          <td class="ev">${(p.diferencas || []).map(difTxt).join("")}</td>
          <td><div class="acoes pacoes">${ibA("abrir", "abrir", "Abrir a O.S.")}${ibA("aplicar", "aplicar", "Aplicar no sistema", "pri")}${ibA("manter", "manter", "Manter o sistema")}</div></td></tr>`).join("")}</tbody></table></div>`
          : '<div class="empty">Nenhuma mudança nova na planilha.</div>'}</div>
      ${mudsC.length ? `<div class="card"><h3>Lançamentos da planilha em O.S. canceladas (${mudsC.length})</h3><div class="d">Só para consulta, fora das contagens. A O.S. cancelada não muda; se a empresa informou atendimento numa O.S. cancelada, ela não pode ser paga por ela.</div>
        <div class="tbl" style="max-height:none"><table><thead><tr><th>Nº O.S.</th><th>Empresa</th><th>O que a planilha diz</th><th></th></tr></thead><tbody>${mudsC.map(p => `<tr data-p="${p.id}" data-os="${p.os_id}">
          <td><b>${esc(p.numero)}</b> <span class="badge b-gray">Cancelada</span><div class="mun">${ha(p.atualizado_em)}</div></td><td>${esc(EMPN[p.empresa] || p.empresa)}</td>
          <td class="ev">${(p.diferencas || []).map(difTxt).join("")}</td>
          <td><div class="acoes pacoes">${ibA("abrir", "abrir", "Abrir a O.S.")}</div></td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${(() => { const sc = semComprovante(); return `<div class="card"><h3>Atendidas pela planilha sem a O.S. assinada (${sc.length})</h3><div class="d">Ao aplicar "Atendida" vinda da planilha, a O.S. fica aqui até a empresa (ou a gerência) anexar o PDF. A empresa recebe um e-mail pedindo o arquivo.</div>
        ${sc.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nº O.S.</th><th>Escola</th><th>Empresa</th><th>Atendida em</th><th></th></tr></thead><tbody>${sc.map(o => `<tr data-os="${o.id}">
          <td><b>${esc(o.os)}</b></td><td><div class="esc">${esc(tc(o.escola || ""))}</div><div class="mun">${esc(tc(o.mun || ""))}</div></td><td>${esc(EMPN[o.emp] || o.emp)}</td><td>${fmt(o.atend)}</td>
          <td><div class="acoes pacoes">${ibA("abrir", "abrir", "Abrir a O.S.")}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma O.S. aguardando a O.S. assinada.</div>'}</div>`; })()}
      <details class="card"><summary><h3 style="display:inline">Já tratados (${tratadas.length})</h3></summary>
        ${tratadas.length ? `<div class="tbl" style="max-height:50vh"><table><thead><tr><th>Nº O.S.</th><th>Tipo</th><th>Situação</th><th>Quem</th><th>Observação</th></tr></thead><tbody>${tratadas.map(p => `<tr>
          <td><b>${esc(p.numero)}</b></td><td>${p.tipo === "nova" ? "O.S. nova" : "Mudança"}</td><td><span class="badge ${SIT[p.situacao] || "b-gray"}">${esc(p.situacao)}</span></td>
          <td>${esc(p.decidido_por || "")}<div class="mun">${p.decidido_em ? quando(p.decidido_em) : ""}</div></td><td>${esc(p.obs || "")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nada ainda.</div>'}</details>`;
    const achar = el => { const r = el.closest("[data-p]"); return r ? (CTX.pendencias || []).find(x => String(x.id) === r.dataset.p) : null; };
    $("v-planilha").querySelectorAll("button[data-a]").forEach(b => b.onclick = async () => {
      const p = achar(b), a = b.dataset.a;
      if (a === "importar") { if (!(await P.podeSair())) return; return P.setView("nova", { modo: "importar", pend: p }); }
      if (a === "abrir") return P.openDet(b.closest("tr").dataset.os);
      if (a === "descartar") return dialogo({ titulo: `Descartar o lançamento ${p.numero} da planilha`, perigo: true, botao: "Descartar",
        texto: "A O.S. não será criada no sistema. O descarte fica registrado.",
        campos: [{ id: "obs", rot: "Por que não importar", tipo: "textarea", obrig: true, min: 5 }],
        enviar: async v => { const r = await rpc("pendencia_decidir", { p_id: p.id, p_acao: "descartar", p_obs: v.obs }); if (r.erro) return r.erro; await P.recarregar(); aviso("Lançamento descartado.", "ok"); return null; } });
      if (a === "aplicar" || a === "manter") return acaoPendencia(p, a);
    });
  }

  marcarAbaNova();
  // Auditoria: cancelar a O.S. duplicada, com o motivo e o detalhe já preenchidos (a pessoa pode mudar antes de confirmar).
  // Usa a mesma função do banco do cancelamento comum; continua na Auditoria depois de cancelar.
  // cancelamento com motivo e detalhe já preenchidos (a pessoa pode mudar antes de confirmar); usa a mesma função do banco
  function cancelarComo(o, motivoRe, detalhe, textoExtra) {
    if (!o) return;
    const ops = ativos(MOD().motivos_cancelamento).concat(["Outro motivo"]);
    const sug = (motivoRe && ops.find(m => motivoRe.test(m))) || "Outro motivo";
    return dialogo({ titulo: `Cancelar a O.S. ${o.os}`, perigo: true, botao: "Cancelar O.S.",
      texto: (textoExtra ? textoExtra + " " : "") + "O cancelamento não pode ser desfeito. A empresa é avisada por e-mail.",
      campos: [{ id: "motivo", rot: "Motivo", tipo: "select", opcoes: ops, obrig: true, valor: sug },
        { id: "texto", rot: "Detalhe", tipo: "textarea", valor: detalhe || "", dica: "Obrigatório quando o motivo for \"Outro motivo\"." }],
      enviar: async v => {
        if (v.motivo === "Outro motivo" && (v.texto || "").length < 10) return "Descreva o motivo (mínimo de 10 caracteres).";
        const r = await rpc("os_cancelar", { p_id: o.id, p_motivo: v.motivo, p_texto: v.texto });
        if (r.erro) return r.erro;
        await P.recarregar(); aviso(`O.S. ${o.os} cancelada.`, "ok"); return null;
      } });
  }
  // Auditoria: cancelar a O.S. duplicada, com o motivo e o detalhe já preenchidos
  function cancelarDuplicada(o, outra) {
    if (!o || !outra) return;
    return cancelarComo(o, /duplicad/i, `Duplicada da O.S. ${outra.os} (${EMPN[outra.emp] || outra.emp}, criada em ${fmt(outra.criada)})`, `Duplicada da O.S. ${esc(outra.os)}, que continua em aberto.`);
  }
  return { dialogo, cancelarDuplicada, renderPlanilha, renderModelo, podeSair, faixaHoje, contarAprov, renderNova, renderAprov, renderEmpresas, faixaDetalhe, botoesDetalhe, ligarDetalhe, historico, audEntidades };
};
