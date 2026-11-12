// Datos de un partido desde football-data.org (plan gratis: ligas principales y Champions, 10 consultas/minuto):
// forma reciente, tabla, enfrentamientos directos y un modelo de goles (Poisson) con probabilidades.
//   GET /api/datos-partido?home=Barcelona&away=Real%20Madrid&date=2026-11-22
// Variable: FOOTBALL_DATA_KEY (gratis en football-data.org/client/register).
// Las respuestas se guardan un tiempo para no gastar el límite de consultas.

const API = "https://api.football-data.org/v4";
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });

// ---------- Nombres de equipos (las casas los escriben en español; la API en inglés o en el idioma local) ----------
const ALIASES = {
  alemania: "germany",
  espana: "spain",
  inglaterra: "england",
  francia: "france",
  italia: "italy",
  holanda: "netherlands",
  "paises bajos": "netherlands",
  belgica: "belgium",
  suiza: "switzerland",
  croacia: "croatia",
  escocia: "scotland",
  gales: "wales",
  dinamarca: "denmark",
  suecia: "sweden",
  noruega: "norway",
  polonia: "poland",
  chequia: "czechia",
  "republica checa": "czechia",
  turquia: "turkey",
  grecia: "greece",
  hungria: "hungary",
  rumania: "romania",
  ucrania: "ukraine",
  irlanda: "ireland",
  "irlanda del norte": "northern ireland",
  eslovaquia: "slovakia",
  eslovenia: "slovenia",
  islandia: "iceland",
  finlandia: "finland",
  "bayern munich": "bayern munchen",
  "bayern de munich": "bayern munchen",
  inter: "internazionale",
  "inter milan": "internazionale",
  "inter de milan": "internazionale",
  "ac milan": "milan",
  "atletico de madrid": "atletico madrid",
  "athletic bilbao": "athletic club",
  "manchester utd": "manchester united",
  "man utd": "manchester united",
  "man city": "manchester city",
  "paris saint germain": "paris saint-germain",
  psg: "paris saint-germain",
  "sporting lisboa": "sporting cp",
  "sporting de lisboa": "sporting cp",
  "estrella roja": "crvena zvezda",
  "olympique de marsella": "olympique marseille",
  marsella: "marseille",
  "olympique de lyon": "olympique lyonnais",
  lyon: "lyonnais",
  "borussia dortmund": "borussia dortmund",
  "bayer leverkusen": "bayer 04 leverkusen",
};
const NOISE = new Set([
  "fc",
  "cf",
  "afc",
  "sc",
  "ac",
  "as",
  "sv",
  "fk",
  "sk",
  "club",
  "de",
  "del",
  "la",
  "el",
  "cd",
  "ud",
  "ssc",
  "rcd",
  "sl",
  "1",
  "04",
  "05",
  "1899",
  "1900",
  "1909",
  "1910",
  "calcio",
]);
export function normTeam(v) {
  let s = String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ALIASES[s]) s = ALIASES[s];
  return s;
}
const tokens = (s) =>
  normTeam(s)
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
export function nameScore(query, team) {
  const q = tokens(query);
  if (!q.length || !team) return 0;
  let best = 0;
  for (const cand of [team.name, team.shortName, team.tla]) {
    if (!cand) continue;
    const c = tokens(cand);
    if (!c.length) continue;
    const qs = q.join(" "),
      cs = c.join(" ");
    if (qs === cs) return 1;
    const inter = q.filter((t) =>
      c.some((x) => x === t || (t.length >= 4 && (x.startsWith(t) || t.startsWith(x)))),
    );
    let sc = inter.length / Math.max(q.length, c.length);
    if (cs.includes(qs) || qs.includes(cs)) sc = Math.max(sc, 0.75);
    best = Math.max(best, sc);
  }
  return best;
}
export function findMatch(matches, home, away) {
  let best = null;
  for (const m of matches || []) {
    const direct = Math.min(nameScore(home, m.homeTeam), nameScore(away, m.awayTeam));
    const swapped = Math.min(nameScore(home, m.awayTeam), nameScore(away, m.homeTeam)) * 0.9;
    const sc = Math.max(direct, swapped);
    if (sc >= 0.34 && (!best || sc > best.sc)) best = { m, sc, swapped: swapped > direct };
  }
  return best;
}

