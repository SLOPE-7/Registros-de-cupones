// Lector de cupones: convierte el texto pegado en partidos, mercados, cuotas e importes.
"use strict";
function inferCompetitionCountry(value) {
  const n = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/champions league|europa league|conference league|uefa|copa libertadores|copa sudamericana/.test(n))
    return "Europa";
  if (/copa del rey|la liga|laliga/.test(n)) return "España";
  if (/premier league|fa cup|efl cup/.test(n)) return "Inglaterra";
  if (/serie a|coppa italia/.test(n)) return "Italia";
  if (/bundesliga|dfb pokal/.test(n)) return "Alemania";
  if (/ligue 1|coupe de france/.test(n)) return "Francia";
  if (/primeira liga|taca de portugal/.test(n)) return "Portugal";
  if (/eredivisie|knvb/.test(n)) return "Países Bajos";
  if (/world cup|mundial|amistoso internacional/.test(n)) return "Internacional";
  return "";
}
// Línea con "País o región, Competición" (p. ej. "Europa, UEFA Europa League" o "España, LaLiga").
const LEAGUE_LINE_RE = new RegExp(
  "^(?:" +
    [
      "Europa",
      "Mundo",
      "Internacional",
      "Internacionales",
      "Sudamérica",
      "Sudamerica",
      "Norteamérica",
      "CONCACAF",
      "CONMEBOL",
      "UEFA",
      "FIFA",
      "Inglaterra",
      "España",
      "Italia",
      "Francia",
      "Alemania",
      "Portugal",
      "Países Bajos",
      "Paises Bajos",
      "Holanda",
      "Escocia",
      "Gales",
      "Bélgica",
      "Belgica",
      "Turquía",
      "Turquia",
      "Grecia",
      "Austria",
      "Suiza",
      "Dinamarca",
      "Noruega",
      "Suecia",
      "Finlandia",
      "Polonia",
      "República Checa",
      "Chequia",
      "Croacia",
      "Serbia",
      "Ucrania",
      "Rusia",
      "Rumania",
      "Hungría",
      "Hungria",
      "Irlanda",
      "Chipre",
      "Israel",
      "Brasil",
      "Argentina",
      "Uruguay",
      "Colombia",
      "Chile",
      "Perú",
      "Peru",
      "Ecuador",
      "Paraguay",
      "Bolivia",
      "Venezuela",
      "México",
      "Mexico",
      "Estados Unidos",
      "EE\\.UU\\.",
      "Canadá",
      "Canada",
      "Honduras",
      "Costa Rica",
      "Guatemala",
      "El Salvador",
      "Panamá",
      "Panama",
      "Nicaragua",
      "Arabia Saudita",
      "Arabia Saudí",
      "Japón",
      "Japon",
      "Corea del Sur",
      "China",
      "Australia",
      "Marruecos",
      "Egipto",
      "Catar",
      "Qatar",
    ].join("|") +
    ")\\s*,",
  "i",
);
// Quita la etiqueta de promoción "• pago anticipado" de la selección (se guarda aparte como earlyPayout).
function splitEarlyPayout(pick) {
  const m = String(pick || "").match(/\s*[•·-]?\s*pago anticipado\s*$/i);
  return m
    ? { pick: String(pick).slice(0, m.index).trim(), early: true }
    : { pick: String(pick || "").trim(), early: false };
}
// Línea del importe apostado. "Apuesta" solo cuenta si va sola o seguida del importe
// (así "Apuesta sin empate: 1" se lee como mercado y no como importe).
const STAKE_LINE_RE = /^(?:VALOR APOSTADO|IMPORTE APOSTADO|STAKE)\b|^APUESTA\s*(?::|L\b|\$|\d|$)/i;
function parseCoupon(raw) {
  const lines = String(raw || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const fixtures = [],
    meta = { stake: null, odds: null, bonus: 0, payout: null };
  const dateRe = /\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\s*(?:[•·,\-]\s*)?(\d{1,2}):(\d{2})\b/;
  const cleanTeam = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\(.*?\)\s*$/, "")
      .replace(/\bcompetitor\s+logo\b/gi, "")
      .replace(/^[\s:|•·-]+|[\s:|•·-]+$/g, "")
      .trim();
  const validTeam = (s) => {
    const t = cleanTeam(s);
    return !!t && !/^(?:logo|competitor|competitor logo|vs\.?|v)$/i.test(t) && !/^\d+(?:[.,]\d+)?$/.test(t);
  };
  const numRe = /^[L$]?\s*([\d]+(?:[,.][\d]{1,2})?)\s*$/;
  const getAmount = (line, next) => {
    const find = (s) => {
      const m = String(s || "").match(/(?:^|[:\s])(?:L\s*|\$\s*)?([\d]+(?:[,.][\d]+)*)(?=\s*$)/i);
      return m ? parseMoney(m[1]) : null;
    };
    const value = find(line);
    return value !== null ? value : find(next);
  };
  // Lee los importes aunque el valor esté en la línea siguiente.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let v;
    if (STAKE_LINE_RE.test(l)) {
      v = getAmount(l, lines[i + 1]);
      if (v !== null) meta.stake = v;
    } else if (/^(?:CUOTAS|CUOTA TOTAL|ODDS)\s*:?/i.test(l)) {
      v = getAmount(l, lines[i + 1]);
      if (v !== null) meta.odds = v;
    } else if (/^BONO\b/i.test(l)) {
      v = getAmount(l, lines[i + 1]);
      if (v !== null) meta.bonus = v;
    } else if (/^(?:GANANCIA TOTAL|RETORNO TOTAL|PAGO POTENCIAL|TOTAL RETURN)\b/i.test(l)) {
      v = getAmount(l, lines[i + 1]);
      if (v !== null) meta.payout = v;
    }
  }
  let league = "",
    date = null,
    time = "",
    current = null,
    pendingTeam = "",
    financialSummary = false;
  const finalize = () => {
    if (current) {
      fixtures.push(current);
      current = null;
    }
  };
  const setDate = (dm, line) => {
    if (current && current.markets.length) finalize();
    date = {
      day: String(dm[1]).padStart(2, "0"),
      month: String(dm[2]).padStart(2, "0"),
      year: dm[3] || "",
      text: `${String(dm[1]).padStart(2, "0")}/${String(dm[2]).padStart(2, "0")}${dm[3] ? "/" + dm[3] : ""}`,
    };
    time = `${String(dm[4]).padStart(2, "0")}:${dm[5]}`;
    const prefix = line
      .slice(0, dm.index)
      .replace(/[•·\-]+$/, "")
      .trim();
    if (prefix && /,|league|liga|serie|bundesliga|premier|ligue|championship/i.test(prefix)) league = prefix;
    if (current) {
      current.date = date.text;
      current.time = time;
      current.dateISO = date.year
        ? `${date.year.length === 2 ? "20" + date.year : date.year}-${date.month}-${date.day}`
        : `--${date.month}-${date.day}`;
      if (prefix) current.league = prefix;
    }
  };
  const makeFixture = (home, away) => {
    const year = date?.year || String(new Date().getFullYear());
    const parts = String(league || "")
        .split(",")
        .map((x) => x.trim()),
      rawCompetition = parts.length > 1 ? parts.slice(1).join(",").trim() : String(league || ""),
      rawCountry = parts.length > 1 ? parts[0] : inferCompetitionCountry(rawCompetition);
    return {
      id: uid(),
      home: cleanTeam(home),
      away: cleanTeam(away),
      league,
      country: rawCountry,
      competition: rawCompetition,
      leagueCrest: "",
      homeCrest: "",
      awayCrest: "",
      date: date?.text || "",
      dateISO: date ? `${year.length === 2 ? "20" + year : year}-${date.month}-${date.day}` : "",
      time,
      markets: [],
      builderOdd: "",
    };
  };
  const addBuilder = (line, odd) => {
    if (!current) return;
    const body = line.replace(/^(?:BetBuilder|Constructor de apuestas)\s*:\s*/i, "");
    const parts = body
      .split(/\s*\|\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const part of parts) {
      const colon = part.indexOf(":");
      let market = colon > 0 ? part.slice(0, colon).trim() : part,
        pick = colon > 0 ? part.slice(colon + 1).trim() : "";
      current.markets.push({
        market: market || "BetBuilder",
        pick,
        odd: "",
        builder: true,
        builderOdd: odd || "",
        settlement: "pending",
      });
    }
    current.builderOdd = odd || "";
    current.totalOdds = odd || "";
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^competitor\s+logo$/i.test(line)) continue;
    if (STAKE_LINE_RE.test(line)) {
      financialSummary = true;
      continue;
    }
    if (financialSummary && /^(?:CUOTAS|CUOTA TOTAL|ODDS)\b/i.test(line)) continue;
    if (/^(?:BONO|GANANCIA TOTAL|RETORNO TOTAL|PAGO POTENCIAL|TOTAL RETURN)\b/i.test(line)) continue;
    const dm = line.match(dateRe);
    if (dm) {
      setDate(dm, line);
      continue;
    }
    if (LEAGUE_LINE_RE.test(line)) {
      league = line;
      continue;
    }
    const vs = line.match(/^(.+?)\s+(?:vs\.?|versus|v)\s+(.+)$/i);
    if (vs) {
      const home = cleanTeam(vs[1]),
        away = cleanTeam(vs[2]);
      if (!validTeam(home) || !validTeam(away)) {
        finalize();
        current = null;
        continue;
      }
      finalize();
      current = makeFixture(home, away);
      if (league) current.league = league;
      continue;
    }
    if (/^(?:vs\.?|versus|v)$/i.test(line) && i > 0 && i + 1 < lines.length) {
      pendingTeam = lines[i - 1];
      const away = lines[i + 1];
      if (
        !/^(?:BetBuilder|Cuotas|VALOR APOSTADO|GANANCIA TOTAL)/i.test(away) &&
        validTeam(pendingTeam) &&
        validTeam(away)
      ) {
        finalize();
        current = makeFixture(pendingTeam, away);
        if (league) current.league = league;
        i++;
        pendingTeam = "";
      }
      continue;
    }
    if (!current) {
      if (!/^(?:BetBuilder|Cuotas)/i.test(line) && !numRe.test(line) && !/^\d{1,2}[/.\-]\d{1,2}/.test(line))
        pendingTeam = line;
      continue;
    }
    if (/^(?:BetBuilder|Constructor de apuestas)\s*:/i.test(line)) {
      let odd = "",
        j = i + 1;
      if (/^Cuotas\s*:/i.test(lines[j] || "")) {
        odd = lines[j].replace(/^Cuotas\s*:\s*/i, "").trim();
        j++;
        if (!odd && /^[\d]+[.,][\d]+$/.test(lines[j] || "")) odd = lines[j++];
      } else if (/^[\d]+[.,][\d]+$/.test(lines[j] || "")) odd = lines[j++];
      odd = odd ? odd.replace(",", ".") : "";
      i = j - 1;
      addBuilder(line, odd);
      continue;
    }
    if (/^Cuotas\s*:/i.test(line)) {
      let v = line.replace(/^Cuotas\s*:\s*/i, "").trim();
      if (!v && /^[\d]+[.,][\d]+$/.test(lines[i + 1] || "")) v = lines[++i].replace(",", ".");
      if (v) {
        current.totalOdds = v.replace(",", ".");
        if (current.markets.length && !current.markets[current.markets.length - 1].builder)
          current.markets[current.markets.length - 1].odd = v.replace(",", ".");
      }
      continue;
    }
    const loneOdd = line.match(/^(?:@\s*|cuotas?\s*:?\s*|odds\s*:?\s*)?(\d{1,3}[.,]\d{1,3})$/i);
    if (loneOdd && current.markets.length) {
      const last = current.markets[current.markets.length - 1];
      if (!last.builder && !last.odd) {
        last.odd = loneOdd[1].replace(",", ".");
        if (current.markets.length === 1) current.totalOdds = last.odd;
        continue;
      }
    }
    if (
      /^(?:1x2|1x|x2|12|más de|menos de|over|under|ambos(?: equipos marcan)?|total(?: de goles)?|córners|corners|tarjetas|remates|disparos|resultado|doble oportunidad|hándicap|handicap|\d+\s+total)/i.test(
        line,
      ) ||
      /^[^:]{2,70}:\s*\S+/.test(line)
    ) {
      const rawPick = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
      const ep = splitEarlyPayout(rawPick);
      // Cuota pegada al final de la selección, p. ej. "1 • pago anticipado @1.47"
      const tailOdd = ep.pick.match(/\s+@\s*(\d{1,3}[.,]\d{1,3})$/);
      current.markets.push({
        market: line.includes(":") ? line.split(":")[0].trim() : line,
        pick: tailOdd ? ep.pick.slice(0, tailOdd.index).trim() : ep.pick,
        odd: tailOdd ? tailOdd[1].replace(",", ".") : "",
        builder: false,
        settlement: "pending",
        ...(ep.early ? { earlyPayout: true } : {}),
      });
    }
  }
  finalize();
  const unique = [],
    seen = new Map();
  let duplicateFixtures = 0;
  for (const f of fixtures) {
    const k = [
        teamEventKey(f.home),
        teamEventKey(f.away),
        f.dateISO || f.date,
        String(f.time || "").slice(0, 5),
      ].join("|"),
      existing = seen.get(k);
    if (existing) {
      duplicateFixtures++;
      const keys = new Set(existing.markets.map((m) => [crestNorm(m.market), crestNorm(m.pick)].join("|")));
      for (const m of f.markets) {
        const mk = [crestNorm(m.market), crestNorm(m.pick)].join("|");
        if (!keys.has(mk)) {
          existing.markets.push(m);
          keys.add(mk);
        }
      }
      if (!existing.totalOdds && f.totalOdds) existing.totalOdds = f.totalOdds;
      if (!existing.country && f.country) existing.country = f.country;
      if (!existing.competition && f.competition) existing.competition = f.competition;
      continue;
    }
    seen.set(k, f);
    unique.push(f);
  }
  return { fixtures: unique, meta: { ...meta, duplicateFixtures } };
}

// Una sola vez por cupón: separa "• pago anticipado" de las selecciones ya guardadas.
function migrateEarlyPayout() {
  const moved = new Map();
  db.coupons.forEach((c) =>
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        const ep = splitEarlyPayout(m.pick);
        if (!ep.early) return;
        const oldKey = marketKey(f, m);
        m.pick = ep.pick;
        m.earlyPayout = true;
        moved.set(oldKey, marketKey(f, m));
      }),
    ),
  );
  if (!moved.size) return false;
  if (db.progress)
    for (const [a, b] of moved)
      if (db.progress[a] && !db.progress[b]) {
        db.progress[b] = db.progress[a];
        delete db.progress[a];
      }
  (db.resultHistory || []).forEach((h) => {
    if (moved.has(h.key)) h.key = moved.get(h.key);
  });
  return true;
}
