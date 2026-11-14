// Escudos y fotos desde dos fuentes más:
// 1) TheSportsDB (API pública y gratuita): se consulta junto con API-Football y se muestran ambas.
// 2) Imagen del teléfono: eliges una foto o captura, se recorta a un cuadrado pequeño y se guarda
//    dentro de la app (también viaja con la sincronización y los respaldos).
"use strict";

// --- TheSportsDB ---
async function tsdbSearch(tipo, q, club = "") {
  if (location.protocol === "file:" || String(q || "").trim().length < 3) return [];
  const r = await fetch("/api/imagenes?" + new URLSearchParams({ tipo, q, club }), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "No se pudo consultar TheSportsDB.");
  return Array.isArray(d.options) ? d.options : [];
}

// --- Búsqueda en varias fuentes a la vez, en español e inglés (football-data.org, Wikipedia, TheSportsDB y
//     banderas). tipo: "equipo" | "liga" | "pais" ---
async function logoSearch(tipo, q, pais = "") {
  if (location.protocol === "file:" || String(q || "").trim().length < 2) return [];
  const r = await fetch("/api/buscar-logo?" + new URLSearchParams({ tipo, q, pais }), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "No se pudo buscar el logo.");
  return Array.isArray(d.options) ? d.options : [];
}

// --- Imagen del teléfono → cuadrado de 192 px (WebP o PNG, conserva la transparencia) ---
const UPLOAD_SIZE = 192;
async function imageFileToDataUrl(file) {
  if (!file || !/^image\//i.test(file.type)) throw Error("Elige una imagen.");
  if (file.size > 15e6) throw Error("La imagen es demasiado grande.");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("No se pudo leer la imagen."));
      i.src = src;
    });
    const scale = Math.min(1, UPLOAD_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)),
      h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = cv.height = UPLOAD_SIZE;
    cv.getContext("2d").drawImage(img, (UPLOAD_SIZE - w) / 2, (UPLOAD_SIZE - h) / 2, w, h);
    const webp = cv.toDataURL("image/webp", 0.86);
    return webp.startsWith("data:image/webp") ? webp : cv.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(src);
  }
}

// --- Guardar escudo de equipo (en el catálogo y en todos sus partidos) ---
function setTeamCrest(teamName, url, country = "") {
  const key = savedCrestKey("team", teamName),
    dir = readCrestDirectory();
  dir[key] = {
    name: cleanTeamLogo(teamName),
    url,
    country: country || dir[key]?.country || "",
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch {
    toast("No hay espacio para guardar el escudo en este teléfono.");
    return false;
  }
  const apply = (f) => {
    if (crestNorm(f.home) === crestNorm(teamName)) f.homeCrest = url;
    if (crestNorm(f.away) === crestNorm(teamName)) f.awayCrest = url;
  };
  db.coupons.forEach((c) => (c.fixtures || []).forEach(apply));
  draftSelections.forEach(apply);
  save();
  if (cloudSession) queueCloudSync();
  loadCrestImage(url).catch(() => null);
  renderAll();
  return true;
}

// --- Guardar foto de jugador (en Logos; la usan las tarjetas de mercado y la ficha) ---
function setPlayerPhoto({
  name,
  club = "",
  code = "",
  country = "",
  photo,
  playerId = "",
  marketKey: mk = "",
  aliases = [],
}) {
  const dir = readCrestDirectory();
  const id =
    playerId || "local-" + crestNorm(name).replace(/\s+/g, "-") + "-" + crestNorm(club).replace(/\s+/g, "-");
  const all = new Set([name, ...aliases].filter(Boolean));
  Object.entries(dir).forEach(([k, item]) => {
    if (!k.startsWith("player:")) return;
    if (k === "player:" + id || (samePlayerName(item.name, name) && samePlayerClub(item.club, club))) {
      (item.aliases || []).forEach((a) => all.add(a));
      if (item.name) all.add(item.name);
      if (k !== "player:" + id) delete dir[k];
    }
  });
  dir["player:" + id] = {
    kind: "player",
    playerId: id,
    name,
    aliases: [...all],
    club,
    teamCode: code,
    country,
    photo,
    url: photo,
    marketKey: mk,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch {
    toast("No hay espacio para guardar la foto en este teléfono.");
    return false;
  }
  if (mk) matchPlayerPhotos[mk] = resolveImage(photo);
  if (cloudSession) queueCloudSync();
  renderLogos();
  if (currentMatchRef) renderMatchDetail();
  return true;
}

// --- Selector de imagen del teléfono (un solo <input> para toda la app) ---
let uploadTarget = null;
const uploadInput = document.createElement("input");
uploadInput.type = "file";
uploadInput.accept = "image/*";
uploadInput.hidden = true;
document.body.appendChild(uploadInput);
function pickImage(target) {
  uploadTarget = target;
  uploadInput.value = "";
  uploadInput.click();
}
uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files?.[0],
    t = uploadTarget;
  uploadTarget = null;
  if (!file || !t) return;
  try {
    const url = storeLocalImage(await imageFileToDataUrl(file));
    if (t.kind === "team") {
      if (setTeamCrest(t.name, url, t.country)) toast("Escudo de " + t.name + " guardado desde tu teléfono.");
    } else if (t.kind === "league") {
      await saveCatalogLogo("league", t.name, url, t.country || "");
    } else if (t.kind === "player") {
      if (setPlayerPhoto({ ...t, photo: url })) toast("Foto de " + t.name + " guardada.");
    } else if (t.kind === "sub") {
      const p = progressOf(t.key);
      if (p.sub) {
        db.progress[t.key] = { ...p, sub: { ...p.sub, photo: url }, updatedAt: new Date().toISOString() };
        save();
        renderAll();
        toast("Foto del suplente guardada.");
      }
    }
  } catch (e) {
    toast(e.message || "No se pudo usar esa imagen.");
  }
});

