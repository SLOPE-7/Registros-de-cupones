// Se ejecuta sola cada 5 minutos (función programada de Netlify) y envía los avisos que tocan:
// - "Empieza en N min" cuando falta el tiempo elegido para el partido.
// - "Empezó" cuando llega la hora del partido (si el teléfono lo pidió).
// Borra partidos de hace más de 3 horas y teléfonos que ya no aceptan notificaciones.
import { store, pusher, sendPush } from "../lib/avisos-comun.mjs";

export const config = { schedule: "*/5 * * * *" };

export default async () => {
  const s = store(), now = Date.now();
  const { blobs } = await s.list({ prefix: "sub/" });
  let wp = null, enviados = 0;
  for (const { key } of blobs) {
    const rec = await s.get(key, { type: "json" });
    if (!rec?.subscription) { await s.delete(key); continue; }
    const leadMs = (rec.lead ?? 15) * 60000;
    let changed = false, gone = false;
    for (const m of rec.matches || []) {
      if (gone) break;
      const due = [];
      if (!m.preSent && leadMs > 0 && now >= m.kickoff - leadMs && now < m.kickoff) due.push(["preSent", { title: "⏰ " + m.title, body: "Empieza en " + Math.max(1, Math.round((m.kickoff - now) / 60000)) + " min" + (m.body ? " · " + m.body : ""), tag: "kal-" + m.id, url: "/?vista=calendar" }]);
      if (rec.alStart && !m.startSent && now >= m.kickoff && now < m.kickoff + 20 * 60000) due.push(["startSent", { title: "🔴 Empezó: " + m.title, body: m.body || "Tu partido ya está en juego.", tag: "kal-" + m.id, url: "/?vista=calendar" }]);
      for (const [flag, payload] of due) {
        wp = wp || await pusher();
        const r = await sendPush(wp, rec.subscription, payload);
        if (r === "gone") { gone = true; break; }
        m[flag] = true; changed = true; if (r === "ok") enviados++;
      }
    }
    if (gone) { await s.delete(key); continue; }
    const kept = (rec.matches || []).filter(m => m.kickoff > now - 3 * 3600000);
    if (kept.length !== (rec.matches || []).length) { rec.matches = kept; changed = true; }
    if (changed) await s.setJSON(key, rec);
  }
  console.log(`avisos-envio: ${blobs.length} teléfono(s), ${enviados} aviso(s) enviados`);
};
