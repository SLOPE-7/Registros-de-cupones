// V20 · Leer un boleto desde una captura (Claude con visión vía el Analista) o desde el portapapeles.
// Módulo independiente: solo añade botones junto a "Leer y revisar" y reutiliza readText().

const IMG_MAX_SIDE = 1600;

async function shrinkImage(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, IMG_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)),
    h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const url = cv.toDataURL("image/jpeg", 0.85);
  return { tipo: "image/jpeg", imagen: url.slice(url.indexOf(",") + 1) };
}

async function pdfPayload(blob) {
  if (blob.size > 2_500_000) throw new Error("pdf-grande");
  const url = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
  return { tipo: "application/pdf", imagen: url.slice(url.indexOf(",") + 1) };
}

function setImgStatus(txt) {
  const el = $("imgReadStatus");
  if (el) {
    el.textContent = txt || "";
    el.hidden = !txt;
  }
}

let imgReading = false;
async function readFromImage(blob) {
  if (imgReading) return;
  imgReading = true;
  try {
    setImgStatus("🖼️ Preparando el archivo…");
    let pic;
    try {
      pic = blob.type === "application/pdf" ? await pdfPayload(blob) : await shrinkImage(blob);
    } catch (e) {
      if (e.message === "pdf-grande") {
        toast("Ese PDF pesa demasiado (máximo 2.5 MB). Prueba con una captura.");
        return;
      }
      toast("No pude abrir ese archivo. Prueba con una captura de pantalla.");
      return;
    }
    setImgStatus("🤖 Leyendo el boleto…");
    const r = await analystRequest("imagen", pic, { onStatus: (s) => setImgStatus("🤖 " + s) });
    const txt = String(r.text || "")
      .replace(/^```[a-z]*\n?|```$/g, "")
      .trim();
    if (!txt || /NO_ES_CUPON/.test(txt)) {
      toast("Ese archivo no parece un boleto de apuestas.");
      return;
    }
    $("raw").value = txt;
    readText();
    toast("Boleto leído. Revisa los datos antes de guardar.");
  } catch (e) {
    toast(e.message || "No se pudo leer la imagen.");
  } finally {
    imgReading = false;
    setImgStatus("");
  }
}

// ---------- Enlace de compartir de Doradobet ----------
const SHARE_RE = /https?:\/\/(?:www\.)?doradobet\.com\/[^\s"'<>]*?[?&]shareCode=[A-Za-z0-9]{6,24}/i;
let linkBusy = false;
function showLinkDiag(diag) {
  let el = $("linkDiag");
  if (!el) {
    $("imgReadStatus").insertAdjacentHTML(
      "afterend",
      '<pre class="small link-diag" id="linkDiag" hidden></pre><button type="button" class="btn sm" id="linkDiagCopy" hidden>📋 Copiar diagnóstico</button>',
    );
    el = $("linkDiag");
    $("linkDiagCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("linkDiag").textContent);
        toast("Diagnóstico copiado. Pégalo en el chat.");
      } catch {
        toast("No se pudo copiar. Mantén pulsado el texto para copiarlo.");
      }
    });
  }
  el.hidden = !diag;
  $("linkDiagCopy").hidden = !diag;
  el.textContent = diag
    ? "Doradobet no entregó el boleto como texto desde ese enlace. Usa 📷 Leer captura o PDF, o pega el texto. " +
      "Si quieres que lo afine, enséñale esto a Claude:\n" +
      JSON.stringify(diag, null, 1)
    : "";
}
async function readFromLink(text) {
  if (linkBusy) return;
  const clave = analystState().clave || "";
  if (!clave) {
    toast("Primero escribe el código de acceso del Analista (en Analista → ⚙ Configurar).");
    return;
  }
  linkBusy = true;
  showLinkDiag(null);
  setImgStatus("🔗 Buscando el boleto en el enlace…");
  try {
    const r = await fetch("/api/enlace", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kal-clave": clave },
      body: JSON.stringify({ enlace: text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(j.error || "No pude consultar el enlace (error " + r.status + ").");
      return;
    }
    if (j.ok && j.texto) {
      $("raw").value = j.texto;
      readText();
      if (!draftSelections.length) showLinkDiag(j.diagnostico);
      else toast("Boleto traído desde el enlace. Revisa los datos antes de guardar.");
    } else {
      showLinkDiag(j.diagnostico || { error: "sin respuesta" });
    }
  } catch {
    toast("Sin conexión con el servidor. Revisa tu internet.");
  } finally {
    linkBusy = false;
    setImgStatus("");
  }
}

async function pasteFromClipboard() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith("image/"));
        if (t) return readFromImage(await it.getType(t));
      }
      for (const it of items) {
        if (it.types.includes("text/plain")) {
          const txt = await (await it.getType("text/plain")).text();
          if (SHARE_RE.test(txt)) return readFromLink(txt);
          $("raw").value = txt;
          return readText();
        }
      }
    } else if (navigator.clipboard?.readText) {
      const txt = await navigator.clipboard.readText();
      if (SHARE_RE.test(txt)) return readFromLink(txt);
      $("raw").value = txt;
      return readText();
    }
    toast("No hay nada copiado.");
  } catch {
    toast("El teléfono no dejó leer el portapapeles. Mantén pulsado en el cuadro de texto y elige Pegar.");
  }
}

(function initCaptura() {
  const row = $("readBtn")?.parentElement;
  if (!row) return;
  row.insertAdjacentHTML(
    "beforeend",
    '<button type="button" class="btn" id="photoBtn">📷 Leer captura o PDF</button>' +
      '<button type="button" class="btn" id="pasteBtn">📋 Pegar</button>' +
      '<input id="photoFile" type="file" accept="image/*,application/pdf" hidden>' +
      '<div class="small muted img-status" id="imgReadStatus" hidden aria-live="polite"></div>',
  );
  $("photoBtn").addEventListener("click", () => $("photoFile").click());
  $("photoFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) readFromImage(f);
  });
  $("pasteBtn").addEventListener("click", pasteFromClipboard);
  // Si el texto del cuadro es el enlace de Doradobet, "Leer y revisar" lo consulta en lugar de leerlo como boleto.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest("#readBtn") || !SHARE_RE.test($("raw").value)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      readFromLink($("raw").value);
    },
    true,
  );
  $("raw").addEventListener("paste", (e) => {
    const pegado = e.clipboardData?.getData("text") || "";
    if (SHARE_RE.test(pegado)) {
      e.preventDefault();
      $("raw").value = pegado;
      readFromLink(pegado);
      return;
    }
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) {
      e.preventDefault();
      readFromImage(f);
    }
  });
})();
