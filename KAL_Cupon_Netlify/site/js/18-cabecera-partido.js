// Cabecera de la ficha del partido con identidad propia:
// - Colores y dibujo de fondo según la competición (estrellas de la Champions, rayas, líneas de cancha…).
// - Brillo con el color principal de cada escudo detrás de su equipo (se calcula una vez y se guarda).
// - Logo de la competición como marca de agua y bandera del país en una esquina.
"use strict";

// Temas por competición: [expresión, id, color 1, color 2, acento, dibujo, país al que pertenece (opcional)].
// El orden importa: lo más específico primero (p. ej. "Europa League" antes que el resto de la UEFA).
// Si una liga es de otro país (Bundesliga de Austria, Serie A de Brasil…), se usan los colores de ese país.
const COMPETITION_THEMES = [
  // Selecciones (fechas FIFA)
  [
    /concacaf.*(nations|naciones)|(nations|naciones).*concacaf/,
    "concacaf-nations",
    "#06152b",
    "#0b3d91",
    "#ffd200",
    "rays",
  ],
  [/nations league|liga de (las )?naciones/, "nations-league", "#001a3a", "#00507a", "#41e0d0", "stars"],
  [
    /eliminatori|clasificatori|qualif|preliminar(es)? (del |al )?mundial/,
    "qualifiers",
    "#1a0d00",
    "#7a3d00",
    "#f6c344",
    "stars",
  ],
  [/world cup|mundial|copa del mundo/, "world-cup", "#2c0016", "#7a1538", "#f6c344", "stars"],
  [/\beuro(copa)?\b|european championship/, "euro", "#00153d", "#0a3b8c", "#ffffff", "stars"],
  [/copa america/, "copa-america", "#001a33", "#0a4d8c", "#f6c344", "stars"],
  [/gold cup|copa oro/, "gold-cup", "#1c1400", "#6a4c00", "#ffd700", "rays"],
  [/amistos|friendl/, "friendlies", "#0d1b2a", "#1b4965", "#bee9e8", "pitch"],
  // Competiciones europeas de clubes
  [
    /uefa super ?cup|supercopa (de )?(europa|la uefa)|supercopa uefa/,
    "uefa-super-cup",
    "#0b0f2e",
    "#2a2f7a",
    "#c9d6ff",
    "stars",
  ],
  [/europa league|liga europa|\buel\b/, "europa-league", "#2a1200", "#a84a08", "#ff9a3c", "rays"],
  [/conference/, "conference", "#002a1f", "#00785a", "#3df5b0", "rays"],
  [/champions\b|liga (de )?campeones|\bucl\b|uefa/, "champions", "#06103a", "#1b2f86", "#c9d6ff", "stars"],
  // Sudamérica
  [/libertadores/, "libertadores", "#1c1400", "#6a4c00", "#f2c94c", "stars"],
  [/sudamericana/, "sudamericana", "#00163a", "#0b4f9c", "#5ec2ff", "rays"],
  // Copas y supercopas nacionales
  [
    /fa cup|copa fa|copa de inglaterra|community shield/,
    "fa-cup",
    "#0a1a3a",
    "#1d3f8a",
    "#ffffff",
    "stars",
    /inglaterra|england/,
  ],
  [
    /carabao|efl cup|league cup|copa de la liga inglesa/,
    "league-cup",
    "#0c3b2e",
    "#14805e",
    "#9cffd1",
    "rays",
    /inglaterra|england/,
  ],
  [/copa del rey/, "copa-del-rey", "#330009", "#8a0020", "#f6c344", "stars", /espana|spain/],
  [/supercopa( de espana)?\b/, "supercopa-espana", "#2a050b", "#8e1526", "#f6c344", "stars", /espana|spain/],
  [/coppa italia|copa de italia|supercoppa|supercopa de italia/, "coppa-italia", "#001538", "#0b3fa8", "#3ad07a", "stars", /italia|italy/],
  [/dfb|pokal|supercup|copa de alemania|supercopa de alemania/, "dfb-pokal", "#1a0003", "#7a0010", "#ffcc00", "stars", /alemania|germany/],
  [
    /coupe de france|copa de francia|trophee des champions|supercopa de francia/,
    "coupe-france",
    "#0a1230",
    "#1c2d73",
    "#ff4d5a",
    "stars",
    /francia|france/,
  ],
  [
    /taca|copa de portugal|liga portugal cup|allianz cup|league cup.*portugal/,
    "taca-portugal",
    "#001f12",
    "#00663a",
    "#ff3b3b",
    "stars",
    /portugal/,
  ],
  [/knvb|beker|copa de (los )?paises bajos|copa de holanda/, "knvb", "#2a1000", "#a84400", "#ffffff", "stars", /holanda|paises bajos|netherlands/],
  [
    /scottish cup|copa de escocia/,
    "scottish-cup",
    "#001233",
    "#0b3a8c",
    "#ffffff",
    "stars",
    /escocia|scotland/,
  ],
  // Ligas
  [
    /premier league|\bepl\b/,
    "premier-league",
    "#2a0030",
    "#5d0f6a",
    "#00ff85",
    "stripes",
    /inglaterra|england/,
  ],
  [
    /championship|league one|league two|\befl\b/,
    "english-football-league",
    "#071a33",
    "#173f6e",
    "#e8eef8",
    "pitch",
    /inglaterra|england/,
  ],
  [/segunda|hypermotion|la ?liga 2/, "laliga-2", "#1f0d00", "#7a3a00", "#ffb347", "stripes", /espana|spain/],
  [/la ?liga|laliga/, "laliga", "#2a050b", "#8e1526", "#ff6a4d", "stripes", /espana|spain/],
  [/serie b\b/, "serie-b", "#001a2c", "#0b5a7a", "#7ef0ff", "stripes", /italia|italy/],
  [/serie a\b/, "serie-a", "#001538", "#0b3fa8", "#35c8ff", "stripes", /italia|italy/],
  [/2\.? ?bundesliga|zweite/, "bundesliga-2", "#1a0005", "#6a0010", "#ffffff", "stripes", /alemania|germany/],
  [/bundesliga/, "bundesliga", "#260003", "#a3000f", "#ffffff", "stripes", /alemania|germany/],
  [/ligue 2/, "ligue-2", "#0a1a2a", "#1d4e6e", "#ff8a3c", "stripes", /francia|france/],
  [/ligue 1/, "ligue-1", "#0a1230", "#1c2d73", "#dae025", "stripes", /francia|france/],
  [
    /eerste divisie|keuken/,
    "eerste-divisie",
    "#1f0d00",
    "#7a3a00",
    "#ffffff",
    "stripes",
    /holanda|paises bajos|netherlands/,
  ],
  [
    /eredivisie/,
    "eredivisie",
    "#2a1000",
    "#a84400",
    "#ffb366",
    "stripes",
    /holanda|paises bajos|netherlands/,
  ],
  [/primeira|liga portugal/, "primeira-liga", "#001f12", "#00663a", "#ffd23f", "stripes", /portugal/],
  [
    /premiership|scottish|escoc/,
    "scottish-premiership",
    "#001233",
    "#0b3a8c",
    "#7fb2ff",
    "stripes",
    /escocia|scotland/,
  ],
  [/pro league|jupiler/, "belgian-pro-league", "#1a1400", "#4a3a00", "#e30613", "stripes", /belgica|belgium/],
  [/super ?lig\b|superlig/, "super-lig", "#2a0005", "#a0001a", "#ffffff", "stripes", /turquia|turkey/],
  [/brasileir|brasileirao/, "brasileirao", "#00280f", "#00873c", "#ffdf00", "stripes", /brasil|brazil/],
  [
    /liga profesional|primera division argentina/,
    "liga-argentina",
    "#001a33",
    "#2d7fc1",
    "#ffffff",
    "stripes",
    /argentina/,
  ],
  [
    /roshn|saudi pro|liga saudi/,
    "saudi-pro-league",
    "#002814",
    "#006c35",
    "#ffffff",
    "stripes",
    /arabia|saudi/,
  ],
  [/liga nacional|liga betcris/, "liga-nacional", "#001a45", "#0067b1", "#7fd3ff", "pitch", /honduras/],
  [/liga mx/, "liga-mx", "#00281f", "#006a4e", "#ce1126", "pitch", /mexico/],
  [/\bmls\b|major league soccer/, "mls", "#001427", "#163b66", "#7ab8ff", "pitch", /estados unidos|usa|eeuu/],
];
// Colores por país (para ligas que no están arriba o que son de otro país).
const COUNTRY_THEMES = [
  [/espana|spain/, "#2a050b", "#8e1526", "#ffc400"],
  [/inglaterra|england/, "#071a33", "#173f6e", "#e8eef8"],
  [/escocia|scotland/, "#001233", "#0b3a8c", "#ffffff"],
  [/gales|wales/, "#2a0005", "#a0001a", "#00b140"],
  [/italia|italy/, "#001538", "#0b3fa8", "#35c8ff"],
  [/alemania|germany/, "#260003", "#a3000f", "#ffcc00"],
  [/francia|france/, "#0a1230", "#1c2d73", "#ffffff"],
  [/portugal/, "#001f12", "#00663a", "#ff3b3b"],
  [/holanda|paises bajos|netherlands/, "#2a1000", "#a84400", "#ffffff"],
  [/belgica|belgium/, "#1a1400", "#4a3a00", "#e30613"],
  [/turquia|turkey/, "#2a0005", "#a0001a", "#ffffff"],
  [/grecia|greece/, "#001a3a", "#0d5eaf", "#ffffff"],
  [/austria/, "#2a0005", "#a0001a", "#ffffff"],
  [/suiza|switzerland/, "#2a0005", "#c8102e", "#ffffff"],
  [/dinamarca|denmark/, "#2a0005", "#c8102e", "#ffffff"],
  [/noruega|norway/, "#00132e", "#ba0c2f", "#ffffff"],
  [/suecia|sweden/, "#002a4d", "#006aa7", "#fecc00"],
  [/polonia|poland/, "#2a0005", "#c8102e", "#ffffff"],
  [/chequia|republica checa|czech/, "#00132e", "#11457e", "#d7141a"],
  [/croacia|croatia/, "#00132e", "#171796", "#ff0000"],
  [/serbia/, "#2a0005", "#0c4076", "#ffffff"],
  [/ucrania|ukraine/, "#002a5c", "#0057b7", "#ffd700"],
  [/rusia|russia/, "#00132e", "#0039a6", "#d52b1e"],
  [/brasil|brazil/, "#00280f", "#00873c", "#ffdf00"],
  [/argentina/, "#001a33", "#2d7fc1", "#ffffff"],
  [/uruguay/, "#001a33", "#0038a8", "#fcd116"],
  [/colombia/, "#1a1400", "#003893", "#fcd116"],
  [/chile/, "#00132e", "#0039a6", "#d52b1e"],
  [/mexico/, "#00281f", "#006847", "#ce1126"],
  [/estados unidos|usa|eeuu/, "#00132e", "#3c3b6e", "#b22234"],
  [/honduras/, "#001a45", "#0067b1", "#7fd3ff"],
  [/costa rica/, "#00132e", "#002b7f", "#ce1126"],
  [/arabia|saudi/, "#002814", "#006c35", "#ffffff"],
  [/japon|japan/, "#1a0005", "#bc002d", "#ffffff"],
  [/corea|korea/, "#00132e", "#003478", "#c60c30"],
  [/europa|europe/, "#06103a", "#1b2f86", "#c9d6ff"],
];
// Competiciones de selecciones: muestran la bandera de cada selección detrás de su escudo.
const NATIONS_THEMES = new Set([
  "concacaf-nations",
  "nations-league",
  "qualifiers",
  "world-cup",
  "euro",
  "copa-america",
  "gold-cup",
  "friendlies",
]);

