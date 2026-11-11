// Escudos y logos: catálogo local, caché de imágenes (IndexedDB) y búsqueda en API-Football.
"use strict";
const CREST_CACHE = "kal_auto_crest_cache_v2";
let crestChoices = {};
function crestNorm(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CREST_DIR = "kal_saved_crest_directory_v1",
  LOGO_HIDDEN = "kal_hidden_teams_v1",
  LOGO_TRASH = "kal_logo_trash_v1",
  CLOUD_CFG = "kal_cloud_config_v1",
  CLOUD_SESSION = "kal_cloud_session_v1";
let cloudSession = null,
  cloudSyncTimer = null;
try {
  cloudSession = JSON.parse(localStorage.getItem(CLOUD_SESSION) || "null");
} catch {}
function readCrestDirectory() {
  try {
    return JSON.parse(localStorage.getItem(CREST_DIR) || "{}");
  } catch {
    return {};
  }
}
function readLogoTrash() {
  try {
    return JSON.parse(localStorage.getItem(LOGO_TRASH) || "{}");
  } catch {
    return {};
  }
}
function writeLogoTrash(x) {
  localStorage.setItem(LOGO_TRASH, JSON.stringify(x));
  if (cloudSession) queueCloudSync();
}
function addLogoTrash(kind, id, item) {
  const t = readLogoTrash();
  t[kind + ":" + id] = {
    kind,
    id,
    name: item.name || "Elemento",
    country: item.country || "",
    club: item.club || "",
    url: item.url || "",
    photo: item.photo || "",
    teamCode: item.teamCode || "",
    deletedAt: Date.now(),
  };
  writeLogoTrash(t);
}
function restoreLogoTrash(key) {
  const t = readLogoTrash(),
    x = t[key];
  if (!x) return;
  if (x.kind === "team") {
    const h = new Set(JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"));
    h.delete(x.id);
    localStorage.setItem(LOGO_HIDDEN, JSON.stringify([...h]));
  }
  delete t[key];
  writeLogoTrash(t);
  renderLogos();
  toast(x.name + " volvió a la lista.");
}
function hideLogoEntity(kind, item) {
  addLogoTrash(kind, item.key, item);
  if (kind === "team") {
    const h = new Set(JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"));
    h.add(item.key);
    localStorage.setItem(LOGO_HIDDEN, JSON.stringify([...h]));
  }
  renderLogos();
  toast(item.name + " se movió a Eliminados.");
}
function renderLogoTrash() {
  const el = $("logoTrashList");
  if (!el) return;
  const t = readLogoTrash(),
    hidden = JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"),
    dir = readCrestDirectory();
  hidden.forEach((key) => {
    if (t["team:" + key]) return;
    let item = dir[key];
    if (!item) {
      for (const c of db.coupons || [])
        for (const f of c.fixtures || [])
          for (const [side, name] of [
            ["home", f.home],
            ["away", f.away],
          ])
            if (savedCrestKey("team", name) === key)
              item = {
                name,
                country: f.country || "",
                url: f[side === "home" ? "homeCrest" : "awayCrest"] || "",
              };
    }
    if (item)
      t["team:" + key] = {
        kind: "team",
        id: key,
        name: item.name || key.replace(/^team:/, ""),
        country: item.country || "",
        url: item.url || "",
        deletedAt: Date.now(),
      };
  });
  localStorage.setItem(LOGO_TRASH, JSON.stringify(t));
  const items = Object.entries(t);
  el.innerHTML = items.length
    ? items
        .sort((a, b) => (b[1].deletedAt || 0) - (a[1].deletedAt || 0))
        .map(
          ([k, x]) =>
            '<article class="logo-card"><div class="logo-card-top"><span class="team-fallback">◈</span><div class="logo-team-info"><strong>' +
            esc(x.name) +
            "</strong><span>" +
            esc(x.kind === "team" ? "Equipo" : x.kind === "league" ? "Liga o competencia" : "Jugador") +
            " · " +
            esc(x.club || x.country || "") +
            '</span></div></div><div class="logo-card-actions"><button class="btn good sm" data-logo-restore="' +
            esc(k) +
            '">Recuperar</button></div></article>',
        )
        .join("")
    : '<div class="empty logo-empty"><strong>No hay elementos eliminados</strong>Los elementos ocultados podrán recuperarse aquí.</div>';
}
function savedCrestKey(kind, name) {
  return kind + ":" + crestNorm(name);
}
function rememberFixtureCrests(f) {
  const dir = readCrestDirectory();
  for (const [kind, name, url] of [
    ["team", f.home, f.homeCrest],
    ["team", f.away, f.awayCrest],
    ["league", f.competition || f.league, f.leagueCrest],
  ]) {
    if (!name || !/^https?:\/\//i.test(String(url || ""))) continue;
    dir[savedCrestKey(kind, name)] = { name, url, country: f.country || "", savedAt: Date.now() };
  }
  if (f.country && f.countryFlag)
    dir[savedCrestKey("country", f.countryCode || f.country)] = {
      name: f.country,
      code: f.countryCode || "",
      url: f.countryFlag,
      savedAt: Date.now(),
    };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch (e) {
    toast("No se pudo guardar el catálogo local de escudos.");
  }
}
// Copia del catálogo válida solo durante la pasada de dibujo actual (se descarta al terminar el turno),
// para no leer y descifrar localStorage una vez por cada partido.
let crestDirTick = null;
function crestDirectoryForRender() {
  if (!crestDirTick) {
    crestDirTick = readCrestDirectory();
    queueMicrotask(() => {
      crestDirTick = null;
    });
  }
  return crestDirTick;
}
function applySavedCrests(f) {
  const dir = crestDirectoryForRender();
  if (!f.countryFlag) f.countryFlag = dir[savedCrestKey("country", f.countryCode || f.country)]?.url || "";
  if (!f.homeCrest) f.homeCrest = dir[savedCrestKey("team", f.home)]?.url || "";
  if (!f.awayCrest) f.awayCrest = dir[savedCrestKey("team", f.away)]?.url || "";
  if (!f.leagueCrest) f.leagueCrest = dir[savedCrestKey("league", f.competition || f.league)]?.url || "";
  if (!f.country) {
    f.country =
      dir[savedCrestKey("team", f.home)]?.country || dir[savedCrestKey("team", f.away)]?.country || "";
  }
  return f;
}
function indexSavedCrests() {
  db.coupons.forEach((c) => (c.fixtures || []).forEach(rememberFixtureCrests));
}
const CREST_IMAGE_DB = "kal_crest_images_v1",
  crestImageJobs = new Map(),
  crestObjectUrls = new Map();
let crestDbPromise;
function openCrestImageDB() {
  if (!("indexedDB" in window)) return Promise.reject(Error("IndexedDB no disponible"));
  if (!crestDbPromise)
    crestDbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(CREST_IMAGE_DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("images"))
          r.result.createObjectStore("images", { keyPath: "url" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return crestDbPromise;
}
async function readCrestImage(url) {
  const d = await openCrestImageDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("images", "readonly"),
      r = tx.objectStore("images").get(url);
    r.onsuccess = () => resolve(r.result?.blob || null);
    r.onerror = () => reject(r.error);
  });
}
async function writeCrestImage(url, blob) {
  const d = await openCrestImageDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("images", "readwrite");
    tx.objectStore("images").put({ url, blob, cachedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadCrestImage(url) {
  url = resolveImage(url);
  if (!url) return null;
  if (crestImageJobs.has(url)) return crestImageJobs.get(url);
  const job = (async () => {
    try {
      const cached = await readCrestImage(url);
      if (cached) return cached;
    } catch (e) {}
    // Imagen subida desde el teléfono: ya está dentro de la app.
    if (/^data:image\//i.test(url)) return await (await fetch(url)).blob();
    if (location.protocol === "file:") return null;
    const response = await fetch("/.netlify/functions/logo?url=" + encodeURIComponent(url));
    if (!response.ok) throw Error("No se pudo descargar este escudo.");
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type) || blob.size > 2000000)
      throw Error("El archivo del escudo no es válido.");
    try {
      await writeCrestImage(url, blob);
    } catch (e) {}
    return blob;
  })();
  crestImageJobs.set(url, job);
  try {
    return await job;
  } finally {
    crestImageJobs.delete(url);
  }
}
function safeCrestSource(url) {
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(String(url || ""))) return true;
  try {
    const u = new URL(url);
    if (
      u.protocol === "https:" &&
      /^(?:r2|www)\.thesportsdb\.com$/i.test(u.hostname) &&
      /^\/images\/media\/[a-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(u.pathname)
    )
      return true;
    return (
      u.protocol === "https:" &&
      /^media(?:-\d+)?\.api-sports\.io$/i.test(u.hostname) &&
      (/^\/football\/(?:teams|leagues)\/\d+\.png$/i.test(u.pathname) ||
        /^\/flags\/[a-z]{2}\.svg$/i.test(u.pathname))
    );
  } catch (e) {
    return false;
  }
}
async function showCrestImage(img) {
  const url = img.dataset.crestUrl;
  if (!url || img.dataset.crestLoading) return;
  img.dataset.crestLoading = "1";
  const fallback = img.nextElementSibling,
    showFallback = () => {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    },
    useDirect = () => {
      if (!safeCrestSource(url)) return false;
      img.onload = () => {
        if (fallback) fallback.hidden = true;
      };
      img.onerror = () => {
        img.onerror = null;
        showFallback();
      };
      img.hidden = false;
      if (fallback) fallback.hidden = true;
      img.src = url;
      return true;
    };
  try {
    let objectUrl = crestObjectUrls.get(url);
    if (!objectUrl) {
      const blob = await loadCrestImage(url);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        crestObjectUrls.set(url, objectUrl);
      }
    }
    if (objectUrl) {
      img.onerror = () => {
        img.onerror = null;
        if (!useDirect()) showFallback();
      };
      img.src = objectUrl;
      img.hidden = false;
      if (fallback) fallback.hidden = true;
    } else if (location.protocol === "file:") {
      img.onerror = () => {
        img.onerror = null;
        showFallback();
      };
      img.src = url;
      img.hidden = false;
      if (fallback) fallback.hidden = true;
    } else if (!useDirect()) showFallback();
  } catch (e) {
    if (!useDirect()) showFallback();
  }
}
function initCrestImageCache() {
  const scan = (root) => {
    if (root.nodeType === 1 && root.matches?.("img[data-crest-url]")) showCrestImage(root);
    root.querySelectorAll?.("img[data-crest-url]").forEach(showCrestImage);
  };
  new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(scan))).observe(
    document.body,
    { childList: true, subtree: true },
  );
  scan(document.body);
}

function crestCacheRead() {
  try {
    return JSON.parse(localStorage.getItem(CREST_CACHE) || "{}");
  } catch {
    return {};
  }
}
async function lookupCrests(fi, force = false) {
  const f = draftSelections[fi];
  if (!f) return;
  applySavedCrests(f);
  const needsHome = !f.homeCrest || force,
    needsAway = !f.awayCrest || force,
    needsLeague = !f.leagueCrest || force;
  if (!needsHome && !needsAway && !needsLeague) {
    renderPreview();
    toast("Escudos cargados desde el catálogo guardado en este dispositivo.");
    return;
  }
  if (location.protocol === "file:") {
    toast("La búsqueda automática se activa al publicar la app en Cloudflare.");
    return;
  }
  const box = $("crest-result-" + fi),
    button = document.querySelector('[data-fetch-crests="' + fi + '"]');
  if (!box) return;
  box.textContent = "Buscando equipos y competición…";
  if (button) button.disabled = true;
  const params = new URLSearchParams({
      home: needsHome ? f.home || "" : "",
      away: needsAway ? f.away || "" : "",
      league: needsLeague ? f.competition || f.league || "" : "",
      country: f.country || "",
    }),
    cache = crestCacheRead(),
    cacheKey = crestNorm([params.get("home"), params.get("away"), params.get("league"), f.country].join("|"));
  try {
    let data = force ? null : cache[cacheKey];
    if (!data) {
      const r = await fetch("/.netlify/functions/escudos?" + params.toString(), {
        headers: { Accept: "application/json" },
      });
      data = await r.json();
      // Si API-Football falla (cuota, plan…), se sigue con TheSportsDB.
      if (!r.ok)
        data = { home: { options: [] }, away: { options: [] }, league: { options: [] }, error: data.error };
      else cache[cacheKey] = data;
      const keys = Object.keys(cache);
      if (keys.length > 200) delete cache[keys[0]];
      localStorage.setItem(CREST_CACHE, JSON.stringify(cache));
    }
    const [tsHome, tsAway] = await Promise.all([
      needsHome ? tsdbSearch("equipo", f.home).catch(() => []) : [],
      needsAway ? tsdbSearch("equipo", f.away).catch(() => []) : [],
    ]);
    data = {
      ...data,
      home: { options: [...(data.home?.options || []), ...tsHome] },
      away: { options: [...(data.away?.options || []), ...tsAway] },
    };
    crestChoices[fi] = data;
    const field = (key, label) => {
      const items = data[key]?.options || [];
      if (!items.length) return '<div class="marketmeta">' + label + ": sin coincidencias</div>";
      return (
        '<label class="small muted">' +
        label +
        '<select class="input" id="crest-' +
        key +
        "-" +
        fi +
        '">' +
        items
          .map(
            (x, i) =>
              '<option value="' +
              i +
              '">' +
              esc(x.name) +
              (x.country ? " · " + esc(x.country) : "") +
              (x.source === "TheSportsDB" ? " (TheSportsDB)" : "") +
              "</option>",
          )
          .join("") +
        "</select></label>"
      );
    };
    const any = ["home", "away", "league"].some((k) => (data[k]?.options || []).length);
    box.innerHTML = any
      ? '<div class="meta-edit">' +
        field("home", "Equipo local") +
        field("away", "Equipo visitante") +
        field("league", "Liga / competencia") +
        '</div><button type="button" class="btn good sm" data-apply-crests="' +
        fi +
        '">✓ Aplicar selecciones</button><span class="marketmeta"> Revisa que los nombres coincidan antes de aplicar.</span>'
      : "No encontré coincidencias. Puedes pegar las URL manualmente.";
  } catch (e) {
    box.textContent = e.message || "Falló la búsqueda. Puedes pegar las URL manualmente.";
  } finally {
    if (button) button.disabled = false;
  }
}
async function applyCrestChoices(fi) {
  const f = draftSelections[fi],
    data = crestChoices[fi];
  if (!f || !data) return;
  for (const k of ["home", "away", "league"]) {
    const select = $("crest-" + k + "-" + fi),
      choice = select && data[k]?.options?.[Number(select.value)];
    if (!choice) continue;
    if (k === "home") {
      f.homeCrest = choice.logo || "";
      if (!f.country && choice.country) f.country = choice.country;
    } else if (k === "away") {
      f.awayCrest = choice.logo || "";
      if (!f.country && choice.country) f.country = choice.country;
    } else {
      f.leagueCrest = choice.logo || "";
      if (choice.name) {
        f.competition = choice.name;
        f.league = choice.name;
      }
      if (choice.country) f.country = choice.country;
      if (choice.countryCode) f.countryCode = choice.countryCode;
      if (choice.countryFlag) f.countryFlag = choice.countryFlag;
    }
  }
  rememberFixtureCrests(f);
  renderPreview();
  await Promise.allSettled([f.homeCrest, f.awayCrest, f.leagueCrest].filter(Boolean).map(loadCrestImage));
  toast("Logos guardados para futuros cupones en este dispositivo.");
}
