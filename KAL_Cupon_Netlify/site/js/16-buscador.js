// Buscador global: escribe un equipo, jugador o nombre de cupón y ve todo lo que tienes de él,
// incluidos los cupones archivados. Se abre con el botón 🔎 del encabezado.
"use strict";

let searchTimer = null;

function openSearch() {
  $("searchSheet").hidden = false;
  document.body.classList.add("search-open");
  setTimeout(() => $("globalSearch").focus(), 50);
  runSearch();
}
function closeSearch() {
  $("searchSheet").hidden = true;
  document.body.classList.remove("search-open");
}

const settleTag = (s) =>
  '<span class="st st-' +
  esc(s || "pending") +
  '">' +
  ({ won: "✓ Ganado", lost: "✕ Perdido", void: "＝ Nulo", cashout: "Cash out" }[s] || "Pendiente") +
  "</span>";

function hitRate(won, lost) {
  return won + lost ? Math.round((won / (won + lost)) * 100) + "%" : "sin resultados aún";
}

function searchData(q) {
  const teams = new Map(),
    players = new Map(),
    coupons = [];
  const statusOf = new Map(db.coupons.map((c) => [c.id, calcCoupon(c).status]));
  db.coupons.forEach((c) => {
    if (crestNorm(c.name + " " + (c.notes || "")).includes(q)) coupons.push(c);
    c.fixtures.forEach((f, fi) => {
      applySavedCrests(f);
      for (const [name, crest] of [
        [f.home, f.homeCrest],
        [f.away, f.awayCrest],
      ]) {
        if (!crestNorm(name).includes(q) && !teamEventKey(name).includes(q)) continue;
        const k = teamEventKey(name);
        if (!teams.has(k))
          teams.set(k, { name, crest: "", fixtures: new Map(), won: 0, lost: 0, counted: new Set() });
        const t = teams.get(k);
        t.crest = t.crest || crest || "";
        const fk = fixtureKey(f);
        if (!t.fixtures.has(fk)) t.fixtures.set(fk, { f, couponId: c.id, fi, statuses: new Set() });
        f.markets.forEach((m) => {
          t.fixtures.get(fk).statuses.add(m.settlement);
          const mk = marketKey(f, m);
          if (t.counted.has(mk)) return;
          t.counted.add(mk);
          if (m.settlement === "won") t.won++;
          if (m.settlement === "lost") t.lost++;
        });
      }
      f.markets.forEach((m) => {
        const bet = parsePlayerBet(m, f);
        if (!bet || !crestNorm(bet.name).includes(q)) return;
        const k = crestNorm(bet.name);
        if (!players.has(k))
          players.set(k, {
            name: bet.name,
            club: playerClubForCode(bet.code, f).club,
            photo: "",
            items: new Map(),
          });
        const p = players.get(k);
        const mk = marketKey(f, m);
        p.photo = p.photo || savedPlayerPhoto(mk, f, m);
        if (!p.items.has(mk))
          p.items.set(mk, {
            f,
            m,
            couponId: c.id,
            fi,
            closed: m.settlement === "pending" && statusOf.get(c.id) !== "pending",
          });
      });
    });
  });
  return { teams: [...teams.values()], players: [...players.values()], coupons };
}

