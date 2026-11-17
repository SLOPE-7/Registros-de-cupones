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
export const MAX_IMAGEN = 4_000_000; // una captura reducida en base64
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

// Método común para revisar y armar cupones: cómo investigar y cómo estimar cada selección.
const METODO = `Cómo investigar (tienes pocas búsquedas: úsalas donde más cambian la estimación)
- Si la app te pasa "datosPartidos" (tabla, forma, goles esperados y probabilidades de un modelo de goles), úsalos como punto de partida y no busques lo que ya está ahí.
- Una búsqueda por partido suele bastar; combínala ("X vs Y alineaciones probables bajas"). Prioriza: 1) alineaciones probables o confirmadas y bajas (lesión, sanción, descanso); 2) rotaciones y lo que hay en juego (partido ya decidido, otro partido en pocos días, amistoso); 3) forma reciente.
- Mercados de jugador (remates, remates a puerta, goles): lo primero es saber si será titular y cuántos minutos suele jugar; después su posición y su promedio reciente en esa estadística. Si no puedes confirmar que será titular, dilo.
- Fíjate en la fecha de cada dato: una noticia vieja sobre una lesión no sirve. Si el partido ya se jugó, dilo y no lo analices como futuro.
- Si no encuentras información de un partido, dilo; no la inventes.

Cómo estimar cada selección
- Da una probabilidad en número (por ejemplo "≈ 72 %"), no solo una etiqueta. Parte de una base y ajústala con lo que encontraste: la base es el modelo de goles si la app lo pasa; si no, la probabilidad que implica la cuota individual (1 / cuota, menos el margen de la casa, que suele ser de 5 a 8 %), o tu conocimiento de la frecuencia típica de ese mercado.
- Confianza según tu probabilidad: Alta = 80 % o más y con información que la respalde; Media = entre 65 y 80 %; Baja = menos de 65 %, o cuando falta un dato clave (por ejemplo, un mercado de jugador sin titularidad confirmada es como máximo Media, nunca Alta).
- Un BetBuilder es una sola apuesta con una sola cuota: sus selecciones están relacionadas entre sí (si hay pocos ataques, bajan a la vez los goles, los remates y los córners). Estima la probabilidad de que salgan todas juntas, no multipliques como si fueran independientes, y compárala con la que implica la cuota del paquete.
- Probabilidad del cupón = producto de las probabilidades de cada partido (o paquete). Compárala con la que implica la cuota total y di si la cuota paga el riesgo (valor = probabilidad × cuota − 1).
- Sé honesto con la incertidumbre: las selecciones con cuota muy baja (1.05–1.20) fallan más de lo que parece, y en una combinada larga basta una. Si tu propio historial de aciertos viene en "precisionAnalista", úsalo para corregirte (si tus "Alta" aciertan menos de lo esperado, sé más conservador).
- Si la app te pasa "misRegistros", son datos que la propia persona anotó partido a partido: goles, córners y tarjetas de cada equipo, y remates, remates a puerta y goles de cada jugador, separados por club y selección. Cítalos cuando existan ("en tus 3 registros con Francia promedia 2.3 remates") y compáralos con la línea del mercado, pero recuerda que son muestras pequeñas y solo de partidos en los que apostó: combínalos siempre con la actualidad general que encuentres (forma, titularidad, rival). Un jugador puede rendir distinto con su club y con su selección; usa el registro del equipo con el que juega este partido.
- Usa el historial de la persona por tipo de mercado para avisarle cuando apueste a algo que le sale mal, pero no dejes que sustituya el análisis del partido.`;

