const lookupWindows = globalThis.__kalCrestLookupWindows || (globalThis.__kalCrestLookupWindows = new Map());
const apiResultCache = globalThis.__kalCrestApiResultCache || (globalThis.__kalCrestApiResultCache = new Map());

export default async (request) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) { const now = Date.now(), window = lookupWindows.get(ip); if (window && now - window.started < 60000 && window.count >= 3) return reply(429, { error: "Límite de seguridad: máximo tres búsquedas nuevas por minuto para cuidar la cuota de API-Football. Espera un minuto." }); if (!window || now - window.started >= 60000) lookupWindows.set(ip, { started: now, count: 1 }); else window.count++; }
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return reply(503, { error: "Falta configurar API_FOOTBALL_KEY en las variables de Netlify." });
  const url = new URL(request.url);
  const home = (url.searchParams.get("home") || "").trim().slice(0, 100);
  const away = (url.searchParams.get("away") || "").trim().slice(0, 100);
  const league = (url.searchParams.get("league") || "").trim().slice(0, 100);
  const country = (url.searchParams.get("country") || "").trim().slice(0, 80);
  if (!home && !away && !league) return reply(400, { error: "Indica al menos un equipo o una competición." });

  async function get(path, params) {
    const endpoint = new URL("https://v3.football.api-sports.io/" + path);
    for (const [name, value] of Object.entries(params)) {
      if (!value) continue;
      let clean = value;
      if (name === "search") clean = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (name === "search" && clean.length < 3) return [];
      endpoint.searchParams.set(name, clean);
    }
    const cacheKey = path + "?" + endpoint.searchParams.toString();
    const cached = apiResultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.items;
    const response = await fetch(endpoint, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(9000) });
    if (response.status === 401 || response.status === 403) throw new Error("API-Football no aceptó la clave. Revisa que pegaste la clave secreta completa en API_FOOTBALL_KEY y vuelve a desplegar el sitio.");
    if (response.status === 429) throw new Error("Se alcanzó el límite de consultas de API-Football. Espera a que se renueve la cuota.");
    if (!response.ok) throw new Error("API-Football respondió con error HTTP " + response.status + ".");
    const data = await response.json();
    if (data.errors && Object.keys(data.errors).length) {
      const detail = Object.values(data.errors).flat().map(String).join(" ").slice(0, 180);
      if (/token|api.?key|unauthori[sz]ed|invalid key/i.test(detail)) throw new Error("API-Football rechazó la clave. Verifica API_FOOTBALL_KEY y vuelve a publicar.");
      if (/request|quota|limit|too many/i.test(detail)) throw new Error("API-Football bloqueó temporalmente la consulta: puede haberse alcanzado el límite de 10 por minuto o el cupo diario de 100. Revisa el panel Usage y vuelve a intentar cuando se renueve.");
      throw new Error("API-Football rechazó la consulta: " + (detail || "revisa la clave y los parámetros."));
    }
    const items = Array.isArray(data.response) ? data.response : [];
    apiResultCache.set(cacheKey, { items, expiresAt: Date.now() + 86400000 });
    if (apiResultCache.size > 300) apiResultCache.delete(apiResultCache.keys().next().value);
    return items;
  }
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const rank = (items, query, getName, getCountry = () => "", countryHint = "") => {
    const q = normalize(query);
    return items.map((item) => {
      const name = getName(item) || "";
      const n = normalize(name);
      let score = n === q ? 100 : n.startsWith(q) || q.startsWith(n) ? 75 : n.includes(q) || q.includes(n) ? 60 : 0;
      if (countryHint && getCountry(item) && normalize(getCountry(item)) === normalize(countryHint)) score += 8;
      return { item, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ item }) => item);
  };
  const teamOptions = (items, name) => rank(items, name, (x) => x.team?.name, (x) => x.team?.country, country).map((x) => ({ name: x.team.name, country: x.team.country || "", logo: x.team.id ? "https://media.api-sports.io/football/teams/" + x.team.id + ".png" : (x.team.logo || "") }));
  const findTeamOptions = async (name) => {
    if (name.length < 3) return [];
    let items = await get("teams", { search: name });
    let options = teamOptions(items, name);
    if (options.length) return options;
    const simplified = name.replace(/^\s*(?:(?:the|winner|loser|qualified|team)\s+)+/i, "").replace(/\b(?:football club|fc|cf|afc|sc|cfc|club)\b/ig, " ").replace(/\s+/g, " ").trim();
    if (simplified.length < 3 || normalize(simplified) === normalize(name)) return options;
    items = await get("teams", { search: simplified });
    options = teamOptions(items, simplified);
    return options;
  };
  const leagueOptions = (items, name) => rank(items, name, (x) => x.league?.name, (x) => x.country?.name, country).map((x) => ({ name: x.league.name, country: x.country?.name || "", countryCode: x.country?.code || "", countryFlag: x.country?.flag || "", logo: x.league.id ? "https://media.api-sports.io/football/leagues/" + x.league.id + ".png" : (x.league.logo || "") }));
  try {
    const tasks = [findTeamOptions(home), findTeamOptions(away), league.length >= 3 ? get("leagues", { search: league }) : Promise.resolve([])];
    const [homeOptions, awayOptions, leagueData] = await Promise.all(tasks);
    return reply(200, { home: { options: homeOptions }, away: { options: awayOptions }, league: { options: leagueOptions(leagueData, league) } });
  } catch (error) {
    return reply(502, { error: error?.name === "TimeoutError" ? "La búsqueda tardó demasiado. Inténtalo de nuevo." : (error?.message || "No se pudo consultar el catálogo deportivo.") });
  }
};
