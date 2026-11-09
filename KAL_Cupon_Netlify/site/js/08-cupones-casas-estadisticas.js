// Mis cupones, casas y balances, informes, estadísticas de rendimiento y panel de Inicio.
"use strict";
let couponFilter = "pending";
const COUPON_PAGE = 30;
let couponLimit = COUPON_PAGE;
const COUPON_FILTERS = [
  ["pending", "Pendientes"],
  ["won", "Ganados"],
  ["lost", "Perdidos"],
  ["closed", "Nulos / cash out"],
  ["all", "Todos"],
];
function couponMatchesFilter(c, f) {
  const s = calcCoupon(c).status;
  return f === "all" || (f === "closed" ? s === "void" || s === "cashout" : s === f);
}
function renderCoupons() {
  const el = $("couponList"),
    bar = $("couponFilter");
  if (bar)
    bar.innerHTML = COUPON_FILTERS.map(([k, l]) => {
      const n = db.coupons.filter((c) => couponMatchesFilter(c, k)).length;
      return (
        '<button type="button" class="chip' +
        (couponFilter === k ? " active" : "") +
        '" data-coupon-filter="' +
        k +
        '">' +
        l +
        " <b>" +
        n +
        "</b></button>"
      );
    }).join("");
  const list = db.coupons.filter((c) => couponMatchesFilter(c, couponFilter));
  if (db.coupons.length && !list.length) {
    el.innerHTML =
      '<div class="empty"><strong>' +
      (couponFilter === "pending" ? "No tienes cupones pendientes" : "No hay cupones en esta lista") +
      "</strong>" +
      (couponFilter === "pending"
        ? "Los ganados, perdidos y anulados quedan archivados en sus pestañas."
        : "") +
      "</div>";
    return;
  }
  el.innerHTML = db.coupons.length
    ? list
        .slice(0, couponLimit)
        .map((c) => {
          const r = calcCoupon(c),
            house = db.houses.find((h) => h.id === c.houseId),
            label =
              { pending: "Pendiente", won: "Ganado", lost: "Perdido", void: "Anulado", cashout: "Cash out" }[
                r.status
              ] || "Pendiente",
            matches = c.fixtures
              .map(
                (f, fi) =>
                  '<button type="button" class="saved-fixture" data-open-saved-match="' +
                  esc(c.id) +
                  '" data-fixture-index="' +
                  fi +
                  '" title="Ver partido y mercados">' +
                  crestHTML(f.homeCrest, f.home) +
                  "<b>" +
                  esc(f.home) +
                  "</b><span>vs</span><b>" +
                  esc(f.away) +
                  "</b>" +
                  crestHTML(f.awayCrest, f.away) +
                  "<small>" +
                  esc(f.competition || f.league || "") +
                  "</small></button>",
              )
              .join("");
          return (
            '<article class="coupon saved-coupon" data-coupon-id="' +
            esc(c.id) +
            '"><div class="couponhead"><div><strong>' +
            esc(c.name) +
            '</strong><div class="marketmeta">' +
            esc(house?.name || "Casa sin asignar") +
            " · " +
            new Date(c.created).toLocaleDateString("es-HN") +
            " · " +
            (c.type === "parlay" ? "Combinada" : "Simple") +
            '</div><div class="marketmeta">' +
            couponProgress(c) +
            '</div></div><span class="result-badge result-' +
            r.status +
            '">' +
            label +
            '</span></div><div class="couponbody"><div class="saved-metrics"><span><small>Apostado</small><b>' +
            money(c.stake) +
            "</b></span><span><small>Cuota</small><b>" +
            (c.odds || "—") +
            "</b></span><span><small>Retorno bruto</small><b>" +
            (r.net === null ? "—" : money(r.gross)) +
            "</b></span><span><small>Resultado neto</small><b>" +
            (r.net === null ? "—" : money(r.net)) +
            '</b></span></div><div class="saved-fixtures">' +
            matches +
            '</div><div class="row"><button class="btn sm" data-detail="' +
            esc(c.id) +
            '">✎ Editar</button><button class="btn sm" data-cashout="' +
            esc(c.id) +
            '">Cash out</button><button class="btn sm" data-exportone="' +
            esc(c.id) +
            '">Exportar</button><button class="btn danger sm" data-remove="' +
            esc(c.id) +
            '">Eliminar</button></div></div></article>'
          );
        })
        .join("") +
      (list.length > couponLimit
        ? '<button type="button" class="btn show-more" data-coupon-more>Mostrar ' +
          Math.min(COUPON_PAGE, list.length - couponLimit) +
          " más · quedan " +
          (list.length - couponLimit) +
          "</button>"
        : "")
    : '<div class="empty"><strong>Aún no hay cupones</strong>Los cupones guardados aparecerán aquí.</div>';
}
function renderHouses() {
  renderBookmakerPresets();
  const bank = $("bankTotal");
  if (bank) {
    const total = db.houses.reduce(
        (s, h) =>
          s +
          (Number(h.initial) || 0) +
          db.transactions.filter((t) => t.houseId === h.id).reduce((n, t) => n + (Number(t.delta) || 0), 0),
        0,
      ),
      settled = db.coupons.map(calcCoupon).filter((r) => r.net !== null),
      net = settled.reduce((s, r) => s + (Number(r.net) || 0), 0),
      won = settled.filter((r) => r.status === "won").length,
      lost = settled.filter((r) => r.status === "lost").length;
    bank.innerHTML =
      '<div class="bank-main"><small>Banco actual</small><strong>' +
      money(total) +
      "</strong><span>" +
      db.houses.length +
      " casa" +
      (db.houses.length === 1 ? "" : "s") +
      '</span></div><div class="bank-side"><small>Resultado neto</small><b class="' +
      (net >= 0 ? "pos" : "neg") +
      '">' +
      (net >= 0 ? "+" : "") +
      money(net) +
      "</b><span>" +
      won +
      " ganados · " +
      lost +
      " perdidos</span></div>";
  }
  const el = $("houseList");
  el.innerHTML = db.houses.length
    ? db.houses
        .map((h) => {
          const tx = db.transactions.filter((t) => t.houseId === h.id).reduce((s, t) => s + t.delta, 0);
          const brand = BOOKMAKERS.find((x) => crestNorm(x.name) === crestNorm(h.name));
          return `<div class="listitem"><div class="row"><div>${brand ? '<span class="bookmaker-mark ' + brand.cls + '">' + brand.mark + "</span>" : ""}<strong>${esc(h.name)}</strong><div class="marketmeta">Balance inicial ${money(h.initial)} · Movimientos netos ${money(tx)}</div></div><strong>${money(h.initial + tx)}</strong></div><button class="btn danger sm" data-house-remove="${esc(h.id)}">Eliminar casa</button></div>`;
        })
        .join("")
    : '<div class="empty">Añade una casa de apuestas para empezar a llevar balances.</div>';
  const txel = $("txList");
  txel.innerHTML =
    db.transactions
      .slice()
      .reverse()
      .slice(0, 20)
      .map(
        (t) =>
          `<div class="listitem"><div class="row"><span>${esc(db.houses.find((h) => h.id === t.houseId)?.name || "Casa eliminada")} · ${esc(t.label)}</span><strong>${t.delta >= 0 ? "+" : ""}${money(t.delta)}</strong></div><div class="marketmeta">${new Date(t.date).toLocaleString("es-HN")} · ${esc(t.note || "Sin descripción")}</div></div>`,
      )
      .join("") || '<div class="muted small">Todavía no hay movimientos.</div>';
}
function populateReportHouse() {
  const el = $("reportHouse");
  if (!el) return;
  const selected = el.value;
  el.innerHTML =
    '<option value="">Todas las casas</option>' +
    db.houses.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");
  if (db.houses.some((h) => h.id === selected)) el.value = selected;
}
function reportCoupons() {
  const from = $("reportFrom")?.value || "",
    to = $("reportTo")?.value || "",
    house = $("reportHouse")?.value || "",
    status = $("reportStatus")?.value || "";
  return db.coupons.filter((c) => {
    const day = String(c.created || "").slice(0, 10),
      st = calcCoupon(c).status;
    return (
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!house || c.houseId === house) &&
      (!status || st === status)
    );
  });
}
function renderReport() {
  const coupons = reportCoupons(),
    summary = $("reportSummary"),
    table = $("reportTable");
  if (!summary || !table) return;
  const stake = coupons.reduce((s, c) => s + (Number(c.stake) || 0), 0),
    pending = coupons.filter((c) => calcCoupon(c).status === "pending").length,
    net = coupons.reduce((s, c) => s + (calcCoupon(c).net || 0), 0);
  summary.innerHTML = `<div class="stat"><strong>${coupons.length}</strong><span>Cupones del informe</span></div><div class="stat"><strong>${money(stake)}</strong><span>Importe apostado</span></div><div class="stat"><strong>${money(net)}</strong><span>Resultado neto liquidado</span></div><div class="stat"><strong>${pending}</strong><span>Pendientes</span></div>`;
  table.innerHTML = coupons.length
    ? `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Fecha</th><th>Cupón</th><th>Casa</th><th>Estado</th><th>Apostado</th><th>Retorno bruto</th><th>Neto</th></tr></thead><tbody>${coupons
        .map((c) => {
          const result = calcCoupon(c),
            house = db.houses.find((h) => h.id === c.houseId);
          return `<tr><td>${esc(String(c.created || "").slice(0, 10))}</td><td>${esc(c.name)}</td><td>${esc(house?.name || "Sin asignar")}</td><td>${statusLabel(result.status)}</td><td>${money(c.stake)}</td><td>${money(result.gross)}</td><td>${result.net === null ? "—" : money(result.net)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : '<div class="empty">No hay cupones para esos filtros.</div>';
}
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const coupons = reportCoupons(),
    rows = [
      [
        "Fecha",
        "Cupón",
        "Casa",
        "Tipo",
        "Estado",
        "Apostado",
        "Cuota total",
        "Bono informativo",
        "Retorno bruto",
        "Resultado neto",
        "Mercados",
        "Partidos",
      ],
    ];
  coupons.forEach((c) => {
    const r = calcCoupon(c),
      house = db.houses.find((h) => h.id === c.houseId);
    rows.push([
      String(c.created || "").slice(0, 10),
      c.name,
      house?.name || "Sin asignar",
      c.type === "parlay" ? "Combinada" : "Simple",
      statusLabel(r.status),
      c.stake,
      c.odds,
      c.bonus,
      r.gross,
      r.net === null ? "Pendiente" : r.net,
      c.fixtures.reduce((n, f) => n + f.markets.length, 0),
      c.fixtures.map((f) => `${f.home} vs ${f.away}`).join(" | "),
    ]);
  });
  const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
    stamp = new Date().toISOString().replace(/[:.]/g, "-");
  download("KAL-informe-" + stamp + ".csv", csv, "text/csv;charset=utf-8");
  toast(`Informe CSV exportado: ${coupons.length} cupón(es).`);
}
// ---- Estadísticas de rendimiento ----
// Mercados: cada mercado cuenta una sola vez aunque esté en varios cupones. Solo cuentan los ganados y
// perdidos (los nulos se informan aparte). "Rentab. suelta" = lo que habrías ganado apostando 1 unidad
// a cada mercado por separado, a su cuota. Cupones: ROI = resultado neto / importe apostado.
let perfPeriod = "all";
const PERF_PERIODS = [
  ["30", "30 días"],
  ["90", "90 días"],
  ["year", "Este año"],
  ["all", "Todo"],
];
function perfSince() {
  const now = new Date();
  if (perfPeriod === "30") return new Date(now.getTime() - 30 * 86400000);
  if (perfPeriod === "90") return new Date(now.getTime() - 90 * 86400000);
  if (perfPeriod === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}
function marketCategory(m, f) {
  if (parsePlayerBet(m, f)) return "Jugadores (remates, goles)";
  const x = crestNorm((m.market || "") + " " + (m.pick || ""));
  if (m.builder || /betbuilder|constructor/.test(x)) return "BetBuilder";
  if (/corner|esquina/.test(x)) return "Córners";
  if (/tarjeta/.test(x)) return "Tarjetas";
  if (/remate|tiro/.test(x)) return "Remates del equipo";
  if (/ambos/.test(x)) return "Ambos marcan";
  if (/doble oportunidad/.test(x) || /^(1x|x2|12)$/.test(crestNorm(m.pick))) return "Doble oportunidad";
  if (/handicap/.test(x)) return "Hándicap";
  if (/marcador|resultado exacto|correct score/.test(x)) return "Marcador exacto";
  if (/1x2|ganador|resultado final|match result/.test(x)) return "1X2 / ganador";
  if (/gol|mas de|menos de|over|under|total/.test(x)) return "Goles (más / menos)";
  return "Otros";
}
function oddsBand(o) {
  if (!(o > 1)) return null;
  if (o < 1.3) return "1.01 – 1.29";
  if (o < 1.6) return "1.30 – 1.59";
  if (o < 2) return "1.60 – 1.99";
  if (o < 3) return "2.00 – 2.99";
  return "3.00 o más";
}
function perfData() {
  const since = perfSince(),
    inPeriod = (iso) => !since || (iso && new Date(iso + "T12:00:00") >= since);
  const seen = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (m.settlement !== "won" && m.settlement !== "lost" && m.settlement !== "void") return;
        const iso = scheduleISO(f) || String(c.created || "").slice(0, 10);
        if (!inPeriod(iso)) return;
        const k = marketKey(f, m);
        if (seen.has(k)) return;
        const odd = Number(
          String(m.odd || m.builderOdd || (f.markets.length === 1 ? f.totalOdds : "")).replace(",", "."),
        );
        seen.set(k, { m, f, odd: odd > 1 ? odd : null, house: c.houseId });
      }),
    ),
  );
  const markets = [...seen.values()];
  const group = (keyFn) => {
    const g = new Map();
    markets.forEach((x) => {
      const k = keyFn(x);
      if (!k) return;
      if (!g.has(k)) g.set(k, { name: k, won: 0, lost: 0, void: 0, odds: [], units: 0, unitsN: 0 });
      const r = g.get(k);
      r[x.m.settlement]++;
      if (x.m.settlement !== "void" && x.odd) {
        r.odds.push(x.odd);
        r.units += x.m.settlement === "won" ? x.odd - 1 : -1;
        r.unitsN++;
      }
    });
    return [...g.values()]
      .map((r) => ({
        ...r,
        n: r.won + r.lost,
        rate: r.won + r.lost ? r.won / (r.won + r.lost) : 0,
        avgOdd: r.odds.length ? r.odds.reduce((a, b) => a + b, 0) / r.odds.length : null,
        roi: r.unitsN ? r.units / r.unitsN : null,
      }))
      .filter((r) => r.n > 0);
  };
  const coupons = db.coupons
    .map((c) => ({ c, r: calcCoupon(c) }))
    .filter((x) => x.r.net !== null && inPeriod(String(x.c.created || "").slice(0, 10)));
  const stake = coupons.reduce((s, x) => s + (Number(x.c.stake) || 0), 0),
    net = coupons.reduce((s, x) => s + (Number(x.r.net) || 0), 0),
    won = coupons.filter((x) => x.r.status === "won").length,
    lost = coupons.filter((x) => x.r.status === "lost").length;
  const seq = coupons
    .filter((x) => x.r.status === "won" || x.r.status === "lost")
    .sort((a, b) => String(a.c.updated || a.c.created).localeCompare(String(b.c.updated || b.c.created)))
    .map((x) => x.r.status);
  let best = 0,
    run = 0;
  seq.forEach((s) => {
    run = s === "won" ? run + 1 : 0;
    best = Math.max(best, run);
  });
  let cur = 0,
    curType = seq[seq.length - 1] || "";
  for (let i = seq.length - 1; i >= 0 && seq[i] === curType; i--) cur++;
  const houses = new Map();
  coupons.forEach((x) => {
    const name = db.houses.find((h) => h.id === x.c.houseId)?.name || "Sin casa asignada";
    if (!houses.has(name)) houses.set(name, { name, n: 0, won: 0, stake: 0, net: 0 });
    const h = houses.get(name);
    h.n++;
    if (x.r.status === "won") h.won++;
    h.stake += Number(x.c.stake) || 0;
    h.net += Number(x.r.net) || 0;
  });
  const months = new Map();
  coupons.forEach((x) => {
    const k = String(x.c.created || "").slice(0, 7);
    if (!k) return;
    months.set(k, (months.get(k) || 0) + (Number(x.r.net) || 0));
  });
  return {
    markets,
    byType: group((x) => marketCategory(x.m, x.f)).sort((a, b) => b.n - a.n),
    byOdds: group((x) => oddsBand(x.odd)).sort((a, b) => a.name.localeCompare(b.name)),
    byComp: group((x) => x.f.competition || x.f.league || null)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),
    coupons,
    stake,
    net,
    won,
    lost,
    best,
    cur,
    curType,
    houses: [...houses.values()].sort((a, b) => b.n - a.n),
    months: [...months.entries()].sort().slice(-6),
  };
}
const pct = (v) => Math.round(v * 100) + "%",
  spct = (v) => {
    const n = Math.round(v * 100);
    return n === 0 ? "0%" : (n > 0 ? "+" : "−") + Math.abs(n) + "%";
  };
