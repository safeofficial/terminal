// ═══════════════════════════════════════════════════════════════
//  SAFE Terminal — company-data Edge Function
//
//  하는 일
//   · 국내 기업: DART(금융감독원 전자공시) 재무제표·공시·배당·지분
//   · 미국 기업: SEC EDGAR 재무제표·공시  (API 키 불필요, 공식·무료)
//   · 회사 목록을 Supabase 에 적재해 이름으로 검색할 수 있게 합니다
//
//  배포 (브라우저에서, CLI 필요 없음)
//   Supabase → Edge Functions → Deploy a new function → Via Editor
//   이름: company-data       ← 정확히 이 이름이어야 합니다
//   아래 코드를 통째로 붙여넣고 Deploy
//
//  ⚠️ DART 는 Edge Function 이 직접 호출할 수 없습니다.
//     DART 서버가 옛날 암호화(static RSA)만 지원하는데 Deno 는 그 방식을
//     지원하지 않기 때문입니다(HandshakeFailure). 그래서 DART 호출만
//     Postgres 를 거쳐 갑니다 — terminal-dart-우회.sql 을 먼저 실행하세요.
//
//  Secrets
//   DART_API_KEY  opendart.fss.or.kr 인증키 (40자리)
//   SEC_UA        (선택) SEC 가 요구하는 연락처.
//                 예: "SAFE Sogang club safe.official.sogang@gmail.com"
//                 비워두면 기본값을 쓰지만, 넣어두는 것을 권장합니다.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const CACHE_HOURS = 24;          // 재무·공시는 자주 바뀌지 않습니다

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
function secret(name: string) { return (Deno.env.get(name) ?? "").trim(); }

function dartKey() {
  const k = secret("DART_API_KEY");
  if (!k) throw new Error("DART_API_KEY 가 설정되지 않았습니다. Edge Functions → Secrets 에서 추가하세요.");
  return k;
}
function secHeaders() {
  return {
    "User-Agent": secret("SEC_UA") || "SAFE Terminal university finance club",
    "Accept-Encoding": "gzip, deflate",
  };
}

// ── DART 공통 호출 ────────────────────────────
//   Deno 의 fetch 로는 DART 에 붙지 못하므로 Postgres 통로를 씁니다.
let ADMIN: any = null;

async function dart(path: string, params: Record<string, string>) {
  const url = new URL("https://opendart.fss.or.kr/api/" + path);
  url.searchParams.set("crtfc_key", dartKey());
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

  const { data, error } = await ADMIN.rpc("dart_fetch", { p_url: url.toString() });
  if (error) {
    if (/function .*dart_fetch|does not exist/i.test(error.message)) {
      throw new Error("terminal-dart-우회.sql 을 아직 실행하지 않았습니다. "
                    + "이걸 실행해야 DART 조회가 됩니다.");
    }
    if (/http_get|extension/i.test(error.message)) {
      throw new Error("Supabase 에서 http 확장을 켜야 합니다. "
                    + "Database → Extensions → 'http' 검색 → Enable. (" + error.message + ")");
    }
    throw new Error("DART 호출 실패: " + error.message);
  }

  let d: any;
  try { d = JSON.parse(String(data ?? "")); }
  catch { throw new Error("DART 응답을 읽지 못했습니다: " + String(data ?? "").slice(0, 200)); }

  if (d.status === "013") return { list: [] };          // 조회된 데이터 없음 — 오류 아님
  if (d.status && d.status !== "000") {
    throw new Error(`DART 오류 (${d.status}): ${d.message ?? ""}`);
  }
  return d;
}

// ── 회사 목록 적재 ────────────────────────────
//   원래는 corpCode.xml(ZIP) 을 받으면 되지만, 그 파일은 이진 데이터라
//   Postgres 통로로는 온전히 못 가져옵니다. 대신 정기공시 목록을 훑어
//   상장사의 고유번호를 모읍니다 — 상장사는 1년에 최소 한 번은
//   사업보고서를 내므로 빠짐없이 수집됩니다.

/*  ── 국내 실시간 공시 ──

    SEC 실시간 공시의 한국판입니다. 방금 접수된 공시가 그대로 올라옵니다.
    학회가 한국 학회인데 미국 공시만 흐르면 이상하죠.

    공시 종류 이름이 '주요사항보고서(유상증자결정)' 처럼 그 자체로 설명이라
    따로 풀어줄 필요가 없습니다. 대신 눈여겨볼 것에는 표시를 답니다.        */
const DART_HOT =
  /(유상증자|무상증자|전환사채|신주인수권|자기주식|합병|분할|영업양수도|공개매수|상장폐지|관리종목|불성실공시|정정)/;

async function dartRecent(limit = 60) {
  const p = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const now = new Date();
  //  주말·공휴일이면 최근 공시가 며칠 전일 수 있어 닷새를 봅니다
  const bgn = p(new Date(now.getTime() - 5 * 864e5));
  const d = await dart("list.json", {
    bgn_de: bgn, end_de: p(now),
    page_no: "1", page_count: String(Math.min(100, Math.max(10, limit))),
    sort: "date", sort_mth: "desc",
  });
  const rows = (d.list ?? []).map((x: any) => {
    const nm = String(x.report_nm ?? "").trim();
    const rc = String(x.rcept_no ?? "");
    const t = String(x.rcept_dt ?? "");           //  YYYYMMDD
    return {
      code: "DART", source: "DART 공시",
      company: String(x.corp_name ?? "").trim(),
      form: nm,
      title: String(x.corp_name ?? "").trim() + " — " + nm,
      link: rc ? "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + rc : "",
      market: x.corp_cls === "Y" ? "유가증권" : (x.corp_cls === "K" ? "코스닥" : ""),
      at: /^\d{8}$/.test(t) ? `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T09:00:00+09:00` : null,
      tag: "공시", hot: DART_HOT.test(nm),
    };
  });
  return { items: rows, source: "DART 전자공시", at: new Date().toISOString() };
}

async function syncKrWindow(admin: any, bgn: string, end: string) {
  const seen = new Map<string, any>();
  let page = 1, totalPage = 1;

  while (page <= totalPage && page <= 60) {
    const d = await dart("list.json", {
      bgn_de: bgn, end_de: end, pblntf_ty: "A",
      page_no: String(page), page_count: "100",
      sort: "date", sort_mth: "desc",
    });
    totalPage = Number(d.total_page ?? 1) || 1;

    for (const x of (d.list ?? [])) {
      const stock = String(x.stock_code ?? "").trim();
      const cc = String(x.corp_code ?? "").trim();
      if (!/^\d{6}$/.test(stock) || !/^\d{8}$/.test(cc)) continue;
      if (seen.has(cc)) continue;
      seen.set(cc, {
        corp_code: cc,
        corp_name: String(x.corp_name ?? "").trim(),
        stock_code: stock,
        modify_date: String(x.rcept_dt ?? ""),
        updated_at: new Date().toISOString(),
      });
    }
    page++;
  }

  const rows = [...seen.values()];
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from("dart_corps")
      .upsert(rows.slice(i, i + 1000), { onConflict: "corp_code" });
    if (error) throw new Error("국내 기업목록 저장 실패: " + error.message);
  }
  return rows.length;
}

async function syncUsTickers(admin: any) {
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: secHeaders() });
  if (!r.ok) throw new Error(`SEC 티커 목록 실패 (${r.status}). SEC_UA 시크릿을 설정해 보세요.`);
  const d = await r.json();

  const seen = new Set<string>();
  const rows: any[] = [];
  for (const k of Object.keys(d)) {
    const o = d[k];
    const tk = String(o.ticker ?? "").toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    rows.push({
      ticker: tk,
      cik: String(o.cik_str).padStart(10, "0"),
      title: String(o.title ?? tk),
      updated_at: new Date().toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from("us_tickers")
      .upsert(rows.slice(i, i + 1000), { onConflict: "ticker" });
    if (error) throw new Error("미국 티커 저장 실패: " + error.message);
  }
  return rows.length;
}

// ── 국내 재무제표 ─────────────────────────────
//   사업보고서 한 번 호출로 당기·전기·전전기 3개년이 나옵니다.
//   두 번 호출해서 6개년을 만듭니다.
const KR_ITEMS: [string, RegExp][] = [
  ["revenue", /^(매출액|수익\(매출액\)|영업수익)$/],
  ["op",      /^영업이익(\(손실\))?$/],
  ["net",     /^당기순이익(\(손실\))?$/],
  ["assets",  /^자산총계$/],
  ["liab",    /^부채총계$/],
  ["equity",  /^자본총계$/],
];

function krMergeYear(out: any, year: number, key: string, amount: string) {
  const v = Number(String(amount ?? "").replace(/,/g, ""));
  if (!Number.isFinite(v)) return;
  out[year] = out[year] || { year };
  if (out[year][key] == null) out[year][key] = v;
}

async function krFinOnce(corpCode: string, year: number, out: any) {
  const d = await dart("fnlttSinglAcnt.json", {
    corp_code: corpCode, bsns_year: String(year), reprt_code: "11011",
  });
  const list = d.list ?? [];
  if (!list.length) return false;

  // 연결(CFS)이 있으면 연결을, 없으면 개별(OFS)을 씁니다
  const hasCfs = list.some((r: any) => r.fs_div === "CFS");
  const use = list.filter((r: any) => r.fs_div === (hasCfs ? "CFS" : "OFS"));

  for (const r of use) {
    const nm = String(r.account_nm ?? "").replace(/\s/g, "");
    const hit = KR_ITEMS.find(([, re]) => re.test(nm));
    if (!hit) continue;
    const key = hit[0];
    krMergeYear(out, year,     key, r.thstrm_amount);
    krMergeYear(out, year - 1, key, r.frmtrm_amount);
    krMergeYear(out, year - 2, key, r.bfefrmtrm_amount);
  }
  return true;
}

async function krFin(corpCode: string) {
  const now = new Date().getUTCFullYear();
  const out: any = {};
  let base = 0;
  for (const y of [now - 1, now - 2]) {          // 최신 사업보고서 찾기
    if (await krFinOnce(corpCode, y, out)) { base = y; break; }
  }
  if (!base) return { rows: [], note: "사업보고서를 찾지 못했습니다. (2015년 이후만 제공됩니다)" };
  await krFinOnce(corpCode, base - 3, out);      // 3년 더

  const rows = Object.values(out)
    .filter((r: any) => r.revenue != null || r.assets != null)
    .sort((a: any, b: any) => a.year - b.year);
  return { rows, unit: "원", basis: "연결 우선 · 사업보고서" };
}

// ── 국내 분기 재무제표 ────────────────────────
//   1~3분기는 각 보고서의 '당기 3개월' 금액을 그대로 쓰고,
//   4분기는 (연간 − 3분기 누적) 으로 계산합니다.
//   재무상태표(자산·부채·자본)는 각 시점의 잔액입니다.

function krPickRows(list: any[]) {
  if (!list.length) return [];
  const hasCfs = list.some((r: any) => r.fs_div === "CFS");
  return list.filter((r: any) => r.fs_div === (hasCfs ? "CFS" : "OFS"));
}
function krFind(rows: any[], key: string) {
  const item = KR_ITEMS.find(([k]) => k === key);
  if (!item) return null;
  return rows.find((r: any) => item[1].test(String(r.account_nm ?? "").replace(/\s/g, ""))) ?? null;
}
function toNum(v: any) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const IS_KEYS = ["revenue", "op", "net"];
const BS_KEYS = ["assets", "liab", "equity"];

async function krFinQuarter(corpCode: string) {
  const now = new Date().getUTCFullYear();
  const out: any = {};

  for (const y of [now, now - 1, now - 2]) {
    const rep: any = {};
    for (const [q, rc] of [["Q1", "11013"], ["Q2", "11012"], ["Q3", "11014"], ["Q4", "11011"]]) {
      const d = await dart("fnlttSinglAcnt.json", {
        corp_code: corpCode, bsns_year: String(y), reprt_code: rc,
      });
      const rows = krPickRows(d.list ?? []);
      if (rows.length) rep[q] = rows;
    }
    if (!Object.keys(rep).length) continue;

    for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
      const label = y + " " + q;
      const rows = rep[q];
      if (!rows) continue;
      const row: any = { year: y, q: Number(q[1]), label };

      /*  손익 계정은 보고서마다 '올해 누적' 으로 실립니다.
          그대로 쓰면 4분기 자리에 1년치가 들어앉습니다 — 누적끼리 뺍니다.
          (위 krResolveQuarters 와 같은 규칙입니다)                        */
      for (const k of IS_KEYS) {
        const cumOf = (qq: string) => {
          const hit = krFind(rep[qq] ?? [], k);
          if (!hit) return null;
          return qq === "Q4"
            ? toNum(hit.thstrm_amount)                       // 사업보고서 = 1년치
            : (toNum(hit.thstrm_add_amount) ?? toNum(hit.thstrm_amount));
        };
        const ownOf = (qq: string) => {
          const hit = krFind(rep[qq] ?? [], k);
          if (!hit) return null;
          const a = toNum(hit.thstrm_amount), c = toNum(hit.thstrm_add_amount);
          if (qq === "Q1") return c ?? a;                    // 1분기는 누적 = 3개월
          if (qq === "Q4") return null;
          return (a != null && c != null && a !== c) ? a : null;   // 회사가 따로 적어냄
        };
        const own = ownOf(q);
        if (own != null) { row[k] = own; continue; }
        const here = cumOf(q);
        if (here == null) { row[k] = null; continue; }
        if (q === "Q1") { row[k] = here; continue; }
        const prev = cumOf("Q" + (Number(q[1]) - 1));
        row[k] = (prev == null) ? null : here - prev;
      }
      for (const k of BS_KEYS) row[k] = toNum(krFind(rows, k)?.thstrm_amount);

      if (IS_KEYS.some((k) => row[k] != null) || BS_KEYS.some((k) => row[k] != null)) {
        out[label] = row;
      }
    }
  }

  const rows = Object.values(out).sort((a: any, b: any) =>
    a.year - b.year || a.q - b.q);
  if (!rows.length) return { rows: [], note: "분기 보고서를 찾지 못했습니다." };
  return { rows, unit: "원", basis: "연결 우선 · 분기보고서" };
}

