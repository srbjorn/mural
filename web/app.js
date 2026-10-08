import { firebaseConfig } from "./firebase-config.js";

/* ============ Constantes ============ */
const NOME = { bjorn: "Bjørn", yoshiro: "Yoshiro" };
const CLS = { bjorn: "bj", yoshiro: "yo" };
// Foto de perfil: rosto da figurinha de cada um, com anel na cor dele (Bjørn roxo, Yoshiro verde).
const ROSTO = { bjorn: "img/rosto-bjorn.webp", yoshiro: "img/rosto-yoshiro.webp" };
const marca = (q, extra = "") => `<img class="mk ${CLS[q] || ""} ${extra}" src="${ROSTO[q] || ROSTO.bjorn}" alt="" aria-hidden="true">`;
const TIPO = { nota: "Anotação", checklist: "Checklist", evento: "Evento", meta: "Meta", aniversario: "Aniversário" };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TIPO_PLURAL = { tudo: "Tudo", nota: "Anotações", checklist: "Checklists", evento: "Eventos", meta: "Metas" };
const PRIO = { 3: "Muito importante", 2: "Importante", 1: "Menos importante" };
const outro = (q) => (q === "bjorn" ? "yoshiro" : "bjorn");

const ponte = window.AndroidBridge || null; // existe só dentro do app Android
const params = new URLSearchParams(location.search);
const configurado = firebaseConfig.apiKey && firebaseConfig.apiKey !== "COLE_AQUI";
const DEMO = params.has("demo") || !configurado;

/* ============ Utilidades ============ */
const $app = document.getElementById("app");
const $layer = document.getElementById("layer");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => ymd(new Date());
const somaDias = (str, n) => { const d = new Date(str + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const limpa = (s) => s.replace(/\./g, "");
function fmtDia(str) {
  if (!str) return "";
  const h = hoje();
  if (str === h) return "Hoje";
  if (str === somaDias(h, 1)) return "Amanhã";
  if (str === somaDias(h, -1)) return "Ontem";
  const d = new Date(str + "T12:00:00");
  return limpa(d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }));
}
function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function ler(k, padrao) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? padrao; } catch { return padrao; } }
let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ============ Estado ============ */
const S = {
  backend: null,
  user: null,          // { uid, email }
  pessoas: {},         // uid -> { quem, vistoEm }
  itens: [],
  pronto: false,
  erro: "",
  modo: "entrar",      // tela de entrada: entrar | criar
  ui: Object.assign({ vista: "quadro", prio: 3, tipo: "tudo", autor: "todos", concluidos: false, mes: hoje().slice(0, 7), dia: null }, ler("mural-ui", {})),
};
const eu = () => S.pessoas[S.user?.uid]?.quem || null;
const vistoEm = () => S.pessoas[S.user?.uid]?.vistoEm || 0;
function salvarUi() { guardar("mural-ui", { vista: S.ui.vista, prio: S.ui.prio, tipo: S.ui.tipo, autor: S.ui.autor, concluidos: S.ui.concluidos }); }

/* ============ Aniversários ============ */
// Guardados com niver: "MM-DD" e ano (opcional); repetem todo ano e ficam fora das abas de importância.
const ehNiver = (it) => it.tipo === "aniversario" && /^\d\d-\d\d$/.test(it.niver || "");
const bissexto = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function dataNiver(y, md) {
  const [m, d] = md.split("-").map(Number);
  return m === 2 && d === 29 && !bissexto(y) ? new Date(y, 1, 28) : new Date(y, m - 1, d);
}
/** Próxima vez que o aniversário acontece: { data, dias, idade } (idade só se o ano for conhecido). */
function proxNiver(it) {
  const h = new Date(); h.setHours(0, 0, 0, 0);
  let d = dataNiver(h.getFullYear(), it.niver);
  if (d < h) d = dataNiver(h.getFullYear() + 1, it.niver);
  const dias = Math.round((d - h) / 864e5);
  const idade = Number(it.ano) > 1900 ? d.getFullYear() - Number(it.ano) : null;
  return { data: d, dias, idade };
}
const faltam = (dias) => (dias === 0 ? "Hoje!" : dias === 1 ? "Amanhã" : `Em ${dias} dias`);
const fmtNiver = (md) => { const [m, d] = md.split("-").map(Number); return `${d} de ${MESES[m - 1]}`; };
const aniversarios = () => S.itens.filter(ehNiver).map((it) => ({ it, ...proxNiver(it) })).sort((a, b) => a.dias - b.dias || a.it.titulo.localeCompare(b.it.titulo));

/* ============ Regras dos itens ============ */
function progresso(it) {
  const c = it.checklist || [];
  if (c.length) return Math.round((c.filter((x) => x.ok).length / c.length) * 100);
  return Math.max(0, Math.min(100, Number(it.progresso) || 0));
}
// Eventos de vários dias guardam dataFim ("até que dia"); o resto usa só data.
const fim = (it) => (it.dataFim && it.data && it.dataFim > it.data ? it.dataFim : it.data);
const noDia = (it, dia) => !!it.data && dia >= it.data && dia <= fim(it);
const atrasado = (it) => !it.feito && it.data && fim(it) < hoje();
/** "Hoje · 15:30", "sex, 16 out até dom, 18 out", "Acontecendo · até dom, 18 out", "Último dia". */
function fmtQuando(it) {
  const h = hoje(), hora = it.hora ? ` · ${esc(it.hora)}` : "";
  if (fim(it) === it.data) return fmtDia(it.data) + hora;
  if (noDia(it, h)) return fim(it) === h ? "Último dia" + hora : `Acontecendo · até ${fmtDia(fim(it)).toLowerCase()}`;
  return `${fmtDia(it.data)} até ${fmtDia(fim(it)).toLowerCase()}${hora}`;
}
const ehNovo = (it) => it.autor && it.autor !== eu() && (it.criadoEm || 0) > vistoEm();
const pendentes = () => S.itens.filter((i) => !i.feito && i.tipo !== "aniversario");
function ordenar(a, b) {
  const aa = atrasado(a) ? 0 : 1, bb = atrasado(b) ? 0 : 1;
  if (aa !== bb) return aa - bb;
  const da = (a.data || "9999") + (a.hora || ""), db = (b.data || "9999") + (b.hora || "");
  if (da !== db) return da < db ? -1 : 1;
  return (b.criadoEm || 0) - (a.criadoEm || 0);
}
function resumo() {
  const h = hoje(), p = pendentes();
  return {
    hoje: p.filter((i) => noDia(i, h)).length,
    urgentes: p.filter((i) => Number(i.prioridade) === 3).length,
    atrasados: p.filter(atrasado).length,
    novos: S.itens.filter(ehNovo).length,
    niverHoje: aniversarios().filter((a) => a.dias === 0).map((a) => a.it.titulo),
  };
}

