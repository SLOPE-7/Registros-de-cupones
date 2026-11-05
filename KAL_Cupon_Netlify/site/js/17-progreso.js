// Barra de progreso para mercados de línea ("Más de 2.5 goles", "Menos de 9.5 córners", "Remates a puerta 2+"…).
// El conteo es manual (botones ＋/－). Al llegar a la línea el mercado se marca solo (Más de → ganado,
// Menos de → perdido). Los mercados de jugador "Incl. suplente" tienen un segundo contador para el suplente,
// con su nombre y foto. El progreso se guarda en db.progress[marketKey], así un mismo mercado comparte barra
// en todos los cupones donde aparece.
"use strict";

// El orden importa: "Tiros de esquina" son córners, no remates.
const LINE_CATEGORIES = [
  [/corner|esquina/, "córners", "Córners", "⛳"],
  [/tarjeta|amonestac|card/, "tarjetas", "Tarjetas", "🟨"],
  [/a puerta|al arco|on target/, "a puerta", "A puerta", "🎯"],
  [/remate|tiro|shot/, "remates", "Remates", "🎯"],
  [/gol|goal/, "goles", "Goles", "🥅"],
];

// Devuelve la información de la línea del mercado, o null si no es un mercado de "más de / menos de".
function parseLine(m, f) {
  const raw = (m?.market || "") + " " + (m?.pick || "");
  const n = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/ambos|1x2|doble oportunidad|handicap|marcador (correcto|exacto)/.test(n)) return null;
  const cat = LINE_CATEGORIES.find(([re]) => re.test(n));
  if (!cat) return null;
  let dir = null,
    line = null,
    mm;
  if ((mm = n.match(/(?:mas de|over|\+)\s*(\d+(?:[.,]\d+)?)/))) {
    dir = "over";
    line = Number(mm[1].replace(",", "."));
  } else if ((mm = n.match(/(?:menos de|under)\s*(\d+(?:[.,]\d+)?)/))) {
    dir = "under";
    line = Number(mm[1].replace(",", "."));
  } else if ((mm = n.match(/(\d+)\s*\+(?!\s*\d)/))) {
    dir = "over";
    line = Number(mm[1]) - 0.5;
  }
  if (!dir || !Number.isFinite(line) || line < 0 || line > 60) return null;
  const goal = Math.floor(line) + 1; // Más de 2.5 → 3 para ganar · Menos de 3.5 → con 4 se pierde
  const bet = parsePlayerBet(m, f);
  return {
    dir,
    line,
    goal,
    cat: cat[1],
    label: cat[2],
    icon: cat[3],
    player: bet,
    incl: !!bet && /incl\.?\s*suplente|y suplente|incl\.?\s*sub/i.test(raw),
  };
}

function progressOf(key) {
  db.progress = db.progress || {};
  return db.progress[key] || { count: 0 };
}
const progressTotal = (p) => (Number(p.count) || 0) + (p.sub ? Number(p.sub.count) || 0 : 0);

function lineMarketByKey(key) {
  for (const c of db.coupons)
    for (const f of c.fixtures)
      for (const m of f.markets) if (marketKey(f, m) === key) return { f, m, info: parseLine(m, f) };
  return null;
}

// Barra visual: segmentos si la meta es pequeña; si no, barra continua.
function progressBar(info, total, closedStatus) {
  const goal = info.goal,
    pct = Math.min(100, Math.round((total / goal) * 100));
  const cls =
    info.dir === "under"
      ? total >= goal
        ? "is-bad"
        : total >= goal - 1
          ? "is-risk"
          : "is-under"
      : total >= goal
        ? "is-good"
        : "";
  if (goal <= 12)
    return (
      '<div class="pg-seg ' +
      cls +
      '" aria-hidden="true">' +
      Array.from({ length: goal }, (_, i) => '<i class="' + (i < total ? "on" : "") + '"></i>').join("") +
      "</div>"
    );
  return '<div class="pg-track ' + cls + '" aria-hidden="true"><i style="width:' + pct + '%"></i></div>';
}