// ── 미국 재무제표 (SEC XBRL) ──────────────────
const US_ITEMS: [string, string[], string][] = [
  /*  매출 태그는 회사마다 다릅니다. 여기 목록이 아래 전체 재무제표용보다
      좁아서, 엔비디아처럼 'IncludingAssessedTax' 로 적는 회사는 요약 타일의
      매출액이 빈칸으로 나왔습니다 (영업이익·순이익은 나오는데 매출만 —).
      두 목록을 같은 넓이로 맞춥니다.                                      */
  ["revenue", ["RevenueFromContractWithCustomerExcludingAssessedTax",
               "RevenueFromContractWithCustomerIncludingAssessedTax",
               "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
               "SalesRevenueServicesNet", "TotalRevenuesAndOtherIncome",
               "RevenuesNetOfInterestExpense",
               "RegulatedAndUnregulatedOperatingRevenue"], "USD"],
  ["op",      ["OperatingIncomeLoss"], "USD"],
  ["net",     ["NetIncomeLoss"], "USD"],
  ["assets",  ["Assets"], "USD"],
  ["liab",    ["Liabilities"], "USD"],
  ["equity",  ["StockholdersEquity"], "USD"],
  ["eps",     ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares"],
  ["dps",     ["CommonStockDividendsPerShareDeclared"], "USD/shares"],
];

async function secConcept(cik: string, tag: string, unit: string) {
  const r = await fetch(
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`,
    { headers: secHeaders() },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`SEC 조회 실패 (${r.status}). SEC_UA 시크릿을 설정해 보세요.`);
  const d = await r.json();
  const arr = d?.units?.[unit];
  return Array.isArray(arr) && arr.length ? arr : null;
}

async function usFin(cik: string) {
  const out: any = {};
  for (const [key, tags, unit] of US_ITEMS) {
    let arr: any[] | null = null;
    for (const t of tags) { arr = await secConcept(cik, t, unit); if (arr) break; }
    if (!arr) continue;

    const best: Record<string, any> = {};
    for (const o of arr) {
      if (o.form !== "10-K") continue;
      if (o.start) {                                   // 기간 개념은 1년치만
        const days = (Date.parse(o.end) - Date.parse(o.start)) / 864e5;
        if (days < 300 || days > 400) continue;
      }
      const y = String(o.end).slice(0, 4);
      if (!best[y] || String(o.filed) > String(best[y].filed)) best[y] = o;
    }
    for (const y of Object.keys(best)) {
      const yr = Number(y);
      out[yr] = out[yr] || { year: yr };
      out[yr][key] = Number(best[y].val);
    }
  }
  const rows = Object.values(out)
    .sort((a: any, b: any) => a.year - b.year)
    .slice(-8);
  return { rows, unit: "USD", basis: "10-K (SEC XBRL)" };
}

// 미국 분기: 10-Q 의 3개월 수치를 모으고, 4분기는 (연간 − 1~3분기) 로 계산
async function usFinQuarter(cik: string) {
  const out: any = {};
  const annual: any = {};

  for (const [key, tags, unit] of US_ITEMS) {
    if (key === "eps" || key === "dps") continue;
    let arr: any[] | null = null;
    for (const t of tags) { arr = await secConcept(cik, t, unit); if (arr) break; }
    if (!arr) continue;

    const isFlow = IS_KEYS.indexOf(key) >= 0;
    for (const o of arr) {
      const end = String(o.end);
      const y = Number(end.slice(0, 4));
      const q = Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
      const label = y + " Q" + q;

      if (o.start) {
        const days = (Date.parse(o.end) - Date.parse(o.start)) / 864e5;
        if (days >= 300 && days <= 400) {                 // 연간
          if (isFlow) {
            annual[y] = annual[y] || {};
            if (annual[y][key] == null || String(o.filed) > String(annual[y].filed ?? ""))
              annual[y][key] = Number(o.val);
          }
          continue;
        }
        if (days < 60 || days > 120) continue;            // 분기 아님
      } else if (isFlow) {
        continue;                                          // 손익은 기간값만
      }
      out[label] = out[label] || { year: y, q: q, label: label };
      if (out[label][key] == null) out[label][key] = Number(o.val);
    }
  }

  // 4분기 보정
  for (const y of Object.keys(annual)) {
    const yr = Number(y);
    for (const k of IS_KEYS) {
      const tot = annual[y][k];
      if (tot == null) continue;
      const q4 = yr + " Q4";
      if (out[q4] && out[q4][k] != null) continue;
      const parts = [1, 2, 3].map((i) => out[yr + " Q" + i] && out[yr + " Q" + i][k]);
      if (parts.some((v) => v == null)) continue;
      out[q4] = out[q4] || { year: yr, q: 4, label: q4 };
      out[q4][k] = tot - parts.reduce((a: number, b: any) => a + Number(b), 0);
    }
  }

  const rows = Object.values(out)
    .sort((a: any, b: any) => a.year - b.year || a.q - b.q)
    .slice(-16);
  if (!rows.length) return { rows: [], note: "분기 자료를 찾지 못했습니다." };
  return { rows, unit: "USD", basis: "10-Q · 10-K (SEC XBRL)" };
}

// ── 전체 재무제표 (국내) ──────────────────────
//   fnlttSinglAcntAll 은 손익계산서·재무상태표·현금흐름표의
//   모든 계정을 돌려줍니다. 한 번 호출로 3개년이 나오므로
//   두 번 부르면 6개년이 됩니다.

/*  재무제표 표의 '판' 번호.
    줄 이름·순서·계산 규칙을 바꿀 때마다 올리세요. 캐시가 알아서 갈립니다.  */
const FIN_SCHEMA = "v4";

//  분기 화면에 몇 개를 보여줄지 (12 = 3년)
const KR_QUARTERS = 12;

const SJ_NAME: Record<string, string> = {
  BS:  "재무상태표",
  IS:  "손익계산서",
  CIS: "포괄손익계산서",
  CF:  "현금흐름표",
};

//  같은 계정을 한 줄로 모으기 위한 열쇠.
//
//    DART 의 account_nm 은 회사가 보고서에 적어 넣은 그대로라
//    "투자활동 현금흐름" / "투자활동현금흐름" 처럼 띄어쓰기가
//    해마다 달라집니다. 이름 그대로 묶으면 같은 계정이 두 줄로
//    갈라져서 표 중간이 —— 로 비어 보입니다.
//    표준계정코드(account_id)가 있으면 그것을 쓰고,
//    없으면 공백을 지운 이름으로 묶습니다.
function krAcctKey(r: any) {
  const id = String(r.account_id ?? "").trim();
  if (id && !/미사용/.test(id) && id !== "-") return "id:" + id;
  return "nm:" + String(r.account_nm ?? "").replace(/\s+/g, "");
}

const KR_REPRT: Record<string, string> = {
  "1": "11013", "2": "11012", "3": "11014", "4": "11011",
};

//  한 번의 보고서 조회로 여러 기간을 채웁니다.
//    period='annual'  → 사업보고서 (당기·전기·전전기 3년)
//    period='quarter' → 분기·반기보고서 (해당 분기 하나)
/*  ── 분기 값을 어떻게 얻는가 ──

    DART 의 분기·반기 보고서는 손익·현금흐름을 '그 해 1월부터 지금까지의
    누적' 으로 싣습니다. 사업보고서(4분기 자리)는 아예 1년치입니다.
    그래서 보고서 숫자를 그대로 분기 값으로 쓰면 4분기 칸에 연간 매출이
    들어앉습니다 — 삼성전자 25년 4분기가 93.8조가 아니라 330조로 보이던
    것이 이것입니다.

    올바른 방법은 누적끼리 빼는 것입니다:
      1분기 = 1분기 누적
      2분기 = 반기 누적   − 1분기 누적
      3분기 = 3분기 누적  − 반기 누적
      4분기 = 연간        − 3분기 누적
    회사가 3개월치를 따로 적어냈으면(thstrm_amount 가 누적과 다르면)
    그 값을 그대로 씁니다 — 회사가 낸 숫자가 우리 계산보다 낫습니다.

    재무상태표는 '그 시점 잔액' 이라 빼면 안 됩니다. 그대로 씁니다.       */
const KR_FLOW = new Set(["IS", "CIS", "CF"]);

function krToNum(v: any) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

//  모아둔 누적·자체보고 값에서 분기 값을 만들어 냅니다
function krResolveQuarters(acc: any) {
  for (const key of Object.keys(acc)) {
    const r = acc[key];
    if (!r.cum && !r.own) continue;
    const cum = r.cum || {}, own = r.own || {};
    for (const yq of Object.keys(cum).concat(Object.keys(own))) {
      const m = yq.match(/^(\d{4})Q(\d)$/);
      if (!m) continue;
      const y = m[1], q = Number(m[2]);
      if (r.values[yq] != null) continue;

      //  ① 회사가 3개월치를 따로 적어냈으면 그대로
      if (own[yq] != null) { r.values[yq] = own[yq]; continue; }
      //  ② 아니면 누적끼리 뺍니다
      const here = cum[yq];
      if (here == null) continue;
      if (q === 1) { r.values[yq] = here; continue; }
      const prev = cum[y + "Q" + (q - 1)];
      if (prev == null) continue;              // 앞 누적이 없으면 비워둡니다
      r.values[yq] = here - prev;
    }
    delete r.cum; delete r.own;
  }
}

async function krFullOnce(corpCode: string, year: number, acc: any,
                          quarter = 0, fsHint: string[] = ["CFS", "OFS"]) {
  const reprt = quarter ? KR_REPRT[String(quarter)] : "11011";
  let list: any[] = [];
  let used = "";
  for (const fs of fsHint) {                      // 연결 우선, 없으면 개별
    const d = await dart("fnlttSinglAcntAll.json", {
      corp_code: corpCode, bsns_year: String(year),
      reprt_code: reprt, fs_div: fs,
    });
    if ((d.list ?? []).length) { list = d.list; used = fs; break; }
  }
  if (!list.length) return "";

  for (const r of list) {
    const sj = String(r.sj_div ?? "").toUpperCase();
    if (!SJ_NAME[sj]) continue;
    const nm = String(r.account_nm ?? "").trim();
    if (!nm) continue;

    const key = sj + "|" + krAcctKey(r);
    const aid = String(r.account_id ?? "").trim();
    acc[key] = acc[key] || {
      sj, name: nm, ord: Number(r.ord ?? 9999), values: {}, cum: {}, own: {},
      acct_id: (aid && !/미사용/.test(aid) && aid !== "-") ? aid : "",
    };
    const put = (pk: string, v: any) => {
      const n = Number(String(v ?? "").replace(/,/g, ""));
      if (Number.isFinite(n) && acc[key].values[pk] == null) acc[key].values[pk] = n;
    };

    if (quarter) {
      const pk = year + "Q" + quarter;
      if (!KR_FLOW.has(sj)) {
        //  재무상태표 — 그 시점 잔액이라 그대로
        put(pk, r.thstrm_amount);
      } else {
        const amt = krToNum(r.thstrm_amount);
        const add = krToNum(r.thstrm_add_amount);
        //  4분기(사업보고서)에는 누적칸이 없습니다 — 당기금액이 곧 1년치입니다
        const cumV = (quarter === 4) ? amt : (add ?? amt);
        if (cumV != null && acc[key].cum[pk] == null) acc[key].cum[pk] = cumV;
        //  당기금액이 누적과 다르면 회사가 3개월치를 따로 적어낸 것입니다
        if (quarter !== 4 && amt != null && add != null && amt !== add
            && acc[key].own[pk] == null) acc[key].own[pk] = amt;
        //  1분기는 누적 = 3개월
        if (quarter === 1 && cumV != null && acc[key].own[pk] == null)
          acc[key].own[pk] = cumV;
      }
    } else {
      put(String(year),     r.thstrm_amount);
      put(String(year - 1), r.frmtrm_amount);
      put(String(year - 2), r.bfefrmtrm_amount);
    }
  }
  return used;
}

function krPeriods(keys: string[]) {
  return keys.map((k) => {
    const m = k.match(/^(\d{4})Q(\d)$/);
    if (m) {
      const y = Number(m[1]), q = Number(m[2]);
      return { key: k, label: String(y).slice(2) + "' " + q + "Q",
               end: y + "-" + ["03-31", "06-30", "09-30", "12-31"][q - 1] };
    }
    return { key: k, label: k + "년", end: k + "-12-31" };
  });
}

/*  국내 발행주식수 — DART '주식의 총수 현황'.

    재무제표에는 주식 수가 안 들어 있습니다. 별도 공시라 따로 부릅니다.
    유통주식수 = 발행주식총수 − 자기주식. 밸류에이션에는 이쪽이 맞습니다
    (자기주식은 배당도 의결권도 없으니 주주 몫을 나눌 때 빼야 합니다).   */
async function krShareCount(corpCode: string) {
  const now = new Date().getUTCFullYear();
  for (const y of [now, now - 1, now - 2]) {
    for (const rc of ["11011", "11014", "11012", "11013"]) {
      let d: any = null;
      try {
        d = await dart("stockTotqySttus.json", {
          corp_code: corpCode, bsns_year: String(y), reprt_code: rc,
        });
      } catch { continue; }
      const rows = d?.list ?? [];
      if (!Array.isArray(rows) || !rows.length) continue;

      const num = (v: any) => {
        const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
        return Number.isFinite(n) ? n : null;
      };
      //  '보통주' 줄을 먼저, 없으면 '합계'
      const hit = rows.find((r: any) => /보통주/.test(String(r?.se ?? "")))
               ?? rows.find((r: any) => /합계/.test(String(r?.se ?? "")))
               ?? rows[0];
      if (!hit) continue;

      const issued = num(hit.isu_stock_totqy);
      const treasury = num(hit.tesstk_co) ?? 0;
      const distb = num(hit.distb_stock_co);

      if (distb && distb > 0)
        return { value: distb, as_of: y + " " + (rc === "11011" ? "사업보고서" : "분기보고서"),
                 basis: "유통주식수 (발행 − 자기주식)" };
      if (issued && issued > 0)
        return { value: Math.max(0, issued - treasury), as_of: String(y),
                 basis: treasury ? "유통주식수 (발행 − 자기주식)" : "발행주식총수" };
    }
  }
  return null;
}

async function krFinFull(corpCode: string, period = "annual") {
  const now = new Date().getUTCFullYear();
  const acc: any = {};

  if (period === "quarter") {
    /*  최근 분기부터 거슬러 올라가며 12개를 채웁니다.
        6개만 받으면 재작년 칸이 통째로 비어 보입니다 — 표에는 열이 있는데
        막대가 없던 것이 이것입니다.
        4분기를 계산하려면 같은 해 3분기 누적이 있어야 하므로, 끊기지 않게
        한 분기 더 받아둡니다.                                            */
    let fs: string[] = ["CFS", "OFS"];
    let got = 0, tried = 0;
    const nowQ = Math.floor(new Date().getUTCMonth() / 3) + 1;
    let y = now, q = nowQ;
    for (let i = 0; i < 18 && got < KR_QUARTERS + 1; i++) {
      q -= 1;
      if (q < 1) { q = 4; y -= 1; }
      tried++;
      const used = await krFullOnce(corpCode, y, acc, q, fs);
      if (used) { got++; fs = [used]; }          // 한 번 정해지면 같은 기준으로
      else if (tried > 3 && got === 0) break;    // 아예 없는 회사면 일찍 포기
    }
    if (!got) {
      return { statements: {}, periods: [],
               note: "분기 보고서를 찾지 못했습니다. 연간으로 보시거나 잠시 후 다시 시도해주세요." };
    }
    krResolveQuarters(acc);
  } else {
    let base = 0;
    for (const y of [now - 1, now - 2]) {
      if (await krFullOnce(corpCode, y, acc)) { base = y; break; }
    }
    if (!base) {
      return { statements: {}, periods: [],
               note: "사업보고서를 찾지 못했습니다. (2015년 이후만 제공됩니다)" };
    }
    await krFullOnce(corpCode, base - 3, acc);
  }

  const keys = new Set<string>();
  Object.values(acc).forEach((r: any) => Object.keys(r.values).forEach((k) => keys.add(k)));
  //  계산에만 쓰려고 한 분기 더 받아둔 것은 화면에서 잘라냅니다
  const kl = (period === "quarter")
    ? [...keys].sort().slice(-KR_QUARTERS)
    : [...keys].sort();
  if (period === "quarter") {
    const keep = new Set(kl);
    Object.values(acc).forEach((r: any) => {
      Object.keys(r.values).forEach((k) => { if (!keep.has(k)) delete r.values[k]; });
    });
  }

  const statements: any = {};
  for (const r of Object.values(acc) as any[]) {
    const g = SJ_NAME[r.sj];
    statements[g] = statements[g] || [];
    statements[g].push({ name: r.name, ord: r.ord, values: r.values,
                         acct_id: r.acct_id });
  }
  Object.keys(statements).forEach((g) => {
    statements[g].sort((a: any, b: any) => a.ord - b.ord);
    statements[g] = krLayout(g, statements[g]);
  });

  return { statements, periods: krPeriods(kl), unit: "원", schema: FIN_SCHEMA,
           shares: await krShareCount(corpCode).catch(() => null),
           basis: (period === "quarter" ? "분기보고서" : "사업보고서") + " · 연결 우선" };
}

/*  국내 재무제표를 미국과 같은 골격으로 다시 세웁니다.

    DART 가 주는 순서(ord)는 회사·보고서마다 제각각이라, 그대로 쓰면
    매출액이 표 맨 아래에 오는 일이 생깁니다. 실제로 그랬습니다.
    그래서 '재무제표를 읽는 순서' 를 우리가 정해두고 거기에 끼워 맞춥니다 —
    미국 표와 줄 이름·순서·들여쓰기가 같아지고, 어느 회사를 열어도 똑같습니다.

    [ 표시이름, 깊이, 소계여부, account_id 들, 이름(공백 뺀) 들 ]
    account_id 를 먼저 봅니다 (IFRS 표준코드라 회사가 달라도 같습니다).
    표준코드를 안 쓴 회사는 계정 이름으로 찾습니다.                        */
type KrRow = [string, number, boolean, string[], string[]];

const KR_LAYOUT: Record<string, KrRow[]> = {
  "손익계산서": [
    ["매출액", 0, true,
      ["ifrs-full_Revenue", "ifrs_Revenue"],
      ["매출액", "수익(매출액)", "영업수익", "매출", "수익"]],
    ["매출원가", 0, false,
      ["ifrs-full_CostOfSales", "ifrs_CostOfSales"],
      ["매출원가", "영업비용"]],
    ["매출총이익", 0, true,
      ["ifrs-full_GrossProfit", "ifrs_GrossProfit"],
      ["매출총이익", "매출총이익(손실)"]],
    ["판매비와관리비", 0, false,
      ["dart_TotalSellingGeneralAdministrativeExpenses",
       "ifrs-full_SellingGeneralAndAdministrativeExpense"],
      ["판매비와관리비", "판매비와일반관리비"]],
    ["연구개발비", 1, false,
      ["dart_ResearchAndDevelopmentExpense", "ifrs-full_ResearchAndDevelopmentExpense"],
      ["연구개발비", "경상연구개발비"]],
    ["영업이익", 0, true,
      ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
      ["영업이익", "영업이익(손실)", "영업손익"]],
    ["금융수익", 1, false, ["ifrs-full_FinanceIncome"], ["금융수익"]],
    ["금융비용", 1, false, ["ifrs-full_FinanceCosts"], ["금융비용", "금융원가"]],
    ["기타수익", 1, false, ["ifrs-full_OtherIncome"], ["기타수익", "기타영업외수익"]],
    ["기타비용", 1, false, ["ifrs-full_OtherExpenseByFunction"], ["기타비용", "기타영업외비용"]],
    ["지분법손익", 1, false,
      ["ifrs-full_ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod"],
      ["지분법이익", "지분법손익", "관계기업투자손익"]],
    ["법인세차감전이익", 0, true,
      ["ifrs-full_ProfitLossBeforeTax"],
      ["법인세비용차감전순이익", "법인세비용차감전순이익(손실)", "법인세차감전순이익"]],
    ["법인세비용", 0, false,
      ["ifrs-full_IncomeTaxExpenseContinuingOperations"],
      ["법인세비용", "법인세수익(비용)"]],
    ["당기순이익", 0, true,
      ["ifrs-full_ProfitLoss"],
      ["당기순이익", "당기순이익(손실)", "분기순이익", "반기순이익", "당기순손익"]],
    ["지배주주 순이익", 1, false,
      ["ifrs-full_ProfitLossAttributableToOwnersOfParent"],
      ["지배기업의소유주에게귀속되는당기순이익", "지배회사지분반기순이익",
       "지배기업소유주지분", "지배주주지분"]],
    ["비지배주주 순이익", 1, false,
      ["ifrs-full_ProfitLossAttributableToNoncontrollingInterests"],
      ["비지배지분", "비지배주주지분", "비지배지분순이익"]],
    ["기본주당이익", 0, false,
      ["ifrs-full_BasicEarningsLossPerShare"], ["기본주당이익", "기본주당이익(손실)"]],
    ["희석주당이익", 0, false,
      ["ifrs-full_DilutedEarningsLossPerShare"], ["희석주당이익", "희석주당이익(손실)"]],
  ],
  "재무상태표": [
    ["자산총계", 0, true, ["ifrs-full_Assets"], ["자산총계"]],
    ["유동자산", 1, true, ["ifrs-full_CurrentAssets"], ["유동자산"]],
    ["현금성자산", 2, false,
      ["ifrs-full_CashAndCashEquivalents"], ["현금및현금성자산", "현금성자산"]],
    ["단기금융상품", 2, false, ["dart_ShortTermDepositsNotClassifiedAsCashEquivalents"],
      ["단기금융상품"]],
    ["매출채권", 2, false, ["ifrs-full_TradeAndOtherCurrentReceivables"],
      ["매출채권", "매출채권및기타채권", "매출채권및기타유동채권"]],
    ["재고자산", 2, false, ["ifrs-full_Inventories"], ["재고자산"]],
    ["비유동자산", 1, true, ["ifrs-full_NoncurrentAssets"], ["비유동자산"]],
    ["유형자산", 2, false, ["ifrs-full_PropertyPlantAndEquipment"], ["유형자산"]],
    ["무형자산", 2, false, ["ifrs-full_IntangibleAssetsOtherThanGoodwill"],
      ["무형자산", "영업권및무형자산"]],
    ["부채총계", 0, true, ["ifrs-full_Liabilities"], ["부채총계"]],
    ["유동부채", 1, true, ["ifrs-full_CurrentLiabilities"], ["유동부채"]],
    ["매입채무", 2, false, ["ifrs-full_TradeAndOtherCurrentPayables"],
      ["매입채무", "매입채무및기타채무", "매입채무및기타유동채무"]],
    ["단기차입금", 2, false, ["ifrs-full_ShorttermBorrowings"], ["단기차입금"]],
    ["비유동부채", 1, true, ["ifrs-full_NoncurrentLiabilities"], ["비유동부채"]],
    ["장기차입금", 2, false, ["ifrs-full_LongtermBorrowings"],
      ["장기차입금", "사채", "장기성부채"]],
    ["자본총계", 0, true, ["ifrs-full_Equity"], ["자본총계"]],
    ["자본금", 1, false, ["ifrs-full_IssuedCapital"], ["자본금"]],
    ["이익잉여금", 1, false, ["ifrs-full_RetainedEarnings"],
      ["이익잉여금", "이익잉여금(결손금)"]],
    ["지배주주지분", 1, false, ["ifrs-full_EquityAttributableToOwnersOfParent"],
      ["지배기업의소유주에게귀속되는지분", "지배기업소유주지분"]],
    ["비지배지분", 1, false, ["ifrs-full_NoncontrollingInterests"], ["비지배지분"]],
  ],
  "현금흐름표": [
    ["영업활동 현금흐름", 0, true,
      ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
      ["영업활동현금흐름", "영업활동으로인한현금흐름"]],
    ["감가상각비", 1, false,
      ["ifrs-full_DepreciationExpense", "ifrs-full_DepreciationAndAmortisationExpense"],
      ["감가상각비", "감가상각비및무형자산상각비"]],
    ["투자활동 현금흐름", 0, true,
      ["ifrs-full_CashFlowsFromUsedInInvestingActivities"],
      ["투자활동현금흐름", "투자활동으로인한현금흐름"]],
    ["유형자산 취득", 1, false,
      ["ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
      ["유형자산의취득", "유형자산의증가"]],
    ["재무활동 현금흐름", 0, true,
      ["ifrs-full_CashFlowsFromUsedInFinancingActivities"],
      ["재무활동현금흐름", "재무활동으로인한현금흐름"]],
    ["배당금 지급", 1, false,
      ["ifrs-full_DividendsPaidClassifiedAsFinancingActivities"],
      ["배당금지급", "배당금의지급"]],
    ["기말 현금", 0, true,
      ["ifrs-full_CashAndCashEquivalents"],
      ["기말의현금및현금성자산", "기말현금및현금성자산"]],
  ],
};

//  포괄손익계산서는 손익계산서와 같은 틀을 씁니다
KR_LAYOUT["포괄손익계산서"] = KR_LAYOUT["손익계산서"];

function krNorm(x: string) { return String(x ?? "").replace(/\s+/g, ""); }

/*  DART 가 준 계정들을 위 골격에 끼워 맞춥니다.
    골격에 없는 계정은 버리지 않고 '그 밖의 계정' 아래에 그대로 답니다 —
    회사가 실제로 낸 줄을 잃지 않기 위해서입니다.                        */
function krLayout(group: string, rows: any[]) {
  const layout = KR_LAYOUT[group];
  if (!layout) return rows;

  const byId: Record<string, any> = {};
  const byNm: Record<string, any> = {};
  for (const r of rows) {
    if (r.acct_id) byId[r.acct_id] = byId[r.acct_id] ?? r;
    const n = krNorm(r.name);
    if (!byNm[n]) byNm[n] = r;
  }

  const out: any[] = [];
  const used = new Set<any>();
  let ord = 0;

  for (const [label, depth, emph, ids, names] of layout) {
    let hit: any = null;
    for (const id of ids) if (byId[id]) { hit = byId[id]; break; }
    if (!hit) for (const nm of names) if (byNm[krNorm(nm)]) { hit = byNm[krNorm(nm)]; break; }
    if (!hit || used.has(hit)) continue;
    used.add(hit);
    out.push({ name: label, ord: ord++, values: hit.values,
               depth, emphasis: emph, kr_name: hit.name });
  }

  const extra = rows.filter((r) => !used.has(r));
  if (extra.length) {
    out.push({ name: "그 밖의 계정", ord: ord++, values: {}, depth: 0, emphasis: false });
    for (const r of extra) {
      out.push({ name: r.name, ord: ord++, values: r.values, depth: 1, emphasis: false });
    }
  }
  return out;
}

// ── 전체 재무제표 (미국) ──────────────────────
//   companyfacts 한 번으로 필요한 계정을 모두 뽑습니다.
//  [ 재무제표, 표시이름, us-gaap 태그들, 들여쓰기 깊이, 소계 여부 ]
//  순서와 깊이는 실제 재무제표를 읽는 순서 그대로 둡니다.
//  실제 재무제표를 읽는 순서 그대로 — 총계가 먼저 오고 그 아래로 들여씁니다.
//  [ 재무제표, 표시이름, us-gaap 태그들, 들여쓰기 깊이, 소계 여부 ]
const US_STATEMENTS: [string, string, string[], number, boolean][] = [
  // ── 손익계산서 ──
  ["손익계산서", "매출액", [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet",
    "TotalRevenuesAndOtherIncome", "RevenuesNetOfInterestExpense",
    "RegulatedAndUnregulatedOperatingRevenue"], 0, true],
  ["손익계산서", "매출원가", [
    "CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold",
    "CostOfServices", "CostOfSales"], 0, false],
  ["손익계산서", "매출총이익",      ["GrossProfit"], 0, true],
  ["손익계산서", "영업비용", [
    "OperatingExpenses", "CostsAndExpenses"], 0, false],
  ["손익계산서", "연구개발비",      ["ResearchAndDevelopmentExpense"], 1, false],
  ["손익계산서", "판매관리비", [
    "SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense",
    "SellingAndMarketingExpense"], 1, false],
  ["손익계산서", "영업이익",        ["OperatingIncomeLoss"], 0, true],
  ["손익계산서", "영업외손익", [
    "NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"], 0, false],
  ["손익계산서", "이자비용", [
    "InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet"], 1, false],
  ["손익계산서", "세전이익", [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], 0, true],
  ["손익계산서", "법인세",          ["IncomeTaxExpenseBenefit"], 0, false],
  ["손익계산서", "당기순이익", [
    "NetIncomeLoss", "ProfitLoss",
    "NetIncomeLossAvailableToCommonStockholdersBasic"], 0, true],
  ["손익계산서", "EPS (희석)",      ["EarningsPerShareDiluted", "EarningsPerShareBasic"], 0, false],

  // ── 재무상태표 : 총계 → 그 아래 항목 ──
  ["재무상태표", "자산총계",        ["Assets"], 0, true],
  ["재무상태표", "유동자산",        ["AssetsCurrent"], 1, true],
  ["재무상태표", "현금성자산", [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], 2, false],
  ["재무상태표", "단기투자자산", [
    "ShortTermInvestments", "MarketableSecuritiesCurrent",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], 2, false],
  ["재무상태표", "매출채권", [
    "AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], 2, false],
  ["재무상태표", "재고자산",        ["InventoryNet"], 2, false],
  ["재무상태표", "비유동자산",      ["AssetsNoncurrent"], 1, true],
  ["재무상태표", "유형자산", [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"], 2, false],
  ["재무상태표", "영업권",          ["Goodwill"], 2, false],
  ["재무상태표", "무형자산", [
    "IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], 2, false],
  ["재무상태표", "부채총계",        ["Liabilities"], 0, true],
  ["재무상태표", "유동부채",        ["LiabilitiesCurrent"], 1, true],
  ["재무상태표", "매입채무", [
    "AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"], 2, false],
  ["재무상태표", "단기차입금", [
    "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"], 2, false],
  ["재무상태표", "비유동부채",      ["LiabilitiesNoncurrent"], 1, true],
  ["재무상태표", "장기차입금", [
    "LongTermDebtNoncurrent", "LongTermDebt"], 2, false],
  ["재무상태표", "자본총계", [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], 0, true],
  ["재무상태표", "자본금·자본잉여금", [
    "AdditionalPaidInCapital", "CommonStocksIncludingAdditionalPaidInCapital"], 1, false],
  ["재무상태표", "이익잉여금",      ["RetainedEarningsAccumulatedDeficit"], 1, false],

  // ── 현금흐름표 : 영업 → 투자 → 재무 ──
  ["현금흐름표", "영업활동 현금흐름", [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], 0, true],
  ["현금흐름표", "감가상각비", [
    "DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization", "Depreciation"], 1, false],
  ["현금흐름표", "주식보상비용",     ["ShareBasedCompensation"], 1, false],
  ["현금흐름표", "투자활동 현금흐름", [
    "NetCashProvidedByUsedInInvestingActivities",
    "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"], 0, true],
  ["현금흐름표", "설비투자 (CAPEX)", [
    "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], 1, false],
  ["현금흐름표", "재무활동 현금흐름", [
    "NetCashProvidedByUsedInFinancingActivities",
    "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"], 0, true],
  ["현금흐름표", "배당 지급", [
    "PaymentsOfDividendsCommonStock", "PaymentsOfDividends",
    "PaymentsOfDividendsMinorityInterest"], 1, false],
  ["현금흐름표", "자사주 매입",      ["PaymentsForRepurchaseOfCommonStock"], 1, false],
];

/*  회사가 직접 태그하지 않은 계정은 다른 계정에서 계산해 채웁니다.

    이게 없으면 표 한복판이 뻥 뚫립니다. 예를 들어 '부채총계(Liabilities)'는
    태그를 아예 안 쓰는 회사가 많은데, 자산총계 − 자본총계면 정확히 같은 값입니다.
    [ 재무제표, 만들 계정, 계산식(있는 계정들로) ]                                */
const US_DERIVED: [string, string, string[], (v: number[]) => number][] = [
  ["손익계산서", "매출총이익", ["매출액", "매출원가"], (v) => v[0] - Math.abs(v[1])],
  ["손익계산서", "세전이익",   ["영업이익", "영업외손익"], (v) => v[0] + v[1]],
  ["손익계산서", "당기순이익", ["세전이익", "법인세"], (v) => v[0] - Math.abs(v[1])],
  ["재무상태표", "부채총계",   ["자산총계", "자본총계"], (v) => v[0] - v[1]],
  ["재무상태표", "자본총계",   ["자산총계", "부채총계"], (v) => v[0] - v[1]],
  ["재무상태표", "비유동자산", ["자산총계", "유동자산"], (v) => v[0] - v[1]],
  ["재무상태표", "비유동부채", ["부채총계", "유동부채"], (v) => v[0] - v[1]],
  ["현금흐름표", "잉여현금흐름", ["영업활동 현금흐름", "설비투자 (CAPEX)"],
    (v) => v[0] - Math.abs(v[1])],
];

//  잉여현금흐름은 원래 표에 없는 줄이라 어디에 끼울지 따로 적어둡니다
const US_EXTRA_ROW: Record<string, { depth: number; emphasis: boolean; after: string }> = {
  "잉여현금흐름": { depth: 0, emphasis: true, after: "설비투자 (CAPEX)" },
};

//  10-K 뿐 아니라 수정본과 외국기업 서식도 받습니다 (안 그러면 해가 통째로 빕니다)
const US_ANNUAL_FORM = /^(10-K|20-F|40-F)/;
const US_QUARTER_FORM = /^(10-Q|10-K|20-F|40-F)/;

//  us-gaap 에 없으면 ifrs-full, dei 도 봅니다 (외국 상장사 · 표지 정보)
function usUnits(facts: any, tag: string, unit: string) {
  return facts?.["us-gaap"]?.[tag]?.units?.[unit]
      ?? facts?.["ifrs-full"]?.[tag]?.units?.[unit]
      ?? facts?.["dei"]?.[tag]?.units?.[unit]
      ?? null;
}

/*  ── 발행주식수 ──

    밸류에이션은 전부 '주당' 으로 끝납니다. 주식 수가 없으면 DCF 도
    배수도 못 냅니다. 예전에는 이걸 EODHD 에서만 받아서, 유료 구독이
    끊기면 밸류에이션 탭 전체가 멈추는 구조였습니다.

    SEC 는 10-K/10-Q 표지에 '지금 발행돼 있는 주식 수' 를 dei 태그로
    싣습니다. 공짜이고, 회사가 직접 적어낸 값입니다.
    표지 값이 없으면 희석 가중평균 주식수로 대신합니다 —
    이쪽은 '기간 평균' 이라 뜻이 조금 다르므로 어느 쪽을 썼는지 같이 돌려줍니다. */
function usShareCount(facts: any) {
  const pick = (tag: string) => {
    const arr = usUnits(facts, tag, "shares");
    if (!Array.isArray(arr) || !arr.length) return null;
    //  가장 최근에 제출된 것
    let best: any = null;
    for (const o of arr) {
      const v = Number(o?.val);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (!best || String(o.end ?? "") > String(best.end ?? "")
                || (String(o.end) === String(best.end)
                    && String(o.filed ?? "") > String(best.filed ?? ""))) best = o;
    }
    return best ? { value: Number(best.val), as_of: best.end ?? null } : null;
  };

  const cover = pick("EntityCommonStockSharesOutstanding");
  if (cover) return { ...cover, basis: "발행주식수 (공시 표지)" };

  const issued = pick("CommonStockSharesOutstanding");
  if (issued) return { ...issued, basis: "발행주식수" };

  const dil = pick("WeightedAverageNumberOfDilutedSharesOutstanding");
  if (dil) return { ...dil, basis: "희석 가중평균 주식수" };

  return null;
}

/*  한 계정을 여러 태그에서 모아옵니다.

    예전에는 '값이 있는 첫 태그' 하나만 쓰고 끝냈습니다. 그런데 회계기준이
    2018년에 바뀌면서(ASC 606) 매출을 Revenues 에서 RevenueFromContract... 로
    갈아탄 회사가 많습니다. 태그 하나만 보면 그 전이나 그 후 절반이 통째로
    비어버립니다 — 매출액이 비던 게 바로 이것 때문이었습니다.
    그래서 앞에 적은 태그를 우선하되, 빈 기간은 뒤 태그로 메웁니다.        */

//  한 태그 안에서 기간별로 가장 나중에 낸 공시를 고릅니다 (정정 반영)
function usLatestByKey(arr: any[], keyOf: (o: any) => string | null,
                       formOk: RegExp, minDays: number, maxDays: number) {
  const best: Record<string, any> = {};
  for (const o of arr) {
    if (!formOk.test(String(o.form ?? ""))) continue;
    const end = String(o.end ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    if (o.start) {
      const days = (Date.parse(end) - Date.parse(o.start)) / 864e5;
      if (days < minDays || days > maxDays) continue;
    }
    const k = keyOf(o);
    if (!k) continue;
    if (!best[k] || String(o.filed ?? "") > String(best[k].filed ?? "")) best[k] = o;
  }
  return best;
}

function usMerge(facts: any, tags: string[], unit: string,
                 keyOf: (o: any) => string | null,
                 formOk: RegExp, minDays: number, maxDays: number) {
  const out: Record<string, number> = {};
  for (const tag of tags) {
    const arr = usUnits(facts, tag, unit);
    if (!Array.isArray(arr) || !arr.length) continue;
    const best = usLatestByKey(arr, keyOf, formOk, minDays, maxDays);
    for (const k of Object.keys(best)) {
      if (out[k] == null) out[k] = Number(best[k].val);   // 빈 칸만 메웁니다
    }
  }
  return Object.keys(out).length ? out : null;
}

function usQuarterKey(o: any) {
  const end = String(o.end ?? "");
  const y = Number(end.slice(0, 4));
  const q = Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
  return `${y}Q${q}`;
}

/*  마지막 분기는 10-Q 를 안 냅니다.

    미국 회사는 1~3분기만 10-Q 를 내고 4분기는 따로 안 냅니다 (연간 10-K 로 갈음).
    그래서 그 분기 칸이 통째로 비어 보입니다 — 엔비디아 표에서 한 열이 전부
    '—' 였던 게 이것입니다. 연간에서 앞 세 분기를 빼면 정확히 4분기 값이라,
    손익·현금흐름처럼 '기간 동안 얼마' 인 계정은 계산해서 채웁니다.
    (자산·부채처럼 '그 시점 잔액' 인 계정은 빼면 안 되므로 건드리지 않습니다)   */
function usFillQ4(facts: any, tags: string[], unit: string, out: Record<string, number>) {
  const annual: Record<string, { end: string; val: number }> = {};
  for (const tag of tags) {
    const arr = usUnits(facts, tag, unit);
    if (!Array.isArray(arr)) continue;
    for (const o of arr) {
      if (!US_ANNUAL_FORM.test(String(o.form ?? ""))) continue;
      const end = String(o.end ?? "");
      if (!o.start || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
      const days = (Date.parse(end) - Date.parse(o.start)) / 864e5;
      if (days < 300 || days > 400) continue;
      const k = usQuarterKey(o);
      if (!annual[k]) annual[k] = { end, val: Number(o.val) };
    }
  }

  for (const k of Object.keys(annual)) {
    if (out[k] != null) continue;                    // 회사가 낸 값이 있으면 그대로
    //  회계연도가 끝나는 분기에서 거꾸로 세 분기를 찾습니다
    const m = k.match(/^(\d{4})Q(\d)$/);
    if (!m) continue;
    let y = Number(m[1]), q = Number(m[2]);
    const prev: number[] = [];
    for (let i = 0; i < 3; i++) {
      q -= 1; if (q < 1) { q = 4; y -= 1; }
      const v = out[`${y}Q${q}`];
      if (v == null) break;
      prev.push(v);
    }
    if (prev.length !== 3) continue;
    const v4 = annual[k].val - prev.reduce((a, b) => a + b, 0);
    if (Number.isFinite(v4)) out[k] = v4;
  }
}

function usPickQuarter(facts: any, tags: string[], unit = "USD", flow = true) {
  const out = usMerge(facts, tags, unit, usQuarterKey, US_QUARTER_FORM, 60, 120);
  if (out && flow) usFillQ4(facts, tags, unit, out);
  return out;
}

function usPickAnnual(facts: any, tags: string[], unit = "USD") {
  return usMerge(facts, tags, unit,
    (o) => String(o.end ?? "").slice(0, 4), US_ANNUAL_FORM, 300, 400);
}

function usPeriods(keys: string[]) {
  return keys.map((k) => {
    const m = k.match(/^(\d{4})Q(\d)$/);
    if (m) {
      const y = Number(m[1]), q = Number(m[2]);
      return { key: k, label: String(y).slice(2) + "' " + q + "Q",
               end: y + "-" + ["03-31", "06-30", "09-30", "12-31"][q - 1] };
    }
    return { key: k, label: k + "년", end: k + "-12-31" };
  });
}

async function usFinFull(cik: string, period = "annual") {
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
                        { headers: secHeaders() });
  if (r.status === 404) return { statements: {}, periods: [], note: "SEC 에 해당 기업 자료가 없습니다." };
  if (!r.ok) throw new Error(`SEC 조회 실패 (${r.status}). SEC_UA 시크릿을 설정해 보세요.`);
  const d = await r.json();
  const facts = d?.facts ?? {};

  const q = period === "quarter";
  //  flow = '기간 동안 얼마' 인 계정 (손익·현금흐름). 재무상태표는 잔액이라 제외합니다.
  const pick = (tags: string[], unit = "USD", flow = true) =>
    q ? usPickQuarter(facts, tags, unit, flow) : usPickAnnual(facts, tags, unit);

  const statements: any = {};
  const keys = new Set<string>();
  let ord = 0;

  for (const [group, label, tags, depth, emph] of US_STATEMENTS) {
    ord++;
    const perShare = label.indexOf("EPS") === 0;
    const vals = pick(tags, perShare ? "USD/shares" : "USD", group !== "재무상태표");
    if (!vals) continue;
    Object.keys(vals).forEach((k) => keys.add(k));
    statements[group] = statements[group] || [];
    statements[group].push({ name: label, ord, values: vals,
                             depth, emphasis: emph, per_share: perShare });
  }

  //  회사가 태그하지 않은 계정을 다른 계정에서 계산해 채웁니다
  const filled = usFillDerived(statements, keys);

  const kl = [...keys].sort().slice(q ? -6 : -8);
  return { statements, periods: usPeriods(kl), unit: "USD",
           shares: usShareCount(facts),
           derived: filled, schema: FIN_SCHEMA,
           basis: q ? "10-Q (SEC XBRL)" : "10-K (SEC XBRL)" };
}

/*  표 한복판이 비지 않게, 계산으로 알 수 있는 값은 채웁니다.
    어디까지나 '다른 줄에서 뽑아낸 값' 이라 화면에서 따로 표시해 줍니다.   */
function usFillDerived(statements: any, keys: Set<string>) {
  const made: string[] = [];

  for (const [group, target, needs, calc] of US_DERIVED) {
    const rows: any[] = statements[group];
    if (!rows) continue;
    const find = (n: string) => rows.filter((r: any) => r.name === n)[0];
    const src = needs.map(find);
    if (src.some((r) => !r)) continue;

    let row = find(target);
    if (!row) {
      const extra = US_EXTRA_ROW[target];
      if (!extra) continue;                       // 표에 없는 줄은 정의가 있어야 만듭니다
      const after = find(extra.after);
      row = { name: target, ord: (after ? after.ord : 9990) + 0.5,
              values: {}, depth: extra.depth, emphasis: extra.emphasis, derived: {} };
      rows.push(row);
      rows.sort((x: any, y: any) => x.ord - y.ord);
    }
    row.derived = row.derived || {};

    let n = 0;
    for (const k of keys) {
      if (row.values[k] != null) continue;         // 회사가 직접 낸 값이 우선
      const vals = src.map((r: any) => r.values[k]);
      if (vals.some((v) => v == null || !Number.isFinite(Number(v)))) continue;
      const v = calc(vals.map(Number));
      if (!Number.isFinite(v)) continue;
      row.values[k] = v;
      row.derived[k] = true;
      n++;
    }
    if (n) made.push(target);
  }
  return [...new Set(made)];
}

// ── 공시 목록 ─────────────────────────────────
async function krList(corpCode: string) {
  const end = new Date();
  const bgn = new Date(end.getTime() - 365 * 864e5);
  const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const d = await dart("list.json", {
    corp_code: corpCode, bgn_de: f(bgn), end_de: f(end),
    page_count: "100", sort: "date", sort_mth: "desc",
  });
  const rows = (d.list ?? []).map((x: any) => ({
    date: String(x.rcept_dt ?? "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
    title: x.report_nm,
    filer: x.flr_nm,
    url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + x.rcept_no,
  }));
  return { rows };
}

async function usList(cik: string) {
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: secHeaders() });
  if (!r.ok) throw new Error(`SEC 공시 목록 실패 (${r.status})`);
  const d = await r.json();
  const f = d?.filings?.recent;
  if (!f) return { rows: [] };

  const bare = String(Number(cik));                    // 앞의 0 제거
  const rows: any[] = [];
  for (let i = 0; i < (f.form?.length ?? 0) && rows.length < 60; i++) {
    const acc = String(f.accessionNumber[i]).replace(/-/g, "");
    rows.push({
      date: f.filingDate[i],
      title: f.form[i] + (f.primaryDocDescription?.[i] ? " · " + f.primaryDocDescription[i] : ""),
      filer: d.name,
      url: `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/${f.primaryDocument[i]}`,
    });
  }
  return { rows };
}

/*  ── 공시 <원문> 읽기 ────────────────────────────────────────

    ⚠️ 왜 만들었나. AI 분석 리포트가 공시의 <제목과 날짜만> 보고 있었습니다.
       그래서 "세그먼트 매출 비공개", "고객별 매출 비중 미공개" 같은
       «자료 없음» 이 잔뜩 나왔는데, 사실 그 숫자들은 10-K 본문에 다
       적혀 있습니다. 제목만 주고 분석하라고 한 셈이었습니다.

    ⚠️ 무엇을 골라 오나. 10-K/10-Q 는 수 MB 짜리 HTML 입니다. 통째로
       모델에 넣으면 리포트 한 건에 몇 달러가 나갑니다. 그래서
       <읽을 값어치가 있는 항목만> 잘라옵니다 —
         10-K : Item 1(사업) · 1A(위험요인) · 7(MD&A) · 7A(시장위험)
         10-Q : Item 2(MD&A) · Part II Item 1A(위험요인 변경)
         8-K  : 짧으므로 본문 그대로
       재무제표 숫자는 이미 SEC XBRL 로 정확히 받고 있으므로 안 가져옵니다.

    ⚠️ 무거운 일을 안 하도록. Edge Function 은 CPU 2초 제한이 있습니다.
       내려받는 크기에 상한을 두고, 태그 제거도 한 번만 훑습니다.       */
const FILING_MAX_BYTES = 6_000_000;    //  이보다 큰 문서는 앞부분만
const FILING_SEC_CHARS = 14_000;       //  항목 하나당
const FILING_ALL_CHARS = 34_000;       //  한 공시 전체

//  HTML → 글자. 표는 칸 사이를 공백으로 벌려 숫자가 붙지 않게 합니다.
function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<\/(tr|p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/*  본문에서 "Item 1A." 같은 머리말 자리를 찾습니다.

    ⚠️ 실제 10-K 를 열어보고 맞춘 규칙입니다 (로켓랩 FY2025 기준) —
     ① 목차에도 똑같은 글자가 있습니다. 목차가 <항상 먼저> 나오므로
        뒤에 있는 것을 씁니다.
     ② 목차 줄은 뒤에 <쪽번호(맨숫자)> 가 붙고 본문이 없습니다.
        머리말 뒤 400자에 알파벳이 얼마나 있는지로 가릅니다.
     ③ 번호와 제목이 다른 칸에 있어서 "Item 1. Business" 가 한 덩어리로
        안 붙어 있을 수 있습니다. 그래서 <번호까지만> 찾습니다.
     ④ 함정: Item 1 끝에 "Risk Factors Summary" 가 있습니다. 그래서
        "Risk Factors" 라는 <말> 이 아니라 "Item 1A" 라는 <번호> 로 찾습니다.
     ⑤ 함정: "Item 1" 은 "Item 1A" 의 앞부분이기도 합니다. 뒤에 글자가
        더 붙으면 안 됩니다 (경계 확인).                                */
function itemAt(text: string, item: string) {
  //  1 을 찾을 때 1A · 1B 에 걸리면 안 됩니다
  const re = new RegExp(
    "item\\s*" + item.replace(".", "\\.") + "(?![0-9A-Za-z])\\s*[\\.:\\u2013\\u2014-]?",
    "gi");
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push(m.index);
  if (!hits.length) return -1;
  for (let i = hits.length - 1; i >= 0; i--) {
    const after = text.slice(hits[i], hits[i] + 400);
    //  목차 줄은 제목 몇 글자 + 쪽번호뿐이라 알파벳이 얼마 없습니다
    if (after.replace(/[^A-Za-z]/g, "").length > 120) return hits[i];
  }
  return hits[hits.length - 1];
}

function sliceItem(text: string, from: string, to: string[], cap = FILING_SEC_CHARS) {
  const a = itemAt(text, from);
  if (a < 0) return "";
  let b = text.length;
  for (const t of to) {
    const i = itemAt(text, t);
    if (i > a && i < b) b = i;
  }
  const out = text.slice(a, Math.min(b, a + cap)).trim();
  return out.length > 200 ? out : "";
}

/*  ── 위험요인은 <제목만> 뽑습니다 ────────────────────────────

    ⚠️ Item 1A 는 실제로 9만~11만 자입니다 (로켓랩 기준 위험요인 28~30개).
       통째로 넣으면 리포트 한 건 값이 몇 배가 되는데, 정작 쓸모 있는 건
       "무엇이 위험한가" 목록입니다. 위험요인은 한 개마다 <한 문장짜리
       굵은 제목> 으로 시작하므로 그 제목만 모으면 1/20 크기로 같은 정보를
       줍니다. 앞부분 몇 개만 잘라 넣는 것보다 훨씬 낫습니다.            */
function riskHeadings(block: string, max = 40) {
  const out: string[] = [];
  for (const raw of block.split("\n")) {
    const t = raw.trim();
    if (t.length < 40 || t.length > 320) continue;
    //  위험요인 제목은 대체로 완결된 <문장> 이고 마침표로 끝납니다
    if (!/[.?]$/.test(t)) continue;
    //  문장이 여럿이면 본문 문단입니다
    if ((t.match(/\. /g) || []).length > 1) continue;
    if (!/\b(may|could|might|risk|fail|unable|adverse|depend|if we|we do not|our abilit)/i.test(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function filingText(url: string, form: string) {
  const r = await fetch(url, { headers: secHeaders() });
  if (!r.ok) return { url, form, err: `공시 원문을 받지 못했습니다 (${r.status})` };
  const raw = await r.text();
  const html = raw.length > FILING_MAX_BYTES ? raw.slice(0, FILING_MAX_BYTES) : raw;
  const text = htmlToText(html);
  const f = form.toUpperCase();

  const parts: Record<string, string> = {};
  let risks: string[] = [];
  if (f.startsWith("10-K") || f.startsWith("20-F")) {
    parts["Item 1 · 사업"]      = sliceItem(text, "1", ["1A", "1B", "2"]);
    parts["Item 7 · MD&A"]      = sliceItem(text, "7", ["7A", "8"]);
    parts["Item 7A · 시장위험"] = sliceItem(text, "7A", ["8"], 5_000);
    //  위험요인은 통째로 말고 <제목만> (본문의 1/20 크기, 같은 정보)
    risks = riskHeadings(sliceItem(text, "1A", ["1B", "1C", "2"], 160_000));
  } else if (f.startsWith("10-Q")) {
    parts["Item 2 · MD&A"]      = sliceItem(text, "2", ["3", "4"]);
    parts["Item 3 · 시장위험"]  = sliceItem(text, "3", ["4"], 5_000);
    risks = riskHeadings(sliceItem(text, "1A", ["1B", "2", "5", "6"], 80_000), 20);
  }
  //  8-K 등은 원래 짧습니다 — 앞부분을 그대로 씁니다
  const got = Object.entries(parts).filter(([, v]) => v);
  if (!got.length && !risks.length) {
    return { url, form, chars: text.length,
             body: text.slice(0, FILING_ALL_CHARS),
             note: "항목 머리말을 못 찾아 앞부분을 그대로 넣었습니다." };
  }
  //  항목이 여럿이면 한 공시 전체 상한 안에서 고르게 나눕니다
  const budget = FILING_ALL_CHARS - risks.join("\n").length;
  const per = Math.max(2_000, Math.floor(budget / Math.max(1, got.length)));
  const sections: Record<string, string> = {};
  for (const [k, v] of got) sections[k] = v.slice(0, per);
  return { url, form, chars: text.length, sections,
           risk_headings: risks.length ? risks : undefined };
}

/*  ── 국내 사업보고서 «주요정보» ──────────────────────────────

    ⚠️ 왜 필요한가. AI 분석이 국내 종목에서 공시 섹션을 통째로 비웠습니다.
       미국은 10-K 본문(Item 1 · MD&A · 위험요인)을 긁어오는데, 국내는
       제목과 날짜만 줬기 때문입니다. 모델이 «자료가 없다» 를 넘어
       내부 필드 이름까지 화면에 적는 지경이었습니다.

    ⚠️ DART 원문(document.json)은 ZIP 으로 옵니다. 우리는 Deno 가 DART 에
       직접 못 붙어서 Postgres http_get 을 거치는데, 그 통로로 바이너리를
       나르면 깨집니다. 그래서 <원문 대신 구조화된 주요정보> 를 씁니다.

    ⚠️ 여기 담긴 것들은 리서치 보고서가 실제로 인용하는 항목들입니다 —
       자기주식(주주환원), 최대주주(지배구조), 증자(희석), 직원 수(인건비),
       타법인 출자(사업 확장). 서술은 없지만 <숫자와 사실> 은 있습니다.  */
const KR_MAIN = [
  ["tesstkAcqsDspsSttus", "자기주식 취득·처분"],
  ["hyslrSttus",          "최대주주 현황"],
  ["hyslrChgSttus",       "최대주주 변동"],
  ["irdsSttus",           "증자·감자 현황"],
  ["cprndNrdmpBlnc",      "미상환 전환사채"],
  ["otcprStke",           "타법인 출자 현황"],
  ["empSttus",            "직원 현황"],
  ["hmvAuditAllSttus",    "이사·감사 보수"],
] as const;

async function krMainInfo(corpCode: string) {
  const now = new Date().getUTCFullYear();
  const out: Record<string, any[]> = {};
  //  사업보고서(11011) 기준. 올해 것이 아직이면 작년 것을 봅니다.
  for (const year of [now - 1, now - 2]) {
    const got = await Promise.all(KR_MAIN.map(async ([path, label]) => {
      try {
        const d = await dart(path + ".json", {
          corp_code: corpCode, bsns_year: String(year), reprt_code: "11011",
        });
        const rows = (d?.list ?? []).slice(0, 12);
        return rows.length ? [label, rows] as const : null;
      } catch { return null; }
    }));
    for (const g of got) if (g && !out[g[0]]) out[g[0]] = g[1];
    //  한 해에서 웬만큼 나왔으면 더 안 캡니다 (DART 호출을 아낍니다)
    if (Object.keys(out).length >= 4) break;
  }
  return { year_basis: now - 1, sections: out };
}

// ── 배당 · 지분 (국내) ────────────────────────
async function krDiv(corpCode: string) {
  const now = new Date().getUTCFullYear();
  const rows: any[] = [];
  for (const y of [now - 1, now - 2, now - 3]) {
    const d = await dart("alotMatter.json", {
      corp_code: corpCode, bsns_year: String(y), reprt_code: "11011",
    });
    for (const x of (d.list ?? [])) {
      rows.push({ year: y, item: x.se, kind: x.stock_knd,
                  thstrm: x.thstrm, frmtrm: x.frmtrm, lwfr: x.lwfr });
    }
    if (rows.length) break;                            // 가장 최근 것 하나면 충분
  }
  return { rows };
}

async function krMajor(corpCode: string) {
  const d = await dart("majorstock.json", { corp_code: corpCode });
  const rows = (d.list ?? []).slice(0, 40).map((x: any) => ({
    date: x.rcept_dt, holder: x.repror, kind: x.report_tp,
    qty: x.stkqy, qty_chg: x.stkqy_irds, rate: x.stkrt, rate_chg: x.stkrt_irds,
    reason: x.report_resn,
  }));
  return { rows };
}

async function krElest(corpCode: string) {
  const d = await dart("elestock.json", { corp_code: corpCode });
  const rows = (d.list ?? []).slice(0, 40).map((x: any) => ({
    date: x.rcept_dt, holder: x.repror, position: x.isu_exctv_ofcps,
    registered: x.isu_exctv_rgist_at, major: x.isu_main_shrholdr,
    qty: x.sp_stock_lmp_cnt, qty_chg: x.sp_stock_lmp_irds_cnt, rate: x.sp_stock_lmp_rate,
  }));
  return { rows };
}

// ── 본체 ──────────────────────────────────────
/* ═══════════════════════════════════════════════════════════════
   의회 거래 — 미 하원 공시 (STOCK Act)

   미국 의원은 주식을 사고팔면 45일 안에 PTR(Periodic Transaction
   Report)을 내야 합니다. 하원 사무처(Clerk)가 그 목록을 해마다
   ZIP 한 덩이로 공개합니다 — 무료, 열쇠 없음, 공문서.

     목록  https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{연도}FD.zip
     원본  https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{연도}/{DocID}.pdf

   목록에는 '누가 언제 냈는지' 까지만 있고, 무슨 종목을 얼마에
   샀는지는 PDF 안에 있습니다. PDF 는 화면(브라우저)에서 읽습니다 —
   회원이 실제로 눌러본 건만 읽으면 되니까 서버가 할 일이 없고,
   Edge Function 의 시간 제한에도 걸리지 않습니다.

   ⚠️ 상원(efdsearch.senate.gov)은 넣지 않았습니다. 상원은 목록을
      보기 전에 '이용 제한 동의' 화면을 한 번 거치게 되어 있는데,
      그걸 프로그램이 대신 눌러 넘기는 건 약관 동의를 학회 대신
      해버리는 일입니다. 필요하면 사람이 판단할 문제라 남겨뒀습니다.
   ═══════════════════════════════════════════════════════════════ */

const HOUSE_BASE = "https://disclosures-clerk.house.gov/public_disc";

/*  ZIP 한 덩이에서 파일 하나를 꺼냅니다.

    라이브러리를 안 쓰는 이유는 Edge Function 에 의존성을 하나라도
    덜 얹기 위해서입니다. ZIP 은 구조가 단순합니다 — 끝에 목차(EOCD)가
    있고, 목차가 각 파일의 위치를 가리킵니다.                          */
async function unzipOne(buf: ArrayBuffer, want: RegExp) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  //  끝에서부터 목차 표시(0x06054b50)를 찾습니다
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP 형식이 아닙니다 (목차를 못 찾음).");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);          // 목차 시작 위치

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method  = dv.getUint16(p + 10, true);
    const compSz  = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLn = dv.getUint16(p + 30, true);
    const cmtLen  = dv.getUint16(p + 32, true);
    const lclOff  = dv.getUint32(p + 42, true);
    const name    = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));

    if (want.test(name)) {
      //  지역 헤더는 이름·추가필드 길이가 목차와 다를 수 있어 다시 읽습니다
      if (dv.getUint32(lclOff, true) !== 0x04034b50) throw new Error("ZIP 지역 헤더가 깨졌습니다.");
      const lNameLen = dv.getUint16(lclOff + 26, true);
      const lExtraLn = dv.getUint16(lclOff + 28, true);
      const start = lclOff + 30 + lNameLen + lExtraLn;
      const raw = u8.subarray(start, start + compSz);

      if (method === 0) return new TextDecoder().decode(raw);
      if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const out = new Response(
          new Blob([raw]).stream().pipeThrough(ds),
        );
        return await out.text();
      }
      throw new Error(`ZIP 압축 방식 ${method} 는 지원하지 않습니다.`);
    }
    p += 46 + nameLen + extraLn + cmtLen;
  }
  throw new Error("ZIP 안에서 찾는 파일이 없습니다.");
}

function xmlTag(chunk: string, tag: string) {
  const m = chunk.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
             .trim();
}

//  "1/15/2026" → "2026-01-15"
function usDate(s: string) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
}

//  하원 공시 유형 코드 — 우리가 쓰는 건 P(거래신고)와 그 수정본입니다
const FILING_KIND: Record<string, string> = {
  P: "거래 신고 (PTR)", O: "연간 재산 공개", A: "수정본", C: "후보자",
  D: "후보자 수정", W: "철회", X: "기한 연장", T: "퇴임 신고",
};

async function congressIndex(year: number) {
  const y = Math.max(2014, Math.min(2100, Math.round(year)));
  const r = await fetch(`${HOUSE_BASE}/financial-pdfs/${y}FD.zip`, {
    headers: { "User-Agent": secret("SEC_UA") || "SAFE Terminal university finance club" },
  });
  if (r.status === 404) {
    return { year: y, rows: [], note: `${y}년 자료가 아직 없습니다.` };
  }
  if (!r.ok) throw new Error(`하원 공시 목록을 못 받았습니다 (${r.status}).`);

  const xml = await unzipOne(await r.arrayBuffer(), /\.xml$/i);

  const rows: any[] = [];
  const parts = xml.split(/<Member>/i).slice(1);
  for (const chunk of parts) {
    const kind = xmlTag(chunk, "FilingType").toUpperCase();
    const docId = xmlTag(chunk, "DocID");
    if (!docId) continue;

    const last = xmlTag(chunk, "Last");
    const first = xmlTag(chunk, "First");
    const filed = usDate(xmlTag(chunk, "FilingDate"));
    const fyear = xmlTag(chunk, "Year") || String(y);

    rows.push({
      doc_id: docId,
      kind,
      kind_ko: FILING_KIND[kind] ?? kind,
      name: [first, last].filter(Boolean).join(" "),
      last, first,
      prefix: xmlTag(chunk, "Prefix"),
      state_dst: xmlTag(chunk, "StateDst"),
      filed,
      year: fyear,
      //  거래신고서만 ptr-pdfs 밑에 있습니다
      pdf: (kind === "P" || kind === "A")
        ? `${HOUSE_BASE}/ptr-pdfs/${fyear}/${docId}.pdf`
        : `${HOUSE_BASE}/financial-pdfs/${fyear}/${docId}.pdf`,
    });
  }

  rows.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  return {
    year: y,
    rows,
    total: rows.length,
    ptr: rows.filter((x) => x.kind === "P").length,
    source: "U.S. House Clerk — Financial Disclosure",
  };
}

/*  PDF 원본을 그대로 넘겨줍니다.

    브라우저가 house.gov 를 직접 부르면 CORS 에 막힙니다. 여기서
    받아서 base64 로 실어 보내면 화면에서 PDF.js 로 읽을 수 있습니다.  */
async function congressPtr(year: number, docId: string) {
  const y = Math.max(2014, Math.min(2100, Math.round(year)));
  if (!/^\d{6,12}$/.test(docId)) throw new Error("문서 번호가 올바르지 않습니다.");

  const r = await fetch(`${HOUSE_BASE}/ptr-pdfs/${y}/${docId}.pdf`, {
    headers: { "User-Agent": secret("SEC_UA") || "SAFE Terminal university finance club" },
  });
  if (!r.ok) throw new Error(`공시 원본을 못 받았습니다 (${r.status}).`);

  const buf = new Uint8Array(await r.arrayBuffer());
  //  10MB 가 넘으면 브라우저로 넘기지 않습니다 (거의 없습니다)
  if (buf.length > 10 * 1024 * 1024) throw new Error("공시 원본이 너무 큽니다.");

  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) {
    bin += String.fromCharCode(...buf.subarray(i, i + CH));
  }
  return { doc_id: docId, year: y, bytes: buf.length, b64: btoa(bin) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "로그인이 필요합니다." }, 401);

    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: allowed, error: gateErr } = await asUser.rpc("can_use_terminal");
    if (gateErr) return json({ error: `권한 확인 실패: ${gateErr.message}` }, 403);
    if (!allowed) return json({ error: "터미널 접속 권한이 없습니다." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "").trim();
    const code = String(body.code ?? "").trim();       // corp_code(8) 또는 CIK(10)

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    ADMIN = admin;                       // DART 통로가 쓸 연결

    // 회사 목록 새로 받기 — 임원진만
    if (action === "sync_kr" || action === "sync_us") {
      const { data: off } = await asUser.rpc("is_officer");
      if (!off) return json({ error: "임원진만 실행할 수 있습니다." }, 403);

      if (action === "sync_us") return json({ us: await syncUsTickers(admin) });

      const bgn = String(body.bgn ?? "").replace(/\D/g, "");
      const end = String(body.end ?? "").replace(/\D/g, "");
      if (bgn.length !== 8 || end.length !== 8) {
        return json({ error: "조회 기간(bgn, end)이 올바르지 않습니다." }, 400);
      }
      return json({ kr: await syncKrWindow(admin, bgn, end) });
    }

    /*  공시 원문 — AI 분석이 «자료 없음» 을 덜 쓰게 하려고 씁니다.
        ⚠️ 이미 제출된 공시는 <절대 안 바뀝니다>. 그래서 URL 하나당 한 번만
           받아서 영원히 담아둡니다. 같은 종목을 여러 학회원이 분석해도
           SEC 에는 한 번만 갑니다 (SEC 는 초당 10회 넘으면 막습니다).    */
    //  국내 사업보고서 주요정보 — AI 분석의 공시 섹션 재료
    if (action === "kr_main") {
      if (!code) return json({ error: "기업 코드가 비어 있습니다." }, 400);
      const { data: hitM } = await admin.from("series_cache")
        .select("payload, fetched_at").eq("source", "kr_main").eq("code", code)
        .eq("item_code", "v1").maybeSingle();
      if (hitM?.payload) {
        const ageH = (Date.now() - new Date(hitM.fetched_at).getTime()) / 36e5;
        //  사업보고서는 1년에 한 번입니다 — 오래 담아둡니다
        if (ageH < 24 * 14) return json({ ...(hitM.payload as any), cached: true });
      }
      const outM = await krMainInfo(code);
      if (Object.keys(outM.sections).length) {
        await admin.from("series_cache").upsert({
          source: "kr_main", code, item_code: "v1",
          fetched_at: new Date().toISOString(), payload: outM,
        });
      }
      return json(outM);
    }

    if (action === "filing_text") {
      const fu = String(body.url ?? "");
      const form = String(body.form ?? "");
      if (!/^https:\/\/www\.sec\.gov\/Archives\//.test(fu))
        return json({ error: "SEC 아카이브 주소만 읽습니다." }, 400);

      //  주소가 길어서 열쇠로 쓰기 어렵습니다 — 접수번호+파일명만 씁니다
      const ckey = fu.replace("https://www.sec.gov/Archives/edgar/data/", "").slice(0, 180);
      const { data: hitF } = await admin.from("series_cache")
        .select("payload").eq("source", "filing_text").eq("code", ckey)
        .eq("item_code", "v1").maybeSingle();
      if (hitF?.payload) return json({ ...(hitF.payload as any), cached: true });

      const outF = await filingText(fu, form);
      if (!(outF as any).err) {
        await admin.from("series_cache").upsert({
          source: "filing_text", code: ckey, item_code: "v1",
          fetched_at: new Date().toISOString(), payload: outF,
        });
      }
      return json(outF);
    }

    //  전체 공시 흐름이라 기업 코드가 필요 없습니다
    if (action === "dart_recent")
      return json(await dartRecent(Number(body.limit ?? 60)));

    //  의회 거래 — 기업 코드와 무관합니다
    if (action === "congress_index") {
      const yr = Number(body.year ?? new Date().getUTCFullYear());
      const ckey = String(yr);
      const { data: hitC } = await admin.from("series_cache")
        .select("payload, fetched_at")
        .eq("source", "congress_index").eq("code", ckey).eq("item_code", "")
        .maybeSingle();
      if (hitC) {
        const ageH = (Date.now() - new Date(hitC.fetched_at).getTime()) / 36e5;
        const pc: any = hitC.payload;
        //  지난 해 자료는 더 안 바뀝니다. 올해 것만 자주 새로 받습니다.
        const maxAge = yr < new Date().getUTCFullYear() ? 24 * 30 : 6;
        if (ageH < maxAge && pc && Array.isArray(pc.rows) && pc.rows.length) {
          return json({ ...pc, cached: true });
        }
      }
      const outC = await congressIndex(yr);
      if (Array.isArray(outC.rows) && outC.rows.length) {
        await admin.from("series_cache").upsert({
          source: "congress_index", code: ckey, item_code: "",
          fetched_at: new Date().toISOString(), payload: outC,
        });
      }
      return json(outC);
    }
    if (action === "congress_ptr")
      return json(await congressPtr(Number(body.year ?? 0), String(body.doc_id ?? "")));

    const NEED_CODE = ["kr_fin", "kr_fin_q", "kr_fin_full", "kr_list", "kr_div", "kr_major",
                       "kr_elest", "us_fin", "us_fin_q", "us_fin_full", "us_list",
                       "f13_search", "f13_filings", "f13_holdings", "eod_full"];
    if (!NEED_CODE.includes(action)) {
      return json({ error: `action 은 sync_kr, sync_us, ${NEED_CODE.join(", ")} 중 하나여야 합니다.` }, 400);
    }
    if (!code) return json({ error: "기업 코드가 비어 있습니다." }, 400);

    //  캐시 (series_cache 재사용: source=co_<action>, code=기업코드)
    //
    //  열쇠에 '무엇을 요청했는지' 를 같이 넣어야 합니다.
    //  기간(연간/분기)이 빠져 있으면 연간을 받아둔 캐시가 분기 요청에도
    //  그대로 돌아와서, 분기로 바꿔도 화면이 안 바뀝니다.
    //  13F 도 분기마다 다른 보고서라 접수번호를 열쇠에 넣습니다.
    const period = String(body.period ?? "annual");
    const cacheSrc = "co_" + action;
    //  표 모양이 바뀌면 이 숫자를 올립니다.
    //  그러면 예전에 받아둔 캐시는 저절로 버려집니다 — 배포할 때마다
    //  'SQL 로 캐시 지우기' 를 기억할 필요가 없어집니다.
    //  (실제로 이걸 안 지워서 엔비디아 매출액이 계속 비어 보였습니다)
    const cacheKey =
        (action === "eod_full") ? String(body.market ?? "US")
      : (action === "kr_fin_full" || action === "us_fin_full") ? (FIN_SCHEMA + "|" + period)
      : (action === "f13_holdings")
          ? String(body.accession ?? "") + "|" + String(body.prev_accession ?? "")
      : "";

    const { data: cached } = await admin.from("series_cache")
      .select("payload, fetched_at")
      .eq("source", cacheSrc).eq("code", code).eq("item_code", cacheKey)
      .maybeSingle();

    if (cached) {
      const ageH = (Date.now() - new Date(cached.fetched_at).getTime()) / 36e5;
      const p: any = cached.payload;
      var hasData = (p?.found === true)
                 || (Array.isArray(p?.rows) && p.rows.length)
                 || (Array.isArray(p?.hits) && p.hits.length)
                 || (Array.isArray(p?.filings) && p.filings.length)
                 || (p?.statements && Object.keys(p.statements).length);
      //  이미 제출된 공시는 바뀌지 않으니 오래 두고 씁니다
      const maxH = (action === "f13_holdings") ? 24 * 365 : CACHE_HOURS;
      if (ageH < maxH && hasData) {
        return json({ ...p, cached: true });
      }
    }

    let out: any;
    if (action === "kr_fin")         out = await krFin(code);
    else if (action === "kr_fin_q")  out = await krFinQuarter(code);
    else if (action === "us_fin_q")  out = await usFinQuarter(code);
    else if (action === "eod_full")     out = await eodFundamentals(code, String(body.market ?? "US"),
                                                                   String(body.name ?? ""));
    else if (action === "f13_search")   out = await f13Search(code);
    else if (action === "f13_filings")  out = await f13Filings(code);
    else if (action === "f13_holdings") {
      out = await f13Holdings(code, String(body.accession ?? ""), String(body.filed ?? ""));
      if (body.prev_accession) {
        const prev = await f13Holdings(code, String(body.prev_accession), String(body.prev_filed ?? ""));
        out = { ...out, rows: f13Diff(out, prev), prev_period: prev.period };
      }
    }
    else if (action === "kr_fin_full") out = await krFinFull(code, period);
    else if (action === "us_fin_full") out = await usFinFull(code, period);
    else if (action === "kr_list")  out = await krList(code);
    else if (action === "kr_div")   out = await krDiv(code);
    else if (action === "kr_major") out = await krMajor(code);
    else if (action === "kr_elest") out = await krElest(code);
    else if (action === "us_fin")   out = await usFin(code);
    else                            out = await usList(code);

    var worth = (out?.found === true)
             || (Array.isArray(out?.rows) && out.rows.length)
             || (Array.isArray(out?.hits) && out.hits.length)
             || (Array.isArray(out?.filings) && out.filings.length)
             || (out?.statements && Object.keys(out.statements).length);
    if (worth) {
      await admin.from("series_cache").upsert({
        source: cacheSrc, code, item_code: cacheKey,
        fetched_at: new Date().toISOString(), payload: out,
      });
    }
    return json({ ...out, cached: false });

  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

// ══════════════════════════════════════════════
//  13F — 기관투자자 분기 보유 내역 (SEC)
//
//    함정이 둘 있습니다. 둘 다 조용히 틀린 숫자를 만듭니다.
//
//    1) 금액 단위 — 2023-01-03 부터 "달러", 그 전에는 "천 달러".
//       기준은 보고 분기가 아니라 '제출일' 입니다. 2022년 4분기
//       보고서라도 2023-02-14 에 냈으면 달러 단위입니다.
//
//    2) 같은 CUSIP 이 한 보고서 안에 여러 줄로 나옵니다
//       (운용역이 나뉘어 있으면 각각 따로 적습니다).
//       합치지 않으면 종목 수도 비중도 다 틀립니다.
// ══════════════════════════════════════════════

const FTS = "https://efts.sec.gov/LATEST/search-index";

//  기관 이름으로 CIK 찾기.
//  13F 만 내는 운용사는 company_tickers.json 에 없어서 전문검색을 씁니다.
async function f13Search(q: string) {
  //  q 를 넣으면 그 낱말이 들어간 문서만 세어서, 보유내역 XML 처럼
  //  일반 낱말이 없는 서류가 통째로 빠집니다. q 없이 먼저 시도합니다.
  const base = `${FTS}?forms=13F-HR&entityName=${encodeURIComponent(q)}`;
  let r = await fetch(base, { headers: secHeaders() });
  if (!r.ok) r = await fetch(base + "&q=%22the%22", { headers: secHeaders() });
  if (!r.ok) throw new Error(`SEC 검색 실패 (${r.status}). 잠시 후 다시 시도해주세요.`);
  const d = await r.json();
  const buckets = d?.aggregations?.entity_filter?.buckets ?? [];
  const out: any[] = [];
  for (const b of buckets) {
    const m = String(b.key ?? "").match(/^(.*)\s+\(CIK\s+(\d{10})\)$/);
    if (!m) continue;
    out.push({ name: m[1].trim(), cik: m[2], filings: Number(b.doc_count ?? 0) });
  }
  return { hits: out.slice(0, 20) };
}

//  그 기관의 13F 제출 목록 (분기별)
async function f13Filings(cik: string) {
  const c = String(cik).replace(/\D/g, "").padStart(10, "0");
  const r = await fetch(`https://data.sec.gov/submissions/CIK${c}.json`, { headers: secHeaders() });
  if (r.status === 404) return { name: "", filings: [], note: "해당 CIK 를 찾지 못했습니다." };
  if (!r.ok) throw new Error(`SEC 조회 실패 (${r.status}).`);
  const d = await r.json();
  const byPeriod: Record<string, any> = {};

  //  같은 분기에 정정(13F-HR/A)이 있으면 나중 것을 씁니다
  const take = (rec: any) => {
    const n = (rec?.form ?? []).length;
    for (let i = 0; i < n; i++) {
      const form = String(rec.form[i] ?? "");
      if (form !== "13F-HR" && form !== "13F-HR/A") continue;  // 13F-NT 는 보유 내역이 없습니다
      const period = String(rec.reportDate[i] ?? "");
      if (!period) continue;
      const row = {
        accession: String(rec.accessionNumber[i] ?? ""),
        filed: String(rec.filingDate[i] ?? ""),
        period, form,
      };
      const cur = byPeriod[period];
      if (!cur || row.filed > cur.filed) byPeriod[period] = row;
    }
  };
  take(d?.filings?.recent);

  //  서류가 아주 많은 신고인은 최근분이 잘려 있어서 나머지 묶음도 봅니다
  if (Object.keys(byPeriod).length < 8) {
    for (const f of (d?.filings?.files ?? []).slice(0, 3)) {
      try {
        const rr = await fetch(`https://data.sec.gov/submissions/${f.name}`, { headers: secHeaders() });
        if (rr.ok) take(await rr.json());
      } catch { /* 하나 실패해도 계속 */ }
    }
  }
  const list = Object.values(byPeriod).sort((a: any, b: any) => b.period.localeCompare(a.period));
  return { cik: c, name: d?.name ?? "", filings: list.slice(0, 12) };
}

function xmlAll(src: string, tag: string) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}
function xmlOne(src: string, tag: string) {
  const m = src.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : "";
}
function xmlHas(src: string, tag: string) {
  return new RegExp(`<(?:\\w+:)?${tag}\\b`).test(src);
}

//  보유 내역 XML 은 파일명이 제각각이라 폴더 목록에서 찾아냅니다
async function f13InfoTableUrl(cik: string, accession: string) {
  const bare = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${bare}`;
  const r = await fetch(`${base}/index.json`, { headers: secHeaders() });
  if (!r.ok) throw new Error(`보고서 폴더를 열지 못했습니다 (${r.status}).`);
  const d = await r.json();
  const items = (d?.directory?.item ?? [])
    .map((x: any) => String(x.name ?? ""))
    .filter((nm: string) => /\.xml$/i.test(nm) && nm.toLowerCase() !== "primary_doc.xml");
  for (const nm of items) {
    const rr = await fetch(`${base}/${nm}`, { headers: secHeaders() });
    if (!rr.ok) continue;
    const text = await rr.text();
    if (/<(?:\w+:)?informationTable\b/.test(text)) return { text, url: `${base}/${nm}` };
  }
  throw new Error("보유 내역 표를 찾지 못했습니다.");
}

async function f13Holdings(cik: string, accession: string, filed: string) {
  const bare = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${bare}`;

  //  표지에서 합계를 받아 검산에 씁니다
  let total = 0, entries = 0, manager = "", period = "";
  try {
    const pr = await fetch(`${base}/primary_doc.xml`, { headers: secHeaders() });
    if (pr.ok) {
      const p = await pr.text();
      total   = Number(xmlOne(p, "tableValueTotal") || 0);
      entries = Number(xmlOne(p, "tableEntryTotal") || 0);
      manager = xmlOne(xmlOne(p, "filingManager") || p, "name");
      period  = xmlOne(p, "periodOfReport");
    }
  } catch { /* 표지가 없어도 본문은 읽습니다 */ }

  const { text } = await f13InfoTableUrl(cik, accession);

  //  ① 단위 — 제출일 기준
  const mult = (filed && filed >= "2023-01-03") ? 1 : 1000;

  //  ② 같은 CUSIP 을 합칩니다.
  //     옵션·채권도 버리지 않고 종류를 붙여서 함께 넘깁니다.
  //     다만 주식과 한 덩어리로 섞지는 않습니다 — 옵션의 value 는
  //     옵션 자체의 값이고 수량은 기초자산 주식 수라, 주식 비중에
  //     그대로 더하면 뜻이 어긋납니다.
  const agg: Record<string, any> = {};
  let optionRows = 0, prnRows = 0, rawSum = 0;
  const prices: number[] = [];

  for (const row of xmlAll(text, "infoTable")) {
    const cusip = xmlOne(row, "cusip").toUpperCase();
    if (!cusip) continue;
    const value  = Number(xmlOne(row, "value").replace(/,/g, ""));
    const shares = Number(xmlOne(row, "sshPrnamt").replace(/,/g, ""));
    const type   = (xmlOne(row, "sshPrnamtType") || "SH").toUpperCase();
    const pc     = xmlOne(row, "putCall").trim();
    if (!Number.isFinite(value)) continue;
    rawSum += value;

    const kind = pc ? "option" : (type === "SH" ? "stock" : "bond");
    if (kind === "option") optionRows++;
    if (kind === "bond")   prnRows++;
    if (kind === "stock" && shares > 0) prices.push(value / shares);

    const k = cusip + "|" + kind + "|" + pc;
    agg[k] = agg[k] || { cusip, kind, put_call: pc || null,
                         name: xmlOne(row, "nameOfIssuer").trim(),
                         cls: xmlOne(row, "titleOfClass").trim(), value: 0, shares: 0 };
    agg[k].value  += value;
    agg[k].shares += shares;
  }

  //  ③ 검산 — 합계가 표지와 맞는지, 단가가 상식적인지
  const sorted = prices.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] * mult : 0;
  const sumOk  = !total || Math.abs(rawSum - total) / Math.max(total, 1) < 0.02;
  const priceOk = !median || (median > 0.5 && median < 20000);

  const rows = Object.values(agg).map((x: any) => ({
    cusip: x.cusip, name: x.name, cls: x.cls, kind: x.kind, put_call: x.put_call,
    value: x.value * mult, shares: x.shares,
    //  단가는 보통주에서만 뜻이 있습니다
    price: (x.kind === "stock" && x.shares > 0) ? (x.value * mult) / x.shares : null,
  })).sort((a, b) => b.value - a.value);

  //  비중은 종류별로 따로 냅니다 — 화면에서 어떤 묶음을 보든 합이 100%가 되게
  const sums: Record<string, number> = { stock: 0, option: 0, bond: 0 };
  rows.forEach((x: any) => { sums[x.kind] = (sums[x.kind] ?? 0) + x.value; });
  rows.forEach((x: any) => {
    x.weight = sums[x.kind] > 0 ? (x.value / sums[x.kind]) * 100 : 0;
  });
  const sum = sums.stock;

  return {
    manager, period, filed, accession,
    rows, total: sum, n: rows.filter((x: any) => x.kind === "stock").length,
    totals: { stock: sums.stock, option: sums.option, bond: sums.bond },
    unit_basis: mult === 1 ? "달러" : "천 달러 → 달러 환산",
    counts: { options: optionRows, bonds: prnRows },
    checks: { sum_matches_cover: sumOk, price_sane: priceOk,
              cover_total: total * mult, cover_entries: entries,
              median_price: Math.round(median * 100) / 100 },
  };
}

