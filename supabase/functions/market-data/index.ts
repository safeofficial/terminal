// ═══════════════════════════════════════════════════════════════
//  SAFE Terminal — market-data Edge Function
//
//  Supabase → Edge Functions → market-data → 코드 전체 교체 → Deploy
//
//  Secrets (Edge Functions → Secrets)
//    FRED_API_KEY     fred.stlouisfed.org        (미국 경제지표)
//    ECOS_API_KEY     ecos.bok.or.kr             (한국 경제지표)
//    TWELVE_API_KEY   twelvedata.com             (미국 주가)
//    DATA_GO_KR_KEY   data.go.kr                 (국내 주가)
// ═══════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const CACHE_HOURS = 6;

/*  ⚠️ FRED 가 발표 일정을 안 주는 보고서(OECD 경유 계열 등)가 있습니다.
    그때는 «며칠 지났나» 로 판단합니다. 7일이면 주간 지표도 한 번은
    다시 받고, 월간 지표를 네 번씩 다시 받지도 않습니다.                */
const WARM_TTL_DAYS = 7;

/*  ── 같은 것을 동시에 부르면 한 번만 ─────────────────────────

    ⚠️ 이 지도는 <이 실행 인스턴스> 안에서만 유효합니다. Supabase 가
       인스턴스를 여러 개 띄우면 그만큼은 따로 나갑니다. 그래도 한 인스턴스
       안에서 15번이 1번이 되는 것만으로 충분히 큽니다.
    ⚠️ 실패해도 반드시 지도에서 지웁니다. 안 지우면 «한 번 실패한 지표는
       영원히 실패» 하게 됩니다.                                        */
const inFlight = new Map<string, Promise<any>>();
function onceKey<T>(key: string, run: () => Promise<T>): Promise<T> {
  const cur = inFlight.get(key);
  if (cur) return cur as Promise<T>;
  const p = run().finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p as Promise<T>;
}

/*  ── 보관함 판 번호 ──────────────────────────────────────────

    계산하는 방법을 바꾸면 이 숫자를 올려야 합니다. 안 올리면 예전 방식으로
    계산해 담아둔 값이 그대로 나옵니다 — 코드는 고쳤는데 화면은 그대로인
    상황이 됩니다. (PCE 세부항목이 "+300%" 로 계속 나온 게 이것이었습니다.
    보관함 규칙이 '다음 발표까지' 라서 한 달을 그대로 들고 있었습니다)

    TREE_SCHEMA   발표 표의 뼈대. 항목에 붙이는 표시가 바뀌면 올립니다.
    REPORT_SCHEMA 항목별 값과 변화율. 재는 방법이 바뀌면 올립니다.

    v2 / v3 — 이미 변화율인 표(BEA "Percent Change from …")를 가려내고,
              그런 항목은 비율이 아니라 차이(%p)로 재도록 바꾸면서 올림.  */
const TREE_SCHEMA = "v2";
const REPORT_SCHEMA = "v3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// 비밀값을 읽을 때 앞뒤 공백·줄바꿈을 제거합니다 (복사 실수 방지)
function secret(name: string) {
  return (Deno.env.get(name) ?? "").trim();
}

// ── FRED (미국 경제지표) ──────────────────────
async function fetchFred(code: string, start: string) {
  const key = secret("FRED_API_KEY");
  if (!key) throw new Error("FRED_API_KEY 가 설정되지 않았습니다. Edge Functions → Secrets 에서 추가하세요.");
  if (!/^[a-z0-9]{32}$/.test(key)) {
    throw new Error(`FRED_API_KEY 형식이 잘못되었습니다. 소문자+숫자 32글자여야 하는데 현재 ${key.length}글자입니다.`);
  }

  /*  ⚠️ 반드시 fredGet 을 거쳐야 합니다.

      예전에는 여기서 fetch 를 바로 불렀습니다. 그런데 속도 제한기(분당 100)는
      fredGet 안에 있어서, 이 경로로 나가는 호출은 세어지지도 기다리지도
      않았습니다. 매크로 탭에서 지표를 여섯 개 그리면 여섯 번이 제한기 밖으로
      나가고, 그 위에 보고서 루프가 겹치면서 FRED 실제 한도(분당 120)를 넘겨
      429 를 맞았습니다 — "세부항목이 하나도 안 나온다" 가 이것이었습니다.

      FRED 를 부르는 곳은 전부 fredGet 하나로 모읍니다.                    */
  const d = await fredGet("series/observations", {
    series_id: code, observation_start: start,
  });

  if (!Array.isArray(d.observations)) {
    throw new Error("FRED 응답에 observations 가 없습니다: " + JSON.stringify(d).slice(0, 200));
  }

  return d.observations
    .filter((o: any) => o.value !== "." && o.value !== "")
    .map((o: any) => ({ d: o.date, v: Number(o.value) }))
    .filter((p: any) => Number.isFinite(p.v));
}

// ── ECOS (한국은행) ───────────────────────────
function ecosDate(iso: string, cycle: string) {
  const [y, m] = iso.split("-");
  const dd = iso.split("-")[2];
  if (cycle === "D") return `${y}${m}${dd}`;
  if (cycle === "M") return `${y}${m}`;
  if (cycle === "Q") return `${y}Q${Math.floor((Number(m) - 1) / 3) + 1}`;
  return y;
}

function ecosToIso(t: string) {
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-01`;
  if (/^\d{4}Q[1-4]$/.test(t)) {
    const q = Number(t[5]);
    return `${t.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  }
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  return t;
}

async function fetchEcos(code: string, itemCode: string, cycle: string, start: string) {
  const key = secret("ECOS_API_KEY");
  if (!key) throw new Error("ECOS_API_KEY 가 설정되지 않았습니다. 한국 지표를 쓰려면 Secrets 에 추가하세요.");

  const s = ecosDate(start, cycle);
  const e = ecosDate(new Date().toISOString().slice(0, 10), cycle);

  //  통계표에 따라 항목 축이 둘 이상입니다 (예: 품목 × 지역).
  //  그럴 때는 "A/B" 처럼 빗금으로 이어 붙여 넘길 수 있게 해둡니다.
  const parts = String(itemCode || "").split("/").map((x) => x.trim()).filter(Boolean);
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/100000/` +
              `${code}/${cycle}/${s}/${e}` + (parts.length ? "/" + parts.join("/") : "");

  const r = await fetch(url);
  if (!r.ok) throw new Error(`ECOS 응답 오류 (${r.status})`);

  const d = await r.json();
  if (d.RESULT?.CODE) {
    throw new Error(`ECOS: ${d.RESULT.MESSAGE ?? d.RESULT.CODE} — 통계표코드(${code})와 항목코드(${itemCode})를 확인하세요.`);
  }

  const rows = d.StatisticSearch?.row;
  if (!Array.isArray(rows)) {
    throw new Error("ECOS 응답에 데이터가 없습니다. 통계표코드와 주기를 확인하세요.");
  }

  //  축을 하나만 지정했는데 표에 축이 더 있으면, 같은 날짜가 여러 번 옵니다.
  //  그대로 그리면 선이 톱니처럼 오르내려 완전히 잘못된 그림이 됩니다.
  //  그래서 조합 하나만 골라 그리고, 무슨 일이 있었는지 알려줍니다.
  const comboOf = (o: any) =>
    [o.ITEM_CODE1, o.ITEM_CODE2, o.ITEM_CODE3, o.ITEM_CODE4].filter(Boolean).join("/");
  const nameOf = (o: any) =>
    [o.ITEM_NAME1, o.ITEM_NAME2, o.ITEM_NAME3, o.ITEM_NAME4].filter(Boolean).join(" · ");

  const byCombo: Record<string, any[]> = {};
  for (const o of rows) (byCombo[comboOf(o)] = byCombo[comboOf(o)] || []).push(o);
  const combos = Object.keys(byCombo);

  let use = rows, note: string | null = null;
  if (combos.length > 1) {
    combos.sort((x, y) => byCombo[y].length - byCombo[x].length);
    use = byCombo[combos[0]];
    note = `이 통계표는 항목 축이 여러 개라 ${combos.length}가지 조합이 왔습니다. `
         + `그중 "${nameOf(use[0]) || combos[0]}" 하나만 그렸습니다. `
         + `다른 축까지 지정하려면 항목코드를 "${combos[0]}" 처럼 빗금으로 이어 붙이세요.`;
  }

  const points = use
    .map((o: any) => ({ d: ecosToIso(String(o.TIME)), v: Number(o.DATA_VALUE) }))
    .filter((p: any) => Number.isFinite(p.v))
    .sort((x: any, y: any) => x.d.localeCompare(y.d));

  return { points, note, unit: use[0]?.UNIT_NAME ?? "" };
}

// ── 미국 주가 (Twelve Data) ───────────────────
//  EODHD 를 구독했다면 미국 시세는 전부 거기서 받습니다.
//  분당 호출 제한이 없어서 500종목을 돌려도 막히지 않습니다.
async function fetchQuoteEodhd(symbol: string, start: string) {
  const key = secret("EODHD_API_KEY");
  if (!key) return null;
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol.replace(/\./g, "-"))}.US`
            + `?api_token=${encodeURIComponent(key)}&fmt=json&period=d&from=${start}`;
  const r = await fetch(url);
  if (r.status === 404) return [];
  /*  ⚠️ 던지지 않습니다.
      EODHD 는 무료 요금제에서 하루 한도(402)나 권한(423)에 자주 걸립니다.
      예전에는 여기서 예외를 던져서, 뒤에 있는 Alpaca·Twelve Data 를
      아예 못 써보고 차트가 통째로 비었습니다. 이제 비었다고만 알리고
      다음 창구로 넘어갑니다.                                            */
  if (!r.ok) { console.warn("EODHD 조회 실패", r.status, symbol); return []; }
  const rows = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((o: any) => ({
      d: String(o.date),
      v: Number(o.adjusted_close ?? o.close),
      o: Number(o.open), h: Number(o.high),
      l: Number(o.low),  q: Number(o.volume ?? 0),
    }))
    .filter((p: any) => Number.isFinite(p.v) && p.v > 0)
    .sort((a: any, b: any) => a.d.localeCompare(b.d));
}

/*  Alpaca 일봉을 차트용 모양으로. 무료 요금제로 7년치까지 옵니다.  */
async function fetchQuoteAlpacaUS(symbol: string, start: string) {
  if (!alpacaKeys()) return [];
  try {
    const d: any = await alpGet(ALP_DATA, "/v2/stocks/bars", {
      symbols: symbol.toUpperCase(), timeframe: "1Day", start,
      limit: "10000", feed: "iex", adjustment: "all",
    });
    const bars = d?.bars?.[symbol.toUpperCase()] ?? [];
    return bars
      .map((b: any) => ({ d: String(b.t ?? "").slice(0, 10), v: Number(b.c),
                          o: Number(b.o), h: Number(b.h), l: Number(b.l), q: Number(b.v ?? 0) }))
      .filter((x: any) => Number.isFinite(x.v) && x.v > 0);
  } catch (e) {
    console.warn("Alpaca 봉 조회 실패", symbol, String((e as any)?.message ?? e));
    return [];
  }
}

/*  ── 미국 지난 시세 ──────────────────────────────────────────
    Alpaca 를 먼저 봅니다. 이미 열쇠가 있고, 무료로 분당 200회에
    7년치를 줍니다. EODHD 는 무료 요금제에서 하루 한도(402)에 걸려
    차트가 안 나오는 일이 잦았습니다.                                  */
async function fetchQuoteUS(symbol: string, start: string) {
  const viaAlpaca = await fetchQuoteAlpacaUS(symbol, start);
  if (viaAlpaca.length) return viaAlpaca;

  const viaEodhd = await fetchQuoteEodhd(symbol, start);
  if (viaEodhd && viaEodhd.length) return viaEodhd;

  const key = secret("TWELVE_API_KEY");
  if (!key) throw new Error(
    "미국 시세를 받을 키가 없습니다. EODHD_API_KEY 또는 TWELVE_API_KEY 를 Secrets 에 넣어주세요.");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("start_date", start);
  url.searchParams.set("apikey", key);
  url.searchParams.set("outputsize", "5000");

  const r = await fetch(url);
  const d = await r.json();
  if (d.status === "error") throw new Error(`Twelve Data: ${d.message ?? "조회 실패"} — 티커(${symbol})를 확인하세요.`);

  const rows = d.values;
  if (!Array.isArray(rows)) throw new Error(`티커(${symbol}) 조회 결과가 없습니다.`);

  return rows
    .map((o: any) => ({
      d: o.datetime,
      v: Number(o.close),
      o: Number(o.open), h: Number(o.high),
      l: Number(o.low),  q: Number(o.volume ?? 0),
    }))
    .filter((p: any) => Number.isFinite(p.v))
    .reverse();
}

// ── 국내 주가 (공공데이터포털) ────────────────
async function fetchQuoteKR(symbol: string, start: string) {
  const key = secret("DATA_GO_KR_KEY");
  if (!key) throw new Error("DATA_GO_KR_KEY 가 설정되지 않았습니다. data.go.kr 에서 무료 신청 후 Secrets 에 추가하세요.");

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const from = start.replace(/-/g, "");

  // 인증키가 Encoding(% 포함) 이든 Decoding 이든 둘 다 동작합니다
  const svc = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);

  const url = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo"
            + `?serviceKey=${svc}`
            + `&resultType=json&numOfRows=3000`
            + `&beginBasDt=${from}&endBasDt=${today}`
            + `&likeSrtnCd=${encodeURIComponent(symbol)}`;

  const r = await fetch(url);
  const text = await r.text();
  let d: any;
  try { d = JSON.parse(text); }
  catch { throw new Error("공공데이터포털 응답을 읽지 못했습니다. 서비스키가 맞는지 확인하세요."); }

  const items = d?.response?.body?.items?.item;
  if (!items) throw new Error(`종목코드(${symbol}) 조회 결과가 없습니다. 6자리 코드인지 확인하세요.`);

  const rows = Array.isArray(items) ? items : [items];
  return rows
    .map((o: any) => ({
      d: String(o.basDt).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      v: Number(o.clpr),
      o: Number(o.mkp),
      h: Number(o.hipr),
      l: Number(o.lopr),
      q: Number(o.trqu ?? 0),
      n: o.itmsNm,
    }))
    .filter((p: any) => Number.isFinite(p.v))
    .sort((a: any, b: any) => a.d.localeCompare(b.d));
}


// ══════════════════════════════════════════════
//  거래대금 상위 종목 자동 등록
//
//    국내: data.go.kr 이 하루치 전 종목을 한 번에 줍니다.
//          그 안에 거래대금(trPrc) 과 시장구분(mrktCtg) 이 들어 있어서
//          코스피 + 코스닥을 합쳐 상위 N 개를 뽑을 수 있습니다.
//    미국: EODHD 의 bulk EOD 가 하루치 전 종목을 한 번에 줍니다.
//          키가 없으면 S&P500 명단 + 개별 조회로 대신합니다.
// ══════════════════════════════════════════════

const TOP_N = 100;

function dgkKey() {
  const key = secret("DATA_GO_KR_KEY");
  if (!key) throw new Error("DATA_GO_KR_KEY 가 설정되지 않았습니다.");
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}
function ymd(d: Date) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function iso(y: string) { return y.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"); }

// 우선주 · 스팩 · 리츠처럼 대회에 맞지 않는 종목은 빼둡니다
function skipKrName(name: string) {
  return /스팩|제[0-9]+호|리츠$/.test(name) || /(우|우B|우C|[0-9]우[A-C])$/.test(name);
}

// 하루치 전 종목 — 필요하면 페이지를 넘겨가며 모읍니다
async function krMarketDay(basDt: string) {
  const base = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo"
             + `?serviceKey=${dgkKey()}&resultType=json&numOfRows=4000&basDt=${basDt}`;
  const out: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`${base}&pageNo=${page}`);
    const text = await r.text();
    let d: any;
    try { d = JSON.parse(text); }
    catch { throw new Error("공공데이터포털 응답을 읽지 못했습니다. 서비스키를 확인하세요."); }
    const body = d?.response?.body;
    const items = body?.items?.item;
    if (!items) break;
    const rows = Array.isArray(items) ? items : [items];
    out.push(...rows);
    if (out.length >= Number(body?.totalCount ?? 0)) break;
    if (rows.length === 0) break;
  }
  return out;
}

// 최근 영업일을 찾을 때까지 하루씩 거슬러 올라갑니다 (주말·공휴일 대비)
async function krLatestDay(back = 0) {
  for (let i = back; i < back + 8; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rows = await krMarketDay(ymd(d));
    if (rows.length) return { basDt: ymd(d), rows };
  }
  throw new Error("최근 영업일 시세를 찾지 못했습니다.");
}

//  topN 이 0 이면 <자르지 않음> 입니다 (미국과 같은 약속).
async function syncUniverseKR(admin: any, topN = TOP_N) {
  const { basDt, rows } = await krLatestDay();
  const picked = rows
    .filter((o: any) => ["KOSPI", "KOSDAQ"].includes(String(o.mrktCtg || "").toUpperCase()))
    .filter((o: any) => !skipKrName(String(o.itmsNm || "")))
    .filter((o: any) => Number(o.trPrc) > 0 && Number(o.clpr) > 0)
    .sort((a: any, b: any) => Number(b.trPrc) - Number(a.trPrc));
  const picked2 = topN > 0 ? picked.slice(0, topN) : picked;

  const uni = picked2.map((o: any, i: number) => ({
    symbol: String(o.srtnCd).padStart(6, "0"),
    name: o.itmsNm, rank: i + 1, tr_value: Number(o.trPrc),
  }));
  const { error: e1 } = await admin.rpc("universe_auto_replace",
    { p_market: "KR", p_rows: uni, p_as_of: iso(basDt) });
  if (e1) throw new Error(`종목 등록 실패: ${e1.message}`);

  // 그날 종가는 이미 손에 있으니 같이 저장합니다
  const prices = picked2.map((o: any) => ({
    market: "KR", symbol: String(o.srtnCd).padStart(6, "0"),
    d: iso(basDt), v: Number(o.clpr), name: o.itmsNm,
  }));
  await admin.rpc("price_bulk_upsert", { p_rows: prices });

  return { market: "KR", as_of: iso(basDt), scanned: rows.length, picked: uni.length,
           top: uni.slice(0, 5).map((x: any) => x.name) };
}

// 지난 날짜들을 거슬러 올라가며 종가만 채웁니다 (백테스트용)
async function backfillKR(admin: any, days: number) {
  let saved = 0, hit = 0;
  const want = new Set((await uniList(admin)).filter((x: any) => x.market === "KR")
                        .map((x: any) => x.symbol));
  for (let i = 1; i <= days && hit < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rows = await krMarketDay(ymd(d));
    if (!rows.length) continue;
    hit++;
    const px = rows
      .filter((o: any) => want.has(String(o.srtnCd).padStart(6, "0")))
      .filter((o: any) => Number(o.clpr) > 0)
      .map((o: any) => ({ market: "KR", symbol: String(o.srtnCd).padStart(6, "0"),
                          d: iso(String(o.basDt)), v: Number(o.clpr), name: o.itmsNm }));
    if (px.length) {
      const { data } = await admin.rpc("price_bulk_upsert", { p_rows: px });
      saved += Number(data || 0);
    }
  }
  return { market: "KR", days_fetched: hit, rows_saved: saved };
}

// ── 미국 ────────────────────────────────────
//   EODHD bulk 한 번이면 그날 미국 전 종목이 들어옵니다.

/*  EODHD 응답 코드를 사람 말로 옮깁니다. 화면에 '423' 만 뜨면
    무엇을 해야 하는지 알 수가 없습니다.                              */
function eodhdWhy(status: number) {
  if (status === 401 || status === 403)
    return "EODHD 키가 잘못됐거나 만료됐습니다 (" + status + ").";
  if (status === 402)
    return "EODHD 하루 요청 한도를 다 썼습니다 (402). 내일 다시 됩니다.";
  if (status === 423)
    return "EODHD 요금제에 <b>벌크(하루치 전 종목)</b> 가 안 들어 있습니다 (423). "
         + "벌크는 무료 요금제에서 빠져 있습니다 — 유료로 올리거나, 시세 없이 명단만 쓰면 됩니다.";
  if (status === 429)
    return "EODHD 요청이 너무 잦습니다 (429). 잠시 뒤 다시 눌러주세요.";
  return "EODHD 조회 실패 (" + status + ").";
}

/*  ⚠️ 던지지 않습니다.

    미국 명단(S&P500 500종목)은 공개 CSV 에서 오고 열쇠가 필요 없습니다.
    EODHD 는 <그날 종가와 거래대금> 을 채우는 데만 씁니다. 그런데 예전에는
    벌크가 423 을 주면 통째로 예외를 던져서, 이미 잘 받아둔 500종목 명단까지
    등록이 안 됐습니다. 곁다리가 본 일을 막고 있던 셈입니다.
    이제 시세만 비우고 이유를 같이 돌려줍니다.                          */
async function eodhdBulkSoft(date?: string): Promise<{ rows: any[] | null; why: string | null }> {
  const key = secret("EODHD_API_KEY");
  if (!key) return { rows: null, why: "EODHD_API_KEY 가 없어 종가를 채우지 못했습니다." };
  const q = `api_token=${encodeURIComponent(key)}&fmt=json` + (date ? `&date=${date}` : "");
  let r: Response;
  try {
    r = await fetch(`https://eodhd.com/api/eod-bulk-last-day/US?${q}`);
  } catch (e) {
    return { rows: null, why: "EODHD 에 연결하지 못했습니다: " + String((e as any)?.message ?? e) };
  }
  if (!r.ok) return { rows: null, why: eodhdWhy(r.status) };
  const rows = await r.json();
  return Array.isArray(rows) ? { rows, why: null }
                             : { rows: null, why: "EODHD 응답 형식이 예상과 다릅니다." };
}

//  과거 시세 채우기는 벌크가 <본 일> 이라, 여기서는 안 되면 안 된다고 말합니다.
async function eodhdBulk(date?: string) {
  const { rows, why } = await eodhdBulkSoft(date);
  if (rows) return rows;
  if (!secret("EODHD_API_KEY")) return null;
  throw new Error(why ?? "EODHD 조회 실패.");
}

// S&P500 구성종목 — 공개 데이터셋(PDDL 라이선스). 키가 필요 없습니다.
const SP500_CSV =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

function csvRows(text: string) {
  // 따옴표 안의 쉼표를 지켜가며 한 줄씩 자릅니다 (회사명에 쉼표가 흔합니다)
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

async function sp500List() {
  const r = await fetch(SP500_CSV);
  if (!r.ok) throw new Error(`S&P500 명단을 받지 못했습니다 (${r.status}).`);
  const rows = csvRows(await r.text());
  if (rows.length < 2) throw new Error("S&P500 명단이 비어 있습니다.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const iSym = head.indexOf("symbol");
  const iNam = head.indexOf("security");
  if (iSym < 0) throw new Error("S&P500 명단 형식이 바뀌었습니다.");
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of rows.slice(1)) {
    const sym = String(c[iSym] ?? "").trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ symbol: sym, name: String(c[iNam] ?? sym).trim() });
  }
  return out;
}

//  종목코드 표기 차이를 흡수합니다.
//    저장 기준(그리고 개별 시세 조회) = BRK.B  ·  EODHD 벌크 = BRK-B
const toEodhd = (sym: string) => sym.replace(/\./g, "-");
const fromEodhd = (code: string) => code.replace(/-/g, ".");

//  미국 유니버스 = S&P500 전 종목.
//  EODHD 키가 있으면 그날 종가·거래대금까지 같이 채웁니다.
async function syncUniverseUS(admin: any, topN = 0) {
  const list = await sp500List();
  const want = new Map(list.map((x) => [x.symbol, x.name]));

  let asOf: string | null = null;
  let priced = 0;
  const turnover = new Map<string, number>();
  const closes: any[] = [];

  const { rows: bulk, why: bulkWhy } = await eodhdBulkSoft();
  if (bulk) {
    for (const o of bulk) {
      const sym = fromEodhd(String(o.code || "").toUpperCase());
      if (!want.has(sym)) continue;
      //  거래대금은 그날 실제로 오간 돈이므로 원주가 × 거래량으로 셉니다.
      //  보관하는 시세는 수정주가 — 액면분할 때 가짜 급락이 생기지 않게 합니다.
      const raw = Number(o.close);
      const adj = Number(o.adjusted_close ?? o.close);
      const vol = Number(o.volume ?? 0);
      if (!Number.isFinite(adj) || adj <= 0) continue;
      asOf = asOf || String(o.date);
      if (Number.isFinite(raw) && raw > 0) turnover.set(sym, raw * vol);
      closes.push({ market: "US", symbol: sym, d: String(o.date), v: adj, name: want.get(sym) });
    }
    priced = closes.length;
  }

  //  거래대금 순위는 참고용입니다 — 명단 자체는 500개 전부 등록합니다.
  let rows = list.map((x) => ({
    symbol: x.symbol, name: x.name, tr_value: turnover.get(x.symbol) ?? null,
  }));
  rows.sort((a, b) => (Number(b.tr_value ?? -1)) - (Number(a.tr_value ?? -1)));
  if (topN > 0) rows = rows.slice(0, topN);
  rows = rows.map((x, i) => ({ ...x, rank: i + 1 }));

  const { error } = await admin.rpc("universe_auto_replace", {
    p_market: "US", p_rows: rows, p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(`종목 등록 실패: ${error.message}`);

  if (closes.length) await admin.rpc("price_bulk_upsert", { p_rows: closes });

  return {
    market: "US", as_of: asOf ?? null, scanned: list.length, picked: rows.length, priced,
    top: rows.slice(0, 5).map((x: any) => x.symbol),
    note: bulk ? null
      : (bulkWhy ?? "") + " 명단 " + rows.length + "종목은 그대로 등록했습니다 — "
      + "매매와 전략에는 문제가 없고, 종가는 '과거 시세 채우기' 나 개별 조회로 채워집니다.",
  };
}

async function backfillUS(admin: any, days: number) {
  const want = new Set((await uniList(admin)).filter((x: any) => x.market === "US")
                        .map((x: any) => x.symbol));
  let saved = 0, hit = 0;
  const seen = new Set<string>();
  for (let i = 1; i <= days * 2 && hit < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;   // 주말은 건너뜁니다
    const rows = await eodhdBulk(d.toISOString().slice(0, 10));
    if (!rows || !rows.length) continue;
    // 휴장일을 요청하면 직전 거래일이 돌아옵니다 — 같은 날을 두 번 세지 않습니다
    const got = String(rows[0]?.date ?? "");
    if (got && seen.has(got)) continue;
    if (got) seen.add(got);
    hit++;
    const px = rows
      .map((o: any) => ({ sym: fromEodhd(String(o.code || "").toUpperCase()), o }))
      .filter((x: any) => want.has(x.sym))
      .map((x: any) => ({ market: "US", symbol: x.sym,
                          d: String(x.o.date), v: Number(x.o.adjusted_close ?? x.o.close) }))
      .filter((o: any) => Number.isFinite(o.v) && o.v > 0);
    if (px.length) {
      const { data } = await admin.rpc("price_bulk_upsert", { p_rows: px });
      saved += Number(data || 0);
    }
  }
  return { market: "US", days_fetched: hit, rows_saved: saved };
}



/*  ── 서버가 표를 직접 읽습니다 ────────────────────────────────
    universe_scan() 과 crypto_pool_list() 는 브라우저에서 부르라고 만든
    함수라, 안에 "지금 로그인한 사람이 학회원인가" 검사가 들어 있습니다.
    Edge Function 은 service_role 로 붙기 때문에 로그인한 사람이 없고
    (auth.uid() 가 NULL), 그 검사에서 전부 걸러져 빈 목록이 돌아옵니다.

    그래서 "코인 후보 풀이 비어 있습니다" 라는, 사실이 아닌 안내가 떴습니다.
    표에는 179개가 멀쩡히 들어 있었습니다.

    SQL 쪽도 고쳤지만(terminal-종목등록수리.sql), 그걸 아직 안 돌렸어도
    돌아가도록 여기서는 표를 직접 읽습니다. service_role 은 RLS 를 지나칩니다. */
async function uniList(admin: any) {
  const { data, error } = await admin.from("universe")
    .select("market, symbol, name, rank").eq("active", true)
    .order("market").order("rank", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`허용 종목 목록을 읽지 못했습니다: ${error.message}`);
  return (data ?? []) as any[];
}

async function cryptoPool(admin: any) {
  const { data, error } = await admin.from("crypto_pool")
    .select("symbol, name").eq("enabled", true).order("symbol");
  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message))
      throw new Error("코인 후보 표(crypto_pool)가 없습니다. terminal-코인.sql 을 실행해 주세요.");
    throw new Error(`코인 후보 목록을 읽지 못했습니다: ${error.message}`);
  }
  return (data ?? []) as any[];
}


/* ══════════════════════════════════════════════════════════════
   개인이 살 수 있는 종목 전부 (tradable)

   universe 는 <자동매매가 훑을 목록> 입니다. 1만 종목을 5분마다
   지표까지 계산하며 훑을 수 없어서 상위 100 / S&P500 으로 줄여둡니다.

   그런데 그 표 하나로 <사람이 살 수 있는 목록> 까지 겸하고 있었습니다.
   그래서 TQQQ 도, 소형주도, 국내 ETF 도 "살 수 없는 종목" 이 됐습니다.
   손으로 사는 데는 제한이 있을 이유가 없습니다 — 여기서 그 명단을 받습니다.
   ══════════════════════════════════════════════════════════════ */

/*  ETF 인지, 레버리지인지는 이름을 보고 짐작합니다.

    Alpaca 는 ETF 를 따로 표시해 주지 않습니다 (전부 us_equity 입니다).
    그래서 발행사 이름과 상품명으로 가릅니다. 짐작이 틀려도 <표시가
    틀릴 뿐> 매매가 막히지는 않습니다 — 이 값은 화면에 딱지를 붙이는
    데만 쓰고, 무엇을 살 수 있는지는 전혀 건드리지 않습니다.          */
/*  ⚠️ 예전 판정은 너무 헐거웠습니다.

      · \bShares\b  → "Alibaba … American Depositary Shares",
                       "TSMC … Ordinary Shares" 처럼 <보통주 이름>에 흔한 말입니다.
                       그래서 미국 12,880 종목 중 7,255개가 ETF 로 잡혔습니다.
                       실제 미국 상장 ETF 는 4천 개 안팎입니다.
      · \bTrust\b   → "Northern Trust" 같은 은행·리츠가 딸려 들어옵니다.
      · Ultra ?…    → "Ultragenyx Pharmaceutical" 이 레버리지로 잡힙니다.
      · \bBull\b    → "Bull Horn Holdings" 가 레버리지로 잡힙니다.
      · 2X|3X       → 단어 경계가 없어 이름 아무 데나 걸립니다.

      이 값은 화면에 딱지를 붙이는 데만 쓰고 무엇을 살 수 있는지는 전혀
      건드리지 않지만, 틀린 딱지는 그 자체로 틀린 것입니다.
      이제 <발행사 이름> 과 <상품 표기> 로만 가립니다.                  */
const ETF_ISSUER =
  /^(ProShares|Direxion|iShares|SPDR|Invesco|Vanguard|VanEck|Global ?X|ARK |Schwab|WisdomTree|First Trust|Xtrackers|Pacer|ALPS|Innovator|Simplify|Tidal|Themes|KraneShares|Dimensional|Avantis|Sprott|abrdn|Bitwise|Grayscale|21Shares|Valkyrie|Hashdex|Roundhill|GraniteShares|Defiance|YieldMax|Amplify|T-Rex|Tradr|REX |Matthews|Goldman Sachs ETF|JPMorgan (Equity|Nasdaq|Ultra-Short|Betabuilders)|Fidelity (Covered|Enhanced|Wise|MSCI|Blue|Crypto))/i;
const ETF_WORD = /\bETFs?\b|\bETNs?\b|\bIndex Fund\b|\bIndex Trust\b|\bUCITS\b/i;

//  레버리지·인버스는 <배수 표기> 나 <분명한 낱말> 이 있을 때만.
const LEV_HINT =
  /\b[1-4](\.\d)?X\b|\bUltraPro\b|\bUltraShort\b|^ProShares Ultra\b|\bLeveraged\b|\bInverse\b|\bDaily\b.*\b(Bull|Bear)\b/i;

function usKind(name: string) {
  const n = String(name || "");
  const etf = ETF_ISSUER.test(n) || ETF_WORD.test(n);
  //  레버리지는 ETF 일 때만 뜻이 있습니다 (보통주에 3X 가 붙을 일은 없습니다)
  return { kind: etf ? "etf" : "stock", leveraged: etf && LEV_HINT.test(n) };
}

//  미국 — Alpaca 가 상장 전 종목·ETF 를 통째로 줍니다 (공식 창구입니다)
async function syncTradableUS(admin: any) {
  const rows = await alpGet(ALP_TRADE, "/v2/assets",
    { status: "active", asset_class: "us_equity" });
  if (!Array.isArray(rows)) throw new Error("Alpaca 종목 목록 형식이 예상과 다릅니다.");

  const out = rows
    //  tradable = 알파카에서 실제로 사고팔 수 있는 것.
    //  이것이 곧 "개인이 살 수 있는가" 의 기준입니다.
    .filter((a: any) => a?.tradable && a?.symbol)
    //  워런트·우선주 등 티커에 점이 붙는 것들은 시세 조회가 흔들려서 뺍니다
    .filter((a: any) => !/[.$]/.test(String(a.symbol)))
    .map((a: any) => {
      const k = usKind(a.name);
      return { symbol: String(a.symbol).toUpperCase(), name: a.name ?? a.symbol,
               kind: k.kind, leveraged: k.leveraged };
    });

  if (!out.length) throw new Error("Alpaca 가 종목을 하나도 주지 않았습니다.");
  const { data, error } = await admin.rpc("tradable_bulk_replace",
    { p_market: "US", p_rows: out });
  if (error) throw new Error(`미국 종목 저장 실패: ${error.message}`);

  return { market: "US", saved: Number(data ?? out.length), total: out.length,
           etf: out.filter((x) => x.kind === "etf").length,
           leveraged: out.filter((x) => x.leveraged).length,
           //  티커만 보여주면 맞는 딱지인지 알 수가 없습니다. 이름을 같이 냅니다.
           sample: out.filter((x) => x.leveraged).slice(0, 6)
             .map((x) => `${x.symbol} — ${x.name}`),
           etf_sample: out.filter((x) => x.kind === "etf" && !x.leveraged).slice(0, 3)
             .map((x) => `${x.symbol} — ${x.name}`) };
}

//  국내 — 공공데이터포털이 그날 상장 전 종목을 줍니다.
//  종가도 같이 손에 들어오므로 <전 종목> 을 시세 보관함에 넣습니다.
//  이게 있어야 어떤 국내 종목이든 평가액을 낼 수 있습니다.
async function syncTradableKR(admin: any) {
  const { basDt, rows } = await krLatestDay();
  const seen = new Set<string>();
  const out: any[] = [];
  const px: any[] = [];
  for (const o of rows) {
    const mk = String(o.mrktCtg || "").toUpperCase();
    if (!["KOSPI", "KOSDAQ", "KONEX"].includes(mk)) continue;
    const sym = String(o.srtnCd ?? "").padStart(6, "0");
    if (!sym || sym === "000000" || seen.has(sym)) continue;
    seen.add(sym);
    const nm = String(o.itmsNm ?? sym);
    //  국내는 ETF 도 같은 창구로 들어옵니다. 이름으로 가릅니다.
    const isEtf = /^(KODEX|TIGER|KBSTAR|ARIRANG|HANARO|SOL |ACE |PLUS |RISE |TIMEFOLIO|KOSEF|파워|마이다스|히어로즈)/i.test(nm)
               || /ETF|ETN/i.test(nm);
    const lev = /레버리지|인버스|2X|3X|곱버스/i.test(nm);
    out.push({ symbol: sym, name: nm, kind: isEtf ? "etf" : "stock", leveraged: lev });
    const close = Number(o.clpr);
    if (Number.isFinite(close) && close > 0)
      px.push({ market: "KR", symbol: sym, d: iso(basDt), v: close, name: nm });
  }

  if (!out.length) throw new Error("공공데이터포털이 종목을 하나도 주지 않았습니다.");
  const { data, error } = await admin.rpc("tradable_bulk_replace",
    { p_market: "KR", p_rows: out });
  if (error) throw new Error(`국내 종목 저장 실패: ${error.message}`);

  //  전 종목 종가 — 한 번에 넣으면 몸집이 크니 나눠 넣습니다
  let priced = 0;
  for (let i = 0; i < px.length; i += 1000) {
    const { data: n } = await admin.rpc("price_bulk_upsert", { p_rows: px.slice(i, i + 1000) });
    priced += Number(n ?? 0);
  }

  return { market: "KR", as_of: iso(basDt), saved: Number(data ?? out.length),
           total: out.length, etf: out.filter((x) => x.kind === "etf").length,
           leveraged: out.filter((x) => x.leveraged).length, priced };
}

//  코인 — 후보 풀이 곧 살 수 있는 목록입니다
async function syncTradableCrypto(admin: any) {
  const pool = await cryptoPool(admin);
  if (!pool.length) throw new Error("코인 후보가 없습니다. terminal-코인.sql 을 확인해 주세요.");

  /*  ⚠️ 후보 179개를 그대로 넣으면 안 됩니다.

      체결은 Alpaca 로 합니다. Alpaca 가 취급하는 코인은 20~30종뿐이라,
      179개를 명단에 넣으면 나머지 150개는 <검색에는 나오는데 사려고 하면
      "시세를 받지 못했습니다" 로 막히는> 종목이 됩니다. 살 수 있는 척만
      하는 셈입니다.

      그래서 Alpaca 가 실제로 값을 주는 것만 담습니다.                  */
  const bars = await alpBarsCrypto(pool.map((c: any) => c.symbol), "1Day")
    .catch(() => ({} as Record<string, any[]>));

  const out = pool
    .filter((c: any) => {
      const b = (bars as any)[String(c.symbol).toUpperCase()];
      return Array.isArray(b) && b.length > 0;
    })
    .map((c: any) => ({
      symbol: String(c.symbol).toUpperCase(), name: c.name ?? c.symbol,
      kind: "crypto", leveraged: false }));

  if (!out.length)
    throw new Error("Alpaca 가 값을 주는 코인이 하나도 없습니다. "
                  + "ALPACA_KEY_ID · ALPACA_SECRET_KEY 를 확인해 주세요.");

  const { data, error } = await admin.rpc("tradable_bulk_replace",
    { p_market: "CRYPTO", p_rows: out });
  if (error) throw new Error(`코인 저장 실패: ${error.message}`);
  return { market: "CRYPTO", saved: Number(data ?? out.length), total: out.length,
           pool: pool.length, dropped: pool.length - out.length,
           note: pool.length > out.length
             ? `후보 ${pool.length}개 중 Alpaca 가 실제로 취급하는 ${out.length}개만 담았습니다. `
             + "나머지는 넣어봤자 주문이 안 됩니다."
             : null };
}

// ── 코인 ────────────────────────────────────
//
//   코인은 하루치 전 종목을 한 번에 주는 창구가 없습니다 (벌크는 주식 전용).
//   그래서 학회가 정해둔 후보 풀만 개별로 훑고, 그 안에서 거래대금
//   상위 N 개를 고릅니다. 후보가 100여 개라 한 번에 다 돌 수 있습니다.

const CC_CONCURRENCY = 8;

async function eodhdSeries(ticker: string, from: string) {
  const key = secret("EODHD_API_KEY");
  if (!key) throw new Error("EODHD_API_KEY 가 설정되지 않았습니다.");
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(ticker)}`
            + `?api_token=${encodeURIComponent(key)}&fmt=json&period=d&from=${from}`;
  const r = await fetch(url);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`EODHD 조회 실패 (${r.status}).`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

// 동시에 몇 개씩만 — 한꺼번에 100개를 던지면 막힐 수 있습니다
async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

//  개별 코인 시세 — 티커는 BTC-USD 처럼 받고 .CC 를 붙입니다
async function fetchQuoteCrypto(symbol: string, start: string) {
  let t = symbol.trim().toUpperCase().replace(/\.CC$/, "");
  if (!t.includes("-")) t = `${t}-USD`;          // BTC → BTC-USD

  //  코인도 Alpaca 를 먼저 봅니다 (체결도 Alpaca 로 하니 값이 어긋나지 않습니다)
  if (alpacaKeys()) {
    try {
      const d: any = await alpGet(ALP_DATA, "/v1beta3/crypto/us/bars", {
        symbols: t.replace("-", "/"), timeframe: "1Day", start, limit: "10000",
      });
      const bars = d?.bars?.[t.replace("-", "/")] ?? [];
      const pts = bars
        .map((b: any) => ({ d: String(b.t ?? "").slice(0, 10), v: Number(b.c),
                            o: Number(b.o), h: Number(b.h), l: Number(b.l), q: Number(b.v ?? 0) }))
        .filter((x: any) => Number.isFinite(x.v) && x.v > 0);
      if (pts.length) return pts.sort((a: any, b: any) => a.d.localeCompare(b.d));
    } catch (e) { console.warn("Alpaca 코인 봉 실패", t, String((e as any)?.message ?? e)); }
  }

  const rows = await eodhdSeries(`${t}.CC`, start).catch(() => []);
  if (!rows.length) throw new Error(`코인(${t}) 자료를 찾지 못했습니다. BTC-USD 처럼 입력해 보세요.`);
  return rows
    .map((o: any) => ({
      d: String(o.date),
      v: Number(o.adjusted_close ?? o.close),
      o: Number(o.open), h: Number(o.high),
      l: Number(o.low),  q: Number(o.volume ?? 0),
    }))
    .filter((p: any) => Number.isFinite(p.v) && p.v > 0)
    .sort((a: any, b: any) => a.d.localeCompare(b.d));
}

async function syncUniverseCrypto(admin: any, topN = 50, days = 400) {
  const list = await cryptoPool(admin);
  if (!list.length)
    throw new Error("코인 후보 표는 있는데 켜져 있는 코인이 하나도 없습니다. "
                  + "crypto_pool 의 enabled 를 확인해 주세요.");

  /*  ── Alpaca 를 먼저 봅니다 ──────────────────────────────
      두 가지 이유입니다.

      ① EODHD 는 요금제에 따라 막힙니다 (S&P 벌크가 423 났던 그 계정).
         코인 명단이 유료 요금제에 매달릴 이유가 없습니다.
      ② 더 중요한 건 — <실제로 살 수 있는 코인만> 명단에 넣어야 합니다.
         체결은 Alpaca 로 합니다. Alpaca 가 취급 안 하는 코인을 명단에
         넣으면, 팀이 골라도 주문에서 "시세를 못 받았습니다" 로 막힙니다.
         Alpaca 가 값을 주는 코인만 담으면 그런 일이 없습니다.          */
  /*  ⚠️ 먼저 Alpaca 에게 <취급하는 코인이 무엇인지> 직접 물어봅니다.
      예전에는 후보 179개를 통째로 봉 조회에 던졌는데, 그중 하나가
      Alpaca 규칙에 안 맞으면 (1INCH 처럼 숫자로 시작) 요청 전체가
      400 이 되어 <한 개도> 못 받았습니다. 그러면 아래 EODHD 로 넘어가
      "Alpaca 로는 살 수도 없는 코인"이 명단에 채워졌고, 자동매매는
      그 명단을 훑다가 시세를 하나도 못 받고 멈췄습니다.               */
  const tradable = await alpCryptoAssets(admin);
  const usable = tradable.size
    ? list.filter((c: any) => { const p = alpPair(c.symbol); return p && tradable.has(p); })
    : list;
  if (tradable.size && usable.length < list.length)
    console.log("코인 후보", list.length, "중 Alpaca 취급", usable.length, "개만 씁니다");

  const alpBars = await alpBarsCrypto(usable.map((c: any) => c.symbol), "1Day")
    .catch(() => ({} as Record<string, any[]>));

  const viaAlpaca = usable.map((c: any) => {
    const bars = (alpBars as any)[String(c.symbol).toUpperCase()] ?? [];
    const last = bars[bars.length - 1];
    if (!last) return null;
    const close = Number(last.c), vol = Number(last.v ?? 0);
    if (!Number.isFinite(close) || close <= 0) return null;
    return { symbol: c.symbol, name: c.name || c.symbol, rows: [],
             date: String(last.t ?? "").slice(0, 10), tr: close * vol, src: "alpaca" };
  }).filter(Boolean) as any[];

  if (viaAlpaca.length) {
    viaAlpaca.sort((a, b) => b.tr - a.tr);
    const picked = viaAlpaca.slice(0, topN);
    const asOf = picked[0].date || new Date().toISOString().slice(0, 10);
    const { error } = await admin.rpc("universe_auto_replace", {
      p_market: "CRYPTO", p_as_of: asOf,
      p_rows: picked.map((x, i) => ({
        symbol: x.symbol, name: x.name, rank: i + 1, tr_value: x.tr })),
    });
    if (error) throw new Error(`코인 등록 실패: ${error.message}`);
    return { market: "CRYPTO", as_of: asOf, scanned: list.length, picked: picked.length,
             priced: 0, source: "Alpaca",
             top: picked.slice(0, 5).map((x: any) => x.symbol),
             note: `Alpaca 가 값을 주는 ${viaAlpaca.length}개 중 상위 ${picked.length}개입니다. `
                 + "여기 있는 코인은 전부 실제로 주문이 됩니다." };
  }

  //  Alpaca 가 하나도 못 주면 예전 방식(EODHD)으로 넘어갑니다
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromIso = from.toISOString().slice(0, 10);

  const got = await inBatches(list, CC_CONCURRENCY, async (c: any) => {
    try {
      const rows = await eodhdSeries(`${c.symbol}.CC`, fromIso);
      if (!rows.length) return null;
      const last = rows[rows.length - 1];
      const close = Number(last.adjusted_close ?? last.close);
      const vol = Number(last.volume ?? 0);
      if (!Number.isFinite(close) || close <= 0) return null;
      return { symbol: c.symbol, name: c.name || c.symbol, rows,
               date: String(last.date), tr: close * vol };
    } catch { return null; }
  });

  const ok = got.filter(Boolean) as any[];
  if (!ok.length)
    throw new Error("코인 시세를 하나도 받지 못했습니다. "
      + "Alpaca 도 EODHD 도 값을 주지 않았습니다 — 두 열쇠를 확인해 주세요.");

  ok.sort((a, b) => b.tr - a.tr);
  const picked = ok.slice(0, topN);
  const asOf = picked[0].date;

  const { error } = await admin.rpc("universe_auto_replace", {
    p_market: "CRYPTO", p_as_of: asOf,
    p_rows: picked.map((x, i) => ({
      symbol: x.symbol, name: x.name, rank: i + 1, tr_value: x.tr })),
  });
  if (error) throw new Error(`코인 등록 실패: ${error.message}`);

  //  뽑힌 코인은 과거 시세까지 한 번에 저장합니다 —
  //  이미 받아둔 자료라 추가 호출이 들지 않습니다.
  let saved = 0;
  for (const x of picked) {
    const px = x.rows
      .map((o: any) => ({ market: "CRYPTO", symbol: x.symbol, d: String(o.date),
                          v: Number(o.adjusted_close ?? o.close), name: x.name }))
      .filter((o: any) => Number.isFinite(o.v) && o.v > 0);
    if (!px.length) continue;
    const { data } = await admin.rpc("price_bulk_upsert", { p_rows: px });
    saved += Number(data ?? 0);
  }

  return { market: "CRYPTO", as_of: asOf, scanned: list.length, picked: picked.length,
           rows_saved: saved, top: picked.slice(0, 5).map((x) => x.symbol) };
}


// ── 현재가 (지연 시세) ────────────────────────
//
//   EODHD 의 real-time 엔드포인트는 우리 요금제에 들어 있습니다.
//   다만 이름과 달리 '실시간' 은 아닙니다 —
//     · 미국 주식 : 15~20분 지연
//     · 코인·환율 : 약 1분
//     · 국내 주식 : 아예 제공하지 않음 (공공데이터는 종가만)
//   그래서 값과 함께 '언제 것인지' 를 반드시 같이 돌려줍니다.

async function liveQuote(market: string, symbol: string) {
  const key = secret("EODHD_API_KEY");
  const sym = symbol.trim();

  if (market === "KR") {
    //  국내는 현재가를 주는 창구가 없습니다. 마지막 종가를 그대로 돌려줍니다.
    const pts = await fetchQuoteKR(sym, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    const last = pts[pts.length - 1];
    if (!last) throw new Error(`종목(${sym}) 시세를 찾지 못했습니다.`);
    return { market, symbol: sym, price: last.v, currency: "KRW",
             as_of: last.d, kind: "close", delay_min: null,
             note: "국내 주식은 현재가를 받을 수 있는 무료 창구가 없어 마지막 종가입니다." };
  }

  /*  EODHD 구독을 안 하기로 했으므로 Alpaca 를 먼저 씁니다.
      (EODHD 키가 있으면 그쪽을 씁니다 — 나중에 구독하면 그대로 살아납니다)  */
  if (!key) {
    const sym2 = sym.toUpperCase();
    const q = market === "CRYPTO"
      ? (await alpQuotesCrypto([sym2]))[sym2.includes("-") ? sym2 : sym2 + "-USD"]
      : (await alpQuotesUS([sym2]))[sym2];
    if (!q) throw new Error(`종목(${sym}) 현재가를 찾지 못했습니다.`);
    return {
      market, symbol: sym, price: q.price, currency: "USD",
      as_of: q.at, kind: "live", age_min: null,
      delay_min: 0, prev_close: null, change_pct: null,
      note: market === "CRYPTO"
        ? "Alpaca 코인 실시간입니다."
        : "Alpaca IEX 실시간입니다. 거래가 적은 종목은 전체 시장가와 다를 수 있습니다.",
    };
  }
  const t = market === "CRYPTO"
    ? (sym.toUpperCase().includes("-") ? sym.toUpperCase() : sym.toUpperCase() + "-USD") + ".CC"
    : sym.toUpperCase().replace(/\./g, "-") + ".US";

  const r = await fetch(`https://eodhd.com/api/real-time/${encodeURIComponent(t)}`
                      + `?api_token=${encodeURIComponent(key)}&fmt=json`);
  if (!r.ok) throw new Error(`현재가 조회 실패 (${r.status}).`);
  const d = await r.json();
  const px = Number(d?.close);
  if (!Number.isFinite(px) || px <= 0) throw new Error(`종목(${sym}) 현재가를 찾지 못했습니다.`);

  //  timestamp 는 초 단위입니다
  const ts = Number(d?.timestamp);
  const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null;
  const ageMin = at ? Math.round((Date.now() - ts * 1000) / 60000) : null;

  return {
    market, symbol: sym, price: px, currency: "USD",
    as_of: at, kind: "live", age_min: ageMin,
    delay_min: market === "CRYPTO" ? 1 : 20,
    prev_close: Number(d?.previousClose) || null,
    change_pct: Number(d?.change_p),
    note: market === "CRYPTO"
      ? "코인은 약 1분 지연된 시세입니다."
      : "미국 주식은 15~20분 지연된 시세입니다. 실시간 호가가 아닙니다.",
  };
}

// ── 원/달러 환율 보관 ─────────────────────────
//   모의투자에서 미국 주식을 원화로 환산할 때 씁니다.
//   price_cache 에 market='FX', symbol='USDKRW' 로 저장합니다.

async function upsertFx(admin: any, pts: any[]) {
  const now = new Date().toISOString();
  const rows = pts.map((p: any) => ({
    market: "FX", symbol: "USDKRW", on_date: p.d, close: p.v,
    name: "원/달러", updated_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await admin.from("price_cache")
      .upsert(rows.slice(i, i + 500), { onConflict: "market,symbol,on_date" });
  }
}

async function ensureFx(admin: any) {
  try {
    const { data } = await admin.from("price_cache")
      .select("on_date").eq("market", "FX").eq("symbol", "USDKRW")
      .order("on_date", { ascending: false }).limit(1).maybeSingle();

    const latest: string | undefined = data?.on_date;
    if (latest) {
      const ageDays = (Date.now() - Date.parse(latest + "T00:00:00Z")) / 864e5;
      if (ageDays < 4) return;                 // 최근 환율이 이미 있음
    }
    const start = latest ?? "2015-01-01";
    const pts = await fetchFred("DEXKOUS", start);
    if (pts.length) await upsertFx(admin, pts);
  } catch (_e) {
    // 환율 갱신 실패가 본 요청을 막지는 않게 합니다
  }
}

// ── 여러 종목 한 번에 ─────────────────────────
//   유니버스 스캔 전략은 수십 종목의 시세가 필요합니다.
//   한 종목씩 부르면 왕복이 너무 많아지므로 한 번에 처리하고,
//   받아온 값은 모든 팀이 공유하는 캐시에 남깁니다.
const BULK_MAX = 20;

/*  백테스트용 봉을 한 번에 몇 종목까지 받아올까.

    ⚠️ 두 가지가 동시에 걸립니다.
      · Alpaca: limit 은 <전 종목 합쳐> 한 페이지 10,000봉. 종목 순서로
        채워 보내므로, 한 묶음이 한 페이지를 넘기면 뒤쪽 종목이 0개가 됩니다.
      · Supabase Edge Function: 메모리 256MB · CPU 2초.
    4시간봉 90일이면 미국 124봉·코인 540봉이라, 20종목이면 코인 최악에도
    10,800봉(약 1MB)입니다. 넉넉합니다.                                */
const BARS_BULK_MAX = 20;


async function bulkQuotes(admin: any, codes: any[], start: string) {
  const out: Record<string, any[]> = {};
  let fetched = 0;

  for (const c of codes.slice(0, BULK_MAX)) {
    /*  ⚠️ 예전에는 "US 아니면 전부 KR" 이었습니다. 그래서 코인이 국내
        주식으로 둔갑해 fetchQuoteKR("BTC-USD") 를 부르고 빈손으로
        돌아왔습니다. 게다가 돌려주는 열쇠도 "KR|BTC-USD" 라 화면이
        찾지도 못했습니다. 백테스트가 코인 과거 시세를 <보관함에 이미
        들어 있을 때만> 쓸 수 있었던 이유입니다.                        */
    const mRaw = String(c.market ?? "KR").toUpperCase();
    const market = mRaw === "US" ? "US" : mRaw === "CRYPTO" ? "CRYPTO" : "KR";
    const symbol = String(c.symbol ?? "").trim();
    if (!symbol) continue;
    const key = market + "|" + symbol;
    const source = market === "US" ? "quote_us"
                 : market === "CRYPTO" ? "quote_crypto" : "quote_kr";

    const { data: cached } = await admin
      .from("series_cache")
      .select("payload, fetched_at")
      .eq("source", source).eq("code", symbol).eq("item_code", "")
      .maybeSingle();

    if (cached) {
      const ageH = (Date.now() - new Date(cached.fetched_at).getTime()) / 36e5;
      const p: any = cached.payload;
      if (ageH < CACHE_HOURS && p?.start && p.start <= start
          && Array.isArray(p.points) && p.points.length) {
        out[key] = p.points;
        continue;
      }
    }

    try {
      const pts = market === "US"     ? await fetchQuoteUS(symbol, start)
                : market === "CRYPTO" ? await fetchQuoteCrypto(symbol, start)
                :                       await fetchQuoteKR(symbol, start);
      if (Array.isArray(pts) && pts.length) {
        out[key] = pts;
        fetched++;
        await admin.from("series_cache").upsert({
          source, code: symbol, item_code: "",
          fetched_at: new Date().toISOString(),
          payload: { source, code: symbol, item_code: "", cycle: "D", start, points: pts },
        });
      } else {
        out[key] = [];
      }
    } catch (_e) {
      out[key] = [];                    // 한 종목이 실패해도 나머지는 계속
    }
  }

  return { series: out, fetched, done: codes.length <= BULK_MAX, max: BULK_MAX };
}

// ── 본체 ──────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════
   홈 — 거시경제 캘린더 · 실적 발표 일정 · 환율

     구독 중인 EODHD 요금제에 따라 열리는 창구가 다릅니다.
       · EOD All World ($19.99)  → 환율(EOD)  ✅
       · Calendar & News (+$19.99) 또는 All-In-One → 캘린더 ✅
     막혀 있으면 402/403 이 오므로, 그때는 무엇을 켜야 하는지
     한국어로 알려주고 가능한 무료 자료로 대체합니다.
   ═══════════════════════════════════════════════════════════════ */

function numOrNull(v: any) {
  if (v === null || v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function shiftDay(base: string, n: number) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}
function todayISO() { return isoDay(new Date()); }

//  요금제에 없는 창구인지 구분합니다 (키가 틀린 것과 다릅니다)
function planBlocked(status: number) {
  return status === 401 || status === 402 || status === 403;
}
/*  ⚠️ 예전에는 요금제에 없는 창구를 만날 때마다 이 문구를 화면에
    띄웠습니다. 그런데 <홈을 열 때마다> 뜹니다 — 학회원이 할 수 있는
    일이 아무것도 없는데도요. 요금제를 바꿀 사람은 임원진 한 명뿐이고,
    그 사람도 한 번 알면 됩니다. 그래서 화면에는 안 띄우고
    blocked 표시만 남깁니다 — 캘린더는 그 표시를 보고 FRED 발표 일정
    으로 알아서 갈아탑니다. 학회원은 그냥 일정이 보이면 됩니다.       */
const PLAN_MSG: string | null = null;

//  ── 통화 · 환율 ─────────────────────────────
//     EOD 환율은 All World 요금제에 포함됩니다.
//  [키, 이름, 설명, EODHD 티커]
const FX_PAIRS: [string, string, string, string][] = [
  ["USDKRW", "달러/원",     "미국 달러 1 = 원",      "USDKRW.FOREX"],
  ["EURKRW", "유로/원",     "유로 1 = 원",           "EURKRW.FOREX"],
  ["JPYKRW", "엔/원",       "엔 1 = 원 (100엔 아님)", "JPYKRW.FOREX"],
  ["CNYKRW", "위안/원",     "위안 1 = 원",           "CNYKRW.FOREX"],
  ["EURUSD", "유로/달러",   "유로 1 = 달러",         "EURUSD.FOREX"],
  ["USDJPY", "달러/엔",     "달러 1 = 엔",           "USDJPY.FOREX"],
  ["GBPUSD", "파운드/달러", "파운드 1 = 달러",       "GBPUSD.FOREX"],
  ["DXY",    "달러지수",    "주요 통화 대비 달러 강세", "DXY.INDX"],
];

async function eodSeries(ticker: string, days: number) {
  const key = secret("EODHD_API_KEY");
  if (!key) throw new Error("EODHD_API_KEY 가 설정되지 않았습니다.");
  const from = shiftDay(todayISO(), -days);
  const u = `https://eodhd.com/api/eod/${encodeURIComponent(ticker)}`
          + `?api_token=${encodeURIComponent(key)}&fmt=json&period=d&from=${from}&order=a`;
  const r = await fetch(u);
  if (!r.ok) {
    if (planBlocked(r.status)) return { blocked: true, points: [] as any[] };
    return { blocked: false, points: [] as any[] };
  }
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows)) return { blocked: false, points: [] as any[] };
  return {
    blocked: false,
    points: rows
      .map((x: any) => ({ d: String(x?.date ?? ""), v: Number(x?.adjusted_close ?? x?.close) }))
      .filter((x: any) => x.d && Number.isFinite(x.v) && x.v > 0),
  };
}

//  FRED 에도 무료 환율이 있습니다 (EODHD 가 막혔을 때 대체)
const FRED_FX: Record<string, string> = {
  USDKRW: "DEXKOUS", USDJPY: "DEXJPUS", EURUSD: "DEXUSEU",
  GBPUSD: "DEXUSUK", CNYKRW: "", EURKRW: "", JPYKRW: "", DXY: "DTWEXBGS",
};

async function homeFx(days: number) {
  const n = Math.max(30, Math.min(days || 180, 1200));
  const out: any[] = [];
  let blocked = false, usedFred = false;

  for (const [sym, label, hint, ticker] of FX_PAIRS) {
    let pts: any[] = [];
    try {
      const r = await eodSeries(ticker, n);
      if (r.blocked) blocked = true;
      pts = r.points;
    } catch { /* 아래에서 FRED 로 한 번 더 */ }

    if (!pts.length && FRED_FX[sym]) {
      try { pts = await fetchFred(FRED_FX[sym], shiftDay(todayISO(), -n)); usedFred = true; }
      catch { /* 둘 다 없으면 빈 칸 */ }
    }
    if (!pts.length) { out.push({ symbol: sym, label, hint, last: null, points: [] }); continue; }

    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const wk   = pts[Math.max(0, pts.length - 6)];
    const mo   = pts[Math.max(0, pts.length - 23)];
    const yr   = pts[0];
    const chg = (a: any) => (a && a.v ? (last.v - a.v) / a.v : null);
    out.push({
      symbol: sym, label, hint,
      last: last.v, on: last.d,
      d_day: chg(prev), d_week: chg(wk), d_month: chg(mo), d_year: chg(yr),
      hi: Math.max(...pts.map((x: any) => x.v)),
      lo: Math.min(...pts.map((x: any) => x.v)),
      points: pts.slice(-260),
    });
  }
  return {
    pairs: out, as_of: todayISO(),
    source: usedFred ? "EODHD + FRED" : "EODHD",
    note: blocked ? PLAN_MSG : null,
  };
}

/*  ══════════ 뉴스 · 공시 피드 ══════════

    RSS 는 매체가 '가져다 쓰라' 고 직접 내놓는 창구입니다. 제목과 링크를
    보여주고 원문으로 보내주는 것이 의도된 사용이라 문제가 없습니다.
    (반대로 investing.com 은 약관이 자동 수집을 명시적으로 금지해서 뺐습니다.
     원자재·경제 자리는 정부 소스인 EIA 로 대신합니다.)

    브라우저에서 바로 부르면 CORS 에 막히므로 여기서 대신 받아 넘깁니다.
    학회원 여럿이 동시에 봐도 매체 쪽에 부담이 가지 않게 3분 캐시합니다.   */
type FeedRow = [string, string, string, string];   // [코드, 이름, 분류힌트, URL]
const NEWS_FEEDS: FeedRow[] = [
  ["MW",   "MarketWatch",   "", "https://feeds.content.dowjones.io/public/rss/mw_topstories"],
  ["MW",   "MarketWatch",   "", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"],
  ["CNBC", "CNBC",          "", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"],
  ["CNBC", "CNBC 마켓",     "", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"],
  ["CNBC", "CNBC 경제",     "매크로", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"],
  ["YF",   "Yahoo Finance", "", "https://finance.yahoo.com/news/rssindex"],
  ["EIA",  "미 에너지정보청", "원자재", "https://www.eia.gov/rss/todayinenergy.xml"],
  ["FED",  "연준 보도자료",   "정책", "https://www.federalreserve.gov/feeds/press_all.xml"],
  ["SEC",  "SEC 보도자료",   "정책", "https://www.sec.gov/news/pressreleases.rss"],
  ["BLS",  "미 노동통계국",   "매크로", "https://www.bls.gov/feed/bls_latest.rss"],
  //  ── 원문에 가까운 곳들. 기사보다 하루 빠르거나, 기사가 인용하는 바로 그 자료입니다 ──
  ["BEA",  "미 경제분석국",   "매크로", "https://apps.bea.gov/rss/rss.xml"],
  ["CENSUS","미 인구조사국",  "매크로", "https://www.census.gov/economic-indicators/indicator.xml"],
  ["TREA", "미 재무부",      "정책", "https://home.treasury.gov/rss/press.xml"],
  ["NYFED","뉴욕 연준",      "정책", "https://www.newyorkfed.org/rss/feeds"],
  ["BOK",  "한국은행",       "정책", "https://www.bok.or.kr/portal/bbs/P0000559/rss.do?menuNo=200761"],
  ["FSC",  "금융위원회",      "정책", "https://www.fsc.go.kr/rss/no010101.xml"],
];

//  SEC 실시간 공시 — 방금 접수된 서류가 그대로 올라옵니다
const SEC_FILINGS =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb="
  + "&owner=include&count=60&output=atom";

/*  ── 제목의 단어로 분류를 붙입니다 ──

    순수 키워드 매칭입니다. AI 도 아니고 매체가 준 태그도 아닙니다.
    위에서부터 처음 걸리는 하나를 쓰고, 아무것도 안 걸리면 '기업' 입니다.

    한계를 알고 써야 합니다:
      · 순서가 곧 우선순위입니다. "Fed's rate decision lifts oil" 은
        정책이 먼저 걸려서 원자재로 안 갑니다.
      · 오탐이 납니다 — 회사 이름에 든 gold 가 원자재로 갈 수 있습니다.
      · '기업' 은 기업 뉴스라기보다 '분류 실패' 바구니에 가깝습니다.
    훑어보며 색으로 구분하는 용도입니다. 이 분류로 뭘 판단하면 안 됩니다.   */
const NEWS_TAGS: [string, RegExp][] = [
  ["정책",   /\b(fed|fomc|powell|tariff|ecb|boj|congress|sanction|regulat|treasury dept|white house|정책|관세|연준)\b/i],
  ["매크로", /\b(inflation|cpi|ppi|gdp|payroll|jobless|unemploy|recession|pmi|yield|rate cut|rate hike|consumer price|물가|고용|성장률)\b/i],
  ["원자재", /\b(oil|crude|opec|gold|copper|uranium|natural gas|wheat|commodit|원유|금값|구리)\b/i],
  ["크립토", /\b(bitcoin|crypto|ethereum|stablecoin|blockchain|비트코인|가상자산)\b/i],
  ["실적",   /\b(earnings|revenue|guidance|beats|misses|profit|quarterly results|실적|영업이익)\b/i],
  ["M&A",    /\b(acquisition|acquire|merger|buyout|takeover|ipo|spin[- ]?off|인수|합병)\b/i],
];
//  * 주목 표시 — 시장이 크게 움직이는 단어들
const NEWS_HOT = /\b(fomc|cpi|crash|plunge|tariff|surge|soar|halt|default|downgrade|emergency|폭락|급등)\b/i;

function newsTag(title: string) {
  for (const [name, re] of NEWS_TAGS) if (re.test(title)) return name;
  return "기업";
}

//  RSS 2.0 과 Atom 을 함께 받습니다. 브라우저의 DOMParser 가 없어 직접 훑습니다.
function parseFeed(xml: string, code: string, source: string, hint: string) {
  const out: any[] = [];
  const clean = (t: string) =>
    t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
     .replace(/<[^>]+>/g, "")
     .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
     .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
     .replace(/\s+/g, " ").trim();

  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const t = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!t) continue;
    const title = clean(t[1]);
    if (!title) continue;

    //  링크: RSS 는 <link>본문</link>, Atom 은 <link href="...">
    let link = "";
    const l1 = b.match(/<link[^>]*href=["']([^"']+)["']/i);
    const l2 = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    link = l1 ? l1[1] : (l2 ? clean(l2[1]) : "");

    const d = b.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i);
    const when = d ? Date.parse(clean(d[2])) : NaN;

    out.push({
      title, link, source, code,
      at: Number.isFinite(when) ? new Date(when).toISOString() : null,
      tag: hint || newsTag(title),
      hot: NEWS_HOT.test(title),
    });
  }
  return out;
}

async function fetchFeed(url: string) {
  const r = await fetch(url, {
    headers: {
      //  SEC 는 신원을 밝힌 요청만 받아줍니다. 다른 곳에도 같은 예의를 지킵니다.
      "User-Agent": secret("SEC_UA") || "SAFE Terminal (student club; contact via GitHub)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  if (!r.ok) throw new Error(String(r.status));
  return await r.text();
}

//  SEC 실시간 공시 — 서류 종류와 회사 이름을 갈라 냅니다
function parseSecFilings(xml: string) {
  const rows = parseFeed(xml, "SECF", "SEC 공시", "공시");
  return rows.map((x: any) => {
    //  제목이 '8-K - APPLE INC (0000320193) (Filer)' 모양입니다
    const m = String(x.title).match(/^([A-Z0-9./-]+)\s+-\s+(.+?)\s*\((\d{10})\)/);
    return m
      ? { ...x, form: m[1], company: m[2], cik: m[3],
          title: m[2] + " — " + m[1], hot: /^(8-K|SC 13D|424B|S-1)/.test(m[1]) }
      : x;
  });
}

async function newsFeed(kind: string) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ck = kind === "filings" ? "filings" : "news";

  //  3분 캐시 — 학회원 30명이 동시에 봐도 매체 쪽엔 한 번만 갑니다
  try {
    const { data: hit } = await admin.from("series_cache")
      .select("payload, fetched_at").eq("source", "news_feed")
      .eq("code", ck).eq("item_code", "v1").maybeSingle();
    if (hit?.payload?.items?.length) {
      const age = (Date.now() - new Date(hit.fetched_at).getTime()) / 1000;
      if (age < 180) return { ...hit.payload, cached: true, age_sec: Math.round(age) };
    }
  } catch { /* 캐시를 못 읽어도 새로 받습니다 */ }

  const items: any[] = [];
  const failed: string[] = [];

  if (kind === "filings") {
    try { items.push(...parseSecFilings(await fetchFeed(SEC_FILINGS))); }
    catch (e) { failed.push("SEC 공시 (" + String((e as Error).message) + ")"); }
  } else {
    const seen = new Set<string>();
    await Promise.all(NEWS_FEEDS.map(async ([code, name, hint, url]) => {
      try {
        const rows = parseFeed(await fetchFeed(url), code, name, hint);
        for (const r of rows) {
          //  같은 기사가 여러 피드에 걸립니다 — 제목으로 한 번만
          const k = r.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").slice(0, 60);
          if (seen.has(k)) continue;
          seen.add(k);
          items.push(r);
        }
      } catch (e) { failed.push(name + " (" + String((e as Error).message) + ")"); }
    }));
  }

  items.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const payload = {
    items: items.slice(0, 120), failed,
    note: failed.length ? failed.length + "개 매체를 받지 못했습니다." : null,
    at: new Date().toISOString(),
  };
  if (items.length) {
    try {
      await admin.from("series_cache").upsert({
        source: "news_feed", code: ck, item_code: "v1",
        fetched_at: new Date().toISOString(), payload,
      });
    } catch { /* 저장 실패는 넘어갑니다 */ }
  }
  return { ...payload, cached: false, age_sec: 0 };
}

/*  ══════════ 미국 지표 발표 일정 ══════════

    FRED 의 releases/dates 는 '무슨 발표가 며칠에 있다' 만 알려줍니다.
    이름은 영어이고, 몇 시인지는 아예 없습니다.

    그런데 미국 지표 발표시각은 지표마다 고정돼 있습니다 —
    고용·물가는 8:30, ISM 은 10:00, FOMC 는 14:00 (전부 동부시간).
    그래서 아래 표에 발표시각을 적어두고, 한국시간은 계산해서 냅니다.

    이 표 하나가 네 가지를 합니다:
      ① FRED 의 영어 이름을 한국어로 바꾸고
      ② 발표시각을 알려주고
      ③ 수백 개 발표 중 볼 만한 것만 걸러내는 화이트리스트가 되고
      ④ 세부항목 예열 스케줄러의 대상 목록이 됩니다.

    [ release_id, 한국어 이름, 동부시간 HH:MM, 대표 series_id, 중요도 ]
    중요도 3 = 시장이 크게 움직임, 2 = 챙겨볼 것, 1 = 참고.               */
type RelRow = [number, string, string, string, number];
const US_RELEASES: RelRow[] = [
  [10,  "소비자물가지수 (CPI)",        "08:30", "CPIAUCSL",      3],
  [46,  "고용상황 (비농업 고용·실업률)", "08:30", "PAYEMS",        3],
  [11,  "생산자물가지수 (PPI)",        "08:30", "PPIACO",        2],
  [53,  "국내총생산 (GDP)",           "08:30", "GDPC1",         3],
  [54,  "개인소득·지출 (PCE 물가)",     "08:30", "PCEPI",         3],
  [13,  "소매판매",                   "08:30", "RSAFS",         2],
  [180, "주간 신규 실업수당 청구",       "08:30", "ICSA",          2],
  [9,   "내구재 주문",                 "08:30", "DGORDER",       1],
  [50,  "고용비용지수 (ECI)",          "08:30", "ECIALLCIV",     1],
  [97,  "신규주택 착공·허가",           "08:30", "HOUST",         1],
  [21,  "산업생산·설비가동률",          "09:15", "INDPRO",        2],
  [96,  "신규주택 매매",               "10:00", "HSN1F",         1],
  [20,  "기존주택 매매",               "10:00", "EXHOSLUSM495S", 1],
  [98,  "구인·이직 보고서 (JOLTS)",     "10:00", "JTSJOL",        2],
  [91,  "소비자심리지수 (미시간대)",      "10:00", "UMCSENT",       2],
  [17,  "소비자신뢰지수 (컨퍼런스보드)",  "10:00", "CSCICP03USM665S", 2],
  [151, "연방기금금리 (FOMC)",         "14:00", "FEDFUNDS",      3],
  [175, "베이지북",                    "14:00", "",              1],
  [22,  "무역수지",                    "08:30", "BOPGSTB",       1],
  [25,  "가계부채·신용",               "15:00", "TOTALSL",       1],
  [82,  "케이스-실러 주택가격지수",      "09:00", "CSUSHPINSA",    1],
  [175, "기업재고",                    "10:00", "BUSINV",        1],
];

//  숫자로 빨리 찾기 위한 색인
const REL_BY_ID: Record<string, RelRow> = {};
for (const r of US_RELEASES) if (!REL_BY_ID[String(r[0])]) REL_BY_ID[String(r[0])] = r;

/*  미국 동부시간 → 한국시간.

    동부는 서머타임이 있고 한국은 없습니다. 그래서 같은 8:30 발표가
    여름엔 21:30, 겨울엔 22:30 입니다. 고정으로 +13 을 박아두면
    1년에 두 번 틀립니다 — 계산으로 냅니다.

    미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일.                  */
function isUsDst(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  //  그 달 첫날의 요일로 둘째/첫째 일요일을 구합니다
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  if (m === 3) return day >= (14 - firstDow) % 7 + 8;    // 둘째 일요일부터
  return day < (7 - firstDow) % 7 + 1;                    // 11월 첫째 일요일 전까지
}

//  '2026-08-27' + '08:30'(ET) → { date:'2026-08-27', time:'21:30' } (한국시간)
function etToKst(dateIso: string, hhmm: string) {
  if (!hhmm) return { date: dateIso, time: "", kstDate: dateIso };
  const [h, mi] = hhmm.split(":").map(Number);
  const offset = isUsDst(dateIso) ? 4 : 5;               // ET = UTC−4 (여름) / −5 (겨울)
  const utc = Date.parse(dateIso + "T00:00:00Z") + (h + offset) * 36e5 + mi * 6e4;
  const kst = new Date(utc + 9 * 36e5);                  // KST = UTC+9
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: dateIso,
    kstDate: `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}`,
    time: `${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`,
  };
}

/*  ── 홈 화면 경제지표 캘린더 ──

    FRED 발표 일정에 우리 매핑 표를 씌워서 만듭니다. 유료 캘린더가 없어도
    '언제 · 무엇이 · 몇 시에(한국시간) · 발표치 · 이전치' 까지 채워집니다.

    예측치는 시장 컨센서스가 아니라 <b>연준 나우캐스트</b>입니다 —
    시장 컨센서스는 무료로 구할 데가 없습니다. 애틀랜타 연준 GDPNow 처럼
    출처와 방법론이 공개된 값을 쓰고, 화면에도 그렇게 적습니다.
    출처를 속이느니 다른 숫자를 정직하게 보여주는 편이 낫습니다.          */
const NOWCAST: Record<string, { series: string; label: string }> = {
  "GDPC1":  { series: "GDPNOW",  label: "애틀랜타 연준 GDPNow" },
};

async function fredObs(seriesId: string, from: string) {
  try {
    const d = await fredGet("series/observations", {
      series_id: seriesId, observation_start: from,
      sort_order: "asc", limit: "400",
    });
    return (d.observations ?? [])
      .map((o: any) => ({ d: String(o.date), v: Number(o.value) }))
      .filter((o: any) => Number.isFinite(o.v));
  } catch { return []; }
}

async function macroCalendar(from: string, to: string) {
  //  ① 기간 안의 발표 일정 (호출 한 번)
  const cal = await fredReleaseDates(from, to);
  if (!cal) return { events: [], note: "FRED_API_KEY 가 없어 일정을 받지 못했습니다." };

  //  ② 우리 표에 있는 발표만 남깁니다
  const picked = cal.rows.filter((r: any) => REL_BY_ID[String(r.id)]);

  //  ③ 발표마다 대표 지표의 관측치를 받아둡니다 (같은 지표는 한 번만)
  const need = new Set<string>();
  for (const r of picked) {
    const rel = REL_BY_ID[String(r.id)];
    if (rel[3]) need.add(rel[3]);
    const nc = NOWCAST[rel[3]];
    if (nc) need.add(nc.series);
  }
  const obsFrom = new Date(Date.parse(from + "T00:00:00Z") - 800 * 864e5)
    .toISOString().slice(0, 10);
  const series: Record<string, { d: string; v: number }[]> = {};
  const ids = [...need];
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      series[id] = await fredObs(id, obsFrom);
    }));
  }

  const today = new Date().toISOString().slice(0, 10);
  const events = picked.map((r: any) => {
    const rel = REL_BY_ID[String(r.id)];
    const [id, ko, etTime, sid, imp] = rel;
    const t = etToKst(r.date, etTime);

    /*  그 발표가 내놓은 값 찾기.
        FRED 관측치의 날짜는 '대상 기간' 이지 '발표일' 이 아닙니다.
        (8월 12일에 발표한 CPI 는 7월분이라 관측치 날짜가 7월 1일)
        그래서 발표일보다 앞선 관측치 중 가장 나중 것이 그 발표의 값입니다. */
    let actual: number | null = null, prev: number | null = null, refPeriod = "";
    const obs = series[sid] ?? [];
    if (obs.length && r.date <= today) {
      let k = -1;
      for (let j = 0; j < obs.length; j++) if (obs[j].d < r.date) k = j; else break;
      if (k >= 0) { actual = obs[k].v; refPeriod = obs[k].d; }
      if (k >= 1) prev = obs[k - 1].v;
    }

    //  예측치 — 연준 나우캐스트가 있는 지표만
    let fc: number | null = null, fcLabel = "";
    const nc = NOWCAST[sid];
    if (nc) {
      const no = series[nc.series] ?? [];
      let k2 = -1;
      for (let j = 0; j < no.length; j++) if (no[j].d < r.date) k2 = j; else break;
      if (k2 >= 0) { fc = no[k2].v; fcLabel = nc.label; }
    }

    return {
      id, name: ko, name_en: r.name, country: "US",
      date: r.date, kst_date: t.kstDate, kst_time: t.time,
      importance: imp, series_id: sid,
      actual, previous: prev, forecast: fc, forecast_from: fcLabel,
      ref_period: refPeriod,
      done: r.date <= today && actual != null,
    };
  }).sort((a: any, b: any) =>
    (a.kst_date + (a.kst_time || "99:99")).localeCompare(b.kst_date + (b.kst_time || "99:99")));

  return {
    events, from, to,
    note: "발표시각은 지표별 고정 시각을 한국시간으로 바꾼 값입니다. "
        + "예측치는 시장 컨센서스가 아니라 연준 나우캐스트입니다.",
  };
}

//  ── 국가별 거시경제 지표 캘린더 ──────────────
const ECON_COUNTRY: Record<string, string> = {
  US: "미국", KR: "한국", JP: "일본", CN: "중국", DE: "독일",
  GB: "영국", FR: "프랑스", EU: "유로존", IN: "인도", CA: "캐나다",
};

async function econCalendar(country: string, from: string, to: string, limit: number) {
  const key = secret("EODHD_API_KEY");
  const lim = Math.max(10, Math.min(limit || 300, 1000));
  if (!key) throw new Error("EODHD_API_KEY 가 설정되지 않았습니다.");

  const u = new URL("https://eodhd.com/api/economic-events");
  u.searchParams.set("api_token", key);
  u.searchParams.set("fmt", "json");
  u.searchParams.set("from", from);
  u.searchParams.set("to", to);
  u.searchParams.set("limit", String(lim));
  if (country && country !== "ALL") u.searchParams.set("country", country);

  const r = await fetch(u);
  if (!r.ok) {
    if (planBlocked(r.status)) {
      //  요금제에 없으면 FRED 발표 일정(무료)으로 대신합니다.
      const alt = await fredReleaseDates(from, to).catch(() => null);
      return {
        events: [], blocked: true, note: PLAN_MSG,
        fallback: alt, countries: ECON_COUNTRY, from, to, country,
      };
    }
    throw new Error(`EODHD 경제 캘린더 오류 (${r.status})`);
  }
  const rows = await r.json().catch(() => []);
  const evs = (Array.isArray(rows) ? rows : []).map((x: any) => {
    const dt = String(x?.date ?? "");
    return {
      date: dt.slice(0, 10), time: dt.slice(11, 16),
      country: x?.country ?? null,
      country_ko: ECON_COUNTRY[String(x?.country ?? "").toUpperCase()] ?? (x?.country ?? null),
      type: x?.type ?? null,
      period: x?.period ?? null,
      comparison: x?.comparison ?? null,
      actual: numOrNull(x?.actual),
      estimate: numOrNull(x?.estimate),
      previous: numOrNull(x?.previous),
      change: numOrNull(x?.change),
      change_pct: numOrNull(x?.change_percentage),
    };
  }).sort((a: any, b: any) =>
    (a.date + a.time).localeCompare(b.date + b.time));

  return {
    events: evs, blocked: false, note: null, fallback: null,
    countries: ECON_COUNTRY, from, to, country,
  };
}

//  FRED 발표 일정 — 무료. 미국 지표가 언제 나오는지만 알려줍니다.
/*  기간 안의 발표 일정.

    ⚠️ 여기에 오래된 버그가 있었습니다.

    FRED 의 releases/dates 는 '우리가 보는 22개' 가 아니라 FRED 에 있는
    모든 발표를 돌려줍니다. 한 달 반이면 수천 줄입니다. 그런데 예전에는
    limit=1000 으로 한 번만 부르고, 날짜 오름차순이라 앞쪽 1000줄
    (= 기간의 앞부분) 만 받아왔습니다.

    그래서 8월 달력을 열면 (조회 구간 7/25~9/7) 앞쪽 1000줄이 8월 초에서
    끊겨 8월 말 발표가 통째로 사라졌고, 9월 달력을 열면 (구간 8/25~10/7)
    같은 8월 말 발표가 앞쪽에 들어와 보였습니다. "다음달을 눌러야 이번 달
    4주차가 나온다" 가 정확히 이것이었습니다.

    고치는 방법은 두 가지입니다.
      ① 페이지를 넘겨가며 끝까지 받는다
      ② 받는 족족 우리 표에 있는 것만 남긴다 (1000줄 제한에 안 걸리게)
    둘 다 합니다.                                                       */
async function fredReleaseDates(from: string, to: string) {
  const key = secret("FRED_API_KEY");
  if (!key) return null;

  const seen = new Set<string>();
  const out: any[] = [];
  const PAGE = 1000, MAX_PAGES = 8;

  for (let page = 0; page < MAX_PAGES; page++) {
    let d: any = null;
    try {
      //  여기도 fredGet 을 거칩니다 (속도 제한기 안쪽)
      d = await fredGet("releases/dates", {
        realtime_start: from, realtime_end: to,
        include_release_dates_with_no_data: "true",
        sort_order: "asc", limit: String(PAGE), offset: String(page * PAGE),
      });
    } catch { break; }
    const rows = d?.release_dates ?? [];
    for (const x of rows) {
      //  우리 표에 없는 발표는 여기서 버립니다 — 그래야 400개 상한이
      //  '엉뚱한 발표들' 로 먼저 차지 않습니다.
      if (!REL_BY_ID[String(x?.release_id)]) continue;
      const k = `${x?.date}|${x?.release_name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ date: x?.date ?? null, name: x?.release_name ?? null, id: x?.release_id ?? null });
    }
    //  마지막 장이면 그만
    if (rows.length < PAGE) break;
  }
  return { source: "FRED 발표 일정 (무료)", rows: out, pages_note: null };
}

//  ── 실적 발표 일정 ──────────────────────────
async function earningsCalendar(from: string, to: string, symbols: string) {
  const key = secret("EODHD_API_KEY");
  if (!key) throw new Error("EODHD_API_KEY 가 설정되지 않았습니다.");

  const u = new URL("https://eodhd.com/api/calendar/earnings");
  u.searchParams.set("api_token", key);
  u.searchParams.set("fmt", "json");
  u.searchParams.set("from", from);
  u.searchParams.set("to", to);
  if (symbols) u.searchParams.set("symbols", symbols);

  const r = await fetch(u);
  if (!r.ok) {
    if (planBlocked(r.status))
      return { rows: [], blocked: true, note: PLAN_MSG, from, to };
    throw new Error(`EODHD 실적 캘린더 오류 (${r.status})`);
  }
  const d = await r.json().catch(() => ({}));
  const raw = Array.isArray(d) ? d : (d?.earnings ?? []);
  const rows = (Array.isArray(raw) ? raw : []).map((x: any) => {
    const code = String(x?.code ?? "");
    const dot = code.lastIndexOf(".");
    return {
      code, symbol: dot > 0 ? code.slice(0, dot) : code,
      exchange: dot > 0 ? code.slice(dot + 1) : null,
      date: String(x?.report_date ?? x?.date ?? "").slice(0, 10),
      period: String(x?.date ?? "").slice(0, 10),
      when: x?.before_after_market ?? null,     // BeforeMarket / AfterMarket
      currency: x?.currency ?? null,
      actual: numOrNull(x?.actual),
      estimate: numOrNull(x?.estimate),
      diff: numOrNull(x?.difference),
      surprise_pct: numOrNull(x?.percent),
    };
  }).filter((x: any) => x.date)
    .sort((a: any, b: any) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));

  return { rows: rows.slice(0, 1200), blocked: false, note: null, from, to };
}


/* ══════════════════════════════════════════════════════════════
   미국 주식 옵션 — 무료 창구 (Alpaca)

     MarketData.app 은 계약 하나당 크레딧이 나갑니다.
     무료 등급은 하루 100계약(≈체인 한 번)에 24시간 지연이라
     학회원 여럿이 돌려 쓰기엔 빠듯합니다.

     Alpaca 는 계정만 만들면 옵션 스냅샷이 분당 200회까지 무료입니다.
     내재변동성과 그릭스(델타·감마·세타·베가·로)를 같이 줍니다.
     대신 스냅샷에는 미결제약정이 없어서, 계약 목록을 한 번 더 불러
     붙여 씁니다 (하루 지난 값입니다 — OCC 가 장 마감 뒤에 셉니다).
   ══════════════════════════════════════════════════════════════ */

const ALP_DATA = "https://data.alpaca.markets";
const ALP_TRADE = "https://paper-api.alpaca.markets";

function alpacaKeys() {
  const id = secret("ALPACA_KEY_ID");
  const sk = secret("ALPACA_SECRET_KEY");
  return id && sk ? { id, sk } : null;
}

/*  Alpaca 를 몇 번이나 불렀는지 세어 둡니다.

    "세 팀이 동시에 도는데 무료 요금제로 버티냐" 는 물음에 감으로
    답할 일이 아닙니다. 한 회차가 실제로 몇 번 부르는지 세어서
    자동매매 기록(auto_runs)에 남기면, 한도(분당 200회)에 얼마나
    가까운지 화면에서 그냥 보입니다.

    ⚠️ 팀이 늘어도 호출은 거의 안 늘어납니다 — 시세도 봉도 <한 벌만>
    받아서 모든 팀이 나눠 쓰기 때문입니다. 늘어나는 건 팀 수가 아니라
    <서로 다른 봉 기준의 수> 입니다.                                   */
let ALP_CALLS = 0;
const alpCallsReset = () => { ALP_CALLS = 0; };
const alpCalls = () => ALP_CALLS;

async function alpGet(base: string, path: string, params: Record<string, string>) {
  ALP_CALLS++;
  const k = alpacaKeys();
  if (!k) throw new Error(
    "ALPACA_KEY_ID · ALPACA_SECRET_KEY 가 없습니다. alpaca.markets 에서 발급받아 Secrets 에 넣어주세요.");
  const url = new URL(base + path);
  for (const [a, b] of Object.entries(params)) if (b) url.searchParams.set(a, b);
  const r = await fetch(url, {
    headers: { "APCA-API-KEY-ID": k.id, "APCA-API-SECRET-KEY": k.sk },
  });
  const text = await r.text();
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error("Alpaca 응답을 읽지 못했습니다."); }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403)
      throw new Error("Alpaca 키가 거부됐습니다. Key ID 와 Secret 을 다시 확인해주세요.");
    throw new Error(`Alpaca 조회 실패 (${r.status}): ${d?.message ?? text.slice(0, 120)}`);
  }
  return d;
}

//  계약 목록 — 만기·행사가·미결제를 여기서 얻습니다
async function alpContracts(symbol: string, expiration = "") {
  const out: any[] = [];
  let token = "";
  for (let page = 0; page < 4; page++) {
    const d: any = await alpGet(ALP_TRADE, "/v2/options/contracts", {
      underlying_symbols: symbol,
      status: "active",
      limit: "10000",
      ...(expiration ? { expiration_date: expiration }
                     : { expiration_date_gte: new Date().toISOString().slice(0, 10) }),
      ...(token ? { page_token: token } : {}),
    });
    for (const c of (d?.option_contracts ?? [])) out.push(c);
    token = d?.next_page_token ?? "";
    if (!token) break;
  }
  return out;
}

async function alpacaExpirations(symbol: string) {
  const sym = symbol.toUpperCase();
  const cs = await alpContracts(sym);
  if (!cs.length)
    return { symbol: sym, expirations: [], provider: "alpaca",
             note: "이 종목은 Alpaca 에서 옵션 계약을 찾지 못했습니다." };
  const today = new Date().toISOString().slice(0, 10);
  const days = [...new Set(cs.map((c: any) => String(c.expiration_date)))]
    .filter((x) => x >= today).sort().slice(0, 24);
  return {
    symbol: sym, provider: "alpaca",
    expirations: days.map((x) => ({
      date: x,
      dte: Math.round((Date.parse(x + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5),
    })),
  };
}

//  기초자산 현재가 — IEX 시세는 무료 등급에 들어 있습니다
async function alpSpot(symbol: string) {
  try {
    const d: any = await alpGet(ALP_DATA, `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`,
      { feed: "iex" });
    const p = Number(d?.trade?.p);
    if (Number.isFinite(p) && p > 0) return p;
  } catch { /* 아래에서 다시 시도 */ }
  try {
    const d: any = await alpGet(ALP_DATA, `/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`,
      { feed: "iex" });
    const p = Number(d?.bar?.c);
    if (Number.isFinite(p) && p > 0) return p;
  } catch { /* 없으면 0 */ }
  return 0;
}

function alpNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function alpacaChain(symbol: string, expiration: string, pct = 25) {
  const sym = symbol.toUpperCase();
  if (!expiration) throw new Error("만기를 먼저 골라주세요.");

  //  ① 계약 목록 (행사가·구분·미결제)
  const cs = await alpContracts(sym, expiration);
  if (!cs.length)
    return { symbol: sym, expiration, rows: [], provider: "alpaca",
             note: "해당 만기의 계약을 찾지 못했습니다." };

  const meta: Record<string, any> = {};
  for (const c of cs) meta[String(c.symbol)] = c;

  //  ② 현재가
  const spot = await alpSpot(sym);

  //  ③ 현재가 기준 몇 % 안쪽만 남깁니다.
  //     행사가 간격은 종목마다 딴판이라 '±20개' 보다 '±25%' 가 훨씬 예측 가능합니다.
  const band = Math.max(1, Math.min(pct || 25, 100)) / 100;
  const allStrikes = [...new Set(cs.map((c: any) => Number(c.strike_price)))]
    .filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let lo = allStrikes[0], hi = allStrikes[allStrikes.length - 1];
  if (spot > 0) {
    lo = Math.max(lo, spot * (1 - band));
    hi = Math.min(hi, spot * (1 + band));
    //  너무 좁아 아무것도 안 걸리면 등가격 근처 몇 개라도 남깁니다
    if (!allStrikes.some((k) => k >= lo && k <= hi)) {
      const near = allStrikes.slice()
        .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 20);
      lo = Math.min(...near); hi = Math.max(...near);
    }
  }

  //  ④ 스냅샷 — 내재변동성과 그릭스
  const snaps: Record<string, any> = {};
  let token = "";
  for (let page = 0; page < 4; page++) {
    const d: any = await alpGet(ALP_DATA, `/v1beta1/options/snapshots/${encodeURIComponent(sym)}`, {
      feed: "indicative",
      expiration_date: expiration,
      strike_price_gte: String(lo),
      strike_price_lte: String(hi),
      limit: "1000",
      ...(token ? { page_token: token } : {}),
    });
    Object.assign(snaps, d?.snapshots ?? {});
    token = d?.next_page_token ?? "";
    if (!token) break;
  }

  const rows: any[] = [];
  for (const [code, snap] of Object.entries<any>(snaps)) {
    const c = meta[code];
    if (!c) continue;
    const k = Number(c.strike_price);
    if (!Number.isFinite(k) || k < lo || k > hi) continue;

    const q = snap?.latestQuote ?? snap?.latest_quote ?? {};
    const bid = alpNum(q.bp ?? q.bid_price);
    const ask = alpNum(q.ap ?? q.ask_price);
    const mid = (bid != null && ask != null && bid > 0 && ask > 0) ? (bid + ask) / 2
              : alpNum((snap?.latestTrade ?? snap?.latest_trade ?? {}).p);
    let iv = alpNum(snap?.impliedVolatility ?? snap?.implied_volatility);
    if (iv != null && iv > 5) iv = iv / 100;
    const g = snap?.greeks ?? {};
    const side = String(c.type).toLowerCase() === "put" ? "put" : "call";

    rows.push({
      code, side, strike: k,
      bid, ask, mid,
      last: alpNum((snap?.latestTrade ?? snap?.latest_trade ?? {}).p),
      volume: 0,
      oi: Number(c.open_interest ?? 0) || 0,
      iv,
      delta: alpNum(g.delta), gamma: alpNum(g.gamma),
      theta: alpNum(g.theta), vega: alpNum(g.vega),
      itm: side === "call" ? k < spot : k > spot,
      intrinsic: side === "call" ? Math.max(0, spot - k) : Math.max(0, k - spot),
    });
  }
  rows.sort((a, b) => a.strike - b.strike || a.side.localeCompare(b.side));

  const oiDate = cs.map((c: any) => c.open_interest_date).filter(Boolean).sort().pop() ?? null;
  const dte = Math.round(
    (Date.parse(expiration + "T00:00:00Z") - Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z")) / 864e5);

  return {
    symbol: sym, expiration, spot, dte, rows,
    band: [lo, hi],
    credits: 0, provider: "alpaca",
    note: rows.length
      ? "Alpaca 자료입니다. 호가는 지연·보정된 값이고, 미결제약정은 "
        + (oiDate ? oiDate + " 기준으로 " : "") + "하루 늦게 반영됩니다. 거래량은 제공되지 않습니다."
      : "해당 만기의 자료가 없습니다.",
  };
}

/*  OCC 기호 해석 — AAPL  260918C00230000
      앞 6칸이 종목(모자라면 공백), 그다음 YYMMDD, C/P, 마지막 8자리가 행사가×1000.
    이걸 읽을 수 있으면 계약 목록을 따로 안 불러도 만기·행사가를 알 수 있습니다.  */
function parseOcc(sym: string) {
  const m = String(sym).match(/^([A-Z0-9.]{1,6})\s*(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  return {
    root: m[1],
    expiry: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`,
    side: m[3] === "P" ? "put" : "call",
    strike: Number(m[4]) / 1000,
  };
}

/*  만기별 등가격 IV.

    예전에는 만기마다 계약 목록과 스냅샷을 따로 불러서 만기 8개면 17번을 갔습니다.
    학회원 열댓 명이 동시에 누르면 분당 한도(200회)에 닿습니다.
    지금은 등가격 근처 행사가만 좁혀서 스냅샷을 한 번에 받고,
    기호에서 만기를 읽어 나눕니다 — 만기가 몇 개든 두세 번이면 끝납니다.       */
async function alpacaTerm(symbol: string, dates: string[]) {
  const sym = symbol.toUpperCase();
  const spot = await alpSpot(sym);
  if (!(spot > 0)) return { symbol: sym, spot: 0, term: [], credits: 0, provider: "alpaca" };

  const band = Math.max(spot * 0.03, 0.5);
  const snaps: Record<string, any> = {};
  let token = "";
  for (let page = 0; page < 3; page++) {
    const d: any = await alpGet(ALP_DATA, `/v1beta1/options/snapshots/${encodeURIComponent(sym)}`, {
      feed: "indicative",
      strike_price_gte: String(spot - band),
      strike_price_lte: String(spot + band),
      limit: "1000",
      ...(token ? { page_token: token } : {}),
    });
    Object.assign(snaps, d?.snapshots ?? {});
    token = d?.next_page_token ?? "";
    if (!token) break;
  }

  //  만기별로 등가격에 가장 가까운 계약만 남깁니다
  const byExp: Record<string, { gap: number; ivs: number[]; strike: number }> = {};
  for (const [code, snap] of Object.entries<any>(snaps)) {
    const oc = parseOcc(code);
    if (!oc) continue;
    if (dates.length && dates.indexOf(oc.expiry) < 0) continue;
    let iv = Number(snap?.impliedVolatility ?? snap?.implied_volatility);
    if (Number.isFinite(iv) && iv > 5) iv = iv / 100;
    if (!Number.isFinite(iv) || iv <= 0) continue;

    const gap = Math.abs(oc.strike - spot);
    const cur = byExp[oc.expiry];
    if (!cur || gap < cur.gap - 1e-9) byExp[oc.expiry] = { gap, ivs: [iv], strike: oc.strike };
    else if (cur && Math.abs(gap - cur.gap) < 1e-9) cur.ivs.push(iv);   // 같은 행사가 콜·풋
  }

  const today = Date.now();
  const term = Object.keys(byExp).sort().slice(0, 12).map((e) => {
    const x = byExp[e];
    return {
      date: e,
      dte: Math.round((Date.parse(e + "T00:00:00Z") - today) / 864e5),
      iv: x.ivs.reduce((a, b) => a + b, 0) / x.ivs.length,
      strike: x.strike,
    };
  }).filter((x) => x.dte >= 0);

  return { symbol: sym, spot, term, credits: 0, provider: "alpaca" };
}

/*  어느 창구를 쓸지 — 화면에서 고르거나, 키가 있는 쪽을 자동으로.
    둘 다 없으면 무엇을 넣어야 하는지 한국어로 알려줍니다.          */
function optProvider(want: string) {
  const w = String(want || "").toLowerCase();
  const hasMd = !!secret("MARKETDATA_API_KEY");
  const hasAlp = !!alpacaKeys();
  if (w === "alpaca") {
    if (!hasAlp) throw new Error(
      "Alpaca 키가 없습니다. alpaca.markets 가입 후 ALPACA_KEY_ID · ALPACA_SECRET_KEY 를 Secrets 에 넣어주세요.");
    return "alpaca";
  }
  if (w === "md" || w === "marketdata") {
    if (!hasMd) throw new Error(
      "MARKETDATA_API_KEY 가 없습니다. marketdata.app 에서 키를 발급받아 Secrets 에 넣어주세요.");
    return "md";
  }
  if (hasAlp) return "alpaca";      // 무료 쪽을 먼저 씁니다
  if (hasMd) return "md";
  throw new Error(
    "미국 주식 옵션 창구가 하나도 설정되지 않았습니다. "
    + "alpaca.markets 에서 키를 받아 ALPACA_KEY_ID · ALPACA_SECRET_KEY 를, "
    + "marketdata.app 을 쓰려면 MARKETDATA_API_KEY 를 Secrets 에 넣어주세요. "
    + "코인 옵션은 키 없이 바로 됩니다.");
}

//  지금 무엇을 쓸 수 있는지 화면에 알려줍니다
function optStatus() {
  return {
    marketdata: !!secret("MARKETDATA_API_KEY"),
    alpaca: !!alpacaKeys(),
    crypto: true,
  };
}

/* ═══════════════════════════════════════════════════════════════
   다크풀 — FINRA OTC (ATS · Non-ATS) Transparency

   미국 주식 거래의 상당 부분은 거래소 밖에서 체결됩니다. 그중
   ATS(대체거래시스템, 흔히 말하는 '다크풀') 물량을 FINRA 가 규정
   6110·6610 에 따라 종목별·운영사별로 모아 공표합니다.

   유료 서비스들이 파는 '다크풀 프린트'(체결 하나하나)와는 다릅니다.
   저건 실시간 체결 테이프라 값이 비싸고, 무엇보다 한 건 한 건을
   신호로 읽는 건 근거가 약합니다. FINRA 공표치는 주 단위 합계라
   느리지만 관(官)이 직접 낸 자료이고, "이 종목 거래의 몇 %가 장외에서
   돌았나 · 어느 다크풀이 주로 받았나" 라는 질문에는 오히려 더
   정확하게 답합니다. 학회 리서치에는 이쪽이 맞습니다.

   ⚠️ 공표는 지연됩니다 — NMS Tier1 은 2주, Tier2·OTC 는 4주 뒤.
      "어제 다크풀에서 무슨 일이 있었나" 는 이 자료로 알 수 없습니다.

   ⚠️ FINRA 는 자료를 쓸 때 출처 표기를 요구합니다. 화면에 항상
      "출처: FINRA" 를 답니다.

   Secrets — gateway.finra.org/app/dfo-console 에서 무료 발급
     (Create Account Here → Individual → API Console → 종류는 Public.
      Firm/Org 로 만들면 요금이 청구됩니다. finra.org/finra-data 는
      자료를 눈으로 보는 사이트라 열쇠가 안 나옵니다 — 헷갈리기 쉽습니다.)

     FINRA_API_ID       콘솔의 API Client (user) 값
     FINRA_API_SECRET   콘솔에는 안 나옵니다. 'Action Required' 메일의
                        링크에서 직접 정하는 값입니다.

     ⚠️ Secret 은 1년 뒤 만료됩니다. 만료되면 이 화면만 멈춥니다
        (의회 거래는 열쇠가 없어서 영향 없습니다). 콘솔 Reset 으로
        새로 정하고 이 시크릿을 덮어쓰면 됩니다.
   ═══════════════════════════════════════════════════════════════ */

const FINRA_TOKEN_URL =
  "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials";
const FINRA_DATA_URL = "https://api.finra.org/data/group/otcMarket/name/";

//  토큰은 30분쯤 삽니다. 같은 isolate 안에서 재사용합니다.
let finraTok = "";
let finraTokExp = 0;

async function finraToken() {
  const id = secret("FINRA_API_ID"), sec = secret("FINRA_API_SECRET");
  if (!id || !sec) {
    throw new Error(
      "FINRA_API_ID / FINRA_API_SECRET 이 없습니다. " +
      "gateway.finra.org/app/dfo-console 에서 Individual 계정을 만들고 " +
      "API Console → 자격증명 종류 Public 으로 발급받으세요 (무료). " +
      "ID 는 콘솔 화면에, Secret 은 'Action Required' 메일 링크에서 직접 정합니다. " +
      "두 값을 Edge Functions → Secrets 에 넣어주세요.");
  }
  if (finraTok && Date.now() < finraTokExp) return finraTok;

  const r = await fetch(FINRA_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(id + ":" + sec) },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    //  401 이 계속 나면 대개 자격증명이 1년 만료된 것입니다 (Secret 은 해마다 갱신).
    throw new Error(
      `FINRA 로그인 실패 (${r.status}). ` +
      (r.status === 401 || r.status === 400
        ? "자격증명이 만료됐을 수 있습니다 — FINRA API Secret 은 1년마다 새로 정해야 합니다. " +
          "gateway.finra.org/app/dfo-console → 해당 자격증명의 Reset → 메일 링크에서 새 Secret 을 " +
          "정하고 Supabase Secrets 의 FINRA_API_SECRET 을 덮어쓰세요. "
        : "") + t.slice(0, 160));
  }
  const d = await r.json();
  finraTok = String(d.access_token ?? "");
  if (!finraTok) throw new Error("FINRA 가 토큰을 주지 않았습니다.");
  //  만료 1분 전에 미리 새로 받습니다
  finraTokExp = Date.now() + Math.max(60, Number(d.expires_in ?? 1800) - 60) * 1000;
  return finraTok;
}

type FinraFilter = { compareType: string; fieldName: string; fieldValue: string };

async function finraQuery(
  dataset: string,
  filters: FinraFilter[],
  limit = 1000,
  dateRange?: { fieldName: string; startDate: string; endDate: string },
) {
  const tok = await finraToken();
  const body: Record<string, unknown> = { limit, compareFilters: filters };
  if (dateRange) body.dateRangeFilters = [dateRange];

  const r = await fetch(FINRA_DATA_URL + dataset, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tok,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (r.status === 401 || r.status === 403) {
    //  토큰이 먼저 죽었을 수 있습니다. 한 번만 새로 받아 다시 시도합니다.
    finraTok = ""; finraTokExp = 0;
    const tok2 = await finraToken();
    const r2 = await fetch(FINRA_DATA_URL + dataset, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok2,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r2.ok) throw new Error(`FINRA 응답 오류 ${r2.status}`);
    return await r2.json();
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`FINRA 응답 오류 ${r.status}. ${t.slice(0, 160)}`);
  }
  return await r.json();
}

function finraRows(d: any): any[] {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  if (d && Array.isArray(d.records)) return d.records;
  return [];
}

//  FINRA 는 필드 이름을 카멜/소문자로 섞어 씁니다. 한쪽으로 맞춰 읽습니다.
function fget(row: any, ...names: string[]) {
  for (const n of names) {
    if (row[n] != null) return row[n];
    const lower = n.toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === lower && row[k] != null) return row[k];
    }
  }
  return null;
}

/*  한 종목의 장외 거래.

    ATS_W_SMBL_FIRM  종목 × 다크풀 운영사별 (어느 다크풀이 받았나)
    OTC_W_SMBL       종목 전체 장외 합계 (ATS 아닌 곳 포함)              */
async function darkpool(symbol: string, weeks: number) {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
    throw new Error("미국 주식 티커만 조회할 수 있습니다 (예: AAPL, NVDA).");
  }
  //  요청 주 수 만큼만 거슬러 올라갑니다. 공표 지연이 4주까지 있어서
  //  여유 있게 잡아야 최근 자료가 빈 채로 나오지 않습니다.
  const from = shiftDay(todayISO(), -(Math.max(4, weeks) + 8) * 7);

  const [byFirm, otcTot] = await Promise.all([
    finraQuery("weeklySummary", [
      { compareType: "EQUAL", fieldName: "summaryTypeCode", fieldValue: "ATS_W_SMBL_FIRM" },
      { compareType: "EQUAL", fieldName: "issueSymbolIdentifier", fieldValue: sym },
    ], 5000, { fieldName: "weekStartDate", startDate: from, endDate: todayISO() }),
    finraQuery("weeklySummary", [
      { compareType: "EQUAL", fieldName: "summaryTypeCode", fieldValue: "OTC_W_SMBL" },
      { compareType: "EQUAL", fieldName: "issueSymbolIdentifier", fieldValue: sym },
    ], 2000, { fieldName: "weekStartDate", startDate: from, endDate: todayISO() }).catch(() => null),
  ]);

  const rows = finraRows(byFirm);
  if (!rows.length) {
    return { symbol: sym, weeks: [], venues: [], note:
      "이 종목에 대해 FINRA 가 공표한 장외 거래 자료가 없습니다. " +
      "티커를 확인하시거나, 상장한 지 얼마 안 된 종목인지 살펴보세요." };
  }

  //  주별 합계와 운영사별 합계를 각각 모읍니다
  const perWeek = new Map<string, { ats: number; trades: number }>();
  const perVenue = new Map<string, { name: string; shares: number; trades: number }>();
  let tier = "";

  for (const r of rows) {
    const wk = String(fget(r, "weekStartDate", "weekstartdate") ?? "").slice(0, 10);
    const sh = Number(fget(r, "totalWeeklyShareQuantity", "totalweeksharequantity") ?? 0);
    const tc = Number(fget(r, "totalWeeklyTradeCount", "totalweektradecount") ?? 0);
    const mp = String(fget(r, "MPID", "marketParticipantIdentifier", "mpid") ?? "").trim();
    const nm = String(fget(r, "marketParticipantName", "marketparticipantname") ?? mp).trim();
    if (!tier) tier = String(fget(r, "tierIdentifier", "tieridentifier") ?? "").trim();
    if (!wk || !(sh > 0)) continue;

    const w = perWeek.get(wk) ?? { ats: 0, trades: 0 };
    w.ats += sh; w.trades += tc; perWeek.set(wk, w);

    if (mp) {
      const v = perVenue.get(mp) ?? { name: nm || mp, shares: 0, trades: 0 };
      v.shares += sh; v.trades += tc; perVenue.set(mp, v);
    }
  }

  //  장외 전체(ATS + 비ATS) 합계 — 다크풀 비중을 재는 분모입니다
  const otcWeek = new Map<string, number>();
  for (const r of finraRows(otcTot)) {
    const wk = String(fget(r, "weekStartDate", "weekstartdate") ?? "").slice(0, 10);
    const sh = Number(fget(r, "totalWeeklyShareQuantity", "totalweeksharequantity") ?? 0);
    if (wk && sh > 0) otcWeek.set(wk, (otcWeek.get(wk) ?? 0) + sh);
  }

  const weeksOut = [...perWeek.entries()]
    .map(([d, v]) => ({
      d,
      ats: v.ats,
      trades: v.trades,
      otc: otcWeek.get(d) ?? null,
      //  한 건 평균 몇 주(株)였나 — 기관 물량인지 잔주문인지 가늠합니다
      avg: v.trades > 0 ? v.ats / v.trades : null,
    }))
    .sort((a, b) => a.d < b.d ? -1 : 1)
    .slice(-Math.max(4, weeks));

  const venues = [...perVenue.entries()]
    .map(([mpid, v]) => ({ mpid, name: v.name, shares: v.shares, trades: v.trades }))
    .sort((a, b) => b.shares - a.shares);

  const total = venues.reduce((s, v) => s + v.shares, 0);
  venues.forEach((v: any) => { v.pct = total > 0 ? v.shares / total * 100 : 0; });

  return {
    symbol: sym, tier, weeks: weeksOut, venues,
    lag: tier === "T1" ? 2 : 4,
    source: "FINRA OTC (ATS · Non-ATS) Transparency",
  };
}

/*  최근 한 주 다크풀 물량이 큰 종목.

    "요즘 어디에 장외 물량이 몰렸나" 를 보는 화면입니다. 종목별 합계
    (ATS_W_SMBL) 를 받아 상위만 남깁니다.                                */
async function darkpoolTop(tierId: string, limit: number) {
  const tier = ["T1", "T2", "OTCE"].includes(tierId) ? tierId : "T1";
  const from = shiftDay(todayISO(), -10 * 7);

  const d = await finraQuery("weeklySummary", [
    { compareType: "EQUAL", fieldName: "summaryTypeCode", fieldValue: "ATS_W_SMBL" },
    { compareType: "EQUAL", fieldName: "tierIdentifier", fieldValue: tier },
  ], 5000, { fieldName: "weekStartDate", startDate: from, endDate: todayISO() });

  const rows = finraRows(d);
  //  가장 최근 주만 남깁니다 (공표가 늦어 오늘 기준이 아닙니다)
  let last = "";
  for (const r of rows) {
    const wk = String(fget(r, "weekStartDate", "weekstartdate") ?? "").slice(0, 10);
    if (wk > last) last = wk;
  }
  const out = rows
    .filter((r) => String(fget(r, "weekStartDate", "weekstartdate") ?? "").slice(0, 10) === last)
    .map((r) => ({
      symbol: String(fget(r, "issueSymbolIdentifier", "issuesymbolidentifier") ?? "").trim(),
      name: String(fget(r, "issueName", "issuename") ?? "").trim(),
      shares: Number(fget(r, "totalWeeklyShareQuantity", "totalweeksharequantity") ?? 0),
      trades: Number(fget(r, "totalWeeklyTradeCount", "totalweektradecount") ?? 0),
    }))
    .filter((x) => x.symbol && x.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, Math.min(200, Math.max(10, limit)));

  out.forEach((x: any) => { x.avg = x.trades > 0 ? x.shares / x.trades : null; });
  return { week: last, tier, rows: out, source: "FINRA OTC (ATS) Transparency" };
}

/* ═══════════════════════════════════════════════════════════════
   모의투자 — 실시간 시세 · 주문 · 자동매매 스캔

   설계에서 정한 것들
     · 미국·코인은 <b>누를 때의 시세</b>로 체결 (Alpaca 무료 등급)
     · 국내는 <b>그날 종가</b>로 체결하되, 종가가 나온 뒤(15:30 이후)에만
     · 평가·순위 환율은 <b>1,400원 고정</b> — 환율로 등수가 갈리면
       종목을 고른 실력이 아니게 됩니다
     · 1억은 직접·자동이 나눠 쓰는 한 지갑

   ⚠️ 체결가는 반드시 서버가 정합니다.
      화면이 보낸 가격을 그대로 믿으면, 개발자도구를 열 줄 아는 학회원이
      원하는 값에 체결할 수 있습니다. 대회가 통째로 무의미해집니다.
   ═══════════════════════════════════════════════════════════════ */

const MT_FX = 1400;                   //  평가·순위용 고정 환율 (contest 에서 덮어씁니다)

/*  수수료 — 실제와 비슷하게, 다만 단순하게.
    국내 매도에는 증권거래세(0.18%)가 붙어 사고팔 때가 다릅니다.        */
const MT_FEE = {
  KR:     { buy: 0.00015, sell: 0.00015 + 0.0018 },
  US:     { buy: 0.0025,  sell: 0.0025 },
  CRYPTO: { buy: 0.0005,  sell: 0.0005 },
} as Record<string, { buy: number; sell: number }>;

function mtFee(market: string, side: string, gross: number) {
  const f = MT_FEE[market] ?? MT_FEE.US;
  return Math.round(gross * (side === "buy" ? f.buy : f.sell));
}

//  한국 시간 지금
function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function kstParts() {
  const d = kstNow();
  return {
    iso: d.toISOString().slice(0, 10),
    hhmm: d.toISOString().slice(11, 16),
    dow: d.getUTCDay(),                       //  0 일 … 6 토
  };
}

/*  ── Alpaca 시세 ───────────────────────────────────────────

    무료 등급은 IEX 한 거래소만 실시간입니다. 거래가 많은 종목은
    전체 시장가와 거의 같지만, 거래가 적은 종목은 값이 튈 수 있습니다.
    화면에 어느 창구에서 온 값인지 적어둡니다.                        */
async function alpQuotesUS(symbols: string[]) {
  const out: Record<string, { price: number; at: string }> = {};
  if (!symbols.length) return out;
  //  한 번에 여러 종목 — 팀이 몇이든 스캔은 한 번만 돌면 됩니다
  for (let i = 0; i < symbols.length; i += 200) {
    const chunk = symbols.slice(i, i + 200);
    const d = await alpGet(ALP_DATA, "/v2/stocks/trades/latest",
      { symbols: chunk.join(","), feed: "iex" });
    for (const [sym, t] of Object.entries<any>(d?.trades ?? {})) {
      const p = Number(t?.p);
      if (Number.isFinite(p) && p > 0) out[sym.toUpperCase()] = { price: p, at: String(t?.t ?? "") };
    }
  }
  return out;
}

/*  ── 평가액용 시세 보관함 (20초) ────────────────────────────

    ⚠️ 현황 화면은 30초마다 저절로 새로 받습니다. 학회원 15명이 터미널을
    켜 두면 그것만으로 분당 60번쯤 Alpaca 를 부르게 됩니다 — 다섯 명이
    같은 팀이면 <똑같은 종목 시세를 다섯 번> 따로 받는 셈입니다.

    그래서 <평가액을 매길 때 쓰는 시세> 만 20초 동안 나눠 씁니다.
    같은 팀 다섯 명이 동시에 새로고침해도 실제 호출은 한 번입니다.

    ⚠️ 체결가에는 절대 안 씁니다. 주문이 실제로 체결되는 값(mtPrice)과
    자동매매 스캔은 늘 새로 받습니다 — 20초 전 값으로 체결되면
    "누르는 순간의 시세로 체결됩니다" 가 거짓말이 됩니다.            */
const QUOTE_TTL_MS = 20000;
const QUOTE_CACHE = new Map<string, { price: number; at: string; t: number }>();

function quoteCachePut(mk: string, got: Record<string, any>) {
  const now = Date.now();
  for (const [sym, q] of Object.entries<any>(got ?? {}))
    if (Number(q?.price) > 0)
      QUOTE_CACHE.set(mk + "|" + sym, { price: Number(q.price), at: String(q.at ?? ""), t: now });
}

/*  평가액용 — 20초 안에 받아둔 건 그대로 쓰고, 없는 것만 새로 받습니다. */
async function quotesForValue(us: string[], cc: string[]) {
  const now = Date.now();
  const outUS: Record<string, any> = {}, outCC: Record<string, any> = {};
  const missUS: string[] = [], missCC: string[] = [];
  for (const sy of us) {
    const hit = QUOTE_CACHE.get("US|" + sy);
    if (hit && now - hit.t < QUOTE_TTL_MS) outUS[sy] = hit; else missUS.push(sy);
  }
  for (const sy of cc) {
    const hit = QUOTE_CACHE.get("CRYPTO|" + sy);
    if (hit && now - hit.t < QUOTE_TTL_MS) outCC[sy] = hit; else missCC.push(sy);
  }
  const [gU, gC] = await Promise.all([
    missUS.length ? alpQuotesUS(missUS).catch(() => ({})) : Promise.resolve({}),
    missCC.length ? alpQuotesCrypto(missCC).catch(() => ({})) : Promise.resolve({}),
  ]);
  quoteCachePut("US", gU); quoteCachePut("CRYPTO", gC);
  Object.assign(outUS, gU); Object.assign(outCC, gC);
  return [outUS, outCC] as const;
}

/*  ══ Alpaca 코인 심볼 — 여기서 스캔이 통째로 멈췄습니다 ═══════════

    ⚠️ 실제로 있었던 일

    「왜 안 샀는지 보기」가 <시세를 받은 종목 0>, <봉을 받은 종목 0> 에서
    멈춰 있었습니다. 코인 50종목이 열려 있는데 하나도 못 받았습니다.

    원인은 심볼 하나였습니다. Alpaca 의 코인 시세 창구는 심볼을
    정규식 ^[A-Z]+/[A-Z]+$ 로 검사합니다. 우리 명단에 있던 <1INCH-USD>
    는 1 로 시작해서 이 검사를 통과하지 못합니다. 그러면 Alpaca 는
    <그 심볼만 빼는 게 아니라 요청 전체를 400 으로 돌려보냅니다>.
    한 종목 때문에 45종목이 전부 0 이 된 것입니다.

    게다가 명단에 있던 대부분(HIGH · KAITO · AEVO · API3 · BERA · JTO ·
    IP · DYDX · AR · BAND · AXS · ATOM · ALGO)은 <Alpaca 가 아예 취급하지
    않는 코인>이었습니다. 명단은 거래대금 상위 50으로 뽑았는데, 체결은
    Alpaca 로 하니 애초에 살 수 없는 코인들이 들어와 있었습니다.

    그래서 두 겹으로 막습니다.
      ① Alpaca 에게 <네가 취급하는 코인 목록> 을 직접 물어봅니다
         (GET /v2/assets?asset_class=crypto). 그 안에 있는 것만 씁니다.
      ② 그래도 모양이 안 맞는 심볼은 보내기 전에 걸러냅니다.
      ③ 그럼에도 묶음이 400 이 나면 <한 종목씩> 다시 물어봅니다.
         한 개가 나빠서 마흔다섯 개가 죽는 일은 다시 없어야 합니다.     */
const ALP_PAIR_RE = /^[A-Z]+\/[A-Z]+$/;

//  BTC-USD · BTC · btc/usd → BTC/USD (못 만들면 null)
function alpPair(sym: string): string | null {
  const u = String(sym ?? "").trim().toUpperCase();
  if (!u) return null;
  const p = u.includes("/") ? u : (u.includes("-") ? u.replace("-", "/") : u + "/USD");
  return ALP_PAIR_RE.test(p) ? p : null;
}

//  Alpaca 가 취급하는 코인 목록 (하루 한 번만 물어봅니다)
async function alpCryptoAssets(admin: any): Promise<Set<string>> {
  const empty = new Set<string>();
  if (!alpacaKeys()) return empty;
  try {
    const { data: hit } = await admin.from("series_cache")
      .select("payload, fetched_at").eq("source", "alp_assets")
      .eq("code", "crypto").eq("item_code", "").maybeSingle();
    const age = hit ? (Date.now() - Date.parse(hit.fetched_at)) / 36e5 : 999;
    const cached = (hit?.payload as any)?.pairs;
    if (age < 24 && Array.isArray(cached) && cached.length) return new Set(cached);

    const d: any = await alpGet(ALP_TRADE, "/v2/assets",
      { asset_class: "crypto", status: "active" });
    const pairs = (Array.isArray(d) ? d : [])
      .map((a: any) => String(a?.symbol ?? "").toUpperCase())
      .filter((s: string) => ALP_PAIR_RE.test(s));
    if (!pairs.length) return cached?.length ? new Set(cached) : empty;
    await admin.from("series_cache").upsert({
      source: "alp_assets", code: "crypto", item_code: "",
      fetched_at: new Date().toISOString(), payload: { pairs },
    });
    return new Set(pairs);
  } catch (e) {
    console.warn("Alpaca 코인 목록 조회 실패", String((e as any)?.message ?? e));
    return empty;
  }
}

async function alpQuotesCrypto(symbols: string[]) {
  const out: Record<string, { price: number; at: string }> = {};
  if (!symbols.length) return out;
  /*  ⚠️ 모양이 안 맞는 심볼이 하나라도 섞이면 Alpaca 가 <요청 전체를>
      400 으로 돌려보냅니다. 보내기 전에 걸러냅니다.                   */
  const pairs = symbols.map(alpPair).filter(Boolean) as string[];
  const dropped = symbols.length - pairs.length;
  if (dropped) console.warn("코인 심볼", dropped, "개는 Alpaca 모양이 아니라 건너뜁니다");
  if (!pairs.length) return out;
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    //  ⚠️ 그래도 400 이 나면 (취급 안 하는 코인 등) 한 개씩 다시 —
    //     한 종목 때문에 나머지가 통째로 사라지면 안 됩니다.
    const d = await alpGet(ALP_DATA, "/v1beta3/crypto/us/latest/trades",
      { symbols: chunk.join(",") })
      .catch(async () => {
        const acc: any = { trades: {} };
        for (const one of chunk) {
          const r: any = await alpGet(ALP_DATA, "/v1beta3/crypto/us/latest/trades",
            { symbols: one }).catch(() => null);
          if (r?.trades) Object.assign(acc.trades, r.trades);
        }
        return acc;
      });
    for (const [pair, t] of Object.entries<any>(d?.trades ?? {})) {
      const p = Number(t?.p);
      if (Number.isFinite(p) && p > 0) {
        out[pair.replace("/", "-").toUpperCase()] = { price: p, at: String(t?.t ?? "") };
      }
    }
  }
  return out;
}

//  국내 — 마지막 종가 (무료 창구에 실시간이 없습니다)
/*  ── 지금 «나와 있어야 할» 국내 종가 날짜 ────────────────────

    ⚠️ 공공데이터포털은 그날 종가를 <다음 영업일 오후 1시 이후> 에 줍니다.
       그래서 «가장 최근에 받을 수 있는 종가» 는 시각에 따라 다릅니다.
         · 토·일        → 금요일 종가
         · 평일 13시 전 → 전 영업일 종가 (오늘 것은 아직 안 나옴)
         · 평일 13시 후 → 전 영업일 종가 (오늘 것은 장중이라 미확정)
    ⚠️ 공휴일 달력은 없습니다. 그래서 «이 날짜보다 오래됐으면 다시
       받아본다» 는 <기준선> 으로만 씁니다 — 정확히 맞출 필요는 없고,
       2주 묵은 값을 그대로 내놓지만 않으면 됩니다.                    */
function krFreshCloseDay() {
  const { iso, dow } = kstParts();
  //  토(6)·일(0) 이면 직전 금요일까지 물러섭니다
  let back = dow === 6 ? 1 : dow === 0 ? 2 : 1;
  let day = shiftDay(iso, -back);
  //  물러선 날이 주말이면 한 번 더 (월요일에 1 만 빼면 일요일이 됩니다)
  for (let i = 0; i < 3; i++) {
    const w = new Date(day + "T00:00:00Z").getUTCDay();
    if (w !== 0 && w !== 6) break;
    day = shiftDay(day, -1);
  }
  return day;
}

/*  ── 국내 마지막 종가 ────────────────────────────────────────

    ⚠️ 예전에는 price_cache 에 <무엇이든 한 줄이라도> 있으면 그걸
       그대로 썼습니다. 그래서 누가 8월 28일에 한 번 열어본 종목은
       9월 13일에도 «2026-08-28 종가» 가 붙었습니다 — 16일 묵은 값을
       오늘 주문 체결가로 쓴 셈입니다. 실제로 삼성공조가 그랬습니다.

       price_cache 를 채우는 건 (ㄱ) 누가 차트를 열 때 (ㄴ) 주 1회
       지난시세 채우기 (ㄷ) 자동매매가 <보유 종목> 시세를 갱신할 때
       뿐입니다. 보유도 안 한 종목을 아무도 안 열면 영원히 안 늙습니다.

    이제는 <기준선보다 오래됐으면 다시 받아봅니다>. 받아온 게 더
    새것이면 그걸 쓰고 보관함에도 넣어 둡니다 (다음 사람은 공짜).
    못 받아오면 옛것이라도 돌려줍니다 — 없는 것보다는 나으니까요.   */
async function krLastClose(admin: any, symbol: string) {
  const { data } = await admin.from("price_cache")
    .select("on_date, close").eq("market", "KR").eq("symbol", symbol)
    .order("on_date", { ascending: false }).limit(1).maybeSingle();
  const cached = (data?.close > 0)
    ? { price: Number(data.close), on: String(data.on_date) } : null;

  //  기준선만큼 새것이면 그대로 씁니다 (호출을 아낍니다)
  const need = krFreshCloseDay();
  if (cached && cached.on >= need) return cached;

  //  묵었으면 다시 받아봅니다
  let pts: any[] = [];
  try { pts = await fetchQuoteKR(symbol, shiftDay(todayISO(), -20)); }
  catch (e) { console.warn("국내 종가 재조회 실패", symbol, String(e)); }
  const last = pts[pts.length - 1];

  if (last && (!cached || String(last.d) > cached.on)) {
    //  받아온 값을 보관함에 넣어 둡니다 — 다음 사람은 안 기다립니다
    try {
      await admin.rpc("price_bulk_upsert", { p_rows: pts.slice(-30).map((x: any) => ({
        market: "KR", symbol, d: String(x.d), v: Number(x.v) })) });
    } catch (e) { /* 저장 실패해도 값은 돌려줍니다 */ }
    return { price: Number(last.v), on: String(last.d) };
  }
  //  새로 못 받았으면 옛것이라도 (없는 것보다 낫습니다)
  return cached;
}

/*  ── 미국 시세 예비 창구 : MarketData.app ────────────────────

    ⚠️ 평소에는 Alpaca(IEX 실시간)만 씁니다. 이건 <Alpaca 가 답을 못 줄 때>
       만 켜지는 예비입니다 — 한도 초과, 장애, 상장폐지 직후 등.

    ⚠️ 값의 성격이 다릅니다. MarketData.app 무료 등급은 문서상
       «15분 지연(UTP 권한 있을 때) 또는 하루 전 값» 입니다. Alpaca 보다
       나은 값이 아니라 <없는 것보다 나은> 값입니다. 그래서 basis 에
       그대로 «예비 창구(지연)» 라고 적습니다.

    ⚠️ 과금이 <종목당 1크레딧> 입니다. 한 종목씩만 부릅니다.
    ⚠️ MD 상수는 아래 파생상품 절에 있습니다 (같은 서비스라 같이 씁니다).  */
function mdOn() { return !!secret("MARKETDATA_API_KEY"); }

async function mdQuoteUS(symbol: string) {
  const key = secret("MARKETDATA_API_KEY");
  if (!key) return null;
  const sym = String(symbol).trim().toUpperCase();
  try {
    const r = await fetch(`https://api.marketdata.app/v1/stocks/quotes/${encodeURIComponent(sym)}/`,
                          { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) { console.warn("md quote", r.status, sym); return null; }
    const d: any = await r.json();
    //  응답이 <배열 묶음> 으로 옵니다 — 첫 칸을 씁니다
    if (String(d?.s) !== "ok") return null;
    const px = Number((d.last ?? [])[0] ?? (d.mid ?? [])[0]);
    if (!(px > 0)) return null;
    const t = Number((d.updated ?? [])[0]);
    return { price: px,
             at: Number.isFinite(t) ? new Date(t * 1000).toISOString() : new Date().toISOString() };
  } catch { return null; }
}

/*  ── 국내 장중 시세 예비 창구 : Perplexity Finance Search ────

    ⚠️ 무엇을 위한 것인가. 국내 주식은 <직접매매> 할 때 지금 값이 필요한데,
       거래소 시세를 학회 사이트에 띄우려면 KRX 정보이용계약(옵션3)이
       필요합니다. 그 답을 기다리는 동안, 국내 직접매매만이라도 «지금 값
       비슷한 것» 으로 하려고 씁니다.

    ⚠️ 이건 <검색으로 받아온 참고가> 입니다. 거래소 체결가가 아닙니다.
       그래서 세 겹으로 막습니다 —
         ① 전일 종가 대비 ±30%(상하한가) 밖이면 <버립니다>. 모델이
            자릿수를 틀리거나 다른 종목을 물어오는 큰 사고는 여기서 걸립니다.
         ② 출처 URL 을 받아 체결 기록(fill_basis)에 남깁니다. 나중에
            "이 가격 어디서 왔냐" 는 질문에 답할 수 있어야 합니다.
         ③ 60초 담아둡니다. 같은 1분에 산 사람은 <같은 가격> 에 체결돼서
            대회가 공정해지고, 호출 수도 줄어듭니다.

    ⚠️ <자동매매에는 안 씁니다.> 국내는 autoTradable() 에서 이미 빠져
       있습니다. 여기는 사람이 직접 누르는 주문에만 붙습니다.

    ⚠️ 미국·코인은 이 함수를 절대 안 지납니다. Alpaca 가 실시간 거래소
       시세를 주므로 검색으로 바꿀 이유가 없습니다.

    Secrets: PERPLEXITY_API_KEY                                          */
const PPLX_URL = "https://api.perplexity.ai/v1/agent";
const PPLX_MODEL = "sonar";          //  제일 싼 모델 — 숫자 하나만 받으면 됩니다
const PPLX_CACHE_SEC = 60;
const PPLX_BAND = 0.30;              //  전일 종가 대비 허용 폭 (KRX 상하한가)

function pplxOn() { return !!secret("PERPLEXITY_API_KEY"); }

async function pplxQuoteKR(admin: any, symbol: string, name: string) {
  const key = secret("PERPLEXITY_API_KEY");
  if (!key) return null;
  const sym = String(symbol).trim();

  //  ── 60초 캐시 ──
  try {
    const { data: hit } = await admin.from("series_cache")
      .select("payload, fetched_at").eq("source", "pplx_kr")
      .eq("code", sym).eq("item_code", "v1").maybeSingle();
    if (hit?.payload?.price > 0) {
      const age = (Date.now() - new Date(hit.fetched_at).getTime()) / 1000;
      if (age < PPLX_CACHE_SEC) return { ...(hit.payload as any), cached: true };
    }
  } catch { /* 캐시를 못 읽어도 새로 받습니다 */ }

  const ask = `한국거래소 상장 종목 ${name || ""} (종목코드 ${sym}) 의 <지금 주가>를 찾아
**JSON 하나만** 출력하세요. 설명·인사말·코드펜스 금지.
값을 못 찾으면 price 를 null 로 두세요 — **절대 지어내지 마세요.**
price 는 원(KRW) 단위 정수입니다. 소수점·쉼표·단위 글자를 넣지 마세요.

{"price": 0, "as_of": "YYYY-MM-DD HH:MM", "delayed_min": 0, "name": ""}`;

  let r: Response;
  try {
    r = await fetch(PPLX_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PPLX_MODEL, input: ask,
        tools: [{ type: "finance_search" }],
        max_steps: 2,
      }),
    });
  } catch { return null; }
  if (!r.ok) { console.warn("pplx kr", r.status, sym); return null; }

  let d: any = null;
  try { d = JSON.parse(await r.text()); } catch { return null; }

  let say = "";
  const sources: string[] = [];
  for (const o of (Array.isArray(d?.output) ? d.output : [])) {
    if (o?.type === "message")
      for (const c of (o.content ?? [])) if (c?.type === "output_text") say += c.text ?? "";
    if (o?.type === "finance_results")
      for (const res of (o.results ?? []))
        for (const u of (res?.sources ?? [])) if (typeof u === "string") sources.push(u);
  }
  let got: any = null;
  const a = say.indexOf("{"), b = say.lastIndexOf("}");
  if (a >= 0 && b > a) { try { got = JSON.parse(say.slice(a, b + 1)); } catch { /* 못 읽음 */ } }
  const price = Number(got?.price);
  if (!(price > 0)) return null;

  const out = {
    price, at: String(got?.as_of ?? "").slice(0, 16) || new Date().toISOString().slice(0, 16),
    delayed_min: Number(got?.delayed_min) || null,
    sources: [...new Set(sources)].slice(0, 3),
  };
  try {
    await admin.from("series_cache").upsert({
      source: "pplx_kr", code: sym, item_code: "v1",
      fetched_at: new Date().toISOString(), payload: out,
    });
  } catch { /* 못 담아둬도 값은 씁니다 */ }
  return out;
}

/*  ⚠️ 이 검사가 이 기능의 <핵심> 입니다.

    검색으로 받아온 숫자는 틀릴 수 있습니다. 자릿수를 하나 빠뜨리거나
    (82,400 → 8,240), 우선주를 보통주로 착각하거나, 아예 다른 종목을
    물어올 수 있습니다. 그런 값으로 체결되면 팀 자산이 통째로 망가지고,
    대회가 끝난 뒤에야 발견됩니다.

    KRX 는 하루 등락을 ±30% 로 제한합니다. 전일 종가에서 그 밖으로 나간
    값은 <실제로 존재할 수 없는 가격> 이므로, 그런 건 버리고 종가로
    떨어집니다. 미세한 오차는 못 걸러도, 사고는 여기서 다 걸립니다.       */
function pplxSane(price: number, prevClose: number) {
  if (!(price > 0)) return { ok: false, why: "값이 없습니다." };
  if (!(prevClose > 0)) return { ok: true, why: "" };   //  비교할 종가가 없으면 통과
  const lo = prevClose * (1 - PPLX_BAND), hi = prevClose * (1 + PPLX_BAND);
  if (price < lo || price > hi)
    return { ok: false,
             why: `직전 종가 ${Math.round(prevClose).toLocaleString("ko-KR")}원 대비 `
                + `${Math.round((price / prevClose - 1) * 100)}% 라 상하한가(±30%)를 벗어납니다.` };
  return { ok: true, why: "" };
}

/*  ── 한 종목 체결가 ────────────────────────────────────────

    주문 화면이 부르고, 주문할 때 서버가 다시 한 번 부릅니다.
    (화면에 보인 값과 실제 체결가가 다를 수 있는데, 그게 맞습니다 —
     실제 매매도 그렇습니다. 대신 체결 뒤에 얼마에 됐는지 알려줍니다) */
async function mtPrice(admin: any, market: string, symbol: string, name = "") {
  const sym = symbol.trim().toUpperCase();
  const mk = market.toUpperCase();

  if (mk === "KR") {
    //  ① 증권사 창구(KIS) — 거래소 시세입니다. 가장 정확합니다.
    if (kisOn() && krMarketOpen()) {
      const q = (await kisQuoteKR(admin, [sym]))[sym];
      if (q) return { price: q.price, currency: "KRW", basis: "실시간",
                      live: true, as_of: q.at,
                      note: "한국투자증권 실시간 시세입니다." };
      //  못 받으면 아래로 넘어갑니다 (공휴일·거래정지 등)
    }
    /*  ② EODHD — 학회 이메일로 등록되는 창구입니다.
        ⚠️ 거래소 직결이 아니라 여러 곳을 모은 값이고, 약 15~20분
           늦습니다. 그걸 숨기면 안 됩니다 — 체결 기록에도 그대로
           "지연·집계" 라고 남습니다.                                  */
    if (!kisOn() && eodhdOn() && krMarketOpen()) {
      const q = (await eodhdQuoteKR(admin, [sym]))[sym];
      if (q) return { price: q.price, currency: "KRW", basis: "지연 시세(약 15~20분)",
                      live: false, as_of: q.at,
                      note: "EODHD 집계 시세입니다 — 거래소 직결이 아니라 여러 곳의 "
                          + "체결을 모아 만든 값이라 <b>실제 체결가와 다를 수 있습니다</b>. "
                          + "거래가 적은 종목일수록 차이가 큽니다." };
    }
    //  ② 마지막 종가는 <검증 기준> 으로도 씁니다 — 먼저 받아둡니다
    const c = await krLastClose(admin, sym);

    /*  ③ Perplexity — 검색으로 받아온 <참고가> 입니다.
        ⚠️ 거래소 체결가가 아닙니다. 그래서 반드시 상하한가 검사를
           지나야 하고, 통과해도 화면과 체결 기록에 «AI 검색 참고가» 라고
           그대로 남습니다. 숨기면 안 됩니다.
        ⚠️ 사람이 직접 누르는 주문에만 붙습니다 — 국내는 autoTradable()
           에서 이미 빠져 있어 자동매매는 여기 오지 않습니다.            */
    if (!kisOn() && !eodhdOn() && pplxOn() && krMarketOpen()) {
      const q = await pplxQuoteKR(admin, sym, name || "");
      if (q) {
        const chk = pplxSane(q.price, c ? c.price : 0);
        if (chk.ok) {
          const src = (q.sources || [])[0] || "";
          return {
            price: q.price, currency: "KRW",
            basis: "AI 검색 참고가" + (src ? ` · 출처 ${src.replace(/^https?:\/\//, "")}` : ""),
            live: false, as_of: q.at, sources: q.sources || [],
            note: "<b>거래소 시세가 아니라 AI 검색으로 받아온 참고가입니다.</b> "
                + "실제 체결가와 다를 수 있습니다. 직전 종가 대비 ±30%(상하한가) "
                + "밖이면 서버가 거부하고 종가로 체결합니다. "
                + "체결 기록에 이 값과 출처가 그대로 남습니다.",
          };
        }
        //  ⚠️ 버린 이유를 로그에 남깁니다 — 자주 걸리면 이 창구를 꺼야 합니다
        console.warn("pplx 상하한가 거부", sym, q.price, chk.why);
      }
    }

    //  ④ 아니면 마지막 종가 — <언제 종가인지> 를 반드시 같이 적습니다
    if (!c) throw new Error(`종목(${sym}) 종가를 찾지 못했습니다.`);
    /*  ⚠️ "그날 종가" 라고 적으면 안 됩니다. 공공데이터포털은 그날
        종가를 <다음 영업일 오후 1시 이후> 에 줍니다. 오늘 3시 30분에
        주문해도 붙는 값은 어제(월요일이면 금요일) 종가입니다.        */
    const { iso } = kstParts();
    const stale = c.on < iso;
    return { price: c.price, currency: "KRW", basis: `종가(${c.on})`,
             live: false, as_of: c.on,
             note: (stale
               ? `${c.on} 종가입니다. 공공데이터포털은 그날 종가를 <b>다음 영업일 오후 1시 이후</b>에 주기 때문에, 오늘 값은 아직 없습니다.`
               : `${c.on} 종가입니다.`)
               + (kisOn() ? " 장이 열리는 09:00~15:30 에는 실시간으로 체결됩니다."
                  : eodhdOn() ? " 장이 열리는 09:00~15:30 에는 집계 시세로 체결됩니다."
                  : pplxOn() ? " 장이 열리는 09:00~15:30 에는 AI 검색 참고가로 체결됩니다."
                  : " 장중 시세로 체결하려면 EODHD(학회 이메일) 또는 증권사 창구(KIS)를 연결해야 합니다.") };
  }

  const q = mk === "CRYPTO"
    ? (await alpQuotesCrypto([sym]))[sym.includes("-") ? sym : sym + "-USD"]
      ?? (await alpQuotesCrypto([sym]))[sym]
    : (await alpQuotesUS([sym]))[sym];

  /*  ⚠️ Alpaca 가 답을 못 주면 여기서 끝내지 않습니다. 미국 주식은
      MarketData.app 예비 창구가 있으면 그쪽으로 갑니다 — 값의 성격이
      다르므로(15분 지연·또는 하루 전) basis 에 그대로 적습니다.
      코인은 예비가 없습니다 (MarketData.app 은 주식만 줍니다).         */
  if (!q && mk === "US" && mdOn()) {
    const m = await mdQuoteUS(sym);
    if (m) return {
      price: m.price, currency: "USD", basis: "예비 창구(지연)",
      live: false, as_of: m.at,
      note: "Alpaca 가 답을 주지 않아 <b>MarketData.app 예비 창구</b>로 받았습니다. "
          + "무료 등급은 15분 지연이거나 하루 전 값일 수 있어 "
          + "<b>실제 체결가와 다를 수 있습니다</b>.",
    };
  }

  if (!q) throw new Error(`종목(${sym}) 시세를 받지 못했습니다. 티커를 확인해주세요.`);
  return {
    price: q.price, currency: "USD", basis: "실시간", live: true, as_of: q.at,
    note: mk === "CRYPTO" ? "코인은 24시간 거래됩니다."
                          : "Alpaca IEX 실시간입니다. 거래가 적은 종목은 전체 시장가와 다를 수 있습니다.",
  };
}

/*  ══ 국내 실시간 시세 — 한국투자증권(KIS) Open API ══════════════

    ⚠️ 왜 필요했나

    지금까지 국내는 data.go.kr(공공데이터포털)만 썼습니다. 그런데 그
    포털이 스스로 이렇게 적어 뒀습니다 —

      "모든 서비스는 실시간이 아니며, 데이터 갱신은 기준일자로부터
       영업일 <하루 뒤 오후 1시 이후>에 업데이트됩니다."

    즉 <오늘 종가는 오늘 안 나옵니다>. 그런데 화면은 "오후 3시 30분
    이후에 그날 종가로 체결" 이라고 안내하고 있었습니다. 3시 30분에
    주문하면 실제로는 <어제(혹은 금요일) 종가> 로 체결되면서 화면에는
    "그날 종가" 라고 적히던 셈입니다. 기다리게 만들기까지 했고요.

    공짜로 국내 실시간을 주는 곳은 사실상 증권사 API 뿐입니다.
    (KRX openapi 는 일별만 주고, 약관 제11조②가 "제3자 제공 금지" 라
     학회원 15명에게 보여주는 것 자체가 걸립니다. 그래서 안 씁니다.)

    KIS 는 계좌만 있으면 무료이고 REST 라 서버에서 씁니다.
      · 현재가  GET /uapi/domestic-stock/v1/quotations/inquire-price
                TR_ID FHKST01010100 · output.stck_prpr 가 현재가
      · 토큰    POST /oauth2/tokenP (grant_type=client_credentials)
                유효 1일 · <1분에 한 번만> 발급 · 발급할 때마다 알림톡
    ⚠️ 그래서 토큰을 반드시 보관해 뒀다가 다시 씁니다. Edge Function 은
       호출마다 새로 뜨니 메모리에 두면 매번 새로 받게 되고, 그러면
       1분 제한에 걸리고 학회장 폰에 알림톡이 쏟아집니다.

    키가 없으면? 아무 일도 안 일어납니다 — 예전처럼 마지막 종가로
    체결하되, <언제 종가인지> 를 정직하게 적습니다.                     */
const KIS_REAL = "https://openapi.koreainvestment.com:9443";
const KIS_DEMO = "https://openapivts.koreainvestment.com:29443";
function kisOn() { return !!(secret("KIS_APP_KEY") && secret("KIS_APP_SECRET")); }
function kisBase() { return secret("KIS_DEMO") === "1" ? KIS_DEMO : KIS_REAL; }

//  토큰 보관 (series_cache 에 둡니다 — 새 표를 안 만들어도 됩니다)
const KIS_TOK_KEY = "kis_token";
async function kisToken(admin: any): Promise<string | null> {
  if (!kisOn()) return null;
  const { data: hit } = await admin.from("series_cache")
    .select("payload, fetched_at").eq("source", "kis_auth")
    .eq("code", KIS_TOK_KEY).eq("item_code", "").maybeSingle();
  const p: any = hit?.payload ?? null;
  //  유효기간 1일이지만 20시간에서 미리 바꿉니다 (경계에서 실패하지 않게)
  if (p?.token && p?.at && (Date.now() - Date.parse(p.at)) < 20 * 3600e3) return String(p.token);

  const r = await fetch(kisBase() + "/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials",
                           appkey: secret("KIS_APP_KEY"),
                           appsecret: secret("KIS_APP_SECRET") }),
  }).catch(() => null);
  if (!r || !r.ok) {
    //  ⚠️ 못 받았다고 예전 토큰을 버리면 안 됩니다. 1분에 한 번만
    //     발급되니, 버렸다가는 그 1분 동안 국내 시세가 통째로 멈춥니다.
    if (p?.token) return String(p.token);
    console.error("KIS 토큰 발급 실패", r ? r.status : "네트워크");
    return null;
  }
  const d: any = await r.json().catch(() => null);
  const tok = d?.access_token ? String(d.access_token) : null;
  if (!tok) { console.error("KIS 토큰 응답에 access_token 이 없습니다"); return p?.token ?? null; }
  await admin.from("series_cache").upsert({
    source: "kis_auth", code: KIS_TOK_KEY, item_code: "",
    fetched_at: new Date().toISOString(),
    payload: { token: tok, at: new Date().toISOString() },
  });
  return tok;
}

/*  국내 현재가. 종목 하나에 한 번씩 부릅니다 (KIS 가 그렇게 생겼습니다).
    직접 매매 화면이 쓰는 것이라 한 번에 몇 종목뿐입니다.               */
async function kisQuoteKR(admin: any, symbols: string[]) {
  const out: Record<string, { price: number; at: string }> = {};
  if (!symbols.length || !kisOn()) return out;
  const tok = await kisToken(admin);
  if (!tok) return out;
  const at = new Date().toISOString();
  for (const s of symbols.slice(0, 30)) {
    const sym = String(s).trim().toUpperCase();
    const u = kisBase() + "/uapi/domestic-stock/v1/quotations/inquire-price"
            + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + encodeURIComponent(sym);
    const r = await fetch(u, { headers: {
      "authorization": "Bearer " + tok,
      "appkey": secret("KIS_APP_KEY"), "appsecret": secret("KIS_APP_SECRET"),
      "tr_id": "FHKST01010100", "custtype": "P",
      "Content-Type": "application/json",
    } }).catch(() => null);
    if (!r || !r.ok) continue;
    const d: any = await r.json().catch(() => null);
    const px = Number(d?.output?.stck_prpr);
    if (Number.isFinite(px) && px > 0) out[sym] = { price: px, at };
  }
  return out;
}

/*  ══ 국내 시세 · 두 번째 창구 — EODHD (학회 이메일로 됩니다) ══════

    ⚠️ 왜 이게 필요한가

    KIS·키움 같은 증권사 API 는 <개인 계좌> 에 묶입니다. 학회 사이트에
    학생 한 명의 증권 계좌를 물려두면, 그 학생이 졸업하면 끊깁니다.
    개인 금융계좌를 단체 서비스에 붙이는 것도 좋은 모양이 아닙니다.

    학회 이메일 + 학회 카드로 등록할 수 있는 곳을 전부 확인했는데,
    국내 장중 시세를 주는 곳은 사실상 EODHD 하나였습니다.
      · Twelve Data  — 한국은 $229/월 요금제에서도 <일별만> 줍니다
      · Marketstack · Polygon · Tiingo — 한국 자체가 없습니다
      · 코스콤 오픈API — "법인기업만 이용 가능", 학생 명시적 제외
      · KRX openapi   — 일별만 있고, 약관 제11조②가 제3자 제공 금지
      · data.go.kr    — 장중 자료가 아예 없습니다 (T+1 일별)

    ⚠️ 대신 <정확도를 낮게 잡아야 합니다>. EODHD 는 자기 KO/KQ 안내에
       거래소 직결이 아니라 "100곳 넘는 출처를 VWAP 으로 모은 값이며
       실시간이거나 정확하다고 보장하지 않는다" 고 적어 뒀습니다.
       대형주는 대체로 따라가지만 거래가 적은 코스닥 종목은 벌어질 수
       있습니다. 그래서 체결가 옆에 <지연·집계> 라고 분명히 적습니다.

    순서: 증권사(KIS) → EODHD → 마지막 종가.
    앞의 것이 있으면 뒤는 안 씁니다.                                    */
const EODHD_KR_SFX = ["KO", "KQ"];        //  코스피 · 코스닥

//  종목마다 어느 꼬리표가 맞는지 기억해 둡니다 (매번 두 번 물어보지 않게)
async function eodhdKrSuffix(admin: any, symbol: string): Promise<string | null> {
  const { data: hit } = await admin.from("series_cache")
    .select("payload").eq("source", "eodhd_kr_sfx").eq("code", symbol)
    .eq("item_code", "").maybeSingle();
  const s = (hit?.payload as any)?.sfx;
  return s ? String(s) : null;
}

async function eodhdQuoteKR(admin: any, symbols: string[]) {
  const out: Record<string, { price: number; at: string }> = {};
  const key = secret("EODHD_API_KEY");
  if (!symbols.length || !key) return out;

  for (const raw of symbols.slice(0, 30)) {
    const sym = String(raw).trim();
    //  기억해 둔 꼬리표를 먼저, 없으면 코스피 → 코스닥 순으로
    const known = await eodhdKrSuffix(admin, sym);
    const tries = known ? [known] : EODHD_KR_SFX;
    for (const sfx of tries) {
      const u = `https://eodhd.com/api/real-time/${encodeURIComponent(sym)}.${sfx}`
              + `?api_token=${encodeURIComponent(key)}&fmt=json`;
      const r = await fetch(u).catch(() => null);
      if (!r || !r.ok) continue;
      const d: any = await r.json().catch(() => null);
      //  값이 없으면 "NA" 라는 글자가 옵니다 (숫자가 아닙니다)
      const px = Number(d?.close);
      if (!Number.isFinite(px) || !(px > 0)) continue;
      out[sym] = { price: px,
                   at: d?.timestamp ? new Date(Number(d.timestamp) * 1000).toISOString()
                                    : new Date().toISOString() };
      if (!known) {
        await admin.from("series_cache").upsert({
          source: "eodhd_kr_sfx", code: sym, item_code: "",
          fetched_at: new Date().toISOString(), payload: { sfx },
        });
      }
      break;
    }
  }
  return out;
}
function eodhdOn() { return !!secret("EODHD_API_KEY"); }

/*  ── 국내 장이 열려 있나 (한국시간) ──────────────────────────
    정규장 09:00~15:30, 평일. 공휴일까지는 알 수 없어서, 그때는
    시세가 안 오면 자연히 종가로 넘어갑니다.                          */
function krMarketOpen() {
  const { hhmm, dow } = kstParts();
  if (dow === 0 || dow === 6) return false;
  return hhmm >= "09:00" && hhmm <= "15:30";
}

/*  국내 주문을 받아도 되는 시각인가.

    ⚠️ 예전에는 "오후 3시 30분 이후에만" 이었습니다. 그날 종가로 체결
       한다는 전제였는데, 그 전제가 <틀렸습니다> (위 설명 참고).
       기다려도 오늘 종가는 안 나옵니다. 그래서 막지 않습니다 —
       대신 <무슨 값으로 체결되는지> 를 정확히 적어 줍니다.            */
function krOrderWindow() {
  const live = kisOn() || eodhdOn();
  if (live)
    return krMarketOpen()
      ? { ok: true, why: kisOn() ? ""
          : "국내는 <b>약 15~20분 늦은 집계 시세</b>로 체결됩니다 (거래소 직결이 아닙니다)." }
      : { ok: true, why: "지금은 장이 닫혀 있어 <b>마지막 종가</b>로 체결됩니다." };
  return { ok: true, why:
    "지금 연결된 창구에는 국내 장중 시세가 없어 <b>마지막 종가</b>로 체결됩니다 "
    + "(체결가 옆에 그 종가의 날짜가 적힙니다)." };
}

/*  ── 팀 계좌 상태 ─────────────────────────────────────────  */
/*  ── 거래에 «누가» 를 붙입니다 ──────────────────────────────

    ⚠️ showWho 가 false 면 이름을 <아예 안 담습니다>. 화면에서 숨기는
       것으로는 부족합니다 — 개발자도구를 열면 그대로 보이니까요.
    ⚠️ 자동매매가 산 것은 사람이 아니라 규칙입니다. 이름을 안 붙입니다. */
async function withWho(admin: any, rows: any[], showWho: boolean) {
  if (!showWho) return rows.map((t) => ({ ...t, created_by: undefined }));
  const ids = [...new Set(rows.filter((t) => t.source !== "auto")
    .map((t) => t.created_by).filter(Boolean))];
  let map: Record<string, string> = {};
  if (ids.length) {
    const { data } = await admin.rpc("who_names", { p_ids: ids });
    map = (data ?? {}) as Record<string, string>;
  }
  return rows.map((t) => ({
    ...t,
    created_by: undefined,
    by_name: t.source === "auto" ? null : (map[t.created_by] ?? null),
  }));
}

async function mtAccount(admin: any, teamId: number, fx: number, showWho = false) {
  const { data: team } = await admin.from("teams")
    .select("id, name, seed, auto_on, auto_budget, auto_interval, auto_last_at, bar_tf")
    .eq("id", teamId).maybeSingle();
  if (!team) throw new Error("팀을 찾지 못했습니다.");

  const { data: tr } = await admin.from("trades")
    .select("id, market, symbol, name, side, qty, price, fee, source, traded_at, created_by")
    .eq("team_id", teamId).order("traded_at", { ascending: true });

  const pos: Record<string, any> = {};
  let spent = 0;
  for (const t of tr ?? []) {
    const k = t.market + "|" + t.symbol;
    /*  q_manual / q_auto — 지금 들고 있는 수량 중 손으로 산 것과
        자동매매가 산 것을 갈라 둡니다. 화면에서 종목마다 '직접/자동'
        딱지를 붙이려면 서버가 갈라줘야 합니다. 판 것은 그 매도를
        일으킨 쪽에서 뺍니다 (자동이 판 것은 자동 몫에서).            */
    const p = pos[k] ?? (pos[k] = { market: t.market, symbol: t.symbol, name: t.name,
                                    qty: 0, cost: 0, realized: 0,
                                    q_manual: 0, q_auto: 0, sold: 0,
                                    //  b_* 는 <산 수량만> 더합니다 (팔아도 안 줄어듭니다).
                                    //  q_* 만 있으면 사서 전부 판 종목이 0/0 이 되어
                                    //  "자동이 샀던 것" 이라는 사실이 사라집니다.
                                    b_manual: 0, b_auto: 0 });
    const auto = t.source === "auto";
    const bucket = auto ? "q_auto" : "q_manual";
    const rate = t.market === "KR" ? 1 : fx;
    const gross = Number(t.qty) * Number(t.price);
    const fee = Number(t.fee) || 0;
    if (t.side === "buy") {
      p.qty += Number(t.qty); p.cost += gross + fee;
      p[bucket] += Number(t.qty);
      p[auto ? "b_auto" : "b_manual"] += Number(t.qty);
      spent += (gross + fee) * rate;
    } else {
      //  평균단가 기준으로 원가를 덜어내고 실현손익을 쌓습니다
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const out = Math.min(Number(t.qty), p.qty);
      const gain = (Number(t.price) - avg) * out - fee;
      p.realized += gain;
      /*  이 매도 한 건에서 난 손익을 거래에 붙여둡니다.
          기록 화면에서 "이 매도로 얼마 벌었나" 를 보려면 평균단가를
          알아야 하는데, 그건 거래를 처음부터 훑어야 나옵니다.
          이미 훑고 있는 여기서 계산해 두는 게 맞습니다.              */
      (t as any).realized = gain;
      (t as any).realized_krw = gain * rate;
      (t as any).avg_at_sell = avg;
      p.sold = (p.sold ?? 0) + out;
      p.qty -= Number(t.qty); p.cost -= avg * out;
      p[bucket] -= Number(t.qty);
      spent -= (gross - fee) * rate;
    }
  }

  const live = Object.values(pos).filter((p: any) => p.qty > 1e-9);
  const us = live.filter((p: any) => p.market === "US").map((p: any) => p.symbol);
  const cc = live.filter((p: any) => p.market === "CRYPTO").map((p: any) => p.symbol);
  //  평가액용이라 20초 보관함을 씁니다 (체결가는 여기서 안 씁니다)
  const [qUS, qCC] = await quotesForValue(us, cc);

  let holdings = 0, unreal = 0;
  for (const p of live as any[]) {
    let last: number | null = null;
    if (p.market === "US") last = (qUS as any)[p.symbol]?.price ?? null;
    else if (p.market === "CRYPTO") last = (qCC as any)[p.symbol]?.price ?? null;
    else { const c = await krLastClose(admin, p.symbol); last = c?.price ?? null; }
    const rate = p.market === "KR" ? 1 : fx;
    p.avg = p.qty > 0 ? p.cost / p.qty : 0;
    p.last = last;
    p.value = last != null ? p.qty * last : null;
    p.pnl = last != null ? (last - p.avg) * p.qty : null;
    p.pnl_pct = (last != null && p.avg > 0) ? (last / p.avg - 1) * 100 : null;
    p.value_krw = p.value != null ? p.value * rate : null;
    //  한쪽이 다른 쪽 물량을 팔면 음수가 날 수 있습니다. 0 밑으로는 안 내려가게
    //  누른 뒤, 합이 실제 보유 수량과 맞도록 비율로 다시 맞춥니다.
    let qm = Math.max(0, p.q_manual), qa = Math.max(0, p.q_auto);
    const qs = qm + qa;
    if (qs > 0 && Math.abs(qs - p.qty) > 1e-9) {
      qm = p.qty * (qm / qs); qa = p.qty * (qa / qs);
    } else if (qs <= 0) { qm = p.qty; qa = 0; }
    p.q_manual = qm; p.q_auto = qa;
    p.by = qa <= 1e-9 ? "manual" : (qm <= 1e-9 ? "auto" : "both");
    if (p.value_krw != null){ holdings += p.value_krw; unreal += (p.pnl ?? 0) * rate; }
  }

  /*  ── 판 종목도 내려보냅니다 ──────────────────────────────
      예전에는 지금 들고 있는 것(qty > 0)만 보냈습니다. 그래서 사서
      전부 판 종목은 화면에서 아예 사라졌습니다. 실현손익 타일에는
      숫자가 잡히는데 그게 <어느 종목에서 난 것> 인지 볼 데가 없었고,
      자동매매가 샀다 판 종목은 존재조차 안 보였습니다.
      체결된 종목은 하나도 빠짐없이 보여야 합니다.                     */
  /*  ⚠️ 예전에는 <전부 판 것> 만 내려보냈습니다. 그래서 100주 중 50주만
      판 종목은 아직 들고 있으니 여기 안 나오고, 그 매도로 난 실현손익도
      볼 데가 없었습니다. 반만 팔아도 판 것은 판 것입니다.
      이제 <한 번이라도 판 적 있는 종목> 을 전부 내려보내고, 아직 남은
      수량도 같이 알려줍니다.                                          */
  const closed = (Object.values(pos) as any[])
    .filter((p) => (p.sold ?? 0) > 1e-9)
    .map((p) => {
      const rate = p.market === "KR" ? 1 : fx;
      //  다 팔았으니 남은 수량(q_*)은 0 입니다. <산 수량>(b_*)으로 가릅니다.
      const bm = p.b_manual, ba = p.b_auto;
      return {
        market: p.market, symbol: p.symbol, name: p.name,
        realized: p.realized, realized_krw: p.realized * rate,
        by: ba > 0 && bm > 0 ? "both" : (ba > 0 ? "auto" : "manual"),
        bought_manual: bm, bought_auto: ba,
        sold: p.sold ?? 0,
        qty_left: Math.max(0, p.qty),          // 아직 들고 있는 수량 (반만 팔았으면 > 0)
      };
    })
    .sort((a, b) => Math.abs(b.realized_krw) - Math.abs(a.realized_krw));

  const realized = Object.values(pos)
    .reduce((s: number, p: any) => s + p.realized * (p.market === "KR" ? 1 : fx), 0);

  /*  ── 배당금도 현금입니다 ──────────────────────────────────

      ⚠️ <지급일이 지난 것만> 셉니다. 배당락일이 지났어도 돈은 지급일에
         들어옵니다 (국내는 보통 기준일 다음 해 4월, 미국은 몇 주 뒤).
         배당락일 기준으로 세면 아직 없는 돈으로 주식을 살 수 있게 됩니다.
      ⚠️ 세후(net)로 셉니다. 국내 15.4%, 미국 15% 원천징수를 빼고
         실제로 계좌에 꽂히는 금액이 net 입니다.                        */
  const { data: divs } = await admin.from("dividends")
    .select("net, fx, pay_date").eq("team_id", teamId)
    .lte("pay_date", kstParts().iso);
  const divCash = (divs ?? []).reduce(
    (s: number, d: any) => s + Number(d.net || 0) * Number(d.fx || 1), 0);

  const cash = Number(team.seed) - spent + divCash;

  /*  자동매매가 "지금 돌고 있다" 를 화면이 말할 수 있게, 다음 실행
      시각까지 서버가 계산해서 내려보냅니다. 간격을 분으로 바꾸는 표를
      브라우저에 또 적어두면 둘이 어긋나기 마련이라 여기서 한 번만 씁니다. */
  const ivMin = MT_INTERVAL_MIN[String(team.auto_interval ?? "1d")] ?? MT_INTERVAL_MIN["1d"];
  const lastMs = team.auto_last_at ? Date.parse(team.auto_last_at) : null;
  const auto = {
    on: !!team.auto_on,
    budget: Number(team.auto_budget) || 0,
    interval: team.auto_interval ?? "1d",
    interval_min: ivMin,
    bar_tf: team.bar_tf ?? "1d",
    last_at: team.auto_last_at ?? null,
    next_at: lastMs ? new Date(lastMs + ivMin * 60000).toISOString() : null,
    due: mtDue(String(team.auto_interval ?? "1d"), team.auto_last_at ?? null),
    room: Math.max(0, Math.min(cash, Number(team.auto_budget) || 0)),
    fills: (tr ?? []).filter((t: any) => t.source === "auto").length,
    server_now: new Date().toISOString(),
  };

  return {
    team, auto, cash, holdings, total: cash + holdings,
    //  화면이 "현금 안에 배당이 얼마" 를 말할 수 있게 따로도 내려줍니다
    dividend_krw: divCash,
    spent, realized, unrealized: unreal,
    pnl: cash + holdings - Number(team.seed),
    pnl_pct: Number(team.seed) > 0 ? (cash + holdings - Number(team.seed)) / Number(team.seed) * 100 : 0,
    positions: live,
    closed,
    trades: await withWho(admin, (tr ?? []).slice(-200).reverse(), showWho),
    fx,
  };
}

async function mtContest(admin: any) {
  const { data } = await admin.from("contest")
    .select("gen, starts_at, ends_at, fx_fixed")
    .order("gen", { ascending: false }).limit(1).maybeSingle();
  const ends = data?.ends_at ?? null;
  return {
    gen: data?.gen ?? null,
    starts_at: data?.starts_at ?? null,
    ends_at: ends,
    fx: Number(data?.fx_fixed) || MT_FX,
    closed: ends ? Date.now() >= Date.parse(ends) : false,
  };
}

/*  ── 주문 ──────────────────────────────────────────────────

    화면이 보낸 가격은 <b>쓰지 않습니다</b>. 여기서 다시 받아 그 값으로
    체결합니다. 수량과 방향만 화면에서 옵니다.                        */
async function mtOrder(admin: any, asUser: any, body: any) {
  const teamId = Number(body.team_id);
  const market = String(body.market ?? "").toUpperCase();
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const side = String(body.side ?? "buy");
  const qty = Number(body.qty);

  if (!teamId) throw new Error("팀을 고르지 않았습니다.");
  if (!["KR", "US", "CRYPTO"].includes(market)) throw new Error("시장 구분이 올바르지 않습니다.");
  if (!symbol) throw new Error("종목을 입력해주세요.");
  if (!["buy", "sell"].includes(side)) throw new Error("매수/매도 구분이 올바르지 않습니다.");
  if (!(qty > 0)) throw new Error("수량을 입력해주세요.");

  //  ① 이 사람이 그 팀에서 매매해도 되는가 (임원진은 어디서든)
  const { data: allowed } = await asUser.rpc("in_team", { p_team_id: teamId });
  if (!allowed)
    throw new Error("이 팀에서는 매매할 수 없습니다. 자기 팀 방에서만 주문할 수 있습니다.");

  //  ② 대회가 끝났는가
  const ct = await mtContest(admin);
  if (ct.closed)
    throw new Error(`대회가 ${String(ct.ends_at).slice(0, 16).replace("T", " ")} 에 끝났습니다.`);

  //  ③ 국내는 언제든 주문할 수 있습니다. 무슨 값으로 체결됐는지는
  //     아래 ④에서 받아 온 basis 로 알려줍니다 (실시간 / 종가(날짜)).
  if (market === "KR") {
    const w = krOrderWindow();
    if (!w.ok) throw new Error(w.why);
  }

  //  ④ 체결가는 서버가 정합니다 (이름은 검색 창구가 종목을 찾는 데 씁니다)
  const q = await mtPrice(admin, market, symbol, String(body.name ?? ""));
  const gross = qty * q.price;
  const fee = mtFee(market, side, gross);
  const rate = market === "KR" ? 1 : ct.fx;

  //  ⑤ 돈과 수량이 되는가
  const acc = await mtAccount(admin, teamId, ct.fx);
  if (side === "buy") {
    const need = (gross + fee) * rate;
    if (need > acc.cash + 1)
      throw new Error(
        `현금이 모자랍니다. 필요 ${Math.round(need).toLocaleString("ko-KR")}원, `
        + `남은 현금 ${Math.round(acc.cash).toLocaleString("ko-KR")}원.`);
  } else {
    const held = (acc.positions as any[])
      .find((p) => p.market === market && p.symbol === symbol);
    if (!held || held.qty + 1e-9 < qty)
      throw new Error(`보유 수량이 모자랍니다. 가진 수량 ${held ? held.qty : 0}.`);
  }

  //  ⑥ 이름 — 없으면 유니버스에서 찾아 채웁니다
  let name = String(body.name ?? "").trim();
  if (!name) {
    const { data: t } = await admin.from("tradable")
      .select("name").eq("market", market).eq("symbol", symbol).maybeSingle();
    name = t?.name ?? null;
  }
  if (!name) {
    const { data: u } = await admin.from("universe")
      .select("name").eq("market", market).eq("symbol", symbol).maybeSingle();
    name = u?.name ?? symbol;
  }

  /*  ⚠️ 여기서 그냥 insert 하면 안 됩니다.

      위 ⑤에서 현금을 확인했지만, 확인과 저장 사이에 아무 잠금이
      없습니다. 같은 팀 팀원 둘이 같은 순간에 누르면 둘 다 ⑤를
      통과하고 둘 다 저장합니다 — 시드 1,000만원짜리 팀이 800만원짜리
      주문 두 건을 다 받아 1,600만원을 쓰는 걸 시험에서 재현했습니다.
      15명이 세 팀에서 쓰고, 국내는 3시 30분에 몰리니 흔한 일입니다.

      그래서 <확인 + 저장> 을 DB 함수 한 번으로 합니다. 그 안에서
      팀 줄을 잠그므로 같은 팀 주문은 한 줄로 서고, 다른 팀은
      서로 안 기다립니다. 위 ⑤는 <미리 알려주기> 용으로 남겨둡니다 —
      친절한 오류 문구가 여기서 나오니까요.                          */
  /*  ⚠️ «누가 눌렀나» 는 화면이 보낸 값을 <절대> 쓰지 않습니다.
      로그인 토큰에서 확인한 사람만 씁니다 — 아니면 남의 이름으로
      매매한 것처럼 꾸밀 수 있습니다.                                 */
  const { data: who } = await asUser.auth.getUser();
  const byId = who?.user?.id ?? null;

  const { data: placed, error } = await admin.rpc("mt_place_trade", {
    p_team_id: teamId, p_market: market, p_symbol: symbol, p_name: name,
    p_side: side, p_qty: qty, p_price: q.price, p_fee: fee, p_fx: ct.fx,
    p_source: "manual", p_fill_basis: q.basis, p_rule_name: null,
    p_by: byId,
  });
  if (error) {
    //  함수가 아직 없으면 무엇을 실행해야 하는지 알려줍니다
    if (/mt_place_trade|does not exist|schema cache/i.test(error.message))
      throw new Error("terminal-동시주문.sql 을 아직 실행하지 않았습니다. "
                    + "Supabase SQL Editor 에서 한 번 돌려주세요.");
    throw new Error(error.message);
  }

  const row = {
    team_id: teamId, market, symbol, name, side, qty,
    price: q.price, fee,
    traded_on: kstParts().iso,
    traded_at: new Date().toISOString(),
    source: "manual",
    fill_basis: q.basis,
  };
  return {
    ok: true, ...row, id: (placed as any)?.id ?? null,
    cash_left: (placed as any)?.cash_left ?? null,
    gross, total: (gross + (side === "buy" ? fee : -fee)) * rate,
    currency: q.currency, live: q.live, as_of: q.as_of, note: q.note,
  };
}

/*  ── 자동매매 스캔 ─────────────────────────────────────────

    핵심: <b>유니버스를 한 번만 훑고</b> 그 한 벌의 시세로 모든 팀을
    판정합니다. 팀마다 따로 훑으면 팀이 늘어날수록 호출이 곱으로 늘고,
    같은 순간인데 팀마다 다른 값으로 체결되는 문제도 생깁니다.

    간격은 팀이 고릅니다(5분·15분·30분·2시간·4시간·일봉·주봉).
    이 함수는 5분마다 깨어나서, 지금이 그 팀의 차례인지만 봅니다.     */

/* ══════════════════════════════════════════════════════════════
   기술적 지표 엔진 — 화면(백테스트)과 <같은 계산>

   ⚠️ 이 블록은 terminal/index.html 의 지표 엔진을 그대로 옮긴 것입니다.
      한 글자도 바꾸지 않았습니다 (Deno 가 타입을 봐서 : any 만 붙였습니다).

      왜 굳이 복사했나:
        예전에는 지표 계산기가 브라우저에만 있었습니다. 그래서 "미리
        돌려보기" 는 RSI·골든크로스를 제대로 계산하는데, 서버에서 도는
        진짜 자동매매는 조건을 아예 안 보고 명단 순서대로 사기만 했습니다.
        팀이 전략을 짜도 실제 매매에는 아무 영향이 없었습니다.

      둘이 어긋나면 백테스트와 실제 성적이 달라집니다. 그래서
      _test/term/engine_same41.js 가 <양쪽에 같은 값을 넣어 결과가
      완전히 같은지> 매번 확인합니다. 한쪽만 고치면 거기서 걸립니다.
   ══════════════════════════════════════════════════════════════ */

function _sma(a: any, n: any){
  var out = new Array<any>(a.length).fill(null), sum = 0;
  for (var i=0;i<a.length;i++){
    if (a[i] == null){ out[i] = null; continue; }
    sum += a[i];
    if (i >= n) sum -= a[i-n];
    if (i >= n-1) out[i] = sum/n;
  }
  return out;
}
function _ema(a: any, n: any){
  var out = new Array<any>(a.length).fill(null), k = 2/(n+1), e = null, sum = 0;
  for (var i=0;i<a.length;i++){
    if (i < n-1){ sum += a[i]; continue; }
    if (i === n-1){ sum += a[i]; e = sum/n; out[i] = e; continue; }
    e = a[i]*k + e*(1-k); out[i] = e;
  }
  return out;
}
function _stdev(a: any, n: any){
  var out = new Array<any>(a.length).fill(null);
  for (var i=n-1;i<a.length;i++){
    var m = 0, j;
    for (j=i-n+1;j<=i;j++) m += a[j];
    m /= n;
    var v = 0;
    for (j=i-n+1;j<=i;j++) v += (a[j]-m)*(a[j]-m);
    out[i] = Math.sqrt(v/n);
  }
  return out;
}
function _hh(a: any, n: any){ var o=new Array<any>(a.length).fill(null);
  for (var i=n-1;i<a.length;i++){ var m=-Infinity; for(var j=i-n+1;j<=i;j++) if(a[j]>m) m=a[j]; o[i]=m; } return o; }
function _ll(a: any, n: any){ var o=new Array<any>(a.length).fill(null);
  for (var i=n-1;i<a.length;i++){ var m=Infinity; for(var j=i-n+1;j<=i;j++) if(a[j]<m) m=a[j]; o[i]=m; } return o; }

function calcSMA(c: any, n: any){ return _sma(c,n); }
function calcEMA(c: any, n: any){ return _ema(c,n); }

function calcRSI(c: any, n: any){
  var out = new Array<any>(c.length).fill(null);
  if (c.length < n+1) return out;
  var g=0, l=0, i;
  for (i=1;i<=n;i++){ var ch=c[i]-c[i-1]; if (ch>0) g+=ch; else l-=ch; }
  g/=n; l/=n;
  out[n] = l===0 ? 100 : 100 - 100/(1 + g/l);
  for (i=n+1;i<c.length;i++){
    var d=c[i]-c[i-1], gg=d>0?d:0, ll=d<0?-d:0;
    g=(g*(n-1)+gg)/n; l=(l*(n-1)+ll)/n;
    out[i] = l===0 ? 100 : 100 - 100/(1 + g/l);
  }
  return out;
}
function calcChange(c: any, n: any){
  var out = new Array<any>(c.length).fill(null);
  for (var i=n;i<c.length;i++){ if (c[i-n] > 0) out[i] = (c[i]/c[i-n]-1)*100; }
  return out;
}
/* 이격도 (%) : 종가가 이동평균에서 얼마나 떨어져 있나 */
function calcVsMA(c: any, ma: any){
  var out = new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){ if (ma[i] && ma[i] > 0) out[i] = (c[i]/ma[i]-1)*100; }
  return out;
}
/* MACD 히스토그램 (MACD − 신호선) */
function calcMACDHist(c: any, fast: any, slow: any, sig: any){
  var ef = _ema(c, fast), es = _ema(c, slow);
  var macd = c.map(function(_,i){ return (ef[i]!=null && es[i]!=null) ? ef[i]-es[i] : null; });
  var valid = macd.filter(function(x){ return x!=null; });
  var sl = _ema(valid, sig);
  var out = new Array<any>(c.length).fill(null), k = 0;
  for (var i=0;i<c.length;i++){
    if (macd[i]==null) continue;
    if (sl[k]!=null) out[i] = macd[i] - sl[k];
    k++;
  }
  return out;
}
function calcMACDLine(c: any, fast: any, slow: any){
  var ef=_ema(c,fast), es=_ema(c,slow);
  return c.map(function(_,i){ return (ef[i]!=null&&es[i]!=null)?ef[i]-es[i]:null; });
}
/* 볼린저 %B (0=하단, 100=상단) 와 밴드폭(%) */
function calcBB(c: any, n: any, mult: any, want: any){
  var mid=_sma(c,n), sd=_stdev(c,n), out=new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){
    if (mid[i]==null || sd[i]==null) continue;
    var up=mid[i]+mult*sd[i], lo=mid[i]-mult*sd[i];
    if (want==='pct') out[i] = (up-lo)>0 ? (c[i]-lo)/(up-lo)*100 : null;
    else              out[i] = mid[i]>0 ? (up-lo)/mid[i]*100 : null;
  }
  return out;
}
/* 스토캐스틱 %K */
function calcStochK(h: any, l: any, c: any, n: any){
  var hh=_hh(h,n), ll=_ll(l,n), out=new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){
    if (hh[i]==null||ll[i]==null) continue;
    var r = hh[i]-ll[i];
    out[i] = r>0 ? (c[i]-ll[i])/r*100 : 50;
  }
  return out;
}
/* 윌리엄스 %R (-100 ~ 0) */
function calcWillR(h: any, l: any, c: any, n: any){
  var hh=_hh(h,n), ll=_ll(l,n), out=new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){
    if (hh[i]==null||ll[i]==null) continue;
    var r = hh[i]-ll[i];
    out[i] = r>0 ? (hh[i]-c[i])/r*-100 : -50;
  }
  return out;
}
/* CCI */
function calcCCI(h: any, l: any, c: any, n: any){
  var tp = c.map(function(_,i){ return (h[i]+l[i]+c[i])/3; });
  var m = _sma(tp, n), out = new Array<any>(c.length).fill(null);
  for (var i=n-1;i<c.length;i++){
    if (m[i]==null) continue;
    var dev=0;
    for (var j=i-n+1;j<=i;j++) dev += Math.abs(tp[j]-m[i]);
    dev/=n;
    out[i] = dev>0 ? (tp[i]-m[i])/(0.015*dev) : 0;
  }
  return out;
}
/* ATR 비율 (%) — 변동성 크기 */
function calcATRPct(h: any, l: any, c: any, n: any){
  var tr = new Array<any>(c.length).fill(null), out = new Array<any>(c.length).fill(null);
  for (var i=1;i<c.length;i++){
    tr[i] = Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]));
  }
  var a=null;
  for (var j=1;j<c.length;j++){
    if (j < n){ continue; }
    if (j === n){
      var s=0; for (var k=1;k<=n;k++) s+=tr[k]; a=s/n;
    } else { a = (a*(n-1)+tr[j])/n; }
    out[j] = c[j]>0 ? a/c[j]*100 : null;
  }
  return out;
}
/* ADX — 추세가 얼마나 강한가 (0~100) */
function calcADX(h: any, l: any, c: any, n: any){
  var len=c.length, plus=new Array<any>(len).fill(0), minus=new Array<any>(len).fill(0), tr=new Array<any>(len).fill(0);
  for (var i=1;i<len;i++){
    var up=h[i]-h[i-1], dn=l[i-1]-l[i];
    plus[i]  = (up>dn && up>0) ? up : 0;
    minus[i] = (dn>up && dn>0) ? dn : 0;
    tr[i] = Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]));
  }
  var out=new Array<any>(len).fill(null);
  if (len < n*2+2) return out;
  var sp=0, sm=0, st=0, x;
  for (x=1;x<=n;x++){ sp+=plus[x]; sm+=minus[x]; st+=tr[x]; }
  var dxs=[];
  for (x=n+1;x<len;x++){
    sp = sp - sp/n + plus[x];
    sm = sm - sm/n + minus[x];
    st = st - st/n + tr[x];
    var pdi = st>0 ? sp/st*100 : 0, mdi = st>0 ? sm/st*100 : 0;
    var dx = (pdi+mdi)>0 ? Math.abs(pdi-mdi)/(pdi+mdi)*100 : 0;
    dxs.push({ i:x, dx:dx });
  }
  var adx=null;
  for (var y=0;y<dxs.length;y++){
    if (y < n-1) continue;
    if (y === n-1){ var s2=0; for (var z=0;z<n;z++) s2+=dxs[z].dx; adx=s2/n; }
    else adx = (adx*(n-1)+dxs[y].dx)/n;
    out[dxs[y].i] = adx;
  }
  return out;
}
/* 거래량 비율 (%) — 오늘 거래량 ÷ n일 평균 */
function calcVolRatio(q: any, n: any){
  var m=_sma(q,n), out=new Array<any>(q.length).fill(null);
  for (var i=0;i<q.length;i++){ if (m[i] && m[i]>0) out[i] = q[i]/m[i]*100; }
  return out;
}
/* MFI — 거래량을 반영한 RSI */
function calcMFI(h: any, l: any, c: any, q: any, n: any){
  var tp=c.map(function(_,i){ return (h[i]+l[i]+c[i])/3; });
  var out=new Array<any>(c.length).fill(null);
  for (var i=n;i<c.length;i++){
    var pos=0, neg=0;
    for (var j=i-n+1;j<=i;j++){
      var mf = tp[j]*q[j];
      if (tp[j] > tp[j-1]) pos += mf; else if (tp[j] < tp[j-1]) neg += mf;
    }
    out[i] = neg===0 ? 100 : 100 - 100/(1 + pos/neg);
  }
  return out;
}
/* 기간 고점·저점 대비 (%) */
function calcVsHigh(c: any, h: any, n: any){
  var hh=_hh(h,n), out=new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){ if (hh[i]&&hh[i]>0) out[i]=(c[i]/hh[i]-1)*100; }
  return out;
}
function calcVsLow(c: any, l: any, n: any){
  var ll=_ll(l,n), out=new Array<any>(c.length).fill(null);
  for (var i=0;i<c.length;i++){ if (ll[i]&&ll[i]>0) out[i]=(c[i]/ll[i]-1)*100; }
  return out;
}
/* 연속 상승(+) · 하락(−) 일수 */
function calcStreak(c: any){
  var out=new Array<any>(c.length).fill(null), s=0;
  for (var i=1;i<c.length;i++){
    if (c[i] > c[i-1]) s = s>0 ? s+1 : 1;
    else if (c[i] < c[i-1]) s = s<0 ? s-1 : -1;
    else s = 0;
    out[i]=s;
  }
  return out;
}
/* 연환산 변동성 (%) */
function calcVolatility(c: any, n: any){
  var r=new Array<any>(c.length).fill(null), i;
  for (i=1;i<c.length;i++) r[i] = c[i-1]>0 ? c[i]/c[i-1]-1 : 0;
  var out=new Array<any>(c.length).fill(null);
  for (i=n;i<c.length;i++){
    var m=0, j;
    for (j=i-n+1;j<=i;j++) m+=r[j];
    m/=n;
    var v=0;
    for (j=i-n+1;j<=i;j++) v+=(r[j]-m)*(r[j]-m);
    out[i] = Math.sqrt(v/n)*Math.sqrt(252)*100;
  }
  return out;
}

/* ══ 지표 사전 ══
   cmp:'num'   → 부등호 + 숫자 비교
   cmp:'cross' → 골든크로스 / 데드크로스
   needs: 'hl'(고가·저가) 'vol'(거래량) — 데이터가 없으면 조건이 성립하지 않습니다 */
const IND_SPEC: Record<string, any> = {
  // ── 모멘텀 ──
  RSI:       { cat:'모멘텀', label:'RSI (상대강도)',           p1:'기간', d1:14, cmp:'num', dv:30, unit:'0~100' },
  STOCH:     { cat:'모멘텀', label:'스토캐스틱 %K',            p1:'기간', d1:14, cmp:'num', dv:20, unit:'0~100', needs:'hl' },
  WILLR:     { cat:'모멘텀', label:'윌리엄스 %R',              p1:'기간', d1:14, cmp:'num', dv:-80, unit:'-100~0', needs:'hl' },
  CCI:       { cat:'모멘텀', label:'CCI',                      p1:'기간', d1:20, cmp:'num', dv:-100, unit:'±100 기준' },
  MFI:       { cat:'모멘텀', label:'MFI (거래량 RSI)',         p1:'기간', d1:14, cmp:'num', dv:20, unit:'0~100', needs:'vol' },
  CHANGE:    { cat:'모멘텀', label:'기간 변동률',              p1:'기간', d1:5,  cmp:'num', dv:-10, unit:'%' },
  STREAK:    { cat:'모멘텀', label:'연속 상승/하락일',         cmp:'num', dv:-3, unit:'일 (음수=하락)' },

  // ── 추세 ──
  VS_SMA:    { cat:'추세',   label:'이동평균 이격도 (SMA)',    p1:'기간', d1:20, cmp:'num', dv:-7, unit:'%' },
  VS_EMA:    { cat:'추세',   label:'이동평균 이격도 (EMA)',    p1:'기간', d1:20, cmp:'num', dv:-7, unit:'%' },
  CROSS:     { cat:'추세',   label:'이동평균 교차 (SMA)',      p1:'단기', d1:5,  p2:'장기', d2:20, cmp:'cross' },
  EMA_CROSS: { cat:'추세',   label:'이동평균 교차 (EMA)',      p1:'단기', d1:12, p2:'장기', d2:26, cmp:'cross' },
  MACD:      { cat:'추세',   label:'MACD 히스토그램',          p1:'단기', d1:12, p2:'장기', d2:26, cmp:'num', dv:0, unit:'0 위=상승' },
  MACD_CROSS:{ cat:'추세',   label:'MACD 신호선 교차',         p1:'단기', d1:12, p2:'장기', d2:26, cmp:'cross' },
  ADX:       { cat:'추세',   label:'ADX (추세 강도)',          p1:'기간', d1:14, cmp:'num', dv:25, unit:'25↑ 추세장', needs:'hl' },

  // ── 변동성 ──
  BB_PCT:    { cat:'변동성', label:'볼린저 %B',                p1:'기간', d1:20, cmp:'num', dv:0,  unit:'0=하단 100=상단' },
  BB_WIDTH:  { cat:'변동성', label:'볼린저 밴드폭',            p1:'기간', d1:20, cmp:'num', dv:10, unit:'%' },
  ATR_PCT:   { cat:'변동성', label:'ATR 비율',                 p1:'기간', d1:14, cmp:'num', dv:3,  unit:'%', needs:'hl' },
  VOLAT:     { cat:'변동성', label:'연환산 변동성',            p1:'기간', d1:20, cmp:'num', dv:40, unit:'%' },

  // ── 거래량 · 위치 ──
  VOL_RATIO: { cat:'거래량', label:'거래량 비율 (평균 대비)',  p1:'기간', d1:20, cmp:'num', dv:200, unit:'%', needs:'vol' },
  VS_HIGH:   { cat:'위치',   label:'기간 고점 대비',           p1:'기간', d1:252, cmp:'num', dv:-20, unit:'%', needs:'hl' },
  VS_LOW:    { cat:'위치',   label:'기간 저점 대비',           p1:'기간', d1:252, cmp:'num', dv:10,  unit:'%', needs:'hl' }
};

function specOf(ind: any){ return IND_SPEC[ind] || IND_SPEC.RSI; }
function ruleKey(r: any){ return r.ind + '|' + (r.period||0) + '|' + (r.period2||0); }

/* 규칙이 필요로 하는 지표들을 한 번씩만 계산해 둡니다 */
function buildCtx(pts: any, rules: any){
  var c = pts.map(function(p){ return Number(p.v); });
  var hasHL  = pts.some(function(p){ return Number.isFinite(p.h) && Number.isFinite(p.l) && p.h !== p.l; });
  var hasVol = pts.some(function(p){ return Number.isFinite(p.q) && p.q > 0; });
  var h = pts.map(function(p,i){ return Number.isFinite(p.h) ? Number(p.h) : c[i]; });
  var l = pts.map(function(p,i){ return Number.isFinite(p.l) ? Number(p.l) : c[i]; });
  var q = pts.map(function(p){ return Number.isFinite(p.q) ? Number(p.q) : 0; });

  var ctx = { close:c, high:h, low:l, vol:q, hasHL:hasHL, hasVol:hasVol, s:{} };

  rules.forEach(function(r){
    var key = ruleKey(r), n = Number(r.period)||14, n2 = Number(r.period2)||26;
    if (ctx.s[key]) return;
    var sp = specOf(r.ind);
    if (sp.needs === 'hl'  && !hasHL)  { ctx.s[key] = null; return; }
    if (sp.needs === 'vol' && !hasVol) { ctx.s[key] = null; return; }

    switch (r.ind){
      case 'RSI':        ctx.s[key] = calcRSI(c,n); break;
      case 'STOCH':      ctx.s[key] = calcStochK(h,l,c,n); break;
      case 'WILLR':      ctx.s[key] = calcWillR(h,l,c,n); break;
      case 'CCI':        ctx.s[key] = calcCCI(h,l,c,n); break;
      case 'MFI':        ctx.s[key] = calcMFI(h,l,c,q,n); break;
      case 'CHANGE':     ctx.s[key] = calcChange(c,n); break;
      case 'STREAK':     ctx.s[key] = calcStreak(c); break;
      case 'VS_SMA':     ctx.s[key] = calcVsMA(c, calcSMA(c,n)); break;
      case 'VS_EMA':     ctx.s[key] = calcVsMA(c, calcEMA(c,n)); break;
      case 'MACD':       ctx.s[key] = calcMACDHist(c,n,n2,9); break;
      case 'BB_PCT':     ctx.s[key] = calcBB(c,n,2,'pct'); break;
      case 'BB_WIDTH':   ctx.s[key] = calcBB(c,n,2,'width'); break;
      case 'ATR_PCT':    ctx.s[key] = calcATRPct(h,l,c,n); break;
      case 'VOLAT':      ctx.s[key] = calcVolatility(c,n); break;
      case 'ADX':        ctx.s[key] = calcADX(h,l,c,n); break;
      case 'VOL_RATIO':  ctx.s[key] = calcVolRatio(q,n); break;
      case 'VS_HIGH':    ctx.s[key] = calcVsHigh(c,h,n); break;
      case 'VS_LOW':     ctx.s[key] = calcVsLow(c,l,n); break;
      case 'CROSS':      ctx.s[key] = { a: calcSMA(c,n), b: calcSMA(c,n2) }; break;
      case 'EMA_CROSS':  ctx.s[key] = { a: calcEMA(c,n), b: calcEMA(c,n2) }; break;
      case 'MACD_CROSS': {
        var line = calcMACDLine(c,n,n2);
        var valid = line.filter(function(x){ return x!=null; });
        var sig = calcEMA(valid, 9);
        var sigFull = new Array<any>(c.length).fill(null), k = 0;
        for (var i=0;i<c.length;i++){ if (line[i]==null) continue; sigFull[i] = sig[k]; k++; }
        ctx.s[key] = { a: line, b: sigFull };
        break;
      }
      default: ctx.s[key] = null;
    }
  });
  return ctx;
}

/* 조건 하나를 그날 판정 */
function testRule(rule: any, ctx: any, i: any){
  var arr = ctx.s[ruleKey(rule)];
  if (!arr) return false;

  if (specOf(rule.ind).cmp === 'cross'){
    if (i < 1 || !arr.a || !arr.b) return false;
    var a0=arr.a[i-1], b0=arr.b[i-1], a1=arr.a[i], b1=arr.b[i];
    if (a0==null||b0==null||a1==null||b1==null) return false;
    return rule.op === 'dead' ? (a0 >= b0 && a1 < b1) : (a0 <= b0 && a1 > b1);
  }

  var v = arr[i];
  if (v == null || !isFinite(v)) return false;
  var t = Number(rule.value);
  if (rule.op === '<')  return v <  t;
  if (rule.op === '<=') return v <= t;
  if (rule.op === '>')  return v >  t;
  if (rule.op === '>=') return v >= t;
  return false;
}

/*  ── 자동매매가 실제로 손댈 수 있는 시장 ─────────────────────

    ⚠️ 국내 주식은 무료 실시간 창구가 없어 <서버 자동매매에서 빠져> 있습니다
       (모의투자 화면에도 그렇게 적어 뒀습니다). 그런데 백테스트는 국내까지
       사고팔았습니다. 그래서 "미리 돌려보기에서 가온전선이 수익의 14% 를
       냈다" 같은, 실제로는 절대 일어날 수 없는 결과가 나왔습니다.

       백테스트는 <실제로 일어날 수 있는 일> 만 보여줘야 합니다. 두 엔진이
       같은 이 함수를 봅니다 — 한쪽만 고치면 engine_same41 에서 걸립니다.
       (국내 주식을 직접 매매하는 것은 그대로 됩니다. 자동매매만 빠집니다.) */
function autoTradable(market){
  return String(market || '').toUpperCase() !== 'KR';
}

/*  ── 자리보다 후보가 많을 때 누구를 사는가 ─────────────────────

    ⚠️ 예전에는 <명단에 먼저 나온 것> 부터 담았습니다. 명단이 시장 이름
       순(CRYPTO → KR → US)이라 코인이 다섯 자리를 다 채우고 미국 주식은
       차례가 오지 않았습니다. 90일 백테스트를 돌리면 미국 종목이 한 건도
       안 나왔습니다 — 조건이 안 맞아서가 아니라 <줄을 못 서서> 입니다.

    두 가지로 고칩니다.
      ① 조건을 <얼마나 넉넉히> 만족했는지 점수를 냅니다.
         RSI 45 이하가 조건이면 RSI 20 이 RSI 44 보다 강한 신호입니다.
      ② 시장을 번갈아 가며 각 시장의 1등부터 담습니다.
         어느 시장도 굶지 않고, 왜 그걸 샀는지 설명할 수 있습니다.       */
function ruleMargin(rule, ctx, i){
  var arr = ctx.s[ruleKey(rule)];
  if (!arr) return 0;
  if (specOf(rule.ind).cmp === 'cross'){
    //  교차에는 '얼마나' 가 없습니다. 두 선이 벌어진 폭으로 셉니다.
    if (i < 1 || !arr.a || !arr.b) return 0;
    var a1 = arr.a[i], b1 = arr.b[i];
    if (a1 == null || b1 == null || !isFinite(a1) || !isFinite(b1) || !b1) return 0;
    return Math.abs(a1 - b1) / Math.abs(b1);
  }
  var v = arr[i];
  if (v == null || !isFinite(v)) return 0;
  var t = Number(rule.value);
  var d = (rule.op === '<' || rule.op === '<=') ? (t - v) : (v - t);
  //  기준값이 0 인 지표가 있어서 (0 기준 확산지수 등) 그때는 값으로 나눕니다
  var base = Math.abs(t) > 1e-9 ? Math.abs(t) : Math.max(1e-9, Math.abs(v));
  return d > 0 ? d / base : 0;
}
function ruleScore(rules, ctx, i){
  if (!rules || !rules.length) return 0;
  var s = 0;
  for (var r = 0; r < rules.length; r++) s += ruleMargin(rules[r], ctx, i);
  return s / rules.length;
}
/*  cands = [{ market, symbol, score, ... }] · room = 남은 자리
    같은 값을 넣으면 언제나 같은 답이 나와야 합니다 (백테스트와 실제가
    어긋나면 안 되니까요). 그래서 점수가 같으면 종목 이름으로 줄 세웁니다. */
function rankPicks(cands, room){
  function better(a, b){
    if (b.score !== a.score) return b.score - a.score;
    return String(a.symbol) < String(b.symbol) ? -1
         : String(a.symbol) > String(b.symbol) ? 1 : 0;
  }
  var list = (cands || []).slice().sort(better);
  if (!(room > 0)) return [];

  var by = {}, order = [];
  list.forEach(function(c){
    var m = String(c.market || '');
    if (!by[m]){ by[m] = []; order.push(m); }
    by[m].push(c);
  });
  order.sort();

  /*  자리가 시장 수보다 적으면 <번갈아> 가 성립하지 않습니다. 자리가
      하나뿐인데 순서대로 돌리면 늘 앞 시장(CRYPTO)만 삽니다. 그럴 때는
      시장을 가리지 않고 <가장 강한 신호> 를 삽니다 — 한 자리라면
      그게 맞습니다.                                                    */
  if (room < order.length) return list.slice(0, room);

  //  ① 먼저 시장마다 한 자리씩 — 어느 시장도 굶지 않게
  var out = [], taken = {};
  order.forEach(function(m){
    if (out.length >= room) return;
    var c = by[m][0];
    if (c){ out.push(c); taken[m + '|' + c.symbol] = 1; }
  });
  //  ② 남은 자리는 시장을 가리지 않고 점수가 높은 것부터
  for (var i = 0; i < list.length && out.length < room; i++){
    var x = list[i];
    if (taken[x.market + '|' + x.symbol]) continue;
    taken[x.market + '|' + x.symbol] = 1;
    out.push(x);
  }
  return out;
}

const MT_INTERVAL_MIN: Record<string, number> = {
  "5m": 5, "15m": 15, "30m": 30, "2h": 120, "4h": 240,
  "1d": 60 * 24, "1w": 60 * 24 * 7,
};

function mtDue(interval: string, lastAt: string | null) {
  const need = MT_INTERVAL_MIN[interval] ?? MT_INTERVAL_MIN["1d"];
  if (!lastAt) return true;
  const mins = (Date.now() - Date.parse(lastAt)) / 60000;
  //  1분쯤 여유를 둡니다 (cron 이 정확히 같은 초에 안 옵니다)
  return mins >= need - 1;
}

/*  ── 지금 미국 장이 열려 있나 ─────────────────────────────
    이게 없으면 새벽 3시에도 자동매매가 돕니다. 장이 닫혀 있으면
    Alpaca 가 주는 '마지막 체결가' 는 몇 시간째 그대로인 값이라,
    멈춘 가격으로 밤새 사고파는 꼴이 됩니다. 손절이 새벽에 헛걸리기도 합니다.

    직접 시간을 계산하지 않고 Alpaca 에게 물어봅니다 — 서머타임도,
    공휴일도, 조기 폐장도 저쪽이 압니다.
    코인은 24시간이라 이 검사와 무관합니다.                            */
async function usMarketOpen() {
  try {
    const d: any = await alpGet(ALP_TRADE, "/v2/clock", {});
    return { open: !!d?.is_open, next: String(d?.next_open ?? "") };
  } catch {
    //  못 물어봤으면 <닫힌 것으로> 봅니다. 멈춘 가격으로 매매하는 것보다
    //  한 번 쉬는 편이 낫습니다.
    return { open: false, next: "" };
  }
}

/*  거래 한 줄 넣기. 규칙(유니버스 트리거 등)에 걸리면 조용히 넘어가지
    않고 왜 막혔는지 남깁니다 — 자동매매가 아무것도 안 했을 때
    "왜?" 를 볼 데가 있어야 합니다.                                   */
async function adminInsertTrade(admin: any, row: any) {
  /*  자동매매도 직접 주문과 <같은 문> 으로 들어갑니다.
      5분마다 도는 스캔이 마침 팀원이 주문하는 순간과 겹치면,
      둘이 같은 현금을 두 번 쓸 수 있기 때문입니다.                */
  const { error } = await admin.rpc("mt_place_trade", {
    p_team_id: row.team_id, p_market: row.market, p_symbol: row.symbol,
    p_name: row.name, p_side: row.side, p_qty: row.qty, p_price: row.price,
    p_fee: row.fee, p_fx: row.fx ?? 1,
    p_source: row.source ?? "auto", p_fill_basis: row.fill_basis ?? null,
    p_rule_name: row.rule_name ?? null,
  });
  if (error) {
    console.error("자동매매 거래 실패", row.symbol, error.message);
    return false;
  }
  return true;
}

/*  ── 보유 종목 시세 갱신 ──────────────────────────────────────

    ⚠️ 팀 성적 · 보유 평가액은 price_cache 의 <가장 최근 종가> 로 계산합니다.
    그런데 그 표를 채우는 건 (ㄱ) 누가 터미널에서 차트를 열 때 (ㄴ) 주 1회
    도는 지난시세 채우기 뿐이었습니다. 자동매매 스캔은 시세를 받아서 쓰기만
    하고 <저장은 안 했습니다>.

    그래서 아무도 터미널을 안 켠 주에는, 자동매매가 사고팔고 있는데도
    성적표의 평가액이 지난주 값에 멈춰 있었습니다. "터미널을 안 켜도
    돌아간다" 는 말이 절반만 참이었던 셈입니다.

    자동매매가 켜져 있든 아니든, 5분마다 <팀들이 들고 있는 종목> 의 시세를
    받아 저장합니다. 여러 종목을 한 번에 묻는 호출이라 값도 거의 안 듭니다. */
async function mtRepriceHeld(admin: any, clock: any) {
  //  거래가 있었던 종목 = 지금 들고 있을 수 있는 종목
  const { data: tr } = await admin.from("trades").select("market, symbol");
  const held = new Map<string, string>();
  for (const t of tr ?? []) held.set(`${t.market}|${t.symbol}`, t.market);

  //  유니버스도 같이 채워둡니다 — 어차피 스캔이 받는 값입니다
  const { data: uni } = await admin.from("universe").select("market, symbol");
  for (const u of uni ?? []) held.set(`${u.market}|${u.symbol}`, u.market);

  const us: string[] = [], cc: string[] = [];
  for (const k of held.keys()) {
    const [mk, sym] = [k.split("|")[0], k.slice(k.indexOf("|") + 1)];
    if (mk === "US" && clock.open) us.push(sym);        // 장이 닫혔으면 그대로 둡니다
    else if (mk === "CRYPTO") cc.push(sym);             // 코인은 24시간
  }
  if (!us.length && !cc.length) return { priced: 0, note: "받을 종목이 없습니다." };

  const [qUS, qCC] = await Promise.all([
    us.length ? alpQuotesUS(us).catch(() => ({})) : Promise.resolve({}),
    cc.length ? alpQuotesCrypto(cc).catch(() => ({})) : Promise.resolve({}),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = [];
  for (const [sym, q] of Object.entries<any>(qUS))
    if (Number(q?.price) > 0) rows.push({ market: "US", symbol: sym, d: today, v: Number(q.price) });
  for (const [sym, q] of Object.entries<any>(qCC))
    if (Number(q?.price) > 0) rows.push({ market: "CRYPTO", symbol: sym, d: today, v: Number(q.price) });
  if (!rows.length) return { priced: 0, note: "시세를 받지 못했습니다." };

  /*  ⚠️ price_cache 에 통째로 upsert 하면 이름 칸이 비어 있는 채로 덮어써서
      <이미 저장돼 있던 종목 이름이 지워집니다>. price_bulk_upsert 는
      name 을 coalesce 로 지켜주므로 그쪽으로 넣습니다.                 */
  const { error } = await admin.rpc("price_bulk_upsert", { p_rows: rows });
  if (error) return { priced: 0, note: `시세 저장 실패: ${error.message}` };
  return { priced: rows.length };
}

/*  ══ 배당금 ══════════════════════════════════════════════════

    배당주에 투자한 학회원이 손해를 보면 안 됩니다. 배당을 안 세면
    "배당락일에 주가가 떨어진 만큼만" 반영되어 배당주가 무조건 지는
    게임이 됩니다. 실제로는 그 떨어진 만큼이 현금으로 들어옵니다.

    ── 어디서 받아오나 (전부 확인해 본 것들입니다) ──
      미국  Alpaca /v1/corporate-actions?types=cash_dividend
            무료 Basic 요금제에 들어 있습니다.
            ⚠️ start/end 는 <배당락일이 아니라 process_date> 로 거릅니다.
               (Alpaca 포럼 답변: "the API end dates look at the
                process_date which can be several days after the ex_date")
               그래서 넉넉한 과거 구간으로 받아서 ex_date 는 우리가 거릅니다.
               start=오늘&end=12월2일 로 부르면 <거의 아무것도 안 옵니다>.
      국내  KIS /uapi/domestic-stock/v1/ksdinfo/dividend (TR_ID HHKDB669102C0)
            예탁결제원 배당일정입니다. F_DT~T_DT 로 <미래까지> 줍니다.
            per_sto_divi_amt 가 주당 현금배당금, divi_pay_dt 가 지급일.
            ⚠️ KIS 키가 없으면 국내 배당은 비어 있습니다 (미국은 그대로 됩니다).

    ── 누가 받나 ──
      미국  배당락일(ex_date) <전날> 종가에 들고 있었으면 받습니다.
            배당락일 당일에 사면 못 받습니다 — 그래서 그날 주가가 빠집니다.
      국내  기준일(record_date)에 들고 있었으면 받습니다.

    ── 세금 ──
      국내 15.4% (소득세 14% + 지방소득세 1.4%)
      미국 15%   (한·미 조세조약 제12조 상한)
      대회는 흉내내기이므로 원천징수만 반영하고 종합과세는 안 봅니다.       */
const DIV_TAX: Record<string, number> = { KR: 0.154, US: 0.15 };

//  ⚠️ 배당락일과 process_date 가 벌어지는 폭. 넉넉히 잡습니다.
const DIV_LOOKBACK_DAYS = 120;

async function alpDividendsUS(symbols: string[], from: string, to: string) {
  const out: any[] = [];
  if (!symbols.length || !alpacaKeys()) return out;
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    let token = "";
    for (let page = 0; page < 20; page++) {
      const d: any = await alpGet(ALP_DATA, "/v1/corporate-actions", {
        symbols: chunk.join(","), types: "cash_dividend",
        start: from, end: to, limit: "1000",
        ...(token ? { page_token: token } : {}),
      }).catch((e) => { console.error("배당 조회 실패", String(e)); return null; });
      if (!d) break;
      const rows = d?.corporate_actions?.cash_dividends ?? [];
      for (const r of rows) {
        const rate = Number(r?.rate);
        if (!(rate > 0)) continue;
        out.push({
          market: "US", symbol: String(r.symbol ?? "").toUpperCase(),
          per_share: rate,
          ex_date: String(r.ex_date ?? "").slice(0, 10) || null,
          record_date: String(r.record_date ?? "").slice(0, 10) || null,
          pay_date: String(r.payable_date ?? "").slice(0, 10) || null,
        });
      }
      token = String(d?.next_page_token ?? "");
      if (!token) break;
    }
  }
  return out.filter((x) => x.pay_date && (x.ex_date || x.record_date));
}

async function kisDividendsKR(admin: any, from: string, to: string) {
  const out: any[] = [];
  if (!kisOn()) return out;
  const tok = await kisToken(admin);
  if (!tok) return out;
  let cts = "";
  for (let page = 0; page < 30; page++) {
    const u = kisBase() + "/uapi/domestic-stock/v1/ksdinfo/dividend"
            + "?CTS=" + encodeURIComponent(cts) + "&GB1=0&SHT_CD=&HIGH_GB="
            + "&F_DT=" + from.replace(/-/g, "") + "&T_DT=" + to.replace(/-/g, "");
    const r = await fetch(u, { headers: {
      "authorization": "Bearer " + tok,
      "appkey": secret("KIS_APP_KEY"), "appsecret": secret("KIS_APP_SECRET"),
      "tr_id": "HHKDB669102C0", "custtype": "P",
      "tr_cont": page ? "N" : "",
      "Content-Type": "application/json",
    } }).catch(() => null);
    if (!r || !r.ok) { console.error("KIS 배당일정 실패", r ? r.status : "네트워크"); break; }
    const d: any = await r.json().catch(() => null);
    const rows = d?.output1 ?? [];
    for (const x of rows) {
      const per = Number(String(x?.per_sto_divi_amt ?? "").replace(/,/g, ""));
      if (!(per > 0)) continue;
      const day = (s: any) => {
        const v = String(s ?? "").replace(/\D/g, "");
        return v.length === 8 ? v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8) : null;
      };
      const rec = day(x?.record_date), pay = day(x?.divi_pay_dt);
      if (!rec) continue;
      out.push({
        market: "KR", symbol: String(x?.sht_cd ?? "").trim(),
        per_share: per, ex_date: null, record_date: rec,
        //  ⚠️ 지급일이 비어 있는 경우가 있습니다 (아직 안 정해짐).
        //     그때는 <기준일> 을 지급일로 두면 안 됩니다 — 아직 안 들어온
        //     돈을 현금으로 세게 됩니다. 국내 결산배당은 보통 기준일
        //     이듬해 4월쯤 들어오므로 그렇게 잡아 둡니다.
        pay_date: pay || krGuessPayDate(rec),
        pay_estimated: !pay,
      });
    }
    cts = String(d?.ctx_area_nk100 ?? d?.CTS ?? "").trim();
    if (!cts) break;
  }
  return out.filter((x) => x.symbol && x.pay_date);
}

//  국내 결산배당은 기준일 이듬해 4월쯤 들어옵니다 (중간배당은 두어 달 뒤)
function krGuessPayDate(recordDate: string) {
  const d = new Date(recordDate + "T00:00:00Z");
  const m = d.getUTCMonth();
  if (m === 11) return (d.getUTCFullYear() + 1) + "-04-15";   // 12월 결산
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}

/*  ── 팀별로 배당을 적어 넣습니다 ───────────────────────────

    ⚠️ "지금 들고 있는 수량" 으로 세면 안 됩니다. 배당락일 전에 팔았으면
       못 받고, 그 뒤에 샀으면 받습니다. 그날의 보유 수량을 매매 기록에서
       되짚어 셉니다.                                                   */
function qtyOnDate(trades: any[], market: string, symbol: string, onDate: string) {
  let q = 0;
  for (const t of trades) {
    if (t.market !== market || t.symbol !== symbol) continue;
    if (String(t.traded_on) > onDate) break;          //  날짜순으로 옵니다
    q += (t.side === "buy" ? 1 : -1) * Number(t.qty || 0);
  }
  return Math.max(0, q);
}

async function mtSyncDividends(admin: any, ct: any) {
  const today = kstParts().iso;
  const endsOn = ct?.ends_at ? String(ct.ends_at).slice(0, 10) : shiftDay(today, 90);

  //  어느 팀이 무엇을 들고 있(었)나 — 매매 기록 전부가 필요합니다
  const { data: teams } = await admin.from("teams").select("id, name");
  if (!teams?.length) return { rows: 0, note: "팀이 없습니다." };
  const { data: tr } = await admin.from("trades")
    .select("team_id, market, symbol, name, side, qty, traded_on")
    .order("traded_on", { ascending: true });
  const byTeam: Record<number, any[]> = {};
  for (const t of tr ?? []) (byTeam[t.team_id] ??= []).push(t);

  //  어떤 종목이 한 번이라도 있었나 (그 종목만 배당을 물어보면 됩니다)
  const symUS = new Set<string>(), symKR = new Set<string>();
  const nameOf: Record<string, string> = {};
  for (const t of tr ?? []) {
    const k = t.market + "|" + t.symbol;
    if (t.name) nameOf[k] = t.name;
    if (t.market === "US") symUS.add(String(t.symbol).toUpperCase());
    if (t.market === "KR") symKR.add(String(t.symbol));
  }
  if (!symUS.size && !symKR.size) return { rows: 0, note: "보유한 적이 있는 종목이 없습니다." };

  /*  ⚠️ 미국은 <과거 구간> 으로 부릅니다. start/end 가 process_date 를
      보기 때문에, 미래 구간으로 부르면 아직 처리 안 된 것만 찾다가
      빈손으로 돌아옵니다. 넉넉히 과거를 받아 ex_date 로 우리가 거릅니다. */
  const us = await alpDividendsUS([...symUS],
                shiftDay(today, -DIV_LOOKBACK_DAYS), today).catch(() => []);
  const kr = await kisDividendsKR(admin,
                shiftDay(today, -DIV_LOOKBACK_DAYS), endsOn).catch(() => []);

  const all = [...us, ...kr].filter((d) => {
    const on = d.ex_date || d.record_date;
    if (!on) return false;
    //  대회가 끝난 뒤에 배당락이 오는 것은 이번 대회와 상관없습니다
    return on <= endsOn;
  });

  const rows: any[] = [];
  for (const t of teams) {
    const mine = byTeam[t.id] ?? [];
    if (!mine.length) continue;
    for (const d of all) {
      /*  미국은 배당락일 <전날> 까지 들고 있어야 받습니다.
          국내는 기준일에 들고 있어야 받습니다.                        */
      const onDate = d.market === "US"
        ? (d.ex_date ? shiftDay(d.ex_date, -1) : d.record_date)
        : (d.record_date ?? d.ex_date);
      if (!onDate) continue;
      const qty = qtyOnDate(mine, d.market, d.symbol, onDate);
      if (!(qty > 0)) continue;
      const gross = qty * d.per_share;
      const tax = gross * (DIV_TAX[d.market] ?? 0);
      rows.push({
        team_id: t.id, market: d.market, symbol: d.symbol,
        name: nameOf[d.market + "|" + d.symbol] ?? null,
        per_share: d.per_share, qty, gross, tax, net: gross - tax,
        fx: d.market === "KR" ? 1 : (Number(ct?.fx) || MT_FX),
        ex_date: d.ex_date, record_date: d.record_date, pay_date: d.pay_date,
        source: d.pay_estimated ? "auto_est" : "auto",
      });
    }
  }
  if (!rows.length) return { rows: 0, us: us.length, kr: kr.length,
                             note: "새로 넣을 배당이 없습니다." };
  let put = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await admin.rpc("dividend_upsert", { p_rows: rows.slice(i, i + 200) });
    put += Number(data) || 0;
  }
  return { rows: put, seen: rows.length, us: us.length, kr: kr.length,
           kis: kisOn(), ends_on: endsOn };
}

async function mtScan(admin: any) {
  alpCallsReset();
  const ct = await mtContest(admin);
  if (ct.closed) return { ran: 0, note: "대회가 끝나 자동매매를 돌리지 않습니다." };

  /*  ⚠️ 아래 '차례가 된 팀' 검사보다 <먼저> 합니다.
      자동매매를 아무 팀도 안 켰어도 성적표는 최신이어야 하니까요.       */
  const clockAll = await usMarketOpen();
  let repriced: any = { priced: 0 };
  try { repriced = await mtRepriceHeld(admin, clockAll); } catch (e) { repriced = { priced: 0, note: String(e) }; }

  /*  배당은 하루에 한 번만 맞춰보면 충분합니다 (배당일정이 분 단위로
      바뀌지는 않습니다). 5분마다 부르면 Alpaca·KIS 호출만 낭비합니다.  */
  let divSync: any = null;
  try {
    const { data: hitD } = await admin.from("series_cache")
      .select("fetched_at").eq("source", "div_sync").eq("code", "last")
      .eq("item_code", "").maybeSingle();
    const age = hitD ? (Date.now() - Date.parse(hitD.fetched_at)) / 36e5 : 999;
    if (age >= 20) {
      const ctD = await mtContest(admin);
      divSync = await mtSyncDividends(admin, ctD);
      await admin.from("series_cache").upsert({
        source: "div_sync", code: "last", item_code: "",
        fetched_at: new Date().toISOString(), payload: divSync });
    }
  } catch (e) { divSync = { rows: 0, note: String((e as any)?.message ?? e) }; }

  const { data: teams } = await admin.from("teams")
    .select("id, name, seed, auto_on, auto_budget, auto_interval, auto_last_at, bar_tf")
    .eq("auto_on", true);
  const due = (teams ?? []).filter((t: any) => mtDue(t.auto_interval, t.auto_last_at));
  if (!due.length) return { ran: 0, teams: (teams ?? []).length, repriced,
                            api_calls: alpCalls(), api_limit: 200,
                            note: "차례가 된 팀이 없습니다. (시세는 갱신했습니다)" };

  //  규칙을 가진 팀만 남깁니다
  const ids = due.map((t: any) => t.id);
  /*  ⚠️ 같은 날 두 번 저장하면 effective_from 이 똑같습니다.
      날짜로만 줄을 세우면 <어느 쪽이 앞에 올지 정해져 있지 않아서>,
      전략을 바꿔 저장했는데 서버가 예전 것을 계속 돌릴 수 있었습니다.
      전략을 다듬는 날은 하루에 몇 번씩 저장하게 되니 흔한 일입니다.
      id 로 한 번 더 줄을 세워 <가장 나중에 저장한 것> 이 이기게 합니다.  */
  const { data: strats } = await admin.from("strategies")
    .select("id, team_id, name, config, effective_from")
    .in("team_id", ids)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });
  const byTeam: Record<number, any> = {};
  for (const s of strats ?? []) if (!byTeam[s.team_id]) byTeam[s.team_id] = s;

  const live = due.filter((t: any) => byTeam[t.id]);
  if (!live.length) {
    //  규칙이 없어도 '차례는 지나갔다' 고 적어둡니다 (다음 차례 계산용)
    for (const t of due) {
      await admin.from("teams").update({ auto_last_at: new Date().toISOString() }).eq("id", t.id);
      await admin.from("auto_runs").insert({ team_id: t.id, note: "저장된 전략이 없습니다." });
    }
    return { ran: 0, teams: due.length, repriced, api_calls: alpCalls(), api_limit: 200,
             note: "전략을 저장한 팀이 없습니다." };
  }

  //  ── 유니버스 시세를 한 벌만 받습니다 ──
  const { data: uni } = await admin.from("universe").select("market, symbol, name");

  /*  미국 장이 닫혀 있으면 미국 종목은 아예 건드리지 않습니다.
      코인은 24시간이라 그대로 돕니다.                                 */
  const clock = clockAll;                    // 위에서 이미 받았습니다
  const uniOpen = (uni ?? []).filter((u: any) => u.market !== "US" || clock.open);

  const us = uniOpen.filter((u: any) => u.market === "US").map((u: any) => u.symbol);
  const cc = uniOpen.filter((u: any) => u.market === "CRYPTO").map((u: any) => u.symbol);
  const [qUS, qCC] = await Promise.all([
    us.length ? alpQuotesUS(us).catch(() => ({})) : Promise.resolve({}),
    cc.length ? alpQuotesCrypto(cc).catch(() => ({})) : Promise.resolve({}),
  ]);
  //  스캔은 늘 새로 받습니다 — 받은 김에 보관함도 채워 두면
  //  뒤이어 들어오는 화면 새로고침이 공짜가 됩니다
  quoteCachePut("US", qUS); quoteCachePut("CRYPTO", qCC);
  const scanned = Object.keys(qUS).length + Object.keys(qCC).length;

  /*  지표를 계산하려면 <최근 흐름> 이 필요합니다. 봉도 한 벌만 받아
      모든 팀이 나눠 씁니다 — 팀마다 따로 받으면 15팀이면 15배입니다.
      팀들이 고른 간격이 제각각일 수 있어서 간격별로 한 벌씩 받습니다.  */
  const tfs = Array.from(new Set(live.map((t: any) => mtBarTf(t))));
  const barsUS: Record<string, any> = {}, barsCC: Record<string, any> = {};
  for (const tf of tfs) {
    const [bu, bc] = await Promise.all([
      us.length ? alpBarsUS(us, tf).catch(() => ({})) : Promise.resolve({}),
      cc.length ? alpBarsCrypto(cc, tf).catch(() => ({})) : Promise.resolve({}),
    ]);
    barsUS[tf] = {}; barsCC[tf] = {};
    for (const [k, v] of Object.entries(bu)) (barsUS[tf] as any)[k] = barsToPts(v as any[]);
    for (const [k, v] of Object.entries(bc)) (barsCC[tf] as any)[k] = barsToPts(v as any[]);
  }

  const out: any[] = [];
  for (const t of live) {
    /*  ── 팀 하나가 넘어져도 다른 팀은 계속 돕니다 ──

        모의투자는 팀 프로젝트라, 한 팀 사정이 다른 팀 성적에 영향을 주면
        안 됩니다. 돈은 애초에 안 섞이지만(팀마다 자기 거래만 셉니다),
        이 반복문에 감싸는 것이 없으면 <차례> 는 섞였습니다.

        예: 1팀이 들고 있는 종목 하나의 시세를 못 받아 mtAccount 가
        예외를 던지면, 그 예외가 통째로 튀어나가 2팀·3팀은 그 회차를
        아예 못 돌았습니다. 1팀 사정으로 2팀 자동매매가 멈춘 셈입니다.

        이제 팀마다 따로 감싸고, 실패해도 그 팀 기록에만 남기고 넘어갑니다. */
    try {
      await mtScanTeam(admin, ct, t, byTeam[t.id], barsUS, barsCC,
                       qUS as any, qCC as any, uniOpen, clock, scanned, out);
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      console.error("자동매매 실패", t.name, msg);
      //  넘어진 팀도 <차례는 지나갔다> 고 적어둡니다. 안 그러면 다음 회차에
      //  또 같은 자리에서 넘어지며 영영 못 넘어갑니다.
      await admin.from("auto_runs").insert({
        team_id: t.id, scanned, matched: 0, filled: 0, spent: 0,
        note: "이번 회차는 실패했습니다: " + msg.slice(0, 200),
      });
      await admin.from("teams").update({ auto_last_at: new Date().toISOString() })
        .eq("id", t.id);
      out.push({ team_id: t.id, team: t.name, scanned, matched: 0, filled: 0,
                 spent: 0, budget_left: 0, note: "실패: " + msg.slice(0, 120) });
    }
  }

  return { ran: out.length, scanned, teams: out, us_open: clock.open, repriced,
           dividends: divSync,
           //  이번 회차에 Alpaca 를 몇 번 불렀는지 (무료 한도는 분당 200회)
           api_calls: alpCalls(), api_limit: 200, bar_tfs: tfs,
           next_open: clock.next, at: new Date().toISOString() };
}

/*  팀 하나의 한 회차. mtScan 이 팀마다 이걸 부릅니다.  */
async function mtScanTeam(admin: any, ct: any, t: any, st: any,
                          barsUS: any, barsCC: any, qUS: any, qCC: any,
                          uniOpen: any[], clock: any, scanned: number, out: any[]) {
  {
    const acc = await mtAccount(admin, t.id, ct.fx);
    //  쓸 수 있는 돈 = min(남은 현금, 팀이 정한 자동매매 한도)
    const room = Math.max(0, Math.min(acc.cash, Number(t.auto_budget) || 0));
    const res = { team_id: t.id, team: t.name, scanned, matched: 0, filled: 0,
                  spent: 0, budget_left: room, note: "" };

    const tf = mtBarTf(t);
    const bU = (barsUS[tf] ?? {}) as any, bC = (barsCC[tf] ?? {}) as any;

    /*  ── 먼저 팝니다 ──
        손절·익절이 걸렸는데 새로 사느라 현금을 다 써버리면 안 되고,
        판 돈으로 다시 살 수 있어야 실제 매매와 비슷합니다.          */
    let sold = 0, gained = 0;
    //  qUS 가 비어 있으면(장 마감) 미국 종목은 시세가 없어 자연히 빠집니다
    for (const x of mtPickSells(st.config, acc, qUS as any, qCC as any, bU, bC)) {
      const rate = x.market === "KR" ? 1 : ct.fx;
      const gross = x.qty * x.price;
      const fee = mtFee(x.market, "sell", gross);
      await adminInsertTrade(admin, {
        team_id: t.id, market: x.market, symbol: x.symbol, name: x.name,
        side: "sell", qty: x.qty, price: x.price, fee, fx: ct.fx,
        traded_on: kstParts().iso, traded_at: new Date().toISOString(),
        source: "auto", fill_basis: "실시간(자동)", rule_name: x.why,
      });
      sold++; gained += (gross - fee) * rate;
    }
    (res as any).sold = sold;

    //  팔았으면 현금이 늘었으니 계좌를 다시 셉니다
    const acc2 = sold ? await mtAccount(admin, t.id, ct.fx) : acc;
    const room2 = Math.max(0, Math.min(acc2.cash, Number(t.auto_budget) || 0));
    (res as any).budget_left = room2;

    if (room2 <= 0) {
      res.note = sold
        ? `${sold}건 팔았습니다. 남은 배정 금액이 없어 새로 사지는 않았습니다.`
        : "자동매매에 배정된 돈이 없거나 현금이 모자랍니다.";
    } else {
      //  규칙 판정은 화면의 백테스트와 같은 엔진을 씁니다
      const picks = mtPickByRule(st.config, uniOpen, qUS as any, qCC as any, acc2, bU, bC);
      res.matched = picks.length;

      const room = room2;
      let spent = 0;
      for (const p of picks) {
        if (spent >= room) break;
        const rate = p.market === "KR" ? 1 : ct.fx;
        //  종목당 배정 — 전략에서 정한 비율만큼, 없으면 남은 돈을 고르게 나눕니다
        const perPct = Math.max(1, Math.min(100, Number(st.config?.per_position_pct) || 20));
        const each = room * perPct / 100;
        const budget = Math.min(each, room - spent);

        /*  ⚠️ 두 가지를 여기서 고쳤습니다. 둘 다 <아무 말 없이 한 주도 안 사는>
            고장이라, 화면에는 "조건에 맞았지만 살 수 있는 수량이 안 나왔습니다"
            만 뜨고 원인을 알 길이 없었습니다.

            ① 수수료를 안 빼고 수량을 셌습니다.
               「한 종목에 100%」로 둔 팀은 수량을 배정액에 꽉 채워 계산한 뒤,
               바로 다음 줄에서 <수수료 때문에> 예산을 넘겨 통째로 버려졌습니다.
               비율이 100 에 가까울수록 반드시 이렇게 됩니다.

            ② 코인을 정수로만 셌습니다.
               파는 쪽(mtPickSells)은 소수를 다루는데 사는 쪽만 Math.floor 라,
               한 개 값이 배정액보다 비싼 코인은 <영영 0개> 였습니다.
               팔 수는 있는데 살 수는 없는 종목이 생깁니다.               */
        const unit = p.price * rate;
        const feeRate = (MT_FEE[p.market] ?? MT_FEE.US).buy;
        const step = p.market === "CRYPTO" ? 1e8 : 1;   //  코인은 소수 8자리까지
        let qty = Math.floor(budget / (unit * (1 + feeRate)) * step) / step;
        /*  ⚠️ 수수료는 <달러 단위로 반올림> 됩니다(mtFee). 비율로 미리
            떼어둔 값보다 실제가 조금 더 나올 수 있어서, 실제 금액으로
            다시 재고 넘치면 한 칸씩 줄입니다. 여기서 «종목당 배정»
            (budget) 도 같이 지킵니다 — 「한 종목에 50%」라고 했으면
            반올림 때문에라도 50%를 넘으면 안 됩니다.                  */
        const cap = Math.min(budget, room - spent);
        for (let guard = 0; guard < 6 && qty > 0; guard++) {
          const g = qty * p.price;
          const c = (g + mtFee(p.market, "buy", g)) * rate;
          if (c <= cap) break;
          /*  ⚠️ «한 칸씩» 줄이면 안 됩니다. 코인은 한 칸이 1억분의 1이라
              몇백 번을 줄여도 제자리입니다. 넘친 <비율만큼> 줄입니다. */
          const next = Math.floor(qty * (cap / c) * step) / step;
          qty = next < qty ? next : Math.floor((qty - 1 / step) * step) / step;
        }
        if (!(qty > 0)) continue;
        const gross = qty * p.price;
        const fee = mtFee(p.market, "buy", gross);
        const cost = (gross + fee) * rate;
        if (cost > room - spent) continue;

        const okBuy = await adminInsertTrade(admin, {
          team_id: t.id, market: p.market, symbol: p.symbol, name: p.name,
          side: "buy", qty, price: p.price, fee, fx: ct.fx,
          traded_on: kstParts().iso, traded_at: new Date().toISOString(),
          source: "auto", fill_basis: "실시간(자동)", rule_name: st.name ?? "전략",
        });
        //  DB 가 거절했으면(현금 부족 등) 쓴 것으로 세지 않습니다
        if (!okBuy) continue;
        spent += cost; res.filled++;
      }
      res.spent = spent;
      res.budget_left = room - spent;
      if (!res.filled && res.matched) res.note = "조건에 맞았지만 살 수 있는 수량이 안 나왔습니다.";
      /*  ⚠️ "조건에 맞는 종목이 없었습니다" 와 "봉을 아예 못 받았습니다" 는
          화면에서 똑같아 보입니다. 그런데 원인은 완전히 다릅니다 —
          앞쪽은 전략이 까다로운 것이고, 뒤쪽은 <고장> 입니다.
          실제로 봉 요청이 한도를 넘어 거절당하는 바람에 하루 종일
          한 종목도 못 산 적이 있는데, 화면에는 계속 "조건에 맞는 종목이
          없었습니다" 만 떴습니다. 이제 구분해서 적습니다.              */
      const usable = Object.keys(bU).filter((k) => (bU[k] ?? []).length >= 2).length
                   + Object.keys(bC).filter((k) => (bC[k] ?? []).length >= 2).length;
      (res as any).bars = usable;
      if (!res.matched) {
        if (usable === 0) {
          res.note = "⚠️ 봉(시세 흐름)을 한 종목도 받지 못했습니다 — 조건을 판정할 수 없었습니다. "
                   + "Alpaca 키와 요금제를 확인하세요. (전략 문제가 아닙니다)";
        } else {
          res.note = clock.open
            ? `매수 조건에 맞는 종목이 없었습니다. (봉을 받은 종목 ${usable}개 중)`
            : `미국 장이 닫혀 있어 코인만 봤습니다. (봉을 받은 종목 ${usable}개 중)`;
        }
      }
      if (sold) res.note = `${sold}건 팔고 ${res.filled}건 샀습니다. ` + res.note;
    }

    await admin.from("auto_runs").insert({
      team_id: t.id, scanned: res.scanned, matched: res.matched,
      filled: res.filled + sold, spent: res.spent,
      budget_left: res.budget_left, note: res.note,
    });
    await admin.from("teams").update({ auto_last_at: new Date().toISOString() }).eq("id", t.id);
    out.push(res);
  }
}

/*  ── 봉(bar) 가져오기 ────────────────────────────────────────
    지표를 계산하려면 <값 하나> 가 아니라 <최근 흐름> 이 필요합니다.
    RSI(14)는 15개, MACD(12,26,9)는 60개쯤 있어야 값이 나옵니다.

    Alpaca 무료 요금제로 충분합니다 — 분당 200회, 7년치, 한 번에
    여러 종목. 그래서 지표용으로 따로 유료 API 를 살 이유가 없습니다.  */
/*  <훑는 간격> 과 <지표 기준 봉> 은 다른 이야기입니다.

    훑는 간격 = 얼마나 자주 들여다볼까
    지표 봉   = 20일 이동평균인가, 20개 5분봉 이동평균인가

    "5분마다 확인하되 일봉 20일선" 이 가장 흔한 방식인데, 예전에는
    훑는 간격이 곧 봉 기준이라 그걸 표현할 수가 없었습니다.
    이제 팀이 bar_tf 로 따로 정합니다.                                */
const MT_TF: Record<string, string> = {
  "5m": "5Min", "15m": "15Min", "30m": "30Min",
  "1h": "1Hour", "2h": "1Hour", "4h": "4Hour", "1d": "1Day", "1w": "1Week",
};
//  봉 기준을 안 정한 팀은 일봉으로 봅니다 (가장 흔한 기준입니다)
const mtBarTf = (t: any) => MT_TF[String(t?.bar_tf ?? "1d")] ?? "1Day";

//  지표가 쓸 만한 값을 내려면 이만큼은 있어야 합니다
/*  종목당 받아올 봉 수.

    ⚠️ 220 이었는데, 「기간 고점 대비」·「기간 저점 대비」의 <기본 기간이
       252> 입니다 (1년치 거래일). 즉 그 지표는 아무것도 안 건드리고
       그대로 쓰면 220봉으로는 값이 안 나와서 <조건이 영영 성립하지
       않았습니다>. 기본값이 안 돌아가는 건 그냥 버그입니다.
       252 + 워밍업 여유를 보고 300 으로 올립니다.                     */
const MT_BARS = 300;

/*  ⚠️ Alpaca 의 limit 은 <전 종목 합쳐서> 최대 10,000 입니다.
    (문서: "1 to 10000", "The limit applies to the total number of data
     points, not per symbol!")

    예전에는 100종목 × 220봉 = 22,000 을 그대로 보냈습니다. 한도를 넘으니
    Alpaca 가 요청을 거절하고, 그 오류를 catch 로 삼켜 <그 100종목의 봉이
    통째로 빈 채로> 넘어갔습니다. 봉이 없으면 조건을 판정할 수가 없어서
    자동매매가 하루 종일 돌아도 <한 종목도 안 샀습니다>.

    그래서 한 번에 부르는 종목 수를 220봉 × N ≤ 10,000 이 되게 잘랐습니다. */
const ALP_BAR_CAP = 10000;
//  한 종목이 MT_BARS 봉이면, 한 페이지(10,000봉)에 몇 종목이 들어가나.
//  여유(1.4배)를 두는 이유: 실제 봉 수는 휴장·빈 봉 때문에 들쭉날쭉합니다.
//  이 수를 넘기면 페이지가 넘어가고, 페이지가 넘어가면 <뒤쪽 종목이 0개>
//  가 될 위험이 생깁니다 (Alpaca 는 종목 순으로 채워 보냅니다).
const MT_CHUNK = Math.max(1, Math.floor(ALP_BAR_CAP / (MT_BARS * 1.4)));   // 23

/*  ⚠️ start 를 안 주면 Alpaca 는 <오늘 0시부터> 를 줍니다.
    5분봉이면 하루가 다 차도 78개뿐이고, 장 초반엔 몇 개도 안 됩니다.
    이동평균 20·60 이나 RSI 14 를 걸어두면 영영 성립하지 않습니다.
    그래서 봉이 MT_BARS 개쯤 나올 만큼 거슬러 올라가 달라고 못박습니다.

    ⚠️⚠️ 여기서 <너무 많이> 거슬러 올라가는 것도 똑같이 위험합니다.
       Alpaca 문서: "The returned results are sorted by <symbol first>,
       then by bar timestamp." 그리고 limit 은 한 페이지 크기이고 <전 종목
       합쳐서> 셉니다. 그러니까 한 종목의 봉이 많으면 첫 페이지를 그 종목
       하나가 다 먹고, 뒤쪽 종목은 <몇 개 적게> 오는 게 아니라 <아예 0개>
       옵니다. 페이지를 끝까지 안 넘기면 그 종목들은 통째로 사라집니다.

       예전 값(코인 5분봉 = 12일)이 딱 그 경우였습니다.
         코인 5분봉 12일 = 3,456봉 × 45종목 = 155,520봉
         페이지 8장 × 9,900 = 79,200봉 → 앞쪽 23종목만 받고 나머지 22종목은 0
       조건이 맞아도 봉이 없으니 후보에 들지도 못했습니다.

    그래서 시장별로 <하루에 몇 봉 나오는지> 를 보고 창을 잡습니다.
    미국은 정규장 6시간 반, 코인은 24시간이라 같은 12일이라도 봉 수가
    여섯 배 넘게 차이 납니다. 이걸 한 표로 쓴 게 화근이었습니다.       */
const BARS_PER_DAY_US: Record<string, number> = {
  "5Min": 78, "15Min": 26, "30Min": 13, "1Hour": 7,
  "4Hour": 2, "1Day": 1, "1Week": 0.2,
};
const BARS_PER_DAY_CC: Record<string, number> = {
  "5Min": 288, "15Min": 96, "30Min": 48, "1Hour": 24,
  "4Hour": 6, "1Day": 1, "1Week": 0.143,
};
//  주식은 주말·공휴일에 안 열려서 달력 날짜로는 1.55배쯤 거슬러 가야 합니다
const CAL_SLACK_US = 1.55;
function barStart(tf: string, crypto?: boolean) {
  const per = (crypto ? BARS_PER_DAY_CC : BARS_PER_DAY_US)[tf] ?? 1;
  const slack = crypto ? 1.15 : CAL_SLACK_US;      // 빈 봉·휴장 여유
  const days = Math.max(1, Math.ceil((MT_BARS / per) * slack));
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}

async function alpBarsUS(symbols: string[], tf: string, from?: string) {
  const out: Record<string, any[]> = {};
  if (!symbols.length) return out;
  const start = from || barStart(tf);
  for (let i = 0; i < symbols.length; i += MT_CHUNK) {
    const chunk = symbols.slice(i, i + MT_CHUNK);
    let token = "";
    //  창을 봉 수에 맞춰 잡아서 보통 1~2장이면 끝납니다. 상한은 <혹시>
    //  를 위한 안전장치입니다 — 여기서 끊기면 뒤쪽 종목이 0개가 됩니다.
    for (let page = 0; page < 20; page++) {
      const d: any = await alpGet(ALP_DATA, "/v2/stocks/bars", {
        symbols: chunk.join(","), timeframe: tf, start: start,
        limit: String(Math.min(ALP_BAR_CAP, MT_BARS * chunk.length)),
        feed: "iex", ...(token ? { page_token: token } : {}),
      }).catch((e) => { console.error("봉 조회 실패", tf, chunk.length + "종목", String(e)); return null; });
      if (!d) break;
      for (const [sym, bars] of Object.entries<any>(d?.bars ?? {})) {
        (out[sym.toUpperCase()] ??= []).push(...(bars ?? []));
      }
      token = String(d?.next_page_token ?? "");
      if (!token) break;
    }
  }
  return out;
}

async function alpBarsCrypto(symbols: string[], tf: string, from?: string) {
  const out: Record<string, any[]> = {};
  if (!symbols.length) return out;
  //  ⚠️ 모양이 안 맞는 심볼 하나가 묶음 전체를 400 으로 만듭니다
  const pairs = symbols.map(alpPair).filter(Boolean) as string[];
  if (!pairs.length) return out;
  const start = from || barStart(tf, true);   //  코인은 24시간 — 창이 훨씬 짧아야 합니다
  //  코인도 같은 한도입니다 — 나눠서 부릅니다
  for (let i = 0; i < pairs.length; i += MT_CHUNK) {
    const chunk = pairs.slice(i, i + MT_CHUNK);
    let token = "";
    for (let page = 0; page < 20; page++) {
      const d: any = await alpGet(ALP_DATA, "/v1beta3/crypto/us/bars", {
        symbols: chunk.join(","), timeframe: tf, start: start,
        limit: String(Math.min(ALP_BAR_CAP, MT_BARS * chunk.length)),
        ...(token ? { page_token: token } : {}),
      }).catch(async (e) => {
        /*  ⚠️ 묶음이 통째로 실패하면 한 종목씩 다시 물어봅니다.
            취급 안 하는 코인 하나 때문에 마흔다섯 개가 0 이 되던 일을
            여기서 막습니다 (스캔이 멈춘 진짜 이유였습니다).           */
        console.warn("코인 봉 묶음 실패 — 한 개씩 다시", tf, String(e));
        if (page > 0) return null;
        const acc: any = { bars: {} };
        for (const one of chunk) {
          const r: any = await alpGet(ALP_DATA, "/v1beta3/crypto/us/bars", {
            symbols: one, timeframe: tf, start: start,
            limit: String(Math.min(ALP_BAR_CAP, MT_BARS)),
          }).catch(() => null);
          if (r?.bars) Object.assign(acc.bars, r.bars);
        }
        return acc;
      });
      if (!d) break;
      for (const [pair, bars] of Object.entries<any>(d?.bars ?? {})) {
        (out[pair.replace("/", "-").toUpperCase()] ??= []).push(...(bars ?? []));
      }
      token = String(d?.next_page_token ?? "");
      if (!token) break;
    }
  }
  return out;
}

//  Alpaca 의 봉을 지표 엔진이 쓰는 모양으로 바꿉니다
//  (엔진은 화면과 같은 {d,v,o,h,l,q} 를 씁니다)
/*  ⚠️ 날짜만 남기면 <하루에 여러 봉> 인 경우 전부 같은 열쇠가 됩니다.
    일봉은 지금까지대로 "2026-09-01", 분·시간봉은 "2026-09-01T13:30"
    까지 남깁니다 (백테스트가 봉 하나하나를 구분해야 하니까요).
    ⚠️ 주말·공휴일은 <없는 봉> 이라 애초에 오지 않습니다. 빈 자리를
       채우지 않고 거래일만 그대로 이어 붙입니다 — 그래야 "20봉 이동평균"
       이 20 거래봉이 됩니다.                                          */
function barsToPts(bars: any[], keepTime?: boolean) {
  return (bars ?? [])
    .map((b: any) => ({ d: keepTime ? String(b.t ?? "").slice(0, 16)
                                    : String(b.t ?? "").slice(0, 10),
                        v: Number(b.c),
                        o: Number(b.o), h: Number(b.h), l: Number(b.l), q: Number(b.v ?? 0) }))
    .filter((p: any) => Number.isFinite(p.v) && p.v > 0);
}

/*  마지막 봉에서 조건이 모두 성립하는가.
    화면의 백테스트와 같은 buildCtx / testRule 을 씁니다.        */
function rulesHit(rules: any[], pts: any[], mode: "all" | "any") {
  if (!rules || !rules.length) return false;
  if (pts.length < 2) return false;
  const ctx = buildCtx(pts, rules);
  const i = pts.length - 1;
  const hits = rules.map((r: any) => testRule(r, ctx, i));
  return mode === "all" ? hits.every(Boolean) : hits.some(Boolean);
}


/*  전략 규칙으로 살 종목을 고릅니다.

    조건식은 화면에서 만든 고정 형식(JSON)입니다. 서버에서 남이 만든
    문자열을 eval 하는 일은 절대 없습니다 — 정해진 지표 이름과 부등호만
    해석합니다.

    ⚠️ 예전에는 이 함수가 조건을 <아예 안 보고> 명단 순서대로 골랐습니다.
       팀이 RSI 40 이하를 걸어도 아무 영향이 없었습니다. 이제 화면의
       백테스트와 같은 엔진으로 마지막 봉에서 조건을 판정합니다.        */
function mtPickByRule(cfg: any, uni: any[], qUS: any, qCC: any, acc: any,
                      barsUS: any, barsCC: any) {
  const picks: any[] = [];
  const mode = String(cfg?.mode ?? "fixed");
  const markets = String(cfg?.markets ?? "both");
  const maxN = Math.max(1, Math.min(20, Number(cfg?.max_positions) || 5));
  const buy = Array.isArray(cfg?.buy) ? cfg.buy : [];

  const held = new Set((acc.positions ?? []).map((p: any) => p.market + "|" + p.symbol));
  const room = Math.max(0, maxN - (acc.positions ?? []).length);
  if (room <= 0) return picks;

  function priceOf(m: string, s: string) {
    if (!autoTradable(m)) return null;             //  국내는 자동매매에서 제외 (실시간이 없습니다)
    if (m === "US") return qUS[s]?.price ?? null;
    if (m === "CRYPTO") return qCC[s]?.price ?? qCC[s + "-USD"]?.price ?? null;
    return null;
  }
  function barsOf(m: string, s: string) {
    if (m === "US") return barsUS[s] ?? null;
    if (m === "CRYPTO") return barsCC[s] ?? barsCC[s + "-USD"] ?? null;
    return null;
  }
  function wantMarket(m: string) {
    if (markets === "both") return true;
    if (markets === "stock") return m === "KR" || m === "US";
    return markets === m;
  }

  const pool = mode === "fixed"
    ? (Array.isArray(cfg?.symbols) ? cfg.symbols : [])
    : uni;

  /*  ⚠️ 여기서 room 개를 채우자마자 멈추면 안 됩니다.

      명단(universe_scan) 이 시장 이름 순서(CRYPTO → KR → US)로 오기
      때문에, 먼저 나온 것부터 담으면 코인이 다섯 자리를 다 채우고
      미국 주식은 조건을 만족해도 차례가 오지 않았습니다.

      그래서 <조건에 맞는 것을 전부 모은 다음> 점수를 매겨 고릅니다.  */
  const cands: any[] = [];
  for (const u of pool) {
    const m = String(u.market ?? "").toUpperCase();
    const sy = String(u.symbol ?? "").toUpperCase();
    if (!wantMarket(m)) continue;
    if (held.has(m + "|" + sy)) continue;          //  이미 들고 있으면 건너뜁니다
    const px = priceOf(m, sy);
    if (!(px > 0)) continue;

    //  ── 여기가 핵심 ── 조건을 모두 만족해야 삽니다
    const pts = barsOf(m, sy);
    if (!pts || pts.length < 2) continue;
    //  지표를 한 번만 계산해 <판정과 점수에 같이> 씁니다.
    //  (rulesHit 를 부르고 또 buildCtx 를 부르면 500종목이면 두 배 일입니다)
    const ctx = buildCtx(pts, buy);
    const last = pts.length - 1;
    if (!buy.length || !buy.every((r: any) => testRule(r, ctx, last))) continue;

    //  조건을 얼마나 넉넉히 만족했는지 (자리보다 후보가 많을 때 씁니다)
    const sc = ruleScore(buy, ctx, last);
    cands.push({ market: m, symbol: sy, name: u.name ?? sy, price: px, score: sc });
  }
  //  fixed 모드는 팀이 종목마다 비중을 손으로 정해둔 것이라 적은 순서를
  //  그대로 지킵니다. scan 모드만 점수로 줄을 세웁니다.
  return mode === "fixed" ? cands.slice(0, room) : rankPicks(cands, room);
}

/*  ── 팔 것 고르기 ────────────────────────────────────────────
    예전에는 <파는 코드가 아예 없었습니다>. 손절 7% · 익절 15% 를
    화면에서 정해도 서버는 한 번 사면 대회 끝까지 들고 있었습니다.

    파는 이유는 셋입니다. 하나라도 걸리면 팝니다.
      · 손절 — 평단 대비 정한 만큼 내려갔을 때
      · 익절 — 평단 대비 정한 만큼 올라갔을 때
      · 매도 조건 — 화면에서 정한 지표 조건 (하나라도 맞으면)         */
function mtPickSells(cfg: any, acc: any, qUS: any, qCC: any, barsUS: any, barsCC: any) {
  const sells: any[] = [];
  const sl = Number(cfg?.sl_pct) || 0;
  const tp = Number(cfg?.tp_pct) || 0;
  const sellRules = Array.isArray(cfg?.sell) ? cfg.sell : [];

  for (const p of (acc.positions ?? [])) {
    if (!autoTradable(p.market)) continue;         //  국내는 자동매매에서 제외
    if (!(p.qty > 0)) continue;
    const sy = String(p.symbol).toUpperCase();
    const px = p.market === "US" ? (qUS[sy]?.price ?? null)
                                 : (qCC[sy]?.price ?? qCC[sy + "-USD"]?.price ?? null);
    if (!(px > 0)) continue;
    const avg = Number(p.avg) || 0;
    const chg = avg > 0 ? (px / avg - 1) * 100 : 0;

    let why = "";
    if (sl > 0 && chg <= -sl) why = `손절 ${sl}%`;
    else if (tp > 0 && chg >= tp) why = `익절 ${tp}%`;
    else if (sellRules.length) {
      const pts = p.market === "US" ? (barsUS[sy] ?? null)
                                    : (barsCC[sy] ?? barsCC[sy + "-USD"] ?? null);
      //  매도 조건은 <하나라도> 걸리면 팝니다 (화면 설명과 같습니다)
      if (pts && rulesHit(sellRules, pts, "any")) why = "매도 조건";
    }
    if (!why) continue;

    //  '지표 매도량' — 전량이 기본입니다
    const pct = Math.max(1, Math.min(100, Number(cfg?.sell_pct) || 100));
    const qty = pct >= 100 ? p.qty : Math.floor(p.qty * pct / 100 * 1e8) / 1e8;
    if (!(qty > 0)) continue;
    sells.push({ market: p.market, symbol: sy, name: p.name ?? sy,
                 qty, price: px, why });
  }
  return sells;
}

/*  ── 왜 안 샀는지 ────────────────────────────────────────────

    "자동매매를 켰는데 하루 종일 한 종목도 안 샀다" 는 말을 들으면,
    지금까지는 코드를 읽으며 짐작하는 수밖에 없었습니다. 막힐 수 있는
    자리가 여덟 군데쯤 되는데 화면에는 "매수 조건에 맞는 종목이
    없었습니다" 한 줄만 나왔기 때문입니다. 그 한 줄로는
      · 장이 닫혀서인지
      · 봉을 못 받아서인지
      · 조건 하나가 너무 빡빡해서인지
      · 돈이 없어서인지
    를 구분할 수 없습니다.

    그래서 매매는 하지 않고 <단계마다 몇 종목이 남았는지> 만 세어
    돌려줍니다. 어디서 0 이 되는지 보면 원인이 한눈에 나옵니다.       */
async function mtWhy(admin: any, teamId: number) {
  alpCallsReset();
  const ct = await mtContest(admin);
  const { data: t } = await admin.from("teams")
    .select("id, name, seed, auto_on, auto_budget, auto_interval, auto_last_at, bar_tf")
    .eq("id", teamId).maybeSingle();
  if (!t) throw new Error("팀을 찾지 못했습니다.");

  const steps: any[] = [];
  const add = (name: string, n: number | null, note = "") =>
    steps.push({ step: name, left: n, note });

  add("대회 진행 중", ct.closed ? 0 : 1, ct.closed ? "대회가 끝났습니다." : "");
  add("자동매매 켜짐", t.auto_on ? 1 : 0,
      t.auto_on ? "" : "자동매매 스위치가 꺼져 있습니다. 켜고 저장하세요.");

  const { data: strats } = await admin.from("strategies")
    .select("id, name, config, effective_from")
    .eq("team_id", teamId)
    .order("effective_from", { ascending: false }).order("id", { ascending: false })
    .limit(1);
  const st = (strats ?? [])[0];
  add("저장된 전략", st ? 1 : 0,
      st ? `"${st.name ?? "전략"}" 이 돕니다.` : "저장된 전략이 없습니다.");
  if (!st) return { team: t.name, steps, at: new Date().toISOString(), api_calls: alpCalls() };

  const cfg = st.config ?? {};
  const buy = Array.isArray(cfg.buy) ? cfg.buy : [];
  const markets = String(cfg.markets ?? "both");
  add("매수 조건", buy.length,
      buy.length ? `${buy.length}개를 <모두> 만족해야 삽니다.` : "매수 조건이 없어 아무것도 안 삽니다.");

  const due = mtDue(t.auto_interval, t.auto_last_at);
  add("지금이 차례", due ? 1 : 0,
      due ? "" : `${t.auto_interval} 간격이라 아직 차례가 아닙니다. 마지막 ${String(t.auto_last_at ?? "").slice(0, 16)}`);

  const clock = await usMarketOpen();
  const { data: uni } = await admin.from("universe").select("market, symbol, name");
  const all = uni ?? [];
  const wantMk = (m: string) => markets === "both" ? true
    : (markets === "stock" ? (m === "KR" || m === "US") : markets === m);
  const inScope = all.filter((u: any) => wantMk(String(u.market).toUpperCase()));
  add("훑을 명단", inScope.length,
      `국내 ${inScope.filter((u: any) => u.market === "KR").length} · `
      + `미국 ${inScope.filter((u: any) => u.market === "US").length} · `
      + `코인 ${inScope.filter((u: any) => u.market === "CRYPTO").length}`);

  /*  ⚠️ 여기서 0 이 되는 경우가 가장 흔합니다. 한국 낮에는 미국 장이
      닫혀 있어서 미국 종목이 통째로 빠집니다. 코인을 안 넣어뒀으면
      훑을 것이 하나도 없습니다.                                       */
  const open = inScope.filter((u: any) =>
    String(u.market).toUpperCase() !== "US" || clock.open);
  add("지금 열려 있는 것", open.length,
      clock.open ? "미국 장이 열려 있습니다."
        : `미국 장이 닫혀 있습니다 (다음 개장 ${String(clock.next).slice(0, 16).replace("T", " ")}). `
          + `한국 낮에는 코인만 볼 수 있습니다.`);
  if (!open.length) return { team: t.name, steps, at: new Date().toISOString(), api_calls: alpCalls() };

  const us = open.filter((u: any) => u.market === "US").map((u: any) => u.symbol);
  const cc = open.filter((u: any) => u.market === "CRYPTO").map((u: any) => u.symbol);
  const [qUS, qCC] = await Promise.all([
    us.length ? alpQuotesUS(us).catch(() => ({})) : Promise.resolve({}),
    cc.length ? alpQuotesCrypto(cc).catch(() => ({})) : Promise.resolve({}),
  ]);
  const priced = open.filter((u: any) => {
    const m = String(u.market).toUpperCase(), sy = String(u.symbol).toUpperCase();
    if (m === "US") return Number((qUS as any)[sy]?.price) > 0;
    if (m === "CRYPTO") return Number((qCC as any)[sy]?.price ?? (qCC as any)[sy + "-USD"]?.price) > 0;
    return false;
  });
  add("시세를 받은 종목", priced.length,
      priced.length ? "" : "Alpaca 에서 시세를 하나도 못 받았습니다 — 키와 요금제를 확인하세요.");

  const tf = mtBarTf(t);
  const [bU, bC] = await Promise.all([
    us.length ? alpBarsUS(us, tf).catch(() => ({})) : Promise.resolve({}),
    cc.length ? alpBarsCrypto(cc, tf).catch(() => ({})) : Promise.resolve({}),
  ]);
  const barsOf = (m: string, sy: string) => m === "US"
    ? barsToPts((bU as any)[sy] ?? [])
    : barsToPts((bC as any)[sy] ?? (bC as any)[sy + "-USD"] ?? []);
  const withBars = priced.filter((u: any) => {
    const p = barsOf(String(u.market).toUpperCase(), String(u.symbol).toUpperCase());
    return p && p.length >= 2;
  });
  add(`봉(${t.bar_tf ?? "1d"})을 받은 종목`, withBars.length,
      withBars.length ? `한 종목당 평균 ${Math.round(
        withBars.reduce((s: number, u: any) => s + barsOf(String(u.market).toUpperCase(),
          String(u.symbol).toUpperCase()).length, 0) / Math.max(1, withBars.length))}개`
      : "봉을 하나도 못 받았습니다 — 조건을 판정할 수가 없습니다. (전략 문제가 아닙니다)");
  if (!withBars.length) return { team: t.name, steps, at: new Date().toISOString(), api_calls: alpCalls() };

  //  ── 조건을 하나씩 따로 세어 봅니다. 어느 조건이 범인인지 나옵니다.
  const perRule: any[] = [];
  for (const r of buy) {
    let n = 0;
    for (const u of withBars) {
      const p = barsOf(String(u.market).toUpperCase(), String(u.symbol).toUpperCase());
      if (rulesHit([r], p, "all")) n++;
    }
    perRule.push({ rule: r, passed: n });
  }
  for (const pr of perRule)
    add(`조건 통과 — ${ruleText(pr.rule)}`, pr.passed,
        pr.passed ? "" : "이 조건이 아무 종목도 통과 못 했습니다.");

  let allHit = 0;
  for (const u of withBars) {
    const p = barsOf(String(u.market).toUpperCase(), String(u.symbol).toUpperCase());
    if (rulesHit(buy, p, "all")) allHit++;
  }
  add("모든 조건을 만족", allHit,
      allHit ? "" : (perRule.every((x) => x.passed > 0)
        ? "조건 하나씩은 통과하는데 <동시에> 만족하는 종목이 없습니다. 조건을 줄여보세요."
        : "위에서 0 인 조건이 범인입니다."));

  const acc = await mtAccount(admin, teamId, ct.fx);
  const held = new Set((acc.positions ?? []).map((p: any) => p.market + "|" + p.symbol));
  const maxN = Math.max(1, Math.min(20, Number(cfg.max_positions) || 5));
  add("이미 안 들고 있는 것", Math.max(0, maxN - (acc.positions ?? []).length),
      `최대 ${maxN}종목까지 · 지금 ${(acc.positions ?? []).length}종목 보유` + (held.size ? "" : ""));
  const room = Math.max(0, Math.min(acc.cash, Number(t.auto_budget) || 0));
  add("쓸 수 있는 돈", Math.round(room),
      room > 0 ? `현금 ${Math.round(acc.cash).toLocaleString("ko-KR")}원 · `
                 + `배정 ${Math.round(Number(t.auto_budget) || 0).toLocaleString("ko-KR")}원`
               : "자동매매 배정 금액이 0 이거나 현금이 없습니다.");

  /*  ⚠️ 마지막 한 칸이 빠져 있었습니다. 위 칸이 전부 0 이 아닌데도
      안 사는 일이 있었는데, 그게 <자리보다 후보가 많아서 줄을 못 선>
      경우였습니다. 명단이 시장 이름 순이라 코인이 자리를 다 채우고
      미국은 차례가 안 왔습니다. 이제 그 줄 세운 결과를 그대로 보여줍니다. */
  const picks = mtPickByRule(cfg, open, qUS as any, qCC as any, acc,
                             barsBy(bU), barsBy(bC));
  add("이번에 살 종목", picks.length,
      picks.length
        ? picks.map((p: any) => `${p.market} ${p.symbol}`).join(" · ")
        : (allHit > 0
            ? "조건은 맞았는데 자리나 돈이 없어 못 삽니다 (위 두 칸을 보세요)."
            : "조건에 맞는 종목이 없습니다."));

  return { team: t.name, bar_tf: t.bar_tf ?? "1d", interval: t.auto_interval,
           us_open: clock.open, steps, api_calls: alpCalls(),
           picks: picks.map((p: any) => ({ market: p.market, symbol: p.symbol,
                                           score: Math.round((p.score ?? 0) * 1000) / 1000 })),
           at: new Date().toISOString() };
}

/*  mtPickByRule 은 {심볼: 봉[]} 을 받습니다. mtWhy 는 Alpaca 응답을
    그대로 들고 있어서 한 번 펴 줍니다.                                */
function barsBy(raw: any) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = barsToPts(v as any[]);
  return out;
}

/*  규칙을 사람이 읽는 말로 (화면과 같은 표현)  */
function ruleText(r: any) {
  const S: Record<string, any> = {
    RSI: "RSI", STOCH: "스토캐스틱", WILLR: "윌리엄스 %R", CCI: "CCI", MFI: "MFI",
    CHANGE: "기간 변동률", STREAK: "연속 상승/하락일",
    VS_SMA: "이격도(SMA)", VS_EMA: "이격도(EMA)", CROSS: "이동평균 교차(SMA)",
    EMA_CROSS: "이동평균 교차(EMA)", MACD: "MACD 히스토그램", MACD_CROSS: "MACD 신호선 교차",
    ADX: "ADX", BB_PCT: "볼린저 %B", BB_WIDTH: "볼린저 밴드폭", ATR_PCT: "ATR 비율",
    VOLAT: "연환산 변동성", VOL_RATIO: "거래량 비율", VS_HIGH: "기간 고점 대비",
    VS_LOW: "기간 저점 대비",
  };
  const nm = S[r?.ind] ?? String(r?.ind ?? "");
  if (r?.op === "golden" || r?.op === "dead")
    return `${nm} ${r.period ?? ""}↔${r.period2 ?? ""} ${r.op === "dead" ? "데드크로스" : "골든크로스"}`;
  return `${r?.period ? r.period + "일 " : ""}${nm} ${r?.op ?? ""} ${r?.value ?? ""}`;
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
    const source = String(body.source ?? "fred").toLowerCase();

    // 여러 종목 한 번에 (유니버스 스캔용)
    /*  ── 백테스트용 봉 (일봉보다 잘게) ────────────────────────

        지금까지 백테스트는 <일봉만> 돌았습니다. 팀이 자동매매를 4시간봉으로
        해두면 같은 「RSI 20」이 백테스트에서는 20일, 실제로는 20개 4시간봉이
        되어 이름만 같지 다른 전략이었습니다.

        브라우저가 종목을 나눠서 여러 번 부릅니다. 한 번에 다 받으면
        Edge Function 메모리(256MB)를 넘깁니다.                          */
    if (source === "bars_bulk") {
      const codes = Array.isArray(body.codes) ? body.codes : [];
      if (!codes.length) return json({ error: "codes 가 비어 있습니다." }, 400);
      if (codes.length > BARS_BULK_MAX)
        return json({ error: `한 번에 ${BARS_BULK_MAX}종목까지입니다.` }, 400);
      const tf = MT_TF[String(body.tf ?? "1d")] ?? null;
      if (!tf) return json({ error: "모르는 봉 기준입니다." }, 400);
      const from = String(body.start ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from))
        return json({ error: "start 는 YYYY-MM-DD 여야 합니다." }, 400);
      const keepTime = tf !== "1Day" && tf !== "1Week";

      const us = codes.filter((c: any) => String(c.market).toUpperCase() === "US")
                      .map((c: any) => String(c.symbol).toUpperCase());
      const cc = codes.filter((c: any) => String(c.market).toUpperCase() === "CRYPTO")
                      .map((c: any) => String(c.symbol).toUpperCase());
      //  국내는 자동매매 대상이 아니라 봉도 받지 않습니다 (autoTradable 참고)
      const [bu, bc] = await Promise.all([
        us.length ? alpBarsUS(us, tf, from).catch(() => ({})) : Promise.resolve({}),
        cc.length ? alpBarsCrypto(cc, tf, from).catch(() => ({})) : Promise.resolve({}),
      ]);
      const series: Record<string, any[]> = {};
      for (const [k, v] of Object.entries(bu)) series["US|" + k] = barsToPts(v as any[], keepTime);
      for (const [k, v] of Object.entries(bc)) series["CRYPTO|" + k] = barsToPts(v as any[], keepTime);
      let pts = 0;
      for (const k of Object.keys(series)) pts += series[k].length;
      return json({ series, tf: String(body.tf), start: from, symbols: codes.length,
                    points: pts, api_calls: alpCalls() });
    }

    if (source === "bulk") {
      const admin0 = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const codes = Array.isArray(body.codes) ? body.codes : [];
      if (!codes.length) return json({ error: "codes 가 비어 있습니다." }, 400);
      const start0 = String(body.start ?? "2024-01-01");
      //  코인도 달러 표시라 환율이 있어야 원화로 환산할 수 있습니다
      if (codes.some((c: any) => {
            const m = String(c.market).toUpperCase();
            return m === "US" || m === "CRYPTO";
          })) {
        await ensureFx(admin0);
      }
      return json(await bulkQuotes(admin0, codes, start0));
    }

    // ── 홈 탭 ──
    if (source === "home_fx")
      return json(await homeFx(Number(body.days ?? 400)));
    if (source === "econ_cal")
      return json(await econCalendar(
        String(body.country ?? "US").toUpperCase(),
        String(body.from ?? shiftDay(todayISO(), -7)),
        String(body.to   ?? shiftDay(todayISO(), 21)),
        Number(body.limit ?? 300)));
    if (source === "earn_cal")
      return json(await earningsCalendar(
        String(body.from ?? todayISO()),
        String(body.to   ?? shiftDay(todayISO(), 14)),
        String(body.symbols ?? "").trim()));

    if (source === "crypto_currencies")
      return json(await cryptoCurrencies());
    if (source === "opt_crypto")
      return json(await cryptoOptions(String(body.code ?? "BTC"), String(body.expiration ?? "")));

    if (source === "opt_status") return json(optStatus());

    // ── 다크풀 (FINRA) ──
    //   공표가 주 단위라 하루 한 번만 새로 받으면 충분합니다.
    if (source === "darkpool" || source === "darkpool_top") {
      const adminD = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const isTop = source === "darkpool_top";
      const key = isTop
        ? String(body.tier ?? "T1").toUpperCase() + "|" + Number(body.limit ?? 60)
        : String(body.code ?? "").trim().toUpperCase() + "|" + Number(body.weeks ?? 26);

      const { data: hitD } = await adminD.from("series_cache")
        .select("payload, fetched_at")
        .eq("source", source).eq("code", key).eq("item_code", "")
        .maybeSingle();
      if (hitD) {
        const ageH = (Date.now() - new Date(hitD.fetched_at).getTime()) / 36e5;
        const pd: any = hitD.payload;
        if (ageH < 24 && pd && (Array.isArray(pd.rows) || Array.isArray(pd.weeks))) {
          return json({ ...pd, cached: true });
        }
      }

      const outD = isTop
        ? await darkpoolTop(String(body.tier ?? "T1").toUpperCase(), Number(body.limit ?? 60))
        : await darkpool(String(body.code ?? ""), Number(body.weeks ?? 26));

      await adminD.from("series_cache").upsert({
        source, code: key, item_code: "",
        fetched_at: new Date().toISOString(), payload: outD,
      });
      return json(outD);
    }

    if (source === "opt_term"){
      //  만기별 IV — Alpaca 는 스냅샷 한 번에 다 오므로 크레딧이 들지 않습니다
      const pv = optProvider(String(body.provider ?? ""));
      const dates = Array.isArray(body.dates) ? body.dates.map(String) : [];
      return json(pv === "alpaca"
        ? await alpacaTerm(String(body.code ?? ""), dates)
        : await optTerm(String(body.code ?? ""), dates));
    }
    if (source === "opt_expirations"){
      const pv = optProvider(String(body.provider ?? ""));
      return json(pv === "alpaca"
        ? await alpacaExpirations(String(body.code ?? ""))
        : { ...(await optExpirations(String(body.code ?? ""))), provider: "md" });
    }
    if (source === "opt_chain"){
      const pv = optProvider(String(body.provider ?? ""));
      //  예전 화면은 strikes(개수) 를 보냈습니다 — 둘 다 받아줍니다
      const pc = Number(body.pct ?? body.strikes ?? 25);
      return json(pv === "alpaca"
        ? await alpacaChain(String(body.code ?? ""), String(body.expiration ?? ""), pc)
        : { ...(await optChain(String(body.code ?? ""), String(body.expiration ?? ""), pc)),
            provider: "md" });
    }

    if (source === "quote_live")
      return json(await liveQuote(String(body.market ?? "US").toUpperCase(),
                                  String(body.code ?? "")));

    /* ── 모의투자 ────────────────────────────────────────────
       체결가는 전부 서버가 정합니다. 화면이 보낸 가격은 안 씁니다.  */
    if (source.startsWith("mt_")) {
      const adminM = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const ctM = await mtContest(adminM);

      //  대회 상태 (남은 시간·고정 환율·내 팀)
      if (source === "mt_contest") return json(ctM);

      //  한 종목 시세 — 주문 화면이 미리 보여주는 값
      if (source === "mt_quote") {
        const mk = String(body.market ?? "US").toUpperCase();
        const q = await mtPrice(adminM, mk, String(body.symbol ?? body.code ?? ""),
                                String(body.name ?? ""));
        return json({ ...q, market: mk, fx: ctM.fx,
                      window: mk === "KR" ? krOrderWindow() : { ok: true, why: "" },
                      //  국내 시세를 어디서 받고 있는지 (화면이 안내에 씁니다)
                      kr_feed: mk === "KR"
                        ? (kisOn() ? "kis" : eodhdOn() ? "eodhd"
                           : pplxOn() ? "pplx" : "close") : null });
      }

      //  팀 계좌 — 보유 종목·현금·손익
      /*  ── 배당 현황 ──
          받은 배당 · 대회 끝까지 들어올 배당 · 그 뒤에 들어올 배당.
          숫자는 SQL(team_dividends) 이 셉니다 — 팀 방 밖의 것은
          RLS 와 in_team 검사에 막혀 아예 안 옵니다.                  */
      if (source === "mt_dividends") {
        const teamId = Number(body.team_id);
        if (!teamId) return json({ error: "팀을 고르지 않았습니다." }, 400);
        const { data, error } = await asUser.rpc("team_dividends", { p_team_id: teamId });
        if (error) return json({ error: error.message }, 400);
        return json({ ...(data ?? {}), kis: kisOn() });
      }

      if (source === "mt_account") {
        /*  ⚠️ 다른 팀 방도 들어가 볼 수 있습니다 (순위표에서 눌러서).
            그때는 «직접/자동» 만 보이고 <이름은 안 나갑니다>.
            같은 팀 팀원과 임원진만 봅니다 (학회장 결정).            */
        const tid = Number(body.team_id);
        const { data: inTeam } = await asUser.rpc("in_team", { p_team_id: tid });
        const { data: offAcc } = await asUser.rpc("is_officer");
        return json(await mtAccount(adminM, tid, ctM.fx, !!inTeam || !!offAcc));
      }

      //  주문
      if (source === "mt_order")
        return json(await mtOrder(adminM, asUser, body));

      //  자동매매 설정 (소속 팀 또는 임원진만)
      if (source === "mt_auto_set") {
        const tid = Number(body.team_id);
        const { data: ok } = await asUser.rpc("in_team", { p_team_id: tid });
        if (!ok) return json({ error: "이 팀의 자동매매를 바꿀 수 없습니다." }, 403);
        const patch: any = {};
        if (body.auto_on !== undefined) patch.auto_on = !!body.auto_on;
        if (body.auto_budget !== undefined)
          patch.auto_budget = Math.max(0, Number(body.auto_budget) || 0);
        if (body.auto_interval !== undefined) {
          const iv = String(body.auto_interval);
          if (!MT_INTERVAL_MIN[iv]) return json({ error: "그런 간격은 없습니다." }, 400);
          patch.auto_interval = iv;
        }
        if (body.bar_tf !== undefined) {
          const bt = String(body.bar_tf);
          if (!MT_TF[bt]) return json({ error: "그런 봉 기준은 없습니다." }, 400);
          patch.bar_tf = bt;
        }
        const { error } = await adminM.from("teams").update(patch).eq("id", tid);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, ...patch });
      }

      //  왜 안 샀는지 — 매매는 안 하고 단계별로 세기만 합니다
      if (source === "mt_why") {
        const tid = Number(body.team_id);
        const { data: ok } = await asUser.rpc("in_team", { p_team_id: tid });
        const { data: off2 } = await asUser.rpc("is_officer");
        if (!ok && !off2) return json({ error: "자기 팀만 볼 수 있습니다." }, 403);
        return json(await mtWhy(adminM, tid));
      }

      //  자동매매 스캔 — 예약 작업(토큰) 또는 임원진이 손으로
      if (source === "mt_scan") {
        const want = secret("WARM_TOKEN");
        let okScan = !!want && String(body.token ?? "") === want;
        if (!okScan) {
          const { data: off } = await asUser.rpc("is_officer");
          okScan = !!off;
        }
        if (!okScan) return json({ error: "자동매매 스캔은 임원진만 돌릴 수 있습니다." }, 403);
        return json(await mtScan(adminM));
      }

      return json({ error: `모르는 모의투자 요청입니다: ${source}` }, 400);
    }

    // 지표 파고들기 — 누구나
    /*  값 없이 '항목 목록만' 먼저 주는 창구.
        표를 펼치는 것만으로도 몇 초 걸리는데, 값까지 다 받고 나서야
        화면을 그리면 그동안 빈 상자만 보입니다. 목록을 먼저 보내
        고르기 시작할 수 있게 합니다.                                  */
    if (source === "fred_items") {
      const adminT = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const tree = await fredTreeCached(adminT, String(body.code ?? ""));
      return json({ release: tree.release, note: tree.note, items: tree.items,
                    counted: 0,
                    total_series: tree.items.filter((x: any) => x.series_id).length,
                    remaining: tree.items.filter((x: any) => x.series_id).length,
                    items_only: true });
    }
    if (source === "fred_tree")
      return json(await fredTree(String(body.code ?? ""), String(body.element_id ?? "")));
    if (source === "fred_report") {
      //  같은 보고서를 학회원 여럿이 보는 일이 잦습니다.
      //  한 번 받아두면 6시간 동안은 FRED 를 다시 부르지 않습니다.
      const adminR = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const rc = String(body.code ?? "");
      /*  캐시 칸을 항목 수(max)로 나누지 않습니다.
          예전에는 max 가 바뀔 때마다 다른 칸에 저장돼서, 이어받아도
          앞서 받아둔 값이 합쳐지지 않았습니다. 발표 하나당 한 칸입니다.  */
      const ck = rc;
      const { data: hit } = await adminR
        .from("series_cache")
        .select("payload, fetched_at")
        .eq("source", "fred_report").eq("code", rc).eq("item_code", REPORT_SCHEMA)
        .maybeSingle();

      const prev: any = hit?.payload ?? null;
      const prevItems: any[] | null = Array.isArray(prev?.items) ? prev.items : null;
      const ageH = hit ? (Date.now() - new Date(hit.fetched_at).getTime()) / 36e5 : 999;

      /*  '언제 받았는가' 가 아니라 '마지막 발표 뒤에 받았는가' 로 판정합니다.
          그래야 발표 당일엔 즉시 갈리고, 발표가 없는 동안은 한 달이든 그대로
          씁니다. 발표일을 모르면 (표 캐시가 아직 없으면) 옛 규칙으로 갑니다.  */
      const got = hit ? String(hit.fetched_at).slice(0, 10) : "";
      const w = prev?.release_dates ? releaseWindow(prev.release_dates) : null;
      const fresh = w && w.last
        ? got >= w.last                      //  마지막 발표 뒤에 받았으면 유효
        : ageH < 6;

      //  다 채워졌고 아직 유효하면 그대로 돌려줍니다
      if (fresh && !body.force && prevItems?.length
          && (prev?.remaining ?? 0) === 0 && (prev?.failed ?? 0) === 0)
        return json({ ...prev, cached: true,
                      valid_until: w?.next || null, last_release: w?.last || null });

      //  이어받기 — 지난번 값 위에 빠진 것만 채웁니다
      //  발표가 새로 났으면 옛 값을 물려받지 않습니다 (전부 다시 받습니다)
      const carry = (body.force || !fresh) ? null : prevItems;
      const rep = await fredReport(rc, adminR, carry);
      if (rep.items?.length) {
        await adminR.from("series_cache").upsert({
          source: "fred_report", code: rc, item_code: REPORT_SCHEMA,
          fetched_at: new Date().toISOString(), payload: rep,
        });
      }
      return json({ ...rep, cache_key: ck, cached: false });
    }
    /*  ── 세부항목 미리 받아두기 ──

        새벽에 크론이 이걸 부릅니다. 한 번에 하나씩만 데우고 끝냅니다 —
        Edge Function 이 오래 못 버티기 때문에, 여러 번 나눠 부르는 쪽이
        안전합니다.

        중요한 설계: '지난 24시간에 발표된 것' 이 아니라
        <b>'캐시가 마지막 발표보다 낡은 것'</b> 을 고릅니다.
        전자로 짜면 어느 날 밤 작업이 한 번 실패했을 때 그 지표가 다음 발표
        때까지 낡은 채로 남습니다 — 아무도 모르게. 후자로 짜면 오늘 밤
        실패해도 내일 밤이 다시 잡습니다. 스스로 복구됩니다.               */
    if (source === "fred_warm") {
      /*  두 가지 방법으로 부를 수 있습니다.

          ① 밤에 도는 스케줄러 — WARM_TOKEN 을 들고 옵니다.
          ② 임원진이 화면에서 직접 — 로그인 세션으로 확인합니다.

          ②가 필요한 이유: 학기를 새로 시작하면 보관함이 통째로 비어 있어서,
          밤마다 한 개씩 데워지길 기다리면 지표를 다 채우는 데 몇 주가
          걸립니다. 임원이 앉아서 한 번에 끝낼 수 있어야 합니다.
          (토큰을 화면에 심으면 학회원 아무나 볼 수 있으니 그건 안 됩니다.)  */
      const key = String(body.token ?? "");
      const want = secret("WARM_TOKEN");
      let okWarm = !!want && key === want;
      if (!okWarm) {
        const { data: isOff } = await asUser.rpc("is_officer");
        okWarm = !!isOff;
      }
      if (!okWarm)
        return json({ error: "예열은 임원진만 실행할 수 있습니다 (또는 예열 토큰이 필요합니다)." }, 403);

      const adminW = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      //  카탈로그 = 캘린더 매핑 표. 화면과 예열이 같은 목록을 봅니다.
      const targets = [...new Set(US_RELEASES.map((r) => r[3]).filter(Boolean))];
      const todayIso = new Date().toISOString().slice(0, 10);
      const checked: any[] = [];
      let picked = "";

      for (const sid of targets) {
        const { data: hit } = await adminW.from("series_cache")
          .select("payload, fetched_at").eq("source", "fred_report")
          .eq("code", sid).eq("item_code", REPORT_SCHEMA).maybeSingle();
        const pl: any = hit?.payload ?? null;
        const got = hit ? String(hit.fetched_at).slice(0, 10) : "";
        const w = pl?.release_dates ? releaseWindow(pl.release_dates) : null;

        /*  ── 왜 다시 받아야 하는가 ────────────────────────────────

            ⚠️ 실제로 터진 버그입니다. 예열이 «14/21» 이었다가 다음 날
               «11/21» 로 내려가고, 21/21 에는 영영 도달하지 않았습니다.

               두 가지가 겹쳐 있었습니다.
               ① 정상 — 밤사이 발표가 난 보고서는 다시 받아야 맞습니다
                  (주간 실업수당은 매주 목요일에 납니다).
               ② 버그 — FRED 가 <발표 일정을 안 주는> 보고서가 섞여
                  있습니다. 예전 조건은
                      (w?.last ? got < w.last : true)
                  이라 일정을 모르면 «항상 다시 받아라» 가 됐습니다.
                  다 채워놨는데도 매번 다시 골라져서, 그 보고서들 때문에
                  <절대 끝나지 않고> FRED 호출만 계속 태웠습니다.

            그래서 일정을 모르면 «며칠 지났는가» 로 판단합니다.
            일정을 알면 예전처럼 <발표일> 로 판단합니다.
            그리고 <왜> 다시 받는지를 화면에 그대로 적어 보냅니다 —
            숫자만 오르내리면 사람이 원인을 짐작할 수밖에 없습니다.      */
        const noSched = !(w?.last);
        const ageD = got
          ? Math.max(0, Math.floor((Date.parse(todayIso) - Date.parse(got)) / 864e5))
          : 999;
        let why = "";
        if (!hit || !pl?.items?.length)            why = "아직 안 받음";
        else if ((pl?.remaining ?? 0) > 0)         why = "덜 채움";
        else if (!noSched && got < String(w!.last)) why = "발표 새로 남";
        else if (noSched && ageD >= WARM_TTL_DAYS) why = `일정 모름 · ${ageD}일 지남`;
        const stale = !!why;

        checked.push({ series: sid, got: got || null,
                       last_release: w?.last || null, next: w?.next || null,
                       no_schedule: noSched, age_days: got ? ageD : null,
                       why: why || null, stale });
        if (stale && !picked) picked = sid;
      }

      if (!picked)
        return json({ done: true, warmed: null, checked,
                      note: "전부 최신입니다. 데울 것이 없습니다.", at: todayIso });

      const tree = await fredTreeCached(adminW, picked);
      const { data: old } = await adminW.from("series_cache")
        .select("payload, fetched_at").eq("source", "fred_report")
        .eq("code", picked).eq("item_code", REPORT_SCHEMA).maybeSingle();
      const oldPl: any = old?.payload ?? null;
      const oldGot = old ? String(old.fetched_at).slice(0, 10) : "";
      const ow = oldPl?.release_dates ? releaseWindow(oldPl.release_dates) : null;
      /*  발표가 새로 났으면 옛 값은 버리고 처음부터.

          ⚠️ 예전에는 «발표일을 아는 경우에만» 이어받았습니다
          (ow?.last && oldGot >= ow.last). 그런데 발표일을 못 받은
          보고서에서는 ow.last 가 null 이라 <매번 통째로 버리고> 처음부터
          받았습니다. 100초 예산 안에 못 끝나는 보고서는 그래서 영영
          안 끝났습니다 — 예열이 12/21 에서 멈춘 또 하나의 이유입니다.

          이제는 <새 발표가 났다는 걸 확실히 알 때만> 버립니다.
          모르면 이어받습니다. 조금 오래된 값이 남는 것이, 영영 못 채우는
          것보다 낫습니다.                                              */
      const fresh = !!(ow?.last && oldGot && oldGot < ow.last);
      const carry = fresh ? null : (oldPl?.items ?? null);

      const rep = await fredReport(picked, adminW, carry);
      if (rep.items?.length) {
        await adminW.from("series_cache").upsert({
          source: "fred_report", code: picked, item_code: REPORT_SCHEMA,
          fetched_at: new Date().toISOString(), payload: rep,
        });
      }
      return json({
        done: false, warmed: picked, release: tree?.release?.name ?? null,
        counted: rep.counted, total: rep.total_series, remaining: rep.remaining,
        valid_until: rep.valid_until, checked, at: todayIso,
        note: rep.remaining > 0
          ? `${picked} 를 ${rep.counted}/${rep.total_series} 까지 채웠습니다. 다음 호출에서 이어받습니다.`
          : `${picked} 를 다 채웠습니다. 다음 발표(${rep.valid_until ?? "미정"})까지 그대로 씁니다.`,
      });
    }

    if (source === "news_feed")
      return json(await newsFeed(String(body.kind ?? "news")));
    if (source === "macro_calendar") {
      const f = String(body.from ?? new Date().toISOString().slice(0, 10));
      const t = String(body.to ?? f);
      /*  달력은 학회원 30명이 홈 탭을 열 때마다 부릅니다. 그때마다
          FRED 를 여러 장씩 넘기면 금세 한도에 닿습니다. 6시간만 담아둡니다
          — 발표 일정은 그 사이에 거의 안 바뀌고, 값(actual)이 늦어져도
          6시간 안에는 따라잡습니다.                                     */
      const adminC = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const ckey = f + "|" + t;
      const { data: hitC } = await adminC.from("series_cache")
        .select("payload, fetched_at")
        .eq("source", "macro_calendar").eq("code", ckey).eq("item_code", "")
        .maybeSingle();
      if (hitC) {
        const ageH = (Date.now() - new Date(hitC.fetched_at).getTime()) / 36e5;
        const pc: any = hitC.payload;
        if (ageH < 6 && pc && Array.isArray(pc.events) && pc.events.length) {
          return json({ ...pc, cached: true });
        }
      }
      const outC = await macroCalendar(f, t);
      if (Array.isArray(outC.events) && outC.events.length) {
        await adminC.from("series_cache").upsert({
          source: "macro_calendar", code: ckey, item_code: "",
          fetched_at: new Date().toISOString(), payload: outC,
        });
      }
      return json(outC);
    }
    if (source === "ecos_report")
      return json(await ecosReport(String(body.code ?? ""), String(body.cycle ?? "M")));
    if (source === "fred_search")
      return json(await fredSearch(String(body.q ?? body.code ?? "")));
    if (source === "ecos_items")
      return json(await ecosItems(String(body.code ?? "")));

    // 거래대금 상위 종목 자동 등록 — 임원진만
    if (["universe_kr", "universe_us", "universe_crypto",
         "backfill_kr", "backfill_us",
         "assets_us", "assets_kr", "assets_crypto"].includes(source)) {
      /*  두 가지 길로 들어옵니다.
            ① 주 1회 도는 예약 작업 — WARM_TOKEN 을 들고 옵니다
            ② 임원진이 화면에서 손으로 누르는 경우
          ①을 열어둬야 명단을 사람이 매주 눌러 갱신하지 않아도 됩니다.  */
      const wantU = secret("WARM_TOKEN");
      let okU = !!wantU && String(body.token ?? "") === wantU;
      if (!okU) {
        const { data: officer } = await asUser.rpc("is_officer");
        okU = !!officer;
      }
      if (!okU) return json({ error: "임원진만 실행할 수 있습니다." }, 403);
      const adminU = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      /*  ⚠️ top:0 은 <자르지 않고 전부> 라는 뜻입니다.
          예전에는 `Number(body.top) || TOP_N` 이라 0 이 거짓값이라서
          조용히 100 으로 바뀌었습니다. 화면은 "S&P500 전 종목" 이라고
          적어놓고 top:0 을 보내는데, 서버는 상위 100개만 등록했습니다.
          목(mock)이 503개를 돌려주는 바람에 시험도 이걸 못 잡았습니다.  */
      const topRaw = Number(body.top ?? TOP_N);
      const topN = !Number.isFinite(topRaw) ? TOP_N
                 : topRaw <= 0 ? 0                       // 0 = 전부
                 : Math.max(10, Math.min(topRaw, 600));
      const days = Math.max(1, Math.min(Number(body.days ?? 10) || 10, 40));
      if (source === "universe_kr") return json(await syncUniverseKR(adminU, topN));
      if (source === "universe_us") return json(await syncUniverseUS(adminU, topN));
      if (source === "universe_crypto")
        return json(await syncUniverseCrypto(adminU, Number(body.top ?? 50) || 50));
      if (source === "assets_us") return json(await syncTradableUS(adminU));
      if (source === "assets_kr") return json(await syncTradableKR(adminU));
      if (source === "assets_crypto") return json(await syncTradableCrypto(adminU));
      if (source === "backfill_kr") return json(await backfillKR(adminU, days));
      return json(await backfillUS(adminU, days));
    }
    const code = String(body.code ?? "").trim();
    const itemCode = String(body.item_code ?? "").trim();
    const cycle = String(body.cycle ?? "M").toUpperCase();
    const start = String(body.start ?? "2015-01-01");

    if (!code) return json({ error: "지표 코드가 비어 있습니다." }, 400);
    const ALLOWED = ["fred", "ecos", "quote_us", "quote_kr", "quote_crypto"];
    if (!ALLOWED.includes(source)) return json({ error: `source 는 ${ALLOWED.join(", ")} 중 하나여야 합니다.` }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 캐시 확인 — 비어 있는 캐시는 무시하고 다시 받아옵니다
    const { data: cached } = await admin
      .from("series_cache")
      .select("payload, fetched_at")
      .eq("source", source).eq("code", code).eq("item_code", itemCode)
      .maybeSingle();

    /*  ── 낡은 캐시를 <버리지 않습니다> ────────────────────────────

        ⚠️ 실제로 생길 수 있는 사고입니다. 캐시는 6시간 뒤 만료되는데,
           학회원 15명이 회의 시간에 <동시에> 매크로 탭을 열면 전원이
           캐시 미스가 되어 각자 FRED 를 부릅니다. 그때 FRED 가 429 를
           주거나 잠깐 죽으면, 6시간 전에 받아둔 멀쩡한 값을 손에 쥐고도
           화면에는 <오류> 만 뜹니다.

        ⚠️ 경제지표는 6시간 만에 바뀌는 물건이 아닙니다. 새로 못 받으면
           마지막으로 받아둔 값을 보여주고, <언제 받은 값인지> 를 같이
           적어 줍니다. 빈 화면보다 낫고, 속이는 것도 아닙니다.          */
    let stale: any = null;
    const todayIso = new Date().toISOString().slice(0, 10);
    if (cached) {
      const ageH = (Date.now() - new Date(cached.fetched_at).getTime()) / 36e5;
      const p: any = cached.payload;
      const usable = p?.start && p.start <= start
                  && Array.isArray(p.points) && p.points.length > 0;

      /*  ── «다음 발표일까지» 그대로 씁니다 ──────────────────────

          ⚠️ 6시간은 근거 없는 숫자였습니다. CPI 는 한 달에 한 번 나오는데
             6시간마다 다시 받았고, 15명이 동시에 열면 그때마다 몰렸습니다.
             경제지표가 바뀌는 순간은 <발표 때> 하나뿐입니다.

          ⚠️ 다만 발표 전후 이틀은 짧은 캐시(6시간)로 돌아갑니다.
             FRED 는 미국 동부시간 아침 8시 30분에 올리는데 우리 서버는
             UTC 로 날짜를 셉니다. 그 시차 때문에 «발표일인데 아직 안 올라온»
             값을 받아 한 달을 들고 있을 수 있습니다. 이틀만 조심하면
             그 사고가 사라지고, 나머지 28일은 그대로 씁니다.            */
      const vu = p?.valid_until, lr = p?.last_release;
      const sinceRel = lr
        ? Math.floor((Date.parse(todayIso) - Date.parse(lr)) / 864e5) : 999;
      if (usable && vu && todayIso < vu && sinceRel >= 2)
        return json({ ...p, cached: true, until: vu });

      /*  ⚠️ 한국은행(ECOS)에는 발표 일정 창구가 없습니다. 대신 <주기> 로
          정합니다 — 월간·분기·연간 지표를 6시간마다 다시 받을 이유가
          없습니다. 일간만 짧게 둡니다.                                  */
      const ttl = (source === "ecos" && cycle !== "D") ? 24 : CACHE_HOURS;
      if (usable && ageH < ttl) return json({ ...p, cached: true });
      if (usable) stale = { p, ageH, at: cached.fetched_at };
    }

    let points: any[];
    let srcNote: string | null = null, srcUnit = "";
    try {
      /*  ⚠️ 같은 지표를 <동시에> 여러 명이 부르면 한 번만 받아 나눠 줍니다.

          회의 시간에 캐시가 만료된 채로 15명이 매크로 탭을 열면, 예전에는
          15명이 각자 FRED 를 불렀습니다. 지표를 4개씩 얹으면 60번입니다 —
          이 인스턴스의 속도 제한(분당 60)에 딱 걸려서, 뒤에 선 사람은
          «자리» 를 기다리느라 화면이 한참 안 떴습니다.

          받아오는 값은 어차피 <똑같습니다>. 먼저 부른 사람의 요청에
          나머지가 얹혀 갑니다 — 15번이 1번이 됩니다.                    */
      const got = await onceKey(
        source + "|" + code + "|" + itemCode + "|" + start,
        async () => {
          if (source === "quote_crypto")
            return { points: await fetchQuoteCrypto(code, start), note: null, unit: "" };
          if (source === "fred")
            return { points: await fetchFred(code, start), note: null, unit: "" };
          if (source === "ecos") {
            const ec = await fetchEcos(code, itemCode, cycle, start);
            return { points: ec.points, note: ec.note, unit: ec.unit };
          }
          if (source === "quote_us")
            return { points: await fetchQuoteUS(code, start), note: null, unit: "" };
          return { points: await fetchQuoteKR(code, start), note: null, unit: "" };
        });
      points = got.points; srcNote = got.note; srcUnit = got.unit;
    } catch (e) {
      //  받아둔 게 있으면 그걸 돌려줍니다 (없으면 그대로 오류를 냅니다)
      if (stale) {
        const hrs = Math.round(stale.ageH);
        return json({
          ...stale.p, cached: true, stale: true, fetched_at: stale.at,
          note: (stale.p.note ? stale.p.note + " · " : "")
              + `지금 새로 받지 못해 <b>${hrs}시간 전에 받아둔 값</b>을 보여줍니다 `
              + `(${String((e as Error).message ?? e).slice(0, 80)}).`,
        });
      }
      throw e;
    }

    // 방어: 배열이 아니면 캐시에 저장하지 않습니다
    if (!Array.isArray(points)) {
      throw new Error("데이터를 받아오지 못했습니다. 함수 코드가 손상되었을 수 있습니다.");
    }
    if (points.length === 0) {
      return json({ source, code, item_code: itemCode, cycle, start, points: [],
                    note: srcNote, cached: false });
    }

    /*  ⚠️ «언제까지 유효한가» 를 값과 함께 담아둡니다. 이게 있어야
        다음에 열 때 «다음 발표까지는 이거 그대로» 를 판단할 수 있습니다.
        일정을 못 알아내면 그냥 비워둡니다 — 그러면 예전처럼 6시간 규칙이
        적용될 뿐, 아무것도 안 깨집니다.                                 */
    let relWin: any = null;
    if (source === "fred") {
      try { relWin = await seriesRelease(admin, code); } catch { relWin = null; }
    }
    const payload: any = { source, code, item_code: itemCode, cycle, start, points,
                           note: srcNote, unit: srcUnit,
                           fetched_on: todayIso,
                           last_release: relWin?.last || null,
                           valid_until: relWin?.next || null };

    await admin.from("series_cache").upsert({
      source, code, item_code: itemCode,
      fetched_at: new Date().toISOString(),
      payload,
    });

    // 원/달러 환율은 FRED 에서 받아 그대로 보관합니다
    if (source === "fred" && code === "DEXKOUS") {
      await upsertFx(admin, points);
    }
    // 미국 주가를 볼 때는 환율도 최신으로 맞춰 둡니다
    // 코인도 달러 표시라 원화 환산이 필요합니다
    if (source === "quote_us" || source === "quote_crypto") {
      await ensureFx(admin);
    }

    if (source === "quote_us" || source === "quote_kr" || source === "quote_crypto") {
      const market = source === "quote_kr" ? "KR"
                   : (source === "quote_crypto" ? "CRYPTO" : "US");
      const recent = points.slice(-40);
      if (recent.length) {
        await admin.from("price_cache").upsert(
          recent.map((p: any) => ({
            market, symbol: code, on_date: p.d, close: p.v,
            name: p.n ?? null, updated_at: new Date().toISOString(),
          })),
          { onConflict: "market,symbol,on_date" },
        );
      }
    }

    return json({ ...payload, cached: false });

  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

// ══════════════════════════════════════════════
//  지표 파고들기 — 지표 안의 세부 항목 찾기
//
//    FRED: 지표 하나를 고르면 그 지표가 실린 '릴리스'의
//          표 구조를 그대로 받아옵니다. CPI 라면
//          전체 → 식료품 → 가정식 → 곡물·육류… 처럼
//          실제 통계표의 계층이 그대로 나옵니다.
//    ECOS: 통계표 안의 항목 목록을 부모-자식으로 엮습니다.
// ══════════════════════════════════════════════

function fredKey() {
  const key = secret("FRED_API_KEY");
  if (!key) throw new Error("FRED_API_KEY 가 설정되지 않았습니다.");
  return key;
}
/*  FRED 는 분당 120회까지만 받아줍니다.

    보고서 한 장이 90번 넘게 부르는데, 학회원 둘이 동시에 열면 바로 넘칩니다.
    넘치면 429 가 오고, 그 항목은 값이 통째로 비어버립니다 — 표 절반이 '—'
    로 나오고 선 차트가 안 그려지던 게 이것 때문이었습니다.
    그래서 한 번에 도는 개수를 묶고, 429 를 만나면 기다렸다 다시 겁니다.      */
/*  ── FRED 는 분당 120번입니다 ──

    예전 코드는 '동시에 4개까지' 만 막았습니다. 그런데 한 번 부르는 데
    0.25초면 4개씩 계속 돌아 분당 900번이 나갑니다 — 제한의 여덟 배입니다.
    그래서 429 를 맞고, 기다렸다 다시 걸고, 또 맞고… 화면이 안 넘어갔습니다.
    '동시 개수' 는 '속도' 가 아닙니다.

    이제 최근 60초 동안 몇 번 걸었는지를 세어 두고, 한도에 닿으면
    가장 오래된 호출이 창 밖으로 나갈 때까지 기다립니다.
    한도는 100 으로 둡니다 — 학회원 여럿이 동시에 눌러도 여유가 있게.     */
/*  한도를 60 으로 낮춥니다.

    이 카운터는 '이 실행 인스턴스' 안에서만 셉니다. Supabase 는 요청이
    몰리면 인스턴스를 여러 개 띄우는데, 각자 100 씩 쓰면 합쳐서 200 이 되어
    FRED 실제 한도(120)를 넘습니다. 인스턴스 두엇이 동시에 돌아도 넘지
    않도록 60 으로 둡니다. 조금 느려지지만 429 를 맞는 것보다 훨씬 낫습니다. */
const FRED_PER_MIN = 60;
const fredHits: number[] = [];

/*  429 를 한 번 맞으면 이 인스턴스의 FRED 호출을 통째로 멈춥니다.

    예전에는 맞은 그 호출만 0.9초 뒤에 다시 걸었습니다. 그런데 429 는
    '분당 한도를 넘었다' 는 뜻이라 0.9초 뒤에도 여전히 넘어 있습니다.
    게다가 동시에 날아간 나머지 호출들이 그대로 벽에 부딪히며 상황을
    악화시켰습니다. 이제 한 번 막히면 모두가 같이 쉽니다.                */
let fredCooldownUntil = 0;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fredSlot() {
  for (;;) {
    const now = Date.now();
    //  ① 막힌 상태면 풀릴 때까지 다 같이 기다립니다
    if (fredCooldownUntil > now) {
      await sleep(Math.min(5_000, fredCooldownUntil - now + 50));
      continue;
    }
    //  ② 최근 60초 창이 찼으면 가장 오래된 호출이 빠질 때까지
    while (fredHits.length && now - fredHits[0] > 60_000) fredHits.shift();
    if (fredHits.length < FRED_PER_MIN) { fredHits.push(now); return; }
    await sleep(Math.max(50, 60_000 - (now - fredHits[0]) + 20));
  }
}

async function fredGet(path: string, params: Record<string, string>, tries = 3): Promise<any> {
  const url = new URL("https://api.stlouisfed.org/fred/" + path);
  url.searchParams.set("api_key", fredKey());
  url.searchParams.set("file_type", "json");
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

  for (let i = 0; i < tries; i++) {
    await fredSlot();                       //  다시 걸 때도 자리를 새로 받습니다
    const r = await fetch(url);
    const text = await r.text();

    if (r.status === 429 || r.status === 503) {
      /*  429 는 '분당 한도를 넘었다' 는 뜻입니다. 1초 뒤에도 여전히 넘어
          있으므로, 창이 실제로 비워질 만큼 쉬어야 합니다.
          FRED 가 Retry-After 를 주면 그 값을 따릅니다.                  */
      const ra = Number(r.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0
        ? Math.min(70_000, ra * 1000)
        : Math.min(70_000, 15_000 * (i + 1));
      fredCooldownUntil = Date.now() + waitMs;   //  이 인스턴스 전체가 같이 쉽니다
      fredHits.length = 0;
      if (i < tries - 1) continue;
      throw new Error("FRED 가 요청을 너무 많이 받았습니다. "
                    + Math.ceil(waitMs / 1000) + "초쯤 뒤에 다시 눌러주세요.");
    }
    let d: any;
    try { d = JSON.parse(text); }
    catch { throw new Error("FRED 응답을 읽지 못했습니다."); }
    if (!r.ok)
      throw new Error(`FRED 오류 (${r.status}): ${d?.error_message ?? text.slice(0, 120)}`);
    return d;
  }
  throw new Error("FRED 조회에 실패했습니다.");
}

/*  표 계층은 한 번만 펼칩니다.

    fredTree 는 표를 펼치느라 최대 60번을 부릅니다. 그런데 이어받기를
    할 때마다 이걸 처음부터 다시 했습니다 — 열 바퀴면 600번을 같은 목록
    다시 만드는 데 씁니다. 발표의 표 구조는 거의 안 바뀌므로 하루 담아둡니다. */
async function fredTreeCached(admin: any, seriesId: string) {
  const key = "tree|" + seriesId;
  try {
    const { data: hit } = await admin.from("series_cache")
      .select("payload, fetched_at")
      .eq("source", "fred_tree").eq("code", seriesId).eq("item_code", TREE_SCHEMA)
      .maybeSingle();
    if (hit?.payload?.items?.length) {
      const ageH = (Date.now() - new Date(hit.fetched_at).getTime()) / 36e5;
      if (ageH < 24) return hit.payload;
    }
  } catch { /* 캐시를 못 읽어도 그냥 새로 만듭니다 */ }

  const tree: any = await fredTree(seriesId);
  //  이 발표가 언제언제 나오는지도 같이 담아둡니다 —
  //  '다음 발표까지 캐시 유효' 규칙이 이 목록으로 돌아갑니다.
  if (tree?.release?.id) tree.release_dates = await releaseDates(String(tree.release.id));
  if (tree.items?.length) {
    try {
      await admin.from("series_cache").upsert({
        source: "fred_tree", code: seriesId, item_code: TREE_SCHEMA,
        fetched_at: new Date().toISOString(), payload: tree,
      });
    } catch { /* 저장 실패는 넘어갑니다 */ }
  }
  return tree;
}

/*  ── 캐시를 언제까지 들고 있어도 되나 ──

    예전에는 '6시간' 이었습니다. 근거 없는 숫자였습니다. CPI 는 한 달에
    한 번 나오는데 6시간마다 300번씩 다시 받았고, 반대로 발표가 막 났는데도
    최대 6시간 동안 지난달 숫자를 보여줄 수 있었습니다. 둘 다 틀렸습니다.

    올바른 규칙은 '다음 발표일까지' 입니다. 그러면 CPI 를 한 달 들고 있는
    것이 도박이 아니라 옳은 일이 되고, 발표 당일에는 즉시 갈립니다.
    주간 지표든 월간이든 분기든, 주기를 우리가 관리할 필요도 없습니다 —
    FRED 가 알려주니까요.                                                */
async function releaseDates(releaseId: string) {
  const p = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 10);
  try {
    const d = await fredGet("release/dates", {
      release_id: releaseId,
      realtime_start: p(-400 * 864e5), realtime_end: p(400 * 864e5),
      include_release_dates_with_no_data: "true",
      sort_order: "asc", limit: "400",
    });
    return (d.release_dates ?? []).map((x: any) => String(x.date)).filter(Boolean);
  } catch { return []; }
}

/*  ── 지표 하나가 «언제까지 유효한가» ─────────────────────────

    ⚠️ 학회장 제안: "한번 받으면 DB 에 저장해뒀다가 다음 발표 때 갱신하면
       되지 않나". 맞습니다 — CPI 는 한 달에 한 번 나오는데 6시간마다
       다시 받을 이유가 없습니다.

    ⚠️ 발표 일정은 <FRED 가 알려줍니다>. 우리가 «CPI 는 매월 둘째 주»
       같은 규칙을 손으로 관리하면 언젠가 틀립니다.

    ⚠️ 일정 자체도 캐시합니다 (source='fred_rel'). 안 그러면 지표를 받을
       때마다 일정 확인에 FRED 를 두 번씩 더 부르게 됩니다.            */
async function seriesRelease(admin: any, seriesId: string) {
  try {
    const { data: hit } = await admin.from("series_cache")
      .select("payload, fetched_at").eq("source", "fred_rel")
      .eq("code", seriesId).eq("item_code", "").maybeSingle();
    if (Array.isArray(hit?.payload?.dates) && hit.payload.dates.length) {
      const ageD = (Date.now() - new Date(hit.fetched_at).getTime()) / 864e5;
      const w = releaseWindow(hit.payload.dates);
      //  일정은 ±400일치를 받아두므로 한 달쯤 재사용해도 안전합니다
      if (w.next && ageD < 30) return w;
    }
  } catch { /* 못 읽으면 새로 알아봅니다 */ }

  try {
    const rel = await fredGet("series/release", { series_id: seriesId });
    const id = String((rel.releases ?? [])[0]?.id ?? "");
    if (!id) return null;
    const dates = await releaseDates(id);
    if (!dates.length) return null;
    try {
      await admin.from("series_cache").upsert({
        source: "fred_rel", code: seriesId, item_code: "",
        fetched_at: new Date().toISOString(), payload: { id, dates },
      });
    } catch { /* 저장 실패는 넘어갑니다 */ }
    return releaseWindow(dates);
  } catch { return null; }
}

//  발표일 목록에서 '가장 최근 발표' 와 '다음 발표' 를 뽑습니다
function releaseWindow(dates: string[]) {
  const t = new Date().toISOString().slice(0, 10);
  let last = "", next = "";
  for (const d of dates ?? []) {
    if (d <= t) { if (d > last) last = d; }
    else if (!next || d < next) next = d;
  }
  return { last, next };
}

//  지표 → 그 지표가 실린 통계표의 계층
async function fredTree(seriesId: string, elementId = "") {
  const rel = await fredGet("series/release", { series_id: seriesId });
  const release = (rel.releases ?? [])[0];
  if (!release) throw new Error(`"${seriesId}" 가 속한 통계표를 찾지 못했습니다.`);
  return await fredTreeByRelease(String(release.id), release.name, elementId);
}

/*  발표 자료의 표를 계층 그대로 펼칩니다.

    FRED 는 한 번에 한 단계만 내려줍니다. CPI 처럼 위쪽이
    "Consumer Price Index by Expenditure Category" 같은 '표 이름' 이면,
    그 element_id 로 다시 물어봐야 비로소 All items · Food · Shelter 같은
    실제 항목이 나옵니다. 예전에는 그 한 번을 더 묻지 않아서
    표 이름 두 줄만 보이고 끝났습니다.                                */
async function fredTreeByRelease(releaseId: string, releaseName: string, elementId = "") {
  const out: any[] = [];
  const seen = new Set<string>();
  let calls = 0;
  //  표를 펼치는 횟수. 30 이면 CPI 처럼 가지가 많은 발표에서 아래쪽이 잘립니다.
  const MAX_CALLS = 60;

  /*  '이 표는 이미 변화율(%)' 인지를 위에서 아래로 물려줍니다.

      BEA 의 PCE 발표에는 이런 표가 섞여 있습니다 —
        Table 2.8.6. "Percent Change from Preceding Period in Real PCE …"
      여기 실린 계열은 값 자체가 이미 '전기 대비 몇 %' 입니다 (0.30, -0.60).
      그런데 그 위에 또 전월 대비 %를 계산하면 (0.30 / -0.60 - 1) × 100 이
      되어 -150%, +300% 같은 값이 나옵니다. 실제로 그렇게 나왔습니다.

      표 이름이 알려주는 정보라, 가지를 펼치면서 자식에게 물려줍니다.     */
  const PCT_TABLE = /percent change|percentage change|contributions to percent/i;
  /*  ⚠️ 발표 표에는 <반기(Semiannual)> 구역이 통째로 딸려 옵니다.
      우리 화면은 기본이 「월간 계열만」 이라 그 항목들은 어차피 가려지고,
      전월 대비도 낼 수 없어 빈칸입니다. 그런데 값은 꼬박꼬박 받아왔습니다 —
      CPI 한 장에 300개가 넘는데 그중 수십 개가 그런 것들이라,
      쓰지도 않을 값을 받느라 FRED 한도를 태우고 기다리게 만들었습니다.
      표 이름이 알려주는 정보이니 가지를 펼치면서 자식에게 물려줍니다.   */
  const SEMI_TABLE = /semiannual|semi-annual/i;

  async function expand(container: any, depth: number, inPct = false, inSemi = false) {
    const kids: any[] = Array.isArray(container?.children)
      ? container.children
      : Object.values(container?.elements ?? {});
    if (!kids.length) return;

    //  같은 표 안에서는 FRED 가 주는 level 이 보고서의 들여쓰기 그대로입니다.
    //  표마다 level 시작값이 달라서, 그 표의 최소값을 기준으로 맞춰줍니다.
    const lv = kids.map((c) => Number(c?.level) || 1);
    const base = Math.min(...lv);

    for (const c of kids) {
      const myDepth = depth + (Number(c?.level) || 1) - base;
      const cname = String(c?.name ?? "").trim();
      const myPct  = inPct  || PCT_TABLE.test(cname);
      const mySemi = inSemi || SEMI_TABLE.test(cname);
      const key = String(c?.series_id || ("E" + c?.element_id));
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          element_id: c?.element_id ?? null,
          name: cname,
          series_id: c?.series_id ?? null,
          level: Math.max(1, myDepth),
          line: c?.line ?? "",
          type: c?.type ?? "",
          pct: myPct,                 //  이미 변화율인 표에 속하는가
          semi: mySemi,               //  반기 표에 속하는가 (값을 안 받습니다)
          has_children: (c?.children ?? []).length > 0,
        });
      }

      if ((c?.children ?? []).length) {
        await expand(c, myDepth + 1, myPct, mySemi);
      } else if (!c?.series_id && c?.element_id && calls < MAX_CALLS && depth < 4) {
        //  아직 항목이 안 나온 '표 이름' 이면 한 단계 더 들어갑니다
        calls++;
        try {
          const sub = await fredGet("release/tables",
            { release_id: releaseId, element_id: String(c.element_id) });
          await expand(sub, myDepth + 1, myPct, mySemi);
        } catch { /* 못 열면 그 가지만 건너뜁니다 */ }
      }
    }
  }

  const root = await fredGet("release/tables",
    { release_id: releaseId, element_id: elementId });
  await expand(root, 1);

  let items = out.filter((x) => x.name);
  let note: string | null = null;

  //  계층 표가 아예 없는 발표도 있습니다 (한 줄짜리 통계).
  //  그때는 같은 발표에 실린 지표를 인기순으로 늘어놓습니다.
  if (!items.some((x) => x.series_id)) {
    try {
      const rs = await fredGet("release/series", {
        release_id: releaseId, limit: "200",
        order_by: "popularity", sort_order: "desc",
      });
      const alt = (rs.seriess ?? []).map((x: any) => ({
        element_id: null, name: x.title, series_id: x.id,
        level: 1, line: "", type: "series", has_children: false,
      }));
      if (alt.length) {
        items = alt;
        note = `"${releaseName}" 에는 계층 표가 없어서, 같은 발표에 실린 지표를 `
             + `인기순으로 늘어놓았습니다.`;
      }
    } catch { /* 이것마저 안 되면 빈 목록 그대로 */ }
  }

  return {
    release: { id: releaseId, name: releaseName },
    root: { element_id: elementId || null, name: releaseName },
    items: items.slice(0, 1200),
    note,
  };
}

/* ── 보고서 한 장 만들기 ─────────────────────────────────────────

     항목 목록만 주면 "그래서 이번 달에 뭐가 올랐는데?" 에 답을 못 합니다.
     그래서 항목마다 최근 값·전월 대비·전년 대비를 서버에서 한꺼번에
     계산해 돌려줍니다. 브라우저가 60번 왕복하지 않아도 됩니다.        */

function pctChange(now: number, before: number) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return (now - before) / Math.abs(before) * 100;
}

//  관측치 사이 간격으로 주기를 알아냅니다 (월·분기·연·일)
function stepPerYear(obs: { d: string; v: number }[]) {
  if (obs.length < 3) return 12;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(obs.length, 6); i++) {
    gaps.push(Math.abs(Date.parse(obs[i - 1].d) - Date.parse(obs[i].d)) / 864e5);
  }
  gaps.sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  if (g > 200) return 1;        // 연
  if (g > 60) return 4;         // 분기
  if (g > 20) return 12;        // 월
  if (g > 5) return 52;         // 주
  return 252;                   // 일(영업일)
}

async function fredSeriesTail(id: string, n = 30) {
  const d = await fredGet("series/observations", {
    series_id: id, sort_order: "desc", limit: String(n),
  });
  //  내림차순으로 왔으니 뒤집어 오래된 것부터 둡니다
  const obs = (d.observations ?? [])
    .map((o: any) => ({ d: String(o.date), v: Number(o.value) }))
    .filter((o: any) => Number.isFinite(o.v))
    .reverse();
  return obs as { d: string; v: number }[];
}

/*  ── 한 번에 다 못 받으면 이어받습니다 ──

    FRED 는 1분에 120번까지만 받아줍니다. 항목이 300개인 발표를 한 번에
    부르면 중간부터 막혀서 값이 빈 줄이 생깁니다. 예전에는 그래서 앞에서
    60개만 계산하고 "나머지는 안 했습니다" 라고 적어두고 끝냈습니다.

    이제는 한 번에 REPORT_ROUND 개씩 받고, 받아둔 값을 캐시에 합쳐 둡니다.
    화면은 남은 개수가 0 이 될 때까지 자동으로 다시 부릅니다 —
    몇 번 왕복하면 결국 전부 채워집니다.                                */
/*  한 번에 도는 시간을 재서 끊습니다.

    분당 100번이면 120개를 채우는 데 72초가 걸립니다. Edge Function 은
    그렇게 오래 못 버팁니다 — 중간에 끊기면 그 라운드가 통째로 날아갑니다.
    그래서 개수가 아니라 '45초' 로 끊고, 받은 만큼 저장한 뒤 남은 개수를
    알려줍니다. 화면이 이어서 부릅니다.                                   */
//  Supabase 무료 플랜은 한 번에 150초까지 버팁니다. 분당 60번이면
//  100초에 100개쯤 처리됩니다. 여유를 두고 100초로 잡습니다.
const REPORT_BUDGET_MS = 100_000;
const REPORT_MAX = 400;

async function fredReport(seriesId: string, admin: any, prevItems: any[] | null = null) {
  const started = Date.now();
  const tree = await fredTreeCached(admin, seriesId);
  const all = tree.items.filter((x: any) => x.series_id);

  //  지난번에 받아둔 값을 먼저 깔아둡니다
  const vals: Record<string, any> = {};
  /*  ⚠️ 「받아봤지만 값이 없는」 항목을 따로 기억합니다.

      실제로 겪은 버그: 예열이 12/21 에서 영영 안 올라갔습니다.
      원인은 FRED 에 관측치가 1개 이하인(중단됐거나 아직 발표 전인) 계열이
      섞여 있어서입니다. 그런 계열은 obs.length < 2 로 걸러져 vals 에 안
      들어가는데, 다음 호출에서 «아직 안 받은 것» 으로 또 골라집니다.
      → 같은 9개를 무한히 다시 받으러 가고, counted 는 12 에서 멈춥니다.

      그래서 <못 받았다는 사실 자체를> 기록해 다음부터 건너뜁니다.
      그리고 분모(total)에서도 빼야 «21개 중 12개» 가 아니라
      «12개 중 12개 · 못 받는 것 9개» 로 정확히 끝납니다.               */
  const dead: Record<string, string> = {};
  if (Array.isArray(prevItems)) {
    for (const p of prevItems) {
      if (!p?.series_id) continue;
      if (p.value != null) {
        vals[p.series_id] = { value: p.value, on: p.on, mom: p.mom,
                              yoy: p.yoy, q3: p.q3, m6: p.m6, m9: p.m9,
                              per: p.per, diff: p.diff };
      } else if (p.no_data) {
        dead[p.series_id] = String(p.no_data);
      }
    }
  }

  /*  반기 구역은 값을 안 받습니다.
      화면 기본이 「월간 계열만」 이라 어차피 가려지고, 전월 대비도
      낼 수 없어 빈칸입니다. 안 쓸 값을 받느라 FRED 한도를 태울 이유가
      없습니다 — CPI 한 장이 300개가 넘는데 그중 수십 개가 이것입니다.  */
  const semiSkipped = all.filter((r: any) => r.semi).length;
  const rows = all
    .filter((r: any) => !r.semi)
    .filter((r: any) => vals[r.series_id] === undefined)
    //  ⚠️ 이 한 줄이 «12/21 에서 안 올라가는» 문제를 끊습니다
    .filter((r: any) => dead[r.series_id] === undefined)
    .slice(0, REPORT_MAX);

  let failed = 0, done = 0;
  const CHUNK = 4;
  for (let i = 0; i < rows.length; i += CHUNK) {
    //  시간이 다 되면 여기까지만 하고 돌려줍니다 (받은 값은 캐시에 남습니다)
    if (Date.now() - started > REPORT_BUDGET_MS) break;
    done = i + CHUNK;
    await Promise.all(rows.slice(i, i + CHUNK).map(async (r: any) => {
      try {
        const obs = await fredSeriesTail(r.series_id, 30);
        /*  ⚠️ 관측치가 1개 이하면 <이 계열에는 쓸 값이 없습니다>.
            중단된 계열이거나 아직 첫 발표 전입니다. FRED 가 잠시 막은 것과
            달리 다시 불러도 똑같으므로, «못 받는다» 고 적어두고 넘어갑니다.
            (막힌 경우는 아래 catch 로 가고, 거기서는 안 적어둡니다 —
             다음 호출에서 다시 시도해야 하니까요.)                      */
        if (obs.length < 2) {
          dead[r.series_id] = obs.length === 0 ? "관측치 없음" : "관측치 1개";
          return;
        }
        const per = stepPerYear(obs);
        const last = obs[obs.length - 1];
        const prev = obs[obs.length - 2];
        /*  '몇 개월 전과 견줄까' 를 화면에서 고를 수 있게 여러 구간을 같이 냅니다.
            예전에는 전년 대비 하나뿐이라 '많이 변한 항목 자동 선택' 이
            1년 기준으로만 골랐습니다. 최근 3개월에 튄 항목은 못 잡았습니다.   */
        /*  ⚠️ 주기가 다른 항목을 같은 자로 재면 안 됩니다.

            CPI 발표 표에는 월간 계열 말고 '반기(Semiannual)' 계열도 섞여
            있습니다. 그런데 예전에는 마지막 관측치와 그 앞 관측치를 그냥
            빼서 '전월 대비' 라고 적었습니다. 반기 계열에서 그 둘의 간격은
            6개월이라, 반년치 변화가 '전월 대비 +18.5%' 로 찍혔습니다.
            그러다 보니 '많이 변한 항목 자동 선택' 을 누르면 반기 항목이
            윗자리를 다 차지했습니다 — 값이 커서가 아니라 자를 잘못 대서.

            규칙: N개월 전과 견주려면 그 계열에 N개월 안에 관측치가 하나는
            있어야 합니다. 반기 계열(연 2회)에 '전월 대비' 는 존재하지
            않으므로 빈칸으로 둡니다. 틀린 숫자보다 빈칸이 낫습니다.       */
        /*  ⚠️ '몇 % 변했나' 를 쓸 수 있는 계열인지 먼저 봅니다.

            비율(ratio)은 밑이 양수일 때만 뜻이 있습니다. 값이 0 이거나
            음수를 오가는 계열에 (지금/직전 − 1) × 100 을 하면
            −150%, +300% 같은 숫자가 나옵니다. 나눗셈이 틀린 게 아니라
            애초에 나눌 수 없는 값을 나눈 것입니다.

            이런 계열 — 이미 '전기 대비 %' 로 나오는 표(BEA PCE 2.8.6 등),
            금리차, 순수출처럼 0 을 넘나드는 것 — 은 <b>차이</b>로 냅니다.
            0.30 에서 −0.10 이 되었으면 '−0.40%p' 라고 적는 것이 맞습니다.  */
        const anyNonPos = obs.some((o) => !(o.v > 0));
        const useDiff = r.pct === true || anyNonPos;

        const back = (months: number) => {
          const steps = per * months / 12;          //  N개월이 몇 관측치인가
          if (steps < 0.75) return null;            //  한 걸음도 안 되면 잴 수 없습니다
          const k = Math.max(1, Math.round(steps));
          const o = obs[obs.length - 1 - k];
          if (!o) return null;
          return useDiff ? (last.v - o.v) : pctChange(last.v, o.v);
        };
        vals[r.series_id] = {
          value: last.v, on: last.d,
          //  '전월 대비' 는 월간(연 12회) 이상인 계열에만 있습니다
          mom: per >= 11 ? (useDiff ? (last.v - prev.v) : pctChange(last.v, prev.v)) : null,
          q3: back(3), m6: back(6), m9: back(9),
          yoy: back(12),
          per,
          //  화면이 '%' 로 적을지 '차이' 로 적을지 알 수 있게 표시해 보냅니다
          diff: useDiff,
        };
      } catch { failed++; /* 한 항목이 실패해도 보고서 전체를 막지 않습니다 */ }
    }));
  }

  /*  진행률(68/306)은 <실제로 받을 수 있는 것> 을 세야 맞습니다.
      ⚠️ 분모에서 빼야 하는 것이 둘입니다 —
         ① 안 받기로 한 반기 항목 (semiSkipped)
         ② FRED 에 값이 없는 항목 (dead)
      ②를 안 빼서 예열이 12/21 에서 영영 안 끝났습니다.                */
  const deadN = Object.keys(dead).length;
  const total = Math.max(0, all.length - semiSkipped - deadN);
  const counted = Object.keys(vals).length;
  const remaining = Math.max(0, total - counted);
  let note = tree.note;
  if (remaining > 0)
    note = (note ? note + " " : "")
         + `${total}개 중 ${counted}개까지 받았습니다. 나머지 ${remaining}개를 이어받는 중입니다.`;
  if (deadN > 0)
    note = (note ? note + " " : "")
         + `${deadN}개 항목은 FRED 에 값이 없어(중단됐거나 아직 발표 전) 건너뜁니다.`;
  else if (failed > 0)
    note = (note ? note + " " : "")
         + `${failed}개 항목은 값을 받지 못했습니다 (FRED 가 잠시 막았을 수 있습니다). `
         + `다시 눌러보면 채워집니다.`;

  if (semiSkipped > 0)
    note = (note ? note + " " : "")
         + `반기(Semiannual) 항목 ${semiSkipped}개는 값을 받지 않았습니다 — `
         + `전월 대비를 낼 수 없어 화면에서도 가려지는 항목입니다.`;

  return {
    release: tree.release,
    note,
    items: tree.items.map((x: any) => ({
      ...x, ...(x.series_id && vals[x.series_id] ? vals[x.series_id] : {}),
      //  ⚠️ 이 표시가 payload 에 실려야 다음 호출이 «또 받으러 가지» 않습니다
      ...(x.series_id && dead[x.series_id] ? { no_data: dead[x.series_id] } : {}),
    })),
    semi_skipped: semiSkipped, no_data_count: deadN,
    counted, failed, total_series: total,
    asked: Math.min(done, rows.length), remaining,
    release_dates: tree.release_dates ?? [],
    ...(function(){ const w = releaseWindow(tree.release_dates ?? []);
                    return { last_release: w.last || null, valid_until: w.next || null }; })(),
    took_ms: Date.now() - started,
  };
}

/*  한국은행은 통계표 하나를 통째로 부르면 모든 항목이 한 번에 옵니다.
    그래서 항목마다 따로 부를 필요가 없습니다 — 호출 한 번이면 끝입니다. */
async function ecosReport(statCode: string, cycle = "M") {
  const key = secret("ECOS_API_KEY");
  if (!key) throw new Error("ECOS_API_KEY 가 설정되지 않았습니다.");

  const cy = (cycle || "M").toUpperCase();
  const back = cy === "D" ? 200 : (cy === "Q" ? 8 * 365 : (cy === "A" ? 12 * 365 : 4 * 365));
  const s0 = ecosDate(new Date(Date.now() - back * 864e5).toISOString().slice(0, 10), cy);
  const e0 = ecosDate(new Date().toISOString().slice(0, 10), cy);

  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/100000/`
            + `${statCode}/${cy}/${s0}/${e0}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (d?.RESULT?.CODE) throw new Error(`한국은행 ECOS: ${d.RESULT.MESSAGE ?? d.RESULT.CODE}`);
  const rows = d?.StatisticSearch?.row ?? [];
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("해당 통계표에서 값을 받지 못했습니다. 주기(월·분기·연)를 바꿔보세요.");

  const per = cy === "M" ? 12 : (cy === "Q" ? 4 : (cy === "A" ? 1 : 250));
  const by: Record<string, any> = {};
  for (const o of rows) {
    const code = [o.ITEM_CODE1, o.ITEM_CODE2, o.ITEM_CODE3, o.ITEM_CODE4]
      .filter(Boolean).join("/");
    const name = [o.ITEM_NAME1, o.ITEM_NAME2, o.ITEM_NAME3, o.ITEM_NAME4]
      .filter(Boolean).join(" · ");
    const v = Number(o.DATA_VALUE);
    if (!Number.isFinite(v)) continue;
    const g = by[code] || (by[code] = { code, name, unit: o.UNIT_NAME ?? "", obs: [] });
    g.obs.push({ d: ecosToIso(String(o.TIME)), v });
  }

  const items = Object.values(by).map((g: any) => {
    g.obs.sort((a: any, b: any) => a.d.localeCompare(b.d));
    const last = g.obs[g.obs.length - 1];
    const prev = g.obs[g.obs.length - 2];
    const yr = g.obs[g.obs.length - 1 - per];
    const q = g.obs[g.obs.length - 1 - Math.max(1, Math.round(per / 4))];
    return {
      element_id: null, series_id: null,
      item: g.code, name: g.name, unit: g.unit,
      level: 1, type: "series", has_children: false,
      value: last ? last.v : null, on: last ? last.d : null,
      mom: prev ? pctChange(last.v, prev.v) : null,
      yoy: yr ? pctChange(last.v, yr.v) : null,
      q3: q ? pctChange(last.v, q.v) : null,
      m6: (function(){ const o = g.obs[g.obs.length - 1 - Math.max(1, Math.round(per / 2))];
                       return o ? pctChange(last.v, o.v) : null; })(),
      m9: (function(){ const o = g.obs[g.obs.length - 1 - Math.max(1, Math.round(per * 3 / 4))];
                       return o ? pctChange(last.v, o.v) : null; })(),
      per,
    };
  }).sort((a: any, b: any) => String(a.item).localeCompare(String(b.item)));

  return {
    release: { id: statCode, name: "한국은행 " + statCode },
    items, note: null, cycle: cy,
    counted: items.length, total_series: items.length,
  };
}

//  자유 검색 — 카탈로그에 없는 지표도 찾아 씁니다
async function fredSearch(q: string) {
  const d = await fredGet("series/search", {
    search_text: q, limit: "40",
    order_by: "popularity", sort_order: "desc",
  });
  return {
    items: (d.seriess ?? []).map((s: any) => ({
      series_id: s.id, name: s.title,
      freq: s.frequency_short, unit: s.units_short,
      sa: s.seasonal_adjustment_short,
      start: s.observation_start, end: s.observation_end,
      popularity: s.popularity,
    })),
  };
}

//  ECOS 통계표 안의 항목 목록 (부모-자식으로 엮어서)
async function ecosItems(statCode: string) {
  const key = secret("ECOS_API_KEY");
  if (!key) throw new Error("ECOS_API_KEY 가 설정되지 않았습니다.");
  const url = `https://ecos.bok.or.kr/api/StatisticItemList/${encodeURIComponent(key)}`
            + `/json/kr/1/1000/${encodeURIComponent(statCode)}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  //  ECOS 는 오류도 200 으로 돌려줍니다 — RESULT 를 먼저 봅니다
  if (d?.RESULT) throw new Error(`한국은행 ECOS: ${d.RESULT.MESSAGE ?? d.RESULT.CODE}`);
  const rows = d?.StatisticItemList?.row ?? [];
  if (!rows.length) throw new Error("해당 통계표의 항목을 찾지 못했습니다.");

  //  GRP_CODE 는 서로 다른 '축' 입니다 (항목 / 지역 / 단위 …).
  //  같은 축 안에서만 부모-자식이 성립합니다.
  const groups: Record<string, any[]> = {};
  for (const x of rows) {
    const g = String(x.GRP_CODE ?? "1");
    (groups[g] = groups[g] || []).push({
      code: x.ITEM_CODE, name: x.ITEM_NAME,
      parent: x.P_ITEM_CODE || null, group: g, group_name: x.GRP_NAME ?? "",
      cycle: x.CYCLE, unit: x.UNIT_NAME ?? "",
      start: x.START_TIME, end: x.END_TIME, count: Number(x.DATA_CNT ?? 0),
      weight: x.WEIGHT ?? null,
    });
  }
  //  깊이를 계산해서 화면에서 들여쓰기할 수 있게 합니다
  Object.values(groups).forEach((list) => {
    const byCode: Record<string, any> = {};
    list.forEach((x) => { byCode[x.code] = x; });
    list.forEach((x) => {
      let d2 = 0, cur = x;
      while (cur.parent && byCode[cur.parent] && d2 < 8) { cur = byCode[cur.parent]; d2++; }
      x.level = d2 + 1;
    });
  });

  return { stat_code: statCode, groups: Object.keys(groups).map((g) => ({
    group: g, name: groups[g][0]?.group_name ?? g, items: groups[g],
  })) };
}

// ══════════════════════════════════════════════
//  파생상품 (옵션) — MarketData.app
//
//   과금이 '호출당' 이 아니라 '계약당' 입니다.
//   SPX 전체 체인은 계약이 2만 개가 넘어서 한 번에 하루치 크레딧을
//   다 씁니다. 그래서 반드시 만기 하나 · 등가격 주변으로 좁혀서
//   받아옵니다. 몇 개를 썼는지도 같이 돌려줍니다.
// ══════════════════════════════════════════════

const MD = "https://api.marketdata.app/v1";

function mdKey() {
  const k = secret("MARKETDATA_API_KEY");
  if (!k) throw new Error(
    "MARKETDATA_API_KEY 가 없습니다. marketdata.app 에서 발급 후 Secrets 에 넣어주세요.");
  return k;
}
async function mdGet(path: string, params: Record<string, string>) {
  const url = new URL(MD + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${mdKey()}` } });
  const text = await r.text();
  let d: any;
  try { d = JSON.parse(text); }
  catch { throw new Error("옵션 응답을 읽지 못했습니다."); }
  if (d?.s === "no_data") return null;
  if (!r.ok || d?.s === "error") {
    throw new Error(`옵션 조회 실패 (${r.status}): ${d?.errmsg ?? text.slice(0, 120)}`);
  }
  return d;
}

//  만기 목록 — 1 크레딧
async function optExpirations(symbol: string) {
  const d = await mdGet(`/options/expirations/${encodeURIComponent(symbol.toUpperCase())}/`, {});
  const list = (d?.expirations ?? []) as string[];
  const today = new Date().toISOString().slice(0, 10);
  const out = list.filter((x) => x >= today).slice(0, 24).map((x) => ({
    date: x,
    dte: Math.round((Date.parse(x + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5),
  }));
  return { symbol: symbol.toUpperCase(), expirations: out };
}

/*  체인 — 계약 하나가 1 크레딧이라 등가격 주변만 받습니다.

    화면에서는 '현재가 ±몇 %' 로 고릅니다. MarketData 는 행사가 개수로만
    좁힐 수 있어서, 퍼센트를 대략의 개수로 옮겨 씁니다 (넓게 잡을수록
    크레딧이 더 나갑니다). Alpaca 는 퍼센트를 그대로 씁니다.              */
async function optChain(symbol: string, expiration: string, pct = 25) {
  const sym = symbol.toUpperCase();
  const p = Math.max(1, Math.min(pct || 25, 100));
  //  ±10%→10개, ±25%→20개, ±50%→32개, ±100%→50개 정도로 잡습니다
  const want = Math.round(Math.min(50, Math.max(6, 4 + p * 0.5)));
  const d = await mdGet(`/options/chain/${encodeURIComponent(sym)}/`, {
    expiration: expiration,
    range: "all",
    strikeLimit: String(want),
  });
  if (!d) return { symbol: sym, expiration, rows: [], note: "해당 만기의 자료가 없습니다." };

  //  응답이 '열 단위 배열' 이라 행으로 돌려세웁니다
  const n = (d.optionSymbol ?? []).length;
  const col = (k: string) => (d[k] ?? []) as any[];
  const rows: any[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      code: col("optionSymbol")[i],
      side: col("side")[i],
      strike: Number(col("strike")[i]),
      bid: Number(col("bid")[i]), ask: Number(col("ask")[i]),
      mid: Number(col("mid")[i]), last: Number(col("last")[i]),
      volume: Number(col("volume")[i] ?? 0),
      oi: Number(col("openInterest")[i] ?? 0),
      iv: Number(col("iv")[i]),
      delta: Number(col("delta")[i]), gamma: Number(col("gamma")[i]),
      theta: Number(col("theta")[i]), vega: Number(col("vega")[i]),
      itm: !!col("inTheMoney")[i],
      intrinsic: Number(col("intrinsicValue")[i]),
      extrinsic: Number(col("extrinsicValue")[i]),
    });
  }
  const spot = Number((col("underlyingPrice")[0] ?? 0));
  const dte = Number((col("dte")[0] ?? 0));

  return { symbol: sym, expiration, spot, dte, rows,
           credits: n,
           note: n ? null : "해당 만기의 자료가 없습니다." };
}

//  만기별 등가격 IV — 만기 하나당 행사가 1개(콜·풋 2계약)만 받습니다.
//  6개 만기여도 12크레딧이라 체인 한 번보다 훨씬 쌉니다.
async function optTerm(symbol: string, dates: string[]) {
  const sym = symbol.toUpperCase();
  const use = dates.slice(0, 8);
  const out: any[] = [];
  let credits = 0, spot = 0;
  const today = Date.now();

  for (const e of use) {
    let d: any = null;
    try { d = await mdGet(`/options/chain/${encodeURIComponent(sym)}/`,
                          { expiration: e, range: "all", strikeLimit: "1" }); }
    catch { continue; }
    if (!d) continue;
    const n = (d.optionSymbol ?? []).length;
    credits += n;
    const ivs = (d.iv ?? []).map(Number).filter((v: number) => Number.isFinite(v) && v > 0);
    if (!ivs.length) continue;
    const up = Number((d.underlyingPrice ?? [])[0]);
    if (Number.isFinite(up) && up > 0) spot = up;
    out.push({
      date: e,
      dte: Math.round((Date.parse(e + "T00:00:00Z") - today) / 864e5),
      iv: ivs.reduce((a: number, b: number) => a + b, 0) / ivs.length,
      strike: Number((d.strike ?? [])[0]) || null,
    });
  }
  return { symbol: sym, spot, term: out, credits };
}

// ══════════════════════════════════════════════
//  코인 옵션 (Deribit) — 무료 · 인증 없음
//
//   한 번 부르면 BTC/ETH 전체 체인이 옵니다.
//   다만 그릭스는 안 주고 내재변동성(mark_iv)만 줍니다.
//   그래서 블랙-숄즈로 여기서 직접 계산합니다 —
//   공짜라서만이 아니라, 학회원이 '어디서 나온 숫자인지'
//   알 수 있다는 점에서도 낫습니다.
// ══════════════════════════════════════════════

//  표준정규 누적분포 — Abramowitz & Stegun 7.1.26
function normCdf(x: number) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                  - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

//  블랙-숄즈 그릭스. r 은 0 으로 둡니다 (코인은 무위험이자 개념이 흐릿합니다).
function bsGreeks(S: number, K: number, T: number, vol: number, isCall: boolean, r = 0) {
  if (!(S > 0 && K > 0 && T > 0 && vol > 0)) return null;
  const sT = vol * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + vol * vol / 2) * T) / sT;
  const d2 = d1 - sT;
  const nd1 = normCdf(d1), nd2 = normCdf(d2), pd1 = normPdf(d1);
  const disc = Math.exp(-r * T);
  return {
    delta: isCall ? nd1 : nd1 - 1,
    gamma: pd1 / (S * sT),
    vega: S * pd1 * Math.sqrt(T) / 100,                    // 변동성 1%p 당
    theta: (isCall
      ? -S * pd1 * vol / (2 * Math.sqrt(T)) - r * K * disc * nd2
      : -S * pd1 * vol / (2 * Math.sqrt(T)) + r * K * disc * (1 - nd2)) / 365,  // 하루당
    d1, d2,
  };
}

//  BTC-26SEP26-70000-C  →  { expiry:'2026-09-26', strike:70000, side:'call' }
const DMON: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};
/*  이름 두 가지를 다 읽습니다.
      BTC-26SEP26-70000-C        비트코인·이더리움 (기초자산으로 정산)
      SOL_USDC-25DEC26-100-C     그 밖의 코인 (USDC 로 정산)
    행사가에 소수점이 있으면 점 대신 d 를 씁니다 — 6d4 는 6.4 입니다.      */
function parseDeribit(name: string) {
  const p = String(name).split("-");
  if (p.length < 4) return null;
  const m = p[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m || !DMON[m[2]]) return null;
  const expiry = `20${m[3]}-${DMON[m[2]]}-${m[1].padStart(2, "0")}`;
  const strike = Number(String(p[2]).replace("d", "."));
  const side = p[3] === "P" ? "put" : "call";
  const root = String(p[0]);
  const base = root.split("_")[0];
  const usdc = root.indexOf("_USDC") >= 0;
  if (!Number.isFinite(strike)) return null;
  return { expiry, strike, side, base, usdc };
}

const DERIBIT = "https://www.deribit.com/api/v2/public";

//  코인 이름 — 목록에 없으면 티커를 그대로 씁니다
const CRYPTO_KO: Record<string, string> = {
  BTC: "비트코인", ETH: "이더리움", SOL: "솔라나", XRP: "리플",
  BNB: "바이낸스코인", AVAX: "아발란체", TRX: "트론", DOGE: "도지코인",
  ADA: "에이다", LINK: "체인링크", MATIC: "폴리곤", DOT: "폴카닷",
  LTC: "라이트코인", BCH: "비트코인캐시", NEAR: "니어", TON: "톤코인",
  HYPE: "하이퍼리퀴드", PAXG: "팍스골드", SUI: "수이", APT: "앱토스",
  ARB: "아비트럼", OP: "옵티미즘", ATOM: "코스모스", UNI: "유니스왑",
};

async function deribit(path: string, params: Record<string, string>) {
  const url = new URL(DERIBIT + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Deribit 조회 실패 (${r.status}).`);
  const d = await r.json();
  return d?.result ?? [];
}

/*  어떤 코인의 옵션이 열려 있는지 Deribit 에 직접 물어봅니다.

    예전에는 BTC·ETH 만 손으로 적어뒀는데, 그 사이 솔라나·리플·아발란체
    같은 코인이 계속 늘었습니다. 목록을 붙박아 두면 늘어난 걸 못 씁니다.
    그래서 USDC 정산 옵션 목록을 한 번 받아 거기 있는 코인을 전부 꺼냅니다.  */
async function cryptoCurrencies() {
  const out: any[] = [
    { code: "BTC", name: CRYPTO_KO.BTC, book: "BTC" },
    { code: "ETH", name: CRYPTO_KO.ETH, book: "ETH" },
  ];
  try {
    const list = await deribit("/get_book_summary_by_currency",
      { currency: "USDC", kind: "option" });
    const cnt: Record<string, number> = {};
    for (const o of (list as any[])) {
      const root = String(o?.instrument_name ?? "").split("-")[0];
      const base = root.split("_")[0];
      if (!base || base === "BTC" || base === "ETH") continue;
      cnt[base] = (cnt[base] ?? 0) + 1;
    }
    //  계약이 많은 코인부터 — 얇은 코인은 뒤로 갑니다
    Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]).forEach((b) => {
      out.push({ code: b, name: CRYPTO_KO[b] ?? b, book: "USDC", contracts: cnt[b] });
    });
  } catch { /* 못 받으면 BTC·ETH 만 */ }
  return { currencies: out };
}

async function cryptoOptions(currency: string, expiration = "") {
  const cur = (currency || "BTC").toUpperCase();
  //  BTC·ETH 는 자체 통화 장부가 가장 깊습니다. 나머지는 USDC 장부에 모여 있습니다.
  const inverse = cur === "BTC" || cur === "ETH";
  const list = await deribit("/get_book_summary_by_currency",
    { currency: inverse ? cur : "USDC", kind: "option" });
  if (!Array.isArray(list) || !list.length)
    throw new Error("코인 옵션 자료를 받지 못했습니다.");

  const now = Date.now();
  let spot = 0;
  const parsed: any[] = [];
  for (const o of list) {
    const p = parseDeribit(o.instrument_name);
    if (!p) continue;
    if (p.base !== cur) continue;                 // USDC 장부에는 여러 코인이 섞여 있습니다
    const up = Number(o.underlying_price);
    if (Number.isFinite(up) && up > 0) spot = up;
    parsed.push({ ...p, raw: o });
  }
  if (!parsed.length)
    throw new Error(`${cur} 옵션을 찾지 못했습니다. 다른 코인을 골라보세요.`);

  //  만기 목록 (오늘 이후)
  const today = new Date().toISOString().slice(0, 10);
  const exps = [...new Set(parsed.map((x) => x.expiry))].filter((x) => x >= today).sort();
  const pick = expiration && exps.includes(expiration) ? expiration
             : (exps.filter((e) => {
                  const dte = (Date.parse(e + "T08:00:00Z") - now) / 864e5;
                  return dte >= 15 && dte <= 60;
                })[0] ?? exps[0]);

  const dte = Math.max(0, (Date.parse(pick + "T08:00:00Z") - now) / 864e5);
  const T = dte / 365;

  const rows = parsed.filter((x) => x.expiry === pick).map((x) => {
    const o = x.raw;
    //  mark_iv 를 퍼센트로 주는 경우가 있어 둘 다 받아들입니다
    let iv = Number(o.mark_iv);
    if (Number.isFinite(iv) && iv > 5) iv = iv / 100;
    const g = bsGreeks(spot, x.strike, T, iv, x.side === "call");
    //  BTC·ETH 는 값이 기초자산 단위로 오므로 달러로 환산합니다.
    //  USDC 정산 코인은 이미 달러 표시라 그대로 씁니다.
    const toUsd = (v: any) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return x.usdc ? n : n * spot;
    };
    return {
      code: o.instrument_name, side: x.side, strike: x.strike,
      bid: toUsd(o.bid_price), ask: toUsd(o.ask_price),
      mid: toUsd(o.mid_price), last: toUsd(o.last),
      volume: Number(o.volume ?? 0),
      oi: Number(o.open_interest ?? 0),
      iv: Number.isFinite(iv) ? iv : null,
      delta: g ? g.delta : null, gamma: g ? g.gamma : null,
      theta: g ? g.theta : null, vega: g ? g.vega : null,
      itm: x.side === "call" ? x.strike < spot : x.strike > spot,
    };
  }).sort((a, b) => a.strike - b.strike);

  //  만기별 등가격 IV — 이미 전 체인을 받아왔으니 공짜로 계산합니다.
  //  가까운 만기가 먼 만기보다 높으면(역전) 시장이 코앞의 사건을 겁내고 있다는 뜻입니다.
  const term = exps.slice(0, 12).map((e) => {
    const dteE = Math.max(0, (Date.parse(e + "T08:00:00Z") - now) / 864e5);
    let best: any = null, gap = Infinity;
    for (const x of parsed) {
      if (x.expiry !== e) continue;
      const g2 = Math.abs(x.strike - spot);
      if (g2 < gap) { gap = g2; best = x; }
    }
    let iv = best ? Number(best.raw?.mark_iv) : NaN;
    if (Number.isFinite(iv) && iv > 5) iv = iv / 100;
    return { date: e, dte: Math.round(dteE), iv: Number.isFinite(iv) ? iv : null,
             strike: best ? best.strike : null };
  }).filter((x) => x.iv != null);

  return {
    symbol: cur, expiration: pick, spot, dte: Math.round(dte), rows, term,
    expirations: exps.slice(0, 24).map((e) => ({
      date: e, dte: Math.round((Date.parse(e + "T08:00:00Z") - now) / 864e5),
    })),
    credits: 0,
    greeks_computed: true,
    settle: inverse ? cur + " 정산" : "USDC 정산",
    note: "그릭스는 Deribit 이 주는 내재변동성으로 블랙-숄즈에서 직접 계산한 값입니다 (무위험이자 0 가정).",
  };
}