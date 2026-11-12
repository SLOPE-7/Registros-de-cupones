// Copias de seguridad automáticas y "Novedades" (V16).
// - Espejo: cada vez que se guarda, una copia de los datos va también a IndexedDB (mucho más espacio que el
//   almacenamiento normal). Si el almacenamiento normal se pierde o se queda atrás, al abrir se recupera solo.
// - Copias automáticas: una por semana (y antes de importar, borrar o restaurar). Se guardan las 6 últimas y se
//   pueden restaurar o descargar desde Ajustes.
// - Novedades: al abrir una versión nueva se muestra qué cambió (también desde Ajustes).
"use strict";

const BACKUP_DB = "kal-copias",
  BACKUP_STORE = "kv",
  MAX_SNAPSHOTS = 6;
function backupDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BACKUP_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(BACKUP_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const d = await backupDb();
  return new Promise((res, rej) => {
    const q = d.transaction(BACKUP_STORE).objectStore(BACKUP_STORE).get(key);
    q.onsuccess = () => res(q.result ?? null);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(key, value) {
  const d = await backupDb();
  return new Promise((res, rej) => {
    const t = d.transaction(BACKUP_STORE, "readwrite");
    t.objectStore(BACKUP_STORE).put(value, key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

function backupPayload() {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    db,
    logos: {
      dir: readCrestDirectory(),
      hidden: JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"),
      trash: readLogoTrash(),
      images: localImages(),
    },
  };
}

// ---------- Espejo ----------
let mirrorTimer = null;
function queueMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => mirrorNow().catch(() => {}), 1200);
}
async function mirrorNow() {
  await idbSet("espejo", { savedAt: db.savedAt || new Date().toISOString(), data: JSON.stringify(db) });
}
function normalizedDb(d) {
  return {
    ...d,
    coupons: Array.isArray(d.coupons) ? d.coupons : [],
    houses: Array.isArray(d.houses) ? d.houses : [],
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    resultHistory: Array.isArray(d.resultHistory) ? d.resultHistory : [],
    actionHistory: Array.isArray(d.actionHistory) ? d.actionHistory : [],
    deleted: d.deleted && typeof d.deleted === "object" ? d.deleted : {},
    settings: d.settings && typeof d.settings === "object" ? d.settings : {},
    progress: d.progress && typeof d.progress === "object" ? d.progress : {},
  };
}
// Al abrir: si el espejo es más nuevo que lo guardado (o no hay nada guardado), se recupera.
async function recoverFromMirror() {
  let m;
  try {
    m = await idbGet("espejo");
  } catch {
    return false;
  }
  if (!m?.data) {
    if (db.coupons.length) queueMirror();
    return false;
  }
  const local = localStorage.getItem(KEY);
  const localAt = Date.parse(db.savedAt || "") || 0,
    mirrorAt = Date.parse(m.savedAt || "") || 0;
  if (local && mirrorAt <= localAt + 1000) return false;
  let d;
  try {
    d = normalizedDb(JSON.parse(m.data));
  } catch {
    return false;
  }
  if (!d.coupons.length && db.coupons.length) return false;
  db = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {}
  renderAll();
  toast("Recuperé tus datos de la copia interna del teléfono.");
  return true;
}

// ---------- Copias automáticas ----------
async function snapshots() {
  try {
    return (await idbGet("copias")) || [];
  } catch {
    return [];
  }
}
async function snapshotNow(motivo = "Copia manual") {
  if (!db.coupons.length && !db.houses.length) return null;
  // Los datos se copian ya, antes de cualquier espera (quien llama puede reemplazarlos justo después).
  const snap = {
    id: uid(),
    at: new Date().toISOString(),
    motivo,
    cupones: db.coupons.length,
    data: JSON.stringify(backupPayload()),
  };
  const list = await snapshots();
  list.unshift(snap);
  try {
    await idbSet("copias", list.slice(0, MAX_SNAPSHOTS));
  } catch {
    return null;
  }
  return snap;
}
async function autoSnapshot() {
  const list = await snapshots();
  const lastWeekly = list.find((s) => s.motivo === "Copia semanal");
  if (!lastWeekly || Date.now() - Date.parse(lastWeekly.at) > 7 * 86400000)
    await snapshotNow("Copia semanal");
}
async function restoreSnapshot(id) {
  const snap = (await snapshots()).find((s) => s.id === id);
  if (!snap) return toast("No encontré esa copia.");
  if (
    !confirm(
      "¿Restaurar la copia del " +
        new Date(snap.at).toLocaleString("es-HN") +
        " (" +
        snap.cupones +
        " cupones)? Antes se guardará una copia de lo que tienes ahora.",
    )
  )
    return;
  await snapshotNow("Antes de restaurar");
  const obj = JSON.parse(snap.data);
  db = normalizedDb(obj.db || obj);
  db.deleted = {};
  if (obj.logos) mergeLogoStores(obj.logos);
  indexSavedCrests();
  save();
  renderAll();
  toast("Copia restaurada.");
}
async function downloadSnapshot(id) {
  const snap = (await snapshots()).find((s) => s.id === id);
  if (snap) download("KAL-copia-" + snap.at.slice(0, 10) + ".json", snap.data);
}
async function renderSnapshotBox() {
  const el = $("snapshotBox");
  if (!el) return;
  const list = await snapshots();
  el.innerHTML =
    '<p class="small muted">Una copia por semana, y otra antes de importar, borrar o restaurar. Se guardan las ' +
    MAX_SNAPSHOTS +
    " últimas en este teléfono.</p>" +
    (list.length
      ? '<div class="snap-list">' +
        list
          .map(
            (s) =>
              '<div class="snap-row"><div><b>' +
              esc(
                new Date(s.at).toLocaleDateString("es-HN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              ) +
              "</b><small>" +
              esc(s.motivo) +
              " · " +
              s.cupones +
              " cupones · " +
              fmtSize(s.data.length * 2) +
              '</small></div><button type="button" class="btn sm" data-snap-download="' +
              esc(s.id) +
              '" aria-label="Descargar esta copia">⬇</button><button type="button" class="btn sm" data-snap-restore="' +
              esc(s.id) +
              '">Restaurar</button></div>',
          )
          .join("") +
        "</div>"
      : '<div class="empty small">Aún no hay copias.</div>') +
    '<button type="button" class="btn" data-snap-now>🛟 Crear copia ahora</button>';
}

// ---------- Novedades ----------
const APP_VERSION = "16";
const NOVEDADES = [
  {
    v: "16",
    titulo: "Control, valor y datos",
    items: [
      "🛑 Antes de guardar un cupón: probabilidad real, partidos repetidos, selecciones de relleno y monto sugerido.",
      "🏦 Gestión de banca en Ajustes: unidad, límite de selecciones y pausa tras una racha.",
      "⭐ Confianza de 1 a 5 y motivo en cada cupón, con su rendimiento en Estadísticas.",
      "📈 Cuota de cierre por mercado y valor frente al cierre (CLV).",
      "🧮 Calculadora de valor y comparador de casas en el Analista.",
      "📊 Pestaña “Datos” en la ficha del partido: forma, tabla, enfrentamientos y modelo de goles.",
      "🤖 Analista: “Mi semana” y “Armar cupones”; la revisión usa tu riesgo calculado.",
      "🛟 Copias automáticas en el teléfono, restaurables desde Ajustes.",
    ],
  },
  {
    v: "15",
    titulo: "Mudanza a Cloudflare",
    items: [
      "☁️ La app ahora vive en Cloudflare: sin límite de publicaciones.",
      "🔔 Avisos de partidos rehechos para Cloudflare.",
      "🧹 Estadísticas: una sola Champions/Europa/Conference/Nations y cuota de BetBuilder sin inflar.",
    ],
  },
];
function showNews() {
  document.querySelector(".news-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "news-wrap";
  w.setAttribute("role", "dialog");
  w.setAttribute("aria-modal", "true");
  w.setAttribute("aria-label", "Novedades");
  w.innerHTML =
    '<div class="news-sheet"><h2>🆕 Novedades</h2>' +
    NOVEDADES.map(
      (n) =>
        "<section><h3>Versión " +
        esc(n.v) +
        " · " +
        esc(n.titulo) +
        "</h3><ul>" +
        n.items.map((i) => "<li>" + esc(i) + "</li>").join("") +
        "</ul></section>",
    ).join("") +
    '<button type="button" class="btn gold" data-news-close>Entendido</button></div>';
  document.body.appendChild(w);
}
function maybeShowNews() {
  const seen = readLS("kal_version_vista");
  writeLS("kal_version_vista", APP_VERSION);
  if (seen === APP_VERSION) return;
  // A quien abre la app por primera vez (sin datos) no se le muestra.
  if (!seen && !db.coupons.length) return;
  showNews();
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-news-close]") || e.target.classList?.contains("news-wrap")) {
    document.querySelector(".news-wrap")?.remove();
    return;
  }
  if (e.target.closest("[data-news-open]")) return showNews();
  const r = e.target.closest("[data-snap-restore]");
  if (r) return restoreSnapshot(r.dataset.snapRestore).then(renderSnapshotBox);
  const d = e.target.closest("[data-snap-download]");
  if (d) return downloadSnapshot(d.dataset.snapDownload);
  if (e.target.closest("[data-snap-now]"))
    snapshotNow("Copia manual").then((s) => {
      toast(s ? "Copia creada." : "No hay datos que copiar.");
      renderSnapshotBox();
    });
});
