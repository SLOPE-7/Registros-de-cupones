// Avisos de partidos en Cloudflare: la misma lógica que tenían las funciones "avisos" y "avisos-envio" de Netlify,
// pero con el almacenamiento de Cloudflare (un Durable Object) y Web Push hecho con WebCrypto.
// `store` es cualquier objeto con: get(clave), put(clave, valor), delete(clave), list(prefijo) → [claves].
import { generateVapidKeys, sendWebPush } from "./webpush.mjs";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const validSub = (s) =>
  s &&
  typeof s.endpoint === "string" &&
  /^https:\/\//.test(s.endpoint) &&
  s.endpoint.length < 1000 &&
  s.keys &&
  typeof s.keys.p256dh === "string" &&
  typeof s.keys.auth === "string";
const clean = (v, n) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, n);

export async function subKey(endpoint) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(endpoint))),
  );
  return (
    "sub/" +
    [...hash]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40)
  );
}

// Las claves VAPID se crean solas la primera vez y se guardan; así no hay que configurar nada.
export async function vapidKeys(store) {
  let keys = await store.get("config/vapid");
  if (!keys?.publicKey || !keys?.privateKey) {
    keys = await generateVapidKeys();
    await store.put("config/vapid", keys);
  }
  return keys;
}
// El servicio de push pide un contacto ("sub"): se usa la dirección de la app, guardada al registrar avisos.
async function pushOptions(store) {
  const origin = await store.get("config/origin");
  return { keys: await vapidKeys(store), subject: origin || "mailto:avisos@kal.invalid" };
}

//   GET  ?accion=clave         → clave pública para suscribirse.
//   POST {accion:"guardar", subscription, matches, lead, alStart}
//   POST {accion:"prueba", subscription}
//   POST {accion:"borrar", endpoint}
export async function avisosHandler(request, store, send = sendWebPush) {
  try {
    const origin = new URL(request.url).origin;
    if (/^https:\/\//.test(origin) && (await store.get("config/origin")) !== origin)
      await store.put("config/origin", origin);
    if (request.method === "GET") {
      const { publicKey } = await vapidKeys(store);
      return reply(200, { publicKey });
    }
    if (request.method !== "POST") return reply(405, { error: "Método no permitido." });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return reply(400, { error: "Solicitud no válida." });

    if (body.accion === "borrar") {
      if (typeof body.endpoint === "string") await store.delete(await subKey(body.endpoint));
      return reply(200, { ok: true });
    }
    if (!validSub(body.subscription))
      return reply(400, { error: "La suscripción a notificaciones no es válida." });
    const key = await subKey(body.subscription.endpoint);

    if (body.accion === "prueba") {
      const r = await send(
        body.subscription,
        {
          title: "KAL · Avisos activados ✅",
          body: "Así te avisaremos antes de que empiecen tus partidos.",
          tag: "kal-prueba",
          url: "/",
        },
        await pushOptions(store),
      );
      if (r === "gone") await store.delete(key);
      return r === "ok"
        ? reply(200, { ok: true })
        : reply(502, { error: "El teléfono no aceptó la notificación. Revisa los permisos de KAL." });
    }

    if (body.accion === "guardar") {
      const now = Date.now();
      const lead = Math.min(60, Math.max(0, Number(body.lead) || 15));
      const previous = (await store.get(key)) || { matches: [] };
      const sent = new Map(previous.matches.map((m) => [m.id, m]));
      const matches = (Array.isArray(body.matches) ? body.matches : [])
        .slice(0, 150)
        .map((m) => {
          const kickoff = Date.parse(m?.kickoff);
          if (
            !m?.id ||
            !Number.isFinite(kickoff) ||
            kickoff < now - 3 * 3600000 ||
            kickoff > now + 8 * 86400000
          )
            return null;
          const old = sent.get(String(m.id));
          const sameTime = old && old.kickoff === kickoff;
          return {
            id: clean(m.id, 120),
            title: clean(m.title, 120),
            body: clean(m.body, 240),
            kickoff,
            preSent: !!(sameTime && old.preSent),
            startSent: !!(sameTime && old.startSent),
          };
        })
        .filter(Boolean);
      await store.put(key, {
        subscription: body.subscription,
        lead,
        alStart: body.alStart !== false,
        matches,
        updated: now,
      });
      return reply(200, { ok: true, partidos: matches.length });
    }
    return reply(400, { error: "Acción no reconocida." });
  } catch (e) {
    return reply(500, { error: "No se pudieron guardar los avisos: " + (e?.message || "error interno") });
  }
}

// Tarea programada (cada 5 minutos): envía "Empieza en N min" y "Empezó", y limpia lo viejo.
export async function enviarAvisos(store, send = sendWebPush, now = Date.now()) {
  const keys = await store.list("sub/");
  let opts = null,
    enviados = 0;
  for (const key of keys) {
    const rec = await store.get(key);
    if (!rec?.subscription) {
      await store.delete(key);
      continue;
    }
    const leadMs = (rec.lead ?? 15) * 60000;
    let changed = false,
      gone = false;
    for (const m of rec.matches || []) {
      if (gone) break;
      const due = [];
      if (!m.preSent && leadMs > 0 && now >= m.kickoff - leadMs && now < m.kickoff)
        due.push([
          "preSent",
          {
            title: "⏰ " + m.title,
            body:
              "Empieza en " +
              Math.max(1, Math.round((m.kickoff - now) / 60000)) +
              " min" +
              (m.body ? "\n" + m.body : ""),
            tag: "kal-" + m.id,
            url: "/?vista=calendar",
          },
        ]);
      if (rec.alStart && !m.startSent && now >= m.kickoff && now < m.kickoff + 20 * 60000)
        due.push([
          "startSent",
          {
            title: "🔴 Empezó: " + m.title,
            body: "Ya está en juego" + (m.body ? "\n" + m.body : ""),
            tag: "kal-" + m.id,
            url: "/?vista=calendar",
          },
        ]);
      for (const [flag, payload] of due) {
        opts = opts || (await pushOptions(store));
        const r = await send(rec.subscription, payload, opts);
        if (r === "gone") {
          gone = true;
          break;
        }
        m[flag] = true;
        changed = true;
        if (r === "ok") enviados++;
      }
    }
    if (gone) {
      await store.delete(key);
      continue;
    }
    const kept = (rec.matches || []).filter((m) => m.kickoff > now - 3 * 3600000);
    if (kept.length !== (rec.matches || []).length) {
      rec.matches = kept;
      changed = true;
    }
    if (changed) await store.put(key, rec);
  }
  return { telefonos: keys.length, enviados };
}
