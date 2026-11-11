// Lógica del Analista (IA de Claude), separada de la función para poder probarla sin conexión.
// No importa el SDK: recibe el cliente ya creado, así las pruebas pueden pasar uno simulado.
//
// Protocolo de respuesta: texto en streaming, una línea JSON por evento.
//   {"t":"estado","v":"Buscando: …"}   lo que está haciendo (para mostrarlo mientras espera)
//   {"t":"texto","v":"…"}              un trozo del análisis
//   {"t":"reinicio"}                    descartar el texto recibido (otro modelo retomó la respuesta)
//   {"t":"fin","uso":{…}}               terminó bien
//   {"t":"error","v":"…"}               terminó con un error que se puede mostrar tal cual

export const MODELO = "claude-opus-5-5";
export const MAX_CUERPO = 120_000; // caracteres; un historial resumido ocupa bastante menos
const MAX_CONTINUACIONES = 3;

const BASE = `Eres el Analista de KAL, una app personal donde una persona registra sus cupones de apuestas de fútbol (moneda: lempiras, "L").
Escribe en español, en un tono directo y cercano, sin relleno. Tu lector lee en un teléfono: frases cortas, listas breves, cifras concretas.

Reglas que no cambian:
- Nunca prometas resultados ni digas que un pick es seguro. Habla de probabilidades y de riesgo.
- Una combinada se pierde entera si falla un solo mercado: cada selección que se añade baja la probabilidad de acertar.
- La cuota de la casa incluye su margen. La probabilidad implícita de una cuota es 1 / cuota.
- Si los datos no alcanzan para una conclusión (pocas apuestas), dilo en vez de inventar un patrón.
- No animes a subir los montos para recuperar pérdidas. Si ves señales de eso, dilo con tacto.

Formato de salida (Markdown sencillo, nada más): títulos con "## ", negritas con **, listas con "- ". Sin tablas, sin HTML, sin emojis de más (uno por título está bien).`;

const SISTEMA_HISTORIAL = `${BASE}

Tarea: analizar el historial de apuestas que te pasa la app (JSON) y explicar dónde gana y dónde pierde la persona.
Estructura:
## 📌 En resumen
Tres o cuatro frases con lo más importante.
## ✅ Lo que te funciona
## ⚠️ Lo que te está costando dinero
## 🔢 Tamaño de tus combinadas
Compara cómo le va según el número de selecciones y di cuál le conviene.
## 🎯 Recomendaciones
Entre tres y cinco acciones concretas para las próximas semanas.

Notas sobre los datos: "tasa" = ganados / (ganados + perdidos). "rentabSuelta" = lo que habría ganado apostando 1 unidad a cada mercado por separado, a su cuota (0.10 = +10 %). Los mercados se cuentan una sola vez aunque estén en varios cupones. Fíjate en el tamaño de cada muestra antes de sacar conclusiones.`;

const SISTEMA_CUPON = `${BASE}

Tarea: revisar un cupón ANTES de que la persona lo apueste. Usa la búsqueda web para informarte de cada partido: forma reciente, lesiones y sanciones, rotaciones probables (por ejemplo, si juega otra competición en pocos días), local/visitante y lo que haya en juego. Prioriza fuentes recientes y fiables. Si no encuentras información de un partido, dilo.
Si la app te pasa el historial de la persona por tipo de mercado, úsalo para avisarle cuando apueste a algo que históricamente le sale mal.
Estructura:
## 📌 Veredicto
Una o dos frases: si el cupón es razonable o arriesgado, y la probabilidad aproximada de acertarlo entero comparada con la que implica la cuota total.
## 🔎 Partido por partido
Para cada selección: "- **Equipo A vs Equipo B** · mercado · cuota → confianza Alta / Media / Baja" y debajo una o dos frases con el motivo.
## 🚩 El eslabón más débil
Cuál quitarías o cambiarías y por qué. Propón un mercado alternativo más seguro solo si tiene sentido.
## 💡 Cómo lo armaría yo
Versión ajustada del cupón (qué quitar o cambiar) y cuánto arriesgar según su presupuesto, si te lo pasan.
Cierra con una línea recordando que es un análisis orientativo, no una garantía.`;

export function respuestaJson(status, cuerpo) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Compara en tiempo constante para no dar pistas sobre la clave por el tiempo de respuesta.
function mismoTexto(a, b) {
  const x = new TextEncoder().encode(String(a)),
    y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Valida la petición. Devuelve { error: Response } o { modo, datos }.
export async function leerPeticion(req, env) {
  if (req.method !== "POST") return { error: respuestaJson(405, { error: "Usa POST." }) };
  if (!env.ANTHROPIC_API_KEY)
    return {
      error: respuestaJson(503, {
        error:
          "Falta configurar ANTHROPIC_API_KEY en las variables de Cloudflare (Workers → kal-cupones → Settings → Variables and Secrets).",
        codigo: "sin_clave_api",
      }),
    };
  if (!env.ANALISTA_CLAVE)
    return {
      error: respuestaJson(503, {
        error:
          "Falta configurar ANALISTA_CLAVE en las variables de Cloudflare (Workers → kal-cupones → Settings → Variables and Secrets): es el código que protege al Analista.",
        codigo: "sin_codigo",
      }),
    };
  if (!mismoTexto(req.headers.get("x-kal-clave") || "", env.ANALISTA_CLAVE))
    return {
      error: respuestaJson(401, {
        error: "El código de acceso del Analista no es correcto.",
        codigo: "codigo",
      }),
    };
  const texto = await req.text();
  if (texto.length > MAX_CUERPO)
    return { error: respuestaJson(413, { error: "Hay demasiados datos para analizar de una vez." }) };
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { error: respuestaJson(400, { error: "La petición no es JSON válido." }) };
  }
  const modo = cuerpo?.modo;
  if (modo !== "historial" && modo !== "cupon")
    return { error: respuestaJson(400, { error: "Modo desconocido." }) };
  const datos = cuerpo.datos && typeof cuerpo.datos === "object" ? cuerpo.datos : null;
  if (!datos) return { error: respuestaJson(400, { error: "Faltan los datos." }) };
  if (modo === "cupon" && !(typeof datos.cupon === "string" && datos.cupon.trim().length >= 10))
    return { error: respuestaJson(400, { error: "Pega el texto del cupón que quieres revisar." }) };
  return { modo, datos };
}

