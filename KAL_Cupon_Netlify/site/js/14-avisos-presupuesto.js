// Avisos de partidos (notificaciones y dentro de la app), presupuesto mensual y rachas.
"use strict";
const ALERTS_KEY = "kal_alerts_v1";
function alertCfg() {
  try {
    return {
      enabled: false,
      lead: 15,
      alStart: true,
      inApp: true,
      ...JSON.parse(localStorage.getItem(ALERTS_KEY) || "{}"),
    };
  } catch {
    return { enabled: false, lead: 15, alStart: true, inApp: true };
  }
}
function saveAlertCfg(c) {
  writeLS(ALERTS_KEY, JSON.stringify(c));
}
const pushSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  location.protocol !== "file:";
function b64ToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4),
    b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
// Texto corto de un mercado para la notificación, p. ej. "Más de 1.5 goles" o "Nico Paz: Más de 0.5".
function shortMarket(m, f) {
  const bet = parsePlayerBet(m, f),
    pick = String(m.pick || "")
      .replace(/\s*[•·]\s*pago anticipado/i, "")
      .trim();
  let s = bet ? bet.name + (pick ? ": " + pick : "") : (m.market || "") + (pick ? " " + pick : "");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 38 ? s.slice(0, 37) + "…" : s;
}
function upcomingMatches() {
  const now = Date.now(),
    open = openCouponIds();
  return agendaGroups()
    .groups.filter(
      (g) =>
        g.pending &&
        g.start &&
        g.start.getTime() > now - 20 * 60000 &&
        g.start.getTime() < now + 7 * 86400000,
    )
    .sort((a, b) => a.start - b.start)
    .map((g) => {
      const live = g.markets
          .filter((x) => marketIsActive(x.m, x.coupons, open))
          .map((x) => shortMarket(x.m, x.f)),
        list = live.slice(0, 3).join(", ") + (live.length > 3 ? " y " + (live.length - 3) + " más" : ""),
        hhmm = g.start.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit", hour12: false });
      return {
        id: fixtureKey(g.f).slice(0, 120),
        name: g.f.home + " vs " + g.f.away,
        title: g.f.home + " vs " + g.f.away + " · " + hhmm,
        body:
          "🏆 " +
          (g.f.competition || g.f.league || "Partido") +
          " · " +
          live.length +
          " mercado" +
          (live.length === 1 ? "" : "s") +
          ": " +
          list,
        kickoff: g.start.toISOString(),
        start: g.start,
      };
    });
}
async function pushSubscription(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const r = await fetch("/.netlify/functions/avisos?accion=clave");
    const d = await r.json();
    if (!r.ok || !d.publicKey) throw Error(d.error || "No se pudo preparar el servicio de avisos.");
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(d.publicKey),
    });
  }
  return sub;
}
async function postAlerts(body) {
  const r = await fetch("/.netlify/functions/avisos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "El servicio de avisos no respondió.");
  return d;
}
let alertsSyncTimer = null;
function queueAlertsSync() {
  clearTimeout(alertsSyncTimer);
  alertsSyncTimer = setTimeout(() => syncAlerts().catch(() => {}), 2500);
}
async function syncAlerts(force = false) {
  const c = alertCfg();
  if (!c.enabled || !pushSupported() || Notification.permission !== "granted") return;
  const sub = await pushSubscription(true);
  const matches = upcomingMatches().map(({ start, ...m }) => m),
    payload = { accion: "guardar", subscription: sub.toJSON(), lead: c.lead, alStart: c.alStart, matches },
    hash = JSON.stringify([sub.endpoint, c.lead, c.alStart, matches]);
  if (!force && readLS("kal_alerts_hash") === hash) return;
  await postAlerts(payload);
  writeLS("kal_alerts_hash", hash);
  writeLS("kal_alerts_synced", String(Date.now()));
}
async function enableAlerts() {
  if (!pushSupported()) {
    toast("Este navegador no permite notificaciones.");
    return;
  }
  if (isIOS() && !isStandalone()) {
    toast("Primero instala KAL en tu pantalla de inicio y ábrela desde el ícono.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    renderAlertsBox();
    toast("Sin permiso no podemos enviarte avisos.");
    return;
  }
  const c = alertCfg();
  c.enabled = true;
  saveAlertCfg(c);
  try {
    await syncAlerts(true);
    toast("Avisos activados. Te avisaremos " + c.lead + " min antes de cada partido.");
  } catch (e) {
    toast(e.message || "No se pudieron activar los avisos.");
  }
  renderAlertsBox();
}
async function disableAlerts() {
  const c = alertCfg();
  c.enabled = false;
  saveAlertCfg(c);
  try {
    const sub = pushSupported() ? await pushSubscription(false) : null;
    if (sub) {
      await postAlerts({ accion: "borrar", endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
  writeLS("kal_alerts_hash", "");
  renderAlertsBox();
  toast("Avisos del teléfono desactivados.");
}
async function testAlert() {
  try {
    const sub = await pushSubscription(true);
    await postAlerts({ accion: "prueba", subscription: sub.toJSON() });
    toast("Aviso de prueba enviado. Debería llegar en unos segundos.");
  } catch (e) {
    toast(e.message || "No se pudo enviar la prueba.");
  }
}
function renderAlertsBox() {
  const el = $("alertsBox");
  if (!el) return;
  const c = alertCfg(),
    next = upcomingMatches(),
    perm = "Notification" in window ? Notification.permission : "unsupported";
  let head;
  if (!pushSupported())
    head =
      '<div class="notice">Este navegador no permite notificaciones. Los avisos dentro de la app sí funcionan.</div>';
  else if (isIOS() && !isStandalone())
    head =
      '<div class="notice">En iPhone las notificaciones solo funcionan con KAL instalada. Ábrela desde su ícono en la pantalla de inicio.</div>';
  else if (perm === "denied")
    head =
      '<div class="notice warning">Bloqueaste las notificaciones de KAL. Actívalas en <b>Ajustes del teléfono → Notificaciones → KAL</b> y vuelve aquí.</div>';
  else
    head =
      c.enabled && perm === "granted"
        ? '<div class="notice ok">🔔 Activados · ' +
          next.length +
          " partido" +
          (next.length === 1 ? "" : "s") +
          " próximo" +
          (next.length === 1 ? "" : "s") +
          " con aviso.</div>"
        : '<p class="small muted">Recibe una notificación antes de que empiecen tus partidos pendientes, aunque tengas KAL cerrada.</p>';
  const leadSel =
    '<label class="field"><span>Avisar antes del partido</span><select class="input" id="alertLead">' +
    [5, 10, 15, 30, 60]
      .map(
        (n) =>
          '<option value="' +
          n +
          '"' +
          (c.lead === n ? " selected" : "") +
          ">" +
          n +
          " minutos antes</option>",
      )
      .join("") +
    "</select></label>";
  const opts =
    '<label class="check"><input type="checkbox" id="alertStart"' +
    (c.alStart ? " checked" : "") +
    '> Avisar también cuando empiece</label><label class="check"><input type="checkbox" id="alertInApp"' +
    (c.inApp ? " checked" : "") +
    "> Mostrar avisos dentro de la app</label>";
  const btns =
    pushSupported() && perm !== "denied" && !(isIOS() && !isStandalone())
      ? c.enabled && perm === "granted"
        ? '<div class="row"><button type="button" class="btn" data-alert-test>Enviar prueba</button><button type="button" class="btn danger" data-alert-off>Desactivar</button></div>'
        : '<button type="button" class="btn gold" data-alert-on>🔔 Activar avisos en este teléfono</button>'
      : "";
  el.innerHTML =
    head +
    leadSel +
    opts +
    btns +
    (next.length
      ? '<div class="alert-next"><small>Próximos avisos</small>' +
        next
          .slice(0, 4)
          .map(
            (m) =>
              "<div><b>" +
              esc(m.name) +
              "</b><span>" +
              m.start.toLocaleString("es-HN", {
                weekday: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }) +
              "</span></div>",
          )
          .join("") +
        "</div>"
      : "");
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-alert-on]")) enableAlerts();
  else if (e.target.closest("[data-alert-off]")) disableAlerts();
  else if (e.target.closest("[data-alert-test]")) testAlert();
});
document.addEventListener("change", (e) => {
  const c = alertCfg();
  if (e.target.id === "alertLead") c.lead = Number(e.target.value);
  else if (e.target.id === "alertStart") c.alStart = e.target.checked;
  else if (e.target.id === "alertInApp") c.inApp = e.target.checked;
  else return;
  saveAlertCfg(c);
  renderAlertsBox();
  syncAlerts().catch(() => {});
});
// Avisos dentro de la app (mientras está abierta)
function checkInAppAlerts() {
  const c = alertCfg();
  if (!c.inApp || document.hidden) return;
  const now = Date.now();
  let shown = {};
  try {
    shown = JSON.parse(readLS("kal_inapp_shown") || "{}");
  } catch {}
  Object.keys(shown).forEach((k) => {
    if (shown[k] < now - 86400000) delete shown[k];
  });
  for (const m of upcomingMatches()) {
    const t = m.start.getTime(),
      pre = "pre|" + m.id,
      st = "start|" + m.id;
    let msg = null,
      key = null;
    if (c.alStart && now >= t && now < t + 20 * 60000 && !shown[st]) {
      msg = "🔴 <b>Empezó</b> " + esc(m.name);
      key = st;
    } else if (now >= t - c.lead * 60000 && now < t && !shown[pre]) {
      msg =
        "⏰ <b>" + esc(m.name) + "</b> empieza en " + Math.max(1, Math.round((t - now) / 60000)) + " min";
      key = pre;
    }
    if (key) {
      shown[key] = now;
      writeLS("kal_inapp_shown", JSON.stringify(shown));
      showLiveAlert(msg, m);
      break;
    }
  }
}
function showLiveAlert(html, m) {
  const el = $("liveAlert");
  if (!el) return;
  el.innerHTML =
    "<span>" +
    html +
    '</span><button type="button" class="btn sm gold" data-live-open>Ver</button><button type="button" class="hn-close" data-live-close aria-label="Cerrar">×</button>';
  el.hidden = false;
  el.dataset.match = m.title;
  try {
    navigator.vibrate?.(120);
  } catch {}
  clearTimeout(showLiveAlert.t);
  showLiveAlert.t = setTimeout(() => {
    el.hidden = true;
  }, 15000);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-live-close]")) {
    $("liveAlert").hidden = true;
  } else if (e.target.closest("[data-live-open]")) {
    $("liveAlert").hidden = true;
    agendaRange = "today";
    go("calendar");
    renderCalendar();
  }
});
setInterval(checkInAppAlerts, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkInAppAlerts();
    syncAlerts().catch(() => {});
  }
});

