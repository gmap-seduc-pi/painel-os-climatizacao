/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Medição pelos itens do contrato: cadastro (contratos, períodos de vigência, itens, preços e quantitativo),
   itens declarados pela empresa no atendimento, conferência por item, saldo por período e relatório do mês.
   As permissões são conferidas no banco; esta tela só chama as funções autorizadas. */
window.iniciarMedicao = function (P) {
  const { CTX, $, esc, fmt, tc, nf, EMPN } = P;
  const sb = CTX.sb;
  const hoje = CTX.ref;
  const M = () => CTX.med || {};
  const GMAP = P.GMAP, GESTAO = P.GESTAO, EMPRESA = P.EMPRESA;
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const AVISO_VIG = [120, 90, 60];                   // dias antes do fim da vigência
  const brl = v => v == null || isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  const plural = (n, s, p) => nf(n) + " " + (n === 1 ? s : p);
  const medDesde = () => (CTX.config && CTX.config.medicao_desde) || "2027-01-01";
  const diaLocal = ts => ts ? new Date(ts).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null;
  async function rpc(nome, args) { const { data, error } = await sb.rpc(nome, args); return error ? { erro: error.message } : { data }; }

  // ---------- consultas aos dados carregados ----------
  const contratosDa = emp => (M().contratos || []).filter(c => c.empresa === emp);
  const periodos = ct => (M().periodos || []).filter(p => String(p.contrato_id) === String(ct)).sort((a, b) => b.inicio.localeCompare(a.inicio));
  const periodoNa = (ct, data) => periodos(ct).find(p => data && data >= p.inicio && data <= p.fim) || null;
  const contratoNa = (emp, data) => contratosDa(emp).find(c => c.ativo && periodoNa(c.id, data)) || null;
  const itensDo = (ct, todos) => (M().itens || []).filter(i => String(i.contrato_id) === String(ct) && (todos || i.ativo))
    .sort((a, b) => (a.grupo === b.grupo ? 0 : a.grupo === "Serviço" ? -1 : 1) || a.item - b.item);
  const item = id => (M().itens || []).find(i => String(i.id) === String(id));
  const precos = id => (M().precos || []).filter(p => String(p.item_id) === String(id)).sort((a, b) => b.desde.localeCompare(a.desde));
  const preco = (id, data) => { const p = precos(id).find(x => x.desde <= data); return p ? +p.valor : null; };
  const qtd = (id, per) => (M().qtd || []).find(q => String(q.item_id) === String(id) && String(q.periodo_id) === String(per));
  const prefixo = emp => (emp || "").normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  const codigo = (it, emp) => `${prefixo(emp || (contrato(it.contrato_id) || {}).empresa)}-${it.grupo === "Serviço" ? "S" : "P"}${String(it.item).padStart(2, "0")}`;
  const contrato = id => (M().contratos || []).find(c => String(c.id) === String(id));
  const nomeItem = it => `${it.tipo} · ${it.faixa} BTU`;
  const exige = (emp, data) => !!data && data >= medDesde() && !!contratoNa(emp, data);
  const temContrato = emp => contratosDa(emp).some(c => c.ativo);
  // serviços do contrato da empresa na data (para a grade da emissão): tipo, faixa e preço; vazio se não houver contrato
  const servicosContrato = (emp, data) => { const ct = contratoNa(emp, data) || contratosDa(emp).find(c => c.ativo); if (!ct) return [];
    return itensDo(ct.id).filter(i => i.grupo === "Serviço").map(i => ({ tipo: i.tipo, faixa: i.faixa, item_id: i.id, preco: preco(i.id, data) })); };
  // itens declarados numa O.S., com a conferência (só a gestão recebe a conferência)
  function itensOS(o) {
    const confs = M().itensConf || [];
    return (M().osItens || []).filter(x => String(x.os_id) === String(o.id)).map(x => {
      const it = item(x.item_id) || { tipo: "Item", faixa: "?", grupo: "Serviço", item: 0 }, c = confs.find(k => String(k.os_item_id) === String(x.id));
      const pu = preco(x.item_id, o.atend);
      return { x, it, c, pu, decl: pu != null ? pu * x.quantidade : null, aceito: c && pu != null ? pu * c.aceita : null };
    }).sort((a, b) => (a.it.grupo === b.it.grupo ? 0 : a.it.grupo === "Serviço" ? -1 : 1) || a.it.item - b.it.item);
  }
  function valorOS(o) {
    const L = itensOS(o); if (!L.length) return { n: 0, decl: 0, aceito: null, conferido: false };
    const conferido = L.every(r => r.c);
    return { n: L.length, decl: L.reduce((s, r) => s + (r.decl || 0), 0), aceito: conferido ? L.reduce((s, r) => s + (r.aceito || 0), 0) : null, conferido };
  }
  const resumoItens = o => itensOS(o).map(r => `${r.x.quantidade} x ${r.it.tipo.toLowerCase()} ${r.it.faixa}` + (r.c && r.c.aceita < r.x.quantidade ? ` (aceito ${r.c.aceita})` : "")).join("; ");

  // ---------- campo de itens (atendimento e alteração) ----------
  function campoItens(o, data, atuais, obrig) {
    const ct = contratoNa(o.emp, data);
    if (!ct) return null;
    const L = itensDo(ct.id);
    const opc = sel => ["Serviço", "Peça"].map(g => `<optgroup label="${g === "Serviço" ? "Serviços" : "Peças"}">${L.filter(i => i.grupo === g).map(i => {
      const pu = preco(i.id, data); return `<option value="${i.id}" ${String(sel) === String(i.id) ? "selected" : ""}>${esc(nomeItem(i))}${pu != null ? " · " + brl(pu) : ""}</option>`; }).join("")}</optgroup>`).join("");
    const linha = (sel, q) => `<div class="itr"><select class="its" aria-label="Item do contrato"><option value="">Escolha o item</option>${opc(sel)}</select>
      <input type="number" class="itq" min="1" max="999" step="1" inputmode="numeric" placeholder="Qtd." aria-label="Quantidade" value="${q || ""}">
      <span class="itv"></span><button type="button" class="ib itx" aria-label="Remover item">${UI.icone("cancelar")}</button></div>`;
    const ini = (atuais && atuais.length ? atuais : [{}]).map(a => linha(a.item_id, a.quantidade)).join("");
    return {
      id: "itens", tipo: "custom", obrig, rot: "Itens do contrato executados",
      dica: `Contrato ${ct.numero}. Informe cada serviço e cada peça trocada, com a faixa de potência (BTU) do equipamento e a quantidade.` + (obrig ? "" : " Opcional para este atendimento."),
      html: `<div class="itw"><div class="itl">${ini}</div><button type="button" class="btn itadd">+ Adicionar item</button><div class="itt"></div></div>`,
      ligar(el) {
        const tot = () => { let s = 0; el.querySelectorAll(".itr").forEach(r => { const id = r.querySelector(".its").value, q = +r.querySelector(".itq").value, pu = id ? preco(id, data) : null;
          const v = pu != null && q > 0 ? pu * q : null; r.querySelector(".itv").textContent = v != null ? brl(v) : ""; s += v || 0; });
          el.querySelector(".itt").innerHTML = s ? `Total declarado: <b>${brl(s)}</b>` : ""; };
        const ligarLinha = r => { r.querySelector(".its").onchange = tot; r.querySelector(".itq").oninput = tot;
          r.querySelector(".itx").onclick = () => { if (el.querySelectorAll(".itr").length > 1) r.remove(); else { r.querySelector(".its").value = ""; r.querySelector(".itq").value = ""; } tot(); }; };
        el.querySelectorAll(".itr").forEach(ligarLinha);
        el.querySelector(".itadd").onclick = () => { el.querySelector(".itl").insertAdjacentHTML("beforeend", linha()); const r = el.querySelector(".itl").lastElementChild; ligarLinha(r); r.querySelector(".its").focus(); };
        tot();
      },
      ler(el) { return [...el.querySelectorAll(".itr")].map(r => ({ item_id: r.querySelector(".its").value, q: r.querySelector(".itq").value.trim() })).filter(r => r.item_id || r.q)
        .map(r => ({ item_id: r.item_id ? +r.item_id : null, quantidade: r.q === "" ? null : Number(r.q) })); }
    };
  }
  // confere a lista antes de enviar; devolve a mensagem de erro ou null
  function validarItens(lista) {
    if (lista.some(r => !r.item_id)) return "Escolha o item em todas as linhas (ou remova a linha vazia).";
    if (lista.some(r => !Number.isInteger(r.quantidade) || r.quantidade < 1 || r.quantidade > 999)) return "A quantidade de cada item deve ser um número inteiro entre 1 e 999.";
    const ids = lista.map(r => r.item_id); if (new Set(ids).size !== ids.length) return "O mesmo item aparece mais de uma vez: some as quantidades numa linha só.";
    return null;
  }

  // ---------- detalhe da O.S. ----------
  function podeInformar(o) {
    if (o.status !== "Atendida" || !contratoNa(o.emp, o.atend)) return false;
    if (itensOS(o).some(r => r.c || r.x.conferido)) return false;
    return GMAP || (EMPRESA && EMPRESA === o.emp);
  }
  function blocoDetalhe(o) {
    if (o.status !== "Atendida") return "";
    if (!temContrato(o.emp)) {
      if (!GESTAO) return "";
      return `<div class="dsec"><h3>Pagamento (empresa sem contrato)</h3>
        <div class="dl"><div>Processo (PACTUE extra)</div><div>${esc(o.avulso_processo || "não informado")}</div><div>Nota de empenho</div><div>${esc(o.avulso_empenho || "não informada")}</div>
        <div>Valor</div><div>${o.avulso_valor != null ? brl(o.avulso_valor) : "não informado"}</div></div>
        ${GMAP ? `<div class="dacoes">${UI.botaoIcone("editar", "Registrar processo e empenho").replace('data-acao="editar"', 'id="mAvulso"')}</div>` : ""}</div>`;
    }
    const L = itensOS(o), v = valorOS(o), ex = exige(o.emp, o.atend);
    if (!L.length && !contratoNa(o.emp, o.atend)) return "";
    return `<div class="dsec"><h3>Itens do contrato</h3>
      ${L.length ? `<div class="tbl" style="max-height:none"><table class="nocard itd"><thead><tr><th>Item</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Total</th>${GESTAO ? '<th class="n">Aceito</th>' : ""}</tr></thead><tbody>${
        L.map(r => `<tr><td>${esc(nomeItem(r.it))}<div class="mun">${esc(r.it.grupo)} · item ${r.it.item}</div>${r.c && r.c.motivo ? `<div class="fmot"><span>${esc(r.c.motivo)}</span></div>` : ""}</td>
          <td class="n">${nf(r.x.quantidade)}</td><td class="n">${brl(r.pu)}</td><td class="n">${brl(r.decl)}</td>${GESTAO ? `<td class="n">${r.c ? `<span class="${r.c.aceita < r.x.quantidade ? "txbad" : ""}">${nf(r.c.aceita)}</span>` : '<span class="mun">a conferir</span>'}</td>` : ""}</tr>`).join("")}
        </tbody><tfoot><tr><td colspan="3"><b>Total declarado</b></td><td class="n"><b>${brl(v.decl)}</b></td>${GESTAO ? `<td class="n">${v.aceito != null ? "<b>" + brl(v.aceito) + "</b>" : ""}</td>` : ""}</tr></tfoot></table></div>
        ${!GESTAO && L.some(r => r.x.conferido) ? '<div class="faixa info">Itens já conferidos pela fiscalização. Para corrigir, fale com a GMAP.</div>' : ""}
        <div class="mun">Preços vigentes em ${fmt(o.atend)}. Declarado por ${esc(L[0].x.declarado_nome || "")}${L[0].x.declarado_em ? " em " + fmt(diaLocal(L[0].x.declarado_em)) : ""}.</div>`
        : `<div class="faixa ${ex ? "warn" : "info"}">${ex ? `<b>Itens não informados.</b> Exigidos nos atendimentos a partir de ${fmt(medDesde())}.` : "Nenhum item informado (não exigido para este atendimento)."}</div>`}
      ${podeInformar(o) ? `<div class="dacoes">${UI.botaoIcone("editar", L.length ? "Alterar itens" : "Informar itens").replace('data-acao="editar"', 'id="mItens"')}</div>` : ""}</div>`;
  }
  function ligarDetalhe(o) {
    if ($("mItens")) $("mItens").onclick = () => editarItens(o);
    if ($("mAvulso")) $("mAvulso").onclick = () => editarAvulso(o);
  }
  function editarItens(o) {
    const L = itensOS(o), tinha = L.length > 0;
    const campo = campoItens(o, o.atend, L.map(r => ({ item_id: r.x.item_id, quantidade: r.x.quantidade })), true);
    UI.dialogo({ titulo: `${tinha ? "Alterar" : "Informar"} os itens da O.S. ${o.os}`, botao: "Salvar itens",
      texto: `Atendida em ${fmt(o.atend)}.` + (GMAP && EMPRESA !== o.emp ? " Você está informando pela empresa; o histórico registra que foi a GMAP." : "") + (tinha ? " A alteração fica no histórico com o motivo." : ""),
      campos: [campo].concat(tinha ? [{ id: "motivo", rot: "Motivo da alteração", tipo: "textarea", obrig: true, min: 10 }] : []),
      enviar: async v => {
        const e = validarItens(v.itens); if (e) return e;
        const r = await rpc("os_itens_salvar", { p_id: o.id, p_itens: v.itens, p_motivo: v.motivo || null });
        if (r.erro) return r.erro;
        await P.recarregar(); P.aviso("Itens salvos.", "ok"); P.openDet(o.id); return null;
      } });
  }
  function editarAvulso(o) {
    UI.dialogo({ titulo: `Pagamento por empenho · O.S. ${o.os}`, botao: "Salvar",
      texto: `${esc(EMPN[o.emp] || o.emp)} não tem contrato: o pagamento sai de nota de empenho em cada processo. O registro fica no histórico interno.`,
      campos: [{ id: "proc", rot: "Processo SEI (PACTUE extra)", valor: o.avulso_processo || "", max: 40 }, { id: "emp", rot: "Nota de empenho", valor: o.avulso_empenho || "", max: 40 },
        { id: "val", rot: "Valor (R$)", valor: o.avulso_valor != null ? String(o.avulso_valor).replace(".", ",") : "", dica: "Ex.: 1.450,50" }],
      enviar: async v => {
        const val = v.val ? Number(v.val.replace(/\./g, "").replace(",", ".")) : null;
        if (v.val && !(val > 0)) return "Informe o valor em reais, maior que zero (ex.: 1.450,50).";
        const r = await rpc("os_pagamento_avulso", { p_id: o.id, p_processo: v.proc || null, p_empenho: v.emp || null, p_valor: val });
        if (r.erro) return r.erro;
        await P.recarregar(); P.aviso("Pagamento registrado.", "ok"); P.openDet(o.id); return null;
      } });
  }

  // ---------- saldo por item num período ----------
  function saldos(ct, per) {
    const c = contrato(ct), p = (M().periodos || []).find(x => String(x.id) === String(per));
    if (!c || !p) return [];
    const OSs = P.todos().filter(o => o.emp === c.empresa && o.status === "Atendida" && o.atend && o.atend >= p.inicio && o.atend <= p.fim);
    const uso = {};
    OSs.forEach(o => itensOS(o).forEach(r => { const u = uso[r.x.item_id] = uso[r.x.item_id] || { ac: 0, pend: 0, vac: 0, vpend: 0 };
      if (r.c) { u.ac += r.c.aceita; u.vac += r.aceito || 0; } else { u.pend += r.x.quantidade; u.vpend += r.decl || 0; } }));
    return itensDo(ct, true).map(it => {
      const q = qtd(it.id, per) || { quantidade: 0, consumo_anterior: 0, consumo_informado: false }, u = uso[it.id] || { ac: 0, pend: 0, vac: 0, vpend: 0 };
      const usado = (+q.consumo_anterior || 0) + u.ac + u.pend, cont = +q.quantidade || 0;
      return { it, q, cont, ant: +q.consumo_anterior || 0, inf: !!q.consumo_informado, ac: u.ac, pend: u.pend, vac: u.vac, vpend: u.vpend,
        usado, saldo: cont - usado, pct: cont ? usado / cont : (usado ? 9 : 0), pu: preco(it.id, p.fim < hoje ? p.fim : hoje) };
    });
  }
  // avisos para o contador: vigência perto do fim e itens esgotados no período atual
  // avisos da medição: cada um diz o que é, o que fazer e tem um atalho; "Ciente" tira do contador até a próxima etapa
  const CHAVE_CIENTE = "med_ciente_" + (CTX.uid || "x");
  const cientes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_CIENTE) || "[]"); } catch (e) { return []; } };
  const marcarCiente = k => { try { const L = cientes().filter(x => x !== k).concat(k).slice(-200); localStorage.setItem(CHAVE_CIENTE, JSON.stringify(L)); } catch (e) { /* sem armazenamento: o aviso continua no contador */ } };
  function alertas() {
    const out = [], ok = cientes();
    (M().contratos || []).filter(c => c.ativo && P.veEmpresa(c.empresa)).forEach(c => {
      const ps = periodos(c.id), atual = periodoNa(c.id, hoje), ult = ps[0], nome = EMPN[c.empresa] || c.empresa;
      if (ult && ult.fim >= hoje) {
        const d = dias(ult.fim, hoje);
        if (d <= AVISO_VIG[0]) {
          const etapa = AVISO_VIG.filter(x => d <= x).pop();
          out.push({ c, tipo: "vig", d, grave: d <= AVISO_VIG[2], k: `vig|${c.id}|${ult.fim}|${etapa}`,
            titulo: `Vigência do contrato ${c.numero} (${nome}) termina em ${plural(d, "dia", "dias")}, em ${fmt(ult.fim)}`,
            fazer: `Providencie a prorrogação (ou a nova contratação) a tempo: o processo passa por pareceres antes do termo aditivo. Quando o aditivo for assinado, cadastre o novo período em "Contrato ${c.numero}, períodos e histórico", botão "+ Novo período (prorrogação)". O aviso some sozinho quando o novo período estiver cadastrado; volta a aparecer em ${AVISO_VIG.filter(x => x < etapa).map(x => x + " dias").join(" e ") || "nenhuma outra etapa"} antes do fim.`,
            acao: "Abrir o contrato" });
        }
      } else if (!atual) out.push({ c, tipo: "semvig", grave: true, k: `semvig|${c.id}|${ult ? ult.fim : ""}`,
        titulo: `Contrato ${c.numero} (${nome}) sem período de vigência em ${fmt(hoje)}`,
        fazer: `Se o contrato foi prorrogado, cadastre o novo período ("+ Novo período (prorrogação)"). Se terminou, desative o contrato em "Editar contrato". Enquanto isso, a empresa não consegue declarar itens.`, acao: "Abrir o contrato" });
      if (atual) {
        const S = saldos(c.id, atual.id).filter(s => s.cont && s.saldo <= 0);
        if (S.length) out.push({ c, tipo: "esg", n: S.length, grave: true, k: `esg|${c.id}|${atual.id}|${S.map(x => x.it.id).join(",")}`,
          titulo: `${plural(S.length, "item esgotado", "itens esgotados")} no contrato ${c.numero} (${nome}): ${S.slice(0, 3).map(x => codigo(x.it, c.empresa)).join(", ")}${S.length > 3 ? "…" : ""}`,
          fazer: "O registro continua (a empresa segue declarando), mas o que passar do contratado não tem cobertura no contrato: avalie com a fiscalização se cabe aditivo (o acréscimo tem limite legal de 25% do valor inicial), nova contratação ou pagamento indenizatório. Confira também se o consumo anterior informado está correto.",
          acao: "Ver os itens esgotados" });
      }
    });
    out.forEach(a => a.ciente = ok.includes(a.k));
    return out;
  }
  const contarAlertas = () => GESTAO ? alertas().filter(a => !a.ciente).length : 0;
  const resumoAlertas = () => alertas().filter(a => !a.ciente).map(a => a.titulo).join("\n");

  // ---------- aba Medição ----------
  const ST = { emp: "", per: "", mes: "", ver: "todos" };
  function render() {
    const comContrato = [...new Set((M().contratos || []).map(c => c.empresa))].filter(e => P.veEmpresa(e)).sort();
    const semContrato = [...new Set(P.todos().map(o => o.emp))].filter(e => e && !comContrato.includes(e) && P.veEmpresa(e) && !temContrato(e)).sort();
    if (!ST.emp || ![...comContrato, ...semContrato].includes(ST.emp)) ST.emp = comContrato[0] || semContrato[0] || "";
    const opEmp = comContrato.map(e => `<option value="${esc(e)}" ${ST.emp === e ? "selected" : ""}>${esc(EMPN[e] || e)}</option>`).join("")
      + (semContrato.length ? `<optgroup label="Sem contrato (pagas por empenho)">${semContrato.map(e => `<option value="${esc(e)}" ${ST.emp === e ? "selected" : ""}>${esc(EMPN[e] || e)}</option>`).join("")}</optgroup>` : "");
    const AL = alertas();
    const topo = `<div class="card"><h3>Medição dos contratos</h3>
      <div class="d">Saldo de cada item no período de vigência (contratado, consumo anterior à implantação, aceito pelo fiscal e declarado a conferir) e o valor medido no mês, pela data do atendimento. Os itens são exigidos nos atendimentos a partir de <b>${fmt(medDesde())}</b>${GMAP ? " (altere em Configurações)" : ""}.</div>
      ${AL.length ? `<div class="mavisos"><div class="mavt">${plural(AL.filter(a => !a.ciente).length, "aviso", "avisos")}${AL.some(a => a.ciente) ? ` <span class="mun">(${plural(AL.filter(a => a.ciente).length, "marcado", "marcados")} como ciente)</span>` : ""}</div>${AL.map((a, i) => `<div class="mav ${a.grave ? "bad" : "warn"}${a.ciente ? " ciente" : ""}">
        <div class="mavh"><b>${esc(a.titulo)}</b>${a.ciente ? ' <span class="badge b-gray">ciente</span>' : ""}</div>
        <div class="mavf"><b>O que fazer:</b> ${esc(a.fazer)}</div>
        <div class="acoes"><button class="btn" data-mav="${i}">${esc(a.acao)}</button>${a.ciente ? "" : `<button class="btn" data-mok="${i}" title="Tira do contador; o aviso continua aqui enquanto a situação existir">Ciente</button>`}</div></div>`).join("")}</div>` : ""}
      <div class="fisf"><label>Empresa<select id="mEmp">${opEmp}</select></label><span id="mFilt"></span></div></div>`;
    if (!ST.emp) { $("v-med").innerHTML = topo + `<div class="card"><div class="empty">Nenhum contrato cadastrado para as empresas que você acompanha.</div></div>`; ligarTopo(); return; }
    if (!temContrato(ST.emp) && !contratosDa(ST.emp).length) return renderSemContrato(topo);
    const c = contratosDa(ST.emp)[0], ps = periodos(c.id);
    if (!ST.per || !ps.some(p => String(p.id) === String(ST.per))) ST.per = String((periodoNa(c.id, hoje) || ps[0] || {}).id || "");
    const p = ps.find(x => String(x.id) === ST.per);
    const pode = GMAP || (P.CONSULTIVO && P.veEmpresa(c.empresa));
    if (!p) { $("v-med").innerHTML = topo + blocoContrato(c, ps, pode) + `<div class="card"><div class="empty">Cadastre o período de vigência do contrato para acompanhar o saldo.</div></div>`; ligarTopo(); ligarContrato(c, pode); return; }
    const S = saldos(c.id, p.id);
    const meses = []; for (let d = p.inicio.slice(0, 7); d <= (p.fim < hoje ? p.fim : hoje).slice(0, 7); ) { meses.push(d); const [a, m] = d.split("-").map(Number); d = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7); }
    // mês inicial: o mais recente com atendimento da empresa no período
    if (!ST.mes || (ST.mes !== "todo" && !meses.includes(ST.mes))) { const com = meses.filter(m => P.todos().some(o => o.emp === c.empresa && o.status === "Atendida" && (o.atend || "").startsWith(m)));
      ST.mes = com[com.length - 1] || meses[meses.length - 1] || "todo"; }
    const valCont = S.reduce((s, x) => s + x.cont * (x.pu || 0), 0), valUsado = S.reduce((s, x) => s + x.ant * (x.pu || 0) + x.vac + x.vpend, 0);
    const semInf = S.filter(x => x.cont && !x.inf).length, esg = S.filter(x => x.cont && x.saldo <= 0).length, a80 = S.filter(x => x.cont && x.saldo > 0 && x.pct >= .8).length;
    const vis = S.filter(x => ST.ver === "todos" || (ST.ver === "serv" && x.it.grupo === "Serviço") || (ST.ver === "pec" && x.it.grupo === "Peça") || (ST.ver === "80" && x.cont && x.pct >= .8) || (ST.ver === "esg" && x.cont && x.saldo <= 0) || (ST.ver === "inativos" && !x.it.ativo));
    // O.S. do mês
    const de = ST.mes === "todo" ? p.inicio : ST.mes + "-01", ate = ST.mes === "todo" ? p.fim : new Date(Date.UTC(+ST.mes.slice(0, 4), +ST.mes.slice(5, 7), 0)).toISOString().slice(0, 10);
    const OSm = P.todos().filter(o => o.emp === c.empresa && o.status === "Atendida" && o.atend && o.atend >= de && o.atend <= ate && o.atend >= p.inicio && o.atend <= p.fim)
      .sort((a, b) => a.atend.localeCompare(b.atend) || String(a.os).localeCompare(String(b.os), "pt-BR", { numeric: true }));
    const linhasM = OSm.map(o => ({ o, v: valorOS(o), ex: exige(o.emp, o.atend), c: (CTX.conferencias || {})[o.id] }));
    const totDecl = linhasM.reduce((s, r) => s + r.v.decl, 0), totAc = linhasM.reduce((s, r) => s + (r.v.aceito || 0), 0), aConf = linhasM.filter(r => r.v.n && !r.v.conferido);
    const semItens = linhasM.filter(r => r.ex && !r.v.n);
    const rotMes = m => m === "todo" ? "Período inteiro" : MESES[+m.slice(5, 7) - 1] + "/" + m.slice(0, 4) + (m === hoje.slice(0, 7) ? " (parcial)" : "");
    const barra = x => { const w = Math.min(100, Math.round(x.pct * 100)); return `<div class="mbarra ${x.saldo <= 0 && x.cont ? "bad" : x.pct >= .8 ? "warn" : ""}" title="${Math.round(x.pct * 100)}% usado"><i style="width:${w}%"></i></div><div class="mun">${x.cont ? Math.round(x.pct * 100) + "%" : "sem quantitativo"}</div>`; };
    $("v-med").innerHTML = topo.replace('<span id="mFilt"></span>', `<label>Período de vigência<select id="mPer">${ps.map(x => `<option value="${x.id}" ${String(x.id) === ST.per ? "selected" : ""}>${fmt(x.inicio)} a ${fmt(x.fim)} · ${esc(x.instrumento)}</option>`).join("")}</select></label>
        <label>Mês da medição<select id="mMes">${meses.slice().reverse().map(m => `<option value="${m}" ${ST.mes === m ? "selected" : ""}>${rotMes(m)}</option>`).join("")}<option value="todo" ${ST.mes === "todo" ? "selected" : ""}>Período inteiro</option></select></label>`)
      + `<div class="kpis fisk">
        <div class="kpi"><div class="v mval">${brl(valCont)}</div><div class="l">Contratado no período</div><div class="h">${plural(S.filter(x => x.cont).length, "item", "itens")} · contrato ${esc(c.numero)}</div></div>
        <div class="kpi ${valCont && valUsado / valCont >= .8 ? "warn" : ""}"><div class="v mval">${brl(valUsado)}</div><div class="l">Consumido no período</div><div class="h">${valCont ? Math.round(valUsado / valCont * 100) : 0}% do contratado (com o a conferir)</div></div>
        <div class="kpi ${esg ? "bad" : a80 ? "warn" : ""}"><div class="v">${nf(esg)}<small> / ${nf(a80)}</small></div><div class="l">Itens esgotados / acima de 80%</div><div class="h">o sistema só avisa; o registro continua</div></div>
        <div class="kpi ok"><div class="v mval">${brl(totAc)}</div><div class="l">Aceito em ${ST.mes === "todo" ? "todo o período" : rotMes(ST.mes).replace(" (parcial)", "")}</div><div class="h">${aConf.length ? brl(totDecl - linhasM.filter(r => r.v.conferido).reduce((s, r) => s + r.v.decl, 0)) + " a conferir em " + plural(aConf.length, "O.S.", "O.S.") : "tudo conferido"}</div></div>
      </div>
      ${semInf ? `<div class="faixa warn"><b>Consumo anterior à implantação não informado em ${plural(semInf, "item", "itens")}.</b> Até ser preenchido (pela GMAP, com o documento SEI dos pagamentos já feitos no período), o saldo aparece maior do que é.</div>` : ""}
      <div class="card"><div class="fish"><h3>Saldo por item (${nf(vis.length)})</h3><div class="acoes"><button class="btn" id="mXlsS">Exportar Excel</button>${pode ? '<button class="btn" id="mNovoItem">+ Novo item</button>' : ""}</div></div>
        <div class="d">Usado = consumo anterior + aceito pelo fiscal + declarado ainda a conferir. O que passar do contratado continua registrado, para eventual pagamento indenizatório.</div>
        <div class="fchips">${[["todos", "Todos"], ["serv", "Serviços"], ["pec", "Peças"], ["80", "A partir de 80%"]].concat(S.some(x => x.cont && x.saldo <= 0) ? [["esg", "Esgotados"]] : []).concat(S.some(x => !x.it.ativo) ? [["inativos", "Desativados"]] : []).map(([k, t]) => `<button type="button" class="fchip ${ST.ver === k ? "on" : ""}" data-mver="${k}">${t}</button>`).join("")}</div>
        <div class="tbl" style="max-height:none"><table class="mst"><thead><tr><th>Item</th><th class="n">Valor unit.</th><th class="n">Contratado</th><th class="n">Anterior</th><th class="n">Aceito</th><th class="n">A conferir</th><th class="n">Saldo</th><th>Uso</th>${pode ? "<th></th>" : ""}</tr></thead><tbody>${
          vis.map(x => `<tr${x.it.ativo ? "" : ' class="inat"'}><td><b>${esc(codigo(x.it, c.empresa))}</b> ${esc(nomeItem(x.it))}${x.it.ativo ? "" : ' <span class="badge b-gray">desativado</span>'}</td>
            <td class="n">${brl(x.pu)}</td><td class="n">${nf(x.cont)}</td>
            <td class="n">${x.inf ? nf(x.ant) : '<span class="mun" title="Consumo anterior não informado">n/i</span>'}</td><td class="n">${nf(x.ac)}</td><td class="n">${nf(x.pend)}</td>
            <td class="n ${x.saldo < 0 ? "txbad" : ""}"><b>${nf(x.saldo)}</b>${x.saldo < 0 ? '<div class="mun txbad">acima do contratado</div>' : ""}</td><td>${barra(x)}</td>
            ${pode ? `<td><div class="acoes macoes"><button class="btn" data-mq="${x.it.id}" title="Quantidade contratada e consumo anterior">Qtd.</button><button class="btn" data-mp="${x.it.id}" title="Preço e versões">Preço</button><button class="btn" data-mi="${x.it.id}" title="Dados do item">Item</button></div></td>` : ""}</tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><div class="fish"><h3>Medição de ${esc(rotMes(ST.mes))} (${plural(linhasM.length, "O.S.", "O.S.")})</h3><div class="acoes"><button class="btn" id="mXlsM" ${linhasM.length ? "" : "disabled"}>Exportar Excel</button><button class="btn" id="mPrt" ${linhasM.length ? "" : "disabled"}>Imprimir</button></div></div>
        <div class="d">O.S. atendidas no mês, com os itens declarados pela empresa e o valor aceito na conferência. A conferência e as glosas são feitas na aba Fiscalização.</div>
        ${semItens.length ? `<div class="faixa warn"><b>${plural(semItens.length, "O.S. atendida sem itens", "O.S. atendidas sem itens")}</b> (exigidos desde ${fmt(medDesde())}): ${semItens.slice(0, 12).map(r => esc(r.o.os)).join(", ")}${semItens.length > 12 ? "…" : ""}</div>` : ""}
        ${linhasM.length ? `<div class="tbl" style="max-height:none"><table class="mmt"><thead><tr><th>Nº O.S.</th><th>Escola</th><th>Atendida em</th><th>Itens</th><th class="n">Declarado</th><th class="n">Aceito</th><th>Conferência</th></tr></thead><tbody>${
          linhasM.map(r => `<tr class="r" data-id="${r.o.id}"><td><b>${esc(r.o.os)}</b></td><td><div class="esc">${esc(tc(r.o.escola || ""))}</div><div class="mun">${esc(tc(r.o.mun || ""))}</div></td><td>${fmt(r.o.atend)}</td>
            <td class="ev">${r.v.n ? esc(resumoItens(r.o)) : r.ex ? '<span class="badge b-warn">Itens não informados</span>' : '<span class="mun">não exigidos</span>'}</td>
            <td class="n">${r.v.n ? brl(r.v.decl) : ""}</td><td class="n">${r.v.aceito != null ? brl(r.v.aceito) : r.v.n ? '<span class="mun">a conferir</span>' : ""}</td>
            <td>${r.c && r.c.situacao !== "pendente" ? `<span class="badge ${{ conferida: "b-ok", ressalva: "b-warn", glosada: "b-bad" }[r.c.situacao]}">${{ conferida: "Conferida", ressalva: "Com ressalva", glosada: "Glosada" }[r.c.situacao]}</span>` : '<span class="badge b-gray">A conferir</span>'}</td></tr>`).join("")}
        </tbody><tfoot><tr><td colspan="4"><b>Total</b></td><td class="n"><b>${brl(totDecl)}</b></td><td class="n"><b>${brl(totAc)}</b></td><td></td></tr></tfoot></table></div>` : '<div class="empty">Nenhuma O.S. atendida neste mês.</div>'}
      </div>
      ${blocoContrato(c, ps, pode)}`;
    ligarTopo(); ligarContrato(c, pode);
    $("mPer").onchange = e => { ST.per = e.target.value; ST.mes = ""; render(); };
    $("mMes").onchange = e => { ST.mes = e.target.value; render(); };
    document.querySelectorAll("#v-med [data-mver]").forEach(b => b.onclick = () => { ST.ver = b.dataset.mver; render(); });
    document.querySelectorAll("#v-med [data-mq]").forEach(b => b.onclick = () => editarQuantidade(c, p, item(b.dataset.mq)));
    document.querySelectorAll("#v-med [data-mp]").forEach(b => b.onclick = () => editarPreco(c, item(b.dataset.mp)));
    document.querySelectorAll("#v-med [data-mi]").forEach(b => b.onclick = () => editarItem(c, item(b.dataset.mi)));
    if ($("mNovoItem")) $("mNovoItem").onclick = () => editarItem(c, null);
    const ordem = linhasM.map(r => String(r.o.id));
    document.querySelectorAll("#v-med .mmt tr.r").forEach(tr => tr.onclick = () => P.openDet(tr.dataset.id, ordem));
    $("mXlsS").onclick = () => exportarSaldo(c, p, S);
    if ($("mXlsM")) $("mXlsM").onclick = () => exportarMes(c, p, rotMes(ST.mes), linhasM);
    if ($("mPrt")) $("mPrt").onclick = () => imprimirMes(c, p, rotMes(ST.mes), linhasM, totDecl, totAc);
  }
  function ligarTopo() {
    if ($("mEmp")) $("mEmp").onchange = e => { ST.emp = e.target.value; ST.per = ""; ST.mes = ""; ST.ver = "todos"; render(); };
    const AL = alertas();
    document.querySelectorAll("#v-med [data-mok]").forEach(b => b.onclick = () => { marcarCiente(AL[+b.dataset.mok].k); P.contarMed(); render(); });
    document.querySelectorAll("#v-med [data-mav]").forEach(b => b.onclick = () => { const a = AL[+b.dataset.mav];
      ST.emp = a.c.empresa; ST.per = ""; ST.mes = ""; ST.ver = a.tipo === "esg" ? "esg" : "todos"; render();
      const alvo = a.tipo === "esg" ? document.querySelector("#v-med table.mst") : document.querySelector("#v-med details.fisres");
      if (alvo) { if (alvo.tagName === "DETAILS") alvo.open = true; alvo.scrollIntoView({ behavior: "smooth", block: "start" }); } });
  }

  function renderSemContrato(topo) {
    const L = P.todos().filter(o => o.emp === ST.emp && o.status === "Atendida").sort((a, b) => (b.atend || "").localeCompare(a.atend || ""));
    const tot = L.reduce((s, o) => s + (+o.avulso_valor || 0), 0), sem = L.filter(o => !o.avulso_empenho).length;
    $("v-med").innerHTML = topo + `<div class="card"><h3>${esc(EMPN[ST.emp] || ST.emp)}: pagamento por nota de empenho</h3>
      <div class="d">Empresa sem contrato com a SEDUC: cada serviço é pago por nota de empenho, aberta pela entidade (PACTUE extra) depois de pesquisa de preços. Fica fora da medição por itens; aqui a gerência acompanha o processo, o empenho e o valor de cada O.S.</div>
      <div class="kpis fisk"><div class="kpi"><div class="v">${nf(L.length)}</div><div class="l">O.S. atendidas</div></div><div class="kpi ok"><div class="v mval">${brl(tot)}</div><div class="l">Valor empenhado registrado</div></div>
        <div class="kpi ${sem ? "warn" : ""}"><div class="v">${nf(sem)}</div><div class="l">Sem empenho registrado</div></div></div>
      ${L.length ? `<div class="tbl" style="max-height:none"><table class="mmt"><thead><tr><th>Nº O.S.</th><th>Escola</th><th>Atendida em</th><th>Processo</th><th>Empenho</th><th class="n">Valor</th></tr></thead><tbody>${
        L.map(o => `<tr class="r" data-id="${o.id}"><td><b>${esc(o.os)}</b></td><td><div class="esc">${esc(tc(o.escola || ""))}</div></td><td>${fmt(o.atend)}</td><td>${esc(o.avulso_processo || "")}</td><td>${o.avulso_empenho ? esc(o.avulso_empenho) : '<span class="badge b-warn">Falta</span>'}</td><td class="n">${o.avulso_valor != null ? brl(o.avulso_valor) : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma O.S. atendida.</div>'}
      ${GMAP ? '<div class="mun">Abra a O.S. para registrar o processo, o empenho e o valor.</div>' : ""}</div>`;
    ligarTopo();
    const ordem = L.map(o => String(o.id));
    document.querySelectorAll("#v-med .mmt tr.r").forEach(tr => tr.onclick = () => P.openDet(tr.dataset.id, ordem));
  }

  // ---------- contrato, períodos e histórico ----------
  function blocoContrato(c, ps, pode) {
    const log = (M().log || []).filter(l => l.empresa === c.empresa).slice(0, 30);
    return `<details class="card fisres"><summary><h3 style="display:inline">Contrato ${esc(c.numero)}, períodos e histórico do cadastro</h3></summary>
      <div class="dl" style="margin-top:10px"><div>Empresa</div><div>${esc(EMPN[c.empresa] || c.empresa)}</div><div>Contrato</div><div>${esc(c.numero)}${c.ativo ? "" : " (desativado)"}</div>
        <div>Processo SEI</div><div>${esc(c.processo_sei || "")}</div><div>Documento SEI</div><div>${esc(c.documento_sei || "")}</div></div>
      ${pode ? '<div class="acoes" style="margin:8px 0"><button class="btn" id="mEdCt">Editar contrato</button><button class="btn" id="mNovoPer">+ Novo período (prorrogação)</button></div>' : ""}
      <div class="tbl" style="max-height:none"><table class="nocard"><thead><tr><th>Período de vigência</th><th>Instrumento</th><th>Documento SEI</th>${pode ? "<th></th>" : ""}</tr></thead><tbody>${
        ps.map(p => `<tr><td>${fmt(p.inicio)} a ${fmt(p.fim)}${p.inicio <= hoje && p.fim >= hoje ? ' <span class="badge b-ok">atual</span>' : ""}</td><td>${esc(p.instrumento)}</td><td>${esc(p.documento_sei || "")}</td>${pode ? `<td><button class="btn" data-mper="${p.id}">Editar</button></td>` : ""}</tr>`).join("") || '<tr><td colspan="4" class="mun">Nenhum período cadastrado.</td></tr>'}</tbody></table></div>
      <div class="mun" style="margin:6px 0 12px">Cada prorrogação abre um novo período com o quantitativo renovado (copiado do período anterior, com o consumo zerado).</div>
      <h3>Histórico do cadastro</h3>${log.length ? `<div class="tbl" style="max-height:none"><table class="nocard"><thead><tr><th>Quando</th><th>Quem</th><th>O que mudou</th></tr></thead><tbody>${
        log.map(l => `<tr><td>${new Date(l.em).toLocaleString("pt-BR")}</td><td>${esc(l.quem_nome || "")}</td><td class="ev">${esc(l.detalhe)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma alteração registrada.</div>'}
    </details>`;
  }
  function ligarContrato(c, pode) {
    if (!pode) return;
    if ($("mEdCt")) $("mEdCt").onclick = () => editarContrato(c);
    if ($("mNovoPer")) $("mNovoPer").onclick = () => editarPeriodo(c, null);
    document.querySelectorAll("#v-med [data-mper]").forEach(b => b.onclick = () => editarPeriodo(c, (M().periodos || []).find(p => String(p.id) === b.dataset.mper)));
  }
  const salvo = async (msg) => { await P.recarregar(); P.aviso(msg, "ok"); return null; };
  function editarContrato(c) {
    UI.dialogo({ titulo: `Contrato ${c.numero}`, botao: "Salvar", campos: [
      { id: "num", rot: "Número do contrato", obrig: true, valor: c.numero, max: 30 }, { id: "proc", rot: "Processo SEI", valor: c.processo_sei || "", max: 40 },
      { id: "doc", rot: "Documento SEI do contrato", valor: c.documento_sei || "", max: 40 },
      { id: "at", rot: "Situação", tipo: "select", obrig: true, valor: c.ativo ? "1" : "0", opcoes: [{ v: "1", t: "Ativo" }, { v: "0", t: "Desativado (encerrado)" }] }],
      enviar: async v => { const r = await rpc("contrato_salvar", { p_id: c.id, p_empresa: c.empresa, p_numero: v.num, p_processo: v.proc, p_documento: v.doc, p_ativo: v.at === "1" }); return r.erro || salvo("Contrato salvo."); } });
  }
  function editarPeriodo(c, p) {
    const ult = periodos(c.id)[0];
    const prox = d => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
    UI.dialogo({ titulo: p ? "Editar período de vigência" : "Novo período (prorrogação)", botao: "Salvar",
      texto: p ? "" : "O novo período começa com o mesmo quantitativo do período anterior e consumo zerado. Ajuste depois, item a item, se o aditivo mudar alguma quantidade.",
      campos: [{ id: "ini", rot: "Início", tipo: "date", obrig: true, valor: p ? p.inicio : ult ? prox(ult.fim) : "" }, { id: "fim", rot: "Fim", tipo: "date", obrig: true, valor: p ? p.fim : "" },
        { id: "ins", rot: "Instrumento", obrig: true, valor: p ? p.instrumento : "", dica: "Ex.: 4º Termo Aditivo (prorrogação)", max: 80 }, { id: "doc", rot: "Documento SEI", valor: p ? p.documento_sei || "" : "", max: 40 }],
      enviar: async v => { const r = await rpc("periodo_salvar", { p_id: p ? p.id : null, p_contrato: c.id, p_inicio: v.ini, p_fim: v.fim, p_instrumento: v.ins, p_documento: v.doc || null });
        if (r.erro) return r.erro; if (!p) { ST.per = String(r.data); ST.mes = ""; } return salvo("Período salvo."); } });
  }
  function editarItem(c, it) {
    UI.dialogo({ titulo: it ? `Item ${codigo(it, c.empresa)}` : "Novo item do contrato", botao: "Salvar",
      texto: it ? "Mudanças no item ficam no histórico do cadastro. Para mudar o preço, use o botão Preço." : "Depois de criar, informe o preço e a quantidade do período.",
      campos: [{ id: "g", rot: "Grupo", tipo: "select", obrig: true, valor: it ? it.grupo : "Serviço", opcoes: ["Serviço", "Peça"] },
        { id: "n", rot: "Número do item no contrato", tipo: "number", obrig: true, valor: it ? String(it.item) : "" },
        { id: "t", rot: "Tipo", obrig: true, valor: it ? it.tipo : "", dica: "Ex.: Manutenção corretiva, Compressor", max: 80 },
        { id: "f", rot: "Faixa (BTU)", obrig: true, valor: it ? it.faixa : "", dica: "Ex.: 12.000 a 18.000", max: 40 },
        { id: "u", rot: "Unidade", valor: it ? it.unidade : "Unidade", max: 20 },
        { id: "a", rot: "Situação", tipo: "select", obrig: true, valor: !it || it.ativo ? "1" : "0", opcoes: [{ v: "1", t: "Ativo (aparece para a empresa)" }, { v: "0", t: "Desativado" }] }],
      enviar: async v => { const r = await rpc("item_salvar", { p_id: it ? it.id : null, p_contrato: c.id, p_grupo: v.g, p_item: Number(v.n), p_tipo: v.t, p_faixa: v.f, p_unidade: v.u, p_ativo: v.a === "1" });
        return r.erro || salvo("Item salvo."); } });
  }
  function editarPreco(c, it) {
    const H = precos(it.id);
    UI.dialogo({ titulo: `Preço de ${codigo(it, c.empresa)} · ${nomeItem(it)}`, botao: "Salvar preço",
      texto: (H.length ? "<b>Versões:</b><br>" + H.map(h => `a partir de ${fmt(h.desde)}: ${brl(h.valor)} (${esc(h.documento_sei)})`).join("<br>") + "<br><br>" : "")
        + "Cada versão vale para os atendimentos a partir da data informada (ex.: apostilamento de reajuste). Atendimentos anteriores continuam com o preço da época.",
      campos: [{ id: "d", rot: "Vale a partir de", tipo: "date", obrig: true, valor: "" }, { id: "v", rot: "Valor unitário (R$)", obrig: true, valor: "", dica: "Ex.: 595,00" },
        { id: "doc", rot: "Documento que fixa o preço", obrig: true, valor: "", dica: "Ex.: Apostilamento nº 1, SEI 0000000", max: 120 }],
      enviar: async v => { const val = Number(v.v.replace(/\./g, "").replace(",", ".")); if (!(val > 0)) return "Informe o valor em reais (ex.: 595,00).";
        const r = await rpc("preco_salvar", { p_item: it.id, p_desde: v.d, p_valor: val, p_documento: v.doc }); return r.erro || salvo("Preço salvo."); } });
  }
  function editarQuantidade(c, p, it) {
    const q = qtd(it.id, p.id) || {};
    UI.dialogo({ titulo: `Quantidade de ${codigo(it, c.empresa)} · ${nomeItem(it)}`, botao: "Salvar",
      texto: `Período ${fmt(p.inicio)} a ${fmt(p.fim)} (${esc(p.instrumento)}).`,
      campos: [{ id: "q", rot: "Quantidade contratada no período", tipo: "number", obrig: true, valor: q.quantidade != null ? String(q.quantidade) : "" },
        { id: "a", rot: "Consumo anterior à implantação", tipo: "number", valor: q.consumo_informado ? String(q.consumo_anterior) : "", dica: "Quantidade já paga neste período antes de a medição começar no sistema. Deixe em branco se ainda não levantou." },
        { id: "doc", rot: "Documento SEI do consumo anterior", valor: q.consumo_doc || "", dica: "Obrigatório quando informar o consumo (ex.: processos de pagamento de ago. a out.).", max: 120 }],
      enviar: async v => { const qq = Number(v.q), aa = v.a === "" ? null : Number(v.a);
        if (!Number.isInteger(qq) || qq < 0) return "A quantidade contratada deve ser um número inteiro.";
        if (aa != null && (!Number.isInteger(aa) || aa < 0)) return "O consumo anterior deve ser um número inteiro.";
        const r = await rpc("quantidade_salvar", { p_item: it.id, p_periodo: p.id, p_quantidade: qq, p_consumo: aa, p_consumo_doc: v.doc || null }); return r.erro || salvo("Quantidade salva."); } });
  }

  // ---------- relatórios ----------
  const nomeArq = (c, x) => `Medicao_${(EMPN[c.empresa] || c.empresa).replace(/[^\p{L}\p{N}]+/gu, "_")}_${x}`.replace(/_+$/, "");
  function cab(c, p, t) { return [[t + " · GMAP | SEDUC-PI"], [`${EMPN[c.empresa] || c.empresa} · Contrato ${c.numero} · período ${fmt(p.inicio)} a ${fmt(p.fim)} (${p.instrumento})`], ["Emitido em " + new Date().toLocaleString("pt-BR") + " por " + (CTX.nome || "")], []]; }
  function exportarSaldo(c, p, S) {
    P.xlsx(nomeArq(c, "saldo_" + p.inicio) + ".xlsx", [["Saldo por item", cab(c, p, "Saldo dos itens do contrato").concat([["Código", "Grupo", "Item no contrato", "Tipo", "Faixa (BTU)", "Valor unitário (R$)", "Contratado", "Consumo anterior", "Documento do consumo anterior", "Aceito", "A conferir", "Saldo", "% usado", "Valor contratado (R$)", "Valor usado (R$)"]],
      S.map(x => [codigo(x.it, c.empresa), x.it.grupo, x.it.item, x.it.tipo, x.it.faixa, x.pu, x.cont, x.inf ? x.ant : "não informado", x.q.consumo_doc || "", x.ac, x.pend, x.saldo, x.cont ? Math.round(x.pct * 1000) / 10 : "",
        x.pu != null ? Math.round(x.cont * x.pu * 100) / 100 : "", Math.round((x.ant * (x.pu || 0) + x.vac + x.vpend) * 100) / 100]))]]);
  }
  function exportarMes(c, p, rot, L) {
    const det = []; L.forEach(r => itensOS(r.o).forEach(i => det.push([r.o.os, tc(r.o.escola || ""), fmt(r.o.atend), codigo(i.it, c.empresa), i.it.grupo, i.it.tipo, i.it.faixa, i.x.quantidade, i.pu, i.decl, i.c ? i.c.aceita : "", i.aceito ?? "", i.c && i.c.motivo || ""])));
    P.xlsx(nomeArq(c, rot.replace(/[^\p{L}\p{N}]+/gu, "_")) + ".xlsx", [
      ["Por O.S.", cab(c, p, "Medição de " + rot).concat([["Nº O.S.", "Escola", "INEP", "Atendida em", "Itens", "Valor declarado (R$)", "Valor aceito (R$)", "Conferência"]],
        L.map(r => [r.o.os, tc(r.o.escola || ""), r.o.inep || "", fmt(r.o.atend), r.v.n ? resumoItens(r.o) : r.ex ? "Itens não informados" : "Não exigidos", r.v.n ? Math.round(r.v.decl * 100) / 100 : "", r.v.aceito != null ? Math.round(r.v.aceito * 100) / 100 : "",
          r.c && r.c.situacao !== "pendente" ? r.c.situacao : "a conferir"]))],
      ["Por item", cab(c, p, "Medição de " + rot).concat([["Nº O.S.", "Escola", "Atendida em", "Código", "Grupo", "Tipo", "Faixa (BTU)", "Qtd. declarada", "Valor unitário (R$)", "Total declarado (R$)", "Qtd. aceita", "Total aceito (R$)", "Motivo da glosa do item"]], det.length ? det : [["Nenhum item declarado."]])]]);
  }
  function imprimirMes(c, p, rot, L, totDecl, totAc) {
    const T = (H, R) => `<table><thead><tr>${H.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${R.map(r => `<tr>${r.map(x => `<td>${esc(x ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    P.doPrint(`<div class="rp">${P.ph("Relatório de medição")}<h2>Medição de ${esc(rot)}</h2><div class="foot">${esc(EMPN[c.empresa] || c.empresa)} · Contrato ${esc(c.numero)} · período ${fmt(p.inicio)} a ${fmt(p.fim)}</div>
      ${T(["Nº O.S.", "Escola", "Atendida", "Itens", "Declarado", "Aceito", "Conferência"], L.map(r => [r.o.os, tc(r.o.escola || ""), fmt(r.o.atend), r.v.n ? resumoItens(r.o) : r.ex ? "Itens não informados" : "", r.v.n ? brl(r.v.decl) : "", r.v.aceito != null ? brl(r.v.aceito) : r.v.n ? "a conferir" : "",
        r.c && r.c.situacao !== "pendente" ? r.c.situacao : "a conferir"]).concat([["Total", "", "", "", brl(totDecl), brl(totAc), ""]]))}
      <div class="sig"><div>${esc(CTX.nome || "")}<br><small>${esc(CTX.perfilNome || "")}</small></div><div>Data</div></div>
      <div class="foot">Documento gerado pelo Painel de O.S. de Climatização em ${new Date().toLocaleString("pt-BR")}. Valores pelos preços vigentes na data de cada atendimento.</div></div>`);
  }

  return { servicosContrato, campoItens, validarItens, exige, contratoNa, itensOS, valorOS, resumoItens, blocoDetalhe, ligarDetalhe, render, contarAlertas, resumoAlertas, temContrato, brl, medDesde, nomeItem, codigo };
};