function progressStatusText(info, total) {
  if (info.dir === "over")
    return total >= info.goal
      ? "¡Línea superada!"
      : "falta" + (info.goal - total === 1 ? " " : "n ") + (info.goal - total);
  return total >= info.goal ? "Se pasó de la línea" : "margen: " + (info.goal - 1 - total);
}

function counterRow(key, who, name, photo, count, editable) {
  return (
    '<div class="pg-player">' +
    (photo
      ? '<img class="pg-photo" src="' + esc(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="team-fallback pg-photo">' +
        esc(
          String(name || "?")
            .split(/\s+/)
            .map((x) => x[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
        ) +
        "</span>") +
    '<span class="pg-name">' +
    (who === "sub" ? "<small>Suplente</small>" : "") +
    esc(name) +
    "</span>" +
    (editable
      ? '<button type="button" class="pg-btn" data-pg-step="-1" data-pg-who="' +
        who +
        '" data-pg-key="' +
        esc(key) +
        '" aria-label="Restar a ' +
        esc(name) +
        '">－</button>'
      : "") +
    '<b class="pg-num">' +
    count +
    "</b>" +
    (editable
      ? '<button type="button" class="pg-btn plus" data-pg-step="1" data-pg-who="' +
        who +
        '" data-pg-key="' +
        esc(key) +
        '" aria-label="Sumar a ' +
        esc(name) +
        '">＋</button>'
      : "") +
    (editable && who === "sub"
      ? '<button type="button" class="pg-mini-btn" data-pg-sub-remove="' +
        esc(key) +
        '" aria-label="Quitar suplente">🗑</button>'
      : "") +
    "</div>"
  );
}

// Bloque de progreso dentro de la tarjeta del mercado (ficha del partido).
function progressBlock(x) {
  if (currentMatchRef?.draft) return "";
  const info = parseLine(x.m, x.f);
  if (!info) return "";
  const p = progressOf(x.key),
    total = progressTotal(p),
    s = x.m.settlement || "pending";
  const editable = (s === "pending" && !x.closed) || (p.auto && p.auto === s);
  let html =
    '<div class="pg" data-pg-card="' +
    esc(x.key) +
    '">' +
    progressBar(info, total) +
    '<div class="pg-head"><span><b>' +
    total +
    "</b> / " +
    (info.dir === "over" ? info.goal : "máx. " + (info.goal - 1)) +
    " " +
    esc(info.cat) +
    "</span><small>" +
    progressStatusText(info, total) +
    "</small>";
  if (!info.player) {
    html += editable
      ? '<span class="pg-ctrl"><button type="button" class="pg-btn" data-pg-step="-1" data-pg-who="main" data-pg-key="' +
        esc(x.key) +
        '" aria-label="Restar">－</button><button type="button" class="pg-btn plus" data-pg-step="1" data-pg-who="main" data-pg-key="' +
        esc(x.key) +
        '" aria-label="Sumar">＋</button></span>'
      : "";
    return html + "</div></div>";
  }
  html += "</div>";
  html += counterRow(
    x.key,
    "main",
    info.player.name,
    savedPlayerPhoto(x.key, x.f, x.m),
    Number(p.count) || 0,
    editable,
  );
  if (info.incl) {
    if (p.sub) html += counterRow(x.key, "sub", p.sub.name, p.sub.photo, Number(p.sub.count) || 0, editable);
    else if (editable)
      html +=
        '<button type="button" class="btn sm pg-add-sub" data-pg-sub-add="' +
        esc(x.key) +
        '">＋ Agregar suplente de ' +
        esc(info.player.name.split(" ").slice(-1)[0]) +
        "</button>";
  }
  return html + "</div>";
}

// Cambia el contador y marca el mercado solo cuando corresponde.
function adjustProgress(key, delta, who = "main") {
  const found = lineMarketByKey(key);
  if (!found?.info) return;
  db.progress = db.progress || {};
  const p = { ...progressOf(key) };
  if (who === "sub" && p.sub) p.sub = { ...p.sub, count: Math.max(0, (Number(p.sub.count) || 0) + delta) };
  else p.count = Math.max(0, (Number(p.count) || 0) + delta);
  p.updatedAt = new Date().toISOString();
  const total = progressTotal(p),
    { info, m } = found,
    status = m.settlement || "pending";
  const reached = total >= info.goal;
  let newStatus = null;
  if (reached && status === "pending") {
    newStatus = info.dir === "over" ? "won" : "lost";
    p.auto = newStatus;
  } else if (!reached && p.auto && status === p.auto) {
    newStatus = "pending";
    p.auto = null;
  }
  db.progress[key] = p;
  try {
    navigator.vibrate?.(newStatus === "won" ? [40, 60, 120] : 25);
  } catch {}
  if (newStatus) {
    setMarketStatus(key, newStatus); // guarda, redibuja y deja el cambio en el historial (se puede deshacer)
    if (newStatus === "won")
      toast("🎉 ¡Mercado ganado! " + (m.market || "") + " · " + total + "/" + info.goal);
    else if (newStatus === "lost") toast("✕ Se pasó de la línea: " + (m.market || "") + " · " + total);
    else toast("Mercado vuelto a pendiente (" + total + "/" + info.goal + ").");
  } else {
    save();
    renderAll();
  }
}

// "Terminó el partido": los "Más de" que no llegaron se pierden y los "Menos de" que no se pasaron se ganan.
function finishMatch(fixtureKeyValue) {
  const open = openCouponIds(),
    todo = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      if (fixtureKey(f) !== fixtureKeyValue || !open.has(c.id)) return;
      f.markets.forEach((m) => {
        const info = parseLine(m, f),
          key = marketKey(f, m);
        if (!info || (m.settlement || "pending") !== "pending" || todo.has(key)) return;
        const total = progressTotal(progressOf(key));
        todo.set(key, {
          status:
            info.dir === "over" ? (total >= info.goal ? "won" : "lost") : total >= info.goal ? "lost" : "won",
          label: m.market + " " + (m.pick || "") + " → " + total + "/" + info.goal,
        });
      });
    }),
  );
  if (!todo.size) {
    toast("No hay mercados de línea pendientes en este partido.");
    return;
  }
  const lines = [...todo.values()].map((t) => (t.status === "won" ? "✓ " : "✕ ") + t.label).join("\n");
  if (!confirm("¿Terminó el partido? Se marcarán así:\n\n" + lines)) return;
  for (const [key, t] of todo) setMarketStatus(key, t.status);
  toast("Partido cerrado: " + todo.size + " mercado(s) marcados.");
}

