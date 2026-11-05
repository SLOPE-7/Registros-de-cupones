// Guardar cupones más rápido:
// - Detecta la casa de apuestas: por su nombre en el texto o comparando el "formato" del texto pegado con los
//   cupones que ya guardaste de cada casa. Si no hay pistas, propone la última casa usada.
// - Sugiere tus importes habituales con botones rápidos.
// - Recuerda si registras la apuesta en el balance.
// - Barra fija "Guardar cupón" con el resumen mientras revisas la vista previa.
"use strict";

// Rasgos del formato de un texto de cupón (cada casa de apuestas escribe distinto).
const FORMAT_SIGNALS = [
  /competitor logo/i,
  /^cuotas\s*:/im,
  /valor apostado/i,
  /ganancia total/i,
  /pago anticipado/i,
  /betbuilder|constructor de apuestas/i,
  /^vs\.\s*$/im,
  /^vs\s*$/im,
  /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*•/,
  /\bL\s?\d/,
  /cuota total/i,
  /importe/i,
  /retorno|pago potencial/i,
  /incl\.\s*suplente/i,
  /^[A-ZÁÉÍÓÚÑ][^,\n]{2,30},\s*\S/m,
  /\(\s*[A-Z]{2,5}\s*\)/,
];
const formatVector = (raw) => FORMAT_SIGNALS.map((re) => (re.test(raw || "") ? 1 : 0));
function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  a.forEach((v, i) => {
    dot += v * b[i];
    na += v * v;
    nb += b[i] * b[i];
  });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Devuelve {houseId, reason} o null.
function detectHouse(raw) {
  if (!db.houses.length) return null;
  const text = crestNorm(raw);
  const byName = db.houses.find((h) => crestNorm(h.name).length >= 4 && text.includes(crestNorm(h.name)));
  if (byName) return { houseId: byName.id, reason: "su nombre aparece en el cupón" };
  const v = formatVector(raw);
  const scores = db.houses
    .map((h) => {
      const samples = db.coupons
        .filter((c) => c.houseId === h.id && c.raw)
        .slice(0, 30)
        .map((c) => formatVector(c.raw));
      if (samples.length < 2) return null;
      const avg = v.map((_, i) => samples.reduce((s, x) => s + x[i], 0) / samples.length);
      return { h, score: cosine(v, avg) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (scores[0] && scores[0].score >= 0.85 && (!scores[1] || scores[0].score - scores[1].score >= 0.08))
    return { houseId: scores[0].h.id, reason: "por el formato del texto" };
  const last = db.coupons.find((c) => c.houseId && db.houses.some((h) => h.id === c.houseId));
  return last ? { houseId: last.houseId, reason: "la última que usaste" } : null;
}

// Importes más usados en tus últimos 30 cupones (hasta 4).
function usualStakes() {
  const count = new Map();
  db.coupons.slice(0, 30).forEach((c) => {
    const s = Number(c.stake);
    if (s > 0) count.set(s, (count.get(s) || 0) + 1);
  });
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([s]) => s);
}

function renderStakeChips() {
  const el = $("stakeChips");
  if (!el) return;
  const current = Number($("stake").value);
  el.innerHTML = usualStakes()
    .map(
      (s) =>
        '<button type="button" class="chip' +
        (current === s ? " active" : "") +
        '" data-stake-pick="' +
        s +
        '">' +
        money(s) +
        "</button>",
    )
    .join("");
}

// Se llama al terminar de leer un cupón (desde readText).
function applyQuickDefaults() {
  const hint = $("houseHint");
  if (!$("couponHouse").value) {
    const d = detectHouse(window.__kalLastParsedRaw || "");
    if (d) {
      $("couponHouse").value = d.houseId;
      const name = db.houses.find((h) => h.id === d.houseId)?.name || "";
      if (hint) hint.textContent = "🏠 " + name + " · " + d.reason + ". Cámbiala si no es correcta.";
    } else if (hint) hint.textContent = "";
  } else if (hint) hint.textContent = "";
  if (!$("stake").value) {
    const s = usualStakes()[0];
    if (s) $("stake").value = s;
  }
  if (readLS("kal_auto_stake_tx") === "1") $("autoStakeTx").checked = true;
  renderStakeChips();
  updateSaveBar();
}

// Barra fija con el resumen y el botón de guardar (solo en Nuevo cupón, con un cupón leído).
function updateSaveBar() {
  const bar = $("saveBar");
  if (!bar) return;
  const n = draftSelections.reduce((s, f) => s + f.markets.length, 0);
  bar.hidden = !n;
  if (!n) return;
  const stake = Number($("stake").value) || 0,
    odds = Number($("totalOdds").value) || 0;
  const house = db.houses.find((h) => h.id === $("couponHouse").value)?.name;
  bar.querySelector(".save-bar-info").innerHTML =
    "<b>" +
    n +
    " selecci" +
    (n === 1 ? "ón" : "ones") +
    "</b><small>" +
    [stake ? money(stake) : "Sin importe", odds ? "cuota " + odds : "", house || "Sin casa"]
      .filter(Boolean)
      .map(esc)
      .join(" · ") +
    "</small>";
}

document.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-stake-pick]");
  if (pick) {
    $("stake").value = pick.dataset.stakePick;
    renderStakeChips();
    updateSaveBar();
    return;
  }
  if (e.target.closest("[data-save-bar]")) $("saveBtn").click();
});
["stake", "totalOdds", "couponHouse"].forEach((id) =>
  $(id).addEventListener("input", () => {
    if (id === "couponHouse" && $("houseHint")) $("houseHint").textContent = "";
    renderStakeChips();
    updateSaveBar();
  }),
);
$("couponHouse").addEventListener("change", updateSaveBar);
$("autoStakeTx").addEventListener("change", (e) =>
  writeLS("kal_auto_stake_tx", e.target.checked ? "1" : "0"),
);
