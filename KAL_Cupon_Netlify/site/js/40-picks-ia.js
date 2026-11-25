// V30 · Picks de la IA.
// - Pegas los partidos (y las cuotas de tu casa) y el Analista elige como mucho 3 apuestas simples con valor
//   (probabilidad × cuota − 1 ≥ 5 %), o dice que hoy no hay apuesta buena.
// - Cada pick se guarda solo en db.aiPicks y cuenta en el MODO PRUEBA (en unidades, sin dinero): así se mide si
//   la IA de verdad gana antes de arriesgar. Con «💵 Apostar de verdad» el pick pasa a Nuevo cupón con su monto
//   (unidades × tu unidad) y queda marcado como real.
// - El resultado se toma solo de tus cupones guardados (si el mismo mercado se marca ganado/perdido/nulo) o lo
//   marcas a mano en el pick.
"use strict";

const PICKS_PRUEBA_META = 30; // picks resueltos antes de fiarse de los números
let picksBusy = false,
  picksOpenLast = false;

const aiPicksList = () => (db.aiPicks = Array.isArray(db.aiPicks) ? db.aiPicks : []);
const pickUnits = (p) => (Number(p.unidades) > 0 ? Math.min(1, Number(p.unidades)) : 0.5);
// Cuota con la que se calcula la ganancia: la real si la hay; si no, la mínima que pidió la IA.
const pickOdd = (p) =>
  Number(p.cuota) > 1 ? Number(p.cuota) : Number(p.cuotaMinima) > 1 ? Number(p.cuotaMinima) : 0;
const pickValue = (p) => (pickOdd(p) && Number(p.p) > 0 ? Number(p.p) * pickOdd(p) - 1 : null);
function pickSplitMatch(partido) {
  const m = String(partido || "").match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  return m ? { home: m[1].trim(), away: m[2].trim() } : { home: String(partido || "").trim(), away: "" };
}

// Lee el bloque <kal-json> de la respuesta y guarda los picks nuevos.
function addPicksFromText(text) {
  const v = parseAiVerdict(text);
  const list = Array.isArray(v?.picks) ? v.picks : [];
  const now = new Date().toISOString(),
    batch = uid(),
    added = [];
  list.slice(0, 3).forEach((it) => {
    const p = Number(it?.p),
      conf = nivelOf(it?.confianza);
    if (!it?.partido || !it?.mercado || !(p > 0 && p <= 1) || conf === "Baja") return;
    const { home, away } = pickSplitMatch(it.partido);
    const pick = {
      id: uid(),
      batch,
      created: now,
      updated: now,
      partido: String(it.partido).slice(0, 120),
      home,
      away,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(it.fecha || "") ? it.fecha : "",
      hora: /^\d{1,2}:\d{2}$/.test(it.hora || "") ? it.hora.padStart(5, "0") : "",
      competicion: String(it.competicion || "").slice(0, 80),
      mercado: String(it.mercado).slice(0, 120),
      seleccion: String(it.seleccion || "").slice(0, 80),
      cuota: Number(it.cuota) > 1 ? Math.round(Number(it.cuota) * 100) / 100 : null,
      cuotaMinima: Number(it.cuotaMinima) > 1 ? Math.round(Number(it.cuotaMinima) * 100) / 100 : null,
      p: Math.round(p * 100) / 100,
      confianza: conf || "Media",
      unidades: Number(it.unidades) >= 1 ? 1 : 0.5,
      motivo: String(it.motivo || "").slice(0, 240),
      result: "pending",
      real: false,
    };
    // El mismo pick pedido dos veces el mismo día no se duplica.
    const dup = aiPicksList().some(
      (x) =>
        crestNorm(x.partido) === crestNorm(pick.partido) &&
        crestNorm(x.mercado + " " + x.seleccion) === crestNorm(pick.mercado + " " + pick.seleccion) &&
        String(x.created).slice(0, 10) === now.slice(0, 10),
    );
    if (!dup) added.push(pick);
  });
  aiPicksList().push(...added);
  return { added, sinApuesta: !!v?.sinApuesta && !added.length, parsed: !!v };
}

