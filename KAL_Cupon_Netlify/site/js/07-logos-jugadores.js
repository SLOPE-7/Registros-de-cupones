// Pantalla de Logos: equipos, ligas, jugadores (detección y fotos) y secciones plegables.
"use strict";
let logoManagerTeams = [],
  logoManagerFocus = [];
const logoLookupState = {};
function collectLogoTeams() {
  const teams = new Map(),
    dir = readCrestDirectory(),
    hidden = new Set(JSON.parse(localStorage.getItem(LOGO_HIDDEN) || "[]"));
  const add = (name, country, url) => {
    if (!validTeamLogo(name)) return;
    const key = savedCrestKey("team", name);
    if (hidden.has(key)) return;
    const old = teams.get(key) || { key, name: cleanTeamLogo(name), country: "", url: "", matches: 0 };
    old.country = old.country || country || "";
    old.url = old.url || url || dir[key]?.url || "";
    teams.set(key, old);
  };
  const addFixture = (f) => {
    add(f.home, f.country, f.homeCrest);
    add(f.away, f.country, f.awayCrest);
    const home = teams.get(savedCrestKey("team", f.home)),
      away = teams.get(savedCrestKey("team", f.away));
    if (home) home.matches++;
    if (away) away.matches++;
  };
  db.coupons.forEach((c) => (c.fixtures || []).forEach(addFixture));
  draftSelections.forEach(addFixture);
  Object.entries(dir).forEach(([key, item]) => {
    if (key.startsWith("team:")) add(item?.name, item?.country, item?.url);
  });
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
function collectLogoLeagues() {
  const leagues = new Map(),
    dir = readCrestDirectory(),
    trash = readLogoTrash();
  const add = (name, country, url) => {
    if (!String(name || "").trim()) return;
    const key = savedCrestKey("league", name);
    if (trash["league:" + key]) return;
    const old = leagues.get(key) || { key, name: String(name).trim(), country: "", url: "", matches: 0 };
    old.country = old.country || country || "";
    old.url = old.url || url || dir[key]?.url || "";
    leagues.set(key, old);
  };
  const addFixture = (f) => {
    add(f.competition || f.league, f.country, f.leagueCrest);
    const item = leagues.get(savedCrestKey("league", f.competition || f.league));
    if (item) item.matches++;
  };
  db.coupons.forEach((c) => (c.fixtures || []).forEach(addFixture));
  draftSelections.forEach(addFixture);
  Object.entries(dir).forEach(([key, item]) => {
    if (key.startsWith("league:")) add(item?.name, item?.country, item?.url);
  });
  return [...leagues.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
let catalogLookupData = null;
async function lookupCatalogItem(kind) {
  const result = $("catalogLookupResult");
  if (!result) return;
  const input = kind === "country" ? "catalogCountryCode" : "catalogLeagueId",
    value = $(input)?.value?.trim() || "";
  if (kind === "country" && !/^[a-z]{2}$/i.test(value)) {
    toast("Escribe el código ISO de dos letras del país, por ejemplo ES o GB.");
    return;
  }
  if (kind === "league" && !/^\d{1,10}$/.test(value)) {
    toast("Escribe el ID numérico de la liga.");
    return;
  }
  result.innerHTML = '<div class="catalog-result-card">Consultando API-Football…</div>';
  try {
    const params = new URLSearchParams(
        kind === "country" ? { countryCode: value.toUpperCase() } : { leagueId: value },
      ),
      r = await fetch("/api/catalogo?" + params, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(22000),
      }),
      data = await r.json();
    if (!r.ok) throw Error(data.error || "No se pudo consultar el catálogo.");
    catalogLookupData = { kind, data };
    const item = kind === "country" ? data.country : data.league,
      country = kind === "league" ? data.country : null,
      url = kind === "country" ? item.flag : item.logo;
    result.innerHTML =
      '<div class="catalog-result-card">' +
      (url
        ? crestHTML(url, item.name)
        : '<span class="team-fallback">' + esc(item.name.slice(0, 2).toUpperCase()) + "</span>") +
      "<div><strong>" +
      esc(item.name) +
      "</strong><small>" +
      esc(
        kind === "country"
          ? "Código " + item.code
          : (country?.name || "País no identificado") + " · ID " + item.id,
      ) +
      '</small></div><button class="btn sm gold" type="button" data-catalog-save>Guardar</button></div>';
    showCrestImagesIn(result);
  } catch (e) {
    catalogLookupData = null;
    result.innerHTML =
      '<div class="notice warning">' + esc(e.message || "No se pudo consultar API-Football.") + "</div>";
  }
}
function saveCatalogItem() {
  if (!catalogLookupData) return;
  const { kind, data } = catalogLookupData,
    dir = readCrestDirectory();
  if (kind === "country") {
    const x = data.country;
    if (!x?.name || !x.flag) {
      toast("El proveedor no devolvió la bandera.");
      return;
    }
    const item = { name: x.name, code: x.code, url: x.flag, savedAt: Date.now() };
    dir[savedCrestKey("country", x.name)] = item;
    dir[savedCrestKey("country", x.code)] = item;
    db.coupons.forEach((c) =>
      (c.fixtures || []).forEach((f) => {
        if (crestNorm(f.country) === crestNorm(x.name)) {
          f.countryFlag = x.flag;
          f.countryCode = x.code;
        }
      }),
    );
    draftSelections.forEach((f) => {
      if (crestNorm(f.country) === crestNorm(x.name)) {
        f.countryFlag = x.flag;
        f.countryCode = x.code;
      }
    });
  } else {
    const x = data.league,
      country = data.country || {};
    if (!x?.name || !x.logo) {
      toast("El proveedor no devolvió el logo de liga.");
      return;
    }
    const item = {
      name: x.name,
      url: x.logo,
      country: country.name || "",
      countryCode: country.code || "",
      countryFlag: country.flag || "",
      savedAt: Date.now(),
    };
    dir[savedCrestKey("league", x.name)] = item;
    if (country.name && country.flag) {
      const c = { name: country.name, code: country.code || "", url: country.flag, savedAt: Date.now() };
      dir[savedCrestKey("country", country.name)] = c;
      if (country.code) dir[savedCrestKey("country", country.code)] = c;
    }
    db.coupons.forEach((c) =>
      (c.fixtures || []).forEach((f) => {
        if (crestNorm(f.competition || f.league) === crestNorm(x.name)) {
          f.competition = x.name;
          f.league = x.name;
          f.leagueCrest = x.logo;
          if (country.name) f.country = country.name;
          if (country.flag) f.countryFlag = country.flag;
          if (country.code) f.countryCode = country.code;
        }
      }),
    );
    draftSelections.forEach((f) => {
      if (crestNorm(f.competition || f.league) === crestNorm(x.name)) {
        f.competition = x.name;
        f.league = x.name;
        f.leagueCrest = x.logo;
        if (country.name) f.country = country.name;
        if (country.flag) f.countryFlag = country.flag;
        if (country.code) f.countryCode = country.code;
      }
    });
  }
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch {
    toast("No se pudo guardar en este dispositivo.");
    return;
  }
  save();
  if (cloudSession) queueCloudSync();
  renderAll();
  toast("Datos guardados y vinculados con los partidos correspondientes.");
}
const playerTeamAliases = {
  // Códigos que usan las casas de apuestas (añadidos con cupones reales de Doradobet).
  BET: "real betis",
  SCP: "sporting",
  SPO: "sporting",
  BEN: "benfica",
  SLB: "benfica",
  POR: "porto",
  FCP: "porto",
  MNU: "manchester united",
  MUFC: "manchester united",
  GAL: "galatasaray",
  FEN: "fenerbahce",
  BES: "besiktas",
  BRU: "club brugge",
  CLB: "club brugge",
  AJA: "ajax",
  AJX: "ajax",
  FEY: "feyenoord",
  PSV: "psv",
  LEV: "leverkusen",
  B04: "leverkusen",
  BVB: "borussia dortmund",
  RBL: "rb leipzig",
  ROM: "roma",
  LAZ: "lazio",
  ATA: "atalanta",
  FIO: "fiorentina",
  NEW: "newcastle",
  OM: "marseille",
  MAR: "marseille",
  OL: "lyon",
  LYO: "lyon",
  LIL: "lille",
  LOSC: "lille",
  MON: "monaco",
  ASM: "monaco",
  SEV: "sevilla",
  VIL: "villarreal",
  RSO: "real sociedad",
  ATH: "athletic",
  GIR: "girona",
  CEL: "celtic",
  RAN: "rangers",
  SHA: "shakhtar",
  AVL: "aston villa",
  COM: "como 1907",
  COMO: "como 1907",
  BAR: "barcelona",
  BFC: "bayern munich",
  BAY: "bayern munich",
  FCB: "barcelona",
  RMA: "real madrid",
  ATM: "atletico madrid",
  MUN: "manchester united",
  MCI: "manchester city",
  LIV: "liverpool",
  CHE: "chelsea",
  ARS: "arsenal",
  TOT: "tottenham",
  PSG: "paris saint germain",
  INT: "inter milan",
  JUV: "juventus",
  MIL: "ac milan",
  NAP: "napoli",
  DOR: "borussia dortmund",
};
function playerNameParts(value) {
  const text = String(value || "")
    .replace(/\s*\([A-Z]{2,5}\)\s*/g, " ")
    .replace(/\b(?:incl\.?|including)\b.*$/i, "")
    .replace(/\b(?:y|and)\s+suplente\b.*$/i, "");
  return crestNorm(text)
    .split(" ")
    .filter(
      (x) =>
        x &&
        ![
          "remate",
          "remates",
          "tiro",
          "tiros",
          "a",
          "puerta",
          "goleador",
          "anotador",
          "jugador",
          "suplente",
        ].includes(x),
    );
}
function samePlayerName(a, b) {
  const x = playerNameParts(a),
    y = playerNameParts(b);
  if (!x.length || !y.length) return false;
  const nx = x.join(" "),
    ny = y.join(" ");
  if (nx === ny) return true;
  const lastX = x[x.length - 1],
    lastY = y[y.length - 1];
  if (lastX !== lastY) return false;
  const firstX = x[0],
    firstY = y[0];
  return (
    firstX[0] === firstY[0] &&
    (firstX.length === 1 || firstY.length === 1 || x.length === 1 || y.length === 1)
  );
}
function playerClubKey(value) {
  let raw = String(value || "").trim(),
    code = raw.match(/\(([^)]+)\)/)?.[1] || raw;
  const alias = playerTeamAliases[String(code).toUpperCase()];
  if (alias) return crestNorm(alias);
  const norm = crestNorm(raw);
  for (const [key, name] of Object.entries(playerTeamAliases))
    if (norm === crestNorm(key) || norm === crestNorm(name)) return crestNorm(name);
  return crestNorm(raw.replace(/^equipo\s+/i, ""));
}
function samePlayerClub(a, b) {
  if (!a || !b) return true;
  return playerClubKey(a) === playerClubKey(b);
}
function findSavedPlayer(name, club, dir) {
  const records = Object.entries(dir)
      .filter(([key, item]) => key.startsWith("player:") && item?.name)
      .sort(
        (a, b) =>
          Number(!!(b[1].photo || b[1].url)) - Number(!!(a[1].photo || a[1].url)) ||
          (b[1].savedAt || 0) - (a[1].savedAt || 0),
      ),
    matches = records.filter(([, item]) =>
      [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].some((alias) =>
        samePlayerName(name, alias),
      ),
    );
  return (
    matches.find(([, item]) => samePlayerClub(club, item.club)) || (matches.length === 1 ? matches[0] : null)
  );
}
function playerIdentity(name, club) {
  const words = playerNameParts(name);
  return (words.length ? words[0][0] + "|" + words[words.length - 1] : "unknown") + "|" + playerClubKey(club);
}
function playerIsTrashed(item, trash) {
  if (trash["player:" + item.id]) return true;
  return Object.values(trash).some(
    (x) =>
      x.kind === "player" &&
      samePlayerName(x.name, item.name) &&
      samePlayerClub(x.club || x.country, item.club || item.code),
  );
}
// Detecta si un mercado es de un jugador y extrae su nombre y el código del club, por ejemplo "Nico Paz (COM)".
// Los mercados de equipo o de marcador (por ejemplo "Total de remates - Como" o "Marcador correcto: 2-1") no son jugadores.
const PLAYER_MARKET_RE =
  /(remat|goleador|anotador|anotar[aá]?|tiros? a puerta|tiros? al arco|asistenc|shots?|scorer|to score|player prop|jugador|primer marcador|[uú]ltimo marcador|marcar[aá]? en cualquier|tarjeta|amonestad|falta|parada|atajada|portero|guardameta|cards?\b|saves?\b)/i;
const TEAM_MARKET_RE =
  /\b(?:equipo|local|visitante|total(?:es)?|partido|ambos|1x2|doble oportunidad|h[aá]ndicap|tiempo|descanso|mitad|c[oó]rners?|tarjetas?|marcador (?:correcto|exacto|final|al descanso))\b/i;
const PLAYER_NOISE_WORDS = new Set([
  "remate",
  "remates",
  "tiro",
  "tiros",
  "falta",
  "faltas",
  "cometida",
  "cometidas",
  "recibida",
  "recibidas",
  "a",
  "al",
  "puerta",
  "arco",
  "goleador",
  "anotador",
  "marcador",
  "jugador",
  "jugadores",
  "primer",
  "primero",
  "ultimo",
  "último",
  "cualquier",
  "momento",
  "en",
  "con",
  "o",
  "mas",
  "más",
  "menos",
  "over",
  "under",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "incl",
  "incl.",
  "including",
  "suplente",
  "shot",
  "shots",
  "on",
  "target",
  "anytime",
  "goal",
  "goals",
  "scorer",
  "to",
  "score",
  "player",
  "prop",
  "si",
  "sí",
  "no",
  "asistencia",
  "asistencias",
  "marcara",
  "marcará",
  "marcar",
  "partido",
  "tarjeta",
  "tarjetas",
  "amonestacion",
  "amonestaciones",
  "amarilla",
  "amarillas",
  "roja",
  "rojas",
  "recibe",
  "recibir",
  "parada",
  "paradas",
  "atajada",
  "atajadas",
  "portero",
  "porteros",
  "guardameta",
  "save",
  "saves",
  "card",
  "cards",
  "goalkeeper",
]);
function splitPlayerCode(text) {
  let code = "";
  const s = String(text || "")
    .replace(/\(\s*([A-Z]{2,5})\s*\)/g, (_, c) => {
      code = code || c;
      return " ";
    })
    .replace(/(^|\s)([A-Z]{3,4})(?=\s+[A-ZÀ-Ý][a-zà-ÿ])/g, (all, pre, c) => {
      if (!code) code = c;
      return pre;
    })
    .replace(/([a-zà-ÿ])\s+([A-Z]{3,4})(?=\s|$)/g, (all, pre, c) => {
      if (!code) code = c;
      return pre;
    });
  return { text: s, code };
}
function cleanPlayerCandidate(value) {
  return String(value || "")
    .replace(/\b(?:incl\.?|including)\s+suplente.*$/i, " ")
    .replace(/\b(?:y|and)\s+suplente.*$/i, " ")
    .replace(/\b(?:más|mas|menos|over|under|greater|less)\s+(?:de|than)?\s*\d+(?:[.,]\d+)?\b.*$/i, " ")
    .replace(/\b\d+\s*\+/g, " ")
    .replace(/[()\[\]{}:|•·–—-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !PLAYER_NOISE_WORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
}
// Un nombre de una palabra vale como jugador si parece un nombre propio y no es una palabra de mercado.
const SINGLE_PLAYER_OK = (w) =>
  /^[A-ZÀ-Ý][a-zà-ÿ'’.]{3,}$/.test(w) &&
  !/^(amarillas?|rojas?|total(es)?|local|visitante|empate|over|under|impar|par|ambos|equipo|partido|primer|segundo|tiempo|mitad|suplente|incluido|jugador)$/i.test(
    w,
  );
function parsePlayerBet(market, fixture) {
  // Algunas casas dejan el código del club vacío: "Faltas (Marc Cucurella ())".
  const marketText = String(market?.market || "").replace(/\(\s*\)/g, ""),
    pickText = String(market?.pick || "").replace(/\(\s*\)/g, ""),
    text = (marketText + " " + pickText).trim();
  if (!PLAYER_MARKET_RE.test(text)) return null;
  const nested = text.match(/\(([^()]{3,80})\s*\(([A-Z]{2,5})\)\s*\)/);
  const teamKeys = [fixture?.home, fixture?.away].filter(Boolean).map(teamEventKey);
  const looksLikeTeam = (name) => {
    const k = teamEventKey(name);
    return !k || teamKeys.some((t) => t && (k === t || k.includes(t) || t.includes(k)));
  };
  // single: nombre de una sola palabra («Raphinha», «Vinicius») solo si venía entre paréntesis en un mercado de jugador.
  const accept = (raw, codeHint = "", single = false) => {
    const split = splitPlayerCode(raw),
      name = cleanPlayerCandidate(split.text);
    if (!name || /\d/.test(name) || TEAM_MARKET_RE.test(name)) return null;
    const words = name.split(" ").filter(Boolean),
      code = (codeHint || split.code || "").toUpperCase();
    if (words.length < 2 && !code && !(single && SINGLE_PLAYER_OK(name))) return null;
    if (words.some((w) => !/^[A-Za-zÀ-ÿ'’.]+$/.test(w))) return null;
    if (looksLikeTeam(name)) return null;
    return { name, code };
  };
  if (nested) {
    const r = accept(nested[1], nested[2]);
    if (r) return r;
  }
  const parens = [...text.matchAll(/\(([^()]{3,80})\)/g)]
    .map((m) => m[1].trim())
    .filter((x) => !/^([A-Z]{2,5}|incl\.?.*|suplente)$/i.test(x));
  for (const candidate of [pickText, ...parens, marketText]) {
    const r = accept(candidate, "", parens.includes(candidate) && candidate !== pickText);
    if (r) {
      if (!r.code) r.code = splitPlayerCode(text).code;
      return r;
    }
  }
  return null;
}
function cleanSavedPlayerNames() {
  let changed = false;
  const d = readCrestDirectory();
  Object.entries(d).forEach(([k, item]) => {
    if (!k.startsWith("player:") || !item?.name) return;
    const split = splitPlayerCode(item.name),
      name = cleanPlayerCandidate(split.text);
    if (name && name !== item.name) {
      item.aliases = [...new Set([...(item.aliases || []), item.name])];
      item.name = name;
      if (split.code && !item.teamCode) item.teamCode = split.code;
      changed = true;
    }
  });
  if (changed) {
    try {
      localStorage.setItem(CREST_DIR, JSON.stringify(d));
    } catch (e) {}
  }
}
function titleCaseClub(s) {
  return String(s || "").replace(/\b([a-zà-ÿ])/g, (c) => c.toUpperCase());
}
// Códigos de selecciones que usan las casas (GER, ENG, DNK…) → nombre en inglés de la lista de países.
const NATION_CODES = Object.fromEntries(
  [
    ["ALB", "Albania"],
    ["AND", "Andorra"],
    ["ARM", "Armenia"],
    ["AUT", "Austria"],
    ["AZE", "Azerbaijan"],
    ["BEL", "Belgium"],
    ["BLR", "Belarus"],
    ["BIH", "Bosnia and Herzegovina"],
    ["BUL", "Bulgaria"],
    ["CYP", "Cyprus"],
    ["CRO", "Croatia"],
    ["DEN DNK", "Denmark"],
    ["SCO", "Scotland"],
    ["SVK", "Slovakia"],
    ["SVN SLO", "Slovenia"],
    ["ESP", "Spain"],
    ["EST", "Estonia"],
    ["FIN", "Finland"],
    ["FRA", "France"],
    ["WAL", "Wales"],
    ["GEO", "Georgia"],
    ["GIB", "Gibraltar"],
    ["GRE GRC", "Greece"],
    ["HUN", "Hungary"],
    ["ENG", "England"],
    ["IRL IRE", "Ireland"],
    ["NIR", "Northern Ireland"],
    ["ISL ICE", "Iceland"],
    ["FRO", "Faroe Islands"],
    ["ISR", "Israel"],
    ["ITA", "Italy"],
    ["KAZ", "Kazakhstan"],
    ["KOS", "Kosovo"],
    ["LVA LAT", "Latvia"],
    ["LIE", "Liechtenstein"],
    ["LTU LIT", "Lithuania"],
    ["LUX", "Luxembourg"],
    ["MKD", "North Macedonia"],
    ["MLT", "Malta"],
    ["MDA", "Moldova"],
    ["MNE", "Montenegro"],
    ["NOR", "Norway"],
    ["NED NLD", "Netherlands"],
    ["POL", "Poland"],
    ["POR PRT", "Portugal"],
    ["GBR", "United Kingdom"],
    ["CZE", "Czechia"],
    ["ROU ROM", "Romania"],
    ["RUS", "Russia"],
    ["SMR", "San Marino"],
    ["SRB", "Serbia"],
    ["SWE", "Sweden"],
    ["SUI CHE", "Switzerland"],
    ["TUR", "Turkey"],
    ["UKR", "Ukraine"],
    ["GER DEU", "Germany"],
    ["ARG", "Argentina"],
    ["BOL", "Bolivia"],
    ["BRA", "Brazil"],
    ["CHI CHL", "Chile"],
    ["COL", "Colombia"],
    ["ECU", "Ecuador"],
    ["PAR", "Paraguay"],
    ["PER", "Peru"],
    ["URU", "Uruguay"],
    ["VEN", "Venezuela"],
    ["CAN", "Canada"],
    ["CRC", "Costa Rica"],
    ["CUB", "Cuba"],
    ["SLV", "El Salvador"],
    ["USA", "United States"],
    ["GUA", "Guatemala"],
    ["HAI", "Haiti"],
    ["HON", "Honduras"],
    ["JAM", "Jamaica"],
    ["MEX", "Mexico"],
    ["NCA NIC", "Nicaragua"],
    ["PAN", "Panama"],
    ["DOM", "Dominican Republic"],
    ["TRI TTO", "Trinidad and Tobago"],
    ["CUW", "Curacao"],
    ["SUR", "Suriname"],
    ["ALG", "Algeria"],
    ["ANG", "Angola"],
    ["BEN", "Benin"],
    ["BFA", "Burkina Faso"],
    ["CPV", "Cape Verde"],
    ["CMR", "Cameroon"],
    ["CIV", "Ivory Coast"],
    ["EGY", "Egypt"],
    ["GAB", "Gabon"],
    ["GAM GMB", "Gambia"],
    ["GHA", "Ghana"],
    ["GUI", "Guinea"],
    ["EQG", "Equatorial Guinea"],
    ["KEN", "Kenya"],
    ["LBY LBA", "Libya"],
    ["MLI", "Mali"],
    ["MAR", "Morocco"],
    ["MTN", "Mauritania"],
    ["MOZ", "Mozambique"],
    ["NAM", "Namibia"],
    ["NGA", "Nigeria"],
    ["COD", "DR Congo"],
    ["CGO COG", "Congo"],
    ["SEN", "Senegal"],
    ["SLE", "Sierra Leone"],
    ["SOM", "Somalia"],
    ["RSA", "South Africa"],
    ["SDN SUD", "Sudan"],
    ["TAN TZA", "Tanzania"],
    ["TOG", "Togo"],
    ["TUN", "Tunisia"],
    ["UGA", "Uganda"],
    ["ZAM ZMB", "Zambia"],
    ["ZIM", "Zimbabwe"],
    ["KSA SAU", "Saudi Arabia"],
    ["AUS", "Australia"],
    ["CHN", "China"],
    ["KOR", "South Korea"],
    ["UAE ARE", "United Arab Emirates"],
    ["IND", "India"],
    ["IRQ", "Iraq"],
    ["IRN", "Iran"],
    ["JPN", "Japan"],
    ["JOR", "Jordan"],
    ["NZL", "New Zealand"],
    ["QAT", "Qatar"],
    ["UZB", "Uzbekistan"],
  ].flatMap(([codes, name]) => codes.split(" ").map((c) => [c, name])),
);
function playerClubForCode(code, fixture) {
  code = String(code || "")
    .trim()
    .toUpperCase();
  if (!code) return { side: "", club: "" };
  // Selecciones: GER → Alemania, ENG → Inglaterra, DNK → Dinamarca… (solo si el partido es de selecciones).
  const nation = NATION_CODES[code] ? findCountryLocal(NATION_CODES[code]) : null;
  if (nation)
    for (const [side, name] of [
      ["home", fixture?.home],
      ["away", fixture?.away],
    ]) {
      const c = name && findCountryLocal(name);
      if (c && c.en === nation.en) return { side, club: name };
    }
  const alias = playerTeamAliases[code];
  for (const [side, name] of [
    ["home", fixture?.home],
    ["away", fixture?.away],
  ]) {
    if (!name) continue;
    const norm = crestNorm(name);
    const words = norm
      .split(" ")
      .filter((x) => !["fc", "cf", "sk", "sc", "afc", "club", "de", "the", "ac", "as"].includes(x));
    if (!words.length) continue;
    const compact = words.join(" "),
      letters = words.join(""),
      initials = words.map((x) => x[0]).join(""),
      lower = code.toLowerCase();
    const generic =
      words.length > 1
        ? words[0][0] + words[words.length - 1][0] + words[words.length - 1].slice(-1)
        : letters.slice(0, 3);
    const aliasNorm = alias ? crestNorm(alias) : "";
    if (
      (aliasNorm &&
        (aliasNorm === compact ||
          (" " + compact + " ").includes(" " + aliasNorm + " ") ||
          aliasNorm.startsWith(compact) ||
          teamEventKey(alias) === teamEventKey(name))) ||
      (!aliasNorm && lower.length >= 3 && words.some((w) => w.length > 3 && w.startsWith(lower))) ||
      lower === initials ||
      lower === generic ||
      letters.startsWith(lower)
    )
      return { side, club: name };
  }
  const nationalFixture = [fixture?.home, fixture?.away].some((n) => n && findCountryLocal(n));
  return {
    side: "",
    club: alias ? titleCaseClub(alias) : nation && nationalFixture ? nation.es : "Equipo (" + code + ")",
  };
}
function collectPlayerBets() {
  const bets = new Map(),
    dir = readCrestDirectory(),
    trash = readLogoTrash();
  playerBetRefs = {};
  const add = (f, m, ref) => {
    const parsed = parsePlayerBet(m, f);
    if (!parsed) return;
    const marketKey = marketKeyForPlayer(f, m),
      team = playerClubForCode(parsed.code, f),
      saved = findSavedPlayer(parsed.name, team.club, dir),
      id = saved ? "saved:" + saved[0] : playerIdentity(parsed.name, team.club || parsed.code),
      existing = bets.get(id);
    if (existing) {
      existing.count++;
      existing.aliases = [...new Set([...(existing.aliases || []), parsed.name])];
      if (!existing.marketKey) existing.marketKey = marketKey;
      if (!playerBetRefs[id])
        playerBetRefs[id] = { ref, side: team.side, club: existing.club, code: parsed.code };
      return;
    }
    const entry = {
      id,
      name: saved?.[1]?.name || parsed.name,
      aliases: [parsed.name, ...(saved?.[1]?.aliases || [])],
      code: parsed.code,
      club: saved?.[1]?.club || team.club || "",
      country: saved?.[1]?.country || "",
      photo: saved?.[1]?.photo || saved?.[1]?.url || "",
      savedKey: saved?.[0] || "",
      playerId: saved?.[1]?.playerId || "",
      marketKey,
      count: 1,
    };
    bets.set(id, entry);
    playerBetRefs[id] = { ref, side: team.side, club: entry.club, code: parsed.code };
  };
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f, fixtureIndex) =>
      (f.markets || []).forEach((m) => add(f, m, { couponId: c.id, fixtureIndex })),
    ),
  );
  draftSelections.forEach((f, fixtureIndex) =>
    (f.markets || []).forEach((m) => add(f, m, { draft: true, fixtureIndex })),
  );
  // Jugadores que sigues a mano o anotaste como goleadores en el marcador (sin mercado): también llevan foto y equipo.
  const fixRefs = new Map();
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f, fixtureIndex) => {
      const k = fixtureKey(f);
      if (!fixRefs.has(k)) fixRefs.set(k, { couponId: c.id, fixtureIndex, f });
    }),
  );
  Object.entries(db.stats || {}).forEach(([fk, st]) => {
    const info = fixRefs.get(fk);
    if (!info) return;
    [
      ...(Array.isArray(st?.tracked) ? st.tracked : []),
      ...(Array.isArray(st?.scorers) ? st.scorers : []),
    ].forEach((t) => {
      if (!t?.name || !(t.side === "home" || t.side === "away")) return;
      const club = info.f[t.side] || "",
        saved = findSavedPlayer(t.name, club, dir),
        id = saved ? "saved:" + saved[0] : playerIdentity(t.name, club),
        existing = bets.get(id);
      if (existing) {
        existing.aliases = [...new Set([...(existing.aliases || []), t.name])];
        return;
      }
      bets.set(id, {
        id,
        name: saved?.[1]?.name || t.name,
        aliases: [t.name, ...(saved?.[1]?.aliases || [])],
        code: "",
        club: saved?.[1]?.club || club,
        country: saved?.[1]?.country || "",
        photo: saved?.[1]?.photo || saved?.[1]?.url || "",
        savedKey: saved?.[0] || "",
        playerId: saved?.[1]?.playerId || "",
        marketKey: "",
        count: 0,
      });
      playerBetRefs[id] = {
        ref: { couponId: info.couponId, fixtureIndex: info.fixtureIndex },
        side: t.side,
        club,
        code: "",
      };
    });
  });
  Object.entries(dir)
    .filter(([key, item]) => key.startsWith("player:") && item?.name)
    .sort(
      (a, b) =>
        Number(!!(b[1].photo || b[1].url)) - Number(!!(a[1].photo || a[1].url)) ||
        (b[1].savedAt || 0) - (a[1].savedAt || 0),
    )
    .forEach(([key, item]) => {
      if (
        [...bets.values()].some((x) => samePlayerName(x.name, item.name) && samePlayerClub(x.club, item.club))
      )
        return;
      const id = "saved:" + key;
      bets.set(id, {
        id,
        name: item.name || "Jugador",
        aliases: item.aliases || [],
        code: item.teamCode || "",
        club: item.club || "",
        country: item.country || "",
        photo: item.photo || item.url || "",
        savedKey: key,
        playerId: item.playerId || "",
        marketKey: item.marketKey || "",
        count: 0,
      });
    });
  return [...bets.values()]
    .filter((x) => !playerIsTrashed(x, trash))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
// Secciones plegables de Logos: recuerdan si estaban abiertas; al buscar se abren las que tienen resultados.
const FOLD_KEY = "kal_fold_state_v1";
function readFolds() {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeFolds(s) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(s));
  } catch {}
}
function setFold(el, open) {
  el.classList.toggle("is-open", open);
  el.querySelector(".fold-head")?.setAttribute("aria-expanded", String(open));
}
function syncFoldAllLabel() {
  const all = $("foldAllBtn");
  if (all)
    all.textContent = [...document.querySelectorAll("#view-logos .fold")].every((el) =>
      el.classList.contains("is-open"),
    )
      ? "Contraer todo"
      : "Expandir todo";
}
// Filtro de cada sección (por defecto "Faltan": lo que aún no tiene foto o escudo).
const LG_FILTER_KEY = "kal_logo_filter_v1";
function readLgFilters() {
  try {
    return JSON.parse(localStorage.getItem(LG_FILTER_KEY) || "{}");
  } catch {
    return {};
  }
}
function setLgFilter(fold, value) {
  const f = readLgFilters();
  f[fold] = value;
  try {
    localStorage.setItem(LG_FILTER_KEY, JSON.stringify(f));
  } catch {}
}
const LG_TILES = [
  ["logoClubs", "🛡️", "Clubes"],
  ["logoNat", "🏳️", "Selecciones"],
  ["logoLeagues", "🏆", "Ligas"],
  ["logoPlayers", "👤", "Jugadores"],
];
function lgCounts(el) {
  const total = el.querySelectorAll(".fold-body .logo-card").length,
    has = el.querySelectorAll('.fold-body .logo-card[data-has="1"]').length;
  return { total, has, miss: total - has };
}
function renderLogoSummary() {
  const box = $("logoSummary");
  if (!box) return;
  box.innerHTML = LG_TILES.map(([k, ico, label]) => {
    const el = document.querySelector('#view-logos .fold[data-fold="' + k + '"]');
    if (!el) return "";
    const { total, has, miss } = lgCounts(el);
    return (
      '<button type="button" class="lg-tile' +
      (total && !miss ? " is-ok" : "") +
      '" data-lg-open="' +
      k +
      '"><span class="lg-ico">' +
      ico +
      "</span><b>" +
      label +
      "</b><small>" +
      has +
      " de " +
      total +
      '</small><i class="lg-bar"><u style="width:' +
      (total ? Math.round((has / total) * 100) : 0) +
      '%"></u></i><em>' +
      (!total ? "sin datos" : miss ? "faltan " + miss : "✓ completo") +
      "</em></button>"
    );
  }).join("");
}
function updateFolds() {
  const state = readFolds(),
    filters = readLgFilters(),
    searching = !!($("logoSearch")?.value || "").trim() || logoManagerFocus.length > 0;
  document.querySelectorAll("#view-logos .fold").forEach((el) => {
    const { total, has, miss } = lgCounts(el),
      badge = el.querySelector(".fold-count");
    if (badge) badge.textContent = total;
    if (el.dataset.kind === "logos") {
      // Buscando se muestran todos; si no, el filtro elegido (por defecto, lo que falta).
      const f = searching ? "all" : filters[el.dataset.fold] || "pending";
      el.dataset.filter = f;
      el.querySelectorAll("[data-lg-filter]").forEach((b) => {
        const on = b.dataset.lgFilter === f;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
        const n = b.querySelector("b");
        if (n)
          n.textContent =
            b.dataset.lgFilter === "pending" ? miss : b.dataset.lgFilter === "saved" ? has : total;
      });
      const m = el.querySelector(".fold-miss");
      if (m) {
        m.textContent = !total ? "" : miss ? "faltan " + miss : "✓ completo";
        m.classList.toggle("is-ok", total > 0 && !miss);
      }
      const done = el.querySelector(".lg-done");
      if (done) done.hidden = !(f === "pending" && total > 0 && miss === 0);
    }
    // Por defecto todo retraído; recuerda lo que abres.
    let open = !!state[el.dataset.fold];
    if (searching && el.dataset.fold !== "catalog") open = total > 0;
    setFold(el, open);
  });
  syncFoldAllLabel();
  renderLogoSummary();
}
function toggleFold(el, open) {
  const state = readFolds();
  state[el.dataset.fold] = open;
  writeFolds(state);
  setFold(el, open);
  syncFoldAllLabel();
}
document.addEventListener("click", (e) => {
  const head = e.target.closest("[data-fold-toggle]");
  if (head) {
    const el = head.closest(".fold");
    toggleFold(el, !el.classList.contains("is-open"));
    return;
  }
  if (e.target.closest("#foldAllBtn")) {
    const els = [...document.querySelectorAll("#view-logos .fold")],
      open = !els.every((x) => x.classList.contains("is-open"));
    els.forEach((x) => toggleFold(x, open));
  }
});
function marketKeyForPlayer(f, m) {
  return marketKey(f, m);
}
// ---- Filas compactas: una línea por escudo/foto con un solo botón visible; el resto en "⋯" ----
const lgInitials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
function lgRow(o) {
  return (
    '<article class="logo-card lg-row ' +
    (o.cls || "") +
    '" data-has="' +
    (o.has ? 1 : 0) +
    '"><div class="logo-card-top">' +
    o.thumb +
    '<div class="logo-team-info"><strong>' +
    esc(o.name) +
    "</strong><span>" +
    esc(o.sub) +
    "</span></div>" +
    // Guardado: marca ✓. Pendiente: el botón «＋ Buscar» ya lo dice (no hace falta otra etiqueta).
    (o.has ? '<span class="logo-status is-saved" title="Guardado">✓</span>' : "") +
    (o.primary || "") +
    '<button type="button" class="lg-more" data-lg-more aria-expanded="false" aria-label="Más opciones de ' +
    esc(o.name) +
    '">⋯</button></div><div class="logo-card-actions">' +
    o.actions +
    "</div>" +
    (o.options || "") +
    "</article>"
  );
}
const lgBtn = (cls, attrs, text) =>
  '<button type="button" class="btn sm ' + cls + '" ' + attrs + ">" + text + "</button>";