//  두 분기를 비교해서 신규·청산·증감을 냅니다
function f13Diff(cur: any, prev: any) {
  const key = (x: any) => x.cusip + "|" + x.kind + "|" + (x.put_call ?? "");
  const p: Record<string, any> = {};
  (prev?.rows ?? []).forEach((x: any) => { p[key(x)] = x; });
  const seen = new Set<string>();
  const out = (cur?.rows ?? []).map((x: any) => {
    seen.add(key(x));
    const b = p[key(x)];
    const dShares = b ? x.shares - b.shares : x.shares;
    const pct = b && b.shares > 0 ? (x.shares / b.shares - 1) * 100 : null;
    return { ...x, prev_shares: b ? b.shares : 0, d_shares: dShares,
             d_pct: b ? pct : null, state: b ? (dShares > 0 ? "증가" : (dShares < 0 ? "감소" : "유지")) : "신규" };
  });
  (prev?.rows ?? []).forEach((x: any) => {
    if (seen.has(key(x))) return;
    out.push({ ...x, value: 0, shares: 0, weight: 0,
               prev_shares: x.shares, d_shares: -x.shares, d_pct: -100, state: "청산" });
  });
  return out;
}

// ══════════════════════════════════════════════
//  EODHD 종합 기업 정보
//
//   fundamentals 한 번이면 사업 개요 · 섹터 · 밸류에이션 ·
//   애널리스트 컨센서스 · 기관/펀드 보유 · 내부자 거래 ·
//   실적 추정치 · 재무제표(분기·연간)가 통째로 옵니다.
//   호출 하나가 10 콜을 먹으니 캐시가 중요합니다.
//
//   국내 종목은 005930.KO (코스피) · .KQ (코스닥) 입니다.
//   다만 기관/내부자 자료는 SEC 공시에서 나오는 것이라
//   국내 종목에는 비어 있을 수 있습니다 — 화면에 그대로 알립니다.
// ══════════════════════════════════════════════

