// Búsqueda de escudos y fotos de jugadores en TheSportsDB (API pública y gratuita).
//   GET ?tipo=equipo&q=Club Brugge KV
//   GET ?tipo=jugador&q=Anastasios Douvikas&club=Como
// Con la clave gratuita cada búsqueda devuelve un solo resultado, así que se prueban varias formas del
// nombre (completo, sin "FC/KV/SC…", solo el apellido) y se juntan. Opcional: variable THESPORTSDB_KEY.
const cache = globalThis.__kalTsdbCache || (globalThis.__kalTsdbCache = new Map());
const BASE = "https://www.thesportsdb.com/api/v1/json/";
const norm = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// Siglas que sobran en el nombre del club (no se quita "Club": "Club Brugge" sí existe y "Brugge" da el filial).
const CLUB_TOKENS = new Set([
  "fc",
  "cf",
  "afc",
  "sc",
  "kv",
  "rsc",
  "ac",
  "as",
  "fk",
  "sk",
  "nk",
  "gnk",
  "cd",
  "ud",
  "sl",
  "ss",
  "us",
  "vfb",
  "vfl",
  "tsg",
  "bc",
  "if",
  "bk",
  "jk",
  "tc",
  "sv",
  "ssc",
  "osc",
  "rcd",
  "ca",
]);

function teamVariants(q) {
  const words = q.split(/\s+/).filter(Boolean);
  const clean = words.filter((w) => !CLUB_TOKENS.has(norm(w))).join(" ");
  return [...new Set([q, clean].filter((x) => x && x.length >= 3))];
}
function playerVariants(q) {
  const words = q
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const last = words.at(-1) || "";
  return [
    ...new Set(
      [words.join(" "), last.length >= 4 ? last : "", words.length >= 3 ? words[0] + " " + last : ""].filter(
        (x) => x && x.length >= 3,
      ),
    ),
  ];
}

export default async (request) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const p = new URL(request.url).searchParams;
  const tipo = p.get("tipo"),
    q = (p.get("q") || "").trim().slice(0, 80),
    club = norm(p.get("club") || "");
  if (!["equipo", "jugador"].includes(tipo) || q.length < 3)
    return reply(400, { error: "Indica el tipo (equipo o jugador) y al menos 3 letras." });
  const key = /^[A-Za-z0-9]{1,40}$/.test(process.env.THESPORTSDB_KEY || "")
    ? process.env.THESPORTSDB_KEY
    : "123";
  const cacheKey = [tipo, norm(q), club].join("|"),
    hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return reply(200, hit.data);
  const call = async (term) => {
    const url =
      BASE +
      key +
      (tipo === "equipo" ? "/searchteams.php?t=" : "/searchplayers.php?p=") +
      encodeURIComponent(term);
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (r.status === 429) throw Error("TheSportsDB recibió demasiadas búsquedas. Espera un minuto.");
    if (!r.ok) throw Error("TheSportsDB respondió con error " + r.status + ".");
    const body = await r.json().catch(() => ({}));
    return (tipo === "equipo" ? body.teams : body.player) || [];
  };
  try {
    const variants = tipo === "equipo" ? teamVariants(q) : playerVariants(q);
    const rows = (await Promise.allSettled(variants.map(call))).flatMap((x) =>
      x.status === "fulfilled" ? x.value : [],
    );
    const seen = new Set();
    let options = rows
      .filter((x) => !x.strSport || x.strSport === "Soccer")
      .map((x) =>
        tipo === "equipo"
          ? {
              id: String(x.idTeam || ""),
              name: x.strTeam || "",
              country: x.strCountry || "",
              league: x.strLeague || "",
              logo: x.strBadge || "",
              source: "TheSportsDB",
            }
          : {
              id: String(x.idPlayer || ""),
              name: x.strPlayer || "",
              team: x.strTeam || "",
              country: x.strNationality || "",
              photo: x.strCutout || x.strThumb || x.strRender || "",
              source: "TheSportsDB",
            },
      )
      .filter((x) => (tipo === "equipo" ? x.logo : x.photo) && x.name && !seen.has(x.id) && seen.add(x.id));
    // Primero: el que coincide con el club (jugadores) o con el nombre buscado (equipos).
    const target = norm(q);
    const score = (x) =>
      tipo === "equipo"
        ? (norm(x.name) === target ? 3 : 0) +
          (target.includes(norm(x.name)) || norm(x.name).includes(target) ? 1 : 0)
        : (club && (norm(x.team).includes(club) || club.includes(norm(x.team))) ? 4 : 0) +
          (norm(x.name) === target ? 2 : 0) +
          (/retired/i.test(x.team) ? -3 : 0);
    options = options.sort((a, b) => score(b) - score(a)).slice(0, 6);
    const data = { options };
    cache.set(cacheKey, { data, until: Date.now() + 86400000 });
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return reply(200, data);
  } catch (e) {
    return reply(502, {
      error:
        e?.name === "TimeoutError"
          ? "TheSportsDB tardó demasiado. Inténtalo otra vez."
          : e?.message || "No se pudo consultar TheSportsDB.",
    });
  }
};