/* ============ Backends ============ */
async function backendFirebase() {
  const V = "10.14.1";
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.getFirestore(app);
  }
  return {
    observarAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
    entrar: (e, s) => A.signInWithEmailAndPassword(auth, e, s),
    criar: (e, s) => A.createUserWithEmailAndPassword(auth, e, s),
    sair: () => A.signOut(auth),
    observarItens: (cb, erro) => F.onSnapshot(F.collection(db, "itens"), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), erro),
    observarPessoas: (cb, erro) => F.onSnapshot(F.collection(db, "pessoas"), (s) => { const m = {}; s.forEach((d) => (m[d.id] = d.data())); cb(m); }, erro),
    salvarItem: (id, o) => (id ? F.updateDoc(F.doc(db, "itens", id), o) : F.addDoc(F.collection(db, "itens"), o)),
    removerItem: (id) => F.deleteDoc(F.doc(db, "itens", id)),
    salvarPessoa: (uid, o) => F.setDoc(F.doc(db, "pessoas", uid), o, { merge: true }),
  };
}

function backendDemo() {
  // Dados de exemplo só para ver o visual sem Firebase (abre com ?demo).
  const h = hoje(), agora = Date.now();
  let itens = [
    { id: "d1", tipo: "evento", titulo: "Consulta no dentista", texto: "Levar a carteirinha do plano.", prioridade: 3, data: h, hora: "15:30", autor: "yoshiro", criadoEm: agora - 3600e3 },
    { id: "d2", tipo: "checklist", titulo: "Mercado da semana", texto: "", prioridade: 2, data: somaDias(h, 1), hora: "", autor: "bjorn", criadoEm: agora - 86400e3,
      checklist: [{ t: "Arroz", ok: true }, { t: "Café", ok: false }, { t: "Ração dos gatos", ok: false }, { t: "Detergente", ok: true }] },
    { id: "d3", tipo: "nota", titulo: "Senha nova do wi-fi está no caderno azul", texto: "Mudei ontem à noite.", prioridade: 1, data: null, hora: "", autor: "bjorn", criadoEm: agora - 2 * 86400e3 },
    { id: "d4", tipo: "meta", titulo: "Juntar para a viagem", texto: "", prioridade: 2, data: somaDias(h, 60), hora: "", autor: "yoshiro", criadoEm: agora - 5 * 86400e3,
      checklist: [{ t: "Reserva do hotel", ok: true }, { t: "Passagens", ok: false }, { t: "Passeios", ok: false }] },
    { id: "d5", tipo: "evento", titulo: "Aniversário de namoro", texto: "", prioridade: 3, data: somaDias(h, 6), hora: "20:00", autor: "bjorn", criadoEm: agora - 7 * 86400e3 },
    { id: "d11", tipo: "evento", titulo: "Ultimate Drift", texto: "Levar protetor e garrafa d'água.", prioridade: 2, data: somaDias(h, -1), dataFim: somaDias(h, 1), hora: "", autor: "bjorn", criadoEm: agora - 3 * 86400e3 },
    { id: "d6", tipo: "nota", titulo: "Pagar a conta de luz", texto: "Vence amanhã, boleto no email.", prioridade: 3, data: somaDias(h, -1), hora: "", autor: "yoshiro", criadoEm: agora - 600e3 },
    { id: "d7", tipo: "meta", titulo: "Treinar 3x por semana", texto: "", prioridade: 1, data: null, hora: "", autor: "bjorn", criadoEm: agora - 9 * 86400e3, progresso: 40, checklist: [] },
    { id: "d8", tipo: "aniversario", titulo: "Lucas", texto: "Gosta de jogo de tabuleiro.", prioridade: 0, data: null, hora: "", niver: h.slice(5), ano: 1996, autor: "yoshiro", criadoEm: agora - 20 * 86400e3 },
    { id: "d9", tipo: "aniversario", titulo: "Mari", texto: "", prioridade: 0, data: null, hora: "", niver: somaDias(h, 4).slice(5), ano: null, autor: "bjorn", criadoEm: agora - 30 * 86400e3 },
    { id: "d10", tipo: "aniversario", titulo: "Tia Rose", texto: "Ligar de manhã.", prioridade: 0, data: null, hora: "", niver: somaDias(h, 45).slice(5), ano: 1970, autor: "bjorn", criadoEm: agora - 40 * 86400e3 },
  ];
  let pessoas = { demo: { quem: "bjorn", vistoEm: agora - 2 * 3600e3 } };
  const fi = new Set(), fp = new Set();
  const emitir = () => { fi.forEach((f) => f(itens.map((i) => ({ ...i })))); fp.forEach((f) => f({ ...pessoas })); };
  return {
    observarAuth: (cb) => setTimeout(() => cb({ uid: "demo", email: "demo" }), 0),
    entrar: async () => {}, criar: async () => {}, sair: async () => toast("Na demonstração não dá para sair."),
    observarItens: (cb) => { fi.add(cb); setTimeout(() => cb(itens.map((i) => ({ ...i }))), 0); },
    observarPessoas: (cb) => { fp.add(cb); setTimeout(() => cb({ ...pessoas }), 0); },
    salvarItem: async (id, o) => { if (id) itens = itens.map((i) => (i.id === id ? { ...i, ...o } : i)); else itens.push({ id: "n" + Date.now(), ...o }); emitir(); },
    removerItem: async (id) => { itens = itens.filter((i) => i.id !== id); emitir(); },
    salvarPessoa: async (uid, o) => { pessoas = { ...pessoas, [uid]: { ...(pessoas[uid] || {}), ...o } }; emitir(); },
  };
}

/* ============ Inicialização ============ */
let paraItens = null, paraPessoas = null, primeiraAuth = true, acabouDeEntrar = false;
async function iniciar() {
  try {
    S.backend = DEMO ? backendDemo() : await backendFirebase();
  } catch (e) {
    console.error(e);
    $app.innerHTML = telaMensagem("Sem conexão", "Não consegui carregar o mural. Confira a internet e abra de novo.");
    return;
  }
  S.backend.observarAuth((u) => {
    const primeira = primeiraAuth; primeiraAuth = false;
    if (u && ponte && primeira && !acabouDeEntrar && !ponte.nativoLogado()) {
      // O widget precisa do login no app também: pede para entrar de novo uma vez.
      S.backend.sair(); S.erro = "Entre de novo para ligar o widget do celular."; return;
    }
    S.user = u;
    paraItens?.(); paraPessoas?.(); paraItens = paraPessoas = null;
    S.itens = []; S.pessoas = {}; S.pronto = false;
    if (u) {
      paraItens = S.backend.observarItens((lista) => { S.itens = lista; S.pronto = true; render(); }, erroDados);
      paraPessoas = S.backend.observarPessoas((m) => { S.pessoas = m; render(); }, erroDados);
    }
    render();
  });
}
function erroDados(e) {
  console.error(e);
  S.erro = e?.code === "permission-denied" ? "Esta conta não tem acesso ao mural." : "Não consegui ler o mural agora.";
  render();
}
function avisarNativo() { try { ponte?.atualizarWidget(); } catch {} }