function eodKey() {
  const k = secret("EODHD_API_KEY");
  if (!k) throw new Error(
    "EODHD_API_KEY 가 없습니다. Supabase → Edge Functions → Secrets 에 넣어주세요.");
  return k;
}

//  index 로 열쇠가 붙은 객체를 배열로 폅니다 ({"0":{…},"1":{…}})
function idxRows(o: any, max = 200) {
  if (!o) return [];
  if (Array.isArray(o)) return o.slice(0, max);
  return Object.keys(o).sort((a, b) => Number(a) - Number(b))
          .slice(0, max).map((k) => o[k]);
}
const numOrNull = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

//  005930 → 005930.KO,  AAPL → AAPL.US
function eodTicker(code: string, market: string) {
  const c = String(code).trim();
  if (c.includes(".")) return c.toUpperCase();
  if (market === "KR") return /^\d{6}$/.test(c) ? `${c}.KO` : `${c}.KO`;
  return `${c.toUpperCase()}.US`;
}

/*  ── 컨센서스 예비 창구 : Perplexity Finance Search ──────────

    ⚠️ 왜 필요한가. 「개요 · 컨센서스」는 EODHD 의 Fundamentals 창구를
       쓰는데, 그건 월 $59.99 요금제부터 열립니다. 지금 요금제에서는 403 이
       와서 화면이 통째로 빕니다 — 애널리스트 목표주가가 없으면 밸류에이션
       탭의 「우리 계산 vs 시장 기대」 비교가 아예 성립하지 않습니다.

    ⚠️ 값 차이가 큽니다. EODHD Fundamentals 3개월 $90(학생가) 대 Perplexity
       Finance Search 는 <조회 1,000회에 $5> 입니다. 종목 하나를 하루 한 번
       받아 두면 되는 자료라, 리포트 200건을 만들어도 $1 정도입니다.

    ⚠️ 대신 이건 <검색으로 받아온 값> 입니다. 거래소 원본이 아닙니다.
       그래서 ① 출처 URL 을 같이 받아 화면에 남기고, ② source 를 'pplx' 로
       표시해 EODHD 값과 구분하고, ③ 모델에게 "모르면 null, 지어내지 말 것"
       을 못박습니다. <체결 가격에는 절대 쓰지 않습니다> — 대회 순위가
       검증 불가능한 숫자 위에 서면 안 됩니다. 여기는 «참고 지표» 자리입니다.

    Secrets: PERPLEXITY_API_KEY                                          */
