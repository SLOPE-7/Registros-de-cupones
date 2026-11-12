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

let ok = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) { ok++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "  →  " + detail : "")); } };
const section = (t) => console.log("\n" + t);

// ---------- servidor local ----------
const posts = [];
const analystPosts = [];
const seen = [];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // API-Football (escudos y jugadores), TheSportsDB (imagenes) y el proxy de imágenes, simulados.
  const sendJson = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (url.pathname === "/api/escudos") {
    seen.push("escudos:" + url.searchParams.get("home"));
    return sendJson({ home: { options: [{ name: url.searchParams.get("home"), country: "Turkey", logo: "https://media.api-sports.io/football/teams/611.png" }] }, away: { options: [] }, league: { options: [] } });
  }
  if (url.pathname === "/api/jugadores") return sendJson({ players: [] });
  if (url.pathname === "/api/imagenes") {
    seen.push("imagenes:" + url.searchParams.get("tipo") + ":" + url.searchParams.get("q"));
    return sendJson({ options: url.searchParams.get("tipo") === "equipo"
      ? [{ id: "1", name: url.searchParams.get("q") + " (TSDB)", country: "Turkey", logo: "https://r2.thesportsdb.com/images/media/team/badge/abc.png", source: "TheSportsDB" }]
      : /nico|paz/i.test(url.searchParams.get("q")) ? [{ id: "9", name: "Nico Paz", team: "Como", photo: "https://r2.thesportsdb.com/images/media/player/cutout/nico.png", source: "TheSportsDB" }] : [] });
  }
  if (url.pathname === "/api/logo") { res.writeHead(200, { "content-type": "image/png" }); return fs.createReadStream(path.join(ROOT, "pruebas/escudo-prueba.png")).pipe(res); }
  if (url.pathname === "/api/avisos") {
    if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" })); }
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { posts.push(JSON.parse(b)); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); });
    return;
  }
  if (url.pathname === "/api/datos-partido") {
    seen.push("datos:" + url.searchParams.get("home") + "|" + url.searchParams.get("date"));
    return sendJson({ encontrado: true, alReves: false, fuente: "football-data.org",
      partido: { competicion: "UEFA Champions League", local: { nombre: "Fenerbahçe" }, visitante: { nombre: "Liverpool" } },
      modelo: { lambdaLocal: 1.2, lambdaVisitante: 1.6, p1: 0.3, px: 0.25, p2: 0.45, over05: 0.94, over15: 0.77, over25: 0.53, over35: 0.31, btts: 0.52, base: "tabla de local y visitante" },
      tabla: { local: { posicion: 12, puntos: 7, golesFavor: 6, golesContra: 7 }, visitante: { posicion: 3, puntos: 10, golesFavor: 9, golesContra: 3 }, localEnCasa: { ganados: 1, empates: 1, perdidos: 0 }, visitanteFuera: { ganados: 2, empates: 0, perdidos: 0 }, equipos: 36 },
      forma: { local: [{ fecha: "2026-11-01", rival: "Galatasaray", enCasa: true, marcador: "2-1", resultado: "G" }], visitante: [{ fecha: "2026-11-02", rival: "Arsenal", enCasa: false, marcador: "0-0", resultado: "E" }] },
      h2h: { partidos: 2, goles: 5, local: { ganados: 0, empates: 1, perdidos: 1 }, visitante: { ganados: 1, empates: 1, perdidos: 0 }, ultimos: [{ fecha: "2020-02-01", local: "Liverpool", visitante: "Fenerbahçe", marcador: "2-1" }] } });
  }
  // Analista (función de borde simulada): responde en streaming, una línea JSON por evento.
  if (url.pathname === "/api/analista") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", async () => {
      if (req.headers["x-kal-clave"] !== "secreto") return sendJson({ error: "El código de acceso del Analista no es correcto.", codigo: "codigo" }, 401);
      const body = JSON.parse(b); analystPosts.push(body);
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const send = (o) => res.write(JSON.stringify(o) + "\n");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      send({ t: "estado", v: "Pensando…" });
      if (body.modo === "cupon") { await wait(150); send({ t: "estado", v: "Buscando: Fenerbahce Liverpool lesiones" }); }
      const slow = /LENTO/.test(body.datos?.cupon || "");
      const chunks = ["## 📌 En resumen\n", "Te va **bien** en goles de *1.5*.\n", "- Punto uno\n- Punto <img src=x onerror=alert(1)>\n", "## 🎯 Recomendaciones\n1. Combinadas cortas\n"];
      for (const c of chunks) { await wait(slow ? 400 : 60); if (res.destroyed) return; send({ t: "texto", v: c }); }
      if (/FALLA/.test(body.datos?.cupon || "")) send({ t: "error", v: "Se alcanzó el límite de uso de la API." });
      else send({ t: "fin", uso: { entrada: 100, salida: 50, busquedas: 1 } });
      res.end();
    });
    return;
  }
  let f = path.join(SITE, decodeURIComponent(url.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
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
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? page.promptAnswer ?? d.defaultValue() : undefined));
  await ctx.addInitScript(([d, extra]) => {
    if (!localStorage.getItem("kal_coupon_organizer_v2") && d) localStorage.setItem("kal_coupon_organizer_v2", JSON.stringify(d));
    localStorage.setItem("kal_last_backup", String(Date.now()));
    if (extra !== "news" && !localStorage.getItem("kal_version_vista")) localStorage.setItem("kal_version_vista", "16");
    if (extra === "push") {
      let perm = "default";
      Object.defineProperty(Notification, "permission", { get: () => perm });
      Notification.requestPermission = async () => (perm = "granted");
      PushManager.prototype.getSubscription = async () => window.__sub || null;
      PushManager.prototype.subscribe = async () => (window.__sub = { endpoint: "https://push.example/abc", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "k", auth: "a" } }; }, unsubscribe: async () => true });
    }
  }, [db, init]);
  await page.goto(BASE);
  await page.waitForTimeout(600);
  return { ctx, page };
}
// Cambia de pantalla y espera un instante a que el navegador dibuje (las listas usan content-visibility).
const view = async (page, v) => { await page.evaluate((v) => document.querySelector(`button[data-view="${v}"]`).click(), v); await page.waitForTimeout(120); };
// Toca un botón aunque la barra fija o el menú inferior lo tapen en la pantalla del teléfono.
const tap = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
const texts = async (page, sel) => { await page.waitForTimeout(100); return page.$$eval(sel, (x) => x.map((e) => e.innerText.replace(/\s+/g, " ").trim())); };

