/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Aba "Usuários": aprovação de pedidos de acesso e gestão de usuários (somente GMAP).
   As permissões são conferidas no banco; esta tela só chama as funções autorizadas. */
const PERFIL_NOME = { gmap: "GMAP (gerência)", tecnico: "Técnico GMAP", consultivo: "Consultivo", empresa: "Empresa" };
const uEmpsTxt = u => u.perfil !== "consultivo" ? "" : u.todas_empresas ? "todas as empresas" : (u.empresas || []).length ? (u.empresas || []).join(", ") : "nenhuma empresa definida";
const uPerfilTxt = u => (PERFIL_NOME[u.perfil] || uEscF(u.perfil)) + (u.perfil === "consultivo" && u.funcao ? " · " + uEscF(u.funcao) : "")
  + (u.perfil === "consultivo" ? `<div class="mun">Vê: ${uEscF(uEmpsTxt(u))}</div>` : "");
function uEscF(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
const SIT = { pendente: ["Pendente", "b-warn"], aprovado: ["Ativo", "b-ok"], recusado: ["Recusado", "b-gray"], bloqueado: ["Bloqueado", "b-bad"] };
const uEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uData = s => s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "nunca";

async function contarPendentes(CTX) {
  const { data } = await CTX.sb.rpc("listar_usuarios");
  const n = (data || []).filter(u => u.situacao === "pendente").length;
  const tab = document.querySelector('.tab[data-v="usr"]');
  tab.innerHTML = UI.icone("usuarios") + (n ? `<span class="cnt">${n}</span>` : "");
  tab.setAttribute("aria-label", "Usuários" + (n ? ` (${n} pedido${n > 1 ? "s" : ""} de acesso)` : ""));
}

async function renderUsuarios(CTX) {
  const $ = id => document.getElementById(id);
  $("uMsg").textContent = "";
  $("uPend").innerHTML = '<div class="empty">Carregando…</div>';
  const { data, error } = await CTX.sb.rpc("listar_usuarios");
  if (error) { $("uPend").innerHTML = `<div class="empty">Não foi possível carregar: ${uEsc(error.message)}</div>`; return; }
  const pend = data.filter(u => u.situacao === "pendente");
  // 2.13: quem é administrador (banco sem a migração 016: ninguém)
  let ADM = new Set();
  try { const r = await CTX.sb.from("perfis").select("user_id").eq("administrador", true); if (!r.error) ADM = new Set((r.data || []).map(x => x.user_id)); } catch (e) {}
  const souAdmin = !!CTX.admin;
  const outros = data.filter(u => u.situacao !== "pendente");
  const empresas = CTX.empresas || [];
  const selPerfil = u => `<select class="usel" data-f="perfil">${Object.entries(PERFIL_NOME).map(([v, t]) => `<option value="${v}" ${u.perfil === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const selEmp = u => `<select class="usel" data-f="empresa" ${u.perfil === "empresa" ? "" : "hidden"}><option value="">Selecione</option>${empresas.map(e => `<option ${u.empresa === e ? "selected" : ""}>${uEsc(e)}</option>`).join("")}</select>`;

  $("uPendT").textContent = `Pedidos de acesso (${pend.length})`;
  $("uPend").innerHTML = pend.length ? `<div class="tbl" style="max-height:none"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Empresa</th><th>Pedido em</th><th></th></tr></thead><tbody>${
    pend.map(u => `<tr data-id="${u.user_id}"><td class="esc">${uEsc(u.nome || "")}</td><td>${uEsc(u.email)}</td><td>${selPerfil(u)}${u.funcao ? `<div class="mun">Função informada: ${uEsc(u.funcao)}</div>` : ""}${u.perfil === "consultivo" ? `<div class="mun">Empresas pedidas: ${uEsc(uEmpsTxt(u))}</div>` : ""}</td><td>${selEmp(u)}</td><td>${uData(u.criado_em)}</td>
      <td><div class="acoes"><button class="btn ok" data-a="aprovar">Aprovar</button><button class="btn" data-x="editar">Editar</button><button class="btn no" data-a="recusar">Recusar</button></div></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">Nenhum pedido aguardando aprovação.</div>';

  $("uTodos").innerHTML = `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th>Decidido em</th><th></th></tr></thead><tbody>${
    outros.map(u => {
      const eu = u.user_id === CTX.uid, s = SIT[u.situacao] || [u.situacao, "b-gray"], adm = ADM.has(u.user_id);
      const acao = `<div class="acoes"><button class="btn" data-x="editar">Editar</button>` + (!eu && u.situacao === "aprovado" && u.email ? '<button class="btn" data-x="senha" title="Envia ao e-mail do usuário um link para criar uma senha nova">Enviar link de nova senha</button>' : "") + (u.perfil === "gmap" && u.situacao === "aprovado" ? `<button class="btn" data-x="admin" title="${adm ? "Deixa de alterar Planilha, Empresas, Modelo, Configurações e Usuários" : "Passa a alterar Planilha, Empresas, Modelo, Configurações e Usuários"}">${adm ? "Retirar administrador" : "Tornar administrador"}</button>` : "") + (eu ? '<span class="mun">você</span>' : adm ? "" : (u.situacao === "aprovado" ? '<button class="btn no" data-a="bloquear">Bloquear</button>' : '<button class="btn" data-a="reativar">Reativar</button>')
        + '<button class="btn no" data-x="excluir">Excluir</button>') + "</div>";
      return `<tr data-id="${u.user_id}"><td class="esc">${uEsc(u.nome || "")}</td><td>${uEsc(u.email)}</td><td>${uPerfilTxt(u)}${adm ? ' <span class="badge b-info" title="Altera Planilha, Empresas, Modelo da O.S., Configurações e Usuários">Administrador</span>' : ""}${u.empresa ? "<div class='mun'>" + uEsc(u.empresa) + "</div>" : ""}</td>
        <td><span class="badge ${s[1]}">${s[0]}</span></td><td>${uData(u.ultimo_acesso)}</td><td>${u.decidido_em ? uData(u.decidido_em) : ""}</td><td>${acao}</td></tr>`;
    }).join("")}</tbody></table>`;

  const porId = id => data.find(u => u.user_id === id);
  const recarregar = async msg => { await renderUsuarios(CTX); contarPendentes(CTX); if (msg) $("uMsg").textContent = msg; };
  document.querySelectorAll("#uTodos button[data-x], #uPend button[data-x]").forEach(b => b.onclick = async () => {
    const u = porId(b.closest("tr").dataset.id); if (!u) return;
    if (b.dataset.x === "editar") return editarUsuario(CTX, u, empresas, recarregar);
    if (b.dataset.x === "senha") return enviarLinkUsuario(u, b);
    if (b.dataset.x === "admin") return marcarAdmin(CTX, u, !ADM.has(u.user_id), recarregar);
    return excluirUsuario(CTX, u, recarregar);
  });
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
      if (perfil === "empresa" && !empresa) return UI.alerta({ titulo: "Selecione a empresa", itens: "Para aprovar como Empresa, escolha a empresa na linha do usuário.", campos: [tr.querySelector('select[data-f="empresa"]')] });
    }
    const textos = { aprovar: `Aprovar o acesso de ${nome} como ${PERFIL_NOME[perfil]}${empresa ? " (" + empresa + ")" : ""}?`,
      recusar: `Recusar o pedido de ${nome}?`, bloquear: `Bloquear o acesso de ${nome}? O bloqueio vale na hora.`, reativar: `Reativar o acesso de ${nome}?` };
    if (!(await UI.confirmar({ titulo: textos[acao], botao: { aprovar: "Aprovar", recusar: "Recusar", bloquear: "Bloquear", reativar: "Reativar" }[acao], perigo: acao === "recusar" || acao === "bloquear" }))) return;
    b.disabled = true;
    const { error: e } = await CTX.sb.rpc("decidir_usuario", { p_usuario: id, p_acao: acao, p_perfil: perfil, p_empresa: empresa });
    if (e) { $("uMsg").textContent = "Não foi possível concluir: " + e.message; b.disabled = false; return; }
    await renderUsuarios(CTX);
    contarPendentes(CTX);
  });
  if (!souAdmin) UI.somenteLeitura($("v-usr"));
}

