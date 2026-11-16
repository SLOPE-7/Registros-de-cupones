// Ficha del partido (V17): marcador por equipo, resultado automático y análisis con IA del partido.
// - Goles, córners y tarjetas se cuentan por equipo; el total es la suma. El marcador se ve en la cabecera.
// - Mercados de resultado (1X2, doble oportunidad, ambos marcan, apuesta sin empate, "equipo marcará") se
//   resuelven solos con el marcador final al tocar "Terminó el partido".
// - El mismo pick escrito distinto ("Empate o 2" / "Empate o Senegal") es un solo mercado.
// - "🤖 Analizar este partido": el Analista revisa solo los mercados de este partido; cada mercado muestra su
//   probabilidad y confianza.
"use strict";

const SIDES = ["home", "away"];
const emptyTeams = () => ({
  home: { goals: 0, corners: 0, cards: 0 },
  away: { goals: 0, corners: 0, cards: 0 },
});
const teamStat = (st, side, type) => Number(st?.teams?.[side]?.[type]) || 0;
// Lo contado antes sin equipo (versión anterior): total − (local + visitante).
const unassigned = (st, type) =>
  Math.max(0, (Number(st?.[type]) || 0) - teamStat(st, "home", type) - teamStat(st, "away", type));

// ¿De qué equipo habla este mercado? ("Total de goles - Como", "1 total de goles", "Córners local"…)
function marketSide(m, f) {
  const x = crestNorm((m.market || "") + " " + (m.pick || ""));
  if (/^1 (total|marcara|anotara)|\blocal\b|\bhome\b/.test(x)) return "home";
  if (/^2 (total|marcara|anotara)|\bvisitante\b|\baway\b/.test(x)) return "away";
  const has = (t) => {
    const n = crestNorm(t);
    return !!n && (" " + x + " ").includes(" " + n + " ");
  };
  const h = has(f.home),
    a = has(f.away);
  return h && !a ? "home" : a && !h ? "away" : h || a || /\bequipo\b/.test(x) ? "?" : null;
}

// ---------- Mercados de resultado ----------
// Devuelve qué tiene que pasar para ganar: { t: "1x2"|"dc"|"dnb", picks: ["1","X","2"…] } |
// { t: "btts", yes } | { t: "tts", side, yes } | null si no es un mercado de resultado del partido completo.
function outcomeSpec(m, f) {
  if (!m) return null;
  const market = crestNorm(m.market),
    pick = crestNorm(m.pick),
    all = market + " " + pick;
  if (
    /mitad|tiempo|half|corner|esquina|tarjeta|handicap|remate|tiro|exacto|marcador|minuto|cualquier/.test(all)
  )
    return null;
  const home = crestNorm(f.home),
    away = crestNorm(f.away);
  const tok = (s) => {
    s = s.trim();
    if (s === "1" || (home && s === home) || s === "local") return "1";
    if (s === "2" || (away && s === away) || s === "visitante") return "2";
    if (s === "x" || s === "empate" || s === "draw") return "X";
    return null;
  };
  const yesNo = /^(si|yes)$/.test(pick) ? true : /^no$/.test(pick) ? false : null;
  if (/ambos( equipos)? (marcan|anotan)|both teams/.test(market))
    return yesNo === null ? null : { t: "btts", yes: yesNo };
  const tts = market.match(/^(1|2) (marcara|anotara)$/);
  if (tts) return yesNo === null ? null : { t: "tts", side: tts[1] === "1" ? "home" : "away", yes: yesNo };
  if (/doble oportunidad|double chance/.test(market)) {
    let picks = /^(1x|x1)$/.test(pick)
      ? ["1", "X"]
      : /^(x2|2x)$/.test(pick)
        ? ["X", "2"]
        : pick === "12"
          ? ["1", "2"]
          : null;
    if (!picks) {
      const parts = pick.split(/ o | or /).map(tok);
      if (parts.length === 2 && parts.every(Boolean) && parts[0] !== parts[1]) picks = parts;
    }
    return picks ? { t: "dc", picks: [...picks].sort() } : null;
  }
  if (/sin empate|draw no bet|empate no valido|empate anula/.test(market)) {
    const p = tok(pick);
    return p && p !== "X" ? { t: "dnb", picks: [p] } : null;
  }
  if (
    /^1x2$|resultado final|resultado del partido|ganador del partido|^ganador$|match result|full time result/.test(
      market,
    )
  ) {
    const p = tok(pick);
    return p ? { t: "1x2", picks: [p] } : null;
  }
  return null;
}
function outcomeResult(spec, gh, ga) {
  const r = gh > ga ? "1" : gh < ga ? "2" : "X";
  if (spec.t === "btts") return (gh > 0 && ga > 0) === spec.yes ? "won" : "lost";
  if (spec.t === "tts") return (spec.side === "home" ? gh : ga) > 0 === spec.yes ? "won" : "lost";
  if (spec.t === "dnb") return r === "X" ? "void" : spec.picks.includes(r) ? "won" : "lost";
  return spec.picks.includes(r) ? "won" : "lost";
}
// Clave para juntar el mismo mercado de resultado escrito de formas distintas.
const outcomeKey = (spec) =>
  spec
    ? "res|" + spec.t + "|" + (spec.picks || []).join("") + "|" + (spec.side || "") + "|" + (spec.yes ?? "")
    : "";