function competitionTheme(f) {
  const comp = crestNorm(f.competition || f.league || ""),
    country = crestNorm(f.country || "");
  const countryTheme = COUNTRY_THEMES.find(([re]) => re.test(country));
  const t = COMPETITION_THEMES.find(([re]) => re.test(comp));
  // Liga con el mismo nombre en otro país (p. ej. Bundesliga de Austria): colores de ese país.
  if (t && t[6] && country && !t[6].test(country) && countryTheme)
    return {
      id: "pais",
      c1: countryTheme[1],
      c2: countryTheme[2],
      accent: countryTheme[3],
      pattern: "stripes",
    };
  if (t)
    return { id: t[1], c1: t[2], c2: t[3], accent: t[4], pattern: t[5], nations: NATIONS_THEMES.has(t[1]) };
  const c = countryTheme || COUNTRY_THEMES.find(([re]) => re.test(comp));
  if (c) return { id: "pais", c1: c[1], c2: c[2], accent: c[3], pattern: "pitch" };
  return { id: "general", c1: "#07192e", c2: "#123e42", accent: "#f5c542", pattern: "pitch" };
}

// Bandera de una selección por su nombre (español o inglés).
const NATION_FLAGS = [
  [/^espana$|^spain$/, "🇪🇸"],
  [/^inglaterra$|^england$/, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  [/^escocia$|^scotland$/, "🏴󠁧󠁢󠁳󠁣󠁴󠁿"],
  [/^gales$|^wales$/, "🏴󠁧󠁢󠁷󠁬󠁳󠁿"],
  [/^irlanda del norte$|^northern ireland$/, "🇬🇧"],
  [/^irlanda$|^republica de irlanda$|^ireland$/, "🇮🇪"],
  [/^italia$|^italy$/, "🇮🇹"],
  [/^alemania$|^germany$/, "🇩🇪"],
  [/^francia$|^france$/, "🇫🇷"],
  [/^portugal$/, "🇵🇹"],
  [/^paises bajos$|^holanda$|^netherlands$/, "🇳🇱"],
  [/^belgica$|^belgium$/, "🇧🇪"],
  [/^croacia$|^croatia$/, "🇭🇷"],
  [/^serbia$/, "🇷🇸"],
  [/^suiza$|^switzerland$/, "🇨🇭"],
  [/^austria$/, "🇦🇹"],
  [/^dinamarca$|^denmark$/, "🇩🇰"],
  [/^noruega$|^norway$/, "🇳🇴"],
  [/^suecia$|^sweden$/, "🇸🇪"],
  [/^finlandia$|^finland$/, "🇫🇮"],
  [/^islandia$|^iceland$/, "🇮🇸"],
  [/^polonia$|^poland$/, "🇵🇱"],
  [/^chequia$|^republica checa$|^czech( republic|ia)?$/, "🇨🇿"],
  [/^eslovaquia$|^slovakia$/, "🇸🇰"],
  [/^eslovenia$|^slovenia$/, "🇸🇮"],
  [/^hungria$|^hungary$/, "🇭🇺"],
  [/^rumania$|^romania$/, "🇷🇴"],
  [/^bulgaria$/, "🇧🇬"],
  [/^grecia$|^greece$/, "🇬🇷"],
  [/^turquia$|^turkiye$|^turkey$/, "🇹🇷"],
  [/^ucrania$|^ukraine$/, "🇺🇦"],
  [/^georgia$/, "🇬🇪"],
  [/^albania$/, "🇦🇱"],
  [/^bosnia( y herzegovina)?$|^bosnia and herzegovina$/, "🇧🇦"],
  [/^montenegro$/, "🇲🇪"],
  [/^macedonia( del norte)?$|^north macedonia$/, "🇲🇰"],
  [/^kosovo$/, "🇽🇰"],
  [/^israel$/, "🇮🇱"],
  [/^chipre$|^cyprus$/, "🇨🇾"],
  [/^luxemburgo$|^luxembourg$/, "🇱🇺"],
  [/^armenia$/, "🇦🇲"],
  [/^azerbaiyan$|^azerbaijan$/, "🇦🇿"],
  [/^kazajistan$|^kazakhstan$/, "🇰🇿"],
  [/^estonia$/, "🇪🇪"],
  [/^letonia$|^latvia$/, "🇱🇻"],
  [/^lituania$|^lithuania$/, "🇱🇹"],
  [/^bielorrusia$|^belarus$/, "🇧🇾"],
  [/^moldavia$|^moldova$/, "🇲🇩"],
  [/^malta$/, "🇲🇹"],
  [/^andorra$/, "🇦🇩"],
  [/^san marino$/, "🇸🇲"],
  [/^gibraltar$/, "🇬🇮"],
  [/^islas feroe$|^faroe islands$/, "🇫🇴"],
  [/^liechtenstein$/, "🇱🇮"],
  [/^rusia$|^russia$/, "🇷🇺"],
  [/^brasil$|^brazil$/, "🇧🇷"],
  [/^argentina$/, "🇦🇷"],
  [/^uruguay$/, "🇺🇾"],
  [/^colombia$/, "🇨🇴"],
  [/^chile$/, "🇨🇱"],
  [/^peru$/, "🇵🇪"],
  [/^ecuador$/, "🇪🇨"],
  [/^paraguay$/, "🇵🇾"],
  [/^bolivia$/, "🇧🇴"],
  [/^venezuela$/, "🇻🇪"],
  [/^mexico$/, "🇲🇽"],
  [/^estados unidos$|^usa$|^united states$/, "🇺🇸"],
  [/^canada$/, "🇨🇦"],
  [/^honduras$/, "🇭🇳"],
  [/^costa rica$/, "🇨🇷"],
  [/^panama$/, "🇵🇦"],
  [/^el salvador$/, "🇸🇻"],
  [/^guatemala$/, "🇬🇹"],
  [/^nicaragua$/, "🇳🇮"],
  [/^jamaica$/, "🇯🇲"],
  [/^haiti$/, "🇭🇹"],
  [/^trinidad y tobago$|^trinidad and tobago$/, "🇹🇹"],
  [/^curazao$|^curacao$/, "🇨🇼"],
  [/^surinam$|^suriname$/, "🇸🇷"],
  [/^japon$|^japan$/, "🇯🇵"],
  [/^corea del sur$|^south korea$|^korea republic$/, "🇰🇷"],
  [/^australia$/, "🇦🇺"],
  [/^arabia saudita$|^arabia saudi$|^saudi arabia$/, "🇸🇦"],
  [/^iran$/, "🇮🇷"],
  [/^qatar$/, "🇶🇦"],
  [/^marruecos$|^morocco$/, "🇲🇦"],
  [/^senegal$/, "🇸🇳"],
  [/^nigeria$/, "🇳🇬"],
  [/^egipto$|^egypt$/, "🇪🇬"],
  [/^tunez$|^tunisia$/, "🇹🇳"],
  [/^argelia$|^algeria$/, "🇩🇿"],
  [/^ghana$/, "🇬🇭"],
  [/^camerun$|^cameroon$/, "🇨🇲"],
  [/^costa de marfil$|^ivory coast$|^cote d ivoire$/, "🇨🇮"],
  [/^sudafrica$|^south africa$/, "🇿🇦"],
];
function nationFlag(name) {
  const n = crestNorm(name)
    .replace(/\b(sub ?\d+|u ?\d+|femenino|women|w)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NATION_FLAGS.find(([re]) => re.test(n))?.[1] || "";
}

// Atributos y capas decorativas de la cabecera.
function heroAttrs(f) {
  const t = competitionTheme(f);
  return (
    'data-pattern="' + t.pattern + '" style="--c1:' + t.c1 + ";--c2:" + t.c2 + ";--accent:" + t.accent + '"'
  );
}
function nationFlagsDecor(f) {
  const t = competitionTheme(f),
    h = nationFlag(f.home),
    a = nationFlag(f.away);
  if (!(t.nations || (h && a))) return "";
  return (
    (h ? '<span class="hero-nation left">' + h + "</span>" : "") +
    (a ? '<span class="hero-nation right">' + a + "</span>" : "")
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
    nationFlagsDecor(f) +
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