// Resultado automático: si el mismo mercado está en un cupón guardado y ya se marcó.
function syncPicksFromCoupons() {
  let changed = false;
  aiPicksList().forEach((p) => {
    if (p.result !== "pending" || p.manual) return;
    for (const c of db.coupons) {
      const hit = findLeg(c, { partido: p.partido, mercado: p.mercado, seleccion: p.seleccion });
      const s = hit?.m?.settlement;
      if (s === "won" || s === "lost" || s === "void") {
        p.result = s;
        p.resolvedAt = new Date().toISOString();
        p.updated = p.resolvedAt;
        p.fromCoupon = c.id;
        changed = true;
        break;
      }
    }
  });
  return changed;
}

function picksStats(filter = () => true) {
  const all = aiPicksList().filter(filter),
    done = all.filter((p) => p.result === "won" || p.result === "lost");
  let units = 0,
    profitU = 0,
    stakeL = 0,
    profitL = 0,
    pSum = 0;
  done.forEach((p) => {
    const u = pickUnits(p),
      odd = pickOdd(p) || 1;
    units += u;
    profitU += p.result === "won" ? u * (odd - 1) : -u;
    pSum += Number(p.p) || 0;
    if (p.real && Number(p.stake) > 0) {
      stakeL += Number(p.stake);
      profitL += p.result === "won" ? Number(p.stake) * (odd - 1) : -Number(p.stake);
    }
  });
  const won = done.filter((p) => p.result === "won").length;
  return {
    total: all.length,
    pending: all.filter((p) => p.result === "pending").length,
    resolved: done.length,
    won,
    hit: done.length ? won / done.length : null,
    pMedia: done.length ? pSum / done.length : null,
    units,
    profitU,
    yield: units ? profitU / units : null,
    stakeL,
    profitL,
  };
}
// Lo que se le dice a la IA sobre sus picks anteriores (para que se corrija).
function picksPayload() {
  const s = picksStats();
  if (!s.resolved) return undefined;
  return {
    resueltos: s.resolved,
    acertados: s.won,
    probabilidadMediaQueDiste: Math.round(s.pMedia * 100) / 100,
    aciertoReal: Math.round(s.hit * 100) / 100,
    gananciaEnUnidades: Math.round(s.profitU * 100) / 100,
  };
}

