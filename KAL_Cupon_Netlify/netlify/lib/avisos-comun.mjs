// Código compartido por las funciones de avisos de partidos.
// Las suscripciones y los partidos se guardan en Netlify Blobs (almacenamiento incluido en Netlify, sin
// configuración). Las claves VAPID que firman las notificaciones se crean solas la primera vez y se guardan
// en el mismo almacenamiento, así no hay que añadir variables de entorno.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash } from "node:crypto";

export const store = () => getStore({ name: "kal-avisos", consistency: "strong" });
export const subKey = endpoint => "sub/" + createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40);

export async function vapidKeys() {
  const s = store();
  let keys = await s.get("config/vapid", { type: "json" });
  if (!keys?.publicKey || !keys?.privateKey) {
    keys = webpush.generateVAPIDKeys();
    await s.setJSON("config/vapid", keys);
  }
  return keys;
}

export async function pusher() {
  const keys = await vapidKeys();
  webpush.setVapidDetails(process.env.URL || "https://kal.netlify.app", keys.publicKey, keys.privateKey);
  return webpush;
}

// Envía una notificación. Devuelve "gone" si el teléfono ya no acepta avisos (hay que borrar la suscripción).
export async function sendPush(wp, subscription, payload) {
  try {
    await wp.sendNotification(subscription, JSON.stringify(payload), { TTL: 1800, urgency: "high" });
    return "ok";
  } catch (e) {
    return e?.statusCode === 404 || e?.statusCode === 410 ? "gone" : "error";
  }
}
