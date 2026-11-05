// Agenda, partidos de hoy y resumen central de mercados.
"use strict";
function kickoffDate(f) {
  const iso = scheduleISO(f),
    t = String(f.time || "");
  if (!iso || !/^\d{2}:\d{2}$/.test(t)) return null;
  const d = new Date(iso + "T" + t + ":00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function fixtureMergedMarkets(g) {
  const all = new Map();
  g.items.forEach(({ f, c }) =>
    f.markets.forEach((m) => {
      const k = marketKey(f, m);
      if (!all.has(k)) all.set(k, { m, f, coupons: new Set() });
      all.get(k).coupons.add(c.id);
    }),
  );
  return [...all.values()];
}
function crestHTML(url, name) {
  const u = String(url || "").trim(),
    fallback = '<span class="team-fallback">' + esc((name || "?").slice(0, 2).toUpperCase()) + "</span>";
  if (!/^https?:\/\//i.test(u)) return fallback;
  const trusted = safeCrestSource(u);
  return (
    '<img class="team-crest"' +
    (trusted ? ' src="' + esc(u) + '"' : " hidden") +
    ' data-crest-url="' +
    esc(u) +
    '" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="team-fallback"' +
    (trusted ? " hidden" : "") +
    ">" +
    esc((name || "?").slice(0, 2).toUpperCase()) +
    "</span>"
  );
}
function countryFlag(s) {
  const k = String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const m = {
    espana: "🇪🇸",
    inglaterra: "🏴",
    italia: "🇮🇹",
    francia: "🇫🇷",
    alemania: "🇩🇪",
    portugal: "🇵🇹",
    "paises bajos": "🇳🇱",
    holanda: "🇳🇱",
    escocia: "🏴",
    honduras: "🇭🇳",
    mexico: "🇲🇽",
    "estados unidos": "🇺🇸",
    usa: "🇺🇸",
    brasil: "🇧🇷",
    argentina: "🇦🇷",
    chile: "🇨🇱",
    colombia: "🇨🇴",
    uruguay: "🇺🇾",
    belgica: "🇧🇪",
    turquia: "🇹🇷",
    "arabia saudita": "🇸🇦",
    japon: "🇯🇵",
  };
  return m[k] || "🌍";
}
// ---- Agenda (y panel "Partidos de hoy" del Inicio) ----
// Agrupa los partidos de todos los cupones; "pendiente" solo cuenta mercados de cupones que siguen vivos.
function agendaGroups() {
  const map = new Map(),
    open = openCouponIds();
  let missing = 0;
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      applySavedCrests(f);
      if (open.has(c.id) && (!scheduleISO(f) || !/^\d{2}:\d{2}$/.test(f.time || ""))) missing++;
      const k = fixtureKey(f);
      if (!map.has(k)) map.set(k, { f, items: [] });
      const g = map.get(k);
      ["homeCrest", "awayCrest", "leagueCrest", "country", "competition", "league"].forEach((x) => {
        if (!g.f[x] && f[x]) g.f = Object.assign({}, g.f, { [x]: f[x] });
      });
      g.items.push({ f, c });
    }),
  );
  const now = new Date();
  const groups = [...map.values()].map((g) => {
    const markets = fixtureMergedMarkets(g),
      pending = markets.filter((x) => marketIsActive(x.m, x.coupons, open)).length,
      start = kickoffDate(g.f),
      live = !!(pending && start && now >= start && now < new Date(start.getTime() + 150 * 60000));
    return { ...g, markets, pending, start, live, allDone: markets.length > 0 && !pending };
  });
  return { groups, missing };
}
function isoDay(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
function agendaInRange(g, range, date) {
  const iso = scheduleISO(g.f);
  if (date) return iso === date;
  if (range === "all") return true;
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = isoDay(today),
    tm = isoDay(new Date(today.getTime() + 86400000)),
    wk = isoDay(new Date(today.getTime() + 6 * 86400000));
  if (range === "today") return iso === t;
  if (range === "tomorrow") return iso === tm;
  if (range === "week") return iso >= t && iso <= wk;
  return true;
}
function agendaCard(g) {
  const f = g.f,
    first = g.items[0],
    fixtureIndex = first.c.fixtures.findIndex((x) => fixtureKey(x) === fixtureKey(f)),
    comp = f.competition || f.league || "Competencia sin identificar",
    state = g.live
      ? '<span class="live-dot">EN VIVO</span>'
      : g.allDone
        ? '<span class="done-tag">Liquidado</span>'
        : "";
  return (
    '<button type="button" class="agenda-match agenda-match-link ' +
    (g.live ? "is-live " : "") +
    (g.allDone ? "is-done" : "") +
    '" data-open-saved-match="' +
    esc(first.c.id) +
    '" data-fixture-index="' +
    fixtureIndex +
    '" title="Ver partido y mercados"><span class="agenda-teams">' +
    crestHTML(f.homeCrest, f.home) +
    '<span class="team-side home">' +
    esc(f.home) +
    '</span><span class="agenda-vs">vs</span><span class="team-side away">' +
    esc(f.away) +
    "</span>" +
    crestHTML(f.awayCrest, f.away) +
    '</span><span class="agenda-match-info"><b>◷ ' +
    esc(f.time || "--:--") +
    "</b>" +
    (f.leagueCrest ? crestHTML(f.leagueCrest, comp) : "") +
    '<span class="agenda-comp">' +
    esc(comp) +
    "</span>" +
    state +
    (g.pending
      ? '<span class="agenda-count">' + g.pending + " mercado" + (g.pending === 1 ? "" : "s") + "</span>"
      : "") +
    "</span>" +
    (() => {
      const open = openCouponIds(),
        chips = miniProgressText(g.markets.filter((x) => marketIsActive(x.m, x.coupons, open)));
      return chips ? '<span class="pg-chips">' + chips + "</span>" : "";
    })() +
    '<span class="agenda-chevron" aria-hidden="true">›</span></button>'
  );
}
let agendaRange = null;
function renderCalendar() {
  const el = $("agendaList");
  if (!el) return;
  const { groups, missing } = agendaGroups();
  renderTodayPanel(groups);
  const filter = $("agendaFilter").value,
    date = $("agendaDate").value;
  if (agendaRange === null) {
    const todayIso = isoDay(new Date());
    agendaRange = groups.some((g) => g.pending && scheduleISO(g.f) === todayIso) ? "today" : "all";
  }
  document
    .querySelectorAll("[data-agenda-range]")
    .forEach((b) => b.classList.toggle("active", !date && b.dataset.agendaRange === agendaRange));
  const inRange = groups.filter((g) => agendaInRange(g, agendaRange, date));
  $("agendaUpcoming").textContent = inRange.filter((g) => g.start && g.pending && !g.live).length;
  $("agendaLive").textContent = inRange.filter((g) => g.live).length;
  $("agendaDone").textContent = inRange.filter((g) => g.allDone).length;
  $("agendaMissing").textContent = missing;
  let shown = inRange
    .filter((g) => {
      if (!g.start)
        return filter === "all" || (filter === "pending" && !!g.pending) || (filter === "done" && g.allDone);
      if (filter === "pending" && !g.pending) return false;
      if (filter === "playing" && !g.live) return false;
      if (filter === "done" && !g.allDone) return false;
      return true;
    })
    .sort((a, b) => (a.start?.getTime() || Infinity) - (b.start?.getTime() || Infinity));
  if (!shown.length) {
    el.innerHTML =
      '<div class="empty"><strong>No hay partidos para mostrar</strong>' +
      (agendaRange === "today" && !date
        ? "Hoy no tienes partidos pendientes. Prueba con “Semana” o “Todos”."
        : "Cambia los filtros o completa fecha y hora en tus cupones.") +
      "</div>";
    return;
  }
  const dayLabel = (iso) => {
    const d = new Date(iso + "T12:00:00"),
      today = new Date(),
      tomorrow = new Date();
    today.setHours(0, 0, 0, 0);
    tomorrow.setTime(today.getTime() + 86400000);
    if (d.toDateString() === today.toDateString()) return "Hoy";
    if (d.toDateString() === tomorrow.toDateString()) return "Mañana";
    return d.toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long" });
  };
  const byDay = new Map();
  shown.forEach((g) => {
    if (!g.start) return;
    const k = scheduleISO(g.f);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(g);
  });
  let html = "";
  for (const [iso, items] of byDay)
    html +=
      '<section class="agenda-day"><h3>' +
      esc(dayLabel(iso)) +
      " <small>" +
      items.length +
      "</small></h3>" +
      items.map(agendaCard).join("") +
      "</section>";
  const noDate = shown.filter((g) => !g.start);
  if (noDate.length)
    html +=
      '<section class="agenda-day"><h3>Fecha u hora pendiente</h3>' +
      noDate.map(agendaCard).join("") +
      "</section>";
  el.innerHTML = html;
}
function renderTodayPanel(groups) {
  const el = $("todayList");
  if (!el) return;
  groups = groups || agendaGroups().groups;
  const t = isoDay(new Date()),
    today = groups
      .filter((g) => scheduleISO(g.f) === t)
      .sort((a, b) => (a.start?.getTime() || Infinity) - (b.start?.getTime() || Infinity));
  $("todayUpcoming").textContent = today.filter((g) => g.pending && !g.live).length;
  $("todayLive").textContent = today.filter((g) => g.live).length;
  $("todayDone").textContent = today.filter((g) => g.allDone).length;
  const active = today.filter((g) => g.pending);
  el.innerHTML = active.length
    ? active.slice(0, 6).map(agendaCard).join("") +
      (active.length > 6
        ? '<button type="button" class="btn sm today-more" data-view="calendar">Ver los ' +
          active.length +
          " partidos de hoy</button>"
        : "")
    : '<div class="empty small">No tienes partidos pendientes para hoy.</div>';
}

function marketPlayerPhotoHTML(x) {
  const bet = parsePlayerBet(x.m, x.f);
  if (!bet) return "";
  const url = savedPlayerPhoto(x.key, x.f, x.m);
  return url
    ? '<img class="market-player-photo" src="' +
        esc(url) +
        '" alt="Foto de ' +
        esc(bet.name) +
        '" loading="lazy" referrerpolicy="no-referrer">'
    : "";
}
function renderMarkets() {
  const matches = new Map(),
    open = openCouponIds();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => {
      applySavedCrests(f);
      const fk = fixtureKey(f);
      if (!matches.has(fk)) matches.set(fk, { f: { ...f }, markets: new Map() });
      const match = matches.get(fk);
      ["homeCrest", "awayCrest", "leagueCrest", "country", "competition", "league"].forEach((k) => {
        if (!match.f[k] && f[k]) match.f[k] = f[k];
      });
      f.markets.forEach((m) => {
        const key = marketKey(f, m);
        if (!match.markets.has(key)) match.markets.set(key, { key, f, m, coupons: new Set() });
        match.markets.get(key).coupons.add(c.id);
      });
    }),
  );
  const arr = [...matches.values()]
    .map((group) => ({ ...group, markets: new Map([...group.markets]) }))
    .filter((group) => group.markets.size)
    .sort((a, b) => fixtureSortValue(a.f) - fixtureSortValue(b.f));
  marketMatchRefs = [];
  $("marketSummary").innerHTML = arr.length
    ? arr
        .map((match, i) => {
          const firstMarket = [...match.markets.values()][0],
            firstCoupon = [...firstMarket.coupons][0],
            fixtureIndex =
              db.coupons
                .find((c) => c.id === firstCoupon)
                ?.fixtures.findIndex((f) => fixtureKey(f) === fixtureKey(match.f)) ?? 0,
            ref = marketMatchRefs.push({ couponId: firstCoupon, fixtureIndex }) - 1;
          return `<article class="coupon" data-market-card data-team="${esc(match.f.home + " " + match.f.away)}" data-date="${esc(match.f.date + " " + match.f.time)}"><div class="couponhead"><div class="market-match-open" role="button" tabindex="0" data-open-market-match="${ref}" title="Ver partido y mercados"><div class="agenda-teams">${crestHTML(match.f.homeCrest, match.f.home)}<strong>${esc(match.f.home)}</strong><span class="agenda-vs">vs</span><strong>${esc(match.f.away)}</strong>${crestHTML(match.f.awayCrest, match.f.away)}</div><div class="marketmeta">${match.f.leagueCrest ? crestHTML(match.f.leagueCrest, match.f.competition || match.f.league) : ""} ◷ ${esc(match.f.time || "Hora pendiente")}　·　${esc(displayFixtureDate(match.f))}　·　${esc([match.f.country, match.f.competition || match.f.league].filter(Boolean).join(" · ") || "Competencia sin identificar")}</div></div><div class="row market-head-actions"><button type="button" class="btn sm" data-market-edit-logos data-home="${esc(match.f.home)}" data-away="${esc(match.f.away)}">⚽ Editar escudos</button><button type="button" class="btn sm" data-expand="fixture-markets-${i}" aria-expanded="false"><span class="badge">${match.markets.size} mercado(s)　⌄</span></button></div></div><div class="couponbody hidden" id="fixture-markets-${i}"><div class="marketmeta">${esc(match.f.date)} · ${esc(match.f.time)} · ${esc(match.f.league || "Liga no identificada")} · ${match.markets.size} mercado(s)</div>${[...match.markets.values()].map((x) => `<div class="marketrow" data-market-row data-market-status="${esc(x.m.settlement)}" data-market-active="${marketIsActive(x.m, x.coupons, open) ? "1" : "0"}" data-market-houses="${esc([...x.coupons].map((id) => db.coupons.find((c) => c.id === id)?.houseId || "").join("|"))}"><div><div class="marketname">${marketPlayerPhotoHTML(x)}${esc(x.m.market)}${x.m.pick ? " · " + esc(x.m.pick) : ""}</div>${miniProgressText([x]) ? '<div class="pg-chips">' + miniProgressText([x]) + "</div>" : ""}<div class="marketmeta">Aparece en ${x.coupons.size} cupón(es) · Estado: <b>${statusLabel(x.m.settlement)}</b>${lostCouponCount(x.coupons) ? " · En " + lostCouponCount(x.coupons) + " combinada(s) perdida(s)" : ""}${x.m.odd || x.m.builderOdd || (x.f.markets.length === 1 ? x.f.totalOdds : "") ? " · Cuota: " + esc(x.m.odd || x.m.builderOdd || (x.f.markets.length === 1 ? x.f.totalOdds : "")) : ""}</div></div><div class="statusbtns"><button title="Ganado" aria-label="Ganado" class="${x.m.settlement === "won" ? "won" : ""}" data-status="${esc(x.key)}" data-value="won">✅</button><button title="Perdido" aria-label="Perdido" class="${x.m.settlement === "lost" ? "lost" : ""}" data-status="${esc(x.key)}" data-value="lost">❌</button><button title="Nulo" aria-label="Nulo" class="${x.m.settlement === "void" ? "void" : ""}" data-status="${esc(x.key)}" data-value="void">🟰</button><button title="Pendiente" aria-label="Pendiente" data-status="${esc(x.key)}" data-value="pending">↺</button></div></div>`).join("")}</div></article>`;
        })
        .join("")
    : '<div class="empty"><strong>No hay mercados registrados</strong>Guarda un cupón para ver aquí el resumen consolidado.</div>';
  showPlayerPhotoImagesIn($("marketSummary"));
}
