// SAFE Terminal - listed-company jet snapshot (runs on GitHub Actions, no secrets, no Supabase)
// asks adsb.lol ONLY for the aircraft registered to S&P 500 companies (pub.json, built weekly from the FAA registry)
import fs from "node:fs";
const OUT = process.argv[2] || "out";
const UA = { "User-Agent": "SAFE-Terminal-research (github.com/safeofficial/terminal)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const now = Date.now();
const PUB = rd(OUT + "/pub.json", { hex: {}, fleet: [] });   // hex -> [registrant, ticker, company, sector, exactName]
const aps = rd(OUT + "/airports.json", []);                  // [icao, name, lat, lon, iso, city]
const st = rd(OUT + "/state.json", { legs: {}, trips: [] });
if (!st.legs || Array.isArray(st.legs)) st.legs = {};
st.trips = (st.trips || []).filter((t) => PUB.hex[t.h]);
for (const h of Object.keys(st.legs)) if (!PUB.hex[h]) delete st.legs[h];

function near(lat, lon, km) {
  let best = null, bd = km;
  const cl = Math.cos(lat * Math.PI / 180);
  for (const a of aps) {
    const dy = (a[2] - lat) * 111, dx = (a[3] - lon) * 111 * cl;
    if (Math.abs(dy) > bd || Math.abs(dx) > bd) continue;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = a; }
  }
  return best ? { icao: best[0], name: best[1], iso: best[4], city: best[5] || "", la: best[2], lo: best[3] } : null;
}

const log = {};
async function get(u) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(u, { headers: UA });
      const key = "adsb.lol:" + r.status; log[key] = (log[key] || 0) + 1;
      if (r.ok) return await r.json();
      if (r.status === 429) { await sleep(10000 * (k + 1)); continue; }
      return null;
    } catch (e) { log.err = (log.err || 0) + 1; await sleep(3000); }
  }
  return null;
}
const hexes = Object.keys(PUB.hex);
let ac = [], mode = "multi", multiOk = true;
for (let i = 0; i < hexes.length; i += 40) {          // several aircraft per request
  const j = await get("https://api.adsb.lol/v2/hex/" + hexes.slice(i, i + 40).join(","));
  if (!j) { multiOk = false; break; }
  for (const x of j.ac || j.aircraft || []) ac.push(x);
  await sleep(1500);
}
if (!multiOk || (ac.length === 0 && !st.multiSeen)) {  // the API may not take a list: ask one by one, slowly
  mode = "single"; ac = [];
  for (const h of hexes) {
    const j = await get("https://api.adsb.lol/v2/hex/" + h);
    for (const x of (j && (j.ac || j.aircraft)) || []) ac.push(x);
    await sleep(1200);
  }
} else if (ac.length) st.multiSeen = 1;
console.log(mode, JSON.stringify(log), "seen", ac.length);

const seen = {}, out = [];
for (const x of ac) {
  const h = String(x.hex || "").toLowerCase(), P = PUB.hex[h];
  if (!P || seen[h] || x.lat == null || x.lon == null) continue;
  const f = Number(x.dbFlags || 0);
  if (f & 1 || f & 4 || f & 8) continue;            // military · privacy (PIA) · owner asked not to be tracked (LADD)
  seen[h] = 1;
  const alt = x.alt_baro === "ground" ? 0 : Number(x.alt_baro) || 0;
  if (alt === 0 && Number(x.gs || 0) < 50) continue;  // parked on the ground
  out.push({ h, r: x.r || "", t: x.t || "", cs: String(x.flight || "").trim(), own: P[0], pub: [P[1], P[2], P[3], P[4]],
    la: Math.round(x.lat * 1000) / 1000, lo: Math.round(x.lon * 1000) / 1000, al: alt, gs: Math.round(x.gs || 0), tr: Math.round(x.track || 0), vr: Math.round(x.baro_rate || 0) });
}
// legs: departure when first seen low and climbing near an airport · arrival when last seen low and descending, then gone · path = every snapshot position
for (const a of out) {
  const L = st.legs[a.h];
  const low = a.al < 10000, ap = low ? near(a.la, a.lo, 40) : null;
  if (!L || now - L.ts > 45 * 60e3) {
    st.legs[a.h] = { from: low && a.vr >= 0 && ap ? ap : null, t0: now, ts: now, last: a, p: [[a.lo, a.la]] };
  } else { L.ts = now; L.last = a; (L.p = L.p || []).push([a.lo, a.la]); if (L.p.length > 300) L.p.splice(1, L.p.length - 300); }
}
for (const [h, L] of Object.entries(st.legs)) {
  if (now - L.ts < 25 * 60e3) continue;
  const a = L.last, to = a.al < 10000 && a.vr <= 0 ? near(a.la, a.lo, 40) : null;
  if ((L.from || to) && !(L.from && to && L.from.icao === to.icao)) st.trips.push({ h, r: a.r, t: a.t, own: a.own, pub: a.pub, from: L.from, to, t0: L.t0, t1: L.ts });
  delete st.legs[h];
}
st.trips = st.trips.filter((x) => now - x.t1 < 72 * 3600e3).slice(-1000);
for (const a of out) { const L = st.legs[a.h]; if (L) { if (L.from) a.from = L.from; a.p = L.p; a.t0 = L.t0; } }
fs.writeFileSync(OUT + "/state.json", JSON.stringify(st));
fs.writeFileSync(OUT + "/jets.json", JSON.stringify({ v: 2, at: new Date(now).toISOString(), n: out.length, src: Object.assign({ mode }, log), ac: out, trips: st.trips, fleet: PUB.fleet }));
console.log("listed aircraft flying", out.length, "legs", Object.keys(st.legs).length, "trips", st.trips.length);
