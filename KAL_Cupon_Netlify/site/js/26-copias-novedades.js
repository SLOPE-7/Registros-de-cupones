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
    stats: d.stats && typeof d.stats === "object" ? d.stats : {},
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
  // Se compara con lo que había guardado al abrir: el arranque puede haber guardado después (migraciones).
  const local = kalLoadedState.found;
  const localAt = Date.parse(kalLoadedState.savedAt || "") || 0,
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
const APP_VERSION = "21.3";
const NOVEDADES = [
  {
    v: "21.3",
    titulo: "Pestañas del partido y nombres de equipos",
    items: [
      "◎ La ficha del partido queda con las pestañas que sí aportan: Mercados, Datos y Cupones. Se quitaron Análisis, Estadísticas y Eventos, que dependían de un plan de pago y nunca traían datos.",
      "🔎 football-data.org ahora reconoce más nombres en inglés (Cologne, Munich, Wolves, Spurs…) y, si no encuentra el partido, explica por qué.",
      "🛡️ Cologne y otros equipos con nombre en inglés ya encuentran su escudo.",
    ],
  },
  {
    v: "21.2",
    titulo: "Revisión general",
    items: [
      "🧱 La app ya no se rompe con respaldos antiguos o datos incompletos (cupones sin partidos o partidos sin mercados).",
      "🌱 Nuevo comienzo y “Borrar cupones” ya no se deshacen solos con la sincronización: la nube no devuelve lo borrado.",
      "📴 Funciona sin conexión con todas las funciones nuevas.",
      "♿ Etiquetas enlazadas en los formularios, casillas y botones más grandes y mejor contraste en el tema claro.",
      "🧹 Limpieza: código sin uso eliminado y cabeceras de seguridad añadidas.",
    ],
  },
  {
    v: "21.1",
    titulo: "Corregir el resultado de un cupón",
    items: [
      "🛠 En Cupones guardados, cada cupón tiene “Corregir resultado”: ves todos sus mercados y cambias cualquiera (ganado, perdido, nulo o pendiente), o marcas todo ganado o todo pendiente.",
      "Sirve también para quitar un cash out puesto por error.",
      "Los cambios quedan en el historial de resultados y se pueden deshacer.",
    ],
  },
  {
    v: "21",
    titulo: "Nuevo comienzo",
    items: [
      "🌱 En Ajustes: “Empezar de cero con mi banca”. Guarda una copia, borra cupones, casas y movimientos, y deja la banca nueva con reglas claras.",
      "Conserva escudos, logos, banderas, fotos de jugadores y tus registros de partidos.",
      "Reglas sanas por defecto: unidad del 1 % de la banca, máximo 3 selecciones, pausa tras 2 perdidos seguidos y presupuesto mensual del 30 %.",
    ],
  },
  {
    v: "20.4",
    titulo: "Enlace de Doradobet",
    items: [
      "🔗 El enlace de “Compartir enlace” de Doradobet no trae el boleto (su web lo pide a un servicio privado). Si lo pegas, la app te avisa y te lleva al texto o a la captura.",
      "Lo más corto que sí funciona: copiar el texto del boleto y tocar 📋 Pegar, o 📷 Leer captura o PDF.",
    ],
  },
  {
    v: "20.1",
    titulo: "Leer el boleto desde un PDF",
    items: [
      "📄 “Leer captura o PDF” ahora acepta el PDF del boleto de Doradobet: toca 🖨️ en tu cupón → compartir → Guardar en Archivos, y elígelo en la app.",
      "Trae todo el boleto en una hoja (todos los partidos, cuota total, valor apostado, bono y ganancia), sin hacer scroll.",
    ],
  },
  {
    v: "20",
    titulo: "Captura de boletos y etiquetas de estrategia",
    items: [
      "📷 Leer captura: elige la imagen de tu boleto y el Analista la convierte en cupón (necesita tu código de acceso).",
      "📋 Pegar: pega el texto o la imagen que tengas copiada, con un toque.",
      "🏷️ Etiquetas de estrategia en cada cupón (Remates, Goles, Combinada…), sugeridas solas al leer el boleto.",
      "📊 En Estadísticas: acierto y rentabilidad por etiqueta.",
    ],
  },
  {
    v: "19",
    titulo: "Salud de tu banca y convertidor de cuotas",
    items: [
      "🩺 En Estadísticas: yield, últimos 20 cupones, caída máxima, rachas y cuánto estás por debajo de tu mejor momento.",
      "🧮 Convertidor de cuotas: decimal, americana, fraccional y probabilidad.",
      "📉 Margen de la casa: escribe las cuotas de un partido y ves cuánto se queda la casa y las probabilidades reales.",
    ],
  },
  {
    v: "18.1",
    titulo: "Goleadores y jugadores en el partido en vivo",
    items: [
      "＋ Seguir jugador: en el marcador en vivo puedes añadir a cualquier jugador (aunque no tenga mercado) y anotar sus remates, remates a puerta y goles.",
      "⚽ Cada jugador tiene su contador de Goles: al sumar uno también sube el marcador de su equipo; al restarlo se revierte.",
      "＋ Goleador siempre visible para anotar quién marcó.",
      "Todo alimenta los registros y promedios de cada jugador, y el Analista los usa.",
    ],
  },
  {
    v: "18",
    titulo: "Tus registros de equipos y jugadores",
    items: [
      "📒 Cada equipo o selección guarda lo que anotas: goles a favor y en contra, córners y tarjetas, con el promedio de sus últimos 5 partidos.",
      "👤 Cada jugador se liga al equipo con el que jugó (club o selección) y a la competición, con su promedio de remates y remates a puerta.",
      "⚽ En cada gol puedes anotar quién lo hizo; también cuenta como registro del jugador.",
      "🤖 El Analista recibe tus registros de los equipos y jugadores de cada cupón y los combina con la actualidad.",
      "Los verás en la ficha del partido → 📈 Datos y en Estadísticas.",
    ],
  },
  {
    v: "17",
    titulo: "El partido en vivo",
    items: [
      "⚽ Marcador por equipo: goles, córners y tarjetas de cada equipo, con el resultado en la cabecera y animación de gol.",
      "🏁 “Terminó el partido” confirma el marcador final y marca solos 1X2, doble oportunidad, ambos marcan y apuesta sin empate.",
      "🔗 “Empate o 2” y “Empate o Senegal” ya son un solo mercado.",
      "↩️ Toca de nuevo un estado marcado para desmarcarlo.",
      "🤖 “Analizar este partido” en la ficha; cada mercado muestra la probabilidad y la confianza del Analista.",
      "🏳️ Banderas automáticas para selecciones y búsqueda de logos en español e inglés.",
    ],
  },
  {
    v: "16.5",
    titulo: "Marcador en vivo y Analista en cada cupón",
    items: [
      "📊 Marcador en vivo por partido: goles, córners, tarjetas y, por jugador, Remates (tiros totales) y Remates a puerta, como en Sofascore. Toca el número para escribirlo.",
      "🔗 El mismo mercado en varios cupones se cuenta una sola vez y se marca solo al superarse.",
      "🧾 Lee el boleto antes de apostar y te pide valor apostado, bono y ganancia total.",
      "🤖 “Analizar este cupón ahora” en Nuevo cupón; el análisis se guarda dentro del cupón.",
      "✅ Cuando el cupón se resuelve, te dice si el Analista lo vio venir, y en Estadísticas ves su acierto.",
    ],
  },
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
