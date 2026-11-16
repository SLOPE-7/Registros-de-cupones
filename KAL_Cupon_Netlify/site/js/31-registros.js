// Registros propios (V18): lo que anotas en el marcador de cada partido se convierte en el historial de cada
// equipo/selección y de cada jugador, con sus promedios.
// - No se guarda nada nuevo: se calcula a partir del marcador de cada partido (db.stats) y de tus cupones.
// - Equipo: goles a favor/en contra, córners y tarjetas por partido registrado.
// - Jugador: remates, remates a puerta y goles, ligado al equipo con el que jugó (club o selección) y a la
//   competición. El equipo sale del código del mercado ("(FRA)", "(RMD)") o del goleador anotado.
// - Goleadores: en cada partido puedes anotar quién hizo cada gol.
// - El Analista recibe los registros de los equipos y jugadores del cupón.
"use strict";

const REC_LAST = 5; // los promedios usan los últimos 5 partidos registrados
let recordsCache = null;

function buildRecords() {
  if (recordsCache && recordsCache.at === db.savedAt && recordsCache.n === db.coupons.length)
    return recordsCache.data;
  const teams = new Map(),
    players = new Map();
  // Jugadores con mercado en cada partido (para saber su equipo).
  const bets = new Map(); // fk → Map(playerKey → { name, side })
  const fixtures = new Map(); // fk → fixture
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      const fk = fixtureKey(f);
      if (!fixtures.has(fk)) fixtures.set(fk, f);
      f.markets.forEach((m) => {
        const b = parsePlayerBet(m, f);
        if (!b?.name) return;
        const side = playerClubForCode(b.code, f).side || "";
        if (!bets.has(fk)) bets.set(fk, new Map());
        const k = crestNorm(b.name);
        if (!bets.get(fk).has(k) || (side && !bets.get(fk).get(k).side))
          bets.get(fk).set(k, { name: b.name, side });
      });
    }),
  );
  const addTeam = (name, e) => {
    const k = crestNorm(name);
    if (!k) return;
    if (!teams.has(k))
      teams.set(k, { key: k, name, tipo: findCountryLocal(name) ? "selección" : "club", matches: [] });
    teams.get(k).matches.push(e);
  };
  const addPlayer = (name, e) => {
    const k = crestNorm(name);
    if (!k) return;
    if (!players.has(k)) players.set(k, { key: k, name, matches: [] });
    players.get(k).matches.push(e);
  };
  for (const [fk, f] of fixtures) {
    const st = db.stats?.[fk];
    if (!st) continue;
    const fecha = scheduleISO(f) || "",
      comp = canonicalCompetition(f.competition || f.league) || "";
    // Solo partidos ya cerrados: con "Terminó el partido" o de un día anterior. Uno en juego no cuenta todavía.
    if (!st.final && !(fecha && fecha < localISODate())) continue;
    const v = (side, type) => teamStat(st, side, type);
    const gh = v("home", "goals"),
      ga = v("away", "goals");
    const goalsKnown = !!st.final || gh + ga > 0,
      cornersKnown = v("home", "corners") + v("away", "corners") > 0,
      cardsKnown = v("home", "cards") + v("away", "cards") > 0;
    if (goalsKnown || cornersKnown || cardsKnown)
      for (const side of SIDES) {
        const other = side === "home" ? "away" : "home";
        addTeam(f[side], {
          fk,
          fecha,
          competicion: comp,
          rival: f[other],
          local: side === "home",
          ...(goalsKnown ? { gf: v(side, "goals"), gc: v(other, "goals") } : {}),
          ...(cornersKnown ? { cf: v(side, "corners"), cc: v(other, "corners") } : {}),
          ...(cardsKnown ? { tf: v(side, "cards"), tc: v(other, "cards") } : {}),
        });
      }
    // Jugadores: remates del marcador y goles anotados.
    const scorers = Array.isArray(st.scorers) ? st.scorers : [];
    const inMatch = new Map(bets.get(fk) || []);
    (st.tracked || []).forEach((t) => {
      const k = crestNorm(t.name);
      if (k) inMatch.set(k, { name: t.name, side: t.side, tracked: true });
    });
    scorers.forEach((s) => {
      const k = crestNorm(s.name);
      if (k && !inMatch.has(k)) inMatch.set(k, { name: s.name, side: s.side });
    });
    for (const [k, info] of inMatch) {
      const p = st.players?.[k];
      const shots = p ? shotsOf(p) : 0,
        onT = p ? Number(p.onTarget) || 0 : 0;
      const hasBet = bets.get(fk)?.has(k);
      const shotsKnown = shots > 0 || (!!st.final && (hasBet || info.tracked) && !!p);
      const goles = scorers.filter((s) => crestNorm(s.name) === k).length;
      const side = st.sides?.[k] || info.side || scorers.find((s) => crestNorm(s.name) === k)?.side || "";
      if (!shotsKnown && !goles) continue;
      const equipo = side ? f[side] : "";
      addPlayer(info.name, {
        fk,
        fecha,
        competicion: comp,
        equipo,
        tipo: equipo ? (findCountryLocal(equipo) ? "selección" : "club") : "",
        rival: side ? f[side === "home" ? "away" : "home"] : "",
        ...(shotsKnown ? { remates: shots, aPuerta: onT } : {}),
        ...(scorers.length ? { goles } : {}),
      });
    }
  }
  const byDate = (a, b) => String(b.fecha).localeCompare(String(a.fecha));
  teams.forEach((t) => t.matches.sort(byDate));
  players.forEach((p) => p.matches.sort(byDate));
  const data = { teams, players };
  recordsCache = { at: db.savedAt, n: db.coupons.length, data };
  return data;
}
// Promedio de un dato en los últimos partidos donde se registró.
function recAvg(matches, field, last = REC_LAST) {
  const xs = matches.filter((m) => m[field] != null).slice(0, last);
  if (!xs.length) return null;
  return { n: xs.length, prom: Math.round((xs.reduce((s, m) => s + m[field], 0) / xs.length) * 100) / 100 };
}
const teamRecord = (name) => buildRecords().teams.get(crestNorm(name)) || null;
const playerRecord = (name) => buildRecords().players.get(crestNorm(name)) || null;

