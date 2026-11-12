// Sincronización con Supabase: combinar datos, iniciar sesión, subir y bajar cambios.
"use strict";
function mergeDatabases(local, remote) {
  const deleted = {};
  for (const k of ["coupons", "houses", "transactions"])
    deleted[k] = [...new Set([...(local.deleted?.[k] || []), ...(remote.deleted?.[k] || [])])].slice(-2000);
  const stamp = (x) => Date.parse(x?.updated || x?.created || x?.date || 0) || 0;
  const merge = (a, b, kind) => {
    const gone = new Set(deleted[kind] || []),
      m = new Map();
    [...(a || []), ...(b || [])].forEach((x) => {
      const id = x?.id || JSON.stringify(x);
      if (gone.has(id)) return;
      const prev = m.get(id);
      if (!prev || stamp(x) > stamp(prev)) m.set(id, x);
    });
    return [...m.values()];
  };
  const list = (a, b) => {
    const m = new Map();
    [...(a || []), ...(b || [])].forEach((x) => m.set(x?.id || [x?.key, x?.at, x?.type].join("|"), x));
    return [...m.values()].sort((x, y) => String(x.at || "").localeCompare(String(y.at || ""))).slice(-200);
  };
  const coupons = merge(local.coupons, remote.coupons, "coupons").sort((a, b) =>
    String(b.created || "").localeCompare(String(a.created || "")),
  );
  return {
    ...local,
    coupons,
    houses: merge(local.houses, remote.houses, "houses"),
    transactions: merge(local.transactions, remote.transactions, "transactions"),
    resultHistory: list(local.resultHistory, remote.resultHistory),
    actionHistory: (local.actionHistory || []).slice(-100),
    deleted,
    stats: (() => {
      const out = { ...(remote.stats || {}) };
      Object.entries(local.stats || {}).forEach(([k, v]) => {
        if (!out[k] || String(v?.updatedAt || "") >= String(out[k]?.updatedAt || "")) out[k] = v;
      });
      return out;
    })(),
    statsMigrated: !!(local.statsMigrated || remote.statsMigrated),
    progress: (() => {
      const out = { ...(remote.progress || {}) };
      Object.entries(local.progress || {}).forEach(([k, v]) => {
        if (!out[k] || String(v?.updatedAt || "") >= String(out[k]?.updatedAt || "")) out[k] = v;
      });
      return out;
    })(),
    settings:
      String(remote.settings?.updatedAt || "") > String(local.settings?.updatedAt || "")
        ? remote.settings
        : local.settings || {},
  };
}
// Combina catálogos de escudos/fotos: conserva la entrada guardada más recientemente.
function mergeLogoStores(incoming) {
  const parse = (v, d) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : v || d;
    } catch {
      return d;
    }
  };
  const inDir = parse(incoming.dir, {}),
    dir = readCrestDirectory();
  Object.entries(inDir).forEach(([k, v]) => {
    if (!dir[k] || (v?.savedAt || 0) > (dir[k]?.savedAt || 0)) dir[k] = v;
  });
  const hidden = new Set([...parse(localStorage.getItem(LOGO_HIDDEN), []), ...parse(incoming.hidden, [])]);
  const trash = { ...parse(incoming.trash, {}), ...readLogoTrash() };
  // Imágenes subidas desde el teléfono: se juntan las de los dos lados.
  const images = { ...parse(incoming.images, {}), ...localImages() };
  try {
    if (Object.keys(images).length) localStorage.setItem(IMG_STORE, JSON.stringify(images));
  } catch (e) {}
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
    localStorage.setItem(LOGO_HIDDEN, JSON.stringify([...hidden]));
    localStorage.setItem(LOGO_TRASH, JSON.stringify(trash));
  } catch (e) {
    toast("No se pudo guardar el catálogo de logos en este dispositivo.");
  }
}
async function cloudRequest(url, options = {}) {
  let r = await fetch(url, { ...options, headers: cloudHeaders(options.headers || {}) });
  if (r.status === 401 && cloudSession?.refresh_token) {
    const c = cloudCfg(),
      refresh = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: cloudSession.refresh_token }),
      });
    if (refresh.ok) {
      cloudSession = await cloudJson(refresh);
      localStorage.setItem(CLOUD_SESSION, JSON.stringify(cloudSession));
      r = await fetch(url, { ...options, headers: cloudHeaders(options.headers || {}) });
    }
  }
  return r;
}
// Acepta la dirección de Supabase como venga: con o sin "https://", con rutas pegadas (/rest/v1…) o solo el
// identificador del proyecto (20 letras). Devuelve "" si no es una dirección válida.
function normalizeCloudUrl(v) {
  let s = String(v || "").replace(/\s+/g, "");
  if (!s) return "";
  if (/^[a-z0-9]{20}$/i.test(s)) s = s.toLowerCase() + ".supabase.co";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.hostname.includes(".") ? "https://" + u.host : "";
  } catch {
    return "";
  }
}
function cloudCfg() {
  const c = JSON.parse(localStorage.getItem(CLOUD_CFG) || "{}");
  return {
    url: normalizeCloudUrl($("cloudUrl").value || c.url),
    // La clave no lleva espacios ni saltos de línea (a veces se cuelan al copiar y pegar).
    key: String($("cloudAnon").value || c.key || "").replace(/\s+/g, ""),
  };
}
// Lee la respuesta como JSON; si no lo es, explica el problema en vez del mensaje técnico del navegador.
async function cloudJson(r) {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Error(
      "La dirección de Supabase no respondió como Supabase. Revisa que sea https://TU-PROYECTO.supabase.co",
    );
  }
}
function cloudMsg(x) {
  $("cloudStatus").textContent = x;
}
function cloudHeaders(extra = {}) {
  const c = cloudCfg();
  return {
    apikey: c.key,
    Authorization: "Bearer " + (cloudSession?.access_token || c.key),
    "Content-Type": "application/json",
    ...extra,
  };
}
async function cloudAuth(mode) {
  const c = cloudCfg(),
    email = $("cloudEmail").value.trim(),
    password = $("cloudPassword").value;
  if (!c.url && $("cloudUrl").value.trim()) {
    cloudMsg("La dirección de Supabase no es válida. Debe ser como https://TU-PROYECTO.supabase.co");
    return;
  }
  if (!c.url || !c.key || !email || password.length < 8) {
    cloudMsg("Completa URL, clave pública, correo y contraseña de al menos 8 caracteres.");
    return;
  }
  localStorage.setItem(CLOUD_CFG, JSON.stringify(c));
  $("cloudUrl").value = c.url;
  $("cloudAnon").value = c.key;
  const r = await fetch(
      c.url + (mode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password"),
      { method: "POST", headers: cloudHeaders(), body: JSON.stringify({ email, password }) },
    ),
    d = await cloudJson(r);
  if (!r.ok) {
    const raw = String(d.msg || d.message || d.error_description || d.error || "");
    const known = [
      [/invalid login credentials/i, "Correo o contraseña incorrectos."],
      [/email not confirmed/i, "Confirma tu correo (revisa tu bandeja) y luego inicia sesión."],
      [/user already registered/i, "Ese correo ya tiene cuenta: usa «Iniciar sesión»."],
      [/invalid api key|no api key/i, "La clave pública (anon) de Supabase no es correcta."],
    ].find(([re]) => re.test(raw));
    throw Error(known ? known[1] : raw || "No se pudo autenticar (error " + r.status + ").");
  }
  if (!d.access_token) {
    cloudMsg("Cuenta creada. Confirma tu correo y luego inicia sesión.");
    return;
  }
  cloudSession = d;
  localStorage.setItem(CLOUD_SESSION, JSON.stringify(d));
  await cloudPull();
  $("cloudPassword").value = "";
  cloudMsg("Sesión activa: " + email);
}
async function cloudPull() {
  if (!cloudSession) return;
  const c = cloudCfg(),
    r = await cloudRequest(
      c.url +
        "/rest/v1/kal_user_data?user_id=eq." +
        encodeURIComponent(cloudSession.user.id) +
        "&select=payload",
      { headers: cloudHeaders() },
    );
  if (!r.ok) throw Error("Falta crear la tabla o habilitar sus permisos.");
  const rows = await cloudJson(r);
  if (rows.length) {
    const remote = rows[0].payload || {};
    mergeLogoStores({
      dir: remote._kalLogos,
      hidden: remote._kalHiddenTeams,
      trash: remote._kalLogoTrash,
      images: remote._kalImages,
    });
    delete remote._kalLogos;
    delete remote._kalHiddenTeams;
    delete remote._kalLogoTrash;
    delete remote._kalImages;
    db = mergeDatabases(db, remote);
    localStorage.setItem(KEY, JSON.stringify(db));
    renderAll();
  }
  await cloudPush();
}
async function cloudPush() {
  if (!cloudSession) return;
  const c = cloudCfg(),
    r = await cloudRequest(c.url + "/rest/v1/kal_user_data?on_conflict=user_id", {
      method: "POST",
      headers: cloudHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        user_id: cloudSession.user.id,
        payload: {
          ...db,
          _kalLogos: localStorage.getItem(CREST_DIR) || "{}",
          _kalHiddenTeams: localStorage.getItem(LOGO_HIDDEN) || "[]",
          _kalLogoTrash: localStorage.getItem(LOGO_TRASH) || "{}",
          _kalImages: localStorage.getItem(IMG_STORE) || "{}",
        },
        updated_at: new Date().toISOString(),
      }),
    });
  if (!r.ok) throw Error("No se pudieron sincronizar datos. Revisa la tabla.");
}
function queueCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(
    () =>
      cloudPush()
        .then(() => cloudMsg("Sincronizado " + new Date().toLocaleTimeString("es-HN")))
        .catch((e) => cloudMsg("Guardado local; sincronización: " + e.message)),
    1000,
  );
}
async function manualCloudSync() {
  const b = $("cloudSync");
  if (!cloudSession) {
    cloudMsg("Inicia sesión antes de sincronizar.");
    return;
  }
  b.disabled = true;
  b.textContent = "Sincronizando…";
  cloudMsg("Sincronizando cupones y escudos…");
  try {
    await cloudPull();
    cloudMsg("Sincronización completada · " + new Date().toLocaleTimeString("es-HN"));
  } catch (e) {
    cloudMsg("No se pudo sincronizar: " + (e.message || "revisa la conexión y la configuración"));
  } finally {
    b.disabled = false;
    b.textContent = "Sincronizar ahora";
  }
}
function initCloud() {
  const c = JSON.parse(localStorage.getItem(CLOUD_CFG) || "{}");
  $("cloudUrl").value = c.url || "";
  $("cloudAnon").value = c.key || "";
  $("cloudSignup").onclick = () => cloudAuth("signup").catch((e) => cloudMsg(e.message));
  $("cloudLogin").onclick = () => cloudAuth("login").catch((e) => cloudMsg(e.message));
  $("cloudSync").onclick = manualCloudSync;
  $("cloudLogout").onclick = () => {
    cloudSession = null;
    localStorage.removeItem(CLOUD_SESSION);
    cloudMsg("Sesión cerrada. Los datos locales siguen en este dispositivo.");
  };
}
