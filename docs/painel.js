/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Lógica do painel. Recebe os dados já filtrados pelo banco (RLS) e o perfil do usuário. */
function iniciarPainel(CTX){
const RAW = CTX.rows;
const LOGO = CTX.logo;
const REF = CTX.ref;               // hoje (fuso de Brasília)
const AVENCER = 3;                // dias para "a vencer"
const F = ["os","emp","status","prio","criada","prazo","atend","splits","desc","escola","inep","gre","mun","zona","end","sei","obs","just","motivo"];
const OPEN = ["Pendente","Em andamento","Problema"];
const EMPN = {"CLASSE A":"Classe A","CONCRETIZAR":"Concretizar","R.E. SOLUÇÕES":"R.E. Soluções","NATAL COMPUTER":"Natal Computer"};
const PRIOS = ["Urgente","Alta","Normal"];
const SERV = ["MANUT. PREVENTIVA","MANUT. CORRETIVA","INSTALAÇÃO","DESINSTALAÇÃO"];
const SERVN = {"MANUT. PREVENTIVA":"Preventiva","MANUT. CORRETIVA":"Corretiva","INSTALAÇÃO":"Instalação","DESINSTALAÇÃO":"Desinstalação"};
const dd = s => s ? new Date(s+"T12:00:00") : null;
const ref = dd(REF);
const days = (a,b) => Math.round((a-b)/864e5);
const fmt = s => s ? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : "";
const nf = n => n.toLocaleString("pt-BR");
const pct = (a,b) => b ? (a/b*100).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%" : "n/d";
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const tc = s => s.toLowerCase().replace(/(^|[\s(\/-])(\S)/g,(m,a,b)=>a+b.toUpperCase()).replace(/ (Do|De|Da|Dos|Das|E) /g,m=>m.toLowerCase());

const ALL = RAW.map(r => { const o={}; F.forEach((k,i)=>o[k]=r[i]);
  o.serv = (o.desc||"").split(",").map(s=>s.trim()).filter(Boolean);
  // situação do prazo
  const pz=dd(o.prazo), cr=dd(o.criada), at=dd(o.atend);
  if (o.status==="Cancelada") o.sp="Cancelada";
  else if (o.status==="Atendida") {
    if (!at || !pz) o.sp="Sem data";
    else if (cr && at<cr) o.sp="Atendida antes da O.S.";
    else o.sp = at<=pz ? "Atendida no prazo" : "Atendida fora do prazo";
    o.atraso = at&&pz ? days(at,pz) : null;
  } else {
    if (!pz) o.sp="Sem prazo";
    else { const d=days(pz,ref); o.sp = d<0 ? "Vencida" : d<=AVENCER ? "A vencer" : "No prazo"; o.atraso = -d; }
  }
  return o; });
const DENTRO = ["Atendida no prazo","Atendida antes da O.S."];
const SPB = {"Vencida":"b-bad","A vencer":"b-warn","No prazo":"b-info","Atendida no prazo":"b-ok","Atendida fora do prazo":"b-bad","Cancelada":"b-gray","Sem prazo":"b-gray","Sem data":"b-gray","Atendida antes da O.S.":"b-ok"};
const STB = {"Atendida":"b-ok","Em andamento":"b-info","Pendente":"b-warn","Problema":"b-bad","Cancelada":"b-gray"};
const PRB = {"Urgente":"b-bad","Alta":"b-warn","Normal":"b-gray"};

// ---------- perfis (simulação do login) ----------
const EMPS = [...new Set(ALL.map(o=>o.emp))].sort((a,b)=>ALL.filter(o=>o.emp===b).length-ALL.filter(o=>o.emp===a).length);
EMPS.forEach(e=>{ if(!EMPN[e]) EMPN[e]=tc(e) });
const PERFIS = [{id:"gmap",n:"GMAP (gerência)"},{id:"dir",n:"Diretoria"}].concat(EMPS.map(e=>({id:"emp:"+e,n:"Empresa: "+EMPN[e]})));
const $ = id => document.getElementById(id);
let perfil=CTX.perfil, view="geral", page=0, sel=new Set();
if(perfil.startsWith("emp:") && !EMPN[perfil.slice(4)]) EMPN[perfil.slice(4)]=tc(perfil.slice(4));
const PS=50;
const base = () => perfil.startsWith("emp:") ? ALL.filter(o=>o.emp===perfil.slice(4)) : ALL;

// ---------- filtros ----------
const FD = [
  {k:"emp",n:"Empresa",opts:()=>EMPS.map(e=>[e,EMPN[e]]),hideEmp:true},
  {k:"gre",n:"GRE",opts:()=>uniq("gre").map(g=>[g,g==="SEDE"?"Sede":g.replace(/^0?(\d+)ª - (.*)$/,(m,a,b)=>a+"ª "+tc(b))])},
  {k:"mun",n:"Município",opts:()=>uniq("mun").map(m=>[m,tc(m)])},
  {k:"status",n:"Status",opts:()=>["Pendente","Em andamento","Problema","Atendida","Cancelada"].map(s=>[s,s])},
  {k:"prio",n:"Prioridade",opts:()=>PRIOS.map(p=>[p,p])},
  {k:"serv",n:"Tipo de serviço",opts:()=>SERV.map(s=>[s,SERVN[s]])},
];
function uniq(k){return [...new Set(base().map(o=>o[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true}))}
let FV={};
function buildFilters(){
  const isEmp=perfil.startsWith("emp:");
  $("filters").innerHTML = FD.filter(f=>!(f.hideEmp&&isEmp)).map(f=>`<div><label>${f.n}</label><select data-k="${f.k}"><option value="">Todos</option>${f.opts().map(([v,t])=>`<option value="${esc(v)}" ${FV[f.k]===v?"selected":""}>${esc(t)}</option>`).join("")}</select></div>`).join("")
   + `<div><label>Criadas de</label><input type="date" data-k="de" value="${FV.de||""}"></div><div><label>até</label><input type="date" data-k="ate" value="${FV.ate||""}"></div>`
   + `<div class="fbar"><button class="btn" id="clr">Limpar filtros</button></div>`;
  $("filters").querySelectorAll("select,input").forEach(el=>el.onchange=()=>{FV[el.dataset.k]=el.value;page=0;render()});
  $("clr").onclick=()=>{FV={};buildFilters();page=0;render()};
}
function filtered(){
  return base().filter(o=>{
    for(const k of ["emp","gre","mun","status","prio"]) if(FV[k] && o[k]!==FV[k]) return false;
    if(FV.serv && !o.serv.includes(FV.serv)) return false;
    if(FV.de && (!o.criada || o.criada<FV.de)) return false;
    if(FV.ate && (!o.criada || o.criada>FV.ate)) return false;
    return true;
  });
}
function filterText(){
  const p=[]; FD.forEach(f=>{if(FV[f.k]){const o=f.opts().find(x=>x[0]===FV[f.k]);p.push(f.n+": "+(o?o[1]:FV[f.k]))}});
  if(FV.de)p.push("De "+fmt(FV.de)); if(FV.ate)p.push("Até "+fmt(FV.ate));
  const pr=(PERFIS.find(x=>x.id===perfil)||{n:CTX.perfilNome}).n;
  return "Perfil: "+pr+(p.length?" · "+p.join(" · "):" · Sem filtros");
}

// ---------- indicadores ----------
function stats(L){
  const open=L.filter(o=>OPEN.includes(o.status));
  const at=L.filter(o=>DENTRO.includes(o.sp)||o.sp==="Atendida fora do prazo");
  return {total:L.length,open:open.length,venc:open.filter(o=>o.sp==="Vencida").length,av:open.filter(o=>o.sp==="A vencer").length,
    noprz:open.filter(o=>o.sp==="No prazo").length,atend:L.filter(o=>o.status==="Atendida").length,atNo:at.filter(o=>DENTRO.includes(o.sp)).length,atBase:at.length};
}
let ch1,ch2;
Chart.defaults.font.family='Montserrat,"Segoe UI",Arial,sans-serif'; Chart.defaults.color="#5C6670";
function renderGeral(L){
  const s=stats(L);
  const k=[
    {v:nf(s.open),l:"O.S. em aberto",h:`de ${nf(s.total)} no filtro`,go:{}},
    {v:nf(s.venc),l:"Vencidas",h:pct(s.venc,s.open)+" das em aberto",c:"bad",go:{sp:"Vencida"}},
    {v:nf(s.av),l:`A vencer em até ${AVENCER} dias`,h:"precisam de atenção agora",c:"warn",go:{sp:"A vencer"}},
    {v:nf(s.atend),l:"Atendidas",h:pct(s.atend,s.total)+" do total",go:{status:"Atendida"}},
    {v:pct(s.atNo,s.atBase),l:"Atendidas no prazo",h:`${nf(s.atNo)} de ${nf(s.atBase)} com datas válidas`,c:"ok"},
  ];
  const canFila = true;
  $("kpis").innerHTML=k.map((x,i)=>`<div class="kpi ${x.c||""} ${x.go&&canFila?"click":""}" data-i="${i}"><div class="v">${x.v}</div><div class="l">${x.l}</div><div class="h">${x.h}</div></div>`).join("");
  $("kpis").querySelectorAll(".kpi.click").forEach(el=>el.onclick=()=>{const g=k[+el.dataset.i].go; if(g.status){FV.status=g.status;buildFilters()} $("fprazo").value=g.sp||""; setView("fila")});

  // gráfico 1: aberto por situação do prazo (por empresa ou por prioridade no perfil empresa)
  const isEmp=perfil.startsWith("emp:");
  const cats = isEmp ? PRIOS : EMPS.filter(e=>L.some(o=>o.emp===e));
  const key = isEmp ? "prio" : "emp";
  $("t1").textContent = "Carteira em aberto por situação do prazo" + (isEmp?" e prioridade":"");
  const sit=[["Vencida","#EF4123"],["A vencer","#FDB913"],["No prazo","#034EA2"]];
  const open=L.filter(o=>OPEN.includes(o.status));
  ch1&&ch1.destroy();
  ch1=new Chart($("c1"),{type:"bar",data:{labels:cats.map(c=>isEmp?c:EMPN[c]),datasets:sit.map(([n,c])=>({label:n,backgroundColor:c,data:cats.map(x=>open.filter(o=>o[key]===x&&o.sp===n).length)}))},
    options:{indexAxis:"y",maintainAspectRatio:false,plugins:{legend:{position:"top",align:"start"}},scales:{x:{stacked:true,grid:{color:"#EEF1F3"}},y:{stacked:true,grid:{display:false}}}}});

  // matriz % no prazo
  const rowsM = isEmp ? [[EMPN[perfil.slice(4)],L]] : cats.map(e=>[EMPN[e],L.filter(o=>o.emp===e)]).concat([["Total",L]]);
  const cell=(LL)=>{const a=LL.filter(o=>DENTRO.includes(o.sp)||o.sp==="Atendida fora do prazo"),n=a.filter(o=>DENTRO.includes(o.sp)).length;
    if(!a.length) return `<td><span class="cell b-gray">n/d</span></td>`; const p=n/a.length; const c=p>=.8?"b-ok":p>=.5?"b-warn":"b-bad";
    return `<td title="${n} de ${a.length}"><span class="cell ${c}">${pct(n,a.length)}</span><div class="mun">${n}/${a.length}</div></td>`};
  $("mx").innerHTML=`<table class="mx"><thead><tr><th></th>${PRIOS.map(p=>`<th style="text-align:center">${p}</th>`).join("")}<th style="text-align:center">Geral</th></tr></thead><tbody>`+
    rowsM.map(([n,LL])=>`<tr><td>${n}</td>${PRIOS.map(p=>cell(LL.filter(o=>o.prio===p))).join("")}${cell(LL)}</tr>`).join("")+`</tbody></table>
    <div class="mun" style="margin-top:8px">Verde: 80% ou mais · Amarelo: 50% a 79% · Vermelho: abaixo de 50%. Passe o mouse para ver as quantidades.</div>`;

  // gráfico 2: mensal
  const mk=s=>s?s.slice(0,7):null; const ms=[...new Set(L.map(o=>mk(o.criada)).concat(L.map(o=>mk(o.atend))).filter(Boolean))].sort();
  const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  ch2&&ch2.destroy();
  ch2=new Chart($("c2"),{type:"bar",data:{labels:ms.map(m=>MES[+m.slice(5)-1]+"/"+m.slice(2,4)),datasets:[
    {label:"Emitidas",backgroundColor:"#A9C1E3",data:ms.map(m=>L.filter(o=>mk(o.criada)===m&&o.status!=="Cancelada").length)},
    {label:"Atendidas",backgroundColor:"#034EA2",data:ms.map(m=>L.filter(o=>o.status==="Atendida"&&mk(o.atend)===m).length)}]},
    options:{maintainAspectRatio:false,plugins:{legend:{position:"top",align:"start"}},scales:{x:{grid:{display:false}},y:{grid:{color:"#EEF1F3"}}}}});

  // maiores atrasos
  const late=open.filter(o=>o.sp==="Vencida").sort((a,b)=>b.atraso-a.atraso).slice(0,6);
  $("late").innerHTML = late.length ? `<table><thead><tr><th>Nº O.S.</th><th>Escola</th>${isEmp?"":"<th>Empresa</th>"}<th>Prioridade</th><th class="n">Dias de atraso</th></tr></thead><tbody>${
    late.map(o=>`<tr class="r" data-os="${esc(o.os)}|${esc(o.emp)}"><td><b>${esc(o.os)}</b></td><td><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||""))}</div></td>${isEmp?"":`<td>${EMPN[o.emp]}</td>`}<td><span class="badge ${PRB[o.prio]||"b-gray"}">${esc(o.prio||"n/d")}</span></td><td class="n"><b style="color:var(--bad)">${nf(o.atraso)}</b></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Nenhuma O.S. vencida no filtro.</div>`;
  $("late").querySelectorAll("tr.r").forEach(tr=>tr.onclick=()=>openDet(tr.dataset.os));
}

// ---------- auditoria dos dados (somente GMAP) ----------
const byInep = {}; ALL.forEach(o=>{ if(o.inep){ (byInep[o.inep]=byInep[o.inep]||[]).push(o) } });
const osCount = {}; ALL.forEach(o=>osCount[o.os]=(osCount[o.os]||0)+1);
const svTxt = o => o.serv.map(s=>SERVN[s]||s).join(", ");
const evAt = a => `${a.os} em ${fmt(a.atend)} (${a.splits??"?"} split${a.splits===1?"":"s"}, ${svTxt(a)}, ${EMPN[a.emp]||a.emp})`;
function backlog(o){
  if(!OPEN.includes(o.status)||!o.inep||!o.criada) return null;
  const at=(byInep[o.inep]||[]).filter(a=>a!==o&&a.status==="Atendida"&&a.atend&&a.atend>=o.criada);
  if(!at.length) return null;
  const cover = o.serv.length && o.serv.every(t=>at.some(a=>a.serv.includes(t)&&(a.splits??0)>=(o.splits??0)));
  return {tipo:cover?"prov":"parc", ev:"Atendida depois na mesma escola: "+at.slice(0,3).map(evAt).join("; ")+(at.length>3?` e mais ${at.length-3}`:"")};
}
const CHECKS = [
  {id:"prov",c:"r",t:"Provável backlog artificial",x:"Em aberto, mas a escola teve atendimento posterior que cobre o serviço e a quantidade",
   f:o=>{const b=backlog(o);return b&&b.tipo==="prov"?b.ev:null}},
  {id:"parc",c:"y",t:"Atendimento parcial posterior",x:"Em aberto; a escola foi atendida depois, mas com outro serviço ou menos splits",
   f:o=>{const b=backlog(o);return b&&b.tipo==="parc"?b.ev:null}},
  {id:"dup",c:"y",t:"Possível duplicidade em aberto",x:"Outra O.S. em aberto na mesma escola com o mesmo tipo de serviço",
   f:o=>{if(!OPEN.includes(o.status)||!o.inep)return null; const d=(byInep[o.inep]||[]).filter(a=>a!==o&&OPEN.includes(a.status)&&a.serv.some(t=>o.serv.includes(t))); return d.length?"Também em aberto: "+d.map(a=>`${a.os} (${EMPN[a.emp]||a.emp}, criada em ${fmt(a.criada)})`).join("; "):null}},
  {id:"just",c:"r",t:"Vencida ou com problema sem justificativa",x:"A empresa não registrou justificativa",
   f:o=>(o.sp==="Vencida"||o.status==="Problema")&&!o.just?(o.status==="Problema"?"Status Problema sem justificativa":`Vencida há ${o.atraso} dias sem justificativa`):null},
  {id:"semat",c:"y",t:"Atendida sem data de atendimento",x:"Status Atendida, mas a data não foi preenchida",
   f:o=>o.status==="Atendida"&&!o.atend?"Data do atendimento em branco":null},
  {id:"inc",c:"y",t:"Cadastro incompleto",x:"Falta data de criação, prazo, prioridade, município ou INEP",
   f:o=>{const m=[];if(!o.criada)m.push("data de criação");if(!o.prazo)m.push("prazo");if(!o.prio)m.push("prioridade");if(!o.mun)m.push("município");if(!o.inep)m.push("INEP");return m.length?"Sem "+m.join(", "):null}},
  {id:"rep",c:"y",t:"Número de O.S. repetido",x:"O mesmo número aparece em mais de um registro",
   f:o=>osCount[o.os]>1?"Também usado em: "+ALL.filter(a=>a.os===o.os&&a!==o).map(a=>`${EMPN[a.emp]||a.emp} (${a.status})`).join(", "):null},
  {id:"ant",c:"g",t:"Atendidas antes da emissão",x:"Chamados urgentes atendidos antes da O.S., que veio depois para regularizar",
   f:o=>o.sp==="Atendida antes da O.S."?`Atendida em ${fmt(o.atend)}, O.S. criada em ${fmt(o.criada)} (${days(dd(o.criada),dd(o.atend))} dias depois)`:null},
];
let audSel="prov", ch3;
function renderAud(L){
  const res={}; CHECKS.forEach(c=>res[c.id]=L.map(o=>[o,c.f(o)]).filter(x=>x[1]));
  $("audg").innerHTML=CHECKS.map(c=>`<div class="ac ${c.c} ${audSel===c.id?"on":""}" data-id="${c.id}"><div class="v">${nf(res[c.id].length)}</div><div class="t">${c.t}</div><div class="x">${c.x}</div></div>`).join("");
  $("audg").querySelectorAll(".ac").forEach(el=>el.onclick=()=>{audSel=el.dataset.id;renderAud(L)});
  // canceladas
  const can=L.filter(o=>o.status==="Cancelada"), mot={}; can.forEach(o=>{const m=o.motivo||"Não informado";mot[m]=(mot[m]||0)+1});
  const me=Object.entries(mot).sort((a,b)=>b[1]-a[1]);
  $("cand").textContent=`${nf(can.length)} de ${nf(L.length)} O.S. (${pct(can.length,L.length)})`+(mot["Não informado"]?` · ${mot["Não informado"]} sem motivo informado`:"");
  ch3&&ch3.destroy();
  ch3=new Chart($("c3"),{type:"bar",data:{labels:me.map(x=>x[0].length>42?x[0].slice(0,40)+"…":x[0]),datasets:[{label:"O.S.",data:me.map(x=>x[1]),backgroundColor:"#034EA2"}]},
    options:{indexAxis:"y",maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:"#EEF0F3"},ticks:{precision:0}},y:{grid:{display:false}}}}});
  const ce=EMPS.map(e=>{const LL=L.filter(o=>o.emp===e),cc=LL.filter(o=>o.status==="Cancelada");const m={};cc.forEach(o=>{const k=o.motivo||"Não informado";m[k]=(m[k]||0)+1});const top=Object.entries(m).sort((a,b)=>b[1]-a[1])[0];return [e,LL.length,cc.length,top]}).filter(r=>r[1]);
  $("canemp").innerHTML=`<table><thead><tr><th>Empresa</th><th class="n">Canceladas</th><th class="n">% das emitidas</th><th>Motivo mais frequente</th></tr></thead><tbody>${ce.map(([e,n,c,t])=>`<tr><td>${EMPN[e]}</td><td class="n"><b>${nf(c)}</b></td><td class="n">${pct(c,n)}</td><td>${t?esc(t[0])+` (${t[1]})`:"n/d"}</td></tr>`).join("")}</tbody></table>`;
  // lista
  const c=CHECKS.find(x=>x.id===audSel), rows=res[audSel].slice().sort((a,b)=>(a[0].criada||"").localeCompare(b[0].criada||""));
  $("audlist").innerHTML=`<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap"><div><h3>${c.t} (${nf(rows.length)})</h3><div class="d">${c.x}. Clique na O.S. para ver o detalhe.</div></div><button class="btn" id="audx" ${rows.length?"":"disabled"}>Exportar lista (.xlsx)</button></div>
   <div class="tbl" style="max-height:60vh">${rows.length?`<table><thead><tr><th>Nº O.S.</th><th>Empresa</th><th>Escola</th><th>Status</th><th>Criada</th><th>Evidência</th></tr></thead><tbody>${rows.map(([o,ev])=>`<tr class="r" data-os="${esc(o.os+"|"+o.emp)}"><td><b>${esc(o.os)}</b></td><td>${EMPN[o.emp]||esc(o.emp)}</td><td><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||"Município não informado"))}</div></td><td><span class="badge ${STB[o.status]}">${esc(o.status)}</span></td><td>${fmt(o.criada)||"n/d"}</td><td class="ev">${esc(ev)}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Nenhuma ocorrência no filtro atual.</div>`}</div>`;
  $("audlist").querySelectorAll("tr.r").forEach(tr=>tr.onclick=()=>openDet(tr.dataset.os));
  const bx=$("audx"); if(bx) bx.onclick=()=>xlsx("Auditoria_"+audSel+".xlsx",[["Auditoria",[["Auditoria dos dados · "+c.t],[filterText()],["Situação em "+fmt(REF)+" · emitido em "+stamp()],[],["Nº O.S.","Empresa","Status","Prioridade","Criada em","Prazo","Atendida em","Escola","INEP","Município","Serviço","Splits","Evidência"]].concat(rows.map(([o,ev])=>[o.os,EMPN[o.emp]||o.emp,o.status,o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.escola,o.inep,o.mun,svTxt(o),o.splits??"",ev]))]]);
}

