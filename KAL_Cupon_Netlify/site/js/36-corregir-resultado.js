// V21.1 · Corregir el resultado de un cupón ya guardado (ganado, perdido, anulado o con cash out).
// Muestra todos los mercados del cupón con sus botones y reutiliza setMarketStatus(), así que cada cambio
// queda en el historial de resultados (y se puede deshacer) y se aplica también a los demás cupones que
// tengan ese mismo mercado, igual que en la pantalla de Mercados.

let fixingCouponId = null;
const FIX_STATES = [
  ["won", "✅", "Ganado"],
  ["lost", "❌", "Perdido"],
  ["void", "🟰", "Nulo"],
  ["pending", "↺", "Pendiente"],
];

function fixHtml(c) {
  const r = calcCoupon(c),
    label = { pending: "Pendiente", won: "Ganado", lost: "Perdido", void: "Anulado", cashout: "Cash out" }[
      r.status
    ];
  const rows = c.fixtures
    .map(
      (f) =>
        '<section class="fix-match"><h4>' +
        esc(f.home) +
        " vs " +
        esc(f.away) +
        "</h4>" +
        f.markets
          .map(
            (m) =>
              '<div class="fix-row"><div class="fix-name"><b>' +
              esc(m.market || "Mercado") +
              "</b>" +
              (m.pick ? " · " + esc(m.pick) : "") +
              '</div><div class="statusbtns">' +
              FIX_STATES.map(
                ([v, ic, tt]) =>
                  '<button type="button" title="' +
                  tt +
                  '" aria-label="' +
                  tt +
                  '" class="' +
                  (m.settlement === v ? v : "") +
                  '" data-fix-key="' +
                  esc(marketKey(f, m)) +
                  '" data-fix-value="' +
                  v +
                  '">' +
                  ic +
                  "</button>",
              ).join("") +
              "</div></div>",
          )
          .join("") +
        "</section>",
    )
    .join("");
  return (
    '<div class="news-sheet fix-sheet"><h2>🛠 Corregir resultado</h2><p class="small"><b>' +
    esc(c.name) +
    '</b> · ahora: <span class="result-badge result-' +
    r.status +
    '">' +
    label +
    "</span></p>" +
    (c.cashoutGross != null
      ? '<div class="notice small">Este cupón tiene un cash out de ' +
        money(c.cashoutGross) +
        '. <button type="button" class="btn sm" data-fix-cashout>Quitar el cash out</button></div>'
      : "") +
    '<div class="row fix-quick"><button type="button" class="btn sm" data-fix-all="won">✅ Todo ganado</button>' +
    '<button type="button" class="btn sm" data-fix-all="pending">↺ Todo pendiente</button></div>' +
    rows +
    '<p class="small muted">El cambio se aplica también a los demás cupones que tengan el mismo mercado, y queda en Mercados → Historial de resultados, donde puedes deshacerlo.</p>' +
    '<button type="button" class="btn gold" data-fix-close>Listo</button></div>'
  );
}
function showFix(id) {
  const c = db.coupons.find((x) => x.id === id);
  if (!c) return;
  fixingCouponId = id;
  let w = document.querySelector(".news-wrap.fix-wrap");
  const top = w?.querySelector(".fix-sheet")?.scrollTop || 0;
  if (!w) {
    document.querySelector(".news-wrap")?.remove();
    w = document.createElement("div");
    w.className = "news-wrap fix-wrap";
    w.setAttribute("role", "dialog");
    w.setAttribute("aria-modal", "true");
    w.setAttribute("aria-label", "Corregir resultado");
    document.body.appendChild(w);
  }
  w.innerHTML = fixHtml(c);
  const sheet = w.querySelector(".fix-sheet");
  if (sheet) sheet.scrollTop = top;
}
function closeFix() {
  document.querySelector(".fix-wrap")?.remove();
  fixingCouponId = null;
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-fix-result]");
  if (open) {
    showFix(open.dataset.fixResult);
    return;
  }
  if (!fixingCouponId) return;
  if (e.target.closest("[data-fix-close]") || e.target.classList?.contains("fix-wrap")) {
    closeFix();
    return;
  }
  const c = db.coupons.find((x) => x.id === fixingCouponId);
  if (!c) return closeFix();
  const one = e.target.closest("[data-fix-key]");
  if (one) {
    setMarketStatus(one.dataset.fixKey, one.dataset.fixValue);
    showFix(c.id);
    return;
  }
  const all = e.target.closest("[data-fix-all]");
  if (all) {
    const keys = [...new Set(c.fixtures.flatMap((f) => f.markets.map((m) => marketKey(f, m))))];
    if (keys.length) setMarketStatus(keys.join("||"), all.dataset.fixAll);
    showFix(c.id);
    return;
  }
  if (e.target.closest("[data-fix-cashout]")) {
    c.cashoutGross = null;
    touchCoupon(c);
    save();
    renderAll();
    toast("Cash out quitado. El resultado vuelve a salir de los mercados.");
    showFix(c.id);
  }
});

// Botón en cada cupón guardado.
const renderCouponsFix = renderCoupons;
renderCoupons = function () {
  renderCouponsFix();
  document.querySelectorAll(".saved-coupon[data-coupon-id]").forEach((card) => {
    if (card.querySelector("[data-fix-result]")) return;
    const row = card.querySelector(".couponbody > .row");
    row?.insertAdjacentHTML(
      "afterbegin",
      '<button type="button" class="btn sm" data-fix-result="' +
        esc(card.dataset.couponId) +
        '">🛠 Corregir resultado</button>',
    );
  });
};
