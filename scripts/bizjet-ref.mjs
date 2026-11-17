// weekly reference data: FAA corporate owners (by Mode S hex) · airports with ICAO codes
import fs from "node:fs";
const [, , master, apcsv, OUT] = process.argv;
const out = {};
if (master && fs.existsSync(master)) {
  const lines = fs.readFileSync(master, "latin1").split(/\r?\n/);
  const H = lines[0].replace(/^﻿/, "").split(",").map((s) => s.trim());
  const ix = (n) => H.indexOf(n);
  const iName = ix("NAME"), iCity = ix("CITY"), iSt = ix("STATE"), iReg = ix("TYPE REGISTRANT"), iEng = ix("TYPE ENGINE"), iHex = ix("MODE S CODE HEX");
  const KIND = { "2": "partnership", "3": "corp", "5": "gov", "7": "llc", "8": "corp" };   // individuals (1) and co-owned (4, 9) are left out
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < H.length - 2) continue;
    if (String(c[iEng]).trim() !== "5") continue;      // turbofan only
    const k = KIND[String(c[iReg]).trim()];
    if (!k) continue;
    const hex = String(c[iHex]).trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) continue;
    let nm = String(c[iName]).trim().replace(/\s+/g, " ");
    if (/TRUSTEE|\bTRUST CO\b|\bTRUST COMPANY\b|\bBANK\b.*TRUST/.test(nm)) nm = "TRUST: " + nm;   // trustee registration - real owner not public
    out[hex] = [nm, String(c[iCity]).trim(), String(c[iSt]).trim(), k];
  }
}
fs.writeFileSync(OUT + "/faa.json", JSON.stringify(out));
const ap = [];
if (apcsv && fs.existsSync(apcsv)) {
  const L = fs.readFileSync(apcsv, "utf8").split(/\r?\n/);
  const parse = (s) => { const r = []; let q = false, f = ""; for (const ch of s) { if (ch === '"') q = !q; else if (ch === "," && !q) { r.push(f); f = ""; } else f += ch; } r.push(f); return r; };
  const H = parse(L[0]), g = (n) => H.indexOf(n);
  const iT = g("type"), iN = g("name"), iLa = g("latitude_deg"), iLo = g("longitude_deg"), iC = g("iso_country"), iI = g("icao_code"), iG = g("gps_code"), iId = g("ident"), iM = g("municipality");
  for (let i = 1; i < L.length; i++) {
    const c = parse(L[i]);
    if (!/^(large_airport|medium_airport|small_airport)$/.test(c[iT])) continue;
    const code = c[iI] || c[iG] || "";
    if (!/^[A-Z]{4}$/.test(code)) continue;
    if (c[iT] === "small_airport" && !/^K/.test(code)) continue;        // small fields: US only (bizjet heavy) to keep the file small
    ap.push([code, c[iN], Math.round(+c[iLa] * 1e4) / 1e4, Math.round(+c[iLo] * 1e4) / 1e4, c[iC], c[iM] || ""]);
  }
}
fs.writeFileSync(OUT + "/airports.json", JSON.stringify(ap));
console.log("faa", Object.keys(out).length, "airports", ap.length);
