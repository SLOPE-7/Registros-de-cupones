// V21 · Nuevo comienzo: reinicia cupones, casas, movimientos y banca con una copia de seguridad antes.
// Conserva escudos, logos, banderas y fotos de jugadores (viven aparte de los cupones), el tema, el código del
// Analista y, salvo que se pida lo contrario, los registros de partidos (promedios de equipos y jugadores).

const FRESH_CONFIRM = "EMPEZAR";
const FRESH_UNITS = [
  ["1", "1 % · conservador"],
  ["1.5", "1.5 %"],
  ["2", "2 % · máximo sano"],
];

function freshStartHtml() {
  return (
    '<div class="news-sheet reset-sheet"><h2>🌱 Nuevo comienzo</h2>' +
    '<p class="small">Una banca sana se construye con porcentajes fijos, no con rachas. Antes de borrar se guarda una copia: se descarga un archivo y queda en <b>Copias automáticas</b> (Ajustes) para recuperarla si te arrepientes.</p>' +
    "<section><h3>✅ Se conserva</h3><ul><li>Escudos, logos de ligas, banderas y fotos de jugadores</li><li>Tu código del Analista, el tema y las etiquetas</li><li>Tus registros de partidos (promedios de equipos y jugadores)</li></ul></section>" +
    "<section><h3>🗑️ Se borra</h3><ul><li>Cupones, movimientos, casas y balances</li><li>Historial de resultados y la banca y presupuesto anteriores</li></ul>" +
    '<label class="small reset-check"><input type="checkbox" id="rsStats"> También borrar mis registros de partidos</label></section>' +
    "<h3>💰 Tu nueva banca</h3>" +
    '<p class="small muted">Pon solo dinero que puedas perder sin que te afecte. Puedes repartirlo en dos casas.</p>' +
    '<div class="row"><div class="field"><label for="rsCasa1">Casa 1</label><input class="input" id="rsCasa1" list="rsCasas" value="Doradobet"></div>' +
    '<div class="field"><label for="rsMonto1">Monto (L)</label><input class="input" id="rsMonto1" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></div></div>' +
    '<div class="row"><div class="field"><label for="rsCasa2">Casa 2 (opcional)</label><input class="input" id="rsCasa2" list="rsCasas" placeholder="Hondubet"></div>' +
    '<div class="field"><label for="rsMonto2">Monto (L)</label><input class="input" id="rsMonto2" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></div></div>' +
    '<datalist id="rsCasas">' +
    BOOKMAKERS.map((b) => '<option value="' + esc(b.name) + '">').join("") +
    "</datalist>" +
    '<div class="field"><label>Unidad (% de tu banca por apuesta)</label><div class="chips" id="rsUnit" role="group" aria-label="Unidad">' +
    FRESH_UNITS.map(
      ([v, l]) =>
        '<button type="button" class="chip' +
        (v === "1" ? " active" : "") +
        '" data-rs-unit="' +
        v +
        '">' +
        l +
        "</button>",
    ).join("") +
    "</div></div>" +
    '<div class="row"><div class="field"><label for="rsMax">Máx. selecciones por cupón</label><input class="input" id="rsMax" type="number" min="1" max="10" value="3" inputmode="numeric"></div>' +
    '<div class="field"><label for="rsPause">Pausa tras N perdidos seguidos</label><input class="input" id="rsPause" type="number" min="2" max="10" value="2" inputmode="numeric"></div></div>' +
    '<div class="field"><label for="rsBudget">Presupuesto mensual (L)</label><input class="input" id="rsBudget" type="number" min="0" step="1" inputmode="decimal" placeholder="Sugerido: 30 % de la banca"></div>' +
    '<div class="notice small" id="rsResumen" aria-live="polite">Escribe el monto de tu banca para ver tus reglas.</div>' +
    '<div class="field"><label for="rsConfirm">Para confirmar escribe <b>' +
    FRESH_CONFIRM +
    "</b></label>" +
    '<input class="input" id="rsConfirm" autocomplete="off" autocapitalize="characters"></div>' +
    '<div class="row"><button type="button" class="btn danger" id="rsGo" disabled>Empezar de cero</button>' +
    '<button type="button" class="btn" data-reset-close>Cancelar</button></div></div>'
  );
}

