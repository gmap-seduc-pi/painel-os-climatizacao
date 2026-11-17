/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Aba "Fiscalização": atendimentos de um período (pela data informada pela empresa), para a
   conferência dos fiscais de contrato antes do pagamento. Resumo, pontos de atenção, lista com a
   O.S. assinada, conferência (gerência e perfil Consultivo), relatório e download das O.S. assinadas.
   As permissões são conferidas no banco; esta tela só chama as funções autorizadas. */
window.iniciarFiscalizacao = function (P) {
  const { CTX, $, esc, fmt, tc, nf, EMPN, SERV, SERVN, PRIOS } = P;
  const sb = CTX.sb;
  const PODE = P.podeConferir;                       // gerência e Consultivo
  const DENTRO = ["Atendida no prazo", "Atendida antes da O.S."];
  const SIT = { conferida: ["Conferida", "b-ok"], ressalva: ["Com ressalva", "b-warn"], glosada: ["Glosada", "b-bad"], aconferir: ["A conferir", "b-gray"] };
  const LIMITE_REGISTRO = 7;                         // dias entre o atendimento e o registro no sistema que viram alerta
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const hoje = CTX.ref;                              // AAAA-MM-DD
  const fimDoMes = m => { const [a, b] = m.split("-").map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };
  const mesAnterior = () => { const [a, b] = hoje.split("-").map(Number); const d = new Date(Date.UTC(a, b - 2, 1)); return d.toISOString().slice(0, 7); };
  const diaLocal = ts => ts ? new Date(ts).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null;
  const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  const ST0 = () => ({ mes: mesAnterior(), de: "", ate: "", emp: "", gre: "", ver: "todas", alerta: "", sel: new Set() });
  const ST = ST0();
  // O.S. assinada só é exigida nas O.S. emitidas a partir da data configurada pela gerência
  const pdfDesde = () => (CTX.config && CTX.config.pdf_obrigatorio_desde) || "2026-12-01";
  const exigePdf = o => !!o.criada && o.criada >= pdfDesde();
  const motivosTxt = c => (c && c.motivos && c.motivos.length ? c.motivos.join("; ") : "");
  const plural = (n, s, p) => nf(n) + " " + (n === 1 ? s : p);

  function periodo() {
    if (ST.mes === "outro") return { de: ST.de || hoje.slice(0, 8) + "01", ate: ST.ate || hoje };
    return { de: ST.mes + "-01", ate: fimDoMes(ST.mes) };
  }
  const conf = o => (CTX.conferencias || {})[o.id];
  const sitConf = o => { const c = conf(o); return !c || c.situacao === "pendente" ? "aconferir" : c.situacao; };

  // pontos de atenção de cada O.S. do período
  function analisar(L) {
    const porChave = {};
    L.forEach(o => o.serv.forEach(s => { const k = (o.inep || o.escola) + "|" + s; (porChave[k] = porChave[k] || []).push(o); }));
    return L.map(o => {
      const reg = diaLocal(o.atendido_registrado_em), lag = reg && o.atend ? dias(reg, o.atend) : null, c = conf(o);
      const a = [];
      if (o.sp === "Atendida fora do prazo") a.push(["fora", `Fora do prazo (${plural(o.atraso, "dia", "dias")})`]);
      if (o.sp === "Atendida antes da O.S.") a.push(["antes", "Atendimento com data anterior à emissão"]);
      if (!o.pdf_caminho && exigePdf(o)) a.push(["semPdf", "Sem a O.S. assinada no sistema"]);
      if (lag != null && lag > LIMITE_REGISTRO) a.push(["tarde", `Registrado ${plural(lag, "dia", "dias")} depois da data informada`]);
      if (o.pend) a.push(["pend", "Empresa relatou pendências"]);
      if (c && c.situacao !== "pendente" && o.atendido_registrado_em && Date.parse(c.em) < Date.parse(o.atendido_registrado_em)) a.push(["mudou", "Atendimento alterado depois da conferência"]);
      const dup = [...new Set(o.serv.flatMap(s => (porChave[(o.inep || o.escola) + "|" + s] || []).filter(x => x !== o)))];
      if (dup.length) a.push(["dup", "Mesma escola e serviço no período: " + dup.map(x => x.os).join(", ")]);
      return { o, reg, lag, alertas: a, sit: sitConf(o) };
    });
  }
  const ALERTAS = { fora: "Fora do prazo", semPdf: "Sem O.S. assinada", tarde: `Registro tardio (mais de ${LIMITE_REGISTRO} dias)`, antes: "Data anterior à emissão",
                    dup: "Mesma escola e serviço", pend: "Pendências relatadas", mudou: "Alterada depois da conferência" };

  function dados() {
    const { de, ate } = periodo();
    const L = P.todos().filter(o => o.status === "Atendida" && o.atend && o.atend >= de && o.atend <= ate && (!ST.emp || o.emp === ST.emp) && (!ST.gre || o.gre === ST.gre))
      .sort((a, b) => (a.atend || "").localeCompare(b.atend || "") || String(a.os).localeCompare(String(b.os), "pt-BR", { numeric: true }));
    return { de, ate, A: analisar(L) };
  }
  const descricao = (de, ate) => `Atendimentos com data entre ${fmt(de)} e ${fmt(ate)}` + (ST.emp ? " · " + (EMPN[ST.emp] || ST.emp) : " · todas as empresas") + (ST.gre ? " · " + ST.gre : "");

  function render() {
    const { de, ate, A } = dados();
    const meses = [...new Set(P.todos().filter(o => o.atend).map(o => o.atend.slice(0, 7)))].concat([hoje.slice(0, 7)]);
    const mesesU = [...new Set(meses)].sort().reverse().slice(0, 24);
    const emps = [...new Set(P.todos().map(o => o.emp).filter(Boolean))].sort((a, b) => (EMPN[a] || a).localeCompare(EMPN[b] || b));
    const gres = [...new Set(P.todos().map(o => o.gre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    const n = A.length, noPrazo = A.filter(x => DENTRO.includes(x.o.sp)).length, fora = A.filter(x => x.o.sp === "Atendida fora do prazo");
    const atrMed = fora.length ? Math.round(fora.reduce((s, x) => s + (x.o.atraso || 0), 0) / fora.length) : 0;
    const splits = A.reduce((s, x) => s + (+x.o.splits || 0), 0), semPdf = A.filter(x => x.alertas.some(a => a[0] === "semPdf")).length;
    const cont = k => A.filter(x => x.sit === k).length;
    const visiveis = A.filter(x => (ST.ver === "todas" || x.sit === ST.ver) && (!ST.alerta || x.alertas.some(a => a[0] === ST.alerta)));
    ST.sel = new Set([...ST.sel].filter(id => visiveis.some(x => String(x.o.id) === id)));
    const porServ = SERV.map(s => { const LL = A.filter(x => x.o.serv.includes(s)); return [SERVN[s] || s, LL.length, LL.reduce((t, x) => t + (+x.o.splits || 0), 0),
      LL.filter(x => DENTRO.includes(x.o.sp)).length, LL.filter(x => x.o.sp === "Atendida fora do prazo").length]; }).filter(r => r[1]);
    const porPrio = PRIOS.map(p => { const LL = A.filter(x => x.o.prio === p), f = LL.filter(x => x.o.sp === "Atendida fora do prazo");
      return [p, LL.length, LL.filter(x => DENTRO.includes(x.o.sp)).length, f.length, f.length ? Math.round(f.reduce((t, x) => t + (x.o.atraso || 0), 0) / f.length) : 0]; }).filter(r => r[1]);
    const porGre = [...new Set(A.map(x => x.o.gre || "Não informada"))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
      .map(g => { const LL = A.filter(x => (x.o.gre || "Não informada") === g); return [g, LL.length, LL.reduce((t, x) => t + (+x.o.splits || 0), 0)]; });
    const contAlerta = k => A.filter(x => x.alertas.some(a => a[0] === k)).length;
    const tab = (H, R) => `<div class="tbl" style="max-height:none"><table class="nocard fisr"><thead><tr>${H.map((h, i) => `<th${i ? ' class="n"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${R.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

    $("v-fisc").innerHTML = `
      <div class="card"><div class="fish"><h3>Fiscalização dos atendimentos</h3>
          <button type="button" class="btn" id="fLimpa" ${JSON.stringify([ST.mes, ST.emp, ST.gre, ST.ver, ST.alerta]) === JSON.stringify([mesAnterior(), "", "", "todas", ""]) ? "disabled" : ""}>${UI.icone("limpar")}<span>Limpar filtros</span></button></div>
        <div class="d">Para conferir a execução do contrato antes do pagamento. O período considera a <b>data do atendimento informada pela empresa</b>; o relatório aponta quando o registro no sistema foi feito muito depois.</div>
        <div class="fisf">
          <label>Empresa<select id="fEmp"><option value="">Todas</option>${emps.map(e => `<option value="${esc(e)}" ${ST.emp === e ? "selected" : ""}>${esc(EMPN[e] || e)}</option>`).join("")}</select></label>
          <label>Período<select id="fMes">${mesesU.map(m => { const [a, b] = m.split("-"); return `<option value="${m}" ${ST.mes === m ? "selected" : ""}>${MESES[+b - 1]}/${a}${m === hoje.slice(0, 7) ? " (parcial)" : ""}</option>`; }).join("")}<option value="outro" ${ST.mes === "outro" ? "selected" : ""}>Outro período…</option></select></label>
          ${ST.mes === "outro" ? `<label>De<input type="date" id="fDe" value="${de}"></label><label>Até<input type="date" id="fAte" value="${ate}"></label>` : ""}
          <label>GRE<select id="fGre"><option value="">Todas</option>${gres.map(g => `<option ${ST.gre === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
        </div>
        <div class="mun" id="fDesc">${esc(descricao(de, ate))}</div>
      </div>
      <div class="kpis fisk">
        <div class="kpi"><div class="v">${nf(n)}</div><div class="l">O.S. atendidas</div><div class="h">${plural(splits, "split", "splits")}</div></div>
        <div class="kpi ok"><div class="v">${n ? Math.round(noPrazo / n * 100) : 0}%</div><div class="l">No prazo</div><div class="h">${plural(noPrazo, "O.S.", "O.S.")} de ${nf(n)}</div></div>
        <div class="kpi ${fora.length ? "bad" : ""}"><div class="v">${nf(fora.length)}</div><div class="l">Fora do prazo</div><div class="h">${fora.length ? "atraso médio de " + plural(atrMed, "dia", "dias") : "nenhuma"}</div></div>
        <div class="kpi ${semPdf ? "warn" : ""}"><div class="v">${nf(semPdf)}</div><div class="l">Sem O.S. assinada</div><div class="h">exigida desde ${fmt(pdfDesde())}</div></div>
        <div class="kpi"><div class="v">${nf(cont("conferida") + cont("ressalva") + cont("glosada"))}<small>/${nf(n)}</small></div><div class="l">Conferidas</div><div class="h">${nf(cont("ressalva"))} com ressalva · ${nf(cont("glosada"))} glosada${cont("glosada") === 1 ? "" : "s"}</div></div>
      </div>
      ${n ? `      <div class="card"><h3>Pontos de atenção</h3><div class="d">Toque para ver só as O.S. com aquele ponto.</div>
        <div class="fchips">${Object.entries(ALERTAS).map(([k, t]) => { const c = contAlerta(k); return `<button type="button" class="fchip ${ST.alerta === k ? "on" : ""} ${c ? "" : "zero"}" data-al="${k}" ${c ? "" : "disabled"}>${t} <b>${nf(c)}</b></button>`; }).join("")}</div>
      </div>` : ""}
      <div class="card"><div class="fish"><h3>O.S. atendidas no período (${nf(visiveis.length)}${visiveis.length !== n ? " de " + nf(n) : ""})</h3>
          <div class="acoes"><button class="btn" id="fXls" ${n ? "" : "disabled"}>Exportar Excel</button><button class="btn" id="fPrt" ${n ? "" : "disabled"}>Imprimir relatório</button>
            <button class="btn" id="fZip" ${A.some(x => x.o.pdf_caminho) ? "" : "disabled"}>Baixar O.S. assinadas (${nf(A.filter(x => x.o.pdf_caminho).length)})</button></div></div>
        <div class="fchips">${[["todas", "Todas", n], ["aconferir", "A conferir", cont("aconferir")], ["conferida", "Conferidas", cont("conferida")], ["ressalva", "Com ressalva", cont("ressalva")], ["glosada", "Glosadas", cont("glosada")]]
          .map(([k, t, c]) => `<button type="button" class="fchip ${ST.ver === k ? "on" : ""}" data-ver="${k}">${t} <b>${nf(c)}</b></button>`).join("")}
          ${ST.alerta ? `<span class="chip">${esc(ALERTAS[ST.alerta])} <button id="fXAl" title="Remover este filtro">×</button></span>` : ""}</div>
        ${PODE && visiveis.length ? `<div class="fisb"><label class="chk1"><input type="checkbox" id="fTodas" ${visiveis.length && visiveis.every(x => ST.sel.has(String(x.o.id))) ? "checked" : ""}><span>Marcar todas da lista</span></label>
          <button class="btn pri" id="fConfSel" ${ST.sel.size ? "" : "disabled"}>Conferir selecionadas (${nf(ST.sel.size)})</button></div>` : ""}
        ${visiveis.length ? `<div class="tbl" style="max-height:none"><table class="fist"><thead><tr>${PODE ? "<th></th>" : ""}<th>Nº O.S.</th><th>Escola</th><th>Serviço</th><th>Prazo</th><th>Atendida em</th><th>Registro no sistema</th><th>O.S. assinada</th><th>Conferência</th><th></th></tr></thead><tbody>${
          visiveis.map(x => { const o = x.o, c = conf(o), s = SIT[x.sit];
            return `<tr class="r" data-id="${o.id}">${PODE ? `<td class="tc-sem"><input type="checkbox" class="fck" aria-label="Selecionar O.S. ${esc(o.os)}" ${ST.sel.has(String(o.id)) ? "checked" : ""}></td>` : ""}
              <td><b>${esc(o.os)}</b><div class="mun">${esc(EMPN[o.emp] || o.emp)} · ${esc(o.prio || "")}</div></td>
              <td><div class="esc">${esc(tc(o.escola || ""))}</div><div class="mun">${esc(tc(o.mun || ""))}${o.gre ? " · " + esc(o.gre) : ""}</div></td>
              <td>${esc(o.serv.map(t => SERVN[t] || t).join(", "))}${o.splits != null ? `<div class="mun">${plural(+o.splits, "split", "splits")}</div>` : ""}</td>
              <td>${fmt(o.prazo)}<div class="mun">emitida ${fmt(o.criada)}</div></td>
              <td>${fmt(o.atend)}<div>${o.sp === "Atendida antes da O.S." ? '<span class="badge b-warn">Antes da emissão</span>' : DENTRO.includes(o.sp) ? '<span class="badge b-ok">No prazo</span>' : o.sp === "Atendida fora do prazo" ? `<span class="badge b-bad">${plural(o.atraso, "dia", "dias")} de atraso</span>` : `<span class="badge b-gray">${esc(o.sp)}</span>`}</div></td>
              <td>${x.reg ? fmt(x.reg) + (x.lag > 0 ? `<div class="mun ${x.lag > LIMITE_REGISTRO ? "txbad" : ""}">${plural(x.lag, "dia", "dias")} depois</div>` : `<div class="mun">no mesmo dia</div>`) : '<span class="mun">pela planilha</span>'}</td>
              <td>${o.pdf_caminho ? `<button class="btn" data-pdf="${o.id}">Ver PDF</button>` : exigePdf(o) ? '<span class="badge b-warn">Falta</span>' : `<span class="mun">não exigida<br>(emitida antes de ${fmt(pdfDesde())})</span>`}</td>
              <td><span class="badge ${s[1]}">${s[0]}</span>${c && c.situacao !== "pendente" ? `<div class="mun">${esc(c.quem_nome || "")}${c.funcao ? " (" + esc(c.funcao) + ")" : ""} · ${fmt(diaLocal(c.em))}</div>${motivosTxt(c) ? `<div class="fmot">${c.motivos.map(m => `<span>${esc(m)}</span>`).join("")}</div>` : ""}${c.obs ? `<div class="mun">Obs.: ${esc(c.obs)}</div>` : ""}` : ""}
                ${x.alertas.length ? `<div class="falt">${x.alertas.map(a => `<span>${esc(a[1])}</span>`).join("")}</div>` : ""}</td>
              <td><div class="acoes">${PODE ? `<button class="btn" data-conf="${o.id}">${x.sit === "aconferir" ? "Conferir" : "Alterar"}</button>` : ""}<button class="btn" data-det="${o.id}">Detalhes</button></div></td></tr>`; }).join("")}
          </tbody></table></div>` : `<div class="empty">${n ? "Nenhuma O.S. nesta situação." : "Nenhuma O.S. atendida neste período."}</div>`}
      </div>
      ${n ? `<details class="card fisres" open><summary><h3 style="display:inline">Resumo por serviço, prioridade e GRE</h3></summary><div class="grid2">
        <div class="card"><h3>Por tipo de serviço</h3><div class="d">Uma O.S. com mais de um serviço conta em cada um.</div>${tab(["Serviço", "O.S.", "Splits", "No prazo", "Fora do prazo"], porServ)}</div>
        <div class="card"><h3>Por prioridade</h3>${tab(["Prioridade", "O.S.", "No prazo", "Fora do prazo", "Atraso médio (dias)"], porPrio)}
          <h3 style="margin-top:14px">Por GRE</h3>${tab(["GRE", "O.S.", "Splits"], porGre)}</div>
      </div></details>` : ""}`;

    const re = () => { ST.sel.clear(); render(); };
    $("fLimpa").onclick = () => { Object.assign(ST, ST0()); render(); };
    $("fEmp").onchange = e => { ST.emp = e.target.value; re(); };
    $("fGre").onchange = e => { ST.gre = e.target.value; re(); };
    $("fMes").onchange = e => { ST.mes = e.target.value; if (ST.mes === "outro") { ST.de = de; ST.ate = ate; } re(); };
    if ($("fDe")) { $("fDe").onchange = e => { ST.de = e.target.value; re(); }; $("fAte").onchange = e => { ST.ate = e.target.value; re(); }; }
    document.querySelectorAll("#v-fisc [data-al]").forEach(b => b.onclick = () => { ST.alerta = ST.alerta === b.dataset.al ? "" : b.dataset.al; render(); });
    document.querySelectorAll("#v-fisc [data-ver]").forEach(b => b.onclick = () => { ST.ver = b.dataset.ver; render(); });
    if ($("fXAl")) $("fXAl").onclick = () => { ST.alerta = ""; render(); };
    const ordem = visiveis.map(x => String(x.o.id));
    document.querySelectorAll("#v-fisc [data-det]").forEach(b => b.onclick = e => { e.stopPropagation(); P.openDet(b.dataset.det, ordem); });
    document.querySelectorAll("#v-fisc [data-pdf]").forEach(b => b.onclick = e => { e.stopPropagation(); verPdf(P.find(b.dataset.pdf)); });
    document.querySelectorAll("#v-fisc [data-conf]").forEach(b => b.onclick = e => { e.stopPropagation(); conferir([P.find(b.dataset.conf)]); });
    document.querySelectorAll("#v-fisc .fck").forEach(c => { c.onclick = e => e.stopPropagation();
      c.onchange = () => { const id = c.closest("tr").dataset.id; c.checked ? ST.sel.add(id) : ST.sel.delete(id); render(); }; });
    document.querySelectorAll("#v-fisc tr.r").forEach(tr => tr.onclick = e => { if (!e.target.closest("button,input,a")) P.openDet(tr.dataset.id, ordem); });
    if ($("fTodas")) $("fTodas").onchange = () => { visiveis.forEach(x => $("fTodas").checked ? ST.sel.add(String(x.o.id)) : ST.sel.delete(String(x.o.id))); render(); };
    if ($("fConfSel")) $("fConfSel").onclick = () => conferir([...ST.sel].map(P.find).filter(Boolean));
    if ($("fXls")) $("fXls").onclick = () => exportar(de, ate, A, { porServ, porPrio, porGre, n, noPrazo, fora: fora.length, atrMed, splits, semPdf, cont });
    if ($("fPrt")) $("fPrt").onclick = () => imprimir(de, ate, A, { porServ, porPrio, n, noPrazo, fora: fora.length, atrMed, splits, semPdf, cont });
    if ($("fZip")) $("fZip").onclick = () => baixarPdfs(de, ate, A.filter(x => x.o.pdf_caminho).map(x => x.o));
  }

  async function verPdf(o) {
    if (!o || !o.pdf_caminho) return;
    const { data, error } = await sb.storage.from("os-assinadas").createSignedUrl(o.pdf_caminho, 300);
    if (error || !data) return UI.alerta({ titulo: "Não foi possível abrir o PDF", itens: error ? error.message : "Tente de novo." });
    window.open(data.signedUrl, "_blank", "noopener");
  }

  function conferir(lista) {
    if (!lista.length) return;
    const um = lista.length === 1, jaConf = lista.some(o => sitConf(o) !== "aconferir");
    const cfg = CTX.config || {}, LG = cfg.motivos_glosa || [], LR = cfg.motivos_ressalva || [];
    const opc = L => L.map(m => ({ valor: m, rotulo: esc(m) })).concat([{ valor: "__outro", rotulo: "<b>Outro</b> (descrever)" }]);
    const mostra = (id, s) => { const el = document.getElementById("dc_" + id); if (el) el.closest(".fl").hidden = !s; };
    const ajustar = v => { mostra("mg", v.sit === "glosada"); mostra("mr", v.sit === "ressalva");
      const lista = v.sit === "glosada" ? v.mg : v.sit === "ressalva" ? v.mr : [];
      mostra("outro", (lista || []).includes("__outro")); };
    UI.dialogo({
      titulo: um ? `Conferência da O.S. ${lista[0].os}` : `Conferência de ${nf(lista.length)} O.S.`, botao: "Registrar conferência",
      texto: (um ? `${esc(tc(lista[0].escola || ""))} · atendida em ${fmt(lista[0].atend)}` : "A mesma situação vale para todas as selecionadas.") +
        "<br>A O.S. não muda; a conferência fica registrada com o seu nome e a data, e a empresa não vê.",
      campos: [
        { id: "sit", rot: "Situação", tipo: "select", obrig: true, valor: "conferida", aoMudar: ajustar,
          opcoes: [{ v: "conferida", t: "Conferida" }, { v: "ressalva", t: "Conferida com ressalva" }, { v: "glosada", t: "Glosada (não aceita para pagamento)" }].concat(jaConf ? [{ v: "pendente", t: "Desfazer a conferência (volta para a conferir)" }] : []) },
        { id: "mg", rot: "Motivos da glosa (um ou mais)", tipo: "checks", obrig: true, oculto: true, opcoes: opc(LG), aoMudar: ajustar },
        { id: "mr", rot: "Motivos da ressalva (um ou mais)", tipo: "checks", obrig: true, oculto: true, opcoes: opc(LR), aoMudar: ajustar },
        { id: "outro", rot: "Descreva o outro motivo", obrig: true, oculto: true, max: 200 },
        { id: "obs", rot: "Observação", tipo: "textarea", linhas: 3, dica: "Opcional (obrigatória para desfazer a conferência). Fica separada dos motivos." }
      ],
      enviar: async v => {
        if (v.sit === "pendente" && (v.obs || "").length < 5) return "Explique por que a conferência foi desfeita (mínimo de 5 caracteres).";
        const marcados = v.sit === "glosada" ? v.mg : v.sit === "ressalva" ? v.mr : [];
        const motivos = (marcados || []).filter(m => m !== "__outro").concat((marcados || []).includes("__outro") ? ["Outro: " + v.outro] : []);
        const { data, error } = await sb.rpc("os_conferir", { p_ids: lista.map(o => o.id), p_situacao: v.sit, p_motivos: motivos, p_obs: v.obs || null });
        if (error) return error.message;
        ST.sel.clear(); await P.recarregar();
        P.aviso(`Conferência registrada em ${plural(data, "O.S.", "O.S.")}.`, "ok");
        return null;
      }
    });
  }

  // ---------- relatórios ----------
  const nomeArq = (de, ate) => "Fiscalizacao_" + (ST.emp ? (EMPN[ST.emp] || ST.emp).replace(/[^\p{L}\p{N}]+/gu, "_") + "_" : "") + de + "_a_" + ate;
  const linhaOS = x => { const o = x.o, c = conf(o), s = SIT[x.sit];
    return [o.os, EMPN[o.emp] || o.emp, o.escola, o.inep || "", o.gre || "", o.mun || "", o.serv.map(t => SERVN[t] || t).join(", "), o.splits ?? "", o.prio || "",
      fmt(o.criada), fmt(o.prazo), fmt(o.atend), DENTRO.includes(o.sp) ? "No prazo" : o.sp, o.sp === "Atendida fora do prazo" ? o.atraso : "",
      o.just || "", o.pend || "", x.reg ? fmt(x.reg) : "Pela planilha", x.lag ?? "", o.pdf_caminho ? (o.pdf || "Sim") : exigePdf(o) ? "Falta" : "Não exigida (emitida antes de " + fmt(pdfDesde()) + ")",
      s[0], c && c.situacao !== "pendente" ? motivosTxt(c) : "", c && c.situacao !== "pendente" ? (c.quem_nome || "") + (c.funcao ? " (" + c.funcao + ")" : "") : "",
      c && c.situacao !== "pendente" ? fmt(diaLocal(c.em)) : "", x.alertas.map(a => a[1]).join("; "), c && c.situacao !== "pendente" ? c.obs || "" : ""]; };
  const CAB = ["Nº O.S.", "Empresa", "Escola / entidade", "INEP", "GRE", "Município", "Serviço", "Splits", "Prioridade", "Emitida em", "Prazo", "Atendida em",
    "Situação do prazo", "Dias de atraso", "Justificativa da empresa", "Pendências relatadas", "Registrado no sistema em", "Dias até o registro", "O.S. assinada",
    "Conferência", "Motivos da conferência", "Conferido por", "Conferido em", "Pontos de atenção", "Observação da conferência"];

  function exportar(de, ate, A, S) {
    const cab = [["Relatório de fiscalização dos atendimentos · GMAP | SEDUC-PI"], [descricao(de, ate)], ["Emitido em " + new Date().toLocaleString("pt-BR") + " por " + (CTX.nome || "")], []];
    const res = cab.concat([["Indicador", "Valor"], ["O.S. atendidas", S.n], ["Splits atendidos", S.splits], ["No prazo", S.noPrazo], ["Fora do prazo", S.fora], ["Atraso médio das fora do prazo (dias)", S.atrMed],
      ["Sem O.S. assinada no sistema", S.semPdf], ["Conferidas", S.cont("conferida")], ["Com ressalva", S.cont("ressalva")], ["Glosadas", S.cont("glosada")], ["A conferir", S.cont("aconferir")], [],
      ["Por tipo de serviço"], ["Serviço", "O.S.", "Splits", "No prazo", "Fora do prazo"]], S.porServ, [[], ["Por prioridade"], ["Prioridade", "O.S.", "No prazo", "Fora do prazo", "Atraso médio (dias)"]], S.porPrio,
      [[], ["Por GRE"], ["GRE", "O.S.", "Splits"]], S.porGre);
    const alertas = A.filter(x => x.alertas.length).flatMap(x => x.alertas.map(a => [x.o.os, EMPN[x.o.emp] || x.o.emp, x.o.escola, fmt(x.o.atend), a[1]]));
    P.xlsx(nomeArq(de, ate) + ".xlsx", [["Resumo", res], ["O.S. atendidas", cab.concat([CAB], A.map(linhaOS))], ["Pontos de atenção", cab.concat([["Nº O.S.", "Empresa", "Escola", "Atendida em", "Ponto de atenção"]], alertas.length ? alertas : [["Nenhum ponto de atenção no período."]])]]);
  }

  function imprimir(de, ate, A, S) {
    const T = (H, R) => `<table><thead><tr>${H.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${R.map(r => `<tr>${r.map(c => `<td>${esc(c ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const eu = CTX.perfilNome || "";
    P.doPrint(`<div class="rp">${P.ph("Relatório de fiscalização")}<h2>Fiscalização dos atendimentos</h2><div class="foot">${esc(descricao(de, ate))}</div>
      ${T(["O.S. atendidas", "Splits", "No prazo", "Fora do prazo", "Atraso médio", "Sem O.S. assinada", "Conferidas", "Com ressalva", "Glosadas", "A conferir"],
        [[S.n, S.splits, S.noPrazo, S.fora, S.atrMed + " dias", S.semPdf, S.cont("conferida"), S.cont("ressalva"), S.cont("glosada"), S.cont("aconferir")]])}
      <h3>Por tipo de serviço</h3>${T(["Serviço", "O.S.", "Splits", "No prazo", "Fora do prazo"], S.porServ)}
      <h3>O.S. atendidas (${nf(A.length)})</h3>${T(["Nº O.S.", "Escola", "Serviço", "Splits", "Prazo", "Atendida", "Situação", "O.S. assinada", "Conferência", "Pontos de atenção"],
        A.map(x => { const r = linhaOS(x); return [r[0], tc(r[2] || ""), r[6], r[7], r[10], r[11], r[12] + (r[13] ? ` (${r[13]} d)` : ""), r[18], r[19] + (r[20] ? ": " + r[20] : "") + (r[24] ? " (obs.: " + r[24] + ")" : ""), r[23]]; }))}
      <div class="sig"><div>${esc(CTX.nome || "")}<br><small>${esc(eu)}</small></div><div>Data</div></div>
      <div class="foot">Documento gerado pelo Painel de O.S. de Climatização em ${new Date().toLocaleString("pt-BR")}. A conferência registrada no sistema fica no histórico de cada O.S.</div></div>`);
  }

  async function baixarPdfs(de, ate, lista) {
    const b = $("fZip"), txt0 = b.textContent; b.disabled = true;
    const arquivos = [], falhas = [];
    for (let i = 0; i < lista.length; i++) {
      const o = lista[i]; b.textContent = `Baixando ${i + 1} de ${lista.length}…`;
      try {
        const { data, error } = await sb.storage.from("os-assinadas").download(o.pdf_caminho);
        if (error || !data) throw error || new Error("vazio");
        const nome = `${String(o.os).replace(/[^\p{L}\p{N}]+/gu, "-")}_${tc(o.escola || "").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.pdf`;
        arquivos.push({ nome, bytes: new Uint8Array(await data.arrayBuffer()) });
      } catch (e) { falhas.push(o.os); }
    }
    b.textContent = txt0; b.disabled = false;
    if (!arquivos.length) return UI.alerta({ titulo: "Nenhum arquivo baixado", itens: "Não foi possível baixar as O.S. assinadas agora. Tente de novo." });
    const a = document.createElement("a"); a.href = URL.createObjectURL(UI.zip(arquivos)); a.download = nomeArq(de, ate) + "_OS_assinadas.zip";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    if (falhas.length) UI.alerta({ titulo: `${plural(falhas.length, "arquivo não baixou", "arquivos não baixaram")}`, itens: "O.S.: " + falhas.join(", ") + ". As demais estão no arquivo .zip." });
  }

  // ---------- Configurações (gerência): motivos de glosa e de ressalva, data da exigência da O.S. assinada ----------
  let CFG = null;
  async function renderConfig() {
    const c = CTX.config || {};
    if (!CFG) CFG = { mg: [...(c.motivos_glosa || [])], mr: [...(c.motivos_ressalva || [])], pdf: pdfDesde() };
    const { data: log } = await sb.from("config_log").select("*").order("id", { ascending: false }).limit(15);
    const lista = (k, tit, d) => `<div class="card"><h3>${tit}</h3><div class="d">${d}</div>
      <div class="cfgl" data-l="${k}">${CFG[k].map((m, i) => `<div class="cfgi"><input type="text" value="${esc(m)}" data-i="${i}" maxlength="120" aria-label="Motivo ${i + 1}">
        <button type="button" class="ib" data-up="${i}" ${i ? "" : "disabled"} aria-label="Subir">${UI.icone("subir")}</button>
        <button type="button" class="ib" data-dn="${i}" ${i < CFG[k].length - 1 ? "" : "disabled"} aria-label="Descer">${UI.icone("descer")}</button>
        <button type="button" class="ib" data-rm="${i}" aria-label="Remover">${UI.icone("recusar")}</button></div>`).join("")}</div>
      <button type="button" class="btn" data-add="${k}">+ Adicionar motivo</button><div class="mun" style="margin-top:6px">"Outro (descrever)" aparece sempre no fim da lista; não precisa cadastrar.</div></div>`;
    const mudou = JSON.stringify([CFG.mg, CFG.mr, CFG.pdf]) !== JSON.stringify([c.motivos_glosa || [], c.motivos_ressalva || [], pdfDesde()]);
    $("v-cfg").innerHTML = `
      <div class="card"><h3>O.S. assinada (PDF ou fotos)</h3>
        <div class="d">A O.S. assinada é obrigatória no registro do atendimento e cobrada na Fiscalização só nas O.S. <b>emitidas a partir desta data</b>. Nas anteriores, a empresa pode anexar, mas não é obrigada.</div>
        <label class="fl" style="max-width:260px">Exigida nas O.S. emitidas a partir de<input type="date" id="cfgPdf" value="${esc(CFG.pdf)}"></label></div>
      <div class="grid2">${lista("mg", "Motivos de glosa", "Opções rápidas ao glosar uma O.S. na Fiscalização (pode marcar mais de um).")}${lista("mr", "Motivos de ressalva", "Opções rápidas ao conferir com ressalva.")}</div>
      <div class="card mbar"><span class="sp">${mudou ? "Há alterações não salvas." : "Tudo salvo."}</span>
        <button type="button" class="btn" id="cfgDesc" ${mudou ? "" : "disabled"}>Descartar alterações</button>
        <button type="button" class="btn pri" id="cfgSal" ${mudou ? "" : "disabled"}>Salvar configurações</button></div>
      <div class="card"><h3>Alterações recentes</h3>${(log || []).length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Quando</th><th>Quem</th><th>O que mudou</th></tr></thead><tbody>${
        log.map(l => `<tr><td>${new Date(l.em).toLocaleString("pt-BR")}</td><td>${esc(l.quem_nome || "")}</td><td class="ev">${esc(l.detalhe)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma alteração registrada.</div>'}</div>`;
    const re = () => renderConfig();
    document.querySelectorAll("#v-cfg .cfgl").forEach(L => { const k = L.dataset.l;
      L.querySelectorAll("input").forEach(inp => inp.oninput = () => { CFG[k][+inp.dataset.i] = inp.value; const st = $("v-cfg").querySelector(".mbar .sp"); if (st) st.textContent = "Há alterações não salvas."; $("cfgSal").disabled = $("cfgDesc").disabled = false; });
      L.querySelectorAll("[data-up]").forEach(b => b.onclick = () => { const i = +b.dataset.up; [CFG[k][i - 1], CFG[k][i]] = [CFG[k][i], CFG[k][i - 1]]; re(); });
      L.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => { const i = +b.dataset.dn; [CFG[k][i + 1], CFG[k][i]] = [CFG[k][i], CFG[k][i + 1]]; re(); });
      L.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { CFG[k].splice(+b.dataset.rm, 1); re(); }); });
    document.querySelectorAll("#v-cfg [data-add]").forEach(b => b.onclick = async () => { CFG[b.dataset.add].push(""); await re(); const ins = document.querySelectorAll(`#v-cfg .cfgl[data-l="${b.dataset.add}"] input`); if (ins.length) ins[ins.length - 1].focus(); });
    $("cfgPdf").onchange = () => { CFG.pdf = $("cfgPdf").value; re(); };
    $("cfgDesc").onclick = () => { CFG = null; re(); };
    $("cfgSal").onclick = async () => {
      const limpa = L => L.map(x => x.trim()).filter(Boolean);
      if (!limpa(CFG.mg).length || !limpa(CFG.mr).length) return UI.alerta({ titulo: "Lista vazia", itens: "Deixe pelo menos um motivo em cada lista." });
      if (CFG.pdf !== pdfDesde() && !(await UI.confirmar({ titulo: "Mudar a data da exigência da O.S. assinada?", botao: "Mudar a data",
        texto: `Passa a valer para as O.S. emitidas a partir de <b>${fmt(CFG.pdf)}</b>. As O.S. emitidas antes dessa data deixam de aparecer como "sem O.S. assinada".` }))) return;
      $("cfgSal").disabled = true;
      const { error } = await sb.rpc("config_salvar", { p_motivos_glosa: limpa(CFG.mg), p_motivos_ressalva: limpa(CFG.mr), p_pdf_desde: CFG.pdf });
      if (error) { $("cfgSal").disabled = false; return UI.alerta({ titulo: "Não foi possível salvar", itens: error.message }); }
      CFG = null; await P.recarregar(); P.aviso("Configurações salvas.", "ok"); renderConfig();
    };
  }
  const podeSairConfig = async () => { const c = CTX.config || {};
    if (!CFG || JSON.stringify([CFG.mg, CFG.mr, CFG.pdf]) === JSON.stringify([c.motivos_glosa || [], c.motivos_ressalva || [], pdfDesde()])) { CFG = null; return true; }
    const ok = await UI.confirmar({ titulo: "Sair sem salvar as configurações?", botao: "Sair sem salvar", perigo: true, texto: "As alterações nos motivos ou na data serão perdidas." });
    if (ok) CFG = null; return ok; };

  return { render, renderConfig, podeSairConfig };
};
