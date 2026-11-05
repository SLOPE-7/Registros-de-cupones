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
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");

let ok = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) { ok++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "  →  " + detail : "")); } };
const section = (t) => console.log("\n" + t);

// ---------- servidor local ----------
const posts = [];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/.netlify/functions/avisos") {
    if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" })); }
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { posts.push(JSON.parse(b)); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); });
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
const view = (page, v) => page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), v);
const texts = (page, sel) => page.$$eval(sel, (x) => x.map((e) => e.innerText.replace(/\s+/g, " ").trim()));

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

// ---------- 8. Funciones de Netlify (con API y almacenamiento simulados) ----------
section("8. Funciones de Netlify");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kal-fn-"));
  fs.mkdirSync(path.join(tmp, "functions")); fs.mkdirSync(path.join(tmp, "lib"));
  for (const f of ["partido.mjs", "avisos.mjs", "avisos-envio.mjs"]) fs.copyFileSync(path.join(ROOT, "netlify/functions", f), path.join(tmp, "functions", f));
  fs.writeFileSync(path.join(tmp, "lib/avisos-comun.mjs"), `const mem=new Map();export const sent=[];
export const store=()=>({get:async k=>mem.has(k)?JSON.parse(mem.get(k)):null,setJSON:async(k,v)=>mem.set(k,JSON.stringify(v)),delete:async k=>mem.delete(k),list:async({prefix})=>({blobs:[...mem.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))})});
export const subKey=e=>'sub/'+e;export const vapidKeys=async()=>({publicKey:'P',privateKey:'Q'});export const pusher=async()=>({});
export async function sendPush(wp,sub,p){sent.push(p.title+' | '+p.body);return 'ok'}`);
  process.env.API_FOOTBALL_KEY = "x";
  let mode = "ok";
  globalThis.fetch = async (u) => {
    u = new URL(u); const p = u.searchParams; const json = (b) => ({ status: 200, ok: true, json: async () => b });
    if (mode === "plan") return json({ errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." }, response: [] });
    if (p.get("from") && !p.get("season")) return json({ errors: { season: "The Season field is required." }, response: [] });
    if (p.get("from")) return json({ errors: [], response: [{ fixture: { id: 9, date: "2026-11-04T14:00:00Z" }, league: { id: 2, season: 2026 }, teams: { home: { id: 1 }, away: { id: 2 } } }] });
    return json({ errors: [], response: [{ fixture: { id: 9 }, statistics: [] }] });
  };
  const { default: partido } = await import(path.join(tmp, "functions/partido.mjs"));
  let r = await partido(new Request("https://x/p?homeId=1&awayId=2&date=2026-11-04&mode=match", { headers: { "x-nf-client-connection-ip": "a" } }));
  check("partido: envía la temporada y encuentra el partido", (await r.json()).fixture?.fixture?.id === 9);
  mode = "plan";
  r = await partido(new Request("https://x/p?homeId=1&awayId=3&date=2026-11-04&mode=match", { headers: { "x-nf-client-connection-ip": "b" } }));
  check("partido: explica el límite del plan gratis en español", /plan gratis/.test((await r.json()).error || ""));
  const { default: avisos } = await import(path.join(tmp, "functions/avisos.mjs"));
  const { default: envio } = await import(path.join(tmp, "functions/avisos-envio.mjs"));
  const { sent } = await import(path.join(tmp, "lib/avisos-comun.mjs"));
  const now = Date.now(), sub = { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } };
  await avisos(new Request("https://x/a", { method: "POST", body: JSON.stringify({ accion: "guardar", subscription: sub, lead: 15, matches: [
    { id: "m1", title: "Lens vs Como · 14:00", body: "🏆 UEFA", kickoff: new Date(now + 12 * 60e3).toISOString() },
    { id: "m2", title: "Betis vs Sevilla · 13:00", body: "🏆 La Liga", kickoff: new Date(now - 60e3).toISOString() }] }) }));
  await envio();
  check("avisos: 'empieza en' y 'empezó' en el momento justo", sent.length === 2 && /Empieza en 12 min/.test(sent[0]) && /Empezó/.test(sent[1]), sent.join(" / "));
  await envio();
  check("avisos: no repite notificaciones", sent.length === 2);
  fs.rmSync(tmp, { recursive: true, force: true });
}

await browser.close();
server.close();
console.log(`\n${ok} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
