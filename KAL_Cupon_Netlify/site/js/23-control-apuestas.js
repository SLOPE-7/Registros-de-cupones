// Control de apuestas (V16):
// 1) "Antes de guardar": probabilidad real del cupón (con tu historial y con la cuota), tamaño frente a tu límite,
//    partidos que ya están en otros cupones pendientes (exposición), selecciones de relleno, racha y presupuesto.
// 2) Gestión de banca: banca, unidad (% de la banca), máximo de selecciones y pausa tras una racha de pérdidas.
// 3) Diario: confianza de 1 a 5 y motivo en cada cupón, y su rendimiento en Estadísticas.
"use strict";

const BANKROLL_DEFAULTS = { monto: 0, unidadPct: 2, maxSel: 5, pausaTras: 3 };
function bankrollCfg() {
  return { ...BANKROLL_DEFAULTS, ...(db.settings?.banca || {}) };
}
function housesTotal() {
  return db.houses.reduce(
    (s, h) =>
      s +
      (Number(h.initial) || 0) +
      db.transactions.filter((t) => t.houseId === h.id).reduce((n, t) => n + (Number(t.delta) || 0), 0),
    0,
  );
}
// La banca es la que defines tú; si no, el total de tus casas.
function bankrollAmount() {
  const cfg = bankrollCfg();
  return Number(cfg.monto) > 0 ? Number(cfg.monto) : Math.max(0, housesTotal());
}
function unitStake() {
  const u = (bankrollAmount() * (Number(bankrollCfg().unidadPct) || 2)) / 100;
  return u >= 10 ? Math.round(u / 5) * 5 : Math.round(u * 100) / 100;
}
const CONFIDENCE_UNITS = { 1: 0.5, 2: 0.5, 3: 1, 4: 1.5, 5: 2 };
// Monto sugerido: unidades según la confianza; a la mitad si estás en racha de pérdidas.
function suggestedStake(confidence) {
  const unit = unitStake();
  if (!unit) return null;
  const units = CONFIDENCE_UNITS[confidence] || 1;
  const streak = lossStreak(),
    pause = streak >= (Number(bankrollCfg().pausaTras) || 3);
  const raw = unit * units * (pause ? 0.5 : 1);
  return {
    amount: raw >= 10 ? Math.round(raw / 5) * 5 : Math.round(raw * 100) / 100,
    units,
    pause,
    streak,
    unit,
  };
}