function runSearch() {
  const el = $("searchResults"),
    raw = $("globalSearch").value,
    q = crestNorm(raw);
  if (q.length < 2) {
    el.innerHTML =
      '<div class="empty small">Escribe al menos 2 letras: un equipo (“Barcelona”), un jugador (“Douvikas”) o el nombre de un cupón.</div>';
    return;
  }
  const { teams, players, coupons } = searchData(q);
  const fixtureRow = (x) =>
    '<button type="button" class="search-fixture" data-open-saved-match="' +
    esc(x.couponId) +
    '" data-fixture-index="' +
    x.fi +
    '"><span>' +
    esc(x.f.home) +
    " vs " +
    esc(x.f.away) +
    "</span><small>" +
    esc(displayFixtureDate(x.f)) +
    "</small></button>";
  let html = "";
  if (teams.length)
    html +=
      '<section class="search-group"><h3>Equipos <small>' +
      teams.length +
      "</small></h3>" +
      teams
        .map((t) => {
          const list = [...t.fixtures.values()].sort((a, b) => fixtureSortValue(b.f) - fixtureSortValue(a.f));
          return (
            '<article class="search-card"><div class="search-head">' +
            crestHTML(t.crest, t.name) +
            "<div><b>" +
            esc(t.name) +
            "</b><small>" +
            list.length +
            " partido" +
            (list.length === 1 ? "" : "s") +
            " · " +
            (t.won + t.lost
              ? t.won + "/" + (t.won + t.lost) + " mercados acertados (" + hitRate(t.won, t.lost) + ")"
              : t.counted.size + " mercado" + (t.counted.size === 1 ? "" : "s") + " sin resultado aún") +
            "</small></div></div>" +
            list.slice(0, 5).map(fixtureRow).join("") +
            (list.length > 5
              ? '<small class="search-more">y ' + (list.length - 5) + " partidos más</small>"
              : "") +
            "</article>"
          );
        })
        .join("") +
      "</section>";
  if (players.length)
    html +=
      '<section class="search-group"><h3>Jugadores <small>' +
      players.length +
      "</small></h3>" +
      players
        .map((p) => {
          const items = [...p.items.values()],
            won = items.filter((x) => x.m.settlement === "won").length,
            lost = items.filter((x) => x.m.settlement === "lost").length;
          return (
            '<article class="search-card"><div class="search-head">' +
            (p.photo
              ? '<img class="search-photo" src="' +
                esc(p.photo) +
                '" alt="" loading="lazy" referrerpolicy="no-referrer">'
              : '<span class="team-fallback">' +
                esc(
                  p.name
                    .split(/\s+/)
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase(),
                ) +
                "</span>") +
            "<div><b>" +
            esc(p.name) +
            "</b><small>" +
            esc(p.club || "Club por identificar") +
            " · " +
            items.length +
            " mercado" +
            (items.length === 1 ? "" : "s") +
            " · " +
            hitRate(won, lost) +
            (won + lost ? " de acierto" : "") +
            "</small></div></div>" +
            items
              .slice(0, 6)
              .map(
                (x) =>
                  '<button type="button" class="search-fixture" data-open-saved-match="' +
                  esc(x.couponId) +
                  '" data-fixture-index="' +
                  x.fi +
                  '"><span>' +
                  esc(shortMarket(x.m, x.f)) +
                  " <small>· " +
                  esc(x.f.home) +
                  " vs " +
                  esc(x.f.away) +
                  "</small></span>" +
                  (x.closed ? '<span class="st st-lost">Cupón perdido</span>' : settleTag(x.m.settlement)) +
                  "</button>",
              )
              .join("") +
            "</article>"
          );
        })
        .join("") +
      "</section>";
  if (coupons.length)
    html +=
      '<section class="search-group"><h3>Cupones <small>' +
      coupons.length +
      "</small></h3>" +
      coupons
        .map((c) => {
          const r = calcCoupon(c);
          return (
            '<button type="button" class="search-fixture search-coupon" data-search-coupon="' +
            esc(c.id) +
            '"><span><b>' +
            esc(c.name) +
            "</b> <small>· " +
            esc(new Date(c.created).toLocaleDateString("es-HN")) +
            " · " +
            money(c.stake) +
            "</small></span>" +
            settleTag(r.status === "pending" ? "pending" : r.status) +
            "</button>"
          );
        })
        .join("") +
      "</section>";
  el.innerHTML =
    html ||
    '<div class="empty small"><strong>Sin resultados</strong>No encontré “' +
      esc(raw) +
      "” en tus cupones.</div>";
  showCrestImagesIn(el);
}

// Lleva a Mis cupones con el filtro adecuado y resalta el cupón.
function showCouponFromSearch(id) {
  const c = db.coupons.find((x) => x.id === id);
  if (!c) return;
  const s = calcCoupon(c).status;
  couponFilter = s === "pending" ? "pending" : s === "won" ? "won" : s === "lost" ? "lost" : "closed";
  closeSearch();
  go("saved");
  renderCoupons();
  const card = document.querySelector('[data-coupon-id="' + CSS.escape(id) + '"]');
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1800);
  }
}

$("globalSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#searchBtn")) return openSearch();
  if (e.target.closest("[data-search-close]")) return closeSearch();
  const c = e.target.closest("[data-search-coupon]");
  if (c) return showCouponFromSearch(c.dataset.searchCoupon);
  if (e.target.closest("#searchSheet [data-open-saved-match]")) closeSearch();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("searchSheet").hidden) closeSearch();
});