function finishMatchButton(f, pending) {
  if (currentMatchRef?.draft || !pending.some((x) => parseLine(x.m, x.f))) return "";
  return (
    '<button type="button" class="btn sm pg-finish" data-pg-finish="' +
    esc(fixtureKey(f)) +
    '">🏁 Terminó el partido</button>'
  );
}

// Suplente: nombre y foto (búsqueda por nombre en API-Football; si falla, por ID).
async function addSubstitute(key) {
  const found = lineMarketByKey(key);
  if (!found?.info?.player) return;
  const name = (
    prompt("¿Qué jugador entró por " + found.info.player.name + "? Escribe su nombre:") || ""
  ).trim();
  if (name.length < 3) {
    if (name) toast("Escribe al menos 3 letras.");
    return;
  }
  const p = { ...progressOf(key), sub: { name, count: 0, photo: "" }, updatedAt: new Date().toISOString() };
  db.progress[key] = p;
  save();
  renderAll();
  if (location.protocol === "file:") return;
  try {
    const side = playerClubForCode(found.info.player.code, found.f).side,
      ids = matchApiIds(found.f);
    const params = new URLSearchParams({
      search: name.normalize("NFD").replace(/[̀-ͯ]/g, ""),
      teamId: (side && ids[side]) || "",
      season: scheduleISO(found.f).slice(0, 4),
    });
    const r = await fetch("/.netlify/functions/jugadores?" + params, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(16000),
    });
    const d = await r.json().catch(() => ({}));
    let chosen = null;
    if (r.ok && d.players?.length) {
      chosen = d.players[0];
      if (d.players.length > 1) {
        const a = prompt(
          "Elige el jugador:\n" +
            d.players.map((x, i) => i + 1 + ". " + x.name + (x.team ? " · " + x.team : "")).join("\n"),
          "1",
        );
        chosen = a === null ? null : d.players[Number(a) - 1] || null;
      }
    } else if (confirm("No encontré la foto de " + name + ". ¿Quieres buscarla por su ID de API-Football?")) {
      const id = (prompt("ID numérico del jugador en API-Football:") || "").trim();
      if (/^\d{1,10}$/.test(id))
        chosen = { id, name, photo: "https://media.api-sports.io/football/players/" + id + ".png", team: "" };
    }
    if (!chosen?.photo) return;
    const cur = progressOf(key);
    if (!cur.sub) return;
    db.progress[key] = {
      ...cur,
      sub: { ...cur.sub, name: chosen.name || name, photo: chosen.photo, playerId: String(chosen.id || "") },
      updatedAt: new Date().toISOString(),
    };
    const dir = readCrestDirectory(),
      pid = String(chosen.id || "");
    if (pid) {
      dir["player:" + pid] = {
        kind: "player",
        playerId: pid,
        name: chosen.name || name,
        aliases: [name],
        club: chosen.team || "",
        country: chosen.country || "",
        photo: chosen.photo,
        url: chosen.photo,
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(CREST_DIR, JSON.stringify(dir));
      } catch {}
    }
    save();
    renderAll();
    toast("Suplente: " + (chosen.name || name) + " con su foto.");
  } catch (e) {
    toast("Se guardó el suplente sin foto: " + (e?.message || "no se pudo buscar"));
  }
}

