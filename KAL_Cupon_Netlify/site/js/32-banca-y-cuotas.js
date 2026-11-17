// V19 · Salud de la banca (caída máxima, rachas, yield) y convertidor de cuotas.
// Módulo independiente: se engancha al final de renderPerformance() y no modifica nada existente.

function bankHealth() {
  const rows = db.coupons
    .map((c) => ({ c, r: calcCoupon(c) }))
    .filter((x) => x.r.status !== "pending" && x.r.net !== null)
    .sort((a, b) => String(a.c.created).localeCompare(String(b.c.created)));
  if (!rows.length) return null;
  let run = 0,
    peak = 0,
    maxDd = 0,
    stake = 0,
    cur = 0,
    curType = "",
    bestWin = 0,
    worstLoss = 0;
  rows.forEach((x) => {
    const net = Number(x.r.net) || 0;
    run += net;
    peak = Math.max(peak, run);
    maxDd = Math.max(maxDd, peak - run);
    stake += Number(x.c.stake) || 0;
    const t = x.r.status === "won" ? "w" : x.r.status === "lost" ? "l" : "";
    if (!t) return;
    if (t === curType) cur++;
    else {
      curType = t;
      cur = 1;
    }
    if (t === "w") bestWin = Math.max(bestWin, cur);
    else worstLoss = Math.max(worstLoss, cur);
  });
  const lastTwenty = rows.slice(-20),
    last20 = lastTwenty.reduce((s, x) => s + (Number(x.r.net) || 0), 0),
    last20Stake = lastTwenty.reduce((s, x) => s + (Number(x.c.stake) || 0), 0);
  return {
    n: rows.length,
    net: run,
    yieldPct: stake ? run / stake : null,
    maxDd,
    underPeak: peak - run,
    bestWin,
    worstLoss,
    cur: curType ? { type: curType, n: cur } : null,
    last20Yield: last20Stake ? last20 / last20Stake : null,
  };
}
function bankHealthHtml() {
  const h = bankHealth();
  if (!h) return '<div class="empty small">Liquida algún cupón para ver la salud de tu banca.</div>';
  const cell = (label, val, cls) =>
    '<div class="bh-cell"><small>' +
    label +
    "</small><b" +
    (cls ? ' class="' + cls + '"' : "") +
    ">" +
    val +
    "</b></div>";
  return (
    '<div class="bh-grid">' +
    cell(
      "Yield (neto ÷ apostado)",
      h.yieldPct == null ? "—" : spct(h.yieldPct),
      h.net >= 0 ? "gain" : "loss",
    ) +
    cell(
      "Últimos 20 cupones",
      h.last20Yield == null ? "—" : spct(h.last20Yield),
      h.last20Yield >= 0 ? "gain" : "loss",
    ) +
    cell("Caída máxima", money(h.maxDd), h.maxDd ? "loss" : "") +
    cell("Ahora bajo tu máximo", money(h.underPeak), h.underPeak ? "loss" : "gain") +
    cell("Mejor racha ganando", h.bestWin + " seguidos") +
    cell("Peor racha perdiendo", h.worstLoss + " seguidos") +
    "</div>" +
    (h.cur
      ? '<p class="small muted">Racha actual: ' +
        h.cur.n +
        (h.cur.type === "w" ? " ganado(s)" : " perdido(s)") +
        " seguidos.</p>"
      : "") +
    '<p class="small muted">La caída máxima es lo más que has llegado a perder desde tu mejor momento: sirve para dimensionar tu banca.</p>'
  );
}