// ---------- Pantalla ----------
const pkPct = (x) => Math.round(x * 100) + " %";
const pkSigned = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
function picksVerdictHtml(s) {
  if (!s.resolved)
    return (
      '<div class="notice">🧪 <b>Modo prueba.</b> Cada pick se registra solo y cuenta en unidades, sin dinero. Cuando haya ' +
      PICKS_PRUEBA_META +
      " picks resueltos sabrás si la IA gana de verdad.</div>"
    );
  if (s.resolved < PICKS_PRUEBA_META)
    return (
      '<div class="notice">🧪 <b>' +
      s.resolved +
      " de " +
      PICKS_PRUEBA_META +
      " picks resueltos.</b> Aún es poco para saber si la IA gana" +
      (s.profitU < 0 ? ", y por ahora va en negativo" : "") +
      ". Si apuestas de verdad, que sea 1 unidad como máximo.</div>"
    );
  return s.yield > 0
    ? '<div class="notice pick-good">✅ <b>La IA va en positivo</b> con ' +
        s.resolved +
        " picks (rendimiento " +
        pkSigned(s.yield * 100, 1) +
        " %). Sigue con montos fijos de 1 unidad o menos: una buena racha no garantiza la siguiente.</div>"
    : '<div class="notice pick-bad">⛔ <b>La IA va en negativo</b> con ' +
        s.resolved +
        " picks (rendimiento " +
        pkSigned(s.yield * 100, 1) +
        " %). Con estos números no conviene seguirla con dinero real.</div>";
}
function pickCardHtml(p) {
  const v = pickValue(p),
    when = [p.fecha ? p.fecha.split("-").reverse().join("/") : "", p.hora].filter(Boolean).join(" · "),
    res = { won: "✓ Ganado", lost: "✕ Perdido", void: "＝ Nulo" }[p.result],
    btn = (val, label, cls) =>
      '<button type="button" class="mk-btn ' +
      cls +
      (p.result === val ? " selected" : "") +
      '" data-pick-res="' +
      esc(p.id) +
      '" data-v="' +
      val +
      '">' +
      label +
      "</button>";
  return (
    '<article class="pick-card st-' +
    esc(p.result) +
    '" data-pick="' +
    esc(p.id) +
    '"><div class="pick-top"><b>' +
    esc(p.partido) +
    "</b>" +
    (when ? "<small>" + esc(when) + "</small>" : "") +
    '</div><div class="pick-mk">' +
    esc(p.mercado) +
    (p.seleccion ? " · <b>" + esc(p.seleccion) + "</b>" : "") +
    '</div><div class="pick-meta">' +
    (p.cuota
      ? "<span>Cuota <b>" + esc(p.cuota.toFixed(2)) + "</b></span>"
      : p.cuotaMinima
        ? "<span>Solo si la cuota es <b>≥ " + esc(p.cuotaMinima.toFixed(2)) + "</b></span>"
        : "") +
    "<span>≈ " +
    pkPct(p.p) +
    "</span>" +
    (v !== null ? "<span>valor " + pkSigned(v * 100, 0) + " %</span>" : "") +
    "<span>" +
    esc(p.confianza) +
    "</span><span>" +
    (pickUnits(p) === 1 ? "1 unidad" : "½ unidad") +
    "</span></div>" +
    (p.motivo ? '<div class="pick-why small muted">' + esc(p.motivo) + "</div>" : "") +
    '<div class="pick-tags"><span class="pick-tag">🧪 Prueba</span>' +
    (p.real ? '<span class="pick-tag real">💵 Real · ' + money(Number(p.stake) || 0) + "</span>" : "") +
    (res
      ? '<span class="pick-tag res-' +
        esc(p.result) +
        '">' +
        res +
        (p.fromCoupon ? " (de tu cupón)" : "") +
        "</span>"
      : "") +
    "</div>" +
    (p.result === "pending"
      ? '<div class="pick-actions">' +
        (p.real
          ? ""
          : '<button type="button" class="btn sm gold" data-pick-real="' +
            esc(p.id) +
            '">💵 Apostar de verdad</button>') +
        '<button type="button" class="btn sm" data-pick-odd="' +
        esc(p.id) +
        '">✎ Cuota</button><button type="button" class="btn sm" data-pick-del="' +
        esc(p.id) +
        '" aria-label="Borrar pick">🗑</button></div><div class="mk-actions">' +
        btn("won", "✓ Ganado", "won") +
        btn("lost", "✕ Perdido", "lost") +
        btn("void", "＝ Nulo", "void") +
        "</div>"
      : '<div class="pick-actions"><button type="button" class="btn sm" data-pick-res="' +
        esc(p.id) +
        '" data-v="pending">↺ Volver a pendiente</button></div>') +
    "</article>"
  );
}
function picksSectionHtml() {
  const st = analystState(),
    all = picksStats(),
    real = picksStats((p) => p.real),
    list = aiPicksList(),
    pending = list
      .filter((p) => p.result === "pending")
      .sort((a, b) => String(a.fecha + a.hora).localeCompare(String(b.fecha + b.hora))),
    done = list
      .filter((p) => p.result !== "pending")
      .sort((a, b) => String(b.resolvedAt || b.updated).localeCompare(String(a.resolvedAt || a.updated)));
  const box = (t, main, sub) =>
    '<div class="ps-box"><small>' +
    t +
    "</small><b>" +
    main +
    "</b>" +
    (sub ? "<span>" + sub + "</span>" : "") +
    "</div>";
  return (
    '<section class="panel analyst-card picks-card" id="picksCard"><div class="ph"><div><h2>🎯 Picks de la IA</h2><div class="marketmeta">Solo apuestas simples con valor. Se registran solas para medir si la IA gana.</div></div></div><div class="pb">' +
    '<div class="picks-stats">' +
    box(
      "🧪 Todos los picks (prueba)",
      all.resolved ? all.won + " de " + all.resolved + " acertados · " + pkPct(all.hit) : "Sin resultados aún",
      all.resolved
        ? pkSigned(all.profitU) + " unidades · rendimiento " + pkSigned(all.yield * 100, 1) + " %"
        : all.pending
          ? all.pending + " pendiente(s)"
          : "",
    ) +
    box(
      "💵 Lo que apostaste de verdad",
      real.resolved ? (real.profitL >= 0 ? "+" : "−") + money(Math.abs(real.profitL)) : "Nada aún",
      real.resolved
        ? real.won + " de " + real.resolved + " acertados · apostado " + money(real.stakeL)
        : real.pending
          ? real.pending + " pendiente(s)"
          : "",
    ) +
    "</div>" +
    (all.resolved >= 5
      ? '<p class="small muted picks-cal">La IA dio en promedio <b>' +
        pkPct(all.pMedia) +
        "</b> de probabilidad y acertó el <b>" +
        pkPct(all.hit) +
        "</b>." +
        (all.hit < all.pMedia - 0.08 ? " Está siendo optimista." : "") +
        "</p>"
      : "") +
    picksVerdictHtml(all) +
    '<div class="field"><label for="picksText">Partidos y cuotas de tu casa</label><textarea id="picksText" class="analyst-text" placeholder="Ej.\nReal Madrid vs PSV — 1: 1.55 · X: 4.30 · 2: 5.50 · Más de 2.5: 1.62\nArsenal vs Dortmund — Ambos marcan Sí: 1.70\n(o pega el cupón copiado de tu casa)">' +
    esc(st.picksBorrador || "") +
    "</textarea></div>" +
    '<p class="small muted">Con las cuotas reales de tu casa la IA calcula el valor exacto; sin ellas te dice la cuota mínima a la que vale la pena. Tarda 1–2 minutos y cuesta aprox. US$0.20–0.50 por consulta.</p>' +
    '<button type="button" class="btn gold" data-picks-run>✦ Pedir picks</button>' +
    '<div class="analyst-out" id="picksOut" aria-live="polite">' +
    (st.picks?.texto
      ? '<details class="picks-last"' +
        (picksOpenLast ? " open" : "") +
        '><summary class="small">Ver el último análisis completo</summary><div class="analyst-md">' +
        renderMd(stripAiJson(st.picks.texto)) +
        "</div></details>"
      : "") +
    "</div>" +
    (pending.length ? '<h3 class="picks-h">Pendientes</h3>' + pending.map(pickCardHtml).join("") : "") +
    (done.length
      ? '<details class="picks-done"><summary class="small"><b>Resueltos (' +
        done.length +
        ")</b></summary>" +
        done.slice(0, 40).map(pickCardHtml).join("") +
        "</details>"
      : "") +
    "</div></section>"
  );
}

