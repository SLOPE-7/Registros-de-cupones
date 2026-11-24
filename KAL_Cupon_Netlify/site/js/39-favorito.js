// V27 · Favorito de Safari: lee el boleto que ya tienes abierto en tu casa de apuestas y lo manda a KAL.
// El favorito solo toma el TEXTO visible de la página (o lo que tengas seleccionado), lo copia al portapapeles
// y abre KAL con ese texto en la dirección (#importar=…). No ve contraseñas ni habla con la casa.
// KAL lo recibe en importarDeFavorito() (se llama desde 99-arranque.js), lo pone en el cuadro y lo lee.
"use strict";

const FAV_MAX = 14000;

// Código del favorito. Sin «%», sin saltos de línea y con el «#» escrito como carácter 35 para que no se corte
// al pegarlo como dirección de un favorito.
function favoritoCodigo(origen) {
  const K = JSON.stringify(origen || location.origin + "/");
  return (
    "javascript:(function(){" +
    "var K=" +
    K +
    ",c=0,q=[document],t='',m='',h='',i,d,a,j,e,x,w,n;" +
    "while(q.length){d=q.shift();" +
    "try{m+=String(d.getSelection())}catch(r){}" +
    "try{t+='\\n'+(d.body?d.body.innerText:'')}catch(r){}" +
    "try{a=d.querySelectorAll('*');for(j=0;j<a.length;j++){e=a[j];" +
    "if(e.shadowRoot){w=d.createTreeWalker(e.shadowRoot,4);while(n=w.nextNode()){if(!/^(STYLE|SCRIPT)$/.test(n.parentNode.nodeName))h+=n.data+'\\n'}}" +
    "if(e.tagName=='IFRAME'){x=null;try{x=e.contentDocument}catch(r){}if(x)q.push(x);else c++}}}catch(r){}}" +
    "t=(m.trim().length>=40?m:/\\bvs\\b/i.test(t)?t:t+'\\n'+h).replace(/\\n{3,}/g,'\\n\\n').trim();" +
    "i=t.search(/\\bvs\\b/i);" +
    "if(i<0){alert('KAL: no veo un boleto en esta pantalla. Leí '+t.length+' letras. '+" +
    "(c?'Hay '+c+' marco(s) protegido(s) que no puedo leer: selecciona y copia el texto del cupón y usa Pegar en KAL. ':" +
    "'Abre tu cupón y toca el favorito otra vez. ')+'Inicio: '+t.slice(0,60));return}" +
    "if(t.length>" +
    FAV_MAX +
    "){i=Math.max(0,i-300);t=t.slice(i,i+" +
    FAV_MAX +
    ")}" +
    "try{navigator.clipboard.writeText(t)}catch(r){}" +
    "var b=btoa(unescape(encodeURIComponent(t))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');" +
    "var u=K+String.fromCharCode(35)+'importar='+b;" +
    "if(!window.open(u,'_blank'))location.href=u" +
    "})()"
  );
}

function favoritoDecodificar(b64url) {
  try {
    const b = String(b64url || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

// Si KAL se abrió desde el favorito, carga el boleto en "Nuevo cupón" y lo lee.
function importarDeFavorito() {
  const m = /^#importar=([A-Za-z0-9_-]+)$/.exec(location.hash || "");
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search);
  const txt = favoritoDecodificar(m[1]).slice(0, FAV_MAX * 2);
  if (!txt.trim()) {
    toast("El favorito no trajo ningún texto. Abre el cupón en tu casa y vuelve a tocarlo.");
    return false;
  }
  go("new");
  $("raw").value = txt;
  $("raw").dispatchEvent(new Event("input", { bubbles: true }));
  toast("📥 Boleto recibido del favorito (" + txt.length + " letras). Revisa los datos antes de guardar.");
  readText();
  return true;
}

async function copiarTexto(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}

(function initFavorito() {
  const row = $("readBtn")?.parentElement;
  if (!row) return;
  const box = document.createElement("details");
  box.className = "fav-box";
  box.id = "favBox";
  box.innerHTML =
    '<summary class="small"><b>🔖 Leer el boleto directo desde tu casa (favorito de Safari)</b></summary>' +
    '<div class="small muted" style="margin-top:8px">' +
    "<p>Una sola vez: instala el favorito. Después, con tu cupón abierto en la casa, lo tocas y KAL se abre con el boleto ya leído.</p>" +
    "<ol>" +
    "<li>Toca <b>Copiar código del favorito</b>.</li>" +
    "<li>En Safari abre cualquier página, toca <b>Compartir → Añadir a favoritos</b> y guárdalo con el nombre <b>KAL</b>.</li>" +
    "<li>Abre Favoritos (icono del libro), toca <b>Editar</b>, entra en <b>KAL</b>, borra la dirección y <b>pega el código</b>. Guarda.</li>" +
    "<li>En la casa, con el cupón abierto (o la hoja de imprimir), toca Favoritos → <b>KAL</b>.</li>" +
    "</ol>" +
    "<p>El favorito solo lee el texto que ves en pantalla (o el que tengas seleccionado). No ve tu contraseña ni envía nada a la casa. También copia el boleto: si usas KAL desde el icono de inicio, ábrelo y toca <b>📋 Pegar</b>.</p>" +
    "</div>" +
    '<div class="row"><button type="button" class="btn sm" id="favCopy">📋 Copiar código del favorito</button></div>' +
    '<a class="small" id="favLink" href="#" draggable="true">KAL · leer boleto</a> <span class="small muted">(en computador, arrástralo a la barra de favoritos)</span>';
  row.insertAdjacentElement("afterend", box);
  $("favLink").setAttribute("href", favoritoCodigo());
  $("favLink").addEventListener("click", (e) => {
    e.preventDefault();
    toast("Arrastra este enlace a tu barra de favoritos, o usa «Copiar código del favorito».");
  });
  $("favCopy").addEventListener("click", async () => {
    toast(
      (await copiarTexto(favoritoCodigo()))
        ? "Código copiado. Ahora pégalo en el favorito."
        : "No pude copiarlo.",
    );
  });
})();
