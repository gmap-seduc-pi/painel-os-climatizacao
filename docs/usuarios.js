/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Aba "Usuários": aprovação de pedidos de acesso e gestão de usuários (somente GMAP).
   As permissões são conferidas no banco; esta tela só chama as funções autorizadas. */
const PERFIL_NOME = { gmap: "GMAP (gerência)", diretoria: "Diretoria", empresa: "Empresa" };
const SIT = { pendente: ["Pendente", "b-warn"], aprovado: ["Ativo", "b-ok"], recusado: ["Recusado", "b-gray"], bloqueado: ["Bloqueado", "b-bad"] };
const uEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uData = s => s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "nunca";

async function contarPendentes(CTX) {
  const { data } = await CTX.sb.rpc("listar_usuarios");
  const n = (data || []).filter(u => u.situacao === "pendente").length;
  const tab = document.querySelector('.tab[data-v="usr"]');
  tab.innerHTML = "Usuários" + (n ? `<span class="cnt">${n}</span>` : "");
}

async function renderUsuarios(CTX) {
  const $ = id => document.getElementById(id);
  $("uMsg").textContent = "";
  $("uPend").innerHTML = '<div class="empty">Carregando…</div>';
  const { data, error } = await CTX.sb.rpc("listar_usuarios");
  if (error) { $("uPend").innerHTML = `<div class="empty">Não foi possível carregar: ${uEsc(error.message)}</div>`; return; }
  const pend = data.filter(u => u.situacao === "pendente");
  const outros = data.filter(u => u.situacao !== "pendente");
  const empresas = CTX.empresas || [];
  const selPerfil = u => `<select class="usel" data-f="perfil">${Object.entries(PERFIL_NOME).map(([v, t]) => `<option value="${v}" ${u.perfil === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const selEmp = u => `<select class="usel" data-f="empresa" ${u.perfil === "empresa" ? "" : "hidden"}><option value="">Selecione</option>${empresas.map(e => `<option ${u.empresa === e ? "selected" : ""}>${uEsc(e)}</option>`).join("")}</select>`;

  $("uPendT").textContent = `Pedidos de acesso (${pend.length})`;
  $("uPend").innerHTML = pend.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Empresa</th><th>Pedido em</th><th></th></tr></thead><tbody>${
    pend.map(u => `<tr data-id="${u.user_id}"><td class="esc">${uEsc(u.nome || "")}</td><td>${uEsc(u.email)}</td><td>${selPerfil(u)}</td><td>${selEmp(u)}</td><td>${uData(u.criado_em)}</td>
      <td><div class="acoes"><button class="btn ok" data-a="aprovar">Aprovar</button><button class="btn no" data-a="recusar">Recusar</button></div></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">Nenhum pedido aguardando aprovação.</div>';

  $("uTodos").innerHTML = `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th>Decidido em</th><th></th></tr></thead><tbody>${
    outros.map(u => {
      const eu = u.user_id === CTX.uid, s = SIT[u.situacao] || [u.situacao, "b-gray"];
      const acao = eu ? '<span class="mun">você</span>' : u.situacao === "aprovado" ? '<button class="btn no" data-a="bloquear">Bloquear</button>' : '<button class="btn" data-a="reativar">Reativar</button>';
      return `<tr data-id="${u.user_id}"><td class="esc">${uEsc(u.nome || "")}</td><td>${uEsc(u.email)}</td><td>${PERFIL_NOME[u.perfil] || uEsc(u.perfil)}${u.empresa ? "<div class='mun'>" + uEsc(u.empresa) + "</div>" : ""}</td>
        <td><span class="badge ${s[1]}">${s[0]}</span></td><td>${uData(u.ultimo_acesso)}</td><td>${u.decidido_em ? uData(u.decidido_em) : ""}</td><td>${acao}</td></tr>`;
    }).join("")}</tbody></table>`;

  document.querySelectorAll('#uPend select[data-f="perfil"]').forEach(sel => sel.onchange = () => {
    sel.closest("tr").querySelector('select[data-f="empresa"]').hidden = sel.value !== "empresa";
  });
  document.querySelectorAll("#v-usr button[data-a]").forEach(b => b.onclick = async () => {
    const tr = b.closest("tr"), id = tr.dataset.id, acao = b.dataset.a;
    const nome = tr.querySelector(".esc").textContent || tr.children[1].textContent;
    let perfil = null, empresa = null;
    if (acao === "aprovar") {
      perfil = tr.querySelector('select[data-f="perfil"]').value;
      empresa = tr.querySelector('select[data-f="empresa"]').value || null;
      if (perfil === "empresa" && !empresa) { $("uMsg").textContent = "Selecione a empresa antes de aprovar."; return; }
    }
    const textos = { aprovar: `Aprovar o acesso de ${nome} como ${PERFIL_NOME[perfil]}${empresa ? " (" + empresa + ")" : ""}?`,
      recusar: `Recusar o pedido de ${nome}?`, bloquear: `Bloquear o acesso de ${nome}? O bloqueio vale na hora.`, reativar: `Reativar o acesso de ${nome}?` };
    if (!confirm(textos[acao])) return;
    b.disabled = true;
    const { error: e } = await CTX.sb.rpc("decidir_usuario", { p_usuario: id, p_acao: acao, p_perfil: perfil, p_empresa: empresa });
    if (e) { $("uMsg").textContent = "Não foi possível concluir: " + e.message; b.disabled = false; return; }
    await renderUsuarios(CTX);
    contarPendentes(CTX);
  });
}