/* ============ Versões novas ============ */
// versao.json é publicado junto com o site: { site, app, pc, apk, pcZip }.
const V = { carregada: null, atual: null };
const versaoDoApp = () => { try { return typeof ponte?.versaoApp === "function" ? Number(ponte.versaoApp()) : 0; } catch { return 0; } };
async function verificarVersao() {
  if (DEMO) return;
  try {
    const r = await fetch(`versao.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const v = await r.json();
    if (V.carregada === null) V.carregada = v.site;
    const antes = JSON.stringify(V.atual);
    V.atual = v;
    if (antes !== JSON.stringify(v) && S.user && eu()) render();
  } catch {}
}
function avisosDeVersao() {
  const v = V.atual;
  if (!v) return "";
  let html = "";
  if (ponte && Number(v.app) > versaoDoApp() && v.apk)
    html += `<p class="banner versao">Tem uma versão nova do app do celular. <a class="btn btn-small btn-main" href="${esc(v.apk)}">Baixar e instalar</a><span class="vazio">Instale por cima; as anotações não se perdem.</span></p>`;
  else if (V.carregada !== null && Number(v.site) > Number(V.carregada))
    html += `<p class="banner versao">Tem uma versão nova do mural. <button class="btn btn-small btn-main" data-act="recarregar">Atualizar agora</button></p>`;
  return html;
}

/* ============ Render ============ */
function render() {
  if (!S.user) { $app.innerHTML = telaEntrada(); return; }
  if (!S.pronto && !DEMO) { $app.innerHTML = telaMensagem("Abrindo o mural…", ""); return; }
  if (!eu()) { $app.innerHTML = telaQuem(); return; }
  $app.innerHTML = telaPainel();
  if (aberturaPendente) { const a = aberturaPendente; aberturaPendente = null; a(); }
}
let aberturaPendente = null;

function telaMensagem(titulo, texto) {
  return `<div class="gate"><div></div><div class="gate-card sticker"><h1>${esc(titulo)}</h1>${texto ? `<p>${esc(texto)}</p>` : ""}</div><div></div></div>`;
}

function telaEntrada() {
  const criar = S.modo === "criar";
  return `
  <div class="gate">
    <div class="gate-oc bj" aria-hidden="true">${marca("bjorn", "huge")}<span>Bjørn</span></div>
    <form class="gate-card sticker" id="f-entrar" novalidate>
      <h1>Mural do <span class="bj">Bjørn</span> &amp; do <span class="yo">Yoshiro</span></h1>
      <p>${criar ? "Crie a sua conta. Cada um de vocês usa a própria." : "Entre com a sua conta para ver o que vocês dois anotaram."}</p>
      <div class="field"><label for="in-email">Email</label><input class="input" id="in-email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="in-senha">Senha</label><input class="input" id="in-senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}" minlength="6" required></div>
      <p class="erro" role="alert">${esc(S.erro)}</p>
      <button class="btn btn-main" type="submit">${criar ? "Criar conta" : "Entrar"}</button>
      <button class="btn btn-ghost" type="button" data-act="modo">${criar ? "Já tenho conta" : "Primeira vez? Criar conta"}</button>
    </form>
    <div class="gate-oc yo" aria-hidden="true">${marca("yoshiro", "huge")}<span>Yoshiro</span></div>
  </div>`;
}

function telaQuem() {
  return `
  <div class="gate">
    <div></div>
    <div class="gate-card sticker">
      <h1>Quem é você?</h1>
      <p>Isso aparece nas suas anotações, para o outro saber quem escreveu.</p>
      <div class="picker">
        <button class="pick bj" data-act="souu" data-q="bjorn">${marca("bjorn", "huge")}Sou o Bjørn</button>
        <button class="pick yo" data-act="souu" data-q="yoshiro">${marca("yoshiro", "huge")}Sou o Yoshiro</button>
      </div>
      <button class="btn btn-ghost" data-act="sair">Sair desta conta</button>
    </div>
    <div></div>
  </div>`;
}

function topo() {
  const r = resumo(), meu = eu(), dele = outro(meu);
  const d = new Date();
  const dataLonga = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const contagem = (q) => pendentes().filter((i) => i.autor === q).length;
  return `
  <header class="top">
    <div class="top-oc bj">${marca("bjorn", "big")}<div class="who"><b>Bjørn</b><span>${contagem("bjorn")} pendentes</span></div></div>
    <div class="top-mid">
      <div class="top-row">
        <div class="date-big"><small>${saudacao()}, ${NOME[meu]}</small>${esc(dataLonga)}</div>
        <div class="top-actions">
          <button class="btn btn-small" data-act="aviso">Aviso do dia</button>
          <button class="btn btn-small btn-ghost" data-act="sair">Sair</button>
        </div>
      </div>
      <div class="pills">
        <span class="pill hoje">${r.hoje} pra hoje</span>
        ${r.niverHoje.length ? `<button class="pill niver" data-act="vista" data-v="niver">Aniversário hoje: ${esc(r.niverHoje.join(", "))}</button>` : ""}
        ${r.urgentes ? `<span class="pill p3">${r.urgentes} muito importante${r.urgentes > 1 ? "s" : ""}</span>` : ""}
        ${r.atrasados ? `<span class="pill p3">${r.atrasados} atrasad${r.atrasados > 1 ? "as" : "a"}</span>` : ""}
        ${r.novos ? `<button class="pill novo ${CLS[dele]}" data-act="visto">${r.novos} novidade${r.novos > 1 ? "s" : ""} do ${NOME[dele]} · marcar como visto</button>` : ""}
      </div>
    </div>
    <div class="top-oc yo">${marca("yoshiro", "big")}<div class="who"><b>Yoshiro</b><span>${contagem("yoshiro")} pendentes</span></div></div>
  </header>`;
}

function calendario() {
  const [y, m] = S.ui.mes.split("-").map(Number);
  const primeiro = new Date(y, m - 1, 1);
  const inicio = new Date(primeiro); inicio.setDate(1 - primeiro.getDay());
  const nomeMes = primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const porDia = {};
  for (const it of S.itens) {
    if (!it.data || it.feito) continue;
    // Um evento de vários dias aparece em cada dia, de data até dataFim (no máximo 60 dias).
    for (let s = it.data, n = 0; s <= fim(it) && n < 60; s = somaDias(s, 1), n++) (porDia[s] ||= []).push(it);
  }
  const nivers = S.itens.filter(ehNiver);
  const h = hoje();
  let cel = ["D", "S", "T", "Q", "Q", "S", "S"].map((w) => `<div class="wd" aria-hidden="true">${w}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio); d.setDate(inicio.getDate() + i);
    const s = ymd(d), lista = porDia[s] || [];
    const nv = nivers.filter((it) => ymd(dataNiver(d.getFullYear(), it.niver)) === s);
    const cls = ["day", d.getMonth() !== m - 1 && "fora", s === h && "hoje", s === S.ui.dia && "sel"].filter(Boolean).join(" ");
    const dots = nv.slice(0, 2).map((it) => `<i class="dot niver ${CLS[it.autor] || ""}"></i>`).join("") +
      lista.slice(0, 4 - Math.min(nv.length, 2)).map((it) => `<i class="dot ${CLS[it.autor] || ""} ${Number(it.prioridade) === 3 ? "p3" : ""}"></i>`).join("");
    const rot = `${d.getDate()} de ${d.toLocaleDateString("pt-BR", { month: "long" })}${lista.length ? `, ${lista.length} ${lista.length > 1 ? "itens" : "item"}` : ""}${nv.length ? `, aniversário de ${nv.map((x) => x.titulo).join(" e ")}` : ""}`;
    cel += `<button class="${cls}" data-act="dia" data-d="${s}" aria-label="${esc(rot)}" aria-pressed="${s === S.ui.dia}"><span>${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  return `
  <section class="panel sticker" aria-labelledby="h-cal">
    <div class="panel-h">
      <h2 id="h-cal">${esc(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1))}</h2>
      <div class="cal-nav">
        <button class="icon-btn" data-act="mes" data-n="-1" aria-label="Mês anterior">‹</button>
        <button class="btn btn-small" data-act="mes" data-n="0">Hoje</button>
        <button class="icon-btn" data-act="mes" data-n="1" aria-label="Próximo mês">›</button>
      </div>
    </div>
    <div class="cal">${cel}</div>
  </section>`;
}

function proximosEventos() {
  const h = hoje();
  const ev = S.itens.filter((i) => i.tipo === "evento" && !i.feito && i.data && fim(i) >= h).sort(ordenar).slice(0, 8);
  const lis = ev.map((it) => {
    const d = new Date(it.data + "T12:00:00");
    const f = new Date(fim(it) + "T12:00:00");
    const dias = fim(it) !== it.data ? (d.getMonth() === f.getMonth() ? `${d.getDate()}–${f.getDate()}` : `${d.getDate()}`) : `${d.getDate()}`;
    return `<li><button class="ev" data-act="editar" data-id="${esc(it.id)}">
      <span class="ev-date"><b>${dias}</b><span>${limpa(d.toLocaleDateString("pt-BR", { month: "short" }))}</span></span>
      <span><span class="ev-t">${esc(it.titulo)}</span><span class="ev-s"><i class="dot ${CLS[it.autor]}"></i>${fmtQuando(it)}</span></span>
    </button></li>`;
  }).join("");
  return `
  <section class="panel sticker" aria-labelledby="h-ev">
    <div class="panel-h"><h2 id="h-ev">Próximos eventos</h2><button class="btn btn-small" data-act="novo" data-tipo="evento">+ Evento</button></div>
    ${lis ? `<ul class="ev-list">${lis}</ul>` : `<p class="vazio">Nenhum evento marcado. Use “+ Evento” para pôr uma data no calendário.</p>`}
  </section>`;
}

function filtrados() {
  const u = S.ui;
  return S.itens.filter((it) =>
    Number(it.prioridade) === u.prio &&
    (u.tipo === "tudo" || it.tipo === u.tipo) &&
    (u.autor === "todos" || it.autor === u.autor) &&
    (!u.dia || noDia(it, u.dia)) &&
    (u.concluidos || !it.feito)
  ).sort(ordenar);
}

function cartao(it) {
  const q = it.autor, c = CLS[q] || "";
  const p = progresso(it);
  const checks = (it.checklist || []).length && it.tipo !== "meta" ? `
    <ul class="checks">${it.checklist.map((x, i) => `
      <li><label class="check ${x.ok ? "ok" : ""}"><input type="checkbox" data-act="ck" data-id="${esc(it.id)}" data-i="${i}" ${x.ok ? "checked" : ""}><span>${esc(x.t)}</span></label></li>`).join("")}
    </ul>` : "";
  const meta = it.tipo === "meta" ? `
    <div class="prog"><div class="prog-l"><span>Progresso</span><span>${p}%</span></div><div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i class="${c}" style="width:${p}%"></i></div></div>
    ${(it.checklist || []).length ? `<ul class="checks">${it.checklist.map((x, i) => `<li><label class="check ${x.ok ? "ok" : ""}"><input type="checkbox" data-act="ck" data-id="${esc(it.id)}" data-i="${i}" ${x.ok ? "checked" : ""}><span>${esc(x.t)}</span></label></li>`).join("")}</ul>` : ""}` : "";
  const badge = atrasado(it) ? `<span class="badge atraso">Atrasado</span>` : ehNovo(it) ? `<span class="badge novo ${c}">Novo</span>` : "";
  const quando = it.data ? `<span class="when">${it.tipo === "meta" ? "Prazo: " : ""}${fmtQuando(it)}</span>` : "";
  const contagem = (it.checklist || []).length && it.tipo === "checklist" ? ` · ${it.checklist.filter((x) => x.ok).length}/${it.checklist.length}` : "";
  return `
  <article class="item sticker ${c} ${it.feito ? "feito" : ""}" data-card="${esc(it.id)}">
    <div class="item-top">
      ${marca(q)}
      <div class="item-meta"><b class="${c}">${NOME[q] || "Alguém"}</b><span>${TIPO[it.tipo] || "Anotação"}${contagem}</span></div>
      ${badge}
    </div>
    <h3 class="item-t">${esc(it.titulo)}</h3>
    ${quando}
    ${it.texto ? `<p class="item-x">${esc(it.texto)}</p>` : ""}
    ${checks}${meta}
    <div class="item-foot" data-foot="${esc(it.id)}">
      <button class="btn btn-small" data-act="feito" data-id="${esc(it.id)}">${it.feito ? "Reabrir" : "Concluir"}</button>
      <button class="btn btn-small btn-ghost" data-act="editar" data-id="${esc(it.id)}">Editar</button>
      <button class="btn btn-small btn-ghost btn-danger" data-act="apagar" data-id="${esc(it.id)}">Excluir</button>
    </div>
  </article>`;
}

function quadro() {
  const u = S.ui, pend = pendentes();
  const tabs = [3, 2, 1].map((p) => {
    const n = pend.filter((i) => Number(i.prioridade) === p).length;
    return `<button class="tab p${p}" role="tab" aria-selected="${u.prio === p}" data-act="prio" data-p="${p}"><span class="n">${n}</span><span class="t">${PRIO[p]}</span></button>`;
  }).join("");
  const chipsTipo = Object.keys(TIPO_PLURAL).map((t) => `<button class="chip" aria-pressed="${u.tipo === t}" data-act="tipo" data-t="${t}">${TIPO_PLURAL[t]}</button>`).join("");
  const chipsAutor = [["todos", "Nós dois", ""], ["bjorn", "Bjørn", "bj"], ["yoshiro", "Yoshiro", "yo"]]
    .map(([v, l, c]) => `<button class="chip ${c}" aria-pressed="${u.autor === v}" data-act="autor" data-a="${v}">${l}</button>`).join("");
  const lista = filtrados();
  const vazio = `
    <div class="empty-board">
      <p class="vazio">${u.dia ? `Nada em ${fmtDia(u.dia).toLowerCase()} nesta aba.` : `Nada ${u.prio === 3 ? "muito importante" : u.prio === 2 ? "importante" : "menos importante"} pendente${u.tipo !== "tudo" ? ` em ${TIPO_PLURAL[u.tipo].toLowerCase()}` : ""}.`}</p>
      <button class="btn" data-act="novo">+ Anotar aqui</button>
    </div>`;
  const nvDia = u.dia ? S.itens.filter((it) => ehNiver(it) && ymd(dataNiver(Number(u.dia.slice(0, 4)), it.niver)) === u.dia) : [];
  return `
  <section class="panel sticker" aria-labelledby="h-q">
    <div class="panel-h">${vistas()}
      <label class="check"><input type="checkbox" data-act="concl" ${u.concluidos ? "checked" : ""}><span>Mostrar concluídos</span></label>
    </div>
    <div class="tabs" role="tablist" aria-label="Importância">${tabs}</div>
    <div class="filters"><div class="chips">${chipsTipo}</div><span class="sep"></span><div class="chips">${chipsAutor}</div></div>
    ${u.dia ? `<div class="dia-ativo">Mostrando ${esc(fmtDia(u.dia).toLowerCase())} <button class="btn btn-small" data-act="dia" data-d="${u.dia}">Ver todos os dias</button></div>` : ""}
    ${nvDia.length ? `<button class="niver-faixa" data-act="vista" data-v="niver">Aniversário neste dia: ${esc(nvDia.map((x) => x.titulo).join(", "))}</button>` : ""}
    ${lista.length ? `<div class="cards">${lista.map(cartao).join("")}</div>` : vazio}
  </section>`;
}

/** Troca entre o Quadro e a aba de Aniversários (cabeçalho do painel central). */
function vistas() {
  const v = S.ui.vista, n = S.itens.filter(ehNiver).length;
  return `<div class="vistas" role="tablist" aria-label="Seção">
    <button role="tab" aria-selected="${v === "quadro"}" data-act="vista" data-v="quadro">Quadro</button>
    <button role="tab" aria-selected="${v === "niver"}" data-act="vista" data-v="niver">Aniversários <span class="vn">${n}</span></button>
  </div>`;
}

function cartaoNiver({ it, dias, idade }) {
  const q = it.autor, c = CLS[q] || "";
  return `
  <article class="item niver-card sticker ${c} ${dias === 0 ? "hoje" : ""}">
    <div class="item-top">
      ${marca(q)}
      <div class="item-meta"><b class="${c}">${NOME[q] || "Alguém"}</b><span>anotou</span></div>
      <span class="badge falta ${dias <= 7 ? "perto" : ""}">${faltam(dias)}</span>
    </div>
    <h3 class="item-t">${esc(it.titulo)}</h3>
    <span class="when">${fmtNiver(it.niver)}${idade ? ` · faz ${idade}` : ""}</span>
    ${it.texto ? `<p class="item-x">${esc(it.texto)}</p>` : ""}
    <div class="item-foot">
      <button class="btn btn-small btn-ghost" data-act="editar" data-id="${esc(it.id)}">Editar</button>
      <button class="btn btn-small btn-ghost btn-danger" data-act="apagar" data-id="${esc(it.id)}">Excluir</button>
    </div>
  </article>`;
}

function abaNiver() {
  const lista = aniversarios().filter((a) => S.ui.autor === "todos" || a.it.autor === S.ui.autor);
  // Agrupa por mês, começando no mês atual (a lista já vem na ordem do próximo aniversário).
  const grupos = [];
  for (const a of lista) {
    const nome = MESES[a.data.getMonth()] + (a.data.getFullYear() > new Date().getFullYear() ? ` de ${a.data.getFullYear()}` : "");
    const g = grupos.at(-1);
    if (g && g.nome === nome) g.itens.push(a); else grupos.push({ nome, itens: [a] });
  }
  const chipsAutor = [["todos", "Nós dois", ""], ["bjorn", "Bjørn", "bj"], ["yoshiro", "Yoshiro", "yo"]]
    .map(([v, l, c]) => `<button class="chip ${c}" aria-pressed="${S.ui.autor === v}" data-act="autor" data-a="${v}">${l}</button>`).join("");
  return `
  <section class="panel sticker" aria-label="Aniversários">
    <div class="panel-h">${vistas()}<button class="btn btn-small btn-main" data-act="novo" data-tipo="aniversario">+ Aniversário</button></div>
    <div class="filters"><div class="chips">${chipsAutor}</div></div>
    ${grupos.length ? grupos.map((g) => `
      <div class="mes-grupo">
        <h3 class="mes-h">${esc(g.nome.charAt(0).toUpperCase() + g.nome.slice(1))}</h3>
        <div class="cards">${g.itens.map(cartaoNiver).join("")}</div>
      </div>`).join("") : `
      <div class="empty-board">
        <p class="vazio">Nenhum aniversário anotado ainda. Guarde aqui o dia de cada amigo e da família; o mural avisa vocês quando estiver chegando.</p>
        <button class="btn" data-act="novo" data-tipo="aniversario">+ Aniversário</button>
      </div>`}
  </section>`;
}

function proximosNivers() {
  const lista = aniversarios().slice(0, 5);
  const lis = lista.map((a) => `<li><button class="ev" data-act="vista" data-v="niver">
      <span class="ev-date"><b>${a.data.getDate()}</b><span>${MESES[a.data.getMonth()].slice(0, 3)}</span></span>
      <span><span class="ev-t">${esc(a.it.titulo)}</span><span class="ev-s"><i class="dot niver ${CLS[a.it.autor]}"></i>${faltam(a.dias)}${a.idade ? ` · faz ${a.idade}` : ""}</span></span>
    </button></li>`).join("");
  return `
  <section class="panel sticker" aria-labelledby="h-nv">
    <div class="panel-h"><h2 id="h-nv">Aniversários</h2><button class="btn btn-small" data-act="novo" data-tipo="aniversario">+ Aniversário</button></div>
    ${lis ? `<ul class="ev-list">${lis}</ul>` : `<p class="vazio">Nenhum aniversário anotado. Use “+ Aniversário” para guardar o dia de um amigo.</p>`}
  </section>`;
}

function metas() {
  const ms = S.itens.filter((i) => i.tipo === "meta" && (S.ui.concluidos || !i.feito)).sort(ordenar);
  const lis = ms.map((it) => {
    const p = progresso(it), c = CLS[it.autor];
    return `<button class="meta" data-act="editar" data-id="${esc(it.id)}">
      <span class="meta-t"><i class="dot ${c}"></i>${esc(it.titulo)}</span>
      <span class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i class="${c}" style="width:${p}%"></i></span>
      <span class="prog-l"><span>${it.data ? `Prazo ${fmtDia(it.data).toLowerCase()}` : "Sem prazo"}</span><span>${p}%</span></span>
    </button>`;
  }).join("");
  return `
  <section class="panel sticker" aria-labelledby="h-m">
    <div class="panel-h"><h2 id="h-m">Metas</h2><button class="btn btn-small" data-act="novo" data-tipo="meta">+ Meta</button></div>
    ${lis ? `<div class="meta-list">${lis}</div>` : `<p class="vazio">Nenhuma meta ainda. Uma meta pode ter etapas, e a barra enche conforme vocês marcam.</p>`}
  </section>`;
}

function telaPainel() {
  return `
  ${topo()}
  ${S.erro ? `<p class="banner" role="alert">${esc(S.erro)}</p>` : ""}
  ${avisosDeVersao()}
  ${DEMO ? `<p class="banner">Demonstração com dados de exemplo. ${configurado ? "" : "O Firebase ainda não foi configurado (web/firebase-config.js)."}</p>` : ""}
  <main class="board">
    <div class="col">${calendario()}${proximosEventos()}</div>
    <div class="col col-main">${S.ui.vista === "niver" ? abaNiver() : quadro()}</div>
    <div class="col">${proximosNivers()}${metas()}</div>
  </main>
  <button class="btn fab" data-act="novo">+ Anotar</button>`;
}

/* ============ Editor ============ */
let E = null;
function abrirEditor(it, preset = {}) {
  E = it
    ? { ...it, checklist: (it.checklist || []).map((x) => ({ ...x })), confirmar: false }
    : { id: null, tipo: "nota", titulo: "", texto: "", prioridade: S.ui.prio, data: S.ui.dia || "", hora: "", checklist: [], progresso: 0, feito: false, ...preset };
  if (E.tipo === "evento" && !E.data) E.data = hoje();
  prepararNiver();
  renderEditor(true);
}
/** Dia e mês do aniversário no editor (vêm de niver "MM-DD", do dia escolhido no calendário ou de hoje). */
function prepararNiver() {
  if (E.nd) return;
  const base = E.niver || (S.ui.dia || hoje()).slice(5);
  const [m, d] = base.split("-").map(Number);
  E.nm = m; E.nd = d; E.ano = E.ano || "";
}
function renderEditor(focar) {
  if (!E) { $layer.innerHTML = ""; return; }
  const comLista = E.tipo === "checklist" || E.tipo === "meta";
  const niver = E.tipo === "aniversario";
  const seg = Object.entries(TIPO).map(([v, l]) => `<button type="button" data-ed="tipo" data-v="${v}" aria-pressed="${E.tipo === v}">${l}</button>`).join("");
  const prio = [3, 2, 1].map((p) => `<button type="button" data-ed="prio" data-v="${p}" aria-pressed="${Number(E.prioridade) === p}">${PRIO[p]}</button>`).join("");
  const linhas = E.checklist.map((x, i) => `
    <div class="ck-row">
      <input type="checkbox" data-ed="ckok" data-i="${i}" ${x.ok ? "checked" : ""} aria-label="Feito">
      <input class="input" id="ck-${i}" data-ed="ckt" data-i="${i}" value="${esc(x.t)}" placeholder="${E.tipo === "meta" ? "Etapa" : "Item"} ${i + 1}">
      <button type="button" class="icon-btn" data-ed="ckdel" data-i="${i}" aria-label="Remover">×</button>
    </div>`).join("");
  $layer.innerHTML = `
  <div class="overlay" data-ed="fundo">
    <form class="sheet sticker" id="f-ed" role="dialog" aria-modal="true" aria-labelledby="h-ed" novalidate>
      <h2 id="h-ed">${E.id ? "Editar" : "Nova anotação"}</h2>
      <div class="field"><span class="label">Tipo</span><div class="seg">${seg}</div></div>
      <div class="field"><label for="ed-t">${niver ? "Nome de quem faz aniversário" : "Título"}</label><input class="input" id="ed-t" data-ed="titulo" value="${esc(E.titulo)}" maxlength="140" placeholder="${niver ? "Ex.: Lucas" : E.tipo === "evento" ? "Ex.: Jantar com a família" : E.tipo === "meta" ? "Ex.: Guardar dinheiro pra viagem" : E.tipo === "checklist" ? "Ex.: Mercado" : "Ex.: Lembrar de pagar a internet"}"></div>
      ${niver ? `
      <div class="row3">
        <div class="field"><label for="ed-nd">Dia</label><select class="input" id="ed-nd" data-ed="nd">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${E.nd === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
        <div class="field"><label for="ed-nm">Mês</label><select class="input" id="ed-nm" data-ed="nm">${MESES.map((n, i) => `<option value="${i + 1}" ${E.nm === i + 1 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label for="ed-ano">Ano em que nasceu (opcional)</label><input class="input" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" id="ed-ano" data-ed="ano" value="${esc(E.ano || "")}" placeholder="Ex.: 1996"></div>
      </div>` : `
      <div class="field"><span class="label">Importância</span><div class="seg prio">${prio}</div></div>
      <div class="${E.tipo === "evento" ? "row3 ev3" : "row2"}">
        <div class="field"><label for="ed-d">${E.tipo === "meta" ? "Prazo" : E.tipo === "evento" ? "Começa no dia" : "Dia (opcional)"}</label><input class="input" type="date" id="ed-d" data-ed="data" value="${esc(E.data || "")}"></div>
        ${E.tipo === "evento" ? `<div class="field"><label for="ed-df">Até que dia (opcional)</label><input class="input" type="date" id="ed-df" data-ed="dataFim" min="${esc(E.data || "")}" value="${esc(E.dataFim || "")}"></div>` : ""}
        <div class="field"><label for="ed-h">Hora (opcional)</label><input class="input" type="time" id="ed-h" data-ed="hora" value="${esc(E.hora || "")}"></div>
      </div>
      ${E.tipo === "evento" ? `<p class="dica-campo">Para eventos de vários dias, como o Ultimate Drift: marque o primeiro dia e o último. Deixe "Até que dia" vazio se for um dia só.</p>` : ""}`}
      <div class="field"><label for="ed-x">${niver ? "Ideias de presente e anotações (opcional)" : "Detalhes (opcional)"}</label><textarea class="textarea" id="ed-x" data-ed="texto">${esc(E.texto)}</textarea></div>
      ${comLista ? `<div class="field"><span class="label">${E.tipo === "meta" ? "Etapas da meta" : "Itens da lista"}</span><div class="ck-edit">${linhas}</div>
        <button type="button" class="btn btn-small" data-ed="ckadd">+ ${E.tipo === "meta" ? "Etapa" : "Item"}</button></div>` : ""}
      ${E.tipo === "meta" && !E.checklist.length ? `<div class="field"><label for="ed-p">Progresso: <span id="ed-pv">${progresso(E)}%</span></label><input class="range" type="range" min="0" max="100" step="5" id="ed-p" data-ed="progresso" value="${progresso(E)}"></div>` : ""}
      <p class="erro" id="ed-erro" role="alert"></p>
      <div class="sheet-foot">
        ${E.id ? (E.confirmar
          ? `<span class="confirm left">Excluir de vez? <button type="button" class="btn btn-small btn-danger" data-ed="apagar-sim">Sim, excluir</button><button type="button" class="btn btn-small btn-ghost" data-ed="apagar-nao">Não</button></span>`
          : `<button type="button" class="btn btn-ghost btn-danger left" data-ed="apagar">Excluir</button>`) : ""}
        <button type="button" class="btn btn-ghost" data-ed="fechar">Cancelar</button>
        <button type="submit" class="btn btn-main">Salvar</button>
      </div>
    </form>
  </div>`;
  if (focar) document.getElementById("ed-t")?.focus();
}
async function salvarEditor() {
  const erro = document.getElementById("ed-erro");
  const titulo = E.titulo.trim();
  const niver = E.tipo === "aniversario";
  if (!titulo) { erro.textContent = niver ? "Escreva o nome de quem faz aniversário." : "Escreva um título."; document.getElementById("ed-t").focus(); return; }
  if (E.tipo === "evento" && !E.data) { erro.textContent = "Evento precisa de um dia."; document.getElementById("ed-d").focus(); return; }
  if (E.tipo === "evento" && E.dataFim && E.dataFim < E.data) { erro.textContent = "O último dia não pode ser antes do primeiro."; document.getElementById("ed-df").focus(); return; }
  if (niver && E.nd > new Date(2024, E.nm, 0).getDate()) { erro.textContent = `${MESES[E.nm - 1]} não tem dia ${E.nd}.`; document.getElementById("ed-nd").focus(); return; }
  const ano = Number(E.ano);
  if (niver && E.ano !== "" && (ano < 1900 || ano > new Date().getFullYear())) { erro.textContent = "Ano de nascimento inválido (ou deixe em branco)."; document.getElementById("ed-ano").focus(); return; }
  const usaLista = E.tipo === "checklist" || E.tipo === "meta";
  const o = {
    tipo: E.tipo, titulo, texto: E.texto.trim(), prioridade: niver ? 0 : Number(E.prioridade) || 1,
    data: niver ? null : E.data || null, hora: niver ? "" : E.hora || "",
    dataFim: E.tipo === "evento" && E.dataFim && E.data && E.dataFim > E.data ? E.dataFim : null,
    niver: niver ? `${pad(E.nm)}-${pad(E.nd)}` : null, ano: niver && E.ano !== "" ? ano : null,
    checklist: usaLista ? E.checklist.filter((x) => x.t.trim()).map((x) => ({ t: x.t.trim(), ok: !!x.ok })) : [],
    progresso: E.tipo === "meta" ? Number(E.progresso) || 0 : 0,
    atualizadoEm: Date.now(),
  };
  const id = E.id;
  if (!id) Object.assign(o, { feito: false, autor: eu(), autorUid: S.user.uid, criadoEm: Date.now() });
  E = null; renderEditor();
  gravar(S.backend.salvarItem(id, o), id ? "Salvo." : "Anotado! Já aparece pro " + NOME[outro(eu())] + ".");
}
function gravar(promessa, ok) {
  if (ok) toast(ok);
  avisarNativo();
  Promise.resolve(promessa).then(avisarNativo).catch((e) => { console.error(e); toast(e?.code === "permission-denied" ? "Sem permissão para salvar." : "Não salvou. Confira a internet."); });
}

/* ============ Aviso do dia ============ */
function abrirAviso() {
  const h = hoje(), meu = eu(), dele = outro(meu), p = pendentes();
  const deHoje = p.filter((i) => noDia(i, h)).sort(ordenar);
  const atras = p.filter(atrasado).sort(ordenar);
  const urg = p.filter((i) => Number(i.prioridade) === 3 && !noDia(i, h) && !atrasado(i)).sort(ordenar).slice(0, 6);
  const novos = S.itens.filter(ehNovo).sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 6);
  const li = (it, extra) => `<li><i class="dot ${CLS[it.autor]}"></i>${esc(it.titulo)}<small>${extra ?? (it.data && fim(it) !== it.data ? fmtQuando(it) : it.hora || fmtDia(it.data) || TIPO[it.tipo])}</small></li>`;
  const sec = (t, arr, f) => (arr.length ? `<div class="aviso-sec"><h3>${t}</h3><ul>${arr.map(f || ((it) => li(it))).join("")}</ul></div>` : "");
  const nivers = aniversarios().filter((a) => a.dias <= 7);
  const nada = !deHoje.length && !atras.length && !urg.length && !novos.length && !nivers.length;
  $layer.innerHTML = `
  <div class="overlay" data-av="fundo">
    <section class="aviso sticker" role="dialog" aria-modal="true" aria-labelledby="h-av">
      <div class="aviso-oc bj" aria-hidden="true"></div>
      <div class="aviso-body">
        <h2 id="h-av">${saudacao()}, ${NOME[meu]}!</h2>
        ${sec("Aniversários", nivers, (a) => `<li><i class="dot niver ${CLS[a.it.autor]}"></i>${esc(a.it.titulo)}${a.idade ? ` (faz ${a.idade})` : ""}<small>${faltam(a.dias)}</small></li>`)}
        ${sec(`Novidades do ${NOME[dele]}`, novos, (it) => li(it, TIPO[it.tipo]))}
        ${sec("Hoje", deHoje)}
        ${sec("Atrasados", atras)}
        ${sec("Muito importante", urg)}
        ${nada ? `<p class="vazio">Nada pendente pra hoje. Dia livre!</p>` : ""}
        <div class="sheet-foot"><button class="btn btn-main" data-av="fechar">Fechar e ir pro mural</button></div>
      </div>
      <div class="aviso-oc yo" aria-hidden="true"></div>
    </section>
  </div>`;
  $layer.querySelector("[data-av='fechar']").focus();
}
function fecharAviso() {
  $layer.innerHTML = "";
  marcarVisto();
}
function marcarVisto() {
  if (S.user && eu()) gravar(S.backend.salvarPessoa(S.user.uid, { vistoEm: Date.now() }));
}