const signed = (v) => (v >= 0 ? "+" : "−") + money(Math.abs(v)).replace("L ", "L ");
function perfRows(rows, emptyText) {
  if (!rows.length) return '<div class="empty small">' + emptyText + "</div>";
  return (
    '<div class="perf-rows" role="table">' +
    rows
      .map(
        (r) =>
          '<div class="perf-row" role="row" title="' +
          esc(r.name) +
          ": " +
          r.won +
          " ganados de " +
          r.n +
          (r.void ? " · " + r.void + " nulos" : "") +
          '"><div class="perf-name" role="cell"><b>' +
          esc(r.name) +
          "</b><small>" +
          r.won +
          "/" +
          r.n +
          " acertados" +
          (r.avgOdd ? " · cuota media " + r.avgOdd.toFixed(2) : "") +
          '</small></div><div class="perf-bar" role="cell" aria-label="' +
          pct(r.rate) +
          ' de acierto"><i style="width:' +
          Math.max(2, Math.round(r.rate * 100)) +
          '%"></i></div><div class="perf-val" role="cell"><b>' +
          pct(r.rate) +
          "</b>" +
          (r.roi !== null
            ? '<small class="' + (r.roi >= 0 ? "gain" : "loss") + '">' + spct(r.roi) + " suelto</small>"
            : "") +
          "</div></div>",
      )
      .join("") +
    "</div>"
  );
}
function perfMonths(months) {
  if (!months.length) return '<div class="empty small">Aún no hay cupones liquidados en este periodo.</div>';
  const maxUp = Math.max(0, ...months.map(([, v]) => v)),
    maxDown = Math.max(0, ...months.map(([, v]) => -v)),
    rows = (maxUp || !maxDown ? Math.max(maxUp, 1) : 0) + "fr " + (maxDown ? maxDown : 0) + "fr",
    name = (k) =>
      new Date(k + "-15T12:00:00").toLocaleDateString("es-HN", { month: "short" }).replace(".", "");
  return (
    '<div class="month-chart" role="img" aria-label="Resultado neto por mes">' +
    months
      .map(([k, v]) => {
        const h = Math.round((Math.abs(v) / (v >= 0 ? Math.max(maxUp, 1) : Math.max(maxDown, 1))) * 100);
        return (
          '<div class="mc-col" style="grid-template-rows:' +
          rows +
          ' auto" tabindex="0" title="' +
          esc(name(k)) +
          " " +
          k.slice(0, 4) +
          ": " +
          signed(v) +
          '"><div class="mc-half up">' +
          (v >= 0
            ? '<span class="mc-val">' + signed(v) + '</span><i class="gain" style="height:' + h + '%"></i>'
            : "") +
          '</div><div class="mc-half down">' +
          (v < 0
            ? '<i class="loss" style="height:' + h + '%"></i><span class="mc-val">' + signed(v) + "</span>"
            : "") +
          '</div><span class="mc-lbl">' +
          esc(name(k)) +
          "</span></div>"
        );
      })
      .join("") +
    '</div><div class="mc-legend"><span><i class="gain"></i>Ganancia</span><span><i class="loss"></i>Pérdida</span></div>'
  );
}
function renderPerformance() {
  const el = $("perfSection");
  if (!el) return;
  const d = perfData(),
    roi = d.stake ? d.net / d.stake : null,
    rate = d.won + d.lost ? d.won / (d.won + d.lost) : null,
    mk = d.markets.filter((x) => x.m.settlement !== "void"),
    mkRate = mk.length ? mk.filter((x) => x.m.settlement === "won").length / mk.length : null;
  const best = d.byType.filter((r) => r.n >= 3).sort((a, b) => b.rate - a.rate)[0],
    worst = d.byType.filter((r) => r.n >= 3).sort((a, b) => a.rate - b.rate)[0];
  el.innerHTML =
    '<div class="chips perf-periods" role="group" aria-label="Periodo">' +
    PERF_PERIODS.map(
      ([k, l]) =>
        '<button type="button" class="chip' +
        (perfPeriod === k ? " active" : "") +
        '" data-perf-period="' +
        k +
        '">' +
        l +
        "</button>",
    ).join("") +
    "</div>" +
    '<div class="stats perf-kpis"><div class="stat"><strong class="' +
    (roi === null ? "" : roi >= 0 ? "gain" : "loss") +
    '">' +
    (roi === null ? "—" : spct(roi)) +
    "</strong><span>ROI · " +
    signed(d.net) +
    '</span></div><div class="stat"><strong>' +
    (rate === null ? "—" : pct(rate)) +
    "</strong><span>Cupones ganados (" +
    d.won +
    " de " +
    (d.won + d.lost) +
    ')</span></div><div class="stat"><strong>' +
    (mkRate === null ? "—" : pct(mkRate)) +
    "</strong><span>Mercados acertados (" +
    mk.length +
    ')</span></div><div class="stat"><strong>' +
    (d.cur ? d.cur + (d.curType === "won" ? " ✓" : " ✕") : "—") +
    "</strong><span>Racha actual · mejor " +
    d.best +
    " ✓</span></div></div>" +
    (best && worst && best.name !== worst.name
      ? '<div class="perf-insight">💡 Tu mercado más fiable es <b>' +
        esc(best.name) +
        "</b> (" +
        pct(best.rate) +
        " de acierto); el que más te falla es <b>" +
        esc(worst.name) +
        "</b> (" +
        pct(worst.rate) +
        ").</div>"
      : "") +
    '<section class="perf-block"><h3>Resultado neto por mes</h3>' +
    perfMonths(d.months) +
    "</section>" +
    '<section class="perf-block"><h3>Acierto por tipo de mercado</h3><p class="small muted">“Suelto” es la rentabilidad si hubieras apostado cada mercado por separado.</p>' +
    perfRows(d.byType, "Marca resultados en tus mercados para ver este análisis.") +
    "</section>" +
    '<section class="perf-block"><h3>Acierto por rango de cuota</h3>' +
    perfRows(d.byOdds, "Faltan mercados liquidados con cuota.") +
    "</section>" +
    '<section class="perf-block"><h3>Acierto por competición</h3>' +
    perfRows(d.byComp, "Aún no hay competiciones con resultados.") +
    "</section>" +
    '<section class="perf-block"><h3>Por casa de apuestas</h3>' +
    (d.houses.length
      ? '<div class="perf-houses">' +
        d.houses
          .map(
            (h) =>
              '<div class="perf-house"><b>' +
              esc(h.name) +
              "</b><small>" +
              h.n +
              " cupones · " +
              h.won +
              " ganados · apostado " +
              money(h.stake) +
              '</small><span class="' +
              (h.net >= 0 ? "gain" : "loss") +
              '">' +
              signed(h.net) +
              (h.stake ? " · ROI " + spct(h.net / h.stake) : "") +
              "</span></div>",
          )
          .join("") +
        "</div>"
      : '<div class="empty small">Aún no hay cupones liquidados.</div>') +
    "</section>";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-perf-period]");
  if (b) {
    perfPeriod = b.dataset.perfPeriod;
    renderPerformance();
  }
});

