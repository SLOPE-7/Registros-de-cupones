// KAL en Cloudflare: un solo Worker que
//   - sirve la app (carpeta site/) como archivos estáticos;
//   - atiende las mismas rutas que usaba en Netlify (/.netlify/functions/… y /api/analista), así la app no cambia;
//   - envía los avisos de partidos cada 5 minutos (tarea programada).
// Variables y secretos (Cloudflare → Workers → kal-cupones → Settings → Variables and Secrets):
//   API_FOOTBALL_KEY, ANTHROPIC_API_KEY, ANALISTA_CLAVE, FOOTBALL_DATA_KEY y, opcional, THESPORTSDB_KEY.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import escudos from "../netlify/functions/escudos.mjs";
import logo from "../netlify/functions/logo.mjs";
import partido from "../netlify/functions/partido.mjs";
import jugadores from "../netlify/functions/jugadores.mjs";
import catalogo from "../netlify/functions/catalogo.mjs";
import imagenes from "../netlify/functions/imagenes.mjs";
import { manejar as analista } from "../netlify/lib/analista-comun.mjs";
import { avisosHandler, enviarAvisos } from "./avisos.mjs";
import { datosPartido } from "./datos-partido.mjs";

// Almacenamiento de los avisos (suscripciones, partidos y claves VAPID). Un único Durable Object con SQLite,
// incluido en el plan gratis y sin nada que configurar.
export class Almacen extends DurableObject {
  async leer(clave) {
    return (await this.ctx.storage.get(clave)) ?? null;
  }
  async guardar(clave, valor) {
    await this.ctx.storage.put(clave, valor);
  }
  async borrar(clave) {
    await this.ctx.storage.delete(clave);
  }
  async listar(prefijo) {
    return [...(await this.ctx.storage.list({ prefix: prefijo })).keys()];
  }
}
function almacen(env) {
  const stub = env.ALMACEN.get(env.ALMACEN.idFromName("kal-avisos"));
  return {
    get: (k) => stub.leer(k),
    put: (k, v) => stub.guardar(k, v),
    delete: (k) => stub.borrar(k),
    list: (p) => stub.listar(p),
  };
}

// Las funciones de Netlify leen sus claves de process.env.
function exponerVariables(env) {
  globalThis.process ??= { env: {} };
  process.env ??= {};
  for (const k of ["API_FOOTBALL_KEY", "THESPORTSDB_KEY"])
    if (typeof env[k] === "string") process.env[k] = env[k];
}

const FUNCIONES = { escudos, logo, partido, jugadores, catalogo, imagenes };

async function api(nombre, request, env) {
  if (FUNCIONES[nombre]) return FUNCIONES[nombre](request);
  if (nombre === "avisos") return avisosHandler(request, almacen(env));
  if (nombre === "datos-partido")
    return datosPartido(request, { token: env.FOOTBALL_DATA_KEY, store: almacen(env) });
  if (nombre === "analista")
    return analista(request, {
      env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ANALISTA_CLAVE: env.ANALISTA_CLAVE },
      crearCliente: (apiKey) => new Anthropic({ apiKey, maxRetries: 2 }),
    });
  return null;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = pathname.match(/^\/(?:\.netlify\/functions|api)\/([a-z-]+)\/?$/);
    if (m) {
      exponerVariables(env);
      try {
        const r = await api(m[1], request, env);
        if (r) return r;
      } catch (e) {
        return new Response(JSON.stringify({ error: "Error interno: " + (e?.message || "desconocido") }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response(JSON.stringify({ error: "No existe esa función." }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      enviarAvisos(almacen(env)).then((r) =>
        console.log(`avisos: ${r.telefonos} teléfono(s), ${r.enviados} aviso(s) enviados`),
      ),
    );
  },
};