// ---------- Modelo de goles (Poisson) ----------
const fact = (n) => (n < 2 ? 1 : n * fact(n - 1));
const pois = (k, l) => (Math.exp(-l) * Math.pow(l, k)) / fact(k);
export function poissonModel(lh, la) {
  const N = 10;
  let p1 = 0,
    px = 0,
    p2 = 0,
    btts = 0;
  const totals = new Array(2 * N + 1).fill(0);
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const p = pois(i, lh) * pois(j, la);
      if (i > j) p1 += p;
      else if (i === j) px += p;
      else p2 += p;
      if (i > 0 && j > 0) btts += p;
      totals[i + j] += p;
    }
  const over = (line) => totals.reduce((s, p, g) => (g > line ? s + p : s), 0);
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    lambdaLocal: r(lh),
    lambdaVisitante: r(la),
    p1: r(p1),
    px: r(px),
    p2: r(p2),
    over05: r(over(0.5)),
    over15: r(over(1.5)),
    over25: r(over(2.5)),
    over35: r(over(3.5)),
    btts: r(btts),
  };
}
// Goles esperados con la tabla de local y de visitante (fuerza de ataque × debilidad defensiva × media de la liga),
// acercando a la media cuando hay pocos partidos jugados.
export function expectedGoals(standings, homeId, awayId) {
  const table = (type) => standings?.find((s) => s.type === type)?.table || [];
  const H = table("HOME"),
    A = table("AWAY");
  const sum = (t, k) => t.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const shrink = (v, n, mean) => (v * n + mean * 4) / (n + 4);
  if (!H.length || !A.length) {
    // El plan gratis solo trae la tabla general: se usa con una ventaja de local típica (±10 %).
    const T = table("TOTAL");
    const avg = sum(T, "goalsFor") / Math.max(1, sum(T, "playedGames"));
    const h = T.find((r) => r.team?.id === homeId),
      a = T.find((r) => r.team?.id === awayId);
    if (!T.length || !h || !a || !avg) return null;
    const rate = (r, k) => shrink(r[k] / Math.max(1, r.playedGames), r.playedGames, avg) / avg;
    return {
      lh: rate(h, "goalsFor") * rate(a, "goalsAgainst") * avg * 1.1,
      la: rate(a, "goalsFor") * rate(h, "goalsAgainst") * avg * 0.9,
      base: "tabla general (con ventaja de local)",
    };
  }
  const avgHome = sum(H, "goalsFor") / Math.max(1, sum(H, "playedGames")),
    avgAway = sum(A, "goalsFor") / Math.max(1, sum(A, "playedGames"));
  const h = H.find((r) => r.team?.id === homeId),
    a = A.find((r) => r.team?.id === awayId);
  if (!h || !a || !avgHome || !avgAway) return null;
  const hAtt = shrink(h.goalsFor / Math.max(1, h.playedGames), h.playedGames, avgHome) / avgHome,
    hDef = shrink(h.goalsAgainst / Math.max(1, h.playedGames), h.playedGames, avgAway) / avgAway,
    aAtt = shrink(a.goalsFor / Math.max(1, a.playedGames), a.playedGames, avgAway) / avgAway,
    aDef = shrink(a.goalsAgainst / Math.max(1, a.playedGames), a.playedGames, avgHome) / avgHome;
  return { lh: hAtt * aDef * avgHome, la: aAtt * hDef * avgAway, base: "tabla de local y visitante" };
}
// Sin tabla (copas, fases de eliminación): con los últimos partidos de cada equipo.
export function expectedFromForm(homeMatches, awayMatches, homeId, awayId) {
  const avg = (ms, id) => {
    const xs = (ms || []).filter((m) => m.score?.fullTime?.home != null);
    if (xs.length < 3) return null;
    let gf = 0,
      ga = 0;
    xs.forEach((m) => {
      const isHome = m.homeTeam?.id === id;
      gf += isHome ? m.score.fullTime.home : m.score.fullTime.away;
      ga += isHome ? m.score.fullTime.away : m.score.fullTime.home;
    });
    return { gf: gf / xs.length, ga: ga / xs.length, n: xs.length };
  };
  const h = avg(homeMatches, homeId),
    a = avg(awayMatches, awayId);
  if (!h || !a) return null;
  const mean = 1.35;
  const shrink = (v, n) => (v * n + mean * 4) / (n + 4);
  return {
    lh: Math.max(0.2, ((shrink(h.gf, h.n) + shrink(a.ga, a.n)) / 2) * 1.1),
    la: Math.max(0.2, ((shrink(a.gf, a.n) + shrink(h.ga, h.n)) / 2) * 0.9),
    base: "últimos partidos de cada equipo",
  };
}

