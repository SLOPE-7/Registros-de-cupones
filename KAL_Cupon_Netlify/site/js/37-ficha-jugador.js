// V23 · Ficha del jugador: con lo que has anotado de él (remates, remates a puerta, goles, tarjetas, paradas) calcula
// la probabilidad de cada línea en sus últimos partidos registrados y la "cuota justa" (1 ÷ probabilidad). Si tienes
// un mercado suyo en el partido, compara tu cuota con esa cuota justa (valor esperado).
// La probabilidad es (aciertos + 1) ÷ (partidos + 2): se suaviza para no dar nunca 0 % ni 100 % con pocos partidos.
"use strict";

const PC_STATS = [
  {
    id: "remates",
    label: "Remates",
    icon: "🎯",
    field: "remates",
    sub: "rematesConSup",
    lines: [0.5, 1.5, 2.5, 3.5],
  },
  {
    id: "aPuerta",
    label: "Remates a puerta",
    icon: "🥅",
    field: "aPuerta",
    sub: "aPuertaConSup",
    lines: [0.5, 1.5, 2.5],
  },
  { id: "goles", label: "Goleador (marca gol)", icon: "⚽", field: "goles", lines: [0.5] },
  { id: "tarjetas", label: "Tarjetas", icon: "🟨", field: "tarjetas", lines: [0.5] },
  { id: "paradas", label: "Paradas del portero", icon: "🧤", field: "paradas", lines: [1.5, 2.5, 3.5, 4.5] },
];
const PC_STAT_OF = { onTarget: "aPuerta", shots: "remates", cards: "tarjetas", saves: "paradas" };
let pcState = null; // { pk, fk, withSub }

// Nombre y foto del jugador, buscados en los mercados de tus cupones.
function pcPlayerInfo(pk) {
  let name = "",
    photo = "";
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) =>
      f.markets.forEach((m) => {
        const b = parsePlayerBet(m, f);
        if (!b?.name || crestNorm(b.name) !== pk) return;
        name = name || b.name;
        photo = photo || savedPlayerPhoto(marketKey(f, m), f, m);
      }),
    ),
  );
  return { name, photo };
}

// Mercados del jugador que ya tienes en ese partido (para comparar tu cuota con la cuota justa).
function pcMine(pk, fk) {
  const out = [];
  if (!fk) return out;
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      if (fixtureKey(f) !== fk) return;
      f.markets.forEach((m) => {
        const info = parseLine(m, f),
          kind = info && statKind(m, f, info);
        if (kind?.type === "player" && kind.playerKey === pk && info.dir === "over") {
          out.push({ id: PC_STAT_OF[kind.stat], line: info.line, odd: legOdd(f, m), incl: kind.incl });
          return;
        }
        const b = parsePlayerBet(m, f),
          t = (m.market || "") + " " + (m.pick || "");
        if (
          b?.name &&
          crestNorm(b.name) === pk &&
          /goleador|anotador|anota|marcar[aá]? en cualquier/i.test(t) &&
          !/primer|[uú]ltimo/i.test(t)
        )
          out.push({ id: "goles", line: 0.5, odd: legOdd(f, m) });
      });
    }),
  );
  return out;
}

// Probabilidad de cada línea según los últimos partidos registrados.
function pcRows(p, withSub, mine) {
  return PC_STATS.map((s) => {
    const vals = (p?.matches || [])
      .map((m) => (withSub && s.sub ? (m[s.sub] ?? m[s.field]) : m[s.field]))
      .filter((v) => v != null)
      .slice(0, REC_LAST);
    const mineHere = mine.filter((x) => x.id === s.id);
    if (!vals.length && !mineHere.length) return null;
    const lines = [...new Set([...s.lines, ...mineHere.map((x) => x.line)])]
      .sort((a, b) => a - b)
      .map((line) => {
        const hits = vals.filter((v) => v > line).length,
          prob = vals.length ? (hits + 1) / (vals.length + 2) : null,
          mias = mineHere.filter((x) => x.line === line);
        return { line, hits, prob, fair: prob ? 1 / prob : null, mias };
      });
    return { ...s, vals, lines };
  }).filter(Boolean);
}

function pcLineHtml(s, l, n) {
  const mias = l.mias
    .map((x) => {
      if (!x.odd || l.prob == null) return '<span class="clv-chip">En tu cupón</span>';
      const ev = l.prob * x.odd - 1;
      return (
        '<span class="clv-chip ' +
        (ev >= 0 ? "pos" : "neg") +
        '">Tu cuota ' +
        x.odd.toFixed(2) +
        " · " +
        signedPct(ev) +
        " valor</span>"
      );
    })
    .join(" ");
  const lineLabel = s.id === "goles" ? "Marca gol" : "Más de " + l.line;
  return (
    '<div class="pc-line' +
    (l.mias.length ? " mine" : "") +
    '"><span>' +
    lineLabel +
    "</span>" +
    (l.prob == null
      ? '<span class="muted">sin datos</span><span></span><span></span>'
      : rsPill(l.prob) +
        '<span class="pc-odd" title="Cuota justa">' +
        l.fair.toFixed(2) +
        '</span><small class="pc-hits">' +
        l.hits +
        "/" +
        n +
        "</small>") +
    (mias ? '<div class="pc-mine">' + mias + "</div>" : "") +
    "</div>"
  );
}