// 2.13: dar ou retirar a marca de administrador (o banco impede ficar sem nenhum)
async function marcarAdmin(CTX, u, dar, recarregar) {
  const nome = u.nome || u.email;
  if (!(await UI.confirmar({ titulo: dar ? `Tornar ${nome} administrador(a) do sistema?` : `Retirar de ${nome} a marca de administrador?`, botao: dar ? "Tornar administrador" : "Retirar", perigo: !dar,
    texto: dar ? "Passa a alterar Planilha, Empresas, Modelo da O.S., Configurações e Usuários (inclusive dar e retirar esta marca)."
               : "Continua na gerência, mas só consulta Planilha, Empresas, Modelo da O.S., Configurações e Usuários." }))) return;
  const { error: e } = await CTX.sb.rpc("usuario_admin", { p_usuario: u.user_id, p_admin: dar });
  if (e) return UI.alerta({ titulo: "Não foi possível concluir", itens: e.message });
  if (u.user_id === CTX.uid && !dar) { UI.aviso("Marca retirada. A página vai recarregar.", "ok"); return setTimeout(() => location.reload(), 900); }
  await recarregar(dar ? `${nome} agora é administrador(a).` : `${nome} deixou de ser administrador(a).`);
}

// gerência: envia ao usuário o link de redefinição de senha (o mesmo de "Esqueci minha senha").
// A senha atual continua valendo até a pessoa criar a nova; a gerência não vê nem define a senha.
async function enviarLinkUsuario(u, b) {
  if (!(await UI.confirmar({ titulo: "Enviar link de nova senha?", texto: `${uEsc(u.nome || u.email)} vai receber em ${uEsc(u.email)} um link para criar uma senha nova. O link vale por 1 hora. A senha atual continua valendo até ser trocada.`, botao: "Enviar link" }))) return;
  b.disabled = true;
  const erro = await window.enviarLinkSenha(u.email);
  if (erro) { document.getElementById("uMsg").textContent = erro; b.disabled = false; return; }
  document.getElementById("uMsg").textContent = `Link de nova senha enviado para ${u.email}.`;
  setTimeout(() => { b.disabled = false; }, 60000);
}