// ---------- Consulta a la API con caché ----------
// Se guarda solo lo necesario de cada partido (las listas de partidos ocupan mucho).
const team = (t) => t && { id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, crest: t.crest };
const slimMatch = (m) => ({
  id: m.id,
  utcDate: m.utcDate,
  status: m.status,
  competition: m.competition && { id: m.competition.id, code: m.competition.code, name: m.competition.name },
  homeTeam: team(m.homeTeam),
  awayTeam: team(m.awayTeam),
  score: { fullTime: m.score?.fullTime || {} },
});
function slim(data) {
  if (Array.isArray(data?.matches)) return { ...data, matches: data.matches.map(slimMatch) };
  return data;
}
class ApiError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
async function fdGet(path, { token, store, fetchImpl, ttl }) {
  const key = "fd:" + path,
    now = Date.now();
  const hit = store && (await store.get(key));
  if (hit && now - hit.at < ttl) return hit.data;
  const r = await fetchImpl(API + path, { headers: { "X-Auth-Token": token } });
  if (r.status === 429)
    throw new ApiError(429, "Se alcanzó el límite gratis (10 consultas por minuto). Prueba en un minuto.");
  if (r.status === 403)
    throw new ApiError(403, "Esta competición no está incluida en el plan gratis de football-data.org.");
  if (r.status === 400 || r.status === 401)
    throw new ApiError(401, "football-data.org rechazó la clave FOOTBALL_DATA_KEY. Revísala en Cloudflare.");
  if (r.status === 404) throw new ApiError(404, "football-data.org no tiene estos datos.");
  if (!r.ok) throw new ApiError(502, "football-data.org no respondió (error " + r.status + ").");
  const data = slim(await r.json());
  if (store)
    try {
      await store.put(key, { at: now, data });
    } catch {
      // Si no se puede guardar en caché, se sigue sin ella.
    }
  return data;
}
const shiftDay = (iso, d) =>
  new Date(Date.parse(iso + "T12:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const RES = { W: "G", D: "E", L: "P" };
function teamRow(standings, type, id) {
  const r = standings?.find((s) => s.type === type)?.table?.find((x) => x.team?.id === id);
  return r
    ? {
        posicion: r.position,
        puntos: r.points,
        jugados: r.playedGames,
        ganados: r.won,
        empates: r.draw,
        perdidos: r.lost,
        golesFavor: r.goalsFor,
        golesContra: r.goalsAgainst,
        forma: String(r.form || "")
          .split(",")
          .filter(Boolean)
          .map((x) => RES[x] || x)
          .join(""),
      }
    : null;
}
function lastMatches(ms, id) {
  return (ms || [])
    .filter((m) => m.score?.fullTime?.home != null)
    .sort((a, b) => String(b.utcDate).localeCompare(String(a.utcDate)))
    .slice(0, 5)
    .map((m) => {
      const isHome = m.homeTeam?.id === id,
        gf = isHome ? m.score.fullTime.home : m.score.fullTime.away,
        ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      return {
        fecha: String(m.utcDate).slice(0, 10),
        rival: (isHome ? m.awayTeam : m.homeTeam)?.shortName || (isHome ? m.awayTeam : m.homeTeam)?.name,
        enCasa: isHome,
        marcador: gf + "-" + ga,
        resultado: gf > ga ? "G" : gf === ga ? "E" : "P",
        competicion: m.competition?.name,
      };
    });
}

export async function datosPartido(request, { token, store, fetchImpl = fetch }) {
  const u = new URL(request.url);
  const home = (u.searchParams.get("home") || "").slice(0, 80),
    away = (u.searchParams.get("away") || "").slice(0, 80),
    date = u.searchParams.get("date") || "";
  if (!home || !away || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return reply(400, { error: "Faltan los equipos o la fecha del partido." });
  if (!token)
    return reply(503, {
      error:
        "Falta configurar FOOTBALL_DATA_KEY en Cloudflare. Es gratis: regístrate en football-data.org y copia tu clave.",
      codigo: "sin_clave",
    });
  const opt = (ttl) => ({ token, store, fetchImpl, ttl });
  try {
    const day = await fdGet(
      "/matches?dateFrom=" + shiftDay(date, -1) + "&dateTo=" + shiftDay(date, 1),
      opt(30 * 60000),
    );
    const found = findMatch(day.matches, home, away);
    if (!found)
      return reply(200, {
        encontrado: false,
        motivo:
          "No encontré este partido en football-data.org. El plan gratis cubre las ligas principales de Europa, la Champions, el Mundial y la Eurocopa; otras competiciones (como la Nations League) no están incluidas.",
      });
    const m = found.m;
    // Si la casa puso los equipos al revés, se respeta el orden de la API.
    const H = m.homeTeam,
      A = m.awayTeam;
    const safe = (p) => p.catch((e) => (e.status === 429 ? Promise.reject(e) : null));
    const [st, h2h, fh, fa] = await Promise.all([
      safe(
        fdGet("/competitions/" + (m.competition?.code || m.competition?.id) + "/standings", opt(6 * 3600000)),
      ),
      safe(fdGet("/matches/" + m.id + "/head2head?limit=10", opt(12 * 3600000))),
      safe(fdGet("/teams/" + H.id + "/matches?status=FINISHED&limit=6", opt(6 * 3600000))),
      safe(fdGet("/teams/" + A.id + "/matches?status=FINISHED&limit=6", opt(6 * 3600000))),
    ]);
    const xg =
      expectedGoals(st?.standings, H.id, A.id) || expectedFromForm(fh?.matches, fa?.matches, H.id, A.id);
    const agg = h2h?.aggregates;
    return reply(200, {
      encontrado: true,
      alReves: found.swapped,
      partido: {
        id: m.id,
        competicion: m.competition?.name,
        fecha: m.utcDate,
        estado: m.status,
        local: { nombre: H.shortName || H.name, escudo: H.crest },
        visitante: { nombre: A.shortName || A.name, escudo: A.crest },
      },
      tabla: st
        ? {
            local: teamRow(st.standings, "TOTAL", H.id),
            visitante: teamRow(st.standings, "TOTAL", A.id),
            localEnCasa: teamRow(st.standings, "HOME", H.id),
            visitanteFuera: teamRow(st.standings, "AWAY", A.id),
            equipos: st.standings?.find((s) => s.type === "TOTAL")?.table?.length || null,
          }
        : null,
      forma: { local: lastMatches(fh?.matches, H.id), visitante: lastMatches(fa?.matches, A.id) },
      h2h: agg
        ? {
            partidos: agg.numberOfMatches,
            goles: agg.totalGoals,
            local: {
              ganados: agg.homeTeam?.wins,
              empates: agg.homeTeam?.draws,
              perdidos: agg.homeTeam?.losses,
            },
            visitante: {
              ganados: agg.awayTeam?.wins,
              empates: agg.awayTeam?.draws,
              perdidos: agg.awayTeam?.losses,
            },
            ultimos: (h2h.matches || [])
              .filter((x) => x.score?.fullTime?.home != null)
              .slice(0, 5)
              .map((x) => ({
                fecha: String(x.utcDate).slice(0, 10),
                local: x.homeTeam?.shortName || x.homeTeam?.name,
                visitante: x.awayTeam?.shortName || x.awayTeam?.name,
                marcador: x.score.fullTime.home + "-" + x.score.fullTime.away,
              })),
          }
        : null,
      modelo: xg ? { ...poissonModel(xg.lh, xg.la), base: xg.base } : null,
      fuente: "football-data.org",
    });
  } catch (e) {
    return reply(e.status === 429 ? 429 : e.status || 502, {
      error: e.message || "No se pudieron cargar los datos.",
    });
  }
}
