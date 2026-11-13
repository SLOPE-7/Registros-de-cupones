// El análisis del Analista se guarda dentro del cupón (V16.5) y se compara con el resultado.
// - La revisión termina con un bloque <kal-json>…</kal-json> (oculto en pantalla) con la confianza de cada
//   selección y el eslabón más débil.
// - Se pega al cupón: si analizas desde Nuevo cupón, al guardarlo; si eliges un cupón pendiente en el Analista, al
//   momento; si pegas el texto de un cupón ya guardado, se reconoce por sus partidos.
// - Cada selección queda con m.ai = { nivel: "Alta" | "Media" | "Baja", debil: true|false }.
// - Al resolverse el cupón: "El Analista lo vio venir" / "Falló algo que veía con confianza Alta"…, y en
//   Estadísticas, el acierto del Analista por nivel de confianza.
"use strict";

const AI_JSON_RE = /<kal-json>([\s\S]*?)<\/kal-json>/i;
// Quita el bloque de datos del texto que se muestra (también cuando aún está llegando a medias).
function stripAiJson(text) {
  return String(text || "")
    .replace(AI_JSON_RE, "")
    .replace(/<kal-json>[\s\S]*$/i, "")
    .trimEnd();
}
function parseAiVerdict(text) {
  const m = String(text || "").match(AI_JSON_RE);
  if (!m) return null;
  try {
    const raw = m[1].replace(/^```(?:json)?|```$/g, "").trim();
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

const fixtureSig = (fixtures) =>
  (fixtures || [])
    .map((f) => matchPairKey(f))
    .sort()
    .join("~");
const words = (s) =>
  crestNorm(s)
    .split(" ")
    .filter((w) => w.length > 1 && !["de", "del", "la", "el", "vs", "y", "a", "mas", "menos"].includes(w));
function overlap(a, b) {
  const A = new Set(words(a)),
    B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / Math.min(A.size, B.size);
}
// Busca en el cupón la selección que nombra el Analista.
function findLeg(c, item) {
  const partido = String(item?.partido || ""),
    texto = String(item?.mercado || "") + " " + String(item?.seleccion || "");
  let best = null;
  c.fixtures.forEach((f) => {
    const fs = Math.max(overlap(partido, f.home + " " + f.away), partido ? 0 : 0.5);
    if (fs < 0.5) return;
    f.markets.forEach((m) => {
      const ms = overlap(texto, (m.market || "") + " " + (m.pick || ""));
      // La línea (1.5, 2.5…) debe coincidir si el Analista la menciona.
      const nums = (s) => (String(s).match(/\d+[.,]\d/g) || []).map((x) => x.replace(",", "."));
      const ln = nums(texto),
        lm = nums((m.market || "") + " " + (m.pick || ""));
      const lineOk = !ln.length || !lm.length || ln.some((x) => lm.includes(x));
      const score = fs + ms + (lineOk ? 0 : -1);
      if (ms >= 0.4 && lineOk && (!best || score > best.score)) best = { f, m, score };
    });
  });
  return best;
}
const NIVELES = ["Alta", "Media", "Baja"];
const nivelOf = (v) => NIVELES.find((n) => crestNorm(n) === crestNorm(v)) || null;

function attachAnalysis(c, text) {
  const v = parseAiVerdict(text);
  c.analysis = {
    fecha: new Date().toISOString(),
    texto: stripAiJson(text).slice(0, 8000),
    veredicto: v?.veredicto ? String(v.veredicto).slice(0, 40) : null,
    probabilidad: Number.isFinite(Number(v?.probabilidad)) ? Number(v.probabilidad) : null,
  };
  // Las marcas anteriores se reemplazan por las de este análisis.
  c.fixtures.forEach((f) => f.markets.forEach((m) => delete m.ai));
  (Array.isArray(v?.selecciones) ? v.selecciones : []).forEach((it) => {
    const hit = findLeg(c, it),
      nivel = nivelOf(it?.confianza);
    if (hit && nivel) hit.m.ai = { ...(hit.m.ai || {}), nivel };
  });
  (Array.isArray(v?.eslabonDebil) ? v.eslabonDebil : v?.eslabonDebil ? [v.eslabonDebil] : []).forEach(
    (it) => {
      const hit = findLeg(c, it);
      if (hit) hit.m.ai = { ...(hit.m.ai || {}), debil: true };
    },
  );
  touchCoupon(c);
}

// Se llama al terminar una revisión. source: { couponId } | { draft: true } | { text }
function onAnalystCouponDone(text, source = {}) {
  let c = source.couponId ? db.coupons.find((x) => x.id === source.couponId) : null;
  if (!c && source.text) {
    try {
      const sig = fixtureSig(parseCoupon(source.text).fixtures);
      if (sig)
        c = db.coupons.find((x) => calcCoupon(x).status === "pending" && fixtureSig(x.fixtures) === sig);
    } catch {}
  }
  if (c) {
    attachAnalysis(c, text);
    save();
    toast("🤖 Análisis guardado en el cupón «" + c.name + "».");
    return;
  }
  // Aún no está guardado: se pega cuando se guarde un cupón con los mismos partidos.
  const sig = source.draft
    ? fixtureSig(draftSelections)
    : source.text
      ? fixtureSig(parseCoupon(source.text).fixtures)
      : "";
  if (sig) analystSave({ pendiente: { sig, texto: text, fecha: new Date().toISOString() } });
}
// Al guardar un cupón: si hay un análisis pendiente de esos mismos partidos (de las últimas 12 h), se le pega.
function attachPendingAnalysis(c) {
  const p = analystState().pendiente;
  if (!p?.sig || p.sig !== fixtureSig(c.fixtures)) return false;
  if (Date.now() - Date.parse(p.fecha || 0) > 12 * 3600000) return false;
  attachAnalysis(c, p.texto);
  analystSave({ pendiente: null });
  return true;
}

// ---------- ¿Acertó el Analista? ----------
const legName = (f, m) => f.home + " vs " + f.away + " · " + [m.market, m.pick].filter(Boolean).join(": ");
function couponAiOutcome(c) {
  if (!c.analysis) return null;
  const r = calcCoupon(c);
  const legs = c.fixtures.flatMap((f) => f.markets.map((m) => ({ f, m })));
  if (r.status === "lost") {
    const lost = legs.filter((x) => x.m.settlement === "lost");
    const seen = lost.filter((x) => x.m.ai?.debil || x.m.ai?.nivel === "Baja");
    if (seen.length)
      return {
        kind: "good",
        text: "🤖 El Analista lo vio venir: había marcado como débil " + legName(seen[0].f, seen[0].m) + ".",
      };
    const high = lost.find((x) => x.m.ai?.nivel === "Alta");
    if (high)
      return {
        kind: "bad",
        text:
          "🤖 Falló una selección que el Analista veía con confianza Alta: " + legName(high.f, high.m) + ".",
      };
    return lost.length
      ? {
          kind: "mid",
          text:
            "🤖 El Analista no había señalado la selección que falló: " + legName(lost[0].f, lost[0].m) + ".",
        }
      : null;
  }
  if (r.status === "won") {
    const risky = /arriesg/i.test(c.analysis.veredicto || "");
    return risky
      ? { kind: "mid", text: "🤖 El Analista lo veía arriesgado, pero salió." }
      : { kind: "good", text: "🤖 El Analista lo veía razonable y acertó." };
  }
  return {
    kind: "pending",
    text: "🤖 Analizado" + (c.analysis.veredicto ? ": " + c.analysis.veredicto : "") + ".",
  };
}
function couponAnalysisHtml(c) {
  if (!c.analysis) return "";
  const o = couponAiOutcome(c);
  return (
    '<details class="coupon-ai is-' +
    esc(o?.kind || "pending") +
    '"><summary>' +
    esc(o?.text || "🤖 Analizado") +
    ' <span class="small muted">· ver análisis</span></summary><div class="analyst-md">' +
    renderMd(c.analysis.texto) +
    "</div></details>"
  );
}

// Acierto del Analista: por nivel de confianza y en el eslabón débil.
function aiAccuracy() {
  const by = { Alta: { won: 0, lost: 0 }, Media: { won: 0, lost: 0 }, Baja: { won: 0, lost: 0 } };
  let analyzed = 0,
    lostCoupons = 0,
    foreseen = 0,
    weakFlags = 0,
    weakLost = 0;
  const seen = new Set();
  db.coupons.forEach((c) => {
    if (!c.analysis) return;
    analyzed++;
    c.fixtures.forEach((f) =>
      f.markets.forEach((m) => {
        if (!m.ai || (m.settlement !== "won" && m.settlement !== "lost")) return;
        const k = c.id + "|" + marketKey(f, m);
        if (seen.has(k)) return;
        seen.add(k);
        if (m.ai.nivel && by[m.ai.nivel]) by[m.ai.nivel][m.settlement]++;
        if (m.ai.debil) {
          weakFlags++;
          if (m.settlement === "lost") weakLost++;
        }
      }),
    );
    if (calcCoupon(c).status === "lost") {
      lostCoupons++;
      if (
        c.fixtures.some((f) =>
          f.markets.some((m) => m.settlement === "lost" && (m.ai?.debil || m.ai?.nivel === "Baja")),
        )
      )
        foreseen++;
    }
  });
  return { analyzed, by, lostCoupons, foreseen, weakFlags, weakLost };
}
function aiAccuracyHtml() {
  const a = aiAccuracy();
  if (!a.analyzed)
    return '<div class="empty small">Analiza tus cupones antes de apostar (Nuevo cupón → 🤖 Analizar) y aquí verás si el Analista acierta.</div>';
  const row = (n) => {
    const x = a.by[n],
      t = x.won + x.lost;
    return (
      '<div class="perf-house"><b>Confianza ' +
      n +
      "</b><small>" +
      t +
      " selecciones resueltas</small><span>" +
      (t ? Math.round((x.won / t) * 100) + " % acertadas" : "—") +
      "</span></div>"
    );
  };
  return (
    '<div class="perf-houses">' +
    NIVELES.map(row).join("") +
    '</div><p class="small">' +
    a.analyzed +
    " cupones analizados" +
    (a.lostCoupons
      ? " · en <b>" +
        a.foreseen +
        " de " +
        a.lostCoupons +
        "</b> perdidos, el Analista había marcado como débil la selección que falló"
      : "") +
    (a.weakFlags ? " · de sus " + a.weakFlags + " eslabones débiles, fallaron " + a.weakLost : "") +
    ".</p>"
  );
}