const SISTEMA_CUPON = `${BASE}

Tarea: revisar un cupón ANTES de que la persona lo apueste y decirle, con números, qué tan probable es acertarlo y cuál es su punto más débil.

${METODO}

Si la app te pasa "riesgo" (calculado con el historial de la persona: selecciones de relleno, partidos repetidos en otros cupones pendientes, cómo le fue con cupones de ese tamaño, racha), menciónalo cuando sea relevante: un partido repetido en varios cupones multiplica la pérdida si falla.

Estructura de la respuesta:
## 📌 Veredicto
Dos frases: probabilidad estimada de acertar el cupón entero, la que implica la cuota, y si vale la pena tal como está.
## 🔎 Partido por partido
Para cada selección: "- **Equipo A vs Equipo B** · mercado · selección → ≈ NN % · confianza Alta / Media / Baja" y debajo una o dos frases con el dato concreto que lo respalda (o el que falta).
## 🚩 El eslabón más débil
La selección con menor probabilidad: por qué, y qué harías (quitarla, bajar la línea o cambiar de mercado). Di cuánto sube la probabilidad del cupón sin ella.
## 💡 Cómo lo armaría yo
Versión ajustada del cupón y cuánto arriesgar según su unidad o presupuesto, si te los pasan.
Cierra con una línea recordando que es un análisis orientativo, no una garantía.

Después de esa línea, y como lo último de tu respuesta, añade un bloque de datos para la app (no se le muestra a la persona), con JSON válido en una sola línea:
<kal-json>{"veredicto":"razonable|arriesgado|muy arriesgado","probabilidad":0.35,"selecciones":[{"partido":"Equipo A vs Equipo B","mercado":"mercado tal como aparece en el cupón","seleccion":"selección tal como aparece","p":0.72,"confianza":"Alta|Media|Baja"}],"eslabonDebil":[{"partido":"Equipo A vs Equipo B","mercado":"…","seleccion":"…"}]}</kal-json>
Incluye en "selecciones" todas las del cupón, con los mismos nombres que en el cupón; "p" es tu probabilidad de esa selección (0 a 1) y debe coincidir con la que escribiste. "probabilidad" es la del cupón entero (0 a 1).`;

const SISTEMA_SEMANA = `${BASE}

Tarea: hacer el resumen de los últimos 7 días de apuestas que te pasa la app (JSON), comparándolo con el historial general.
Estructura (corta, cabe en una pantalla de teléfono):
## 📅 Tu semana
Cifras clave: cupones, ganados/perdidos, resultado neto y si va mejor o peor que su media.
## ✅ Lo mejor
## ⚠️ A corregir
Incluye si rompió sus propias reglas (más selecciones que su límite, el mismo partido en varios cupones, montos por encima de su unidad, apuestas seguidas tras perder).
## 🎯 Para la próxima semana
Tres acciones concretas.`;

const SISTEMA_ARMAR = `${BASE}

Tarea: ayudar a armar cupones con los partidos o picks que la persona está considerando. Si solo da partidos, propón tú los mercados; elige en cada partido el mercado con mejor relación entre probabilidad y cuota, no el más llamativo.

${METODO}

Reglas para armar:
- Propón entre 1 y 3 cupones cortos (de 1 a la cantidad máxima de selecciones que indique la app; si no la indica, máximo 4).
- Un partido no se repite en dos cupones.
- Solo entran selecciones con probabilidad estimada de 70 % o más; evita las de "relleno" con cuota menor que 1.15.
- Mercados de jugador: solo con titularidad razonablemente confirmada, y como mucho uno por cupón.
- Prioriza los tipos de mercado donde su historial es bueno y evita los que le salen mal (si la app te pasa el historial).
- Si un partido no tiene un pick con sentido, descártalo y dilo. Proponer menos cupones, o ninguno, es una respuesta válida.
- Montos en unidades (½, 1, 1½ o 2) según la probabilidad del cupón; si la app te da el valor de la unidad, conviértelo a lempiras. En racha de pérdidas, como mucho 1 unidad.
Estructura:
## 🧩 Cupón 1 · nombre corto
Lista: "- **Equipo A vs Equipo B** · mercado · selección · cuota aproximada si la conoces → ≈ NN % · confianza Alta/Media/Baja" y una frase con el dato que lo respalda. Al final: probabilidad estimada del cupón y monto sugerido.
(Repite para cada cupón.)
## 🗑️ Lo que descarté
Partidos que no usaste y por qué.
Cierra con una línea recordando que es un análisis orientativo, no una garantía.`;

const SISTEMA_IMAGEN = `Eres un transcriptor. Recibes una captura de pantalla, una foto o un PDF de un boleto/cupón de apuestas deportivas.
Tu única tarea es copiar el texto del boleto, tal cual se ve, en texto plano, una línea por dato, en el mismo orden de la imagen.
Reglas:
- Incluye todo lo que sea parte del boleto: tipo de apuesta (por ejemplo BB o Combinada), fechas y horas, equipos ("Equipo A vs. Equipo B"), competición, mercados, selecciones, cuotas, y al final cuota total, valor apostado, bono y ganancia total si aparecen.
- No traduzcas, no resumas, no corrijas, no inventes nada y no añadas comentarios ni formato Markdown. Si un dato no se lee bien, copia lo que se alcance a leer.
- Los números con coma decimal déjalos como se ven.
- No copies datos personales del cliente (nombre de usuario, número de cliente, afiliado, IB, saldo).
- Si la imagen no es un boleto o cupón de apuestas, responde exactamente: NO_ES_CUPON`;

