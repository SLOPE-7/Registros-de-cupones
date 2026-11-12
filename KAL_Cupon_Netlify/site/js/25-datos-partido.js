// Pestaña "📈 Datos" de la ficha del partido (V16): forma reciente, tabla, enfrentamientos directos y un modelo de
// goles (Poisson) con la probabilidad de 1X2, más/menos goles y ambos marcan. Cuando un mercado tuyo coincide con
// el modelo, se compara la probabilidad del modelo con la de tu cuota (valor esperado).
// Fuente: football-data.org (plan gratis: ligas principales de Europa, Champions, Mundial y Eurocopa).
"use strict";

const matchFormCache = {};
const pctR = (p) => Math.round(p * 100) + " %";

async function loadMatchForm(f, force = false) {
  const key = fixtureKey(f);
  const date = scheduleISO(f);
  if (!date) {
    matchFormCache[key] = { error: "Completa la fecha del partido para buscar sus datos." };
    return;
  }
  if (!force && matchFormCache[key] && !matchFormCache[key].loading && !matchFormCache[key].error) return;
  matchFormCache[key] = { loading: true };
  try {
    const r = await fetch("/api/datos-partido?" + new URLSearchParams({ home: f.home, away: f.away, date }), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "No se pudieron cargar los datos (error " + r.status + ").");
    matchFormCache[key] = d;
  } catch (e) {
    matchFormCache[key] = {
      error: e.name === "TimeoutError" ? "La consulta tardó demasiado. Prueba otra vez." : e.message,
    };
  }
  if (currentMatchRef && matchActiveTab === "datos") renderMatchDetail(currentMatchRef);
}

// Probabilidad del modelo para un mercado (desde el punto de vista del cupón: "1" = local del cupón).
function modelProbForMarket(m, f, model, swapped) {
  if (!model || m.builder) return null;
  const p1 = swapped ? model.p2 : model.p1,
    p2 = swapped ? model.p1 : model.p2,
    px = model.px;
  const x = crestNorm((m.market || "") + " " + (m.pick || "")),
    pick = crestNorm(m.pick || ""),
    home = crestNorm(f.home),
    away = crestNorm(f.away);
  // Mercados de un solo equipo, jugadores, córners, tarjetas o mitades: el modelo no aplica.
  if (
    /corner|esquina|tarjeta|remate|tiro|jugador|anota|goleador|mitad|tiempo|handicap|exacto|marcador/.test(x)
  )
    return null;
  if (/ambos/.test(x)) {
    if (/\bsi\b|\byes\b/.test(pick)) return model.btts;
    if (/\bno\b/.test(pick)) return 1 - model.btts;
    return null;
  }
  // crestNorm convierte "1.5" en "1 5".
  const line = x.match(/(mas|menos|over|under) (de )?(\d+)( 5)?\b/);
  if (line && /gol|total|mas de|menos de|over|under/.test(x)) {
    if ((home && x.includes(home)) || (away && x.includes(away))) return null; // goles de un solo equipo
    const n = Number(line[3]) + (line[4] ? 0.5 : 0);
    const over = { 0.5: model.over05, 1.5: model.over15, 2.5: model.over25, 3.5: model.over35 }[n];
    if (over == null) return null;
    return /mas|over/.test(line[1]) ? over : 1 - over;
  }
  if (/doble oportunidad/.test(x) || /^(1x|x2|12)$/.test(pick)) {
    if (/^1x$|local o empate/.test(pick)) return p1 + px;
    if (/^x2$|empate o visit/.test(pick)) return px + p2;
    if (/^12$/.test(pick)) return p1 + p2;
    return null;
  }
  if (/1x2|resultado final|ganador del partido|ganador|resultado del partido|match result/.test(x)) {
    if (pick === "1" || (home && pick === home)) return p1;
    if (pick === "x" || /empate|draw/.test(pick)) return px;
    if (pick === "2" || (away && pick === away)) return p2;
  }
  return null;
}

function formChips(list) {
  if (!list?.length) return '<span class="small muted">Sin partidos recientes.</span>';
  return list
    .map(
      (m) =>
        '<span class="form-chip is-' +
        m.resultado +
        '" title="' +
        esc(m.fecha + " · " + (m.enCasa ? "vs " : "en ") + m.rival + " · " + m.marcador) +
        '">' +
        m.resultado +
        "</span>",
    )
    .join("");
}
function formList(list) {
  return (list || [])
    .map(
      (m) =>
        '<li><span class="form-chip is-' +
        m.resultado +
        '">' +
        m.resultado +
        "</span>" +
        esc((m.enCasa ? "vs " : "en ") + m.rival) +
        " <b>" +
        esc(m.marcador) +
        '</b><small class="muted"> · ' +
        esc(m.fecha) +
        "</small></li>",
    )
    .join("");
}
function probBar(label, p, extra = "") {
  return (
    '<div class="dp-prob"><span>' +
    esc(label) +
    '</span><div class="mk-bar"><i style="width:' +
    Math.round(p * 100) +
    '%"></i></div><b>' +
    pctR(p) +
    "</b>" +
    extra +
    "</div>"
  );
}

