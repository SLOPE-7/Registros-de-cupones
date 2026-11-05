// Datos de prueba reutilizables (fechas relativas a hoy, para que siempre haya partidos "de hoy").
const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const mk = (market, pick, odd, settlement = "pending") => ({ market, pick, odd, settlement, builder: false });
const fx = (id, home, away, when, markets, extra = {}) => ({ id, home, away, competition: "UEFA Liga Campeones", league: "UEFA Liga Campeones", country: "Europa", dateISO: isoDay(when), time: hhmm(when), markets, homeCrest: "", awayCrest: "", leagueCrest: "", ...extra });

export function baseDb(now = Date.now()) {
  return {
    coupons: [
      { id: "A", name: "Combinada A", created: new Date(now - 3600e3).toISOString(), houseId: "h1", type: "parlay", stake: 50, odds: 6, payout: 300,
        raw: "Europa, UEFA Liga Campeones\nFenerbahce\nvs.\nLiverpool\n05/11/2026 • 14:00\nTotal de goles: Más de 1.5\nCuotas: 1.50\nVALOR APOSTADO L 50.00",
        fixtures: [fx("1", "Fenerbahce", "Liverpool", now + 10 * 60e3, [mk("Total de goles", "Más de 1.5", "1.50"), mk("Ambos equipos marcan", "Sí", "1.70")]),
                   fx("2", "AEK", "Real Madrid", now + 2 * 3600e3, [mk("1x2", "2", "1.40")])] },
      { id: "B", name: "Combinada B", created: new Date(now - 7200e3).toISOString(), houseId: "h1", type: "parlay", stake: 70, odds: 3, payout: 210,
        raw: "Europa, UEFA Liga Campeones\nAEK\nvs.\nReal Madrid\n05/11/2026 • 16:00\n1x2: 2\nCuotas: 1.40\nVALOR APOSTADO L 70.00",
        fixtures: [fx("3", "AEK", "Real Madrid", now + 2 * 3600e3, [mk("1x2", "2", "1.40")]),
                   fx("4", "Como", "Napoli", now + 26 * 3600e3, [mk("Remates a Puerta (Nico Paz (COM)) - Incl. suplente", "Más de 0.5", "1.60"), mk("Total de remates - Como", "Más de 4.5", "1.70")])] },
      { id: "C", name: "Ganado viejo", created: new Date(now - 9 * 86400e3).toISOString(), houseId: "h2", type: "simple", stake: 20, odds: 2, payout: 40,
        fixtures: [fx("5", "Inter Milan", "Fiorentina", now - 9 * 86400e3, [mk("1x2", "1", "2.00", "won")])] },
    ],
    houses: [{ id: "h1", name: "Hondubet", initial: 500 }, { id: "h2", name: "Doradobet", initial: 300 }],
    transactions: [{ id: "tB", couponId: "B", houseId: "h1", delta: -70, label: "Apuesta de cupón", date: new Date(now - 7200e3).toISOString() }],
    resultHistory: [], actionHistory: [],
  };
}