// La sección va arriba de todo en la pantalla del Analista.
const renderAnalystBase = renderAnalyst;
renderAnalyst = function () {
  renderAnalystBase();
  const el = $("analystView");
  if (!el) return;
  if (syncPicksFromCoupons()) save();
  const warn = el.querySelector(".analyst-warn");
  if (warn) warn.insertAdjacentHTML("afterend", picksSectionHtml());
  else el.insertAdjacentHTML("afterbegin", picksSectionHtml());
};

async function runPicks() {
  if (picksBusy || analystBusy) return;
  const texto = ($("picksText")?.value || "").trim();
  if (texto.length < 10) return toast("Escribe los partidos (y si puedes, las cuotas de tu casa).");
  const datos = { texto: texto.slice(0, 8000) };
  try {
    datos.partidos = analystFixtureList(parseCoupon(texto).fixtures);
  } catch {}
  const h = analystShortHistory();
  if (h) datos.historial = h;
  datos.banca = { unidad: unitStake() || null, rachaPerdidos: lossStreak() };
  datos.precisionAnalista = aiPrecisionPayload();
  datos.picksAnteriores = picksPayload();
  picksBusy = analystBusy = true;
  setAnalystButtons(true);
  document.querySelectorAll("[data-picks-run]").forEach((b) => (b.disabled = true));
  const out = $("picksOut");
  out.innerHTML =
    '<div class="analyst-live"><div class="analyst-status"><span class="analyst-dot"></span><span data-status>Conectando…</span><button type="button" class="btn sm" data-analyst-cancel>Cancelar</button></div><div class="analyst-md" data-md></div></div>';
  const status = out.querySelector("[data-status]"),
    md = out.querySelector("[data-md]");
  let frame = 0,
    ok = false;
  try {
    const { text } = await analystRequest("picks", datos, {
      onStatus: (s) => (status.textContent = s),
      onText: (t) => {
        status.textContent = "Escribiendo…";
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => (md.innerHTML = renderMd(stripAiJson(t))));
      },
      onReset: () => (md.innerHTML = ""),
    });
    cancelAnimationFrame(frame);
    analystSave({ picks: { texto: text, fecha: new Date().toISOString() } });
    const r = addPicksFromText(text);
    save();
    ok = true;
    picksBusy = analystBusy = false;
    picksOpenLast = true;
    renderAnalyst();
    toast(
      r.added.length
        ? "🎯 " + r.added.length + " pick(s) registrados en modo prueba."
        : r.sinApuesta
          ? "La IA no encontró ninguna apuesta con valor hoy. No apostar también es una decisión."
          : r.parsed
            ? "No hubo picks nuevos."
            : "No pude leer los picks de la respuesta; revisa el análisis.",
    );
  } catch (e) {
    cancelAnimationFrame(frame);
    out.innerHTML =
      '<div class="notice analyst-error">' +
      esc(e.name === "AbortError" ? "Análisis cancelado." : e.message) +
      "</div>";
  } finally {
    picksBusy = analystBusy = false;
    analystAbort = null;
    setAnalystButtons(false);
    if (!ok) document.querySelectorAll("[data-picks-run]").forEach((b) => (b.disabled = false));
  }
}