// ---------- Riesgo de un cupón ----------
let hitRateCache = null;
function marketHitRates() {
  if (hitRateCache && hitRateCache.n === db.coupons.length && hitRateCache.at > Date.now() - 5000)
    return hitRateCache.map;
  const map = new Map();
  analystMarketHistory().byType.forEach((r) => map.set(r.name, r));
  hitRateCache = { map, n: db.coupons.length, at: Date.now() };
  return map;
}
const matchPairKey = (f) => teamEventKey(f.home) + "|" + teamEventKey(f.away);
function legOdd(f, m) {
  if (m.builder) return null;
  const v = Number(String(m.odd || (f.markets.length === 1 ? f.totalOdds : "")).replace(",", "."));
  return v > 1 ? v : null;
}
function couponRisk(fixtures, { totalOdds = 0, excludeId = null } = {}) {
  const rates = marketHitRates();
  const legs = fixtures.reduce((s, f) => s + f.markets.length, 0);
  let pHist = 1,
    histKnown = 0;
  const filler = [];
  const smooth = (r) => (r.won + 1) / (r.n + 2);
  const clamp = (p) => Math.min(0.99, Math.max(0.01, p));
  fixtures.forEach((f) => {
    // Un BetBuilder es una sola apuesta: si no hay historial de todas sus selecciones, se usa su cuota de paquete.
    const builder = f.markets.filter((m) => m.builder),
      singles = f.markets.filter((m) => !m.builder);
    if (builder.length) {
      const hist = builder.map((m) => rates.get(marketCategory(m, f))).filter((r) => r && r.n >= 8);
      const b = Number(String(f.builderOdd || builder[0].builderOdd || "").replace(",", "."));
      if (hist.length === builder.length) {
        hist.forEach((r) => (pHist *= clamp(smooth(r))));
        histKnown += builder.length;
      } else if (b > 1) pHist *= clamp(1 / b);
      else pHist *= Math.pow(0.8, builder.length);
    }
    singles.forEach((m) => {
      const r = rates.get(marketCategory(m, f)),
        odd = legOdd(f, m);
      let p;
      if (r && r.n >= 8) {
        p = smooth(r);
        histKnown++;
      } else if (odd) p = 1 / odd;
      else p = r && r.n ? smooth(r) : 0.8;
      pHist *= clamp(p);
      if (odd && odd < 1.15) filler.push({ f, m, odd });
    });
  });
  let pOdds = null;
  if (totalOdds > 1) pOdds = 1 / totalOdds;
  else {
    let prod = 1,
      all = true;
    fixtures.forEach((f) => {
      if (f.markets.some((m) => m.builder)) {
        const b = Number(f.builderOdd);
        if (b > 1) prod *= b;
        else all = false;
      }
      f.markets
        .filter((m) => !m.builder)
        .forEach((m) => {
          const o = legOdd(f, m);
          if (o) prod *= o;
          else all = false;
        });
    });
    if (all && prod > 1) pOdds = 1 / prod;
  }
  // Exposición: el mismo partido en otros cupones pendientes.
  const keys = new Map(fixtures.map((f) => [matchPairKey(f), f]));
  const exposure = new Map();
  db.coupons.forEach((c) => {
    if (c.id === excludeId || calcCoupon(c).status !== "pending") return;
    c.fixtures.forEach((f) => {
      const k = matchPairKey(f);
      if (!keys.has(k)) return;
      if (!exposure.has(k)) exposure.set(k, { f: keys.get(k), coupons: [], stake: 0 });
      const e = exposure.get(k);
      if (!e.coupons.includes(c)) {
        e.coupons.push(c);
        e.stake += Number(c.stake) || 0;
      }
    });
  });
  // Cómo te ha ido con cupones de este tamaño.
  const band = sizeBand(legs);
  let bandN = 0,
    bandWon = 0;
  db.coupons.forEach((c) => {
    const s = calcCoupon(c).status;
    if ((s === "won" || s === "lost") && sizeBand(couponLegs(c)) === band) {
      bandN++;
      if (s === "won") bandWon++;
    }
  });
  return {
    legs,
    pHist: legs ? pHist : null,
    histKnown,
    pOdds,
    filler,
    exposure: [...exposure.values()],
    band: { name: band, n: bandN, won: bandWon },
  };
}

function riskLevel(r, cfg) {
  let score = 0;
  if (r.legs > cfg.maxSel) score += 2;
  if (r.exposure.length) score += 1;
  if (r.filler.length) score += 1;
  if (r.pHist !== null && r.pHist < 0.25) score += 2;
  else if (r.pHist !== null && r.pHist < 0.45) score += 1;
  return score >= 4 ? "high" : score >= 2 ? "mid" : "low";
}
const pctTxt = (p) => (p == null ? "—" : (p < 0.01 ? "<1" : Math.round(p * 100)) + " %");