// ---------- 1. Lector y detección de jugadores (funciones puras) ----------
section("1. Lector de cupones y detección de jugadores");
{
  const { ctx, page } = await open(null);
  const r = await page.evaluate(() => {
    const p = parseCoupon("Italia, Serie A\nInter Milan\nvs.\nFiorentina\n25/10/2026 • 05:30\n1x2: 1 • pago anticipado\nCuotas: 1.36\nEspaña, La Liga\nBarcelona\nvs.\nReal Madrid\n25/10/2026 • 08:00\nMás de 2.5 goles\nCuotas: 1.85\nVALOR APOSTADO L 120.00\nCUOTAS: 2.20\nGANANCIA TOTAL: L 264.00");
    const f = { home: "Como", away: "Napoli" };
    const pb = (market, pick) => parsePlayerBet({ market, pick }, f);
    return { n: p.fixtures.length, teams: p.fixtures.map((x) => x.home + "-" + x.away), stake: p.meta.stake, payout: p.meta.payout,
      paz: pb("Remates a puerta", "COM Nico Paz Más de 0.5"), nested: pb("Remates del jugador (incl. suplente)", "(Nico Paz (COM)) Más de 1.5"),
      hoj: pb("Primer goleador", "Rasmus Hojlund (NAP)"), team1: pb("Total de remates - Como", "Más de 4.5"), team2: pb("Marcador correcto", "Como 2-1"),
      club: playerClubForCode("NAP", f) };
  });
  check("lee 2 partidos con sus equipos", r.n === 2 && r.teams.join() === "Inter Milan-Fiorentina,Barcelona-Real Madrid", r.teams.join());
  check("lee importe y ganancia total", r.stake === 120 && r.payout === 264, `${r.stake} / ${r.payout}`);
  check("jugador sin el código del club en el nombre", r.paz?.name === "Nico Paz" && r.paz?.code === "COM", JSON.stringify(r.paz));
  check("jugador en formato anidado", r.nested?.name === "Nico Paz", JSON.stringify(r.nested));
  check("club correcto por código (NAP → Napoli)", r.club.club === "Napoli" && r.hoj?.code === "NAP");
  check("mercados de equipo no son jugadores", r.team1 === null && r.team2 === null);
  const v = await page.evaluate(() => {
    const p = parseCoupon("Europa, UEFA Europa League\nReal Sociedad\nvs.\nOlympique Lyonnais\n05/11/2026 • 11:45\nAmbos equipos marcan: Sí\n1.47\nEuropa, UEFA Liga Campeones\nBayer Leverkusen\nvs.\nMarseille\n05/11/2026 • 14:00\n1x2: 1 • pago anticipado\n@1.75\nTotal de goles: Más de 2.5 @1.80");
    const [a, b] = p.fixtures;
    return { comp: a.competition, country: a.country, odd1: a.markets[0].odd, comp2: b.competition, pick: b.markets[0].pick, early: b.markets[0].earlyPayout, odd2: b.markets[0].odd, odd3: b.markets[1]?.odd };
  });
  check("lee la línea 'Europa, competición'", v.comp === "UEFA Europa League" && v.country === "Europa" && v.comp2 === "UEFA Liga Campeones", JSON.stringify(v));
  check("lee la cuota sola en su línea (1.47 y @1.75)", v.odd1 === "1.47" && v.odd2 === "1.75", JSON.stringify(v));
  check("lee la cuota al final de la selección (@1.80)", v.odd3 === "1.80", JSON.stringify(v));
  check("separa '• pago anticipado' de la selección", v.pick === "1" && v.early === true, JSON.stringify(v));
  const mig = await page.evaluate(() => {
    db = { coupons: [{ id: "x", name: "x", created: "2026-11-01", fixtures: [{ home: "A", away: "B", dateISO: "2026-11-05", time: "10:00", markets: [{ market: "1x2", pick: "1 • pago anticipado", settlement: "pending" }] }] }], houses: [], transactions: [], resultHistory: [], actionHistory: [] };
    const changed = migrateEarlyPayout();
    return changed + ":" + db.coupons[0].fixtures[0].markets[0].pick + ":" + db.coupons[0].fixtures[0].markets[0].earlyPayout;
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
      sinCompeticion: p.fixtures.filter((f) => !/europa league|conference league/i.test(f.competition)).map((f) => f.home),
      anderlecht: p.fixtures.find((f) => /anderlecht/i.test(f.home))?.markets[0],
      celtic: p.fixtures.find((f) => /celtic/i.test(f.home))?.markets[0],
      early: p.fixtures.filter((f) => f.markets[0]?.earlyPayout).length,
      meta: p.meta,
    };
  }, realRaw);
  check("cupón real: 16 partidos, todos con mercado", real.n === 16 && !real.sinMercado.length, JSON.stringify(real.sinMercado));
  check("cupón real: todas las cuotas leídas", !real.sinCuota.length, JSON.stringify(real.sinCuota));
  check("cupón real: competición en todos (Europa / Conference League)", !real.sinCompeticion.length, JSON.stringify(real.sinCompeticion));
  check("cupón real: 'Apuesta sin empate' es un mercado, no el importe", real.anderlecht?.market === "Apuesta sin empate" && real.anderlecht?.odd === "1.45", JSON.stringify(real.anderlecht));
  check("cupón real: hándicap con su línea '2 (0:2)'", real.celtic?.market === "Hándicap 1x2" && real.celtic?.pick === "2 (0:2)", JSON.stringify(real.celtic));
  check("cupón real: 8 selecciones con pago anticipado", real.early === 8, String(real.early));
  check("cupón real: importe, cuota total, bono y ganancia", real.meta.stake === 10 && real.meta.odds === 37.48 && real.meta.bonus === 21.88 && real.meta.payout === 396.7, JSON.stringify(real.meta));
  // Cupón real 2: BetBuilder, jugador dentro del BetBuilder y copas nacionales.
  const real2 = await page.evaluate((raw) => {
    const p = parseCoupon(raw);
    const roma = p.fixtures[0], torino = p.fixtures[1], mg = p.fixtures[3];
    const player = torino.markets.find((m) => /Douvikas/.test(m.market));
    return {
      n: p.fixtures.length,
      romaMarkets: roma.markets.map((m) => m.market + "=" + m.pick + "@" + m.builderOdd + (m.earlyPayout ? "⚡" : "")).join(" | "),
      torinoN: torino.markets.length,
      player: parsePlayerBet(player, torino),
      playerLine: parseLine(player, torino),
      homeGoals: parseLine(mg.markets[1], mg)?.goal,
      themes: p.fixtures.map((f) => competitionTheme(f).id).join(","),
      meta: p.meta,
    };
  }, fs.readFileSync(path.join(ROOT, "pruebas/cupon-real-2.txt"), "utf8"));
  check("cupón real 2: BetBuilder separado en selecciones con su cuota", real2.n === 10 && real2.romaMarkets === "1x2=1@1.40 | Total Tiros De Esquina=Más de 5.5@1.40⚡" && real2.torinoN === 3, real2.romaMarkets);
  check("cupón real 2: jugador dentro del BetBuilder con '( COM)'", real2.player?.name === "Anastasios Douvikas" && real2.player?.code === "COM" && real2.playerLine?.incl === true && real2.playerLine?.goal === 1, JSON.stringify(real2.player));
  check("cupón real 2: '1 total de goles: Más de 0.5' tiene barra (meta 1)", real2.homeGoals === 1);
  check("cupón real 2: temas de Serie A, Copa de Alemania, EFL Cup y Copa del Rey", real2.themes === "serie-a,serie-a,dfb-pokal,dfb-pokal,dfb-pokal,league-cup,copa-del-rey,copa-del-rey,copa-del-rey,pais", real2.themes);
  check("cupón real 2: importe 15 y cuota 7.45 (ganancia vacía sin error)", real2.meta.stake === 15 && real2.meta.odds === 7.45 && real2.meta.payout === null, JSON.stringify(real2.meta));
  // Tres cupones reales de Doradobet (ligas, Europa/Conference League y Champions, con jugadores).
  const dorado = await page.evaluate((raws) => raws.map((raw) => {
    const p = parseCoupon(raw);
    return {
      n: p.fixtures.length, sel: p.fixtures.reduce((s, f) => s + f.markets.length, 0), meta: p.meta,
      faltan: p.fixtures.flatMap((f) => [!f.markets.length && f.home + " sin mercado", !f.competition && f.home + " sin competición", ...f.markets.filter((m) => !(m.odd || m.builderOdd)).map((m) => f.home + " sin cuota")]).filter(Boolean),
      jugadores: p.fixtures.flatMap((f) => f.markets.map((m) => { const b = parsePlayerBet(m, f); return b ? b.name + "=" + playerClubForCode(b.code, f).club : null; }).filter(Boolean)),
    };
  }), [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/doradobet-${n}.txt`), "utf8")));
  check("Doradobet: 42 partidos y 75 selecciones sin datos faltantes", dorado.map((d) => d.n).join() === "23,11,8" && dorado.map((d) => d.sel).join() === "45,16,14" && dorado.every((d) => !d.faltan.length), JSON.stringify(dorado.map((d) => [d.n, d.sel, d.faltan])));
  check("Doradobet: importes y cuotas totales", dorado.map((d) => d.meta.stake + "@" + d.meta.odds).join() === "4.4@184.28,50@11.94,50@5.77", dorado.map((d) => d.meta.stake + "@" + d.meta.odds).join());
  const jug = dorado.flatMap((d) => d.jugadores).join(" | ");
  check("Doradobet: 8 jugadores con su club (BET, SCP, BEN, MNU, GAL, BRU, BAY, COM)", jug === "Nicolo Tresoldi=Club Brugge KV | Abdessamad Ezzalzouli=Real Betis | Harry Kane=Bayern Munich | Luis Suárez=Sporting Lisboa | Gianluca Prestianni=SL Benfica | Victor Osimhen=Galatasaray SK | Anastasios Douvikas=Como | Bryan Mbeumo=Manchester United", jug);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 2. Regla del cupón perdido, mercados, agenda y archivo ----------
section("2. Regla del cupón perdido, Mercados, Agenda y Mis cupones");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "saved");
  check("Mis cupones muestra solo pendientes", (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() === "Combinada A,Combinada B");
  await view(page, "calendar"); await page.click('[data-agenda-range="all"]');
  check("Agenda muestra 3 partidos vivos", (await page.$$("#agendaList .agenda-match")).length === 3);
  // perder un mercado de la Combinada A desde la ficha
  await page.evaluate(() => [...document.querySelectorAll("#agendaList .agenda-match")].find((e) => e.innerText.includes("Fenerbahce")).click());
  await page.waitForTimeout(150);
  await page.evaluate(() => [...document.querySelectorAll(".match-tab-content > .mk-card")].find((e) => e.innerText.includes("Ambos")).querySelector(".mk-btn.lost").click());
  await page.waitForTimeout(150);
  check("la ficha no deja pendientes del cupón perdido", (await page.$$(".match-tab-content > .mk-card")).length === 0);
  check("resumen 'Ya marcados' indica cupón perdido", /cupón perdido/.test(await page.$eval(".marked-summary", (e) => e.innerText)));
  await page.click(".match-close");
  await page.click('[data-agenda-range="all"]');
  const ag = await texts(page, "#agendaList .agenda-match .agenda-teams");
  check("Agenda quita el partido del cupón perdido", !ag.some((t) => t.includes("Fenerbahce")) && ag.some((t) => t.includes("AEK")), ag.join(" / "));
  await view(page, "markets");
  const mk = await page.$$eval("[data-market-card]:not(.hidden)", (x) => x.map((e) => e.dataset.team));
  check("Mercados (Pendiente) quita el partido perdido y mantiene AEK (sigue vivo en B)", !mk.some((t) => t.includes("Fenerbahce")) && mk.some((t) => t.includes("AEK")), mk.join(" / "));
  await view(page, "saved");
  check("el cupón A pasa a Perdidos", (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() === "Combinada B");
  await page.click('[data-coupon-filter="lost"]');
  check("pestaña Perdidos contiene A", (await texts(page, "#couponList .saved-coupon > .couponhead strong")).join() === "Combinada A");
  // deshacer
  await view(page, "markets"); await page.click('[data-fold="history"] .fold-head'); await page.click("#undoResultBtn"); await page.waitForTimeout(100);
  await view(page, "saved"); await page.click('[data-coupon-filter="pending"]');
  check("deshacer devuelve A a pendientes", (await texts(page, "#couponList .saved-coupon > .couponhead strong")).length === 2);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 3. Eliminar cupón y balance ----------
section("3. Eliminar cupón, balance y deshacer");
{
  const { ctx, page } = await open(baseDb());
  const bal = async () => { await view(page, "houses"); return page.$eval("#houseList .listitem", (e) => e.innerText.replace(/\s+/g, " ")); };
  check("balance inicial con la apuesta de B", /-70\.00/.test(await bal()));
  await view(page, "saved"); await page.click('[data-remove="B"]'); await page.waitForTimeout(100);
  check("eliminar B quita su apuesta del balance", /Movimientos netos L 0\.00/.test(await bal()));
  await view(page, "saved"); await page.click("#undoCouponActionBtn"); await page.waitForTimeout(100);
  check("deshacer la recupera", /-70\.00/.test(await bal()));
  await ctx.close();
}

// ---------- 4. Guardado rápido ----------
section("4. Guardar cupones más rápido");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "new");
  const today = isoDay(Date.now()).split("-").reverse().join("/");
  await page.fill("#raw", `Europa, UEFA Liga Campeones\nPSV\nvs.\nAjax\n${today} • 23:59\nTotal de goles: Más de 2.5\nCuotas: 1.80\nVALOR APOSTADO L 50.00`);
  await page.click("#readBtn"); await page.waitForTimeout(150);
  check("detecta la casa por el formato o el historial", (await page.$eval("#couponHouse", (e) => e.value)) === "h1", await page.$eval("#houseHint", (e) => e.textContent));
  check("explica por qué eligió la casa", /Hondubet/.test(await page.$eval("#houseHint", (e) => e.textContent)));
  check("ofrece importes habituales", (await texts(page, "#stakeChips .chip")).length >= 2, (await texts(page, "#stakeChips .chip")).join());
  check("barra fija de guardar visible", await page.isVisible("#saveBar"));
  await page.click('#stakeChips .chip >> text="L 70.00"'); await page.waitForTimeout(50);
  check("tocar un importe lo aplica", (await page.$eval("#stake", (e) => e.value)) === "70");
  check("la barra resume selecciones, importe y casa", /1 selección[\s\S]*L 70\.00[\s\S]*Hondubet/.test(await page.$eval("#saveBar", (e) => e.innerText)), await page.$eval("#saveBar", (e) => e.innerText));
  await page.click("[data-save-bar]"); await page.waitForTimeout(200);
  check("guarda desde la barra y va a Mis cupones", (await page.$eval("#viewTitle", (e) => e.textContent)) === "Mis cupones");
  check("barra oculta tras guardar", !(await page.isVisible("#saveBar")));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 5. Buscador global ----------
section("5. Buscador global");
{
  const { ctx, page } = await open(baseDb());
  await page.click("#searchBtn"); await page.fill("#globalSearch", "aek"); await page.waitForTimeout(300);
  check("encuentra el equipo AEK con su partido", /AEK/.test(await page.$eval("#searchResults", (e) => e.innerText)));
  await page.fill("#globalSearch", "nico paz"); await page.waitForTimeout(300);
  const res = await page.$eval("#searchResults", (e) => e.innerText);
  check("encuentra al jugador Nico Paz con su club", /Nico Paz/.test(res) && /Como/.test(res), res.slice(0, 120));
  await page.fill("#globalSearch", "ganado"); await page.waitForTimeout(300);
  await page.click("[data-search-coupon]"); await page.waitForTimeout(400);
  check("al tocar un cupón archivado abre su pestaña", (await page.$eval("#couponFilter .chip.active", (e) => e.innerText)).startsWith("Ganados"));
  check("buscador cerrado", !(await page.isVisible("#searchSheet")));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 6. Avisos, presupuesto y rachas ----------
section("6. Avisos de partidos, presupuesto y rachas");
{
  const db = baseDb();
  // "Ganado viejo" (hace 9 días) entraría en el mes actual a partir del día 10: se pasa al mes anterior para que el gasto del mes sea siempre 120.
  db.coupons.find((c) => c.id === "C").created = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString();
  for (let i = 0; i < 3; i++) db.coupons.push({ id: "L" + i, name: "Perdido " + i, created: new Date(Date.now() - (5 - i) * 86400e3).toISOString(), stake: 0, odds: 2, payout: 20, fixtures: [{ id: "x" + i, home: "X" + i, away: "Y" + i, dateISO: isoDay(Date.now() - (5 - i) * 86400e3), time: "10:00", markets: [{ market: "1x2", pick: "1", odd: "2", settlement: "lost" }] }] });
  const { ctx, page } = await open(db, { init: "push" });
  check("aviso dentro de la app antes del partido", /Fenerbahce vs Liverpool<\/b> empieza en \d+ min/.test(await page.$eval("#liveAlert", (e) => e.innerHTML)));
  check("aviso de 3 cupones perdidos seguidos", (await texts(page, ".home-notice b")).some((t) => /3 cupones perdidos seguidos/.test(t)));
  page.promptAnswer = "130";
  await page.click("[data-budget-edit]"); await page.waitForTimeout(100);
  check("presupuesto cerca del límite (120 de 130)", /Cerca del límite/.test(await page.$eval("#budgetCard", (e) => e.innerText)));
  await view(page, "settings"); await page.click("[data-alert-on]"); await page.waitForTimeout(600);
  const last = posts.at(-1);
  check("envía al servidor los partidos vivos", last?.accion === "guardar" && last.matches.length === 3, JSON.stringify(last?.matches?.map((m) => m.title)));
  check("la notificación lista los mercados pendientes", last?.matches?.some((m) => /Nico Paz: Más de 0\.5/.test(m.body)));
  await page.click("[data-alert-off]"); await page.waitForTimeout(300);
  check("desactivar avisa al servidor", posts.at(-1)?.accion === "borrar");
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 7. App instalable y sin conexión ----------
section("7. App instalable y sin conexión");
{
  const { ctx, page } = await open(baseDb());
  const m = await page.evaluate(async () => (await fetch(document.querySelector("link[rel=manifest]").href)).json());
  check("manifest de app instalable", m.display === "standalone" && m.icons.length >= 3);
  check("service worker activo", await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active));
  await page.waitForTimeout(500);
  await ctx.setOffline(true); await page.reload(); await page.waitForTimeout(600);
  check("abre sin conexión con los cupones", (await page.$eval("#sCoupons", (e) => e.textContent)) === "3");
  await ctx.close();
}

// ---------- 9. Barra de progreso de mercados ----------
section("9. Barra de progreso de mercados");
{
  const now = Date.now(), day = isoDay(now), time = new Date(now + 30 * 60e3).toTimeString().slice(0, 5);
  const db = { coupons: [{ id: "P", name: "Progreso", created: new Date(now).toISOString(), houseId: "", type: "parlay", stake: 10, odds: 5, payout: 50,
    fixtures: [{ id: "f", home: "Real Madrid", away: "Juventus", competition: "UEFA Liga Campeones", dateISO: day, time, markets: [
      { market: "Total de goles", pick: "Más de 2.5", odd: "1.8", settlement: "pending" },
      { market: "Total Tiros De Esquina", pick: "Menos de 2.5", odd: "2.1", settlement: "pending" },
      { market: "Remates a Puerta (Kylian Mbappe (RMD)) - Incl. suplente", pick: "Más de 1.5", odd: "1.9", settlement: "pending" },
      { market: "Total de tarjetas", pick: "Más de 4.5", odd: "1.7", settlement: "pending" },
      { market: "1x2", pick: "1", odd: "1.5", settlement: "pending" }] }] }], houses: [], transactions: [], resultHistory: [], actionHistory: [] };
  const { ctx, page } = await open(db);
  const u = await page.evaluate(() => {
    const L = (market, pick) => { const r = parseLine({ market, pick }, { home: "Real Madrid", away: "Juventus" }); return r ? r.dir + ":" + r.goal + ":" + r.cat + (r.incl ? ":suplente" : "") : null; };
    return [L("Total de goles", "Más de 2.5"), L("Total Tiros De Esquina", "Menos de 9.5"), L("Remates a Puerta (Kylian Mbappe (RMD)) - Incl. suplente", "Más de 1.5"),
            L("Remates (Kylian Mbappe (RMD)) - Incl. suplente", "Más de 1.5"), L("Tarjetas", "+3.5"), L("Jugador remates a puerta", "Mbappe 2+"), L("1x2", "1"), L("Ambos equipos marcan", "Sí")];
  });
  check("entiende las líneas (goles, córners, remates, tarjetas, 2+)", u.map(String).join("|") === "over:3:goles|under:10:córners|over:2:a puerta:suplente|over:2:remates:suplente|over:4:tarjetas|over:2:a puerta|null|null", u.map(String).join("|"));
  await page.evaluate(() => document.querySelector("#todayList .agenda-match").click()); await page.waitForTimeout(150);
  const card = (txt) => `.mk-card:has-text("${txt}")`;
  check("muestra barra solo en mercados de línea", (await page.$$(".match-tab-content .pg")).length === 4);
  check("cabecera con el tema de la competición (Champions → estrellas)", (await page.$eval(".match-stadium", (e) => e.dataset.pattern)) === "stars");
  const themes = await page.evaluate(() => [
    ["UEFA Liga Campeones", "Europa"], ["UEFA Europa League", ""], ["UEFA Conference League", ""], ["Supercopa de la UEFA", ""],
    ["Premier League", "Inglaterra"], ["Championship", "Inglaterra"], ["FA Cup", "Inglaterra"], ["Carabao Cup", "Inglaterra"],
    ["LaLiga", "España"], ["LaLiga Hypermotion", "España"], ["Copa del Rey", "España"], ["Supercopa de España", "España"],
    ["Serie A", "Italia"], ["Coppa Italia", "Italia"], ["Bundesliga", "Alemania"], ["DFB Pokal", "Alemania"], ["Bundesliga", "Austria"],
    ["Ligue 1", "Francia"], ["Eredivisie", "Países Bajos"], ["Liga Portugal", "Portugal"], ["Premiership", "Escocia"], ["Super Lig", "Turquía"],
    ["Serie A", "Brasil"], ["Superliga", "Dinamarca"], ["Liga Nacional", "Honduras"],
    ["UEFA Nations League", ""], ["Eliminatorias UEFA Mundial", ""], ["Eliminatorias CONMEBOL", ""], ["Amistosos Internacionales", ""],
    ["Copa Mundial de la FIFA", ""], ["Eurocopa", ""], ["Copa América", ""], ["CONCACAF Liga de Naciones", ""], ["Copa Oro", ""],
  ].map(([competition, country]) => competitionTheme({ competition, country }).id).join(","));
  check("temas de ligas, copas, competiciones europeas y selecciones", themes === "champions,europa-league,conference,uefa-super-cup,premier-league,english-football-league,fa-cup,league-cup,laliga,laliga-2,copa-del-rey,supercopa-espana,serie-a,coppa-italia,bundesliga,dfb-pokal,pais,ligue-1,eredivisie,primeira-liga,scottish-premiership,super-lig,pais,pais,liga-nacional,nations-league,qualifiers,qualifiers,friendlies,world-cup,euro,copa-america,concacaf-nations,gold-cup", themes);
  const flags = await page.evaluate(() => ["España", "Inglaterra", "Países Bajos", "Estados Unidos", "Honduras", "Costa de Marfil", "Brasil Sub 20", "Real Madrid"].map(nationFlag).join(" "));
  check("banderas de selecciones (y ninguna para clubes)", flags.split(" ").filter(Boolean).length === 7 && !flags.trim().endsWith("🇪🇸 "), flags);
  for (let i = 0; i < 3; i++) { await page.click(`${card("Total de goles")} .pg-btn.plus`); await page.waitForTimeout(80); }
  check("Más de 2.5 goles: con 3 se marca ganado solo", (await page.evaluate(() => db.coupons[0].fixtures[0].markets[0].settlement)) === "won");
  check("avisa con un mensaje de mercado ganado", /Mercado ganado/.test(await page.$eval("#toast", (e) => e.textContent)));
  await page.click("[data-marked-toggle]");
  await page.click(`.marked-fold ${card("Total de goles")} .pg-btn:not(.plus)`); await page.waitForTimeout(100);
  check("si restas, vuelve a pendiente", (await page.evaluate(() => db.coupons[0].fixtures[0].markets[0].settlement)) === "pending");
  for (let i = 0; i < 3; i++) { await page.click(`.match-tab-content > ${card("Tiros De Esquina")} .pg-btn.plus`); await page.waitForTimeout(80); }
  check("Menos de 2.5 córners: con 3 se marca perdido solo", (await page.evaluate(() => db.coupons[0].fixtures[0].markets[1].settlement)) === "lost");
  await page.evaluate(() => { db.coupons[0].fixtures[0].markets[1].settlement = "pending"; db.progress = {}; save(); renderAll(); });
  await page.click(`.match-tab-content > ${card("Mbappe")} .pg-btn.plus`); await page.waitForTimeout(80);
  page.promptAnswer = "Endrick";
  await page.click(`${card("Mbappe")} [data-pg-sub-add]`); await page.waitForTimeout(400);
  check("agrega al suplente con su nombre", (await page.$eval(card("Mbappe"), (e) => e.innerText)).includes("Endrick"));
  await page.click(`${card("Mbappe")} .pg-player:has-text("Endrick") .pg-btn.plus`); await page.waitForTimeout(150);
  check("Mbappé 1 + suplente 1 = 2: remates a puerta ganado", (await page.evaluate(() => db.coupons[0].fixtures[0].markets[2].settlement)) === "won");
  await page.click(".match-close"); await view(page, "calendar"); await page.click('[data-agenda-range="all"]');
  check("la Agenda muestra el progreso en miniatura", /Goles 0\/3/.test(await page.$eval("#agendaList", (e) => e.innerText)), await page.$eval("#agendaList", (e) => e.innerText.replace(/\s+/g, " ")));
  await page.evaluate(() => document.querySelector("#agendaList .agenda-match").click()); await page.waitForTimeout(150);
  await page.click(`${card("tarjetas")} .pg-btn.plus`); await page.waitForTimeout(80);
  await page.click("[data-pg-finish]"); await page.waitForTimeout(200);
  const st = await page.evaluate(() => db.coupons[0].fixtures[0].markets.map((m) => m.settlement).join(","));
  check("Terminó el partido: Más de sin llegar → perdido, Menos de → ganado", st === "lost,won,won,lost,pending", st);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 10. Escudos y fotos: TheSportsDB e imagen del teléfono ----------
section("10. Escudos y fotos: TheSportsDB e imagen del teléfono");
{
  const { ctx, page } = await open(baseDb());
  await view(page, "logos");
  const idx = (name) => page.evaluate((n) => logoManagerTeams.findIndex((t) => t.name === n), name);
  const fb = await idx("Fenerbahce");
  await page.click(`[data-logo-lookup="${fb}"]`); await page.waitForTimeout(300);
  const opts = await texts(page, `#logo-options-${fb} .img-opt`);
  check("busca a la vez en API-Football y TheSportsDB", opts.length === 2 && /API-Football/.test(opts[0]) && /TheSportsDB/.test(opts[1]), opts.join(" / "));
  await page.click(`#logo-options-${fb} .img-opt >> nth=1`); await page.waitForTimeout(200);
  check("tocar un resultado de TheSportsDB guarda el escudo", (await page.evaluate(() => readCrestDirectory()["team:fenerbahce"]?.url || "")).includes("thesportsdb.com"));
  check("el escudo se aplica a sus partidos", (await page.evaluate(() => db.coupons[0].fixtures[0].homeCrest)).includes("thesportsdb.com"));
  const lv = await idx("Liverpool");
  await page.click(`[data-logo-lookup="${lv}"]`); await page.waitForTimeout(300);
  await page.fill(`#logo-q-${lv}`, "Liverpool FC"); await page.click(`[data-logo-requery="${lv}"]`); await page.waitForTimeout(300);
  check("se puede buscar con otro nombre", seen.includes("imagenes:equipo:Liverpool FC") && seen.includes("escudos:Liverpool FC"), seen.slice(-4).join(" | "));
  const aek = await idx("AEK");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(`[data-logo-upload="${aek}"]`)]);
  await chooser.setFiles(path.join(ROOT, "pruebas/escudo-prueba.png")); await page.waitForTimeout(500);
  const aekUrl = await page.evaluate(() => readCrestDirectory()["team:aek"]?.url || "");
  const aekImg = await page.evaluate((u) => resolveImage(u), aekUrl);
  check("subir imagen del teléfono guarda el escudo (recortado y pequeño)", /^data:image\/(webp|png);base64,/.test(aekImg) && aekImg.length < 60000, aekImg.slice(0, 30) + " · " + aekImg.length + " caracteres");
  const stored = await page.evaluate(() => ({ ref: readCrestDirectory()["team:aek"].url, enPartido: db.coupons.flatMap((c) => c.fixtures).find((f) => f.home === "AEK").homeCrest, copias: (JSON.stringify(db).match(/data:image/g) || []).length }));
  check("la imagen se guarda una sola vez; los partidos llevan solo la referencia", stored.ref.startsWith("kalimg:") && stored.enPartido === stored.ref && stored.copias === 0, JSON.stringify(stored).slice(0, 120));
  check("el escudo subido se ve en su tarjeta", await page.evaluate(() => [...document.querySelectorAll("#logoArchive .logo-card")].some((c) => c.innerText.includes("AEK") && /^(data:image|blob:)/.test(c.querySelector("img.team-crest:not([hidden])")?.src || ""))));
  // Fotos de jugadores: búsqueda combinada y subida
  await page.evaluate(() => { const el = document.querySelector('[data-fold="players"]'); if (!el.classList.contains("is-open")) el.querySelector(".fold-head").click(); });
  await page.click('#playerPhotoArchive [data-player-photo]'); await page.waitForTimeout(400);
  const nico = () => page.evaluate(() => Object.values(readCrestDirectory()).find((x) => x?.kind === "player" && /Nico Paz/.test(x.name))?.photo || "");
  check("la foto del jugador se encuentra en TheSportsDB si API-Football no la tiene", (await nico()).includes("thesportsdb.com"), await nico());
  const [ch2] = await Promise.all([page.waitForEvent("filechooser"), page.click('#playerPhotoArchive [data-player-upload]')]);
  await ch2.setFiles(path.join(ROOT, "pruebas/escudo-prueba.png")); await page.waitForTimeout(500);
  check("subir la foto de un jugador desde el teléfono", (await nico()).startsWith("kalimg:") && (await page.evaluate(() => !!document.querySelector('#playerPhotoArchive img.player-logo-thumb[src^="data:image"]'))), (await nico()).slice(0, 30));
  // Una imagen guardada entera por la versión anterior pasa a referencia al abrir la app.
  const mig = await page.evaluate(() => { const data = resolveImage(readCrestDirectory()["team:aek"].url); db.coupons[0].fixtures[0].awayCrest = data; const changed = migrateInlineImages(); return changed + ":" + db.coupons[0].fixtures[0].awayCrest.slice(0, 7); });
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
      const x = parseCoupon(raws[i % 3]), d = new Date(now - ((i - 5) * 86400000) / 2);
      x.fixtures.forEach((f, j) => { f.dateISO = d.toISOString().slice(0, 10); f.home += i > 10 ? " " + (i % 7) : ""; f.markets.forEach((m, k) => { m.settlement = i < 6 ? "pending" : (i * 7 + j * 3 + k) % 10 < 7 ? "won" : "lost"; }); });
      db.coupons.push({ id: "c" + i, name: "Cupón " + i, created: d.toISOString(), type: "parlay", stake: 10, odds: 2, payout: 20, fixtures: x.fixtures });
    }
    const time = (fn) => { const a = performance.now(); fn(); return performance.now() - a; };
    const out = { all: time(renderAll) };
    for (const v of ["calendar", "markets", "saved", "stats", "logos"]) out[v] = time(() => go(v));
    out.nodes = document.querySelectorAll("*").length;
    out.marketCards = document.querySelectorAll("[data-market-card]").length;
    return out;
  }, raws);
  const slowest = Math.max(r.all, r.calendar, r.markets, r.saved, r.stats, r.logos);
  check("ninguna pantalla tarda más de 400 ms en dibujarse", slowest < 400, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]))));
  check("la página se mantiene ligera (menos de 25.000 elementos)", r.nodes < 25000, String(r.nodes));
  check("Mercados dibuja por páginas (40 partidos) con botón 'Mostrar más'", r.marketCards === 40 && (await page.$("[data-market-more]")) !== null, String(r.marketCards));
  await view(page, "markets"); await page.click("[data-market-more]"); await page.waitForTimeout(100);
  check("'Mostrar más' agrega otros 40", (await page.$$("[data-market-card]")).length === 80);
  await page.selectOption("#marketStatusFilter", ""); await page.waitForTimeout(150);
  check("el filtro 'Todos' también va por páginas", (await page.$$("[data-market-card]")).length === 40);
  await view(page, "saved"); await page.click('[data-coupon-filter="all"]'); await page.waitForTimeout(100);
  check("Mis cupones → Todos muestra 30 y ofrece 'Mostrar más'", (await page.$$("#couponList .saved-coupon")).length === 30 && (await page.$("[data-coupon-more]")) !== null);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 12. Animaciones de resultado y pantalla de entrada ----------
