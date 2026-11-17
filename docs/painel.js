/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Lógica do painel. Recebe os dados já filtrados pelo banco (RLS) e o perfil do usuário. */
function iniciarPainel(CTX){
const LOGO = CTX.logo;
const REF = CTX.ref;               // hoje (fuso de Brasília)
const AVENCER = 3;                // dias para "a vencer"
const OPEN = ["Emitida","Stand by"];                 // em aberto (o prazo continua correndo no stand by)
const PRE = ["Aguardando aprovação","Devolvida","Recusada"]; // solicitações ainda sem número: fora dos indicadores
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
// Nomes em "Primeira Maiúscula", mantendo siglas e tipologias em maiúsculas (CETI, CEJA, U E, GRE, II...)
const SIGLAS = new Set(("CETI CEJA EJA CEEP CEMTI CEM CAIC CEI CMEI EEF UE GRE GRES UAB UAPI SEDUC SEAD SEDUC-PI INEP PI GMAP GEC UFIN UTD SUPEN CEPI UGP FUNART "+
  "IFPI UESPI UFPI APAE CRAS CAPS UBS SESC SENAI SENAC EMEF EMEI ETI EPT AEE CETE CEFTI CEAJA NTE SUGESP SUPLAN").split(" "));
const MINUSC = new Set(["de","da","do","dos","das","e","di","du","del"]);
const ROMANO = /^(XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
function tcPal(t, i) {
  if (!t || /^[\/(),.'-]+$/.test(t)) return t;
  const U = t.toUpperCase(), base = U.replace(/\./g, "");
  if (SIGLAS.has(base)) return U;
  if (/^([A-ZÀ-Ý]\.){2,}$/.test(U)) return U;                       // R.E.
  if (base.length >= 2 && base.length <= 6 && ROMANO.test(base)) return U;  // II, IV, XII
  const l = t.toLowerCase(); if (i > 0 && MINUSC.has(l)) return l;
  return l.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toUpperCase()).replace(/^(d')(\p{L})/iu, (m, a, b) => "D'" + b.toUpperCase());
}
const tc = s => { const w = String(s ?? "").trim().split(/\s+/); if (!w[0]) return "";
  const ue = /^U\.?$/i.test(w[0]) && /^E\.?$/i.test(w[1] || "");            // "U E" = Unidade Escolar
  return w.map((p, i) => ue && i < 2 ? p.toUpperCase() : p.split(/([\/(),-])/).map(t => tcPal(t, i)).join("")).join(" "); };

let ALL=[], SOLIC=[], byInep={}, osCount={}, EMPS=[];
function preparar(rows){
 const todos = rows.map(r => { const o=Object.assign({},r);
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
 ALL = todos.filter(o=>!PRE.includes(o.status));
 SOLIC = todos.filter(o=>PRE.includes(o.status));
 byInep={}; ALL.forEach(o=>{ if(o.inep){ (byInep[o.inep]=byInep[o.inep]||[]).push(o) } });
 osCount={}; ALL.forEach(o=>osCount[o.os]=(osCount[o.os]||0)+1);
 EMPS = [...new Set(ALL.map(o=>o.emp).concat((CTX.empresasCad||[]).map(e=>e.nome)))].sort((a,b)=>ALL.filter(o=>o.emp===b).length-ALL.filter(o=>o.emp===a).length);
 EMPS.forEach(e=>{ if(!EMPN[e]) EMPN[e]=tc(e) });
}
preparar(CTX.rows);
const DENTRO = ["Atendida no prazo","Atendida antes da O.S."];
const SPB = {"Vencida":"b-bad","A vencer":"b-warn","No prazo":"b-info","Atendida no prazo":"b-ok","Atendida fora do prazo":"b-bad","Cancelada":"b-gray","Sem prazo":"b-gray","Sem data":"b-gray","Atendida antes da O.S.":"b-ok"};
const STB = {"Atendida":"b-ok","Emitida":"b-info","Stand by":"b-warn","Cancelada":"b-gray","Aguardando aprovação":"b-warn","Devolvida":"b-bad","Recusada":"b-gray"};
const PRB = {"Urgente":"b-bad","Alta":"b-warn","Normal":"b-gray"};

// ---------- perfis (simulação do login) ----------
const PERFIS = [{id:"gmap",n:"GMAP (gerência)"},{id:"tec",n:"Técnico GMAP"},{id:"dir",n:"Consultivo"}].concat(EMPS.map(e=>({id:"emp:"+e,n:"Empresa: "+EMPN[e]})));
const $ = id => document.getElementById(id);
let perfil=CTX.perfil, view="geral", page=0, sel=new Set();
$("lateBy").onchange=()=>render();
if(perfil.startsWith("emp:") && !EMPN[perfil.slice(4)]) EMPN[perfil.slice(4)]=tc(perfil.slice(4));
const PS=50;
const base = () => perfil.startsWith("emp:") ? ALL.filter(o=>o.emp===perfil.slice(4)) : ALL;

// ---------- filtros ----------
const FD = [
  {k:"emp",n:"Empresa",opts:()=>EMPS.map(e=>[e,EMPN[e]]),hideEmp:true},
  {k:"gre",n:"GRE",opts:()=>uniq("gre").map(g=>[g,g==="SEDE"?"Sede":g.replace(/^0?(\d+)ª - (.*)$/,(m,a,b)=>a+"ª "+tc(b))])},
  {k:"mun",n:"Município",opts:()=>uniq("mun").map(m=>[m,tc(m)])},
  {k:"status",n:"Status",opts:()=>["Emitida","Stand by","Atendida","Cancelada"].map(s=>[s,s])},
  {k:"prio",n:"Prioridade",opts:()=>PRIOS.map(p=>[p,p])},
  {k:"serv",n:"Tipo de serviço",opts:()=>SERV.map(s=>[s,SERVN[s]])},
];
// no celular, rótulos longos dos gráficos viram duas ou três linhas em vez de serem cortados
function quebrarRotulo(t){ t=String(t||""); if(innerWidth>700||t.length<=16) return t; const L=[]; let l="";
  for(const p of t.split(" ")){ if((l+" "+p).trim().length>16&&l){L.push(l);l=p}else l=(l+" "+p).trim(); } if(l)L.push(l); return L.slice(0,3); }
function uniq(k){return [...new Set(base().map(o=>o[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true}))}
let FV={};
// celular: filtros recolhidos atrás do botão "Filtros (n)"
function contarFiltros(){ const n=Object.keys(FV).filter(k=>FV[k]&&k!=="escolaNome").length; $("fTogN").textContent=n?` (${n})`:""; $("fTog").classList.toggle("ativo",n>0); }
$("fTog").onclick=()=>{ const ab=$("filters").classList.toggle("aberto"); $("fTog").setAttribute("aria-expanded",String(ab)); };
function buildFilters(){
  const isEmp=perfil.startsWith("emp:");
  $("filters").innerHTML = FD.filter(f=>!(f.hideEmp&&isEmp)).map(f=>`<div><label>${f.n}</label><select data-k="${f.k}"><option value="">Todos</option>${f.opts().map(([v,t])=>`<option value="${esc(v)}" ${FV[f.k]===v?"selected":""}>${esc(t)}</option>`).join("")}</select></div>`).join("")
   + `<div><label>Criadas de</label><input type="date" data-k="de" value="${FV.de||""}"></div><div><label>até</label><input type="date" data-k="ate" value="${FV.ate||""}"></div>`
   + `<div><label>Atendidas de</label><input type="date" data-k="atDe" value="${FV.atDe||""}"></div><div><label>até</label><input type="date" data-k="atAte" value="${FV.atAte||""}"></div>`
   + `<div class="fbar">${FV.escola?`<span class="chip">Escola: ${esc(FV.escolaNome||FV.escola)} <button id="xEsc" title="Remover filtro de escola">×</button></span>`:""}${FV.semComp?`<span class="chip">Sem a O.S. assinada <button id="xComp" title="Remover este filtro">×</button></span>`:""}<button class="btn" id="clr">Limpar filtros</button></div>`;
  $("filters").querySelectorAll("select,input").forEach(el=>el.onchange=()=>{FV[el.dataset.k]=el.value;page=0;contarFiltros();render()});
  contarFiltros();
  $("clr").onclick=()=>{FV={};buildFilters();page=0;render()};
  if($("xEsc")) $("xEsc").onclick=()=>{delete FV.escola;delete FV.escolaNome;buildFilters();page=0;render()};
  if($("xComp")) $("xComp").onclick=()=>{delete FV.semComp;buildFilters();page=0;render()};
}
function filtered(){
  return base().filter(o=>{
    for(const k of ["emp","gre","mun","status","prio"]) if(FV[k] && o[k]!==FV[k]) return false;
    if(FV.serv && !o.serv.includes(FV.serv)) return false;
    if(FV.escola && (o.inep||o.escola)!==FV.escola) return false;
    if(FV.de && (!o.criada || o.criada<FV.de)) return false;
    if(FV.ate && (!o.criada || o.criada>FV.ate)) return false;
    if(FV.atDe && (!o.atend || o.atend<FV.atDe)) return false;
    if(FV.atAte && (!o.atend || o.atend>FV.atAte)) return false;
    if(FV.semComp && !(o.comprovante_pendente && o.status==="Atendida")) return false;
    return true;
  });
}
function filterText(){
  const p=[]; FD.forEach(f=>{if(FV[f.k]){const o=f.opts().find(x=>x[0]===FV[f.k]);p.push(f.n+": "+(o?o[1]:FV[f.k]))}});
  if(FV.escola)p.push("Escola: "+(FV.escolaNome||FV.escola));
  if(FV.semComp)p.push("Sem a O.S. assinada");
  if(FV.de)p.push("Criadas de "+fmt(FV.de)); if(FV.ate)p.push("Criadas até "+fmt(FV.ate));
  if(FV.atDe)p.push("Atendidas de "+fmt(FV.atDe)); if(FV.atAte)p.push("Atendidas até "+fmt(FV.atAte));
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
  L=L.filter(o=>!o.revisao);   // O.S. em revisão pela GMAP saem temporariamente das contagens
  EMI.faixaHoje(L);
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

  // maiores atrasos: por O.S. ou agrupado por escola, GRE ou município
  const lateBy=$("lateBy").value, venc=open.filter(o=>o.sp==="Vencida");
  $("lateD").textContent = lateBy==="os" ? "O.S. vencidas com mais dias de atraso" : "Onde há mais O.S. vencidas. Clique para abrir a fila filtrada.";
  if(!venc.length){ $("late").innerHTML=`<div class="empty">Nenhuma O.S. vencida no filtro.</div>`; }
  else if(lateBy==="os"){
    const late=venc.sort((a,b)=>b.atraso-a.atraso).slice(0,6);
    $("late").innerHTML = `<table><thead><tr><th>Nº O.S.</th><th>Escola</th>${isEmp?"":"<th>Empresa</th>"}<th>Prioridade</th><th class="n">Dias de atraso</th></tr></thead><tbody>${
    late.map(o=>`<tr class="r" data-os="${o.id}"><td><b>${esc(o.os)}</b></td><td><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||""))}</div></td>${isEmp?"":`<td>${EMPN[o.emp]}</td>`}<td><span class="badge ${PRB[o.prio]||"b-gray"}">${esc(o.prio||"n/d")}</span></td><td class="n"><b style="color:var(--bad)">${nf(o.atraso)}</b></td></tr>`).join("")}</tbody></table>`;
    $("late").querySelectorAll("tr.r").forEach(tr=>tr.onclick=()=>openDet(tr.dataset.os,[...$("late").querySelectorAll("tr.r")].map(x=>x.dataset.os)));
  } else {
    const chave = o => lateBy==="escola" ? (o.inep||o.escola) : lateBy==="gre" ? (o.gre||"Não informada") : (o.mun||"Não informado");
    const G={}; venc.forEach(o=>{ const k=chave(o); (G[k]=G[k]||{k,itens:[],o}).itens.push(o); });
    const rows=Object.values(G).map(g=>({k:g.k,o:g.o,n:g.itens.length,max:Math.max(...g.itens.map(x=>x.atraso)),med:Math.round(g.itens.reduce((a,x)=>a+x.atraso,0)/g.itens.length)}))
      .sort((a,b)=>b.n-a.n||b.max-a.max).slice(0,6);
    const titulo={escola:"Escola",gre:"GRE",mun:"Município"}[lateBy];
    const nome=r=> lateBy==="escola" ? `<div class="esc">${esc(tc(r.o.escola))}</div><div class="mun">${esc(tc(r.o.mun||""))}${r.o.inep?" · INEP "+esc(r.o.inep):""}</div>`
      : lateBy==="gre" ? `<div class="esc">${esc(String(r.k).replace(/^0?(\d+)ª - (.*)$/,(m,a,b)=>a+"ª "+tc(b)))}</div>` : `<div class="esc">${esc(tc(r.k))}</div>`;
    $("late").innerHTML=`<table><thead><tr><th>${titulo}</th><th class="n">O.S. vencidas</th><th class="n">Maior atraso</th><th class="n">Atraso médio</th></tr></thead><tbody>${
      rows.map((r,i)=>`<tr class="r" data-i="${i}"><td>${nome(r)}</td><td class="n"><b>${nf(r.n)}</b></td><td class="n"><b style="color:var(--bad)">${nf(r.max)} d</b></td><td class="n">${nf(r.med)} d</td></tr>`).join("")}</tbody></table>`;
    $("late").querySelectorAll("tr.r").forEach(tr=>tr.onclick=()=>{ const r=rows[+tr.dataset.i];
      if(lateBy==="escola"){ FV.escola=r.o.inep||r.o.escola; FV.escolaNome=tc(r.o.escola); } else if(lateBy==="gre"){ FV.gre=r.k==="Não informada"?"":r.k; } else { FV.mun=r.k==="Não informado"?"":r.k; }
      buildFilters(); $("fprazo").value="Vencida"; setView("fila"); });
  }
}

// ---------- auditoria dos dados (somente GMAP) ----------
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
  {id:"just",c:"r",t:"Vencida sem justificativa",x:"Em aberto, vencida, sem justificativa da empresa nem motivo de stand by",
   f:o=>o.sp==="Vencida"&&!o.just&&!o.standby_motivo?`Vencida há ${o.atraso} dias sem justificativa`:null},
  {id:"semat",c:"y",t:"Atendida sem data de atendimento",x:"Status Atendida, mas a data não foi preenchida",
   f:o=>o.status==="Atendida"&&!o.atend?"Data do atendimento em branco":null},
  {id:"inc",c:"y",t:"Cadastro incompleto",x:"Falta data de criação, prazo, prioridade, município ou INEP (canceladas não entram)",
   f:o=>{if(o.status==="Cancelada")return null;const m=[];if(!o.criada)m.push("data de criação");if(!o.prazo)m.push("prazo");if(!o.prio)m.push("prioridade");if(!o.mun)m.push("município");if(!o.inep)m.push("INEP");return m.length?"Sem "+m.join(", "):null}},
  {id:"rep",c:"y",t:"Número de O.S. repetido",x:"O mesmo número em mais de um registro. A O.S. cancelada não entra na lista, mas a ativa com o mesmo número continua aparecendo",
   f:o=>o.status!=="Cancelada"&&osCount[o.os]>1?"Também usado em: "+ALL.filter(a=>a.os===o.os&&a!==o).map(a=>`${EMPN[a.emp]||a.emp} (${a.status})`).join(", "):null},
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
    options:{indexAxis:"y",maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:"#EEF0F3"},ticks:{precision:0}},y:{grid:{display:false},ticks:{callback(v){return quebrarRotulo(this.getLabelForValue(v))}}}}}});
  const ce=EMPS.map(e=>{const LL=L.filter(o=>o.emp===e),cc=LL.filter(o=>o.status==="Cancelada");const m={};cc.forEach(o=>{const k=o.motivo||"Não informado";m[k]=(m[k]||0)+1});const top=Object.entries(m).sort((a,b)=>b[1]-a[1])[0];return [e,LL.length,cc.length,top]}).filter(r=>r[1]);
  $("canemp").innerHTML=`<table><thead><tr><th>Empresa</th><th class="n">Canceladas</th><th class="n">% das emitidas</th><th>Motivo mais frequente</th></tr></thead><tbody>${ce.map(([e,n,c,t])=>`<tr><td>${EMPN[e]}</td><td class="n"><b>${nf(c)}</b></td><td class="n">${pct(c,n)}</td><td>${t?esc(t[0])+` (${t[1]})`:"n/d"}</td></tr>`).join("")}</tbody></table>`;
  // lista
  const c=CHECKS.find(x=>x.id===audSel), rows=res[audSel].slice().sort((a,b)=>(a[0].criada||"").localeCompare(b[0].criada||""));
  $("audlist").innerHTML=`<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap"><div><h3>${c.t} (${nf(rows.length)})</h3><div class="d">${c.x}. Clique na O.S. para ver o detalhe.</div></div><button class="btn" id="audx" ${rows.length?"":"disabled"}>Exportar lista (.xlsx)</button></div>
   <div class="tbl" style="max-height:60vh">${rows.length?`<table><thead><tr><th>Nº O.S.</th><th>Empresa</th><th>Escola</th><th>Status</th><th>Criada</th><th>Evidência</th></tr></thead><tbody>${rows.map(([o,ev])=>`<tr class="r" data-os="${o.id}"><td><b>${esc(o.os)}</b></td><td>${EMPN[o.emp]||esc(o.emp)}</td><td><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||"Município não informado"))}</div></td><td><span class="badge ${STB[o.status]}">${esc(o.status)}</span></td><td>${fmt(o.criada)||"n/d"}</td><td class="ev">${esc(ev)}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Nenhuma ocorrência no filtro atual.</div>`}</div>`;
  $("audlist").querySelectorAll("tr.r").forEach(tr=>tr.onclick=()=>openDet(tr.dataset.os,[...$("audlist").querySelectorAll("tr.r")].map(x=>x.dataset.os)));
  EMI.audEntidades(L);
  const bx=$("audx"); if(bx) bx.onclick=()=>xlsx("Auditoria_"+audSel+".xlsx",[["Auditoria",[["Auditoria dos dados · "+c.t],[filterText()],["Situação em "+fmt(REF)+" · emitido em "+stamp()],[],["Nº O.S.","Empresa","Status","Prioridade","Criada em","Prazo","Atendida em","Escola","INEP","Município","Serviço","Splits","Evidência"]].concat(rows.map(([o,ev])=>[o.os,EMPN[o.emp]||o.emp,o.status,o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.escola,o.inep,o.mun,svTxt(o),o.splits??"",ev]))]]);
}

// ---------- fila ----------
function filaList(){
  if(soSel) return [...sel].map(find).filter(Boolean).sort(ordUsuario);
  const q=$("q").value.trim().toLowerCase(), sp=$("fprazo").value;
  return filtered().filter(o=>(!sp||o.sp===sp)&&(!q||[o.os,o.escola,o.inep,o.sei,o.mun].join(" ").toLowerCase().includes(q))).sort(ordUsuario);
}
// Ordenação escolhida pelo usuário (clique no título da coluna, ou "Ordenar" no celular).
// Sem escolha, vale a ordem padrão: em aberto primeiro, das mais atrasadas para as menos.
let ORD=null;   // {c: coluna, d: 1 crescente | -1 decrescente}
const PRIO_N={Urgente:0,Alta:1,Normal:2};
const ORD_COL={
  num:{n:"Nº O.S.",f:o=>{const m=String(o.os||"").match(/(\d+)\D+(\d{4})/);return m?(+m[2])*1e6+(+m[1]):null},a:"menor → maior",z:"maior → menor"},
  emp:{n:"Empresa",f:o=>EMPN[o.emp]||o.emp||null,a:"A → Z",z:"Z → A"},
  esc:{n:"Escola",f:o=>o.escola?tc(o.escola):null,a:"A → Z",z:"Z → A"},
  prio:{n:"Prioridade",f:o=>o.prio in PRIO_N?PRIO_N[o.prio]:null,a:"Urgente primeiro",z:"Normal primeiro"},
  cri:{n:"Criada",f:o=>o.criada||null,a:"mais antigas primeiro",z:"mais novas primeiro"},
  prz:{n:"Prazo",f:o=>o.prazo||null,a:"mais próximo primeiro",z:"mais distante primeiro"},
  sp:{n:"Situação do prazo",f:o=>o.atraso??null,a:"menos atrasadas primeiro",z:"mais atrasadas primeiro"},
  st:{n:"Status",f:o=>o.status||null,a:"A → Z",z:"Z → A"}
};
function ordUsuario(a,b){
  if(!ORD) return ordFila(a,b);
  const f=ORD_COL[ORD.c].f, x=f(a), y=f(b);
  if(x==null||y==null) return x==null&&y==null?ordFila(a,b):x==null?1:-1;   // sem valor vai sempre para o fim
  const r=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"pt-BR",{numeric:true,sensitivity:"base"});
  return r?r*ORD.d:ordFila(a,b);
}
function marcarOrdem(){
  document.querySelectorAll("#tb th[data-ord]").forEach(th=>{ const on=ORD&&ORD.c===th.dataset.ord;
    th.setAttribute("aria-sort",on?(ORD.d>0?"ascending":"descending"):"none");
    th.querySelector(".ordi").textContent=on?(ORD.d>0?"▲":"▼"):"↕"; th.classList.toggle("ordon",!!on); });
  $("ford").value=ORD?ORD.c+":"+ORD.d:"";
}
function ligarOrdem(){
  document.querySelectorAll("#tb th[data-ord]").forEach(th=>{
    const t=th.textContent; th.innerHTML=`<button type="button" class="thord" title="Ordenar por ${esc(t)}">${esc(t)} <span class="ordi" aria-hidden="true">↕</span></button>`;
    th.querySelector("button").onclick=()=>{ const c=th.dataset.ord;
      ORD = !ORD||ORD.c!==c ? {c,d:c==="sp"?-1:1} : ORD.d===(c==="sp"?-1:1) ? {c,d:-ORD.d} : null;   // 1º clique, 2º inverte, 3º volta ao padrão
      page=0; marcarOrdem(); renderFila(); };
  });
  $("ford").innerHTML=`<option value="">Ordem padrão (mais atrasadas)</option>`+Object.entries(ORD_COL).map(([c,o])=>
    `<option value="${c}:1">${o.n}: ${o.a}</option><option value="${c}:-1">${o.n}: ${o.z}</option>`).join("");
  $("ford").onchange=()=>{ const v=$("ford").value; ORD=v?{c:v.split(":")[0],d:+v.split(":")[1]}:null; page=0; marcarOrdem(); renderFila(); };
  marcarOrdem();
}
function ordFila(a,b){const ra=OPEN.includes(a.status)?0:1, rb=OPEN.includes(b.status)?0:1; if(ra!==rb) return ra-rb; return (b.atraso??-1e9)-(a.atraso??-1e9)}
// Seleção: fica guardada independente da pesquisa e dos filtros; a barra mostra quantas há e quantas estão fora da lista atual
let soSel=false;
function renderSelBar(L){
  if(!sel.size && soSel) soSel=false;
  const bar=$("selbar"); bar.hidden=!sel.size; $("v-fila").classList.toggle("comsel",sel.size>0);
  if(!sel.size) return;
  const visiveis=new Set(L.map(o=>String(o.id))), fora=soSel?0:[...sel].filter(k=>!visiveis.has(k)).length;
  $("selN").textContent=`${nf(sel.size)} selecionada${sel.size>1?"s":""}`;
  $("selFora").hidden=!fora; $("selFora").textContent=`${nf(fora)} fora desta lista`;
  $("selVer").textContent=soSel?"Voltar à lista":"Ver só as selecionadas";
  $("q").disabled=soSel; $("fprazo").disabled=soSel;
  $("selAviso").hidden=!soSel;
}
function renderFila(){
  if(!sel.size) soSel=false;
  if(!soSel){ $("q").disabled=false; $("fprazo").disabled=false; }
  const L=filaList(), n=L.length, pages=Math.max(1,Math.ceil(n/PS)); if(page>=pages) page=pages-1;
  const P=L.slice(page*PS,page*PS+PS);
  $("cnt").textContent=`${nf(n)} O.S.`;
  $("bPrintSel").disabled=!sel.size;
  const id=o=>String(o.id);
  $("tb").tBodies[0].innerHTML = P.length ? P.map(o=>{
    const pz = o.sp==="Vencida" ? `<span class="badge b-bad">Vencida há ${nf(o.atraso)} d</span>` : o.sp==="A vencer" ? `<span class="badge b-warn">Vence em ${nf(-o.atraso)} d</span>` : `<span class="badge ${SPB[o.sp]}">${o.sp}</span>`;
    return `<tr class="r${sel.has(id(o))?" marc":""}" data-os="${esc(id(o))}"><td class="c-ck"><input type="checkbox" class="ck" aria-label="Selecionar O.S. ${esc(o.os)}" ${sel.has(id(o))?"checked":""}></td><td class="c-num"><b>${esc(o.os)}</b></td><td class="c-emp">${EMPN[o.emp]||esc(o.emp)}</td>
    <td class="c-esc"><div class="esc">${esc(tc(o.escola))}</div><div class="mun">${esc(tc(o.mun||"Município não informado"))}</div></td>
    <td class="c-prio"><span class="badge ${PRB[o.prio]||"b-gray"}">${esc(o.prio||"n/d")}</span></td><td class="c-cri">${fmt(o.criada)}</td><td class="c-prz">${fmt(o.prazo)}</td><td class="c-sp">${pz}</td><td class="c-st"><span class="badge ${STB[o.status]}">${esc(o.status)}</span>${o.revisao?`<div><span class="badge b-rev">Em revisão</span></div>`:""}</td></tr>`}).join("")
    : `<tr><td colspan="9" class="empty">Nenhuma O.S. encontrada.</td></tr>`;
  $("tb").tBodies[0].querySelectorAll("tr.r").forEach(tr=>{
    const ck=tr.querySelector(".ck");
    ck.onclick=e=>{e.stopPropagation(); ck.checked?sel.add(tr.dataset.os):sel.delete(tr.dataset.os); renderFila()};
    ck.parentElement.onclick=e=>e.stopPropagation();
    tr.onclick=()=>openDet(tr.dataset.os,filaList().map(id));
  });
  $("all").checked = P.length>0 && P.every(o=>sel.has(id(o)));
  $("all").title=`Marcar as ${P.length} O.S. desta página`;
  $("all").onclick=()=>{P.forEach(o=>$("all").checked?sel.add(id(o)):sel.delete(id(o)));renderFila()};
  $("pinfo").textContent=`Página ${page+1} de ${pages}`; $("prev").disabled=page===0; $("next").disabled=page>=pages-1;
  renderSelBar(L);
}
$("selVer").onclick=()=>{soSel=!soSel; page=0; renderFila()};
$("selFora").onclick=()=>{soSel=true; page=0; renderFila()};
$("selLimpar").onclick=()=>{sel.clear(); soSel=false; renderFila()};
$("prev").onclick=()=>{page--;renderFila()}; $("next").onclick=()=>{page++;renderFila()};
$("q").oninput=()=>{page=0;renderFila()}; $("fprazo").onchange=()=>{page=0;renderFila()};
ligarOrdem();

// ---------- detalhe ----------
const find = k => ALL.find(o=>String(o.id)===String(k)) || SOLIC.find(o=>String(o.id)===String(k));
const ORIG={redmine:"Redmine",sei:"Processo SEI",gerencia:"Determinação da gerência"};
function osRows(o){return [["Empresa",EMPN[o.emp]||o.emp],["Status",o.status],["Prioridade",o.prio||"n/d"],["Emitida em",fmt(o.criada)],["Prazo",fmt(o.prazo)],["Atendida em",fmt(o.atend)||"n/d"],
  ["Situação do prazo",PRE.includes(o.status)?"Ainda não emitida":o.sp],["Escola / entidade",o.escola],["INEP",o.inep],["GRE",o.gre],["Município",tc(o.mun||"")],["Zona",o.zona],["Endereço",o.end],
  ["Origem da demanda",o.origem?ORIG[o.origem]+(o.origem_num?" nº "+o.origem_num:""):""],["Processo SEI",o.sei],["Serviço",o.serv.map(s=>SERVN[s]||s).join(", ")],
  ["Qtd. de splits",o.splits??""],["Motivo da O.S.",(o.motivos||[]).join("; ")],["Ambientes",(o.ambientes||[]).map(a=>`${a.ambiente}: ${a.splits} split${a.splits===1?"":"s"}`).join(" · ")],
  ["Responsável pela entidade",o.resp_nome?o.resp_nome+" · "+(o.resp_contato||""):""],["Descrição / observações",o.obs],
  ...(o.respostas||[]).map(r=>[r.rotulo,Array.isArray(r.valor)?r.valor.join(", "):r.tipo==="data"?fmt(r.valor):r.valor]),["Empresa fora da área sugerida",o.fora_area?("Sim. Justificativa: "+(o.fora_just||"")):""],
  ["Motivo do stand by",o.status==="Stand by"?o.standby_motivo+(o.standby_por?" ("+(o.standby_por==="empresa"?"empresa":"GMAP")+")":""):""],
  ["Justificativa da empresa",o.just],["Pendências ou problemas encontrados",o.pend],["O.S. assinada (PDF)",o.pdf||(o.comprovante_pendente&&o.status==="Atendida"?"Falta anexar (atendida pela planilha)":"")],["Motivo do cancelamento",o.motivo],
  ["Lançada na planilha como",o.chave_planilha?(o.numero_planilha||"")+(o.numero_planilha!==o.numero?" (número novo no sistema)":""):""],
  ["Solicitada por",o.solicitado_nome?o.solicitado_nome+" em "+dh(o.solicitado_em):""],["Aprovada por",o.aprovado_nome?o.aprovado_nome+" em "+dh(o.aprovado_em):""],
  ["Atendimento registrado por",o.atendido_nome||""]].filter(r=>r[1]!==""&&r[1]!=null)}
const dh=s=>s?new Date(s).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
// Navegação no detalhe: a lista de onde a O.S. foi aberta (fila filtrada e ordenada, fiscalização, aprovações...)
let NAV=null, DET_ATUAL=null;
function openDet(k,lista){const o=find(k); if(!o) return; DET_ATUAL=String(o.id);
  if(lista) NAV=lista.map(String); else if(!NAV||!NAV.includes(String(o.id))) NAV=null;
  const pos=NAV?NAV.indexOf(String(o.id)):-1, nav=NAV&&NAV.length>1&&pos>=0;
  $("det").innerHTML=`<div class="dhead"><div><div class="mun">Ordem de serviço</div><h2>${esc(o.os)}</h2>
   <span class="badge ${STB[o.status]}">${esc(o.status)}</span> ${PRE.includes(o.status)?"":`<span class="badge ${SPB[o.sp]}">${esc(o.sp)}</span>`}</div>
   <div class="dnav">${nav?`<button class="ib" id="dAnt" ${pos>0?"":"disabled"} data-tip="O.S. anterior (seta ←)" aria-label="O.S. anterior">${UI.icone("anterior")}</button>
     <span class="dpos" aria-live="polite">${nf(pos+1)} de ${nf(NAV.length)}</span>
     <button class="ib" id="dProx" ${pos<NAV.length-1?"":"disabled"} data-tip="Próxima O.S. (seta →)" aria-label="Próxima O.S.">${UI.icone("proxima")}</button>`:""}
     <button class="btn" id="xd">Fechar</button></div></div>
   ${EMI.faixaDetalhe(o)}
   <div class="dl">${osRows(o).slice(0).map(([a,b])=>`<div>${a}</div><div>${esc(b)}</div>`).join("")}</div>
   <div class="dacoes" id="dAcoes">${EMI.botoesDetalhe(o)}${PRE.includes(o.status)?"":UI.botaoIcone("imprimir","Imprimir esta O.S.").replace('data-acao="imprimir"','id="pd"')}</div>
   <h3 class="hist-t">Histórico</h3><div id="dHist" class="hist"><div class="mun">Carregando…</div></div>`;
  $("drawer").classList.add("on"); $("det").scrollTop=0; $("xd").onclick=closeDet; if($("pd")) $("pd").onclick=()=>printOS([o]);
  if(nav){ $("dAnt").onclick=()=>irDet(-1); $("dProx").onclick=()=>irDet(1); }
  EMI.ligarDetalhe(o); EMI.historico(o);
}
function closeDet(){$("drawer").classList.remove("on")}
function irDet(d){ if(!NAV||!$("drawer").classList.contains("on")) return; const atual=NAV.indexOf(DET_ATUAL);
  const n=atual+d; if(atual<0||n<0||n>=NAV.length) return; openDet(NAV[n]); const b=$(d<0?"dAnt":"dProx"); if(b&&!b.disabled) b.focus(); }
// setas do teclado trocam de O.S. quando o detalhe está aberto (fora de campos e de diálogos)
document.addEventListener("keydown",e=>{ if(!["ArrowLeft","ArrowRight"].includes(e.key)||!$("drawer").classList.contains("on")) return;
  if(e.target.closest("input,textarea,select,[contenteditable]")||document.querySelector("#dlg.on,#cfm.on,#alr.on")) return;
  e.preventDefault(); irDet(e.key==="ArrowLeft"?-1:1); });
$("drawer").onclick=e=>{if(e.target.id==="drawer")closeDet()};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDet()});

// ---------- impressão ----------
const stamp=()=>new Date().toLocaleString("pt-BR");
const ph=(t)=>`<div class="ph"><div style="display:flex;align-items:center;gap:12px"><img src="${LOGO}" style="height:40px"><div style="border-left:1px solid #ccc;padding-left:12px"><b>GMAP</b><div style="font-size:11px">Gerência de Material e Patrimônio</div></div></div><div style="text-align:right;font-size:11px">${t}<br>Emitido em ${stamp()}</div></div>`;
function doPrint(html){$("print").innerHTML=html; setTimeout(()=>window.print(),50)}
function printOS(list){
  doPrint(list.map(o=>`<div class="pg os">${ph("Ordem de Serviço de Climatização")}<h2>O.S. nº ${esc(o.os)}</h2>${o.revisao?'<div class="foot"><b>Em revisão pela GMAP: confirme os dados antes de executar.</b></div>':""}
   <table>${osRows(o).map(([a,b])=>`<tr><td class="k">${a}</td><td>${esc(b)}</td></tr>`).join("")}</table>
   <div class="sig"><div>Responsável técnico da empresa</div><div>Responsável pela unidade escolar</div></div>
   <div class="foot">Documento gerado pelo Painel de O.S. de Climatização. Situação em ${fmt(REF)}.</div></div>`).join(""));
}
$("bPrintSel").onclick=()=>printOS([...sel].map(find).filter(Boolean));

// ---------- relatórios ----------
function synth(L){
  const canc=LL=>LL.filter(o=>o.status==="Cancelada").length;
  const linha=(nome,LL)=>{const s=stats(LL);return [nome,s.total,s.open,s.atend,canc(LL),s.atBase?+(s.atNo/s.atBase*100).toFixed(1):null]};
  // linha "Não informada" para registros sem o campo, para que as linhas sempre somem o total
  const grp=(key,vals,name)=>vals.map(v=>linha(name(v),L.filter(o=>o[key]===v))).filter(r=>r[1]).concat(L.some(o=>!o[key])?[linha("Não informada",L.filter(o=>!o[key]))]:[]);
  const H=["", "Total", "Em aberto", "Atendidas", "Canceladas", "% atendidas no prazo"];
  const s=stats(L);
  return {H, emp:grp("emp",EMPS,v=>EMPN[v]), prio:grp("prio",PRIOS,v=>v), gre:grp("gre",uniq("gre"),v=>v),
    tot:["Total",s.total,s.open,s.atend,canc(L),s.atBase?+(s.atNo/s.atBase*100).toFixed(1):null]};
}
const NOTA_SINT="Total = Em aberto + Atendidas + Canceladas.";
const ANH=["Nº O.S.","Empresa","Status","Em revisão","Prioridade","Emitida em","Prazo","Atendida em","Situação do prazo","Dias de atraso","Escola / entidade","INEP","GRE","Município","Serviço","Splits","Origem","Nº da origem","Processo SEI"];
const anRow=o=>[o.os,EMPN[o.emp]||o.emp,o.status,o.revisao?"Sim":"",o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.sp,(o.atraso>0?o.atraso:""),o.escola,o.inep,o.gre,o.mun,o.serv.map(s=>SERVN[s]||s).join(", "),o.splits??"",o.origem?ORIG[o.origem]:"",o.origem_num||"",o.sei];
function xlsx(name,sheets){const wb=XLSX.utils.book_new();sheets.forEach(([n,aoa])=>{const ws=XLSX.utils.aoa_to_sheet(aoa);ws["!cols"]=aoa[Math.min(4,aoa.length-1)].map((_,i)=>({wch:Math.min(48,Math.max(10,...aoa.map(r=>String(r[i]??"").length+2)))}));XLSX.utils.book_append_sheet(wb,ws,n)});XLSX.writeFile(wb,name)}
function exp(x){
  const L=filaList(), head=[["Painel de O.S. de Climatização · GMAP | SEDUC-PI"],[filterText()],["Situação em "+fmt(REF)+" · emitido em "+stamp()],[]];
  if(x==="sx"){const S=synth(L); const blk=(t,rows,first)=>[[t],[first].concat(S.H.slice(1))].concat(rows).concat([[]]);
    xlsx("OS_relatorio_sintetico.xlsx",[["Sintético",head.concat([[NOTA_SINT],[]],blk("Por empresa",S.emp.concat([S.tot]),"Empresa"),blk("Por prioridade",S.prio.concat([S.tot]),"Prioridade"),blk("Por GRE",S.gre.concat([S.tot]),"GRE"))]]);}
  if(x==="ax") xlsx("OS_relatorio_analitico.xlsx",[["Analítico",head.concat([ANH],L.map(anRow))]]);
  const T=(H,R)=>`<table><thead><tr>${H.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${R.map(r=>`<tr>${r.map((c,i)=>`<td ${i&&typeof c==="number"?'style="text-align:right"':""}>${esc(typeof c==="number"&&i===5?c.toLocaleString("pt-BR")+"%":c??"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  if(x==="sp"){const S=synth(L); doPrint(`<div class="rp">${ph("Relatório sintético")}<h2>Relatório sintético de O.S.</h2><div class="foot">${esc(filterText())} · Situação em ${fmt(REF)}</div><div class="foot">${NOTA_SINT}</div>
    <h3>Por empresa</h3>${T(["Empresa"].concat(S.H.slice(1)),S.emp.concat([S.tot]))}<h3>Por prioridade</h3>${T(["Prioridade"].concat(S.H.slice(1)),S.prio.concat([S.tot]))}<h3>Por GRE</h3>${T(["GRE"].concat(S.H.slice(1)),S.gre.concat([S.tot]))}</div>`);}
  if(x==="ap"){const H2=["Nº O.S.","Empresa","Status","Prior.","Criada","Prazo","Atendida","Situação do prazo","Escola","Município"];
    doPrint(`<div class="rp">${ph("Relatório analítico")}<h2>Relatório analítico de O.S. (${nf(L.length)})</h2><div class="foot">${esc(filterText())} · Situação em ${fmt(REF)}</div>${T(H2,L.map(o=>[o.os,EMPN[o.emp]||o.emp,o.status,o.prio,fmt(o.criada),fmt(o.prazo),fmt(o.atend),o.sp,tc(o.escola),tc(o.mun||"")]))}</div>`);}
  $("mExp").classList.remove("on");
}
$("bExp").onclick=e=>{e.stopPropagation();$("mExp").classList.toggle("on")};
document.addEventListener("click",()=>$("mExp").classList.remove("on"));
$("mExp").querySelectorAll("button[data-x]").forEach(b=>b.onclick=()=>exp(b.dataset.x));

// ---------- navegação ----------
const VIEWS=["geral","fila","aprov","nova","fisc","planilha","aud","emp","modelo","cfg","usr"];
const SEMFILTRO=["usr","aprov","nova","emp","modelo","planilha","fisc","cfg"];
const GRUPO_CONF=["fisc","planilha","aud","emp","modelo","cfg"];
function setView(v,arg){view=v; document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.v===v)); $("tConf").classList.toggle("on",GRUPO_CONF.includes(v)); fecharConf(); VIEWS.forEach(x=>$("v-"+x).hidden=v!==x); $("filters").hidden=$("fTog").hidden=SEMFILTRO.includes(v); page=0; render(arg); window.scrollTo(0,0)}
// trocar de aba pergunta antes se houver formulário preenchido (O.S. ou modelo)
document.querySelectorAll(".tab[data-v]").forEach(t=>t.onclick=async()=>{ const v=t.dataset.v; fecharConf(); if(v===view) return; if(!(await EMI.podeSair(view))) return; if(view==="cfg"&&!(await FIS.podeSairConfig())) return; setView(v); });
// engrenagem: Planilha, Auditoria, Empresas e Modelo num menu; o número soma os avisos dos itens
function fecharConf(){ const m=$("mConf"); if(!m.hidden){ m.hidden=true; $("tConf").setAttribute("aria-expanded","false"); } }
function posicionarConf(){ const m=$("mConf"); if(m.hidden) return; const r=$("tConf").getBoundingClientRect(), w=m.offsetWidth;
  m.style.top=(r.bottom+4)+"px"; m.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+"px"; }
function abrirConf(){ const m=$("mConf"); m.hidden=false; $("tConf").setAttribute("aria-expanded","true"); posicionarConf();
  const f=m.querySelector(".tab:not([hidden])"); if(f) f.focus({preventScroll:true}); }
$("tConf").onclick=e=>{ e.stopPropagation(); $("mConf").hidden?abrirConf():fecharConf(); };
document.addEventListener("click",e=>{ if(!e.target.closest("#mConf,#tConf")) fecharConf(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("mConf").hidden){ fecharConf(); $("tConf").focus(); } });
window.addEventListener("resize",posicionarConf); window.addEventListener("scroll",posicionarConf,true);
function atualizarConf(){ const itens=[...$("mConf").querySelectorAll(".tab")].filter(t=>!t.hidden), n=itens.reduce((s,t)=>s+(+((t.querySelector(".cnt")||{}).textContent)||0),0);
  $("tConf").hidden=!itens.length; $("tConf").innerHTML=UI.icone("config")+(n?`<span class="cnt">${n}</span>`:"");
  $("tConf").setAttribute("aria-label","Administração"+(n?` (${n} aviso${n>1?"s":""})`:"")); }
const MQ_CEL=matchMedia("(max-width:700px)");
function posicionarIcones(){ const fim=document.querySelector(".tabs-fim"); if(MQ_CEL.matches) $("bSenha").before(fim); else $("tabs").append(fim); fecharConf(); }
(MQ_CEL.addEventListener?MQ_CEL.addEventListener("change",posicionarIcones):MQ_CEL.addListener(posicionarIcones)); posicionarIcones();
new MutationObserver(atualizarConf).observe($("mConf"),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["hidden"]});
function render(arg){ if(view==="geral") renderGeral(filtered()); else if(view==="aud") renderAud(filtered()); else if(view==="usr") renderUsuarios(CTX);
  else if(view==="aprov") EMI.renderAprov(); else if(view==="nova") EMI.renderNova(arg); else if(view==="emp") EMI.renderEmpresas(); else if(view==="modelo") EMI.renderModelo(); else if(view==="planilha") EMI.renderPlanilha(); else if(view==="fisc") FIS.render(); else if(view==="cfg") FIS.renderConfig(); else renderFila(); }
// abas por perfil: técnico vê tudo menos Usuários; consultivo (diretoria, fiscais) e empresa só consultam
const GMAP = perfil==="gmap", TEC = perfil==="tec", EQUIPE = GMAP||TEC;
// fase planilha: até a virada, as O.S. são emitidas na planilha; Nova O.S. e Aprovações ficam escondidas
const EMISSAO = !(CTX.config && CTX.config.planilha_ativa);
const OBSERVANDO = EMISSAO && !!(CTX.config && CTX.config.observar_planilha);
const CONSULTIVO = perfil==="dir";
// Fiscalização: aba principal para o Consultivo (fiscais, diretoria); para a equipe fica no menu da engrenagem
if(!CONSULTIVO) $("mConf").insertBefore(document.querySelector('.tab[data-v="fisc"]'), document.querySelector('#mConf .tab[data-v="aud"]'));
const ABAS = {fisc:EQUIPE||CONSULTIVO, cfg:GMAP, aud:EQUIPE, usr:GMAP, aprov:EQUIPE&&EMISSAO, nova:EQUIPE&&EMISSAO, planilha:GMAP&&OBSERVANDO, emp:EQUIPE, modelo:GMAP};
Object.entries(ABAS).forEach(([v,ok])=>document.querySelector(`.tab[data-v="${v}"]`).hidden=!ok);
document.querySelector('.tab[data-v="usr"]').innerHTML=UI.icone("usuarios"); atualizarConf();
if(GMAP) contarPendentes(CTX);
// recarrega os dados do banco depois de cada ação e redesenha a tela atual
async function recarregar(){ const novo=await CTX.recarregar(); CTX.rows=novo.rows; Object.assign(CTX,novo); preparar(novo.rows); buildFilters(); EMI.contarAprov(); if(view!=="nova") render(); }
const EMI = window.iniciarEmissao({CTX, $, esc, fmt, tc, nf, pct, days, dd, EMPN, PRIOS, SERV, SERVN, STB, PRB, SPB, OPEN, PRE, ORIG, REF, perfil, GMAP, TEC, EQUIPE,
  todos:()=>ALL, solic:()=>SOLIC, find, openDet, closeDet, setView, recarregar, podeSair:()=>EMI.podeSair(view), xlsx, stamp:()=>new Date().toLocaleString("pt-BR"),
  verFila:(filtro)=>{ FV=Object.assign({},filtro||{}); buildFilters(); $("fprazo").value=""; setView("fila"); }});
const FIS = window.iniciarFiscalizacao({CTX, $, esc, fmt, tc, nf, EMPN, SERV, SERVN, PRIOS, todos:()=>ALL, find, openDet, recarregar, xlsx, doPrint, ph,
  podeConferir: GMAP||CONSULTIVO, aviso:(m,t)=>UI.aviso(m,t)});
EMI.contarAprov();
buildFilters(); render();

}