function teamCard(x) {
  const t = x.team,
    has = !!t.url,
    i = x.index;
  return lgRow({
    has,
    name: t.name,
    sub: (t.country || "País no especificado") + " · " + (t.matches || 0) + " partido(s)",
    thumb: crestHTML(t.url, t.name),
    primary: has ? "" : lgBtn("gold lg-main", 'data-logo-lookup="' + i + '"', "＋ Buscar"),
    actions:
      (has ? lgBtn("", 'data-logo-lookup="' + i + '"', "↻ Actualizar") : "") +
      lgBtn("", 'data-logo-id="' + i + '"', "Por ID") +
      lgBtn("", 'data-logo-upload="' + i + '" title="Subir imagen del teléfono"', "📷 Subir imagen") +
      (has ? lgBtn("", 'data-team-logo-remove="' + esc(t.key) + '"', "Quitar") : "") +
      lgBtn("danger", 'data-logo-hide="' + esc(t.key) + '"', "🗑 Ocultar"),
    options: '<div class="logo-options" id="logo-options-' + i + '"></div>',
  });
}
function leagueCard(x, index) {
  const has = !!x.url;
  return lgRow({
    has,
    name: x.name,
    sub: (x.country || "País no especificado") + " · " + x.matches + " partido(s)",
    thumb: crestHTML(x.url, x.name),
    primary: has ? "" : lgBtn("gold lg-main", 'data-league-search="' + index + '"', "＋ Buscar"),
    actions:
      (has ? lgBtn("", 'data-league-search="' + index + '"', "↻ Actualizar por nombre") : "") +
      lgBtn("", 'data-league-id="' + esc(x.key) + '"', "Por ID") +
      lgBtn(
        "",
        'data-league-upload="' + esc(x.key) + '" title="Subir imagen del teléfono"',
        "📷 Subir imagen",
      ) +
      (has ? lgBtn("", 'data-league-remove="' + esc(x.key) + '"', "Quitar") : "") +
      lgBtn("danger", 'data-league-hide="' + esc(x.key) + '"', "🗑 Ocultar"),
    options: '<div class="logo-options" id="league-options-' + index + '"></div>',
  });
}
function playerCard(item) {
  const has = !!item.photo,
    open = 'data-pp-open="' + esc(item.id) + '"';
  return lgRow({
    has,
    cls: "player-logo-card",
    name: item.name,
    sub: [
      /^Equipo \(/.test(item.club || "") ? "" : item.club,
      item.country,
      item.count ? item.count + " mercado(s)" : "seguido",
    ]
      .filter(Boolean)
      .join(" · "),
    thumb: has
      ? '<img class="player-logo-thumb" src="' +
        esc(playerImageUrl(item.photo)) +
        '" alt="Foto de ' +
        esc(item.name) +
        '" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="team-fallback player-logo-thumb">' + esc(lgInitials(item.name)) + "</span>",
    primary: has ? "" : lgBtn("gold lg-main", open, "＋ Buscar"),
    actions:
      (has ? lgBtn("", open, "↻ Actualizar foto") : "") +
      lgBtn("", 'data-player-id="' + esc(item.id) + '"', "Por ID") +
      lgBtn(
        "",
        'data-player-upload="' + esc(item.id) + '" title="Subir foto del teléfono"',
        "📷 Subir foto",
      ) +
      (has && item.savedKey
        ? lgBtn("", 'data-player-photo-remove="' + esc(item.savedKey) + '"', "Quitar foto")
        : "") +
      lgBtn("danger", 'data-player-hide="' + esc(item.id) + '"', "🗑 Ocultar"),
  });
}
const lgFill = (el, items, empty) => {
  if (el) el.innerHTML = items.length ? items.join("") : empty;
};
function renderLogos() {
  const el = $("logoList"),
    archive = $("logoArchive");
  if (!el || !archive) return;
  logoManagerTeams = collectLogoTeams();
  const q = crestNorm($("logoSearch")?.value || ""),
    shown = logoManagerTeams
      .map((team, index) => ({ team, index }))
      .filter(
        (x) =>
          (!logoManagerFocus.length || logoManagerFocus.includes(x.team.key)) &&
          (!q || crestNorm(x.team.name).includes(q) || crestNorm(x.team.country).includes(q)),
      );
  const clearFocus = $("logoClearFocus");
  if (clearFocus) clearFocus.hidden = !logoManagerFocus.length;
  $("logoTeamCount").textContent = logoManagerTeams.length;
  $("logoSavedCount").textContent = logoManagerTeams.filter((t) => t.url).length;
  // Clubes y selecciones van en secciones distintas (las selecciones llevan bandera).
  const national = (x) => !!findCountryLocal(x.team.name),
    savedMsg = (what) =>
      '<div class="empty logo-empty"><strong>Aún no hay ' +
      what +
      " guardados</strong>Al guardar uno, aparecerá aquí.</div>";
  const clubs = shown.filter((x) => !national(x)),
    nats = shown.filter(national);
  lgFill(el, clubs.filter((x) => !x.team.url).map(teamCard), "");
  lgFill(archive, clubs.filter((x) => x.team.url).map(teamCard), savedMsg("escudos"));
  lgFill($("logoListNat"), nats.filter((x) => !x.team.url).map(teamCard), "");
  lgFill($("logoArchiveNat"), nats.filter((x) => x.team.url).map(teamCard), savedMsg("banderas"));
  const playerArchive = $("playerPhotoArchive");
  if (playerArchive) {
    const players = collectPlayerBets()
      .filter(
        (item) =>
          !q ||
          crestNorm(item.name).includes(q) ||
          crestNorm(item.club).includes(q) ||
          crestNorm(item.country).includes(q),
      )
      // Primero los que no tienen foto.
      .sort((a, b) => !!a.photo - !!b.photo);
    lgFill(
      playerArchive,
      players.map(playerCard),
      '<div class="empty logo-empty"><strong>No detecté mercados de jugadores</strong>Los jugadores aparecerán automáticamente al guardar cupones con mercados de remates, goleador, tarjetas o paradas.</div>',
    );
    showPlayerPhotoImagesIn(playerArchive);
  }
  const leagueEl = $("leagueLogoList"),
    leagueArchive = $("leagueLogoArchive");
  if (leagueEl && leagueArchive) {
    const allLeagues = collectLogoLeagues(),
      leagues = allLeagues.filter(
        (x) => !q || crestNorm(x.name).includes(q) || crestNorm(x.country).includes(q),
      );
    lgFill(
      leagueEl,
      leagues.filter((x) => !x.url).map((x) => leagueCard(x, allLeagues.indexOf(x))),
      "",
    );
    lgFill(
      leagueArchive,
      leagues.filter((x) => x.url).map((x) => leagueCard(x, allLeagues.indexOf(x))),
      '<div class="empty logo-empty"><strong>Aún no hay ligas guardadas</strong>Busca por ID para archivarlas.</div>',
    );
    renderLogoTrash();
  }
  updateFolds();
}

// Filtros, tarjetas resumen y opciones de cada fila.
document.addEventListener("click", (e) => {
  const flt = e.target.closest("[data-lg-filter]");
  if (flt) {
    setLgFilter(flt.closest(".fold").dataset.fold, flt.dataset.lgFilter);
    updateFolds();
    return;
  }
  const tile = e.target.closest("[data-lg-open]");
  if (tile) {
    const el = document.querySelector('#view-logos .fold[data-fold="' + tile.dataset.lgOpen + '"]');
    if (!el) return;
    setLgFilter(el.dataset.fold, "pending");
    if (!el.classList.contains("is-open")) toggleFold(el, true);
    updateFolds();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const more = e.target.closest("[data-lg-more]"),
    top = !more && e.target.closest(".lg-row .logo-card-top");
  if (more || (top && !e.target.closest("button, a, input, img"))) {
    const card = (more || top).closest(".lg-row"),
      open = !card.classList.contains("is-open");
    card.classList.toggle("is-open", open);
    card.querySelector("[data-lg-more]")?.setAttribute("aria-expanded", String(open));
  }
});

async function saveLogoById(kind, indexOrKey) {
  const team = kind === "team" ? logoManagerTeams[Number(indexOrKey)] : null;
  const name = team?.name || collectLogoLeagues().find((x) => x.key === indexOrKey)?.name;
  if (!name) {
    toast("No encontré el nombre del equipo o competencia.");
    return;
  }
  const raw = prompt("Escribe solo el ID numérico de " + name + " en API-Football:");
  if (raw === null) return;
  const id = raw.trim();
  if (!/^\d{1,10}$/.test(id)) {
    toast("El ID debe contener solo números.");
    return;
  }
  const path = kind === "team" ? "teams" : "leagues",
    url = "https://media.api-sports.io/football/" + path + "/" + id + ".png";
  try {
    await loadCrestImage(url);
  } catch (e) {
    toast("No se pudo cargar esa imagen. Revisa el ID e intenta otra vez.");
    return;
  }
  const dir = readCrestDirectory(),
    key = savedCrestKey(kind, name);
  dir[key] = {
    name,
    url,
    country: team?.country || collectLogoLeagues().find((x) => x.key === key)?.country || "",
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch (e) {
    toast("No se pudo guardar el catálogo de logos.");
    return;
  }
  if (kind === "team") {
    db.coupons.forEach((c) =>
      (c.fixtures || []).forEach((f) => {
        if (crestNorm(f.home) === crestNorm(name)) f.homeCrest = url;
        if (crestNorm(f.away) === crestNorm(name)) f.awayCrest = url;
      }),
    );
    draftSelections.forEach((f) => {
      if (crestNorm(f.home) === crestNorm(name)) f.homeCrest = url;
      if (crestNorm(f.away) === crestNorm(name)) f.awayCrest = url;
    });
  } else {
    db.coupons.forEach((c) =>
      (c.fixtures || []).forEach((f) => {
        if (crestNorm(f.competition || f.league) === crestNorm(name)) f.leagueCrest = url;
      }),
    );
    draftSelections.forEach((f) => {
      if (crestNorm(f.competition || f.league) === crestNorm(name)) f.leagueCrest = url;
    });
  }
  save();
  if (cloudSession) queueCloudSync();
  renderAll();
  toast("Logo guardado para " + name + ". Se reutilizará automáticamente.");
}
function removeLeagueLogo(key) {
  const dir = readCrestDirectory(),
    item = dir[key];
  if (item) {
    item.url = "";
    item.logo = "";
  }
  localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      if (savedCrestKey("league", f.competition || f.league) === key) f.leagueCrest = "";
    }),
  );
  draftSelections.forEach((f) => {
    if (savedCrestKey("league", f.competition || f.league) === key) f.leagueCrest = "";
  });
  save();
  if (cloudSession) queueCloudSync();
  renderAll();
}
function removeTeamLogo(key) {
  const d = readCrestDirectory(),
    item = d[key];
  if (!item) return;
  item.url = "";
  item.logo = "";
  localStorage.setItem(CREST_DIR, JSON.stringify(d));
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      if (savedCrestKey("team", f.home) === key) f.homeCrest = "";
      if (savedCrestKey("team", f.away) === key) f.awayCrest = "";
    }),
  );
  draftSelections.forEach((f) => {
    if (savedCrestKey("team", f.home) === key) f.homeCrest = "";
    if (savedCrestKey("team", f.away) === key) f.awayCrest = "";
  });
  save();
  if (cloudSession) queueCloudSync();
  renderAll();
  toast("Se quitó el escudo; el equipo sigue en la lista.");
}
const leagueLookupOptions = {};
async function lookupSavedLeagueLogo(i) {
  const xs = collectLogoLeagues(),
    x = xs[i],
    box = $("league-options-" + i),
    btn = document.querySelector('[data-league-search="' + i + '"]');
  if (!x || !box) return;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  box.textContent = "Consultando catálogos (español e inglés)…";
  try {
    const p = new URLSearchParams({ home: "", away: "", league: x.name, country: x.country || "" });
    const [af, more] = await Promise.allSettled([
      fetch("/api/escudos?" + p, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(16000),
      }).then((r) => r.json().then((d) => (r.ok ? d.league?.options || [] : []))),
      logoSearch("liga", x.name, x.country || ""),
    ]);
    const opts = [
      ...(more.status === "fulfilled" ? more.value : []),
      ...(af.status === "fulfilled" ? af.value : []),
    ];
    if (!opts.length) {
      box.textContent = "Sin coincidencias. Prueba Buscar por ID.";
      return;
    }
    leagueLookupOptions[x.key] = opts;
    box.innerHTML =
      '<select class="input" id="league-choice-' +
      i +
      '">' +
      opts
        .map(
          (o, j) =>
            '<option value="' +
            j +
            '">' +
            esc(o.name) +
            (o.country ? " · " + esc(o.country) : "") +
            (o.source ? " (" + esc(o.source) + ")" : "") +
            "</option>",
        )
        .join("") +
      '</select><button class="btn good sm" data-league-option="' +
      i +
      '" data-option-index="0">Guardar selección</button>';
    const sel = box.querySelector("select"),
      b = box.querySelector("button");
    sel.addEventListener("change", () => (b.dataset.optionIndex = sel.value));
  } catch (e) {
    box.textContent = e.message || "No se pudo buscar.";
  } finally {
    btn.disabled = false;
    btn.textContent = x.url ? "Actualizar por nombre" : "Buscar por nombre";
  }
}
async function saveLeagueLookupOption(i, j) {
  const x = collectLogoLeagues()[i],
    o = x && leagueLookupOptions[x.key]?.[j];
  if (!x || !o?.logo) {
    toast("Elige una liga válida.");
    return;
  }
  await saveCatalogLogo("league", x.name, o.logo, o.country || x.country);
}
async function saveCatalogLogo(kind, name, url, country = "") {
  try {
    await loadCrestImage(url);
  } catch {
    toast("No se pudo cargar esa imagen.");
    return;
  }
  const k = savedCrestKey(kind, name),
    d = readCrestDirectory();
  d[k] = { kind, name, url, country, savedAt: Date.now() };
  localStorage.setItem(CREST_DIR, JSON.stringify(d));
  if (kind === "league") {
    db.coupons.forEach((c) =>
      (c.fixtures || []).forEach((f) => {
        if (savedCrestKey("league", f.competition || f.league) === k) f.leagueCrest = url;
      }),
    );
    draftSelections.forEach((f) => {
      if (savedCrestKey("league", f.competition || f.league) === k) f.leagueCrest = url;
    });
  }
  save();
  if (cloudSession) queueCloudSync();
  renderAll();
  toast("Logo guardado para " + name + ".");
}
async function savePlayerPhotoById(keyId) {
  const x = collectPlayerBets().find((p) => p.id === keyId);
  if (!x) return;
  const raw = prompt("Escribe solo el ID numérico del jugador en API-Football:");
  if (raw === null) return;
  const id = raw.trim();
  if (!/^\d{1,10}$/.test(id)) {
    toast("El ID debe contener solo números.");
    return;
  }
  const url = "https://media.api-sports.io/football/players/" + id + ".png";
  try {
    await loadCrestImage(url);
  } catch {
    toast("No se pudo cargar esa foto. Revisa el ID.");
    return;
  }
  const d = readCrestDirectory(),
    key = "player:" + id,
    aliases = new Set([x.name, ...(x.aliases || [])]);
  Object.entries(d).forEach(([oldKey, item]) => {
    if (!oldKey.startsWith("player:")) return;
    const oldId = String(item.playerId || oldKey.split(":")[1] || "");
    if (oldId === id || (samePlayerName(item.name, x.name) && samePlayerClub(item.club, x.club))) {
      if (item.name) aliases.add(item.name);
      (item.aliases || []).forEach((a) => aliases.add(a));
      if (oldKey !== key) delete d[oldKey];
    }
  });
  d[key] = {
    kind: "player",
    playerId: id,
    name: x.name,
    aliases: [...aliases],
    club: x.club,
    country: x.country,
    teamCode: x.code,
    photo: url,
    url,
    marketKey: x.marketKey || "",
    savedAt: Date.now(),
  };
  localStorage.setItem(CREST_DIR, JSON.stringify(d));
  if (x.marketKey) matchPlayerPhotos[x.marketKey] = playerImageUrl(url);
  if (cloudSession) queueCloudSync();
  renderLogos();
  if (currentMatchRef) renderMatchDetail();
  toast("Foto guardada para " + x.name + ".");
}
// Busca el escudo en API-Football y TheSportsDB a la vez; se toca el correcto para guardarlo.
async function lookupSavedTeamLogo(index, query = "") {
  const team = logoManagerTeams[index],
    box = $("logo-options-" + index),
    button = document.querySelector('[data-logo-lookup="' + index + '"]');
  if (!team || !box) return;
  const tools =
    '<div class="logo-tools"><input class="input" id="logo-q-' +
    index +
    '" placeholder="Buscar con otro nombre" value="' +
    esc(query) +
    '"><button type="button" class="btn sm" data-logo-requery="' +
    index +
    '">Buscar</button><button type="button" class="btn sm" data-logo-upload="' +
    index +
    '">📷 Subir imagen</button></div>';
  if (location.protocol === "file:") {
    box.innerHTML =
      '<span class="marketmeta">La búsqueda automática está disponible al publicar la app en Cloudflare.</span>' +
      tools;
    return;
  }
  const q = (query || team.name).trim();
  if (button) {
    button.disabled = true;
    button.textContent = "Buscando…";
  }
  box.innerHTML =
    '<span class="marketmeta">Buscando en football-data.org, Wikipedia, TheSportsDB y API-Football…</span>';
  const apiFootball = (async () => {
    const params = new URLSearchParams({ home: q, away: "", league: "", country: team.country || "" }),
      cache = crestCacheRead(),
      cacheKey = crestNorm([q, "", "", team.country || ""].join("|"));
    let data = cache[cacheKey];
    if (!data) {
      const r = await fetch("/api/escudos?" + params.toString(), {
        headers: { Accept: "application/json" },
      });
      data = await r.json();
      if (!r.ok) throw Error(data.error || "No se pudo consultar API-Football.");
      cache[cacheKey] = data;
      const keys = Object.keys(cache);
      if (keys.length > 200) delete cache[keys[0]];
      try {
        localStorage.setItem(CREST_CACHE, JSON.stringify(cache));
      } catch {}
    }
    return (data.home?.options || []).map((o) => ({ ...o, source: "API-Football" }));
  })();
  try {
    const [a, b] = await Promise.allSettled([apiFootball, logoSearch("equipo", q, team.country || "")]);
    const seenLogo = new Set();
    const options = [
      ...(b.status === "fulfilled" ? b.value : []),
      ...(a.status === "fulfilled" ? a.value : []),
    ].filter((o) => o.logo && !seenLogo.has(o.logo) && seenLogo.add(o.logo));
    const errors = [a, b]
      .filter((x) => x.status === "rejected")
      .map((x) => x.reason?.message)
      .filter(Boolean);
    logoLookupState[team.key] = options;
    box.innerHTML =
      (options.length
        ? '<span class="marketmeta">Toca el escudo correcto para guardarlo:</span>' +
          crestOptionsHTML(options, 'data-logo-opt="' + index + '" data-opt')
        : '<span class="marketmeta">No encontré a “' +
          esc(q) +
          "”" +
          (errors.length ? " (" + esc(errors[0]) + ")" : "") +
          ". Prueba con otro nombre o sube una imagen.</span>") + tools;
    showCrestImagesIn(box);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = team.url ? "↻ Actualizar escudo" : "＋ Buscar escudo";
    }
  }
}
async function saveManualTeamLogo(index) {
  const team = logoManagerTeams[index],
    url = $("logo-manual-" + index)?.value.trim();
  if (!team || !safeCrestSource(url)) {
    toast("Pega una URL segura de un escudo de API-Football.");
    return;
  }
  const dir = readCrestDirectory();
  dir[team.key] = { name: team.name, url, country: team.country || "", savedAt: Date.now() };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch (e) {
    toast("No se pudo guardar el catálogo de escudos.");
    return;
  }
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      if (crestNorm(f.home) === crestNorm(team.name)) f.homeCrest = url;
      if (crestNorm(f.away) === crestNorm(team.name)) f.awayCrest = url;
    }),
  );
  draftSelections.forEach((f) => {
    if (crestNorm(f.home) === crestNorm(team.name)) f.homeCrest = url;
    if (crestNorm(f.away) === crestNorm(team.name)) f.awayCrest = url;
    rememberFixtureCrests(f);
  });
  save();
  await loadCrestImage(url).catch(() => null);
  renderAll();
  toast("URL guardada para " + team.name + ".");
}
async function saveManagedTeamLogo(index) {
  const team = logoManagerTeams[index],
    select = $("logo-choice-" + index),
    options = team && logoLookupState[team.key],
    choice = options && options[Number(select?.value)];
  if (!team || !choice?.logo) {
    toast("Elige un escudo válido antes de guardar.");
    return;
  }
  const dir = readCrestDirectory();
  dir[team.key] = {
    name: team.name,
    url: choice.logo,
    country: choice.country || team.country || "",
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch (e) {
    toast("No se pudo guardar el escudo en este dispositivo.");
    return;
  }
  db.coupons.forEach((c) =>
    (c.fixtures || []).forEach((f) => {
      if (crestNorm(f.home) === crestNorm(team.name)) f.homeCrest = choice.logo;
      if (crestNorm(f.away) === crestNorm(team.name)) f.awayCrest = choice.logo;
    }),
  );
  draftSelections.forEach((f) => {
    if (crestNorm(f.home) === crestNorm(team.name)) f.homeCrest = choice.logo;
    if (crestNorm(f.away) === crestNorm(team.name)) f.awayCrest = choice.logo;
    rememberFixtureCrests(f);
  });
  save();
  await loadCrestImage(choice.logo).catch(() => null);
  renderAll();
  toast("Escudo guardado para " + team.name + ". Se actualizaron sus cupones guardados.");
}
