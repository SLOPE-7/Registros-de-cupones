// V26 · Buscar a un jugador (para seguirlo en el marcador o para ponerle foto) sin cuadros de texto del navegador.
// - Busca a la vez en API-Football y TheSportsDB, con límite de tiempo, y muestra los resultados con su foto.
// - Si no aparece, prueba solo con el apellido y con nombre + apellido (en TheSportsDB, que no gasta cuota).
// - Al elegir a alguien se guarda su foto ligada al equipo del partido (club o selección) y, si es para seguirlo,
//   se añade al marcador con su nombre completo.
"use strict";

let ppState = null;

const ppAscii = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*\([A-Z]{2,5}\)\s*$/i, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// "Alejandro Baena Rodriguez" → nombre completo, "Alejandro Rodriguez", "Baena Rodriguez" y "Rodriguez".
function ppVariants(name) {
  const w = ppAscii(name).split(" ").filter(Boolean),
    out = [w.join(" ")];
  if (w.length >= 3) out.push(w[0] + " " + w.at(-1), w.at(-2) + " " + w.at(-1));
  if (w.length >= 2) out.push(w.at(-1));
  return [...new Set(out.filter((x) => x.length >= 3))].slice(0, 4);
}
async function ppApi(name, st) {
  const params = new URLSearchParams({ search: name, teamId: st.teamId || "", season: st.season || "" });
  const r = await fetch("/api/jugadores?" + params, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(14000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "No se pudo buscar al jugador.");
  return (d.players || []).map((x) => ({ ...x, source: "API-Football" }));
}
async function ppTsdb(name, st) {
  const list = await tsdbSearch("jugador", name, st.club || "");
  return list.map((x) => ({ ...x, id: x.id ? "tsdb-" + x.id : "", source: "TheSportsDB" }));
}
function ppAdd(list) {
  const st = ppState;
  if (!st) return;
  const q = crestNorm(st.query);
  list
    .filter((x) => x?.name && x.photo)
    .forEach((x) => {
      const k = (x.id || "") + "|" + crestNorm(x.name) + "|" + crestNorm(x.team || "");
      if (st.seen.has(k)) return;
      st.seen.add(k);
      st.results.push(x);
    });
  const score = (x) => {
    const n = crestNorm(x.name);
    return n === q ? 2 : q.split(" ").every((w) => n.includes(w)) ? 1 : 0;
  };
  st.results.sort((a, b) => score(b) - score(a));
  st.results = st.results.slice(0, 10);
  renderPicker();
}
async function ppRun() {
  const st = ppState;
  if (!st) return;
  const token = ++st.token,
    q = ppAscii(st.query);
  st.results = [];
  st.seen = new Set();
  if (q.length < 3) {
    st.busy = false;
    st.status = "Escribe al menos 3 letras.";
    return renderPicker();
  }
  st.busy = true;
  st.status = "Buscando…";
  renderPicker();
  const variants = ppVariants(q),
    errors = [];
  const guard = (p) =>
    p
      .then((l) => token === st.token && ppAdd(l))
      .catch((e) => errors.push(e?.name === "TimeoutError" ? "tardó demasiado" : e?.message || "error"));
  await Promise.allSettled([guard(ppApi(variants[0], st)), guard(ppTsdb(variants[0], st))]);
  // Sin resultados: otras formas del nombre, solo en TheSportsDB (no gasta la cuota de API-Football).
  for (const v of variants.slice(1)) {
    if (token !== st.token || st.results.length) break;
    st.status = "Probando con «" + v + "»…";
    renderPicker();
    await guard(ppTsdb(v, st));
  }
  if (token !== st.token) return;
  st.busy = false;
  st.status = st.results.length
    ? "Toca al jugador correcto:"
    : "No encontré «" + st.query + "»" + (errors.length ? " (" + errors[0] + ")" : "") + ".";
  renderPicker();
}

function ppHtml() {
  const st = ppState,
    track = st.mode === "track";
  const face = (x) => {
    const url = x.photo ? resolveImage(x.photo) : "";
    return url
      ? '<img class="pp-photo" src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="team-fallback pp-photo">' + esc(lgInitials(x.name)) + "</span>";
  };
  return (
    '<div class="news-sheet pp-sheet"><h2>' +
    (track ? "＋ Seguir jugador" : "📷 Foto del jugador") +
    "</h2>" +
    '<p class="small muted">' +
    (track
      ? "Equipo: <b>" + esc(st.club) + "</b>. "
      : st.club
        ? "Equipo: <b>" + esc(st.club) + "</b>. "
        : "") +
    "Escribe el nombre (o solo el apellido) y toca al jugador correcto: se guarda con su foto y su equipo.</p>" +
    '<div class="pp-search"><input class="input" id="ppQuery" autocomplete="off" placeholder="Nombre o apellido" value="' +
    esc(st.query) +
    '"><button type="button" class="btn gold" data-pp-search>Buscar</button></div>' +
    (track && st.known?.length
      ? '<div class="pp-known"><small class="muted">Jugadores que ya conozco de este equipo:</small><div class="chips">' +
        st.known
          .map(
            (n, i) => '<button type="button" class="chip" data-pp-known="' + i + '">' + esc(n) + "</button>",
          )
          .join("") +
        "</div></div>"
      : "") +
    '<p class="small pp-status" aria-live="polite">' +
    (st.busy ? '<span class="spinner"></span> ' : "") +
    esc(st.status || "") +
    "</p>" +
    '<div class="pp-results">' +
    st.results
      .map(
        (x, i) =>
          '<button type="button" class="pp-result" data-pp-pick="' +
          i +
          '">' +
          face(x) +
          "<span><b>" +
          esc(x.name) +
          "</b><small>" +
          esc([x.team, x.country, x.source].filter(Boolean).join(" · ")) +
          "</small></span></button>",
      )
      .join("") +
    "</div>" +
    '<div class="row pp-actions">' +
    (track
      ? '<button type="button" class="btn" data-pp-manual>Seguir a «' +
        esc(st.query || "…") +
        "» sin foto</button>"
      : '<button type="button" class="btn" data-pp-upload>📷 Subir desde el teléfono</button>') +
    '<button type="button" class="btn" data-pp-close>Cerrar</button></div></div>'
  );
}
function renderPicker() {
  const w = document.querySelector(".pp-wrap");
  if (!w || !ppState) return;
  const typing = document.activeElement?.id === "ppQuery";
  w.innerHTML = ppHtml();
  if (typing) {
    const i = $("ppQuery");
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }
}
function openPlayerPicker(opts) {
  ppState = {
    mode: "photo",
    club: "",
    teamId: "",
    season: String(new Date().getFullYear()),
    code: "",
    marketKey: "",
    market: "",
    aliases: [],
    known: [],
    ...opts,
    token: 0,
    results: [],
    seen: new Set(),
    busy: false,
    status: "",
    query: opts.query ?? opts.name ?? "",
  };
  document.querySelector(".pp-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "news-wrap pp-wrap";
  w.setAttribute("role", "dialog");
  w.setAttribute("aria-modal", "true");
  w.setAttribute("aria-label", "Buscar jugador");
  document.body.appendChild(w);
  renderPicker();
  if (ppAscii(ppState.query).length >= 3 && ppState.mode === "photo") ppRun();
}
function closePlayerPicker() {
  document.querySelector(".pp-wrap")?.remove();
  ppState = null;
}

// Guarda la foto del jugador ligada al equipo del partido (club o selección) y a sus otros nombres.
function ppSavePhoto(chosen, st) {
  const dir = readCrestDirectory(),
    playerId = String(chosen.id || ""),
    photoKey = playerId ? "player:" + playerId : "player:" + crestNorm(chosen.name),
    link = st.club || chosen.team || "",
    aliases = new Set([chosen.name, st.name, st.query, ...(st.aliases || [])].filter(Boolean));
  Object.entries(dir).forEach(([oldKey, item]) => {
    if (!oldKey.startsWith("player:")) return;
    const oldId = String(item.playerId || oldKey.split(":")[1] || "");
    if (
      (playerId && oldId === playerId) ||
      (samePlayerName(item.name, chosen.name) && samePlayerClub(item.club, link))
    ) {
      (item.aliases || []).forEach((n) => aliases.add(n));
      if (item.name) aliases.add(item.name);
      if (oldKey !== photoKey) delete dir[oldKey];
    }
  });
  dir[photoKey] = {
    kind: "player",
    playerId,
    name: chosen.name,
    aliases: [...aliases],
    club: link,
    teamCode: st.code || "",
    country: chosen.country || "",
    teamId: chosen.teamId || st.teamId || "",
    photo: chosen.photo,
    url: chosen.photo,
    marketKey: st.marketKey || "",
    market: st.market || "",
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(CREST_DIR, JSON.stringify(dir));
  } catch {
    toast("No se pudo guardar la foto. Libera espacio del navegador e inténtalo otra vez.");
    return false;
  }
  if (st.marketKey) matchPlayerPhotos[st.marketKey] = playerImageUrl(chosen.photo);
  if (typeof cloudSession !== "undefined" && cloudSession) queueCloudSync();
  return true;
}
function ppAfterSave() {
  renderLogos();
  if (currentMatchRef && $("matchModal")?.classList.contains("open")) renderMatchDetail(currentMatchRef);
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-pp-open]");
  if (open) {
    const id = open.dataset.ppOpen,
      item = collectPlayerBets().find((x) => x.id === id);
    if (!item) return;
    const ref = playerBetRefs[id],
      c = ref?.ref && db.coupons.find((x) => x.id === ref.ref.couponId),
      f = c?.fixtures?.[Number(ref.ref.fixtureIndex)],
      side = ref?.side || "",
      club = /^Equipo \(/.test(item.club || "") ? "" : item.club || "";
    openPlayerPicker({
      mode: "photo",
      name: item.name,
      club,
      code: item.code || "",
      marketKey: item.marketKey || "",
      aliases: item.aliases || [],
      teamId: (f && side && matchApiIds(f)[side]) || item.teamId || "",
      season: f ? (scheduleISO(f) || "").slice(0, 4) || undefined : undefined,
    });
    return;
  }
  const live = e.target.closest("[data-pp-live]");
  if (live) {
    const fk = live.dataset.fk,
      pk = live.dataset.pk,
      f = fixtureByKey(fk),
      pl = statsPlayers(fk).get(pk);
    if (!f || !pl) return;
    const side = playerSide(fk, pk, pl),
      club = side ? f[side] : pl.code ? playerClubForCode(pl.code, f).club : "";
    openPlayerPicker({
      mode: "photo",
      name: pl.name,
      club: /^Equipo \(/.test(club || "") ? "" : club,
      code: pl.code || "",
      aliases: [pl.name],
      teamId: (side && matchApiIds(f)[side]) || "",
      season: (scheduleISO(f) || "").slice(0, 4) || undefined,
    });
    return;
  }
  if (!ppState) return;
  if (e.target.closest("[data-pp-close]") || e.target.classList?.contains("pp-wrap"))
    return closePlayerPicker();
  if (e.target.closest("[data-pp-search]")) {
    ppState.query = $("ppQuery").value.trim();
    return ppRun();
  }
  const pick = e.target.closest("[data-pp-pick]");
  if (pick) {
    const chosen = ppState.results[Number(pick.dataset.ppPick)],
      st = ppState;
    if (!chosen || !ppSavePhoto(chosen, st)) return;
    closePlayerPicker();
    if (st.mode === "track") applyTrack(st.fk, st.side, chosen.name);
    else {
      ppAfterSave();
      toast("Foto guardada para " + chosen.name + (st.club ? " · " + st.club : ""));
    }
    return;
  }
  const known = e.target.closest("[data-pp-known]");
  if (known) {
    const st = ppState,
      name = st.known[Number(known.dataset.ppKnown)];
    closePlayerPicker();
    applyTrack(st.fk, st.side, name);
    return;
  }
  if (e.target.closest("[data-pp-manual]")) {
    const st = ppState,
      name = ($("ppQuery").value || "").trim();
    if (ppAscii(name).length < 3) {
      st.status = "Escribe al menos 3 letras.";
      return renderPicker();
    }
    closePlayerPicker();
    applyTrack(st.fk, st.side, name);
    return;
  }
  if (e.target.closest("[data-pp-upload]")) {
    const st = ppState;
    closePlayerPicker();
    pickImage({
      kind: "player",
      name: st.name || st.query,
      club: st.club,
      code: st.code,
      country: "",
      marketKey: st.marketKey,
      aliases: st.aliases,
    });
  }
});
document.addEventListener("keydown", (e) => {
  if (ppState && e.key === "Enter" && e.target.id === "ppQuery") {
    e.preventDefault();
    ppState.query = e.target.value.trim();
    ppRun();
  }
  if (ppState && e.key === "Escape") closePlayerPicker();
});