const PPLX_URL = "https://api.perplexity.ai/v1/agent";
const PPLX_MODEL = "openai/gpt-5.6-sol";

function pplxOn() { return !!secret("PERPLEXITY_API_KEY"); }

const PPLX_ASK = `아래 종목의 시장 컨센서스를 찾아 **JSON 하나만** 출력하세요.
설명·인사말·코드펜스 금지. 모르는 값은 반드시 null 로 두세요 —
**절대 지어내지 마세요.** 통화는 국내 종목이면 KRW, 미국이면 USD 입니다.

{"found":true,
 "currency":"USD|KRW",
 "price":0,               // 최근 종가 (참고용)
 "market_cap":0,          // 시가총액 (통화 단위 그대로)
 "shares_outstanding":0,
 "pe":0,"pb":0,"ps":0,"ev_ebitda":0,
 "eps_ttm":0,"eps_est_cy":0,"eps_est_ny":0,
 "target_mean":0,         // 애널리스트 목표주가 평균 (주당)
 "target_high":0,"target_low":0,
 "analysts":0,            // 커버리지 애널리스트 수
 "rating_score":0,        // 1=강한 매도 … 5=강한 매수
 "rating_text":"Strong Buy|Buy|Hold|Sell|Strong Sell",
 "revenue_ttm":0,
 "sector":null,"industry":null,
 "as_of":"YYYY-MM-DD"}`;

