// Ficha del partido: mercados, análisis, estadísticas, eventos y fotos de jugadores.
"use strict";
function openMatchDetails(ref) {
  pageScrollBeforeModal = window.scrollY || document.documentElement.scrollTop || 0;
  const body = document.body;
  modalBodyStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = "fixed";
  body.style.top = "-" + pageScrollBeforeModal + "px";
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  currentMatchRef = ref;
  matchActiveTab = "markets";
  matchMarkedOpen = false;
  matchSubTab = null;
  matchApiData = {};
  matchPlayerPhotos = {};
  renderMatchDetail(ref);
  $("matchModal").classList.add("open");
  $("matchModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}
function closeMatchDetails() {
  $("matchModal").classList.remove("open");
  $("matchModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  currentMatchRef = null;
  matchApiData = {};
  matchPlayerPhotos = {};
  if (modalBodyStyles) {
    const body = document.body;
    Object.assign(body.style, {
      position: modalBodyStyles.position,
      top: modalBodyStyles.top,
      left: modalBodyStyles.left,
      right: modalBodyStyles.right,
      width: modalBodyStyles.width,
      overflow: modalBodyStyles.overflow,
    });
    modalBodyStyles = null;
    window.scrollTo(0, pageScrollBeforeModal);
  }
}
function matchApiIds(f) {
  const id = (u) => {
    const m = String(u || "").match(/\/(teams|leagues)\/(\d+)\.png/i);
    return m ? m[2] : "";
  };
  return { home: id(f.homeCrest), away: id(f.awayCrest), league: id(f.leagueCrest) };
}
function matchCacheKey(f) {
  return [fixtureKey(f), f.homeCrest || "", f.awayCrest || "", f.leagueCrest || ""].join("~");
}
async function loadMatchTab(tab, force = false) {
  const ref = currentMatchRef;
  if (!ref) return;
  const c = ref.draft
      ? { id: "draft", fixtures: draftSelections }
      : db.coupons.find((x) => x.id === ref.couponId),
    f = ref.draft ? draftSelections[Number(ref.fixtureIndex)] : c?.fixtures?.[Number(ref.fixtureIndex)];
  if (!f) return;
  const ids = matchApiIds(f),
    date = scheduleISO(f),
    key = matchCacheKey(f),
    cached = matchApiData[key] || {};
  if (ref.draft) {
    toast("Guarda el cupón antes de consultar los datos del partido.");
    return;
  }
  if (!ids.home || !ids.away) {
    toast("Para conectar API-Football, primero guarda los dos escudos por ID.");
    return;
  }
  if (!date) {
    toast("Completa la fecha del partido antes de buscar sus datos.");
    return;
  }
  if (!force && cached[tab] && !cached[tab].error) {
    matchActiveTab = tab;
    renderMatchDetail(ref);
    return;
  }
  matchActiveTab = tab;
  renderMatchDetail(ref);
  const panel = $("matchTabPanel");
  if (panel)
    panel.innerHTML =
      '<div class="match-loading"><span class="spinner"></span> Consultando información disponible…</div>';
  const url = new URLSearchParams({
    homeId: ids.home,
    awayId: ids.away,
    date,
    mode: tab === "analysis" ? "analysis" : tab === "events" ? "events" : "match",
  });
  url.set("season", date.slice(0, 4));
  if (ids.league) url.set("leagueId", ids.league);
  if (force) url.set("refresh", "1");
  try {
    const r = await fetch("/api/partido?" + url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(18000),
      }),
      data = await r.json();
    if (currentMatchRef !== ref) return;
    if (!r.ok) throw Error(data.error || "No se pudieron cargar los datos.");
    matchApiData[key] = matchApiData[key] || {};
    matchApiData[key][tab] = data;
    renderMatchDetail(ref);
  } catch (e) {
    if (currentMatchRef !== ref) return;
    matchApiData[key] = matchApiData[key] || {};
    matchApiData[key][tab] = { error: e.message || "No se pudieron cargar los datos." };
    renderMatchDetail(ref);
  }
}
function matchTabButton(id, label) {
  return (
    '<button type="button" class="match-tab ' +
    (matchActiveTab === id ? "active" : "") +
    '" data-match-tab="' +
    id +
    '">' +
    label +
    "</button>"
  );
}
function ownFormEstimate(pred, homeName, awayName, fallbackStats = []) {
  const form = (x) =>
    String(x || "")
      .toUpperCase()
      .replace(/[^WDL]/g, "");
  const home = form(
      pred?.teams?.home?.last_5?.form || pred?.teams?.home?.league?.form || fallbackStats[0]?.form,
    ),
    away = form(pred?.teams?.away?.last_5?.form || pred?.teams?.away?.league?.form || fallbackStats[1]?.form);
  let h = 0,
    d = 0,
    a = 0,
    n = 0;
  for (const x of home) {
    if (x === "W") h++;
    else if (x === "D") d++;
    else a++;
    n++;
  }
  for (const x of away) {
    if (x === "W") a++;
    else if (x === "D") d++;
    else h++;
    n++;
  }
  const h2h = Array.isArray(pred?.h2h) ? pred.h2h : [];
  for (const x of h2h) {
    const hn = crestNorm(x.teams?.home?.name),
      an = crestNorm(x.teams?.away?.name),
      scoreH = Number(x.goals?.home),
      scoreA = Number(x.goals?.away);
    if (!Number.isFinite(scoreH) || !Number.isFinite(scoreA)) continue;
    if (hn !== crestNorm(homeName || "") && an !== crestNorm(homeName || "")) continue;
    const homeIsCurrent = hn === crestNorm(homeName || "");
    if (scoreH === scoreA) d++;
    else if (scoreH > scoreA) {
      if (homeIsCurrent) h++;
      else a++;
    } else {
      if (homeIsCurrent) a++;
      else h++;
    }
    n++;
  }
  if (!n) return null;
  const den = h + d + a + 3;
  const homePct = Math.round(((h + 1) * 100) / den),
    drawPct = Math.round(((d + 1) * 100) / den);
  return {
    home: homePct,
    draw: drawPct,
    away: 100 - homePct - drawPct,
    sample: n,
    level: n >= 10 ? "Media" : n >= 5 ? "Baja" : "Muy baja",
  };
}
// ---- Mercados dentro de la ficha del partido ----
// Pendientes arriba; los ya marcados (ganado, perdido, nulo) se agrupan en una sección plegable.
let matchMarkedOpen = false;
function matchMarketCard(x) {
  const odd = Number(
      String(x.m.odd || x.m.builderOdd || (x.f.markets.length === 1 ? x.f.totalOdds : "")).replace(",", "."),
    ),
    // En un BetBuilder la cuota es la del paquete: no indica la probabilidad de esta selección sola.
    prob = odd > 1 && !x.m.builder ? Math.round(100 / odd) : null,
    bet = parsePlayerBet(x.m, x.f),
    photo = bet ? savedPlayerPhoto(x.key, x.f, x.m) : "",
    icon = photo
      ? '<img class="mk-photo" src="' +
        esc(photo) +
        '" alt="Foto de ' +
        esc(bet.name) +
        '" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="mk-icon">' +
        (/gol|marcan|anota/i.test(x.m.market)
          ? "🥅"
          : /c[oó]rner|esquina/i.test(x.m.market)
            ? "⛳"
            : /tarjeta/i.test(x.m.market)
              ? "🟨"
              : /remat|tiro/i.test(x.m.market)
                ? "🎯"
                : "⚽") +
        "</span>",
    s = x.m.settlement || "pending",
    btn = (v, label, cls) =>
      '<button type="button" class="mk-btn ' +
      cls +
      (s === v ? " selected" : "") +
      '" data-status="' +
      esc(x.statusKey || x.key) +
      '" data-value="' +
      v +
      '" aria-pressed="' +
      (s === v) +
      '">' +
      label +
      "</button>";
  return (
    '<article class="mk-card st-' +
    esc(s) +
    (x.closed ? " is-closed" : "") +
    '">' +
    (x.closed
      ? '<div class="mk-closed">Cupón ' +
        (lostCouponCount(x.coupons) ? "perdido" : "cerrado") +
        " · este mercado ya no cuenta</div>"
      : "") +
    '<div class="mk-top">' +
    icon +
    '<div class="mk-copy"><strong>' +
    esc(x.m.market || "Mercado") +
    "</strong>" +
    (x.m.pick ? "<b>" + esc(x.m.pick) + "</b>" : "") +
    (x.m.earlyPayout ? '<span class="mk-tag">⚡ Pago anticipado</span>' : "") +
    aiChipHtml(x.ai || x.m.ai) +
    '</div><span class="mk-odd">' +
    (odd > 1 ? esc(String(odd.toFixed(2))) : "—") +
    "</span></div>" +
    '<div class="mk-prob">' +
    (prob !== null
      ? '<div class="mk-bar"><i style="width:' +
        Math.min(100, prob) +
        '%"></i></div><small>Probabilidad implícita ' +
        prob +
        "% · " +
        x.coupons.size +
        " cupón" +
        (x.coupons.size === 1 ? "" : "es") +
        "</small>"
      : "<small>" +
        (x.m.builder && odd > 1 ? "Cuota del BetBuilder completo" : "Sin cuota registrada") +
        " · " +
        x.coupons.size +
        " cupón" +
        (x.coupons.size === 1 ? "" : "es") +
        "</small>") +
    "</div>" +
    closeOddHtml(x, odd) +
    progressBlock(x) +
    (bet && !photo && !currentMatchRef?.draft
      ? '<button type="button" class="btn sm player-photo-button" data-player-photo="' +
        esc(x.key) +
        '">▣ Buscar foto de ' +
        esc(bet.name) +
        "</button>"
      : "") +
    '<div class="mk-actions">' +
    btn("won", "✓ Ganado", "won") +
    btn("lost", "✕ Perdido", "lost") +
    btn("void", "＝ Nulo", "void") +
    (s !== "pending" ? btn("pending", "↺ Pendiente", "reset") : "") +
    "</div></article>"
  );
}
// ---- Subpestañas de «Mercados»: Jugadores · Goles · Córners · Tarjetas · 1X2 y Hándicap · Otros ----
let matchSubTab = null;
const MARKET_GROUPS = [
  ["players", "👤 Jugadores"],
  ["goals", "🥅 Goles"],
  ["corners", "⛳ Córners"],
  ["cards", "🟨 Tarjetas"],
  ["result", "⚖️ 1X2 y Hándicap"],
  ["other", "▫️ Otros"],
];
// A qué subpestaña pertenece un mercado.
function marketGroupOf(x) {
  const t = crestNorm((x.m.market || "") + " " + (x.m.pick || ""));
  if (parsePlayerBet(x.m, x.f)) return "players";
  if (/corner|esquina/.test(t)) return "corners";
  if (/tarjeta|amonest|expuls|\bcards?\b|booking/.test(t)) return "cards";
  const spec = outcomeSpec(x.m, x.f);
  if (
    (spec && spec.t !== "btts" && spec.t !== "tts") ||
    /handicap|resultado|ganador|\bgana\b|ganara|apuesta sin empate|doble oportunidad|1x2|empate|draw no bet|to win/.test(
      t,
    )
  )
    return "result";
  if (/gol|marcan|marcar|marcara|anota|total|mitad|over|under|exacto|marcador|ambos|btts|score/.test(t))
    return "goals";
  return "other";
}
// De qué equipo es un mercado: "home", "away" o "both" (del partido en general). Los jugadores usan "none" si no se sabe.
function marketTeamOf(x, players) {
  const f = x.f,
    bet = parsePlayerBet(x.m, f);
  if (bet) {
    const fk = fixtureKey(f),
      pk = playerKeyOf(bet.name);
    return playerSide(fk, pk, { code: bet.code, ...(players.get(pk) || {}) }) || "none";
  }
  const spec = outcomeSpec(x.m, f);
  if (spec && spec.picks) {
    const teams = spec.picks.filter((p) => p !== "X");
    if (teams.length === 1) return teams[0] === "1" ? "home" : "away";
    return "both";
  }
  if (spec?.t === "tts") return spec.side;
  const side = marketSide(x.m, f);
  return side === "home" || side === "away" ? side : "both";
}
function renderMatchMarkets(merged) {
  const all = [...merged.values()],
    open = openCouponIds(),
    draft = !!currentMatchRef?.draft,
    alive = (x) =>
      draft ? (x.m.settlement || "pending") === "pending" : marketIsActive(x.m, x.coupons, open);
  all.forEach((x) => {
    x.closed = (x.m.settlement || "pending") === "pending" && !alive(x);
  });
  if (!all.length) return '<div class="empty">Este partido aún no tiene mercados.</div>';
  const f0 = all[0].f,
    fk = fixtureKey(f0),
    st = draft ? null : statsOf(f0),
    players = draft ? new Map() : statsPlayers(fk),
    groups = Object.fromEntries(MARKET_GROUPS.map(([id]) => [id, []]));
  all.forEach((x) => groups[marketGroupOf(x)].push(x));
  const avail = (id) =>
      groups[id].length > 0 || (!draft && (id === "goals" || (id === "players" && players.size >= 0))),
    pendingOf = (id) => groups[id].filter(alive),
    tabs = MARKET_GROUPS.filter(([id]) => avail(id));
  let active = tabs.find(([id]) => id === matchSubTab)?.[0];
  if (!active) active = (tabs.find(([id]) => pendingOf(id).length) || tabs[0])[0];
  matchSubTab = active;
  const chip = ([id, label]) => {
      const pend = pendingOf(id).length,
        mark = groups[id].length - pend;
      return (
        '<button type="button" class="match-tab msub-chip' +
        (id === active ? " active" : "") +
        '" data-msub="' +
        id +
        '" aria-pressed="' +
        (id === active) +
        '">' +
        label +
        (pend ? "<i>" + pend + "</i>" : mark ? '<i class="done">✓</i>' : "") +
        "</button>"
      );
    },
    teamHead = (side, n) =>
      '<header class="msub-team-head">' +
      (side === "home" || side === "away"
        ? crestHTML(side === "home" ? f0.homeCrest : f0.awayCrest, f0[side]) + "<b>" + esc(f0[side]) + "</b>"
        : side === "none"
          ? "<b>👤 Sin equipo asignado</b>"
          : "<b>" + (active === "result" ? "⚖️ Resultado del partido" : "🏟️ Partido") + "</b>") +
      (n ? "<small>" + n + "</small>" : "") +
      "</header>";
  const sideOrder = active === "players" ? ["home", "away", "none"] : ["both", "home", "away"],
    pend = pendingOf(active),
    marked = groups[active].filter((x) => !alive(x)),
    count = (stt) => marked.filter((x) => x.m.settlement === stt).length;
  let body = "";
  // Solo lo que aún falta: el marcador de goles siempre (es el resultado), los de córners y tarjetas solo
  // mientras quede algún mercado suyo pendiente, y las fichas de jugadores solo si les queda algo por cumplir.
  if (!draft && (active === "goals" || (["corners", "cards"].includes(active) && pend.length)))
    body += liveBoardHtml(f0, active);
  const pendingPlayers = new Set();
  pend.forEach((x) => {
    const k = statKind(x.m, x.f),
      bet = parsePlayerBet(x.m, x.f);
    if (k?.playerKey) pendingPlayers.add(k.playerKey);
    if (bet) pendingPlayers.add(playerKeyOf(bet.name));
  });
  const showPlayer = (pk, pl) => pendingPlayers.has(pk) || (pl.tracked && !pl.lines && !st?.final);
  sideOrder.forEach((side) => {
    const cards = pend.filter((x) => marketTeamOf(x, players) === side),
      blocks =
        active === "players" && !draft
          ? [...players]
              .filter(([pk, pl]) => showPlayer(pk, pl) && (playerSide(fk, pk, pl) || "none") === side)
              .map(([pk, pl]) => playerBlockHtml(fk, f0, st, pk, pl))
          : [];
    if (!cards.length && !blocks.length) return;
    body +=
      '<section class="msub-team">' +
      teamHead(side, cards.length) +
      (blocks.length ? '<div class="live-board lb-part lb-players">' + blocks.join("") + "</div>" : "") +
      cards.map(matchMarketCard).join("") +
      "</section>";
  });
  if (active === "players" && !draft) body += trackButtonsHtml(fk, f0);
  if (!pend.length && groups[active].length)
    body +=
      '<div class="empty small"><strong>Todo marcado ✓</strong>No quedan mercados pendientes en esta sección.</div>';
  if (!groups[active].length && !["goals", "players"].includes(active))
    body += '<div class="empty small">No tienes mercados de esto en este partido.</div>';
  // Lo terminado se adjunta a «Ya marcados»: fichas de jugadores sin pendientes y contadores sin mercados
  // pendientes (así se puede corregir un toque equivocado).
  const doneBoard = draft
    ? ""
    : active === "players"
      ? [...players]
          .filter(([pk, pl]) => !showPlayer(pk, pl))
          .map(([pk, pl]) => playerBlockHtml(fk, f0, st, pk, pl))
          .join("")
      : ["corners", "cards"].includes(active) && !pend.length
        ? liveBoardHtml(f0, active)
        : "";
  if (marked.length || doneBoard)
    body +=
      '<section class="fold marked-fold' +
      (matchMarkedOpen ? " is-open" : "") +
      '"><button type="button" class="fold-head" data-marked-toggle aria-expanded="' +
      matchMarkedOpen +
      '"><span class="fold-title">Ya marcados y cerrados</span><span class="marked-summary">' +
      (count("won") ? '<span class="st st-won">' + count("won") + " ✓</span>" : "") +
      (count("lost") ? '<span class="st st-lost">' + count("lost") + " ✕</span>" : "") +
      (count("void") ? '<span class="st st-void">' + count("void") + " ＝</span>" : "") +
      (marked.filter((x) => x.closed).length
        ? '<span class="st st-lost">' + marked.filter((x) => x.closed).length + " cupón perdido</span>"
        : "") +
      '</span><span class="fold-icon" aria-hidden="true">▾</span></button><div class="fold-body">' +
      (doneBoard
        ? active === "players"
          ? '<div class="live-board lb-part lb-players lb-done">' + doneBoard + "</div>"
          : doneBoard
        : "") +
      marked.map(matchMarketCard).join("") +
      "</div></section>";
  const allPending = all.filter(alive);
  return (
    '<section class="match-tab-content">' +
    (draft
      ? '<div class="notice">Vista previa del cupón. Guarda el cupón para marcar resultados.</div>'
      : "") +
    '<nav class="msub-nav" aria-label="Tipos de mercado">' +
    tabs.map(chip).join("") +
    "</nav>" +
    finishMatchButton(f0, allPending) +
    matchAiHtml(f0) +
    '<div class="msub-body" data-msub-body="' +
    active +
    '">' +
    body +
    "</div></section>"
  );
}
function renderMatchDataPanel(tab, f, merged) {
  if (tab === "datos") return matchRecordsHtml(f, merged) + renderFormPanel(f, merged);
  const key = matchCacheKey(f),
    data = matchApiData[key]?.[tab];
  if (tab === "coupons") {
    const ids = currentMatchRef?.draft
      ? new Set()
      : new Set(
          db.coupons.filter((c) => c.fixtures?.some((g) => fixtureKey(g) === fixtureKey(f))).map((c) => c.id),
        );
    return (
      '<div class="match-related-coupons">' +
      ([...ids]
        .map((id) => {
          const c = db.coupons.find((x) => x.id === id);
          return c
            ? '<button class="match-coupon-link" data-detail="' +
                esc(c.id) +
                '"><b>' +
                esc(c.name) +
                "</b><span>" +
                c.fixtures
                  .filter((g) => fixtureKey(g) === fixtureKey(f))
                  .reduce((n, g) => n + g.markets.length, 0) +
                " mercado(s) · " +
                esc(c.created ? new Date(c.created).toLocaleDateString("es-HN") : "") +
                "</span></button>"
            : "";
        })
        .join("") || '<div class="empty">No hay cupones guardados con este partido.</div>') +
      "</div>"
    );
  }
  if (tab === "markets") return renderMatchMarkets(merged);
  if (data?.error) return '<div class="notice warning">' + esc(data.error) + "</div>";
  if (data?.available === false)
    return (
      '<div class="empty"><strong>Datos no disponibles</strong>' +
      esc(data.reason || "La API no devolvió información para este partido.") +
      "</div>"
    );
  if (!data)
    return (
      '<div class="match-data-intro"><strong>' +
      ({
        analysis: "Análisis del partido",
        statistics: "Estadísticas del encuentro",
        events: "Eventos, lesiones y alineaciones",
        coupons: "Cupones relacionados",
      }[tab] || "Información") +
      "</strong><p>" +
      ({
        analysis:
          "Carga las predicciones, forma reciente, enfrentamientos y tabla que la API tenga disponibles.",
        statistics:
          "Las estadísticas oficiales aparecen durante o después del partido si la competición las proporciona.",
        events:
          "Los eventos y alineaciones dependen de la cobertura de la liga; las lesiones pueden no estar disponibles.",
        coupons: "Revisa los cupones guardados que contienen este partido.",
      }[tab] || "") +
      '</p><button type="button" class="btn gold" data-load-match-tab="' +
      tab +
      '">Cargar datos disponibles</button></div>'
    );
  if (tab === "statistics") {
    const fixture = data.fixture,
      stats = fixture?.statistics || [];
    if (!stats.length)
      return '<div class="empty"><strong>Estadísticas no disponibles todavía</strong>API-Football no entregó datos para este partido. Es posible que aún no comience o que la competición no cubra estadísticas.</div>';
    return (
      '<div class="match-data-grid">' +
      stats
        .map(
          (team) =>
            '<article class="match-data-card"><h3>' +
            esc(team.team?.name || "Equipo") +
            "</h3>" +
            team.statistics
              .map(
                (x) =>
                  '<div class="match-stat-row"><span>' +
                  esc(x.type) +
                  "</span><b>" +
                  esc(x.value ?? "—") +
                  "</b></div>",
              )
              .join("") +
            "</article>",
        )
        .join("") +
      "</div>"
    );
  }
  if (tab === "events") {
    const fixture = data.fixture || {},
      events = fixture.events || [],
      lineups = fixture.lineups || [],
      injuries = data.injuries || [];
    return (
      '<div class="match-data-grid"><article class="match-data-card"><h3>Eventos</h3>' +
      (events.length
        ? events
            .map(
              (x) =>
                '<div class="match-event"><b>' +
                esc((x.time?.elapsed ?? "") + (x.time?.extra ? "+" + x.time.extra : "") + "′") +
                "</b><span>" +
                esc(x.team?.name || "") +
                " · " +
                esc(x.player?.name || "") +
                " · " +
                esc(x.detail || x.type || "Evento") +
                "</span></div>",
            )
            .join("")
        : '<p class="muted">Los eventos suelen aparecer cuando el partido comienza o termina. Si ya se jugó y sigue vacío, esta competición puede no ofrecer ese dato en API-Football.</p>') +
      '</article><article class="match-data-card"><h3>Lesiones y suspensiones</h3>' +
      (injuries.length
        ? injuries
            .map(
              (x) =>
                '<div class="match-event"><b>' +
                esc(x.player?.name || "Jugador") +
                "</b><span>" +
                esc(x.team?.name || "") +
                " · " +
                esc(x.type || "") +
                " · " +
                esc(x.reason || "") +
                "</span></div>",
            )
            .join("")
        : '<p class="muted">La API no reportó lesiones o suspensiones para este encuentro.</p>') +
      "</article>" +
      (!lineups.length
        ? '<article class="match-data-card"><h3>Alineaciones</h3><p class="muted">La API publica las alineaciones cerca del inicio del partido, si la competición ofrece ese dato.</p></article>'
        : "") +
      lineups
        .map(
          (team) =>
            '<article class="match-data-card"><h3>' +
            esc(team.team?.name || "Alineación") +
            " · " +
            esc(team.formation || "") +
            "</h3><p>Entrenador: " +
            esc(team.coach?.name || "—") +
            "</p>" +
            (team.startXI || [])
              .map(
                (x) =>
                  '<div class="match-event"><b>' +
                  esc(x.player?.number ?? "") +
                  "</b><span>" +
                  esc(x.player?.name || "") +
                  " · " +
                  esc(x.player?.pos || "") +
                  "</span></div>",
              )
              .join("") +
            "</article>",
        )
        .join("") +
      "</div>"
    );
  }
  if (tab === "analysis") {
    const pred = data.predictions,
      fixture = pred?.predictions || {},
      percent = fixture.percent || {},
      form = pred?.teams || {},
      cmp = pred?.comparison || {},
      analysisData = pred || { h2h: data.h2h || [] },
      model = ownFormEstimate(analysisData, f.home, f.away, data.teamStats || []),
      rows = Object.entries(cmp).filter(([, v]) => v && typeof v === "object");
    const predHtml = pred
      ? '<div class="match-data-card"><h3>Predicción publicada por API-Football</h3><div class="match-prob-grid">' +
        [
          ["Local", percent.home],
          ["Empate", percent.draw],
          ["Visitante", percent.away],
        ]
          .map(([n, v]) => "<div><small>" + n + "</small><strong>" + esc(v || "—") + "</strong></div>")
          .join("") +
        '</div><p class="small muted">Estimación de API-Football; no es una garantía. ' +
        esc(fixture.advice || "") +
        "</p></div>"
      : '<div class="empty">' +
        esc(data.predictionsError || "La API no ofrece una predicción para esta competición o encuentro.") +
        "</div>";
    const modelHtml = model
      ? '<article class="match-data-card"><h3>Estimación propia KAL · forma reciente</h3><div class="match-prob-grid">' +
        [
          ["Local", model.home + "%"],
          ["Empate", model.draw + "%"],
          ["Visitante", model.away + "%"],
        ]
          .map(([n, v]) => "<div><small>" + n + "</small><strong>" + v + "</strong></div>")
          .join("") +
        '</div><p class="small muted">Calculada solo con forma reciente y H2H que la API entregó (' +
        model.sample +
        " resultados). Confianza de cobertura: " +
        model.level +
        ". Modelo orientativo, sin ventaja local ni datos faltantes añadidos.</p></article>"
      : "";
    const h2hItems = Array.isArray(pred?.h2h) ? pred.h2h : data.h2h || [],
      h2hHtml =
        '<article class="match-data-card"><h3>Enfrentamientos directos · H2H</h3>' +
        (h2hItems.length
          ? h2hItems
              .slice(0, 5)
              .map(
                (x) =>
                  '<div class="match-event"><b>' +
                  esc(x.goals?.home ?? "—") +
                  "–" +
                  esc(x.goals?.away ?? "—") +
                  "</b><span>" +
                  esc(x.teams?.home?.name || "") +
                  " vs " +
                  esc(x.teams?.away?.name || "") +
                  " · " +
                  esc(x.fixture?.date ? new Date(x.fixture.date).toLocaleDateString("es-HN") : "") +
                  "</span></div>",
              )
              .join("")
          : '<p class="muted">La API no proporcionó enfrentamientos directos.</p>') +
        "</article>";
    const seasonStats = (data.teamStats || []).filter(Boolean);
    const formHtml =
      [form.home, form.away]
        .filter(Boolean)
        .map(
          (t) =>
            '<article class="match-data-card"><h3>' +
            esc(t.name || "Equipo") +
            " · forma reciente</h3><p>" +
            esc(t.last_5?.form || t.league?.form || "Sin forma disponible") +
            "</p><small>Victorias " +
            esc(t.last_5?.fixtures?.wins?.total ?? t.league?.fixtures?.wins?.total ?? "—") +
            " · Empates " +
            esc(t.last_5?.fixtures?.draws?.total ?? t.league?.fixtures?.draws?.total ?? "—") +
            " · Derrotas " +
            esc(t.last_5?.fixtures?.loses?.total ?? t.league?.fixtures?.loses?.total ?? "—") +
            "</small></article>",
        )
        .join("") ||
      (seasonStats.length
        ? seasonStats
            .map((t) => {
              const s = t.fixtures || {},
                g = t.goals || {};
              return (
                '<article class="match-data-card"><h3>' +
                esc(t.team?.name || "Equipo") +
                " · forma de temporada " +
                esc(data.season || "") +
                "</h3><p>Últimos resultados disponibles: " +
                esc(t.form || "Sin dato") +
                "</p><small>Partidos " +
                esc(s.played?.total ?? "—") +
                " · G/E/P " +
                esc(s.wins?.total ?? "—") +
                "/" +
                esc(s.draws?.total ?? "—") +
                "/" +
                esc(s.loses?.total ?? "—") +
                " · Goles a favor (prom.) " +
                esc(g.for?.average?.total ?? "—") +
                " · en contra (prom.) " +
                esc(g.against?.average?.total ?? "—") +
                "</small></article>"
              );
            })
            .join("")
        : '<article class="match-data-card"><h3>Forma reciente</h3><p class="muted">La API no devolvió forma o estadísticas de temporada para estos equipos.</p></article>');
    const cmpHtml = rows.length
      ? '<article class="match-data-card"><h3>Comparativa de equipos</h3>' +
        rows
          .map(
            ([k, v]) =>
              '<div class="match-stat-row"><span>' +
              esc(k.replace(/([A-Z])/g, " $1")) +
              "</span><b>" +
              esc(v.home || "—") +
              " · " +
              esc(v.away || "—") +
              "</b></div>",
          )
          .join("") +
        "</article>"
      : "";
    const standings = (data.standings || []).flatMap((x) => x.league?.standings || []).flat();
    const standingsHtml = standings.length
      ? '<article class="match-data-card"><h3>Posiciones</h3>' +
        standings
          .filter((x) => [f.home, f.away].some((n) => teamEventKey(x.team?.name) === teamEventKey(n)))
          .map(
            (x) =>
              '<div class="match-stat-row"><span>' +
              esc(x.team?.name || "") +
              "</span><b>#" +
              esc(x.rank) +
              " · " +
              esc(x.points) +
              " pts</b></div>",
          )
          .join("") +
        "</article>"
      : data.standingsError
        ? '<article class="match-data-card"><h3>Posiciones</h3><p class="muted">' +
          esc(data.standingsError) +
          "</p></article>"
        : '<article class="match-data-card"><h3>Posiciones</h3><p class="muted">La API no tiene una tabla disponible para esta competición y temporada.</p></article>';
    return (
      '<div class="match-analysis-grid">' +
      predHtml +
      modelHtml +
      formHtml +
      cmpHtml +
      h2hHtml +
      standingsHtml +
      '</div><div class="small muted match-data-footnote">Los porcentajes de cuotas, si existen, son implícitos; la ficha distingue esos valores de las predicciones de la API. Sin datos suficientes no se muestra un nivel de confianza inventado.</div>'
    );
  }
  return '<div class="empty">No hay información disponible para esta pestaña.</div>';
}
function playerImageUrl(url) {
  return resolveImage(url);
}
function savedPlayerPhoto(key, fixture, market) {
  if (matchPlayerPhotos[key]) return matchPlayerPhotos[key];
  const dir = readCrestDirectory(),
    parsed = parsePlayerBet(market, fixture),
    club = parsed ? playerClubForCode(parsed.code, fixture).club : "",
    direct = Object.entries(dir).find(
      ([id, item]) => id.startsWith("player:") && item?.marketKey === key && (item.photo || item.url),
    );
  if (direct) return playerImageUrl(direct[1].photo || direct[1].url);
  const saved = parsed ? findSavedPlayer(parsed.name, club, dir) : null;
  return saved ? playerImageUrl(saved[1].photo || saved[1].url) : "";
}
// Abre la ventana para buscar la foto del jugador de un mercado (sin cuadros de texto del navegador).
async function lookupMatchPlayerPhoto(marketKeyValue, refOverride = null, playerBet = null) {
  const ref = refOverride || currentMatchRef,
    c = ref?.draft ? { fixtures: draftSelections } : db.coupons.find((x) => x.id === ref?.couponId),
    f = ref?.draft ? draftSelections[Number(ref.fixtureIndex)] : c?.fixtures?.[Number(ref?.fixtureIndex)];
  if (!f) {
    toast("No pude identificar el partido asociado a este jugador.");
    return;
  }
  const market = f.markets?.find((m) => marketKey(f, m) === marketKeyValue),
    parsed = (market && parsePlayerBet(market, f)) || {},
    name = parsed.name || playerBet?.name || "",
    code = playerBet?.code || parsed.code || "";
  const inferred = playerBet?.side
      ? { side: playerBet.side, club: playerBet.club }
      : playerClubForCode(code, f),
    side = inferred.side,
    club = side ? f[side] : /^Equipo \(/.test(inferred.club || "") ? "" : inferred.club || "";
  openPlayerPicker({
    mode: "photo",
    name,
    club,
    code,
    marketKey: marketKeyValue,
    market: market?.market || "",
    aliases: [parsed.name].filter(Boolean),
    teamId: (side && matchApiIds(f)[side]) || "",
    season: (scheduleISO(f) || "").slice(0, 4) || undefined,
  });
}
function renderMatchDetail(ref = currentMatchRef) {
  if (!ref) return;
  const draftFixture = ref.draft ? draftSelections[Number(ref.fixtureIndex)] : null,
    c = ref.draft
      ? { id: editingCouponId || "draft", fixtures: draftSelections }
      : db.coupons.find((x) => x.id === ref.couponId),
    f = ref.draft ? draftFixture : c?.fixtures?.[Number(ref.fixtureIndex)];
  if (!c || !f) {
    closeMatchDetails();
    return;
  }
  applySavedCrests(f);
  const fk = fixtureKey(f),
    items = [];
  if (ref.draft) {
    f.markets.forEach((m) => items.push({ f, m, c: { id: c.id } }));
  } else
    db.coupons.forEach((coupon) =>
      (coupon.fixtures || []).forEach((g) => {
        if (fixtureKey(g) === fk) g.markets.forEach((m) => items.push({ f: g, m, c: coupon }));
      }),
    );
  // El mismo mercado de línea escrito distinto en otro cupón ("Total" / "Total de goles", "Remates (X) y suplente" /
  // "Remates - X (incl. suplente)") se muestra una sola vez; sus botones marcan todos a la vez.
  const merged = new Map();
  items.forEach((x) => {
    const k = marketKey(x.f, x.m),
      info = parseLine(x.m, x.f),
      kind = info && statKind(x.m, x.f, info),
      g = kind
        ? [
            "linea",
            kind.type,
            kind.side || "",
            kind.stat || "",
            kind.playerKey || "",
            kind.incl ? "s" : "",
            info.dir,
            info.line,
          ].join("|")
        : outcomeKey(outcomeSpec(x.m, x.f)) || k;
    if (!merged.has(g)) merged.set(g, { key: k, keys: [], f: x.f, m: x.m, coupons: new Set() });
    const e = merged.get(g);
    if (!e.keys.includes(k)) e.keys.push(k);
    if (
      String(x.m.market || "").length > String(e.m.market || "").length &&
      x.m.settlement === e.m.settlement
    )
      e.m = x.m;
    if (x.m.ai && !e.ai) e.ai = x.m.ai;
    e.coupons.add(x.c.id);
  });
  merged.forEach((e) => (e.statusKey = e.keys.join("||")));
  const comp =
      [f.competition || f.league, f.country].filter(Boolean).join(" · ") || "Competencia sin identificar",
    title = esc(f.home) + " vs " + esc(f.away),
    date = esc(displayFixtureDate(f)),
    time = esc(f.time || "Hora pendiente"),
    logo = f.leagueCrest ? crestHTML(f.leagueCrest, comp) : '<span class="match-league-ball">⚽</span>',
    // Análisis, Estadísticas y Eventos venían de API-Football, cuyo plan gratis solo da temporadas 2022-2024: nunca
    // traían datos de partidos actuales y cada intento gastaba la cuota de los escudos. Los datos útiles están en "Datos".
    tabs = [
      ["markets", "◎ Mercados"],
      ["datos", "📊 Resumen"],
      ["coupons", "▣ Cupones"],
    ];
  const content = renderMatchDataPanel(matchActiveTab, f, merged),
    prevScroll = $("matchModalContent").querySelector(".match-modal-markets"),
    keepScroll =
      prevScroll && ref === currentMatchRef && prevScroll.dataset.tab === matchActiveTab
        ? prevScroll.scrollTop
        : 0;
  $("matchModalContent").innerHTML =
    '<header class="match-stadium themed" ' +
    heroAttrs(f) +
    ">" +
    heroDecor(f) +
    '<div class="match-competition">' +
    logo +
    "<span>" +
    esc(comp) +
    '</span></div><div class="match-teams-hero"><div class="hero-team">' +
    crestHTML(f.homeCrest, f.home) +
    "<strong>" +
    esc(f.home) +
    "</strong></div>" +
    heroScoreHtml(f) +
    '<div class="hero-team">' +
    crestHTML(f.awayCrest, f.away) +
    "<strong>" +
    esc(f.away) +
    '</strong></div></div><div class="match-info-chips"><span>▦　' +
    date +
    "</span><span>◷　" +
    time +
    "</span><span>◎　" +
    (f.countryFlag ? crestHTML(f.countryFlag, f.country) : esc(countryFlag(f.country || "Competición"))) +
    "　" +
    esc(f.country || "Competición") +
    "</span><span>" +
    logo +
    "　" +
    esc(f.competition || f.league || "Liga no identificada") +
    '</span></div><button type="button" class="btn match-edit-crests" data-market-edit-logos data-home="' +
    esc(f.home) +
    '" data-away="' +
    esc(f.away) +
    '">⚽ Editar escudos</button></header><nav class="match-tabs" aria-label="Secciones del partido">' +
    tabs.map(([id, label]) => matchTabButton(id, label)).join("") +
    '</nav><section class="match-modal-markets ' +
    (ref.draft ? "is-draft" : "") +
    '" data-tab="' +
    matchActiveTab +
    '"><div class="match-market-heading"><h2 id="matchModalTitle">' +
    title +
    '</h2><div class="row"><span class="badge">' +
    merged.size +
    " mercado(s)</span>" +
    (["analysis", "statistics", "events"].includes(matchActiveTab)
      ? '<button type="button" class="btn sm" data-load-match-tab="' +
        matchActiveTab +
        '">↻ Actualizar datos</button>'
      : "") +
    '</div></div><div id="matchTabPanel">' +
    content +
    "</div></section>";
  showCrestImagesIn($("matchModalContent"));
  applyTeamColors($("matchModalContent").querySelector(".match-stadium"), f);
  showPlayerPhotoImagesIn($("matchModalContent"));
  // La subpestaña activa se centra en la fila de botones (sin mover la ventana).
  const subNav = $("matchModalContent").querySelector(".msub-nav"),
    subChip = subNav?.querySelector(".msub-chip.active");
  if (subNav && subChip)
    subNav.scrollLeft = subChip.offsetLeft - (subNav.clientWidth - subChip.offsetWidth) / 2;
  if (keepScroll) {
    const sc = $("matchModalContent").querySelector(".match-modal-markets");
    if (sc) sc.scrollTop = keepScroll;
  }
}
function showPlayerPhotoImagesIn(root) {
  root.querySelectorAll(".player-photo-row img,.player-logo-card img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const row = img.closest(".player-photo-row,.player-logo-card .logo-card-top");
        if (row) {
          img.remove();
          const note = document.createElement("span");
          note.className = "muted";
          note.textContent = "La imagen del jugador no está disponible.";
          row.append(note);
          const status = img.closest(".player-logo-card")?.querySelector(".logo-status");
          if (status) {
            status.textContent = "Imagen no disponible";
            status.classList.remove("is-saved");
          }
        }
      },
      { once: true },
    );
  });
}
function showCrestImagesIn(root) {
  root.querySelectorAll("img[data-crest-url]").forEach(showCrestImage);
}
