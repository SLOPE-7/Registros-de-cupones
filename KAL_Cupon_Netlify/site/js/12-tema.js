// Tema oscuro, claro o automático.
"use strict";
const THEME_KEY = "kal_theme_v1";
function themePref() {
  try {
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    return "dark";
  }
}
function applyTheme(pref) {
  const dark = pref === "auto" ? matchMedia("(prefers-color-scheme: dark)").matches : pref !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#070b14" : "#0b5038");
  const tg = $("themeToggle");
  if (tg) {
    tg.textContent = dark ? "☀" : "☾";
    tg.title = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  }
  document
    .querySelectorAll("[data-theme-choice]")
    .forEach((b) => b.classList.toggle("active", b.dataset.themeChoice === pref));
}
function setTheme(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {}
  applyTheme(pref);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#themeToggle")) {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    return;
  }
  const c = e.target.closest("[data-theme-choice]");
  if (c) setTheme(c.dataset.themeChoice);
});
try {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePref() === "auto") applyTheme("auto");
  });
} catch {}
applyTheme(themePref());