function renderFormPanel(f, merged) {
  const key = fixtureKey(f),
    d = matchFormCache[key];
  if (!d) {
    setTimeout(() => loadMatchForm(f));
    return '<div class="match-loading"><span class="spinner"></span> Buscando forma, tabla y enfrentamientos…</div>';
  }
  if (d.loading)
    return '<div class="match-loading"><span class="spinner"></span> Buscando forma, tabla y enfrentamientos…</div>';
  if (d.error)
    return (
      '<div class="notice">' +
      esc(d.error) +
      '</div><button type="button" class="btn sm" data-reload-form>↻ Reintentar</button>'
    );
  if (!d.encontrado) return '<div class="notice">' + esc(d.motivo) + "</div>";
  const md = d.modelo,
    sw = !!d.alReves;
  const L = d.partido.local.nombre,
    V = d.partido.visitante.nombre;
  let html = "";
  // Tus mercados frente al modelo
  if (md) {
    const rows = [...merged.values()]
      .map((x) => {
        const p = modelProbForMarket(x.m, x.f, md, sw);
        if (p == null) return "";
        const odd = legOdd(x.f, x.m);
        const ev = odd ? p * odd - 1 : null;
        return (
          "<li><div><b>" +
          esc(x.m.market) +
          "</b>" +
          (x.m.pick ? " · " + esc(x.m.pick) : "") +
          "</div><span>Modelo " +
          pctR(p) +
          (odd ? " · cuota " + odd.toFixed(2) + " (" + Math.round(100 / odd) + " %)" : "") +
          "</span>" +
          (ev != null
            ? '<span class="clv-chip ' + (ev >= 0 ? "pos" : "neg") + '">' + signedPct(ev) + " valor</span>"
            : "") +
          "</li>"
        );
      })
      .filter(Boolean);
    if (rows.length)
      html +=
        '<section class="dp-block"><h3>🎯 Tus mercados frente al modelo</h3><ul class="dp-markets">' +
        rows.join("") +
        '</ul><p class="small muted">Valor positivo = el modelo ve más probable tu pick de lo que paga la cuota. Es una estimación: úsala junto con tu lectura del partido.</p></section>';
    html +=
      '<section class="dp-block"><h3>📊 Modelo de goles</h3><p class="small muted">Goles esperados: ' +
      esc(L) +
      " " +
      md.lambdaLocal.toFixed(2) +
      " · " +
      esc(V) +
      " " +
      md.lambdaVisitante.toFixed(2) +
      " (según " +
      esc(md.base) +
      ")</p>" +
      probBar("Gana " + L, md.p1) +
      probBar("Empate", md.px) +
      probBar("Gana " + V, md.p2) +
      probBar("Más de 1.5 goles", md.over15) +
      probBar("Más de 2.5 goles", md.over25) +
      probBar("Más de 3.5 goles", md.over35) +
      probBar("Ambos marcan", md.btts) +
      "</section>";
  } else
    html +=
      '<div class="notice">No hay datos suficientes para el modelo de goles (equipos sin tabla ni partidos recientes).</div>';
  const t = d.tabla;
  if (t?.local && t?.visitante) {
    const row = (name, r, split, splitLabel) =>
      "<tr><td><b>" +
      esc(name) +
      "</b></td><td>" +
      r.posicion +
      "º</td><td>" +
      r.puntos +
      "</td><td>" +
      r.golesFavor +
      ":" +
      r.golesContra +
      "</td><td>" +
      (split
        ? split.ganados + "-" + split.empates + "-" + split.perdidos + " <small>" + splitLabel + "</small>"
        : "—") +
      "</td></tr>";
    html +=
      '<section class="dp-block"><h3>🏆 Tabla' +
      (t.equipos ? " (" + t.equipos + " equipos)" : "") +
      '</h3><table class="dp-table"><thead><tr><th></th><th>Pos</th><th>Pts</th><th>Goles</th><th>G-E-P</th></tr></thead><tbody>' +
      row(L, t.local, t.localEnCasa, "en casa") +
      row(V, t.visitante, t.visitanteFuera, "fuera") +
      "</tbody></table></section>";
  }
  html +=
    '<section class="dp-block"><h3>📈 Forma reciente</h3><div class="dp-form"><div><b>' +
    esc(L) +
    '</b><div class="form-row">' +
    formChips(d.forma?.local) +
    '</div><ul class="dp-list">' +
    formList(d.forma?.local) +
    "</ul></div><div><b>" +
    esc(V) +
    '</b><div class="form-row">' +
    formChips(d.forma?.visitante) +
    '</div><ul class="dp-list">' +
    formList(d.forma?.visitante) +
    "</ul></div></div></section>";
  if (d.h2h?.partidos)
    html +=
      '<section class="dp-block"><h3>⚔️ Enfrentamientos directos</h3><p>' +
      d.h2h.partidos +
      " partidos · " +
      esc(L) +
      " " +
      (d.h2h.local.ganados ?? 0) +
      " · empates " +
      (d.h2h.local.empates ?? 0) +
      " · " +
      esc(V) +
      " " +
      (d.h2h.visitante.ganados ?? 0) +
      " · " +
      (d.h2h.goles ?? 0) +
      ' goles</p><ul class="dp-list">' +
      (d.h2h.ultimos || [])
        .map(
          (x) =>
            "<li>" +
            esc(x.local + " " + x.marcador + " " + x.visitante) +
            '<small class="muted"> · ' +
            esc(x.fecha) +
            "</small></li>",
        )
        .join("") +
      "</ul></section>";
  return (
    html +
    '<p class="small muted dp-source">Datos: ' +
    esc(d.fuente) +
    (sw ? " · la casa puso los equipos al revés; se usa el orden oficial" : "") +
    ' · <button type="button" class="linkish" data-reload-form>↻ Actualizar</button></p>'
  );
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-reload-form]") || !currentMatchRef) return;
  const c = db.coupons.find((x) => x.id === currentMatchRef.couponId),
    f = currentMatchRef.draft
      ? draftSelections[Number(currentMatchRef.fixtureIndex)]
      : c?.fixtures?.[Number(currentMatchRef.fixtureIndex)];
  if (f) {
    loadMatchForm(f, true);
    renderMatchDetail(currentMatchRef);
  }
});
