// Espacio en el teléfono: el navegador da unos 5 MB para los datos de la app.
// La limpieza quita solo lo que no se usa (nunca cupones, resultados, escudos ni fotos en uso):
// - el texto original pegado de los cupones ya liquidados (se conserva en los 40 más recientes y en los
//   pendientes, que es lo que usa la detección de la casa por formato);
// - el historial largo de "deshacer" de cupones, que guarda copias completas;
// - el progreso de mercados que ya no existen y las imágenes subidas que nadie usa;
// - búsquedas de escudos guardadas en caché.
"use strict";

const STORAGE_LIMIT = 5 * 1024 * 1024; // estimación prudente del límite del navegador
const KEEP_RAW = 40;

function storageUsage() {
  let chars = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      chars += k.length + (localStorage.getItem(k) || "").length;
    }
  } catch {}
  const bytes = chars * 2; // el navegador guarda el texto a 2 bytes por carácter
  return { bytes, percent: Math.min(100, Math.round((bytes / STORAGE_LIMIT) * 100)) };
}
const fmtSize = (b) =>
  b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";

// Devuelve cuántos bytes liberó. Con deep=true también vacía la caché de búsquedas.
function compactData(deep = false) {
  const before = storageUsage().bytes;
  const keep = new Set(db.coupons.slice(0, KEEP_RAW).map((c) => c.id));
  db.coupons.forEach((c) => {
    if (c.raw && !keep.has(c.id) && calcCoupon(c).status !== "pending") delete c.raw;
  });
  if ((db.actionHistory || []).length > 20) db.actionHistory = db.actionHistory.slice(-20);
  // Progreso de mercados que ya no están en ningún cupón
  const liveKeys = new Set();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) => f.markets.forEach((m) => liveKeys.add(marketKey(f, m)))),
  );
  Object.keys(db.progress || {}).forEach((k) => {
    if (!liveKeys.has(k)) delete db.progress[k];
  });
  // Imágenes subidas que ya nadie usa
  try {
    const used = new Set();
    const mark = (v) => typeof v === "string" && v.startsWith("kalimg:") && used.add(v.slice(7));
    Object.values(readCrestDirectory()).forEach((x) => {
      mark(x?.url);
      mark(x?.photo);
    });
    db.coupons.forEach((c) =>
      c.fixtures.forEach((f) => ["homeCrest", "awayCrest", "leagueCrest"].forEach((k) => mark(f[k]))),
    );
    Object.values(db.progress || {}).forEach((p) => mark(p?.sub?.photo));
    const images = { ...localImages() };
    let removed = false;
    Object.keys(images).forEach((id) => {
      if (!used.has(id)) {
        delete images[id];
        removed = true;
      }
    });
    if (removed) localStorage.setItem(IMG_STORE, JSON.stringify(images));
  } catch {}
  if (deep) {
    try {
      localStorage.removeItem(CREST_CACHE);
    } catch {}
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {}
  return Math.max(0, before - storageUsage().bytes);
}

function renderStorageBox() {
  const el = $("storageBox");
  if (!el) return;
  const u = storageUsage(),
    level = u.percent >= 85 ? "over" : u.percent >= 60 ? "warn" : "ok";
  el.innerHTML =
    '<div class="storage-row"><span><b>' +
    fmtSize(u.bytes) +
    "</b> de ~5 MB · " +
    db.coupons.length +
    " cupones</span><span>" +
    u.percent +
    "%</span></div>" +
    '<div class="budget-bar storage-bar is-' +
    level +
    '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
    u.percent +
    '"><i style="width:' +
    Math.max(2, u.percent) +
    '%"></i></div>' +
    '<p class="small muted">' +
    (level === "ok"
      ? "✓ Hay espacio de sobra."
      : level === "warn"
        ? "⚠️ Se está llenando. La app limpia sola lo que no se usa."
        : "⛔ Casi lleno: libera espacio y descarga un respaldo.") +
    " La limpieza no borra cupones, resultados, escudos ni fotos en uso.</p>" +
    '<button type="button" class="btn" data-compact>🧹 Liberar espacio ahora</button>';
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-compact]")) return;
  const freed = compactData(true);
  renderStorageBox();
  toast(freed > 1024 ? "Liberé " + fmtSize(freed) + "." : "Ya estaba todo limpio.");
});

// Limpieza automática al abrir cuando hay muchos cupones o el espacio pasa del 60 %.
function autoCompact() {
  if (db.coupons.length > KEEP_RAW + 10 || storageUsage().percent >= 60) compactData(false);
}