function removeSubstitute(key) {
  const p = progressOf(key);
  if (!p.sub || !confirm("¿Quitar a " + p.sub.name + " como suplente? Se descuenta lo que sumó.")) return;
  const { sub, ...rest } = p;
  db.progress[key] = { ...rest, updatedAt: new Date().toISOString() };
  adjustProgress(key, 0);
}

// Resumen corto para la Agenda y Mercados, p. ej. "Goles 2/3 · Mbappé 1/2".
function miniProgressText(entries) {
  return entries
    .map(({ f, m }) => {
      const info = parseLine(m, f);
      if (!info) return null;
      const total = progressTotal(progressOf(marketKey(f, m)));
      const who = info.player ? info.player.name.split(" ").slice(-1)[0] : info.label;
      return (
        '<span class="pg-chip' +
        (info.dir === "over" && total >= info.goal ? " ok" : "") +
        '">' +
        esc(who) +
        " " +
        total +
        "/" +
        (info.dir === "over" ? info.goal : "≤" + (info.goal - 1)) +
        "</span>"
      );
    })
    .filter(Boolean)
    .slice(0, 3)
    .join("");
}

document.addEventListener("click", (e) => {
  const step = e.target.closest("[data-pg-step]");
  if (step) return adjustProgress(step.dataset.pgKey, Number(step.dataset.pgStep), step.dataset.pgWho);
  const fin = e.target.closest("[data-pg-finish]");
  if (fin) return finishMatch(fin.dataset.pgFinish);
  const add = e.target.closest("[data-pg-sub-add]");
  if (add) return addSubstitute(add.dataset.pgSubAdd);
  const rm = e.target.closest("[data-pg-sub-remove]");
  if (rm) return removeSubstitute(rm.dataset.pgSubRemove);
});
