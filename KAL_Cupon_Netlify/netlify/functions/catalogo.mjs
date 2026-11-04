const cache = globalThis.__kalCatalogCache || (globalThis.__kalCatalogCache = new Map());
export default async (request) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return reply(503, { error: "Falta configurar API_FOOTBALL_KEY en Netlify." });
  const p = new URL(request.url).searchParams, countryCode = (p.get("countryCode") || "").trim().toUpperCase(), leagueId = (p.get("leagueId") || "").trim();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return reply(400, { error: "Escribe el código ISO de dos letras, por ejemplo ES o GB." });
  if (leagueId && !/^\d{1,10}$/.test(leagueId)) return reply(400, { error: "El ID de liga debe contener solo números." });
  if (!countryCode && !leagueId) return reply(400, { error: "Indica un código de país o un ID de liga." });
  const call = async (path, params) => {
    const u = new URL("https://v3.football.api-sports.io/" + path);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    const cacheKey = u.toString(), cached = cache.get(cacheKey); if (cached && cached.until > Date.now()) return cached.data;
    const r = await fetch(u, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(9000) });
    if (r.status === 401 || r.status === 403) throw Error("API-Football rechazó la clave configurada en Netlify.");
    if (r.status === 429) throw Error("Se alcanzó el límite de API-Football. Espera a que se renueve la cuota.");
    if (!r.ok) throw Error("API-Football respondió con error HTTP " + r.status + ".");
    const body = await r.json();
    if (body.errors && Object.keys(body.errors).length) throw Error(Object.values(body.errors).flat().map(String).join(" ").slice(0, 180));
    const data = body.response || []; cache.set(cacheKey, { data, until: Date.now() + 86400000 }); return data;
  };
  try {
    if (countryCode) {
      const rows = await call("countries", { code: countryCode });
      const x = rows[0]; if (!x) return reply(404, { error: "No se encontró ese código de país en API-Football." });
      return reply(200, { country: { name: x.name || "", code: x.code || countryCode, flag: x.flag || "" } });
    }
    const season = (p.get("season") || String(new Date().getUTCFullYear())).trim();
    const rows = await call("leagues", { id: leagueId, season: /^\d{4}$/.test(season) ? season : String(new Date().getUTCFullYear()) });
    const x = rows[0]; if (!x?.league) return reply(404, { error: "No se encontró esa liga. Revisa el ID y la temporada." });
    return reply(200, { league: { id: x.league.id, name: x.league.name || "", logo: x.league.logo || "" }, country: { name: x.country?.name || "", code: x.country?.code || "", flag: x.country?.flag || "" }, season: x.seasons?.find(s => String(s.year) === season)?.year || season });
  } catch (e) {
    const message = e?.name === "TimeoutError" ? "La búsqueda tardó demasiado. Inténtalo otra vez." : e?.message || "No se pudo consultar API-Football.";
    return reply(502, { error: message });
  }
};
