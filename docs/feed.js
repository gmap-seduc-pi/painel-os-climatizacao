/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Feed: as movimentações das O.S. (histórico), das mais recentes para as mais antigas.
   Só lê os eventos que o banco já libera para o perfil (a empresa vê os públicos das O.S. dela;
   a gestão vê também os internos). Não altera nada. */
window.iniciarFeed = function (P) {
  const { CTX, $, esc, tc, nf, EMPN, STB } = P;
  const sb = CTX.sb;
  const GESTAO = P.GESTAO, EMPRESA = P.EMPRESA;
  const CHAVE = "feed_visto_" + (CTX.uid || "x");
  const ler = () => { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } };
  const gravar = v => { try { localStorage.setItem(CHAVE, v); } catch (e) { /* sem armazenamento: só não guarda a última visita */ } };
  // tipos de movimentação (pela ação registrada no histórico)
  const CAT = [
    { k: "emi", n: "Emissão e aprovação", c: "info", a: ["solicitou", "aprovou", "emitiu", "reenviou", "transferiu a solicitação", "recusou", "devolveu", "importou da planilha"] },
    { k: "atd", n: "Atendimento", c: "ok", a: ["registrou atendimento", "corrigiu atendimento", "desfez atendimento", "anexou a O.S. assinada"] },
    { k: "and", n: "Stand by, cancelamento e revisão", c: "warn", a: ["colocou em stand by", "retomou", "cancelou", "editou", "atualizou dados da escola", "colocou em revisão", "em revisão", "revisão concluída", "encerrou revisão sem alterar"] },
    { k: "fis", n: "Fiscalização e medição", c: "rev", a: ["informou itens", "corrigiu itens", "conferiu", "registrou pagamento por empenho"] },
    { k: "pla", n: "Planilha", c: "gray", a: ["aplicou mudança da planilha", "manteve o sistema"] }
  ];
  const catDe = acao => CAT.find(c => c.a.includes(acao)) || { k: "out", n: "Outras", c: "gray" };
  const PER = [["1", "Hoje"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"]];
  const ST = { per: "7", cat: "", emp: "", q: "", lim: 60 };
  let EVTS = null, carregado = "", carregando = false;
  const fuso = { timeZone: "America/Sao_Paulo" };
  const dia = ts => new Date(ts).toLocaleDateString("sv-SE", fuso);
  const hora = ts => new Date(ts).toLocaleTimeString("pt-BR", Object.assign({ hour: "2-digit", minute: "2-digit" }, fuso));
  const hojeStr = () => new Date().toLocaleDateString("sv-SE", fuso);
  function rotDia(d) {
    const h = hojeStr(), o = new Date(Date.parse(h + "T12:00:00") - 864e5).toISOString().slice(0, 10);
    if (d === h) return "Hoje"; if (d === o) return "Ontem";
    const t = new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const maiusc = a => { a = String(a || ""); return a.charAt(0).toUpperCase() + a.slice(1); };

  // contador da aba: O.S. que mudaram desde a última visita ao Feed (sem contar o que a própria pessoa fez)
  function contar() {
    const visto = ler(); if (!visto) return 0;
    return P.todos().filter(o => o.movimentada_em && Date.parse(o.movimentada_em) > Date.parse(visto) && o.movimentada_por !== CTX.nome).length;
  }
  async function carregar(forcar) {
    const desde = new Date(Date.now() - (+ST.per) * 864e5);
    if (ST.per === "1") desde.setTime(Date.parse(hojeStr() + "T00:00:00-03:00"));
    const chave = ST.per + "|" + desde.toISOString().slice(0, 13);
    if (!forcar && EVTS && carregado === chave) return;
    carregando = true;
    const { data, error } = await sb.from("os_eventos").select("*").gte("quando", desde.toISOString()).order("quando", { ascending: false }).range(0, 2999);
    carregando = false;
    if (error) { EVTS = []; carregado = ""; throw new Error(error.message); }
    EVTS = (data || []).sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando) || b.id - a.id);
    carregado = chave;
  }
  async function render(forcar) {
    const el = $("v-feed");
    const visto = ler();
    const y = window.scrollY;
    if (!EVTS) el.innerHTML = `<div class="card"><div class="empty">Carregando as movimentações…</div></div>`;
    try { await carregar(forcar); } catch (e) { el.innerHTML = `<div class="card"><div class="faixa warn">Não foi possível carregar as movimentações: ${esc(e.message)}</div><button class="btn" id="fdTenta">Tentar de novo</button></div>`; $("fdTenta").onclick = () => render(true); return; }
    const porId = new Map(P.todos().map(o => [String(o.id), o]));
    const q = ST.q.trim().toLowerCase();
    const L = EVTS.map(e => ({ e, o: porId.get(String(e.os_id)), cat: catDe(e.acao) }))
      .filter(x => x.o && (!ST.cat || x.cat.k === ST.cat) && (!ST.emp || x.o.emp === ST.emp)
        && (!q || [x.o.os, x.o.escola, x.o.inep, x.o.mun, x.e.quem_nome].join(" ").toLowerCase().includes(q)));
    const empsF = [...new Set(EVTS.map(e => (porId.get(String(e.os_id)) || {}).emp).filter(Boolean))].sort();
    const vis = L.slice(0, ST.lim);
    const grupos = []; vis.forEach(x => { const d = dia(x.e.quando); const g = grupos[grupos.length - 1]; if (g && g.d === d) g.L.push(x); else grupos.push({ d, L: [x] }); });
    const novos = visto ? L.filter(x => Date.parse(x.e.quando) > Date.parse(visto) && x.e.quem_nome !== CTX.nome).length : 0;
    el.innerHTML = `<div class="card fdtopo"><div class="fish"><h3>Feed de movimentações</h3><div class="acoes"><button class="btn" id="fdAtu">Atualizar</button></div></div>
      <div class="d">Tudo o que aconteceu com as O.S.${EMPRESA ? " da empresa" : ""}, das movimentações mais recentes para as mais antigas. Clique numa movimentação para abrir a O.S.${GESTAO ? " Movimentações internas (conferência, pagamento por empenho) aparecem marcadas e não são vistas pelas empresas." : ""}</div>
      <div class="fdf"><label>Período<select id="fdPer">${PER.map(([v, t]) => `<option value="${v}" ${ST.per === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Tipo<select id="fdCat"><option value="">Todos os tipos</option>${CAT.map(c => `<option value="${c.k}" ${ST.cat === c.k ? "selected" : ""}>${c.n}</option>`).join("")}</select></label>
        ${!EMPRESA && empsF.length > 1 ? `<label>Empresa<select id="fdEmp"><option value="">Todas</option>${empsF.map(e => `<option value="${esc(e)}" ${ST.emp === e ? "selected" : ""}>${esc(EMPN[e] || e)}</option>`).join("")}</select></label>` : ""}
        <label class="fdq">Buscar<input id="fdQ" type="search" placeholder="Nº da O.S., escola, município ou pessoa" value="${esc(ST.q)}"></label></div>
      <div class="mun" id="fdRes">${nf(L.length)} ${L.length === 1 ? "movimentação" : "movimentações"}${novos ? ` · <b class="txok">${nf(novos)} ${novos === 1 ? "nova" : "novas"} desde a sua última visita</b>` : ""}</div></div>
      ${grupos.length ? grupos.map(g => `<div class="card fdg"><h4 class="fddia">${esc(rotDia(g.d))}</h4><ol class="fdl">${g.L.map(x => {
        const novo = visto && Date.parse(x.e.quando) > Date.parse(visto) && x.e.quem_nome !== CTX.nome;
        return `<li><button type="button" class="fdi${novo ? " novo" : ""}" data-os="${esc(String(x.o.id))}">
          <span class="fdh">${esc(hora(x.e.quando))}</span><span class="fdp ${x.cat.c}" aria-hidden="true"></span>
          <span class="fdc"><span class="fdt"><b>${esc(maiusc(x.e.acao))}</b> · O.S. <b>${esc(x.o.os)}</b> <span class="badge ${STB[x.o.status] || "b-gray"}">${esc(x.o.status)}</span>${x.e.interno ? ' <span class="badge b-rev">interno</span>' : ""}${novo ? ' <span class="badge b-novo">Novo</span>' : ""}</span>
            <span class="fdq2">${esc(x.e.quem_nome || "")}${x.e.perfil === "empresa" ? " (empresa)" : ""} · ${esc(tc(x.o.escola || ""))}${x.o.mun ? ", " + esc(tc(x.o.mun)) : ""}${!EMPRESA ? " · " + esc(EMPN[x.o.emp] || x.o.emp || "") : ""}</span>
            ${x.e.detalhe ? `<span class="fdd" title="${esc(x.e.detalhe)}">${esc(x.e.detalhe)}</span>` : ""}</span></button></li>`; }).join("")}</ol></div>`).join("")
        : `<div class="card"><div class="empty">Nenhuma movimentação ${ST.per === "1" ? "hoje" : "no período"}${ST.cat || ST.emp || ST.q ? " com esses filtros" : ""}.</div></div>`}
      ${L.length > ST.lim ? `<div class="fdmais"><button class="btn" id="fdMais">Mostrar mais ${nf(Math.min(60, L.length - ST.lim))}</button></div>` : ""}
      ${EVTS.length >= 3000 ? '<div class="mun">Mostrando as 3.000 movimentações mais recentes do período. Escolha um período menor para ver tudo.</div>' : ""}`;
    if (forcar) window.scrollTo(0, y);
    // a visita conta a partir de agora (o destaque "Novo" continua até a próxima vez)
    gravar(new Date().toISOString()); P.contarFeed();
    const re = () => { ST.lim = 60; render(); };
    $("fdPer").onchange = e => { ST.per = e.target.value; re(); };
    $("fdCat").onchange = e => { ST.cat = e.target.value; re(); };
    if ($("fdEmp")) $("fdEmp").onchange = e => { ST.emp = e.target.value; re(); };
    let t; $("fdQ").oninput = e => { clearTimeout(t); t = setTimeout(() => { ST.q = e.target.value; ST.lim = 60; render().then(() => { const i = $("fdQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
    $("fdAtu").onclick = async () => { await P.recarregar(); render(true); };
    if ($("fdMais")) $("fdMais").onclick = () => { ST.lim += 60; render(); };
    const ordem = [...new Set(vis.map(x => String(x.o.id)))];
    el.querySelectorAll(".fdi").forEach(b => b.onclick = () => P.openDet(b.dataset.os, ordem));
  }
  // primeira visita: começa a contar a partir de agora
  if (!ler()) gravar(new Date().toISOString());
  return { render, contar };
};
