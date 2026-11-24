// Pruebas automáticas de KAL.
// Uso:  node pruebas/ejecutar.mjs      (desde la carpeta KAL_Cupon_Netlify)
// Necesita Playwright con Chromium (npm i -D playwright && npx playwright install chromium).
// Levanta un servidor local con la carpeta site/ (y una versión simulada de la función de avisos),
// abre la app en un navegador del tamaño de un teléfono y comprueba cada función con resultados esperados.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseDb, isoDay } from "./datos.mjs";

const require = createRequire(import.meta.url);
const nativeFetch = globalThis.fetch; // algunas secciones simulan fetch; la 16 necesita la red local de verdad
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");

let ok = 0,
  fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    ok++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (detail ? "  →  " + detail : ""));
  }
};
const section = (t) => console.log("\n" + t);

// ---------- servidor local ----------
const posts = [];
const analystPosts = [];
const seen = [];
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // API-Football (escudos y jugadores), TheSportsDB (imagenes) y el proxy de imágenes, simulados.
  const sendJson = (obj, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === "/api/escudos") {
    seen.push("escudos:" + url.searchParams.get("home"));
    return sendJson({
      home: {
        options: [
          {
            name: url.searchParams.get("home"),
            country: "Turkey",
            logo: "https://media.api-sports.io/football/teams/611.png",
          },
        ],
      },
      away: { options: [] },
      league: { options: [] },
    });
  }
  if (url.pathname === "/api/jugadores") {
    const q = url.searchParams.get("search") || "";
    seen.push("jugadores:" + q);
    const P = (id, name, team, country) => ({
      id,
      name,
      team,
      country,
      photo: "https://media.api-sports.io/football/players/" + id + ".png",
      teamId: "26",
    });
    return sendJson({
      players: /baena/i.test(q)
        ? [P("501", "Alejandro Baena Rodriguez", "Villarreal", "Spain")]
        : /kang/i.test(q)
          ? [P("88", "Kang-in Lee", "Paris Saint Germain", "South Korea")]
          : [],
    });
  }
  if (url.pathname === "/api/imagenes") {
    seen.push("imagenes:" + url.searchParams.get("tipo") + ":" + url.searchParams.get("q"));
    return sendJson({
      options:
        url.searchParams.get("tipo") === "equipo"
          ? [
              {
                id: "1",
                name: url.searchParams.get("q") + " (TSDB)",
                country: "Turkey",
                logo: "https://r2.thesportsdb.com/images/media/team/badge/abc.png",
                source: "TheSportsDB",
              },
            ]
          : /^rodriguez$/i.test(url.searchParams.get("q"))
            ? [
                {
                  id: "77",
                  name: "Carlos Mario Rodriguez",
                  team: "Getafe",
                  photo: "https://r2.thesportsdb.com/images/media/player/cutout/rod.png",
                  source: "TheSportsDB",
                },
              ]
            : /nico|paz/i.test(url.searchParams.get("q"))
              ? [
                  {
                    id: "9",
                    name: "Nico Paz",
                    team: "Como",
                    photo: "https://r2.thesportsdb.com/images/media/player/cutout/nico.png",
                    source: "TheSportsDB",
                  },
                ]
              : [],
    });
  }
  if (url.pathname === "/api/buscar-logo") {
    const tipo = url.searchParams.get("tipo"),
      q = url.searchParams.get("q");
    seen.push("buscar:" + tipo + ":" + q);
    return sendJson({
      options:
        tipo === "equipo"
          ? [
              {
                name: q + " (TSDB)",
                country: "Turquía",
                logo: "https://r2.thesportsdb.com/images/media/team/badge/abc.png",
                source: "TheSportsDB",
              },
            ]
          : tipo === "liga"
            ? [
                {
                  name: "UEFA Champions League",
                  country: "",
                  logo: "https://crests.football-data.org/CL.png",
                  source: "football-data.org",
                },
              ]
            : [],
    });
  }
  if (url.pathname === "/api/logo") {
    res.writeHead(200, { "content-type": "image/png" });
    return fs.createReadStream(path.join(ROOT, "pruebas/escudo-prueba.png")).pipe(res);
  }
  if (url.pathname === "/api/avisos") {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          publicKey:
            "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
        }),
      );
    }
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      posts.push(JSON.parse(b));
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }
  if (url.pathname === "/api/datos-partido") {
    seen.push("datos:" + url.searchParams.get("home") + "|" + url.searchParams.get("date"));
    seen.push("datosq:" + url.search);
    const nij = url.searchParams.get("home") === "Nijmegen";
    if (nij && !url.searchParams.get("matchId") && !url.searchParams.get("ah"))
      return sendJson({
        encontrado: false,
        motivo:
          "Encontré un partido parecido en football-data.org (NEC vs PSV) pero los nombres no coinciden.",
        partidosDelDia: [
          {
            id: 501,
            local: "NEC",
            visitante: "PSV",
            competicion: "Eredivisie",
            hora: "2026-11-21T15:30:00Z",
            cerca: true,
          },
          {
            id: 502,
            local: "Chelsea",
            visitante: "Leeds United",
            competicion: "Premier League",
            hora: "2026-11-21T17:30:00Z",
            cerca: false,
          },
        ],
      });
    return sendJson({
      encontrado: true,
      alReves: false,
      fuente: "football-data.org",
      partido: {
        competicion: "UEFA Champions League",
        local: { nombre: nij ? "NEC" : "Fenerbahçe", oficial: nij ? "NEC" : "Fenerbahçe" },
        visitante: { nombre: nij ? "PSV" : "Liverpool", oficial: nij ? "PSV" : "Liverpool" },
      },
      modelo: {
        lambdaLocal: 1.2,
        marcador: [1, 1],
        lambdaVisitante: 1.6,
        p1: 0.3,
        px: 0.25,
        p2: 0.45,
        over05: 0.94,
        over15: 0.77,
        over25: 0.53,
        over35: 0.31,
        btts: 0.52,
        base: "tabla de local y visitante",
      },
      tabla: {
        local: { posicion: 12, puntos: 7, golesFavor: 6, golesContra: 7 },
        visitante: { posicion: 3, puntos: 10, golesFavor: 9, golesContra: 3 },
        localEnCasa: { ganados: 1, empates: 1, perdidos: 0 },
        visitanteFuera: { ganados: 2, empates: 0, perdidos: 0 },
        equipos: 36,
      },
      forma: {
        local: [{ fecha: "2026-11-01", rival: "Galatasaray", enCasa: true, marcador: "2-1", resultado: "G" }],
        visitante: [
          { fecha: "2026-11-02", rival: "Arsenal", enCasa: false, marcador: "0-0", resultado: "E" },
        ],
      },
      h2h: {
        partidos: 2,
        goles: 5,
        local: { ganados: 0, empates: 1, perdidos: 1 },
        visitante: { ganados: 1, empates: 1, perdidos: 0 },
        ultimos: [{ fecha: "2020-02-01", local: "Liverpool", visitante: "Fenerbahçe", marcador: "2-1" }],
      },
    });
  }
  // Analista (función de borde simulada): responde en streaming, una línea JSON por evento.
  if (url.pathname === "/api/analista") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (req.headers["x-kal-clave"] !== "secreto")
        return sendJson({ error: "El código de acceso del Analista no es correcto.", codigo: "codigo" }, 401);
      const body = JSON.parse(b);
      analystPosts.push(body);
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const send = (o) => res.write(JSON.stringify(o) + "\n");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      send({ t: "estado", v: "Pensando…" });
      if (body.modo === "imagen") {
        await wait(80);
        send({
          t: "texto",
          v: globalThis.__noCupon
            ? "NO_ES_CUPON"
            : fs.readFileSync(path.join(ROOT, "pruebas/previa-1.txt"), "utf8"),
        });
        send({ t: "fin", uso: { entrada: 900, salida: 120, busquedas: 0 } });
        res.end();
        return;
      }
      if (body.modo === "cupon") {
        await wait(150);
        send({ t: "estado", v: "Buscando: Fenerbahce Liverpool lesiones" });
      }
      const slow = /LENTO/.test(body.datos?.cupon || "");
      const chunks = [
        "## 📌 En resumen\n",
        "Te va **bien** en goles de *1.5*.\n",
        "- Punto uno\n- Punto <img src=x onerror=alert(1)>\n",
        "## 🎯 Recomendaciones\n1. Combinadas cortas\n",
      ];
      if (body.modo === "cupon")
        chunks.push(
          'Orientativo.\n<kal-json>{"veredicto":"arriesgado","probabilidad":0.4,"selecciones":[{"partido":"Fenerbahce vs Liverpool","mercado":"Total de goles","seleccion":"Más de 1.5","p":0.9,"confianza":"Alta"},',
          '{"partido":"Fenerbahce vs Liverpool","mercado":"Ambos equipos marcan","seleccion":"Sí","p":0.55,"confianza":"Baja"}],"eslabonDebil":[{"partido":"Fenerbahce vs Liverpool","mercado":"Ambos equipos marcan","seleccion":"Sí"}]}</kal-json>',
        );
      for (const c of chunks) {
        await wait(slow ? 400 : 60);
        if (res.destroyed) return;
        send({ t: "texto", v: c });
      }
      if (/FALLA/.test(body.datos?.cupon || ""))
        send({ t: "error", v: "Se alcanzó el límite de uso de la API." });
      else send({ t: "fin", uso: { entrada: 100, salida: 50, busquedas: 1 } });
      res.end();
    });
    return;
  }
  let f = path.join(SITE, decodeURIComponent(url.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(SITE) || !fs.existsSync(f)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
async function open(db, { ctxOpts = {}, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...ctxOpts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("dialog", (d) =>
    d.accept(d.type() === "prompt" ? (page.promptAnswer ?? d.defaultValue()) : undefined),
  );
  await ctx.addInitScript(
    ([d, extra]) => {
      if (!localStorage.getItem("kal_coupon_organizer_v2") && d)
        localStorage.setItem("kal_coupon_organizer_v2", JSON.stringify(d));
      localStorage.setItem("kal_last_backup", String(Date.now()));
      if (extra !== "news" && !localStorage.getItem("kal_version_vista"))
        localStorage.setItem("kal_version_vista", "27");
      if (extra === "push") {
        let perm = "default";
        Object.defineProperty(Notification, "permission", { get: () => perm });
        Notification.requestPermission = async () => (perm = "granted");
        PushManager.prototype.getSubscription = async () => window.__sub || null;
        PushManager.prototype.subscribe = async () =>
          (window.__sub = {
            endpoint: "https://push.example/abc",
            toJSON() {
              return { endpoint: this.endpoint, keys: { p256dh: "k", auth: "a" } };
            },
            unsubscribe: async () => true,
          });
      }
    },
    [db, init],
  );
  await page.goto(BASE);
  await page.waitForTimeout(600);
  return { ctx, page };
}
// Cambia de pantalla y espera un instante a que el navegador dibuje (las listas usan content-visibility).
const view = async (page, v) => {
  await page.evaluate((v) => document.querySelector(`button[data-view="${v}"]`).click(), v);
  await page.waitForTimeout(120);
};
// Toca un botón aunque la barra fija o el menú inferior lo tapen en la pantalla del teléfono.
const tap = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
const texts = async (page, sel) => {
  await page.waitForTimeout(100);
  return page.$$eval(sel, (x) => x.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
};

// ---------- 1. Lector y detección de jugadores (funciones puras) ----------
section("1. Lector de cupones y detección de jugadores");
{
  const { ctx, page } = await open(null);
  const r = await page.evaluate(() => {
    const p = parseCoupon(
      "Italia, Serie A\nInter Milan\nvs.\nFiorentina\n25/10/2026 • 05:30\n1x2: 1 • pago anticipado\nCuotas: 1.36\nEspaña, La Liga\nBarcelona\nvs.\nReal Madrid\n25/10/2026 • 08:00\nMás de 2.5 goles\nCuotas: 1.85\nVALOR APOSTADO L 120.00\nCUOTAS: 2.20\nGANANCIA TOTAL: L 264.00",
    );
    const f = { home: "Como", away: "Napoli" };
    const pb = (market, pick) => parsePlayerBet({ market, pick }, f);
    return {
      n: p.fixtures.length,
      teams: p.fixtures.map((x) => x.home + "-" + x.away),
      stake: p.meta.stake,
      payout: p.meta.payout,
      paz: pb("Remates a puerta", "COM Nico Paz Más de 0.5"),
      nested: pb("Remates del jugador (incl. suplente)", "(Nico Paz (COM)) Más de 1.5"),
      hoj: pb("Primer goleador", "Rasmus Hojlund (NAP)"),
      team1: pb("Total de remates - Como", "Más de 4.5"),
      team2: pb("Marcador correcto", "Como 2-1"),
      club: playerClubForCode("NAP", f),
    };
  });
  check(
    "lee 2 partidos con sus equipos",
    r.n === 2 && r.teams.join() === "Inter Milan-Fiorentina,Barcelona-Real Madrid",
    r.teams.join(),
  );
  check("lee importe y ganancia total", r.stake === 120 && r.payout === 264, `${r.stake} / ${r.payout}`);
  check(
    "jugador sin el código del club en el nombre",
    r.paz?.name === "Nico Paz" && r.paz?.code === "COM",
    JSON.stringify(r.paz),
  );
  check("jugador en formato anidado", r.nested?.name === "Nico Paz", JSON.stringify(r.nested));
  check("club correcto por código (NAP → Napoli)", r.club.club === "Napoli" && r.hoj?.code === "NAP");
  check("mercados de equipo no son jugadores", r.team1 === null && r.team2 === null);
  const v = await page.evaluate(() => {
    const p = parseCoupon(
      "Europa, UEFA Europa League\nReal Sociedad\nvs.\nOlympique Lyonnais\n05/11/2026 • 11:45\nAmbos equipos marcan: Sí\n1.47\nEuropa, UEFA Liga Campeones\nBayer Leverkusen\nvs.\nMarseille\n05/11/2026 • 14:00\n1x2: 1 • pago anticipado\n@1.75\nTotal de goles: Más de 2.5 @1.80",
    );
    const [a, b] = p.fixtures;
    return {
      comp: a.competition,
      country: a.country,
      odd1: a.markets[0].odd,
      comp2: b.competition,
      pick: b.markets[0].pick,
      early: b.markets[0].earlyPayout,
      odd2: b.markets[0].odd,
      odd3: b.markets[1]?.odd,
    };
  });
  check(
    "lee la línea 'Europa, competición'",
    v.comp === "UEFA Europa League" && v.country === "Europa" && v.comp2 === "UEFA Liga Campeones",
    JSON.stringify(v),
  );
  check(
    "lee la cuota sola en su línea (1.47 y @1.75)",
    v.odd1 === "1.47" && v.odd2 === "1.75",
    JSON.stringify(v),
  );
  check("lee la cuota al final de la selección (@1.80)", v.odd3 === "1.80", JSON.stringify(v));
  check("separa '• pago anticipado' de la selección", v.pick === "1" && v.early === true, JSON.stringify(v));
  const mig = await page.evaluate(() => {
    db = {
      coupons: [
        {
          id: "x",
          name: "x",
          created: "2026-11-01",
          fixtures: [
            {
              home: "A",
              away: "B",
              dateISO: "2026-11-05",
              time: "10:00",
              markets: [{ market: "1x2", pick: "1 • pago anticipado", settlement: "pending" }],
            },
          ],
        },
      ],
      houses: [],
      transactions: [],
      resultHistory: [],
      actionHistory: [],
    };
    const changed = migrateEarlyPayout();
    return (
      changed +
      ":" +
      db.coupons[0].fixtures[0].markets[0].pick +
      ":" +
      db.coupons[0].fixtures[0].markets[0].earlyPayout
    );
  });
  check("limpia cupones ya guardados con 'pago anticipado'", mig === "true:1:true", mig);
  // Cupón real (Europa League + Conference League, 16 partidos) pegado tal cual desde la casa de apuestas.
  const realRaw = fs.readFileSync(path.join(ROOT, "pruebas/cupon-real-1.txt"), "utf8");
  const real = await page.evaluate((raw) => {
    const p = parseCoupon(raw);
    return {
      n: p.fixtures.length,
      sinMercado: p.fixtures.filter((f) => !f.markets.length).map((f) => f.home),
      sinCuota: p.fixtures.filter((f) => f.markets.some((m) => !m.odd)).map((f) => f.home),
      sinCompeticion: p.fixtures
        .filter((f) => !/europa league|conference league/i.test(f.competition))
        .map((f) => f.home),
      anderlecht: p.fixtures.find((f) => /anderlecht/i.test(f.home))?.markets[0],
      celtic: p.fixtures.find((f) => /celtic/i.test(f.home))?.markets[0],
      early: p.fixtures.filter((f) => f.markets[0]?.earlyPayout).length,
      meta: p.meta,
    };
  }, realRaw);
  check(
    "cupón real: 16 partidos, todos con mercado",
    real.n === 16 && !real.sinMercado.length,
    JSON.stringify(real.sinMercado),
  );
  check("cupón real: todas las cuotas leídas", !real.sinCuota.length, JSON.stringify(real.sinCuota));
  check(
    "cupón real: competición en todos (Europa / Conference League)",
    !real.sinCompeticion.length,
    JSON.stringify(real.sinCompeticion),
  );
  check(
    "cupón real: 'Apuesta sin empate' es un mercado, no el importe",
    real.anderlecht?.market === "Apuesta sin empate" && real.anderlecht?.odd === "1.45",
    JSON.stringify(real.anderlecht),
  );
  check(
    "cupón real: hándicap con su línea '2 (0:2)'",
    real.celtic?.market === "Hándicap 1x2" && real.celtic?.pick === "2 (0:2)",
    JSON.stringify(real.celtic),
  );
  check("cupón real: 8 selecciones con pago anticipado", real.early === 8, String(real.early));
  check(
    "cupón real: importe, cuota total, bono y ganancia",
    real.meta.stake === 10 &&
      real.meta.odds === 37.48 &&
      real.meta.bonus === 21.88 &&
      real.meta.payout === 396.7,
    JSON.stringify(real.meta),
  );
  // Cupón real 2: BetBuilder, jugador dentro del BetBuilder y copas nacionales.
  const real2 = await page.evaluate(
    (raw) => {
      const p = parseCoupon(raw);
      const roma = p.fixtures[0],
        torino = p.fixtures[1],
        mg = p.fixtures[3];
      const player = torino.markets.find((m) => /Douvikas/.test(m.market));
      return {
        n: p.fixtures.length,
        romaMarkets: roma.markets
          .map((m) => m.market + "=" + m.pick + "@" + m.builderOdd + (m.earlyPayout ? "⚡" : ""))
          .join(" | "),
        torinoN: torino.markets.length,
        player: parsePlayerBet(player, torino),
        playerLine: parseLine(player, torino),
        homeGoals: parseLine(mg.markets[1], mg)?.goal,
        themes: p.fixtures.map((f) => competitionTheme(f).id).join(","),
        meta: p.meta,
      };
    },
    fs.readFileSync(path.join(ROOT, "pruebas/cupon-real-2.txt"), "utf8"),
  );
  check(
    "cupón real 2: BetBuilder separado en selecciones con su cuota",
    real2.n === 10 &&
      real2.romaMarkets === "1x2=1@1.40 | Total Tiros De Esquina=Más de 5.5@1.40⚡" &&
      real2.torinoN === 3,
    real2.romaMarkets,
  );
  check(
    "cupón real 2: jugador dentro del BetBuilder con '( COM)'",
    real2.player?.name === "Anastasios Douvikas" &&
      real2.player?.code === "COM" &&
      real2.playerLine?.incl === true &&
      real2.playerLine?.goal === 1,
    JSON.stringify(real2.player),
  );
  check("cupón real 2: '1 total de goles: Más de 0.5' tiene barra (meta 1)", real2.homeGoals === 1);
  check(
    "cupón real 2: temas de Serie A, Copa de Alemania, EFL Cup y Copa del Rey",
    real2.themes ===
      "serie-a,serie-a,dfb-pokal,dfb-pokal,dfb-pokal,league-cup,copa-del-rey,copa-del-rey,copa-del-rey,pais",
    real2.themes,
  );
  check(
    "cupón real 2: importe 15 y cuota 7.45 (ganancia vacía sin error)",
    real2.meta.stake === 15 && real2.meta.odds === 7.45 && real2.meta.payout === null,
    JSON.stringify(real2.meta),
  );
  // Tres cupones reales de Doradobet (ligas, Europa/Conference League y Champions, con jugadores).
  const dorado = await page.evaluate(
    (raws) =>
      raws.map((raw) => {
        const p = parseCoupon(raw);
        return {
          n: p.fixtures.length,
          sel: p.fixtures.reduce((s, f) => s + f.markets.length, 0),
          meta: p.meta,
          faltan: p.fixtures
            .flatMap((f) => [
              !f.markets.length && f.home + " sin mercado",
              !f.competition && f.home + " sin competición",
              ...f.markets.filter((m) => !(m.odd || m.builderOdd)).map((m) => f.home + " sin cuota"),
            ])
            .filter(Boolean),
          jugadores: p.fixtures.flatMap((f) =>
            f.markets
              .map((m) => {
                const b = parsePlayerBet(m, f);
                return b ? b.name + "=" + playerClubForCode(b.code, f).club : null;
              })
              .filter(Boolean),
          ),
        };
      }),
    [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/doradobet-${n}.txt`), "utf8")),
  );
  check(
    "Doradobet: 42 partidos y 75 selecciones sin datos faltantes",
    dorado.map((d) => d.n).join() === "23,11,8" &&
      dorado.map((d) => d.sel).join() === "45,16,14" &&
      dorado.every((d) => !d.faltan.length),
    JSON.stringify(dorado.map((d) => [d.n, d.sel, d.faltan])),
  );
  check(
    "Doradobet: importes y cuotas totales",
    dorado.map((d) => d.meta.stake + "@" + d.meta.odds).join() === "4.4@184.28,50@11.94,50@5.77",
    dorado.map((d) => d.meta.stake + "@" + d.meta.odds).join(),
  );
  const jug = dorado.flatMap((d) => d.jugadores).join(" | ");
  check(
    "Doradobet: 8 jugadores con su club (BET, SCP, BEN, MNU, GAL, BRU, BAY, COM)",
    jug ===
      "Nicolo Tresoldi=Club Brugge KV | Abdessamad Ezzalzouli=Real Betis | Harry Kane=Bayern Munich | Luis Suárez=Sporting Lisboa | Gianluca Prestianni=SL Benfica | Victor Osimhen=Galatasaray SK | Anastasios Douvikas=Como | Bryan Mbeumo=Manchester United",
    jug,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 2. Regla del cupón perdido, mercados, agenda y archivo ----------
section("2. Regla del cupón perdido, Mercados, Agenda y Mis cupones");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "saved");
  check(
    "Mis cupones muestra solo pendientes",
    (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() ===
      "Combinada A,Combinada B",
  );
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  check("Agenda muestra 3 partidos vivos", (await page.$$("#agendaList .agenda-match")).length === 3);
  // perder un mercado de la Combinada A desde la ficha
  await page.evaluate(() =>
    [...document.querySelectorAll("#agendaList .agenda-match")]
      .find((e) => e.innerText.includes("Fenerbahce"))
      .click(),
  );
  await page.waitForTimeout(150);
  await page.evaluate(() =>
    [...document.querySelectorAll(".match-tab-content > .mk-card")]
      .find((e) => e.innerText.includes("Ambos"))
      .querySelector(".mk-btn.lost")
      .click(),
  );
  await page.waitForTimeout(150);
  check(
    "la ficha no deja pendientes del cupón perdido",
    (await page.$$(".match-tab-content > .mk-card")).length === 0,
  );
  check(
    "resumen 'Ya marcados' indica cupón perdido",
    /cupón perdido/.test(await page.$eval(".marked-summary", (e) => e.innerText)),
  );
  await page.click(".match-close");
  await page.click('[data-agenda-range="all"]');
  const ag = await texts(page, "#agendaList .agenda-match .agenda-teams");
  check(
    "Agenda quita el partido del cupón perdido",
    !ag.some((t) => t.includes("Fenerbahce")) && ag.some((t) => t.includes("AEK")),
    ag.join(" / "),
  );
  await view(page, "markets");
  const mk = await page.$$eval("[data-market-card]:not(.hidden)", (x) => x.map((e) => e.dataset.team));
  check(
    "Mercados (Pendiente) quita el partido perdido y mantiene AEK (sigue vivo en B)",
    !mk.some((t) => t.includes("Fenerbahce")) && mk.some((t) => t.includes("AEK")),
    mk.join(" / "),
  );
  await view(page, "saved");
  check(
    "el cupón A pasa a Perdidos",
    (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() === "Combinada B",
  );
  await page.click('[data-coupon-filter="lost"]');
  check(
    "pestaña Perdidos contiene A",
    (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() === "Combinada A",
  );
  // deshacer
  await view(page, "markets");
  await page.click('[data-fold="history"] .fold-head');
  await page.click("#undoResultBtn");
  await page.waitForTimeout(100);
  await view(page, "saved");
  await page.click('[data-coupon-filter="pending"]');
  check(
    "deshacer devuelve A a pendientes",
    (await texts(page, "#couponList .saved-coupon > .couponhead strong")).length === 2,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 3. Eliminar cupón y balance ----------
section("3. Eliminar cupón, balance y deshacer");
{
  const { ctx, page } = await open(baseDb());
  const bal = async () => {
    await view(page, "houses");
    return page.$eval("#houseList .listitem", (e) => e.innerText.replace(/\s+/g, " "));
  };
  check("balance inicial con la apuesta de B", /-70\.00/.test(await bal()));
  await view(page, "saved");
  await page.click('[data-remove="B"]');
  await page.waitForTimeout(100);
  check("eliminar B quita su apuesta del balance", /Movimientos netos L 0\.00/.test(await bal()));
  await view(page, "saved");
  await page.click("#undoCouponActionBtn");
  await page.waitForTimeout(100);
  check("deshacer la recupera", /-70\.00/.test(await bal()));
  await ctx.close();
}

// ---------- 4. Guardado rápido ----------
section("4. Guardar cupones más rápido");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "new");
  const today = isoDay(Date.now()).split("-").reverse().join("/");
  await page.fill(
    "#raw",
    `Europa, UEFA Liga Campeones\nPSV\nvs.\nAjax\n${today} • 23:59\nTotal de goles: Más de 2.5\nCuotas: 1.80\nVALOR APOSTADO L 50.00`,
  );
  await page.click("#readBtn");
  await page.waitForTimeout(150);
  check(
    "detecta la casa por el formato o el historial",
    (await page.$eval("#couponHouse", (e) => e.value)) === "h1",
    await page.$eval("#houseHint", (e) => e.textContent),
  );
  check(
    "explica por qué eligió la casa",
    /Hondubet/.test(await page.$eval("#houseHint", (e) => e.textContent)),
  );
  check(
    "ofrece importes habituales",
    (await texts(page, "#stakeChips .chip")).length >= 2,
    (await texts(page, "#stakeChips .chip")).join(),
  );
  check("barra fija de guardar visible", await page.isVisible("#saveBar"));
  await page.click('#stakeChips .chip >> text="L 70.00"');
  await page.waitForTimeout(50);
  check("tocar un importe lo aplica", (await page.$eval("#stake", (e) => e.value)) === "70");
  check(
    "la barra resume selecciones, importe y casa",
    /1 selección[\s\S]*L 70\.00[\s\S]*Hondubet/.test(await page.$eval("#saveBar", (e) => e.innerText)),
    await page.$eval("#saveBar", (e) => e.innerText),
  );
  await page.click("[data-save-bar]");
  await page.waitForTimeout(200);
  check(
    "guarda desde la barra y va a Mis cupones",
    (await page.$eval("#viewTitle", (e) => e.textContent)) === "Mis cupones",
  );
  check("barra oculta tras guardar", !(await page.isVisible("#saveBar")));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 5. Buscador global ----------
section("5. Buscador global");
{
  const { ctx, page } = await open(baseDb());
  await page.click("#searchBtn");
  await page.fill("#globalSearch", "aek");
  await page.waitForTimeout(300);
  check(
    "encuentra el equipo AEK con su partido",
    /AEK/.test(await page.$eval("#searchResults", (e) => e.innerText)),
  );
  await page.fill("#globalSearch", "nico paz");
  await page.waitForTimeout(300);
  const res = await page.$eval("#searchResults", (e) => e.innerText);
  check(
    "encuentra al jugador Nico Paz con su club",
    /Nico Paz/.test(res) && /Como/.test(res),
    res.slice(0, 120),
  );
  await page.fill("#globalSearch", "ganado");
  await page.waitForTimeout(300);
  await page.click("[data-search-coupon]");
  await page.waitForTimeout(400);
  check(
    "al tocar un cupón archivado abre su pestaña",
    (await page.$eval("#couponFilter .chip.active", (e) => e.innerText)).startsWith("Ganados"),
  );
  check("buscador cerrado", !(await page.isVisible("#searchSheet")));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 6. Avisos, presupuesto y rachas ----------
section("6. Avisos de partidos, presupuesto y rachas");
{
  const db = baseDb();
  // "Ganado viejo" (hace 9 días) entraría en el mes actual a partir del día 10: se pasa al mes anterior para que el gasto del mes sea siempre 120.
  db.coupons.find((c) => c.id === "C").created = new Date(
    new Date().getFullYear(),
    new Date().getMonth() - 1,
    15,
  ).toISOString();
  for (let i = 0; i < 3; i++)
    db.coupons.push({
      id: "L" + i,
      name: "Perdido " + i,
      created: new Date(Date.now() - (5 - i) * 86400e3).toISOString(),
      stake: 0,
      odds: 2,
      payout: 20,
      fixtures: [
        {
          id: "x" + i,
          home: "X" + i,
          away: "Y" + i,
          dateISO: isoDay(Date.now() - (5 - i) * 86400e3),
          time: "10:00",
          markets: [{ market: "1x2", pick: "1", odd: "2", settlement: "lost" }],
        },
      ],
    });
  const { ctx, page } = await open(db, { init: "push" });
  check(
    "aviso dentro de la app antes del partido",
    /Fenerbahce vs Liverpool<\/b> empieza en \d+ min/.test(
      await page.$eval("#liveAlert", (e) => e.innerHTML),
    ),
  );
  check(
    "aviso de 3 cupones perdidos seguidos",
    (await texts(page, ".home-notice b")).some((t) => /3 cupones perdidos seguidos/.test(t)),
  );
  page.promptAnswer = "130";
  await page.click("[data-budget-edit]");
  await page.waitForTimeout(100);
  check(
    "presupuesto cerca del límite (120 de 130)",
    /Cerca del límite/.test(await page.$eval("#budgetCard", (e) => e.innerText)),
  );
  await view(page, "settings");
  await page.click("[data-alert-on]");
  await page.waitForTimeout(600);
  const last = posts.at(-1);
  check(
    "envía al servidor los partidos vivos",
    last?.accion === "guardar" && last.matches.length === 3,
    JSON.stringify(last?.matches?.map((m) => m.title)),
  );
  check(
    "la notificación lista los mercados pendientes",
    last?.matches?.some((m) => /Nico Paz: Más de 0\.5/.test(m.body)),
  );
  await page.click("[data-alert-off]");
  await page.waitForTimeout(300);
  check("desactivar avisa al servidor", posts.at(-1)?.accion === "borrar");
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 7. App instalable y sin conexión ----------
section("7. App instalable y sin conexión");
{
  const { ctx, page } = await open(baseDb());
  const m = await page.evaluate(async () =>
    (await fetch(document.querySelector("link[rel=manifest]").href)).json(),
  );
  check("manifest de app instalable", m.display === "standalone" && m.icons.length >= 3);
  check(
    "service worker activo",
    await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active),
  );
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(600);
  check("abre sin conexión con los cupones", (await page.$eval("#sCoupons", (e) => e.textContent)) === "3");
  await ctx.close();
}

// ---------- 9. Barra de progreso de mercados ----------
section("9. Barra de progreso de mercados");
{
  const now = Date.now(),
    day = isoDay(now),
    time = new Date(now + 30 * 60e3).toTimeString().slice(0, 5);
  const db = {
    coupons: [
      {
        id: "P",
        name: "Progreso",
        created: new Date(now).toISOString(),
        houseId: "",
        type: "parlay",
        stake: 10,
        odds: 5,
        payout: 50,
        fixtures: [
          {
            id: "f",
            home: "Real Madrid",
            away: "Juventus",
            competition: "UEFA Liga Campeones",
            dateISO: day,
            time,
            markets: [
              { market: "Total de goles", pick: "Más de 2.5", odd: "1.8", settlement: "pending" },
              { market: "Total Tiros De Esquina", pick: "Menos de 2.5", odd: "2.1", settlement: "pending" },
              {
                market: "Remates a Puerta (Kylian Mbappe (RMD)) - Incl. suplente",
                pick: "Más de 1.5",
                odd: "1.9",
                settlement: "pending",
              },
              { market: "Total de tarjetas", pick: "Más de 4.5", odd: "1.7", settlement: "pending" },
              { market: "1x2", pick: "1", odd: "1.5", settlement: "pending" },
            ],
          },
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
  };
  const { ctx, page } = await open(db);
  const u = await page.evaluate(() => {
    const L = (market, pick) => {
      const r = parseLine({ market, pick }, { home: "Real Madrid", away: "Juventus" });
      return r ? r.dir + ":" + r.goal + ":" + r.cat + (r.incl ? ":suplente" : "") : null;
    };
    return [
      L("Total de goles", "Más de 2.5"),
      L("Total Tiros De Esquina", "Menos de 9.5"),
      L("Remates a Puerta (Kylian Mbappe (RMD)) - Incl. suplente", "Más de 1.5"),
      L("Remates (Kylian Mbappe (RMD)) - Incl. suplente", "Más de 1.5"),
      L("Tarjetas", "+3.5"),
      L("Jugador remates a puerta", "Mbappe 2+"),
      L("1x2", "1"),
      L("Ambos equipos marcan", "Sí"),
    ];
  });
  check(
    "entiende las líneas (goles, córners, remates, tarjetas, 2+)",
    u.map(String).join("|") ===
      "over:3:goles|under:10:córners|over:2:a puerta:suplente|over:2:remates:suplente|over:4:tarjetas|over:2:a puerta|null|null",
    u.map(String).join("|"),
  );
  await page.evaluate(() => document.querySelector("#todayList .agenda-match").click());
  await page.waitForTimeout(150);
  const card = (txt) => `.mk-card:has-text("${txt}")`;
  check("muestra barra solo en mercados de línea", (await page.$$(".match-tab-content .pg")).length === 4);
  check(
    "cabecera con el tema de la competición (Champions → estrellas)",
    (await page.$eval(".match-stadium", (e) => e.dataset.pattern)) === "stars",
  );
  const themes = await page.evaluate(() =>
    [
      ["UEFA Liga Campeones", "Europa"],
      ["UEFA Europa League", ""],
      ["UEFA Conference League", ""],
      ["Supercopa de la UEFA", ""],
      ["Premier League", "Inglaterra"],
      ["Championship", "Inglaterra"],
      ["FA Cup", "Inglaterra"],
      ["Carabao Cup", "Inglaterra"],
      ["LaLiga", "España"],
      ["LaLiga Hypermotion", "España"],
      ["Copa del Rey", "España"],
      ["Supercopa de España", "España"],
      ["Serie A", "Italia"],
      ["Coppa Italia", "Italia"],
      ["Bundesliga", "Alemania"],
      ["DFB Pokal", "Alemania"],
      ["Bundesliga", "Austria"],
      ["Ligue 1", "Francia"],
      ["Eredivisie", "Países Bajos"],
      ["Liga Portugal", "Portugal"],
      ["Premiership", "Escocia"],
      ["Super Lig", "Turquía"],
      ["Serie A", "Brasil"],
      ["Superliga", "Dinamarca"],
      ["Liga Nacional", "Honduras"],
      ["UEFA Nations League", ""],
      ["Eliminatorias UEFA Mundial", ""],
      ["Eliminatorias CONMEBOL", ""],
      ["Amistosos Internacionales", ""],
      ["Copa Mundial de la FIFA", ""],
      ["Eurocopa", ""],
      ["Copa América", ""],
      ["CONCACAF Liga de Naciones", ""],
      ["Copa Oro", ""],
    ]
      .map(([competition, country]) => competitionTheme({ competition, country }).id)
      .join(","),
  );
  check(
    "temas de ligas, copas, competiciones europeas y selecciones",
    themes ===
      "champions,europa-league,conference,uefa-super-cup,premier-league,english-football-league,fa-cup,league-cup,laliga,laliga-2,copa-del-rey,supercopa-espana,serie-a,coppa-italia,bundesliga,dfb-pokal,pais,ligue-1,eredivisie,primeira-liga,scottish-premiership,super-lig,pais,pais,liga-nacional,nations-league,qualifiers,qualifiers,friendlies,world-cup,euro,copa-america,concacaf-nations,gold-cup",
    themes,
  );
  const flags = await page.evaluate(() =>
    [
      "España",
      "Inglaterra",
      "Países Bajos",
      "Estados Unidos",
      "Honduras",
      "Costa de Marfil",
      "Brasil Sub 20",
      "Real Madrid",
    ]
      .map(nationFlag)
      .join(" "),
  );
  check(
    "banderas de selecciones (y ninguna para clubes)",
    flags.split(" ").filter(Boolean).length === 7 && !flags.trim().endsWith("🇪🇸 "),
    flags,
  );
  const stBtn = (target, step = 1) =>
    `.live-board button[data-st-target="${target}"][data-st-step="${step}"]`;
  for (let i = 0; i < 3; i++) {
    await tap(page, stBtn("goals:home"));
    await page.waitForTimeout(80);
  }
  check(
    "Más de 2.5 goles: con 3 en el marcador se marca ganado solo",
    (await page.evaluate(() => db.coupons[0].fixtures[0].markets[0].settlement)) === "won",
  );
  check(
    "avisa con un mensaje de línea superada",
    /superada/.test(await page.$eval("#toast", (e) => e.textContent)),
    await page.$eval("#toast", (e) => e.textContent),
  );
  await tap(page, stBtn("goals:home", -1));
  await page.waitForTimeout(100);
  check(
    "si restas, vuelve a pendiente",
    (await page.evaluate(() => db.coupons[0].fixtures[0].markets[0].settlement)) === "pending",
  );
  for (let i = 0; i < 3; i++) {
    await tap(page, stBtn("corners:away"));
    await page.waitForTimeout(80);
  }
  check(
    "Menos de 2.5 córners: con 3 se marca perdido solo",
    (await page.evaluate(() => db.coupons[0].fixtures[0].markets[1].settlement)) === "lost",
  );
  await page.evaluate(() => {
    db.coupons[0].fixtures[0].markets[1].settlement = "pending";
    db.stats = {};
    db.progress = {};
    save();
    renderAll();
  });
  await page.waitForTimeout(100);
  const pk = await page.evaluate(() => crestNorm("Kylian Mbappe"));
  check(
    "jugador con solo líneas a puerta: el marcador muestra solo 'Remates a puerta'",
    !/tiros totales/.test(await page.$eval(".live-board", (e) => e.innerText)) &&
      /Remates a puerta/.test(await page.$eval(".live-board", (e) => e.innerText)),
  );
  await tap(page, stBtn(`player:${pk}:main:onTarget`));
  await page.waitForTimeout(80);
  page.promptAnswer = "Endrick";
  await tap(page, ".live-board [data-st-sub-add]");
  await page.waitForTimeout(400);
  check(
    "agrega al suplente con su nombre",
    (await page.$eval(".live-board", (e) => e.innerText)).includes("Endrick"),
  );
  await tap(page, stBtn(`player:${pk}:sub:onTarget`));
  await page.waitForTimeout(150);
  check(
    "Mbappé 1 + suplente 1 = 2: remates a puerta (incl. suplente) ganado",
    (await page.evaluate(() => db.coupons[0].fixtures[0].markets[2].settlement)) === "won",
  );
  await page.click(".match-close");
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  check(
    "la Agenda muestra el progreso en miniatura",
    /Goles 0\/3/.test(await page.$eval("#agendaList", (e) => e.innerText)),
    await page.$eval("#agendaList", (e) => e.innerText.replace(/\s+/g, " ")),
  );
  await page.evaluate(() => document.querySelector("#agendaList .agenda-match").click());
  await page.waitForTimeout(150);
  await tap(page, stBtn("cards:home"));
  await page.waitForTimeout(80);
  await page.click("[data-pg-finish]");
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => db.coupons[0].fixtures[0].markets.map((m) => m.settlement).join(","));
  check(
    "Terminó el partido: Más de sin llegar → perdido, Menos de → ganado",
    st === "lost,won,won,lost,pending",
    st,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 10. Escudos y fotos: TheSportsDB e imagen del teléfono ----------
section("10. Escudos y fotos: TheSportsDB e imagen del teléfono");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "logos");
  // Las secciones vienen retraídas y cada fila esconde sus opciones en «⋯»: aquí se abren para probar los botones.
  await page.evaluate(() =>
    document.querySelectorAll("#view-logos .fold").forEach((f) => toggleFold(f, true)),
  );
  const abrirFila = (sel) =>
    page.evaluate((x) => document.querySelector(x).closest(".lg-row").classList.add("is-open"), sel);
  const idx = (name) => page.evaluate((n) => logoManagerTeams.findIndex((t) => t.name === n), name);
  const fb = await idx("Fenerbahce");
  await page.click(`[data-logo-lookup="${fb}"]`);
  await page.waitForTimeout(300);
  const opts = await texts(page, `#logo-options-${fb} .img-opt`);
  check(
    "busca a la vez en varias fuentes (API-Football, TheSportsDB…)",
    opts.length === 2 && opts.some((o) => /API-Football/.test(o)) && opts.some((o) => /TheSportsDB/.test(o)),
    opts.join(" / "),
  );
  await page.evaluate(
    (fb) =>
      [...document.querySelectorAll(`#logo-options-${fb} .img-opt`)]
        .find((b) => /TheSportsDB/.test(b.innerText))
        .click(),
    fb,
  );
  await page.waitForTimeout(200);
  check(
    "tocar un resultado de TheSportsDB guarda el escudo",
    (await page.evaluate(() => readCrestDirectory()["team:fenerbahce"]?.url || "")).includes(
      "thesportsdb.com",
    ),
  );
  check(
    "el escudo se aplica a sus partidos",
    (await page.evaluate(() => db.coupons[0].fixtures[0].homeCrest)).includes("thesportsdb.com"),
  );
  const lv = await idx("Liverpool");
  await page.click(`[data-logo-lookup="${lv}"]`);
  await page.waitForTimeout(300);
  await page.fill(`#logo-q-${lv}`, "Liverpool FC");
  await page.click(`[data-logo-requery="${lv}"]`);
  await page.waitForTimeout(300);
  check(
    "se puede buscar con otro nombre",
    seen.includes("buscar:equipo:Liverpool FC") && seen.includes("escudos:Liverpool FC"),
    seen.slice(-4).join(" | "),
  );
  const aek = await idx("AEK");
  await abrirFila(`[data-logo-upload="${aek}"]`);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(`[data-logo-upload="${aek}"]`),
  ]);
  await chooser.setFiles(path.join(ROOT, "pruebas/escudo-prueba.png"));
  await page.waitForTimeout(500);
  const aekUrl = await page.evaluate(() => readCrestDirectory()["team:aek"]?.url || "");
  const aekImg = await page.evaluate((u) => resolveImage(u), aekUrl);
  check(
    "subir imagen del teléfono guarda el escudo (recortado y pequeño)",
    /^data:image\/(webp|png);base64,/.test(aekImg) && aekImg.length < 60000,
    aekImg.slice(0, 30) + " · " + aekImg.length + " caracteres",
  );
  const stored = await page.evaluate(() => ({
    ref: readCrestDirectory()["team:aek"].url,
    enPartido: db.coupons.flatMap((c) => c.fixtures).find((f) => f.home === "AEK").homeCrest,
    copias: (JSON.stringify(db).match(/data:image/g) || []).length,
  }));
  check(
    "la imagen se guarda una sola vez; los partidos llevan solo la referencia",
    stored.ref.startsWith("kalimg:") && stored.enPartido === stored.ref && stored.copias === 0,
    JSON.stringify(stored).slice(0, 120),
  );
  check(
    "el escudo subido se ve en su tarjeta",
    await page.evaluate(() =>
      [...document.querySelectorAll("#logoArchive .logo-card")].some(
        (c) =>
          c.innerText.includes("AEK") &&
          /^(data:image|blob:)/.test(c.querySelector("img.team-crest:not([hidden])")?.src || ""),
      ),
    ),
  );
  // Fotos de jugadores: búsqueda combinada y subida
  await page.evaluate(() => {
    const el = document.querySelector('[data-fold="logoPlayers"]');
    if (!el.classList.contains("is-open")) el.querySelector(".fold-head").click();
  });
  // «＋ Buscar» abre la ventana de búsqueda (sin cuadros de texto) y se toca al jugador correcto.
  await page.click("#playerPhotoArchive [data-pp-open]");
  await page.waitForSelector(".pp-result", { timeout: 8000 });
  await page.click(".pp-result");
  await page.waitForTimeout(400);
  const nico = () =>
    page.evaluate(
      () =>
        Object.values(readCrestDirectory()).find((x) => x?.kind === "player" && /Nico Paz/.test(x.name))
          ?.photo || "",
    );
  check(
    "la foto del jugador se encuentra en TheSportsDB si API-Football no la tiene",
    (await nico()).includes("thesportsdb.com"),
    await nico(),
  );
  // Con la foto ya guardada, el jugador sale de «Faltan»: se muestran todos para subirle otra desde el teléfono.
  await page.evaluate(() => {
    setLgFilter("logoPlayers", "all");
    updateFolds();
    document.querySelectorAll("#playerPhotoArchive .lg-row").forEach((c) => c.classList.add("is-open"));
  });
  const [ch2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("#playerPhotoArchive [data-player-upload]"),
  ]);
  await ch2.setFiles(path.join(ROOT, "pruebas/escudo-prueba.png"));
  await page.waitForTimeout(500);
  check(
    "subir la foto de un jugador desde el teléfono",
    (await nico()).startsWith("kalimg:") &&
      (await page.evaluate(
        () => !!document.querySelector('#playerPhotoArchive img.player-logo-thumb[src^="data:image"]'),
      )),
    (await nico()).slice(0, 30),
  );
  // Una imagen guardada entera por la versión anterior pasa a referencia al abrir la app.
  const mig = await page.evaluate(() => {
    const data = resolveImage(readCrestDirectory()["team:aek"].url);
    db.coupons[0].fixtures[0].awayCrest = data;
    const changed = migrateInlineImages();
    return changed + ":" + db.coupons[0].fixtures[0].awayCrest.slice(0, 7);
  });
  check("migra imágenes guardadas enteras a referencias", mig === "true:kalimg:", mig);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 11. Rendimiento con muchos datos ----------
section("11. Rendimiento con muchos datos (150 cupones, ~2.100 partidos)");
{
  const { ctx, page } = await open(null);
  const raws = [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/doradobet-${n}.txt`), "utf8"));
  const r = await page.evaluate((raws) => {
    const now = Date.now();
    for (let i = 0; i < 150; i++) {
      const x = parseCoupon(raws[i % 3]),
        d = new Date(now - ((i - 5) * 86400000) / 2);
      x.fixtures.forEach((f, j) => {
        f.dateISO = d.toISOString().slice(0, 10);
        f.home += i > 10 ? " " + (i % 7) : "";
        f.markets.forEach((m, k) => {
          m.settlement = i < 6 ? "pending" : (i * 7 + j * 3 + k) % 10 < 7 ? "won" : "lost";
        });
      });
      db.coupons.push({
        id: "c" + i,
        name: "Cupón " + i,
        created: d.toISOString(),
        type: "parlay",
        stake: 10,
        odds: 2,
        payout: 20,
        fixtures: x.fixtures,
      });
    }
    const time = (fn) => {
      const a = performance.now();
      fn();
      return performance.now() - a;
    };
    const out = { all: time(renderAll) };
    for (const v of ["calendar", "markets", "saved", "stats", "logos"]) out[v] = time(() => go(v));
    out.nodes = document.querySelectorAll("*").length;
    out.marketCards = document.querySelectorAll("[data-market-card]").length;
    return out;
  }, raws);
  const slowest = Math.max(r.all, r.calendar, r.markets, r.saved, r.stats, r.logos);
  check(
    "ninguna pantalla tarda más de 400 ms en dibujarse",
    slowest < 400,
    JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]))),
  );
  check("la página se mantiene ligera (menos de 25.000 elementos)", r.nodes < 25000, String(r.nodes));
  check(
    "Mercados dibuja por páginas (40 partidos) con botón 'Mostrar más'",
    r.marketCards === 40 && (await page.$("[data-market-more]")) !== null,
    String(r.marketCards),
  );
  await view(page, "markets");
  await page.click("[data-market-more]");
  await page.waitForTimeout(100);
  check("'Mostrar más' agrega otros 40", (await page.$$("[data-market-card]")).length === 80);
  await page.selectOption("#marketStatusFilter", "");
  await page.waitForTimeout(150);
  check("el filtro 'Todos' también va por páginas", (await page.$$("[data-market-card]")).length === 40);
  await view(page, "saved");
  await page.click('[data-coupon-filter="all"]');
  await page.waitForTimeout(100);
  check(
    "Mis cupones → Todos muestra 30 y ofrece 'Mostrar más'",
    (await page.$$("#couponList .saved-coupon")).length === 30 &&
      (await page.$("[data-coupon-more]")) !== null,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 12. Animaciones de resultado y pantalla de entrada ----------
section("12. Animaciones y pantalla de entrada");
{
  const { ctx, page } = await open(baseDb());
  await page.waitForTimeout(700);
  check("la pantalla de entrada se quita sola al cargar", (await page.$("#splash")) === null);
  const key = (ci, fi, mi) =>
    page.evaluate(
      ([ci, fi, mi]) => marketKey(db.coupons[ci].fixtures[fi], db.coupons[ci].fixtures[fi].markets[mi]),
      [ci, fi, mi],
    );
  // Combinada B: AEK (1 mercado) + Como (2 mercados). Ganar uno → confeti corto, sin tarjeta.
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 0, 0));
  await page.waitForTimeout(300);
  check(
    "mercado ganado: confeti, sin tarjeta de cupón",
    (await page.$("canvas.confetti")) !== null && (await page.$(".result-card")) === null,
  );
  // Ganar el resto → cupón B ganado: tarjeta con la ganancia (210 − 70 = 140).
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 1, 0));
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 1, 1));
  await page.waitForTimeout(350);
  const card = await page.$eval(
    ".result-card-wrap",
    (e) => e.className + " | " + e.innerText.replace(/\s+/g, " "),
  );
  check(
    "cupón ganado: tarjeta con el nombre y la ganancia",
    /is-won/.test(card) &&
      /¡Cupón ganado!/.test(card) &&
      /Combinada B/.test(card) &&
      /\+L 140\.00/.test(card),
    card,
  );
  await page.click(".result-card-wrap");
  await page.waitForTimeout(350);
  check("la tarjeta se cierra al tocarla", (await page.$(".result-card-wrap")) === null);
  // Perder un mercado de la Combinada A → tarjeta de cupón perdido con lo apostado.
  await page.evaluate((k) => setMarketStatus(k, "lost"), await key(0, 0, 0));
  await page.waitForTimeout(350);
  const lostCard = await page.$eval(
    ".result-card-wrap",
    (e) => e.className + " | " + e.innerText.replace(/\s+/g, " "),
  );
  check(
    "cupón perdido: tarjeta con lo apostado",
    /is-lost/.test(lostCard) && /Cupón perdido/.test(lostCard) && /−L 50\.00/.test(lostCard),
    lostCard,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
  // Con "reducir movimiento" no hay confeti, pero la tarjeta sí aparece.
  const calm = await open(baseDb(), { ctxOpts: { reducedMotion: "reduce" } });
  await calm.page.evaluate(() => {
    const f = db.coupons[1].fixtures;
    f.forEach((x) => x.markets.forEach((m) => setMarketStatus(marketKey(x, m), "won")));
  });
  await calm.page.waitForTimeout(350);
  check(
    "con 'reducir movimiento': tarjeta sí, confeti no",
    (await calm.page.$(".result-card")) !== null && (await calm.page.$("canvas.confetti")) === null,
  );
  await calm.ctx.close();
}

// ---------- 13. Limpieza de espacio ----------
section("13. Limpieza automática de espacio");
{
  const { ctx, page } = await open(null);
  const raws = [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/doradobet-${n}.txt`), "utf8"));
  const r = await page.evaluate((raws) => {
    for (let i = 0; i < 100; i++) {
      const x = parseCoupon(raws[i % 3]);
      x.fixtures.forEach((f) =>
        f.markets.forEach((m) => {
          m.settlement = i % 10 === 9 ? "pending" : "won";
        }),
      );
      db.coupons.push({
        id: "c" + i,
        name: "Cupón " + i,
        created: new Date(Date.now() - i * 3600e3).toISOString(),
        stake: 10,
        odds: 2,
        payout: 20,
        raw: raws[i % 3],
        fixtures: x.fixtures,
      });
    }
    db.actionHistory = Array.from({ length: 60 }, (_, i) => ({ type: "create", couponId: "c" + i, at: "x" }));
    db.progress = { "clave-que-ya-no-existe": { count: 3 } };
    localStorage.setItem(
      "kal_images_v1",
      JSON.stringify({ huerfana: "data:image/png;base64," + "A".repeat(20000) }),
    );
    save();
    const before = storageUsage(),
      markets = db.coupons.reduce((s, c) => s + c.fixtures.reduce((n, f) => n + f.markets.length, 0), 0);
    const freed = compactData(true);
    const saved = JSON.parse(localStorage.getItem("kal_coupon_organizer_v2"));
    return {
      freed,
      before: before.bytes,
      after: storageUsage().bytes,
      coupons: saved.coupons.length,
      marketsSame:
        saved.coupons.reduce((s, c) => s + c.fixtures.reduce((n, f) => n + f.markets.length, 0), 0) ===
        markets,
      rawNewest: saved.coupons.slice(0, 40).every((c) => c.raw),
      rawOldSettled: saved.coupons
        .slice(40)
        .filter((c) => c.raw)
        .map((c) => c.id),
      pendingOldKeepRaw: saved.coupons
        .slice(40)
        .filter((c) => c.fixtures[0].markets[0].settlement === "pending")
        .every((c) => c.raw),
      history: saved.actionHistory.length,
      progress: Object.keys(saved.progress).length,
      images: Object.keys(JSON.parse(localStorage.getItem("kal_images_v1"))).length,
    };
  }, raws);
  check(
    "libera espacio sin borrar cupones ni mercados",
    r.freed > 100000 && r.coupons === 100 && r.marketsSame,
    `liberó ${Math.round(r.freed / 1024)} KB de ${Math.round(r.before / 1024)} KB`,
  );
  check(
    "conserva el texto original en los 40 más recientes y en los pendientes",
    r.rawNewest && r.pendingOldKeepRaw && r.rawOldSettled.every((id) => Number(id.slice(1)) % 10 === 9),
    JSON.stringify(r.rawOldSettled.slice(0, 5)),
  );
  check(
    "recorta el historial de deshacer y quita progreso e imágenes sin uso",
    r.history === 20 && r.progress === 0 && r.images === 0,
    `${r.history}/${r.progress}/${r.images}`,
  );
  await view(page, "settings");
  check(
    "Ajustes muestra el espacio usado y el botón de liberar",
    /de ~5 MB · 100 cupones/.test(await page.$eval("#storageBox", (e) => e.innerText)) &&
      (await page.$("[data-compact]")) !== null,
    await page.$eval("#storageBox", (e) => e.innerText.replace(/\s+/g, " ").slice(0, 80)),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("14. Analista con IA (pantalla y datos que se envían)");
{
  const { ctx, page } = await open(baseDb());
  // Historial con suficientes resultados: 6 cupones liquidados (3 simples ganados, 3 combinadas perdidas)
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) {
      const won = i < 3;
      db.coupons.push({
        id: "H" + i,
        name: "Hist " + i,
        created: new Date(Date.now() - (i + 2) * 86400e3).toISOString(),
        houseId: "h2",
        stake: 10,
        odds: won ? 1.8 : 5,
        payout: won ? 18 : 50,
        fixtures: (won ? [0] : [0, 1, 2]).map((k) => ({
          id: "h" + i + k,
          home: "Equipo " + i + k,
          away: "Rival " + k,
          competition: "LaLiga",
          date: "01/11/2026",
          time: "12:00",
          markets: [
            {
              market: "Total de goles",
              pick: "Más de 1.5",
              odd: "1.80",
              settlement: won ? "won" : k === 2 ? "lost" : "won",
            },
          ],
        })),
      });
    }
    save();
    renderAll();
  });
  await view(page, "analyst");
  let info = await page.evaluate(() => ({
    title: $("viewTitle").textContent,
    open: document.querySelector(".analyst-config").classList.contains("is-open"),
    disabled: document.querySelector('[data-analyst-run="historial"]').disabled,
    inMore: !!document.querySelector('#moreMenu [data-view="analyst"]'),
  }));
  check(
    "pantalla Analista en el menú Más, con la configuración abierta si falta el código",
    info.title === "Analista" && info.open && info.inMore && !info.disabled,
    JSON.stringify(info),
  );
  await page.click('[data-analyst-run="historial"]');
  await page.waitForTimeout(150);
  check(
    "sin código avisa en vez de llamar al servidor",
    /código de acceso/i.test(await page.$eval("#analystOut-historial", (e) => e.innerText)) &&
      analystPosts.length === 0,
  );
  await page.fill("#analystKey", "malo");
  await page.click("[data-analyst-key]");
  await page.click('[data-analyst-run="historial"]');
  await page.waitForTimeout(250);
  check(
    "código incorrecto muestra el error del servidor",
    /no es correcto/.test(await page.$eval("#analystOut-historial", (e) => e.innerText)),
  );
  await page.click(".analyst-config [data-fold-toggle]");
  await page.fill("#analystKey", "secreto");
  await page.click("[data-analyst-key]");
  await page.click('[data-analyst-run="historial"]');
  await page.waitForTimeout(140);
  const live = await page.$eval("#analystOut-historial", (e) => ({
    busy: !!e.querySelector(".analyst-live"),
    btn: document.querySelector('[data-analyst-run="historial"]').disabled,
  }));
  await page.waitForTimeout(600);
  const e2 = (o) => o.i === "1.5";
  const out = await page.$eval("#analystOut-historial", (e) => ({
    i: e.querySelector("i")?.textContent,
    h: [...e.querySelectorAll("h4")].map((x) => x.textContent),
    li: e.querySelectorAll("li").length,
    b: e.querySelector("b")?.textContent,
    img: e.querySelectorAll("img").length,
    text: e.innerText,
  }));
  check("muestra el análisis mientras llega y bloquea el botón", live.busy && live.btn, JSON.stringify(live));
  check(
    "da formato (títulos, listas, negritas) sin ejecutar HTML",
    out.h.length === 2 &&
      out.li === 3 &&
      out.b === "bien" &&
      e2(out) &&
      out.img === 0 &&
      out.text.includes("<img"),
    JSON.stringify(out).slice(0, 200),
  );
  const hp = analystPosts.at(-1);
  const h = hp?.datos?.historial;
  check(
    "envía un resumen: por mercado, cuota, tamaño de combinada y últimos cupones",
    hp?.modo === "historial" &&
      h.porMercado.some((r) => r.tipo === "Goles (más / menos)" && r.ganados === 9 && r.perdidos === 3) &&
      h.porTamano.some((r) => r.selecciones === "3" && r.cupones === 3 && r.ganados === 0) &&
      h.ultimosCupones.length >= 6 &&
      /^\d{4}-\d{2}-\d{2}$/.test(hp.datos.hoy),
    JSON.stringify(h?.porTamano),
  );
  check(
    "no envía datos de la cuenta ni el código",
    !/cloud|password|supabase|secreto|kal_/i.test(JSON.stringify(hp)),
  );
  await view(page, "home");
  await view(page, "analyst");
  check(
    "el último análisis se guarda y se ve al volver",
    /Último análisis/.test(await page.$eval("#analystOut-historial", (e) => e.innerText)),
  );
  // Revisar un cupón pendiente
  await page.selectOption("#analystCouponPick", "A");
  check(
    "elegir un cupón pendiente carga su texto",
    /Fenerbahce/.test(await page.$eval("#analystCouponText", (e) => e.value)),
  );
  await page.click('[data-analyst-run="cupon"]');
  await page.waitForTimeout(100);
  const st = await page.$eval("#analystOut-cupon [data-status]", (e) => e.textContent).catch(() => "");
  await page.waitForTimeout(800);
  const cp = analystPosts.at(-1);
  check(
    "revisión de cupón: envía el cupón, el historial por mercado y el presupuesto",
    cp.modo === "cupon" &&
      /Fenerbahce/.test(cp.datos.cupon) &&
      Array.isArray(cp.datos.historial) &&
      cp.datos.historial.length > 0,
    JSON.stringify(cp).slice(0, 160),
  );
  check("muestra lo que está haciendo (búsquedas)", /Pensando|Buscando|Conectando/.test(st), st);
  check(
    "revisión de cupón terminada",
    /Recomendaciones/.test(await page.$eval("#analystOut-cupon", (e) => e.innerText)),
  );
  // Error a mitad del análisis y cancelar
  await page.fill("#analystCouponText", "Cupón que FALLA en el servidor");
  await page.click('[data-analyst-run="cupon"]');
  await page.waitForTimeout(700);
  check(
    "un error a mitad conserva lo recibido y explica el problema",
    await page.$eval(
      "#analystOut-cupon",
      (e) => /límite de uso/.test(e.innerText) && e.querySelectorAll("li").length > 0,
    ),
  );
  await page.fill("#analystCouponText", "Cupón LENTO de prueba para cancelar");
  await page.click('[data-analyst-run="cupon"]');
  await page.waitForTimeout(250);
  await page.click("[data-analyst-cancel]");
  await page.waitForTimeout(200);
  check(
    "se puede cancelar un análisis",
    /cancelado/.test(await page.$eval("#analystOut-cupon", (e) => e.innerText)) &&
      !(await page.$eval('[data-analyst-run="cupon"]', (b) => b.disabled)),
  );
  // Desde Nuevo cupón
  await view(page, "new");
  check(
    "el botón del Analista no aparece sin cupón leído",
    !(await page.isVisible("[data-analyst-preview]")),
  );
  await page.fill(
    "#raw",
    "España, La Liga\nBarcelona\nvs.\nReal Madrid\n25/10/2026 • 08:00\nMás de 2.5 goles\nCuotas: 1.85\nVALOR APOSTADO L 120.00",
  );
  await page.click("#readBtn");
  await page.waitForTimeout(200);
  const nPosts = analystPosts.length;
  await tap(page, "[data-analyst-preview]");
  await page.waitForTimeout(900);
  const inl = await page.evaluate(() => ({ view: activeView, out: $("previewAnalystOut").innerText }));
  const ip = analystPosts.at(-1);
  check(
    "'Analizar este cupón ahora' analiza ahí mismo, sin salir de Nuevo cupón",
    inl.view === "new" &&
      /Recomendaciones/.test(inl.out) &&
      analystPosts.length === nPosts + 1 &&
      ip.modo === "cupon" &&
      /Barcelona vs Real Madrid/.test(ip.datos.cupon) &&
      /Valor apostado: L 120/.test(ip.datos.cupon) &&
      ip.datos.riesgo?.selecciones === 1,
    JSON.stringify(inl).slice(0, 200),
  );
  await page.fill(
    "#raw",
    "España, La Liga\nBetis\nvs.\nSevilla\n26/10/2026 • 08:00\nMás de 1.5 goles\nCuotas: 1.30",
  );
  await tap(page, "#readBtn");
  await page.waitForTimeout(200);
  check(
    "al leer otro cupón se borra el análisis anterior",
    (await page.$eval("#previewAnalystOut", (e) => e.innerText.trim())) === "",
  );
  await page.evaluate(() => {
    analystSave({ clave: "" });
  });
  await tap(page, "[data-analyst-preview]");
  await page.waitForTimeout(150);
  check(
    "sin código del Analista explica cómo configurarlo",
    /primero escribe tu código/.test(await page.$eval("#previewAnalystOut", (e) => e.innerText)) &&
      !!(await page.$("[data-analyst-open-config]")),
  );
  await page.evaluate(() => {
    analystSave({ clave: "secreto" });
  });
  const comp = await page.evaluate(() => ({
    names: [
      "UEFA Liga Campeones",
      "UEFA Champions League",
      "Liga de Campeones de la UEFA",
      "UEFA Liga Europa",
      "UEFA Europa League",
      "UEFA Conference League",
      "AFC Champions League",
      "CONCACAF Liga de Campeones",
      "Championship",
      "LaLiga",
      "Liga de Naciones de la UEFA",
      "UEFA Nations League",
      "CONCACAF Liga de Naciones",
    ].map(canonicalCompetition),
    builder: (() => {
      db.coupons.push({
        id: "BB",
        name: "BB",
        created: new Date().toISOString(),
        stake: 10,
        odds: 3.25,
        payout: 32.5,
        fixtures: [
          {
            id: "bb1",
            home: "PSG",
            away: "Lyon",
            competition: "Ligue 1",
            date: "02/11/2026",
            time: "12:00",
            markets: [
              {
                market: "Remates Kang-in Lee",
                pick: "Más de 0.5",
                odd: "",
                builder: true,
                builderOdd: "3.25",
                settlement: "won",
              },
              {
                market: "Total de goles",
                pick: "Más de 1.5",
                odd: "",
                builder: true,
                builderOdd: "3.25",
                settlement: "won",
              },
            ],
          },
        ],
      });
      const p = analystMarketHistory(),
        row = p.byOdds.find((r) => r.name.startsWith("3.00"));
      const line = legLine(db.coupons.at(-1).fixtures[0], db.coupons.at(-1).fixtures[0].markets[0], true);
      db.coupons.pop();
      return { inflated: !!row && row.won >= 2, line };
    })(),
  }));
  check(
    "estadísticas: una sola Champions/Europa/Conference, sin tocar otras confederaciones ni la Championship",
    comp.names.join("|") ===
      "UEFA Champions League|UEFA Champions League|UEFA Champions League|UEFA Europa League|UEFA Europa League|UEFA Conference League|AFC Champions League|CONCACAF Liga de Campeones|Championship|LaLiga|UEFA Nations League|UEFA Nations League|CONCACAF Liga de Naciones",
    comp.names.join("|"),
  );
  check(
    "estadísticas: la cuota de un BetBuilder no se cuenta como cuota de cada selección",
    !comp.builder.inflated &&
      /cuota del paquete 3.25/.test(comp.builder.line) &&
      !/@ 3.25/.test(comp.builder.line),
    JSON.stringify(comp.builder),
  );
  const nube = await page.evaluate(() =>
    [
      "tutujwepbvlxfmizehkf.supabase.co",
      " https://tutujwepbvlxfmizehkf.supabase.co/rest/v1/ ",
      "tutujwepbvlxfmizehkf",
      "http://x.supabase.co",
      "no es url",
      "",
    ].map(normalizeCloudUrl),
  );
  check(
    "nube: acepta la dirección de Supabase sin https://, con rutas o solo el proyecto",
    nube.join("|") ===
      "https://tutujwepbvlxfmizehkf.supabase.co|https://tutujwepbvlxfmizehkf.supabase.co|https://tutujwepbvlxfmizehkf.supabase.co|https://x.supabase.co||",
    nube.join("|"),
  );
  check(
    "el código queda solo en este teléfono (no entra en los datos sincronizados)",
    await page.evaluate(
      () =>
        !JSON.stringify(db).includes("secreto") &&
        JSON.parse(localStorage.getItem("kal_analista_v1")).clave === "secreto",
    ),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("17. Control de apuestas: freno al guardar, banca y diario");
{
  const db0 = baseDb();
  // 3 perdidos seguidos para probar la pausa
  for (let i = 0; i < 3; i++)
    db0.coupons.push({
      id: "P" + i,
      name: "Perdido " + i,
      created: new Date(Date.now() - (5 - i) * 86400e3).toISOString(),
      updated: new Date(Date.now() - (5 - i) * 86400e3).toISOString(),
      stake: 10,
      odds: 2,
      payout: 20,
      fixtures: [
        {
          id: "p" + i,
          home: "X" + i,
          away: "Y" + i,
          date: "01/11/2026",
          time: "10:00",
          markets: [{ market: "1x2", pick: "1", odd: "2", settlement: "lost" }],
        },
      ],
    });
  const { ctx, page } = await open(db0);
  await view(page, "settings");
  await page.fill("#brAmount", "1000");
  await page.fill("#brUnit", "2");
  await page.fill("#brMax", "5");
  await page.fill("#brPause", "3");
  await tap(page, "[data-bankroll-save]");
  const bank = await page.evaluate(() => ({
    unit: unitStake(),
    cfg: bankrollCfg(),
    txt: $("bankrollBox").innerText,
  }));
  check(
    "banca: 1 unidad = 2 % de L 1,000 y se guarda en los datos (viaja con la nube)",
    bank.unit === 20 && bank.cfg.maxSel === 5 && /L 20.00/.test(bank.txt),
    JSON.stringify(bank),
  );
  await view(page, "new");
  const legs = [
    ["Fenerbahce", "Liverpool", "1x2: 2", "1.40"],
    ["Celtic", "Rangers", "Total de goles: Más de 1.5", "1.05"],
    ["Ajax", "PSV", "1x2: 1", "2.10"],
    ["Porto", "Benfica", "Ambos equipos marcan: Sí", "1.70"],
    ["Roma", "Lazio", "1x2: X", "3.20"],
    ["Lyon", "Lille", "1x2: 1", "1.90"],
    ["Sevilla", "Betis", "1x2: 1", "2.00"],
  ];
  const raw =
    legs
      .map(([h, a, mk, o]) => `Europa, Liga\n${h}\nvs.\n${a}\n20/11/2026 • 14:00\n${mk}\nCuotas: ${o}`)
      .join("\n") + "\nVALOR APOSTADO L 50.00";
  await page.fill("#raw", raw);
  await tap(page, "#readBtn");
  await page.waitForTimeout(250);
  const risk = await page.$eval("#riskBox", (e) => ({
    cls: e.querySelector(".risk-card")?.className,
    text: e.innerText.replace(/\s+/g, " "),
  }));
  check(
    "freno: cupón de 7 selecciones marcado como riesgo alto, con su probabilidad",
    /is-high/.test(risk.cls) &&
      /7 selecciones/.test(risk.text) &&
      /tu límite es 5/.test(risk.text) &&
      /Probabilidad (según tu historial|estimada)/.test(risk.text),
    risk.text.slice(0, 200),
  );
  check(
    "lector: sin línea de CUOTAS total no toma la cuota del último partido como total",
    (await page.$eval("#totalOdds", (e) => e.value)) === "" &&
      /Según la cuota/.test(risk.text) &&
      !/ 50 % Según/.test(risk.text),
    risk.text.slice(0, 160),
  );
  check(
    "freno: avisa del partido repetido en otros cupones y de la selección de relleno",
    /Fenerbahce vs Liverpool.*ya está en 1 cupón/.test(risk.text) && /relleno.*Celtic.*1.05/.test(risk.text),
    risk.text,
  );
  check(
    "freno: con 3 perdidos seguidos sugiere pausa y media unidad",
    /3 cupones perdidos seguidos/.test(risk.text) && /Monto sugerido: L 10.00/.test(risk.text),
    risk.text.match(/Monto sugerido[^)]*\)/)?.[0],
  );
  await tap(page, '[data-confidence="5"]');
  await page.waitForTimeout(80);
  const sug5 = await page.$eval(
    "#riskBox",
    (e) => e.innerText.match(/Monto sugerido[^:]*: (L [\d.,]+)/)?.[1],
  );
  await tap(page, "[data-use-stake]");
  check(
    "freno: confianza 5 = 2 unidades (a la mitad por la racha) y 'Usar' pone el importe",
    sug5 === "L 20.00" && (await page.$eval("#stake", (e) => e.value)) === "20",
    sug5,
  );
  await page.fill("#couponReason", "Local fuerte");
  await tap(page, "#saveBtn");
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const c = db.coupons[0];
    return { conf: c.confidence, reason: c.reason, pickerReset: !$("couponConfidence").value };
  });
  check(
    "diario: guarda la confianza y el motivo, y limpia el formulario",
    saved.conf === 5 && saved.reason === "Local fuerte" && saved.pickerReset,
    JSON.stringify(saved),
  );
  await page.evaluate(() => {
    db.coupons[0].fixtures.forEach((f) => f.markets.forEach((m) => (m.settlement = "won")));
    db.coupons[0].payout = 400;
    save();
  });
  await view(page, "stats");
  check(
    "estadísticas: sección 'Según tu confianza'",
    /Confianza 5 · Muy alta/.test(await page.$eval("#perfSection", (e) => e.innerText)),
  );
  const pay = await page.evaluate(() => analystHistoryPayload());
  check(
    "Analista: recibe confianza, motivo y la banca",
    pay.porConfianza?.[0]?.confianza === 5 &&
      pay.ultimosCupones.some((c) => c.motivo === "Local fuerte") &&
      pay.banca?.unidad === 20,
  );
  // Editar recupera la confianza
  await view(page, "saved");
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.dataset.detail = db.coupons[0].id;
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  await page.waitForTimeout(200);
  check(
    "editar un cupón recupera su confianza y motivo",
    (await page.$eval("#couponConfidence", (e) => e.value)) === "5" &&
      (await page.$eval("#couponReason", (e) => e.value)) === "Local fuerte",
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("18. Valor de la cuota: cierre (CLV), calculadora y comparador");
{
  const { ctx, page } = await open(baseDb());
  const vc = await page.evaluate(() =>
    valueCalc({
      odd: 2.1,
      ref: [1.95, 3.6, 4.2],
      houses: [
        { name: "Hondubet", odd: 2.05 },
        { name: "Doradobet", odd: 2.2 },
      ],
    }),
  );
  check(
    "calculadora: quita el margen y calcula probabilidad, cuota justa y valor esperado",
    Math.abs(vc.fairP - 0.4985) < 0.001 &&
      Math.abs(vc.fairOdd - 2.006) < 0.01 &&
      Math.abs(vc.margin - 0.0287) < 0.001 &&
      vc.use === 2.2 &&
      Math.abs(vc.ev - (0.4985 * 2.2 - 1)) < 0.002 &&
      vc.kellyQuarter > 0,
    JSON.stringify(vc),
  );
  await page.evaluate(() => {
    db.settings = { banca: { monto: 1000, unidadPct: 2, maxSel: 5, pausaTras: 3 } };
    save();
  });
  await view(page, "analyst");
  await page.fill("#vcOdd", "2.10");
  await page.fill("#vcRef", "1.95 3.60 4.20");
  await page.fill('[data-vc-house="h1"]', "2.05");
  await page.fill('[data-vc-house="h2"]', "2.20");
  const vt = await page.$eval("#vcResult", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "calculadora en pantalla: mejor casa, cuota justa y veredicto con monto prudente",
    /Mejor cuota: Doradobet 2.20/.test(vt) &&
      /Cuota justa: 2.01/.test(vt) &&
      /Tiene valor/.test(vt) &&
      /¼ de Kelly/.test(vt),
    vt,
  );
  await page.fill("#vcOdd", "1.80");
  await page.fill('[data-vc-house="h1"]', "");
  await page.fill('[data-vc-house="h2"]', "");
  check(
    "calculadora: una cuota por debajo de la justa no tiene valor",
    /Sin valor/.test(await page.$eval("#vcResult", (e) => e.innerText)),
  );
  // Cuota de cierre desde la ficha del partido
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("#agendaList .agenda-match")]
      .find((e) => e.innerText.includes("Fenerbahce"))
      .click(),
  );
  await page.waitForTimeout(200);
  page.promptAnswer = "1.30";
  await page.evaluate(() =>
    [...document.querySelectorAll(".match-tab-content > .mk-card")]
      .find((e) => e.innerText.includes("Total de goles"))
      .querySelector("[data-close-odd]")
      .click(),
  );
  await page.waitForTimeout(200);
  const chip = await page.evaluate(
    () =>
      [...document.querySelectorAll(".match-tab-content > .mk-card")]
        .find((e) => e.innerText.includes("Total de goles"))
        .querySelector(".clv-chip")?.innerText,
  );
  check(
    "cierre: se guarda y muestra el valor (1.50 contra cierre 1.30 = +15 %)",
    chip === "Cierre 1.30 · +15 %",
    chip,
  );
  const st = await page.evaluate(() => ({
    s: clvStats(),
    saved: JSON.parse(localStorage.getItem("kal_coupon_organizer_v2")).coupons[0].fixtures[0].markets[0]
      .closeOdd,
    pay: analystHistoryPayload().valorCierre,
  }));
  check(
    "cierre: cuenta en las estadísticas y llega al Analista",
    st.s.n === 1 && Math.abs(st.s.avg - 0.1538) < 0.001 && st.saved === 1.3 && st.pay.mercados === 1,
    JSON.stringify(st),
  );
  await page.evaluate(() => closeMatchDetails());
  await view(page, "stats");
  check(
    "estadísticas: sección de valor frente al cierre",
    /Valor medio frente al cierre/.test(await page.$eval("#perfSection", (e) => e.innerText)),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("19. Datos del partido: forma, tabla, enfrentamientos y modelo de goles");
{
  const D = await import(path.join(ROOT, "cloudflare/datos-partido.mjs"));
  const m = D.poissonModel(1.5, 1.5);
  check(
    "modelo Poisson: probabilidades coherentes (λ 1.5 + 1.5 → más de 2.5 = 57.7 %)",
    Math.abs(m.p1 - m.p2) < 0.001 &&
      Math.abs(m.p1 + m.px + m.p2 - 1) < 0.002 &&
      Math.abs(m.over25 - 0.577) < 0.002 &&
      m.over15 > m.over25 &&
      m.over25 > m.over35,
    JSON.stringify(m),
  );
  const T = (id, name, shortName, tla) => ({ id, name, shortName, tla });
  const fdMatches = [
    {
      id: 11,
      utcDate: "2026-11-22T20:00:00Z",
      status: "TIMED",
      competition: { id: 2002, code: "BL1", name: "Bundesliga" },
      homeTeam: T(5, "FC Bayern München", "Bayern", "FCB"),
      awayTeam: T(4, "Borussia Dortmund", "Dortmund", "BVB"),
      score: { fullTime: {} },
    },
    {
      id: 12,
      utcDate: "2026-11-22T18:00:00Z",
      status: "TIMED",
      competition: { id: 2014, code: "PD", name: "Primera Division" },
      homeTeam: T(78, "Club Atlético de Madrid", "Atleti", "ATM"),
      awayTeam: T(81, "FC Barcelona", "Barça", "FCB"),
      score: { fullTime: {} },
    },
  ];
  check(
    "nombres: español, alias y equipos al revés",
    D.nameScore("España", T(1, "Spain", "Spain", "ESP")) === 1 &&
      D.findMatch(fdMatches, "Bayern Múnich", "Dortmund")?.m.id === 11 &&
      D.findMatch(fdMatches, "Barcelona", "Atlético de Madrid")?.swapped === true &&
      !D.findMatch(fdMatches, "Inter", "Napoli"),
  );
  check(
    "modelo: marcador más probable (1.5 vs 1.5 → 1-1; 2.9 vs 0.92 → 2-0)",
    JSON.stringify(m.marcador) === "[1,1]" && JSON.stringify(D.poissonModel(2.9, 0.92).marcador) === "[2,0]",
    JSON.stringify([m.marcador, D.poissonModel(2.9, 0.92).marcador]),
  );
  const fin = (id, h, a, gh, ga, d) => ({
    id,
    utcDate: d + "T15:00:00Z",
    status: "FINISHED",
    competition: { name: "Bundesliga" },
    homeTeam: T(h, "H" + h, "H" + h),
    awayTeam: T(a, "A" + a, "A" + a),
    score: { fullTime: { home: gh, away: ga } },
  });
  const row = (id, pos, pj, gf, ga) => ({
    position: pos,
    team: { id },
    playedGames: pj,
    won: 3,
    draw: 1,
    lost: 1,
    points: 10,
    goalsFor: gf,
    goalsAgainst: ga,
    form: "W,W,D,L,W",
  });
  const standings = {
    standings: ["TOTAL", "HOME", "AWAY"].map((type) => ({
      type,
      table: [row(5, 1, 6, 15, 4), row(4, 2, 6, 12, 6), row(9, 3, 6, 6, 8), row(10, 4, 6, 4, 12)],
    })),
  };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url.replace("https://api.football-data.org/v4", ""));
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (/\/matches\?dateFrom=2026-11-21&dateTo=2026-11-23/.test(url)) return ok({ matches: fdMatches });
    if (/competitions\/BL1\/standings/.test(url)) return ok(standings);
    if (/matches\/11\/head2head/.test(url))
      return ok({
        aggregates: {
          numberOfMatches: 4,
          totalGoals: 13,
          homeTeam: { wins: 3, draws: 0, losses: 1 },
          awayTeam: { wins: 1, draws: 0, losses: 3 },
        },
        matches: [fin(1, 5, 4, 4, 2, "2026-03-01")],
      });
    if (/teams\/5\/matches/.test(url))
      return ok({ matches: [fin(2, 5, 9, 3, 0, "2026-11-15"), fin(3, 10, 5, 1, 1, "2026-11-08")] });
    if (/teams\/4\/matches/.test(url)) return ok({ matches: [fin(4, 4, 10, 2, 1, "2026-11-15")] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mem = new Map(),
    store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v) };
  const req = (q) => new Request("https://x/api/datos-partido?" + new URLSearchParams(q));
  const r1 = await (
    await D.datosPartido(req({ home: "Bayern Múnich", away: "Dortmund", date: "2026-11-22" }), {
      token: "t",
      store,
      fetchImpl: fakeFetch,
    })
  ).json();
  check(
    "datos: encuentra el partido y arma tabla, forma, enfrentamientos y modelo",
    r1.encontrado &&
      r1.tabla.local.posicion === 1 &&
      r1.tabla.local.forma === "GGEPG" &&
      r1.forma.local[0].resultado === "G" &&
      r1.forma.local[0].marcador === "3-0" &&
      r1.h2h.partidos === 4 &&
      r1.modelo.p1 > r1.modelo.p2 &&
      r1.modelo.base === "tabla de local y visitante",
    JSON.stringify(r1).slice(0, 300),
  );
  const onlyTotal = [
    {
      type: "TOTAL",
      table: [row(5, 1, 12, 40, 10), row(4, 2, 12, 20, 20), row(9, 3, 12, 14, 18), row(10, 4, 12, 10, 36)],
    },
  ];
  const xg = D.expectedGoals(onlyTotal, 5, 10),
    xr = D.expectedGoals(onlyTotal, 10, 5);
  check(
    "modelo: con solo la tabla general (plan gratis) usa ataque, defensa y ventaja de local",
    xg && xg.lh > xg.la && xg.lh > xr.lh && /tabla general/.test(xg.base),
    JSON.stringify(xg),
  );
  const n1 = calls.length;
  await D.datosPartido(req({ home: "Bayern Múnich", away: "Dortmund", date: "2026-11-22" }), {
    token: "t",
    store,
    fetchImpl: fakeFetch,
  });
  check(
    "datos: la segunda consulta sale de la caché (cuida el límite de 10 por minuto)",
    n1 === 5 && calls.length === 5,
    n1 + "/" + calls.length,
  );
  const noKey = await D.datosPartido(req({ home: "A", away: "B", date: "2026-11-22" }), {
    token: "",
    store,
    fetchImpl: fakeFetch,
  });
  const nf = await (
    await D.datosPartido(req({ home: "Inter", away: "Napoli", date: "2026-11-22" }), {
      token: "t",
      store,
      fetchImpl: fakeFetch,
    })
  ).json();
  const limited = await D.datosPartido(req({ home: "X", away: "Y", date: "2026-12-01" }), {
    token: "t",
    store: null,
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  check(
    "datos: sin clave, partido no cubierto y límite de consultas con mensajes claros",
    noKey.status === 503 &&
      nf.encontrado === false &&
      /Nations League/.test(nf.motivo) &&
      limited.status === 429 &&
      /10 consultas/.test((await limited.json()).error),
  );

  const { ctx, page } = await open(baseDb());
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("#agendaList .agenda-match")]
      .find((e) => e.innerText.includes("Fenerbahce"))
      .click(),
  );
  await page.waitForTimeout(150);
  await tap(page, '[data-match-tab="datos"]');
  await page.waitForTimeout(500);
  const panel = await page.$eval("#matchTabPanel", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "ficha → 📊 Resumen: modelo, tabla, forma y enfrentamientos",
    /Probabilidad 1X2/.test(panel) &&
      /Pronóstico del modelo/.test(panel) &&
      /Más de 2.5 goles 53 %/.test(panel) &&
      /12º/.test(panel) &&
      /Forma \(últimos 5\)/.test(panel) &&
      /Enfrentamientos directos/.test(panel),
    panel.slice(0, 300),
  );
  const rs = await page.evaluate(() => ({
    cajas: document.querySelectorAll("#matchTabPanel .rs-box").length,
    top: document.querySelectorAll("#matchTabPanel .rs-box.rs-top").length,
    xg: document.querySelectorAll("#matchTabPanel .rs-xg").length,
    chips: document.querySelectorAll("#matchTabPanel .rs-form-row .form-chip").length,
    mejores: /Mejores mercados/.test(document.getElementById("matchTabPanel").innerText),
  }));
  check(
    "ficha → 📊 Resumen: 3 recuadros 1X2 con el favorito resaltado, 2 barras de goles esperados, forma con chips y marcador probable",
    rs.cajas === 3 &&
      rs.top === 1 &&
      rs.xg === 2 &&
      rs.chips >= 1 &&
      rs.mejores &&
      /Marcador más probable 1 - 1/.test(panel),
    JSON.stringify(rs) + " " + panel.slice(0, 200),
  );
  check(
    "ficha → 📊 Resumen: compara tus mercados con el modelo (más de 1.5 a 1.50: 77 % → +16 % de valor)",
    /Total de goles · Más de 1.5 Modelo 77 % · cuota 1.50 \(67 %\) \+16 % valor/.test(panel) &&
      /Ambos equipos marcan · Sí Modelo 52 %/.test(panel),
    panel.match(/Tus mercados[^📊]*/)?.[0],
  );
  check(
    "ficha → 📊 Resumen: pide los datos con la fecha del partido",
    seen.some((x) => x.startsWith("datos:Fenerbahce|20")),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("20. Analista: mi semana, armar cupones y riesgo en la revisión");
{
  const A = await import(path.join(ROOT, "servidor/analista.mjs"));
  const pa = A.construirPeticion("armar", {
    partidos: "España vs Suiza\nAlemania vs Italia",
    banca: { unidad: 20, maxSelecciones: 4 },
  });
  const ps = A.construirPeticion("semana", { semana: { ultimos7dias: { cupones: 3 } } });
  const bad = await A.leerPeticion(
    new Request("https://x", {
      method: "POST",
      headers: { "x-kal-clave": "s" },
      body: JSON.stringify({ modo: "armar", datos: { partidos: "" } }),
    }),
    { ANTHROPIC_API_KEY: "k", ANALISTA_CLAVE: "s" },
  );
  check(
    "servidor: 'armar' busca en internet y recibe tu banca; 'semana' no busca; valida los datos",
    pa.tools[0].max_uses === 10 &&
      pa.output_config.effort === "high" &&
      /Ayúdame a armar cupones/.test(pa.messages[0].content) &&
      /"maxSelecciones":4/.test(pa.messages[0].content) &&
      /Un partido no se repite/.test(pa.system) &&
      !ps.tools &&
      /últimos 7 días/.test(ps.messages[0].content) &&
      bad.error.status === 400,
  );
  const db0 = baseDb();
  db0.settings = { banca: { monto: 1000, unidadPct: 2, maxSel: 4, pausaTras: 3 } };
  db0.coupons.push({
    id: "W1",
    name: "Semana 1",
    created: new Date(Date.now() - 2 * 86400e3).toISOString(),
    updated: new Date(Date.now() - 86400e3).toISOString(),
    stake: 50,
    odds: 3,
    payout: 150,
    fixtures: [
      {
        id: "w1",
        home: "Ajax",
        away: "PSV",
        date: "09/11/2026",
        time: "12:00",
        markets: [
          { market: "1x2", pick: "1", odd: "1.5", settlement: "won" },
          { market: "Ambos equipos marcan", pick: "Sí", odd: "2", settlement: "won" },
        ],
      },
    ],
  });
  db0.coupons.push({
    id: "W2",
    name: "Semana 2",
    created: new Date(Date.now() - 3 * 86400e3).toISOString(),
    updated: new Date(Date.now() - 2 * 86400e3).toISOString(),
    stake: 20,
    odds: 30,
    payout: 600,
    fixtures: ["a", "b", "c", "d", "e"].map((k, i) => ({
      id: "w2" + k,
      home: "Ajax",
      away: "PSV" + (i ? i : ""),
      date: "09/11/2026",
      time: "12:00",
      markets: [{ market: "1x2", pick: "1", odd: "1.8", settlement: i === 4 ? "lost" : "won" }],
    })),
  });
  const { ctx, page } = await open(db0);
  const week = await page.$eval("#weekCard", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "Inicio: tarjeta de los últimos 7 días con resultado y avisos de tus reglas",
    /Tus últimos 7 días/.test(week) &&
      /2 Cupones/.test(week) &&
      /1 \/ 1/.test(week) &&
      /\+L 80.00/.test(week) &&
      /por encima de tu límite/.test(week) &&
      /monto\(s\) de más de 2 unidades/.test(week),
    week,
  );
  await tap(page, "[data-week-analyst]");
  await page.waitForTimeout(200);
  check(
    "Inicio → 🤖 Analizar lleva a 'Mi semana'",
    (await page.evaluate(() => activeView)) === "analyst" && !!(await page.$("[data-analyst-run=semana]")),
  );
  await page.evaluate(() => {
    analystSave({ clave: "secreto" });
    renderAnalyst();
  });
  const before = analystPosts.length;
  await tap(page, '[data-analyst-run="semana"]');
  await page.waitForTimeout(700);
  const sp = analystPosts.at(-1);
  check(
    "Mi semana: envía los últimos 7 días y el historial general",
    analystPosts.length === before + 1 &&
      sp.modo === "semana" &&
      sp.datos.semana.ultimos7dias.cupones === 2 &&
      sp.datos.semana.general.porMercado.length > 0 &&
      /Recomendaciones/.test(await page.$eval("#analystOut-semana", (e) => e.innerText)),
  );
  await page.fill("#analystBuildText", "España vs Suiza\nAlemania vs Italia — me gusta más de 2.5");
  await tap(page, '[data-analyst-run="armar"]');
  await page.waitForTimeout(800);
  const ap = analystPosts.at(-1);
  check(
    "Armar cupones: envía tus partidos, tu límite, tu unidad y tu historial",
    ap.modo === "armar" &&
      /Alemania vs Italia/.test(ap.datos.partidos) &&
      ap.datos.banca.maxSelecciones === 4 &&
      ap.datos.banca.unidad === 20 &&
      Array.isArray(ap.datos.historial),
  );
  await page.selectOption("#analystCouponPick", "A");
  await tap(page, '[data-analyst-run="cupon"]');
  await page.waitForTimeout(800);
  const cp = analystPosts.at(-1);
  check(
    "Revisar cupón: envía el riesgo calculado (sin contar el mismo cupón como repetido)",
    cp.modo === "cupon" &&
      cp.datos.riesgo?.selecciones >= 1 &&
      cp.datos.riesgo.limiteSelecciones === 4 &&
      Array.isArray(cp.datos.riesgo.repetidosEnOtrosCupones) &&
      !cp.datos.riesgo.repetidosEnOtrosCupones.some((x) => x.cupones > 1) &&
      cp.datos.banca.unidad === 20,
    JSON.stringify(cp.datos.riesgo),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("21. Copias automáticas, espejo, novedades y rutas /api");
{
  const { ctx, page } = await open(baseDb(), { init: "news" });
  await page.waitForTimeout(1400);
  check(
    "novedades: se muestran una vez al llegar la versión nueva",
    (await page.$(".news-wrap")) !== null &&
      /Versión 18/.test(await page.$eval(".news-sheet", (e) => e.innerText)),
  );
  await tap(page, "[data-news-close]");
  await page.reload();
  await page.waitForTimeout(1500);
  check("novedades: no se repiten al volver a abrir", (await page.$(".news-wrap")) === null);
  const snaps = await page.evaluate(async () => (await snapshots()).map((s) => s.motivo));
  check("copias: copia semanal automática al abrir", snaps.includes("Copia semanal"), JSON.stringify(snaps));
  // Espejo: se borra el almacenamiento normal y al abrir se recupera
  await page.evaluate(async () => {
    db.coupons[0].name = "Cambiado";
    save();
    await new Promise((r) => setTimeout(r, 1500));
    localStorage.removeItem("kal_coupon_organizer_v2");
  });
  await page.reload();
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => ({
    n: db.coupons.length,
    name: db.coupons[0]?.name,
    ls: !!localStorage.getItem("kal_coupon_organizer_v2"),
  }));
  check(
    "espejo: si se pierde el almacenamiento normal, los datos se recuperan solos",
    rec.n === 3 && rec.name === "Cambiado" && rec.ls,
    JSON.stringify(rec),
  );
  // Restaurar una copia
  await view(page, "settings");
  await page.evaluate(async () => {
    db.coupons = [];
    save();
    renderAll();
    await renderSnapshotBox();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector("[data-snap-restore]").click());
  await page.waitForTimeout(600);
  const after = await page.evaluate(async () => ({
    n: db.coupons.length,
    motivos: (await snapshots()).map((s) => s.motivo),
  }));
  check(
    "copias: restaurar desde Ajustes recupera los cupones (y guarda antes una copia de lo actual)",
    after.n === 3 && after.motivos[0] === "Antes de restaurar",
    JSON.stringify(after),
  );
  check(
    "copias: el respaldo descargable usa el mismo formato",
    await page.evaluate(() => {
      const p = backupPayload();
      return p.version === 3 && Array.isArray(p.db.coupons) && typeof p.logos === "object";
    }),
  );
  check(
    "la app llama a las funciones en /api/ (ya no en /.netlify/)",
    seen.length > 0 &&
      !(await page.evaluate(
        () =>
          [...document.scripts].length &&
          performance.getEntriesByType("resource").some((r) => r.name.includes("/.netlify/")),
      )),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("22. Cupones antes de apostar (boleto sin totales)");
{
  const { ctx, page } = await open(null);
  const slips = [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/previa-${n}.txt`), "utf8"));
  const r = await page.evaluate(
    (slips) =>
      slips.map((t) => {
        const p = parseCoupon(t);
        return {
          meta: p.meta,
          n: p.fixtures.length,
          legs: p.fixtures.reduce((s, f) => s + f.markets.length, 0),
          f: p.fixtures.map((f) => ({
            h: f.home,
            a: f.away,
            iso: f.dateISO,
            t: f.time,
            b: f.builderOdd,
            m: f.markets.map((m) => [m.market, m.pick, m.odd, m.builder ? 1 : 0, m.builderOdd || ""]),
          })),
        };
      }),
    slips,
  );
  const [a, b, c] = r;
  check(
    "previa 1: 11 BetBuilder de selecciones con sus 25 selecciones, fecha, hora y cuota del paquete",
    a.meta.betslip &&
      a.n === 11 &&
      a.legs === 25 &&
      a.f[0].h === "Senegal" &&
      a.f[0].a === "Sudan" &&
      a.f[0].iso === "2026-11-12" &&
      a.f[0].t === "13:00" &&
      a.f[0].b === "1.16" &&
      JSON.stringify(a.f[0].m[1]) === JSON.stringify(["Doble oportunidad", "1 o empate", "", 1, "1.16"]) &&
      a.f[7].m[1][0] === "Remates - Arda Guler (TUR)" &&
      a.f[7].m[1][1] === "Más de 1.5",
    JSON.stringify(a.f[0]),
  );
  const prod1 = [1.16, 1.26, 1.42, 1.3, 1.2, 1.35, 1.13, 1.52, 1.47, 1.33, 1.8].reduce((x, y) => x * y, 1);
  check(
    "previa 1: cuota total calculada multiplicando cada BetBuilder una vez",
    Math.abs(a.meta.oddsProduct - Math.round(prod1 * 100) / 100) < 0.011 &&
      a.meta.stake === null &&
      a.meta.payout === null,
    a.meta.oddsProduct + " vs " + prod1.toFixed(2),
  );
  check(
    "previa 2: 4 BetBuilder con 12 selecciones (incluye hándicap y remates)",
    b.n === 4 &&
      b.legs === 12 &&
      b.f[1].m[1][0] === "Hándicap" &&
      b.f[1].m[1][1] === "2 (+0.5)" &&
      b.f[2].b === "2.20" &&
      b.f[2].m.length === 4,
    JSON.stringify(b.f[1]),
  );
  const simple = c.f.filter((f) => !f.b),
    bb = c.f.filter((f) => f.b);
  check(
    "previa 3: 18 partidos mezclando simples (con fecha después) y BetBuilder (con fecha antes)",
    c.n === 18 &&
      c.legs === 22 &&
      simple.length === 14 &&
      bb.length === 4 &&
      c.f[0].h === "FK Bodo Glimt" &&
      c.f[0].iso === "2026-11-24" &&
      c.f[0].t === "11:45" &&
      JSON.stringify(c.f[0].m[0]) === JSON.stringify(["Ambos equipos marcan", "Sí", "1.38", 0, ""]) &&
      c.f[11].m[0][0] === "2 marcará" &&
      c.f[11].m[0][2] === "1.25" &&
      c.f[10].h === "Sabah FC" &&
      c.f[10].iso === "2026-11-25" &&
      c.f[10].b === "1.17",
    JSON.stringify(c.f.slice(10, 12)),
  );
  const v4 = await page.evaluate(
    (t) => {
      const p = parseCoupon(t);
      const f = p.fixtures[0];
      return {
        slip: p.meta.betslip,
        n: p.fixtures.length,
        h: f?.home,
        a: f?.away,
        b: f?.builderOdd,
        iso: f?.dateISO,
        m: f?.markets.map((m) => m.market + ": " + m.pick),
      };
    },
    fs.readFileSync(path.join(ROOT, "pruebas/previa-4.txt"), "utf8"),
  );
  check(
    "previa 4: equipos en líneas separadas con 'competitor logo' y 'vs' sueltos",
    v4.slip &&
      v4.n === 1 &&
      v4.h === "Turquía" &&
      v4.a === "Bélgica" &&
      v4.b === "2.40" &&
      v4.iso === "2026-11-12" &&
      v4.m.length === 5 &&
      v4.m[4] === "Total de tarjetas: Más de 2.5" &&
      v4.m[1] === "Remates a Puerta (Arda Guler (TUR)) - Incl. suplente: Más de 0.5",
    JSON.stringify(v4),
  );
  const totals = await page.evaluate(
    (t) => parseCoupon(t + "\nCuota total 245.10\nValor total L 50\nBono 5\nGanancia total 12,255.00").meta,
    slips[2],
  );
  check(
    "previa: lee los totales si se pegan al final",
    totals.odds === 245.1 && totals.stake === 50 && totals.bonus === 5 && totals.payout === 12255,
    JSON.stringify(totals),
  );
  const old = await page.evaluate(
    (t) => {
      const p = parseCoupon(t);
      return { slip: !!p.meta.betslip, n: p.fixtures.length };
    },
    fs.readFileSync(path.join(ROOT, "pruebas/doradobet-1.txt"), "utf8"),
  );
  check("los cupones ya apostados siguen usando su lector", !old.slip && old.n > 10, JSON.stringify(old));
  const players = await page.evaluate(() =>
    [
      "Remates - Arda Guler (TUR)",
      "Remates a Puerta - Harry Kane (ENG)",
      "Remates (Lopez Fermin (ESP)) y suplente",
    ].map(
      (mk) =>
        parsePlayerBet({ market: mk, pick: "Más de 1.5" }, { home: "Turquía", away: "Bélgica" })?.name ||
        null,
    ),
  );
  check(
    "jugadores en el formato del boleto: Arda Guler, Harry Kane, Lopez Fermin",
    players.join("|") === "Arda Guler|Harry Kane|Lopez Fermin",
    players.join("|"),
  );
  await view(page, "new");
  await page.fill("#raw", slips[2]);
  await tap(page, "#readBtn");
  await page.waitForTimeout(300);
  const ui = await page.evaluate(() => ({
    odds: $("totalOdds").value,
    hint: $("slipHint").innerText,
    need: ["stake", "bonus", "payout"].filter((id) => $(id).classList.contains("need-input")),
    risk: !!document.querySelector("#riskBox .risk-card"),
  }));
  check(
    "Nuevo cupón: pone la cuota calculada, avisa qué falta y resalta valor apostado y ganancia",
    Number(ui.odds) > 100 &&
      /antes de apostar/i.test(ui.hint) &&
      /valor apostado/.test(ui.hint) &&
      ui.need.includes("stake") &&
      ui.need.includes("payout") &&
      ui.risk,
    JSON.stringify(ui),
  );
  await page.fill("#stake", "20");
  check(
    "al escribir el valor apostado deja de estar resaltado",
    !(await page.$eval("#stake", (e) => e.classList.contains("need-input"))),
  );
  const ph = await page.$eval("#payout", (e) => ({
    ph: e.placeholder,
    need: e.classList.contains("need-input"),
  }));
  const oddsNow = Number(await page.$eval("#totalOdds", (e) => e.value));
  check(
    "ganancia total vacía: muestra la calculada (valor × cuota) y deja de pedirla",
    ph.ph === (20 * oddsNow).toFixed(2) + " (calculada)" && !ph.need,
    JSON.stringify(ph),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("23. Marcador en vivo compartido entre cupones (goles y jugadores)");
{
  const now = Date.now(),
    day = isoDay(now),
    time = new Date(now + 30 * 60e3).toTimeString().slice(0, 5);
  const fx = (id, markets) => ({
    id,
    home: "Italia",
    away: "Francia",
    competition: "UEFA Nations League",
    dateISO: day,
    time,
    builderOdd: "1.80",
    markets,
  });
  const mk = (market, pick, builder = true) => ({
    market,
    pick,
    odd: "",
    builder,
    builderOdd: "1.80",
    settlement: "pending",
  });
  const db = {
    coupons: [
      {
        id: "C1",
        name: "Cupón 1",
        created: new Date(now).toISOString(),
        stake: 5,
        odds: 1.8,
        payout: 9,
        fixtures: [
          fx("a", [
            mk("Total", "Más de 1.5"),
            mk("Remates a Puerta - Michael Olise (FRA)", "Más de 0.5"),
            mk("Remates (Michael Olise (FRA)) y suplente", "Más de 2.5"),
          ]),
        ],
      },
      {
        id: "C2",
        name: "Cupón 2",
        created: new Date(now).toISOString(),
        stake: 5,
        odds: 1.8,
        payout: 9,
        fixtures: [
          fx("b", [
            mk("Total de goles", "Más de 1.5"),
            mk("Remates a Puerta (Michael Olise (FRA)) - Incl. suplente", "Más de 1.5"),
            mk("Remates - Michael Olise (FRA)", "Más de 1.5"),
          ]),
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    // contadores viejos (uno por mercado) para probar el paso al marcador
    progress: {},
  };
  const { ctx, page } = await open(db);
  await page.evaluate(() => {
    const f = db.coupons[1].fixtures[0],
      m = f.markets[2];
    db.progress[marketKey(f, m)] = { count: 1, updatedAt: "2026-11-12T10:00:00Z" };
    db.statsMigrated = false;
    migrateProgressToStats();
    save();
    renderAll();
  });
  const mig = await page.evaluate(() => {
    const s = Object.values(db.stats)[0];
    return s.players[crestNorm("Michael Olise")];
  });
  check(
    "los contadores viejos pasan al marcador del partido",
    mig?.shots === 1 && mig.onTarget === 0,
    JSON.stringify(mig),
  );
  await page.evaluate(() => {
    db.stats = {};
    save();
    renderAll();
  }); // se empieza el partido desde cero
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  await page.evaluate(() => document.querySelector("#agendaList .agenda-match").click());
  await page.waitForTimeout(200);
  const cards = await page.$$eval(".match-tab-content > .mk-card", (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, " ")),
  );
  check(
    "'Total · Más de 1.5' y 'Total de goles · Más de 1.5' de cupones distintos se ven en una sola tarjeta",
    cards.filter(
      (t) =>
        /Más de 1.5/.test(t) &&
        /^(Total|⚽|🥅)/.test(t.replace(/^\S+\s/, "")) &&
        /Total/.test(t) &&
        !/Olise/.test(t),
    ).length === 1 && cards.length === 5,
    cards.join(" || "),
  );
  const board = await page.$eval(".live-board", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "marcador: goles y una ficha de Olise con 'Remates (tiros totales)', 'Remates a puerta' y su suplente",
    /Goles/.test(board) &&
      /Michael Olise/.test(board) &&
      /Remates \(tiros totales\)/.test(board) &&
      /Remates a puerta/.test(board) &&
      !/Fuera/.test(board) &&
      /Agregar suplente de Olise/.test(board),
    board,
  );
  const stBtn = (target, step = 1) =>
    `.live-board button[data-st-target="${target}"][data-st-step="${step}"]`;
  const pk = await page.evaluate(() => crestNorm("Michael Olise"));
  const status = () =>
    page.evaluate(() =>
      db.coupons.map((c) => c.fixtures[0].markets.map((m) => m.settlement[0]).join("")).join(" "),
    );
  for (let i = 0; i < 2; i++) {
    await tap(page, stBtn("goals:home"));
    await page.waitForTimeout(100);
  }
  check(
    "2 goles: las dos líneas de +1.5 (una en cada cupón) quedan ganadas a la vez",
    (await status()) === "wpp wpp",
    await status(),
  );
  await tap(page, stBtn(`player:${pk}:main:onTarget`));
  await page.waitForTimeout(150);
  const s1 = await page.evaluate(
    (pk) => ({
      st: db.coupons.map((c) => c.fixtures[0].markets.map((m) => m.settlement[0]).join("")).join(" "),
      p: Object.values(db.stats)[0].players[pk],
    }),
    pk,
  );
  check(
    "1 a puerta de Olise: '+0.5 a puerta (solo él)' ganada; '+1.5 con suplente' espera; también suma 1 remate",
    s1.st === "wwp wpp" && s1.p.onTarget === 1 && s1.p.shots === 1,
    JSON.stringify(s1),
  );
  page.promptAnswer = "Kolo Muani";
  await tap(page, ".live-board [data-st-sub-add]");
  await page.waitForTimeout(400);
  await tap(page, stBtn(`player:${pk}:sub:onTarget`));
  await page.waitForTimeout(150);
  check(
    "suplente 1 a puerta: '+1.5 a puerta con suplente' ganada (1 + 1); 'remates +1.5 solo él' sigue esperando",
    (await status()) === "wwp wwp",
    await status(),
  );
  await tap(page, stBtn(`player:${pk}:main:shots`));
  await page.waitForTimeout(150);
  check(
    "Olise llega a 2 remates (1 a puerta + 1 más): '+1.5 remates solo él' ganada; '+2.5 con suplente' (2 + 1 = 3) también",
    (await status()) === "www www",
    await status(),
  );
  await tap(page, stBtn(`player:${pk}:main:shots`, -1));
  await page.waitForTimeout(150);
  check(
    "si restas, las líneas que ganó el marcador vuelven a pendiente",
    (await status()) === "wwp wwp",
    await status(),
  );
  // Tu ejemplo: 2 a puerta = 2 remates → se ganan "a puerta +0.5" y "remates +1.5"
  const ex = await page.evaluate(() => [
    lineValueFromStats(
      { players: { x: { onTarget: 2, shots: 2 } } },
      { type: "player", stat: "shots", playerKey: "x" },
    ),
    lineValueFromStats(
      { players: { x: { onTarget: 1, off: 1 } } },
      { type: "player", stat: "shots", playerKey: "x" },
    ),
  ]);
  check(
    "2 a puerta cuentan como 2 remates; los datos de la versión anterior (a puerta + fuera) se convierten al total",
    ex.join() === "2,2",
    ex.join(),
  );
  // Escribir el número (copiado de Sofascore): Esposito-Olise remates 4, a puerta 2
  await page.evaluate(() => {
    db.stats = {};
    save();
    renderAll();
  });
  await page.waitForTimeout(100);
  page.promptAnswer = "4";
  await tap(page, `.live-board button[data-st-set][data-st-target="player:${pk}:main:shots"]`);
  await page.waitForTimeout(150);
  page.promptAnswer = "2";
  await tap(page, `.live-board button[data-st-set][data-st-target="player:${pk}:main:onTarget"]`);
  await page.waitForTimeout(150);
  const typed = await page.evaluate((pk) => Object.values(db.stats)[0].players[pk], pk);
  check(
    "tocar el número para escribirlo: remates 4 y a puerta 2 (el total no se infla)",
    typed.shots === 4 && typed.onTarget === 2,
    JSON.stringify(typed),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("24. El análisis se guarda en el cupón y se compara con el resultado");
{
  const { ctx, page } = await open(baseDb());
  const pure = await page.evaluate(() => ({
    s: stripAiJson('Hola\n<kal-json>{"a":1}</kal-json>'),
    partial: stripAiJson('Hola\n<kal-json>{"a"'),
    v: parseAiVerdict('x <kal-json>{"veredicto":"razonable"}</kal-json>')?.veredicto,
  }));
  check(
    "el bloque de datos se oculta (también a medias) y se lee",
    pure.s === "Hola" && pure.partial === "Hola" && pure.v === "razonable",
    JSON.stringify(pure),
  );
  await page.evaluate(() => {
    analystSave({ clave: "secreto" });
  });
  await view(page, "analyst");
  await page.selectOption("#analystCouponPick", "A");
  await tap(page, '[data-analyst-run="cupon"]');
  await page.waitForTimeout(1200);
  const shown = await page.$eval("#analystOut-cupon", (e) => e.innerText);
  const a = await page.evaluate(() => {
    const c = db.coupons.find((x) => x.id === "A");
    return {
      has: !!c.analysis,
      ver: c.analysis?.veredicto,
      ai: c.fixtures[0].markets.map((m) => m.ai || null),
      cloud: JSON.stringify(db).includes("analysis"),
    };
  });
  check(
    "revisión de un cupón pendiente: se guarda en el cupón (viaja con la nube) sin mostrar el bloque de datos",
    a.has && a.ver === "arriesgado" && a.cloud && !/kal-json/.test(shown),
    JSON.stringify(a),
  );
  const sent = analystPosts.at(-1).datos;
  check(
    "la app envía los partidos del cupón (equipos y fecha) para consultar sus datos",
    sent.partidos?.length === 2 &&
      sent.partidos[0].local === "Fenerbahce" &&
      /^\d{4}-\d{2}-\d{2}$/.test(sent.partidos[0].fecha),
    JSON.stringify(sent.partidos),
  );
  check(
    "cada selección guarda también la probabilidad que dio el Analista",
    a.ai[0]?.p === 0.9 && a.ai[1]?.p === 0.55,
    JSON.stringify(a.ai),
  );
  check(
    "cada selección queda con su confianza y el eslabón débil marcado",
    a.ai[0]?.nivel === "Alta" && !a.ai[0]?.debil && a.ai[1]?.nivel === "Baja" && a.ai[1]?.debil === true,
    JSON.stringify(a.ai),
  );
  await page.evaluate(() => {
    const f = db.coupons.find((x) => x.id === "A").fixtures[0];
    setMarketStatus(marketKey(f, f.markets[1]), "lost");
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector(".result-card-wrap")?.click());
  const out = await page.evaluate(() => couponAiOutcome(db.coupons.find((x) => x.id === "A")));
  check(
    "cupón perdido por el eslabón débil: 'El Analista lo vio venir'",
    out.kind === "good" && /lo vio venir/.test(out.text) && /Ambos equipos marcan/.test(out.text),
    JSON.stringify(out),
  );
  await view(page, "saved");
  await page.evaluate(() => document.querySelector('[data-coupon-filter="lost"]')?.click());
  await page.waitForTimeout(150);
  check(
    "Mis cupones muestra el resultado del Analista y su análisis plegado",
    /lo vio venir/.test(await page.$eval("#couponList", (e) => e.innerText)) &&
      !!(await page.$("#couponList details.coupon-ai .analyst-md")),
  );
  await view(page, "stats");
  const stx = await page.$eval("#perfSection", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "Estadísticas: el Analista frente a tus resultados",
    /El Analista frente a tus resultados/.test(stx) &&
      /Confianza Baja 1 selecciones resueltas 0 % acertadas/.test(stx) &&
      /1 de 1/.test(stx),
    stx.match(/El Analista frente[^]*?Según tu confianza/)?.[0],
  );
  const prec = await page.evaluate(() => aiPrecisionPayload());
  check(
    "calibración: probabilidad media que dio frente al acierto real, y se le envía en la siguiente revisión",
    prec.calibracion?.selecciones === 1 &&
      prec.calibracion.probabilidadMediaQueDiste === 0.55 &&
      prec.calibracion.aciertoReal === 0 &&
      prec.porConfianza.Baja.falladas === 1,
    JSON.stringify(prec),
  );
  check(
    "el Analista recibe su propia precisión",
    await page.evaluate(() => analystHistoryPayload().precisionAnalista?.perdidosQueVioVenir === 1),
  );
  // Desde Nuevo cupón: analizar y después guardar
  await view(page, "new");
  await page.fill(
    "#raw",
    "Europa, UEFA Liga Campeones\nFenerbahce\nvs.\nLiverpool\n20/11/2026 • 14:00\nTotal de goles: Más de 1.5\nCuotas: 1.50\nAmbos equipos marcan: Sí\nCuotas: 1.70\nVALOR APOSTADO L 20.00",
  );
  await tap(page, "#readBtn");
  await page.waitForTimeout(250);
  await tap(page, "[data-analyst-preview]");
  await page.waitForTimeout(1300);
  const pend = await page.evaluate(() => !!analystState().pendiente);
  await tap(page, "#saveBtn");
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => ({
    has: !!db.coupons[0].analysis,
    ai: db.coupons[0].fixtures[0].markets.map((m) => m.ai?.nivel || null),
    left: !!analystState().pendiente,
    toast: $("toast").textContent,
  }));
  check(
    "desde Nuevo cupón: el análisis espera y se pega al guardar el cupón",
    pend &&
      saved.has &&
      saved.ai.join() === "Alta,Baja" &&
      !saved.left &&
      /Con su análisis/.test(saved.toast),
    JSON.stringify(saved),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("25. Búsqueda de logos en varias fuentes, en español e inglés");
{
  const N = await import(path.join(ROOT, "servidor/nombres.mjs"));
  const L = await import(path.join(ROOT, "servidor/buscar-logos.mjs"));
  const G = await import(path.join(ROOT, "servidor/logo.mjs"));
  check(
    "países y selecciones en español o inglés → bandera",
    N.findCountry("España")?.flag === "es" &&
      N.findCountry("Selección de Inglaterra")?.flag === "gb-eng" &&
      N.findCountry("Ivory Coast")?.es === "Costa de Marfil" &&
      N.findCountry("Países Bajos")?.en === "Netherlands" &&
      N.findCountry("RD Congo")?.flag === "cd" &&
      !N.findCountry("Real Madrid"),
  );
  check(
    "ligas: nombre en español → país y código",
    N.leagueInfo("LaLiga EA Sports").code === "PD" &&
      N.leagueInfo("Liga MX").country === "Mexico" &&
      N.leagueInfo("UEFA Liga Campeones").code === "CL",
  );
  const calls = [];
  const fakeFetch = async (url, init) => {
    const u = String(url);
    calls.push(u);
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (u.includes("api.football-data.org/v4/competitions/") && u.endsWith("/teams")) {
      const code = u.split("/").at(-2);
      return ok({
        teams:
          code === "BL1"
            ? [
                {
                  name: "FC Bayern München",
                  shortName: "Bayern",
                  tla: "FCB",
                  area: { name: "Germany" },
                  crest: "https://crests.football-data.org/5.png",
                },
              ]
            : [],
      });
    }
    if (u.endsWith("api.football-data.org/v4/competitions"))
      return ok({
        competitions: [
          {
            code: "PD",
            name: "Primera Division",
            area: { name: "Spain" },
            emblem: "https://crests.football-data.org/PD.png",
          },
          {
            code: "CL",
            name: "UEFA Champions League",
            area: { name: "Europe" },
            emblem: "https://crests.football-data.org/CL.png",
          },
        ],
      });
    if (u.includes("wbsearchentities"))
      return ok({
        search: /bayern/i.test(decodeURIComponent(u))
          ? [{ id: "Q15789" }]
          : /liga[+ ]mx/i.test(decodeURIComponent(u))
            ? [{ id: "Q1068" }]
            : [],
      });
    if (u.includes("wbgetentities"))
      return ok({
        entities: {
          Q15789: {
            id: "Q15789",
            labels: { es: { value: "FC Bayern de Múnich" }, en: { value: "FC Bayern Munich" } },
            descriptions: { es: { value: "club de fútbol alemán" } },
            claims: { P154: [{ mainsnak: { datavalue: { value: "FC Bayern München logo (2017).svg" } } }] },
          },
          Q1068: {
            id: "Q1068",
            labels: { es: { value: "Liga MX" }, en: { value: "Liga MX" } },
            descriptions: { es: { value: "liga de fútbol de México" } },
            claims: { P154: [{ mainsnak: { datavalue: { value: "Liga MX logo.svg" } } }] },
          },
        },
      });
    if (u.includes("searchteams.php"))
      return ok({
        teams: /bayern/i.test(decodeURIComponent(u))
          ? [
              {
                strTeam: "Bayern Munich",
                strCountry: "Germany",
                strSport: "Soccer",
                strBadge: "https://r2.thesportsdb.com/images/media/team/badge/b.png",
              },
            ]
          : null,
      });
    if (u.includes("search_all_leagues.php"))
      return ok({
        countries: /Mexico/.test(u)
          ? [
              {
                strLeague: "Mexican Primera League",
                strLeagueAlternate: "Liga MX",
                strCountry: "Mexico",
                strBadge: "https://r2.thesportsdb.com/images/media/league/badge/mx.png",
              },
            ]
          : [],
      });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mem = new Map(),
    store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v) };
  const run = async (q) =>
    await (
      await L.buscarLogos(new Request("https://x/api/buscar-logo?" + new URLSearchParams(q)), {
        footballDataKey: "k",
        store,
        fetchImpl: fakeFetch,
      })
    ).json();
  const b = await run({ tipo: "equipo", q: "Bayern Múnich", pais: "Alemania" });
  check(
    "'Bayern Múnich' (en español) encuentra el escudo en football-data, Wikipedia y TheSportsDB; el país sale en español",
    b.options.length === 3 &&
      b.options[0].source === "football-data.org" &&
      b.options.some(
        (o) => o.source === "Wikipedia" && /Special:FilePath\/FC_Bayern_M%C3%BCnchen_logo/.test(o.logo),
      ) &&
      b.options.some((o) => o.source === "TheSportsDB") &&
      b.options[0].country === "Alemania",
    JSON.stringify(b.options.map((o) => o.source + ":" + o.name + ":" + o.country)),
  );
  check(
    "Wikipedia se consulta en español e inglés y con una identificación de la app (sin datos personales)",
    calls.some((u) => u.includes("language=es")) && calls.some((u) => u.includes("language=en")),
  );
  const e = await run({ tipo: "equipo", q: "Selección de España" });
  check(
    "selección nacional: bandera por su nombre en español",
    e.options[0]?.source === "Bandera" && e.options[0].logo === "https://flagcdn.com/w160/es.png",
    JSON.stringify(e.options),
  );
  const lmx = await run({ tipo: "liga", q: "Liga MX" });
  check(
    "liga: 'Liga MX' en Wikipedia y en TheSportsDB (por país)",
    lmx.options.some((o) => o.source === "Wikipedia") &&
      lmx.options.some((o) => o.source === "TheSportsDB" && /mx\.png/.test(o.logo)),
    JSON.stringify(lmx.options),
  );
  const cl = await run({ tipo: "liga", q: "UEFA Liga Campeones" });
  check(
    "liga: 'UEFA Liga Campeones' → logo oficial de la Champions (football-data)",
    cl.options[0]?.logo === "https://crests.football-data.org/CL.png",
    JSON.stringify(cl.options),
  );
  const n1 = calls.length;
  await run({ tipo: "equipo", q: "Bayern Múnich", pais: "Alemania" });
  check("las búsquedas repetidas salen de la caché", calls.length - n1 <= 1, String(calls.length - n1));
  const sim = (a, b) => L.similarity(a, b);
  check(
    "parecido de nombres sin falsos positivos (AZ≠Internazionale, AC Milan≠Inter, Liga MX≠Primeira Liga)",
    sim("internazionale", "AZ") < 0.6 &&
      sim("Inter de Milán", "AC Milan") < 0.6 &&
      sim("Liga MX", "Primeira Liga") < 0.6 &&
      sim("UEFA Nations League", "UEFA Champions League") < 0.6 &&
      sim("Selección de España", "ES Troyes AC") < 0.6 &&
      sim("Manchester City", "Manchester United") < 0.6 &&
      sim("internazionale", "FC Internazionale Milano") >= 0.6 &&
      sim("Barcelona (F)", "FC Barcelona") >= 0.6 &&
      sim("Como", "Como 1907") >= 0.6 &&
      sim("Real Madrid", "Real Madrid CF") >= 0.6,
  );
  check(
    "países con 'de' y 'y' en el nombre",
    N.findCountry("Costa de Marfil")?.flag === "ci" &&
      N.findCountry("Selección de Costa de Marfil")?.flag === "ci" &&
      N.findCountry("Bosnia y Herzegovina")?.flag === "ba" &&
      N.findCountry("Spain U21")?.flag === "es",
  );
  const ok = (u) => G.isExtraLogoSource(new URL(u));
  check(
    "proxy de imágenes: acepta las fuentes nuevas y rechaza otras",
    ok("https://crests.football-data.org/5.png") &&
      ok("https://flagcdn.com/w160/gb-eng.png") &&
      ok("https://commons.wikimedia.org/wiki/Special:FilePath/X.svg") &&
      !ok("https://evil.example.com/x.png") &&
      !ok("http://flagcdn.com/w160/es.png"),
  );
  const { ctx, page } = await open(null);
  const safe = await page.evaluate(() =>
    [
      "https://crests.football-data.org/5.svg",
      "https://flagcdn.com/w160/es.png",
      "https://commons.wikimedia.org/wiki/Special:FilePath/Liga_MX_logo.svg?width=200",
      "https://evil.example.com/logo.png",
    ]
      .map(safeCrestSource)
      .join(),
  );
  check(
    "la app muestra escudos de las fuentes nuevas (y no de otras)",
    safe === "true,true,true,false",
    safe,
  );
  await ctx.close();
}

section("26. Ficha del partido: marcador por equipo, resultado automático, IA y banderas");
{
  const now = Date.now(),
    day = isoDay(now),
    time = new Date(now + 30 * 60e3).toTimeString().slice(0, 5);
  const fx = (id, markets, b) => ({
    id,
    home: "Sudan",
    away: "Senegal",
    league: "Africa, Copa de Naciones Africanas, Cla",
    competition: "Copa de Naciones Africanas,Cla",
    country: "Africa",
    dateISO: day,
    time,
    builderOdd: b,
    markets,
  });
  const mk = (market, pick, b, builder = true) => ({
    market,
    pick,
    odd: "",
    builder,
    builderOdd: b,
    settlement: "pending",
  });
  const db0 = {
    coupons: [
      {
        id: "C1",
        name: "Cupón 1",
        created: new Date(now).toISOString(),
        stake: 5,
        odds: 1.36,
        payout: 6.8,
        fixtures: [
          fx(
            "a",
            [mk("Doble oportunidad", "Empate o 2", "1.36"), mk("Total de goles", "Más de 1.5", "1.36")],
            "1.36",
          ),
        ],
      },
      {
        id: "C2",
        name: "Cupón 2",
        created: new Date(now).toISOString(),
        stake: 5,
        odds: 1.41,
        payout: 7.05,
        fixtures: [
          fx(
            "b",
            [
              mk("Doble oportunidad", "Empate o Senegal", "1.41"),
              mk("Total", "Más de 1.5", "1.41"),
              mk("Ambos equipos marcan", "Sí", "1.41"),
              mk("Total de goles - Senegal", "Más de 1.5", "1.41"),
              mk("Total Tiros De Esquina", "Más de 7.5", "1.41"),
            ],
            "1.41",
          ),
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  const pure = await page.evaluate(() => {
    const f = { home: "Sudan", away: "Senegal" },
      sp = (market, pick) => outcomeSpec({ market, pick }, f);
    const key = (market, pick) => outcomeKey(sp(market, pick));
    return {
      same:
        key("Doble oportunidad", "Empate o 2") === key("Doble oportunidad", "Empate o Senegal") &&
        key("Doble oportunidad", "X2") === key("Doble oportunidad", "Empate o 2"),
      diff: key("Doble oportunidad", "1 o empate") !== key("Doble oportunidad", "Empate o 2"),
      res: [
        outcomeResult(sp("Doble oportunidad", "Empate o 2"), 0, 2),
        outcomeResult(sp("Doble oportunidad", "Empate o 2"), 1, 0),
        outcomeResult(sp("1x2", "Sudan"), 1, 0),
        outcomeResult(sp("1x2", "X"), 1, 1),
        outcomeResult(sp("Ambos equipos marcan", "Sí"), 1, 0),
        outcomeResult(sp("Ambos equipos marcan", "No"), 1, 0),
        outcomeResult(sp("Apuesta sin empate", "2"), 1, 1),
        outcomeResult(sp("2 marcará", "Sí"), 0, 1),
      ].join(),
      none: [
        sp("1x2 - 1ª mitad", "1"),
        sp("Total de goles", "Más de 1.5"),
        sp("Hándicap", "2 (+0.5)"),
        sp("Argelia gana cualquier mitad", "Sí"),
      ].every((x) => x === null),
      side: [
        marketSide({ market: "Total de goles - Senegal", pick: "Más de 1.5" }, f),
        marketSide({ market: "1 total de goles", pick: "Más de 0.5" }, f),
        marketSide({ market: "Total de goles", pick: "Más de 1.5" }, f),
      ].join(),
      flags: [
        nationFlagUrl("Sudan"),
        nationFlagUrl("Sudán"),
        nationFlagUrl("Senegal"),
        nationFlagUrl("Costa de Marfil"),
        nationFlagUrl("Real Madrid"),
      ].join(),
      comp:
        db.coupons[0].fixtures[0].competition +
        " | " +
        parseCoupon(
          "Africa, Copa de Naciones Africanas, Cla 16/11 • 07:00\nSudan vs. Senegal\nTotal de goles: Más de 1.5\nCuotas:\n1.36",
        ).fixtures[0].competition,
    };
  });
  check(
    "mercados de resultado: 'Empate o 2' = 'Empate o Senegal' = 'X2'; se resuelven con el marcador",
    pure.same && pure.diff && pure.res === "won,lost,won,won,lost,won,void,won" && pure.none,
    JSON.stringify(pure),
  );
  check(
    "mercado de un solo equipo se reconoce por el nombre o '1/2 total'",
    pure.side === "away,home,",
    pure.side,
  );
  check(
    "banderas de selecciones por su nombre (con o sin tilde); ninguna para clubes",
    pure.flags ===
      "https://flagcdn.com/w160/sd.png,https://flagcdn.com/w160/sd.png,https://flagcdn.com/w160/sn.png,https://flagcdn.com/w160/ci.png,",
    pure.flags,
  );
  check(
    "competición cortada por la casa: 'Cla' → 'Clasificación' (cupones guardados y nuevos)",
    /Clasificación \| Copa de Naciones Africanas, Clasificación/.test(pure.comp),
    pure.comp,
  );
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  await page.evaluate(() => document.querySelector("#agendaList .agenda-match").click());
  await page.waitForTimeout(250);
  const ui = await page.evaluate(() => ({
    cards: [...document.querySelectorAll(".match-tab-content > .mk-card")].map((e) =>
      e.innerText.replace(/\s+/g, " ").slice(0, 60),
    ),
    crests: [...document.querySelectorAll(".hero-team img.team-crest")].map((i) => i.dataset.crestUrl),
    board: document.querySelector(".live-board").innerText.replace(/\s+/g, " "),
    vs: document.querySelector(".hero-vs").textContent,
    finish: !!document.querySelector("[data-pg-finish]"),
    ai: !!document.querySelector("[data-match-ai]"),
  }));
  check(
    "la ficha junta los dos 'Doble oportunidad' y los dos '+1.5 goles' (5 tarjetas en vez de 7)",
    ui.cards.length === 5 && ui.cards.filter((c) => /Doble oportunidad/.test(c)).length === 1,
    ui.cards.join(" || "),
  );
  check(
    "los dos equipos muestran su bandera sin haberla buscado",
    ui.crests.join() === "https://flagcdn.com/w160/sd.png,https://flagcdn.com/w160/sn.png",
    ui.crests.join(),
  );
  check(
    "marcador por equipo: goles y córners de Sudan y de Senegal, y botón del Analista",
    /Goles Total: 0 .*Sudan.*Senegal/.test(ui.board) &&
      /Córners Total: 0/.test(ui.board) &&
      ui.vs === "VS" &&
      ui.finish &&
      ui.ai,
    ui.board,
  );
  const stBtn = (target, step = 1) =>
    `.live-board button[data-st-target="${target}"][data-st-step="${step}"]`;
  const status = () =>
    page.evaluate(() =>
      db.coupons.map((c) => c.fixtures[0].markets.map((m) => m.settlement[0]).join("")).join(" "),
    );
  await tap(page, stBtn("goals:away"));
  await page.waitForTimeout(150);
  const g1 = await page.evaluate(() => ({
    toast: $("toast").textContent,
    score: document.querySelector(".hero-score")?.textContent,
    pop: document.querySelector(".hero-score")?.classList.contains("goal-pop"),
  }));
  check(
    "gol de Senegal: aviso, marcador 0 – 1 en la cabecera y animación",
    /Gol de Senegal! 0 – 1/.test(g1.toast) && g1.score === "0 – 1" && g1.pop,
    JSON.stringify(g1),
  );
  await tap(page, stBtn("goals:away"));
  await page.waitForTimeout(150);
  check(
    "0 – 2: se ganan '+1.5 goles' (los dos cupones) y '+1.5 goles de Senegal'; lo demás espera",
    (await status()) === "pw pwpwp",
    await status(),
  );
  await tap(page, stBtn("goals:home"));
  await page.waitForTimeout(150);
  page.promptAnswer = "1-2";
  await tap(page, "[data-pg-finish]");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector(".result-card-wrap")?.click());
  check(
    "Terminó el partido 1-2: doble oportunidad (en los dos cupones) y ambos marcan ganados; córners sin llegar, perdido",
    (await status()) === "ww wwwwl",
    await status(),
  );
  // Desmarcar tocando de nuevo
  await page.evaluate(() => {
    if (!document.querySelector(".marked-fold.is-open"))
      document.querySelector("[data-marked-toggle]").click();
  });
  await page.waitForTimeout(120);
  await page.evaluate(() =>
    [...document.querySelectorAll(".marked-fold .mk-card")]
      .find((e) => /Ambos equipos/.test(e.innerText))
      .querySelector(".mk-btn.won.selected")
      .click(),
  );
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector(".result-card-wrap")?.click());
  check(
    "tocar de nuevo un estado ya marcado lo devuelve a pendiente",
    (await status()) === "ww wwpwl",
    await status(),
  );
  // IA del partido
  await page.evaluate(() => {
    analystSave({ clave: "secreto" });
    db.coupons[1].fixtures[0].markets[4].settlement = "pending";
    save();
    renderAll();
  });
  const before = analystPosts.length;
  await tap(page, "[data-match-ai]");
  await page.waitForTimeout(1300);
  const post = analystPosts.at(-1);
  const aiUi = await page.evaluate(() => ({
    saved: !!Object.values(db.stats)[0].ai?.texto,
    box: document.querySelector(".match-ai").innerText.replace(/\s+/g, " ").slice(0, 80),
    details: !!document.querySelector(".match-ai-saved"),
  }));
  check(
    "🤖 Analizar este partido: envía solo sus mercados pendientes (sin repetir) y guarda el análisis en el partido",
    analystPosts.length === before + 1 &&
      post.modo === "cupon" &&
      /Sudan vs Senegal/.test(post.datos.cupon) &&
      (post.datos.cupon.match(/^- /gm) || []).length === 2 &&
      post.datos.partidos.length === 1 &&
      aiUi.saved &&
      aiUi.details,
    JSON.stringify(aiUi) + " " + post.datos.cupon,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
  const gen = await import(path.join(ROOT, "herramientas/generar-paises.mjs"));
  check(
    "la lista de países de la app está al día con la del servidor",
    fs.readFileSync(path.join(ROOT, "site/js/29-paises.js"), "utf8") === gen.contenido(),
  );
}

section("27. Registros propios de equipos y jugadores (promedios y goleadores)");
{
  const day = (n) => isoDay(Date.now() - n * 86400e3);
  const mk = (market, pick) => ({ market, pick, odd: "1.8", builder: false, settlement: "won" });
  const fx = (id, home, away, comp, d, markets) => ({
    id,
    home,
    away,
    competition: comp,
    league: comp,
    dateISO: day(d),
    time: "14:00",
    markets,
  });
  const db0 = {
    coupons: [
      {
        id: "R1",
        name: "R1",
        created: new Date().toISOString(),
        stake: 5,
        odds: 2,
        payout: 10,
        fixtures: [
          fx("a", "Real Madrid", "Sevilla", "LaLiga", 20, [
            mk("Remates a Puerta - Kylian Mbappe (RMD)", "Más de 0.5"),
            mk("Total de goles", "Más de 1.5"),
          ]),
          fx("b", "Betis", "Real Madrid", "LaLiga", 12, [mk("Remates - Kylian Mbappe (RMD)", "Más de 1.5")]),
          fx("c", "Francia", "Italia", "UEFA Nations League", 6, [
            mk("Remates a Puerta - Kylian Mbappe (FRA)", "Más de 0.5"),
          ]),
          fx("d", "Real Madrid", "Barcelona", "LaLiga", -2, [
            {
              market: "Remates a Puerta - Kylian Mbappe (RMD)",
              pick: "Más de 1.5",
              odd: "2.1",
              builder: false,
              settlement: "pending",
            },
          ]),
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await page.evaluate(() => {
    const fk = (i) => fixtureKey(db.coupons[0].fixtures[i]),
      pk = crestNorm("Kylian Mbappe");
    const put = (i, gh, ga, ch, ca, shots, onT, scorers) => {
      db.stats[fk(i)] = {
        goals: gh + ga,
        corners: ch + ca,
        cards: 0,
        final: true,
        teams: { home: { goals: gh, corners: ch, cards: 0 }, away: { goals: ga, corners: ca, cards: 0 } },
        players: { [pk]: { shots, onTarget: onT } },
        scorers,
        auto: {},
      };
    };
    db.stats = {};
    put(0, 3, 1, 7, 2, 5, 3, [
      { name: "Kylian Mbappe", side: "home" },
      { name: "Kylian Mbappe", side: "home" },
      { name: "Vinicius Junior", side: "home" },
    ]);
    put(1, 0, 2, 4, 6, 3, 1, [{ name: "Kylian Mbappe", side: "away" }]);
    put(2, 1, 1, 5, 5, 2, 2, [{ name: "Kylian Mbappe", side: "home" }]);
    save();
    renderAll();
  });
  const rec = await page.evaluate(() => {
    const t = teamSummary(teamRecord("Real Madrid")),
      p = playerSummary(playerRecord("Kylian Mbappe")),
      fr = teamRecord("Francia"),
      vini = playerRecord("Vinicius Junior");
    return {
      t,
      club: p.porEquipo.find((g) => g.equipo === "Real Madrid"),
      sel: p.porEquipo.find((g) => g.equipo === "Francia"),
      goles: p.goles,
      n: p.partidosRegistrados,
      frTipo: fr.tipo,
      frGf: recAvg(fr.matches, "gf"),
      vini: vini && { goles: playerSummary(vini).goles, equipo: vini.matches[0].equipo },
      barca: teamRecord("Barcelona"),
    };
  });
  check(
    "equipo: promedio de sus partidos registrados (Real Madrid: 2 partidos, 2.5 goles a favor, 0.5 en contra, 6.5 córners)",
    rec.t.partidosRegistrados === 2 &&
      rec.t.golesFavor.prom === 2.5 &&
      rec.t.golesContra.prom === 0.5 &&
      rec.t.cornersFavor.prom === 6.5 &&
      rec.t.tipo === "club" &&
      rec.barca === null,
    JSON.stringify(rec.t),
  );
  check(
    "jugador ligado a su club y a su selección por separado (Mbappé: Madrid 4 remates y 2 a puerta de media; Francia 2 y 2)",
    rec.club.tipo === "club" &&
      rec.club.partidos === 2 &&
      rec.club.remates.prom === 4 &&
      rec.club.aPuerta.prom === 2 &&
      rec.club.goles === 3 &&
      rec.sel.tipo === "selección" &&
      rec.sel.remates.prom === 2 &&
      rec.sel.goles === 1 &&
      rec.goles === 4 &&
      rec.n === 3,
    JSON.stringify([rec.club, rec.sel]),
  );
  check(
    "selección reconocida como tal y goleador sin mercado también queda registrado",
    rec.frTipo === "selección" &&
      rec.frGf.prom === 1 &&
      rec.vini?.goles === 1 &&
      rec.vini.equipo === "Real Madrid",
    JSON.stringify(rec.vini),
  );
  const pay = await page.evaluate(() => recordsPayload([db.coupons[0].fixtures[3]]));
  const mb = pay.jugadores[0];
  check(
    "al Analista le llegan los registros del cupón: Real Madrid y Mbappé con club y selección (Barcelona sin registros no aparece)",
    pay.equipos.length === 1 &&
      pay.equipos[0].equipo === "Real Madrid" &&
      /2.5 \(2 partidos\)/.test(pay.equipos[0].promedios.golesFavor) &&
      pay.equipos[0].ultimos[0].marcador === "2-0" &&
      mb.jugador === "Kylian Mbappe" &&
      mb.porEquipo.length === 2 &&
      /4 \(2 partidos\)/.test(mb.porEquipo.find((g) => g.equipo === "Real Madrid").rematesPromedio) &&
      mb.ultimos.length === 3 &&
      mb.ultimos[0].competicion === "UEFA Nations League",
    JSON.stringify(pay).slice(0, 400),
  );
  // Goleadores en la ficha
  await view(page, "calendar");
  await page.click('[data-agenda-range="all"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("#agendaList .agenda-match")]
      .find((e) => e.innerText.includes("Barcelona"))
      .click(),
  );
  await page.waitForTimeout(250);
  const stBtn = (target) => `.live-board button[data-st-target="${target}"][data-st-step="1"]`;
  await tap(page, stBtn("goals:home"));
  await page.waitForTimeout(150);
  const ask = await page.$eval(".live-board", (e) => e.innerText);
  page.promptAnswer = "1";
  await tap(page, '[data-scorer-add="home"]');
  await page.waitForTimeout(200);
  const sc = await page.evaluate(() => ({
    scorers: Object.values(db.stats).find((x) => x.scorers?.length === 1 && !x.final)?.scorers,
    chip: document.querySelector(".scorer-chip")?.innerText,
  }));
  check(
    "en el partido: tras un gol aparece '¿Quién anotó?' y sugiere a los jugadores conocidos del equipo",
    /¿Quién anotó\?/.test(ask) &&
      sc.scorers?.[0]?.name === "Kylian Mbappe" &&
      sc.scorers[0].side === "home" &&
      /Kylian Mbappe/.test(sc.chip),
    JSON.stringify(sc),
  );
  await tap(page, ".scorer-chip");
  await page.waitForTimeout(150);
  check("tocar un goleador lo quita", (await page.$$(".scorer-chip")).length === 0);
  // Seguir a un jugador sin mercado, anotar goleadores y goles por jugador
  const bd = await page.$eval(".live-board", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "el marcador siempre ofrece '＋ Goleador' y '＋ Seguir jugador' (aunque no haya goles ni mercados del jugador)",
    /＋ Goleador/.test(bd) &&
      /Seguir jugador de Real Madrid/.test(bd) &&
      /Seguir jugador de Barcelona/.test(bd),
    bd.slice(0, 200),
  );
  // «Seguir jugador» abre la ventana de búsqueda; sin red se puede seguir solo con el nombre.
  await tap(page, '[data-track-add="away"]');
  await page.waitForSelector(".pp-sheet");
  await page.fill("#ppQuery", "Lamine Yamal");
  await tap(page, "[data-pp-manual]");
  await page.waitForTimeout(250);
  const fkD = await page.evaluate(() => Object.keys(db.stats).find((k) => db.stats[k].tracked?.length));
  const card = await page.evaluate(() =>
    [...document.querySelectorAll(".lb-player")]
      .find((e) => /Lamine Yamal/.test(e.innerText))
      ?.innerText.replace(/\s+/g, " "),
  );
  check(
    "jugador seguido: aparece con su equipo y sus contadores de remates, a puerta y goles",
    /Lamine Yamal · Barcelona/.test(card) &&
      /Remates \(tiros totales\)/.test(card) &&
      /Remates a puerta/.test(card) &&
      /⚽ Goles/.test(card),
    card,
  );
  const yk = await page.evaluate(() => crestNorm("Lamine Yamal"));
  await tap(page, `.live-board button[data-st-target="player:${yk}:main:onTarget"][data-st-step="1"]`);
  await page.waitForTimeout(120);
  await tap(page, `.live-board button[data-player-goal="1"][data-st-pk="${yk}"]`);
  await page.waitForTimeout(250);
  const g = await page.evaluate((k) => {
    const st = Object.values(db.stats).find((x) => x.tracked?.length);
    return {
      away: st.teams.away.goals,
      total: st.goals,
      sum: st.teams.home.goals + st.teams.away.goals,
      scorers: st.scorers,
      p: st.players[k],
    };
  }, yk);
  check(
    "＋ gol en el jugador: anota al goleador y también sube el marcador de su equipo (Barcelona 1)",
    g.away === 1 &&
      g.total === g.sum &&
      g.scorers.length === 1 &&
      g.scorers[0].name === "Lamine Yamal" &&
      g.scorers[0].side === "away" &&
      g.scorers[0].add === true &&
      g.p.onTarget === 1 &&
      g.p.shots === 1,
    JSON.stringify(g),
  );
  await tap(page, `.live-board button[data-player-goal="-1"][data-st-pk="${yk}"]`);
  await page.waitForTimeout(250);
  const g2 = await page.evaluate(() => {
    const st = Object.values(db.stats).find((x) => x.tracked?.length);
    return { away: st.teams.away.goals, scorers: st.scorers.length };
  });
  check(
    "− gol: lo quita del jugador y del marcador del equipo",
    g2.away === 0 && g2.scorers === 0,
    JSON.stringify(g2),
  );
  // Mercado existente (Mbappé, código RMD): si no se sabe su equipo, lo pregunta una vez
  const mk2 = await page.evaluate(() => crestNorm("Kylian Mbappe"));
  page.promptAnswer = "1";
  await tap(page, `.live-board button[data-player-goal="1"][data-st-pk="${mk2}"]`);
  await page.waitForTimeout(250);
  const g3 = await page.evaluate(() => {
    const st = Object.values(db.stats).find((x) => x.tracked?.length);
    return { home: st.teams.home.goals, who: st.scorers.map((x) => x.name + ":" + x.side).join() };
  });
  check(
    "jugador con mercado: su gol también cuenta (Real Madrid 1, goleador Mbappé)",
    g3.home === 1 && g3.who === "Kylian Mbappe:home",
    JSON.stringify(g3),
  );
  await tap(page, `.live-board button[data-player-goal="-1"][data-st-pk="${mk2}"]`);
  await page.waitForTimeout(150);
  page.promptAnswer = "Rodrygo Goes";
  await tap(page, '[data-scorer-add="home"]');
  await page.waitForTimeout(250);
  const g4 = await page.evaluate(() => {
    const st = Object.values(db.stats).find((x) => x.tracked?.length);
    return {
      home: st.teams.home.goals,
      who: st.scorers.map((x) => x.name).join(),
      seg: [...document.querySelectorAll(".lb-player")].some((e) => /Rodrygo Goes/.test(e.innerText)),
    };
  });
  check(
    "'＋ Goleador' sin sumar el gol antes: anota a Rodrygo, sube el marcador y aparece su ficha",
    g4.home === 1 && g4.who === "Rodrygo Goes" && g4.seg,
    JSON.stringify(g4),
  );
  // Cerrar el partido (pasado) para que cuente en los registros
  await page.evaluate(() => {
    const k = Object.keys(db.stats).find((x) => db.stats[x].tracked?.length);
    db.stats[k].final = true;
    db.stats[k].players[crestNorm("Lamine Yamal")] = { onTarget: 2, shots: 3 };
    save();
  });
  const reg = await page.evaluate(() => {
    const p = playerRecord("Lamine Yamal");
    return p && playerSummary(p);
  });
  check(
    "el jugador seguido entra en los registros con su equipo (Barcelona), remates y a puerta",
    reg &&
      reg.porEquipo[0].equipo === "Barcelona" &&
      reg.porEquipo[0].tipo === "club" &&
      reg.porEquipo[0].remates.prom === 3 &&
      reg.porEquipo[0].aPuerta.prom === 2,
    JSON.stringify(reg),
  );
  const rg = await page.evaluate(() => playerSummary(playerRecord("Rodrygo Goes")));
  check(
    "el goleador sin mercado entra en los registros con su gol",
    rg.goles === 1 && rg.porEquipo[0].equipo === "Real Madrid",
    JSON.stringify(rg),
  );
  page.promptAnswer = "";
  await page.evaluate(() => {
    const k = Object.keys(db.stats).find((x) => db.stats[x].tracked?.length);
    db.stats[k].final = false;
    save();
  });
  await tap(page, '[data-match-tab="datos"]');
  await page.waitForTimeout(400);
  const dt = await page.$eval("#matchTabPanel", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "ficha → 📊 Resumen: 'Tus registros' con los dos equipos y los jugadores de tus mercados",
    /Tus registros/.test(dt) &&
      /Real Madrid 2 partidos registrados/.test(dt) &&
      /Barcelona Sin partidos registrados/.test(dt) &&
      /Kylian Mbappe (?:📇 Ficha )?3 partido\(s\) registrado\(s\) · 4 gol/.test(dt) &&
      /Francia \(selección\)/.test(dt),
    dt.slice(0, 420),
  );
  await page.evaluate(() => closeMatchDetails());
  await view(page, "stats");
  const stt = await page.$eval("#recordsSection", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "Estadísticas: registros de todos los equipos y jugadores",
    /Equipos y selecciones \(5\)/.test(stt) && /Jugadores \(2\)/.test(stt),
    stt.slice(0, 200),
  );
  const A2 = await import(path.join(ROOT, "servidor/analista.mjs"));
  const pr = A2.construirPeticion("cupon", {
    cupon: "Real Madrid vs Barcelona · Remates a puerta Mbappe +1.5",
    registros: pay,
  });
  check(
    "el servidor pasa 'misRegistros' al Analista con la indicación de combinarlos con la actualidad",
    /misRegistros/.test(pr.messages[0].content) &&
      /Kylian Mbappe/.test(pr.messages[0].content) &&
      /misRegistros/.test(pr.system) &&
      /club y selección/.test(pr.system),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("28. Salud de la banca y convertidor de cuotas");
{
  const day = (n) => isoDay(Date.now() - n * 86400e3);
  const cp = (id, d, st) => ({
    id,
    name: id,
    created: new Date(Date.now() - d * 86400e3).toISOString(),
    stake: 10,
    odds: 2,
    payout: 20,
    fixtures: [
      {
        id: "f" + id,
        home: "Real Madrid",
        away: "Sevilla",
        competition: "LaLiga",
        league: "LaLiga",
        dateISO: day(d),
        time: "14:00",
        markets: [{ market: "Total de goles", pick: "Más de 1.5", odd: "2", builder: false, settlement: st }],
      },
    ],
  });
  const db0 = {
    coupons: [
      cp("a", 6, "won"),
      cp("b", 5, "won"),
      cp("c", 4, "lost"),
      cp("d", 3, "lost"),
      cp("e", 2, "lost"),
      cp("f", 1, "won"),
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  const h = await page.evaluate(() => bankHealth());
  check(
    "salud de la banca: caída máxima 30, mejor racha 2, peor racha 3, racha actual de 1 ganado",
    h &&
      h.maxDd === 30 &&
      h.bestWin === 2 &&
      h.worstLoss === 3 &&
      h.cur.type === "w" &&
      h.cur.n === 1 &&
      h.underPeak === 20,
    JSON.stringify(h),
  );
  await tap(page, '[data-view="stats"]');
  await page.waitForTimeout(300);
  const txt = await page.$eval("#perfSection", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "Estadísticas muestra la salud de la banca y el convertidor de cuotas",
    /Salud de tu banca/.test(txt) && /Convertidor de cuotas/.test(txt) && /Caída máxima/.test(txt),
    txt.slice(0, 200),
  );
  await page.selectOption("#oddsFmt", "us");
  await page.fill("#oddsIn", "-120");
  const o1 = await page.$eval("#oddsOut", (e) => e.innerText);
  check(
    "convierte −120 americano a decimal 1.83 y 54.5 % de probabilidad",
    /1\.83/.test(o1) && /54\.5/.test(o1),
    o1,
  );
  await page.selectOption("#oddsFmt", "frac");
  await page.fill("#oddsIn", "5/4");
  const o2 = await page.$eval("#oddsOut", (e) => e.innerText);
  check("fracción 5/4 → decimal 2.25 y americana +125", /2\.25/.test(o2) && /\+125/.test(o2), o2);
  await page.fill("#oddsIn", "abc");
  const o3 = await page.$eval("#oddsOut", (e) => e.innerText);
  check("una cuota ilegible no rompe nada", /No entiendo/.test(o3), o3);
  await page.fill("#mgA", "2.10");
  await page.fill("#mgB", "3.30");
  await page.fill("#mgC", "3.40");
  const mg = await page.$eval("#mgOut", (e) => e.innerText);
  check("margen de la casa de 2.10 / 3.30 / 3.40 ≈ 7.3 %", /7\.3 %/.test(mg), mg);
  await tap(page, "[data-perf-period]");
  await page.waitForTimeout(200);
  check("tras cambiar el periodo los bloques nuevos siguen ahí", (await page.$$("#bankHealth")).length === 1);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("29. Captura de boletos y etiquetas de estrategia");
{
  const A = await import(path.join(ROOT, "servidor/analista.mjs"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const b64 = "A".repeat(200_000);
  const env = { ANTHROPIC_API_KEY: "k", ANALISTA_CLAVE: "secreto" };
  const req = (body) =>
    new Request("https://x/api/analista", {
      method: "POST",
      headers: { "x-kal-clave": "secreto" },
      body: JSON.stringify(body),
    });
  const ok = await A.leerPeticion(req({ modo: "imagen", datos: { tipo: "image/jpeg", imagen: b64 } }), env);
  check(
    "servidor: acepta una captura grande (más de 120 000 caracteres) en modo imagen",
    ok.modo === "imagen" && !ok.error,
  );
  const pr = A.construirPeticion("imagen", ok.datos);
  const c0 = pr.messages[0].content;
  check(
    "servidor: manda la imagen a Claude como bloque de imagen, sin búsquedas web, para transcribir",
    c0[0].type === "image" &&
      c0[0].source.media_type === "image/jpeg" &&
      !pr.tools &&
      /NO_ES_CUPON/.test(pr.system),
  );
  const okPdf = await A.leerPeticion(
    req({ modo: "imagen", datos: { tipo: "application/pdf", imagen: b64 } }),
    env,
  );
  const bloque = A.construirPeticion("imagen", okPdf.datos).messages[0].content[0];
  check(
    "servidor: acepta el PDF del boleto y lo manda a Claude como documento",
    bloque.type === "document" && bloque.source.media_type === "application/pdf",
  );
  const mala = await A.leerPeticion(req({ modo: "imagen", datos: { tipo: "text/html", imagen: b64 } }), env);
  check("servidor: rechaza tipos que no son imagen", mala.error?.status === 400);
  const grande = await A.leerPeticion(req({ modo: "cupon", datos: { cupon: "x".repeat(130_000) } }), env);
  check("servidor: los demás modos siguen limitados a 120 000 caracteres", grande.error?.status === 413);

  // --- cliente
  const mk = (id, d, st, tags, stake = 10) => ({
    id,
    name: id,
    created: new Date(Date.now() - d * 86400e3).toISOString(),
    stake,
    odds: 2,
    payout: stake * 2,
    tags,
    fixtures: [
      {
        id: "f" + id,
        home: "Real Madrid",
        away: "Sevilla",
        competition: "LaLiga",
        league: "LaLiga",
        dateISO: isoDay(Date.now() - d * 86400e3),
        time: "14:00",
        markets: [{ market: "Total de goles", pick: "Más de 1.5", odd: "2", builder: false, settlement: st }],
      },
    ],
  });
  const db0 = {
    coupons: [
      mk("a", 5, "won", ["Remates"]),
      mk("b", 4, "lost", ["Remates"]),
      mk("c", 3, "lost", ["Remates", "Combinada"]),
      mk("d", 2, "won", ["Goles"]),
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await page.evaluate(() => localStorage.setItem("kal_analista_v1", JSON.stringify({ clave: "secreto" })));
  await tap(page, '[data-view="stats"]');
  await page.waitForTimeout(300);
  const tx = await page.$eval("#perfSection", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "Estadísticas: 'Por etiqueta' con Remates (3 cupones, 1 ganado) y Goles",
    /Por etiqueta/.test(tx) && /Remates\s*3 cupones · 1 ganados/.test(tx) && /Goles\s*1 cupones/.test(tx),
    tx.slice(tx.indexOf("Por etiqueta"), tx.indexOf("Por etiqueta") + 220),
  );
  await tap(page, '[data-view="saved"]');
  await page.evaluate(() => {
    couponFilter = "all";
    renderCoupons();
  });
  await page.waitForTimeout(200);
  const pills = await page.$$eval(".tag-pill", (e) => e.map((x) => x.innerText));
  check(
    "la tarjeta del cupón guardado muestra sus etiquetas",
    pills.some((t) => /Remates/.test(t)) && pills.length >= 4,
    pills.join("|"),
  );
  await tap(page, '[data-view="new"]');
  await page.waitForTimeout(200);
  check(
    "Nuevo cupón tiene el selector de etiquetas y los botones de captura y portapapeles",
    (await page.$$("#tagPicker .tag-chip")).length >= 9 &&
      !!(await page.$("#photoBtn")) &&
      !!(await page.$("#pasteBtn")),
  );
  // Leer desde captura
  await page.setInputFiles("#photoFile", { name: "boleto.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => /Senegal/.test($("preview").innerText), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const post = analystPosts[analystPosts.length - 1];
  check(
    "📷 Leer captura: envía la imagen reducida al Analista y rellena el cupón con el texto leído",
    post.modo === "imagen" &&
      post.datos.tipo === "image/jpeg" &&
      post.datos.imagen.length > 100 &&
      (await page.$eval("#preview", (e) => /Senegal/.test(e.innerText))),
  );
  const sug = await page.$$eval("#tagPicker .tag-chip.active", (e) => e.map((x) => x.innerText));
  check(
    "se sugieren etiquetas al leer el boleto (Goles y Combinada)",
    sug.includes("Goles") && sug.includes("Combinada"),
    sug.join("|"),
  );
  await tap(page, '#tagPicker [data-tag-toggle="Seguro"]');
  await tap(page, '#tagPicker [data-tag-toggle="Goles"]');
  const sug2 = await page.$$eval("#tagPicker .tag-chip.active", (e) => e.map((x) => x.innerText));
  check(
    "tocar una etiqueta la activa o la quita",
    sug2.includes("Seguro") && !sug2.includes("Goles"),
    sug2.join("|"),
  );
  await page.fill("#stake", "10");
  await tap(page, "#saveBtn");
  await page.waitForTimeout(400);
  const tags = await page.evaluate(() => db.coupons[0].tags);
  check(
    "al guardar, el cupón conserva sus etiquetas",
    tags.includes("Seguro") && tags.includes("Combinada") && !tags.includes("Goles"),
    JSON.stringify(tags),
  );
  check(
    "tras guardar, el selector queda limpio para el siguiente cupón",
    (await page.$$("#tagPicker .tag-chip.active")).length === 0,
  );
  // PDF del boleto
  await tap(page, '[data-view="new"]');
  await page.evaluate(() => {
    draftSelections = [];
    renderPreview();
  });
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(400, 0x41)]);
  await page.setInputFiles("#photoFile", { name: "boleto.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForFunction(() => /Senegal/.test($("preview").innerText), null, { timeout: 8000 });
  const postPdf = analystPosts[analystPosts.length - 1];
  check(
    "📄 Leer PDF: envía el PDF tal cual al Analista y rellena el cupón",
    postPdf.modo === "imagen" &&
      postPdf.datos.tipo === "application/pdf" &&
      postPdf.datos.imagen.startsWith("JVBERi0"),
  );
  // Imagen que no es un boleto
  await tap(page, '[data-view="new"]');
  await page.evaluate(() => ($("raw").value = ""));
  globalThis.__noCupon = true;
  const antes = "";
  await page.setInputFiles("#photoFile", { name: "otra.png", mimeType: "image/png", buffer: png });
  await page.waitForTimeout(900);
  globalThis.__noCupon = false;
  check(
    "una imagen sin boleto no rellena nada y avisa",
    (await page.$eval("#raw", (e) => e.value)) === antes &&
      /no parece un boleto/.test(await page.$eval("#toast", (e) => e.textContent)),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("30. Enlace de compartir de Doradobet (aviso)");
{
  const msg =
    "¡Vea los partidos en mi boleto de apuestas en doradobet.com y haga las mismas apuestas con un solo clic!\nhttps://doradobet.com/deportes?shareCode=83RY6YV5AHN";
  const { ctx, page } = await open({
    coupons: [],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  });
  await tap(page, '[data-view="new"]');
  await page.fill("#raw", msg);
  await tap(page, "#readBtn");
  await page.waitForTimeout(250);
  const t = await page.$eval("#toast", (e) => e.textContent);
  check(
    "pegar solo el enlace de Doradobet avisa que no trae el boleto y no inventa un cupón",
    /no trae el boleto/.test(t) && (await page.evaluate(() => draftSelections.length)) === 0,
    t,
  );
  await page.fill("#raw", "Senegal vs. Sudan\n12/11/2026 • 13:00\n1.16\nTotal de goles\nMás de 1.5\n" + msg);
  await tap(page, "#readBtn");
  await page.waitForTimeout(250);
  check(
    "si el texto trae el boleto además del enlace, se lee normal",
    (await page.evaluate(() => draftSelections.length)) >= 1,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("31. Nuevo comienzo (reinicio de banca, casas y cupones)");
{
  const day = (n) => isoDay(Date.now() - n * 86400e3);
  const cp = (id, st) => ({
    id,
    name: id,
    created: new Date().toISOString(),
    stake: 10,
    odds: 2,
    payout: 20,
    houseId: "H1",
    fixtures: [
      {
        id: "f" + id,
        home: "Real Madrid",
        away: "Sevilla",
        competition: "LaLiga",
        league: "LaLiga",
        dateISO: day(2),
        time: "14:00",
        markets: [{ market: "Total de goles", pick: "Más de 1.5", odd: "2", builder: false, settlement: st }],
      },
    ],
  });
  const db0 = {
    coupons: [cp("a", "lost"), cp("b", "lost"), cp("c", "won")],
    houses: [{ id: "H1", name: "Hondubet", initial: 500 }],
    transactions: [{ id: "T1", houseId: "H1", delta: -10, couponId: "a", date: new Date().toISOString() }],
    resultHistory: [{ id: "x" }],
    actionHistory: [],
    settings: { budget: 99, banca: { monto: 5000, unidadPct: 5, maxSel: 9, pausaTras: 7 } },
    stats: {
      k1: {
        goals: 2,
        corners: 5,
        cards: 1,
        final: true,
        teams: { home: { goals: 1 }, away: { goals: 1 } },
        players: {},
        scorers: [],
      },
    },
    tagList: ["Mía"],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await page.evaluate(() => {
    localStorage.setItem(
      "kal_saved_crest_directory_v1",
      JSON.stringify({ "real madrid": { url: "https://x/rm.png" } }),
    );
    localStorage.setItem("kal_images_v1", JSON.stringify({ a: "data:image/png;base64,AAAA" }));
    localStorage.setItem("kal_budget_alert_2026-11", "over");
  });
  await tap(page, '[data-view="settings"]');
  await tap(page, "[data-fresh-start]");
  await page.waitForSelector("#rsGo");
  check(
    "el asistente muestra qué se conserva y qué se borra",
    /Se conserva/.test(await page.$eval(".reset-sheet", (e) => e.innerText)) &&
      /Escudos, logos/.test(await page.$eval(".reset-sheet", (e) => e.innerText)),
  );
  check(
    "el botón de empezar está bloqueado hasta poner banca y escribir EMPEZAR",
    await page.$eval("#rsGo", (e) => e.disabled),
  );
  await page.fill("#rsMonto1", "1000");
  await page.fill("#rsCasa2", "Hondubet");
  await page.fill("#rsMonto2", "500");
  const resumen = await page.$eval("#rsResumen", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "el resumen calcula la unidad: banca L 1,500 → 1 unidad = L 15.00 (1 %) y presupuesto L 450",
    /1,500/.test(resumen) && /15\.00/.test(resumen) && /450/.test(resumen),
    resumen,
  );
  await page.fill("#rsConfirm", "hola");
  check("sigue bloqueado con otra palabra", await page.$eval("#rsGo", (e) => e.disabled));
  await page.fill("#rsConfirm", "empezar");
  check("con 'empezar' y la banca se habilita", !(await page.$eval("#rsGo", (e) => e.disabled)));
  await tap(page, "#rsGo");
  await page.waitForFunction(() => db.coupons.length === 0 && db.houses.length === 2, null, {
    timeout: 8000,
  });
  const r = await page.evaluate(async () => ({
    cupones: db.coupons.length,
    tx: db.transactions.length,
    hist: db.resultHistory.length,
    casas: db.houses.map((h) => h.name + ":" + h.initial).join(","),
    banca: bankrollAmount(),
    unidad: unitStake(),
    cfg: db.settings.banca,
    presupuesto: db.settings.budget,
    stats: Object.keys(db.stats || {}).length,
    tags: db.tagList,
    escudos: localStorage.getItem("kal_saved_crest_directory_v1"),
    fotos: localStorage.getItem("kal_images_v1"),
    aviso: localStorage.getItem("kal_budget_alert_2026-11"),
    copias: (await snapshots()).map((s) => s.motivo + ":" + s.cupones),
  }));
  check(
    "se borraron cupones, movimientos e historial",
    r.cupones === 0 && r.tx === 0 && r.hist === 0,
    JSON.stringify(r),
  );
  check(
    "las casas nuevas tienen la banca: Doradobet 1000 y Hondubet 500",
    r.casas === "Doradobet:1000,Hondubet:500" && r.banca === 1500,
    r.casas,
  );
  check(
    "la banca queda con reglas sanas: unidad 1 % (L 15), 3 selecciones, pausa tras 2, presupuesto L 450",
    r.unidad === 15 &&
      r.cfg.unidadPct === 1 &&
      r.cfg.maxSel === 3 &&
      r.cfg.pausaTras === 2 &&
      r.presupuesto === 450,
    JSON.stringify(r.cfg),
  );
  check(
    "se conservan escudos, fotos, etiquetas y registros de partidos",
    /real madrid/.test(r.escudos) && !!r.fotos && r.tags[0] === "Mía" && r.stats === 1,
  );
  check("se limpiaron los avisos del presupuesto anterior", r.aviso === null);
  check(
    "quedó una copia automática con los 3 cupones antes de borrar",
    r.copias.some((c) => /Antes de nuevo comienzo:3/.test(c)),
    r.copias.join("|"),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();

  // Borrar también los registros de partidos
  const t2 = await open(db0);
  await tap(t2.page, '[data-view="settings"]');
  await tap(t2.page, "[data-fresh-start]");
  await t2.page.fill("#rsMonto1", "200");
  await t2.page.check("#rsStats");
  await t2.page.fill("#rsConfirm", "EMPEZAR");
  await tap(t2.page, "#rsGo");
  await t2.page.waitForFunction(() => db.coupons.length === 0, null, { timeout: 8000 });
  check(
    "si lo pides, también borra los registros de partidos",
    (await t2.page.evaluate(() => Object.keys(db.stats || {}).length)) === 0,
  );
  await t2.ctx.close();
}

section("32. Corregir el resultado de un cupón guardado");
{
  const fx = (home, away, ms) => ({
    id: home,
    home,
    away,
    competition: "LaLiga",
    league: "LaLiga",
    dateISO: isoDay(Date.now() - 2 * 86400e3),
    time: "14:00",
    markets: ms.map(([m, p, st]) => ({ market: m, pick: p, odd: "1.5", builder: false, settlement: st })),
  });
  const cp = (id, fixtures, extra = {}) => ({
    id,
    name: "Cupón " + id,
    created: new Date().toISOString(),
    stake: 10,
    odds: 3,
    payout: 30,
    fixtures,
    ...extra,
  });
  const db0 = {
    coupons: [
      // Se marcó un mercado como perdido por error: el cupón sale perdido
      cp("A", [
        fx("Real Madrid", "Sevilla", [["Total de goles", "Más de 1.5", "won"]]),
        fx("Betis", "Girona", [["Total de goles", "Más de 1.5", "lost"]]),
        fx("Villarreal", "Getafe", [["Ambos equipos marcan", "Sí", "won"]]),
      ]),
      // Comparte el mercado de Betis con el cupón A
      cp("B", [fx("Betis", "Girona", [["Total de goles", "Más de 1.5", "lost"]])]),
      cp("C", [fx("Valencia", "Osasuna", [["Total de goles", "Más de 1.5", "won"]])], { cashoutGross: 4 }),
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  const st = () =>
    page.evaluate(() => Object.fromEntries(db.coupons.map((c) => [c.id, calcCoupon(c).status])));
  check(
    "punto de partida: A y B perdidos, C con cash out",
    JSON.stringify(await st()) === '{"A":"lost","B":"lost","C":"cashout"}',
    JSON.stringify(await st()),
  );
  await tap(page, '[data-view="saved"]');
  await page.evaluate(() => {
    couponFilter = "all";
    renderCoupons();
  });
  await page.waitForTimeout(200);
  check(
    "cada cupón guardado tiene el botón 'Corregir resultado'",
    (await page.$$("[data-fix-result]")).length === 3,
  );
  await tap(page, '[data-fix-result="A"]');
  await page.waitForSelector(".fix-sheet");
  const txt = await page.$eval(".fix-sheet", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "el asistente lista los 3 partidos con sus mercados y el estado actual",
    /Betis vs Girona/.test(txt) && /Villarreal vs Getafe/.test(txt) && /Perdido/.test(txt),
    txt.slice(0, 160),
  );
  const key = await page.evaluate(() =>
    marketKey(db.coupons[0].fixtures[1], db.coupons[0].fixtures[1].markets[0]),
  );
  await tap(page, `.fix-sheet [data-fix-key="${key}"][data-fix-value="won"]`);
  await page.waitForTimeout(200);
  check(
    "marcar ✅ el mercado equivocado deja el cupón A ganado (y el B, que comparte ese mercado, también)",
    JSON.stringify(await st()) === '{"A":"won","B":"won","C":"cashout"}',
    JSON.stringify(await st()),
  );
  check(
    "la ventana se actualiza sola y muestra 'Ganado'",
    /ahora:\s*Ganado/.test(await page.$eval(".fix-sheet", (e) => e.innerText.replace(/\s+/g, " "))),
  );
  check(
    "el cambio quedó en el historial de resultados",
    (await page.evaluate(() => db.resultHistory.length)) === 1,
  );
  await tap(page, '.fix-sheet [data-fix-all="pending"]');
  await page.waitForTimeout(200);
  check(
    "'Todo pendiente' devuelve el cupón A a pendiente",
    (await st()).A === "pending",
    JSON.stringify(await st()),
  );
  await tap(page, '.fix-sheet [data-fix-all="won"]');
  await page.waitForTimeout(200);
  check("'Todo ganado' lo marca ganado", (await st()).A === "won", JSON.stringify(await st()));
  await tap(page, "[data-fix-close]");
  check("'Listo' cierra la ventana", (await page.$(".fix-sheet")) === null);
  await tap(page, '[data-fix-result="C"]');
  await page.waitForSelector("[data-fix-cashout]");
  await tap(page, "[data-fix-cashout]");
  await page.waitForTimeout(200);
  check(
    "quitar el cash out hace que C vuelva a salir de sus mercados (ganado)",
    (await st()).C === "won",
    JSON.stringify(await st()),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("33. Revisión general: datos incompletos, nube, service worker y accesibilidad");
{
  // --- el service worker precarga todos los archivos del sitio
  const sw = fs.readFileSync(path.join(ROOT, "site/sw.js"), "utf8");
  const archivos = [
    ...fs
      .readdirSync(path.join(ROOT, "site/js"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => "/js/" + f),
    ...fs
      .readdirSync(path.join(ROOT, "site/css"))
      .filter((f) => f.endsWith(".css"))
      .map((f) => "/css/" + f),
  ];
  const faltan = archivos.filter((f) => !sw.includes("'" + f + "'"));
  check(
    "el service worker precarga todos los JS y CSS del sitio",
    faltan.length === 0,
    "faltan: " + faltan.join(", "),
  );
  check(
    "las cabeceras de seguridad básicas están en _headers",
    /nosniff/.test(fs.readFileSync(path.join(ROOT, "site/_headers"), "utf8")),
  );

  // --- datos incompletos (respaldos antiguos, fusiones): la app no se rompe
  const dbRota = {
    coupons: [
      { id: "s1", name: "Sin partidos", created: new Date().toISOString(), stake: 5 },
      {
        id: "s2",
        name: "Partido sin mercados",
        created: new Date().toISOString(),
        stake: 5,
        fixtures: [{ id: "f", home: "A", away: "B" }],
      },
      {
        id: "s3",
        name: "Mercado vacío",
        created: new Date().toISOString(),
        stake: 5,
        fixtures: [{ id: "g", home: "C", away: "D", markets: [{}, null] }],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const r0 = await open(dbRota);
  for (const v of [
    "home",
    "new",
    "calendar",
    "markets",
    "saved",
    "houses",
    "stats",
    "analyst",
    "logos",
    "settings",
  ]) {
    await r0.page.evaluate((v) => go(v), v);
    await r0.page.waitForTimeout(80);
  }
  const estados = await r0.page.evaluate(() =>
    db.coupons.map((c) => calcCoupon(c).status + ":" + c.fixtures.length),
  );
  check(
    "datos incompletos: todas las pantallas cargan sin errores",
    !r0.page.errors.length,
    r0.page.errors.join(" | "),
  );
  check(
    "datos incompletos: los cupones quedan en una forma segura (lista de partidos y de mercados)",
    estados.length === 3 && estados[0] === "pending:0",
    estados.join(","),
  );
  await r0.ctx.close();

  // --- el reinicio no se deshace con la fusión de la nube
  const cp = (id) => ({
    id,
    name: id,
    created: new Date().toISOString(),
    stake: 10,
    odds: 2,
    payout: 20,
    houseId: "H1",
    fixtures: [
      {
        id: "f" + id,
        home: "A" + id,
        away: "B",
        dateISO: isoDay(Date.now() - 2 * 86400e3),
        time: "14:00",
        markets: [{ market: "1x2", pick: "1", odd: "2", settlement: "won" }],
      },
    ],
  });
  const viejo = {
    coupons: [cp("a"), cp("b")],
    houses: [{ id: "H1", name: "Vieja", initial: 100 }],
    transactions: [{ id: "T1", houseId: "H1", delta: -10, couponId: "a" }],
    resultHistory: [],
    actionHistory: [],
    progress: { p1: { updatedAt: "2026-01-01T00:00:00.000Z", goals: 1 } },
    stats: { s1: { updatedAt: "2026-01-01T00:00:00.000Z", goals: 2 } },
    tagList: ["Remota"],
    statsMigrated: true,
  };
  const r1 = await open(viejo);
  await tap(r1.page, '[data-view="settings"]');
  await tap(r1.page, "[data-fresh-start]");
  await r1.page.fill("#rsMonto1", "500");
  await r1.page.check("#rsStats");
  await r1.page.fill("#rsConfirm", "EMPEZAR");
  await tap(r1.page, "#rsGo");
  await r1.page.waitForFunction(() => db.coupons.length === 0 && db.houses.length === 1, null, {
    timeout: 8000,
  });
  const fus = await r1.page.evaluate((viejo) => {
    const m = mergeDatabases(db, JSON.parse(JSON.stringify(viejo)));
    return {
      cupones: m.coupons.length,
      casas: m.houses.map((h) => h.name).join(","),
      tx: m.transactions.length,
      progreso: Object.keys(m.progress).length,
      stats: Object.keys(m.stats).length,
      tags: m.tagList,
    };
  }, viejo);
  check(
    "tras el reinicio, fusionar con una nube vieja NO devuelve cupones, casas, movimientos, progreso ni registros",
    fus.cupones === 0 && fus.casas === "Doradobet" && fus.tx === 0 && fus.progreso === 0 && fus.stats === 0,
    JSON.stringify(fus),
  );
  check(
    "la fusión une las etiquetas propias de los dos lados",
    fus.tags.includes("Remota"),
    JSON.stringify(fus.tags),
  );
  await r1.ctx.close();

  // --- sin borrar registros: los registros de la nube se conservan; solo lo anterior desaparece
  const r2 = await open(viejo);
  await tap(r2.page, '[data-view="settings"]');
  await tap(r2.page, "[data-fresh-start]");
  await r2.page.fill("#rsMonto1", "500");
  await r2.page.fill("#rsConfirm", "EMPEZAR");
  await tap(r2.page, "#rsGo");
  await r2.page.waitForFunction(() => db.coupons.length === 0, null, { timeout: 8000 });
  const fus2 = await r2.page.evaluate(
    (viejo) => Object.keys(mergeDatabases(db, JSON.parse(JSON.stringify(viejo))).stats).length,
    viejo,
  );
  check("si no se pidió borrar los registros de partidos, se conservan", fus2 === 1, String(fus2));
  await r2.ctx.close();

  // --- el borrado general también deja marcas
  const r3 = await open(viejo);
  await tap(r3.page, '[data-view="settings"]');
  await tap(r3.page, "#wipeBtn");
  await r3.page.waitForFunction(() => db.coupons.length === 0, null, { timeout: 8000 });
  const fus3 = await r3.page.evaluate(
    (viejo) => mergeDatabases(db, JSON.parse(JSON.stringify(viejo))).coupons.length,
    viejo,
  );
  check(
    "'Borrar cupones y movimientos' tampoco se deshace con la fusión de la nube",
    fus3 === 0,
    String(fus3),
  );
  await r3.ctx.close();

  // --- accesibilidad: cada campo del HTML tiene su etiqueta enlazada
  const r4 = await open(baseDb());
  const sinFor = await r4.page.evaluate(() =>
    [...document.querySelectorAll(".field > label:not([for])")]
      .filter(
        (l) =>
          l.nextElementSibling &&
          /^(INPUT|SELECT|TEXTAREA)$/.test(l.nextElementSibling.tagName) &&
          l.nextElementSibling.id,
      )
      .map((l) => l.textContent.trim()),
  );
  check(
    "accesibilidad: todas las etiquetas de formulario están enlazadas a su campo",
    sinFor.length === 0,
    sinFor.join(" | "),
  );
  const tam = await r4.page.evaluate(() => {
    go("new");
    const c = document.getElementById("autoStakeTx");
    const r = c.getBoundingClientRect();
    return Math.round(r.width) + "x" + Math.round(r.height);
  });
  check("accesibilidad: las casillas miden al menos 20 px", tam === "20x20", tam);
  await r4.ctx.close();
}

section("34. Pestañas del partido y nombres de equipos");
{
  const D = await import(path.join(ROOT, "cloudflare/datos-partido.mjs"));
  const T = (id, name, shortName, tla) => ({ id, name, shortName, tla });
  const dia = [
    {
      id: 1,
      homeTeam: T(5, "FC Bayern München", "Bayern", "FCB"),
      awayTeam: T(38, "1. FC Köln", "1. FC Köln", "KOE"),
    },
    {
      id: 2,
      homeTeam: T(11, "VfL Wolfsburg", "Wolfsburg", "WOB"),
      awayTeam: T(3, "Bayer 04 Leverkusen", "Leverkusen", "B04"),
    },
    {
      id: 3,
      homeTeam: T(76, "Wolverhampton Wanderers FC", "Wolves", "WOL"),
      awayTeam: T(73, "Tottenham Hotspur FC", "Tottenham", "TOT"),
    },
  ];
  const r1 = D.findMatch(dia, "Bayern Munich", "Cologne");
  check(
    "«Bayern Munich vs Cologne» encuentra «FC Bayern München vs 1. FC Köln»",
    r1?.m.id === 1 && !r1.swapped,
    JSON.stringify(r1 && r1.m.id),
  );
  check(
    "«Cologne vs Bayern Munich» (al revés) también",
    D.findMatch(dia, "Cologne", "Bayern Munich")?.m.id === 1,
  );
  check(
    "«FC Cologne» y «Colonia» llegan a Köln",
    D.nameScore("FC Cologne", dia[0].awayTeam) === 1 && D.nameScore("Colonia", dia[0].awayTeam) === 1,
  );
  check(
    "«Wolves vs Spurs» encuentra Wolverhampton vs Tottenham",
    D.findMatch(dia, "Wolves", "Spurs")?.m.id === 3,
  );
  check("no confunde: «Inter vs Napoli» no está ese día", !D.findMatch(dia, "Inter", "Napoli"));
  const hint = D.motivoNoEncontrado(dia, "Cologne", "Hamburgo");
  check(
    "si solo coincide un equipo, el mensaje lo dice y pide elegir el partido",
    /parecido/.test(hint) && /Köln|Bayern/.test(hint) && /elígelo/.test(hint),
    hint,
  );
  check(
    "si no hay nada parecido, explica el límite del plan gratis",
    /plan gratis/.test(D.motivoNoEncontrado(dia, "Boca Juniors", "River Plate")),
  );
  const nombres = await import(path.join(ROOT, "servidor/nombres.mjs"));
  check(
    "la búsqueda de escudos entiende «Cologne» como Köln",
    nombres.teamAlias("Cologne") === "koln" && nombres.teamAlias("1. FC Cologne") === "koln",
  );

  // --- ficha del partido: solo las pestañas útiles
  const db0 = {
    coupons: [
      {
        id: "Z1",
        name: "Z",
        created: new Date().toISOString(),
        stake: 5,
        odds: 2,
        payout: 10,
        fixtures: [
          {
            id: "fz",
            home: "Bayern Munich",
            away: "Cologne",
            competition: "Bundesliga",
            league: "Bundesliga",
            dateISO: isoDay(Date.now() + 86400e3),
            time: "13:30",
            markets: [
              {
                market: "Total de goles",
                pick: "Más de 1.5",
                odd: "1.3",
                builder: false,
                settlement: "pending",
              },
            ],
          },
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await tap(page, '[data-view="saved"]');
  await page.evaluate(() => {
    couponFilter = "all";
    renderCoupons();
  });
  await tap(page, "[data-open-saved-match]");
  await page.waitForSelector(".match-tabs");
  const tabs = await page.$$eval(".match-tab", (e) => e.map((x) => x.textContent.trim()));
  check(
    "la ficha tiene solo Mercados, Resumen y Cupones",
    tabs.length === 3 && /Mercados/.test(tabs[0]) && /Resumen/.test(tabs[1]) && /Cupones/.test(tabs[2]),
    tabs.join(" | "),
  );
  check("abre en Mercados", await page.$eval(".match-tab.active", (e) => /Mercados/.test(e.textContent)));
  const sinApi = await page.evaluate(() => !document.querySelector("[data-load-match-tab]"));
  check("no hay botones que consulten API-Football (ya no gastan la cuota)", sinApi);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("35. Ficha del jugador: tarjetas, paradas y probabilidades");
{
  // --- lectura de mercados nuevos
  const { ctx: c0, page: p0 } = await open(baseDb());
  const lec = await p0.evaluate(() => {
    const f = { home: "Real Madrid", away: "Sevilla", markets: [] };
    const pb = (market, pick) => parsePlayerBet({ market, pick }, f);
    const sk = (market, pick) => {
      const k = statKind({ market, pick }, f);
      return k ? (k.type === "player" ? "player:" + k.stat : k.type) : null;
    };
    return {
      tarj: pb("Tarjetas - Rasmus Hojlund (DNK)", "Más de 0.5")?.name,
      tarjStat: sk("Tarjetas - Rasmus Hojlund (DNK)", "Más de 0.5"),
      para: pb("Paradas del portero - Thibaut Courtois (RMD)", "Más de 2.5")?.name,
      paraStat: sk("Paradas del portero - Thibaut Courtois (RMD)", "Más de 2.5"),
      ata: sk("Atajadas (Keylor Navas (CRC))", "Más de 3.5"),
      totalTarj: pb("Total de tarjetas", "Más de 1.5"),
      totalTarjStat: sk("Total de tarjetas", "Más de 1.5"),
      equipoTarj: pb("Tarjetas - Real Madrid", "Más de 1.5"),
      equipoTarjStat: sk("Tarjetas - Real Madrid", "Más de 1.5"),
      remates: sk("Remates a Puerta - Kylian Mbappe (RMD)", "Más de 0.5"),
    };
  });
  check(
    "lee «Tarjetas - Rasmus Hojlund (DNK)» como tarjetas del jugador (antes contaba las del partido)",
    lec.tarj === "Rasmus Hojlund" && lec.tarjStat === "player:cards",
    JSON.stringify(lec),
  );
  check(
    "lee «Paradas del portero - Thibaut Courtois (RMD)» y «Atajadas (Keylor Navas (CRC))»",
    lec.para === "Thibaut Courtois" && lec.paraStat === "player:saves" && lec.ata === "player:saves",
    JSON.stringify(lec),
  );
  check(
    "«Total de tarjetas» y las tarjetas de un equipo siguen siendo del partido (no de un jugador)",
    lec.totalTarj === null &&
      lec.totalTarjStat === "cards" &&
      lec.equipoTarj === null &&
      lec.equipoTarjStat === "cards",
    JSON.stringify(lec),
  );
  check("los remates a puerta siguen igual", lec.remates === "player:onTarget");
  await c0.close();

  // --- partidos registrados de Mbappé y Courtois (5 cerrados) + un partido futuro con tus mercados
  const day = (n) => isoDay(Date.now() - n * 86400e3);
  const MB = "Remates - Kylian Mbappe (RMD)",
    MT = "Tarjetas - Kylian Mbappe (RMD)",
    CP = "Paradas del portero - Thibaut Courtois (RMD)",
    MA = "Remates a Puerta (Kylian Mbappe (RMD)) - Incl. suplente";
  const mk = (market, pick, odd, st = "won") => ({ market, pick, odd, builder: false, settlement: st });
  const fx = (id, dias, markets) => ({
    id,
    home: "Real Madrid",
    away: "Sevilla",
    competition: "LaLiga",
    league: "LaLiga",
    dateISO: day(dias),
    time: "14:00",
    markets,
  });
  const pasados = [20, 16, 12, 8, 4].map((d, i) =>
    fx("p" + i, d, [mk(MB, "Más de 1.5", "1.9"), mk(MT, "Más de 0.5", "2.6"), mk(CP, "Más de 2.5", "1.8")]),
  );
  const futuro = fx("fut", -2, [
    mk(MB, "Más de 1.5", "1.90", "pending"),
    mk(MT, "Más de 0.5", "2.60", "pending"),
    mk(CP, "Más de 2.5", "1.80", "pending"),
    mk(MA, "Más de 0.5", "1.50", "pending"),
  ]);
  const db0 = {
    coupons: [
      {
        id: "P1",
        name: "P1",
        created: new Date().toISOString(),
        stake: 10,
        odds: 3,
        payout: 30,
        fixtures: [...pasados, futuro],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await page.evaluate(() => {
    const mb = crestNorm("Kylian Mbappe"),
      co = crestNorm("Thibaut Courtois");
    // a, b, c, d, e = del más antiguo al más reciente (20, 16, 12, 8 y 4 días atrás)
    const shots = [3, 1, 2, 4, 0],
      cards = [1, 0, 0, 1, 0],
      saves = [4, 2, 5, 3, 1];
    db.stats = {};
    db.coupons[0].fixtures.slice(0, 5).forEach((f, i) => {
      const players = {
        [mb]: { shots: shots[i], onTarget: Math.min(1, shots[i]), cards: cards[i] },
        [co]: { saves: saves[i] },
      };
      if (i === 0) players[mb].sub = { shots: 2, onTarget: 1 };
      db.stats[fixtureKey(f)] = {
        goals: 2,
        corners: 5,
        cards: 2,
        final: true,
        teams: { home: { goals: 1, corners: 3, cards: 1 }, away: { goals: 1, corners: 2, cards: 1 } },
        players,
        scorers: [],
        auto: {},
      };
    });
    save();
    renderAll();
  });
  const rec = await page.evaluate(() => {
    const p = playerRecord("Kylian Mbappe"),
      c = playerRecord("Thibaut Courtois");
    const ms = p.matches.map((m) => m.remates + "/" + m.tarjetas + "/" + (m.rematesConSup ?? "-"));
    return {
      ms,
      par: c.matches.map((m) => m.paradas),
      sum: playerSummary(p).tarjetas,
      sumC: playerSummary(c).paradas,
    };
  });
  check(
    "registros: remates, tarjetas y paradas por partido (con suplente cuando lo hay)",
    rec.ms.join() === "0/0/-,4/1/-,2/0/-,1/0/-,3/1/5" && rec.par.join() === "1,3,5,2,4",
    JSON.stringify(rec),
  );
  check(
    "promedios: tarjetas de Mbappé 0.4 y paradas de Courtois 3",
    rec.sum?.prom === 0.4 && rec.sumC?.prom === 3,
    JSON.stringify([rec.sum, rec.sumC]),
  );

  // --- ficha del jugador abierta desde el partido
  await page.evaluate(() => openMatchDetails({ couponId: "P1", fixtureIndex: 5 }));
  await page.waitForSelector(".live-board [data-player-card]");
  const contadores = await page.$$eval(".live-board .lb-counter span", (e) =>
    e.map((x) => x.textContent.trim()),
  );
  check(
    "el marcador del partido trae los contadores 🟨 Tarjetas y 🧤 Paradas de esos jugadores",
    contadores.some((t) => /Tarjetas/.test(t)) && contadores.some((t) => /Paradas/.test(t)),
    contadores.join(" | "),
  );
  const mbKey = await page.evaluate(() => crestNorm("Kylian Mbappe"));
  await tap(page, `.live-board [data-player-card="${mbKey}"]`);
  await page.waitForSelector(".pc-sheet");
  const ficha = await page.$eval(".pc-sheet", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "ficha: nombre, equipo y los datos registrados",
    /Kylian Mbappe/.test(ficha) && /Real Madrid/.test(ficha),
    ficha.slice(0, 160),
  );
  check(
    "ficha: remates más de 1.5 → 3 de 5 partidos = 57 % y cuota justa 1.75",
    /Más de 1\.5 57 % 1\.75 3\/5/.test(ficha),
    ficha.slice(ficha.indexOf("Remates"), ficha.indexOf("Remates") + 260),
  );
  check(
    "ficha: tarjetas → 2 de 5 = 43 % y cuota justa 2.33",
    /Tarjetas[^]*?Más de 0\.5 43 % 2\.33 2\/5/.test(ficha) || /43 % 2\.33 2\/5/.test(ficha),
    ficha.slice(ficha.indexOf("Tarjetas"), ficha.indexOf("Tarjetas") + 200),
  );
  check(
    "ficha: compara tu cuota 1.90 con la justa (+9 % valor) y la de tarjetas 2.60 (+11 % valor)",
    /Tu cuota 1\.90 · \+9 % valor/.test(ficha) && /Tu cuota 2\.60 · \+11 % valor/.test(ficha),
    ficha.match(/Tu cuota[^A-Z]{0,40}/g)?.join(" | "),
  );
  const encima = await page.evaluate(() => {
    const r = document.querySelector(".pc-sheet").getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + 80);
    return !!el?.closest(".pc-sheet");
  });
  check("ficha: se ve encima de la ventana del partido (no queda escondida detrás)", encima);
  check("ficha: lleva un aviso honesto de que es una estimación", /estimación con pocos datos/.test(ficha));
  const sec = (titulo) =>
    page.$eval(
      ".pc-sheet",
      (e, t) => {
        const x = [...e.querySelectorAll(".pc-stat")].find((y) =>
          y.querySelector("b")?.textContent.includes(t),
        );
        return x ? x.innerText.replace(/\s+/g, " ") : "";
      },
      titulo,
    );
  const titulos = await page.$$eval(".pc-stat-head b", (e) =>
    e.map((x) => x.textContent.replace(/^\S+\s/, "")),
  );
  check(
    "ficha: secciones separadas Remates, Remates y suplente, Remates a puerta y Remates a puerta y suplente",
    ["Remates", "Remates y suplente", "Remates a puerta", "Remates a puerta y suplente"].every((t) =>
      titulos.includes(t),
    ) && !(await page.$("[data-pc-sub]")),
    titulos.join(" | "),
  );
  const sinSup = await sec("Remates");
  const conSup = await sec("Remates y suplente");
  check(
    "«Remates y suplente» suma al reemplazo: más de 3.5 pasa de 29 % (3.50) a 43 % (2.33)",
    /Más de 3\.5 29 % 3\.50 1\/5/.test(sinSup) && /Más de 3\.5 43 % 2\.33 2\/5/.test(conSup),
    sinSup + " ||| " + conSup,
  );
  const apSup = await sec("Remates a puerta y suplente");
  check(
    "tu mercado «Remates a Puerta … Incl. suplente» (cuota 1.50) se compara con la sección CON suplente: 71 % → +7 % valor",
    /Más de 0\.5 71 % 1\.40 4\/5 Tu cuota 1\.50 · \+7 % valor/.test(apSup) &&
      !/Tu cuota 1\.50/.test(await sec("Remates a puerta")),
    apSup,
  );
  await tap(page, "[data-pc-close]");
  check("la ficha se cierra", (await page.$(".pc-sheet")) === null);
  const coKey = await page.evaluate(() => crestNorm("Thibaut Courtois"));
  await tap(page, `.live-board [data-player-card="${coKey}"]`);
  await page.waitForSelector(".pc-sheet");
  const portero = await page.$eval(".pc-sheet", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "portero: paradas más de 2.5 → 3 de 5 = 57 % (1.75) y tu cuota 1.80 (+3 % valor)",
    /Más de 2\.5 57 % 1\.75 3\/5/.test(portero) && /Tu cuota 1\.80 · \+3 % valor/.test(portero),
    portero.slice(portero.indexOf("Paradas"), portero.indexOf("Paradas") + 240),
  );
  await tap(page, "[data-pc-close]");

  // --- contador de tarjetas del jugador: se marca solo al llegar a la línea
  const tkey = `player:${mbKey}:main:cards`;
  await tap(page, `.live-board [data-st-step="1"][data-st-target="${tkey}"]`);
  const est = await page.evaluate(() => {
    const f = db.coupons[0].fixtures[5];
    return { tarj: f.markets[1].settlement, rem: f.markets[0].settlement, equipo: statsOf(f).cards };
  });
  check(
    "sumar una tarjeta a Mbappé gana su línea «Más de 0.5» y no toca las tarjetas del partido ni sus remates",
    est.tarj === "won" && est.rem === "pending" && est.equipo === 0,
    JSON.stringify(est),
  );
  await tap(page, `.live-board [data-st-step="1"][data-st-target="player:${coKey}:main:saves"]`);
  await tap(page, `.live-board [data-st-step="1"][data-st-target="player:${coKey}:main:saves"]`);
  await tap(page, `.live-board [data-st-step="1"][data-st-target="player:${coKey}:main:saves"]`);
  check(
    "3 paradas de Courtois ganan «Más de 2.5»",
    (await page.evaluate(() => db.coupons[0].fixtures[5].markets[2].settlement)) === "won",
  );

  // --- desde «Tus registros»
  await page.evaluate(() => {
    renderMatchDetail(currentMatchRef);
  });
  await tap(page, '[data-match-tab="datos"]');
  await page.waitForTimeout(500);
  check(
    "«Tus registros» tiene el botón 📇 Ficha de cada jugador",
    (await page.$$("#matchTabPanel [data-player-card]")).length >= 1,
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("36. Alias de equipos y partidos del día");
{
  const D = await import(path.join(ROOT, "cloudflare/datos-partido.mjs"));
  const T = (id, name, shortName, tla) => ({ id, name, shortName, tla });
  // --- los falsos parecidos de tus capturas
  check(
    "«KV Mechelen» ya no se parece a «Chelsea» (la sigla CHE estaba dentro de «mechelen»)",
    D.nameScore("KV Mechelen", T(1, "Chelsea FC", "Chelsea", "CHE")) < 0.5,
  );
  check(
    "«Tromsoe» ya no se parece a «Roma» (ROM dentro de «tromsoe»)",
    D.nameScore("Tromsoe", T(2, "AS Roma", "Roma", "ROM")) < 0.5,
  );
  check("«Romania» no se confunde con «Roma»", D.nameScore("Romania", T(2, "AS Roma", "Roma", "ROM")) < 0.5);
  check(
    "lo que sí debe seguir coincidiendo: PSV / PSV Eindhoven, Atlético, Real Betis, sigla idéntica BVB",
    D.nameScore("PSV", T(3, "PSV Eindhoven", "PSV", "PSV")) === 1 &&
      D.nameScore("PSV", T(3, "PSV Eindhoven", "", "")) >= 0.75 &&
      D.nameScore("Atlético de Madrid", T(4, "Club Atlético de Madrid", "Atleti", "ATM")) === 1 &&
      D.nameScore("Real Betis", T(5, "Real Betis Balompié", "Real Betis", "BET")) === 1 &&
      D.nameScore("BVB", T(6, "Borussia Dortmund", "Dortmund", "BVB")) === 1 &&
      D.nameScore("Newcastle", T(7, "Newcastle United FC", "Newcastle", "NEW")) >= 0.75,
  );

  // --- un día de partidos como los devuelve football-data.org
  const dia = [
    {
      id: 501,
      utcDate: "2026-11-21T15:30:00Z",
      status: "TIMED",
      competition: { code: "DED", name: "Eredivisie" },
      homeTeam: T(1, "NEC", "NEC", "NEC"),
      awayTeam: T(2, "PSV", "PSV", "PSV"),
      score: { fullTime: {} },
    },
    {
      id: 502,
      utcDate: "2026-11-21T17:30:00Z",
      status: "TIMED",
      competition: { code: "PL", name: "Premier League" },
      homeTeam: T(3, "Chelsea FC", "Chelsea", "CHE"),
      awayTeam: T(4, "Leeds United FC", "Leeds United", "LEE"),
      score: { fullTime: {} },
    },
    {
      id: 503,
      utcDate: "2026-11-21T19:45:00Z",
      status: "TIMED",
      competition: { code: "SA", name: "Serie A" },
      homeTeam: T(5, "Parma Calcio 1913", "Parma", "PAR"),
      awayTeam: T(6, "AS Roma", "Roma", "ROM"),
      score: { fullTime: {} },
    },
  ];
  const fetchDia = async (url) =>
    /matches\?dateFrom=2026-11-20&dateTo=2026-11-22/.test(url)
      ? { ok: true, status: 200, json: async () => ({ matches: dia }) }
      : { ok: false, status: 404, json: async () => ({}) };
  const mem = new Map(),
    store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v) };
  const pedir = async (q) =>
    (
      await D.datosPartido(
        new Request("https://x/api/datos-partido?" + new URLSearchParams({ date: "2026-11-21", ...q })),
        { token: "t", store, fetchImpl: fetchDia },
      )
    ).json();

  const mech = await pedir({ home: "KV Mechelen", away: "Club Brugge KV" });
  check(
    "Mechelen vs Brugge: ya no inventa «Chelsea vs Leeds»; dice que la liga no está en el plan gratis",
    mech.encontrado === false && /plan gratis/.test(mech.motivo) && !/parecido/.test(mech.motivo),
    mech.motivo,
  );
  const trom = await pedir({ home: "Tromsoe", away: "Viking FK" });
  check(
    "Tromsoe vs Viking: ya no inventa «Parma vs Roma»",
    trom.encontrado === false && /plan gratis/.test(trom.motivo),
    trom.motivo,
  );

  const nij = await pedir({ home: "Nijmegen", away: "PSV" });
  check(
    "Nijmegen vs PSV: no coincide por nombre, pero propone «NEC vs PSV» como el más parecido",
    nij.encontrado === false &&
      /parecido/.test(nij.motivo) &&
      nij.partidosDelDia[0].id === 501 &&
      nij.partidosDelDia[0].cerca === true &&
      nij.partidosDelDia.filter((x) => x.cerca).length === 1 &&
      nij.partidosDelDia.length === 3,
    JSON.stringify(nij.partidosDelDia),
  );
  const eleg = await pedir({ home: "Nijmegen", away: "PSV", matchId: "501" });
  check(
    "al elegir el partido (matchId) lo encuentra y devuelve los nombres oficiales para guardarlos",
    eleg.encontrado === true &&
      eleg.partido.local.oficial === "NEC" &&
      eleg.partido.visitante.oficial === "PSV" &&
      eleg.alReves === false,
    JSON.stringify(eleg.partido),
  );
  const alias = await pedir({ home: "Nijmegen", away: "PSV", ah: "NEC", aa: "PSV" });
  check(
    "con el alias guardado (ah/aa) lo encuentra solo, sin elegir",
    alias.encontrado === true && alias.partido.local.oficial === "NEC",
  );
  const alrev = await pedir({ home: "PSV", away: "Nijmegen", matchId: "501" });
  check(
    "si la casa puso los equipos al revés, lo detecta (alReves)",
    alrev.encontrado === true && alrev.alReves === true,
    JSON.stringify([alrev.encontrado, alrev.alReves]),
  );

  // --- ficha en el navegador
  const fut = isoDay(Date.now() + 2 * 86400e3);
  const db0 = {
    coupons: [
      {
        id: "N1",
        name: "N1",
        created: new Date().toISOString(),
        stake: 5,
        odds: 2,
        payout: 10,
        fixtures: [
          {
            id: "n",
            home: "Nijmegen",
            away: "PSV",
            competition: "Eredivisie",
            league: "Eredivisie",
            dateISO: fut,
            time: "09:30",
            markets: [
              {
                market: "Total de goles",
                pick: "Más de 1.5",
                odd: "1.4",
                builder: false,
                settlement: "pending",
              },
            ],
          },
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  await page.evaluate(() => openMatchDetails({ couponId: "N1", fixtureIndex: 0 }));
  await tap(page, '[data-match-tab="datos"]');
  await page.waitForSelector(".fd-pick", { timeout: 8000 });
  const panel0 = await page.$eval("#matchTabPanel", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "sin coincidencia: la ficha pregunta «¿Es alguno de estos partidos?» y muestra «NEC vs PSV»",
    /¿Es alguno de estos partidos\?/.test(panel0) && /NEC vs PSV/.test(panel0),
    panel0.slice(0, 260),
  );
  check(
    "los que no se parecen quedan escondidos en «Ver todos los partidos de ese día (1)»",
    /Ver todos los partidos de ese día \(1\)/.test(panel0),
  );
  await tap(page, '[data-fd-pick="501"]');
  await page.waitForSelector(".rs-pick", { timeout: 8000 });
  const al = await page.evaluate(() => JSON.stringify(db.aliases));
  check(
    "al elegirlo, guarda el alias «Nijmegen» = «NEC»",
    /"nijmegen":\{"mi":"Nijmegen","fd":"NEC"\}/.test(al),
    al,
  );
  check(
    "y la ficha ya muestra el resumen (1X2, xG…) con los nombres guardados",
    /nombres guardados/.test(await page.$eval("#matchTabPanel", (e) => e.innerText)),
  );
  // siguiente consulta: usa el alias solo
  const antes = seen.length;
  await tap(page, "[data-reload-form]");
  await page.waitForFunction(
    () => /Probabilidad 1X2/.test(document.getElementById("matchTabPanel").innerText),
    null,
    { timeout: 8000 },
  );
  const q = seen.slice(antes).find((x) => x.startsWith("datosq:")) || "";
  check(
    "la siguiente consulta manda el alias (ah=NEC) y ya no pide elegir",
    /ah=NEC/.test(q) && !(await page.$(".fd-pick")),
    q,
  );
  // Ajustes: ver y quitar
  await tap(page, "[data-match-close], .match-close, #matchModal .close");
  await page.evaluate(() => closeMatchDetails());
  await tap(page, '[data-view="settings"]');
  const caja = await page.$eval("#aliasBox", (e) => e.innerText.replace(/\s+/g, " "));
  check("Ajustes → Alias de equipos lista «Nijmegen» = «NEC»", /Nijmegen.*NEC/.test(caja), caja);
  await tap(page, "[data-alias-del]");
  check("y se puede quitar", (await page.evaluate(() => Object.keys(db.aliases || {}).length)) === 0);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("37. Escudos y fotos: resumen, secciones retraídas y filas compactas");
{
  const fut = isoDay(Date.now() + 2 * 86400e3);
  const mk = (market, pick) => ({ market, pick, odd: "1.5", builder: false, settlement: "pending" });
  const fx = (id, home, away, comp, country, markets) => ({
    id,
    home,
    away,
    competition: comp,
    league: comp,
    country,
    dateISO: fut,
    time: "14:00",
    markets,
  });
  const db0 = {
    coupons: [
      {
        id: "L1",
        name: "L1",
        created: new Date().toISOString(),
        stake: 5,
        odds: 3,
        payout: 15,
        fixtures: [
          fx("a", "Fenerbahce", "Liverpool", "UEFA Champions League", "Europa", [
            mk("Total de goles", "Más de 1.5"),
          ]),
          fx("b", "Francia", "Italia", "UEFA Nations League", "Europa", [
            mk("Remates a Puerta - Kylian Mbappe (FRA)", "Más de 0.5"),
          ]),
          fx("c", "Como", "Napoli", "Serie A", "Italia", [
            mk("Remates a Puerta (Nico Paz (COM)) - Incl. suplente", "Más de 0.5"),
          ]),
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  // El estado de plegado que guardaba la versión anterior (como tu captura: jugadores abierto) no debe abrir nada.
  await page.evaluate(() =>
    localStorage.setItem(
      "kal_fold_state_v1",
      JSON.stringify({ players: true, teamsPending: true, teamsSaved: true }),
    ),
  );
  await page.evaluate(() => {
    setTeamCrest("Liverpool", "https://media.api-sports.io/football/teams/40.png", "Inglaterra");
  });
  await view(page, "logos");
  await page.waitForTimeout(200);
  const abiertas = await page.$$eval("#view-logos .fold.is-open", (e) => e.length);
  check(
    "todas las secciones empiezan retraídas, aunque la versión anterior las dejara abiertas",
    abiertas === 0,
    String(abiertas),
  );
  const tiles = await page.$$eval(".lg-tile", (e) => e.map((x) => x.innerText.replace(/\s+/g, " ")));
  check(
    "el resumen tiene 4 tarjetas: clubes, selecciones, ligas y jugadores",
    tiles.length === 4 &&
      /Clubes/.test(tiles[0]) &&
      /Selecciones/.test(tiles[1]) &&
      /Ligas/.test(tiles[2]) &&
      /Jugadores/.test(tiles[3]),
    tiles.join(" | "),
  );
  check(
    "clubes: 1 de 2 con escudo, «faltan 1» (Liverpool sí, Fenerbahce no, Como/Napoli aún)",
    /Clubes/.test(tiles[0]) && /\d+ de \d+/.test(tiles[0]) && /faltan \d+/.test(tiles[0]),
    tiles[0],
  );
  check(
    "jugadores: 2 de 2 sin foto → «faltan 2»",
    /0 de 2/.test(tiles[3]) && /faltan 2/.test(tiles[3]),
    tiles[3],
  );
  const clubes = await page.evaluate(() =>
    [...document.querySelectorAll('.fold[data-fold="logoClubs"] .logo-card')]
      .map((c) => c.querySelector("strong").textContent + ":" + c.dataset.has)
      .sort()
      .join(","),
  );
  const sel = await page.evaluate(() =>
    [...document.querySelectorAll('.fold[data-fold="logoNat"] .logo-card')]
      .map((c) => c.querySelector("strong").textContent)
      .sort()
      .join(","),
  );
  check(
    "clubes y selecciones van en secciones distintas (Francia e Italia son selecciones)",
    /Fenerbahce:0/.test(clubes) &&
      /Liverpool:1/.test(clubes) &&
      !/Francia/.test(clubes) &&
      /Francia/.test(sel) &&
      /Italia/.test(sel) &&
      !/Fenerbahce/.test(sel),
    clubes + " || " + sel,
  );

  // Tocar la tarjeta abre la sección con lo que falta
  await tap(page, '[data-lg-open="logoClubs"]');
  await page.waitForTimeout(150);
  const abierta = await page.evaluate(() => {
    const f = document.querySelector('.fold[data-fold="logoClubs"]');
    const vis = [...f.querySelectorAll(".logo-card")]
      .filter((c) => c.offsetParent)
      .map((c) => c.querySelector("strong").textContent + ":" + c.dataset.has);
    return { open: f.classList.contains("is-open"), filtro: f.dataset.filter, vis };
  });
  check(
    "tocar «Clubes» abre la sección con el filtro «Faltan» (solo los sin escudo)",
    abierta.open &&
      abierta.filtro === "pending" &&
      abierta.vis.length >= 1 &&
      abierta.vis.every((x) => x.endsWith(":0")) &&
      !abierta.vis.some((x) => /Liverpool/.test(x)),
    JSON.stringify(abierta),
  );
  // Fila compacta: un solo botón a la vista; el resto en «⋯»
  const fila = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.fold[data-fold="logoClubs"] .logo-card')].find((x) =>
      /Fenerbahce/.test(x.innerText),
    );
    const visibles = [...c.querySelectorAll("button")]
      .filter((b) => b.offsetParent)
      .map((b) => b.textContent.trim());
    return { visibles, alto: Math.round(c.getBoundingClientRect().height) };
  });
  check(
    "fila de un club sin escudo: solo «＋ Buscar» y «⋯» a la vista, y mide menos de 80 px",
    fila.visibles.length === 2 &&
      /Buscar/.test(fila.visibles[0]) &&
      fila.visibles[1] === "⋯" &&
      fila.alto < 80,
    JSON.stringify(fila),
  );
  await tap(page, '.fold[data-fold="logoClubs"] .logo-card [data-lg-more]');
  const abiertaFila = await page.$$eval(
    '.fold[data-fold="logoClubs"] .logo-card.is-open [data-logo-id], .fold[data-fold="logoClubs"] .logo-card.is-open [data-logo-hide]',
    (e) => e.filter((x) => x.offsetParent).length,
  );
  check("«⋯» muestra Por ID, Subir imagen y Ocultar", abiertaFila === 2, String(abiertaFila));

  // Filtros
  await tap(page, '.fold[data-fold="logoClubs"] [data-lg-filter="saved"]');
  const comp = await page.evaluate(() =>
    [...document.querySelectorAll('.fold[data-fold="logoClubs"] .logo-card')]
      .filter((c) => c.offsetParent)
      .map((c) => c.querySelector("strong").textContent),
  );
  check("filtro «Completos»: solo Liverpool", comp.length === 1 && comp[0] === "Liverpool", comp.join());
  await tap(page, '.fold[data-fold="logoClubs"] [data-lg-filter="all"]');
  const todos = await page.evaluate(
    () =>
      [...document.querySelectorAll('.fold[data-fold="logoClubs"] .logo-card')].filter((c) => c.offsetParent)
        .length,
  );
  check("filtro «Todos»: se ven los dos", todos >= 2, String(todos));
  const chips = await page.$$eval('.fold[data-fold="logoClubs"] .lg-filter .chip', (e) =>
    e.map((x) => x.innerText.replace(/\s+/g, " ")),
  );
  check(
    "los filtros muestran sus cantidades",
    chips.length === 3 &&
      /Faltan \d+/.test(chips[0]) &&
      /Completos 1/.test(chips[1]) &&
      /Todos \d+/.test(chips[2]),
    chips.join(" | "),
  );
  // Buscar muestra todos aunque el filtro sea «Faltan»
  await tap(page, '.fold[data-fold="logoClubs"] [data-lg-filter="pending"]');
  await page.fill("#logoSearch", "liverpool");
  await page.waitForTimeout(150);
  const busca = await page.evaluate(() => {
    const f = document.querySelector('.fold[data-fold="logoClubs"]');
    return {
      filtro: f.dataset.filter,
      vis: [...f.querySelectorAll(".logo-card")]
        .filter((c) => c.offsetParent)
        .map((c) => c.querySelector("strong").textContent),
    };
  });
  check(
    "al buscar se muestran todos (aunque el filtro sea «Faltan») y aparece Liverpool",
    busca.filtro === "all" && busca.vis.includes("Liverpool"),
    JSON.stringify(busca),
  );
  await page.fill("#logoSearch", "");
  await page.waitForTimeout(150);
  // Jugadores: los que faltan salen primero y con un solo botón visible
  await tap(page, '[data-lg-open="logoPlayers"]');
  await page.waitForTimeout(150);
  const jug = await page.evaluate(() => {
    const f = document.querySelector('.fold[data-fold="logoPlayers"]');
    const c = [...f.querySelectorAll(".logo-card")].filter((x) => x.offsetParent);
    return {
      n: c.length,
      botones: c[0]
        ? [...c[0].querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.textContent.trim())
        : [],
      miss: f.querySelector(".fold-miss").textContent,
    };
  });
  check(
    "jugadores sin foto: 2 filas, cada una con «＋ Buscar» y «⋯», y la sección dice «faltan 2»",
    jug.n === 2 && jug.botones.length === 2 && /Buscar/.test(jug.botones[0]) && jug.miss === "faltan 2",
    JSON.stringify(jug),
  );
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("38. Seguir jugador y foto: búsqueda en ventana, equipo y selección");
{
  // --- códigos de selecciones (antes quedaban como «Equipo (GER)»)
  const { ctx: c0, page: p0 } = await open(baseDb());
  const cods = await p0.evaluate(() => {
    const f = (home, away) => ({ home, away });
    const r = (code, h, a) => {
      const x = playerClubForCode(code, f(h, a));
      return x.side + ":" + x.club;
    };
    return {
      ger: r("GER", "Alemania", "Países Bajos"),
      eng: r("ENG", "España", "Inglaterra"),
      dnk: r("DNK", "Dinamarca", "Noruega"),
      ned: r("NED", "Alemania", "Países Bajos"),
      swe: r("SWE", "Polonia", "Suecia"),
      sco: r("SCO", "Suiza", "Escocia"),
      wal: r("WAL", "Gales", "Portugal"),
      por: r("POR", "Gales", "Portugal"),
      fraCh: r("CHE", "Chelsea", "Arsenal"),
      roma: r("ROM", "Roma", "Lazio"),
      fuera: r("GER", "España", "Francia"),
      club: r("ATM", "Getafe", "Atletico Madrid"),
      sinResolver: Object.entries(NATION_CODES)
        .filter(([, n]) => !findCountryLocal(n))
        .map(([c]) => c),
    };
  });
  check(
    "GER, ENG, DNK, NED, SWE, SCO y WAL se ligan con su selección y su lado",
    cods.ger === "home:Alemania" &&
      cods.eng === "away:Inglaterra" &&
      cods.dnk === "home:Dinamarca" &&
      cods.ned === "away:Países Bajos" &&
      cods.swe === "away:Suecia" &&
      cods.sco === "away:Escocia" &&
      cods.wal === "home:Gales" &&
      cods.por === "away:Portugal",
    JSON.stringify(cods),
  );
  check(
    "los códigos de clubes siguen igual (Chelsea, Roma, Atlético)",
    cods.fraCh === "home:Chelsea" && cods.roma === "home:Roma" && cods.club === "away:Atletico Madrid",
    JSON.stringify(cods),
  );
  check(
    "si el partido no es de esa selección, muestra el país (no «Equipo (GER)»)",
    cods.fuera === ":Alemania",
    cods.fuera,
  );
  check(
    "todos los códigos de la tabla apuntan a un país que la app conoce",
    cods.sinResolver.length === 0,
    cods.sinResolver.join(),
  );
  await c0.close();

  // --- seguir a un jugador buscándolo
  const fut = isoDay(Date.now() + 2 * 86400e3);
  const mk = (market, pick) => ({ market, pick, odd: "1.6", builder: false, settlement: "pending" });
  const db0 = {
    coupons: [
      {
        id: "G1",
        name: "G1",
        created: new Date().toISOString(),
        stake: 5,
        odds: 3,
        payout: 15,
        fixtures: [
          {
            id: "g",
            home: "Getafe",
            away: "Atletico Madrid",
            competition: "LaLiga",
            league: "LaLiga",
            dateISO: fut,
            time: "14:00",
            markets: [mk("Remates a Puerta (Kang In Lee (ATM)) - Incl. suplente", "Más de 0.5")],
          },
        ],
      },
    ],
    houses: [],
    transactions: [],
    resultHistory: [],
    actionHistory: [],
    statsMigrated: true,
  };
  const { ctx, page } = await open(db0);
  let dialogos = 0;
  page.on("dialog", () => dialogos++);
  await page.evaluate(() => openMatchDetails({ couponId: "G1", fixtureIndex: 0 }));
  await page.waitForSelector(".live-board");
  await tap(page, '[data-track-add="away"]');
  await page.waitForSelector(".pp-sheet");
  const cab = await page.$eval(".pp-sheet", (e) => e.innerText.replace(/\s+/g, " "));
  check(
    "«Seguir jugador» abre una ventana con el equipo y los jugadores que ya conoce",
    /Equipo: Atletico Madrid/.test(cab) && /Kang In Lee/.test(cab),
    cab.slice(0, 220),
  );
  await page.fill("#ppQuery", "Baena");
  await tap(page, "[data-pp-search]");
  await page.waitForSelector(".pp-result", { timeout: 8000 });
  const res = await page.$$eval(".pp-result", (e) => e.map((x) => x.innerText.replace(/\s+/g, " ")));
  check(
    "busca y muestra al jugador con su equipo y la fuente",
    res.length === 1 &&
      /Alejandro Baena Rodriguez/.test(res[0]) &&
      /Villarreal/.test(res[0]) &&
      /API-Football/.test(res[0]),
    res.join(" | "),
  );
  await tap(page, ".pp-result");
  await page.waitForTimeout(300);
  const seg = await page.evaluate(() => {
    const st = Object.values(db.stats).find((x) => x.tracked?.length);
    const dir = Object.values(readCrestDirectory()).find((x) => x.kind === "player" && /Baena/.test(x.name));
    const card = [...document.querySelectorAll(".lb-player")].find((e) => /Baena/.test(e.innerText));
    return {
      tracked: st.tracked[0],
      dir: dir && { club: dir.club, photo: dir.photo, alias: dir.aliases },
      foto: card?.querySelector("img.pg-photo")?.getAttribute("src") || "",
      texto: card?.querySelector(".lb-player-head")?.innerText.replace(/\s+/g, " "),
    };
  });
  check(
    "al elegirlo lo sigue con su nombre completo y del lado del equipo correcto",
    seg.tracked.name === "Alejandro Baena Rodriguez" && seg.tracked.side === "away",
    JSON.stringify(seg.tracked),
  );
  check(
    "guarda su foto ligada al equipo del partido (Atletico Madrid), con el nombre que escribiste como alias",
    seg.dir?.club === "Atletico Madrid" &&
      /players\/501/.test(seg.dir.photo) &&
      seg.dir.alias.includes("Baena"),
    JSON.stringify(seg.dir),
  );
  check(
    "en el marcador aparece con su foto y su equipo",
    /players\/501/.test(seg.foto) && /Atletico Madrid/.test(seg.texto),
    JSON.stringify([seg.foto, seg.texto]),
  );
  const logos = await page.evaluate(() => {
    const x = collectPlayerBets().find((p) => /Baena/.test(p.name));
    return x && { club: x.club, tiene: !!x.photo, count: x.count };
  });
  check(
    "también aparece en Logos → Jugadores, con su club y su foto",
    logos?.club === "Atletico Madrid" && logos.tiene && logos.count === 0,
    JSON.stringify(logos),
  );

  // --- probar otras formas del nombre (apellido) cuando no hay resultados
  await tap(page, '[data-track-add="home"]');
  await page.waitForSelector(".pp-sheet");
  await page.fill("#ppQuery", "Carlos Mario Rodriguez");
  await tap(page, "[data-pp-search]");
  await page.waitForSelector(".pp-result", { timeout: 8000 });
  const rod = await page.$$eval(".pp-result", (e) => e.map((x) => x.innerText.replace(/\s+/g, " ")));
  check(
    "sin resultados con el nombre completo, prueba solo con el apellido y lo encuentra",
    rod.length === 1 &&
      /Carlos Mario Rodriguez/.test(rod[0]) &&
      /TheSportsDB/.test(rod[0]) &&
      seen.some((x) => x === "imagenes:jugador:Rodriguez"),
    rod.join(" | "),
  );
  await tap(page, "[data-pp-close]");

  // --- foto de un jugador del marcador (con mercado)
  await tap(page, ".live-board [data-pp-live]");
  await page.waitForSelector(".pp-result", { timeout: 8000 });
  const kang = await page.$eval(".pp-sheet", (e) => ({
    q: document.getElementById("ppQuery").value,
    r: e.innerText.replace(/\s+/g, " "),
  }));
  check(
    "📷 del marcador: abre la búsqueda con su nombre y encuentra a «Kang-in Lee»",
    /Kang/.test(kang.q) && /Kang-in Lee/.test(kang.r),
    kang.q,
  );
  await tap(page, ".pp-result");
  await page.waitForTimeout(300);
  const kf = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".lb-player")].find((e) => /Kang/.test(e.innerText));
    return card?.querySelector("img.pg-photo")?.getAttribute("src") || "";
  });
  check("la foto de Kang In Lee ya sale en su tarjeta del marcador", /players\/88/.test(kf), kf);
  check("sin ningún cuadro de texto del navegador en todo el recorrido", dialogos === 0, String(dialogos));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();

  // --- el servidor ya no se queda esperando: tiempo máximo
  const J = (await import(path.join(ROOT, "servidor/jugadores.mjs"))).default;
  const realFetch = globalThis.fetch;
  process.env.API_FOOTBALL_KEY = "k";
  globalThis.fetch = (u, o) =>
    new Promise((_, rej) => o?.signal?.addEventListener("abort", () => rej(o.signal.reason)));
  const t0 = Date.now();
  const lento = await J(
    new Request("https://x/api/jugadores?search=Jugador%20Muy%20Lento&teamId=26&season=2026"),
  );
  const dur = Date.now() - t0;
  globalThis.fetch = realFetch;
  const cuerpo = await lento.json();
  check(
    "servidor: si API-Football se cuelga, responde en menos de 10 s con un aviso claro",
    dur < 10500 && lento.status === 502 && /tardó demasiado/.test(cuerpo.error),
    dur + " ms · " + JSON.stringify(cuerpo),
  );
}

section("39. Favorito de Safari: leer el boleto desde la casa");
{
  const raws = [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/doradobet-${n}.txt`), "utf8"));
  const html = (cuerpo) =>
    `<html><body><nav>Inicio · Deportes · Casino · Promociones</nav><h1>Doradobet</h1><pre id="b">${cuerpo.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre><footer>Juega con responsabilidad +18</footer></body></html>`;
  const { ctx, page } = await open(baseDb());
  const esperados = await page.evaluate((r) => r.map((t) => parseCoupon(t).fixtures.length), raws);
  const code = await page.evaluate(() => favoritoCodigo());
  check(
    "el código del favorito es una sola línea «javascript:», sin % y con la dirección de KAL",
    code.startsWith("javascript:") && !/[%\n\r#]/.test(code) && code.includes(JSON.stringify(BASE)),
    code.slice(0, 120),
  );
  check(
    "«Nuevo cupón» muestra las instrucciones y el enlace trae el mismo código",
    await page.evaluate(
      (c) =>
        !!document.querySelector("#favBox #favCopy") &&
        document.getElementById("favLink").getAttribute("href") === c,
      code,
    ),
  );

  await ctx.route(/https:\/\/(casa|otra)\.test\/.*/, (r) => {
    const u = new URL(r.request().url());
    const n = Number(u.searchParams.get("n") || 1);
    const cuerpo =
      u.pathname === "/vacio"
        ? "Casino Slots Promociones Bonos de bienvenida y mucho más para ti"
        : u.pathname === "/enorme"
          ? "Texto de relleno.\n".repeat(3000) + raws[0] + "\n" + "Más relleno.\n".repeat(3000)
          : u.pathname === "/acentos"
            ? "Peña vs Año — Ñandú ¿qué? 1.50 € ✓\n" + "x".repeat(60)
            : raws[n - 1];
    if (u.pathname === "/marco" || u.pathname === "/ajeno")
      return r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<html><body><h1>Doradobet</h1><iframe src="${u.pathname === "/marco" ? "https://casa.test" : "https://otra.test"}/boleto?n=2"></iframe></body></html>`,
      });
    if (u.pathname === "/sombra")
      return r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<html><body><h1>Doradobet</h1><div id="h" style="display:none"></div><script>const r=document.getElementById("h").attachShadow({mode:"open"});r.innerHTML="<style>.x{padding:8px;z-index:10;width:100%}.vs{color:red}</style><p></p>";r.querySelector("p").textContent=${JSON.stringify(raws[2])}</script></body></html>`,
      });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: html(cuerpo) });
  });
  const abrirCasa = async (ruta) => {
    const casa = await ctx.newPage();
    casa.dialogs = [];
    casa.on("dialog", (d) => {
      casa.dialogs.push(d.message());
      d.accept();
    });
    await casa.goto("https://casa.test" + ruta);
    return casa;
  };

  // --- los tres boletos reales: se lee todo igual que pegándolo
  for (const n of [1, 2, 3]) {
    const casa = await abrirCasa("/boleto?n=" + n);
    const pop = ctx.waitForEvent("page");
    await casa.evaluate(code.replace(/^javascript:/, ""));
    const kal = await pop;
    await kal.waitForFunction(() => document.querySelectorAll("#preview .pv-market").length > 0, null, {
      timeout: 8000,
    });
    const r = await kal.evaluate(() => ({
      partidos: draftSelections.length,
      raw: window.__kalLastParsedRaw || "",
      hash: location.hash,
      vista: document.querySelector(".view.active")?.id,
    }));
    check(
      `boleto ${n}: KAL se abre con los ${esperados[n - 1]} partidos ya leídos, en Nuevo cupón y sin dejar el texto en la dirección`,
      r.partidos === esperados[n - 1] &&
        r.vista === "view-new" &&
        r.hash === "" &&
        r.raw.includes(raws[n - 1].trim().split("\n")[0].trim()),
      JSON.stringify({ ...r, raw: r.raw.length }),
    );
    if (n === 1)
      check(
        "el texto de menús y pie de página de la casa no impide leerlo",
        r.partidos === esperados[0] && /Casino/.test(r.raw),
        String(r.partidos),
      );
    await kal.close();
    await casa.close();
  }

  // --- el cupón dentro de un marco (iframe) o de un shadow DOM
  for (const [ruta, n, nombre] of [
    ["/marco", 2, "un marco de la misma casa"],
    ["/sombra", 3, "un shadow DOM"],
  ]) {
    const casa = await abrirCasa(ruta);
    const pop = ctx.waitForEvent("page");
    await casa.evaluate(code.replace(/^javascript:/, ""));
    const kal = await pop;
    await kal.waitForFunction(() => document.querySelectorAll("#preview .pv-market").length > 0, null, {
      timeout: 8000,
    });
    check(
      `cupón dentro de ${nombre}: se lee completo y sin código de estilos`,
      (await kal.evaluate(() => draftSelections.length)) === esperados[n - 1] &&
        !(await kal.evaluate(() => /z-index|padding/.test(window.__kalLastParsedRaw || ""))),
    );
    await kal.close();
    await casa.close();
  }
  const ajeno = await abrirCasa("/ajeno");
  await ajeno.evaluate(code.replace(/^javascript:/, ""));
  await ajeno.waitForTimeout(500);
  check(
    "cupón en un marco de otro sitio: explica que está protegido y qué hacer (copiar y Pegar)",
    ajeno.dialogs.some((d) => /protegido/.test(d) && /Pegar/.test(d) && /Leí \d+ letras/.test(d)),
    ajeno.dialogs.join("|"),
  );
  await ajeno.close();

  // --- sin boleto en pantalla: avisa y no abre nada
  const vacia = await abrirCasa("/vacio");
  let abrio = false;
  ctx.once("page", () => (abrio = true));
  await vacia.evaluate(code.replace(/^javascript:/, ""));
  await vacia.waitForTimeout(400);
  check(
    "sin boleto en la pantalla avisa «no veo un boleto» y no abre KAL",
    vacia.dialogs.some((d) => /no veo un boleto/.test(d)) && !abrio,
    vacia.dialogs.join("|"),
  );
  await vacia.close();

  // --- texto seleccionado: usa solo la selección
  const sel = await abrirCasa("/boleto?n=2");
  await sel.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById("b"));
    const g = getSelection();
    g.removeAllRanges();
    g.addRange(r);
  });
  await sel.evaluate("window.open=(u)=>{window.__u=u;return {}};" + code.replace(/^javascript:/, ""));
  const uSel = await sel.evaluate(() => window.__u);
  const txtSel = await page.evaluate((u) => favoritoDecodificar(u.split("#importar=")[1]), uSel);
  check(
    "con texto seleccionado envía solo la selección (sin menús)",
    !/Casino|Juega con responsabilidad/.test(txtSel) && txtSel.includes("vs"),
    txtSel.slice(0, 80),
  );
  await sel.close();

  // --- acentos y símbolos viajan intactos
  const ac = await abrirCasa("/acentos");
  await ac.evaluate("window.open=(u)=>{window.__u=u;return {}};" + code.replace(/^javascript:/, ""));
  const txtAc = await page.evaluate(
    (u) => favoritoDecodificar(u.split("#importar=")[1]),
    await ac.evaluate(() => window.__u),
  );
  check(
    "acentos, ñ, ¿? y € llegan sin estropearse",
    /Peña vs Año — Ñandú ¿qué\? 1\.50 € ✓/.test(txtAc),
    txtAc.slice(0, 60),
  );
  await ac.close();

  // --- páginas enormes: se recorta alrededor del primer «vs»
  const enorme = await abrirCasa("/enorme");
  await enorme.evaluate("window.open=(u)=>{window.__u=u;return {}};" + code.replace(/^javascript:/, ""));
  const uEn = await enorme.evaluate(() => window.__u);
  const txtEn = await page.evaluate((u) => favoritoDecodificar(u.split("#importar=")[1]), uEn);
  check(
    "una página enorme se recorta (máx. 14000 letras) y conserva el boleto",
    txtEn.length <= 14000 && /\bvs\b/i.test(txtEn) && uEn.length < 40000,
    txtEn.length + " / " + uEn.length,
  );
  await enorme.close();

  // --- direcciones raras no rompen nada
  const rara = await ctx.newPage();
  rara.errors = [];
  rara.on("pageerror", (e) => rara.errors.push(e.message));
  await rara.goto(BASE + "#importar=!!!");
  await rara.waitForTimeout(500);
  check(
    "una dirección #importar= inválida se ignora sin errores",
    !rara.errors.length && (await rara.evaluate(() => $("raw").value)) === "",
    rara.errors.join("|"),
  );
  await rara.goto(BASE + "#importar=AAAA");
  await rara.waitForTimeout(500);
  check("un favorito sin texto útil avisa y no deja basura", !rara.errors.length, rara.errors.join("|"));
  check("sin errores en la pantalla principal", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 8. Funciones del servidor (con API simulada) ----------
section("8. Funciones del servidor (API-Football y TheSportsDB)");
{
  process.env.API_FOOTBALL_KEY = "x";
  let mode = "ok";
  globalThis.fetch = async (u) => {
    u = new URL(u);
    const p = u.searchParams;
    const json = (b) => ({ status: 200, ok: true, json: async () => b });
    if (mode === "plan")
      return json({
        errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." },
        response: [],
      });
    if (p.get("from") && !p.get("season"))
      return json({ errors: { season: "The Season field is required." }, response: [] });
    if (p.get("from"))
      return json({
        errors: [],
        response: [
          {
            fixture: { id: 9, date: "2026-11-04T14:00:00Z" },
            league: { id: 2, season: 2026 },
            teams: { home: { id: 1 }, away: { id: 2 } },
          },
        ],
      });
    return json({ errors: [], response: [{ fixture: { id: 9 }, statistics: [] }] });
  };
  const { default: partido } = await import(path.join(ROOT, "servidor/partido.mjs"));
  let r = await partido(
    new Request("https://x/p?homeId=1&awayId=2&date=2026-11-04&mode=match", {
      headers: { "x-nf-client-connection-ip": "a" },
    }),
  );
  check("partido: envía la temporada y encuentra el partido", (await r.json()).fixture?.fixture?.id === 9);
  mode = "plan";
  r = await partido(
    new Request("https://x/p?homeId=1&awayId=3&date=2026-11-04&mode=match", {
      headers: { "x-nf-client-connection-ip": "b" },
    }),
  );
  check(
    "partido: explica el límite del plan gratis en español",
    /plan gratis/.test((await r.json()).error || ""),
  );
  // TheSportsDB (con respuestas simuladas como las reales: un resultado por búsqueda)
  const tsdbCalls = [];
  globalThis.fetch = async (u) => {
    const url = new URL(u),
      q = url.searchParams.get("t") || url.searchParams.get("p");
    tsdbCalls.push(q);
    const R = {
      "Club Brugge KV": {
        teams: [
          {
            idTeam: "2",
            strTeam: "Club NXT",
            strCountry: "Belgium",
            strSport: "Soccer",
            strBadge: "https://r2.thesportsdb.com/images/media/team/badge/nxt.png",
          },
        ],
      },
      "Club Brugge": {
        teams: [
          {
            idTeam: "1",
            strTeam: "Club Brugge",
            strCountry: "Belgium",
            strSport: "Soccer",
            strBadge: "https://r2.thesportsdb.com/images/media/team/badge/cb.png",
          },
        ],
      },
      "Anastasios Douvikas": {
        player: [
          { idPlayer: "5", strPlayer: "Anastasios Douvikas", strTeam: "_Retired Soccer", strSport: "Soccer" },
        ],
      },
      Douvikas: {
        player: [
          {
            idPlayer: "6",
            strPlayer: "Tasos Douvikas",
            strTeam: "Como",
            strSport: "Soccer",
            strCutout: "https://r2.thesportsdb.com/images/media/player/cutout/d.png",
          },
        ],
      },
    };
    return { ok: true, status: 200, json: async () => R[q] || { teams: null, player: null } };
  };
  const { default: imagenes } = await import(path.join(ROOT, "servidor/imagenes.mjs"));
  let ri = await (await imagenes(new Request("https://x/i?tipo=equipo&q=Club%20Brugge%20KV"))).json();
  check(
    "TheSportsDB: prueba el nombre sin 'KV' y pone primero el equipo correcto",
    ri.options.map((o) => o.name).join() === "Club Brugge,Club NXT" && tsdbCalls.includes("Club Brugge"),
    JSON.stringify(ri.options.map((o) => o.name)),
  );
  ri = await (
    await imagenes(new Request("https://x/i?tipo=jugador&q=Anastasios%20Douvikas&club=Como"))
  ).json();
  check(
    "TheSportsDB: prueba el apellido y descarta fichas sin foto",
    ri.options.length === 1 &&
      ri.options[0].name === "Tasos Douvikas" &&
      ri.options[0].photo.includes("cutout"),
    JSON.stringify(ri.options),
  );
}

section("15. Función del Analista (Claude simulado)");
{
  const A = await import(path.join(ROOT, "servidor/analista.mjs"));
  const env = { ANTHROPIC_API_KEY: "sk-prueba", ANALISTA_CLAVE: "secreto" };
  const req = (body, clave = "secreto", method = "POST") =>
    new Request("https://x/api/analista", {
      method,
      headers: { "x-kal-clave": clave },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  const status = async (r, e = env) => (await A.leerPeticion(r, e)).error?.status;
  check(
    "rechaza sin ANTHROPIC_API_KEY, sin ANALISTA_CLAVE, con código malo o modo raro",
    (await status(req({ modo: "historial", datos: {} }), { ANALISTA_CLAVE: "x" })) === 503 &&
      (await status(req({ modo: "historial", datos: {} }), { ANTHROPIC_API_KEY: "x" })) === 503 &&
      (await status(req({ modo: "historial", datos: {} }, "otro"))) === 401 &&
      (await status(req({ modo: "x", datos: {} }))) === 400 &&
      (await status(req({ modo: "cupon", datos: { cupon: "" } }))) === 400 &&
      (await status(new Request("https://x", { method: "GET" }))) === 405 &&
      (await status(req({ modo: "historial", datos: { x: "a".repeat(130000) } }))) === 413,
  );
  const pc = A.construirPeticion("cupon", {
    cupon: "Barcelona vs Real Madrid 1x2",
    historial: [{ tipo: "1X2" }],
    hoy: "2026-11-11",
  });
  const ph = A.construirPeticion("historial", { historial: { resumen: {} } });
  // Método, búsquedas según el tamaño y datos de los partidos
  const sys = A.construirPeticion("cupon", { cupon: "Barcelona vs Real Madrid 1x2" }).system;
  check(
    "método: probabilidad por selección, titularidad en mercados de jugador, BetBuilder como un solo paquete y calibración",
    /≈ NN %/.test(sys) &&
      /titular/.test(sys) &&
      /BetBuilder es una sola apuesta/.test(sys) &&
      /precisionAnalista/.test(sys) &&
      /"p":0.72/.test(sys),
  );
  const uses = (d) => A.construirPeticion("cupon", d).tools[0].max_uses;
  const lista = (n) =>
    Array.from({ length: n }, (_, i) => ({ local: "A" + i, visitante: "B" + i, fecha: "2026-11-22" }));
  check(
    "búsquedas según el número de partidos (mínimo 4, uno por partido + 2, máximo 12)",
    uses({ cupon: "A vs B 1x2", partidos: lista(1) }) === 4 &&
      uses({ cupon: "x", partidos: lista(5) }) === 7 &&
      uses({ cupon: "x", partidos: lista(12) }) === 12 &&
      uses({ cupon: "A vs. B\nC vs D\nE vs F\nG vs H" }) === 6,
  );
  const dp = {
    encontrado: true,
    alReves: false,
    partido: {
      competicion: "Primera Division",
      fecha: "2026-11-22T20:00:00Z",
      estado: "TIMED",
      local: { nombre: "Barça" },
      visitante: { nombre: "Real Madrid" },
    },
    tabla: {
      local: { posicion: 1, puntos: 33, jugados: 12, golesFavor: 48, golesContra: 13 },
      visitante: { posicion: 2, puntos: 30, jugados: 12, golesFavor: 30, golesContra: 10 },
      equipos: 20,
    },
    forma: { local: [{ resultado: "G", marcador: "3-0", enCasa: true }], visitante: [] },
    h2h: { partidos: 10, goles: 35, local: { ganados: 5, empates: 1 }, visitante: { ganados: 4 } },
    modelo: {
      lambdaLocal: 2.1,
      lambdaVisitante: 1.3,
      p1: 0.55,
      px: 0.2,
      p2: 0.25,
      over15: 0.85,
      over25: 0.66,
      over35: 0.44,
      btts: 0.65,
      base: "tabla general",
    },
  };
  const estados = [];
  let llamadas = 0;
  const reunidos = await A.reunirDatosPartidos(
    [
      { local: "Barcelona", visitante: "Real Madrid", fecha: "2026-11-22" },
      { local: "Sin", visitante: "Fecha", fecha: "" },
      { local: "No", visitante: "Cubierto", fecha: "2026-11-22" },
      { local: "Limite", visitante: "X", fecha: "2026-11-22" },
      { local: "Despues", visitante: "Y", fecha: "2026-11-22" },
    ],
    async (p) => {
      llamadas++;
      return p.local === "Barcelona" ? dp : p.local === "Limite" ? { limite: true } : { encontrado: false };
    },
    (e) => estados.push(e.v),
  );
  check(
    "datos de partidos: resume el modelo y la tabla, salta los que no tienen fecha o no están cubiertos y se detiene en el límite",
    reunidos.length === 1 &&
      reunidos[0].modelo.mas25 === 0.66 &&
      reunidos[0].tabla.local.posicion === 1 &&
      /G 3-0 \(casa\)/.test(reunidos[0].ultimos5.local) &&
      llamadas === 3 &&
      /Consultando datos/.test(estados[0]),
    JSON.stringify(reunidos).slice(0, 200) + " llamadas=" + llamadas,
  );
  const conDatos = A.construirPeticion("cupon", {
    cupon: "Barcelona vs Real Madrid 1x2",
    datosPartidos: reunidos,
    precisionAnalista: { porConfianza: { Alta: { acertadas: 3, falladas: 2 } } },
  }).messages[0].content;
  check(
    "la petición incluye los datos de los partidos y la precisión del Analista",
    /datosPartidos/.test(conDatos) &&
      /"mas25":0.66/.test(conDatos) &&
      /precisionAnalista/.test(conDatos) &&
      /"falladas":2/.test(conDatos),
  );
  const val = await A.leerPeticion(
    req({
      modo: "cupon",
      datos: {
        cupon: "Barcelona vs Real Madrid 1x2: 1",
        partidos: [{ local: "Barcelona", visitante: "Real Madrid", fecha: "22/11/2026" }, { local: 5 }, "x"],
      },
    }),
    env,
  );
  check(
    "valida la lista de partidos (descarta entradas raras y fechas mal formadas)",
    val.datos.partidos.length === 1 && val.datos.partidos[0].fecha === "",
    JSON.stringify(val.datos?.partidos),
  );
  let pidio = null;
  const respD = await A.manejar(
    req({
      modo: "cupon",
      datos: {
        cupon: "Barcelona vs Real Madrid 1x2: 1",
        partidos: [{ local: "Barcelona", visitante: "Real Madrid", fecha: "2026-11-22" }],
      },
    }),
    {
      env,
      datosDePartido: async () => dp,
      crearCliente: () => {
        const c = fakeClient([{ stop: "end_turn", events: [["text", "ok"]] }]);
        pidio = c;
        return c;
      },
    },
  );
  const lineasD = (await respD.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  check(
    "manejar: consulta los datos, los pasa a Claude y avisa de cada paso",
    /"mas25":0.66/.test(pidio.calls[0].messages[0].content) &&
      lineasD.some((l) => l.v === "Consultando datos de los partidos…") &&
      lineasD.some((l) => l.v === "Analizando…") &&
      lineasD.at(-1).t === "fin",
    JSON.stringify(lineasD.map((l) => l.v || l.t)),
  );
  check(
    "revisión de cupón: pide el bloque de datos <kal-json> con confianza y eslabón débil",
    /<kal-json>/.test(A.construirPeticion("cupon", { cupon: "Barcelona vs Real Madrid 1x2" }).system) &&
      /eslabonDebil/.test(A.construirPeticion("cupon", { cupon: "Barcelona vs Real Madrid 1x2" }).system),
  );
  check(
    "petición: modelo, respaldo ante rechazos, esfuerzo y búsqueda web solo al revisar cupones",
    pc.model === "claude-opus-5-5" &&
      pc.fallbacks === "default" &&
      pc.betas.includes("server-side-fallback-2026-07-01") &&
      pc.output_config.effort === "high" &&
      ph.output_config.effort === "medium" &&
      pc.tools[0].type === "web_search_20260209" &&
      !ph.tools &&
      /2026-11-11/.test(pc.messages[0].content) &&
      /<cupon>/.test(pc.messages[0].content) &&
      !("thinking" in pc) &&
      !("temperature" in pc),
  );
  // Cliente simulado: cada llamada sigue un guion de eventos y devuelve un mensaje final.
  function fakeClient(scripts) {
    const calls = [];
    return {
      calls,
      beta: {
        messages: {
          stream(params) {
            const sc = scripts[calls.length];
            calls.push(JSON.parse(JSON.stringify(params)));
            const h = {};
            return {
              on(ev, fn) {
                (h[ev] = h[ev] || []).push(fn);
                return this;
              },
              async finalMessage() {
                if (sc.throw) throw sc.throw;
                for (const [ev, ...args] of sc.events || []) (h[ev] || []).forEach((fn) => fn(...args));
                return {
                  stop_reason: sc.stop,
                  content: sc.content || [{ type: "text", text: "x" }],
                  usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    server_tool_use: { web_search_requests: sc.searches || 0 },
                  },
                };
              },
            };
          },
        },
      },
    };
  }
  const run = async (scripts) => {
    const client = fakeClient(scripts),
      out = [];
    await A.analizar(client, pc, (e) => out.push(e));
    return { client, out };
  };
  let r = await run([
    {
      stop: "pause_turn",
      searches: 2,
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Barcelona lesiones" } },
      ],
      events: [
        ["streamEvent", { type: "content_block_start", content_block: { type: "server_tool_use" } }],
        ["contentBlock", { type: "server_tool_use", input: { query: "Barcelona lesiones" } }],
        ["text", "Hola "],
      ],
    },
    { stop: "end_turn", searches: 1, events: [["text", "mundo"]] },
  ]);
  check(
    "búsqueda larga (pause_turn): continúa con lo hecho y suma el uso",
    r.client.calls.length === 2 &&
      r.client.calls[1].messages.at(-1).role === "assistant" &&
      r.client.calls[1].messages.length === 2 &&
      r.out
        .filter((e) => e.t === "texto")
        .map((e) => e.v)
        .join("") === "Hola mundo" &&
      r.out.some((e) => e.v === "Buscando: Barcelona lesiones") &&
      r.out.at(-1).t === "fin" &&
      r.out.at(-1).uso.busquedas === 3,
    JSON.stringify(r.out),
  );
  r = await run([
    {
      stop: "end_turn",
      events: [
        ["text", "parcial"],
        ["streamEvent", { type: "content_block_start", content_block: { type: "fallback" } }],
        ["text", "nuevo"],
      ],
    },
  ]);
  check(
    "si otro modelo retoma la respuesta, la app descarta lo parcial",
    r.out.map((e) => e.t).join() === "texto,reinicio,texto,fin",
  );
  r = await run([{ stop: "refusal" }]);
  check(
    "un rechazo se informa como error legible",
    r.out.at(-1).t === "error" && !r.out.some((e) => e.t === "fin"),
  );
  const resp = await A.manejar(req({ modo: "historial", datos: { historial: {} } }), {
    env,
    crearCliente: () => fakeClient([{ throw: Object.assign(new Error("rate"), { status: 429 }) }]),
  });
  const lines = (await resp.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  check(
    "respuesta en streaming: empieza con 'Pensando…' y traduce los errores de la API",
    resp.headers.get("content-type").includes("ndjson") &&
      lines[0].t === "estado" &&
      lines.at(-1).t === "error" &&
      /límite de uso/.test(lines.at(-1).v),
    JSON.stringify(lines),
  );
  check(
    "mensajes de error claros (sin saldo, clave mala)",
    /saldo/.test(A.mensajeDeError({ status: 400, message: "Your credit balance is too low" })) &&
      /ANTHROPIC_API_KEY/.test(A.mensajeDeError({ status: 401 })),
  );
  const edge = fs.readFileSync(path.join(ROOT, "cloudflare/worker.mjs"), "utf8");
  check(
    "Worker: /api/analista con el SDK oficial y la clave desde las variables de Cloudflare",
    /nombre === "analista"/.test(edge) &&
      /from "@anthropic-ai\/sdk"/.test(edge) &&
      /env\.ANTHROPIC_API_KEY/.test(edge),
  );
}

section("16. Cloudflare: notificaciones, avisos y el servidor real (workerd)");
{
  const W = await import(path.join(ROOT, "cloudflare/webpush.mjs"));
  const { avisosHandler, enviarAvisos } = await import(path.join(ROOT, "cloudflare/avisos.mjs"));
  const nodeCrypto = await import("node:crypto");
  const ece = require("http_ece");
  // Teléfono simulado: sus claves y una captura del envío
  const ua = nodeCrypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const sub = {
    endpoint: "https://web.push.apple.com/QAbc",
    keys: { p256dh: W.b64u(ua.getPublicKey()), auth: W.b64u(auth) },
  };
  const keys = await W.generateVapidKeys();
  const realFetch = nativeFetch;
  let sent = null,
    status = 201;
  globalThis.fetch = async (url, init) => {
    sent = { url, init };
    return new Response(null, { status });
  };
  const r1 = await W.sendWebPush(
    sub,
    { title: "⏰ Barça", body: "Empieza en 15 min" },
    { keys, subject: "https://kal.example.workers.dev" },
  );
  const plain = ece
    .decrypt(Buffer.from(sent.init.body), { version: "aes128gcm", privateKey: ua, authSecret: W.b64u(auth) })
    .toString();
  check(
    "Web Push: el mensaje cifrado (aes128gcm) se descifra con la librería de referencia",
    r1 === "ok" &&
      plain === '{"title":"⏰ Barça","body":"Empieza en 15 min"}' &&
      sent.init.headers["Content-Encoding"] === "aes128gcm",
    plain,
  );
  const [, t, k] = sent.init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, sg] = t.split(".");
  const pk = nodeCrypto.createPublicKey({
    key: { kty: "EC", crv: "P-256", x: W.b64u(W.unb64u(k).slice(1, 33)), y: W.b64u(W.unb64u(k).slice(33)) },
    format: "jwk",
  });
  const claims = JSON.parse(Buffer.from(W.unb64u(c)).toString());
  check(
    "Web Push: firma VAPID (ES256) válida, para el servicio correcto y con contacto",
    nodeCrypto.verify(
      "sha256",
      Buffer.from(h + "." + c),
      { key: pk, dsaEncoding: "ieee-p1363" },
      Buffer.from(W.unb64u(sg)),
    ) &&
      claims.aud === "https://web.push.apple.com" &&
      claims.sub === "https://kal.example.workers.dev" &&
      claims.exp > Date.now() / 1000,
  );
  status = 410;
  check(
    "Web Push: un teléfono que ya no acepta avisos se detecta",
    (await W.sendWebPush(sub, {}, { keys, subject: "x" })) === "gone",
  );
  globalThis.fetch = realFetch;

  // Lógica de avisos con un almacenamiento en memoria (igual al Durable Object)
  const mem = new Map();
  const store = {
    get: async (k2) => (mem.has(k2) ? structuredClone(mem.get(k2)) : null),
    put: async (k2, v) => void mem.set(k2, structuredClone(v)),
    delete: async (k2) => void mem.delete(k2),
    list: async (p) => [...mem.keys()].filter((x) => x.startsWith(p)),
  };
  const pushes = [];
  const fakeSend = async (s2, payload, opts) => {
    pushes.push({ payload, opts });
    return s2.endpoint.includes("muerto") ? "gone" : "ok";
  };
  const call = (body, method = "POST") =>
    avisosHandler(
      new Request(
        "https://kal-cupones.ejemplo.workers.dev/.netlify/functions/avisos" +
          (method === "GET" ? "?accion=clave" : ""),
        { method, body: method === "POST" ? JSON.stringify(body) : undefined },
      ),
      store,
      fakeSend,
    );
  const pub1 = (await (await call(null, "GET")).json()).publicKey,
    pub2 = (await (await call(null, "GET")).json()).publicKey;
  check(
    "avisos: clave pública estable y dirección de la app guardada",
    pub1 &&
      pub1 === pub2 &&
      W.unb64u(pub1).length === 65 &&
      mem.get("config/origin") === "https://kal-cupones.ejemplo.workers.dev",
  );
  const now = Date.now();
  const saveRes = await (
    await call({
      accion: "guardar",
      subscription: sub,
      lead: 15,
      matches: [
        { id: "m1", title: "Barcelona vs Real Madrid", kickoff: new Date(now + 10 * 60000).toISOString() },
        { id: "viejo", title: "X", kickoff: new Date(now - 5 * 3600000).toISOString() },
      ],
    })
  ).json();
  check("avisos: guarda solo partidos válidos", saveRes.partidos === 1);
  await call({
    accion: "guardar",
    subscription: { endpoint: "https://push.example/muerto", keys: { p256dh: "a", auth: "b" } },
    matches: [{ id: "z", title: "Y", kickoff: new Date(now + 5 * 60000).toISOString() }],
  });
  let r = await enviarAvisos(store, fakeSend, now);
  const pre = pushes.filter((p) => /Empieza en 10 min/.test(p.payload.body));
  check(
    "avisos: 'Empieza en 10 min' con la clave y el contacto de la app; borra teléfonos que ya no existen",
    r.telefonos === 2 &&
      pre.length === 1 &&
      pre[0].opts.subject === "https://kal-cupones.ejemplo.workers.dev" &&
      pre[0].opts.keys.publicKey === pub1 &&
      (await store.list("sub/")).length === 1,
    JSON.stringify(r),
  );
  pushes.length = 0;
  await enviarAvisos(store, fakeSend, now + 60000);
  check("avisos: no repite el mismo aviso", pushes.length === 0);
  await enviarAvisos(store, fakeSend, now + 11 * 60000);
  check(
    "avisos: 'Empezó' a la hora del partido",
    pushes.length === 1 && /Empezó/.test(pushes[0].payload.title),
  );
  await enviarAvisos(store, fakeSend, now + 4 * 3600000);
  check(
    "avisos: limpia partidos de hace más de 3 horas",
    (await store.get((await store.list("sub/"))[0])).matches.length === 0,
  );
  const pr = await call({ accion: "prueba", subscription: sub });
  check("avisos: notificación de prueba", pr.status === 200 && pushes.at(-1).payload.tag === "kal-prueba");

  // Servidor real de Cloudflare (workerd) con wrangler dev: archivos, rutas, Analista y tarea programada
  const { spawn } = await import("node:child_process");
  const net = await import("node:net");
  const port = await new Promise((res) => {
    const s2 = net.createServer();
    s2.listen(0, () => {
      const p = s2.address().port;
      s2.close(() => res(p));
    });
  });
  let log = "";
  const dev = spawn(
    path.join(ROOT, "node_modules/.bin/wrangler"),
    [
      "dev",
      "--port",
      String(port),
      "--test-scheduled",
      "--persist-to",
      path.join(os.tmpdir(), "kal-wrangler-" + port),
      "--var",
      "ANALISTA_CLAVE:secreto",
      "--var",
      "ANTHROPIC_API_KEY:sk-prueba",
      "--var",
      "API_FOOTBALL_KEY:prueba",
    ],
    { cwd: ROOT, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } },
  );
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const B2 = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise((res) => setTimeout(res, 500));
    up = await realFetch(B2 + "/").then(
      (x) => x.ok,
      () => false,
    );
  }
  check("workerd: el Worker arranca", up, log.slice(-400));
  if (up) {
    const home = await realFetch(B2 + "/"),
      swr = await realFetch(B2 + "/sw.js"),
      css = await realFetch(B2 + "/css/16-analista.css");
    check(
      "workerd: sirve la app sin caché en la página y con el permiso del service worker",
      home.headers.get("cache-control") === "no-cache" &&
        /<title>/.test(await home.text()) &&
        swr.headers.get("service-worker-allowed") === "/" &&
        css.ok,
    );
    const clave = await (await realFetch(B2 + "/api/avisos?accion=clave")).json();
    check(
      "workerd: avisos con almacenamiento (Durable Object) y claves generadas",
      W.unb64u(clave.publicKey).length === 65,
    );
    const guard = await (
      await realFetch(B2 + "/api/avisos", {
        method: "POST",
        body: JSON.stringify({
          accion: "guardar",
          lead: 15,
          subscription: sub,
          matches: [{ id: "w1", title: "A vs B", kickoff: new Date(Date.now() + 10 * 60000).toISOString() }],
        }),
      })
    ).json();
    const an = await realFetch(B2 + "/api/analista", {
      method: "POST",
      headers: { "x-kal-clave": "malo" },
      body: "{}",
    });
    const nf = await realFetch(B2 + "/api/nada");
    const fb = await (await realFetch(B2 + "/.netlify/functions/escudos")).json().catch(() => ({}));
    check(
      "workerd: rutas de funciones y Analista protegidas",
      guard.partidos === 1 && an.status === 401 && nf.status === 404 && typeof fb === "object",
      JSON.stringify(guard),
    );
    const dp = await realFetch(B2 + "/api/datos-partido?home=Barcelona&away=Madrid&date=2026-11-22");
    check(
      "workerd: datos del partido sin clave explica cómo configurarla",
      dp.status === 503 && (await dp.json()).codigo === "sin_clave",
    );
    await realFetch(B2 + "/__scheduled?cron=*/5+*+*+*+*");
    for (let i = 0; i < 20 && !/avisos: \d+ teléfono/.test(log); i++)
      await new Promise((res) => setTimeout(res, 300));
    check(
      "workerd: la tarea programada de avisos corre",
      /avisos: 1 teléfono\(s\)/.test(log),
      log
        .split("\n")
        .filter((l) => /avisos|rror/.test(l))
        .slice(-3)
        .join(" | "),
    );
  }
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {} // termina wrangler y su workerd (mismo grupo de procesos)
  await new Promise((res) => setTimeout(res, 500));
  fs.rmSync(path.join(os.tmpdir(), "kal-wrangler-" + port), { recursive: true, force: true });
}

await browser.close();
server.close();
console.log(`\n${ok} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
