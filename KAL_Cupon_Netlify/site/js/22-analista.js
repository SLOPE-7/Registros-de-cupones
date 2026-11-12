// Analista con IA (Claude). Dos funciones:
// 1) Analizar mi historial: la app resume tus cupones liquidados (por mercado, cuota, competición,
//    casa, mes y tamaño de la combinada) y Claude explica dónde ganas y dónde pierdes.
// 2) Revisar un cupón antes de apostar: Claude busca en internet cada partido y señala el más débil.
// Se envía un resumen, no tu base de datos: sin correo, sin cuentas ni datos de la nube.
// El código de acceso se guarda solo en este teléfono (no se sincroniza).
"use strict";

const ANALYST_STORE = "kal_analista_v1";
const ANALYST_MIN_MARKETS = 5;
let analystBusy = false,
  analystAbort = null;

function analystState() {
  try {
    return JSON.parse(localStorage.getItem(ANALYST_STORE) || "{}") || {};
  } catch {
    return {};
  }
}
function analystSave(patch) {
  const next = { ...analystState(), ...patch };
  try {
    localStorage.setItem(ANALYST_STORE, JSON.stringify(next));
  } catch {}
  return next;
}

// ---------- Datos que se envían ----------
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
function perfRowOut(r, nameKey) {
  return {
    [nameKey]: r.name,
    ganados: r.won,
    perdidos: r.lost,
    nulos: r.void || 0,
    tasa: r2(r.rate),
    cuotaMedia: r2(r.avgOdd),
    rentabSuelta: r2(r.roi),
  };
}
function sizeBand(n) {
  return n <= 1 ? "1 (simple)" : n === 2 ? "2" : n === 3 ? "3" : n <= 5 ? "4-5" : n <= 8 ? "6-8" : "9 o más";
}
function couponLegs(c) {
  return c.fixtures.reduce((s, f) => s + f.markets.length, 0);
}
function legLine(f, m, withResult) {
  const odd = m.builder ? "" : m.odd;
  const when = [f.date, f.time].filter(Boolean).join(" ");
  return (
    [canonicalCompetition(f.competition || f.league), (f.home || "?") + " vs " + (f.away || "?"), when]
      .filter(Boolean)
      .join(" · ") +
    " · " +
    [m.market, m.pick].filter(Boolean).join(": ") +
    (odd
      ? " @ " + odd
      : m.builder && m.builderOdd
        ? " (BetBuilder; cuota del paquete " + m.builderOdd + ")"
        : "") +
    (withResult && m.settlement && m.settlement !== "pending" ? " → " + m.settlement : "")
  );
}
function houseName(id) {
  return db.houses.find((h) => h.id === id)?.name || "";
}

