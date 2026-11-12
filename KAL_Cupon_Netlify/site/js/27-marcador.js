// Marcador en vivo por partido (V16.2).
// Un solo contador por partido para goles, córners y tarjetas, y una ficha por jugador con dos contadores:
// remates a puerta y remates (un remate a puerta también es un remate). Cada jugador puede tener un suplente.
// Todas las líneas de todos los cupones de ese partido leen de este marcador:
//   - "Más de 1.5 goles" en un cupón y "Total · Más de 1.5" en otro avanzan juntas;
//   - "Remates a puerta (Olise) +0.5" (solo él) cuenta solo a Olise; "… - Incl. suplente" suma también al suplente;
//   - en cuanto una línea se supera, se marca ganada ("Más de") o perdida ("Menos de"); el resto sigue esperando.
// Se guarda en db.stats[clave del partido]. Los mercados de un solo equipo ("Total de goles - Como") siguen con su
// contador propio (db.progress).
"use strict";

const playerKeyOf = (name) => crestNorm(name);

// ¿Qué contador del marcador usa este mercado? null = mercado con contador propio.
function statKind(m, f, info = parseLine(m, f)) {
  if (!info) return null;
  if (info.player) {
    const stat = info.cat === "a puerta" ? "onTarget" : info.cat === "remates" ? "shots" : null;
    if (!stat) return null;
    return {
      type: "player",
      stat,
      playerKey: playerKeyOf(info.player.name),
      player: info.player,
      incl: info.incl,
    };
  }
  const type =
    info.cat === "goles"
      ? "goals"
      : info.cat === "córners"
        ? "corners"
        : info.cat === "tarjetas"
          ? "cards"
          : null;
  if (!type) return null;
  // De un solo equipo: nombre del equipo en el mercado, "1 total", "2 total", "local", "visitante"…
  const x = crestNorm((m.market || "") + " " + (m.pick || "")),
    team = (t) => {
      const n = crestNorm(t);
      return n && (x.includes(n) || n.split(" ").some((w) => w.length >= 5 && x.split(" ").includes(w)));
    };
  if (
    /^(1|2) (total|marcara|anotara)|\blocal\b|\bvisitante\b|\bequipo\b/.test(x) ||
    team(f.home) ||
    team(f.away)
  )
    return null;
  return { type };
}

function statsOf(f) {
  db.stats = db.stats || {};
  return db.stats[fixtureKey(f)] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} };
}
function lineValueFromStats(st, kind) {
  if (kind.type !== "player") return Number(st[kind.type]) || 0;
  const p = st.players?.[kind.playerKey];
  if (!p) return 0;
  const own = Number(p[kind.stat]) || 0;
  return kind.incl && p.sub ? own + (Number(p.sub[kind.stat]) || 0) : own;
}
// Valor actual de un mercado de línea: del marcador del partido o de su contador propio.
function lineValue(f, m, key = marketKey(f, m)) {
  const kind = statKind(m, f);
  return kind ? lineValueFromStats(statsOf(f), kind) : progressTotal(progressOf(key));
}

// Cambia un contador del marcador y marca/desmarca las líneas del partido que correspondan.
function statStep(fk, target, delta) {
  db.stats = db.stats || {};
  const st = JSON.parse(
    JSON.stringify(db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} }),
  );
  st.players = st.players || {};
  st.auto = st.auto || {};
  const [kind, pk, who, stat] = target.split(":"); // "goals" | "player:<clave>:main|sub:shots|onTarget"
  if (kind !== "player") st[kind] = Math.max(0, (Number(st[kind]) || 0) + delta);
  else {
    const p = (st.players[pk] = st.players[pk] || { shots: 0, onTarget: 0 });
    const o = who === "sub" ? p.sub : p;
    if (!o) return;
    if (stat === "onTarget") {
      // Un remate a puerta también es un remate.
      o.onTarget = Math.max(0, (Number(o.onTarget) || 0) + delta);
      o.shots = Math.max(o.onTarget, (Number(o.shots) || 0) + delta);
    } else o.shots = Math.max(Number(o.onTarget) || 0, (Number(o.shots) || 0) + delta);
  }
  st.updatedAt = new Date().toISOString();
  db.stats[fk] = st;
  try {
    navigator.vibrate?.(25);
  } catch {}
  applyStatsToLines(fk);
}

