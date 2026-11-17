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
          $("raw").value = await (await it.getType("text/plain")).text();
          return readText();
        }
      }
    } else if (navigator.clipboard?.readText) {
      $("raw").value = await navigator.clipboard.readText();
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
  $("raw").addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) {
      e.preventDefault();
      readFromImage(f);
    }
  });
})();