// ---------- Marcador ----------
function scoreOf(f) {
  const st = statsOf(f);
  return { st, gh: teamStat(st, "home", "goals"), ga: teamStat(st, "away", "goals"), touched: !!st.teams };
}
function heroScoreHtml(f) {
  if (currentMatchRef?.draft) return '<span class="hero-vs">VS</span>';
  const s = scoreOf(f);
  if (!s.touched && !unassigned(s.st, "goals")) return '<span class="hero-vs">VS</span>';
  const pop = window.__kalGoalPop === fixtureKey(f);
  window.__kalGoalPop = null;
  return (
    '<span class="hero-vs hero-score' +
    (pop ? " goal-pop" : "") +
    '" aria-label="Marcador">' +
    s.gh +
    " – " +
    s.ga +
    "</span>"
  );
}
// Cambia un contador de equipo ("goals:home"…). Devuelve true si lo manejó.
function teamStatStep(st, kind, side, delta, f) {
  if (!SIDES.includes(side) || !["goals", "corners", "cards"].includes(kind)) return false;
  st.teams = st.teams || emptyTeams();
  const before = teamStat(st, side, kind),
    after = Math.max(0, before + delta);
  st.teams[side] = { ...st.teams[side], [kind]: after };
  st[kind] = Math.max(0, (Number(st[kind]) || 0) + (after - before));
  if (kind === "goals" && after > before && f) {
    window.__kalGoalPop = fixtureKey(f);
    toast(
      "⚽ ¡Gol de " +
        (side === "home" ? f.home : f.away) +
        "! " +
        teamStat(st, "home", "goals") +
        " – " +
        teamStat(st, "away", "goals"),
    );
    try {
      navigator.vibrate?.([30, 40, 90]);
    } catch {}
  }
  return true;
}
// Fila del marcador: los dos equipos con su contador.
function teamRowHtml(fk, f, st, type, label) {
  const side = (s) =>
    '<div class="lb-side">' +
    '<span class="lb-team-name">' +
    crestHTML(s === "home" ? f.homeCrest : f.awayCrest, s === "home" ? f.home : f.away) +
    "<em>" +
    esc(s === "home" ? f.home : f.away) +
    "</em></span>" +
    statCounter(fk, type + ":" + s, "", teamStat(st, s, type), true, "lb-compact") +
    "</div>";
  const rest = unassigned(st, type);
  return (
    '<div class="lb-stat"><div class="lb-stat-head"><b>' +
    label +
    "</b><span>Total: <b>" +
    (Number(st[type]) || 0) +
    "</b></span></div>" +
    '<div class="lb-sides">' +
    side("home") +
    side("away") +
    "</div>" +
    (rest
      ? '<div class="small muted lb-rest">' +
        rest +
        ' sin asignar a un equipo <button type="button" class="linkish" data-st-step="-1" data-st-fk="' +
        esc(fk) +
        '" data-st-target="' +
        type +
        '">quitar 1</button></div>'
      : "") +
    '<div class="lb-lines">' +
    linesFor(fk, (k) => k.type === type) +
    "</div></div>"
  );
}

