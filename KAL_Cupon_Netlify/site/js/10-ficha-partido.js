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
    const r = await fetch("/.netlify/functions/partido?" + url.toString(), {
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
function matchStatValue(stats, name) {
  const item = (stats || []).find((x) => String(x.type).toLowerCase() === name.toLowerCase());
  return item?.value === null || item?.value === undefined ? "—" : String(item.value);
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
    prob = odd > 1 ? Math.round(100 / odd) : null,
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
      esc(x.key) +
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
      : "<small>Sin cuota registrada · " +
        x.coupons.size +
        " cupón" +
        (x.coupons.size === 1 ? "" : "es") +
        "</small>") +
    "</div>" +
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
function renderMatchMarkets(merged) {
  const all = [...merged.values()],
    open = openCouponIds(),
    alive = (x) =>
      currentMatchRef?.draft
        ? (x.m.settlement || "pending") === "pending"
        : marketIsActive(x.m, x.coupons, open);
  all.forEach((x) => {
    x.closed = (x.m.settlement || "pending") === "pending" && !alive(x);
  });
  const pending = all.filter(alive),
    marked = all.filter((x) => !alive(x));
  if (!all.length) return '<div class="empty">Este partido aún no tiene mercados.</div>';
  const count = (st) => marked.filter((x) => x.m.settlement === st).length;
  return (
    '<section class="match-tab-content">' +
    (currentMatchRef?.draft
      ? '<div class="notice">Vista previa del cupón. Guarda el cupón para marcar resultados.</div>'
      : "") +
    finishMatchButton(all[0].f, pending) +
    (pending.length
      ? pending.map(matchMarketCard).join("")
      : '<div class="empty small"><strong>Todo marcado ✓</strong>No quedan mercados pendientes en este partido.</div>') +
    (marked.length
      ? '<section class="fold marked-fold' +
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
        marked.map(matchMarketCard).join("") +
        "</div></section>"
      : "") +
    "</section>"
  );
}
function renderMatchDataPanel(tab, f, merged) {
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
  return String(url || "");
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
function playerPhotoMarkup(key, fixture, market) {
  const url = savedPlayerPhoto(key, fixture, market);
  return url
    ? '<div class="player-photo-row"><img src="' +
        esc(url) +
        '" alt="Foto de ' +
        esc(market?.playerName || "jugador") +
        '" loading="lazy" referrerpolicy="no-referrer"><span>Foto del jugador guardada en Logos</span></div>'
    : '<button type="button" class="btn sm player-photo-button" data-player-photo="' +
        esc(key) +
        '">▣ Buscar foto del jugador</button>';
}
async function lookupMatchPlayerPhoto(marketKeyValue, refOverride = null, playerBet = null) {
  const ref = refOverride || currentMatchRef,
    c = ref?.draft ? { fixtures: draftSelections } : db.coupons.find((x) => x.id === ref?.couponId),
    f = ref?.draft ? draftSelections[Number(ref.fixtureIndex)] : c?.fixtures?.[Number(ref.fixtureIndex)];
  if (!f) {
    toast("No pude identificar el partido asociado a este jugador.");
    return;
  }
  const market =
      f.markets?.find((m) => marketKey(f, m) === marketKeyValue) ||
      f.markets?.find((m) => parsePlayerBet(m, f)),
    parsed = parsePlayerBet(market, f) || {},
    hinted = parsed.name || "";
  const search = hinted || prompt("Escribe el nombre del jugador para buscar su foto:");
  if (!search || search.trim().length < 3) {
    if (search !== null) toast("Escribe al menos tres letras.");
    return;
  }
  const inferred = playerBet?.side
    ? { side: playerBet.side, club: playerBet.club }
    : playerClubForCode(playerBet?.code || parsed.code, f);
  const isHome =
    inferred.side === "home"
      ? true
      : inferred.side === "away"
        ? false
        : confirm("¿Juega en el equipo local: " + f.home + "? Pulsa Cancelar para buscar en " + f.away + ".");
  const teamId = isHome ? matchApiIds(f).home : matchApiIds(f).away,
    club = isHome ? f.home : f.away;
  const button = [...document.querySelectorAll("[data-player-photo]")].find(
    (x) => x.dataset.playerPhoto === marketKeyValue,
  );
  if (button) {
    button.disabled = true;
    button.textContent = "Buscando foto…";
  }
  try {
    const cleanName = search
      .replace(/\s*\([A-Z]{2,5}\)\s*$/i, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const params = new URLSearchParams({
      search: cleanName,
      teamId: teamId || "",
      season: scheduleISO(f).slice(0, 4),
    });
    const response = await fetch("/.netlify/functions/jugadores?" + params.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(16000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error(
        "La función de jugadores no devolvió JSON. Publica el paquete completo de Netlify, incluidas las funciones.",
      );
    }
    if (!response.ok) throw Error(data.error || "No se pudo buscar al jugador.");
    if (!Array.isArray(data.players) || !data.players.length)
      throw Error(
        "API-Football no encontró una foto para " +
          search +
          ". Prueba con el apellido o revisa que el jugador aparezca en la lista Football Players IDs de API-Football.",
      );
    let chosen = data.players[0];
    if (data.players.length > 1) {
      const options = data.players
          .map((x, i) => i + 1 + ". " + x.name + (x.country ? " · " + x.country : ""))
          .join("\n"),
        answer = prompt("Elige el jugador correcto:\n" + options, "1");
      if (answer === null) return;
      chosen = data.players[Number(answer) - 1];
      if (!chosen) {
        toast("Número de jugador no válido.");
        return;
      }
    }
    if (!chosen.photo) throw Error("API-Football encontró al jugador, pero no entregó su foto.");
    const code = playerBet?.code || parsed.code || "",
      savedClub = chosen.team || club || playerBet?.club || "",
      playerId = String(chosen.id || ""),
      photoKey = playerId ? "player:" + playerId : "player:" + crestNorm(chosen.name),
      dir = readCrestDirectory(),
      aliases = new Set([chosen.name, search, parsed.name].filter(Boolean));
    Object.entries(dir).forEach(([oldKey, item]) => {
      if (!oldKey.startsWith("player:")) return;
      const oldId = String(item.playerId || oldKey.split(":")[1] || "");
      if (
        (playerId && oldId === playerId) ||
        (samePlayerName(item.name, chosen.name) && samePlayerClub(item.club, savedClub))
      ) {
        (item.aliases || []).forEach((name) => aliases.add(name));
        if (item.name) aliases.add(item.name);
        if (oldKey !== photoKey) delete dir[oldKey];
      }
    });
    dir[photoKey] = {
      kind: "player",
      playerId,
      name: chosen.name,
      aliases: [...aliases],
      club: savedClub,
      teamCode: code,
      country: chosen.country || "",
      teamId: chosen.teamId || teamId || "",
      photo: chosen.photo,
      url: chosen.photo,
      marketKey: marketKeyValue,
      market: market?.market || "",
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(CREST_DIR, JSON.stringify(dir));
    } catch {
      throw Error("No se pudo guardar la foto en Logos. Libera espacio del navegador e inténtalo otra vez.");
    }
    matchPlayerPhotos[marketKeyValue] = playerImageUrl(chosen.photo);
    if (cloudSession) queueCloudSync();
    renderLogos();
    if (currentMatchRef === ref && $("matchModal")?.classList.contains("open")) renderMatchDetail(ref);
    toast(
      "Foto guardada en Logos para " + chosen.name + " · " + (chosen.team || club || "club por identificar"),
    );
  } catch (error) {
    toast(error?.message || "No se pudo cargar la foto del jugador.");
  } finally {
    const b = [...document.querySelectorAll("[data-player-photo]")].find(
      (x) => x.dataset.playerPhoto === marketKeyValue,
    );
    if (b) {
      b.disabled = false;
      b.textContent = "▣ Buscar foto del jugador";
    }
  }
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
  const merged = new Map();
  items.forEach((x) => {
    const k = marketKey(x.f, x.m);
    if (!merged.has(k)) merged.set(k, { key: k, f: x.f, m: x.m, coupons: new Set() });
    merged.get(k).coupons.add(x.c.id);
  });
  const comp =
      [f.competition || f.league, f.country].filter(Boolean).join(" · ") || "Competencia sin identificar",
    title = esc(f.home) + " vs " + esc(f.away),
    date = esc(displayFixtureDate(f)),
    time = esc(f.time || "Hora pendiente"),
    logo = f.leagueCrest ? crestHTML(f.leagueCrest, comp) : '<span class="match-league-ball">⚽</span>',
    tabs = [
      ["analysis", "◈ Análisis"],
      ["statistics", "▤ Estadísticas"],
      ["markets", "◎ Mercados"],
      ["events", "◷ Eventos"],
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
    '</strong></div><span class="hero-vs">VS</span><div class="hero-team">' +
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