async function pplxConsensus(code: string, market: string, name: string) {
  const key = secret("PERPLEXITY_API_KEY");
  if (!key) return { found: false, note: "PERPLEXITY_API_KEY 가 없습니다." };

  const who = market === "KR"
    ? `한국거래소 상장 종목 ${name || ""} (종목코드 ${code})`
    : `미국 상장 종목 ${name || ""} (티커 ${code})`;

  let r: Response;
  try {
    r = await fetch(PPLX_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PPLX_MODEL,
        input: `${who}\n\n${PPLX_ASK}`,
        tools: [{ type: "finance_search" }],
        //  ⚠️ 단계를 늘리면 값이 붙습니다. 시세·컨센서스는 한 번이면 됩니다.
        max_steps: 2,
      }),
    });
  } catch (e) {
    return { found: false, note: `Perplexity 호출 실패: ${String((e as any)?.message ?? e)}` };
  }

  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* 그대로 */ }
    const why = r.status === 401
      ? "Perplexity 키가 거부됐습니다 (401). 키를 확인하세요."
      : r.status === 429
      ? "Perplexity 요청이 몰렸습니다 (429). 잠시 뒤 다시 눌러주세요."
      : `Perplexity 조회 실패 (${r.status}): ${msg}`;
    return { found: false, note: why };
  }

  let d: any = null;
  try { d = JSON.parse(text); } catch { return { found: false, note: "Perplexity 응답을 읽지 못했습니다." }; }

  //  ① 모델이 쓴 글에서 JSON 을, ② finance_results 에서 출처를 꺼냅니다
  const outs: any[] = Array.isArray(d?.output) ? d.output : [];
  let say = "";
  const sources: string[] = [];
  for (const o of outs) {
    if (o?.type === "message") {
      for (const c of (o.content ?? [])) if (c?.type === "output_text") say += c.text ?? "";
    }
    if (o?.type === "finance_results") {
      for (const res of (o.results ?? [])) {
        for (const u of (res?.sources ?? [])) if (typeof u === "string") sources.push(u);
      }
    }
  }
  const got = pplxJson(say);
  if (!got) return { found: false, note: "Perplexity 가 정해진 형식으로 답하지 않았습니다." };

  const invoked = Number(d?.usage?.tool_calls_details?.finance_search?.invocation) || 0;
  return shapePplx(got, code, market, name,
                   [...new Set(sources)].slice(0, 6), invoked);
}

