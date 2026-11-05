// Reglas de cupones y mercados: estados, claves de partido/mercado, cupones vivos y filtros.
"use strict";
function statusLabel(s) {
  return s === "won"
    ? "Ganado"
    : s === "lost"
      ? "Perdido"
      : s === "void"
        ? "Nulo"
        : s === "cashout"
          ? "Cash out"
          : "Pendiente";
}
function lostCouponCount(ids) {
  return [...ids].filter((id) => {
    const c = db.coupons.find((x) => x.id === id);
    return c && calcCoupon(c).status === "lost";
  }).length;
}
// Un cupón sigue "vivo" solo mientras está pendiente: si se perdió, se cobró (cash out) o se anuló, sus mercados ya no se siguen.
function openCouponIds() {
  return new Set(db.coupons.filter((c) => calcCoupon(c).status === "pending").map((c) => c.id));
}
function marketIsActive(m, couponIds, open) {
  return m.settlement === "pending" && [...couponIds].some((id) => open.has(id));
}
function pendingMarketCount() {
  const keys = new Set(),
    open = openCouponIds();
  db.coupons
    .filter((c) => open.has(c.id))
    .forEach((c) =>
      c.fixtures.forEach((f) =>
        f.markets.forEach((m) => {
          if (m.settlement === "pending") keys.add(marketKey(f, m));
        }),
      ),
    );
  return keys.size;
}
function scheduleISO(f) {
  let x = String(f.dateISO || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  if (/^--\d{2}-\d{2}$/.test(x)) return new Date().getFullYear() + x.slice(1);
  const m = String(f.date || "").match(/(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?/);
  if (!m) return "";
  let y = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (y < 100) y += 2000;
  return y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
}
function fixtureSortValue(f) {
  const iso = scheduleISO(f);
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const time = /^\d{2}:\d{2}$/.test(f.time || "") ? f.time : "23:59";
  return new Date(iso + "T" + time + ":00").getTime();
}
function displayFixtureDate(f) {
  const iso = scheduleISO(f);
  return iso
    ? new Date(iso + "T12:00:00").toLocaleDateString("es-HN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : f.date || "Fecha pendiente";
}
function teamEventKey(value) {
  let n = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  n = n
    .replace(/\b(?:football club|fc|cf|sk|sc|afc|cfc|fk|vfb|ac|as|sv|bk|if|ik|club|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = {
    "paris saint germain": "psg",
    "paris st germain": "psg",
    "paris sg": "psg",
    "inter milan": "inter",
    internazionale: "inter",
    "fc internazionale": "inter",
    "sporting lisboa": "sporting cp",
    "sporting lisbon": "sporting cp",
    sporting: "sporting cp",
    barca: "barcelona",
    "fc barcelona": "barcelona",
    "barcelona fc": "barcelona",
    "galatasaray sk": "galatasaray",
    "villarreal cf": "villarreal",
    "vfb stuttgart": "stuttgart",
    "aston villa fc": "aston villa",
    "sl benfica": "benfica",
    "benfica lisbon": "benfica",
    "psv eindhoven": "psv",
    "bayern munchen": "bayern munich",
    "bayern munich": "bayern munich",
    "man utd": "manchester united",
    "man united": "manchester united",
    "manchester utd": "manchester united",
    "atletico madrid": "atletico madrid",
    "atletico de madrid": "atletico madrid",
  };
  return aliases[n] || n;
}
function fixtureKey(f) {
  return [scheduleISO(f) || f.date, f.time, teamEventKey(f.home), teamEventKey(f.away)].join("|");
}
function legacyMarketKey(f, m) {
  return [
    scheduleISO(f) || f.date,
    f.time,
    f.home.toLowerCase().replace(/\s+/g, " ").trim(),
    f.away.toLowerCase().replace(/\s+/g, " ").trim(),
    m.market.toLowerCase().replace(/\s+/g, " ").trim(),
    m.pick.toLowerCase().trim(),
  ].join("|");
}
function marketKey(f, m) {
  const norm = (x) =>
    String(x || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return [
    scheduleISO(f) || f.date,
    f.time,
    teamEventKey(f.home),
    teamEventKey(f.away),
    norm(m.market),
    norm(m.pick),
  ].join("|");
}
function fixtureCount(c) {
  return c.fixtures.length;
}
function couponProgress(c) {
  const all = c.fixtures.flatMap((f) => f.markets),
    done = all.filter((m) => m.settlement !== "pending").length;
  return `Mercados liquidados: ${done} de ${all.length}${calcCoupon(c).status === "lost" ? " · Combinada perdida" : ""}`;
}
function populateHouses() {
  const opts =
    '<option value="">Sin asignar</option>' +
    db.houses.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");
  $("couponHouse").innerHTML = opts;
  $("txHouse").innerHTML =
    '<option value="">Seleccionar casa</option>' +
    db.houses.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");
}
function populateMarketHouseFilter() {
  const el = $("marketHouseFilter");
  if (!el) return;
  const selected = el.value;
  el.innerHTML =
    '<option value="">Todas las casas</option>' +
    db.houses.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");
  if (db.houses.some((h) => h.id === selected)) el.value = selected;
}
function applyMarketFilters() {
  const q = ($("marketSearch")?.value || "").trim().toLowerCase(),
    date = ($("marketDateFilter")?.value || "").trim().toLowerCase(),
    status = $("marketStatusFilter")?.value || "",
    house = $("marketHouseFilter")?.value || "";
  document.querySelectorAll("[data-market-card]").forEach((card) => {
    const team = (card.dataset.team || "").toLowerCase().includes(q),
      dateMatch = (card.dataset.date || "").toLowerCase().includes(date);
    let hasVisible = false;
    card.querySelectorAll("[data-market-row]").forEach((row) => {
      const houses = (row.dataset.marketHouses || "").split("|");
      const visible =
        (!status ||
          (status === "pending" ? row.dataset.marketActive === "1" : row.dataset.marketStatus === status)) &&
        (!house || houses.includes(house));
      row.classList.toggle("hidden", !visible);
      if (visible) hasVisible = true;
    });
    card.classList.toggle("hidden", !(team && dateMatch && hasVisible));
  });
}
