// Analista con IA (Claude). Es una función "de borde" (Edge Function) y no una función normal porque
// en el plan gratis de Netlify las funciones normales se cortan a los 10 segundos, y un análisis que
// busca en internet tarda más. Las de borde pueden seguir enviando datos mientras Claude escribe.
//
// Variables en Netlify (Site configuration → Environment variables):
//   ANTHROPIC_API_KEY  clave de la API de Anthropic (console.anthropic.com → API keys)
//   ANALISTA_CLAVE     código que tú eliges; la app lo envía para que nadie más gaste tu saldo
import Anthropic from "@anthropic-ai/sdk";
import { manejar } from "../lib/analista-comun.mjs";

export default (req) =>
  manejar(req, {
    env: {
      ANTHROPIC_API_KEY: Netlify.env.get("ANTHROPIC_API_KEY"),
      ANALISTA_CLAVE: Netlify.env.get("ANALISTA_CLAVE"),
    },
    crearCliente: (apiKey) => new Anthropic({ apiKey, maxRetries: 2 }),
  });

export const config = { path: "/api/analista" };