// Arma la petición a Claude según el modo.
export function construirPeticion(modo, datos) {
  const hoy = String(datos.hoy || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const base = {
    model: MODELO,
    max_tokens: 16000,
    // Si un filtro de seguridad rechaza la respuesta por error, el servidor la reintenta con el modelo recomendado.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  if (modo === "historial") {
    return {
      ...base,
      output_config: { effort: "medium" },
      system: SISTEMA_HISTORIAL,
      messages: [
        {
          role: "user",
          content: `Fecha de hoy: ${hoy}.\nEste es mi historial resumido por la app:\n\n${JSON.stringify(datos.historial ?? {})}`,
        },
      ],
    };
  }
  const extras = [];
  if (datos.historial) extras.push("Mi historial por tipo de mercado:\n" + JSON.stringify(datos.historial));
  if (datos.presupuesto) extras.push("Mi presupuesto:\n" + JSON.stringify(datos.presupuesto));
  return {
    ...base,
    output_config: { effort: "medium" },
    system: SISTEMA_CUPON,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    messages: [
      {
        role: "user",
        content:
          `Fecha de hoy: ${hoy}.\nRevisa este cupón antes de que lo apueste:\n\n<cupon>\n${datos.cupon.trim()}\n</cupon>` +
          (extras.length ? "\n\n" + extras.join("\n\n") : ""),
      },
    ],
  };
}

const MENSAJE_ERROR = {
  401: "Anthropic rechazó la clave ANTHROPIC_API_KEY. Revisa que esté bien copiada en Cloudflare.",
  403: "La clave de Anthropic no tiene permiso para este modelo.",
  429: "Se alcanzó el límite de uso de la API (o el límite de gasto que pusiste). Prueba en unos minutos.",
  529: "Los servidores de Claude están saturados. Prueba en unos minutos.",
};
export function mensajeDeError(e) {
  const status = Number(e?.status) || 0;
  if (MENSAJE_ERROR[status]) return MENSAJE_ERROR[status];
  if (status === 400 && /credit balance/i.test(String(e?.message)))
    return "Tu cuenta de Anthropic no tiene saldo. Recárgala en console.anthropic.com → Billing.";
  if (status >= 500) return "Claude tuvo un problema temporal. Prueba otra vez.";
  if (status) return "Claude no pudo procesar la petición (error " + status + ").";
  return "No se pudo conectar con Claude. Revisa tu conexión y prueba otra vez.";
}

// Ejecuta el análisis y escribe los eventos con `enviar`. Maneja pause_turn (búsquedas largas) y rechazos.
export async function analizar(client, peticion, enviar) {
  const messages = [...peticion.messages];
  const uso = { entrada: 0, salida: 0, busquedas: 0 };
  for (let vuelta = 0; vuelta <= MAX_CONTINUACIONES; vuelta++) {
    const stream = client.beta.messages.stream({ ...peticion, messages });
    stream.on("text", (delta) => enviar({ t: "texto", v: delta }));
    stream.on("streamEvent", (ev) => {
      if (ev.type !== "content_block_start") return;
      const tipo = ev.content_block?.type;
      if (tipo === "fallback") enviar({ t: "reinicio" });
      else if (tipo === "server_tool_use") enviar({ t: "estado", v: "Buscando información en internet…" });
      else if (tipo === "web_search_tool_result") enviar({ t: "estado", v: "Leyendo resultados…" });
    });
    stream.on("contentBlock", (b) => {
      if (b?.type === "server_tool_use" && b.input?.query)
        enviar({ t: "estado", v: "Buscando: " + b.input.query });
    });
    const msg = await stream.finalMessage();
    uso.entrada += msg.usage?.input_tokens || 0;
    uso.salida += msg.usage?.output_tokens || 0;
    uso.busquedas += msg.usage?.server_tool_use?.web_search_requests || 0;
    if (msg.stop_reason === "refusal") {
      enviar({ t: "error", v: "Claude no quiso responder a esta petición. Prueba a reformular el cupón." });
      return;
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (msg.stop_reason === "max_tokens")
      enviar({ t: "texto", v: "\n\n_(El análisis se cortó por largo.)_" });
    enviar({ t: "fin", uso });
    return;
  }
  enviar({ t: "fin", uso });
}

// Respuesta en streaming: las cabeceras salen enseguida (la función de borde exige enviarlas en < 40 s)
// y el análisis llega a trozos mientras Claude escribe.
export function respuestaEnStreaming(trabajo) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let cerrado = false;
      const enviar = (obj) => {
        if (!cerrado) controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };
      enviar({ t: "estado", v: "Pensando…" });
      try {
        await trabajo(enviar);
      } catch (e) {
        enviar({ t: "error", v: mensajeDeError(e) });
      }
      cerrado = true;
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function manejar(req, { env, crearCliente }) {
  const p = await leerPeticion(req, env);
  if (p.error) return p.error;
  const peticion = construirPeticion(p.modo, p.datos);
  return respuestaEnStreaming((enviar) => analizar(crearCliente(env.ANTHROPIC_API_KEY), peticion, enviar));
}
