// Valor de la cuota (V16):
// - Cuota de cierre por mercado (la que había justo antes del partido) y "CLV": cuánto mejor fue tu cuota.
//   Apostar de forma constante por encima del cierre es la señal más fiable de que tienes ventaja.
// - Calculadora de valor: con las cuotas de una casa de referencia (de margen bajo) se quita el margen y se
//   obtiene la probabilidad justa; se compara con tu cuota y con la de tus casas (comparador).
"use strict";

const toOdd = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return n > 1 ? n : null;
};
const clvOf = (odd, close) => (odd > 1 && close > 1 ? odd / close - 1 : null);
const signedPct = (v) => (v >= 0 ? "+" : "−") + Math.abs(Math.round(v * 100)) + " %";

// ---------- Cuota de cierre en la ficha del partido ----------
function closeOddHtml(x, odd) {
  if (x.m.builder || !(odd > 1) || currentMatchRef?.draft) return "";
  const c = toOdd(x.m.closeOdd),
    v = clvOf(odd, c);
  return (
    '<div class="mk-clv">' +
    (c
      ? '<span class="clv-chip ' +
        (v >= 0 ? "pos" : "neg") +
        '" title="Valor frente a la cuota de cierre">Cierre ' +
        c.toFixed(2) +
        " · " +
        signedPct(v) +
        "</span>"
      : '<span class="small muted">¿A cuánto cerró esta cuota?</span>') +
    '<button type="button" class="btn sm" data-close-odd="' +
    esc(x.key) +
    '">' +
    (c ? "✎ Cierre" : "＋ Cuota de cierre") +
    "</button></div>"
  );
}
function setCloseOdd(key) {
  let current = "";
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (marketKey(f, m) === key && m.closeOdd) current = m.closeOdd;
      }),
    ),
  );
  const ans = prompt(
    "Cuota de este mercado justo antes de empezar el partido (cierre). Vacío para borrar:",
    current,
  );
  if (ans === null) return;
  const v = toOdd(ans);
  if (ans.trim() && !v) return toast("Escribe una cuota válida, por ejemplo 1.85.");
  let n = 0;
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (marketKey(f, m) !== key) return;
        if (v) m.closeOdd = v;
        else delete m.closeOdd;
        n++;
        touchCoupon(c);
      }),
    ),
  );
  if (!n) return;
  save();
  if (typeof queueCloudSync === "function") queueCloudSync();
  if (currentMatchRef) renderMatchDetail(currentMatchRef);
  toast(v ? "Cuota de cierre guardada." : "Cuota de cierre borrada.");
}

// ---------- CLV en Estadísticas y para el Analista ----------
function clvStats() {
  const seen = new Set(),
    rows = [];
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        const k = marketKey(f, m);
        if (seen.has(k) || m.builder) return;
        const odd = legOdd(f, m),
          close = toOdd(m.closeOdd);
        if (!odd || !close) return;
        seen.add(k);
        rows.push({ v: clvOf(odd, close), m, f });
      }),
    ),
  );
  if (!rows.length) return null;
  const avg = rows.reduce((s, r) => s + r.v, 0) / rows.length;
  return { n: rows.length, avg, beat: rows.filter((r) => r.v > 0).length };
}
function clvHtml() {
  const s = clvStats();
  if (!s)
    return '<div class="empty small">Abre un partido y toca “＋ Cuota de cierre” en tus mercados (la cuota justo antes de empezar). Con 20 o más verás si apuestas con ventaja.</div>';
  return (
    '<div class="stats clv-stats"><div class="stat"><strong class="' +
    (s.avg >= 0 ? "gain" : "loss") +
    '">' +
    signedPct(s.avg) +
    '</strong><span>Valor medio frente al cierre</span></div><div class="stat"><strong>' +
    Math.round((s.beat / s.n) * 100) +
    ' %</strong><span>Apuestas mejores que el cierre</span></div><div class="stat"><strong>' +
    s.n +
    '</strong><span>Mercados con cierre</span></div></div><p class="small muted">' +
    (s.n < 20
      ? "Aún son pocos datos; con 20 o más el resultado es más fiable."
      : s.avg > 0.02
        ? "Consigues cuotas mejores que el cierre: es la señal más fiable de que tus picks tienen valor, aunque una racha salga mal."
        : s.avg < -0.02
          ? "Tus cuotas suelen ser peores que el cierre: apuesta más temprano o compara casas antes de apostar."
          : "Apuestas más o menos al precio de cierre: sin ventaja clara por ahora.") +
    "</p>"
  );
}

