// Búsqueda de escudos, logos de ligas y banderas en varias fuentes a la vez, en español y en inglés.
//   GET /api/buscar-logo?tipo=equipo|liga|pais&q=Bayern Múnich&pais=Alemania
// Fuentes (en paralelo; si una falla, se usan las demás):
//   1. football-data.org: escudos y logos oficiales de las ligas de su plan gratis (necesita FOOTBALL_DATA_KEY).
//   2. Wikidata/Wikipedia: gratis y multilingüe (busca en español y en inglés); logo (P154) o bandera (P41).
//   3. TheSportsDB: equipos (nombre en los dos idiomas) y ligas por país.
//   4. Banderas (flagcdn.com) para países y selecciones, por su nombre en español o inglés.
import { norm, findCountry, teamAlias, leagueInfo } from "./nombres.mjs";

const UA = "KAL-Cupones/1.0 (app personal de seguimiento de apuestas)";
const FREE_COMPETITIONS = ["PL", "PD", "SA", "BL1", "FL1", "DED", "PPL", "ELC", "CL", "BSA", "EC", "WC"];

const reply = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

async function getJson(fetchImpl, url, init = {}, ms = 9000) {
  const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
// Caché en el almacenamiento del Worker (si hay) para no repetir consultas.
async function cached(store, key, ttl, fn) {
  const hit = store && (await store.get(key).catch(() => null));
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await fn();
  if (store) await store.put(key, { at: Date.now(), data }).catch(() => {});
  return data;
}

// Parecido entre dos nombres (0 a 1), por palabras.
const NOISE = new Set([
  "fc",
  "cf",
  "afc",
  "sc",
  "ac",
  "club",
  "de",
  "del",
  "la",
  "el",
  "cd",
  "ud",
  "sv",
  "fk",
  "sk",
  "the",
]);
const toks = (s) =>
  norm(s)
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
export function similarity(a, b) {
  const A = toks(a),
    B = toks(b);
  if (!A.length || !B.length) return 0;
  const joinA = A.join(" "),
    joinB = B.join(" ");
  if (joinA === joinB) return 1;
  const inter = A.filter((t) =>
    B.some((x) => x === t || (t.length >= 4 && (x.startsWith(t) || t.startsWith(x)))),
  );
  let s = inter.length / Math.max(A.length, B.length);
  if (joinB.includes(joinA) || joinA.includes(joinB)) s = Math.max(s, 0.75);
  return s;
}

// ---------- Fuentes ----------
function commonsUrl(file) {
  return (
    "https://commons.wikimedia.org/wiki/Special:FilePath/" +
    encodeURIComponent(String(file).replace(/ /g, "_")) +
    "?width=200"
  );
}
async function fromWikidata(fetchImpl, terms, tipo) {
  const ids = new Set();
  const searches = [];
  for (const term of terms)
    for (const lang of ["es", "en"])
      searches.push(
        getJson(
          fetchImpl,
          "https://www.wikidata.org/w/api.php?" +
            new URLSearchParams({
              action: "wbsearchentities",
              search: term,
              language: lang,
              uselang: "es",
              type: "item",
              limit: "6",
              format: "json",
              origin: "*",
            }),
          { headers: { "user-agent": UA, "api-user-agent": UA } },
        ).then((d) => (d.search || []).forEach((x) => ids.add(x.id))),
      );
  await Promise.allSettled(searches);
  if (!ids.size) return [];
  const d = await getJson(
    fetchImpl,
    "https://www.wikidata.org/w/api.php?" +
      new URLSearchParams({
        action: "wbgetentities",
        ids: [...ids].slice(0, 20).join("|"),
        props: "labels|descriptions|claims",
        languages: "es|en",
        format: "json",
        origin: "*",
      }),
    { headers: { "user-agent": UA, "api-user-agent": UA } },
  );
  const out = [];
  for (const e of Object.values(d.entities || {})) {
    const claim = (p) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
    const desc = norm((e.descriptions?.es?.value || "") + " " + (e.descriptions?.en?.value || ""));
    const sporty =
      /futbol|football|soccer|club|liga|league|copa|cup|campeonato|championship|seleccion|national/.test(
        desc,
      );
    const img = tipo === "pais" ? claim("P41") : claim("P154") || (sporty ? claim("P94") : null);
    if (!img || (tipo !== "pais" && !sporty)) continue;
    out.push({
      id: e.id,
      name: e.labels?.es?.value || e.labels?.en?.value || "",
      nameEn: e.labels?.en?.value || "",
      country: "",
      logo: commonsUrl(img),
      source: "Wikipedia",
    });
  }
  return out;
}
async function footballDataIndex(fetchImpl, token, store) {
  // Catálogo de competiciones (logos de ligas) y equipos de las competiciones gratis. Se arma poco a poco
  // (como máximo 4 competiciones nuevas por búsqueda) para no pasar el límite de 10 consultas por minuto.
  const H = { headers: { "X-Auth-Token": token } };
  const comps = await cached(store, "logos:fd:comps", 7 * 86400000, async () => {
    const d = await getJson(fetchImpl, "https://api.football-data.org/v4/competitions", H);
    return (d.competitions || []).map((c) => ({
      code: c.code,
      name: c.name,
      country: c.area?.name || "",
      logo: c.emblem || "",
    }));
  });
  const teams = [];
  let fetched = 0;
  for (const code of FREE_COMPETITIONS) {
    const key = "logos:fd:teams:" + code;
    const hit = store && (await store.get(key).catch(() => null));
    if (hit && Date.now() - hit.at < 7 * 86400000) {
      teams.push(...hit.data);
      continue;
    }
    if (fetched >= 4) continue;
    fetched++;
    try {
      const d = await getJson(
        fetchImpl,
        "https://api.football-data.org/v4/competitions/" + code + "/teams",
        H,
      );
      const list = (d.teams || []).map((t) => ({
        name: t.name,
        shortName: t.shortName,
        tla: t.tla,
        country: t.area?.name || "",
        logo: t.crest || "",
      }));
      if (store) await store.put(key, { at: Date.now(), data: list }).catch(() => {});
      teams.push(...list);
    } catch (e) {
      if (e.status === 429) break;
    }
  }
  return { comps, teams };
}
async function fromTheSportsDb(fetchImpl, key, tipo, terms, countryEn) {
  const base = "https://www.thesportsdb.com/api/v1/json/" + key;
  if (tipo === "equipo") {
    const rows = (
      await Promise.allSettled(
        terms.map((t) => getJson(fetchImpl, base + "/searchteams.php?t=" + encodeURIComponent(t))),
      )
    ).flatMap((x) => (x.status === "fulfilled" ? x.value.teams || [] : []));
    return rows
      .filter((x) => !x.strSport || x.strSport === "Soccer")
      .map((x) => ({
        name: x.strTeam || "",
        nameEn: x.strTeamAlternate || "",
        country: x.strCountry || "",
        logo: x.strBadge || "",
        source: "TheSportsDB",
      }));
  }
  if (tipo === "liga" && countryEn) {
    const d = await getJson(
      fetchImpl,
      base + "/search_all_leagues.php?" + new URLSearchParams({ c: countryEn, s: "Soccer" }),
    );
    return (d.countries || d.countrys || d.leagues || []).map((x) => ({
      name: x.strLeague || "",
      nameEn: x.strLeagueAlternate || "",
      country: x.strCountry || countryEn,
      logo: x.strBadge || x.strLogo || "",
      source: "TheSportsDB",
    }));
  }
  return [];
}

// ---------- Búsqueda ----------
export async function buscarLogos(
  request,
  { footballDataKey, theSportsDbKey = "123", store, fetchImpl = fetch },
) {
  if (request.method !== "GET") return reply(405, { error: "Usa una solicitud GET." });
  const p = new URL(request.url).searchParams;
  const tipo = p.get("tipo"),
    q = String(p.get("q") || "")
      .trim()
      .slice(0, 80),
    paisParam = String(p.get("pais") || "").slice(0, 60);
  if (!["equipo", "liga", "pais"].includes(tipo) || q.length < 2)
    return reply(400, { error: "Indica el tipo (equipo, liga o pais) y el nombre." });

  // Variantes del nombre: tal cual, en inglés (selecciones, alias) y sin siglas.
  const country = findCountry(q);
  const alias = teamAlias(q);
  const lg = tipo === "liga" ? leagueInfo(q) : { country: null, code: null };
  const paisCtx = findCountry(paisParam);
  const terms = [
    ...new Set(
      [q, alias, country?.en, country?.es, toks(q).join(" ")].filter((x) => x && String(x).length >= 2),
    ),
  ].slice(0, 4);

  const jobs = [];
  // Banderas: países y selecciones
  if (country && (tipo === "pais" || tipo === "equipo"))
    jobs.push(
      Promise.resolve([
        {
          name: country.es,
          nameEn: country.en,
          country: country.es,
          logo: "https://flagcdn.com/w160/" + country.flag + ".png",
          source: "Bandera",
        },
      ]),
    );
  if (tipo !== "pais" && footballDataKey)
    jobs.push(
      footballDataIndex(fetchImpl, footballDataKey, store).then(({ comps, teams }) =>
        tipo === "liga"
          ? comps.map((c) => ({ ...c, source: "football-data.org", code: c.code }))
          : teams.map((t) => ({
              name: t.name,
              nameEn: t.shortName,
              tla: t.tla,
              country: t.country,
              logo: t.logo,
              source: "football-data.org",
            })),
      ),
    );
  jobs.push(
    cached(store, "logos:wd:" + tipo + ":" + norm(terms.join("|")), 7 * 86400000, () =>
      fromWikidata(fetchImpl, terms.slice(0, 2), tipo),
    ),
  );
  if (tipo !== "pais")
    jobs.push(
      cached(
        store,
        "logos:ts:" + tipo + ":" + norm(terms.join("|")) + ":" + (lg.country || paisCtx?.en || ""),
        86400000,
        () => fromTheSportsDb(fetchImpl, theSportsDbKey, tipo, terms.slice(0, 3), lg.country || paisCtx?.en),
      ),
    );
  const settled = await Promise.allSettled(jobs);
  const errors = settled.filter((x) => x.status === "rejected").map((x) => x.reason?.message);

  // Ordenar: parecido con cualquiera de las variantes; football-data y banderas primero ante empate.
  const priority = { "football-data.org": 0.06, Bandera: 0.05, TheSportsDB: 0.02, Wikipedia: 0 };
  const seen = new Set();
  const options = settled
    .flatMap((x) => (x.status === "fulfilled" ? x.value : []))
    .filter((o) => o.logo && o.name)
    .map((o) => {
      let s = Math.max(...terms.map((t) => Math.max(similarity(t, o.name), similarity(t, o.nameEn || ""))));
      if (o.tla && norm(o.tla) === norm(q)) s = Math.max(s, 0.9);
      if (lg.code && o.code === lg.code) s = Math.max(s, 0.95);
      if (paisCtx && o.country && similarity(paisCtx.en, o.country) + similarity(paisCtx.es, o.country) > 0)
        s += 0.05;
      return { ...o, score: s + (priority[o.source] || 0) };
    })
    .filter((o) => o.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .filter((o) => (seen.has(o.logo) ? false : seen.add(o.logo)))
    .slice(0, 8)
    .map(({ score, nameEn, tla, code, ...o }) => ({
      ...o,
      country: findCountry(o.country)?.es || o.country || "",
    }));
  return reply(200, {
    options,
    ...(options.length || !errors.length ? {} : { error: "Las fuentes no respondieron." }),
  });
}