// ---------- fila ----------
function filaList(){
  const q=$("q").value.trim().toLowerCase(), sp=$("fprazo").value;
  return filtered().filter(o=>(!sp||o.sp===sp)&&(!q||[o.os,o.escola,o.inep,o.sei,o.mun].join(" ").toLowerCase().includes(q)))
    .sort((a,b)=>{const ra=OPEN.includes(a.status)?0:1, rb=OPEN.includes(b.status)?0:1; if(ra!==rb) return ra-rb; return (b.atraso??-1e9)-(a.atraso??-1e9)});
}
function renderFila(){
  const L=filaList(), n=L.length, pages=Math.max(1,Math.ceil(n/PS)); if(page>=pages) page=pages-1;
  const P=L.slice(page*PS,page*PS+PS);
  $("cnt").textContent=`${nf(n)} O.S.`+(sel.size?` · ${sel.size} selecionada(s)`:"");
  $("bPrintSel").disabled=!sel.size;
  const id=o=>o.os+"|"+o.emp;
  $("tb").tBodies[0].innerHTML = P.length ? P.map(o=>{
    const pz = o.sp==="Vencida" ? `<span class="badge b-bad">Vencida há ${nf(o.atraso)} d</span>` : o.sp==="A vencer" ? `<span class="badge b-warn">Vence em ${nf(-o.atraso)} d</span>` : `<span class="badge ${SPB[o.sp]}">${o.sp}</span>`;
    return `<tr class="r" data-os="${esc(id(o))}"><td><input type="checkbox" class="ck" ${sel.has(id(o))?"checked":""}></td><td><b>${esc(o.os)}</b></td><td>${EMPN[o.emp]||esc(o.emp)}</td>
    <td><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||"Município não informado"))}</div></td>
    <td><span class="badge ${PRB[o.prio]||"b-gray"}">${esc(o.prio||"n/d")}</span></td><td>${fmt(o.criada)}</td><td>${fmt(o.prazo)}</td><td>${pz}</td><td><span class="badge ${STB[o.status]}">${esc(o.status)}</span></td></tr>`}).join("")
    : `<tr><td colspan="9" class="empty">Nenhuma O.S. encontrada.</td></tr>`;
  $("tb").tBodies[0].querySelectorAll("tr.r").forEach(tr=>{
    const ck=tr.querySelector(".ck");
    ck.onclick=e=>{e.stopPropagation(); ck.checked?sel.add(tr.dataset.os):sel.delete(tr.dataset.os); renderFila()};
    tr.onclick=()=>openDet(tr.dataset.os);
  });
  $("all").checked = P.length && P.every(o=>sel.has(id(o)));
  $("all").onclick=()=>{P.forEach(o=>$("all").checked?sel.add(id(o)):sel.delete(id(o)));renderFila()};
  $("pinfo").textContent=`Página ${page+1} de ${pages}`; $("prev").disabled=page===0; $("next").disabled=page>=pages-1;
}
$("prev").onclick=()=>{page--;renderFila()}; $("next").onclick=()=>{page++;renderFila()};
$("q").oninput=()=>{page=0;renderFila()}; $("fprazo").onchange=()=>{page=0;renderFila()};