// ---------- Terminó el partido: resultado con el marcador final ----------
function pendingOutcomeMarkets(fk) {
  const open = openCouponIds(),
    out = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      if (fixtureKey(f) !== fk || !open.has(c.id)) return;
      f.markets.forEach((m) => {
        if ((m.settlement || "pending") !== "pending") return;
        const spec = outcomeSpec(m, f);
        if (spec) out.set(marketKey(f, m), { spec, f, m });
      });
    }),
  );
  return out;
}
// Pide confirmar el marcador final y lo guarda. Devuelve { gh, ga } o null si se canceló o no es válido.
function askFinalScore(fk, f) {
  const s = scoreOf(f);
  const a = prompt(
    "Marcador final de " + f.home + " vs " + f.away + " (local-visitante), por ejemplo 2-1:",
    s.gh + "-" + s.ga,
  );
  const mm = a && a.match(/^\s*(\d{1,2})\s*[-–:]\s*(\d{1,2})\s*$/);
  if (!mm) return null;
  const gh = Number(mm[1]),
    ga = Number(mm[2]);
  db.stats = db.stats || {};
  const st = JSON.parse(
    JSON.stringify(db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} }),
  );
  st.teams = st.teams || emptyTeams();
  st.teams.home.goals = gh;
  st.teams.away.goals = ga;
  st.goals = gh + ga;
  st.final = true;
  st.updatedAt = new Date().toISOString();
  db.stats[fk] = st;
  return { gh, ga };
}