/* ============ Eventos ============ */
const AUTH_ERROS = {
  "auth/invalid-credential": "Email ou senha incorretos.",
  "auth/wrong-password": "Email ou senha incorretos.",
  "auth/user-not-found": "Email ou senha incorretos.",
  "auth/invalid-email": "Esse email não parece certo.",
  "auth/email-already-in-use": "Já existe uma conta com esse email. Use “Já tenho conta”.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/admin-restricted-operation": "Novas contas estão desativadas neste mural.",
  "auth/operation-not-allowed": "Login por email ainda não foi ativado no Firebase.",
  "auth/network-request-failed": "Sem internet. Tente de novo.",
  "auth/too-many-requests": "Muitas tentativas. Espere um pouco e tente de novo.",
};

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (ev.target.id === "f-ed") return salvarEditor();
  if (ev.target.id !== "f-entrar") return;
  const email = document.getElementById("in-email").value.trim();
  const senha = document.getElementById("in-senha").value;
  const erro = ev.target.querySelector(".erro");
  if (!email || !senha) { erro.textContent = "Preencha email e senha."; return; }
  erro.textContent = "";
  ev.target.querySelector("[type=submit]").disabled = true;
  try {
    acabouDeEntrar = true;
    if (S.modo === "criar") await S.backend.criar(email, senha);
    else await S.backend.entrar(email, senha);
    S.erro = "";
    try { ponte?.entrar(email, senha); } catch {}
  } catch (e) {
    erro.textContent = AUTH_ERROS[e?.code] || "Não deu certo. Tente de novo.";
    ev.target.querySelector("[type=submit]").disabled = false;
  }
});