// ---------- detalhe ----------
const find = k => ALL.find(o=>o.os+"|"+o.emp===k);
function osRows(o){return [["Empresa",EMPN[o.emp]||o.emp],["Status",o.status],["Prioridade",o.prio||"n/d"],["Criada em",fmt(o.criada)],["Prazo",fmt(o.prazo)],["Atendida em",fmt(o.atend)||"n/d"],
  ["Situação do prazo",o.sp],["Escola",o.escola],["INEP",o.inep],["GRE",o.gre],["Município",tc(o.mun||"")],["Endereço",o.end],["Processo SEI",o.sei],["Serviço",o.serv.map(s=>SERVN[s]||s).join(", ")],
  ["Qtd. de splits",o.splits??""],["Observações",o.obs],["Justificativa da empresa",o.just],["Motivo do cancelamento",o.motivo]].filter(r=>r[1]!==""&&r[1]!=null)}
function openDet(k){const o=find(k); if(!o) return;
  $("det").innerHTML=`<div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><div class="mun">Ordem de serviço</div><h2>${esc(o.os)}</h2>
   <span class="badge ${STB[o.status]}">${esc(o.status)}</span> <span class="badge ${SPB[o.sp]}">${esc(o.sp)}</span></div><button class="btn" id="xd">Fechar</button></div>
   <div class="dl">${osRows(o).slice(0).map(([a,b])=>`<div>${a}</div><div>${esc(b)}</div>`).join("")}</div>
   <button class="btn pri" id="pd">Imprimir esta O.S.</button>`;
  $("drawer").classList.add("on"); $("xd").onclick=closeDet; $("pd").onclick=()=>printOS([o]);
}
function closeDet(){$("drawer").classList.remove("on")}
$("drawer").onclick=e=>{if(e.target.id==="drawer")closeDet()};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDet()});

