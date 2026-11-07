/* 미국 고용 · 업종별 증감 카드 (매크로 경제 › 고용) — 터미널 테마 변수만 사용, 라이트 · 다크 · 글래스 공통 */
(function(){
  if(typeof window==="undefined")return;
  var SEC=[
    {c:"USMINE",ko:"광업",en:"Mining",col:"#8A8F99"},
    {c:"USCONS",ko:"건설",en:"Construction",col:"#E8873A"},
    {c:"MANEMP",ko:"제조",en:"Manufacturing",col:"#9B7BD8"},
    {c:"USTPU",ko:"거래·운송",en:"Trade & Transport",col:"#E6C14A"},
    {c:"USINFO",ko:"정보",en:"Information",col:"#3FB6C9"},
    {c:"USFIRE",ko:"금융",en:"Financial",col:"#F0A04B"},
    {c:"USPBS",ko:"전문·사업",en:"Prof. & Business",col:"#E05A9C"},
    {c:"USEHS",ko:"교육·의료",en:"Education & Health",col:"#3DBE7A"},
    {c:"USLAH",ko:"레저·접객",en:"Leisure & Hospitality",col:"#7D6BB0"},
    {c:"USSERV",ko:"기타 서비스",en:"Other Services",col:"#C9B458"},
    {c:"USGOVT",ko:"정부",en:"Government",col:"#4C7A99"}
  ];
  var TOTAL="PAYEMS";
  var S={data:null,busy:null,mode:"mom",yrs:1,chart:null,ro:null,mo:null,w:0};
  var tt=function(ko,en){return typeof T==="function"?T(ko,en):ko};
  var esc2=function(s){return typeof esc==="function"?esc(s):String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
  var nm=function(x){return typeof isEn==="function"&&isEn()?x.en:x.ko};
  var css=function(v){try{return getComputedStyle(document.documentElement).getPropertyValue(v).trim()}catch(e){return""}};
  function hexRgb(h){h=String(h||"").trim();var m=/^#?([0-9a-f]{6})$/i.exec(h);if(!m)return null;var n=parseInt(m[1],16);return[(n>>16)&255,(n>>8)&255,n&255]}
  function rgba(h,a){var r=hexRgb(h)||[127,127,127];return"rgba("+r[0]+","+r[1]+","+r[2]+","+a+")"}
  function fmt(v){var n=Math.round(v);return(n>0?"+":"")+n}
  function ym(d){return String(d).slice(2,7).replace("-",".")}

  /* ---------- 데이터 ---------- */
  function startDate(){var d=new Date();d.setFullYear(d.getFullYear()-4);return d.toISOString().slice(0,10)}
  function toMap(pts){var m={};(pts||[]).forEach(function(p){if(p&&p.d&&p.v!=null&&isFinite(Number(p.v)))m[String(p.d).slice(0,7)]=Number(p.v)});return m}
  async function load(force){
    if(S.data&&!force)return S.data;
    if(S.busy)return S.busy;
    S.busy=(async function(){
      var codes=[TOTAL].concat(SEC.map(function(x){return x.c})),st=startDate(),out={};
      for(var i=0;i<codes.length;i+=4){
        await Promise.all(codes.slice(i,i+4).map(async function(c){
          try{var d=await edge({source:"fred",code:c,item_code:"",cycle:"M",start:st,force:!!force});out[c]=toMap(d&&d.points)}catch(e){out[c]=null}
        }));
      }
      if(!out[TOTAL]||!Object.keys(out[TOTAL]).length)throw new Error("no data");
      var months=Object.keys(out[TOTAL]).sort();
      var rows=[];
      for(var k=1;k<months.length;k++){
        var m=months[k],p=months[k-1],r={m:m,tot:out[TOTAL][m]-out[TOTAL][p],sec:[]};
        SEC.forEach(function(x){var mp=out[x.c];r.sec.push(mp&&mp[m]!=null&&mp[p]!=null?mp[m]-mp[p]:null)});
        rows.push(r);
      }
      S.data={rows:rows,at:new Date().toISOString().slice(0,10)};
      S.busy=null;return S.data;
    })();
    S.busy.catch(function(){S.busy=null});
    return S.busy;
  }
  function view(){
    var rows=S.data.rows,n=S.yrs*12+(S.mode==="avg"?2:0),sl=rows.slice(-n);
    if(S.mode!=="avg")return sl.slice(-S.yrs*12);
    var out=[];
    for(var i=2;i<sl.length;i++){var a=sl[i-2],b=sl[i-1],c=sl[i];out.push({m:c.m,tot:(a.tot+b.tot+c.tot)/3,sec:c.sec.map(function(v,j){var x=a.sec[j],y=b.sec[j];return v==null||x==null||y==null?null:(x+y+v)/3})})}
    return out;
  }

  /* ---------- 마크업 ---------- */
  function ensureCard(){
    var host=$("macroTeamCard");if(!host)return null;
    var el=$("nfpSecCard");
    if(el)return el;
    el=document.createElement("div");el.className="card nfp-card";el.id="nfpSecCard";
    el.innerHTML='<div class="mtm-head nfp-head"><div class="ttl"><b>'+tt("미국 고용 · 업종별 증감","US Payrolls by Industry")+'</b><span id="nfpSub"></span></div>'+
      '<div class="tools"><span class="seg" role="group"><button type="button" data-m="mom" class="on" onclick="nfpSetMode(\'mom\')">'+tt("전월 대비","MoM")+'</button><button type="button" data-m="avg" onclick="nfpSetMode(\'avg\')">'+tt("3개월 평균","3M avg")+'</button></span>'+
      '<span class="seg" role="group"><button type="button" data-y="1" class="on" onclick="nfpSetYrs(1)">1'+tt("년","Y")+'</button><button type="button" data-y="3" onclick="nfpSetYrs(3)">3'+tt("년","Y")+'</button></span>'+
      '<button class="icon-btn" onclick="nfpRefresh()" title="'+tt("다시 받기","Reload")+'" aria-label="reload">↻</button></div></div>'+
      '<div id="nfpBody" class="nfp-body"><div class="st-hint">'+tt("받는 중…","Loading…")+'</div></div>';
    host.parentNode.insertBefore(el,host.nextSibling);
    return el;
  }
  function kpi(label,val,cls){return'<div class="nfp-k"><p>'+label+'</p><b class="'+(cls||"")+'">'+val+'</b></div>'}
  function render(){
    var el=ensureCard();if(!el||!S.data)return;
    var body=$("nfpBody"),rows=view(),last=rows[rows.length-1];
    if(!last){body.innerHTML='<div class="st-hint">'+tt("자료가 없습니다","No data")+'</div>';return}
    var raw=S.data.rows,lr=raw[raw.length-1];
    var hi=-1,lo=-1;SEC.forEach(function(x,i){var v=lr.sec[i];if(v==null)return;if(hi<0||v>lr.sec[hi])hi=i;if(lo<0||v<lr.sec[lo])lo=i});
    var avg3=raw.slice(-3).reduce(function(a,r){return a+r.tot},0)/Math.min(3,raw.length);
    var sub=$("nfpSub");if(sub)sub.textContent=tt("비농업 고용 전월 대비 순증감 (천 명, 계절조정) · 자료 BLS/FRED · 기준 ","Nonfarm payroll change by industry (thousands, SA) · BLS/FRED · as of ")+ym(lr.m);
    var legend=SEC.map(function(x,i){var v=lr.sec[i];return'<span class="nfp-lg"><i style="background:'+x.col+'"></i>'+esc2(nm(x))+' <b class="'+(v>0?"up":v<0?"dn":"")+'">'+(v==null?"-":fmt(v))+'</b></span>'}).join("");
    var hm=raw.slice(-6);
    var up=css("--up")||"#c0392b",dn=css("--down")||"#1b5fa8";
    var cell=function(v){if(v==null)return'<td>-</td>';var a=Math.min(Math.abs(v)/60,1);var bg=v>0?rgba(up,.12+.5*a):v<0?rgba(dn,.12+.5*a):"transparent";return'<td style="background:'+bg+'">'+fmt(v)+'</td>'};
    var table='<table class="nfp-hm"><thead><tr><th>'+tt("업종","Industry")+'</th>'+hm.map(function(r){return"<th>"+ym(r.m)+"</th>"}).join("")+'</tr></thead><tbody>'+
      SEC.map(function(x,i){return"<tr><th><i style=\"background:"+x.col+"\"></i>"+esc2(nm(x))+"</th>"+hm.map(function(r){return cell(r.sec[i])}).join("")+"</tr>"}).join("")+
      '<tr class="tot"><th>'+tt("총계","Total")+'</th>'+hm.map(function(r){return"<td>"+fmt(r.tot)+"</td>"}).join("")+'</tr></tbody></table>';
    body.innerHTML='<div class="nfp-kpi">'+
      kpi(tt(ym(lr.m)+" 총계",ym(lr.m)+" total"),fmt(lr.tot)+tt("천","k"),lr.tot>0?"up":"dn")+
      kpi(tt("가장 많이 늘어난 업종","Largest gain"),hi<0?"-":esc2(nm(SEC[hi]))+" "+fmt(lr.sec[hi]),"")+
      kpi(tt("가장 많이 줄어든 업종","Largest loss"),lo<0?"-":esc2(nm(SEC[lo]))+" "+fmt(lr.sec[lo]),lr.sec[lo]<0?"dn":"")+
      kpi(tt("3개월 평균","3M average"),fmt(avg3)+tt("천","k"),"")+'</div>'+
      '<div class="nfp-legend">'+legend+'</div><div id="nfpChart" class="nfp-chart"></div>'+
      '<div class="nfp-h3">'+tt("업종별 히트맵 · 최근 6개월","Heatmap · last 6 months")+'</div><div class="nfp-tw">'+table+'</div>'+
      '<div class="st-hint" style="margin-top:8px">'+tt("빨강 = 증가 · 파랑 = 감소 (색이 진할수록 변화가 큼) · 카드의 ↻ 로 다시 받기","Red = gain · Blue = loss (darker = bigger) · ↻ to reload")+'</div>';
    el.querySelectorAll("[data-m]").forEach(function(b){b.classList.toggle("on",b.dataset.m===S.mode)});
    el.querySelectorAll("[data-y]").forEach(function(b){b.classList.toggle("on",Number(b.dataset.y)===S.yrs)});
    drawChart(rows);
  }
  function drawChart(rows){
    var box=$("nfpChart");if(!box||typeof echarts==="undefined")return;
    if(S.chart&&S.chart.getDom()!==box){try{S.chart.dispose()}catch(e){}S.chart=null}
    if(!S.chart)S.chart=echarts.init(box,null,{renderer:"canvas"});
    var txt=css("--text")||"#1a1f36",sub=css("--text-sub")||"#5a6278",bd=css("--border")||"#e2e6f0",card=css("--white")||"#fff";
    var x=rows.map(function(r){return ym(r.m)});
    var series=SEC.map(function(s,i){return{name:nm(s),type:"bar",stack:"s",barMaxWidth:56,itemStyle:{color:s.col},emphasis:{focus:"series"},data:rows.map(function(r){return r.sec[i]==null?null:Math.round(r.sec[i]*10)/10})}});
    series.push({name:tt("총계","Total"),type:"line",symbol:"circle",symbolSize:7,z:10,lineStyle:{width:3,color:txt},itemStyle:{color:txt,borderColor:card,borderWidth:1.5},data:rows.map(function(r){return Math.round(r.tot*10)/10}),label:{show:true,position:"top",color:txt,fontWeight:700,fontSize:11,formatter:function(p){return p.dataIndex===rows.length-1?fmt(p.value):""}}});
    S.chart.setOption({
      animationDuration:300,backgroundColor:"transparent",
      grid:{left:52,right:16,top:16,bottom:28},
      tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:card,borderColor:bd,textStyle:{color:txt,fontSize:12},
        formatter:function(ps){var h="<b>"+ps[0].axisValue+"</b>";ps.slice().sort(function(a,b){return(b.value||0)-(a.value||0)}).forEach(function(p){if(p.value==null)return;h+="<br>"+p.marker+p.seriesName+" <b>"+fmt(p.value)+"</b>"});return h}},
      xAxis:{type:"category",data:x,axisLine:{lineStyle:{color:bd}},axisTick:{show:false},axisLabel:{color:sub,fontSize:11,interval:rows.length>14?2:0}},
      yAxis:{type:"value",splitLine:{lineStyle:{color:bd}},axisLabel:{color:sub,fontSize:11,formatter:function(v){return fmt(v)}}},
      series:series
    },true);
    watch(box);
  }
  function watch(box){
    if(S.ro)return;
    if(typeof ResizeObserver!=="undefined"){S.w=box.clientWidth;S.ro=new ResizeObserver(function(){var w=box.clientWidth;if(!w||Math.abs(w-S.w)<2)return;S.w=w;clearTimeout(S.rt);S.rt=setTimeout(function(){try{S.chart&&S.chart.resize()}catch(e){}},80)});S.ro.observe(box)}
    if(!S.mo&&typeof MutationObserver!=="undefined"){S.mo=new MutationObserver(function(){clearTimeout(S.mt);S.mt=setTimeout(function(){if(S.data&&$("nfpChart"))render()},120)});S.mo.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-glass","data-skin","lang"]})}
  }

  /* ---------- 공개 함수 · 훅 ---------- */
  window.nfpSetMode=function(m){S.mode=m==="avg"?"avg":"mom";if(S.data)render()};
  window.nfpSetYrs=function(y){S.yrs=y===3?3:1;if(S.data)render()};
  window.nfpRefresh=function(){var b=$("nfpBody");if(b)b.innerHTML='<div class="st-hint">'+tt("다시 받는 중…","Reloading…")+'</div>';S.data=null;load(true).then(render).catch(fail)};
  function fail(e){var b=$("nfpBody");if(b)b.innerHTML='<div class="st-hint">'+tt("업종별 고용 자료를 받지 못했습니다 · ↻ 로 다시 시도","Could not load industry payrolls · press ↻")+'</div>'}
  function show(on){var el=$("nfpSecCard");if(!on){if(el)el.classList.add("hidden");return}if(!el)el=ensureCard();if(!el)return;el.classList.remove("hidden");if(S.data){render()}else{load().then(render).catch(fail)}}
  var r0=window.renderMacroTeam;
  if(typeof r0==="function"){
    window.renderMacroTeam=function(){var r=r0.apply(this,arguments);try{show(typeof macroTeam!=="undefined"&&macroTeam==="jobs")}catch(e){}return r};
  }
  document.addEventListener("DOMContentLoaded",function(){try{if(typeof macroTeam!=="undefined"&&macroTeam==="jobs"&&$("macroTeamCard"))show(true)}catch(e){}});

  /* ---------- 스타일 (테마 변수만) ---------- */
  var st=document.createElement("style");st.id="nfpSecCss";st.textContent=
    '.nfp-card .nfp-head{margin-bottom:12px}'+
    '.nfp-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:4px 0 14px}'+
    '.nfp-k{background:var(--bg-sub);border:1px solid var(--border);border-radius:10px;padding:10px 14px;min-width:0}'+
    '.nfp-k p{margin:0 0 2px;color:var(--text-sub);font-size:12px}.nfp-k b{font-size:21px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}'+
    '.nfp-k b.up,.nfp-lg b.up{color:var(--up)}.nfp-k b.dn,.nfp-lg b.dn{color:var(--down)}'+
    '.nfp-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--text);margin:0 0 6px}'+
    '.nfp-lg i,.nfp-hm th i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}'+
    '.nfp-chart{width:100%;height:340px}'+
    '.nfp-h3{font-weight:700;font-size:15px;color:var(--text);margin:14px 0 8px}'+
    '.nfp-tw{overflow-x:auto;scrollbar-gutter:stable}'+
    '.nfp-hm{border-collapse:collapse;width:100%;font-size:13px;color:var(--text);font-variant-numeric:tabular-nums}'+
    '.nfp-hm th{text-align:left;font-weight:600;padding:6px 10px;white-space:nowrap;color:var(--text)}.nfp-hm thead th{color:var(--text-sub);text-align:right}.nfp-hm thead th:first-child{text-align:left}'+
    '.nfp-hm td{text-align:right;padding:6px 10px;border-left:1px solid var(--border)}'+
    '.nfp-hm tr.tot th,.nfp-hm tr.tot td{border-top:2px solid var(--accent);font-weight:800}'+
    '@media (max-width:900px){.nfp-kpi{grid-template-columns:repeat(2,1fr)}.nfp-chart{height:280px}}';
  (document.head||document.documentElement).appendChild(st);
})();
