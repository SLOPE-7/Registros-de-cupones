// Arranque: se ejecuta al final, cuando ya están cargados todos los archivos.
"use strict";
protectStorage();
renderInstallHelp();
renderHomeNotices();
renderAlertsBox();
renderBudget();
checkInAppAlerts();
syncAlerts().catch(() => {});
{
  const v = new URLSearchParams(location.search).get("vista");
  if (v && VIEW_TITLES[v]) go(v);
}
$("raw").value = localStorage.getItem(DRAFT) || "";
cleanSavedPlayerNames();
if (migrateEarlyPayout()) save();
if (migrateInlineImages()) save();
indexSavedCrests();
autoCompact();
renderAll();
hideSplash();
recoverFromMirror()
  .then(() => autoSnapshot())
  .catch(() => {});
setTimeout(maybeShowNews, 1200);
initCrestImageCache();
if (cloudSession) {
  cloudPull()
    .then(() => cloudMsg("Cuenta sincronizada: " + (cloudSession.user.email || "")))
    .catch((e) => cloudMsg("No se pudo sincronizar: " + e.message));
  setInterval(() => cloudPull().catch(() => {}), 60000);
}
