const cache = globalThis.__kalMatchDataCache || (globalThis.__kalMatchDataCache = new Map());
const fixtureCache = globalThis.__kalFixtureCache || (globalThis.__kalFixtureCache = new Map());
const windows = globalThis.__kalMatchWindows || (globalThis.__kalMatchWindows = new Map());
const base = "https://v3.football.api-sports.io/";

export default async (request) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return reply(503, { error: "Falta configurar API_FOOTBALL_KEY en Netlify." });
  const url = new URL(request.url), p = url.searchParams, force = p.get("refresh") === "1";
  const home = p.get("homeId"), away = p.get("awayId"), date = p.get("date"), league = p.get("leagueId"), season = p.get("season"), mode = p.get("mode") || "match";
  if (!/^\d+$/.test(home || "") || !/^\d+$/.test(away || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return reply(400, { error: "Faltan los ID de ambos equipos o la fecha del partido." });
  if (!["match", "analysis", "injuries", "events"].includes(mode)) return reply(400, { error: "Sección de datos no reconocida." });
  const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now(), w = windows.get(ip);
  if (w && now - w.start < 60000 && w.count >= 6) return reply(429, { error: "Límite temporal de consultas. Espera un minuto y vuelve a intentar." });
  if (!w || now - w.start >= 60000) windows.set(ip, { start: now, count: 1 }); else w.count++;
  const cacheKey = [home, away, date, league || "", season || "", mode].join("|");
  const hit = cache.get(cacheKey); if (!force && hit && hit.until > now) return reply(200, hit.data);
  const call = async (path, params) => {
    const u = new URL(path, base); Object.entries(params).forEach(([k,v]) => { if (v) u.searchParams.set(k, v); });
    const r = await fetch(u, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(10000) });
    if (r.status === 401 || r.status === 403) throw Error("API-Football rechazó la clave configurada en Netlify.");
    if (r.status === 429) throw Error("Se alcanzó el límite de API-Football. Espera a que se renueve la cuota.");
    if (!r.ok) throw Error("API-Football respondió con error HTTP " + r.status + ".");
    const body = await r.json();
    if (body.errors && Object.keys(body.errors).length) throw Error(Object.values(body.errors).flat().join(" ").slice(0, 180));
    return body.response || [];
  };
  try {
    const day = new Date(date + "T12:00:00Z");
    const shift = n => { const d = new Date(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    // Los cupones y la API pueden guardar el inicio del partido en días distintos
    // por zona horaria. Buscar en una ventana de tres días evita ese falso negativo.
    const fixtureKey = [home, away, date, league || ""].join("|");
    let candidates = fixtureCache.get(fixtureKey);
    if (!candidates || candidates.until <= now) {
      // API-Football exige la temporada cuando se busca por rango de fechas. Las ligas europeas usan
      // el año de inicio (2026 para 2026/27); las de año natural usan el año del partido. Entre enero
      // y julio se prueban ambas, empezando por la que más se usa.
      const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
      const seasons = [...new Set([month >= 7 ? year : year - 1, year])];
      const isMatch = x => { const h = String(x.teams?.home?.id), a = String(x.teams?.away?.id); return (h === String(home) && a === String(away)) || (h === String(away) && a === String(home)); };
      candidates = [];
      for (const s of seasons) {
        const rows = await call("fixtures", { team: home, season: String(s), from: shift(-1), to: shift(1), timezone: "America/Tegucigalpa" });
        candidates.push(...rows);
        if (rows.some(isMatch)) break;
      }
      fixtureCache.set(fixtureKey, { rows: candidates, until: now + 600000 });
      if (fixtureCache.size > 180) fixtureCache.delete(fixtureCache.keys().next().value);
    } else candidates = candidates.rows;
    const matching = candidates.filter(x => {
      const direct = String(x.teams?.home?.id) === String(home) && String(x.teams?.away?.id) === String(away);
      const reverse = String(x.teams?.home?.id) === String(away) && String(x.teams?.away?.id) === String(home);
      return (direct || reverse) && (!league || String(x.league?.id) === String(league));
    });
    matching.sort((a, b) => Math.abs(Date.parse(a.fixture?.date || 0) - Date.parse(date)) - Math.abs(Date.parse(b.fixture?.date || 0) - Date.parse(date)));
    const fixture = matching[0];
    if (!fixture?.fixture?.id) return reply(200, { available: false, reason: "API-Football no encontró este partido con esos equipos y fecha. Verifica los escudos y la fecha." });
    let data;
    if (mode === "match") {
      const details = await call("fixtures", { id: String(fixture.fixture.id) });
      data = { available: true, fixture: details[0] || fixture };
    } else if (mode === "analysis") {
      const effectiveSeason = /^\d{4}$/.test(String(fixture.league?.season || "")) ? String(fixture.league.season) : (/^\d{4}$/.test(season || "") ? season : date.slice(0, 4));
      let predRows = [], standings = [], standingsError = "", predictionsError = "", teamStats = [], teamStatsError = "", h2h = [], h2hError = "";
      const leagueId = league && /^\d+$/.test(league) ? league : String(fixture.league?.id || "");
      const [predictionResult, standingsResult] = await Promise.all([
        call("predictions", { fixture: String(fixture.fixture.id) }).then(rows => ({ rows })).catch(error => ({ error })),
        leagueId ? call("standings", { league: leagueId, season: effectiveSeason }).then(rows => ({ rows })).catch(error => ({ error })) : Promise.resolve({ rows: [] })
      ]);
      predRows = predictionResult.rows || [];
      if (predictionResult.error) predictionsError = predictionResult.error?.message || "Predicción no disponible.";
      standings = standingsResult.rows || [];
      if (standingsResult.error) standingsError = standingsResult.error?.message || "No se encontró la tabla para la temporada de este encuentro.";
      if (leagueId) {
        if (!predRows.length) {
          const [stats, h2hResult] = await Promise.all([
            Promise.allSettled([
              call("teams/statistics", { league: leagueId, season: effectiveSeason, team: home }),
              call("teams/statistics", { league: leagueId, season: effectiveSeason, team: away })
            ]),
            call("fixtures/headtohead", { h2h: home + "-" + away, last: "5", timezone: "America/Tegucigalpa" }).then(rows => ({ rows })).catch(error => ({ error: error?.message || "H2H no disponible." }))
          ]);
          teamStats = stats.map(x => x.status === "fulfilled" ? x.value[0] || null : null);
          if (stats.every(x => x.status === "rejected")) teamStatsError = "La API no proporcionó estadísticas de temporada para estos equipos.";
          h2h = h2hResult.rows || [];
          h2hError = h2hResult.error || "";
        }
      }
      data = { available: true, fixtureId: fixture.fixture.id, season: effectiveSeason, predictions: predRows[0] || null, predictionsError, standings, standingsError, teamStats, teamStatsError, h2h, h2hError };
    } else if (mode === "injuries") {
      const injuries = await call("injuries", { fixture: String(fixture.fixture.id) });
      data = { available: true, fixtureId: fixture.fixture.id, injuries };
    } else {
      const details = await call("fixtures", { id: String(fixture.fixture.id) });
      let injuries = [], injuriesError = "";
      try { injuries = await call("injuries", { fixture: String(fixture.fixture.id) }); }
      catch (e) { injuriesError = e?.message || "Lesiones no disponibles."; }
      data = { available: true, fixture: details[0] || fixture, injuries, injuriesError };
    }
    const cacheSeconds = mode === "match" ? 15 : mode === "events" ? 180 : 3600;
    cache.set(cacheKey, { data, until: now + cacheSeconds * 1000 });
    if (cache.size > 180) cache.delete(cache.keys().next().value);
    return reply(200, data);
  } catch (e) {
    const message = e?.name === "TimeoutError" ? "La consulta tardó demasiado. Inténtalo otra vez." : (e?.message || "No se pudo obtener información del partido.");
    return reply(502, { error: message });
  }
};