// ---------- IA del partido ----------
let matchAi = null; // { fk, busy, status, text, error }
function aiChipHtml(ai) {
  if (!ai?.nivel) return "";
  return (
    '<span class="ai-chip is-' +
    esc(ai.nivel) +
    '" title="Estimación del Analista">🤖 ' +
    (ai.p ? "≈ " + Math.round(ai.p * 100) + " % · " : "") +
    esc(ai.nivel) +
    (ai.debil ? " · eslabón débil" : "") +
    "</span>"
  );
}
function matchAiHtml(f) {
  if (currentMatchRef?.draft) return "";
  const fk = fixtureKey(f),
    saved = statsOf(f).ai,
    live = matchAi && matchAi.fk === fk ? matchAi : null;
  let body = "";
  if (live?.busy)
    body =
      '<div class="analyst-status"><span class="analyst-dot"></span><span id="matchAiStatus">' +
      esc(live.status || "Conectando…") +
      '</span><button type="button" class="btn sm" data-analyst-cancel>Cancelar</button></div><div class="analyst-md" id="matchAiLive">' +
      renderMd(live.text || "") +
      "</div>";
  else {
    if (live?.error) body += '<div class="notice analyst-error">' + esc(live.error) + "</div>";
    if (saved?.texto)
      body +=
        '<details class="match-ai-saved"' +
        (live && !live.busy && !live.error ? " open" : "") +
        "><summary>Análisis del " +
        esc(new Date(saved.fecha).toLocaleDateString("es-HN", { day: "numeric", month: "short" })) +
        " " +
        esc(new Date(saved.fecha).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })) +
        ' <span class="small muted">· toca para ver</span></summary><div class="analyst-md">' +
        renderMd(saved.texto) +
        "</div></details>";
  }
  return (
    '<section class="match-ai"><div class="match-ai-head"><b>🤖 Analista</b>' +
    (live?.busy
      ? ""
      : '<button type="button" class="btn sm" data-match-ai="' +
        esc(fk) +
        '">' +
        (saved?.texto ? "↻ Analizar de nuevo" : "Analizar este partido") +
        "</button>") +
    "</div>" +
    (body ||
      '<p class="small muted">Revisa con IA los mercados que tienes en este partido: probabilidad de cada uno y cuál es el más débil.</p>') +
    "</section>"
  );
}
async function analyzeMatch(fk) {
  if (matchAi?.busy || analystBusy) return toast("Ya hay un análisis en curso.");
  const f = fixtureByKey(fk);
  if (!f) return;
  if (!analystState().clave) return toast("Primero escribe tu código en Más → Analista → ⚙ Configurar.");
  // Mercados pendientes de este partido, sin repetir.
  const open = openCouponIds(),
    seen = new Set(),
    lines = [];
  db.coupons.forEach((c) =>
    c.fixtures.forEach((g) => {
      if (fixtureKey(g) !== fk || !open.has(c.id)) return;
      g.markets.forEach((m) => {
        if ((m.settlement || "pending") !== "pending") return;
        const k = outcomeKey(outcomeSpec(m, g)) || crestNorm(m.market + "|" + m.pick);
        if (seen.has(k)) return;
        seen.add(k);
        lines.push("- " + legLine(g, m, false));
      });
    }),
  );
  if (!lines.length) return toast("No hay mercados pendientes en este partido.");
  const datos = {
    cupon:
      "Analiza solo este partido y estos mercados (están repartidos en mis cupones; no son una sola combinada):\n" +
      lines.join("\n"),
    partidos: analystFixtureList([f]),
    precisionAnalista: aiPrecisionPayload(),
  };
  const h = analystShortHistory();
  if (h) datos.historial = h;
  matchAi = { fk, busy: true, status: "Conectando…", text: "" };
  renderAll();
  try {
    const { text } = await analystRequest("cupon", datos, {
      onStatus: (s) => {
        matchAi.status = s;
        const el = $("matchAiStatus");
        if (el) el.textContent = s;
      },
      onText: (t) => {
        matchAi.text = t;
        matchAi.status = "Escribiendo…";
        const el = $("matchAiLive");
        if (el) el.innerHTML = renderMd(t);
      },
      onReset: () => (matchAi.text = ""),
    });
    // Guardar el texto en el partido y la estimación en cada mercado (en todos los cupones que lo tienen).
    db.stats = db.stats || {};
    const st = (db.stats[fk] = db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} });
    st.ai = { texto: stripAiJson(text).slice(0, 6000), fecha: new Date().toISOString() };
    st.updatedAt = st.ai.fecha;
    const v = parseAiVerdict(text);
    const each = (list, fn) =>
      (Array.isArray(list) ? list : list ? [list] : []).forEach((it) =>
        db.coupons.forEach((c) => {
          if (!c.fixtures.some((g) => fixtureKey(g) === fk)) return;
          const hit = findLeg({ fixtures: c.fixtures.filter((g) => fixtureKey(g) === fk) }, it);
          if (hit) fn(hit.m, it);
        }),
      );
    each(v?.selecciones, (m, it) => {
      const nivel = nivelOf(it?.confianza),
        p = Number(it?.p);
      if (nivel) m.ai = { nivel, ...(p > 0 && p <= 1 ? { p: Math.round(p * 100) / 100 } : {}) };
    });
    each(v?.eslabonDebil, (m) => (m.ai = { ...(m.ai || {}), debil: true }));
    matchAi = { fk, busy: false };
    save();
  } catch (e) {
    matchAi = { fk, busy: false, error: e.name === "AbortError" ? "Análisis cancelado." : e.message };
  }
  renderAll();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-match-ai]");
  if (b) analyzeMatch(b.dataset.matchAi);
});

// ---------- Correcciones de datos guardados ----------
// La casa corta "Clasificación" en "Cla": "Copa de Naciones Africanas, Cla".
function fixCompetitionName(s) {
  return String(s || "")
    .replace(/,\s*Cla\.?$/i, ", Clasificación")
    .replace(/,\s*Clasif\.?$/i, ", Clasificación");
}
function migrateCompetitionNames() {
  let changed = false;
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) =>
      ["league", "competition"].forEach((k) => {
        const v = fixCompetitionName(f[k]);
        if (f[k] && v !== f[k]) {
          f[k] = v;
          changed = true;
        }
      }),
    ),
  );
  return changed;
}