function teamSummary(t) {
  const a = (f) => recAvg(t.matches, f);
  return {
    equipo: t.name,
    tipo: t.tipo,
    partidosRegistrados: t.matches.length,
    golesFavor: a("gf"),
    golesContra: a("gc"),
    cornersFavor: a("cf"),
    cornersContra: a("cc"),
    tarjetas: a("tf"),
  };
}
function playerSummary(p) {
  const groups = new Map();
  p.matches.forEach((m) => {
    const k = (m.tipo || "equipo") + "|" + crestNorm(m.equipo);
    if (!groups.has(k)) groups.set(k, { equipo: m.equipo || "—", tipo: m.tipo || "", matches: [] });
    groups.get(k).matches.push(m);
  });
  return {
    jugador: p.name,
    partidosRegistrados: p.matches.length,
    remates: recAvg(p.matches, "remates"),
    aPuerta: recAvg(p.matches, "aPuerta"),
    goles: p.matches.reduce((s, m) => s + (m.goles || 0), 0),
    porEquipo: [...groups.values()].map((g) => ({
      equipo: g.equipo,
      tipo: g.tipo,
      partidos: g.matches.length,
      remates: recAvg(g.matches, "remates"),
      aPuerta: recAvg(g.matches, "aPuerta"),
      goles: g.matches.reduce((s, m) => s + (m.goles || 0), 0),
    })),
  };
}

