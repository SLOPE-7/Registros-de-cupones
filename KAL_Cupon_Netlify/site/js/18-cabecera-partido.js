// Cabecera de la ficha del partido con identidad propia:
// - Colores y dibujo de fondo según la competición (estrellas de la Champions, rayas, líneas de cancha…).
// - Brillo con el color principal de cada escudo detrás de su equipo (se calcula una vez y se guarda).
// - Logo de la competición como marca de agua y bandera del país en una esquina.
"use strict";

// [expresión, color 1, color 2, acento, dibujo]
const COMPETITION_THEMES = [
  // Europa y Conference primero: también llevan "UEFA" en el nombre.
  [/europa league|liga europa|uel\b/, "#2a1200", "#a84a08", "#ff9a3c", "rays"],
  [/conference/, "#002a1f", "#00785a", "#3df5b0", "rays"],
  [/champions|liga (de )?campeones|\bucl\b|uefa/, "#06103a", "#1b2f86", "#c9d6ff", "stars"],
  [/libertadores/, "#1c1400", "#6a4c00", "#f2c94c", "stars"],
  [/sudamericana/, "#00163a", "#0b4f9c", "#5ec2ff", "rays"],
  [/premier league|epl/, "#2a0030", "#5d0f6a", "#00ff85", "stripes"],
  [/la ?liga|laliga/, "#2a050b", "#8e1526", "#ff6a4d", "stripes"],
  [/copa del rey/, "#330009", "#8a0020", "#f6c344", "stars"],
  [/serie a|coppa italia/, "#001538", "#0b3fa8", "#35c8ff", "stripes"],
  [/bundesliga|dfb/, "#260003", "#a3000f", "#ffffff", "stripes"],
  [/ligue 1|coupe de france/, "#0a1230", "#1c2d73", "#dae025", "stripes"],
  [/eredivisie/, "#2a1000", "#a84400", "#ffb366", "stripes"],
  [/primeira|liga portugal/, "#001f12", "#00663a", "#ffd23f", "stripes"],
  [/fa cup|efl|championship/, "#071a33", "#173f6e", "#e8eef8", "pitch"],
  [/liga nacional|honduras|liga betcris/, "#001a45", "#0067b1", "#7fd3ff", "pitch"],
  [/liga mx|mexic/, "#00281f", "#006a4e", "#ce1126", "pitch"],
  [/mls/, "#001427", "#163b66", "#7ab8ff", "pitch"],
  [
    /world cup|mundial|eliminatorias|nations league|copa america|euro\b/,
    "#2c0016",
    "#7a1538",
    "#f6c344",
    "stars",
  ],
];
const COUNTRY_THEMES = [
  [/espana|spain/, "#2a050b", "#8e1526", "#ffc400"],
  [/inglaterra|england/, "#071a33", "#173f6e", "#e8eef8"],
  [/italia|italy/, "#001538", "#0b3fa8", "#35c8ff"],
  [/alemania|germany/, "#260003", "#a3000f", "#ffcc00"],
  [/francia|france/, "#0a1230", "#1c2d73", "#ffffff"],
  [/honduras/, "#001a45", "#0067b1", "#7fd3ff"],
  [/portugal/, "#001f12", "#00663a", "#ffd23f"],
];

function competitionTheme(f) {
  const comp = crestNorm(f.competition || f.league || ""),
    country = crestNorm(f.country || "");
  const t = COMPETITION_THEMES.find(([re]) => re.test(comp));
  if (t) return { c1: t[1], c2: t[2], accent: t[3], pattern: t[4] };
  const c = COUNTRY_THEMES.find(([re]) => re.test(country) || re.test(comp));
  if (c) return { c1: c[1], c2: c[2], accent: c[3], pattern: "pitch" };
  return { c1: "#07192e", c2: "#123e42", accent: "#f5c542", pattern: "pitch" };
}

// Atributos y capas decorativas de la cabecera.
function heroAttrs(f) {
  const t = competitionTheme(f);
  return (
    'data-pattern="' + t.pattern + '" style="--c1:' + t.c1 + ";--c2:" + t.c2 + ";--accent:" + t.accent + '"'
  );
}
function heroDecor(f) {
  const comp = f.competition || f.league || "";
  const flag = f.countryFlag
    ? crestHTML(f.countryFlag, f.country)
    : '<span class="hero-flag-emoji">' + esc(countryFlag(f.country || "")) + "</span>";
  return (
    '<div class="hero-bg" aria-hidden="true">' +
    (f.leagueCrest ? '<div class="hero-watermark">' + crestHTML(f.leagueCrest, comp) + "</div>" : "") +
    (f.country ? '<div class="hero-flag">' + flag + "</div>" : "") +
    "</div>"
  );
}

// Color principal de un escudo (el tono más presente y con color; ignora blancos, negros y grises).
const CREST_COLORS_KEY = "kal_crest_colors_v1";
function crestColorCache() {
  try {
    return JSON.parse(localStorage.getItem(CREST_COLORS_KEY) || "{}");
  } catch {
    return {};
  }
}
async function crestColor(url) {
  if (!url) return null;
  const cache = crestColorCache();
  if (url in cache) return cache[url] || null;
  let blob = null;
  try {
    blob = await loadCrestImage(url);
  } catch {}
  if (!blob || typeof createImageBitmap !== "function") return null; // sin imagen guardada todavía: se intenta otro día
  let color = null;
  try {
    const bmp = await createImageBitmap(blob),
      size = 32,
      cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data,
      buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 150) continue;
      const max = Math.max(r, g, b) / 255,
        min = Math.min(r, g, b) / 255,
        l = (max + min) / 2,
        d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s < 0.28 || l < 0.12 || l > 0.9) continue;
      let h = 0;
      if (d) {
        const R = r / 255,
          G = g / 255,
          B = b / 255;
        h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      const k = Math.round(h / 24) % 15,
        e = buckets.get(k) || { w: 0, r: 0, g: 0, b: 0 };
      const w = s;
      e.w += w;
      e.r += r * w;
      e.g += g * w;
      e.b += b * w;
      buckets.set(k, e);
    }
    const best = [...buckets.values()].sort((a, b) => b.w - a.w)[0];
    if (best && best.w > 6) {
      const hex = (v) =>
        Math.round(v / best.w)
          .toString(16)
          .padStart(2, "0");
      color = "#" + hex(best.r) + hex(best.g) + hex(best.b);
    }
  } catch {}
  // Se vuelve a leer antes de guardar: los dos escudos se calculan a la vez y no deben pisarse.
  const fresh = crestColorCache();
  fresh[url] = color || "";
  try {
    localStorage.setItem(CREST_COLORS_KEY, JSON.stringify(fresh));
  } catch {}
  return color;
}

// Pone el brillo de cada equipo cuando sus colores están listos (no bloquea el dibujo de la ficha).
async function applyTeamColors(header, f) {
  if (!header) return;
  const [home, away] = await Promise.all([crestColor(f.homeCrest), crestColor(f.awayCrest)]);
  if (home) header.style.setProperty("--home", home + "cc");
  if (away) header.style.setProperty("--away", away + "cc");
}
