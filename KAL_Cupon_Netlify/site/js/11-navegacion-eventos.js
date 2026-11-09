// Navegación entre pantallas, respaldos, botones y carga inicial de los datos guardados.
"use strict";
// Qué se dibuja en cada pantalla. Solo se redibuja la pantalla visible; las demás se dibujan al entrar
// (antes cada toque redibujaba todas las pantallas, también las ocultas).
const VIEW_RENDER = {
  home: () => {
    renderHomeNotices();
    renderBudget();
    renderTodayPanel();
    renderDashboard();
  },
  new: () => renderPreview(),
  calendar: () => renderCalendar(),
  markets: () => {
    renderMarkets();
    renderResultHistory();
  },
  logos: () => renderLogos(),
  saved: () => {
    renderCoupons();
    renderCouponActionUndo();
  },
  houses: () => renderHouses(),
  stats: () => renderStats(),
  settings: () => {
    renderAlertsBox();
    renderInstallHelp();
    renderStorageBox();
  },
};
function renderView(name = activeView) {
  VIEW_RENDER[name]?.();
}
function renderAll() {
  db.coupons.forEach((c) => (c.fixtures || []).forEach(applySavedCrests));
  populateHouses();
  populateMarketHouseFilter();
  populateReportHouse();
  renderView();
  if (currentMatchRef) renderMatchDetail(currentMatchRef);
  $("sideCount").textContent = db.coupons.length;
  $("sCoupons").textContent = db.coupons.length;
  $("sMatches").textContent = db.coupons.reduce((s, c) => s + c.fixtures.length, 0);
  $("sPending").textContent = pendingMarketCount();
  $("sStake").textContent = money(db.coupons.reduce((s, c) => s + (Number(c.stake) || 0), 0));
  queueAlertsSync();
}
const VIEW_TITLES = {
    home: "Inicio",
    new: "Nuevo cupón",
    calendar: "Agenda",
    markets: "Mercados",
    logos: "Logos",
    saved: "Mis cupones",
    houses: "Balances",
    stats: "Estadísticas",
    settings: "Ajustes",
  },
  MORE_VIEWS = ["logos", "houses", "stats", "settings"];
