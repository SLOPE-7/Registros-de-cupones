// Leer un boleto desde el enlace de compartir de Doradobet (…/deportes?shareCode=XXXX).
// Es un experimento: la página puede no entregar el boleto como texto. Si no lo hace, la respuesta lleva un
// diagnóstico corto (estado, título, direcciones que aparecen en la página) para poder afinarlo.
// Solo se consultan las direcciones de doradobet.com y se exige el mismo código de acceso que el Analista.
import { mismoTexto, respuestaJson } from "./analista.mjs";

const HOSTS = new Set(["doradobet.com", "www.doradobet.com"]);
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const MAX_PAGINA = 1_500_000;

// Busca el enlace dentro de un texto (el mensaje de "Compartir enlace" trae una frase y la dirección).
export function leerEnlace(texto) {
  const m = String(texto || "").match(
    /https?:\/\/(?:www\.)?doradobet\.com\/[^\s"'<>]*?[?&]shareCode=([A-Za-z0-9]{6,24})/i,
  );
  return m ? { codigo: m[1], url: "https://doradobet.com/deportes?shareCode=" + m[1] } : null;
}

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function htmlATexto(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTIDADES[e.toLowerCase()] ?? " ";
    })
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ¿Parece un boleto? Equipos con "vs" y alguna cuota con dos decimales.
export function pareceBoleto(texto) {
  return /\bvs\.?\s/i.test(texto) && /\b\d{1,3}\.\d{2}\b/.test(texto) && texto.length > 80;
}

function direcciones(html) {
  const vistas = new Set();
  for (const m of String(html).matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
    if (/api|altenar|biahosted|share|coupon|ticket|bet/i.test(m[0])) vistas.add(m[0].slice(0, 160));
    if (vistas.size >= 12) break;
  }
  return [...vistas];
}

async function descargar(url, fetchFn) {
  let actual = url;
  for (let salto = 0; salto < 4; salto++) {
    const r = await fetchFn(actual, {
      redirect: "manual",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "es-HN,es;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const siguiente = new URL(r.headers.get("location"), actual);
      if (siguiente.protocol !== "https:" || !HOSTS.has(siguiente.hostname))
        return { estado: r.status, html: "", aviso: "redirige a otro sitio" };
      actual = siguiente.toString();
      continue;
    }
    const html = (await r.text()).slice(0, MAX_PAGINA);
    return { estado: r.status, html, tipo: r.headers.get("content-type") || "" };
  }
  return { estado: 310, html: "", aviso: "demasiadas redirecciones" };
}

export async function manejar(req, { env, fetchFn = fetch }) {
  if (req.method !== "POST") return respuestaJson(405, { error: "Usa POST." });
  if (!env.ANALISTA_CLAVE)
    return respuestaJson(503, {
      error: "Falta configurar ANALISTA_CLAVE en Cloudflare.",
      codigo: "sin_codigo",
    });
  if (!mismoTexto(req.headers.get("x-kal-clave") || "", env.ANALISTA_CLAVE))
    return respuestaJson(401, {
      error: "El código de acceso del Analista no es correcto.",
      codigo: "codigo",
    });
  let cuerpo;
  try {
    const t = await req.text();
    if (t.length > 5000) return respuestaJson(413, { error: "Texto demasiado largo." });
    cuerpo = JSON.parse(t);
  } catch {
    return respuestaJson(400, { error: "La petición no es JSON válido." });
  }
  const enlace = leerEnlace(cuerpo?.enlace);
  if (!enlace)
    return respuestaJson(400, { error: "Ese texto no trae un enlace de Doradobet con shareCode." });
  let pagina;
  try {
    pagina = await descargar(enlace.url, fetchFn);
  } catch (e) {
    return respuestaJson(200, {
      ok: false,
      texto: "",
      diagnostico: { error: e?.name === "TimeoutError" ? "tiempo agotado" : "sin conexión con Doradobet" },
    });
  }
  const texto = htmlATexto(pagina.html);
  const ok = pagina.estado >= 200 && pagina.estado < 300 && pareceBoleto(texto);
  return respuestaJson(200, {
    ok,
    texto: ok ? texto.slice(0, 20000) : "",
    diagnostico: {
      estado: pagina.estado,
      tipo: pagina.tipo || undefined,
      aviso: pagina.aviso,
      titulo: (pagina.html.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim() || undefined,
      largo: pagina.html.length,
      direcciones: direcciones(pagina.html),
      muestra: texto.slice(0, 300),
    },
  });
}
