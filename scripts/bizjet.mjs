// SAFE Terminal - business jet snapshot (runs on GitHub Actions, no secrets, no Supabase)
// sources: adsb.lol live positions (by ICAO type) · FAA releasable registry (US corporate owners only) · OurAirports (nearest airport)
import fs from "node:fs";
const OUT = process.argv[2] || "out";
const UA = { "User-Agent": "SAFE-Terminal-research (github.com/safeofficial/terminal)" };
const TYPES = ["GLF4","GLF5","GLF6","GA5C","GA6C","GA7C","GA8C","G280","G150","GALX",
  "GLEX","GL5T","GL6T","GL7T","CL30","CL35","CL60","LJ35","LJ45","LJ60","LJ75",
  "F900","F2TH","FA7X","FA8X","FA6X","FA50",
  "C750","C680","C68A","C700","C56X","C560","C525","C25A","C25B","C25C","C510","C550",
  "E55P","E50P","E545","E550","E35L","H25B","H25C","PRM1","HDJT","PC24","SF50"];
// well-known business-aviation operators by ICAO callsign prefix
const OPS = { EJA: "NetJets", NJE: "NetJets Europe", LXJ: "Flexjet", VJT: "VistaJet", XOJ: "XO", JTL: "Jet Linx", EJM: "Executive Jet Management" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const now = Date.now();
const faa = rd(OUT + "/faa.json", {});        // hex -> [name, city, state, kind]
const aps = rd(OUT + "/airports.json", []);    // [icao, name, lat, lon, iso]
const st = rd(OUT + "/state.json", { legs: {}, trips: [] });

function near(lat, lon, km) {
  let best = null, bd = km;
  const cl = Math.cos(lat * Math.PI / 180);
  for (const a of aps) {
    const dy = (a[2] - lat) * 111, dx = (a[3] - lon) * 111 * cl;
    if (Math.abs(dy) > bd || Math.abs(dx) > bd) continue;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = a; }
  }
  return best ? { icao: best[0], name: best[1], iso: best[4] } : null;
}

const ac = [], log = {};
const SRC = ["https://api.adsb.lol/v2/type/", "https://api.airplanes.live/v2/type/", "https://opendata.adsb.fi/api/v2/type/"];
async function get(u) {
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch(u, { headers: UA });
      log[u.split("/")[2] + ":" + r.status] = (log[u.split("/")[2] + ":" + r.status] || 0) + 1;
      if (r.ok) return await r.json();
      if (r.status === 429) await sleep(3000);
    } catch (e) { log[u.split("/")[2] + ":err"] = (log[u.split("/")[2] + ":err"] || 0) + 1; }
    await sleep(1200);
  }
  return null;
}
for (const t of TYPES) {
  let j = null;
  for (const s of SRC) { j = await get(s + t); if (j) break; }
  for (const x of (j && (j.ac || j.aircraft)) || []) ac.push(x);
  await sleep(1100);
}
console.log(JSON.stringify(log));
const seen = {};
const out = [];
for (const x of ac) {
  if (!x.hex || seen[x.hex] || x.lat == null || x.lon == null) continue;
  const f = Number(x.dbFlags || 0);
  if (f & 1 || f & 4 || f & 8) continue;          // military · privacy (PIA) · owner asked not to be tracked (LADD)
  seen[x.hex] = 1;
  const cs = String(x.flight || "").trim(), op = OPS[cs.slice(0, 3)] || null;
  const fo = faa[x.hex] || null;
  const alt = x.alt_baro === "ground" ? 0 : Number(x.alt_baro) || 0;
  out.push({ h: x.hex, r: x.r || "", t: x.t || "", cs, op, own: fo ? fo[0] : null, oc: fo ? fo[1] + (fo[2] ? ", " + fo[2] : "") : null, ok: fo ? fo[3] : null,
    la: Math.round(x.lat * 1000) / 1000, lo: Math.round(x.lon * 1000) / 1000, al: alt, gs: Math.round(x.gs || 0), tr: Math.round(x.track || 0), vr: Math.round(x.baro_rate || 0) });
}
// legs: departure when first seen low and climbing near an airport · arrival when last seen low and descending, then gone
for (const a of out) {
  const L = st.legs[a.h];
  const low = a.al < 10000, ap = low ? near(a.la, a.lo, 40) : null;
  if (!L || now - L.ts > 45 * 60e3) {
    st.legs[a.h] = { from: low && a.vr >= 0 && ap ? ap : null, t0: now, ts: now, last: a };
  } else { L.ts = now; L.last = a; }
}
for (const [h, L] of Object.entries(st.legs)) {
  if (now - L.ts < 25 * 60e3) continue;
  const a = L.last, to = a.al < 10000 && a.vr <= 0 ? near(a.la, a.lo, 40) : null;
  if (L.from || to) st.trips.push({ h, r: a.r, t: a.t, op: a.op, own: a.own, from: L.from, to, t0: L.t0, t1: L.ts });
  delete st.legs[h];
}
st.trips = st.trips.filter((x) => now - x.t1 < 72 * 3600e3).slice(-3000);
for (const a of out) { const L = st.legs[a.h]; if (L && L.from) a.from = L.from.icao; }
fs.writeFileSync(OUT + "/state.json", JSON.stringify(st));
fs.writeFileSync(OUT + "/jets.json", JSON.stringify({ at: new Date(now).toISOString(), n: out.length, src: log, ac: out, trips: st.trips.slice(-800) }));
console.log("aircraft", out.length, "legs", Object.keys(st.legs).length, "trips", st.trips.length);