export const MODOS = ["historial", "cupon", "semana", "armar", "imagen"];
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export function respuestaJson(status, cuerpo) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Compara en tiempo constante para no dar pistas sobre la clave por el tiempo de respuesta.
export function mismoTexto(a, b) {
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
  if (texto.length > MAX_IMAGEN)
    return { error: respuestaJson(413, { error: "Hay demasiados datos para analizar de una vez." }) };
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { error: respuestaJson(400, { error: "La petición no es JSON válido." }) };
  }
  const modo = cuerpo?.modo;
  if (!MODOS.includes(modo)) return { error: respuestaJson(400, { error: "Modo desconocido." }) };
  if (modo !== "imagen" && texto.length > MAX_CUERPO)
    return { error: respuestaJson(413, { error: "Hay demasiados datos para analizar de una vez." }) };
  const datos = cuerpo.datos && typeof cuerpo.datos === "object" ? cuerpo.datos : null;
  if (!datos) return { error: respuestaJson(400, { error: "Faltan los datos." }) };
  if (modo === "imagen") {
    if (!TIPOS_IMAGEN.includes(datos.tipo) || !/^[A-Za-z0-9+/=\s]{100,}$/.test(String(datos.imagen || "")))
      return { error: respuestaJson(400, { error: "No pude leer la imagen. Prueba con otra captura." }) };
    return { modo, datos: { imagen: datos.imagen.replace(/\s+/g, ""), tipo: datos.tipo, partidos: [] } };
  }
  if (modo === "cupon" && !(typeof datos.cupon === "string" && datos.cupon.trim().length >= 10))
    return { error: respuestaJson(400, { error: "Pega el texto del cupón que quieres revisar." }) };
  if (modo === "armar" && !(typeof datos.partidos === "string" && datos.partidos.trim().length >= 10))
    return { error: respuestaJson(400, { error: "Escribe los partidos o picks que estás considerando." }) };
  // Lista opcional de partidos del cupón (para consultar sus datos antes de analizar).
  datos.partidos = Array.isArray(datos.partidos)
    ? datos.partidos
        .filter((x) => x && typeof x.local === "string" && typeof x.visitante === "string")
        .slice(0, 12)
        .map((x) => ({
          local: x.local.slice(0, 80),
          visitante: x.visitante.slice(0, 80),
          fecha: /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || "") ? x.fecha : "",
        }))
    : modo === "armar"
      ? datos.partidos
      : [];
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
  if (modo === "semana") {
    return {
      ...base,
      output_config: { effort: "medium" },
      system: SISTEMA_SEMANA,
      messages: [
        {
          role: "user",
          content: `Fecha de hoy: ${hoy}.\nMis últimos 7 días y mi historial general:\n\n${JSON.stringify(datos.semana ?? {})}`,
        },
      ],
    };
  }
  if (modo === "imagen") {
    return {
      ...base,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: SISTEMA_IMAGEN,
      messages: [
        {
          role: "user",
          content: [
            datos.tipo === "application/pdf"
              ? { type: "document", source: { type: "base64", media_type: datos.tipo, data: datos.imagen } }
              : { type: "image", source: { type: "base64", media_type: datos.tipo, data: datos.imagen } },
            { type: "text", text: "Copia el texto de este boleto." },
          ],
        },
      ],
    };
  }
  const extras = [];
  if (datos.datosPartidos?.length)
    extras.push(
      "datosPartidos (football-data.org; probabilidades de un modelo de goles de Poisson; p1/px/p2 = gana local/empate/gana visitante):\n" +
        JSON.stringify(datos.datosPartidos),
    );
  if (datos.registros)
    extras.push(
      "misRegistros (lo que yo mismo anoté en partidos anteriores: promedios de los últimos 5 partidos registrados de cada equipo y jugador):\n" +
        JSON.stringify(datos.registros),
    );
  if (datos.precisionAnalista)
    extras.push(
      "precisionAnalista (cómo te ha ido en cupones anteriores de esta persona):\n" +
        JSON.stringify(datos.precisionAnalista),
    );
  if (datos.historial) extras.push("Mi historial por tipo de mercado:\n" + JSON.stringify(datos.historial));
  if (datos.presupuesto) extras.push("Mi presupuesto:\n" + JSON.stringify(datos.presupuesto));
  if (datos.banca) extras.push("Mi gestión de banca:\n" + JSON.stringify(datos.banca));
  if (datos.riesgo) extras.push("Riesgo calculado por la app:\n" + JSON.stringify(datos.riesgo));
  if (modo === "armar") {
    return {
      ...base,
      max_tokens: 24000,
      output_config: { effort: "high" },
      system: SISTEMA_ARMAR,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
      messages: [
        {
          role: "user",
          content:
            `Fecha de hoy: ${hoy}.\nAyúdame a armar cupones con esto:\n\n<partidos>\n${datos.partidos.trim()}\n</partidos>` +
            (extras.length ? "\n\n" + extras.join("\n\n") : ""),
        },
      ],
    };
  }
  // Búsquedas: una por partido y dos de margen (entre 4 y 12), para que un cupón largo no se quede a medias.
  const nPartidos =
    (Array.isArray(datos.partidos) && datos.partidos.length) ||
    (datos.cupon.match(/\bvs\.?\b/gi) || []).length ||
    1;
  return {
    ...base,
    max_tokens: 24000,
    output_config: { effort: "high" },
    system: SISTEMA_CUPON,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: Math.min(12, Math.max(4, nPartidos + 2)) },
    ],
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