document.addEventListener("click", (ev) => {
  const ed = ev.target.closest("[data-ed]");
  if (ed && E) return acaoEditor(ed, ev);
  const av = ev.target.closest("[data-av]");
  if (av) { if (av.dataset.av === "fechar" || ev.target === av) fecharAviso(); return; }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act, u = S.ui;
  const item = b.dataset.id ? S.itens.find((i) => i.id === b.dataset.id) : null;
  switch (a) {
    case "modo": S.modo = S.modo === "criar" ? "entrar" : "criar"; S.erro = ""; render(); break;
    case "sair": S.backend.sair(); try { ponte?.sair(); } catch {} break;
    case "souu": S.backend.salvarPessoa(S.user.uid, { quem: b.dataset.q, vistoEm: Date.now() }).catch(erroDados); break;
    case "prio": u.prio = Number(b.dataset.p); salvarUi(); render(); break;
    case "tipo": u.tipo = b.dataset.t; salvarUi(); render(); break;
    case "autor": u.autor = b.dataset.a; salvarUi(); render(); break;
    case "dia": {
      const d = b.dataset.d;
      u.dia = u.dia === d ? null : d;
      if (u.dia && u.dia.slice(0, 7) !== u.mes) u.mes = u.dia.slice(0, 7);
      if (u.dia) { const ns = S.itens.filter((i) => i.data === u.dia && !i.feito); if (ns.length && !ns.some((i) => Number(i.prioridade) === u.prio)) u.prio = Number(ns[0].prioridade); }
      render(); break;
    }
    case "mes": {
      const n = Number(b.dataset.n);
      if (!n) { u.mes = hoje().slice(0, 7); u.dia = null; }
      else { const [y, m] = u.mes.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); u.mes = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
      render(); break;
    }
    case "novo": {
      const tipo = b.dataset.tipo || (u.vista === "niver" ? "aniversario" : null);
      abrirEditor(null, tipo ? { tipo, prioridade: tipo === "meta" ? 2 : tipo === "aniversario" ? 0 : u.prio } : {});
      break;
    }
    case "vista": u.vista = b.dataset.v === "niver" ? "niver" : "quadro"; salvarUi(); render(); document.querySelector(".col-main")?.scrollIntoView({ block: "start" }); break;
    case "editar": if (item) abrirEditor(item); break;
    case "feito": if (item) gravar(S.backend.salvarItem(item.id, { feito: !item.feito, atualizadoEm: Date.now() }), item.feito ? "Reaberto." : "Concluído!"); break;
    case "apagar": {
      const foot = b.closest(".item-foot");
      foot.innerHTML = `<span class="confirm">Excluir de vez? <button class="btn btn-small btn-danger" data-act="apagar-sim" data-id="${esc(item.id)}">Sim, excluir</button><button class="btn btn-small btn-ghost" data-act="apagar-nao">Não</button></span>`;
      break;
    }
    case "apagar-sim": if (item) gravar(S.backend.removerItem(item.id), "Excluído."); break;
    case "apagar-nao": render(); break;
    case "aviso": abrirAviso(); break;
    case "visto": marcarVisto(); break;
    case "recarregar": location.reload(); break;
  }
});

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset.act === "ck") {
    const it = S.itens.find((i) => i.id === t.dataset.id);
    if (!it) return;
    const lista = (it.checklist || []).map((x, i) => (i === Number(t.dataset.i) ? { ...x, ok: t.checked } : x));
    gravar(S.backend.salvarItem(it.id, { checklist: lista, atualizadoEm: Date.now() }));
  } else if (t.dataset.act === "concl") {
    S.ui.concluidos = t.checked; salvarUi(); render();
  } else if (E && t.dataset.ed === "ckok") {
    E.checklist[Number(t.dataset.i)].ok = t.checked;
    if (E.tipo === "meta") renderEditor();
  }
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (!E || !t.dataset.ed) return;
  const k = t.dataset.ed;
  if (k === "titulo" || k === "texto" || k === "data" || k === "hora" || k === "dataFim") E[k] = t.value;
  if (k === "data") { const df = document.getElementById("ed-df"); if (df) df.min = t.value; }
  else if (k === "ano") E.ano = t.value.trim();
  else if (k === "nd" || k === "nm") E[k] = Number(t.value);
  else if (k === "ckt") E.checklist[Number(t.dataset.i)].t = t.value;
  else if (k === "progresso") { E.progresso = Number(t.value); document.getElementById("ed-pv").textContent = t.value + "%"; }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (E) { E = null; renderEditor(); }
    else if ($layer.querySelector("[data-av]")) fecharAviso();
  }
  if (ev.key === "Enter" && ev.target.dataset?.ed === "ckt") {
    ev.preventDefault();
    const i = Number(ev.target.dataset.i);
    E.checklist.splice(i + 1, 0, { t: "", ok: false });
    renderEditor(); document.getElementById("ck-" + (i + 1))?.focus();
  }
});