// ---- Presupuesto mensual y racha de pérdidas ----
function monthSpent() {
  const n = new Date(),
    k = n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
  return db.coupons
    .filter((c) => {
      const d = new Date(c.created);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") === k;
    })
    .reduce((s, c) => s + (Number(c.stake) || 0), 0);
}
function renderBudget() {
  const el = $("budgetCard");
  if (!el) return;
  const budget = Number(db.settings?.budget) || 0,
    spent = monthSpent(),
    month = new Date().toLocaleDateString("es-HN", { month: "long" });
  if (!budget) {
    el.innerHTML =
      '<div class="budget-card empty-budget"><span>💰</span><div><b>Define tu presupuesto mensual</b><small>Te avisaremos al llegar al 80 % y al 100 %.</small></div><button type="button" class="btn sm" data-budget-edit>Definir</button></div>';
    return;
  }
  const p = spent / budget,
    level = p >= 1 ? "over" : p >= 0.8 ? "warn" : "ok",
    label =
      level === "over"
        ? "⛔ Superaste tu presupuesto"
        : level === "warn"
          ? "⚠️ Cerca del límite"
          : "✓ Dentro del presupuesto";
  el.innerHTML =
    '<div class="budget-card is-' +
    level +
    '"><div class="budget-top"><div><small>Presupuesto de ' +
    esc(month) +
    "</small><b>" +
    money(spent) +
    " <span>de " +
    money(budget) +
    '</span></b></div><button type="button" class="btn sm" data-budget-edit aria-label="Cambiar presupuesto">✎</button></div><div class="budget-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
    Math.round(p * 100) +
    '"><i style="width:' +
    Math.min(100, Math.round(p * 100)) +
    '%"></i></div><div class="budget-foot"><span class="budget-state">' +
    label +
    "</span><span>" +
    (level === "over" ? "Excedido en " + money(spent - budget) : "Te quedan " + money(budget - spent)) +
    "</span></div></div>";
  const key = "kal_budget_alert_" + new Date().toISOString().slice(0, 7),
    prev = readLS(key) || "ok";
  if (level !== prev && (level === "over" || (level === "warn" && prev === "ok"))) {
    writeLS(key, level);
    toast(
      level === "over"
        ? "Superaste tu presupuesto de " + month + "."
        : "Ya usaste el " + Math.round(p * 100) + "% de tu presupuesto de " + month + ".",
    );
  }
}
function editBudget() {
  const cur = Number(db.settings?.budget) || 0,
    v = prompt(
      "Presupuesto mensual para apostar (Lempiras). Escribe 0 para quitarlo.",
      cur ? String(cur) : "",
    );
  if (v === null) return;
  const n = Number(String(v).replace(/[L\s,]/gi, ""));
  if (!Number.isFinite(n) || n < 0) {
    toast("Escribe un número válido.");
    return;
  }
  db.settings = { ...(db.settings || {}), budget: n, updatedAt: new Date().toISOString() };
  save();
  toast(n ? "Presupuesto guardado: " + money(n) + " al mes." : "Presupuesto quitado.");
  renderBudget();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-budget-edit]")) editBudget();
});
function lossStreak() {
  const seq = db.coupons
    .map((c) => ({ c, s: calcCoupon(c).status }))
    .filter((x) => x.s === "won" || x.s === "lost")
    .sort((a, b) => String(a.c.updated || a.c.created).localeCompare(String(b.c.updated || b.c.created)));
  let n = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i].s === "lost"; i--) n++;
  return n;
}
