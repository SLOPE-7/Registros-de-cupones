// Núcleo: claves de almacenamiento, estado global (db), utilidades ($, esc, uid, toast, money) y guardado.
"use strict";
const KEY = "kal_coupon_organizer_v2",
  OLD = "kal_coupon_organizer_v1",
  DRAFT = "kal_coupon_v2_draft";
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
let db = { coupons: [], houses: [], transactions: [], resultHistory: [], actionHistory: [] },
  draftSelections = [],
  draftDuplicateCount = 0,
  activeView = "home",
  editingCouponId = null,
  calendarMatchRefs = [],
  marketMatchRefs = [],
  currentMatchRef = null,
  matchActiveTab = "markets",
  matchApiData = {},
  matchPlayerPhotos = {},
  playerBetRefs = {},
  pageScrollBeforeModal = 0,
  modalBodyStyles = null;
function toast(s) {
  const el = $("toast");
  el.textContent = s;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}
function money(n) {
  return (
    "L " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
const cleanTeamLogo = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(.*?\)\s*$/, "")
    .replace(/\bcompetitor\s+logo\b/gi, "")
    .replace(/^[\s:|•·-]+|[\s:|•·-]+$/g, "")
    .trim();
const validTeamLogo = (s) => {
  const t = cleanTeamLogo(s);
  return (
    !!t && !/^(?:logo|competitor|competitor logo|vs\.?|v)$/i.test(t) && !/^[0-9]+(?:[.,][0-9]+)?$/.test(t)
  );
};
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    toast("El navegador no permitió guardar. Libera espacio o usa otro navegador; tus datos no se borraron.");
    return false;
  }
  try {
    localStorage.setItem(DRAFT, $("raw").value);
  } catch (e) {}
  if (cloudSession) queueCloudSync();
  return true;
}
function parseMoney(s) {
  if (!s) return null;
  let v = String(s).replace(/[L$\s]/gi, "");
  const comma = v.lastIndexOf(","),
    dot = v.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const last = Math.max(comma, dot),
      tail = v.length - last - 1;
    v = tail <= 2 ? v.slice(0, last).replace(/[,.]/g, "") + "." + v.slice(last + 1) : v.replace(/[,.]/g, "");
  } else if (comma >= 0) {
    const tail = v.length - comma - 1;
    v = tail === 1 || tail === 2 ? v.replace(",", ".") : v.replace(/,/g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Imágenes subidas desde el teléfono. Se guardan UNA vez aquí (id → imagen) y en escudos, fotos y partidos
// solo se guarda la referencia corta "kalimg:<id>" (antes la imagen entera se copiaba en cada partido).
const IMG_STORE = "kal_images_v1";
let localImagesRaw = null,
  localImagesMap = {};
function localImages() {
  let raw = null;
  try {
    raw = localStorage.getItem(IMG_STORE);
  } catch {}
  if (raw !== localImagesRaw) {
    localImagesRaw = raw;
    try {
      localImagesMap = JSON.parse(raw || "{}") || {};
    } catch {
      localImagesMap = {};
    }
  }
  return localImagesMap;
}
function storeLocalImage(dataUrl) {
  const map = { ...localImages() };
  const same = Object.entries(map).find(([, v]) => v === dataUrl);
  if (same) return "kalimg:" + same[0];
  const id = uid();
  map[id] = dataUrl;
  localStorage.setItem(IMG_STORE, JSON.stringify(map)); // si no hay espacio lanza un error que ve quien llama
  return "kalimg:" + id;
}
// Convierte una referencia "kalimg:<id>" en la imagen; cualquier otra dirección se devuelve igual.
function resolveImage(url) {
  const u = String(url || "");
  return u.startsWith("kalimg:") ? localImages()[u.slice(7)] || "" : u;
}
