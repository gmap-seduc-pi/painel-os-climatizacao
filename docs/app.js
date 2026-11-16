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

  const NOMES = { gmap: "GMAP (gerência)", tecnico: "Técnico GMAP", diretoria: "Diretoria", empresa: "Empresa" };
  const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const fmtDH = s => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  async function carregarTudo(tabela, colunas, ordem) {
    const passo = 1000, todos = [];
    for (let de = 0; ; de += passo) {
      const { data, error } = await sb.from(tabela).select(colunas).order(ordem || "id").range(de, de + passo - 1);
      if (error) throw error;
      todos.push(...data);
      if (data.length < passo) break;
    }
    return todos;
  }

  // Converte a linha do banco para o formato usado pelo painel
  const paraPainel = o => Object.assign({}, o, {
    id: o.id, os: o.numero || o.cod, emp: o.empresa, prio: o.prioridade, criada: o.criada_em, atend: o.atendida_em, desc: o.descricao,
    escola: o.escola || o.entidade, mun: o.municipio, end: o.endereco, sei: o.id_sei, obs: o.observacoes, just: o.justificativa,
    motivo: o.motivo_cancelamento, pend: o.pendencias, pdf: o.pdf_nome, revisao: !!o.revisao
  });
  async function carregarDados(equipe) {
    const [linhas, ents, emps, muds, modelo, contatos, cfg, pend] = await Promise.all([
      carregarTudo("os", "*"),
      carregarTudo("entidades", "*"),
      sb.from("empresas").select("*").order("nome"),
      equipe ? sb.from("entidades_mudancas").select("*").order("id", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
      sb.from("os_modelo").select("*").limit(1),
      equipe ? sb.from("entidade_contatos").select("*").limit(5000) : Promise.resolve({ data: [] }),
      sb.from("sistema_config").select("*").limit(1),
      equipe ? sb.from("planilha_pendencias").select("*").order("id", { ascending: false }).limit(1000) : Promise.resolve({ data: [] })
    ]);
    return { rows: linhas.map(paraPainel), entidades: ents, empresasCad: emps.data || [], mudancas: muds.data || [],
             modelo: (modelo.data || [])[0] || null, contatos: contatos.data || [], config: (cfg.data || [])[0] || { planilha_ativa: false }, pendencias: pend.data || [] };
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
      const equipe = p.perfil === "gmap" || p.perfil === "tecnico";
      const [dados, sinc] = await Promise.all([
        carregarDados(equipe),
        sb.from("sincronizacoes").select("executada_em").order("id", { ascending: false }).limit(1)
      ]);
      sb.from("acessos").insert({ agente: navigator.userAgent.slice(0, 200) }).then(() => {});
      const perfil = p.perfil === "gmap" ? "gmap" : p.perfil === "tecnico" ? "tec" : p.perfil === "diretoria" ? "dir" : "emp:" + p.empresa;
      const perfilNome = p.perfil === "empresa" ? "Empresa: " + p.empresa : NOMES[p.perfil];
      $("uNome").textContent = p.nome || p.email;
      $("uPerfil").textContent = perfilNome;
      const ult = sinc.data && sinc.data[0];
      const naPlanilha = dados.config && dados.config.planilha_ativa;
      $("refd").textContent = "situação em " + hojeBR().split("-").reverse().join("/") + (naPlanilha ? (ult ? " · planilha sincronizada em " + fmtDH(ult.executada_em) : "") : " · dados em tempo real");

      show("app");
      const { data: emps } = await sb.rpc("empresas_disponiveis");
      iniciarPainel(Object.assign(dados, { perfil, perfilNome, ref: hojeBR(), logo: new URL("assets/logo-seduc.png", location.href).href,
                      sb, uid: session.user.id, nome: p.nome || p.email, empresas: (emps || []).map(e => typeof e === "string" ? e : Object.values(e)[0]),
                      recarregar: () => carregarDados(equipe) }));
    } catch (e) {
      show("carregando");
      $("carregando").innerHTML = '<div class="lcard"><b>Não foi possível carregar os dados</b><div class="sub">' + String(e.message || e).replace(/</g, "&lt;") + '</div><button class="btn" onclick="location.reload()">Tentar de novo</button></div>';
    }
  }

  UI.aoEnviar("fLogin", async ev => {
    ev.preventDefault();
    $("lErr").textContent = ""; $("lBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lSenha").value });
    $("lBtn").disabled = false;
    if (error) { $("lErr").textContent = "E-mail ou senha incorretos."; return; }
    iniciar();
  });
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
  UI.aoEnviar("fCad", async ev => {
    ev.preventDefault();
    $("cErr").textContent = "";
    const faltaC = [["cNome", "Nome"], ["cEmail", "E-mail"], ["cS1", "Senha"], ["cS2", "Confirmação da senha"]].filter(([i]) => !$(i).value.trim());
    if (faltaC.length) return UI.alerta({ titulo: "Preencha os campos obrigatórios", itens: faltaC.map(x => x[1]), campos: faltaC.map(x => $(x[0])) });
    if ($("cS1").value.length < 10) return UI.alerta({ titulo: "Senha curta", itens: "A senha precisa ter pelo menos 10 caracteres.", campos: [$("cS1")] });
    if ($("cS1").value !== $("cS2").value) return UI.alerta({ titulo: "As senhas não conferem", itens: "Digite a mesma senha nos dois campos.", campos: [$("cS2")] });
    const perfil = $("cPerfil").value, empresa = perfil === "empresa" ? $("cEmpresa").value : null;
    if (perfil === "empresa" && !empresa) return UI.alerta({ titulo: "Selecione a empresa", itens: "Para o perfil Empresa, escolha a empresa na lista.", campos: [$("cEmpresa")] });
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
  });

  $("bSenha").onclick = () => { $("sErr").textContent = ""; $("s1").value = ""; $("s2").value = ""; $("dSenha").classList.add("on"); };
  $("sCanc").onclick = () => $("dSenha").classList.remove("on");
  UI.aoEnviar("fSenha", async ev => {
    ev.preventDefault();
    if ($("s1").value.length < 10) return UI.alerta({ titulo: "Senha curta", itens: "A senha precisa ter pelo menos 10 caracteres.", campos: [$("s1")] });
    if ($("s1").value !== $("s2").value) return UI.alerta({ titulo: "As senhas não conferem", itens: "Digite a mesma senha nos dois campos.", campos: [$("s2")] });
    const { error } = await sb.auth.updateUser({ password: $("s1").value });
    if (error) { $("sErr").textContent = "Não foi possível alterar: " + error.message; return; }
    $("sErr").style.color = "var(--ok)"; $("sErr").textContent = "Senha alterada.";
    setTimeout(() => { $("dSenha").classList.remove("on"); $("sErr").style.color = ""; }, 1200);
  });

  iniciar();
})();