function analystMarketHistory() {
  const prev = perfPeriod;
  perfPeriod = "all";
  try {
    return perfData();
  } finally {
    perfPeriod = prev;
  }
}
function analystHistoryPayload() {
  const p = analystMarketHistory();
  const sizes = new Map();
  p.coupons.forEach(({ c, r }) => {
    if (r.status !== "won" && r.status !== "lost") return;
    const k = sizeBand(couponLegs(c));
    if (!sizes.has(k)) sizes.set(k, { selecciones: k, cupones: 0, ganados: 0, apostado: 0, neto: 0 });
    const s = sizes.get(k);
    s.cupones++;
    if (r.status === "won") s.ganados++;
    s.apostado += Number(c.stake) || 0;
    s.neto += Number(r.net) || 0;
  });
  const recent = p.coupons
    .filter((x) => x.r.status !== "pending")
    .sort((a, b) => String(b.c.updated || b.c.created).localeCompare(String(a.c.updated || a.c.created)))
    .slice(0, 25)
    .map(({ c, r }) => ({
      fecha: String(c.created || "").slice(0, 10),
      casa: houseName(c.houseId) || undefined,
      importe: r2(Number(c.stake) || 0),
      cuota: r2(Number(c.odds) || null),
      resultado: r.status,
      confianza: Number(c.confidence) || undefined,
      motivo: c.reason || undefined,
      neto: r2(r.net),
      selecciones: c.fixtures.flatMap((f) => f.markets.map((m) => legLine(f, m, true))).slice(0, 14),
    }));
  const budget = Number(db.settings?.budget) || 0;
  return {
    resumen: {
      cuponesLiquidados: p.coupons.length,
      ganados: p.won,
      perdidos: p.lost,
      apostado: r2(p.stake),
      neto: r2(p.net),
      roi: p.stake ? r2(p.net / p.stake) : null,
      mejorRacha: p.best,
      rachaActual: p.cur ? { tipo: p.curType, cupones: p.cur } : null,
      cuponesPendientes: db.coupons.filter((c) => calcCoupon(c).status === "pending").length,
    },
    porMercado: p.byType.map((r) => perfRowOut(r, "tipo")),
    porCuota: p.byOdds.map((r) => perfRowOut(r, "rangoCuota")),
    porCompeticion: p.byComp.map((r) => perfRowOut(r, "competicion")),
    porCasa: p.houses.map((h) => ({
      casa: h.name,
      cupones: h.n,
      ganados: h.won,
      apostado: r2(h.stake),
      neto: r2(h.net),
    })),
    porTamano: [...sizes.values()].map((s) => ({ ...s, apostado: r2(s.apostado), neto: r2(s.neto) })),
    porMes: p.months.map(([mes, neto]) => ({ mes, neto: r2(neto) })),
    valorCierre: (() => {
      const s = clvStats();
      return s ? { mercados: s.n, valorMedio: r2(s.avg), mejoresQueCierre: s.beat } : null;
    })(),
    porConfianza: confidenceRows(p.coupons).map((x) => ({
      confianza: x.k,
      cupones: x.n,
      ganados: x.won,
      apostado: r2(x.stake),
      neto: r2(x.net),
    })),
    banca: bankrollAmount()
      ? { banca: r2(bankrollAmount()), unidad: unitStake(), maxSelecciones: bankrollCfg().maxSel }
      : null,
    presupuesto: budget ? { mensual: budget, gastadoEsteMes: r2(monthSpent()) } : null,
    ultimosCupones: recent,
    _mercadosLiquidados: p.markets.length,
  };
}
// Versión corta para acompañar la revisión de un cupón.
function analystShortHistory() {
  const p = analystMarketHistory();
  if (p.markets.length < ANALYST_MIN_MARKETS) return null;
  return p.byType.map((r) => perfRowOut(r, "tipo"));
}
function couponAsText(c) {
  if (c.raw && c.raw.trim().length > 20) return c.raw.trim();
  const lines = c.fixtures.flatMap((f) => f.markets.map((m) => "- " + legLine(f, m, false)));
  if (c.stake) lines.push("Importe: " + money(c.stake));
  if (c.odds) lines.push("Cuota total: " + c.odds);
  return lines.join("\n");
}
function fixturesAsText(fixtures) {
  return fixtures.flatMap((f) => f.markets.map((m) => "- " + legLine(f, m, false))).join("\n");
}

// ---------- Markdown mínimo y seguro (todo se escapa antes de dar formato) ----------
function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
}
function renderMd(text) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push("</" + list + ">");
    list = null;
  };
  String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .forEach((raw) => {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) return closeList();
      if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
        closeList();
        out.push("<h4>" + inlineMd(m[1]) + "</h4>");
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== "ul") {
          closeList();
          out.push("<ul>");
          list = "ul";
        }
        out.push("<li>" + inlineMd(m[1]) + "</li>");
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== "ol") {
          closeList();
          out.push("<ol>");
          list = "ol";
        }
        out.push("<li>" + inlineMd(m[1]) + "</li>");
      } else if (list && /^\s{2,}\S/.test(raw)) {
        out[out.length - 1] = out[out.length - 1].replace(
          /<\/li>$/,
          "<br>" + inlineMd(line.trim()) + "</li>",
        );
      } else {
        closeList();
        out.push("<p>" + inlineMd(line) + "</p>");
      }
    });
  closeList();
  return out.join("");
}