// Tarjeta en "Nuevo cupón".
function renderRiskBox() {
  const el = $("riskBox");
  if (!el) return;
  if (!draftSelections.length) {
    el.innerHTML = "";
    return;
  }
  const cfg = bankrollCfg();
  const r = couponRisk(draftSelections, {
    totalOdds: Number($("totalOdds")?.value) || 0,
    excludeId: editingCouponId,
  });
  const conf = Number($("couponConfidence")?.value) || 0;
  const sug = suggestedStake(conf || 3);
  const stake = Number($("stake")?.value) || 0;
  const items = [];
  if (r.legs > cfg.maxSel)
    items.push([
      "bad",
      "🔢",
      "<b>" +
        r.legs +
        " selecciones</b>: tu límite es " +
        cfg.maxSel +
        "." +
        (r.band.n
          ? " Con cupones de " + esc(r.band.name) + " has ganado " + r.band.won + " de " + r.band.n + "."
          : ""),
    ]);
  else if (r.band.n >= 3)
    items.push([
      r.band.won / r.band.n >= 0.4 ? "ok" : "warn",
      "🔢",
      "Con cupones de " +
        esc(r.band.name) +
        " selecciones has ganado " +
        r.band.won +
        " de " +
        r.band.n +
        ".",
    ]);
  r.exposure.forEach((e) =>
    items.push([
      "warn",
      "🔗",
      "<b>" +
        esc(e.f.home + " vs " + e.f.away) +
        "</b> ya está en " +
        e.coupons.length +
        " cupón(es) pendiente(s) (" +
        money(e.stake) +
        "). Si falla, caen todos a la vez.",
    ]),
  );
  if (r.filler.length)
    items.push([
      "warn",
      "🪶",
      r.filler.length +
        " selección(es) de relleno (cuota menor que 1.15): " +
        r.filler
          .slice(0, 3)
          .map((x) => esc(x.f.home + " " + (x.m.pick || x.m.market)) + " @ " + x.odd)
          .join(", ") +
        ". Suben muy poco la cuota y añaden riesgo.",
    ]);
  if (sug?.pause)
    items.push([
      "bad",
      "⏸",
      "Llevas <b>" +
        sug.streak +
        " cupones perdidos seguidos</b>. Pausa sugerida: hoy apuesta media unidad o descansa.",
    ]);
  const budget = Number(db.settings?.budget) || 0;
  if (budget) {
    const left = budget - monthSpent() - (editingCouponId ? 0 : stake);
    if (left < 0)
      items.push(["bad", "💰", "Con este cupón te pasas del presupuesto del mes por " + money(-left) + "."]);
  }
  if (sug && stake > sug.amount * 1.5)
    items.push([
      "warn",
      "⚖️",
      "El importe (" + money(stake) + ") es mayor que el sugerido para tu banca (" + money(sug.amount) + ").",
    ]);
  const level = riskLevel(r, cfg);
  el.innerHTML =
    '<section class="risk-card is-' +
    level +
    '"><div class="risk-head"><b>' +
    (level === "high"
      ? "🛑 Cupón de alto riesgo"
      : level === "mid"
        ? "⚠️ Revisa antes de guardar"
        : "✅ Cupón razonable") +
    '</b><span class="small muted">' +
    r.legs +
    " selecci" +
    (r.legs === 1 ? "ón" : "ones") +
    '</span></div><div class="risk-probs"><div><strong>' +
    pctTxt(r.pHist) +
    "</strong><small>" +
    (r.histKnown === 0
      ? "Probabilidad estimada (aún sin historial de estos mercados)"
      : "Probabilidad según tu historial" +
        (r.histKnown < r.legs ? " (" + r.histKnown + " de " + r.legs + " con datos)" : "")) +
    "</small></div><div><strong>" +
    pctTxt(r.pOdds) +
    "</strong><small>Según la cuota (incluye el margen de la casa)</small></div></div>" +
    (items.length
      ? '<ul class="risk-list">' +
        items
          .map(
            ([k, icon, t]) => '<li class="is-' + k + '"><span>' + icon + "</span><div>" + t + "</div></li>",
          )
          .join("") +
        "</ul>"
      : "") +
    (sug
      ? '<div class="risk-stake"><span>Monto sugerido' +
        (conf ? " (confianza " + conf + ")" : "") +
        ": <b>" +
        money(sug.amount) +
        "</b><small>1 unidad = " +
        money(sug.unit) +
        " (" +
        cfg.unidadPct +
        " % de " +
        money(bankrollAmount()) +
        ')</small></span><button type="button" class="btn sm" data-use-stake="' +
        sug.amount +
        '">Usar</button></div>'
      : '<div class="risk-stake"><span class="small muted">Define tu banca en Ajustes → Gestión de banca para ver el monto sugerido.</span></div>') +
    "</section>";
}