// Resume los datos de un partido (de /api/datos-partido) a lo que le sirve al análisis.
export function resumirDatosPartido(d) {
  if (!d?.encontrado) return null;
  const fila = (r) =>
    r && {
      posicion: r.posicion,
      puntos: r.puntos,
      jugados: r.jugados,
      golesFavor: r.golesFavor,
      golesContra: r.golesContra,
    };
  const forma = (l) =>
    (l || []).map((m) => m.resultado + " " + m.marcador + (m.enCasa ? " (casa)" : " (fuera)")).join(", ");
  const m = d.modelo;
  return {
    partido: d.partido.local.nombre + " vs " + d.partido.visitante.nombre,
    competicion: d.partido.competicion,
    fecha: String(d.partido.fecha || "").slice(0, 16),
    estado: d.partido.estado,
    ...(d.alReves
      ? { nota: "la casa lista los equipos al revés; este es el orden oficial (local primero)" }
      : {}),
    tabla: d.tabla
      ? { local: fila(d.tabla.local), visitante: fila(d.tabla.visitante), equipos: d.tabla.equipos }
      : null,
    ultimos5: { local: forma(d.forma?.local), visitante: forma(d.forma?.visitante) },
    enfrentamientos: d.h2h
      ? {
          partidos: d.h2h.partidos,
          goles: d.h2h.goles,
          ganaLocal: d.h2h.local?.ganados,
          empates: d.h2h.local?.empates,
          ganaVisitante: d.h2h.visitante?.ganados,
        }
      : null,
    modelo: m
      ? {
          golesEsperados: [m.lambdaLocal, m.lambdaVisitante],
          p1: m.p1,
          px: m.px,
          p2: m.p2,
          mas15: m.over15,
          mas25: m.over25,
          mas35: m.over35,
          ambosMarcan: m.btts,
          base: m.base,
        }
      : null,
  };
}
// Consulta los datos de hasta 5 partidos del cupón (uno tras otro, con un tope de tiempo). Si la fuente no cubre
// un partido o se alcanza su límite de consultas, se sigue sin esos datos.
export async function reunirDatosPartidos(partidos, datosDePartido, enviar, ahora = () => Date.now()) {
  const out = [];
  if (!datosDePartido || !Array.isArray(partidos) || !partidos.length) return out;
  const inicio = ahora();
  enviar({ t: "estado", v: "Consultando datos de los partidos…" });
  for (const p of partidos.slice(0, 5)) {
    if (!p.fecha || ahora() - inicio > 12000) continue;
    try {
      const d = await datosDePartido(p);
      if (d?.limite) break;
      const r = resumirDatosPartido(d);
      if (r) out.push(r);
    } catch {
      // sin datos de este partido
    }
  }
  return out;
}

export async function manejar(req, { env, crearCliente, datosDePartido }) {
  const p = await leerPeticion(req, env);
  if (p.error) return p.error;
  return respuestaEnStreaming(async (enviar) => {
    if (p.modo === "cupon") {
      const datosPartidos = await reunirDatosPartidos(p.datos.partidos, datosDePartido, enviar);
      if (datosPartidos.length) p.datos.datosPartidos = datosPartidos;
      enviar({ t: "estado", v: "Analizando…" });
    }
    const peticion = construirPeticion(p.modo, p.datos);
    await analizar(crearCliente(env.ANTHROPIC_API_KEY), peticion, enviar);
  });
}