// ---------- Llamada al servidor (respuesta en streaming, una línea JSON por evento) ----------
async function analystRequest(modo, datos, { onStatus, onText, onReset }) {
  const clave = analystState().clave || "";
  if (!clave) throw new Error("Primero escribe el código de acceso del Analista (abajo, en ⚙ Configurar).");
  analystAbort = new AbortController();
  let r;
  try {
    r = await fetch("/api/analista", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kal-clave": clave },
      body: JSON.stringify({ modo, datos: { ...datos, hoy: localISODate() } }),
      signal: analystAbort.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Sin conexión con el servidor. Revisa tu internet.");
  }
  if (!r.ok || !r.body) {
    let msg = "El Analista no respondió (error " + r.status + ").";
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch {}
    if (r.status === 404) msg = "El Analista aún no está publicado en el servidor. Vuelve a publicar la app.";
    throw new Error(msg);
  }
  const reader = r.body.getReader(),
    dec = new TextDecoder();
  let buf = "",
    text = "",
    done = null;
  const handle = (line) => {
    if (!line.trim()) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.t === "estado") onStatus?.(ev.v);
    else if (ev.t === "texto") {
      text += ev.v;
      onText?.(text);
    } else if (ev.t === "reinicio") {
      text = "";
      onReset?.();
    } else if (ev.t === "error") done = { error: ev.v };
    else if (ev.t === "fin") done = { uso: ev.uso };
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  handle(buf);
  if (done?.error) throw new Error(done.error);
  if (!done) throw new Error(text ? "La conexión se cortó antes de terminar." : "El Analista no respondió.");
  return { text, uso: done.uso };
}
function localISODate() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// ---------- Pantalla ----------
function analystResultHtml(kind) {
  const last = analystState()[kind];
  if (!last?.texto) return "";
  const when = new Date(last.fecha);
  return (
    '<div class="analyst-meta small muted">Último análisis · ' +
    esc(when.toLocaleDateString("es", { day: "numeric", month: "short" })) +
    " " +
    esc(when.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })) +
    (last.titulo ? " · " + esc(last.titulo) : "") +
    '</div><div class="analyst-md">' +
    renderMd(last.texto) +
    "</div>"
  );
}
function renderAnalyst() {
  const el = $("analystView");
  if (!el) return;
  const st = analystState(),
    settled = analystMarketHistory().markets.length,
    pending = db.coupons.filter((c) => calcCoupon(c).status === "pending");
  const enough = settled >= ANALYST_MIN_MARKETS,
    week = weekSummary();
  const sel = $("analystCouponPick")?.value || "";
  el.innerHTML =
    '<div class="notice analyst-warn">🤖 El Analista te ayuda a decidir mejor, pero <b>ninguna predicción es segura</b>. Apuesta solo lo que tu presupuesto permite.</div>' +
    // 1) Historial
    '<section class="panel analyst-card"><div class="ph"><div><h2>📊 Analizar mi historial</h2><div class="marketmeta">Dónde ganas, dónde pierdes y qué tamaño de combinada te conviene</div></div></div><div class="pb">' +
    (enough
      ? '<p class="small muted">Se usarán tus <b>' +
        settled +
        "</b> mercados liquidados (solo un resumen, sin datos de tu cuenta).</p>"
      : '<p class="small muted">Necesitas al menos ' +
        ANALYST_MIN_MARKETS +
        " mercados liquidados (ganados o perdidos) para sacar conclusiones. Llevas " +
        settled +
        ".</p>") +
    '<button type="button" class="btn gold" data-analyst-run="historial"' +
    (enough ? "" : " disabled") +
    ">✦ Analizar mi historial</button>" +
    '<div class="analyst-out" id="analystOut-historial" aria-live="polite">' +
    analystResultHtml("historial") +
    "</div></div></section>" +
    // Mi semana
    '<section class="panel analyst-card"><div class="ph"><div><h2>📅 Mi semana</h2><div class="marketmeta">Resumen de tus últimos 7 días frente a tu historial, y qué ajustar</div></div></div><div class="pb">' +
    (week.cupones
      ? '<p class="small muted">' + week.cupones + " cupones liquidados en los últimos 7 días.</p>"
      : '<p class="small muted">Aún no hay cupones liquidados en los últimos 7 días.</p>') +
    '<button type="button" class="btn gold" data-analyst-run="semana"' +
    (week.cupones ? "" : " disabled") +
    ">✦ Analizar mi semana</button>" +
    '<div class="analyst-out" id="analystOut-semana" aria-live="polite">' +
    analystResultHtml("semana") +
    "</div></div></section>" +
    // Armar cupones
    '<section class="panel analyst-card"><div class="ph"><div><h2>🧩 Armar cupones</h2><div class="marketmeta">Escribe los partidos o picks que estás pensando y te propone cupones cortos</div></div></div><div class="pb">' +
    '<div class="field"><label for="analystBuildText">Partidos o picks</label><textarea id="analystBuildText" class="analyst-text" placeholder="Ej.\nEspaña vs Suiza\nAlemania vs Italia — me gusta más de 2.5\nPortugal vs Polonia">' +
    esc(st.armarBorrador || "") +
    "</textarea></div>" +
    '<p class="small muted">Respeta tu límite de ' +
    bankrollCfg().maxSel +
    " selecciones, no repite partidos entre cupones y usa tu historial y tu unidad de " +
    money(unitStake()) +
    ".</p>" +
    '<button type="button" class="btn gold" data-analyst-run="armar">✦ Armar cupones</button>' +
    '<div class="analyst-out" id="analystOut-armar" aria-live="polite">' +
    analystResultHtml("armar") +
    "</div></div></section>" +
    // 2) Revisar cupón
    '<section class="panel analyst-card"><div class="ph"><div><h2>🔍 Revisar un cupón antes de apostar</h2><div class="marketmeta">Busca la forma, lesiones y rotaciones de cada partido y señala el más débil</div></div></div><div class="pb">' +
    (pending.length
      ? '<div class="field"><label for="analystCouponPick">Elegir un cupón pendiente</label><select class="input" id="analystCouponPick"><option value="">— o pega uno abajo —</option>' +
        pending
          .slice(0, 40)
          .map(
            (c) =>
              '<option value="' +
              esc(c.id) +
              '"' +
              (sel === c.id ? " selected" : "") +
              ">" +
              esc(c.name || "Cupón") +
              " · " +
              couponLegs(c) +
              " sel.</option>",
          )
          .join("") +
        "</select></div>"
      : "") +
    '<div class="field"><label for="analystCouponText">Texto del cupón</label><textarea id="analystCouponText" class="analyst-text" placeholder="Pega aquí el cupón que estás pensando apostar…">' +
    esc(st.borrador || "") +
    "</textarea></div>" +
    '<label class="small analyst-opt"><input type="checkbox" id="analystWithHistory" checked> Tener en cuenta mi historial por tipo de mercado</label>' +
    '<button type="button" class="btn gold" data-analyst-run="cupon">✦ Revisar cupón</button>' +
    '<p class="small muted">Tarda entre 30 segundos y 2 minutos porque busca información actualizada.</p>' +
    '<div class="analyst-out" id="analystOut-cupon" aria-live="polite">' +
    analystResultHtml("cupon") +
    "</div></div></section>" +
    // Configuración
    '<section class="fold analyst-config' +
    (st.clave ? "" : " is-open") +
    '" data-fold="analystConfig"><button type="button" class="fold-head" data-fold-toggle aria-expanded="' +
    (st.clave ? "false" : "true") +
    '"><span class="fold-title">⚙ Configurar el Analista</span><span class="fold-count">' +
    (st.clave ? "✓" : "!") +
    '</span><span class="fold-icon" aria-hidden="true">▾</span></button><div class="fold-body">' +
    '<p class="small muted">El Analista usa la IA de Claude (Anthropic). Necesita dos variables en Cloudflare (Workers → kal-cupones → Settings → Variables and Secrets): <b>ANTHROPIC_API_KEY</b> (tu clave de console.anthropic.com) y <b>ANALISTA_CLAVE</b> (un código que inventas). Escribe ese mismo código aquí; se guarda solo en este teléfono.</p>' +
    '<div class="row"><div class="field"><label for="analystKey">Código de acceso</label><input class="input" id="analystKey" type="password" autocomplete="off" placeholder="El mismo de ANALISTA_CLAVE" value="' +
    esc(st.clave || "") +
    '"></div><div class="field" style="align-self:end"><button type="button" class="btn" data-analyst-key>Guardar código</button></div></div>' +
    '<p class="small muted">Cada análisis se cobra en tu cuenta de Anthropic (aprox. US$0.05 el historial y US$0.15–0.40 la revisión de un cupón con búsquedas). Pon un límite de gasto mensual en la consola de Anthropic.</p>' +
    "</div></section>";
}