// Pasa el pick a Nuevo cupón para apostarlo con dinero real.
function betPickForReal(id) {
  const p = aiPicksList().find((x) => x.id === id);
  if (!p) return;
  const s = picksStats();
  const avisos = [];
  if (s.resolved < PICKS_PRUEBA_META)
    avisos.push(
      "La IA lleva " +
        s.resolved +
        " de " +
        PICKS_PRUEBA_META +
        " picks de prueba resueltos: todavía no se sabe si gana.",
    );
  else if (s.yield <= 0)
    avisos.push("La IA va en negativo en modo prueba (" + pkSigned(s.yield * 100, 1) + " %).");
  const streak = lossStreak();
  if (streak >= (Number(bankrollCfg().pausaTras) || 3))
    avisos.push("Llevas " + streak + " cupones perdidos seguidos: tu regla dice hacer una pausa.");
  let cuota = Number(p.cuota) || 0;
  if (!cuota) {
    const a = prompt(
      "¿Qué cuota te da tu casa para «" +
        p.mercado +
        " · " +
        p.seleccion +
        "»?" +
        (p.cuotaMinima ? " (vale la pena desde " + p.cuotaMinima.toFixed(2) + ")" : ""),
      p.cuotaMinima ? p.cuotaMinima.toFixed(2) : "",
    );
    if (a === null) return;
    cuota = Number(String(a).replace(",", "."));
    if (!(cuota > 1)) return toast("Escribe una cuota válida, por ejemplo 1.75.");
    if (p.cuotaMinima && cuota < p.cuotaMinima)
      avisos.push(
        "Tu casa paga " +
          cuota.toFixed(2) +
          ", menos que la cuota mínima (" +
          p.cuotaMinima.toFixed(2) +
          "): así el pick no tiene valor.",
      );
  }
  let stake = Math.round(pickUnits(p) * unitStake() * 100) / 100;
  if (!stake) {
    const a = prompt(
      "¿Cuánto vas a apostar (L)? Define tu banca en Ajustes para que KAL lo calcule solo.",
      "",
    );
    if (a === null) return;
    stake = Number(String(a).replace(",", "."));
    if (!(stake > 0)) return toast("Escribe un monto válido.");
  }
  if (
    !confirm(
      (avisos.length ? "⚠️ " + avisos.join("\n⚠️ ") + "\n\n" : "") +
        "¿Apostar " +
        money(stake) +
        " a «" +
        p.partido +
        " · " +
        p.mercado +
        " · " +
        p.seleccion +
        "» a cuota " +
        cuota.toFixed(2) +
        "?",
    )
  )
    return;
  p.real = true;
  p.stake = stake;
  p.cuota = Math.round(cuota * 100) / 100;
  p.updated = new Date().toISOString();
  save();
  const [y, m, d] = (p.fecha || localISODate()).split("-");
  const text = [
    (p.home || p.partido) + (p.away ? " vs. " + p.away : ""),
    d + "/" + m + "/" + y + " • " + (p.hora || "12:00"),
    String(p.mercado).replace(/:/g, " -"),
    String(p.seleccion || "").replace(/:/g, " -") || "—",
    p.cuota.toFixed(2),
  ].join("\n");
  go("new");
  $("raw").value = text;
  readText();
  $("stake").value = String(stake);
  $("totalOdds").value = p.cuota.toFixed(2);
  $("payout").value = String(Math.round(stake * p.cuota * 100) / 100);
  $("couponName").value = "Pick IA · " + p.partido;
  ["stake", "totalOdds", "payout"].forEach((id) => $(id).classList.remove("need-input"));
  if (typeof updatePayoutHint === "function") updatePayoutHint();
  toast("💵 Elige tu casa y guarda el cupón. El pick queda marcado como apuesta real.");
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-picks-run]")) return runPicks();
  const real = e.target.closest("[data-pick-real]");
  if (real) return betPickForReal(real.dataset.pickReal);
  const res = e.target.closest("[data-pick-res]");
  if (res) {
    const p = aiPicksList().find((x) => x.id === res.dataset.pickRes);
    if (!p) return;
    p.result = res.dataset.v;
    p.manual = res.dataset.v !== "pending";
    p.resolvedAt = res.dataset.v === "pending" ? null : new Date().toISOString();
    if (res.dataset.v === "pending") delete p.fromCoupon;
    p.updated = new Date().toISOString();
    save();
    return renderAnalyst();
  }
  const odd = e.target.closest("[data-pick-odd]");
  if (odd) {
    const p = aiPicksList().find((x) => x.id === odd.dataset.pickOdd);
    if (!p) return;
    const a = prompt("Cuota que te da tu casa para este pick:", p.cuota ? p.cuota.toFixed(2) : "");
    if (a === null) return;
    const v = Number(String(a).replace(",", "."));
    if (!(v > 1)) return toast("Escribe una cuota válida, por ejemplo 1.75.");
    p.cuota = Math.round(v * 100) / 100;
    p.updated = new Date().toISOString();
    save();
    if (p.cuotaMinima && v < p.cuotaMinima)
      toast("Con esa cuota el pick no tiene valor (mínimo " + p.cuotaMinima.toFixed(2) + ").");
    return renderAnalyst();
  }
  const del = e.target.closest("[data-pick-del]");
  if (del) {
    const id = del.dataset.pickDel;
    if (!confirm("¿Borrar este pick? Dejará de contar en las estadísticas de la IA.")) return;
    db.aiPicks = aiPicksList().filter((x) => x.id !== id);
    db.deleted = db.deleted || {};
    db.deleted.aiPicks = [...(db.deleted.aiPicks || []), id].slice(-2000);
    save();
    return renderAnalyst();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "picksText") return;
  clearTimeout(runPicks.t);
  runPicks.t = setTimeout(() => analystSave({ picksBorrador: e.target.value.slice(0, 8000) }), 400);
});
