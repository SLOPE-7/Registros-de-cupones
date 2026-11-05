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
      r = await fetch("/.netlify/functions/catalogo?" + params, {
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
  /(remat|goleador|anotador|anotar[aá]?|tiros? a puerta|tiros? al arco|asistenc|shots?|scorer|to score|player prop|jugador|primer marcador|[uú]ltimo marcador|marcar[aá]? en cualquier)/i;
const TEAM_MARKET_RE =
  /\b(?:equipo|local|visitante|total(?:es)?|partido|ambos|1x2|doble oportunidad|h[aá]ndicap|tiempo|descanso|mitad|c[oó]rners?|tarjetas?|marcador (?:correcto|exacto|final|al descanso))\b/i;
const PLAYER_NOISE_WORDS = new Set([
  "remate",
  "remates",
  "tiro",
  "tiros",
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
function parsePlayerBet(market, fixture) {
  const marketText = String(market?.market || ""),
    pickText = String(market?.pick || ""),
    text = (marketText + " " + pickText).trim();
  if (!PLAYER_MARKET_RE.test(text)) return null;
  const nested = text.match(/\(([^()]{3,80})\s*\(([A-Z]{2,5})\)\s*\)/);
  const teamKeys = [fixture?.home, fixture?.away].filter(Boolean).map(teamEventKey);
  const looksLikeTeam = (name) => {
    const k = teamEventKey(name);
    return !k || teamKeys.some((t) => t && (k === t || k.includes(t) || t.includes(k)));
  };
  const accept = (raw, codeHint = "") => {
    const split = splitPlayerCode(raw),
      name = cleanPlayerCandidate(split.text);
    if (!name || /\d/.test(name) || TEAM_MARKET_RE.test(name)) return null;
    const words = name.split(" ").filter(Boolean),
      code = (codeHint || split.code || "").toUpperCase();
    if (words.length < 2 && !code) return null;
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
    const r = accept(candidate);
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
function playerClubForCode(code, fixture) {
  code = String(code || "")
    .trim()
    .toUpperCase();
  if (!code) return { side: "", club: "" };
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
          compact.startsWith(aliasNorm + " ") ||
          aliasNorm.startsWith(compact) ||
          teamEventKey(alias) === teamEventKey(name))) ||
      lower === initials ||
      lower === generic ||
      letters.startsWith(lower)
    )
      return { side, club: name };
  }
  return { side: "", club: alias ? titleCaseClub(alias) : "Equipo (" + code + ")" };
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
function updateFolds() {
  const state = readFolds(),
    searching = !!($("logoSearch")?.value || "").trim() || logoManagerFocus.length > 0;
  document.querySelectorAll("#view-logos .fold").forEach((el) => {
    if (el.dataset.defaultOpen === undefined)
      el.dataset.defaultOpen = el.classList.contains("is-open") ? "1" : "0";
    const count = el.querySelectorAll(".fold-body .logo-card").length,
      badge = el.querySelector(".fold-count");
    if (badge) badge.textContent = count;
    const saved = state[el.dataset.fold];
    let open = saved === undefined ? el.dataset.defaultOpen === "1" : !!saved;
    if (searching && el.dataset.fold !== "catalog") open = count > 0;
    setFold(el, open);
  });
  syncFoldAllLabel();
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
function renderPlayerLogoActions(item) {
  let html = "";
  if (item.marketKey) {
    const label = item.photo ? "Actualizar foto" : "Buscar foto";
    html +=
      '<button type="button" class="btn gold sm" data-player-photo="' +
      esc(item.marketKey) +
      '" data-player-photo-bet="' +
      esc(item.id) +
      '">' +
      label +
      "</button>";
  }
  html += '<button type="button" class="btn sm" data-player-id="' + esc(item.id) + '">Por ID</button>';
  if (item.photo && item.savedKey)
    html +=
      '<button type="button" class="btn sm" data-player-photo-remove="' +
      esc(item.savedKey) +
      '">Quitar foto</button>';
  html +=
    '<button type="button" class="btn danger sm" data-player-hide="' + esc(item.id) + '">🗑 Ocultar</button>';
  return html;
}
function renderLogos() {
  const el = $("logoList"),
    archive = $("logoArchive"),
    leagueEl = $("leagueLogoList"),
    leagueArchive = $("leagueLogoArchive");
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
  const saved = shown.filter((x) => x.team.url),
    pending = shown.filter((x) => !x.team.url);
  $("logoTeamCount").textContent = logoManagerTeams.length;
  $("logoSavedCount").textContent = logoManagerTeams.filter((t) => t.url).length;
  const card = (x) =>
    '<article class="logo-card"><div class="logo-card-top">' +
    crestHTML(x.team.url, x.team.name) +
    '<div class="logo-team-info"><strong>' +
    esc(x.team.name) +
    "</strong><span>" +
    esc(x.team.country || "País no especificado") +
    " · " +
    (x.team.matches || 0) +
    ' partido(s)</span></div><span class="logo-status ' +
    (x.team.url ? "is-saved" : "") +
    '">' +
    (x.team.url ? "Guardado" : "Pendiente") +
    '</span></div><div class="logo-card-actions"><button class="btn sm ' +
    (x.team.url ? "" : "gold") +
    '" data-logo-lookup="' +
    x.index +
    '">' +
    (x.team.url ? "↻ Actualizar" : "＋ Buscar escudo") +
    '</button><button class="btn sm" data-logo-id="' +
    x.index +
    '">Por ID</button>' +
    (x.team.url
      ? '<button class="btn sm" data-team-logo-remove="' + esc(x.team.key) + '">Quitar</button>'
      : "") +
    '<button class="btn danger sm" data-logo-hide="' +
    esc(x.team.key) +
    '">🗑 Ocultar</button></div><div class="logo-options" id="logo-options-' +
    x.index +
    '"></div></article>';
  el.innerHTML = pending.length
    ? pending.map(card).join("")
    : '<div class="empty logo-empty"><strong>No quedan equipos pendientes</strong>Los que falten aparecerán al guardar nuevos cupones.</div>';
  archive.innerHTML = saved.length
    ? saved.map(card).join("")
    : '<div class="empty logo-empty"><strong>Aún no hay escudos guardados</strong>Al guardar uno, aparecerá aquí.</div>';
  const playerArchive = $("playerPhotoArchive");
  if (playerArchive) {
    const players = collectPlayerBets().filter(
      (item) =>
        !q ||
        crestNorm(item.name).includes(q) ||
        crestNorm(item.club).includes(q) ||
        crestNorm(item.country).includes(q),
    );
    playerArchive.innerHTML = players.length
      ? players
          .map(
            (item) =>
              '<article class="logo-card player-logo-card"><div class="logo-card-top">' +
              (item.photo
                ? '<img class="player-logo-thumb" src="' +
                  esc(playerImageUrl(item.photo)) +
                  '" alt="Foto de ' +
                  esc(item.name) +
                  '" loading="lazy" referrerpolicy="no-referrer">'
                : '<span class="team-fallback player-logo-thumb">' +
                  esc(
                    item.name
                      .split(/\s+/)
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase(),
                  ) +
                  "</span>") +
              '<div class="logo-team-info"><strong>' +
              esc(item.name) +
              "</strong><span>" +
              esc(item.club || "Club por identificar") +
              " · " +
              esc(item.country || "País del jugador por consultar") +
              " · " +
              item.count +
              ' mercado(s)</span></div><span class="logo-status ' +
              (item.photo ? "is-saved" : "") +
              '">' +
              (item.photo ? "Foto guardada" : "Pendiente") +
              '</span></div><div class="logo-card-actions">' +
              renderPlayerLogoActions(item) +
              "</div></article>",
          )
          .join("")
      : '<div class="empty logo-empty"><strong>No detecté mercados de jugadores</strong>Los jugadores aparecerán automáticamente al guardar cupones con mercados de remates, goleador o anotador.</div>';
    showPlayerPhotoImagesIn(playerArchive);
  }
  if (leagueEl && leagueArchive) {
    const allLeagues = collectLogoLeagues(),
      leagues = allLeagues.filter(
        (x) => !q || crestNorm(x.name).includes(q) || crestNorm(x.country).includes(q),
      ),
      waiting = leagues.filter((x) => !x.url),
      done = leagues.filter((x) => x.url),
      leagueCard = (x, index) =>
        '<article class="logo-card"><div class="logo-card-top">' +
        crestHTML(x.url, x.name) +
        '<div class="logo-team-info"><strong>' +
        esc(x.name) +
        "</strong><span>" +
        esc(x.country || "País no especificado") +
        " · " +
        x.matches +
        ' partido(s)</span></div><span class="logo-status ' +
        (x.url ? "is-saved" : "") +
        '">' +
        (x.url ? "Guardado" : "Pendiente") +
        '</span></div><div class="logo-card-actions"><button class="btn sm gold" data-league-search="' +
        index +
        '">' +
        (x.url ? "Actualizar por nombre" : "Buscar por nombre") +
        '</button><button class="btn sm" data-league-id="' +
        esc(x.key) +
        '">Por ID</button>' +
        (x.url ? '<button class="btn sm" data-league-remove="' + esc(x.key) + '">Quitar</button>' : "") +
        '<button class="btn danger sm" data-league-hide="' +
        esc(x.key) +
        '">🗑 Ocultar</button></div><div class="logo-options" id="league-options-' +
        index +
        '"></div></article>';
    leagueEl.innerHTML = waiting.length
      ? waiting.map((x) => leagueCard(x, allLeagues.indexOf(x))).join("")
      : '<div class="empty logo-empty"><strong>No hay ligas pendientes</strong>Las competencias de tus cupones aparecerán aquí.</div>';
    leagueArchive.innerHTML = done.length
      ? done.map((x) => leagueCard(x, leagues.indexOf(x))).join("")
      : '<div class="empty logo-empty"><strong>Aún no hay ligas guardadas</strong>Busca por ID para archivarlas.</div>';
    renderLogoTrash();
  }
  updateFolds();
}

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
  box.textContent = "Consultando catálogo…";
  try {
    const p = new URLSearchParams({ home: "", away: "", league: x.name, country: x.country || "" }),
      r = await fetch("/.netlify/functions/escudos?" + p, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(16000),
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.error || "No se pudo buscar la liga.");
    const opts = d.league?.options || [];
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
async function lookupSavedTeamLogo(index) {
  const team = logoManagerTeams[index],
    box = $("logo-options-" + index),
    button = document.querySelector('[data-logo-lookup="' + index + '"]');
  if (!team || !box) return;
  if (location.protocol === "file:") {
    box.innerHTML =
      '<span class="marketmeta">La búsqueda automática está disponible al publicar la carpeta Netlify.</span>';
    return;
  }
  button.disabled = true;
  button.textContent = "Buscando…";
  box.innerHTML = '<span class="marketmeta">Consultando el catálogo de fútbol…</span>';
  const params = new URLSearchParams({ home: team.name, away: "", league: "", country: team.country || "" }),
    cache = crestCacheRead(),
    cacheKey = crestNorm([team.name, "", "", team.country || ""].join("|"));
  try {
    let data = cache[cacheKey];
    if (!data) {
      const r = await fetch("/.netlify/functions/escudos?" + params.toString(), {
        headers: { Accept: "application/json" },
      });
      data = await r.json();
      if (!r.ok) throw Error(data.error || "No se pudo consultar el catálogo.");
      cache[cacheKey] = data;
      const keys = Object.keys(cache);
      if (keys.length > 200) delete cache[keys[0]];
      localStorage.setItem(CREST_CACHE, JSON.stringify(cache));
    }
    const options = data.home?.options || [];
    if (!options.length) {
      box.innerHTML =
        '<span class="marketmeta">No hubo coincidencias. Puedes guardar el enlace manualmente.</span><div class="logo-pick"><input class="input" type="url" id="logo-manual-' +
        index +
        '" placeholder="https://media.api-sports.io/football/teams/ID.png"><button class="btn good sm" data-logo-manual-save="' +
        index +
        '">Guardar URL</button></div>';
      return;
    }
    logoLookupState[team.key] = options;
    box.innerHTML =
      '<div class="logo-pick"><label class="small muted" for="logo-choice-' +
      index +
      '">Elige el escudo correcto</label><select class="input" id="logo-choice-' +
      index +
      '">' +
      options
        .map(
          (x, i) =>
            '<option value="' +
            i +
            '">' +
            esc(x.name) +
            (x.country ? " · " + esc(x.country) : "") +
            "</option>",
        )
        .join("") +
      '</select><button class="btn good sm" data-logo-save="' +
      index +
      '">Guardar escudo</button></div>';
  } catch (e) {
    box.innerHTML =
      '<span class="marketmeta">' +
      esc(e.message || "Falló la búsqueda. Inténtalo otra vez.") +
      '</span><div class="logo-pick"><input class="input" type="url" id="logo-manual-' +
      index +
      '" placeholder="https://media.api-sports.io/football/teams/ID.png"><button class="btn good sm" data-logo-manual-save="' +
      index +
      '">Guardar URL</button></div>';
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