// ---------- Lo que recibe el Analista ----------
function recordsPayload(fixtures) {
  const equipos = [],
    jugadores = [],
    seenT = new Set(),
    seenP = new Set();
  const short = (x) => (x ? x.prom + " (" + x.n + " partidos)" : undefined);
  (fixtures || []).forEach((f) => {
    [f.home, f.away].forEach((name) => {
      const t = teamRecord(name);
      if (!t || seenT.has(t.key)) return;
      seenT.add(t.key);
      const s = teamSummary(t);
      equipos.push({
        equipo: s.equipo,
        tipo: s.tipo,
        partidosRegistrados: s.partidosRegistrados,
        promedios: {
          golesFavor: short(s.golesFavor),
          golesContra: short(s.golesContra),
          cornersFavor: short(s.cornersFavor),
          cornersContra: short(s.cornersContra),
          tarjetas: short(s.tarjetas),
        },
        ultimos: t.matches.slice(0, REC_LAST).map((m) => ({
          fecha: m.fecha,
          competicion: m.competicion || undefined,
          rival: m.rival,
          condicion: m.local ? "local" : "visitante",
          marcador: m.gf != null ? m.gf + "-" + m.gc : undefined,
          corners: m.cf != null ? m.cf + "-" + m.cc : undefined,
          tarjetas: m.tf != null ? m.tf + "-" + m.tc : undefined,
        })),
      });
    });
    (f.markets || []).forEach((m) => {
      const b = parsePlayerBet(m, f);
      const p = b?.name && playerRecord(b.name);
      if (!p || seenP.has(p.key)) return;
      seenP.add(p.key);
      const s = playerSummary(p);
      jugadores.push({
        jugador: s.jugador,
        partidosRegistrados: s.partidosRegistrados,
        porEquipo: s.porEquipo.map((g) => ({
          equipo: g.equipo,
          tipo: g.tipo || undefined,
          partidos: g.partidos,
          rematesPromedio: short(g.remates),
          aPuertaPromedio: short(g.aPuerta),
          goles: g.goles,
        })),
        ultimos: p.matches.slice(0, REC_LAST).map((x) => ({
          fecha: x.fecha,
          equipo: x.equipo || undefined,
          rival: x.rival || undefined,
          competicion: x.competicion || undefined,
          remates: x.remates,
          aPuerta: x.aPuerta,
          goles: x.goles,
        })),
      });
    });
  });
  return equipos.length || jugadores.length ? { equipos, jugadores } : undefined;
}