// ---------- impressão ----------
const stamp=()=>new Date().toLocaleString("pt-BR");
const ph=(t)=>`<div class="ph"><div style="display:flex;align-items:center;gap:12px"><img src="${LOGO}" style="height:40px"><div style="border-left:1px solid #ccc;padding-left:12px"><b>GMAP</b><div style="font-size:11px">Gerência de Material e Patrimônio</div></div></div><div style="text-align:right;font-size:11px">${t}<br>Emitido em ${stamp()}</div></div>`;
function doPrint(html){$("print").innerHTML=html; setTimeout(()=>window.print(),50)}
function printOS(list){
  doPrint(list.map(o=>`<div class="pg os">${ph("Ordem de Serviço de Climatização")}<h2>O.S. nº ${esc(o.os)}</h2>
   <table>${osRows(o).map(([a,b])=>`<tr><td class="k">${a}</td><td>${esc(b)}</td></tr>`).join("")}</table>
   <div class="sig"><div>Responsável técnico da empresa</div><div>Responsável pela unidade escolar</div></div>
   <div class="foot">Documento gerado pelo Painel de O.S. de Climatização. Situação em ${fmt(REF)}.</div></div>`).join(""));
}
$("bPrintSel").onclick=()=>printOS([...sel].map(find).filter(Boolean));