// ---------- Diario: confianza y motivo ----------
function renderConfidencePicker() {
  const el = $("confidencePicker");
  if (!el) return;
  const v = Number($("couponConfidence").value) || 0;
  el.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        '<button type="button" class="chip conf-chip' +
        (n === v ? " active" : "") +
        '" data-confidence="' +
        n +
        '" aria-pressed="' +
        (n === v) +
        '">' +
        n +
        "</button>",
    )
    .join("");
}
function setConfidence(v) {
  $("couponConfidence").value = v ? String(v) : "";
  renderConfidencePicker();
  renderRiskBox();
}
const CONF_LABELS = { 1: "Muy baja", 2: "Baja", 3: "Media", 4: "Alta", 5: "Muy alta" };
function confidenceRows(coupons) {
  const g = new Map();
  coupons.forEach(({ c, r }) => {
    const k = Number(c.confidence) || 0;
    if (!k || (r.status !== "won" && r.status !== "lost")) return;
    if (!g.has(k)) g.set(k, { k, n: 0, won: 0, stake: 0, net: 0 });
    const x = g.get(k);
    x.n++;
    if (r.status === "won") x.won++;
    x.stake += Number(c.stake) || 0;
    x.net += Number(r.net) || 0;
  });
  return [...g.values()].sort((a, b) => b.k - a.k);
}
function confidenceHtml(coupons) {
  const rows = confidenceRows(coupons);
  if (!rows.length)
    return '<div class="empty small">Marca tu confianza (1 a 5) al guardar cupones y aquí verás si tu intuición acierta.</div>';
  return (
    '<div class="perf-houses">' +
    rows
      .map(
        (x) =>
          '<div class="perf-house"><b>Confianza ' +
          x.k +
          " · " +
          CONF_LABELS[x.k] +
          "</b><small>" +
          x.n +
          " cupones · " +
          x.won +
          " ganados (" +
          Math.round((x.won / x.n) * 100) +
          ' %)</small><span class="' +
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

// ---------- Ajustes: gestión de banca ----------
function renderBankrollBox() {
  const el = $("bankrollBox");
  if (!el) return;
  const cfg = bankrollCfg();
  el.innerHTML =
    '<p class="small muted">Apostar siempre una parte fija de tu banca es lo que protege tu dinero en las rachas malas.</p>' +
    '<div class="row"><div class="field"><label for="brAmount">Banca (L)</label><input class="input" id="brAmount" type="number" min="0" step="1" inputmode="decimal" placeholder="Total de tus casas: ' +
    esc(money(Math.max(0, housesTotal()))) +
    '" value="' +
    (Number(cfg.monto) > 0 ? esc(cfg.monto) : "") +
    '"></div><div class="field"><label for="brUnit">Unidad (% de la banca)</label><input class="input" id="brUnit" type="number" min="0.5" max="10" step="0.5" inputmode="decimal" value="' +
    esc(cfg.unidadPct) +
    '"></div></div><div class="row"><div class="field"><label for="brMax">Máximo de selecciones por cupón</label><input class="input" id="brMax" type="number" min="1" max="30" step="1" inputmode="numeric" value="' +
    esc(cfg.maxSel) +
    '"></div><div class="field"><label for="brPause">Pausa tras N cupones perdidos seguidos</label><input class="input" id="brPause" type="number" min="2" max="10" step="1" inputmode="numeric" value="' +
    esc(cfg.pausaTras) +
    '"></div></div><p class="small">1 unidad = <b>' +
    money(unitStake()) +
    "</b> · confianza 1–2: ½ unidad · 3: 1 · 4: 1½ · 5: 2 unidades.</p>" +
    '<button type="button" class="btn gold" data-bankroll-save>Guardar</button>';
}
function saveBankroll() {
  const num = (id, min, max, def) => {
    const v = Number($(id).value);
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  };
  db.settings = {
    ...(db.settings || {}),
    banca: {
      monto: num("brAmount", 0, 1e9, 0),
      unidadPct: num("brUnit", 0.5, 10, 2),
      maxSel: Math.round(num("brMax", 1, 30, 5)),
      pausaTras: Math.round(num("brPause", 2, 10, 3)),
    },
    updatedAt: new Date().toISOString(),
  };
  save();
  if (typeof queueCloudSync === "function") queueCloudSync();
  renderBankrollBox();
  toast("Gestión de banca guardada.");
}

// ---------- Resumen de la semana (últimos 7 días) ----------
function weekSummary(now = Date.now()) {
  const since = now - 7 * 86400000;
  const when = (c) => Date.parse(c.updated || c.created) || 0;
  const items = db.coupons
    .map((c) => ({ c, r: calcCoupon(c) }))
    .filter((x) => x.r.status !== "pending" && when(x.c) >= since);
  const cfg = bankrollCfg(),
    unit = unitStake();
  const won = items.filter((x) => x.r.status === "won").length,
    lost = items.filter((x) => x.r.status === "lost").length,
    stake = items.reduce((s, x) => s + (Number(x.c.stake) || 0), 0),
    net = items.reduce((s, x) => s + (Number(x.r.net) || 0), 0);
  const cats = new Map();
  items.forEach(({ c }) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (m.settlement !== "won" && m.settlement !== "lost") return;
        const k = marketCategory(m, f);
        if (!cats.has(k)) cats.set(k, { tipo: k, ganados: 0, perdidos: 0 });
        cats.get(k)[m.settlement === "won" ? "ganados" : "perdidos"]++;
      }),
    ),
  );
  // Partidos repetidos en varios cupones de la semana
  const seenMatch = new Map();
  items.forEach(({ c }) =>
    c.fixtures.forEach((f) => {
      const k = matchPairKey(f);
      seenMatch.set(k, (seenMatch.get(k) || 0) + 1);
    }),
  );
  const legs = items.map(({ c }) => couponLegs(c));
  return {
    cupones: items.length,
    ganados: won,
    perdidos: lost,
    apostado: r2(stake),
    neto: r2(net),
    roi: stake ? r2(net / stake) : null,
    seleccionesMedias: legs.length ? r2(legs.reduce((a, b) => a + b, 0) / legs.length) : null,
    sobreLimite: legs.filter((n) => n > cfg.maxSel).length,
    partidosRepetidos: [...seenMatch.values()].filter((n) => n > 1).length,
    montosAltos: unit ? items.filter(({ c }) => (Number(c.stake) || 0) > unit * 2).length : null,
    porMercado: [...cats.values()].sort((a, b) => b.ganados + b.perdidos - (a.ganados + a.perdidos)),
  };
}
function renderWeekCard() {
  const el = $("weekCard");
  if (!el) return;
  const w = weekSummary();
  if (!w.cupones) {
    el.innerHTML = "";
    return;
  }
  const best = w.porMercado
    .filter((x) => x.ganados + x.perdidos >= 3)
    .sort((a, b) => b.ganados / (b.ganados + b.perdidos) - a.ganados / (a.ganados + a.perdidos))[0];
  const warns = [];
  if (w.sobreLimite) warns.push(w.sobreLimite + " cupón(es) por encima de tu límite de selecciones");
  if (w.partidosRepetidos) warns.push(w.partidosRepetidos + " partido(s) repetidos en varios cupones");
  if (w.montosAltos) warns.push(w.montosAltos + " monto(s) de más de 2 unidades");
  el.innerHTML =
    '<section class="panel week-card"><div class="ph"><h2>📅 Tus últimos 7 días</h2><button type="button" class="btn sm" data-week-analyst>🤖 Analizar</button></div><div class="pb"><div class="stats mini-stats"><div class="stat"><strong>' +
    w.cupones +
    '</strong><span>Cupones</span></div><div class="stat"><strong>' +
    w.ganados +
    " / " +
    w.perdidos +
    '</strong><span>Ganados / perdidos</span></div><div class="stat"><strong class="' +
    (w.neto >= 0 ? "gain" : "loss") +
    '">' +
    signed(w.neto) +
    "</strong><span>Resultado" +
    (w.roi != null ? " · ROI " + spct(w.roi) : "") +
    "</span></div></div>" +
    (best
      ? '<p class="small">✅ Lo mejor: <b>' +
        esc(best.tipo) +
        "</b> (" +
        best.ganados +
        " de " +
        (best.ganados + best.perdidos) +
        ").</p>"
      : "") +
    (warns.length ? '<p class="small week-warn">⚠️ ' + esc(warns.join(" · ")) + ".</p>" : "") +
    "</div></section>";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-week-analyst]")) return;
  go("analyst");
  requestAnimationFrame(() => $("analystOut-semana")?.closest("section")?.scrollIntoView({ block: "start" }));
});
// Datos de riesgo de un cupón en texto (para la revisión del Analista).
function riskForText(text, excludeId = null) {
  try {
    const p = parseCoupon(text);
    if (!p.fixtures?.length) return null;
    return riskSummary(couponRisk(p.fixtures, { totalOdds: Number(p.meta?.odds) || 0, excludeId }));
  } catch {
    return null;
  }
}
function riskSummary(r) {
  {
    return {
      selecciones: r.legs,
      limiteSelecciones: bankrollCfg().maxSel,
      probabilidadSegunHistorial: r.pHist != null ? r2(r.pHist) : null,
      mercadosConHistorial: r.histKnown,
      probabilidadSegunCuota: r.pOdds != null ? r2(r.pOdds) : null,
      relleno: r.filler.map(
        (x) => x.f.home + " vs " + x.f.away + " · " + (x.m.pick || x.m.market) + " @ " + x.odd,
      ),
      repetidosEnOtrosCupones: r.exposure.map((e) => ({
        partido: e.f.home + " vs " + e.f.away,
        cupones: e.coupons.length,
      })),
      historialMismoTamano: r.band.n ? { tamano: r.band.name, cupones: r.band.n, ganados: r.band.won } : null,
      rachaPerdidos: lossStreak(),
    };
  }
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-confidence]");
  if (c) {
    const v = Number(c.dataset.confidence);
    setConfidence(Number($("couponConfidence").value) === v ? 0 : v);
    return;
  }
  const u = e.target.closest("[data-use-stake]");
  if (u) {
    $("stake").value = u.dataset.useStake;
    $("stake").dispatchEvent(new Event("input"));
    return;
  }
  if (e.target.closest("[data-bankroll-save]")) saveBankroll();
});
["stake", "totalOdds"].forEach((id) => $(id)?.addEventListener("input", renderRiskBox));

// Cupón antes de apostar: los campos que faltan se resaltan hasta que se completan.
document.addEventListener("input", (e) => {
  if (e.target.classList?.contains("need-input") && String(e.target.value).trim())
    e.target.classList.remove("need-input");
});
function clearSlipHint() {
  if ($("slipHint")) $("slipHint").innerHTML = "";
  if ($("previewAnalystOut") && !analystBusy) $("previewAnalystOut").innerHTML = "";
  ["stake", "totalOdds", "bonus", "payout"].forEach((id) => $(id)?.classList.remove("need-input"));
}
