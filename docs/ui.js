/* Painel de O.S. de Climatização · GMAP | SEDUC-PI
   Utilitários de interface usados por todas as telas.
   Não usamos o envio nativo de formulário nem confirm()/alert() do navegador: em páginas
   incorporadas ou protegidas eles podem ser bloqueados e o botão parece "não fazer nada". */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Liga a ação de um formulário ao clique do botão principal e à tecla Enter (fora de áreas de texto). */
  function aoEnviar(form, fn) {
    if (typeof form === "string") form = $(form);
    if (!form) return;
    let ocupado = false;
    const rodar = async ev => {
      if (ev) ev.preventDefault();
      if (ocupado) return;
      ocupado = true;
      try { await fn(ev); } finally { ocupado = false; }
    };
    form.addEventListener("submit", rodar);
    form.querySelectorAll('button[type="submit"],button:not([type])').forEach(b => { b.type = "button"; b.addEventListener("click", rodar); });
    form.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && ev.target.tagName === "INPUT" && !["checkbox", "radio", "file", "button"].includes(ev.target.type)) rodar(ev);
    });
  }

  /** Janela de confirmação própria. Resolve true (confirmou) ou false. */
  function confirmar({ titulo, texto, botao, perigo, voltar }) {
    return new Promise(res => {
      let d = $("cfm"); if (!d) { d = document.createElement("div"); d.id = "cfm"; d.className = "dlg cfm"; document.body.appendChild(d); }
      d.innerHTML = `<div class="dlgp" role="alertdialog" aria-modal="true" aria-labelledby="cfmT"><h2 id="cfmT">${esc(titulo)}</h2>${texto ? `<div class="sub">${texto}</div>` : ""}
        <div class="dlgb"><button type="button" class="btn" id="cfmN">${esc(voltar || "Voltar")}</button><button type="button" class="btn ${perigo ? "no" : "pri"}" id="cfmS">${esc(botao || "Confirmar")}</button></div></div>`;
      d.classList.add("on");
      const fim = v => { d.classList.remove("on"); document.removeEventListener("keydown", tecla); res(v); };
      const tecla = e => { if (e.key === "Escape") fim(false); };
      document.addEventListener("keydown", tecla);
      $("cfmN").onclick = () => fim(false); $("cfmS").onclick = () => fim(true);
      setTimeout(() => $("cfmS").focus(), 30);
    });
  }

  /** Escolha entre várias opções (ex.: manter rascunho, descartar). Resolve o id do botão clicado ou null. */
  function escolher({ titulo, texto, opcoes }) {
    return new Promise(res => {
      let d = $("cfm"); if (!d) { d = document.createElement("div"); d.id = "cfm"; d.className = "dlg cfm"; document.body.appendChild(d); }
      d.innerHTML = `<div class="dlgp" role="alertdialog" aria-modal="true"><h2>${esc(titulo)}</h2>${texto ? `<div class="sub">${texto}</div>` : ""}
        <div class="dlgb">${opcoes.map(o => `<button type="button" class="btn ${o.classe || ""}" data-id="${esc(o.id)}">${esc(o.rotulo)}</button>`).join("")}</div></div>`;
      d.classList.add("on");
      const fim = v => { d.classList.remove("on"); res(v); };
      d.querySelectorAll("button").forEach(b => b.onclick = () => fim(b.dataset.id));
      d.onclick = e => { if (e.target === d) fim(null); };
    });
  }

  /** Aviso em destaque quando algo impede a ação. "campos" são elementos a destacar; o primeiro recebe o foco. */
  function alerta({ titulo, itens, campos }) {
    document.querySelectorAll(".invalido").forEach(e => e.classList.remove("invalido"));
    (campos || []).filter(Boolean).forEach(e => e.classList.add("invalido"));
    return new Promise(res => {
      let d = $("alr"); if (!d) { d = document.createElement("div"); d.id = "alr"; d.className = "dlg alr"; document.body.appendChild(d); }
      const L = Array.isArray(itens) ? itens : [itens];
      d.innerHTML = `<div class="dlgp" role="alertdialog" aria-modal="true" aria-labelledby="alrT"><div class="alrh"><span class="alri" aria-hidden="true">!</span><h2 id="alrT">${esc(titulo || "Não foi possível continuar")}</h2></div>
        ${L.length > 1 ? `<ul>${L.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p>${esc(L[0] || "")}</p>`}
        <div class="dlgb"><button type="button" class="btn pri" id="alrOk">Entendi, vou corrigir</button></div></div>`;
      d.classList.add("on");
      const fim = () => {
        d.classList.remove("on"); document.removeEventListener("keydown", tecla);
        const c = (campos || []).filter(Boolean)[0];
        if (c) { c.scrollIntoView({ block: "center", behavior: "smooth" }); const f = c.matches("input,select,textarea") ? c : c.querySelector("input,select,textarea,button"); if (f) setTimeout(() => f.focus({ preventScroll: true }), 250); }
        res();
      };
      const tecla = e => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); fim(); } };
      document.addEventListener("keydown", tecla);
      $("alrOk").onclick = fim;
      setTimeout(() => $("alrOk").focus(), 30);
    });
  }
  // ao corrigir um campo destacado, o destaque some
  document.addEventListener("input", e => { const c = e.target.closest(".invalido"); if (c) c.classList.remove("invalido"); }, true);
  document.addEventListener("change", e => { const c = e.target.closest(".invalido"); if (c) c.classList.remove("invalido"); }, true);

  // Ícones (traço simples, herdam a cor do botão)
  const P = {
    atender: '<path d="M20 6 9 17l-5-5"/>', corrigir: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', standby: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    retomar: '<path d="m6 4 14 8-14 8Z"/>', cancelar: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    revisao: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    manter: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', aprovar: '<path d="M20 6 9 17l-5-5"/>', devolver: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    recusar: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', reenviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    imprimir: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    subir: '<path d="m18 15-6-6-6 6"/>', descer: '<path d="m6 9 6 6 6-6"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>'
  };
  const icone = n => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.manter}</svg>`;
  /** Botão de ícone com a descrição aparecendo ao passar o cursor (e escrita embaixo em telas de toque). */
  const botaoIcone = (acao, rotulo, classe) => `<button type="button" class="ib ${classe || ""}" data-acao="${esc(acao)}" aria-label="${esc(rotulo)}" data-tip="${esc(rotulo)}">${icone(acao)}<span class="ibt">${esc(rotulo)}</span></button>`;

  window.UI = { aoEnviar, confirmar, escolher, alerta, icone, botaoIcone, esc };
})();
