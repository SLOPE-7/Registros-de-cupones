// Registro de avisos de partidos.
//   GET  ?accion=clave         → clave pública para suscribirse a notificaciones.
//   POST {accion:"guardar", subscription, matches, lead, alStart} → guarda los próximos partidos de este teléfono.
//   POST {accion:"prueba", subscription}  → envía una notificación de prueba.
//   POST {accion:"borrar", endpoint}      → deja de enviar avisos a este teléfono.
import { store, subKey, vapidKeys, pusher, sendPush } from "../lib/avisos-comun.mjs";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const validSub = s => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

export default async request => {
  try {
    if (request.method === "GET") {
      const { publicKey } = await vapidKeys();
      return reply(200, { publicKey });
    }
    if (request.method !== "POST") return reply(405, { error: "Método no permitido." });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return reply(400, { error: "Solicitud no válida." });
    const s = store();

    if (body.accion === "borrar") {
      if (typeof body.endpoint === "string") await s.delete(subKey(body.endpoint));
      return reply(200, { ok: true });
    }
    if (!validSub(body.subscription)) return reply(400, { error: "La suscripción a notificaciones no es válida." });
    const key = subKey(body.subscription.endpoint);

    if (body.accion === "prueba") {
      const r = await sendPush(await pusher(), body.subscription, { title: "KAL · Avisos activados ✅", body: "Así te avisaremos antes de que empiecen tus partidos.", tag: "kal-prueba", url: "/" });
      if (r === "gone") await s.delete(key);
      return r === "ok" ? reply(200, { ok: true }) : reply(502, { error: "El teléfono no aceptó la notificación. Revisa los permisos de KAL." });
    }

    if (body.accion === "guardar") {
      const now = Date.now();
      const lead = Math.min(60, Math.max(0, Number(body.lead) || 15));
      const previous = (await s.get(key, { type: "json" })) || { matches: [] };
      const sent = new Map(previous.matches.map(m => [m.id, m]));
      const matches = (Array.isArray(body.matches) ? body.matches : []).slice(0, 150).map(m => {
        const kickoff = Date.parse(m?.kickoff);
        if (!m?.id || !Number.isFinite(kickoff) || kickoff < now - 3 * 3600000 || kickoff > now + 8 * 86400000) return null;
        const old = sent.get(String(m.id));
        const sameTime = old && old.kickoff === kickoff;
        return { id: clean(m.id, 120), title: clean(m.title, 120), body: clean(m.body, 240), kickoff, preSent: !!(sameTime && old.preSent), startSent: !!(sameTime && old.startSent) };
      }).filter(Boolean);
      await s.setJSON(key, { subscription: body.subscription, lead, alStart: body.alStart !== false, matches, updated: now });
      return reply(200, { ok: true, partidos: matches.length });
    }
    return reply(400, { error: "Acción no reconocida." });
  } catch (e) {
    return reply(500, { error: "No se pudieron guardar los avisos: " + (e?.message || "error interno") });
  }
};