function setAnalystButtons(disabled) {
  document.querySelectorAll("[data-analyst-run]").forEach((b) => {
    if (disabled) {
      b.dataset.wasDisabled = b.disabled ? "1" : "";
      b.disabled = true;
    } else b.disabled = b.dataset.wasDisabled === "1";
  });
}

async function runAnalyst(modo) {
  if (analystBusy) return;
  const out = $("analystOut-" + modo);
  let datos, titulo;
  if (modo === "historial") {
    const h = analystHistoryPayload();
    if (h._mercadosLiquidados < ANALYST_MIN_MARKETS) return toast("Aún no hay suficientes resultados.");
    delete h._mercadosLiquidados;
    datos = { historial: h };
    titulo = h.resumen.cuponesLiquidados + " cupones";
  } else if (modo === "semana") {
    const w = weekSummary();
    if (!w.cupones) return toast("No hay cupones liquidados en los últimos 7 días.");
    const h = analystHistoryPayload();
    datos = {
      semana: {
        ultimos7dias: w,
        general: { resumen: h.resumen, porMercado: h.porMercado, porTamano: h.porTamano },
        banca: h.banca,
      },
    };
    titulo = w.cupones + " cupones";
  } else if (modo === "armar") {
    const partidos = ($("analystBuildText")?.value || "").trim();
    if (partidos.length < 10) return toast("Escribe los partidos o picks que estás considerando.");
    titulo = partidos.split("\n")[0].slice(0, 40);
    datos = { partidos: partidos.slice(0, 6000) };
    const h = analystShortHistory();
    if (h) datos.historial = h;
    if (bankrollAmount())
      datos.banca = {
        unidad: unitStake(),
        maxSelecciones: bankrollCfg().maxSel,
        rachaPerdidos: lossStreak(),
      };
    else datos.banca = { maxSelecciones: bankrollCfg().maxSel };
    const budget = Number(db.settings?.budget) || 0;
    if (budget) datos.presupuesto = { mensual: budget, gastadoEsteMes: r2(monthSpent()) };
  } else {
    const cupon = ($("analystCouponText")?.value || "").trim();
    if (cupon.length < 10) return toast("Pega o elige el cupón que quieres revisar.");
    const pick = db.coupons.find((c) => c.id === $("analystCouponPick")?.value);
    titulo = pick?.name || cupon.split("\n")[0].slice(0, 40);
    datos = { cupon: cupon.slice(0, 12000) };
    if ($("analystWithHistory")?.checked) {
      const h = analystShortHistory();
      if (h) datos.historial = h;
    }
    const budget = Number(db.settings?.budget) || 0;
    if (budget) datos.presupuesto = { mensual: budget, gastadoEsteMes: r2(monthSpent()) };
    const riesgo = riskForText(cupon, pick?.id || null);
    if (riesgo) datos.riesgo = riesgo;
    if (bankrollAmount()) datos.banca = { unidad: unitStake(), maxSelecciones: bankrollCfg().maxSel };
  }
  analystBusy = true;
  setAnalystButtons(true);
  out.innerHTML =
    '<div class="analyst-live"><div class="analyst-status"><span class="analyst-dot"></span><span data-status>Conectando…</span><button type="button" class="btn sm" data-analyst-cancel>Cancelar</button></div><div class="analyst-md" data-md></div></div>';
  const status = out.querySelector("[data-status]"),
    md = out.querySelector("[data-md]");
  let frame = 0;
  try {
    const { text } = await analystRequest(modo, datos, {
      onStatus: (s) => (status.textContent = s),
      onText: (t) => {
        status.textContent = "Escribiendo…";
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => (md.innerHTML = renderMd(t)));
      },
      onReset: () => (md.innerHTML = ""),
    });
    cancelAnimationFrame(frame);
    analystSave({ [modo]: { texto: text, fecha: new Date().toISOString(), titulo } });
    out.innerHTML = analystResultHtml(modo);
  } catch (e) {
    cancelAnimationFrame(frame);
    const partial = md.innerHTML;
    out.innerHTML =
      '<div class="notice analyst-error">' +
      esc(e.name === "AbortError" ? "Análisis cancelado." : e.message) +
      "</div>" +
      (partial ? '<div class="analyst-md">' + partial + "</div>" : analystResultHtml(modo));
  } finally {
    analystBusy = false;
    analystAbort = null;
    setAnalystButtons(false);
  }
}

