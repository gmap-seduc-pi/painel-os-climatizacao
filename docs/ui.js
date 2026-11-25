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
    desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', standby: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    retomar: '<path d="m6 4 14 8-14 8Z"/>', cancelar: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    revisao: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    manter: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>', aprovar: '<path d="M20 6 9 17l-5-5"/>', devolver: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    config: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    limpar: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    anterior: '<path d="m15 18-6-6 6-6"/>', proxima: '<path d="m9 18 6-6-6-6"/>',
    usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    recusar: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', reenviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    imprimir: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    subir: '<path d="m18 15-6-6-6 6"/>', descer: '<path d="m6 9 6 6 6-6"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    abrir: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    aplicar: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
  };
  const icone = n => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.manter}</svg>`;
  /** Botão de ícone com a descrição aparecendo ao passar o cursor (e escrita embaixo em telas de toque). */
  const botaoIcone = (acao, rotulo, classe) => `<button type="button" class="ib ${classe || ""}" data-acao="${esc(acao)}" aria-label="${esc(rotulo)}" data-tip="${esc(rotulo)}">${icone(acao)}<span class="ibt">${esc(rotulo)}</span></button>`;

  // descrição dos botões de ícone: um balão único, posicionado na tela inteira e sempre dentro da área visível
  let balao = null;
  function mostrarBalao(el) {
    if (!balao) { balao = document.createElement("div"); balao.className = "balao"; balao.setAttribute("role", "tooltip"); document.body.appendChild(balao); }
    balao.textContent = el.dataset.tip; balao.style.display = "block";
    const r = el.getBoundingClientRect(), b = balao.getBoundingClientRect(), m = 8;
    let x = r.left + r.width / 2 - b.width / 2, y = r.top - b.height - 8;
    if (y < m) y = r.bottom + 8;
    x = Math.max(m, Math.min(x, window.innerWidth - b.width - m));
    balao.style.left = x + "px"; balao.style.top = y + "px";
  }
  const esconderBalao = () => { if (balao) balao.style.display = "none"; };
  const temHover = !window.matchMedia || window.matchMedia("(hover: hover)").matches;
  const alvo = e => e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
  document.addEventListener("mouseover", e => { const el = alvo(e); if (el && temHover) mostrarBalao(el); });
  document.addEventListener("mouseout", e => { const el = alvo(e); if (el && !el.contains(e.relatedTarget)) esconderBalao(); });
  document.addEventListener("focusin", e => { const el = alvo(e); try { if (el && el.matches(":focus-visible")) mostrarBalao(el); } catch (x) {} });
  document.addEventListener("focusout", esconderBalao);
  document.addEventListener("scroll", esconderBalao, true);
  document.addEventListener("click", esconderBalao, true);

  // ---------- O.S. assinada: PDF pronto ou fotos (uma por página) convertidas em PDF no próprio aparelho ----------
  const MAX_ANEXO = 10 * 1024 * 1024, MAX_FOTOS = 12;
  const tamanho = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  const ehPdf = f => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
  const ehFoto = f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);
  /** Campo de anexo para os diálogos: "Tirar foto" (abre a câmera no celular) e "Escolher arquivo" (PDF ou fotos). */
  function campoAnexo(id, rotulo, dica) {
    return `<div class="fl anx" id="dc_${id}"><span>${rotulo}</span>
      <div class="anxb"><label class="btn pri anxbt">${icone("camera")}<span>Tirar foto</span><input type="file" class="vh" id="dc_${id}_foto" accept="image/*" capture="environment"></label>
        <label class="btn anxbt">${icone("pdf")}<span>Escolher arquivo</span><input type="file" class="vh" id="dc_${id}_arq" accept="application/pdf,.pdf,image/*" multiple></label></div>
      <div class="anxl" aria-live="polite"></div>${dica ? `<small>${esc(dica)}</small>` : ""}</div>`;
  }
  function ligarAnexo(el) {
    el._anexo = { pdf: null, fotos: [] }; let urls = [];
    const desenhar = () => {
      urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
      const a = el._anexo, L = el.querySelector(".anxl");
      if (a.pdf) L.innerHTML = `<div class="anxpdf">${icone("pdf")}<span><b>${esc(a.pdf.name)}</b><small>${tamanho(a.pdf.size)}</small></span><button type="button" class="btn" data-rm="pdf">Remover</button></div>`;
      else if (a.fotos.length) L.innerHTML = `<div class="anxfotos">${a.fotos.map((f, i) => { const u = URL.createObjectURL(f); urls.push(u);
          return `<figure><img src="${u}" alt="Página ${i + 1}"><figcaption>Pág. ${i + 1}</figcaption><button type="button" data-rm="${i}" aria-label="Remover a página ${i + 1}">×</button></figure>`; }).join("")}</div>
        <small class="anxinfo">${a.fotos.length} foto${a.fotos.length > 1 ? "s" : ""}: viram um PDF com uma página por foto. Se a O.S. tiver mais páginas, toque em "Tirar foto" de novo.</small>`;
      else L.innerHTML = "";
      el.querySelector(".anxbt span").textContent = a.fotos.length ? "Foto da próxima página" : "Tirar foto";
      L.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { if (b.dataset.rm === "pdf") a.pdf = null; else a.fotos.splice(+b.dataset.rm, 1); desenhar(); });
    };
    const receber = inp => {
      const L = [...inp.files]; inp.value = ""; if (!L.length) return;
      const pdfs = L.filter(ehPdf), fotos = L.filter(f => !ehPdf(f) && ehFoto(f));
      if (L.length > pdfs.length + fotos.length) return alerta({ titulo: "Arquivo não aceito", itens: "Envie um PDF ou fotos (JPG, PNG)." });
      if (pdfs.length > 1 || (pdfs.length && fotos.length)) return alerta({ titulo: "Escolha só um PDF", itens: "Envie um único PDF da O.S. assinada, ou então fotos das páginas." });
      if (pdfs.length) { el._anexo = { pdf: pdfs[0], fotos: [] }; return desenhar(); }
      const a = el._anexo; a.pdf = null;
      if (a.fotos.length + fotos.length > MAX_FOTOS) return alerta({ titulo: "Fotos demais", itens: `Envie até ${MAX_FOTOS} fotos (uma por página).` });
      a.fotos.push(...fotos); desenhar();
    };
    el.querySelectorAll("input[type=file]").forEach(i => i.onchange = () => receber(i));
    desenhar();
  }
  const valorAnexo = el => el._anexo && (el._anexo.pdf || el._anexo.fotos.length) ? el._anexo : null;
  async function jpeg(arquivo, max = 1800, q = 0.72) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error(`Não foi possível ler a foto "${arquivo.name}". Tire a foto de novo ou envie em JPG.`)); i.src = url; });
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const b = await new Promise(ok => c.toBlob(ok, "image/jpeg", q)); if (!b) throw new Error("Não foi possível preparar a foto.");
      return { w, h, bytes: new Uint8Array(await b.arrayBuffer()) };
    } finally { URL.revokeObjectURL(url); }
  }
  /** Junta as fotos num PDF simples (uma página por foto, largura de folha A4). */
  async function fotosParaPdf(fotos) {
    const pags = []; for (const f of fotos) pags.push(await jpeg(f));
    const enc = new TextEncoder(), partes = [], offs = []; let pos = 0;
    const add = x => { const u = typeof x === "string" ? enc.encode(x) : x; partes.push(u); pos += u.length; };
    const obj = (id, corpo) => { offs[id] = pos; add(id + " 0 obj\n"); corpo.forEach(add); add("\nendobj\n"); };
    add("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    obj(2, [`<< /Type /Pages /Kids [${pags.map((_, i) => (3 + 3 * i) + " 0 R").join(" ")}] /Count ${pags.length} >>`]);
    pags.forEach((p, i) => {
      const W = 595.28, H = +(W * p.h / p.w).toFixed(2), pg = 3 + 3 * i, ct = pg + 1, im = pg + 2, cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      obj(pg, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`]);
      obj(ct, [`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`]);
      obj(im, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`, p.bytes, "\nendstream"]);
    });
    const total = 3 + 3 * pags.length, xref = pos;
    add(`xref\n0 ${total}\n0000000000 65535 f \n`); for (let i = 1; i < total; i++) add(String(offs[i]).padStart(10, "0") + " 00000 n \n");
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(partes, { type: "application/pdf" });
  }
  /** Devolve { blob, nome } pronto para enviar, ou lança o erro em texto. */
  async function pdfDoAnexo(a) {
    if (a.pdf) {
      if (!ehPdf(a.pdf)) throw new Error("O arquivo precisa ser PDF.");
      if (a.pdf.size > MAX_ANEXO) throw new Error("O PDF passa de 10 MB. Tire fotos das páginas: o sistema reduz o tamanho.");
      return { blob: a.pdf, nome: a.pdf.name };
    }
    const blob = await fotosParaPdf(a.fotos);
    if (blob.size > MAX_ANEXO) throw new Error("As fotos passaram de 10 MB mesmo reduzidas. Envie menos páginas por vez.");
    return { blob, nome: `os-assinada-fotos-${a.fotos.length}p.pdf` };
  }

  // ---------- celular: tabelas viram cartões; cada célula recebe o título da coluna ----------
  function rotularTabelas() {
    document.querySelectorAll("#app table:not(.mx):not(#tb):not(.nocard), #dlg table:not(.mx):not(.nocard)").forEach(t => {
      const th = t.tHead && t.tHead.rows[0] ? [...t.tHead.rows[0].cells].map(c => c.textContent.trim()) : null; if (!th) return;
      t.classList.add("tcard");
      for (const tb of t.tBodies) for (const tr of tb.rows) [...tr.cells].forEach((td, i) => {
        if (td.colSpan > 1) { td.classList.add("tc-cheia"); return; }
        if (!td.hasAttribute("data-label")) { if (th[i]) td.setAttribute("data-label", th[i]); else td.classList.add("tc-sem"); }
      });
    });
  }
  let agendado = false;
  new MutationObserver(() => { if (agendado) return; agendado = true; requestAnimationFrame(() => { agendado = false; rotularTabelas(); }); })
    .observe(document.documentElement, { childList: true, subtree: true });

  // ---------- arquivo .zip simples (sem compressão: os PDFs já são comprimidos) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  /** Junta arquivos [{nome, bytes}] num .zip. Nomes repetidos ganham (2), (3)... */
  function zip(arquivos) {
    const enc = new TextEncoder(), partes = [], central = []; let pos = 0; const usados = {};
    const agora = new Date(), hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1), data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    for (const a of arquivos) {
      let nome = a.nome; if (usados[nome]) { usados[nome]++; nome = nome.replace(/(\.[^.]+)?$/, m => ` (${usados[a.nome]})` + m); } else usados[nome] = 1;
      const n = enc.encode(nome), b = a.bytes, crc = crc32(b);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, hora, true); h.setUint16(12, data, true);
      h.setUint32(14, crc, true); h.setUint32(18, b.length, true); h.setUint32(22, b.length, true); h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, hora, true); c.setUint16(14, data, true);
      c.setUint32(16, crc, true); c.setUint32(20, b.length, true); c.setUint32(24, b.length, true); c.setUint16(28, n.length, true); c.setUint32(42, pos, true);
      partes.push(h, n, b); central.push(c, n); pos += 30 + n.length + b.length;
    }
    const tamC = central.reduce((s, x) => s + (x.byteLength ?? x.length), 0), fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true); fim.setUint32(12, tamC, true); fim.setUint32(16, pos, true);
    return new Blob([...partes, ...central, fim], { type: "application/zip" });
  }

  // nome do status na tela: "Stand by" passou a se chamar "Problema" (o valor no banco continua o mesmo)
  const rotStatus = st => st === "Stand by" ? "Problema" : st;
  window.UI = { rotStatus, aoEnviar, confirmar, escolher, alerta, icone, botaoIcone, esc, campoAnexo, ligarAnexo, valorAnexo, pdfDoAnexo, fotosParaPdf, zip };
})();
