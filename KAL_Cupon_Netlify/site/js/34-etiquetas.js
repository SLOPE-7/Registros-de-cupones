// V20 · Etiquetas de estrategia por cupón (selector, sugerencia automática, tarjeta y rentabilidad por etiqueta).

const DEFAULT_TAGS = [
  "Remates",
  "Goles",
  "Córners",
  "Tarjetas",
  "Combinada",
  "Selecciones",
  "Seguro",
  "Arriesgado",
];
let draftTags = [];

const cleanTag = (t) =>
  String(t || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
function tagList() {
  const base = Array.isArray(db.tagList) && db.tagList.length ? db.tagList : DEFAULT_TAGS;
  const extra = draftTags.filter((t) => !base.includes(t));
  return [...base, ...extra];
}
function currentDraftTags() {
  return draftTags.slice();
}
function resetDraftTags() {
  draftTags = [];
  renderTagPicker();
}
function loadDraftTags(tags) {
  draftTags = (Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean);
  renderTagPicker();
}
function renderTagPicker() {
  const el = $("tagPicker");
  if (!el) return;
  el.innerHTML =
    tagList()
      .map(
        (t) =>
          '<button type="button" class="chip tag-chip' +
          (draftTags.includes(t) ? " active" : "") +
          '" data-tag-toggle="' +
          esc(t) +
          '" aria-pressed="' +
          draftTags.includes(t) +
          '">' +
          esc(t) +
          "</button>",
      )
      .join("") + '<button type="button" class="chip tag-chip tag-new" data-tag-new>＋ Nueva</button>';
}
function suggestTags(fixtures) {
  const tags = new Set();
  let n = 0;
  (fixtures || []).forEach((f) =>
    (f.markets || []).forEach((m) => {
      n++;
      const t = crestNorm((m.market || "") + " " + (m.pick || ""));
      if (/remate|tiros?/.test(t)) tags.add("Remates");
      else if (/corner/.test(t)) tags.add("Córners");
      else if (/tarjeta/.test(t)) tags.add("Tarjetas");
      else if (/gol|marcan|anota/.test(t)) tags.add("Goles");
    }),
  );
  if (n > 1) tags.add("Combinada");
  return [...tags];
}
document.addEventListener("click", (e) => {
  const tg = e.target.closest("[data-tag-toggle]");
  if (tg) {
    const t = tg.dataset.tagToggle;
    draftTags = draftTags.includes(t) ? draftTags.filter((x) => x !== t) : [...draftTags, t];
    renderTagPicker();
    return;
  }
  if (e.target.closest("[data-tag-new]")) {
    const t = cleanTag(prompt("Nombre de la etiqueta (por ejemplo: Hondureños, Jueves…)"));
    if (!t) return;
    if (!Array.isArray(db.tagList) || !db.tagList.length) db.tagList = DEFAULT_TAGS.slice();
    if (!db.tagList.includes(t)) db.tagList.push(t);
    if (!draftTags.includes(t)) draftTags.push(t);
    save();
    renderTagPicker();
  }
});

// Sugerir etiquetas al leer un boleto nuevo (applyQuickDefaults se llama al terminar de leer).
const applyQuickDefaultsBase = applyQuickDefaults;
applyQuickDefaults = function () {
  applyQuickDefaultsBase();
  if (!editingCouponId && !draftTags.length) {
    draftTags = suggestTags(draftSelections);
    renderTagPicker();
  }
};

// Etiquetas visibles en la tarjeta del cupón guardado.
const renderCouponsBase = renderCoupons;
renderCoupons = function () {
  renderCouponsBase();
  document.querySelectorAll(".saved-coupon[data-coupon-id]").forEach((card) => {
    const c = db.coupons.find((x) => x.id === card.dataset.couponId);
    const host = card.querySelector(".saved-fixtures");
    if (!c?.tags?.length || !host || card.querySelector(".tag-row")) return;
    host.insertAdjacentHTML(
      "beforebegin",
      '<div class="tag-row">' +
        c.tags.map((t) => '<span class="tag-pill">🏷️ ' + esc(t) + "</span>").join("") +
        "</div>",
    );
  });
};

// Rentabilidad por etiqueta (cupones liquidados).
function tagStats() {
  const g = new Map();
  db.coupons.forEach((c) => {
    const r = calcCoupon(c);
    if (r.status === "pending" || r.net === null || !c.tags?.length) return;
    c.tags.forEach((t) => {
      if (!g.has(t)) g.set(t, { name: t, n: 0, won: 0, stake: 0, net: 0 });
      const x = g.get(t);
      x.n++;
      if (r.status === "won") x.won++;
      x.stake += Number(c.stake) || 0;
      x.net += Number(r.net) || 0;
    });
  });
  return [...g.values()].sort((a, b) => b.n - a.n);
}
function tagStatsHtml() {
  const rows = tagStats();
  if (!rows.length)
    return '<div class="empty small">Pon etiquetas a tus cupones y, al liquidarlos, verás aquí cuáles te dan dinero.</div>';
  return (
    '<div class="perf-houses">' +
    rows
      .map(
        (x) =>
          '<div class="perf-house"><b>🏷️ ' +
          esc(x.name) +
          "</b><small>" +
          x.n +
          " cupones · " +
          x.won +
          " ganados (" +
          pct(x.won / x.n) +
          ") · apostado " +
          money(x.stake) +
          '</small><span class="' +
          (x.net >= 0 ? "gain" : "loss") +
          '">' +
          signed(x.net) +
          (x.stake ? " · ROI " + spct(x.net / x.stake) : "") +
          "</span></div>",
      )
      .join("") +
    "</div>"
  );
}
const renderPerformanceTags = renderPerformance;
renderPerformance = function () {
  renderPerformanceTags();
  const el = $("perfSection");
  if (!el || el.querySelector("#tagStatsBlock")) return;
  el.insertAdjacentHTML(
    "beforeend",
    '<section class="perf-block" id="tagStatsBlock"><h3>🏷️ Por etiqueta de estrategia</h3>' +
      tagStatsHtml() +
      "</section>",
  );
};

(function initEtiquetas() {
  const row = document.querySelector(".diary-row");
  if (!row) return;
  row.insertAdjacentHTML(
    "afterend",
    '<div class="field"><label>Etiquetas de estrategia</label><div class="chips tag-picker" id="tagPicker" role="group" aria-label="Etiquetas"></div></div>',
  );
  renderTagPicker();
})();
