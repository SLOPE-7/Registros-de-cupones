const PLAN_MSG =
  "Tu plan gratis de API-Football solo permite consultar las temporadas 2022 a 2024, por eso no hay datos de este partido. Para ver estadísticas, eventos y análisis de partidos actuales hace falta un plan de pago de API-Football.";
const cache = globalThis.__kalPlayerCache || (globalThis.__kalPlayerCache = new Map());
const base = "https://v3.football.api-sports.io/";
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default async (request) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey)
    return reply(503, {
      error:
        "Falta configurar API_FOOTBALL_KEY en las variables de Cloudflare (Workers → kal-cupones → Settings → Variables and Secrets).",
    });
  const params = new URL(request.url).searchParams;
  const search = (params.get("search") || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([A-Z]{2,5}\)\s*$/i, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const teamId = params.get("teamId") || params.get("team") || "";
  const season = params.get("season") || "";
  if (search.length < 3 || (teamId && !/^\d+$/.test(teamId)) || (season && !/^\d{4}$/.test(season)))
    return reply(400, { error: "Indica el nombre del jugador y revisa el equipo o la temporada." });
  const cacheKey = [normalize(search), teamId, season].join("|");
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return reply(200, cached.data);
  const apiFetch = async (path, query) => {
    const url = new URL(path, base);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== "" && value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    const response = await fetch(url, {
      headers: { "x-apisports-key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 204) return [];
    if (response.status === 401 || response.status === 403)
      throw Error("API-Football rechazó la clave API_FOOTBALL_KEY configurada en el servidor.");
    if (response.status === 429)
      throw Error("Se alcanzó el límite de API-Football. Espera a que se renueve la cuota.");
    if (!response.ok) throw Error("API-Football respondió con error HTTP " + response.status + ".");
    const body = await response.json();
    if (body.errors && Object.keys(body.errors).length) {
      if (/free plans? do not have access|plan.*season/i.test(JSON.stringify(body.errors)))
        throw Error(PLAN_MSG);
    }
    if (body.errors && Object.keys(body.errors).length)
      throw Error(Object.values(body.errors).flat().join(" ").slice(0, 160));
    return body.response || [];
  };
  const mapPlayer = (row, teamFallback = "") => {
    const player = row.player || row;
    const statsTeam = row.statistics?.[0]?.team || {};
    const id = player.id || row.id || "";
    return {
      id: String(id),
      name: player.name || row.name || "",
      photo:
        player.photo ||
        row.photo ||
        (id ? "https://media.api-sports.io/football/players/" + id + ".png" : ""),
      country: player.nationality || player.birth?.country || row.country || "",
      team: statsTeam.name || row.team?.name || teamFallback,
      teamId: String(statsTeam.id || row.team?.id || teamId || ""),
    };
  };
  try {
    // Profiles search is independent of club and season; retry the full text if the surname alone misses.
    const words = search.split(" ").filter(Boolean);
    const lastName = words.at(-1) || search;
    const terms = [...new Set([lastName, search].filter((term) => term.length >= 4))];
    let rows = [],
      players = [];
    for (const term of terms) {
      rows = await apiFetch("players/profiles", { search: term });
      const q = normalize(term);
      const found = rows
        .map((row) => mapPlayer(row))
        .filter((player) => player.name && player.photo && normalize(player.name).includes(q));
      players.push(...found);
      if (found.length) break;
    }
    const full = normalize(search);
    players.sort((a, b) => Number(normalize(b.name) === full) - Number(normalize(a.name) === full));
    // Fall back to roster searches for the current and previous season if the fixture club has no profile hit.
    if (!players.length && teamId && season) {
      const seasonOptions = [...new Set([season, String(Number(season) - 1)])];
      for (const seasonValue of seasonOptions) {
        rows = await apiFetch("players", { search: lastName, team: teamId, season: seasonValue });
        players = rows
          .map((row) => mapPlayer(row))
          .filter(
            (player) => player.name && player.photo && normalize(player.name).includes(normalize(lastName)),
          );
        if (players.length) break;
      }
    }
    if (!players.length && teamId) {
      const squads = await apiFetch("players/squads", { team: teamId });
      const roster = squads
        .flatMap((row) => row.players || [])
        .map((row) => mapPlayer(row, squads[0]?.team?.name || ""));
      const q = normalize(search);
      players = roster.filter((player) => {
        const name = normalize(player.name);
        return (
          player.name &&
          player.photo &&
          (name.includes(q) || q.includes(name) || name.split(" ").at(-1) === q.split(" ").at(-1))
        );
      });
    }
    const seen = new Set();
    players = players
      .filter((player) => {
        const key = player.id || normalize(player.name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
    const data = { players };
    cache.set(cacheKey, { data, until: Date.now() + 86400000 });
    return reply(200, data);
  } catch (error) {
    return reply(502, {
      error:
        error?.name === "TimeoutError"
          ? "La consulta tardó demasiado. Inténtalo otra vez."
          : error?.message || "No se pudo consultar el catálogo de jugadores.",
    });
  }
};