// Revisa todas las líneas del partido (en todos los cupones) contra el marcador.
function applyStatsToLines(fk) {
  const st = db.stats[fk],
    changes = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      if (fixtureKey(f) !== fk) return;
      f.markets.forEach((m) => {
        const info = parseLine(m, f),
          kind = info && statKind(m, f, info);
        if (!kind) return;
        const key = marketKey(f, m);
        if (changes.has(key)) return;
        const total = lineValueFromStats(st, kind),
          status = m.settlement || "pending",
          reached = total >= info.goal;
        if (reached && status === "pending")
          changes.set(key, { status: info.dir === "over" ? "won" : "lost", m, total, info });
        else if (!reached && st.auto[key] && status === st.auto[key])
          changes.set(key, { status: "pending", m, total, info });
      });
    }),
  );
  if (!changes.size) {
    save();
    renderAll();
    return;
  }
  let won = 0;
  for (const [key, ch] of changes) {
    if (ch.status === "pending") delete st.auto[key];
    else st.auto[key] = ch.status;
    if (ch.status === "won") won++;
    setMarketStatus(key, ch.status);
  }
  if (won) toast("🎉 " + won + " línea(s) superada(s) y marcada(s) como ganada(s).");
}

// Suplente de un jugador (nombre y foto); cuenta solo en las líneas "incl. suplente".
async function addStatsSub(fk, pk) {
  const f = fixtureByKey(fk);
  const name0 = statsPlayerName(fk, pk);
  const name = (prompt("¿Qué jugador entró por " + name0 + "? Escribe su nombre:") || "").trim();
  if (name.length < 3) {
    if (name) toast("Escribe al menos 3 letras.");
    return;
  }
  db.stats = db.stats || {};
  const st = (db.stats[fk] = db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} });
  st.players = st.players || {};
  const p = (st.players[pk] = st.players[pk] || { shots: 0, onTarget: 0 });
  p.sub = { name, shots: 0, onTarget: 0, photo: "" };
  st.updatedAt = new Date().toISOString();
  save();
  renderAll();
  const code = statsPlayerCode(fk, pk);
  const chosen = f && typeof pickPlayerPhoto === "function" ? await pickPlayerPhoto(name, code, f) : null;
  if (chosen?.photo && db.stats[fk]?.players?.[pk]?.sub) {
    db.stats[fk].players[pk].sub = {
      ...db.stats[fk].players[pk].sub,
      name: chosen.name || name,
      photo: chosen.photo,
    };
    save();
    renderAll();
    toast("Suplente: " + (chosen.name || name) + " con su foto.");
  }
}
function removeStatsSub(fk, pk) {
  const p = db.stats?.[fk]?.players?.[pk];
  if (!p?.sub || !confirm("¿Quitar a " + p.sub.name + " como suplente? Se descuenta lo que sumó.")) return;
  delete p.sub;
  db.stats[fk].updatedAt = new Date().toISOString();
  applyStatsToLines(fk);
}
function fixtureByKey(fk) {
  for (const c of db.coupons) for (const f of c.fixtures) if (fixtureKey(f) === fk) return f;
  return null;
}
function statsPlayers(fk) {
  // Jugadores con líneas en este partido: nombre, código, foto y si alguna línea incluye suplente.
  const out = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      if (fixtureKey(f) !== fk) return;
      f.markets.forEach((m) => {
        const kind = statKind(m, f);
        if (kind?.type !== "player") return;
        const e = out.get(kind.playerKey) || {
          name: kind.player.name,
          code: kind.player.code,
          photo: savedPlayerPhoto(marketKey(f, m), f, m),
          incl: false,
          stats: new Set(),
        };
        e.incl = e.incl || kind.incl;
        e.stats.add(kind.stat);
        if (!e.photo) e.photo = savedPlayerPhoto(marketKey(f, m), f, m);
        out.set(kind.playerKey, e);
      });
    }),
  );
  return out;
}
const statsPlayerName = (fk, pk) => statsPlayers(fk).get(pk)?.name || "el jugador";
const statsPlayerCode = (fk, pk) => statsPlayers(fk).get(pk)?.code || "";

