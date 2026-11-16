// Genera site/js/29-paises.js a partir de servidor/nombres.mjs (una sola lista de países para servidor y app).
// Uso: node herramientas/generar-paises.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRIES } from "../servidor/nombres.mjs";

export function contenido() {
  return (
    "// GENERADO por herramientas/generar-paises.mjs a partir de servidor/nombres.mjs. No editar a mano.\n" +
    "// Países y selecciones en español e inglés, con el código de su bandera (flagcdn.com).\n" +
    '"use strict";\n' +
    "const KAL_COUNTRIES = " +
    JSON.stringify(COUNTRIES) +
    ";\n" +
    `const KAL_COUNTRY_INDEX = new Map();
KAL_COUNTRIES.forEach((c) => [c[0], c[1], ...c.slice(3)].forEach((n) => KAL_COUNTRY_INDEX.set(crestNorm(n), c)));
// Devuelve { es, en, flag } si el nombre es un país o su selección ("España", "Spain U21", "Sudan").
function findCountryLocal(name) {
  const full = crestNorm(name);
  let c = KAL_COUNTRY_INDEX.get(full);
  if (!c) {
    const n = full
      .replace(/^(seleccion|national team) (de |of )?/, "")
      .replace(/\\b(national|team|nt|women|femenil|femenina|femenino)\\b/g, " ")
      .replace(/\\b(u|sub)\\s?(17|19|20|21|23)\\b/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
    c = KAL_COUNTRY_INDEX.get(n);
  }
  return c ? { es: c[0], en: c[1], flag: c[2] } : null;
}
const nationFlagUrl = (name) => {
  const c = findCountryLocal(name);
  return c ? "https://flagcdn.com/w160/" + c.flag + ".png" : "";
};
`
  );
}
const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), "../site/js/29-paises.js");
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(destino, contenido());
  console.log("escrito", destino);
}