// ---------- Calculadora de valor y comparador de casas ----------
function renderValueCalc(force = false) {
  const el = $("valueCalc");
  if (!el || (el.dataset.ready && !force)) return;
  el.dataset.ready = "1";
  el.innerHTML =
    '<section class="panel value-card"><div class="ph"><div><h2>🧮 Calculadora de valor</h2><div class="marketmeta">¿La cuota que te dan vale la pena? Compárala con una casa de margen bajo y con tus otras casas</div></div></div><div class="pb">' +
    '<div class="row"><div class="field"><label for="vcOdd">Tu cuota</label><input class="input" id="vcOdd" inputmode="decimal" placeholder="Ej. 2.10"></div>' +
    '<div class="field"><label for="vcRef">Cuotas de referencia del mercado (la tuya primero)</label><input class="input" id="vcRef" inputmode="decimal" placeholder="Ej. 1.95 3.60 4.20"></div></div>' +
    '<p class="small muted">Referencia: las cuotas de todas las opciones del mismo mercado en una casa de margen bajo (por ejemplo Pinnacle). 1X2: tres cuotas; más/menos o ambos marcan: dos.</p>' +
    (db.houses.length
      ? '<div class="field"><label>Cuotas en tus casas (opcional)</label><div class="vc-houses">' +
        db.houses
          .map(
            (h) =>
              '<label class="vc-house"><span>' +
              esc(h.name) +
              '</span><input class="input" data-vc-house="' +
              esc(h.id) +
              '" inputmode="decimal" placeholder="—"></label>',
          )
          .join("") +
        "</div></div>"
      : "") +
    '<div id="vcResult" class="vc-result" aria-live="polite"></div></div></section>';
  updateValueCalc();
}
function parseOddsList(s) {
  return String(s || "")
    .split(/[\s;/|]+/)
    .map(toOdd)
    .filter(Boolean);
}
function valueCalc({ odd, ref = [], houses = [] }) {
  const quotes = houses.filter((h) => h.odd);
  const best = quotes.reduce((b, h) => (!b || h.odd > b.odd ? h : b), null);
  const use = Math.max(odd || 0, best?.odd || 0) || null;
  const out = { use, best, quotes };
  if (ref.length >= 2) {
    const inv = ref.map((r) => 1 / r),
      sum = inv.reduce((a, b) => a + b, 0);
    out.margin = sum - 1;
    out.fairP = inv[0] / sum;
    out.fairOdd = 1 / out.fairP;
    if (use) {
      out.ev = out.fairP * use - 1;
      const kelly = (out.fairP * use - 1) / (use - 1);
      out.kellyQuarter = kelly > 0 ? kelly / 4 : 0;
    }
  }
  return out;
}
function updateValueCalc() {
  const el = $("vcResult");
  if (!el) return;
  const houses = [...document.querySelectorAll("[data-vc-house]")].map((i) => ({
    name: db.houses.find((h) => h.id === i.dataset.vcHouse)?.name || "",
    odd: toOdd(i.value),
  }));
  const r = valueCalc({ odd: toOdd($("vcOdd").value), ref: parseOddsList($("vcRef").value), houses });
  const parts = [];
  if (r.quotes.length >= 2) {
    const worst = r.quotes.reduce((w, h) => (!w || h.odd < w.odd ? h : w), null);
    parts.push(
      '<div class="vc-line">🏆 Mejor cuota: <b>' +
        esc(r.best.name) +
        " " +
        r.best.odd.toFixed(2) +
        "</b>" +
        (worst.odd < r.best.odd
          ? " · " + Math.round((r.best.odd / worst.odd - 1) * 100) + " % más que " + esc(worst.name)
          : "") +
        "</div>",
    );
  }
  if (r.fairP != null) {
    parts.push(
      '<div class="vc-line">Margen de la referencia: ' +
        (r.margin * 100).toFixed(1) +
        " % · Probabilidad justa: <b>" +
        (r.fairP * 100).toFixed(1) +
        " %</b> · Cuota justa: <b>" +
        r.fairOdd.toFixed(2) +
        "</b></div>",
    );
    if (r.use) {
      const verdict =
        r.ev > 0.02
          ? ["good", "✅ Tiene valor"]
          : r.ev < -0.02
            ? ["bad", "❌ Sin valor: la casa paga menos de lo justo"]
            : ["mid", "≈ Cuota justa, sin ventaja"];
      const unit = unitStake();
      const kellyAmt = r.kellyQuarter * bankrollAmount();
      parts.push(
        '<div class="vc-verdict is-' +
          verdict[0] +
          '"><b>' +
          verdict[1] +
          "</b><span>Valor esperado con " +
          r.use.toFixed(2) +
          ": <b>" +
          signedPct(r.ev) +
          "</b> por cada lempira apostado</span>" +
          (r.kellyQuarter > 0 && bankrollAmount()
            ? "<small>Monto prudente (¼ de Kelly): " +
              money(unit ? Math.min(kellyAmt, unit * 2) : kellyAmt) +
              (unit && kellyAmt > unit * 2 ? " (limitado a 2 unidades)" : "") +
              "</small>"
            : "") +
          "</div>",
      );
    }
  } else if (r.use) {
    parts.push(
      '<div class="vc-line">Probabilidad que implica ' +
        r.use.toFixed(2) +
        ": <b>" +
        Math.round(100 / r.use) +
        " %</b> (con el margen de la casa). Añade las cuotas de referencia para saber si tiene valor.</div>",
    );
  }
  el.innerHTML = parts.join("") || '<div class="small muted">Escribe una cuota para empezar.</div>';
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-close-odd]");
  if (b) setCloseOdd(b.dataset.closeOdd);
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#valueCalc")) updateValueCalc();
});