// ---------- Convertidor de cuotas ----------
function parseOddsInput(txt, fmt) {
  const t = String(txt).trim().replace(",", ".");
  if (!t) return null;
  let dec = null;
  if (fmt === "dec") dec = parseFloat(t);
  else if (fmt === "us") {
    const v = parseFloat(t);
    if (!v || Math.abs(v) < 100) return null;
    dec = v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v);
  } else if (fmt === "frac") {
    const m = t.match(/^(\d+(?:\.\d+)?)\s*[\/-]\s*(\d+(?:\.\d+)?)$/);
    if (!m || !Number(m[2])) return null;
    dec = 1 + Number(m[1]) / Number(m[2]);
  } else if (fmt === "prob") {
    const p = parseFloat(t.replace("%", "")) / 100;
    if (!(p > 0 && p < 1)) return null;
    dec = 1 / p;
  }
  return dec && dec > 1 && isFinite(dec) ? dec : null;
}
function oddsAll(dec) {
  const us = dec >= 2 ? "+" + Math.round((dec - 1) * 100) : "−" + Math.round(100 / (dec - 1));
  // fracción simple aproximada (denominadores habituales)
  let best = { n: Math.round((dec - 1) * 10), d: 10, err: 9 };
  [1, 2, 3, 4, 5, 6, 8, 10, 20].forEach((d) => {
    const n = Math.round((dec - 1) * d),
      err = Math.abs(n / d - (dec - 1));
    if (n > 0 && err < best.err - 1e-9) best = { n, d, err };
  });
  return {
    dec: dec.toFixed(2),
    us,
    frac: best.n + "/" + best.d,
    prob: Math.round((1 / dec) * 1000) / 10 + " %",
  };
}
function marginHtml() {
  const v = ["mgA", "mgB", "mgC"].map((id) => parseOddsInput(($(id) || {}).value || "", "dec"));
  const real = v.filter(Boolean);
  if (real.length < 2)
    return "Escribe 2 cuotas (local–visitante) o 3 (local–empate–visitante) para ver el margen de la casa.";
  const sum = real.reduce((s, d) => s + 1 / d, 0),
    margin = sum - 1;
  return (
    "Margen de la casa: <b>" +
    (margin * 100).toFixed(1) +
    " %</b>. Probabilidades reales (sin margen): " +
    real.map((d) => ((1 / d / sum) * 100).toFixed(1) + " %").join(" · ") +
    "."
  );
}
function oddsToolHtml() {
  return (
    '<div class="odds-tool"><div class="odds-row"><select id="oddsFmt" aria-label="Formato">' +
    '<option value="dec">Decimal (1.85)</option><option value="us">Americana (−120 / +150)</option>' +
    '<option value="frac">Fraccional (5/4)</option><option value="prob">Probabilidad (54 %)</option></select>' +
    '<input id="oddsIn" inputmode="decimal" placeholder="Escribe la cuota" aria-label="Cuota"></div>' +
    '<div id="oddsOut" class="small muted">Elige formato y escribe una cuota.</div>' +
    '<h4 class="small">Margen de la casa en un partido</h4>' +
    '<div class="odds-row"><input id="mgA" inputmode="decimal" placeholder="Local"><input id="mgB" inputmode="decimal" placeholder="Empate"><input id="mgC" inputmode="decimal" placeholder="Visitante"></div>' +
    '<div id="mgOut" class="small muted">' +
    marginHtml() +
    "</div></div>"
  );
}
function renderOddsOut() {
  const out = $("oddsOut");
  if (!out) return;
  const dec = parseOddsInput($("oddsIn").value, $("oddsFmt").value);
  if (!dec) {
    out.innerHTML = $("oddsIn").value.trim()
      ? "No entiendo esa cuota para el formato elegido."
      : "Elige formato y escribe una cuota.";
    return;
  }
  const o = oddsAll(dec);
  out.innerHTML =
    "<b>Decimal " +
    o.dec +
    "</b> · Americana " +
    o.us +
    " · Fraccional ≈ " +
    o.frac +
    " · Probabilidad implícita " +
    o.prob;
}
document.addEventListener("input", (e) => {
  if (e.target.id === "oddsIn" || e.target.id === "oddsFmt") renderOddsOut();
  else if (/^mg[ABC]$/.test(e.target.id)) $("mgOut").innerHTML = marginHtml();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "oddsFmt") renderOddsOut();
});

// ---------- Enganche en Estadísticas ----------
const renderPerformanceBase = renderPerformance;
renderPerformance = function () {
  renderPerformanceBase();
  const el = $("perfSection");
  if (!el || el.querySelector("#bankHealth")) return;
  el.insertAdjacentHTML(
    "beforeend",
    '<section class="perf-block" id="bankHealth"><h3>🩺 Salud de tu banca</h3>' +
      bankHealthHtml() +
      '</section><section class="perf-block" id="oddsToolBlock"><h3>🧮 Convertidor de cuotas</h3>' +
      oddsToolHtml() +
      "</section>",
  );
};