// Pasa los contadores viejos (uno por mercado) al marcador del partido. Una sola vez.
function migrateProgressToStats() {
  if (db.statsMigrated) return false;
  db.stats = db.stats || {};
  Object.entries(db.progress || {}).forEach(([key, p]) => {
    const found = lineMarketByKey(key);
    if (!found?.info) return;
    const kind = statKind(found.m, found.f, found.info);
    if (!kind) return;
    const fk = fixtureKey(found.f);
    const st = (db.stats[fk] = db.stats[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} });
    st.players = st.players || {};
    st.auto = st.auto || {};
    if (kind.type !== "player") st[kind.type] = Math.max(Number(st[kind.type]) || 0, Number(p.count) || 0);
    else {
      const pl = (st.players[kind.playerKey] = st.players[kind.playerKey] || { shots: 0, onTarget: 0 });
      pl[kind.stat] = Math.max(Number(pl[kind.stat]) || 0, Number(p.count) || 0);
      pl.shots = Math.max(pl.shots, pl.onTarget);
      if (p.sub && kind.incl) {
        pl.sub = pl.sub || { name: p.sub.name, photo: p.sub.photo || "", shots: 0, onTarget: 0 };
        pl.sub[kind.stat] = Math.max(Number(pl.sub[kind.stat]) || 0, Number(p.sub.count) || 0);
        pl.sub.shots = Math.max(pl.sub.shots, pl.sub.onTarget);
      }
    }
    if (p.auto) st.auto[key] = p.auto;
    st.updatedAt = p.updatedAt || new Date().toISOString();
  });
  db.statsMigrated = true;
  return true;
}

