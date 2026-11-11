/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Login, carregamento dos dados e inicialização do painel. */
(function () {
  const cfg = window.PAINEL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const show = id => ["login", "cad", "pend", "carregando", "app"].forEach(x => $(x).hidden = x !== id);

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("SEU-PROJETO")) {
    show("carregando");
    $("carregando").innerHTML = '<div class="lcard"><b>Configuração pendente</b><div class="sub">Preencha o arquivo config.js com a URL e a chave pública do Supabase.</div></div>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const NOMES = { gmap: "GMAP (gerência)", diretoria: "Diretoria", empresa: "Empresa" };
  const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const fmtDH = s => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  async function carregarTudo(tabela, colunas) {
    const passo = 1000, todos = [];
    for (let de = 0; ; de += passo) {
      const { data, error } = await sb.from(tabela).select(colunas).order("chave").range(de, de + passo - 1);
      if (error) throw error;
      todos.push(...data);
      if (data.length < passo) break;
    }
    return todos;
  }

  async function iniciar() {
    show("carregando");
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return show("login");

    const { data: perfis, error: ep } = await sb.from("perfis").select("perfil, empresa, nome, email, situacao").eq("user_id", session.user.id);
    const p = perfis && perfis[0];
    if (ep || !p) {
      try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
      try { Object.keys(localStorage).filter(k => k.startsWith("sb-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
      show("login");
      $("lErr").textContent = "Seu usuário não tem perfil de acesso. Solicite acesso ou fale com a GMAP.";
      return;
    }
    if (p.situacao !== "aprovado") {
      const pend = p.situacao === "pendente";
      $("pTit").textContent = pend ? "Acesso em análise" : "Acesso não liberado";
      $("pMsg").textContent = pend
        ? "Seu pedido de acesso foi recebido e está em análise pela GMAP. Você poderá entrar assim que ele for aprovado."
        : "Seu acesso não está liberado. Em caso de dúvida, fale com a GMAP.";
      return show("pend");
    }

    try {
      const cols = "chave,numero,empresa,status,prioridade,criada_em,prazo,atendida_em,splits,descricao,escola,entidade,inep,gre,municipio,zona,endereco,id_sei,observacoes,justificativa,motivo_cancelamento";
      const [linhas, sinc] = await Promise.all([
        carregarTudo("os", cols),
        sb.from("sincronizacoes").select("executada_em").order("id", { ascending: false }).limit(1)
      ]);
      sb.from("acessos").insert({ agente: navigator.userAgent.slice(0, 200) }).then(() => {});

      const rows = linhas.map(o => [o.numero, o.empresa, o.status, o.prioridade, o.criada_em, o.prazo, o.atendida_em, o.splits,
        o.descricao, o.escola || o.entidade, o.inep, o.gre, o.municipio, o.zona, o.endereco, o.id_sei, o.observacoes, o.justificativa, o.motivo_cancelamento]);

      const perfil = p.perfil === "gmap" ? "gmap" : p.perfil === "diretoria" ? "dir" : "emp:" + p.empresa;
      const perfilNome = p.perfil === "empresa" ? "Empresa: " + p.empresa : NOMES[p.perfil];
      $("uNome").textContent = p.nome || p.email;
      $("uPerfil").textContent = perfilNome;
      const ult = sinc.data && sinc.data[0];
      $("refd").textContent = "situação em " + hojeBR().split("-").reverse().join("/") + (ult ? " · planilha sincronizada em " + fmtDH(ult.executada_em) : "");

      show("app");
      const { data: emps } = await sb.rpc("empresas_disponiveis");
      iniciarPainel({ rows, perfil, perfilNome, ref: hojeBR(), logo: new URL("assets/logo-seduc.png", location.href).href,
                      sb, uid: session.user.id, empresas: (emps || []).map(e => typeof e === "string" ? e : Object.values(e)[0]) });
    } catch (e) {
      show("carregando");
      $("carregando").innerHTML = '<div class="lcard"><b>Não foi possível carregar os dados</b><div class="sub">' + String(e.message || e).replace(/</g, "&lt;") + '</div><button class="btn" onclick="location.reload()">Tentar de novo</button></div>';
    }
  }

  $("fLogin").onsubmit = async ev => {
    ev.preventDefault();
    $("lErr").textContent = ""; $("lBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lSenha").value });
    $("lBtn").disabled = false;
    if (error) { $("lErr").textContent = "E-mail ou senha incorretos."; return; }
    iniciar();
  };
  // Sair: tenta encerrar a sessão no servidor e, aconteça o que acontecer, apaga a sessão deste navegador.
  async function sair() {
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* segue para a limpeza local */ }
    try { Object.keys(localStorage).filter(k => k.startsWith("sb-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.replace(location.pathname);
  }
  $("bSair").onclick = sair;
  $("pSair").onclick = sair;

  // ---------- solicitar acesso ----------
  $("aCad").onclick = async ev => {
    ev.preventDefault();
    $("cErr").textContent = ""; show("cad");
    const { data } = await sb.rpc("empresas_disponiveis");
    $("cEmpresa").innerHTML = '<option value="">Selecione</option>' + (data || [])
      .map(e => typeof e === "string" ? e : Object.values(e)[0])
      .map(e => `<option>${String(e).replace(/</g, "&lt;")}</option>`).join("");
  };
  $("aLogin").onclick = ev => { ev.preventDefault(); show("login"); };
  $("cPerfil").onchange = () => { $("lEmp").hidden = $("cPerfil").value !== "empresa"; $("cEmpresa").required = $("cPerfil").value === "empresa"; };
  $("fCad").onsubmit = async ev => {
    ev.preventDefault();
    $("cErr").textContent = "";
    if ($("cS1").value !== $("cS2").value) { $("cErr").textContent = "As senhas não conferem."; return; }
    const perfil = $("cPerfil").value, empresa = perfil === "empresa" ? $("cEmpresa").value : null;
    if (perfil === "empresa" && !empresa) { $("cErr").textContent = "Selecione a empresa."; return; }
    $("cBtn").disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: $("cEmail").value.trim(), password: $("cS1").value,
      options: { data: { nome: $("cNome").value.trim(), perfil, empresa } }
    });
    $("cBtn").disabled = false;
    if (error) {
      $("cErr").textContent = /registered|already/i.test(error.message)
        ? "Este e-mail já tem cadastro. Use a tela de login ou fale com a GMAP."
        : "Não foi possível enviar: " + error.message;
      return;
    }
    if (data.session) return iniciar();
    $("pTit").textContent = "Solicitação enviada";
    $("pMsg").textContent = "Seu pedido foi registrado e será analisado pela GMAP. Você poderá entrar assim que ele for aprovado.";
    show("pend");
  };

  $("bSenha").onclick = () => { $("sErr").textContent = ""; $("fSenha").reset(); $("dSenha").classList.add("on"); };
  $("sCanc").onclick = () => $("dSenha").classList.remove("on");
  $("fSenha").onsubmit = async ev => {
    ev.preventDefault();
    if ($("s1").value !== $("s2").value) { $("sErr").textContent = "As senhas não conferem."; return; }
    const { error } = await sb.auth.updateUser({ password: $("s1").value });
    if (error) { $("sErr").textContent = "Não foi possível alterar: " + error.message; return; }
    $("sErr").style.color = "var(--ok)"; $("sErr").textContent = "Senha alterada.";
    setTimeout(() => { $("dSenha").classList.remove("on"); $("sErr").style.color = ""; }, 1200);
  };

  iniciar();
})();