// ---------- Goleadores ----------
function scorerNamesFor(fk, f, side) {
  const names = new Map();
  const add = (n) => n && !names.has(crestNorm(n)) && names.set(crestNorm(n), n);
  db.coupons.forEach((c) =>
    c.fixtures.forEach((g) => {
      if (fixtureKey(g) !== fk) return;
      g.markets.forEach((m) => {
        const b = parsePlayerBet(m, g);
        if (b?.name && playerClubForCode(b.code, g).side === side) add(b.name);
      });
    }),
  );
  const team = crestNorm(f[side]);
  buildRecords().players.forEach((p) => {
    if (p.matches.some((m) => crestNorm(m.equipo) === team)) add(p.name);
  });
  return [...names.values()].slice(0, 9);
}
// Anota un gol de un jugador. Si el equipo aún no tenía ese gol contado, también lo suma al marcador.
function registerGoal(fk, side, name) {
  const f = fixtureByKey(fk);
  if (!f || !SIDES.includes(side)) return;
  db.stats = db.stats || {};
  const st = JSON.parse(
    JSON.stringify(db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} }),
  );
  st.scorers = Array.isArray(st.scorers) ? st.scorers : [];
  st.sides = { ...(st.sides || {}), [playerKeyOf(name)]: side };
  const add = st.scorers.filter((x) => x.side === side).length >= teamStat(st, side, "goals");
  st.scorers.push({ name: String(name).slice(0, 60), side, ...(add ? { add: true } : {}) });
  if (add) teamStatStep(st, "goals", side, 1, f);
  st.updatedAt = new Date().toISOString();
  db.stats[fk] = st;
  applyStatsToLines(fk);
}
function addScorer(fk, side) {
  const f = fixtureByKey(fk);
  if (!f) return;
  const options = scorerNamesFor(fk, f, side);
  const a = (
    prompt(
      "¿Quién anotó para " +
        f[side] +
        "?" +
        (options.length
          ? "\nEscribe el número o el nombre:\n" + options.map((n, i) => i + 1 + ". " + n).join("\n")
          : "\nEscribe el nombre del jugador:"),
    ) || ""
  ).trim();
  if (!a) return;
  const name = /^\d$/.test(a) && options[Number(a) - 1] ? options[Number(a) - 1] : a;
  if (name.length < 3) return toast("Escribe al menos 3 letras.");
  registerGoal(fk, side, name);
}
function removeScorer(fk, index) {
  const st = db.stats?.[fk];
  const sc = st?.scorers?.[index];
  if (!sc) return;
  st.scorers = st.scorers.filter((_, i) => i !== index);
  // Si ese gol se sumó al marcador al anotar al jugador, también se quita del marcador.
  if (sc.add) teamStatStep(st, "goals", sc.side, -1, null);
  st.updatedAt = new Date().toISOString();
  applyStatsToLines(fk);
}
// ＋/− goles en la ficha de un jugador. Si no se sabe de qué equipo es, se pregunta una vez.
function playerGoal(fk, pk, delta) {
  const f = fixtureByKey(fk),
    pl = statsPlayers(fk).get(pk);
  if (!f || !pl) return;
  if (delta < 0) {
    const list = db.stats?.[fk]?.scorers || [];
    for (let i = list.length - 1; i >= 0; i--)
      if (playerKeyOf(list[i].name) === pk) return removeScorer(fk, i);
    return;
  }
  let side = playerSide(fk, pk, pl);
  if (!side) {
    const a = prompt(
      "¿De qué equipo es " + pl.name + "?\n1. " + f.home + "\n2. " + f.away + "\nEscribe 1 o 2:",
    );
    side = a === "1" ? "home" : a === "2" ? "away" : "";
    if (!side) return;
  }
  registerGoal(fk, side, pl.name);
}
// Seguir a un jugador (aunque no tengas ningún mercado suyo): contadores de remates, a puerta y goles.
function trackPlayer(fk, side) {
  const f = fixtureByKey(fk);
  if (!f) return;
  const options = scorerNamesFor(fk, f, side);
  const a = (
    prompt(
      "¿A qué jugador de " +
        f[side] +
        " quieres seguir?" +
        (options.length
          ? "\nEscribe el número o el nombre:\n" + options.map((n, i) => i + 1 + ". " + n).join("\n")
          : "\nEscribe el nombre del jugador:"),
    ) || ""
  ).trim();
  if (!a) return;
  const name = /^\d$/.test(a) && options[Number(a) - 1] ? options[Number(a) - 1] : a;
  if (name.length < 3) return toast("Escribe al menos 3 letras.");
  db.stats = db.stats || {};
  const st = (db.stats[fk] = db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} });
  st.tracked = Array.isArray(st.tracked) ? st.tracked : [];
  const k = playerKeyOf(name);
  if (!st.tracked.some((t) => playerKeyOf(t.name) === k)) st.tracked.push({ name: name.slice(0, 60), side });
  st.sides = { ...(st.sides || {}), [k]: side };
  st.players = st.players || {};
  st.players[k] = st.players[k] || { onTarget: 0, shots: 0 };
  st.updatedAt = new Date().toISOString();
  save();
  renderAll();
  toast("Siguiendo a " + name + ". Anota sus remates y goles en el marcador.");
}
function untrackPlayer(fk, pk) {
  const st = db.stats?.[fk];
  const t = st?.tracked?.find((x) => playerKeyOf(x.name) === pk);
  if (!t || !confirm("¿Quitar a " + t.name + " de este partido? Se borran sus conteos de aquí.")) return;
  st.tracked = st.tracked.filter((x) => playerKeyOf(x.name) !== pk);
  delete st.players?.[pk];
  st.scorers = (st.scorers || []).filter((x) => playerKeyOf(x.name) !== pk);
  delete st.sides?.[pk];
  st.updatedAt = new Date().toISOString();
  applyStatsToLines(fk);
}
// Bloque bajo los goles del marcador: quién anotó.
function scorersHtml(fk, f, st) {
  const list = Array.isArray(st.scorers) ? st.scorers : [];
  const col = (side) => {
    const mine = list.map((s, i) => ({ ...s, i })).filter((s) => s.side === side);
    const missing = teamStat(st, side, "goals") - mine.length;
    return (
      '<div class="lb-scorers">' +
      mine
        .map(
          (s) =>
            '<button type="button" class="scorer-chip" data-scorer-remove="' +
            s.i +
            '" data-st-fk="' +
            esc(fk) +
            '" title="Quitar">⚽ ' +
            esc(s.name) +
            " ×</button>",
        )
        .join("") +
      '<button type="button" class="btn sm" data-scorer-add="' +
      side +
      '" data-st-fk="' +
      esc(fk) +
      '">＋ ' +
      (missing > 0 ? "¿Quién anotó?" + (missing > 1 ? " (" + missing + ")" : "") : "Goleador") +
      "</button>" +
      "</div>"
    );
  };
  return '<div class="lb-sides lb-scorer-row">' + col("home") + col("away") + "</div>";
}