function pcHtml() {
  const { pk, fk, withSub } = pcState,
    p = buildRecords().players.get(pk) || null,
    info = pcPlayerInfo(pk),
    name = p?.name || info.name || pk,
    mine = pcMine(pk, fk),
    rows = pcRows(p, withSub, mine),
    sum = p ? playerSummary(p) : null,
    photo = resolveImage(info.photo),
    initials = String(name)
      .split(/\s+/)
      .map((x) => x[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    comps = [...new Set((p?.matches || []).map((m) => m.competicion).filter(Boolean))].slice(0, 2);
  const hasSub = (p?.matches || []).some((m) => m.rematesConSup != null || m.aPuertaConSup != null);
  let html =
    '<div class="news-sheet pc-sheet"><div class="pc-head">' +
    (photo
      ? '<img class="pc-photo" src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="team-fallback pc-photo">' + esc(initials) + "</span>") +
    "<div><h2>" +
    esc(name) +
    "</h2>" +
    (sum
      ? '<div class="small muted">' +
        sum.porEquipo
          .map(
            (g) =>
              esc(g.equipo) + (g.tipo ? " (" + esc(g.tipo) + ")" : "") + " · " + g.partidos + " partido(s)",
          )
          .join(" · ") +
        (comps.length ? "<br>" + comps.map(esc).join(" · ") : "") +
        "</div>"
      : "") +
    "</div></div>";
  if (!p)
    html +=
      '<div class="notice small">Todavía no tienes partidos registrados de ' +
      esc(name) +
      ". Anota sus remates, tarjetas o paradas en el marcador de cada partido (📇 aparece junto a su nombre) y aquí verás su probabilidad en cada línea.</div>";
  if (hasSub)
    html +=
      '<div class="pc-toggle"><div class="chips" role="group" aria-label="Suplente"><button type="button" class="chip' +
      (withSub ? "" : " active") +
      '" data-pc-sub="0">Sin suplente</button><button type="button" class="chip' +
      (withSub ? " active" : "") +
      '" data-pc-sub="1">Con suplente</button></div><small class="muted">Con suplente suma también al jugador que lo reemplaza.</small></div>';
  html += rows.length
    ? rows
        .map(
          (s) =>
            '<section class="pc-stat"><div class="pc-stat-head"><b>' +
            s.icon +
            " " +
            esc(s.label) +
            '</b><small class="muted">' +
            (s.vals.length ? s.vals.join(" · ") + " (últimos " + s.vals.length + ")" : "sin registros") +
            (s.vals.length && s.vals.length < 3 ? " · pocos datos" : "") +
            "</small></div>" +
            s.lines.map((l) => pcLineHtml(s, l, s.vals.length)).join("") +
            "</section>",
        )
        .join("")
    : p
      ? '<div class="empty small">Aún no hay remates, tarjetas, paradas ni goles anotados de este jugador.</div>'
      : "";
  if (p?.matches.length)
    html +=
      '<details class="rs-more"><summary>Ver los partidos registrados</summary><table class="dp-table"><thead><tr><th>Fecha · rival</th><th>Rem</th><th>Pta</th><th>⚽</th><th>🟨</th><th>🧤</th></tr></thead><tbody>' +
      p.matches
        .slice(0, REC_LAST)
        .map(
          (m) =>
            "<tr><td>" +
            esc(String(m.fecha).slice(5) + " · " + (m.rival || "—")) +
            "</td><td>" +
            (m.remates ?? "—") +
            "</td><td>" +
            (m.aPuerta ?? "—") +
            "</td><td>" +
            (m.goles ?? "—") +
            "</td><td>" +
            (m.tarjetas ?? "—") +
            "</td><td>" +
            (m.paradas ?? "—") +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></details>";
  html +=
    '<p class="small muted">Probabilidad = (aciertos + 1) ÷ (partidos + 2) con tus últimos partidos registrados; la cuota justa es 1 ÷ probabilidad. Es una estimación con pocos datos, no la de la casa: úsala junto con tu lectura del partido y la titularidad.</p><button type="button" class="btn gold" data-pc-close>Cerrar</button></div>';
  return html;
}

function renderPlayerCard() {
  const w = document.querySelector(".pc-wrap");
  if (!w || !pcState) return;
  const top = w.querySelector(".pc-sheet")?.scrollTop || 0;
  w.innerHTML = pcHtml();
  const sheet = w.querySelector(".pc-sheet");
  if (sheet) sheet.scrollTop = top;
}
function openPlayerCard(pk, fk) {
  pcState = { pk, fk: fk || "", withSub: false };
  document.querySelector(".pc-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "news-wrap pc-wrap";
  w.setAttribute("role", "dialog");
  w.setAttribute("aria-modal", "true");
  w.setAttribute("aria-label", "Ficha del jugador");
  document.body.appendChild(w);
  renderPlayerCard();
}
function closePlayerCard() {
  document.querySelector(".pc-wrap")?.remove();
  pcState = null;
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-player-card]");
  if (open) {
    e.preventDefault();
    openPlayerCard(open.dataset.playerCard, open.dataset.fk || currentMatchFixtureKey());
    return;
  }
  if (!pcState) return;
  if (e.target.closest("[data-pc-close]") || e.target.classList?.contains("pc-wrap"))
    return closePlayerCard();
  const t = e.target.closest("[data-pc-sub]");
  if (t) {
    pcState.withSub = t.dataset.pcSub === "1";
    renderPlayerCard();
  }
});

// Clave del partido abierto (para saber qué mercados tuyos comparar).
function currentMatchFixtureKey() {
  try {
    if (!currentMatchRef || currentMatchRef.draft) return "";
    const c = db.coupons.find((x) => x.id === currentMatchRef.couponId);
    const f = c?.fixtures?.[Number(currentMatchRef.fixtureIndex)];
    return f ? fixtureKey(f) : "";
  } catch {
    return "";
  }
}