function freshForm() {
  const casas = [1, 2]
    .map((n) => ({
      name: ($("rsCasa" + n).value || "").trim().slice(0, 40),
      monto: Number($("rsMonto" + n).value) || 0,
    }))
    .filter((c) => c.name && c.monto > 0);
  const total = casas.reduce((s, c) => s + c.monto, 0),
    unidadPct = Number(document.querySelector("#rsUnit .chip.active")?.dataset.rsUnit) || 1,
    clamp = (id, min, max, def) => {
      const v = Math.round(Number($(id).value));
      return v >= min && v <= max ? v : def;
    };
  return {
    casas,
    total,
    unidadPct,
    maxSel: clamp("rsMax", 1, 10, 3),
    pausaTras: clamp("rsPause", 2, 10, 2),
    presupuesto: Number($("rsBudget").value) > 0 ? Number($("rsBudget").value) : Math.round(total * 0.3),
    borrarStats: $("rsStats").checked,
  };
}
function freshRefresh() {
  const f = freshForm(),
    unit = (f.total * f.unidadPct) / 100;
  $("rsResumen").innerHTML = f.total
    ? "<b>Tus reglas:</b> banca " +
      money(f.total) +
      " · 1 unidad = <b>" +
      money(unit) +
      "</b> (" +
      f.unidadPct +
      " %) · cupón de confianza máxima: " +
      money(unit * 2) +
      " · máx. " +
      f.maxSel +
      " selecciones · tras " +
      f.pausaTras +
      " perdidos seguidos la unidad baja a la mitad · presupuesto " +
      money(f.presupuesto) +
      " al mes."
    : "Escribe el monto de tu banca para ver tus reglas.";
  const typed = ($("rsConfirm").value || "").trim().toUpperCase() === FRESH_CONFIRM;
  $("rsGo").disabled = !(f.total > 0 && typed);
}
if (typeof BOOKMAKERS === "undefined") window.BOOKMAKERS = [];

async function runFreshStart() {
  const f = freshForm();
  if (!(f.total > 0)) return;
  $("rsGo").disabled = true;
  try {
    backup(); // descarga el archivo de respaldo
  } catch {}
  try {
    await snapshotNow("Antes de nuevo comienzo");
  } catch {}
  const now = new Date().toISOString();
  // Marcas de borrado: así la sincronización con la nube no devuelve los cupones, casas y movimientos viejos.
  markDeleted(
    "coupons",
    db.coupons.map((c) => c.id),
  );
  markDeleted(
    "houses",
    db.houses.map((h) => h.id),
  );
  markDeleted(
    "transactions",
    db.transactions.map((t) => t.id),
  );
  const resto = { ...db };
  ["coupons", "houses", "transactions", "resultHistory", "actionHistory", "settings", "progress"].forEach(
    (k) => delete resto[k],
  );
  if (f.borrarStats) {
    delete resto.stats;
    resto.statsClearedAt = now;
  }
  resto.resetAt = now;
  db = {
    ...resto,
    coupons: [],
    houses: f.casas.map((c) => ({ id: uid(), name: c.name, initial: c.monto })),
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    settings: {
      banca: { monto: 0, unidadPct: f.unidadPct, maxSel: f.maxSel, pausaTras: f.pausaTras },
      budget: f.presupuesto,
      nuevoComienzo: { at: now, banca: f.total },
      updatedAt: now,
    },
  };
  draftSelections = [];
  editingCouponId = null;
  hitRateCache = null;
  try {
    localStorage.removeItem(DRAFT);
    [...Array(localStorage.length).keys()]
      .map((i) => localStorage.key(i))
      .filter((k) => k && /^(kal_budget_alert_|kal_streak_snooze|kal_inapp_shown)/.test(k))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
  $("raw").value = "";
  if (typeof resetDraftTags === "function") resetDraftTags();
  save();
  if (typeof queueCloudSync === "function") queueCloudSync();
  document.querySelector(".news-wrap")?.remove();
  renderAll();
  go("home");
  toast("🌱 Nuevo comienzo listo. Tu copia de seguridad quedó guardada.");
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-fresh-start]")) {
    document.querySelector(".news-wrap")?.remove();
    const w = document.createElement("div");
    w.className = "news-wrap";
    w.setAttribute("role", "dialog");
    w.setAttribute("aria-modal", "true");
    w.setAttribute("aria-label", "Nuevo comienzo");
    w.innerHTML = freshStartHtml();
    document.body.appendChild(w);
    freshRefresh();
    return;
  }
  const u = e.target.closest("[data-rs-unit]");
  if (u) {
    document.querySelectorAll("#rsUnit .chip").forEach((c) => c.classList.toggle("active", c === u));
    freshRefresh();
    return;
  }
  if (e.target.closest("[data-reset-close]")) {
    document.querySelector(".news-wrap")?.remove();
    return;
  }
  if (e.target.closest("#rsGo")) runFreshStart();
});
document.addEventListener("input", (e) => {
  if (e.target.closest(".reset-sheet")) freshRefresh();
});

(function initNuevoComienzo() {
  const wipe = $("wipeBtn");
  if (!wipe) return;
  wipe.insertAdjacentHTML(
    "beforebegin",
    '<h3>🌱 Nuevo comienzo</h3><p class="small muted">Empieza de cero con una banca nueva y porcentajes claros. Conserva tus escudos, logos, banderas y fotos de jugadores, y guarda una copia antes de borrar.</p><button type="button" class="btn gold" data-fresh-start>🌱 Empezar de cero con mi banca</button>',
  );
})();