// Abre el Analista con un cupón ya cargado (desde la vista previa de "Nuevo cupón").
function openAnalystWith(text) {
  analystSave({ borrador: text });
  go("analyst");
  requestAnimationFrame(() =>
    $("analystCouponText")?.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
}

document.addEventListener("click", (e) => {
  const run = e.target.closest("[data-analyst-run]");
  if (run) return runAnalyst(run.dataset.analystRun);
  if (e.target.closest("[data-analyst-cancel]")) return analystAbort?.abort();
  if (e.target.closest("[data-analyst-key]")) {
    const v = ($("analystKey")?.value || "").trim();
    analystSave({ clave: v });
    toast(v ? "Código guardado en este teléfono." : "Código borrado.");
    if (!analystBusy) renderAnalyst();
    return;
  }
  if (e.target.closest("[data-analyst-preview]")) {
    if (!draftSelections.length) return toast("Primero lee un cupón.");
    const extra = [];
    if ($("stake")?.value) extra.push("Importe: L " + $("stake").value);
    if ($("totalOdds")?.value) extra.push("Cuota total: " + $("totalOdds").value);
    openAnalystWith(fixturesAsText(draftSelections) + (extra.length ? "\n" + extra.join("\n") : ""));
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "analystCouponPick") return;
  const c = db.coupons.find((x) => x.id === e.target.value);
  if (c) {
    $("analystCouponText").value = couponAsText(c);
    analystSave({ borrador: $("analystCouponText").value });
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "analystBuildText") {
    clearTimeout(analystSave.tb);
    analystSave.tb = setTimeout(() => analystSave({ armarBorrador: e.target.value.slice(0, 6000) }), 400);
    return;
  }
  if (e.target.id !== "analystCouponText") return;
  clearTimeout(analystSave.t);
  analystSave.t = setTimeout(() => analystSave({ borrador: e.target.value.slice(0, 12000) }), 400);
});
