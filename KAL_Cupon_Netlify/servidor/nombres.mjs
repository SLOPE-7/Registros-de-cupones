// Nombres en español e inglés: países (con su código ISO para la bandera), equipos con nombre distinto en cada
// idioma y competiciones. Lo usan la búsqueda de logos y los datos del partido.

export function norm(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// [español, inglés, código de bandera (flagcdn), otros nombres…]
export const COUNTRIES = [
  ["Alemania", "Germany", "de"],
  ["Albania", "Albania", "al"],
  ["Andorra", "Andorra", "ad"],
  ["Armenia", "Armenia", "am"],
  ["Austria", "Austria", "at"],
  ["Azerbaiyán", "Azerbaijan", "az"],
  ["Bélgica", "Belgium", "be"],
  ["Bielorrusia", "Belarus", "by"],
  ["Bosnia y Herzegovina", "Bosnia and Herzegovina", "ba", "bosnia"],
  ["Bulgaria", "Bulgaria", "bg"],
  ["Chipre", "Cyprus", "cy"],
  ["Croacia", "Croatia", "hr"],
  ["Dinamarca", "Denmark", "dk"],
  ["Escocia", "Scotland", "gb-sct"],
  ["Eslovaquia", "Slovakia", "sk"],
  ["Eslovenia", "Slovenia", "si"],
  ["España", "Spain", "es"],
  ["Estonia", "Estonia", "ee"],
  ["Finlandia", "Finland", "fi"],
  ["Francia", "France", "fr"],
  ["Gales", "Wales", "gb-wls"],
  ["Georgia", "Georgia", "ge"],
  ["Gibraltar", "Gibraltar", "gi"],
  ["Grecia", "Greece", "gr"],
  ["Hungría", "Hungary", "hu"],
  ["Inglaterra", "England", "gb-eng"],
  ["Irlanda", "Ireland", "ie", "republic of ireland"],
  ["Irlanda del Norte", "Northern Ireland", "gb-nir"],
  ["Islandia", "Iceland", "is"],
  ["Islas Feroe", "Faroe Islands", "fo"],
  ["Israel", "Israel", "il"],
  ["Italia", "Italy", "it"],
  ["Kazajistán", "Kazakhstan", "kz"],
  ["Kosovo", "Kosovo", "xk"],
  ["Letonia", "Latvia", "lv"],
  ["Liechtenstein", "Liechtenstein", "li"],
  ["Lituania", "Lithuania", "lt"],
  ["Luxemburgo", "Luxembourg", "lu"],
  ["Macedonia del Norte", "North Macedonia", "mk", "macedonia"],
  ["Malta", "Malta", "mt"],
  ["Moldavia", "Moldova", "md"],
  ["Montenegro", "Montenegro", "me"],
  ["Noruega", "Norway", "no"],
  ["Países Bajos", "Netherlands", "nl", "holanda", "holland"],
  ["Polonia", "Poland", "pl"],
  ["Portugal", "Portugal", "pt"],
  ["Reino Unido", "United Kingdom", "gb"],
  ["República Checa", "Czechia", "cz", "chequia", "czech republic"],
  ["Rumania", "Romania", "ro", "rumanía"],
  ["Rusia", "Russia", "ru"],
  ["San Marino", "San Marino", "sm"],
  ["Serbia", "Serbia", "rs"],
  ["Suecia", "Sweden", "se"],
  ["Suiza", "Switzerland", "ch"],
  ["Turquía", "Turkey", "tr", "turkiye"],
  ["Ucrania", "Ukraine", "ua"],
  ["Argentina", "Argentina", "ar"],
  ["Bolivia", "Bolivia", "bo"],
  ["Brasil", "Brazil", "br"],
  ["Chile", "Chile", "cl"],
  ["Colombia", "Colombia", "co"],
  ["Ecuador", "Ecuador", "ec"],
  ["Paraguay", "Paraguay", "py"],
  ["Perú", "Peru", "pe"],
  ["Uruguay", "Uruguay", "uy"],
  ["Venezuela", "Venezuela", "ve"],
  ["Canadá", "Canada", "ca"],
  ["Costa Rica", "Costa Rica", "cr"],
  ["Cuba", "Cuba", "cu"],
  ["El Salvador", "El Salvador", "sv"],
  ["Estados Unidos", "United States", "us", "usa", "eeuu", "ee uu"],
  ["Guatemala", "Guatemala", "gt"],
  ["Haití", "Haiti", "ht"],
  ["Honduras", "Honduras", "hn"],
  ["Jamaica", "Jamaica", "jm"],
  ["México", "Mexico", "mx"],
  ["Nicaragua", "Nicaragua", "ni"],
  ["Panamá", "Panama", "pa"],
  ["República Dominicana", "Dominican Republic", "do"],
  ["Trinidad y Tobago", "Trinidad and Tobago", "tt"],
  ["Curazao", "Curacao", "cw"],
  ["Surinam", "Suriname", "sr"],
  ["Argelia", "Algeria", "dz"],
  ["Angola", "Angola", "ao"],
  ["Benín", "Benin", "bj"],
  ["Burkina Faso", "Burkina Faso", "bf"],
  ["Cabo Verde", "Cape Verde", "cv"],
  ["Camerún", "Cameroon", "cm"],
  ["Costa de Marfil", "Ivory Coast", "ci", "cote d ivoire"],
  ["Egipto", "Egypt", "eg"],
  ["Gabón", "Gabon", "ga"],
  ["Gambia", "Gambia", "gm"],
  ["Ghana", "Ghana", "gh"],
  ["Guinea", "Guinea", "gn"],
  ["Guinea Ecuatorial", "Equatorial Guinea", "gq"],
  ["Kenia", "Kenya", "ke"],
  ["Libia", "Libya", "ly"],
  ["Malí", "Mali", "ml"],
  ["Marruecos", "Morocco", "ma"],
  ["Mauritania", "Mauritania", "mr"],
  ["Mozambique", "Mozambique", "mz"],
  ["Namibia", "Namibia", "na"],
  ["Nigeria", "Nigeria", "ng"],
  ["RD Congo", "DR Congo", "cd", "republica democratica del congo", "congo dr"],
  ["Congo", "Congo", "cg"],
  ["Senegal", "Senegal", "sn"],
  ["Sierra Leona", "Sierra Leone", "sl"],
  ["Somalia", "Somalia", "so"],
  ["Sudáfrica", "South Africa", "za"],
  ["Sudán", "Sudan", "sd"],
  ["Tanzania", "Tanzania", "tz"],
  ["Togo", "Togo", "tg"],
  ["Túnez", "Tunisia", "tn"],
  ["Uganda", "Uganda", "ug"],
  ["Zambia", "Zambia", "zm"],
  ["Zimbabue", "Zimbabwe", "zw"],
  ["Arabia Saudita", "Saudi Arabia", "sa", "arabia saudi"],
  ["Australia", "Australia", "au"],
  ["China", "China", "cn"],
  ["Corea del Sur", "South Korea", "kr", "korea republic"],
  ["Emiratos Árabes Unidos", "United Arab Emirates", "ae", "emiratos"],
  ["India", "India", "in"],
  ["Irak", "Iraq", "iq"],
  ["Irán", "Iran", "ir"],
  ["Japón", "Japan", "jp"],
  ["Jordania", "Jordan", "jo"],
  ["Nueva Zelanda", "New Zealand", "nz"],
  ["Qatar", "Qatar", "qa", "catar"],
  ["Uzbekistán", "Uzbekistan", "uz"],
];
const COUNTRY_BY_NAME = new Map();
COUNTRIES.forEach((c) => [c[0], c[1], ...c.slice(3)].forEach((n) => COUNTRY_BY_NAME.set(norm(n), c)));
// Devuelve { es, en, flag } si el texto es un país o su selección ("Selección de España", "Spain U21"…).
export function findCountry(text) {
  const exact = COUNTRY_BY_NAME.get(norm(text));
  if (exact) return { es: exact[0], en: exact[1], flag: exact[2] };
  const n = norm(text)
    .replace(/^(seleccion|national team) (de |of )?/, "")
    .replace(/\b(national|team|nt|fc|women|femenil|femenina)\b/g, " ")
    .replace(/\b(u|sub)\s?(17|19|20|21|23)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const c = COUNTRY_BY_NAME.get(n);
  return c ? { es: c[0], en: c[1], flag: c[2] } : null;
}

// Equipos con nombre distinto en español e inglés (o en su idioma local).
export const TEAM_ALIASES = {
  "bayern munich": "bayern munchen",
  "bayern de munich": "bayern munchen",
  inter: "internazionale",
  "inter milan": "internazionale",
  "inter de milan": "internazionale",
  "ac milan": "milan",
  "atletico de madrid": "atletico madrid",
  "athletic bilbao": "athletic club",
  "manchester utd": "manchester united",
  "man utd": "manchester united",
  "man city": "manchester city",
  "paris saint germain": "paris saint-germain",
  psg: "paris saint-germain",
  "sporting lisboa": "sporting cp",
  "sporting de lisboa": "sporting cp",
  "estrella roja": "crvena zvezda",
  "olympique de marsella": "olympique marseille",
  marsella: "marseille",
  "olympique de lyon": "olympique lyonnais",
  lyon: "lyonnais",
  "bayer leverkusen": "bayer 04 leverkusen",
  oporto: "porto",
  benfica: "sl benfica",
  "ajax de amsterdam": "ajax",
  colonia: "koln",
  maguncia: "mainz",
  friburgo: "freiburg",
  monchengladbach: "borussia monchengladbach",
  napoles: "napoli",
  roma: "as roma",
  "juventus de turin": "juventus",
  brujas: "club brugge",
  "club brujas": "club brugge",
  "slavia praga": "slavia prague",
  "sparta praga": "sparta prague",
  "dinamo de zagreb": "dinamo zagreb",
  "estrella roja de belgrado": "crvena zvezda",
};
export function teamAlias(q) {
  const n = norm(q);
  return TEAM_ALIASES[n] || null;
}

// Competiciones: nombre en español → país (inglés) y código de football-data.org si está en su plan gratis.
export const LEAGUES = [
  [/^la ?liga|primera division|liga espanola|liga ea sports/, "Spain", "PD"],
  [/premier league|liga inglesa/, "England", "PL"],
  [/championship/, "England", "ELC"],
  [/serie a.*(brasil|brazil)|brasileir/, "Brazil", "BSA"],
  [/^serie a|liga italiana|calcio/, "Italy", "SA"],
  [/^bundesliga|liga alemana/, "Germany", "BL1"],
  [/ligue 1|liga francesa/, "France", "FL1"],
  [/eredivisie|liga neerlandesa|liga holandesa/, "Netherlands", "DED"],
  [/primeira liga|liga portugal|liga portuguesa/, "Portugal", "PPL"],
  [/champions league|liga de campeones|uefa liga campeones/, null, "CL"],
  [/eurocopa|european championship|\beuro\b/, null, "EC"],
  [/mundial|world cup|copa del mundo/, null, "WC"],
  [/liga mx|liga mexicana/, "Mexico", null],
  [/mls|major league soccer/, "United States", null],
  [/liga nacional.*honduras|liga hondubet/, "Honduras", null],
  [/super ?lig|liga turca/, "Turkey", null],
  [/scottish premiership|premiership escocesa/, "Scotland", null],
  [/liga profesional.*argentin|liga argentina/, "Argentina", null],
];
export function leagueInfo(q) {
  const n = norm(q);
  const hit = LEAGUES.find(([re]) => re.test(n));
  return hit ? { country: hit[1], code: hit[2] } : { country: null, code: null };
}
