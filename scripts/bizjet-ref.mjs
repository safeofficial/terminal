// weekly reference data: S&P 500 companies matched to FAA registrant names (by Mode S hex) · airports with ICAO codes + city
import fs from "node:fs";
const [, , master, apcsv, OUT, spcsv] = process.argv;
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
// listed companies only: FAA registrant name == S&P 500 company name (airlines · cargo · aircraft makers left out)
const pcsv = (s) => { const r = []; let q = false, f = ""; for (const ch of s) { if (ch === '"') q = !q; else if (ch === "," && !q) { r.push(f); f = ""; } else f += ch; } r.push(f); return r; };
const SUF = new Set(["INC","CORP","CO","COMPANY","CORPORATION","LLC","LTD","PLC","THE","INCORPORATED","NA","LP","HOLDINGS","GROUP","AVIATION","AIR","FLIGHT","DEPARTMENT","DEPT","SERVICES","SERVICE","TRANSPORTATION"]);
const nz = (s) => String(s).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !SUF.has(w)).join(" ");
const SEC = { "Industrials": "산업재", "Financials": "금융", "Energy": "에너지", "Utilities": "유틸리티", "Materials": "소재", "Consumer Staples": "필수소비재", "Consumer Discretionary": "경기소비재", "Health Care": "헬스케어", "Information Technology": "IT", "Real Estate": "부동산", "Communication Services": "통신" };
const EXC = new Set(["UAL","DAL","LUV","UPS","BA","TXT","FDXF","FDX","AAL","ALK","JBLU"]);
const ALIAS = { "EXXON MOBIL": "XOM" };
const sp = {}, byT = {};
if (spcsv && fs.existsSync(spcsv)) {
  const L = fs.readFileSync(spcsv, "utf8").split(/\r?\n/), H = pcsv(L[0]), iS = H.indexOf("Symbol"), iN = H.indexOf("Security"), iG = H.indexOf("GICS Sector");
  for (let i = 1; i < L.length; i++) { const c = pcsv(L[i]); if (!c[iS] || EXC.has(c[iS])) continue; const v = [c[iS], c[iN], SEC[c[iG]] || c[iG]]; sp[nz(c[iN])] = v; byT[c[iS]] = v; }
}
const pub = {}, fl = {};
for (const [hex, v] of Object.entries(out)) {
  const nm = v[0]; if (!nm || /^TRUST: /.test(nm)) continue;
  const k = nz(nm), m = (k.length >= 3 && sp[k]) || (ALIAS[k] && byT[ALIAS[k]]);
  if (!m) continue;
  const ex = /AVIATION|SERVICES? (CO )?LLC|SERVICE CO/.test(nm) ? 0 : 1;
  pub[hex] = [nm, m[0], m[1], m[2], ex];
  const f = fl[m[0]] || (fl[m[0]] = [m[0], m[1], m[2], 0, 0]); f[3]++; if (ex) f[4] = 1;
}
fs.writeFileSync(OUT + "/pub.json", JSON.stringify({ hex: pub, fleet: Object.values(fl).sort((a, b) => b[3] - a[3] || a[0].localeCompare(b[0])) }));
try { fs.unlinkSync(OUT + "/faa.json"); } catch {}
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
console.log("faa", Object.keys(out).length, "listed", Object.keys(pub).length, "airports", ap.length);