// ---------- Panel "Marcador en vivo" en la ficha del partido ----------
function statCounter(fk, target, label, value, editable, extraClass = "") {
  return (
    '<div class="lb-counter ' +
    extraClass +
    '"><span>' +
    label +
    "</span>" +
    (editable
      ? '<button type="button" class="pg-btn" data-st-step="-1" data-st-fk="' +
        esc(fk) +
        '" data-st-target="' +
        esc(target) +
        '" aria-label="Restar ' +
        esc(label) +
        '">－</button>'
      : "") +
    '<b class="pg-num">' +
    value +
    "</b>" +
    (editable
      ? '<button type="button" class="pg-btn plus" data-st-step="1" data-st-fk="' +
        esc(fk) +
        '" data-st-target="' +
        esc(target) +
        '" aria-label="Sumar ' +
        esc(label) +
        '">＋</button>'
      : "") +
    "</div>"
  );
}
// Lista de líneas que dependen de un contador, con su estado.
function linesFor(fk, filter) {
  const st = db.stats?.[fk] || { goals: 0, corners: 0, cards: 0, players: {}, auto: {} },
    seen = new Set(),
    rows = [];
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      if (fixtureKey(f) !== fk) return;
      f.markets.forEach((m) => {
        const info = parseLine(m, f),
          kind = info && statKind(m, f, info);
        if (!kind || !filter(kind)) return;
        const id = [kind.stat || kind.type, kind.incl ? "s" : "", info.dir, info.line].join("|");
        if (seen.has(id)) return;
        seen.add(id);
        const total = lineValueFromStats(st, kind),
          s = m.settlement || "pending";
        rows.push({ info, kind, total, s });
      });
    }),
  );
  rows.sort((a, b) => a.info.line - b.info.line);
  return rows
    .map(
      ({ info, kind, total, s }) =>
        '<span class="lb-line is-' +
        (s === "won" ? "won" : s === "lost" ? "lost" : "pending") +
        '">' +
        (s === "won" ? "✓ " : s === "lost" ? "✕ " : "") +
        (kind.type === "player" ? (kind.stat === "onTarget" ? "A puerta " : "Remates ") : "") +
        (info.dir === "over" ? "+" : "−") +
        info.line +
        (kind.incl ? " (con suplente)" : kind.type === "player" ? " (solo él)" : "") +
        (s === "pending"
          ? " · " + total + "/" + (info.dir === "over" ? info.goal : "≤" + (info.goal - 1))
          : "") +
        "</span>",
    )
    .join("");
}
function liveBoardHtml(f) {
  if (currentMatchRef?.draft) return "";
  const fk = fixtureKey(f),
    st = statsOf(f);
  const has = { goals: false, corners: false, cards: false };
  db.coupons.forEach((c) =>
    c.fixtures.forEach((g) => {
      if (fixtureKey(g) !== fk) return;
      g.markets.forEach((m) => {
        const k = statKind(m, g);
        if (k && k.type !== "player") has[k.type] = true;
      });
    }),
  );
  const players = statsPlayers(fk);
  if (!has.goals && !has.corners && !has.cards && !players.size) return "";
  const editable = true;
  let html =
    '<section class="live-board"><div class="lb-head"><b>📊 Marcador en vivo</b><small>Un solo conteo para todos tus cupones de este partido</small></div>';
  const teamStats = [
    ["goals", "🥅 Goles", has.goals],
    ["corners", "⛳ Córners", has.corners],
    ["cards", "🟨 Tarjetas", has.cards],
  ].filter((x) => x[2]);
  if (teamStats.length)
    html +=
      '<div class="lb-team">' +
      teamStats
        .map(
          ([type, label]) =>
            '<div class="lb-stat">' +
            statCounter(fk, type, label, Number(st[type]) || 0, editable) +
            '<div class="lb-lines">' +
            linesFor(fk, (k) => k.type === type) +
            "</div></div>",
        )
        .join("") +
      "</div>";
  for (const [pk, pl] of players) {
    const p = st.players?.[pk] || { shots: 0, onTarget: 0 };
    const photo = resolveImage(pl.photo);
    const face = (src, name) =>
      src
        ? '<img class="pg-photo" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
        : '<span class="team-fallback pg-photo">' +
          esc(
            String(name || "?")
              .split(/\s+/)
              .map((x) => x[0])
              .slice(0, 2)
              .join("")
              .toUpperCase(),
          ) +
          "</span>";
    html +=
      '<div class="lb-player"><div class="lb-player-head">' +
      face(photo, pl.name) +
      "<b>" +
      esc(pl.name) +
      "</b></div>" +
      statCounter(fk, "player:" + pk + ":main:onTarget", "🎯 A puerta", Number(p.onTarget) || 0, editable) +
      statCounter(fk, "player:" + pk + ":main:shots", "Remates", Number(p.shots) || 0, editable) +
      (pl.incl
        ? p.sub
          ? '<div class="lb-sub"><div class="lb-player-head">' +
            face(resolveImage(p.sub.photo), p.sub.name) +
            "<span><small>Suplente</small> " +
            esc(p.sub.name) +
            '</span><button type="button" class="pg-mini-btn" data-st-sub-remove data-st-fk="' +
            esc(fk) +
            '" data-st-pk="' +
            esc(pk) +
            '" aria-label="Quitar suplente">🗑</button></div>' +
            statCounter(
              fk,
              "player:" + pk + ":sub:onTarget",
              "🎯 A puerta",
              Number(p.sub.onTarget) || 0,
              editable,
            ) +
            statCounter(fk, "player:" + pk + ":sub:shots", "Remates", Number(p.sub.shots) || 0, editable) +
            "</div>"
          : '<button type="button" class="btn sm pg-add-sub" data-st-sub-add data-st-fk="' +
            esc(fk) +
            '" data-st-pk="' +
            esc(pk) +
            '">＋ Agregar suplente de ' +
            esc(pl.name.split(" ").slice(-1)[0]) +
            "</button>"
        : "") +
      '<div class="lb-lines">' +
      linesFor(fk, (k) => k.type === "player" && k.playerKey === pk) +
      "</div></div>";
  }
  return html + "</section>";
}

document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-st-step]");
  if (s) return statStep(s.dataset.stFk, s.dataset.stTarget, Number(s.dataset.stStep));
  const a = e.target.closest("[data-st-sub-add]");
  if (a) return addStatsSub(a.dataset.stFk, a.dataset.stPk);
  const r = e.target.closest("[data-st-sub-remove]");
  if (r) return removeStatsSub(r.dataset.stFk, r.dataset.stPk);
});
