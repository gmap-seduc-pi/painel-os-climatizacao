/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Login, carregamento dos dados e inicialização do painel. */
(function () {
  const cfg = window.PAINEL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const show = id => ["login", "carregando", "app"].forEach(x => $(x).hidden = x !== id);

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

    const { data: perfis, error: ep } = await sb.from("perfis").select("perfil, empresa, nome, email, ativo").eq("user_id", session.user.id);
    const p = perfis && perfis[0];
    if (ep || !p || !p.ativo) {
      await sb.auth.signOut();
      show("login");
      $("lErr").textContent = "Seu usuário não tem perfil de acesso ativo. Fale com a GMAP.";
      return;
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
      iniciarPainel({ rows, perfil, perfilNome, ref: hojeBR(), logo: new URL("assets/logo-seduc.png", location.href).href });
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
  $("bSair").onclick = async () => { await sb.auth.signOut(); location.reload(); };

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