// ---------- relatórios ----------
function synth(L){
  const grp=(key,vals,name)=>vals.map(v=>{const LL=L.filter(o=>o[key]===v),s=stats(LL);return [name(v),s.total,s.open,s.venc,s.av,s.atend,s.atBase?+(s.atNo/s.atBase*100).toFixed(1):null]}).filter(r=>r[1]);
  const H=["", "Total", "Em aberto", "Vencidas", "A vencer", "Atendidas", "% atendidas no prazo"];
  const s=stats(L);
  return {H, emp:grp("emp",EMPS,v=>EMPN[v]), prio:grp("prio",PRIOS,v=>v), gre:grp("gre",uniq("gre"),v=>v),
    tot:["Total",s.total,s.open,s.venc,s.av,s.atend,s.atBase?+(s.atNo/s.atBase*100).toFixed(1):null]};
}
const ANH=["Nº O.S.","Empresa","Status","Prioridade","Criada em","Prazo","Atendida em","Situação do prazo","Dias de atraso","Escola","INEP","GRE","Município","Serviço","Splits","Processo SEI"];
const anRow=o=>[o.os,EMPN[o.emp]||o.emp,o.status,o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.sp,(o.atraso>0?o.atraso:""),o.escola,o.inep,o.gre,o.mun,o.serv.map(s=>SERVN[s]||s).join(", "),o.splits??"",o.sei];
function xlsx(name,sheets){const wb=XLSX.utils.book_new();sheets.forEach(([n,aoa])=>{const ws=XLSX.utils.aoa_to_sheet(aoa);ws["!cols"]=aoa[Math.min(4,aoa.length-1)].map((_,i)=>({wch:Math.min(48,Math.max(10,...aoa.map(r=>String(r[i]??"").length+2)))}));XLSX.utils.book_append_sheet(wb,ws,n)});XLSX.writeFile(wb,name)}
function exp(x){
  const L=filaList(), head=[["Painel de O.S. de Climatização · GMAP | SEDUC-PI"],[filterText()],["Situação em "+fmt(REF)+" · emitido em "+stamp()],[]];
  if(x==="sx"){const S=synth(L); const blk=(t,rows,first)=>[[t],[first].concat(S.H.slice(1))].concat(rows).concat([[]]);
    xlsx("OS_relatorio_sintetico.xlsx",[["Sintético",head.concat(blk("Por empresa",S.emp.concat([S.tot]),"Empresa"),blk("Por prioridade",S.prio.concat([S.tot]),"Prioridade"),blk("Por GRE",S.gre.concat([S.tot]),"GRE"))]]);}
  if(x==="ax") xlsx("OS_relatorio_analitico.xlsx",[["Analítico",head.concat([ANH],L.map(anRow))]]);
  const T=(H,R)=>`<table><thead><tr>${H.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${R.map(r=>`<tr>${r.map((c,i)=>`<td ${i&&typeof c==="number"?'style="text-align:right"':""}>${esc(typeof c==="number"&&i===6?c.toLocaleString("pt-BR")+"%":c??"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  if(x==="sp"){const S=synth(L); doPrint(`<div class="rp">${ph("Relatório sintético")}<h2>Relatório sintético de O.S.</h2><div class="foot">${esc(filterText())} · Situação em ${fmt(REF)}</div>
    <h3>Por empresa</h3>${T(["Empresa"].concat(S.H.slice(1)),S.emp.concat([S.tot]))}<h3>Por prioridade</h3>${T(["Prioridade"].concat(S.H.slice(1)),S.prio.concat([S.tot]))}<h3>Por GRE</h3>${T(["GRE"].concat(S.H.slice(1)),S.gre.concat([S.tot]))}</div>`);}
  if(x==="ap"){const H2=["Nº O.S.","Empresa","Status","Prior.","Criada","Prazo","Atendida","Situação do prazo","Escola","Município"];
    doPrint(`<div class="rp">${ph("Relatório analítico")}<h2>Relatório analítico de O.S. (${nf(L.length)})</h2><div class="foot">${esc(filterText())} · Situação em ${fmt(REF)}</div>${T(H2,L.map(o=>[o.os,EMPN[o.emp]||o.emp,o.status,o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.sp,tc(o.escola),tc(o.mun||"")]))}</div>`);}
  $("mExp").classList.remove("on");
}
$("bExp").onclick=e=>{e.stopPropagation();$("mExp").classList.toggle("on")};
document.addEventListener("click",()=>$("mExp").classList.remove("on"));
$("mExp").querySelectorAll("button[data-x]").forEach(b=>b.onclick=()=>exp(b.dataset.x));

// ---------- navegação ----------
function setView(v){view=v; document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.v===v)); ["geral","fila","aud","usr"].forEach(x=>$("v-"+x).hidden=v!==x); $("filters").hidden=v==="usr"; page=0; render()}
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>setView(t.dataset.v));
function render(){ if(view==="geral") renderGeral(filtered()); else if(view==="aud") renderAud(filtered()); else if(view==="usr") renderUsuarios(CTX); else renderFila(); }
document.querySelector('.tab[data-v="aud"]').hidden = perfil!=="gmap";
document.querySelector('.tab[data-v="usr"]').hidden = perfil!=="gmap";
if(perfil==="gmap") contarPendentes(CTX);
buildFilters(); render();

}