// gerência: editar nome, perfil, empresa e função (o próprio perfil não pode ser trocado)
async function editarUsuario(CTX, u, empresas, recarregar) {
  const eu = u.user_id === CTX.uid;
  const { data: imp } = await CTX.sb.rpc("usuario_impacto", { p_usuario: u.user_id });
  const vis = v => { const s = id => { const el = document.getElementById("dc_" + id); if (el) el.closest(".fl").hidden = !v; }; return s; };
  const ajustar = perfil => { vis(perfil === "empresa")("empresa"); vis(perfil === "consultivo")("funcao"); vis(perfil === "consultivo")("emps"); };
  UI.dialogo({
    titulo: `Editar usuário: ${u.nome || u.email}`, botao: "Salvar",
    texto: `${uEsc(u.email)}${eu ? "<br>Você pode corrigir o seu nome. O seu perfil só pode ser alterado por outra pessoa da gerência." : ""}`,
    campos: [
      { id: "nome", rot: "Nome completo", obrig: true, valor: u.nome || "", max: 120 },
      ...(eu ? [] : [{ id: "perfil", rot: "Perfil", tipo: "select", obrig: true, valor: u.perfil, opcoes: Object.entries(PERFIL_NOME).map(([v, t]) => ({ v, t })), aoMudar: v => ajustar(v.perfil) }]),
      { id: "empresa", rot: "Empresa", tipo: "select", obrig: true, valor: u.empresa || "", opcoes: empresas, oculto: u.perfil !== "empresa" },
      { id: "funcao", rot: "Função", obrig: true, valor: u.funcao || "", max: 60, oculto: u.perfil !== "consultivo", dica: "Ex.: Diretoria, Fiscal de contrato, Fiscal do contrato Classe A." },
      { id: "emps", rot: "Empresas que pode ver e fiscalizar", tipo: "checks", obrig: true, oculto: u.perfil !== "consultivo", dica: "Só as O.S. dessas empresas aparecem para essa pessoa (Visão geral, Fila, Fiscalização e exportações).",
        opcoes: [{ valor: "__todas", rotulo: "<b>Todas as empresas</b> (Diretoria)", marcado: !!u.todas_empresas }].concat(empresas.map(e => ({ valor: e, rotulo: uEsc(e), marcado: !u.todas_empresas && (u.empresas || []).includes(e) }))) }
    ],
    enviar: async v => {
      const perfil = eu ? u.perfil : v.perfil;
      const sai = imp && (imp.aguardando + imp.devolvidas) > 0 && (u.perfil === "gmap" || u.perfil === "tecnico") && !(perfil === "gmap" || perfil === "tecnico");
      if (perfil !== u.perfil && !(await UI.confirmar({ titulo: `Mudar ${u.nome || u.email} de ${PERFIL_NOME[u.perfil]} para ${PERFIL_NOME[perfil]}?`, botao: "Mudar o perfil",
        texto: "As permissões mudam no próximo acesso dessa pessoa." + (sai ? `<br><b>Atenção:</b> essa pessoa tem ${imp.aguardando + imp.devolvidas} ${imp.aguardando + imp.devolvidas === 1 ? "solicitação" : "solicitações"} em andamento e, com o novo perfil, não poderá mais corrigir.` : "") }))) return false;
      const todas = (v.emps || []).includes("__todas"), emps = todas ? [] : (v.emps || []).filter(e => e !== "__todas");
      const { error } = await CTX.sb.rpc("usuario_editar", { p_usuario: u.user_id, p_nome: v.nome, p_perfil: perfil, p_empresa: perfil === "empresa" ? v.empresa : null,
        p_funcao: perfil === "consultivo" ? v.funcao : null, p_empresas: perfil === "consultivo" ? emps : [], p_todas: perfil === "consultivo" && todas });
      if (error) return error.message;
      if (eu && v.nome !== CTX.nome) { const n = document.getElementById("uNome"); if (n) n.textContent = v.nome; }
      await recarregar("Usuário atualizado.");
      return null;
    }
  });
}