function pplxJson(t: string) {
  let x = String(t ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = x.indexOf("{"), b = x.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(x.slice(a, b + 1)); } catch { /* 한 번 더 */ }
  try { return JSON.parse(x.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

/*  EODHD 가 주던 것과 <같은 모양> 으로 맞춥니다. 그래야 화면 코드를
    한 줄도 안 고치고 그대로 씁니다 (개요 탭 · 밸류에이션 탭 · AI 분석). */
function shapePplx(g: any, code: string, market: string, name: string,
                   sources: string[], invoked: number) {
  const n = (v: any) => {
    const x = Number(v);
    return Number.isFinite(x) && x !== 0 ? x : null;
  };
  const score = n(g.rating_score);
  return {
    found: true, ticker: code, market,
    //  ⚠️ 어디서 온 값인지 반드시 남깁니다 — 화면이 딱지를 붙입니다
    source: "pplx", sources, invocations: invoked,
    general: {
      name: name || null, code, exchange: market === "KR" ? "KRX" : "US",
      currency: g.currency ?? (market === "KR" ? "KRW" : "USD"),
      sector: g.sector ?? null, industry: g.industry ?? null,
      country: market === "KR" ? "Korea" : "USA",
      description: null, employees: null, ipo: null, web: null,
      fiscal_year_end: null, is_delisted: false, officers: [],
    },
    highlights: {
      market_cap: n(g.market_cap), pe: n(g.pe), peg: null,
      eps: n(g.eps_ttm), eps_est_cy: n(g.eps_est_cy), eps_est_ny: n(g.eps_est_ny),
      eps_est_nq: null, eps_est_cq: null,
      revenue_ttm: n(g.revenue_ttm), ebitda: null, book_value: null,
      dividend_yield: null, dividend_share: null,
      profit_margin: null, op_margin: null, roe: null, roa: null,
    },
    /*  ⚠️ 아래 칸 이름은 shapeFundamentals 와 <한 글자도 다르면 안 됩니다>.
        화면(renderProfile)이 d.technicals.beta 처럼 바로 읽기 때문에, 칸이
        하나라도 없으면 «Cannot read properties of undefined» 로 개요 탭이
        통째로 빕니다. 실제로 처음에 그렇게 터졌습니다.
        Perplexity 가 안 주는 것은 <있는 자리에 null> 로 둡니다.           */
    valuation: {
      trailing_pe: n(g.pe), forward_pe: null,
      ps: n(g.ps), pb: n(g.pb), ev: null,
      ev_rev: null, ev_ebitda: n(g.ev_ebitda),
    },
    shares: {
      outstanding: n(g.shares_outstanding), float: null,
      pct_insiders: null, pct_institutions: null,
      short: null, short_ratio: null, short_pct: null,
    },
    technicals: {
      beta: null, high52: null, low52: null, ma50: null, ma200: null,
      short_ratio: null, short_pct: null,
    },
    dividends: {
      rate: null, yield: null, payout: null, ex_date: null,
      last_split: null, last_split_date: null,
    },
    ratings: {
      score, target: n(g.target_mean),
      target_high: n(g.target_high), target_low: n(g.target_low),
      analysts: n(g.analysts), text: g.rating_text ?? null,
      strong_buy: null, buy: null, hold: null, sell: null, strong_sell: null,
    },
    holders: { institutions: [], funds: [] },
    insiders: [],
    earnings: { history: [], trend: [] },
    coverage: {
      has_ratings: n(g.target_mean) != null || score != null,
      has_holders: false, has_insiders: false, has_estimates: false,
    },
    as_of: g.as_of ?? null,
    note: "컨센서스는 <검색으로 받아온 참고값> 입니다 (Perplexity). "
        + "거래소 원본이 아니며 <b>체결 가격에는 쓰이지 않습니다</b>. "
        + "발표에 쓰기 전에 아래 출처에서 직접 확인하세요.",
  };
}

async function eodFundamentals(code: string, market: string, name = "") {
  /*  ⚠️ EODHD 키가 아예 없으면 403 을 받아보러 갈 것도 없습니다.
      바로 예비 창구로 갑니다.                                          */
  if (!eodKey()) {
    if (pplxOn()) return await pplxConsensus(code, market, name);
    return { found: false, plan_blocked: true,
             note: "EODHD 키도 Perplexity 키도 없습니다. 둘 중 하나를 Secrets 에 넣어주세요." };
  }
  const t = eodTicker(code, market);
  const url = `https://eodhd.com/api/fundamentals/${encodeURIComponent(t)}`
            + `?api_token=${encodeURIComponent(eodKey())}&fmt=json`;
  const r = await fetch(url);
  if (r.status === 404) {
    //  코스피에 없으면 코스닥으로 한 번 더
    if (market === "KR" && t.endsWith(".KO")) {
      const alt = t.replace(/\.KO$/, ".KQ");
      const r2 = await fetch(url.replace(encodeURIComponent(t), encodeURIComponent(alt)));
      if (r2.ok) return shapeFundamentals(await r2.json(), alt, market);
    }
    //  EODHD 에 없는 종목이어도 Perplexity 는 알 수 있습니다
    if (pplxOn()) {
      const alt = await pplxConsensus(code, market, name);
      if (alt.found) return alt;
    }
    return { found: false, note: `EODHD 에 ${t} 자료가 없습니다.` };
  }
  /*  ⚠️ 던지면 안 됩니다.

      「개요 · 컨센서스」는 EODHD 의 <Fundamentals> 창구를 씁니다. 이건
      요금제가 갈립니다 — 싼 요금제에서는 403 이 옵니다. 그런데 예전에는
      여기서 예외를 던져서 탭 전체가 빨간 줄 하나만 남았습니다.
      ("EODHD 조회 실패 (403)." — 무엇을 해야 하는지 알 수가 없습니다)

      개요가 없어도 <재무제표 · 밸류에이션 · 주가 · 공시 · 13F> 는 전부
      됩니다. 주식 수도 SEC·DART 에서 따로 받습니다. 그러니 없으면
      없는 대로 두고, 무엇이 없고 무엇을 해야 하는지만 적어줍니다.        */
  if (!r.ok) {
    const why = r.status === 403 || r.status === 401
      ? `지금 EODHD 요금제에 <b>기업 개요·컨센서스</b>가 들어 있지 않습니다 (${r.status}). `
        + "EODHD 의 <b>Fundamentals</b> 요금제부터 열립니다. "
        + "이게 없어도 <b>재무제표 · 밸류에이션 · 주가 · 공시 · 기관보유</b>는 그대로 됩니다 — "
        + "애널리스트 목표주가와 컨센서스, 회사 개요만 비어 있습니다."
      : r.status === 402
      ? "EODHD 하루 요청 한도를 다 썼습니다 (402). 내일 다시 됩니다."
      : r.status === 429
      ? "EODHD 요청이 너무 잦습니다 (429). 잠시 뒤 다시 눌러주세요."
      : `EODHD 조회 실패 (${r.status}).`;
    console.warn("EODHD fundamentals", r.status, t);
    /*  ⚠️ 요금제 때문에 막힌 것이면 <여기서 끝내지 않습니다>. 예비 창구가
        있으면 그쪽으로 갑니다 — 학회원 눈에는 그냥 «되는» 것이 됩니다.
        한도 초과(402)·과다호출(429)도 마찬가지로 넘깁니다.              */
    const blocked = r.status === 403 || r.status === 401;
    if ((blocked || r.status === 402 || r.status === 429) && pplxOn()) {
      const alt = await pplxConsensus(code, market, name);
      if (alt.found) return alt;
    }
    return { found: false, note: why, plan_blocked: blocked };
  }
  return shapeFundamentals(await r.json(), t, market);
}

function shapeFundamentals(d: any, ticker: string, market: string) {
  const G = d?.General ?? {};
  const H = d?.Highlights ?? {};
  const V = d?.Valuation ?? {};
  const S = d?.SharesStats ?? {};
  const T = d?.Technicals ?? {};
  const A = d?.AnalystRatings ?? {};
  const SD = d?.SplitsDividends ?? {};

  const inst  = idxRows(d?.Holders?.Institutions, 40);
  const funds = idxRows(d?.Holders?.Funds, 40);
  const ins   = idxRows(d?.InsiderTransactions, 60);

  //  실적 추정 흐름 — 분기 기준으로 정리
  const trendRaw = d?.Earnings?.Trend ?? {};
  const trend = idxRows(trendRaw, 12).length
    ? idxRows(trendRaw, 12)
    : Object.keys(trendRaw).sort().slice(-8).map((k) => trendRaw[k]);

  const histRaw = d?.Earnings?.History ?? {};
  const hist = Object.keys(histRaw).sort().slice(-12).map((k) => histRaw[k]);

  return {
    found: true, ticker, market,
    general: {
      name: G.Name ?? null, code: G.Code ?? null, exchange: G.Exchange ?? null,
      country: G.CountryName ?? null, currency: G.CurrencyCode ?? null,
      sector: G.Sector ?? null, industry: G.Industry ?? null,
      gic_sector: G.GicSector ?? null, gic_industry: G.GicIndustry ?? null,
      description: G.Description ?? null,
      employees: numOrNull(G.FullTimeEmployees),
      ipo: G.IPODate ?? null, web: G.WebURL ?? null,
      fiscal_year_end: G.FiscalYearEnd ?? null,
      is_delisted: !!G.IsDelisted,
      officers: idxRows(G.Officers, 8).map((o: any) => ({
        name: o?.Name ?? null, title: o?.Title ?? null, born: o?.YearBorn ?? null })),
    },
    highlights: {
      market_cap: numOrNull(H.MarketCapitalization),
      ebitda: numOrNull(H.EBITDA), pe: numOrNull(H.PERatio), peg: numOrNull(H.PEGRatio),
      book_value: numOrNull(H.BookValue),
      dividend_yield: numOrNull(H.DividendYield), dividend_share: numOrNull(H.DividendShare),
      eps: numOrNull(H.EarningsShare), eps_est_cy: numOrNull(H.EPSEstimateCurrentYear),
      eps_est_ny: numOrNull(H.EPSEstimateNextYear), eps_est_nq: numOrNull(H.EPSEstimateNextQuarter),
      eps_est_cq: numOrNull(H.EPSEstimateCurrentQuarter),
      profit_margin: numOrNull(H.ProfitMargin), op_margin: numOrNull(H.OperatingMarginTTM),
      roa: numOrNull(H.ReturnOnAssetsTTM), roe: numOrNull(H.ReturnOnEquityTTM),
      revenue_ttm: numOrNull(H.RevenueTTM), gross_profit_ttm: numOrNull(H.GrossProfitTTM),
      rev_growth_yoy: numOrNull(H.QuarterlyRevenueGrowthYOY),
      eps_growth_yoy: numOrNull(H.QuarterlyEarningsGrowthYOY),
      wall_street_target: numOrNull(H.WallStreetTargetPrice),
    },
    valuation: {
      trailing_pe: numOrNull(V.TrailingPE), forward_pe: numOrNull(V.ForwardPE),
      ps: numOrNull(V.PriceSalesTTM), pb: numOrNull(V.PriceBookMRQ),
      ev: numOrNull(V.EnterpriseValue),
      ev_rev: numOrNull(V.EnterpriseValueRevenue), ev_ebitda: numOrNull(V.EnterpriseValueEbitda),
    },
    shares: {
      outstanding: numOrNull(S.SharesOutstanding), float: numOrNull(S.SharesFloat),
      pct_insiders: numOrNull(S.PercentInsiders), pct_institutions: numOrNull(S.PercentInstitutions),
      short: numOrNull(S.SharesShort), short_ratio: numOrNull(S.ShortRatio),
      short_pct: numOrNull(S.ShortPercentOutstanding),
    },
    technicals: {
      beta: numOrNull(T.Beta),
      high52: numOrNull(T["52WeekHigh"]), low52: numOrNull(T["52WeekLow"]),
      ma50: numOrNull(T["50DayMA"]), ma200: numOrNull(T["200DayMA"]),
    },
    dividends: {
      rate: numOrNull(SD.ForwardAnnualDividendRate),
      yield: numOrNull(SD.ForwardAnnualDividendYield),
      payout: numOrNull(SD.PayoutRatio),
      ex_date: SD.ExDividendDate ?? null,
      last_split: SD.LastSplitFactor ?? null, last_split_date: SD.LastSplitDate ?? null,
    },
    ratings: {
      //  1 = 강한 매도 … 5 = 강한 매수 (문자열이 아니라 점수입니다)
      score: numOrNull(A.Rating), target: numOrNull(A.TargetPrice),
      strong_buy: numOrNull(A.StrongBuy), buy: numOrNull(A.Buy),
      hold: numOrNull(A.Hold), sell: numOrNull(A.Sell), strong_sell: numOrNull(A.StrongSell),
    },
    holders: {
      institutions: inst.map((x: any) => ({
        name: x?.name ?? null, date: x?.date ?? null,
        pct_of_company: numOrNull(x?.totalShares),      // 이 종목 지분율
        pct_of_portfolio: numOrNull(x?.totalAssets),    // 그 기관 포트폴리오 내 비중
        shares: numOrNull(x?.currentShares),
        change: numOrNull(x?.change), change_pct: numOrNull(x?.change_p),
      })),
      funds: funds.map((x: any) => ({
        name: x?.name ?? null, date: x?.date ?? null,
        pct_of_company: numOrNull(x?.totalShares),
        pct_of_portfolio: numOrNull(x?.totalAssets),
        shares: numOrNull(x?.currentShares),
        change: numOrNull(x?.change), change_pct: numOrNull(x?.change_p),
      })),
    },
    insiders: ins.map((x: any) => ({
      date: x?.transactionDate ?? x?.date ?? null,
      name: x?.ownerName ?? null, code: x?.transactionCode ?? null,
      acq_disp: x?.transactionAcquiredDisposed ?? null,
      qty: numOrNull(x?.transactionAmount), price: numOrNull(x?.transactionPrice),
      after: numOrNull(x?.postTransactionAmount), link: x?.secLink ?? null,
    })),
    earnings: {
      history: hist.map((x: any) => ({
        date: x?.reportDate ?? x?.date ?? null, period: x?.date ?? null,
        eps_actual: numOrNull(x?.epsActual), eps_est: numOrNull(x?.epsEstimate),
        surprise_pct: numOrNull(x?.surprisePercent),
      })),
      /*  실적 추정.
          EPS 만 싣던 것을 매출 추정까지 같이 싣습니다 — 밸류에이션 탭에서
          '애널리스트가 보는 성장률' 을 그대로 가정으로 쓰기 위해서입니다.   */
      trend: trend.map((x: any) => ({
        date: x?.date ?? null, period: x?.period ?? null,
        eps_avg: numOrNull(x?.earningsEstimateAvg),
        eps_low: numOrNull(x?.earningsEstimateLow), eps_high: numOrNull(x?.earningsEstimateHigh),
        analysts: numOrNull(x?.earningsEstimateNumberOfAnalysts),
        eps_growth: numOrNull(x?.earningsEstimateGrowth),
        eps_yr_ago: numOrNull(x?.earningsEstimateYearAgoEps),
        rev_avg: numOrNull(x?.revenueEstimateAvg),
        rev_low: numOrNull(x?.revenueEstimateLow), rev_high: numOrNull(x?.revenueEstimateHigh),
        rev_analysts: numOrNull(x?.revenueEstimateNumberOfAnalysts),
        rev_growth: numOrNull(x?.revenueEstimateGrowth),
        rev_yr_ago: numOrNull(x?.revenueEstimateYearAgoSales),
        eps_now: numOrNull(x?.epsTrendCurrent),
        eps_7d: numOrNull(x?.epsTrend7daysAgo),
        eps_30d: numOrNull(x?.epsTrend30daysAgo), eps_60d: numOrNull(x?.epsTrend60daysAgo),
        eps_90d: numOrNull(x?.epsTrend90daysAgo),
        up7: numOrNull(x?.epsRevisionsUpLast7days), down7: numOrNull(x?.epsRevisionsDownLast7days),
        up30: numOrNull(x?.epsRevisionsUpLast30days),
        down30: numOrNull(x?.epsRevisionsDownLast30days),
      })),
    },
    coverage: {
      has_ratings: !!(A && Object.keys(A).length && numOrNull(A.Rating) != null),
      has_holders: inst.length > 0 || funds.length > 0,
      has_insiders: ins.length > 0,
      has_estimates: trend.length > 0,
    },
    note: (market === "KR" && !(inst.length || ins.length))
      ? "국내 종목은 기관·내부자 자료가 미국 SEC 공시에서 나오는 값이라 비어 있습니다. 지분 정보는 DART 쪽 '지분·배당' 탭을 보세요."
      : null,
  };
}