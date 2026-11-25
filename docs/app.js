/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Login, carregamento dos dados e inicialização do painel. */
(function () {
  const cfg = window.PAINEL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const show = id => ["login", "cad", "rec", "novaSenha", "pend", "carregando", "app"].forEach(x => $(x).hidden = x !== id);

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("SEU-PROJETO")) {
    show("carregando");
    $("carregando").innerHTML = '<div class="lcard"><b>Configuração pendente</b><div class="sub">Preencha o arquivo config.js com a URL e a chave pública do Supabase.</div></div>';
    return;
  }
  // Recuperação de senha: o link do e-mail volta para o site com "type=recovery" (ou com o erro de link vencido).
  // Lido ANTES de criar o cliente, porque o cliente consome e limpa o endereço. Enquanto a marca existir nesta aba,
  // a pessoa só vê a tela de nova senha (o link já autentica; sem isso ela entraria no painel sem trocar a senha).
  const MARCA_REC = "painel_recuperacao";
  const marcaRec = { ler() { try { return sessionStorage.getItem(MARCA_REC) === "1"; } catch (e) { return false; } },
    por(v) { try { v ? sessionStorage.setItem(MARCA_REC, "1") : sessionStorage.removeItem(MARCA_REC); } catch (e) {} } };
  const hashIni = String(location.hash || "");
  let erroLink = "";
  if (/(^|[#&])type=recovery(&|$)/.test(hashIni)) marcaRec.por(true);
  if (/(^|[#&])error_code=/.test(hashIni) || /(^|[#&])error=/.test(hashIni)) {
    erroLink = /expired|otp_expired/i.test(hashIni) ? "O link de redefinição venceu ou já foi usado. Peça um novo em \"Esqueci minha senha\"." : "Não foi possível usar o link. Peça um novo em \"Esqueci minha senha\".";
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  // link colado na mesma aba em que o site já estava aberto: só o "#..." muda; recarrega para ler o link
  window.addEventListener("hashchange", () => { if (/(^|[#&])(type=recovery|error_code=|error=)/.test(location.hash)) location.reload(); });
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const NOMES = { gmap: "GMAP (gerência)", tecnico: "Técnico GMAP", consultivo: "Consultivo", empresa: "Empresa" };
  let EU = null;   // meu cadastro (para "Minha conta")
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
  async function carregarDados(equipe, gestao, gerencia) {
    const [linhas, ents, emps, muds, modelo, contatos, cfg, pend, conf] = await Promise.all([
      carregarTudo("os", "*"),
      carregarTudo("entidades", "*"),
      sb.from("empresas").select("*").order("nome"),
      equipe ? sb.from("entidades_mudancas").select("*").order("id", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
      sb.from("os_modelo").select("*").limit(1),
      equipe ? sb.from("entidade_contatos").select("*").limit(5000) : Promise.resolve({ data: [] }),
      sb.from("sistema_config").select("*").limit(1),
      equipe ? sb.from("planilha_pendencias").select("*").order("id", { ascending: false }).limit(1000) : Promise.resolve({ data: [] }),
      gestao ? carregarTudo("os_conferencias", "*").catch(() => []) : Promise.resolve([])
    ]);
    // medição: contratos, períodos, itens, preços (a empresa vê o próprio contrato); quantitativo, conferência e histórico só para a gestão
    const opc = (t, ok) => ok ? carregarTudo(t, "*").catch(() => []) : Promise.resolve([]);
    const [contratos, periodos, itens, precos, qtd, osItens, itensConf, log] = await Promise.all([
      opc("contratos", true), opc("contrato_periodos", true), opc("contrato_itens", true), opc("item_precos", true),
      gestao ? sb.from("item_quantidades").select("*").range(0, 9999).then(r => r.data || []) : Promise.resolve([]), opc("os_itens", true),
      gestao ? sb.from("os_itens_conf").select("*").range(0, 49999).then(r => r.data || []) : Promise.resolve([]),
      gestao ? sb.from("contratos_log").select("*").order("id", { ascending: false }).limit(300).then(r => r.data || []) : Promise.resolve([])
    ]);
    // auditoria: ocorrências verificadas pela gerência (sem a migração 011, a lista fica vazia e nada quebra)
    const auditoria = gerencia ? await carregarTudo("auditoria_verificacoes", "*").catch(() => []) : [];
    // conferência atual de cada O.S. = a última registrada
    const conferencias = {}; conf.forEach(c => { conferencias[c.os_id] = c; });
    return { rows: linhas.map(paraPainel), entidades: ents, empresasCad: emps.data || [], mudancas: muds.data || [],
             modelo: (modelo.data || [])[0] || null, contatos: contatos.data || [], config: (cfg.data || [])[0] || { planilha_ativa: false }, pendencias: pend.data || [], conferencias, auditoria,
             med: { contratos, periodos, itens, precos, qtd, osItens, itensConf, log } };
  }
  // Atualização parcial (tempo real): baixa só as O.S. indicadas, com os itens e a conferência delas, e junta aos dados atuais.
  // Uma O.S. que deixou de ser visível para o perfil sai da lista.
  async function carregarParcial(atual, ids, gestao) {
    ids = [...new Set(ids.map(String))];
    const [os, itens, conf] = await Promise.all([
      sb.from("os").select("*").in("id", ids),
      sb.from("os_itens").select("*").in("os_id", ids),
      gestao ? sb.from("os_conferencias").select("*").in("os_id", ids).order("id") : Promise.resolve({ data: [] })
    ]);
    const erro = [os, itens, conf].find(r => r.error); if (erro) throw erro.error;
    const novosItens = itens.data || [];
    const ic = gestao && novosItens.length ? await sb.from("os_itens_conf").select("*").in("os_item_id", novosItens.map(x => x.id)) : { data: [] };
    if (ic.error) throw ic.error;
    const em = new Set(ids), med = atual.med || {};
    const velhosItens = new Set((med.osItens || []).filter(x => em.has(String(x.os_id))).map(x => x.id));
    const porId = new Map((os.data || []).map(o => [String(o.id), paraPainel(o)]));
    const rows = atual.rows.filter(o => !em.has(String(o.id)) || porId.has(String(o.id))).map(o => porId.get(String(o.id)) || o);
    porId.forEach((o, k) => { if (!atual.rows.some(x => String(x.id) === k)) rows.push(o); });
    rows.sort((a, b) => a.id - b.id);
    const conferencias = Object.assign({}, atual.conferencias); ids.forEach(k => { delete conferencias[k]; });
    (conf.data || []).forEach(c => { conferencias[c.os_id] = c; });
    return { rows, conferencias, med: Object.assign({}, med, {
      osItens: (med.osItens || []).filter(x => !em.has(String(x.os_id))).concat(novosItens),
      itensConf: (med.itensConf || []).filter(k => !velhosItens.has(k.os_item_id)).concat(ic.data || []) }) };
  }
  async function iniciar() {
    show("carregando");
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { marcaRec.por(false); show("login"); if (erroLink) { $("lErr").textContent = erroLink; erroLink = ""; } return; }
    if (marcaRec.ler()) { $("ns1").value = $("ns2").value = ""; $("nsErr").textContent = ""; $("nsSub").textContent = "Conta: " + (session.user.email || "") + ". Escolha uma senha com pelo menos 8 caracteres."; return show("novaSenha"); }

    const { data: perfis, error: ep } = await sb.from("perfis").select("perfil, empresa, funcao, empresas, todas_empresas, nome, email, situacao").eq("user_id", session.user.id);
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
      const equipe = p.perfil === "gmap" || p.perfil === "tecnico", gestao = equipe || p.perfil === "consultivo";
      const [dados, sinc] = await Promise.all([
        carregarDados(equipe, gestao, p.perfil === "gmap"),
        sb.from("sincronizacoes").select("executada_em").order("id", { ascending: false }).limit(1)
      ]);
      sb.from("acessos").insert({ agente: navigator.userAgent.slice(0, 200) }).then(() => {});
      const perfil = p.perfil === "gmap" ? "gmap" : p.perfil === "tecnico" ? "tec" : p.perfil === "consultivo" ? "dir" : "emp:" + p.empresa;
      const perfilNome = p.perfil === "empresa" ? "Empresa: " + p.empresa : p.perfil === "consultivo" ? "Consultivo" + (p.funcao ? " · " + p.funcao : "") + (p.todas_empresas ? "" : (p.empresas || []).length ? " · " + p.empresas.join(", ") : "") : NOMES[p.perfil];
      EU = { nome: p.nome || "", email: p.email, perfilNome };
      $("uNome").textContent = p.nome || p.email;
      $("uPerfil").textContent = perfilNome;
      const ult = sinc.data && sinc.data[0];
      const naPlanilha = dados.config && dados.config.planilha_ativa;
      $("refd").textContent = "situação em " + hojeBR().split("-").reverse().join("/") + (naPlanilha ? (ult ? " · planilha sincronizada em " + fmtDH(ult.executada_em) : "") : " · dados em tempo real");

      show("app");
      const { data: emps } = await sb.rpc("empresas_disponiveis");
      const ctx = Object.assign(dados, { perfil, perfilNome, ref: hojeBR(), logo: new URL("assets/logo-seduc.png", location.href).href,
                      sb, uid: session.user.id, nome: p.nome || p.email, empresas: (emps || []).map(e => typeof e === "string" ? e : Object.values(e)[0]),
                      recarregar: () => carregarDados(equipe, gestao, p.perfil === "gmap"), recarregarParcial: ids => carregarParcial(ctx, ids, gestao) });
      iniciarPainel(ctx);
      if (!naPlanilha) ligarTempoReal(ctx);
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
  // Tempo real: quando outra pessoa muda uma O.S. (ou registra algo no histórico), a tela se atualiza sozinha.
  // Economia de dados: o aviso do Supabase só diz "algo mudou"; o painel pergunta ao banco quais movimentações são novas
  // (consulta mínima) e baixa só as O.S. envolvidas, com os itens e a conferência delas. Recarga completa só se muitas
  // O.S. mudaram de uma vez. Ouve apenas inclusões e alterações (exclusões não passam pelas regras de acesso no Supabase).
  // Espera 1,5 s para juntar várias mudanças; não atualiza com janela de diálogo aberta, com a aba escondida ou enquanto
  // a pessoa digita (atualiza assim que ela terminar). Se o canal cair, faz a mesma consulta mínima a cada 2 minutos.
  const LIMITE_PARCIAL = 50;
  function ligarTempoReal(ctx) {
    let t = null, pendente = false, rodando = false, ativo = false, ultimoId = null;
    const ids = new Set();
    // digitando = campo de texto ou lista com foco e tecla/escolha nos últimos 4 s (depois disso a tela pode se atualizar;
    // o painel devolve o foco ao mesmo campo)
    let ultimaTecla = 0; ["keydown", "input", "change"].forEach(ev => document.addEventListener(ev, () => { ultimaTecla = Date.now(); }, true));
    const digitando = () => { const a = document.activeElement;
      return Date.now() - ultimaTecla < 4000 && !!(a && a.closest && a.closest("#app") && a.matches("textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file])")); };
    const ocupado = () => document.hidden || !!document.querySelector("#dlg.on, #cfm.on, #alr.on") || rodando || digitando();
    // ignora o eco das próprias ações (a tela já foi atualizada por quem fez)
    const doMesmo = m => m && m.new && m.new.quem && m.new.quem === ctx.uid;
    const recente = () => Date.now() - (ctx.recarregadoEm || 0) < 4000;
    const agendar = m => {
      if (m && (doMesmo(m) || (m.table === "os" && recente()))) return;
      if (m && m.table === "os" && m.new && m.new.id != null) ids.add(String(m.new.id));
      pendente = true; clearTimeout(t); t = setTimeout(executar, 1500);
    };
    // número da última movimentação já conhecida (a consulta mínima pede só as posteriores)
    async function marco() {
      const { data, error } = await sb.from("os_eventos").select("id").order("id", { ascending: false }).limit(1);
      if (!error) ultimoId = data && data[0] ? data[0].id : 0;
    }
    ctx.marcoTempoReal = marco;
    async function executar() {
      if (!pendente) return;
      if (ocupado()) { clearTimeout(t); t = setTimeout(executar, 2000); return; }
      pendente = false; rodando = true;
      try {
        let tudo = false;
        if (ultimoId == null) await marco();
        else {
          const { data, error } = await sb.from("os_eventos").select("id, os_id, quem").gt("id", ultimoId).order("id").limit(200);
          if (error) throw error;
          (data || []).forEach(e => { ultimoId = Math.max(ultimoId, e.id); if (e.quem !== ctx.uid) ids.add(String(e.os_id)); });
          if ((data || []).length >= 200) tudo = true;
        }
        if (ids.size > LIMITE_PARCIAL) tudo = true;
        if (tudo || ids.size) {
          const lista = tudo ? null : [...ids]; ids.clear();
          if (ctx.atualizarTela) await ctx.atualizarTela({ tempoReal: true, ids: lista });
          if (tudo) await marco();
        }
      } catch (e) { pendente = true; /* tenta de novo na próxima mudança ou conferência */ }
      rodando = false; selo();
    }
    function selo() { const r = $("refd"); if (r) r.textContent = r.textContent.replace(/ · (dados em tempo real|atualização automática a cada 2 min)$/, "")
      + (ativo ? " · dados em tempo real" : " · atualização automática a cada 2 min"); }
    // ao voltar para a aba: confere o que mudou enquanto ela estava escondida (o canal pode ter caído nesse tempo)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) agendar(); });
    marco();
    try {
      sb.channel("painel-os")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "os" }, agendar)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "os" }, agendar)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "os_eventos" }, agendar)
        .subscribe(st => { ativo = st === "SUBSCRIBED"; selo(); });
    } catch (e) { ativo = false; }
    setInterval(() => { if (!ativo && !document.hidden) agendar(); }, 120000);
  }

  // Sair: tenta encerrar a sessão no servidor e, aconteça o que acontecer, apaga a sessão deste navegador.
  // Resposta imediata na tela ("Saindo…"); o servidor tem no máximo 1,5 s para responder, e a sessão local é apagada de qualquer jeito.
  let saindo = false;
  async function sair() {
    if (saindo) return; saindo = true;
    ["bSair", "pSair"].forEach(id => { const b = $(id); if (b) { b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = "Saindo…"; } });
    document.body.classList.add("saindo");
    try { await Promise.race([sb.auth.signOut({ scope: "local" }), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* segue para a limpeza local */ }
    try { Object.keys(localStorage).filter(k => k.startsWith("sb-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    try { sb.removeAllChannels && sb.removeAllChannels(); } catch (e) {}
    location.replace(location.pathname);
  }
  $("bSair").onclick = sair;
  $("pSair").onclick = sair;

  // ---------- solicitar acesso ----------
  $("aCad").onclick = async ev => {
    ev.preventDefault();
    $("cErr").textContent = ""; show("cad");
    const { data } = await sb.rpc("empresas_disponiveis");
    const nomes = (data || []).map(e => typeof e === "string" ? e : Object.values(e)[0]).map(e => String(e).replace(/[<>"&]/g, ""));
    $("cEmpresa").innerHTML = '<option value="">Selecione</option>' + nomes.map(e => `<option>${e}</option>`).join("");
    $("cEmpsL").innerHTML = nomes.map(e => `<label class="chk1"><input type="checkbox" class="cEmp" value="${e}"><span>${e}</span></label>`).join("");
  };
  $("aLogin").onclick = ev => { ev.preventDefault(); show("login"); };

  // ---------- Esqueci minha senha ----------
  // A mensagem é sempre a mesma, exista ou não o cadastro (para ninguém usar a tela para descobrir e-mails).
  const urlRetorno = () => location.origin + location.pathname;
  async function enviarLinkSenha(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlRetorno() });
    if (!error) return null;
    if (error.status === 429 || /security purposes|rate limit|after \d+ seconds/i.test(error.message || "")) return "Aguarde um minuto antes de pedir outro link para este e-mail.";
    return "Não foi possível enviar o link agora. Tente mais tarde ou fale com a GMAP.";
  }
  window.enviarLinkSenha = enviarLinkSenha;
  $("aEsq").onclick = ev => { ev.preventDefault(); $("rEmail").value = $("lEmail").value.trim(); $("rErr").textContent = ""; $("rOk").textContent = ""; show("rec"); $("rEmail").focus(); };
  $("aLogin2").onclick = ev => { ev.preventDefault(); show("login"); };
  UI.aoEnviar("fRec", async ev => {
    ev.preventDefault();
    $("rErr").textContent = ""; $("rOk").textContent = "";
    const email = $("rEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) { $("rErr").textContent = "Informe um e-mail válido."; return; }
    $("rBtn").disabled = true;
    const erro = await enviarLinkSenha(email);
    if (erro) { $("rErr").textContent = erro; $("rBtn").disabled = false; return; }
    $("rOk").textContent = "Se este e-mail estiver cadastrado, você vai receber em instantes um link para criar uma senha nova. Confira também a caixa de spam.";
    setTimeout(() => { $("rBtn").disabled = false; }, 60000);   // evita pedidos repetidos
  });
  // tela de nova senha (aberta pelo link do e-mail)
  sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY" && !marcaRec.ler()) { marcaRec.por(true); iniciar(); } });
  UI.aoEnviar("fNovaSenha", async ev => {
    ev.preventDefault();
    $("nsErr").textContent = "";
    if ($("ns1").value.length < 8) { $("nsErr").textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
    if ($("ns1").value !== $("ns2").value) { $("nsErr").textContent = "As duas senhas não conferem."; return; }
    $("nsBtn").disabled = true;
    const { error } = await sb.auth.updateUser({ password: $("ns1").value });
    $("nsBtn").disabled = false;
    if (error) {
      $("nsErr").textContent = /different from the old|same password/i.test(error.message) ? "A senha nova precisa ser diferente da anterior."
        : /at least|weak|characters/i.test(error.message) ? "Senha fraca ou curta. Use pelo menos 8 caracteres, misturando letras e números."
        : /session|expired|jwt/i.test(error.message) ? "O link venceu. Peça um novo em \"Esqueci minha senha\"." : "Não foi possível salvar: " + error.message;
      return;
    }
    marcaRec.por(false); $("ns1").value = $("ns2").value = "";
    iniciar().then(() => UI.aviso && UI.aviso("Senha alterada. Use a nova senha nos próximos acessos.", "ok"));
  });
  $("nsCanc").onclick = async ev => { ev.preventDefault(); marcaRec.por(false); try { await sb.auth.signOut({ scope: "local" }); } catch (e) {} show("login"); };
  $("cPerfil").onchange = () => { const v = $("cPerfil").value; $("lEmp").hidden = v !== "empresa"; $("cEmpresa").required = v === "empresa";
    $("lFun").hidden = v !== "consultivo"; $("lFunO").hidden = v !== "consultivo" || $("cFuncao").value !== "outra"; $("lEmps").hidden = v !== "consultivo"; };
  $("cTodas").onchange = () => document.querySelectorAll(".cEmp").forEach(c => { c.disabled = $("cTodas").checked; if (c.disabled) c.checked = false; });
  $("cFuncao").onchange = () => { $("lFunO").hidden = $("cFuncao").value !== "outra"; if (!$("lFunO").hidden) $("cFuncaoO").focus(); };
  UI.aoEnviar("fCad", async ev => {
    ev.preventDefault();
    $("cErr").textContent = "";
    const faltaC = [["cNome", "Nome"], ["cEmail", "E-mail"], ["cS1", "Senha"], ["cS2", "Confirmação da senha"]].filter(([i]) => !$(i).value.trim());
    if (faltaC.length) return UI.alerta({ titulo: "Preencha os campos obrigatórios", itens: faltaC.map(x => x[1]), campos: faltaC.map(x => $(x[0])) });
    if ($("cS1").value.length < 8) return UI.alerta({ titulo: "Senha curta", itens: "A senha precisa ter pelo menos 8 caracteres.", campos: [$("cS1")] });
    if ($("cS1").value !== $("cS2").value) return UI.alerta({ titulo: "As senhas não conferem", itens: "Digite a mesma senha nos dois campos.", campos: [$("cS2")] });
    const perfil = $("cPerfil").value, empresa = perfil === "empresa" ? $("cEmpresa").value : null;
    if (perfil === "empresa" && !empresa) return UI.alerta({ titulo: "Selecione a empresa", itens: "Para o perfil Empresa, escolha a empresa na lista.", campos: [$("cEmpresa")] });
    const funcao = perfil !== "consultivo" ? null : $("cFuncao").value === "outra" ? $("cFuncaoO").value.trim() : $("cFuncao").value;
    if (perfil === "consultivo" && (!funcao || funcao.length < 2)) return UI.alerta({ titulo: "Informe a função", itens: "Para o perfil Consultivo, diga a função (Diretoria, Fiscal de contrato ou outra).", campos: [$("cFuncao").value === "outra" ? $("cFuncaoO") : $("cFuncao")] });
    const todas_empresas = perfil === "consultivo" && $("cTodas").checked, empresas = perfil !== "consultivo" || todas_empresas ? [] : [...document.querySelectorAll(".cEmp:checked")].map(c => c.value);
    if (perfil === "consultivo" && !todas_empresas && !empresas.length) return UI.alerta({ titulo: "Escolha as empresas", itens: "Marque as empresas que vai fiscalizar, ou \"Todas as empresas\".", campos: [$("cTodas")] });
    $("cBtn").disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: $("cEmail").value.trim(), password: $("cS1").value,
      options: { data: { nome: $("cNome").value.trim(), perfil, empresa, funcao, ...(perfil === "consultivo" ? { empresas, todas_empresas } : {}) } }
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

  $("bSenha").onclick = () => { $("sErr").textContent = ""; $("s1").value = ""; $("s2").value = ""; $("sNome").value = EU ? EU.nome : "";
    $("sPerf").textContent = EU ? EU.email + " · " + EU.perfilNome : ""; $("dSenha").classList.add("on"); setTimeout(() => $("sNome").focus(), 50); };
  $("sCanc").onclick = () => $("dSenha").classList.remove("on");
  UI.aoEnviar("fSenha", async ev => {
    ev.preventDefault();
    const nome = $("sNome").value.trim().replace(/\s+/g, " "), trocaSenha = !!($("s1").value || $("s2").value), trocaNome = EU && nome !== EU.nome;
    if (nome.length < 3) return UI.alerta({ titulo: "Informe o nome completo", itens: "O nome precisa ter pelo menos 3 caracteres.", campos: [$("sNome")] });
    if (trocaSenha && $("s1").value.length < 8) return UI.alerta({ titulo: "Senha curta", itens: "A senha precisa ter pelo menos 8 caracteres.", campos: [$("s1")] });
    if (trocaSenha && $("s1").value !== $("s2").value) return UI.alerta({ titulo: "As senhas não conferem", itens: "Digite a mesma senha nos dois campos.", campos: [$("s2")] });
    if (!trocaNome && !trocaSenha) { $("dSenha").classList.remove("on"); return; }
    const feito = [];
    if (trocaNome) {
      const { data: novo, error } = await sb.rpc("meu_nome", { p_nome: nome });
      if (error) { $("sErr").textContent = "Não foi possível salvar o nome: " + error.message; return; }
      EU.nome = novo; $("uNome").textContent = novo; feito.push("Nome salvo.");
    }
    if (trocaSenha) {
      const { error } = await sb.auth.updateUser({ password: $("s1").value });
      if (error) { $("sErr").textContent = feito.concat("Não foi possível alterar a senha: " + error.message).join(" "); return; }
      feito.push("Senha alterada.");
    }
    $("sErr").style.color = "var(--ok)"; $("sErr").textContent = feito.join(" ");
    setTimeout(() => { $("dSenha").classList.remove("on"); $("sErr").style.color = ""; }, 1200);
  });

  iniciar();
})();