function acaoEditor(el, ev) {
  const k = el.dataset.ed;
  if (k === "fundo") { if (ev.target === el) { E = null; renderEditor(); } return; }
  if (k === "fechar") { E = null; renderEditor(); return; }
  if (k === "tipo") { E.tipo = el.dataset.v; prepararNiver(); if (E.tipo !== "aniversario" && !Number(E.prioridade)) E.prioridade = S.ui.prio; if (E.tipo === "evento" && !E.data) E.data = hoje(); if ((E.tipo === "checklist" || E.tipo === "meta") && !E.checklist.length) E.checklist.push({ t: "", ok: false }); renderEditor(); return; }
  if (k === "prio") { E.prioridade = Number(el.dataset.v); renderEditor(); return; }
  if (k === "ckadd") { E.checklist.push({ t: "", ok: false }); renderEditor(); document.getElementById("ck-" + (E.checklist.length - 1))?.focus(); return; }
  if (k === "ckdel") { E.checklist.splice(Number(el.dataset.i), 1); renderEditor(); return; }
  if (k === "apagar") { E.confirmar = true; renderEditor(); return; }
  if (k === "apagar-nao") { E.confirmar = false; renderEditor(); return; }
  if (k === "apagar-sim") { const id = E.id; E = null; renderEditor(); gravar(S.backend.removerItem(id), "Excluído."); }
}

/* Atalhos vindos do PC (#aviso) e do widget (#novo) */
function lerHash() {
  const h = location.hash.slice(1);
  if (!h) return;
  history.replaceState(null, "", location.pathname + location.search);
  aberturaPendente = h === "aviso" ? abrirAviso : h === "novo" ? () => abrirEditor(null) : null;
  if (aberturaPendente && S.user && eu() && (S.pronto || DEMO)) render();
}
window.addEventListener("hashchange", lerHash);
lerHash();

// Atualiza "hoje" quando o dia vira com o mural aberto.
let diaAtual = hoje();
setInterval(() => { if (hoje() !== diaAtual) { diaAtual = hoje(); if (S.user && eu()) render(); } }, 60e3);

iniciar();
verificarVersao();
setInterval(verificarVersao, 30 * 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarVersao(); });