function renderStats() {
  renderPerformance();
  const stake = db.coupons.reduce((s, c) => s + (Number(c.stake) || 0), 0),
    pending = db.coupons
      .filter((c) => calcCoupon(c).status === "pending")
      .reduce((s, c) => s + (Number(c.payout) || 0), 0),
    settled = db.coupons.filter((c) => calcCoupon(c).status !== "pending"),
    net = settled.reduce((s, c) => s + (calcCoupon(c).net || 0), 0);
  $("stTotalStake").textContent = money(stake);
  $("stPotential").textContent = money(pending);
  $("stSettled").textContent = settled.length;
  $("stNet").textContent = money(net);
  renderReport();
}
const BOOKMAKERS = [
  { name: "Hondubet", mark: "H", cls: "hondubet" },
  { name: "Doradobet", mark: "D", cls: "doradobet" },
  { name: "Betpro", mark: "betpro", cls: "betpro" },
  { name: "Catraplay", mark: "◉", cls: "catraplay" },
];
function addPresetHouse(name) {
  if (db.houses.some((h) => crestNorm(h.name) === crestNorm(name))) {
    toast(name + " ya está añadida.");
    return;
  }
  db.houses.push({ id: uid(), name, initial: 0 });
  save();
  renderAll();
  toast(name + " añadida.");
}
function renderBookmakerPresets() {
  const el = $("bookmakerPresets");
  if (el)
    el.innerHTML = BOOKMAKERS.map(
      (x) =>
        '<button class="bookmaker-card ' +
        x.cls +
        '" data-add-bookmaker="' +
        x.name +
        '"><b class="bookmaker-mark">' +
        x.mark +
        "</b><strong>" +
        x.name +
        "</strong><small>Añadir</small></button>",
    ).join("");
}
function renderDashboard() {
  const cs = db.coupons.map((c) => ({ c, r: calcCoupon(c) })),
    count = (x) => cs.filter((y) => y.r.status === x).length,
    stake = cs.reduce((n, x) => n + (Number(x.c.stake) || 0), 0),
    paid = cs.reduce((n, x) => n + Math.max(0, Number(x.r.net) || 0), 0),
    lost = cs.filter((x) => x.r.status === "lost").reduce((n, x) => n + (Number(x.c.stake) || 0), 0);
  $("dashWon").textContent = count("won");
  $("dashLost").textContent = count("lost");
  $("dashVoid").textContent = count("void") + count("cashout");
  $("dashStake").textContent = money(stake);
  $("dashReturned").textContent = money(paid);
  $("dashLostAmount").textContent = money(lost);
  const settled = cs
    .filter((x) => x.r.net !== null)
    .sort((a, b) => String(a.c.created).localeCompare(String(b.c.created)));
  let run = 0,
    pts = settled.map((x) => (run += Number(x.r.net) || 0)),
    w = 760,
    h = 170,
    p = 16,
    min = Math.min(0, ...pts),
    max = Math.max(0, ...pts),
    range = max - min || 1,
    coords = pts
      .map(
        (v, k) =>
          p +
          (k * (w - 2 * p)) / Math.max(1, pts.length - 1) +
          "," +
          (h - p - ((v - min) * (h - 2 * p)) / range),
      )
      .join(" ");
  $("balanceChart").innerHTML =
    pts.length > 1
      ? '<b>Balance neto acumulado</b><svg viewBox="0 0 ' +
        w +
        " " +
        h +
        '"><polyline points="' +
        coords +
        '"/></svg><small>Cada punto es un cupón liquidado.</small>'
      : '<div class="chart-placeholder">El gráfico mostrará tus resultados al liquidar cupones.</div>';
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-coupon-more]")) return;
  couponLimit += COUPON_PAGE;
  renderCoupons();
});