// ---------- Pantallas ----------
const avgTxt = (x, dec = 1) => (x ? x.prom.toFixed(dec) : "—");
function teamRecordCard(name) {
  const t = teamRecord(name);
  if (!t)
    return (
      '<div class="rec-card"><b>' +
      esc(name) +
      '</b><small class="muted">Sin partidos registrados todavía.</small></div>'
    );
  const s = teamSummary(t);
  return (
    '<div class="rec-card"><b>' +
    esc(t.name) +
    '</b><small class="muted">' +
    t.matches.length +
    " partido" +
    (t.matches.length === 1 ? "" : "s") +
    " registrado" +
    (t.matches.length === 1 ? "" : "s") +
    '</small><div class="rec-grid"><span><i>Goles a favor</i><b>' +
    avgTxt(s.golesFavor) +
    "</b></span><span><i>Goles en contra</i><b>" +
    avgTxt(s.golesContra) +
    "</b></span><span><i>Córners</i><b>" +
    avgTxt(s.cornersFavor) +
    "</b></span><span><i>Tarjetas</i><b>" +
    avgTxt(s.tarjetas) +
    '</b></span></div><ul class="rec-last">' +
    t.matches
      .slice(0, REC_LAST)
      .map(
        (m) =>
          "<li>" +
          esc((m.local ? "vs " : "en ") + m.rival) +
          (m.gf != null ? " <b>" + m.gf + "-" + m.gc + "</b>" : "") +
          (m.cf != null ? " · ⛳ " + m.cf + "-" + m.cc : "") +
          (m.tf != null ? " · 🟨 " + m.tf + "-" + m.tc : "") +
          '<small class="muted"> · ' +
          esc(m.fecha) +
          "</small></li>",
      )
      .join("") +
    "</ul></div>"
  );
}
function playerRecordCard(name) {
  const p = playerRecord(name);
  if (!p) return "";
  const s = playerSummary(p);
  return (
    '<div class="rec-card"><b>' +
    esc(p.name) +
    '</b><small class="muted">' +
    p.matches.length +
    " partido(s) registrado(s) · " +
    s.goles +
    " gol(es)</small>" +
    s.porEquipo
      .map(
        (g) =>
          '<div class="rec-line"><span>' +
          esc(g.equipo) +
          (g.tipo ? ' <small class="muted">(' + esc(g.tipo) + ")</small>" : "") +
          "</span><span>Remates <b>" +
          avgTxt(g.remates) +
          "</b> · A puerta <b>" +
          avgTxt(g.aPuerta) +
          "</b>" +
          (g.goles ? " · ⚽ <b>" + g.goles + "</b>" : "") +
          ' <small class="muted">(' +
          g.partidos +
          ")</small></span></div>",
      )
      .join("") +
    "</div>"
  );
}
// En la ficha del partido (pestaña 📈 Datos): tus registros de los dos equipos y de los jugadores de tus mercados.
function matchRecordsHtml(f, merged) {
  const players = new Set();
  [...merged.values()].forEach((x) => {
    const b = parsePlayerBet(x.m, x.f);
    if (b?.name) players.add(b.name);
  });
  const pCards = [...players].map(playerRecordCard).filter(Boolean).join("");
  return (
    '<section class="dp-block rec-block"><h3>📒 Tus registros</h3><p class="small muted">Promedio de los últimos ' +
    REC_LAST +
    ' partidos que registraste en el marcador de cada equipo y jugador.</p><div class="rec-two">' +
    teamRecordCard(f.home) +
    teamRecordCard(f.away) +
    "</div>" +
    (pCards ? '<div class="rec-players">' + pCards + "</div>" : "") +
    "</section>"
  );
}
// En Estadísticas: todos los equipos y jugadores con registros.
let recFilter = "";
function recordsStatsHtml() {
  const { teams, players } = buildRecords();
  if (!teams.size && !players.size)
    return '<div class="empty small">Lleva el marcador de tus partidos (goles, córners, tarjetas y remates) y aquí verás el promedio de cada equipo y jugador.</div>';
  const q = crestNorm(recFilter);
  const ts = [...teams.values()]
      .filter((t) => !q || t.key.includes(q))
      .sort((a, b) => b.matches.length - a.matches.length),
    ps = [...players.values()]
      .filter((p) => !q || p.key.includes(q))
      .sort((a, b) => b.matches.length - a.matches.length);
  return (
    '<input class="input" id="recSearch" type="search" placeholder="🔎 Buscar equipo o jugador" value="' +
    esc(recFilter) +
    '"><details class="rec-fold"' +
    (q ? " open" : "") +
    "><summary>Equipos y selecciones (" +
    ts.length +
    ')</summary><div class="rec-two">' +
    ts
      .slice(0, 40)
      .map((t) => teamRecordCard(t.name))
      .join("") +
    '</div></details><details class="rec-fold"' +
    (q ? " open" : "") +
    "><summary>Jugadores (" +
    ps.length +
    ')</summary><div class="rec-players">' +
    ps
      .slice(0, 60)
      .map((p) => playerRecordCard(p.name))
      .join("") +
    "</div></details>"
  );
}

document.addEventListener("click", (e) => {
  const pg = e.target.closest("[data-player-goal]");
  if (pg) return playerGoal(pg.dataset.stFk, pg.dataset.stPk, Number(pg.dataset.playerGoal));
  const ta = e.target.closest("[data-track-add]");
  if (ta) return trackPlayer(ta.dataset.stFk, ta.dataset.trackAdd);
  const tr = e.target.closest("[data-track-remove]");
  if (tr) return untrackPlayer(tr.dataset.stFk, tr.dataset.stPk);
  const a = e.target.closest("[data-scorer-add]");
  if (a) return addScorer(a.dataset.stFk, a.dataset.scorerAdd);
  const r = e.target.closest("[data-scorer-remove]");
  if (r) return removeScorer(r.dataset.stFk, Number(r.dataset.scorerRemove));
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "recSearch") return;
  recFilter = e.target.value;
  const el = $("recordsSection");
  if (el) el.innerHTML = recordsStatsHtml();
});
