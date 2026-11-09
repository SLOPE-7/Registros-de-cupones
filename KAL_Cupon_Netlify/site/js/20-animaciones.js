// Animaciones de resultado: confeti y tarjeta al ganar, sacudida al perder, y la pantalla de entrada.
// - Mercado ganado: ráfaga corta de confeti. Mercado perdido: sacudida breve.
// - Cupón ganado (todo acertado): tarjeta "¡Cupón ganado!" con la ganancia y confeti grande.
// - Cupón perdido: tarjeta "Cupón perdido" con lo apostado.
// Con "reducir movimiento" activado en el teléfono no hay confeti ni sacudidas (solo la tarjeta).
"use strict";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Estado de cada cupón antes de un cambio, para saber qué cambió después.
function couponStatusSnapshot() {
  return new Map(db.coupons.map((c) => [c.id, calcCoupon(c).status]));
}

// --- Confeti en un lienzo a pantalla completa (se elimina solo al terminar) ---
const CONFETTI_COLORS = ["#f5c542", "#2fd27a", "#4c9bff", "#ff6b6b", "#ffffff", "#ffd96a"];
function confetti({ count = 70, duration = 1500, originY = 0.55 } = {}) {
  if (reducedMotion()) return;
  const cv = document.createElement("canvas");
  cv.className = "confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1),
    w = innerWidth,
    h = innerHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7,
      speed = 6 + Math.random() * 9;
    return {
      x: w / 2 + (Math.random() - 0.5) * 60,
      y: h * originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      round: Math.random() < 0.3,
    };
  });
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration * 0.6) / (duration * 0.4));
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, 6.28);
        ctx.fill();
      } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else cv.remove();
  })(start);
}

// --- Tarjeta central de resultado del cupón (se cierra sola o al tocarla) ---
function resultCard({ kind, title, detail, amount }) {
  document.querySelector(".result-card-wrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "result-card-wrap is-" + kind;
  wrap.setAttribute("role", "status");
  wrap.innerHTML =
    '<div class="result-card"><div class="result-emoji">' +
    (kind === "won" ? "🏆" : "💔") +
    "</div><b>" +
    esc(title) +
    "</b>" +
    (detail ? "<span>" + esc(detail) + "</span>" : "") +
    (amount ? '<strong class="result-amount">' + esc(amount) + "</strong>" : "") +
    "</div>";
  document.body.appendChild(wrap);
  const close = () => {
    wrap.classList.add("is-leaving");
    setTimeout(() => wrap.remove(), 220);
  };
  wrap.addEventListener("click", close);
  setTimeout(close, kind === "won" ? 3200 : 2400);
}

function shakeScreen() {
  if (reducedMotion()) return;
  const target = document.querySelector(".match-modal.open .match-dialog") || document.querySelector("main");
  if (!target) return;
  target.classList.remove("shake");
  void target.offsetWidth; // reinicia la animación si se repite
  target.classList.add("shake");
  setTimeout(() => target.classList.remove("shake"), 450);
}

// Se llama después de marcar un resultado. Varias marcas seguidas ("Terminó el partido") se juntan en un
// solo aviso: gana el más importante (cupón ganado > cupón perdido > mercado).
let resultQueue = [],
  resultTimer = null;
function announceResult(marketStatus, before) {
  const changed = db.coupons
    .map((c) => ({ c, now: calcCoupon(c), was: before.get(c.id) }))
    .filter((x) => x.was === "pending" && (x.now.status === "won" || x.now.status === "lost"));
  resultQueue.push({ marketStatus, changed });
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    const all = resultQueue.flatMap((x) => x.changed),
      statuses = resultQueue.map((x) => x.marketStatus);
    resultQueue = [];
    const won = all.filter((x) => x.now.status === "won"),
      lost = all.filter((x) => x.now.status === "lost");
    if (won.length) {
      const net = won.reduce((s, x) => s + (Number(x.now.net) || 0), 0);
      resultCard({
        kind: "won",
        title: won.length === 1 ? "¡Cupón ganado!" : "¡" + won.length + " cupones ganados!",
        detail: won.length === 1 ? won[0].c.name : "",
        amount: net > 0 ? "+" + money(net) : "",
      });
      confetti({ count: 130, duration: 2200, originY: 0.6 });
      try {
        navigator.vibrate?.([60, 50, 60, 50, 160]);
      } catch {}
    } else if (lost.length) {
      const stake = lost.reduce((s, x) => s + (Number(x.c.stake) || 0), 0);
      resultCard({
        kind: "lost",
        title: lost.length === 1 ? "Cupón perdido" : lost.length + " cupones perdidos",
        detail: lost.length === 1 ? lost[0].c.name : "",
        amount: stake ? "−" + money(stake) : "",
      });
      shakeScreen();
      try {
        navigator.vibrate?.([120, 60, 120]);
      } catch {}
    } else if (statuses.includes("won")) confetti({ count: 45, duration: 1100, originY: 0.5 });
    else if (statuses.includes("lost")) shakeScreen();
  }, 180);
}

// --- Pantalla de entrada: se quita cuando la app ya está dibujada (mínimo 0,7 s para que se alcance a ver) ---
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  const shown = performance.now(),
    wait = Math.max(0, 700 - shown);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 380);
  }, wait);
}