// gerência: excluir usuário, mostrando antes o que será afetado
async function excluirUsuario(CTX, u, recarregar) {
  const { data: imp, error } = await CTX.sb.rpc("usuario_impacto", { p_usuario: u.user_id });
  if (error) return UI.alerta({ titulo: "Não foi possível verificar o usuário", itens: error.message });
  const nome = u.nome || u.email, and = imp.aguardando + imp.devolvidas, pl = (n, s, p2) => n + " " + (n === 1 ? s : p2);
  const itens = [
    `Perde o acesso na hora. O login e o cadastro são apagados e <b>não dá para desfazer</b>.`,
    `Último acesso: ${uData(imp.ultimo_acesso)}.`,
    imp.acoes ? `O nome continua no histórico das O.S. (${pl(imp.acoes, "ação registrada", "ações registradas")}).` : "Não há ações desse usuário no histórico das O.S.",
    imp.solicitadas ? `${pl(imp.solicitadas, "O.S. solicitada continua", "O.S. solicitadas continuam")} com esse nome como solicitante.` : "",
    imp.atendimentos ? `${pl(imp.atendimentos, "atendimento registrado continua", "atendimentos registrados continuam")} valendo.` : "",
    and ? `<b>${pl(and, "solicitação em andamento passa", "solicitações em andamento passam")} para você</b>${imp.devolvidas ? ` (${pl(imp.devolvidas, "devolvida volta", "devolvidas voltam")} para a aprovação)` : ""}.` : "",
    u.situacao === "aprovado" ? "Se o afastamento for temporário, prefira <b>Bloquear</b>: dá para reativar depois." : ""
  ].filter(Boolean);
  const ok = await UI.confirmar({ titulo: `Excluir ${nome}?`, perigo: true, botao: "Excluir definitivamente",
    texto: `${uEsc(u.email)} · ${uPerfilTxt(u)}<ul class="impacto">${itens.map(i => `<li>${i}</li>`).join("")}</ul>` });
  if (!ok) return;
  const r = await CTX.sb.rpc("usuario_excluir", { p_usuario: u.user_id });
  if (r.error) return UI.alerta({ titulo: "Não foi possível excluir", itens: r.error.message });
  const t = r.data && r.data.transferidas;
  await recarregar(`${nome} foi excluído(a).` + (t ? ` ${t} ${t === 1 ? "solicitação passou" : "solicitações passaram"} para você.` : ""));
}
