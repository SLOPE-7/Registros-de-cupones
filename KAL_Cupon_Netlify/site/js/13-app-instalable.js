// App instalable: ayuda de instalación, avisos de Inicio, protección de datos y service worker.
"use strict";
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  renderHomeNotices();
  renderInstallHelp();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  renderHomeNotices();
  renderInstallHelp();
  toast("KAL quedó instalada en tu pantalla de inicio.");
});
function readLS(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLS(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}
function installSteps() {
  if (isStandalone()) return '<div class="notice ok">✓ Estás usando KAL como app instalada.</div>';
  if (installPrompt)
    return '<p class="small muted">Instálala para abrirla como app, con su ícono y sin la barra del navegador.</p><button type="button" class="btn gold" data-install-app>⬇ Instalar KAL</button>';
  if (isIOS())
    return '<ol class="install-steps"><li>Abre esta página en <b>Safari</b>.</li><li>Toca el botón <b>Compartir</b> <span class="ios-share" aria-hidden="true">⬆︎</span> de la barra de abajo.</li><li>Elige <b>“Agregar a inicio”</b> y luego <b>Agregar</b>.</li><li>Abre KAL desde el nuevo ícono de tu pantalla de inicio.</li></ol><p class="small muted">Instalada, KAL abre a pantalla completa y el iPhone conserva mejor tus datos.</p>';
  return '<p class="small muted">En el menú del navegador elige <b>“Instalar aplicación”</b> o <b>“Agregar a la pantalla de inicio”</b>.</p>';
}
function renderInstallHelp() {
  const el = $("installHelp");
  if (el) el.innerHTML = installSteps();
}
function renderHomeNotices() {
  const el = $("homeNotices");
  if (!el) return;
  const out = [],
    now = Date.now(),
    day = 86400000;
  if (!isStandalone() && (isIOS() || installPrompt) && Number(readLS("kal_install_snooze") || 0) < now)
    out.push(
      '<div class="home-notice"><span class="hn-ico">📲</span><div><b>Instala KAL en tu teléfono</b><small>' +
        (installPrompt
          ? "Ábrela como app, con su propio ícono."
          : "Safari → Compartir → “Agregar a inicio”. Así abre como app y protege mejor tus datos.") +
        "</small></div>" +
        (installPrompt
          ? '<button type="button" class="btn gold sm" data-install-app>Instalar</button>'
          : '<button type="button" class="btn sm" data-view="settings">Cómo</button>') +
        '<button type="button" class="hn-close" data-snooze="kal_install_snooze" data-days="14" aria-label="Ocultar aviso">×</button></div>',
    );
  const last = Number(readLS("kal_last_backup") || 0),
    snooze = Number(readLS("kal_backup_snooze") || 0);
  if (db.coupons.length && !cloudSession && now - last > 7 * day && snooze < now) {
    const days = last ? Math.floor((now - last) / day) : null;
    out.push(
      '<div class="home-notice warn"><span class="hn-ico">💾</span><div><b>' +
        (days ? "Hace " + days + " días que no guardas un respaldo" : "Aún no has guardado un respaldo") +
        '</b><small>Tus cupones solo están en este teléfono. Descarga una copia por si se borran los datos del navegador.</small></div><button type="button" class="btn gold sm" data-backup-now>Respaldar</button><button type="button" class="hn-close" data-snooze="kal_backup_snooze" data-days="3" aria-label="Recordar más tarde">×</button></div>',
    );
  }
  const streak = lossStreak();
  if (streak >= 3 && Number(readLS("kal_streak_snooze") || 0) < now)
    out.push(
      '<div class="home-notice warn"><span class="hn-ico">⚠️</span><div><b>Llevas ' +
        streak +
        ' cupones perdidos seguidos</b><small>Puede ser buen momento para una pausa o para bajar el importe de los próximos cupones.</small></div><button type="button" class="btn sm" data-view="stats">Ver rendimiento</button><button type="button" class="hn-close" data-snooze="kal_streak_snooze" data-days="1" aria-label="Ocultar aviso">×</button></div>',
    );
  el.innerHTML = out.join("");
}
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-install-app]") && installPrompt) {
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } catch {}
    installPrompt = null;
    renderHomeNotices();
    renderInstallHelp();
    return;
  }
  const sn = e.target.closest("[data-snooze]");
  if (sn) {
    writeLS(sn.dataset.snooze, String(Date.now() + Number(sn.dataset.days || 3) * 86400000));
    renderHomeNotices();
    return;
  }
  if (e.target.closest("[data-backup-now]")) backup();
});
// Pide al navegador que no borre los datos de KAL por falta de espacio o de uso.
async function protectStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist();
  } catch {}
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost"))
  window.addEventListener("load", () => {
    // Si ya había una versión instalada y llega otra, se recarga una vez para usar la nueva.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Busca versión nueva cada vez que vuelves a la app.
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