section("12. Animaciones y pantalla de entrada");
{
  const { ctx, page } = await open(baseDb());
  await page.waitForTimeout(700);
  check("la pantalla de entrada se quita sola al cargar", (await page.$("#splash")) === null);
  const key = (ci, fi, mi) => page.evaluate(([ci, fi, mi]) => marketKey(db.coupons[ci].fixtures[fi], db.coupons[ci].fixtures[fi].markets[mi]), [ci, fi, mi]);
  // Combinada B: AEK (1 mercado) + Como (2 mercados). Ganar uno → confeti corto, sin tarjeta.
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 0, 0)); await page.waitForTimeout(300);
  check("mercado ganado: confeti, sin tarjeta de cupón", (await page.$("canvas.confetti")) !== null && (await page.$(".result-card")) === null);
  // Ganar el resto → cupón B ganado: tarjeta con la ganancia (210 − 70 = 140).
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 1, 0));
  await page.evaluate((k) => setMarketStatus(k, "won"), await key(1, 1, 1)); await page.waitForTimeout(350);
  const card = await page.$eval(".result-card-wrap", (e) => e.className + " | " + e.innerText.replace(/\s+/g, " "));
  check("cupón ganado: tarjeta con el nombre y la ganancia", /is-won/.test(card) && /¡Cupón ganado!/.test(card) && /Combinada B/.test(card) && /\+L 140\.00/.test(card), card);
  await page.click(".result-card-wrap"); await page.waitForTimeout(350);
  check("la tarjeta se cierra al tocarla", (await page.$(".result-card-wrap")) === null);
  // Perder un mercado de la Combinada A → tarjeta de cupón perdido con lo apostado.
  await page.evaluate((k) => setMarketStatus(k, "lost"), await key(0, 0, 0)); await page.waitForTimeout(350);
  const lostCard = await page.$eval(".result-card-wrap", (e) => e.className + " | " + e.innerText.replace(/\s+/g, " "));
  check("cupón perdido: tarjeta con lo apostado", /is-lost/.test(lostCard) && /Cupón perdido/.test(lostCard) && /−L 50\.00/.test(lostCard), lostCard);
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
  // Con "reducir movimiento" no hay confeti, pero la tarjeta sí aparece.
  const calm = await open(baseDb(), { ctxOpts: { reducedMotion: "reduce" } });
  await calm.page.evaluate(() => { const f = db.coupons[1].fixtures; f.forEach((x) => x.markets.forEach((m) => setMarketStatus(marketKey(x, m), "won"))); });
  await calm.page.waitForTimeout(350);
  check("con 'reducir movimiento': tarjeta sí, confeti no", (await calm.page.$(".result-card")) !== null && (await calm.page.$("canvas.confetti")) === null);
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
      x.fixtures.forEach((f) => f.markets.forEach((m) => { m.settlement = i % 10 === 9 ? "pending" : "won"; }));
      db.coupons.push({ id: "c" + i, name: "Cupón " + i, created: new Date(Date.now() - i * 3600e3).toISOString(), stake: 10, odds: 2, payout: 20, raw: raws[i % 3], fixtures: x.fixtures });
    }
    db.actionHistory = Array.from({ length: 60 }, (_, i) => ({ type: "create", couponId: "c" + i, at: "x" }));
    db.progress = { "clave-que-ya-no-existe": { count: 3 } };
    localStorage.setItem("kal_images_v1", JSON.stringify({ huerfana: "data:image/png;base64," + "A".repeat(20000) }));
    save();
    const before = storageUsage(), markets = db.coupons.reduce((s, c) => s + c.fixtures.reduce((n, f) => n + f.markets.length, 0), 0);
    const freed = compactData(true);
    const saved = JSON.parse(localStorage.getItem("kal_coupon_organizer_v2"));
    return {
      freed, before: before.bytes, after: storageUsage().bytes, coupons: saved.coupons.length,
      marketsSame: saved.coupons.reduce((s, c) => s + c.fixtures.reduce((n, f) => n + f.markets.length, 0), 0) === markets,
      rawNewest: saved.coupons.slice(0, 40).every((c) => c.raw), rawOldSettled: saved.coupons.slice(40).filter((c) => c.raw).map((c) => c.id),
      pendingOldKeepRaw: saved.coupons.slice(40).filter((c) => c.fixtures[0].markets[0].settlement === "pending").every((c) => c.raw),
      history: saved.actionHistory.length, progress: Object.keys(saved.progress).length, images: Object.keys(JSON.parse(localStorage.getItem("kal_images_v1"))).length,
    };
  }, raws);
  check("libera espacio sin borrar cupones ni mercados", r.freed > 100000 && r.coupons === 100 && r.marketsSame, `liberó ${Math.round(r.freed / 1024)} KB de ${Math.round(r.before / 1024)} KB`);
  check("conserva el texto original en los 40 más recientes y en los pendientes", r.rawNewest && r.pendingOldKeepRaw && r.rawOldSettled.every((id) => Number(id.slice(1)) % 10 === 9), JSON.stringify(r.rawOldSettled.slice(0, 5)));
  check("recorta el historial de deshacer y quita progreso e imágenes sin uso", r.history === 20 && r.progress === 0 && r.images === 0, `${r.history}/${r.progress}/${r.images}`);
  await view(page, "settings");
  check("Ajustes muestra el espacio usado y el botón de liberar", /de ~5 MB · 100 cupones/.test(await page.$eval("#storageBox", (e) => e.innerText)) && (await page.$("[data-compact]")) !== null, await page.$eval("#storageBox", (e) => e.innerText.replace(/\s+/g, " ").slice(0, 80)));
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
      db.coupons.push({ id: "H" + i, name: "Hist " + i, created: new Date(Date.now() - (i + 2) * 86400e3).toISOString(), houseId: "h2", stake: 10, odds: won ? 1.8 : 5, payout: won ? 18 : 50,
        fixtures: (won ? [0] : [0, 1, 2]).map((k) => ({ id: "h" + i + k, home: "Equipo " + i + k, away: "Rival " + k, competition: "LaLiga", date: "01/11/2026", time: "12:00",
          markets: [{ market: "Total de goles", pick: "Más de 1.5", odd: "1.80", settlement: won ? "won" : k === 2 ? "lost" : "won" }] })) });
    }
    save(); renderAll();
  });
  await view(page, "analyst");
  let info = await page.evaluate(() => ({ title: $("viewTitle").textContent, open: document.querySelector(".analyst-config").classList.contains("is-open"), disabled: document.querySelector('[data-analyst-run="historial"]').disabled, inMore: !!document.querySelector('#moreMenu [data-view="analyst"]') }));
  check("pantalla Analista en el menú Más, con la configuración abierta si falta el código", info.title === "Analista" && info.open && info.inMore && !info.disabled, JSON.stringify(info));
  await page.click('[data-analyst-run="historial"]');
  await page.waitForTimeout(150);
  check("sin código avisa en vez de llamar al servidor", /código de acceso/i.test(await page.$eval("#analystOut-historial", (e) => e.innerText)) && analystPosts.length === 0);
  await page.fill("#analystKey", "malo"); await page.click("[data-analyst-key]");
  await page.click('[data-analyst-run="historial"]'); await page.waitForTimeout(250);
  check("código incorrecto muestra el error del servidor", /no es correcto/.test(await page.$eval("#analystOut-historial", (e) => e.innerText)));
  await page.click(".analyst-config [data-fold-toggle]"); await page.fill("#analystKey", "secreto"); await page.click("[data-analyst-key]");
  await page.click('[data-analyst-run="historial"]');
  await page.waitForTimeout(140);
  const live = await page.$eval("#analystOut-historial", (e) => ({ busy: !!e.querySelector(".analyst-live"), btn: document.querySelector('[data-analyst-run="historial"]').disabled }));
  await page.waitForTimeout(600);
  const e2 = (o) => o.i === "1.5";
  const out = await page.$eval("#analystOut-historial", (e) => ({ i: e.querySelector("i")?.textContent, h: [...e.querySelectorAll("h4")].map((x) => x.textContent), li: e.querySelectorAll("li").length, b: e.querySelector("b")?.textContent, img: e.querySelectorAll("img").length, text: e.innerText }));
  check("muestra el análisis mientras llega y bloquea el botón", live.busy && live.btn, JSON.stringify(live));
  check("da formato (títulos, listas, negritas) sin ejecutar HTML", out.h.length === 2 && out.li === 3 && out.b === "bien" && e2(out) && out.img === 0 && out.text.includes("<img"), JSON.stringify(out).slice(0, 200));
  const hp = analystPosts.at(-1);
  const h = hp?.datos?.historial;
  check("envía un resumen: por mercado, cuota, tamaño de combinada y últimos cupones", hp?.modo === "historial" && h.porMercado.some((r) => r.tipo === "Goles (más / menos)" && r.ganados === 9 && r.perdidos === 3) && h.porTamano.some((r) => r.selecciones === "3" && r.cupones === 3 && r.ganados === 0) && h.ultimosCupones.length >= 6 && /^\d{4}-\d{2}-\d{2}$/.test(hp.datos.hoy), JSON.stringify(h?.porTamano));
  check("no envía datos de la cuenta ni el código", !/cloud|password|supabase|secreto|kal_/i.test(JSON.stringify(hp)));
  await view(page, "home"); await view(page, "analyst");
  check("el último análisis se guarda y se ve al volver", /Último análisis/.test(await page.$eval("#analystOut-historial", (e) => e.innerText)));
  // Revisar un cupón pendiente
  await page.selectOption("#analystCouponPick", "A");
  check("elegir un cupón pendiente carga su texto", /Fenerbahce/.test(await page.$eval("#analystCouponText", (e) => e.value)));
  await page.click('[data-analyst-run="cupon"]');
  await page.waitForTimeout(100);
  const st = await page.$eval("#analystOut-cupon [data-status]", (e) => e.textContent).catch(() => "");
  await page.waitForTimeout(800);
  const cp = analystPosts.at(-1);
  check("revisión de cupón: envía el cupón, el historial por mercado y el presupuesto", cp.modo === "cupon" && /Fenerbahce/.test(cp.datos.cupon) && Array.isArray(cp.datos.historial) && cp.datos.historial.length > 0, JSON.stringify(cp).slice(0, 160));
  check("muestra lo que está haciendo (búsquedas)", /Pensando|Buscando|Conectando/.test(st), st);
  check("revisión de cupón terminada", /Recomendaciones/.test(await page.$eval("#analystOut-cupon", (e) => e.innerText)));
  // Error a mitad del análisis y cancelar
  await page.fill("#analystCouponText", "Cupón que FALLA en el servidor");
  await page.click('[data-analyst-run="cupon"]'); await page.waitForTimeout(700);
  check("un error a mitad conserva lo recibido y explica el problema", await page.$eval("#analystOut-cupon", (e) => /límite de uso/.test(e.innerText) && e.querySelectorAll("li").length > 0));
  await page.fill("#analystCouponText", "Cupón LENTO de prueba para cancelar");
  await page.click('[data-analyst-run="cupon"]'); await page.waitForTimeout(250);
  await page.click("[data-analyst-cancel]"); await page.waitForTimeout(200);
  check("se puede cancelar un análisis", /cancelado/.test(await page.$eval("#analystOut-cupon", (e) => e.innerText)) && !(await page.$eval('[data-analyst-run="cupon"]', (b) => b.disabled)));
  // Desde Nuevo cupón
  await view(page, "new");
  check("el botón del Analista no aparece sin cupón leído", !(await page.isVisible("[data-analyst-preview]")));
  await page.fill("#raw", "España, La Liga\nBarcelona\nvs.\nReal Madrid\n25/10/2026 • 08:00\nMás de 2.5 goles\nCuotas: 1.85\nVALOR APOSTADO L 120.00");
  await page.click("#readBtn"); await page.waitForTimeout(200);
  const nPosts = analystPosts.length;
  await tap(page, "[data-analyst-preview]"); await page.waitForTimeout(900);
  const inl = await page.evaluate(() => ({ view: activeView, out: $("previewAnalystOut").innerText }));
  const ip = analystPosts.at(-1);
  check("'Analizar este cupón ahora' analiza ahí mismo, sin salir de Nuevo cupón", inl.view === "new" && /Recomendaciones/.test(inl.out) && analystPosts.length === nPosts + 1 && ip.modo === "cupon" && /Barcelona vs Real Madrid/.test(ip.datos.cupon) && /Valor apostado: L 120/.test(ip.datos.cupon) && ip.datos.riesgo?.selecciones === 1, JSON.stringify(inl).slice(0, 200));
  await page.fill("#raw", "España, La Liga\nBetis\nvs.\nSevilla\n26/10/2026 • 08:00\nMás de 1.5 goles\nCuotas: 1.30"); await tap(page, "#readBtn"); await page.waitForTimeout(200);
  check("al leer otro cupón se borra el análisis anterior", (await page.$eval("#previewAnalystOut", (e) => e.innerText.trim())) === "");
  await page.evaluate(() => { analystSave({ clave: "" }); });
  await tap(page, "[data-analyst-preview]"); await page.waitForTimeout(150);
  check("sin código del Analista explica cómo configurarlo", /primero escribe tu código/.test(await page.$eval("#previewAnalystOut", (e) => e.innerText)) && !!(await page.$("[data-analyst-open-config]")));
  await page.evaluate(() => { analystSave({ clave: "secreto" }); });
  const comp = await page.evaluate(() => ({
    names: ["UEFA Liga Campeones", "UEFA Champions League", "Liga de Campeones de la UEFA", "UEFA Liga Europa", "UEFA Europa League", "UEFA Conference League", "AFC Champions League", "CONCACAF Liga de Campeones", "Championship", "LaLiga", "Liga de Naciones de la UEFA", "UEFA Nations League", "CONCACAF Liga de Naciones"].map(canonicalCompetition),
    builder: (() => {
      db.coupons.push({ id: "BB", name: "BB", created: new Date().toISOString(), stake: 10, odds: 3.25, payout: 32.5, fixtures: [{ id: "bb1", home: "PSG", away: "Lyon", competition: "Ligue 1", date: "02/11/2026", time: "12:00",
        markets: [{ market: "Remates Kang-in Lee", pick: "Más de 0.5", odd: "", builder: true, builderOdd: "3.25", settlement: "won" }, { market: "Total de goles", pick: "Más de 1.5", odd: "", builder: true, builderOdd: "3.25", settlement: "won" }] }] });
      const p = analystMarketHistory(), row = p.byOdds.find((r) => r.name.startsWith("3.00"));
      const line = legLine(db.coupons.at(-1).fixtures[0], db.coupons.at(-1).fixtures[0].markets[0], true);
      db.coupons.pop();
      return { inflated: !!row && row.won >= 2, line };
    })(),
  }));
  check("estadísticas: una sola Champions/Europa/Conference, sin tocar otras confederaciones ni la Championship", comp.names.join("|") === "UEFA Champions League|UEFA Champions League|UEFA Champions League|UEFA Europa League|UEFA Europa League|UEFA Conference League|AFC Champions League|CONCACAF Liga de Campeones|Championship|LaLiga|UEFA Nations League|UEFA Nations League|CONCACAF Liga de Naciones", comp.names.join("|"));
  check("estadísticas: la cuota de un BetBuilder no se cuenta como cuota de cada selección", !comp.builder.inflated && /cuota del paquete 3.25/.test(comp.builder.line) && !/@ 3.25/.test(comp.builder.line), JSON.stringify(comp.builder));
  const nube = await page.evaluate(() => ["tutujwepbvlxfmizehkf.supabase.co", " https://tutujwepbvlxfmizehkf.supabase.co/rest/v1/ ", "tutujwepbvlxfmizehkf", "http://x.supabase.co", "no es url", ""].map(normalizeCloudUrl));
  check("nube: acepta la dirección de Supabase sin https://, con rutas o solo el proyecto", nube.join("|") === "https://tutujwepbvlxfmizehkf.supabase.co|https://tutujwepbvlxfmizehkf.supabase.co|https://tutujwepbvlxfmizehkf.supabase.co|https://x.supabase.co||", nube.join("|"));
  check("el código queda solo en este teléfono (no entra en los datos sincronizados)", await page.evaluate(() => !JSON.stringify(db).includes("secreto") && JSON.parse(localStorage.getItem("kal_analista_v1")).clave === "secreto"));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("17. Control de apuestas: freno al guardar, banca y diario");
{
  const db0 = baseDb();
  // 3 perdidos seguidos para probar la pausa
  for (let i = 0; i < 3; i++) db0.coupons.push({ id: "P" + i, name: "Perdido " + i, created: new Date(Date.now() - (5 - i) * 86400e3).toISOString(), updated: new Date(Date.now() - (5 - i) * 86400e3).toISOString(), stake: 10, odds: 2, payout: 20, fixtures: [{ id: "p" + i, home: "X" + i, away: "Y" + i, date: "01/11/2026", time: "10:00", markets: [{ market: "1x2", pick: "1", odd: "2", settlement: "lost" }] }] });
  const { ctx, page } = await open(db0);
  await view(page, "settings");
  await page.fill("#brAmount", "1000"); await page.fill("#brUnit", "2"); await page.fill("#brMax", "5"); await page.fill("#brPause", "3");
  await tap(page, "[data-bankroll-save]");
  const bank = await page.evaluate(() => ({ unit: unitStake(), cfg: bankrollCfg(), txt: $("bankrollBox").innerText }));
  check("banca: 1 unidad = 2 % de L 1,000 y se guarda en los datos (viaja con la nube)", bank.unit === 20 && bank.cfg.maxSel === 5 && /L 20.00/.test(bank.txt), JSON.stringify(bank));
  await view(page, "new");
  const legs = [["Fenerbahce", "Liverpool", "1x2: 2", "1.40"], ["Celtic", "Rangers", "Total de goles: Más de 1.5", "1.05"], ["Ajax", "PSV", "1x2: 1", "2.10"], ["Porto", "Benfica", "Ambos equipos marcan: Sí", "1.70"], ["Roma", "Lazio", "1x2: X", "3.20"], ["Lyon", "Lille", "1x2: 1", "1.90"], ["Sevilla", "Betis", "1x2: 1", "2.00"]];
  const raw = legs.map(([h, a, mk, o]) => `Europa, Liga\n${h}\nvs.\n${a}\n20/11/2026 • 14:00\n${mk}\nCuotas: ${o}`).join("\n") + "\nVALOR APOSTADO L 50.00";
  await page.fill("#raw", raw); await tap(page, "#readBtn"); await page.waitForTimeout(250);
  const risk = await page.$eval("#riskBox", (e) => ({ cls: e.querySelector(".risk-card")?.className, text: e.innerText.replace(/\s+/g, " ") }));
  check("freno: cupón de 7 selecciones marcado como riesgo alto, con su probabilidad", /is-high/.test(risk.cls) && /7 selecciones/.test(risk.text) && /tu límite es 5/.test(risk.text) && /Probabilidad (según tu historial|estimada)/.test(risk.text), risk.text.slice(0, 200));
  check("lector: sin línea de CUOTAS total no toma la cuota del último partido como total", (await page.$eval("#totalOdds", (e) => e.value)) === "" && /Según la cuota/.test(risk.text) && !/ 50 % Según/.test(risk.text), risk.text.slice(0, 160));
  check("freno: avisa del partido repetido en otros cupones y de la selección de relleno", /Fenerbahce vs Liverpool.*ya está en 1 cupón/.test(risk.text) && /relleno.*Celtic.*1.05/.test(risk.text), risk.text);
  check("freno: con 3 perdidos seguidos sugiere pausa y media unidad", /3 cupones perdidos seguidos/.test(risk.text) && /Monto sugerido: L 10.00/.test(risk.text), risk.text.match(/Monto sugerido[^)]*\)/)?.[0]);
  await tap(page, '[data-confidence="5"]'); await page.waitForTimeout(80);
  const sug5 = await page.$eval("#riskBox", (e) => e.innerText.match(/Monto sugerido[^:]*: (L [\d.,]+)/)?.[1]);
  await tap(page, "[data-use-stake]");
  check("freno: confianza 5 = 2 unidades (a la mitad por la racha) y 'Usar' pone el importe", sug5 === "L 20.00" && (await page.$eval("#stake", (e) => e.value)) === "20", sug5);
  await page.fill("#couponReason", "Local fuerte");
  await tap(page, "#saveBtn"); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => { const c = db.coupons[0]; return { conf: c.confidence, reason: c.reason, pickerReset: !$("couponConfidence").value }; });
  check("diario: guarda la confianza y el motivo, y limpia el formulario", saved.conf === 5 && saved.reason === "Local fuerte" && saved.pickerReset, JSON.stringify(saved));
  await page.evaluate(() => { db.coupons[0].fixtures.forEach((f) => f.markets.forEach((m) => (m.settlement = "won"))); db.coupons[0].payout = 400; save(); });
  await view(page, "stats");
  check("estadísticas: sección 'Según tu confianza'", /Confianza 5 · Muy alta/.test(await page.$eval("#perfSection", (e) => e.innerText)));
  const pay = await page.evaluate(() => analystHistoryPayload());
  check("Analista: recibe confianza, motivo y la banca", pay.porConfianza?.[0]?.confianza === 5 && pay.ultimosCupones.some((c) => c.motivo === "Local fuerte") && pay.banca?.unidad === 20);
  // Editar recupera la confianza
  await view(page, "saved");
  await page.evaluate(() => { const b = document.createElement("button"); b.dataset.detail = db.coupons[0].id; document.body.appendChild(b); b.click(); b.remove(); }); await page.waitForTimeout(200);
  check("editar un cupón recupera su confianza y motivo", (await page.$eval("#couponConfidence", (e) => e.value)) === "5" && (await page.$eval("#couponReason", (e) => e.value)) === "Local fuerte");
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("18. Valor de la cuota: cierre (CLV), calculadora y comparador");
{
  const { ctx, page } = await open(baseDb());
  const vc = await page.evaluate(() => valueCalc({ odd: 2.1, ref: [1.95, 3.6, 4.2], houses: [{ name: "Hondubet", odd: 2.05 }, { name: "Doradobet", odd: 2.2 }] }));
  check("calculadora: quita el margen y calcula probabilidad, cuota justa y valor esperado", Math.abs(vc.fairP - 0.4985) < 0.001 && Math.abs(vc.fairOdd - 2.006) < 0.01 && Math.abs(vc.margin - 0.0287) < 0.001 && vc.use === 2.2 && Math.abs(vc.ev - (0.4985 * 2.2 - 1)) < 0.002 && vc.kellyQuarter > 0, JSON.stringify(vc));
  await page.evaluate(() => { db.settings = { banca: { monto: 1000, unidadPct: 2, maxSel: 5, pausaTras: 3 } }; save(); });
  await view(page, "analyst");
  await page.fill("#vcOdd", "2.10"); await page.fill("#vcRef", "1.95 3.60 4.20");
  await page.fill('[data-vc-house="h1"]', "2.05"); await page.fill('[data-vc-house="h2"]', "2.20");
  const vt = await page.$eval("#vcResult", (e) => e.innerText.replace(/\s+/g, " "));
  check("calculadora en pantalla: mejor casa, cuota justa y veredicto con monto prudente", /Mejor cuota: Doradobet 2.20/.test(vt) && /Cuota justa: 2.01/.test(vt) && /Tiene valor/.test(vt) && /¼ de Kelly/.test(vt), vt);
  await page.fill("#vcOdd", "1.80"); await page.fill('[data-vc-house="h1"]', ""); await page.fill('[data-vc-house="h2"]', "");
  check("calculadora: una cuota por debajo de la justa no tiene valor", /Sin valor/.test(await page.$eval("#vcResult", (e) => e.innerText)));
  // Cuota de cierre desde la ficha del partido
  await view(page, "calendar"); await page.click('[data-agenda-range="all"]');
  await page.evaluate(() => [...document.querySelectorAll("#agendaList .agenda-match")].find((e) => e.innerText.includes("Fenerbahce")).click());
  await page.waitForTimeout(200);
  page.promptAnswer = "1.30";
  await page.evaluate(() => [...document.querySelectorAll(".match-tab-content > .mk-card")].find((e) => e.innerText.includes("Total de goles")).querySelector("[data-close-odd]").click());
  await page.waitForTimeout(200);
  const chip = await page.evaluate(() => [...document.querySelectorAll(".match-tab-content > .mk-card")].find((e) => e.innerText.includes("Total de goles")).querySelector(".clv-chip")?.innerText);
  check("cierre: se guarda y muestra el valor (1.50 contra cierre 1.30 = +15 %)", chip === "Cierre 1.30 · +15 %", chip);
  const st = await page.evaluate(() => ({ s: clvStats(), saved: JSON.parse(localStorage.getItem("kal_coupon_organizer_v2")).coupons[0].fixtures[0].markets[0].closeOdd, pay: analystHistoryPayload().valorCierre }));
  check("cierre: cuenta en las estadísticas y llega al Analista", st.s.n === 1 && Math.abs(st.s.avg - 0.1538) < 0.001 && st.saved === 1.3 && st.pay.mercados === 1, JSON.stringify(st));
  await page.evaluate(() => closeMatchDetails());
  await view(page, "stats");
  check("estadísticas: sección de valor frente al cierre", /Valor medio frente al cierre/.test(await page.$eval("#perfSection", (e) => e.innerText)));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("19. Datos del partido: forma, tabla, enfrentamientos y modelo de goles");
{
  const D = await import(path.join(ROOT, "cloudflare/datos-partido.mjs"));
  const m = D.poissonModel(1.5, 1.5);
  check("modelo Poisson: probabilidades coherentes (λ 1.5 + 1.5 → más de 2.5 = 57.7 %)", Math.abs(m.p1 - m.p2) < 0.001 && Math.abs(m.p1 + m.px + m.p2 - 1) < 0.002 && Math.abs(m.over25 - 0.577) < 0.002 && m.over15 > m.over25 && m.over25 > m.over35, JSON.stringify(m));
  const T = (id, name, shortName, tla) => ({ id, name, shortName, tla });
  const fdMatches = [
    { id: 11, utcDate: "2026-11-22T20:00:00Z", status: "TIMED", competition: { id: 2002, code: "BL1", name: "Bundesliga" }, homeTeam: T(5, "FC Bayern München", "Bayern", "FCB"), awayTeam: T(4, "Borussia Dortmund", "Dortmund", "BVB"), score: { fullTime: {} } },
    { id: 12, utcDate: "2026-11-22T18:00:00Z", status: "TIMED", competition: { id: 2014, code: "PD", name: "Primera Division" }, homeTeam: T(78, "Club Atlético de Madrid", "Atleti", "ATM"), awayTeam: T(81, "FC Barcelona", "Barça", "FCB"), score: { fullTime: {} } },
  ];
  check("nombres: español, alias y equipos al revés", D.nameScore("España", T(1, "Spain", "Spain", "ESP")) === 1 && D.findMatch(fdMatches, "Bayern Múnich", "Dortmund")?.m.id === 11 && D.findMatch(fdMatches, "Barcelona", "Atlético de Madrid")?.swapped === true && !D.findMatch(fdMatches, "Inter", "Napoli"));
  const fin = (id, h, a, gh, ga, d) => ({ id, utcDate: d + "T15:00:00Z", status: "FINISHED", competition: { name: "Bundesliga" }, homeTeam: T(h, "H" + h, "H" + h), awayTeam: T(a, "A" + a, "A" + a), score: { fullTime: { home: gh, away: ga } } });
  const row = (id, pos, pj, gf, ga) => ({ position: pos, team: { id }, playedGames: pj, won: 3, draw: 1, lost: 1, points: 10, goalsFor: gf, goalsAgainst: ga, form: "W,W,D,L,W" });
  const standings = { standings: ["TOTAL", "HOME", "AWAY"].map((type) => ({ type, table: [row(5, 1, 6, 15, 4), row(4, 2, 6, 12, 6), row(9, 3, 6, 6, 8), row(10, 4, 6, 4, 12)] })) };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url.replace("https://api.football-data.org/v4", ""));
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (/\/matches\?dateFrom=2026-11-21&dateTo=2026-11-23/.test(url)) return ok({ matches: fdMatches });
    if (/competitions\/BL1\/standings/.test(url)) return ok(standings);
    if (/matches\/11\/head2head/.test(url)) return ok({ aggregates: { numberOfMatches: 4, totalGoals: 13, homeTeam: { wins: 3, draws: 0, losses: 1 }, awayTeam: { wins: 1, draws: 0, losses: 3 } }, matches: [fin(1, 5, 4, 4, 2, "2026-03-01")] });
    if (/teams\/5\/matches/.test(url)) return ok({ matches: [fin(2, 5, 9, 3, 0, "2026-11-15"), fin(3, 10, 5, 1, 1, "2026-11-08")] });
    if (/teams\/4\/matches/.test(url)) return ok({ matches: [fin(4, 4, 10, 2, 1, "2026-11-15")] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mem = new Map(), store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v) };
  const req = (q) => new Request("https://x/api/datos-partido?" + new URLSearchParams(q));
  const r1 = await (await D.datosPartido(req({ home: "Bayern Múnich", away: "Dortmund", date: "2026-11-22" }), { token: "t", store, fetchImpl: fakeFetch })).json();
  check("datos: encuentra el partido y arma tabla, forma, enfrentamientos y modelo", r1.encontrado && r1.tabla.local.posicion === 1 && r1.tabla.local.forma === "GGEPG" && r1.forma.local[0].resultado === "G" && r1.forma.local[0].marcador === "3-0" && r1.h2h.partidos === 4 && r1.modelo.p1 > r1.modelo.p2 && r1.modelo.base === "tabla de local y visitante", JSON.stringify(r1).slice(0, 300));
  const onlyTotal = [{ type: "TOTAL", table: [row(5, 1, 12, 40, 10), row(4, 2, 12, 20, 20), row(9, 3, 12, 14, 18), row(10, 4, 12, 10, 36)] }];
  const xg = D.expectedGoals(onlyTotal, 5, 10), xr = D.expectedGoals(onlyTotal, 10, 5);
  check("modelo: con solo la tabla general (plan gratis) usa ataque, defensa y ventaja de local", xg && xg.lh > xg.la && xg.lh > xr.lh && /tabla general/.test(xg.base), JSON.stringify(xg));
  const n1 = calls.length;
  await D.datosPartido(req({ home: "Bayern Múnich", away: "Dortmund", date: "2026-11-22" }), { token: "t", store, fetchImpl: fakeFetch });
  check("datos: la segunda consulta sale de la caché (cuida el límite de 10 por minuto)", n1 === 5 && calls.length === 5, n1 + "/" + calls.length);
  const noKey = await D.datosPartido(req({ home: "A", away: "B", date: "2026-11-22" }), { token: "", store, fetchImpl: fakeFetch });
  const nf = await (await D.datosPartido(req({ home: "Inter", away: "Napoli", date: "2026-11-22" }), { token: "t", store, fetchImpl: fakeFetch })).json();
  const limited = await D.datosPartido(req({ home: "X", away: "Y", date: "2026-12-01" }), { token: "t", store: null, fetchImpl: async () => ({ ok: false, status: 429 }) });
  check("datos: sin clave, partido no cubierto y límite de consultas con mensajes claros", noKey.status === 503 && nf.encontrado === false && /Nations League/.test(nf.motivo) && limited.status === 429 && /10 consultas/.test((await limited.json()).error));

  const { ctx, page } = await open(baseDb());
  await view(page, "calendar"); await page.click('[data-agenda-range="all"]');
  await page.evaluate(() => [...document.querySelectorAll("#agendaList .agenda-match")].find((e) => e.innerText.includes("Fenerbahce")).click());
  await page.waitForTimeout(150);
  await tap(page, '[data-match-tab="datos"]');
  await page.waitForTimeout(500);
  const panel = await page.$eval("#matchTabPanel", (e) => e.innerText.replace(/\s+/g, " "));
  check("ficha → 📈 Datos: modelo, tabla, forma y enfrentamientos", /Modelo de goles/.test(panel) && /Más de 2.5 goles 53 %/.test(panel) && /12º/.test(panel) && /Forma reciente/.test(panel) && /Enfrentamientos directos/.test(panel), panel.slice(0, 300));
  check("ficha → 📈 Datos: compara tus mercados con el modelo (más de 1.5 a 1.50: 77 % → +16 % de valor)", /Total de goles · Más de 1.5 Modelo 77 % · cuota 1.50 \(67 %\) \+16 % valor/.test(panel) && /Ambos equipos marcan · Sí Modelo 52 %/.test(panel), panel.match(/Tus mercados[^📊]*/)?.[0]);
  check("ficha → 📈 Datos: pide los datos con la fecha del partido", seen.some((x) => x.startsWith("datos:Fenerbahce|20")));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("20. Analista: mi semana, armar cupones y riesgo en la revisión");
{
  const A = await import(path.join(ROOT, "servidor/analista.mjs"));
  const pa = A.construirPeticion("armar", { partidos: "España vs Suiza\nAlemania vs Italia", banca: { unidad: 20, maxSelecciones: 4 } });
  const ps = A.construirPeticion("semana", { semana: { ultimos7dias: { cupones: 3 } } });
  const bad = await A.leerPeticion(new Request("https://x", { method: "POST", headers: { "x-kal-clave": "s" }, body: JSON.stringify({ modo: "armar", datos: { partidos: "" } }) }), { ANTHROPIC_API_KEY: "k", ANALISTA_CLAVE: "s" });
  check("servidor: 'armar' busca en internet y recibe tu banca; 'semana' no busca; valida los datos", pa.tools[0].max_uses === 8 && /Ayúdame a armar cupones/.test(pa.messages[0].content) && /"maxSelecciones":4/.test(pa.messages[0].content) && /Un partido no se repite/.test(pa.system) && !ps.tools && /últimos 7 días/.test(ps.messages[0].content) && bad.error.status === 400);
  const db0 = baseDb();
  db0.settings = { banca: { monto: 1000, unidadPct: 2, maxSel: 4, pausaTras: 3 } };
  db0.coupons.push({ id: "W1", name: "Semana 1", created: new Date(Date.now() - 2 * 86400e3).toISOString(), updated: new Date(Date.now() - 86400e3).toISOString(), stake: 50, odds: 3, payout: 150, fixtures: [{ id: "w1", home: "Ajax", away: "PSV", date: "09/11/2026", time: "12:00", markets: [{ market: "1x2", pick: "1", odd: "1.5", settlement: "won" }, { market: "Ambos equipos marcan", pick: "Sí", odd: "2", settlement: "won" }] }] });
  db0.coupons.push({ id: "W2", name: "Semana 2", created: new Date(Date.now() - 3 * 86400e3).toISOString(), updated: new Date(Date.now() - 2 * 86400e3).toISOString(), stake: 20, odds: 30, payout: 600, fixtures: ["a", "b", "c", "d", "e"].map((k, i) => ({ id: "w2" + k, home: "Ajax", away: "PSV" + (i ? i : ""), date: "09/11/2026", time: "12:00", markets: [{ market: "1x2", pick: "1", odd: "1.8", settlement: i === 4 ? "lost" : "won" }] })) });
  const { ctx, page } = await open(db0);
  const week = await page.$eval("#weekCard", (e) => e.innerText.replace(/\s+/g, " "));
  check("Inicio: tarjeta de los últimos 7 días con resultado y avisos de tus reglas", /Tus últimos 7 días/.test(week) && /2 Cupones/.test(week) && /1 \/ 1/.test(week) && /\+L 80.00/.test(week) && /por encima de tu límite/.test(week) && /monto\(s\) de más de 2 unidades/.test(week), week);
  await tap(page, "[data-week-analyst]"); await page.waitForTimeout(200);
  check("Inicio → 🤖 Analizar lleva a 'Mi semana'", (await page.evaluate(() => activeView)) === "analyst" && !!(await page.$("[data-analyst-run=semana]")));
  await page.evaluate(() => { analystSave({ clave: "secreto" }); renderAnalyst(); });
  const before = analystPosts.length;
  await tap(page, '[data-analyst-run="semana"]'); await page.waitForTimeout(700);
  const sp = analystPosts.at(-1);
  check("Mi semana: envía los últimos 7 días y el historial general", analystPosts.length === before + 1 && sp.modo === "semana" && sp.datos.semana.ultimos7dias.cupones === 2 && sp.datos.semana.general.porMercado.length > 0 && /Recomendaciones/.test(await page.$eval("#analystOut-semana", (e) => e.innerText)));
  await page.fill("#analystBuildText", "España vs Suiza\nAlemania vs Italia — me gusta más de 2.5");
  await tap(page, '[data-analyst-run="armar"]'); await page.waitForTimeout(800);
  const ap = analystPosts.at(-1);
  check("Armar cupones: envía tus partidos, tu límite, tu unidad y tu historial", ap.modo === "armar" && /Alemania vs Italia/.test(ap.datos.partidos) && ap.datos.banca.maxSelecciones === 4 && ap.datos.banca.unidad === 20 && Array.isArray(ap.datos.historial));
  await page.selectOption("#analystCouponPick", "A");
  await tap(page, '[data-analyst-run="cupon"]'); await page.waitForTimeout(800);
  const cp = analystPosts.at(-1);
  check("Revisar cupón: envía el riesgo calculado (sin contar el mismo cupón como repetido)", cp.modo === "cupon" && cp.datos.riesgo?.selecciones >= 1 && cp.datos.riesgo.limiteSelecciones === 4 && Array.isArray(cp.datos.riesgo.repetidosEnOtrosCupones) && !cp.datos.riesgo.repetidosEnOtrosCupones.some((x) => x.cupones > 1) && cp.datos.banca.unidad === 20, JSON.stringify(cp.datos.riesgo));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("21. Copias automáticas, espejo, novedades y rutas /api");
{
  const { ctx, page } = await open(baseDb(), { init: "news" });
  await page.waitForTimeout(1400);
  check("novedades: se muestran una vez al llegar la versión nueva", (await page.$(".news-wrap")) !== null && /Versión 16/.test(await page.$eval(".news-sheet", (e) => e.innerText)));
  await tap(page, "[data-news-close]");
  await page.reload(); await page.waitForTimeout(1500);
  check("novedades: no se repiten al volver a abrir", (await page.$(".news-wrap")) === null);
  const snaps = await page.evaluate(async () => (await snapshots()).map((s) => s.motivo));
  check("copias: copia semanal automática al abrir", snaps.includes("Copia semanal"), JSON.stringify(snaps));
  // Espejo: se borra el almacenamiento normal y al abrir se recupera
  await page.evaluate(async () => { db.coupons[0].name = "Cambiado"; save(); await new Promise((r) => setTimeout(r, 1500)); localStorage.removeItem("kal_coupon_organizer_v2"); });
  await page.reload(); await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => ({ n: db.coupons.length, name: db.coupons[0]?.name, ls: !!localStorage.getItem("kal_coupon_organizer_v2") }));
  check("espejo: si se pierde el almacenamiento normal, los datos se recuperan solos", rec.n === 3 && rec.name === "Cambiado" && rec.ls, JSON.stringify(rec));
  // Restaurar una copia
  await view(page, "settings");
  await page.evaluate(async () => { db.coupons = []; save(); renderAll(); await renderSnapshotBox(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector("[data-snap-restore]").click());
  await page.waitForTimeout(600);
  const after = await page.evaluate(async () => ({ n: db.coupons.length, motivos: (await snapshots()).map((s) => s.motivo) }));
  check("copias: restaurar desde Ajustes recupera los cupones (y guarda antes una copia de lo actual)", after.n === 3 && after.motivos[0] === "Antes de restaurar", JSON.stringify(after));
  check("copias: el respaldo descargable usa el mismo formato", await page.evaluate(() => { const p = backupPayload(); return p.version === 3 && Array.isArray(p.db.coupons) && typeof p.logos === "object"; }));
  check("la app llama a las funciones en /api/ (ya no en /.netlify/)", seen.length > 0 && !(await page.evaluate(() => [...document.scripts].length && performance.getEntriesByType("resource").some((r) => r.name.includes("/.netlify/")))));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

section("22. Cupones antes de apostar (boleto sin totales)");
{
  const { ctx, page } = await open(null);
  const slips = [1, 2, 3].map((n) => fs.readFileSync(path.join(ROOT, `pruebas/previa-${n}.txt`), "utf8"));
  const r = await page.evaluate((slips) => slips.map((t) => {
    const p = parseCoupon(t);
    return { meta: p.meta, n: p.fixtures.length, legs: p.fixtures.reduce((s, f) => s + f.markets.length, 0),
      f: p.fixtures.map((f) => ({ h: f.home, a: f.away, iso: f.dateISO, t: f.time, b: f.builderOdd, m: f.markets.map((m) => [m.market, m.pick, m.odd, m.builder ? 1 : 0, m.builderOdd || ""]) })) };
  }), slips);
  const [a, b, c] = r;
  check("previa 1: 11 BetBuilder de selecciones con sus 25 selecciones, fecha, hora y cuota del paquete", a.meta.betslip && a.n === 11 && a.legs === 25 && a.f[0].h === "Senegal" && a.f[0].a === "Sudan" && a.f[0].iso === "2026-11-12" && a.f[0].t === "13:00" && a.f[0].b === "1.16" && JSON.stringify(a.f[0].m[1]) === JSON.stringify(["Doble oportunidad", "1 o empate", "", 1, "1.16"]) && a.f[7].m[1][0] === "Remates - Arda Guler (TUR)" && a.f[7].m[1][1] === "Más de 1.5", JSON.stringify(a.f[0]));
  const prod1 = [1.16, 1.26, 1.42, 1.3, 1.2, 1.35, 1.13, 1.52, 1.47, 1.33, 1.8].reduce((x, y) => x * y, 1);
  check("previa 1: cuota total calculada multiplicando cada BetBuilder una vez", Math.abs(a.meta.oddsProduct - Math.round(prod1 * 100) / 100) < 0.011 && a.meta.stake === null && a.meta.payout === null, a.meta.oddsProduct + " vs " + prod1.toFixed(2));
  check("previa 2: 4 BetBuilder con 12 selecciones (incluye hándicap y remates)", b.n === 4 && b.legs === 12 && b.f[1].m[1][0] === "Hándicap" && b.f[1].m[1][1] === "2 (+0.5)" && b.f[2].b === "2.20" && b.f[2].m.length === 4, JSON.stringify(b.f[1]));
  const simple = c.f.filter((f) => !f.b), bb = c.f.filter((f) => f.b);
  check("previa 3: 18 partidos mezclando simples (con fecha después) y BetBuilder (con fecha antes)", c.n === 18 && c.legs === 22 && simple.length === 14 && bb.length === 4 && c.f[0].h === "FK Bodo Glimt" && c.f[0].iso === "2026-11-24" && c.f[0].t === "11:45" && JSON.stringify(c.f[0].m[0]) === JSON.stringify(["Ambos equipos marcan", "Sí", "1.38", 0, ""]) && c.f[11].m[0][0] === "2 marcará" && c.f[11].m[0][2] === "1.25" && c.f[10].h === "Sabah FC" && c.f[10].iso === "2026-11-25" && c.f[10].b === "1.17", JSON.stringify(c.f.slice(10, 12)));
  const v4 = await page.evaluate((t) => { const p = parseCoupon(t); const f = p.fixtures[0]; return { slip: p.meta.betslip, n: p.fixtures.length, h: f?.home, a: f?.away, b: f?.builderOdd, iso: f?.dateISO, m: f?.markets.map((m) => m.market + ": " + m.pick) }; }, fs.readFileSync(path.join(ROOT, "pruebas/previa-4.txt"), "utf8"));
  check("previa 4: equipos en líneas separadas con 'competitor logo' y 'vs' sueltos", v4.slip && v4.n === 1 && v4.h === "Turquía" && v4.a === "Bélgica" && v4.b === "2.40" && v4.iso === "2026-11-12" && v4.m.length === 5 && v4.m[4] === "Total de tarjetas: Más de 2.5" && v4.m[1] === "Remates a Puerta (Arda Guler (TUR)) - Incl. suplente: Más de 0.5", JSON.stringify(v4));
  const totals = await page.evaluate((t) => parseCoupon(t + "\nCuota total 245.10\nValor total L 50\nBono 5\nGanancia total 12,255.00").meta, slips[2]);
  check("previa: lee los totales si se pegan al final", totals.odds === 245.1 && totals.stake === 50 && totals.bonus === 5 && totals.payout === 12255, JSON.stringify(totals));
  const old = await page.evaluate((t) => { const p = parseCoupon(t); return { slip: !!p.meta.betslip, n: p.fixtures.length }; }, fs.readFileSync(path.join(ROOT, "pruebas/doradobet-1.txt"), "utf8"));
  check("los cupones ya apostados siguen usando su lector", !old.slip && old.n > 10, JSON.stringify(old));
  const players = await page.evaluate(() => ["Remates - Arda Guler (TUR)", "Remates a Puerta - Harry Kane (ENG)", "Remates (Lopez Fermin (ESP)) y suplente"].map((mk) => parsePlayerBet({ market: mk, pick: "Más de 1.5" }, { home: "Turquía", away: "Bélgica" })?.name || null));
  check("jugadores en el formato del boleto: Arda Guler, Harry Kane, Lopez Fermin", players.join("|") === "Arda Guler|Harry Kane|Lopez Fermin", players.join("|"));
  await view(page, "new");
  await page.fill("#raw", slips[2]); await tap(page, "#readBtn"); await page.waitForTimeout(300);
  const ui = await page.evaluate(() => ({ odds: $("totalOdds").value, hint: $("slipHint").innerText, need: ["stake", "bonus", "payout"].filter((id) => $(id).classList.contains("need-input")), risk: !!document.querySelector("#riskBox .risk-card") }));
  check("Nuevo cupón: pone la cuota calculada, avisa qué falta y resalta valor apostado y ganancia", Number(ui.odds) > 100 && /antes de apostar/i.test(ui.hint) && /valor apostado/.test(ui.hint) && ui.need.includes("stake") && ui.need.includes("payout") && ui.risk, JSON.stringify(ui));
  await page.fill("#stake", "20");
  check("al escribir el valor apostado deja de estar resaltado", !(await page.$eval("#stake", (e) => e.classList.contains("need-input"))));
  const ph = await page.$eval("#payout", (e) => ({ ph: e.placeholder, need: e.classList.contains("need-input") }));
  const oddsNow = Number(await page.$eval("#totalOdds", (e) => e.value));
  check("ganancia total vacía: muestra la calculada (valor × cuota) y deja de pedirla", ph.ph === (20 * oddsNow).toFixed(2) + " (calculada)" && !ph.need, JSON.stringify(ph));
  check("sin errores", !page.errors.length, page.errors.join(" | "));
  await ctx.close();
}

// ---------- 8. Funciones del servidor (con API simulada) ----------
section("8. Funciones del servidor (API-Football y TheSportsDB)");
{
  process.env.API_FOOTBALL_KEY = "x";
  let mode = "ok";
  globalThis.fetch = async (u) => {
    u = new URL(u); const p = u.searchParams; const json = (b) => ({ status: 200, ok: true, json: async () => b });
    if (mode === "plan") return json({ errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." }, response: [] });
    if (p.get("from") && !p.get("season")) return json({ errors: { season: "The Season field is required." }, response: [] });
    if (p.get("from")) return json({ errors: [], response: [{ fixture: { id: 9, date: "2026-11-04T14:00:00Z" }, league: { id: 2, season: 2026 }, teams: { home: { id: 1 }, away: { id: 2 } } }] });
    return json({ errors: [], response: [{ fixture: { id: 9 }, statistics: [] }] });
  };
  const { default: partido } = await import(path.join(ROOT, "servidor/partido.mjs"));
  let r = await partido(new Request("https://x/p?homeId=1&awayId=2&date=2026-11-04&mode=match", { headers: { "x-nf-client-connection-ip": "a" } }));
  check("partido: envía la temporada y encuentra el partido", (await r.json()).fixture?.fixture?.id === 9);
  mode = "plan";
  r = await partido(new Request("https://x/p?homeId=1&awayId=3&date=2026-11-04&mode=match", { headers: { "x-nf-client-connection-ip": "b" } }));
  check("partido: explica el límite del plan gratis en español", /plan gratis/.test((await r.json()).error || ""));
  // TheSportsDB (con respuestas simuladas como las reales: un resultado por búsqueda)
  const tsdbCalls = [];
  globalThis.fetch = async (u) => {
    const url = new URL(u), q = url.searchParams.get("t") || url.searchParams.get("p");
    tsdbCalls.push(q);
    const R = {
      "Club Brugge KV": { teams: [{ idTeam: "2", strTeam: "Club NXT", strCountry: "Belgium", strSport: "Soccer", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/nxt.png" }] },
      "Club Brugge": { teams: [{ idTeam: "1", strTeam: "Club Brugge", strCountry: "Belgium", strSport: "Soccer", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/cb.png" }] },
      "Anastasios Douvikas": { player: [{ idPlayer: "5", strPlayer: "Anastasios Douvikas", strTeam: "_Retired Soccer", strSport: "Soccer" }] },
      "Douvikas": { player: [{ idPlayer: "6", strPlayer: "Tasos Douvikas", strTeam: "Como", strSport: "Soccer", strCutout: "https://r2.thesportsdb.com/images/media/player/cutout/d.png" }] },
    };
    return { ok: true, status: 200, json: async () => R[q] || { teams: null, player: null } };
  };
  const { default: imagenes } = await import(path.join(ROOT, "servidor/imagenes.mjs"));
  let ri = await (await imagenes(new Request("https://x/i?tipo=equipo&q=Club%20Brugge%20KV"))).json();
  check("TheSportsDB: prueba el nombre sin 'KV' y pone primero el equipo correcto", ri.options.map((o) => o.name).join() === "Club Brugge,Club NXT" && tsdbCalls.includes("Club Brugge"), JSON.stringify(ri.options.map((o) => o.name)));
  ri = await (await imagenes(new Request("https://x/i?tipo=jugador&q=Anastasios%20Douvikas&club=Como"))).json();
  check("TheSportsDB: prueba el apellido y descarta fichas sin foto", ri.options.length === 1 && ri.options[0].name === "Tasos Douvikas" && ri.options[0].photo.includes("cutout"), JSON.stringify(ri.options));
}

section("15. Función del Analista (Claude simulado)");
{
  const A = await import(path.join(ROOT, "servidor/analista.mjs"));
  const env = { ANTHROPIC_API_KEY: "sk-prueba", ANALISTA_CLAVE: "secreto" };
  const req = (body, clave = "secreto", method = "POST") => new Request("https://x/api/analista", { method, headers: { "x-kal-clave": clave }, body: method === "POST" ? JSON.stringify(body) : undefined });
  const status = async (r, e = env) => (await A.leerPeticion(r, e)).error?.status;
  check("rechaza sin ANTHROPIC_API_KEY, sin ANALISTA_CLAVE, con código malo o modo raro",
    (await status(req({ modo: "historial", datos: {} }), { ANALISTA_CLAVE: "x" })) === 503 && (await status(req({ modo: "historial", datos: {} }), { ANTHROPIC_API_KEY: "x" })) === 503 &&
    (await status(req({ modo: "historial", datos: {} }, "otro"))) === 401 && (await status(req({ modo: "x", datos: {} }))) === 400 && (await status(req({ modo: "cupon", datos: { cupon: "" } }))) === 400 &&
    (await status(new Request("https://x", { method: "GET" }))) === 405 && (await status(req({ modo: "historial", datos: { x: "a".repeat(130000) } }))) === 413);
  const pc = A.construirPeticion("cupon", { cupon: "Barcelona vs Real Madrid 1x2", historial: [{ tipo: "1X2" }], hoy: "2026-11-11" });
  const ph = A.construirPeticion("historial", { historial: { resumen: {} } });
  check("petición: modelo, respaldo ante rechazos, esfuerzo y búsqueda web solo al revisar cupones",
    pc.model === "claude-opus-5-5" && pc.fallbacks === "default" && pc.betas.includes("server-side-fallback-2026-07-01") && pc.output_config.effort === "medium" &&
    pc.tools[0].type === "web_search_20260209" && !ph.tools && /2026-11-11/.test(pc.messages[0].content) && /<cupon>/.test(pc.messages[0].content) && !("thinking" in pc) && !("temperature" in pc));
  // Cliente simulado: cada llamada sigue un guion de eventos y devuelve un mensaje final.
  const fakeClient = (scripts) => { const calls = []; return { calls, beta: { messages: { stream(params) {
    const sc = scripts[calls.length]; calls.push(JSON.parse(JSON.stringify(params))); const h = {};
    return { on(ev, fn) { (h[ev] = h[ev] || []).push(fn); return this; }, async finalMessage() {
      if (sc.throw) throw sc.throw;
      for (const [ev, ...args] of sc.events || []) (h[ev] || []).forEach((fn) => fn(...args));
      return { stop_reason: sc.stop, content: sc.content || [{ type: "text", text: "x" }], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: sc.searches || 0 } } };
    } };
  } } } }; };
  const run = async (scripts) => { const client = fakeClient(scripts), out = []; await A.analizar(client, pc, (e) => out.push(e)); return { client, out }; };
  let r = await run([
    { stop: "pause_turn", searches: 2, content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Barcelona lesiones" } }],
      events: [["streamEvent", { type: "content_block_start", content_block: { type: "server_tool_use" } }], ["contentBlock", { type: "server_tool_use", input: { query: "Barcelona lesiones" } }], ["text", "Hola "]] },
    { stop: "end_turn", searches: 1, events: [["text", "mundo"]] },
  ]);
  check("búsqueda larga (pause_turn): continúa con lo hecho y suma el uso", r.client.calls.length === 2 && r.client.calls[1].messages.at(-1).role === "assistant" && r.client.calls[1].messages.length === 2 &&
    r.out.filter((e) => e.t === "texto").map((e) => e.v).join("") === "Hola mundo" && r.out.some((e) => e.v === "Buscando: Barcelona lesiones") && r.out.at(-1).t === "fin" && r.out.at(-1).uso.busquedas === 3, JSON.stringify(r.out));
  r = await run([{ stop: "end_turn", events: [["text", "parcial"], ["streamEvent", { type: "content_block_start", content_block: { type: "fallback" } }], ["text", "nuevo"]] }]);
  check("si otro modelo retoma la respuesta, la app descarta lo parcial", r.out.map((e) => e.t).join() === "texto,reinicio,texto,fin");
  r = await run([{ stop: "refusal" }]);
  check("un rechazo se informa como error legible", r.out.at(-1).t === "error" && !r.out.some((e) => e.t === "fin"));
  const resp = await A.manejar(req({ modo: "historial", datos: { historial: {} } }), { env, crearCliente: () => fakeClient([{ throw: Object.assign(new Error("rate"), { status: 429 }) }]) });
  const lines = (await resp.text()).trim().split("\n").map((l) => JSON.parse(l));
  check("respuesta en streaming: empieza con 'Pensando…' y traduce los errores de la API", resp.headers.get("content-type").includes("ndjson") && lines[0].t === "estado" && lines.at(-1).t === "error" && /límite de uso/.test(lines.at(-1).v), JSON.stringify(lines));
  check("mensajes de error claros (sin saldo, clave mala)", /saldo/.test(A.mensajeDeError({ status: 400, message: "Your credit balance is too low" })) && /ANTHROPIC_API_KEY/.test(A.mensajeDeError({ status: 401 })));
  const edge = fs.readFileSync(path.join(ROOT, "cloudflare/worker.mjs"), "utf8");
  check("Worker: /api/analista con el SDK oficial y la clave desde las variables de Cloudflare", /nombre === "analista"/.test(edge) && /from "@anthropic-ai\/sdk"/.test(edge) && /env\.ANTHROPIC_API_KEY/.test(edge));
}

section("16. Cloudflare: notificaciones, avisos y el servidor real (workerd)");
{
  const W = await import(path.join(ROOT, "cloudflare/webpush.mjs"));
  const { avisosHandler, enviarAvisos } = await import(path.join(ROOT, "cloudflare/avisos.mjs"));
  const nodeCrypto = await import("node:crypto");
  const ece = require("http_ece");
  // Teléfono simulado: sus claves y una captura del envío
  const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const sub = { endpoint: "https://web.push.apple.com/QAbc", keys: { p256dh: W.b64u(ua.getPublicKey()), auth: W.b64u(auth) } };
  const keys = await W.generateVapidKeys();
  const realFetch = nativeFetch;
  let sent = null, status = 201;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response(null, { status }); };
  const r1 = await W.sendWebPush(sub, { title: "⏰ Barça", body: "Empieza en 15 min" }, { keys, subject: "https://kal.example.workers.dev" });
  const plain = ece.decrypt(Buffer.from(sent.init.body), { version: "aes128gcm", privateKey: ua, authSecret: W.b64u(auth) }).toString();
  check("Web Push: el mensaje cifrado (aes128gcm) se descifra con la librería de referencia", r1 === "ok" && plain === '{"title":"⏰ Barça","body":"Empieza en 15 min"}' && sent.init.headers["Content-Encoding"] === "aes128gcm", plain);
  const [, t, k] = sent.init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, sg] = t.split(".");
  const pk = nodeCrypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: W.b64u(W.unb64u(k).slice(1, 33)), y: W.b64u(W.unb64u(k).slice(33)) }, format: "jwk" });
  const claims = JSON.parse(Buffer.from(W.unb64u(c)).toString());
  check("Web Push: firma VAPID (ES256) válida, para el servicio correcto y con contacto", nodeCrypto.verify("sha256", Buffer.from(h + "." + c), { key: pk, dsaEncoding: "ieee-p1363" }, Buffer.from(W.unb64u(sg))) && claims.aud === "https://web.push.apple.com" && claims.sub === "https://kal.example.workers.dev" && claims.exp > Date.now() / 1000);
  status = 410;
  check("Web Push: un teléfono que ya no acepta avisos se detecta", (await W.sendWebPush(sub, {}, { keys, subject: "x" })) === "gone");
  globalThis.fetch = realFetch;

  // Lógica de avisos con un almacenamiento en memoria (igual al Durable Object)
  const mem = new Map();
  const store = { get: async (k2) => (mem.has(k2) ? structuredClone(mem.get(k2)) : null), put: async (k2, v) => void mem.set(k2, structuredClone(v)), delete: async (k2) => void mem.delete(k2), list: async (p) => [...mem.keys()].filter((x) => x.startsWith(p)) };
  const pushes = [];
  const fakeSend = async (s2, payload, opts) => { pushes.push({ payload, opts }); return s2.endpoint.includes("muerto") ? "gone" : "ok"; };
  const call = (body, method = "POST") => avisosHandler(new Request("https://kal-cupones.ejemplo.workers.dev/.netlify/functions/avisos" + (method === "GET" ? "?accion=clave" : ""), { method, body: method === "POST" ? JSON.stringify(body) : undefined }), store, fakeSend);
  const pub1 = (await (await call(null, "GET")).json()).publicKey, pub2 = (await (await call(null, "GET")).json()).publicKey;
  check("avisos: clave pública estable y dirección de la app guardada", pub1 && pub1 === pub2 && W.unb64u(pub1).length === 65 && mem.get("config/origin") === "https://kal-cupones.ejemplo.workers.dev");
  const now = Date.now();
  const saveRes = await (await call({ accion: "guardar", subscription: sub, lead: 15, matches: [{ id: "m1", title: "Barcelona vs Real Madrid", kickoff: new Date(now + 10 * 60000).toISOString() }, { id: "viejo", title: "X", kickoff: new Date(now - 5 * 3600000).toISOString() }] })).json();
  check("avisos: guarda solo partidos válidos", saveRes.partidos === 1);
  await call({ accion: "guardar", subscription: { endpoint: "https://push.example/muerto", keys: { p256dh: "a", auth: "b" } }, matches: [{ id: "z", title: "Y", kickoff: new Date(now + 5 * 60000).toISOString() }] });
  let r = await enviarAvisos(store, fakeSend, now);
  const pre = pushes.filter((p) => /Empieza en 10 min/.test(p.payload.body));
  check("avisos: 'Empieza en 10 min' con la clave y el contacto de la app; borra teléfonos que ya no existen", r.telefonos === 2 && pre.length === 1 && pre[0].opts.subject === "https://kal-cupones.ejemplo.workers.dev" && pre[0].opts.keys.publicKey === pub1 && (await store.list("sub/")).length === 1, JSON.stringify(r));
  pushes.length = 0;
  await enviarAvisos(store, fakeSend, now + 60000);
  check("avisos: no repite el mismo aviso", pushes.length === 0);
  await enviarAvisos(store, fakeSend, now + 11 * 60000);
  check("avisos: 'Empezó' a la hora del partido", pushes.length === 1 && /Empezó/.test(pushes[0].payload.title));
  await enviarAvisos(store, fakeSend, now + 4 * 3600000);
  check("avisos: limpia partidos de hace más de 3 horas", (await store.get((await store.list("sub/"))[0])).matches.length === 0);
  const pr = await call({ accion: "prueba", subscription: sub });
  check("avisos: notificación de prueba", pr.status === 200 && pushes.at(-1).payload.tag === "kal-prueba");

  // Servidor real de Cloudflare (workerd) con wrangler dev: archivos, rutas, Analista y tarea programada
  const { spawn } = await import("node:child_process");
  const net = await import("node:net");
  const port = await new Promise((res) => { const s2 = net.createServer(); s2.listen(0, () => { const p = s2.address().port; s2.close(() => res(p)); }); });
  let log = "";
  const dev = spawn(path.join(ROOT, "node_modules/.bin/wrangler"), ["dev", "--port", String(port), "--test-scheduled", "--persist-to", path.join(os.tmpdir(), "kal-wrangler-" + port), "--var", "ANALISTA_CLAVE:secreto", "--var", "ANTHROPIC_API_KEY:sk-prueba", "--var", "API_FOOTBALL_KEY:prueba"], { cwd: ROOT, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  dev.stdout.on("data", (d) => (log += d)); dev.stderr.on("data", (d) => (log += d));
  const B2 = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await new Promise((res) => setTimeout(res, 500)); up = await realFetch(B2 + "/").then((x) => x.ok, () => false); }
  check("workerd: el Worker arranca", up, log.slice(-400));
  if (up) {
    const home = await realFetch(B2 + "/"), swr = await realFetch(B2 + "/sw.js"), css = await realFetch(B2 + "/css/16-analista.css");
    check("workerd: sirve la app sin caché en la página y con el permiso del service worker", home.headers.get("cache-control") === "no-cache" && /<title>/.test(await home.text()) && swr.headers.get("service-worker-allowed") === "/" && css.ok);
    const clave = await (await realFetch(B2 + "/api/avisos?accion=clave")).json();
    check("workerd: avisos con almacenamiento (Durable Object) y claves generadas", W.unb64u(clave.publicKey).length === 65);
    const guard = await (await realFetch(B2 + "/api/avisos", { method: "POST", body: JSON.stringify({ accion: "guardar", lead: 15, subscription: sub, matches: [{ id: "w1", title: "A vs B", kickoff: new Date(Date.now() + 10 * 60000).toISOString() }] }) })).json();
    const an = await realFetch(B2 + "/api/analista", { method: "POST", headers: { "x-kal-clave": "malo" }, body: "{}" });
    const nf = await realFetch(B2 + "/api/nada");
    const fb = await (await realFetch(B2 + "/.netlify/functions/escudos")).json().catch(() => ({}));
    check("workerd: rutas de funciones y Analista protegidas", guard.partidos === 1 && an.status === 401 && nf.status === 404 && typeof fb === "object", JSON.stringify(guard));
    const dp = await realFetch(B2 + "/api/datos-partido?home=Barcelona&away=Madrid&date=2026-11-22");
    check("workerd: datos del partido sin clave explica cómo configurarla", dp.status === 503 && (await dp.json()).codigo === "sin_clave");
    await realFetch(B2 + "/__scheduled?cron=*/5+*+*+*+*");
    for (let i = 0; i < 20 && !/avisos: \d+ teléfono/.test(log); i++) await new Promise((res) => setTimeout(res, 300));
    check("workerd: la tarea programada de avisos corre", /avisos: 1 teléfono\(s\)/.test(log), log.split("\n").filter((l) => /avisos|rror/.test(l)).slice(-3).join(" | "));
  }
  try { process.kill(-dev.pid, "SIGTERM"); } catch {} // termina wrangler y su workerd (mismo grupo de procesos)
  await new Promise((res) => setTimeout(res, 500));
  fs.rmSync(path.join(os.tmpdir(), "kal-wrangler-" + port), { recursive: true, force: true });
}

await browser.close();
server.close();
console.log(`\n${ok} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