function closeMoreMenu() {
  const m = $("moreMenu");
  if (m) m.hidden = true;
  $("moreBtn")?.setAttribute("aria-expanded", "false");
}
function go(name) {
  const focusReader = name === "new" && !draftSelections.length;
  if (!VIEW_TITLES[name]) name = "home";
  const changed = activeView !== name;
  activeView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("moreBtn")?.classList.toggle("active", MORE_VIEWS.includes(name));
  const title = $("viewTitle");
  if (title) title.textContent = VIEW_TITLES[name];
  document.body.dataset.view = name;
  closeMoreMenu();
  if (changed) renderView(name);
  if (focusReader) {
    const raw = $("raw");
    raw?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => raw?.focus({ preventScroll: true }), 250);
  } else if (changed) window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const more = e.target.closest("#moreBtn");
  if (more) {
    const m = $("moreMenu"),
      open = m.hidden;
    m.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    return;
  }
  if (!e.target.closest("#moreMenu")) closeMoreMenu();
});
function download(name, text, type = "application/json") {
  const blob = new Blob([text], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    localStorage.setItem("kal_last_backup", String(Date.now()));
  } catch {}
  renderHomeNotices();
  download(
    "KAL-respaldo-" + stamp + ".json",
    JSON.stringify(
      {
        version: 3,
        exportedAt: new Date().toISOString(),
        db,
        logos: {
          dir: readCrestDirectory(),
          hidden: JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"),
          trash: readLogoTrash(),
          images: localImages(),
        },
      },
      null,
      2,
    ),
  );
  toast("Respaldo descargado.");
}
function addHouse() {
  const name = $("houseName").value.trim();
  if (!name) {
    toast("Escribe el nombre de la casa.");
    return;
  }
  db.houses.push({ id: uid(), name, initial: Number($("houseBalance").value) || 0 });
  $("houseName").value = "";
  $("houseBalance").value = "";
  save();
  renderAll();
  toast("Casa añadida.");
}
function addTx() {
  const houseId = $("txHouse").value,
    amount = Number($("txAmount").value);
  if (!houseId || !Number.isFinite(amount) || amount <= 0) {
    toast("Selecciona una casa e introduce un importe mayor que cero.");
    return;
  }
  const type = $("txType").value,
    labels = {
      deposit: "Depósito",
      withdraw: "Retiro",
      stake: "Apuesta realizada",
      return: "Cobro / retorno",
      adjust: "Ajuste",
    };
  const delta = type === "deposit" || type === "return" ? amount : type === "adjust" ? amount : -amount;
  db.transactions.push({
    id: uid(),
    houseId,
    delta,
    label: labels[type],
    note: $("txNote").value.trim(),
    date: new Date().toISOString(),
  });
  $("txAmount").value = "";
  $("txNote").value = "";
  save();
  renderAll();
  toast("Movimiento guardado.");
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      let incoming = obj.db || obj;
      if (
        !incoming ||
        !Array.isArray(incoming.coupons) ||
        !Array.isArray(incoming.houses || []) ||
        !Array.isArray(incoming.transactions || [])
      )
        throw Error();
      if (
        !confirm(
          "¿Importar el respaldo? Los datos actuales se reemplazarán. Descarga un respaldo primero si quieres conservarlos.",
        )
      )
        return;
      db = {
        coupons: incoming.coupons || [],
        houses: incoming.houses || [],
        transactions: incoming.transactions || [],
        resultHistory: Array.isArray(incoming.resultHistory) ? incoming.resultHistory : [],
        actionHistory: Array.isArray(incoming.actionHistory) ? incoming.actionHistory : [],
        deleted: {},
        settings: incoming.settings && typeof incoming.settings === "object" ? incoming.settings : {},
        progress: incoming.progress && typeof incoming.progress === "object" ? incoming.progress : {},
      };
      if (obj.logos) mergeLogoStores(obj.logos);
      indexSavedCrests();
      save();
      renderAll();
      toast("Respaldo importado.");
    } catch (e) {
      toast("No pude leer ese respaldo de KAL.");
    }
  };
  reader.readAsText(file);
}
$("logoSearch").addEventListener("input", renderLogos);
$("logoClearFocus").addEventListener("click", () => {
  logoManagerFocus = [];
  renderLogos();
});
let marketFilterTimer = null;
const refreshMarkets = () => {
  marketLimit = MARKET_PAGE;
  renderMarkets();
};
["marketSearch", "marketDateFilter"].forEach((id) =>
  $(id).addEventListener("input", () => {
    clearTimeout(marketFilterTimer);
    marketFilterTimer = setTimeout(refreshMarkets, 160);
  }),
);
["marketStatusFilter", "marketHouseFilter"].forEach((id) => $(id).addEventListener("change", refreshMarkets));
$("undoResultBtn").addEventListener("click", undoLastResult);
$("undoCouponActionBtn").addEventListener("click", undoCouponAction);
$("exportCsvBtn").addEventListener("click", exportCsv);
["reportFrom", "reportTo"].forEach((id) => $(id).addEventListener("change", renderReport));
["reportHouse", "reportStatus"].forEach((id) => $(id).addEventListener("change", renderReport));
initCloud();
$("readBtn").addEventListener("click", readText);
$("saveBtn").addEventListener("click", () => {
  try {
    saveCoupon();
  } catch (e) {
    console.error("Error al guardar cupón:", e);
    toast("No se pudo guardar el cupón: " + (e?.message || "error inesperado"));
  }
});
$("clearBtn").addEventListener("click", () => {
  $("raw").value = "";
  window.__kalLastParsedRaw = "";
  editingCouponId = null;
  draftSelections = [];
  draftDuplicateCount = 0;
  ["couponName", "stake", "totalOdds", "bonus", "payout", "notes"].forEach((id) => ($(id).value = ""));
  $("couponType").value = "auto";
  $("couponHouse").value = "";
  $("autoStakeTx").checked = false;
  renderPreview();
  renderLogos();
  save();
  toast("Formulario limpio. Los cupones guardados se conservaron.");
});
$("sampleBtn").addEventListener("click", () => {
  $("raw").value =
    `Italia, Serie A\nInter Milan\nvs.\nFiorentina\n25/10/2026 • 05:30\n1x2: 1 • pago anticipado\nCuotas: 1.36\n\nEspaña, La Liga\nBarcelona\nvs.\nReal Madrid\n25/10/2026 • 08:00\nMás de 2.5 goles\nCuotas: 1.85\nVALOR APOSTADO L 120.00\nCUOTAS: 2.20\nGANANCIA TOTAL: L 264.00`;
  $("raw").dispatchEvent(new Event("input"));
  toast("Ejemplo cargado. Pulsa Leer y revisar.");
});
$("raw").addEventListener("input", () => {
  try {
    localStorage.setItem(DRAFT, $("raw").value);
  } catch (e) {}
});
$("addHouse").addEventListener("click", addHouse);
$("addTx").addEventListener("click", addTx);
$("backupBtn").addEventListener("click", backup);
$("settingsBackup").addEventListener("click", backup);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("settingsImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
  e.target.value = "";
});
$("wipeBtn").addEventListener("click", () => {
  if (
    confirm(
      "¿Borrar todos los cupones, casas y movimientos de este navegador? Los escudos y logos guardados se conservarán. Esta acción no se puede deshacer.",
    )
  ) {
    db = { coupons: [], houses: [], transactions: [], resultHistory: [], actionHistory: [] };
    draftSelections = [];
    localStorage.removeItem(KEY);
    localStorage.removeItem(DRAFT);
    $("raw").value = "";
    renderAll();
    toast("Cupones y movimientos borrados. Los escudos se conservaron.");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentMatchRef) closeMatchDetails();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open-market-match]")) {
    e.preventDefault();
    const r = marketMatchRefs[Number(e.target.dataset.openMarketMatch)];
    if (r) openMatchDetails(r);
  }
});
document.body.addEventListener("change", (e) => {
  if (e.target.closest("[data-draft-field]")) renderPreview();
});
$("agendaFilter").addEventListener("change", renderCalendar);
$("agendaDate").addEventListener("change", renderCalendar);
document.addEventListener("click", (e) => {
  const r = e.target.closest("[data-agenda-range]");
  if (!r) return;
  agendaRange = r.dataset.agendaRange;
  $("agendaDate").value = "";
  renderCalendar();
});
// Cada 30 s se refresca solo lo que está a la vista (estado "en vivo" de los partidos).
setInterval(() => {
  if (document.hidden) return;
  if (activeView === "calendar") renderCalendar();
  else if (activeView === "home") renderTodayPanel();
}, 30000);
document.body.addEventListener("input", (e) => {
  const field = e.target.closest("[data-draft-field]");
  if (!field) return;
  const fixture = draftSelections[Number(field.dataset.fi)];
  if (!fixture) return;
  const name = field.dataset.draftField;
  if (["dateISO", "time", "country", "competition", "leagueCrest", "homeCrest", "awayCrest"].includes(name)) {
    fixture[name] = field.value;
    if (name === "dateISO")
      fixture.date = field.value
        ? field.value.slice(8, 10) + "/" + field.value.slice(5, 7) + "/" + field.value.slice(0, 4)
        : "";
    if (name === "competition") fixture.league = field.value;
    return;
  }
  const market = fixture.markets[Number(field.dataset.mi)];
  if (!market) return;
  market[name] = field.value;
  if (name === "odd") {
    if (market.builder) market.builderOdd = field.value;
    if (fixture.markets.length === 1) fixture.totalOdds = field.value;
  }
});
document.body.addEventListener("click", (e) => {
  const playerPhoto = e.target.closest("[data-player-photo]");
  if (playerPhoto) {
    const betId = playerPhoto.dataset.playerPhotoBet,
      betRef = betId ? playerBetRefs[betId] : null;
    lookupMatchPlayerPhoto(playerPhoto.dataset.playerPhoto, betRef?.ref || null, betRef || null);
    return;
  }
  const playerPhotoDelete = e.target.closest("[data-player-photo-remove]");
  if (playerPhotoDelete) {
    const d = readCrestDirectory(),
      x = d[playerPhotoDelete.dataset.playerPhotoRemove];
    if (x) {
      if (x.marketKey) delete matchPlayerPhotos[x.marketKey];
      x.photo = "";
      x.url = "";
      localStorage.setItem(CREST_DIR, JSON.stringify(d));
      if (cloudSession) queueCloudSync();
      renderLogos();
      if (currentMatchRef) renderMatchDetail();
      toast("Se quitó la foto. El jugador sigue en tu lista.");
    }
    return;
  }
  const playerHide = e.target.closest("[data-player-hide]");
  if (playerHide) {
    const x = collectPlayerBets().find((p) => p.id === playerHide.dataset.playerHide);
    if (x && confirm("¿Mover este jugador a Eliminados? Podrás recuperarlo después.")) {
      addLogoTrash("player", x.id, x);
      renderLogos();
    }
    return;
  }
  const leagueHide = e.target.closest("[data-league-hide]");
  if (leagueHide) {
    const x = collectLogoLeagues().find((p) => p.key === leagueHide.dataset.leagueHide);
    if (x && confirm("¿Mover esta liga a Eliminados? Podrás recuperarla después."))
      hideLogoEntity("league", x);
    return;
  }
  const restoreLogo = e.target.closest("[data-logo-restore]");
  if (restoreLogo) {
    restoreLogoTrash(restoreLogo.dataset.logoRestore);
    return;
  }
  const tab = e.target.closest("[data-match-tab]");
  if (tab) {
    matchActiveTab = tab.dataset.matchTab;
    renderMatchDetail();
    if (["analysis", "statistics", "events"].includes(matchActiveTab)) {
      const f = currentMatchRef?.draft
          ? null
          : db.coupons.find((c) => c.id === currentMatchRef?.couponId)?.fixtures?.[
              Number(currentMatchRef?.fixtureIndex)
            ],
        key = f && matchCacheKey(f),
        loaded = key && matchApiData[key]?.[matchActiveTab];
      if (!loaded || loaded.error) loadMatchTab(matchActiveTab);
    }
    return;
  }
  const loadTab = e.target.closest("[data-load-match-tab]");
  if (loadTab) {
    loadMatchTab(loadTab.dataset.loadMatchTab, true);
    return;
  }
  const closeMatch = e.target.closest("[data-close-match]");
  if (closeMatch) {
    closeMatchDetails();
    return;
  }
  const calendarMatch = e.target.closest("[data-open-calendar-match]");
  if (calendarMatch) {
    const r = calendarMatchRefs[Number(calendarMatch.dataset.openCalendarMatch)];
    if (r) openMatchDetails(r);
    return;
  }
  const marketMatch = e.target.closest("[data-open-market-match]");
  if (marketMatch) {
    const r = marketMatchRefs[Number(marketMatch.dataset.openMarketMatch)];
    if (r) openMatchDetails(r);
    return;
  }
  const savedMatch = e.target.closest("[data-open-saved-match]");
  if (savedMatch) {
    openMatchDetails({
      couponId: savedMatch.dataset.openSavedMatch,
      fixtureIndex: Number(savedMatch.dataset.fixtureIndex),
    });
    return;
  }
  const draftMatch = e.target.closest("[data-open-draft-match]");
  if (draftMatch) {
    openMatchDetails({ draft: true, fixtureIndex: Number(draftMatch.dataset.openDraftMatch) });
    return;
  }
  const marketLogoEdit = e.target.closest("[data-market-edit-logos]");
  if (marketLogoEdit) {
    logoManagerFocus = [
      savedCrestKey("team", marketLogoEdit.dataset.home),
      savedCrestKey("team", marketLogoEdit.dataset.away),
    ];
    $("logoSearch").value = "";
    renderLogos();
    go("logos");
    return;
  }
  const hideTeam = e.target.closest("[data-logo-hide]");
  if (hideTeam) {
    if (confirm("¿Mover este equipo a Eliminados? Podrás recuperarlo después.")) {
      const team = logoManagerTeams.find((x) => x.key === hideTeam.dataset.logoHide);
      if (team) hideLogoEntity("team", team);
    }
  }
  const preset = e.target.closest("[data-add-bookmaker]");
  if (preset) {
    addPresetHouse(preset.dataset.addBookmaker);
    return;
  }
  const cash = e.target.closest("[data-cashout]");
  if (cash) {
    const c = db.coupons.find((x) => x.id === cash.dataset.cashout),
      v = prompt("¿Cuánto pagó la casa por el cash out? (Lempiras)", String(c?.stake || 0));
    if (c && v !== null && Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) >= 0) {
      c.cashoutGross = Number(v.replace(",", "."));
      touchCoupon(c);
      save();
      renderAll();
    }
    return;
  }
  const catalogCountry = e.target.closest("[data-catalog-country]");
  if (catalogCountry) {
    lookupCatalogItem("country");
    return;
  }
  const catalogLeague = e.target.closest("[data-catalog-league]");
  if (catalogLeague) {
    lookupCatalogItem("league");
    return;
  }
  const catalogSave = e.target.closest("[data-catalog-save]");
  if (catalogSave) {
    saveCatalogItem();
    return;
  }
  const teamLogoRemove = e.target.closest("[data-team-logo-remove]");
  if (teamLogoRemove) {
    removeTeamLogo(teamLogoRemove.dataset.teamLogoRemove);
    return;
  }
  const logoId = e.target.closest("[data-logo-id]");
  if (logoId) {
    saveLogoById("team", logoId.dataset.logoId);
    return;
  }
  const playerId = e.target.closest("[data-player-id]");
  if (playerId) {
    savePlayerPhotoById(playerId.dataset.playerId);
    return;
  }
  const leagueSearch = e.target.closest("[data-league-search]");
  if (leagueSearch) {
    lookupSavedLeagueLogo(Number(leagueSearch.dataset.leagueSearch));
    return;
  }
  const leagueOption = e.target.closest("[data-league-option]");
  if (leagueOption) {
    saveLeagueLookupOption(
      Number(leagueOption.dataset.leagueOption),
      Number(leagueOption.dataset.optionIndex),
    );
    return;
  }
  const leagueId = e.target.closest("[data-league-id]");
  if (leagueId) {
    saveLogoById("league", leagueId.dataset.leagueId);
    return;
  }
  const leagueRemove = e.target.closest("[data-league-remove]");
  if (leagueRemove) {
    removeLeagueLogo(leagueRemove.dataset.leagueRemove);
    return;
  }
  const logoLookup = e.target.closest("[data-logo-lookup]");
  if (logoLookup) {
    lookupSavedTeamLogo(Number(logoLookup.dataset.logoLookup));
    return;
  }
  const logoManualSave = e.target.closest("[data-logo-manual-save]");
  if (logoManualSave) {
    saveManualTeamLogo(Number(logoManualSave.dataset.logoManualSave));
    return;
  }
  const logoSave = e.target.closest("[data-logo-save]");
  if (logoSave) {
    saveManagedTeamLogo(Number(logoSave.dataset.logoSave));
    return;
  }
  const lookup = e.target.closest("[data-fetch-crests]");
  if (lookup) {
    lookupCrests(Number(lookup.dataset.fetchCrests));
    return;
  }
  const apply = e.target.closest("[data-apply-crests]");
  if (apply) {
    applyCrestChoices(Number(apply.dataset.applyCrests));
    return;
  }
  const cf = e.target.closest("[data-coupon-filter]");
  if (cf) {
    couponFilter = cf.dataset.couponFilter;
    couponLimit = COUPON_PAGE;
    renderCoupons();
    return;
  }
  const pvEdit = e.target.closest("[data-pv-edit]");
  if (pvEdit) {
    const fi = Number(pvEdit.dataset.pvEdit);
    draftEditOpen.has(fi) ? draftEditOpen.delete(fi) : draftEditOpen.add(fi);
    renderPreview();
    return;
  }
  const markedToggle = e.target.closest("[data-marked-toggle]");
  if (markedToggle) {
    matchMarkedOpen = !matchMarkedOpen;
    const fold = markedToggle.closest(".fold");
    fold.classList.toggle("is-open", matchMarkedOpen);
    markedToggle.setAttribute("aria-expanded", String(matchMarkedOpen));
    return;
  }
  const removeDraft = e.target.closest("[data-remove-draft]");
  if (removeDraft) {
    const [fi, mi] = removeDraft.dataset.removeDraft.split(":").map(Number);
    draftSelections[fi]?.markets.splice(mi, 1);
    draftSelections = draftSelections.filter((f) => f.markets.length);
    renderPreview();
    return;
  }
  const exm = e.target.closest("[data-expand]");
  if (exm) {
    const box = $(exm.dataset.expand);
    if (box) {
      const opening = box.classList.contains("hidden");
      box.classList.toggle("hidden");
      exm.setAttribute("aria-expanded", String(opening));
      const badge = exm.querySelector(".badge");
      if (badge)
        badge.textContent = badge.textContent.replace(/[⌄⌃]/g, "").trim() + (opening ? "　⌃" : "　⌄");
    }
  }
  const v = e.target.closest("button[data-view], a[data-view]");
  if (v) go(v.dataset.view);
  const g = e.target.closest("[data-go]");
  if (g) go(g.dataset.go);
  const st = e.target.closest("[data-status]");
  if (st) setMarketStatus(st.dataset.status, st.dataset.value);
  const rm = e.target.closest("[data-remove]");
  if (rm && confirm("¿Eliminar este cupón?")) {
    const coupon = db.coupons.find((c) => c.id === rm.dataset.remove);
    if (coupon) {
      pushCouponAction({
        type: "delete",
        coupon: JSON.parse(JSON.stringify(coupon)),
        transactions: JSON.parse(JSON.stringify(db.transactions.filter((t) => t.couponId === coupon.id))),
        at: new Date().toISOString(),
      });
      const txIds = db.transactions.filter((t) => t.couponId === coupon.id).map((t) => t.id);
      db.coupons = db.coupons.filter((c) => c.id !== coupon.id);
      db.transactions = db.transactions.filter((t) => t.couponId !== coupon.id);
      markDeleted("coupons", coupon.id);
      markDeleted("transactions", txIds);
      save();
      renderAll();
      toast("Cupón eliminado. Puedes deshacerlo desde Cupones guardados.");
    }
  }
  const ex = e.target.closest("[data-exportone]");
  if (ex) {
    const c = db.coupons.find((c) => c.id === ex.dataset.exportone);
    if (c) download("KAL-cupon.json", JSON.stringify(c, null, 2));
  }
  const det = e.target.closest("[data-detail]");
  if (det) {
    const c = db.coupons.find((c) => c.id === det.dataset.detail);
    if (c) {
      $("raw").value = c.raw || "";
      window.__kalLastParsedRaw = c.raw || "";
      editingCouponId = c.id;
      draftSelections = JSON.parse(JSON.stringify(c.fixtures));
      $("couponName").value = c.name;
      $("couponHouse").value = c.houseId || "";
      $("couponType").value = c.type;
      $("stake").value = c.stake;
      $("totalOdds").value = c.odds;
      $("bonus").value = c.bonus;
      $("payout").value = c.payout;
      $("notes").value = c.notes || "";
      $("autoStakeTx").checked = !!c.stakeTxId;
      draftDuplicateCount = 0;
      renderPreview();
      go("new");
      toast("Cupón cargado para editar. Guarda para actualizar este registro.");
    }
  }
  const hr = e.target.closest("[data-house-remove]");
  if (hr && confirm("¿Eliminar esta casa? Los movimientos históricos quedarán registrados.")) {
    db.houses = db.houses.filter((h) => h.id !== hr.dataset.houseRemove);
    markDeleted("houses", hr.dataset.houseRemove);
    save();
    renderAll();
  }
});
try {
  const saved = localStorage.getItem(KEY);
  if (saved) {
    const d = JSON.parse(saved);
    db = {
      coupons: Array.isArray(d.coupons) ? d.coupons : [],
      houses: Array.isArray(d.houses) ? d.houses : [],
      transactions: Array.isArray(d.transactions) ? d.transactions : [],
      resultHistory: Array.isArray(d.resultHistory) ? d.resultHistory : [],
      actionHistory: Array.isArray(d.actionHistory) ? d.actionHistory : [],
      deleted: d.deleted && typeof d.deleted === "object" ? d.deleted : {},
      settings: d.settings && typeof d.settings === "object" ? d.settings : {},
      progress: d.progress && typeof d.progress === "object" ? d.progress : {},
    };
  } else {
    const old = JSON.parse(localStorage.getItem(OLD) || "[]");
    if (Array.isArray(old) && old.length) {
      db.coupons = old
        .filter((c) => Array.isArray(c.matches))
        .map((c) => ({
          id: c.id || uid(),
          name: c.name || "Cupón importado",
          created: c.created || new Date().toISOString(),
          updated: c.updated || new Date().toISOString(),
          raw: c.raw || "",
          houseId: "",
          type: c.matches.length > 1 ? "parlay" : "simple",
          stake: 0,
          odds: 0,
          bonus: 0,
          payout: 0,
          notes: "Importado de versión anterior",
          fixtures: c.matches.map((m) => ({
            id: m.id || uid(),
            home: m.home || "Local",
            away: m.away || "Visitante",
            league: m.league || "",
            date: m.date || "",
            dateISO: m.dateISO || "",
            time: m.time || "",
            markets: [
              {
                market: m.market || "Mercado no identificado",
                pick: m.pick || "",
                odd: m.odd || "",
                settlement: "pending",
                builder: false,
              },
            ],
          })),
        }));
    }
  }
} catch (e) {
  db = { coupons: [], houses: [], transactions: [] };
}
