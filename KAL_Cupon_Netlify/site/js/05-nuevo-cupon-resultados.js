// Nuevo cupón y resultados: vista previa, guardado, marcar ganado/perdido/nulo y deshacer.
"use strict";
let draftEditOpen = new Set();
function renderPreview() {
  if (typeof updateSaveBar === "function") setTimeout(updateSaveBar);
  if (typeof renderRiskBox === "function") setTimeout(renderRiskBox);
  const el = $("preview");
  $("previewCount").textContent = draftSelections.reduce((s, f) => s + f.markets.length, 0) + " selecciones";
  if (!draftSelections.length) {
    el.innerHTML =
      '<div class="empty"><strong>Aún no hay selecciones</strong>Pega el texto y pulsa “Leer y revisar”.</div>';
    return;
  }
  const missing = draftSelections.reduce(
    (n, f) => n + f.markets.filter((m) => !m.odd && !m.builderOdd).length,
    0,
  );
  const warnings = [];
  if (draftDuplicateCount)
    warnings.push(`Detecté ${draftDuplicateCount} partido(s) repetido(s); combiné sus mercados.`);
  if (missing)
    warnings.push(`${missing} mercado(s) sin cuota detectada. Puedes completarla antes de guardar.`);
  const emptyMatches = draftSelections.filter((f) => !f.markets.length).length;
  if (emptyMatches) warnings.push(`${emptyMatches} partido(s) sin mercados detectados.`);
  const incomplete = draftSelections.reduce(
    (n, f) =>
      n + f.markets.filter((m) => !String(m.market || "").trim() || !String(m.pick || "").trim()).length,
    0,
  );
  if (incomplete) warnings.push(`${incomplete} selección(es) con mercado o selección vacíos.`);
  const invalidOdds = draftSelections.reduce(
    (n, f) =>
      n +
      f.markets.filter((m) => {
        const v = m.odd || m.builderOdd;
        return (
          v &&
          (!Number.isFinite(Number(String(v).replace(",", "."))) || Number(String(v).replace(",", ".")) <= 0)
        );
      }).length,
    0,
  );
  if (invalidOdds) warnings.push(`${invalidOdds} cuota(s) con formato o valor inválido.`);
  el.innerHTML = warnings.length ? `<div class="notice">${warnings.map(esc).join("<br>")}</div>` : "";
  el.innerHTML += draftSelections
    .map((f, fi) => {
      const open = draftEditOpen.has(fi),
        comp =
          [f.country, f.competition || f.league].filter(Boolean).join(" · ") || "Competencia sin identificar",
        when = [f.date, f.time].filter(Boolean).join(" · ") || "Fecha pendiente";
      return `<article class="pv-card${open ? " is-editing" : ""}"><div class="pv-head"><button type="button" class="pv-teams" data-open-draft-match="${fi}">${crestHTML(f.homeCrest, f.home)}<span>${esc(f.home)}</span><small>vs</small><span>${esc(f.away)}</span>${crestHTML(f.awayCrest, f.away)}</button><div class="pv-meta"><span>◷ ${esc(when)}</span>${f.leagueCrest ? crestHTML(f.leagueCrest, comp) : ""}<span>${esc(comp)}</span></div></div><div class="pv-markets">${
        f.markets
          .map((m) => {
            const odd = m.odd || m.builderOdd || (f.markets.length === 1 ? f.totalOdds : "");
            return `<div class="pv-market"><span><b>${esc(m.market || "Mercado sin nombre")}</b>${m.pick ? " · " + esc(m.pick) : ""}</span><span class="pv-odd${odd ? "" : " missing"}">${odd ? esc(odd) : "sin cuota"}</span></div>`;
          })
          .join("") || '<div class="small muted">Sin mercados detectados.</div>'
      }</div><div class="pv-actions"><button type="button" class="btn sm" data-fetch-crests="${fi}">🔎 Buscar logos</button><button type="button" class="btn sm" data-pv-edit="${fi}" aria-expanded="${open}">${open ? "✓ Listo" : "✎ Editar"}</button></div><div id="crest-result-${fi}" class="marketmeta"></div>${open ? `<div class="pv-edit"><div class="meta-edit"><label class="small muted">Fecha<input class="input" type="date" data-draft-field="dateISO" data-fi="${fi}" value="${esc(scheduleISO(f))}"></label><label class="small muted">Hora<input class="input" type="time" data-draft-field="time" data-fi="${fi}" value="${esc(f.time || "")}"></label><label class="small muted">País<input class="input" data-draft-field="country" data-fi="${fi}" value="${esc(f.country || "")}" placeholder="País"></label><label class="small muted">Liga / competencia<input class="input" data-draft-field="competition" data-fi="${fi}" value="${esc(f.competition || f.league || "")}" placeholder="Liga o competencia"></label><label class="small muted">Logo liga (URL)<input class="input" type="url" data-draft-field="leagueCrest" data-fi="${fi}" value="${esc(f.leagueCrest || "")}" placeholder="https://…"></label><label class="small muted">Escudo local (URL)<input class="input" type="url" data-draft-field="homeCrest" data-fi="${fi}" value="${esc(f.homeCrest || "")}" placeholder="https://…"></label><label class="small muted">Escudo visitante (URL)<input class="input" type="url" data-draft-field="awayCrest" data-fi="${fi}" value="${esc(f.awayCrest || "")}" placeholder="https://…"></label></div>${f.markets.map((m, mi) => `<div class="draft-fields"><input class="input" aria-label="Mercado" data-draft-field="market" data-fi="${fi}" data-mi="${mi}" value="${esc(m.market)}"><input class="input" aria-label="Selección" data-draft-field="pick" data-fi="${fi}" data-mi="${mi}" value="${esc(m.pick)}"><input class="input" type="text" aria-label="Cuota" data-draft-field="odd" data-fi="${fi}" data-mi="${mi}" value="${esc(m.odd || m.builderOdd || (f.markets.length === 1 ? f.totalOdds : ""))}"><button class="btn danger sm" data-remove-draft="${fi}:${mi}" type="button" aria-label="Quitar este mercado" title="Quitar este mercado">🗑</button></div>`).join("")}</div>` : ""}</article>`;
    })
    .join("");
}
function readText() {
  const raw = $("raw").value;
  if (!raw.trim()) {
    toast("Pega primero el texto del cupón.");
    return;
  }
  const parsed = parseCoupon(raw);
  if (!parsed.fixtures.length) {
    toast("No detecté partidos. El texto debe incluir equipos, “vs” y fecha con hora.");
    return;
  }
  draftSelections = parsed.fixtures;
  if ($("previewAnalystOut") && !analystBusy) $("previewAnalystOut").innerHTML = "";
  draftEditOpen = new Set();
  draftSelections.forEach(applySavedCrests);
  draftDuplicateCount = parsed.meta.duplicateFixtures || 0;
  window.__kalLastParsedRaw = raw;
  $("stake").value = parsed.meta.stake ?? "";
  $("totalOdds").value = parsed.meta.odds ?? "";
  $("bonus").value = parsed.meta.bonus ?? 0;
  $("payout").value = parsed.meta.payout ?? "";
  const slip = parsed.meta.betslip;
  if (slip && !parsed.meta.odds && parsed.meta.oddsProduct) $("totalOdds").value = parsed.meta.oddsProduct;
  ["stake", "totalOdds", "bonus", "payout"].forEach((id) =>
    $(id).classList.toggle("need-input", !!slip && !String($(id).value).trim()),
  );
  if ($("slipHint"))
    $("slipHint").innerHTML = slip
      ? "🧾 <b>Cupón antes de apostar.</b> El boleto no trae los totales: completa <b>valor apostado</b>, <b>bono</b> y <b>ganancia total</b>" +
        (parsed.meta.oddsProduct && !parsed.meta.odds
          ? ". La <b>cuota total</b> (" +
            parsed.meta.oddsProduct +
            ") la calculé multiplicando las cuotas; corrígela si tu casa muestra otra."
          : ".")
      : "";
  $("couponName").value = $("couponName").value || `Cupón ${new Date().toLocaleDateString("es-HN")}`;
  $("couponType").value = draftSelections.reduce((n, f) => n + f.markets.length, 0) > 1 ? "parlay" : "simple";
  applyQuickDefaults();
  updatePayoutHint();
  renderPreview();
  renderLogos();
  $("raw").value = "";
  try {
    localStorage.removeItem(DRAFT);
  } catch (e) {}
  toast(
    parsed.meta.betslip
      ? `Detecté ${draftSelections.length} partidos (antes de apostar). Completa valor apostado, bono y ganancia total.`
      : `Detecté ${draftSelections.length} partidos. Revisa los mercados y datos financieros.`,
  );
}
function calcCoupon(c) {
  const all = c.fixtures.flatMap((f) => f.markets),
    stake = Number(c.stake) || 0;
  if (c.cashoutGross != null)
    return {
      status: "cashout",
      gross: Number(c.cashoutGross) || 0,
      net: (Number(c.cashoutGross) || 0) - stake,
    };
  const lost = all.some((m) => m.settlement === "lost"),
    pending = all.some((m) => m.settlement === "pending"),
    hasVoid = all.some((m) => m.settlement === "void"),
    allVoid = all.length > 0 && all.every((m) => m.settlement === "void"),
    won = all.length > 0 && all.every((m) => m.settlement === "won" || m.settlement === "void");
  if (lost) return { status: "lost", gross: 0, net: -stake };
  if (pending) return { status: "pending", gross: Number(c.payout) || 0, net: null };
  if (hasVoid && c.voidGross != null)
    return { status: "void", gross: Number(c.voidGross) || 0, net: (Number(c.voidGross) || 0) - stake };
  if (allVoid) return { status: "void", gross: stake, net: 0 };
  if (won) {
    const gross = Number(c.payout) || stake * (Number(c.odds) || 1);
    return { status: "won", gross, net: gross - stake };
  }
  return { status: "pending", gross: Number(c.payout) || 0, net: null };
}
function markDeleted(kind, ids, undo = false) {
  db.deleted = db.deleted || {};
  const set = new Set(db.deleted[kind] || []);
  []
    .concat(ids)
    .filter(Boolean)
    .forEach((id) => (undo ? set.delete(id) : set.add(id)));
  db.deleted[kind] = [...set].slice(-2000);
}
function touchCoupon(c) {
  if (c) c.updated = new Date().toISOString();
}
function pushCouponAction(action) {
  db.actionHistory = db.actionHistory || [];
  db.actionHistory.push(action);
  if (db.actionHistory.length > 100) db.actionHistory.shift();
}
function syncAutoStakeTransaction(c, enabled) {
  const tx = db.transactions.find((t) => t.id === c.stakeTxId && t.couponId === c.id);
  if (enabled && c.houseId && Number(c.stake) > 0) {
    if (tx) {
      tx.houseId = c.houseId;
      tx.delta = -Number(c.stake);
      tx.label = "Apuesta de cupón";
      tx.note = `Apuesta del cupón: ${c.name}`;
      tx.date = new Date().toISOString();
    } else {
      const created = {
        id: uid(),
        couponId: c.id,
        houseId: c.houseId,
        delta: -Number(c.stake),
        label: "Apuesta de cupón",
        note: `Apuesta del cupón: ${c.name}`,
        date: new Date().toISOString(),
      };
      db.transactions.push(created);
      c.stakeTxId = created.id;
    }
  } else if (c.stakeTxId) {
    db.transactions = db.transactions.filter((t) => !(t.id === c.stakeTxId && t.couponId === c.id));
    c.stakeTxId = "";
  }
}
function saveCoupon() {
  if (!draftSelections.length && $("raw").value.trim()) readText();
  if (!draftSelections.length) {
    toast("Pega un cupón que incluya al menos un partido antes de guardar.");
    return;
  }
  const allMarkets = draftSelections.reduce((s, f) => s + f.markets.length, 0),
    stake = Number($("stake").value) || 0,
    odds = Number($("totalOdds").value) || 0,
    payout = Number($("payout").value) || (stake && odds ? stake * odds : 0);
  let type = $("couponType").value;
  if (type === "auto") type = allMarkets > 1 ? "parlay" : "simple";
  draftSelections.forEach(rememberFixtureCrests);
  const now = new Date().toISOString(),
    existing = editingCouponId ? db.coupons.find((x) => x.id === editingCouponId) : null,
    before = existing ? JSON.parse(JSON.stringify(existing)) : null,
    transactionsBefore = existing
      ? JSON.parse(JSON.stringify(db.transactions.filter((t) => t.couponId === existing.id)))
      : [];
  const c = {
    ...(existing || {}),
    id: existing?.id || uid(),
    name: $("couponName").value.trim() || "Cupón nuevo",
    created: existing?.created || now,
    updated: now,
    raw: window.__kalLastParsedRaw || $("raw").value,
    houseId: $("couponHouse").value,
    type,
    stake,
    odds,
    bonus: Number($("bonus").value) || 0,
    payout,
    notes: $("notes").value.trim(),
    confidence: Number($("couponConfidence").value) || null,
    reason: $("couponReason").value.trim().slice(0, 140),
    fixtures: JSON.parse(JSON.stringify(draftSelections)),
  };
  pushCouponAction(
    existing
      ? { type: "edit", coupon: before, transactions: transactionsBefore, at: now }
      : { type: "create", couponId: c.id, at: now },
  );
  if (existing) db.coupons = db.coupons.map((x) => (x.id === existing.id ? c : x));
  else db.coupons.unshift(c);
  const autoStakeMissing = $("autoStakeTx").checked && stake > 0 && !c.houseId;
  syncAutoStakeTransaction(c, $("autoStakeTx").checked);
  if (!save()) {
    if (existing) {
      db.coupons = db.coupons.map((x) => (x.id === c.id ? before : x));
      db.transactions = db.transactions.filter((t) => t.couponId !== c.id);
      db.transactions.push(...transactionsBefore);
    } else {
      db.coupons = db.coupons.filter((x) => x.id !== c.id);
      db.transactions = db.transactions.filter((t) => t.couponId !== c.id);
    }
    db.actionHistory.pop();
    editingCouponId = existing?.id || null;
    return;
  }
  editingCouponId = null;
  draftDuplicateCount = 0;
  renderAll();
  toast(
    autoStakeMissing
      ? "Cupón guardado. Selecciona una casa para registrar la apuesta en el balance."
      : allMarkets
        ? "Cupón guardado correctamente."
        : "Cupón guardado, pero no detecté mercados; puedes completar o revisar las selecciones.",
  );
  $("couponName").value = "";
  $("notes").value = "";
  $("couponReason").value = "";
  setConfidence(0);
  clearSlipHint();
  $("autoStakeTx").checked = false;
  draftSelections = [];
  renderPreview();
  renderLogos();
  go("saved");
}
function setMarketStatus(key, status) {
  const statusBefore = couponStatusSnapshot();
  let count = 0,
    oldStatus = null,
    label = "Mercado";
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (marketKey(f, m) === key) {
          if (oldStatus === null) {
            oldStatus = m.settlement;
            label = `${f.home} vs ${f.away} · ${m.market}${m.pick ? " · " + m.pick : ""}`;
          }
          if (m.settlement !== status) {
            m.settlement = status;
            count++;
            touchCoupon(c);
          }
        }
      }),
    ),
  );
  if (!count) {
    toast("Ese mercado ya tiene ese estado.");
    return;
  }
  if (status !== "pending") {
    db.coupons
      .filter(
        (c) =>
          c.voidGross == null &&
          c.fixtures
            .flatMap((f) => f.markets)
            .some(
              (m) =>
                marketKey(
                  c.fixtures.find((f) => f.markets.includes(m)),
                  m,
                ) === key,
            ) &&
          c.fixtures.flatMap((f) => f.markets).every((m) => m.settlement !== "pending") &&
          c.fixtures.flatMap((f) => f.markets).some((m) => m.settlement === "void"),
      )
      .forEach((c) => {
        const a = prompt(
          "Mercados anulados en " + c.name + ". ¿Cuánto pagó la casa en total (Lempiras)?",
          String(c.stake || 0),
        );
        if (a !== null && Number.isFinite(Number(a.replace(",", "."))) && Number(a.replace(",", ".")) >= 0)
          c.voidGross = Number(a.replace(",", "."));
      });
  }
  db.resultHistory = db.resultHistory || [];
  db.resultHistory.push({
    key,
    oldStatus: oldStatus || "pending",
    status,
    label,
    at: new Date().toISOString(),
  });
  if (db.resultHistory.length > 200) db.resultHistory.shift();
  save();
  renderAll();
  toast(`Resultado actualizado en ${count} coincidencia(s).`);
  announceResult(status, statusBefore);
}
function renderResultHistory() {
  const el = $("resultHistory");
  if (!el) return;
  const items = (db.resultHistory || []).slice().reverse().slice(0, 30);
  el.innerHTML = items.length
    ? items
        .map(
          (x) =>
            `<div class="history-row"><div class="history-text"><strong>${esc(x.label || "Mercado")}</strong><small>${new Date(x.at).toLocaleString("es-HN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></div><span class="history-change"><span class="st st-${esc(x.oldStatus || "pending")}">${statusLabel(x.oldStatus)}</span>→<span class="st st-${esc(x.status)}">${statusLabel(x.status)}</span></span></div>`,
        )
        .join("")
    : '<div class="muted small">Todavía no hay cambios de resultados.</div>';
  const btn = $("undoResultBtn");
  if (btn) btn.disabled = !items.length;
  const hc = $("historyCount");
  if (hc) hc.textContent = (db.resultHistory || []).length;
  const fold = el.closest(".fold");
  if (fold) {
    const saved = readFolds().history;
    setFold(fold, !!saved);
  }
}
function undoLastResult() {
  const history = db.resultHistory || [],
    last = history.pop();
  if (!last) {
    toast("No hay cambios para deshacer.");
    return;
  }
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (marketKey(f, m) === last.key || legacyMarketKey(f, m) === last.key) {
          m.settlement = last.oldStatus || "pending";
          touchCoupon(c);
        }
      }),
    ),
  );
  db.resultHistory = history;
  save();
  renderAll();
  toast("Se deshizo el último cambio de resultado.");
}
function undoCouponAction() {
  const history = db.actionHistory || [],
    last = history.pop();
  if (!last) {
    toast("No hay cambios de cupones para deshacer.");
    return;
  }
  const id = last.coupon?.id || last.couponId;
  if (last.type === "create") {
    markDeleted(
      "transactions",
      db.transactions.filter((t) => t.couponId === id).map((t) => t.id),
    );
    db.coupons = db.coupons.filter((c) => c.id !== id);
    db.transactions = db.transactions.filter((t) => t.couponId !== id);
    markDeleted("coupons", id);
  } else if (last.type === "edit") {
    db.coupons = db.coupons.filter((c) => c.id !== id);
    touchCoupon(last.coupon);
    db.coupons.unshift(last.coupon);
    db.transactions = db.transactions.filter((t) => t.couponId !== id);
    db.transactions.push(...(last.transactions || []));
  } else if (last.type === "delete") {
    markDeleted("coupons", id, true);
    markDeleted(
      "transactions",
      (last.transactions || []).map((t) => t.id),
      true,
    );
    touchCoupon(last.coupon);
    if (!db.coupons.some((c) => c.id === id)) db.coupons.unshift(last.coupon);
    db.transactions = db.transactions.filter((t) => t.couponId !== id);
    db.transactions.push(...(last.transactions || []));
  }
  db.actionHistory = history;
  save();
  renderAll();
  toast("Se deshizo el último cambio del cupón.");
}
function renderCouponActionUndo() {
  const btn = $("undoCouponActionBtn");
  if (btn) btn.disabled = !(db.actionHistory || []).length;
}