// --- Resultados de búsqueda de escudos con miniatura y fuente (se toca uno para guardarlo) ---
function crestOptionsHTML(options, attr) {
  return (
    '<div class="img-opts">' +
    options
      .map(
        (o, i) =>
          '<button type="button" class="img-opt" ' +
          attr +
          '="' +
          i +
          '">' +
          crestHTML(o.logo || o.photo, o.name) +
          "<span><b>" +
          esc(o.name) +
          "</b><small>" +
          esc([o.team, o.country, o.league].filter(Boolean).join(" · ")) +
          "</small></span>" +
          '<em class="src ' +
          (o.source === "TheSportsDB" ? "tsdb" : o.source === "API-Football" || !o.source ? "af" : "alt") +
          '">' +
          esc(o.source || "API-Football") +
          "</em></button>",
      )
      .join("") +
    "</div>"
  );
}

// --- Botones ---
document.addEventListener("click", (e) => {
  const opt = e.target.closest("[data-logo-opt]");
  if (opt) {
    const team = logoManagerTeams[Number(opt.dataset.logoOpt)],
      o = team && logoLookupState[team.key]?.[Number(opt.dataset.opt)];
    if (o?.logo && setTeamCrest(team.name, o.logo, o.country))
      toast("Escudo guardado para " + team.name + " (" + (o.source || "API-Football") + ").");
    return;
  }
  const rq = e.target.closest("[data-logo-requery]");
  if (rq)
    return lookupSavedTeamLogo(
      Number(rq.dataset.logoRequery),
      $("logo-q-" + rq.dataset.logoRequery)?.value.trim() || "",
    );
  const up = e.target.closest("[data-logo-upload]");
  if (up) {
    const team = logoManagerTeams[Number(up.dataset.logoUpload)];
    if (team) pickImage({ kind: "team", name: team.name, country: team.country || "" });
    return;
  }
  const lu = e.target.closest("[data-league-upload]");
  if (lu) {
    const l = collectLogoLeagues().find((x) => x.key === lu.dataset.leagueUpload);
    if (l) pickImage({ kind: "league", name: l.name, country: l.country || "" });
    return;
  }
  const pu = e.target.closest("[data-player-upload]");
  if (pu) {
    const p = collectPlayerBets().find((x) => x.id === pu.dataset.playerUpload);
    if (p)
      pickImage({
        kind: "player",
        name: p.name,
        club: p.club || "",
        code: p.code || "",
        country: p.country || "",
        marketKey: p.marketKey || "",
        aliases: p.aliases || [],
      });
    return;
  }
  const sp = e.target.closest("[data-pg-sub-photo]");
  if (sp) pickImage({ kind: "sub", key: sp.dataset.pgSubPhoto });
});

// Una sola vez: las imágenes subidas que quedaron copiadas enteras (versión anterior) pasan a referencia.
function migrateInlineImages() {
  let changed = false;
  const ref = (v) => {
    if (typeof v !== "string" || !v.startsWith("data:image/")) return v;
    changed = true;
    try {
      return storeLocalImage(v);
    } catch {
      return v;
    }
  };
  const dir = readCrestDirectory();
  Object.values(dir).forEach((item) => {
    if (!item) return;
    if (item.url) item.url = ref(item.url);
    if (item.photo) item.photo = ref(item.photo);
  });
  const dirChanged = changed;
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      for (const k of ["homeCrest", "awayCrest", "leagueCrest"]) if (f[k]) f[k] = ref(f[k]);
    }),
  );
  Object.values(db.progress || {}).forEach((p) => {
    if (p?.sub?.photo) p.sub.photo = ref(p.sub.photo);
  });
  if (dirChanged)
    try {
      localStorage.setItem(CREST_DIR, JSON.stringify(dir));
    } catch {}
  return changed;
}
