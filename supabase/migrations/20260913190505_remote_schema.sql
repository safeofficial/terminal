SET local check_function_bodies = off;

CREATE EXTENSION "http" SCHEMA "extensions";

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pg_net" SCHEMA "extensions";

CREATE TABLE "public"."about" (
  "id"          integer                  NOT NULL DEFAULT 1,
  "title"       text                     NOT NULL,
  "body1"       text                     NOT NULL DEFAULT ''::text,
  "body2"       text                     NOT NULL DEFAULT ''::text,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "hero_badge"  text,
  "hero_title1" text,
  "hero_title2" text,
  "hero_desc"   text,
  "about_tag"   text,
  "about_head"  text,
  "about_sub"   text,
  "v1_icon"     text,
  "v1_title"    text,
  "v1_desc"     text,
  "v2_icon"     text,
  "v2_title"    text,
  "v2_desc"     text,
  "v3_icon"     text,
  "v3_title"    text,
  "v3_desc"     text,
  "contacts"    jsonb                    DEFAULT '[]'::jsonb,
  CONSTRAINT "about_pkey" PRIMARY KEY (id),
  CONSTRAINT "about_single_row" CHECK ((id = 1))
);

ALTER TABLE "public"."about"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."access_log" (
  "id"      bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" uuid                     NOT NULL,
  "at"      timestamp with time zone NOT NULL DEFAULT now(),
  "device"  text,
  CONSTRAINT "access_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."access_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ai_reports" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "market"        text                     NOT NULL,
  "code"          text                     NOT NULL,
  "name"          text,
  "model"         text                     NOT NULL,
  "status"        text                     NOT NULL DEFAULT 'running'::text,
  "step"          integer                  NOT NULL DEFAULT 0,
  "steps"         integer                  NOT NULL DEFAULT 6,
  "dossier"       jsonb,
  "sections"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "tokens_in"     bigint                   NOT NULL DEFAULT 0,
  "tokens_out"    bigint                   NOT NULL DEFAULT 0,
  "tokens_cached" bigint                   NOT NULL DEFAULT 0,
  "cost_usd"      numeric                  NOT NULL DEFAULT 0,
  "err"           text,
  "created_by"    uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "sector"        text,
  "depth"         text                     NOT NULL DEFAULT 'fast'::text,
  "mcap"          numeric,
  CONSTRAINT "ai_reports_market_check" CHECK ((market = ANY (ARRAY['KR'::text, 'US'::text]))),
  CONSTRAINT "ai_reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "ai_reports_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text])))
);

ALTER TABLE "public"."ai_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."app_settings" (
  "id"               integer                  NOT NULL DEFAULT 1,
  "current_gen"      integer                  NOT NULL DEFAULT 3,
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "fx_fixed"         numeric,
  "min_auto_trades"  integer                  NOT NULL DEFAULT 10,
  "scan_start"       date,
  "ai_month_cap_usd" numeric                  NOT NULL DEFAULT 20,
  "ai_model"         text                     NOT NULL DEFAULT 'claude-sonnet-5'::text,
  "ai_cache_days"    integer                  NOT NULL DEFAULT 3,
  "ai_recheck_days"  integer                  NOT NULL DEFAULT 30,
  CONSTRAINT "app_settings_fx_chk" CHECK (((fx_fixed IS NULL) OR (fx_fixed > (0)::numeric))),
  CONSTRAINT "app_settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "app_settings_single_row" CHECK ((id = 1))
);

ALTER TABLE "public"."app_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."auto_runs" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id"     bigint,
  "ran_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "scanned"     integer                  NOT NULL DEFAULT 0,
  "matched"     integer                  NOT NULL DEFAULT 0,
  "filled"      integer                  NOT NULL DEFAULT 0,
  "spent"       numeric                  NOT NULL DEFAULT 0,
  "budget_left" numeric,
  "note"        text,
  CONSTRAINT "auto_runs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."auto_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."backup_members" (
  "id"         bigint,
  "name"       text,
  "gen"        integer,
  "role"       text,
  "dept"       text,
  "created_at" timestamp with time zone,
  "entry_year" text,
  "person_key" text
);

ALTER TABLE "public"."backup_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."backup_news" (
  "id"           bigint,
  "type"         text,
  "date"         text,
  "title"        text,
  "description"  text,
  "created_at"   timestamp with time zone,
  "file_url"     text,
  "file_type"    text,
  "storage_path" text,
  "file_name"    text
);

ALTER TABLE "public"."backup_news"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."backup_reports" (
  "id"           bigint,
  "title"        text,
  "gen"          integer,
  "category"     text,
  "author"       text,
  "date"         text,
  "description"  text,
  "file_url"     text,
  "file_type"    text,
  "storage_path" text,
  "created_at"   timestamp with time zone
);

ALTER TABLE "public"."backup_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."chart_themes" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"       text                     NOT NULL,
  "is_default" boolean                  NOT NULL DEFAULT false,
  "bg"         text                     NOT NULL DEFAULT '#ffffff'::text,
  "grid"       text                     NOT NULL DEFAULT '#e8ecf4'::text,
  "axis_left"  text                     NOT NULL DEFAULT '#2c3e6b'::text,
  "axis_right" text                     NOT NULL DEFAULT '#b26a00'::text,
  "text_color" text                     NOT NULL DEFAULT '#1a1f36'::text,
  "palette"    jsonb                    NOT NULL DEFAULT '["#2c3e6b", "#c0392b", "#1f8a70", "#b26a00", "#6b5ca5", "#3d52a0", "#8a6d1f", "#2f7d95"]'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chart_themes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."chart_themes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."contest" (
  "gen"        integer                  NOT NULL,
  "starts_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "ends_at"    timestamp with time zone NOT NULL,
  "fx_fixed"   numeric                  NOT NULL DEFAULT 1400,
  "note"       text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contest_pkey" PRIMARY KEY (gen)
);

ALTER TABLE "public"."contest"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crypto_pool" (
  "symbol"   text                     NOT NULL,
  "name"     text,
  "enabled"  boolean                  NOT NULL DEFAULT true,
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crypto_pool_pkey" PRIMARY KEY (symbol)
);

ALTER TABLE "public"."crypto_pool"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."dart_corps" (
  "corp_code"   text                     NOT NULL,
  "corp_name"   text                     NOT NULL,
  "stock_code"  text,
  "modify_date" text,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "dart_corps_pkey" PRIMARY KEY (corp_code)
);

ALTER TABLE "public"."dart_corps"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."dividends" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id"     bigint                   NOT NULL,
  "market"      text                     NOT NULL,
  "symbol"      text                     NOT NULL,
  "name"        text,
  "per_share"   numeric                  NOT NULL,
  "qty"         numeric                  NOT NULL,
  "gross"       numeric                  NOT NULL,
  "tax"         numeric                  NOT NULL DEFAULT 0,
  "net"         numeric                  NOT NULL,
  "fx"          numeric                  NOT NULL DEFAULT 1,
  "ex_date"     date,
  "record_date" date,
  "pay_date"    date                     NOT NULL,
  "source"      text                     NOT NULL DEFAULT 'auto'::text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "dividends_market_check" CHECK ((market = ANY (ARRAY['KR'::text, 'US'::text]))),
  CONSTRAINT "dividends_per_share_check" CHECK ((per_share > (0)::numeric)),
  CONSTRAINT "dividends_pkey" PRIMARY KEY (id),
  CONSTRAINT "dividends_qty_check" CHECK ((qty > (0)::numeric))
);

ALTER TABLE "public"."dividends"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."indicator_catalog" (
  "id"              bigint   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source"          text     NOT NULL,
  "code"            text     NOT NULL,
  "item_code"       text,
  "cycle"           text     DEFAULT 'M'::text,
  "label"           text     NOT NULL,
  "unit"            text,
  "category"        text     NOT NULL DEFAULT '기타'::text,
  "sort_order"      integer  NOT NULL DEFAULT 0,
  "importance"      smallint NOT NULL DEFAULT 1,
  "importance_auto" boolean  NOT NULL DEFAULT true,
  "description"     text,
  CONSTRAINT "indicator_catalog_cycle_check" CHECK ((cycle = ANY (ARRAY['D'::text, 'M'::text, 'Q'::text, 'A'::text]))),
  CONSTRAINT "indicator_catalog_importance_range" CHECK (((importance >= 1) AND (importance <= 3))),
  CONSTRAINT "indicator_catalog_pkey" PRIMARY KEY (id),
  CONSTRAINT "indicator_catalog_source_check" CHECK ((source = ANY (ARRAY['fred'::text, 'ecos'::text, 'quote_us'::text, 'quote_kr'::text])))
);

ALTER TABLE "public"."indicator_catalog"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."meeting_docs" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "title"       text                     NOT NULL,
  "meeting_on"  date,
  "note"        text,
  "path"        text                     NOT NULL,
  "bytes"       bigint                   NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meeting_docs_path_key" UNIQUE (path),
  CONSTRAINT "meeting_docs_pkey" PRIMARY KEY (id),
  "uploaded_by" uuid                     NOT NULL DEFAULT auth.uid()
);

ALTER TABLE "public"."meeting_docs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."member_ids" (
  "member_id"  bigint                   NOT NULL,
  "student_id" text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "member_ids_pkey" PRIMARY KEY (member_id)
);

ALTER TABLE "public"."member_ids"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."member_presence" (
  "user_id"    uuid                     NOT NULL,
  "device_id"  text                     NOT NULL,
  "device"     text,
  "first_seen" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "member_presence_pkey" PRIMARY KEY (user_id, device_id)
);

ALTER TABLE "public"."member_presence"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."members" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"       text                     NOT NULL,
  "gen"        integer                  NOT NULL,
  "role"       text                     NOT NULL,
  "dept"       text                     NOT NULL DEFAULT ''::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "entry_year" text,
  "person_key" text,
  CONSTRAINT "members_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."news" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "type"         text                     NOT NULL DEFAULT 'notice'::text,
  "date"         text                     NOT NULL,
  "title"        text                     NOT NULL,
  "description"  text                     NOT NULL DEFAULT ''::text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "file_url"     text,
  "file_type"    text,
  "storage_path" text,
  "file_name"    text,
  CONSTRAINT "news_pkey" PRIMARY KEY (id),
  CONSTRAINT "news_type_check" CHECK ((type = ANY (ARRAY['recruit'::text, 'event'::text, 'notice'::text])))
);

ALTER TABLE "public"."news"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."page_views" (
  "visited_on" date    NOT NULL,
  "visitor"    text    NOT NULL,
  "views"      integer NOT NULL DEFAULT 1,
  CONSTRAINT "page_views_pkey" PRIMARY KEY (visited_on, visitor)
);

ALTER TABLE "public"."page_views"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."portfolio_snapshots" (
  "team_id"        bigint                   NOT NULL,
  "on_date"        date                     NOT NULL,
  "cash"           numeric                  NOT NULL,
  "holdings_value" numeric                  NOT NULL,
  "total"          numeric                  NOT NULL,
  "recorded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY (team_id, on_date)
);

ALTER TABLE "public"."portfolio_snapshots"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."price_cache" (
  "market"     text                     NOT NULL,
  "symbol"     text                     NOT NULL,
  "on_date"    date                     NOT NULL,
  "close"      numeric                  NOT NULL,
  "name"       text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "price_cache_pkey" PRIMARY KEY (market, symbol, on_date)
);

ALTER TABLE "public"."price_cache"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."private_warm_cfg" (
  "id"          integer NOT NULL DEFAULT 1,
  "project_url" text    NOT NULL,
  "anon_key"    text    NOT NULL,
  "warm_token"  text    NOT NULL,
  CONSTRAINT "one_row" CHECK ((id = 1)),
  CONSTRAINT "private_warm_cfg_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."private_warm_cfg"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "student_id" text,
  "name"       text,
  "gen"        integer,
  "role"       text                     NOT NULL DEFAULT 'member'::text,
  "position"   text,
  "status"     text                     NOT NULL DEFAULT 'active'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "nickname"   text,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['officer'::text, 'member'::text, 'alumni'::text]))),
  CONSTRAINT "profiles_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reports" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "title"        text                     NOT NULL,
  "gen"          integer                  NOT NULL,
  "category"     text                     NOT NULL DEFAULT 'economy'::text,
  "author"       text                     NOT NULL,
  "date"         text                     NOT NULL,
  "description"  text                     NOT NULL DEFAULT ''::text,
  "file_url"     text                     NOT NULL,
  "file_type"    text                     NOT NULL DEFAULT 'link'::text,
  "storage_path" text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reports_category_check" CHECK ((category = ANY (ARRAY['economy'::text, 'industry'::text]))),
  CONSTRAINT "reports_file_type_check" CHECK ((file_type = ANY (ARRAY['link'::text, 'upload'::text]))),
  CONSTRAINT "reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reset_log" (
  "id"        bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "at"        timestamp with time zone NOT NULL DEFAULT now(),
  "by_user"   uuid,
  "by_name"   text,
  "scope"     text                     NOT NULL,
  "team_id"   bigint,
  "seed"      numeric,
  "starts_at" timestamp with time zone,
  "ends_at"   timestamp with time zone,
  "deleted"   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "note"      text,
  CONSTRAINT "reset_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."reset_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."resource_links" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "category"   text                     NOT NULL DEFAULT '경제지표'::text,
  "title"      text                     NOT NULL,
  "url"        text                     NOT NULL,
  "note"       text,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "resource_links_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."resource_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."series_cache" (
  "source"     text                     NOT NULL,
  "code"       text                     NOT NULL,
  "item_code"  text                     NOT NULL DEFAULT ''::text,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "payload"    jsonb                    NOT NULL,
  CONSTRAINT "series_cache_pkey" PRIMARY KEY (source, code, item_code)
);

ALTER TABLE "public"."series_cache"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."strategies" (
  "id"             bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id"        bigint                   NOT NULL,
  "name"           text                     NOT NULL DEFAULT '전략'::text,
  "config"         jsonb                    NOT NULL,
  "effective_from" date                     NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date,
  "created_by"     uuid,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "expect"         jsonb,
  CONSTRAINT "strategies_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."strategies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."strategy_runs" (
  "team_id"     bigint                   NOT NULL,
  "last_date"   date,
  "trades_made" integer                  NOT NULL DEFAULT 0,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "strategy_runs_pkey" PRIMARY KEY (team_id)
);

ALTER TABLE "public"."strategy_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_members" (
  "team_id" bigint NOT NULL,
  "user_id" uuid   NOT NULL,
  CONSTRAINT "team_members_pkey" PRIMARY KEY (team_id, user_id)
);

ALTER TABLE "public"."team_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."teams" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"          text                     NOT NULL,
  "gen"           integer                  NOT NULL,
  "seed"          numeric                  NOT NULL DEFAULT 100000000,
  "started_on"    date                     NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date,
  "is_open"       boolean                  NOT NULL DEFAULT true,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "mode"          text                     NOT NULL DEFAULT 'manual'::text,
  "auto_on"       boolean                  NOT NULL DEFAULT false,
  "auto_budget"   numeric                  NOT NULL DEFAULT 0,
  "auto_interval" text                     NOT NULL DEFAULT '1d'::text,
  "auto_last_at"  timestamp with time zone,
  "bar_tf"        text                     NOT NULL DEFAULT '1d'::text,
  CONSTRAINT "teams_bar_tf_chk" CHECK ((bar_tf = ANY (ARRAY['5m'::text, '15m'::text, '30m'::text, '1h'::text, '4h'::text, '1d'::text, '1w'::text]))),
  CONSTRAINT "teams_interval_ck" CHECK ((auto_interval = ANY (ARRAY['5m'::text, '15m'::text, '30m'::text, '2h'::text, '4h'::text, '1d'::text, '1w'::text]))),
  CONSTRAINT "teams_mode_chk" CHECK ((mode = ANY (ARRAY['manual'::text, 'strategy'::text]))),
  CONSTRAINT "teams_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."teams"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tradable" (
  "market"     text                     NOT NULL,
  "symbol"     text                     NOT NULL,
  "name"       text,
  "kind"       text,
  "leveraged"  boolean                  NOT NULL DEFAULT false,
  "active"     boolean                  NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tradable_pkey" PRIMARY KEY (market, symbol)
);

ALTER TABLE "public"."tradable"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."trades" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id"    bigint                   NOT NULL,
  "market"     text                     NOT NULL,
  "symbol"     text                     NOT NULL,
  "name"       text,
  "side"       text                     NOT NULL,
  "qty"        numeric                  NOT NULL,
  "price"      numeric                  NOT NULL,
  "fee"        numeric                  NOT NULL DEFAULT 0,
  "traded_on"  date                     NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date,
  "note"       text,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "auto"       boolean                  NOT NULL DEFAULT false,
  "source"     text                     NOT NULL DEFAULT 'manual'::text,
  "traded_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "fill_basis" text,
  "rule_name"  text,
  "fx"         numeric                  NOT NULL DEFAULT 1,
  CONSTRAINT "trades_fx_chk" CHECK ((fx > (0)::numeric)),
  CONSTRAINT "trades_market_check" CHECK ((market = ANY (ARRAY['KR'::text, 'US'::text, 'CRYPTO'::text]))),
  CONSTRAINT "trades_pkey" PRIMARY KEY (id),
  CONSTRAINT "trades_price_check" CHECK ((price > (0)::numeric)),
  CONSTRAINT "trades_qty_check" CHECK ((qty > (0)::numeric)),
  CONSTRAINT "trades_side_check" CHECK ((side = ANY (ARRAY['buy'::text, 'sell'::text]))),
  CONSTRAINT "trades_source_ck" CHECK ((source = ANY (ARRAY['manual'::text, 'auto'::text])))
);

ALTER TABLE "public"."trades"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."universe" (
  "market"     text                     NOT NULL,
  "symbol"     text                     NOT NULL,
  "name"       text,
  "added_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "auto"       boolean                  NOT NULL DEFAULT false,
  "active"     boolean                  NOT NULL DEFAULT true,
  "rank"       integer,
  "tr_value"   numeric,
  "as_of"      date,
  "first_seen" date                     NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT "universe_market_check" CHECK ((market = ANY (ARRAY['KR'::text, 'US'::text, 'CRYPTO'::text]))),
  CONSTRAINT "universe_pkey" PRIMARY KEY (market, symbol)
);

ALTER TABLE "public"."universe"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."us_tickers" (
  "ticker"     text                     NOT NULL,
  "cik"        text                     NOT NULL,
  "title"      text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "us_tickers_pkey" PRIMARY KEY (ticker)
);

ALTER TABLE "public"."us_tickers"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.access_summary()
  RETURNS json
  LANGUAGE sql
  STABLE
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'recent', (
      select coalesce(json_agg(row_to_json(r)), '[]'::json) from (
        select p.student_id, p.name, p.gen, p.role, l.at, l.device
        from public.access_log l
        join public.profiles p on p.id = l.user_id
        order by l.at desc
        limit 50
      ) r
    ),
    'by_member', (
      select coalesce(json_agg(row_to_json(m)), '[]'::json) from (
        select p.student_id, p.name, p.gen, p.role,
               count(l.id)::int as visits,
               max(l.at)        as last_seen
        from public.profiles p
        left join public.access_log l on l.user_id = p.id
        where p.status = 'active'
        group by p.id, p.student_id, p.name, p.gen, p.role
        order by max(l.at) desc nulls last
      ) m
    ),
    'today', (
      select count(distinct user_id) from public.access_log
      where at >= (now() at time zone 'Asia/Seoul')::date
    ),
    'week', (
      select count(distinct user_id) from public.access_log
      where at >= now() - interval '7 days'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.ai_admin_set (
  p_recheck_days integer DEFAULT NULL::integer,
  p_cap          numeric DEFAULT NULL::numeric,
  p_cache_days   integer DEFAULT NULL::integer
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare r record;
begin
  if not public.is_officer() then
    raise exception '임원진만 바꿀 수 있습니다.';
  end if;
  /*  ⚠️ 실제로 터진 함정입니다. Postgres 의 least()/greatest() 는 null 을
      «무시» 합니다 — least(1000, null) 은 null 이 아니라 <1000> 입니다.
      그래서 coalesce(greatest(0, least(1000, p_cap)), 지금값) 으로 쓰면
      «안 건드리려고» null 을 넣었는데 상한이 조용히 1000 달러가 됩니다.
      null 검사를 먼저 하고, 값이 있을 때만 자릅니다.                    */
  update public.app_settings set
    ai_recheck_days  = case when p_recheck_days is null then ai_recheck_days
                            else greatest(0, least(365, p_recheck_days)) end,
    ai_month_cap_usd = case when p_cap is null then ai_month_cap_usd
                            else greatest(0, least(1000, p_cap)) end,
    ai_cache_days    = case when p_cache_days is null then ai_cache_days
                            else greatest(0, least(90, p_cache_days)) end
   where id = 1;
  select ai_recheck_days, ai_month_cap_usd, ai_cache_days into r
    from public.app_settings where id = 1;
  return json_build_object('recheck_days', r.ai_recheck_days,
                           'cap', r.ai_month_cap_usd,
                           'cache_days', r.ai_cache_days, 'ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.ai_budget()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    --  ⚠️ 금액은 임원진에게만. 학회원에게는 '남았나/찼나' 만 알려줍니다.
    'spent',  case when public.is_officer()
                   then coalesce((select sum(cost_usd) from public.ai_reports
                                   where created_at >= date_trunc('month', now())), 0)
                   else null end,
    'cap',    case when public.is_officer()
                   then coalesce((select ai_month_cap_usd from public.app_settings where id = 1), 20)
                   else null end,
    'used_pct', least(100, round(100 * coalesce((select sum(cost_usd) from public.ai_reports
                       where created_at >= date_trunc('month', now())), 0)
                     / nullif(coalesce((select ai_month_cap_usd from public.app_settings
                                         where id = 1), 20), 0))),
    'officer', public.is_officer(),
    'model',  coalesce((select ai_model from public.app_settings where id = 1), 'claude-haiku-4-5'),
    'cache_days', coalesce((select ai_cache_days from public.app_settings where id = 1), 3),
    'recheck_days', coalesce((select ai_recheck_days from public.app_settings where id = 1), 30),
    'reports', coalesce((select count(*) from public.ai_reports
                          where created_at >= date_trunc('month', now())
                            and status = 'done'), 0),
    'ok', public.can_use_terminal()
  );
$function$;

CREATE OR REPLACE FUNCTION public.ai_existing (
  p_market text,
  p_code   text,
  p_depth  text DEFAULT 'fast'::text
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with d as (select coalesce((select ai_recheck_days from public.app_settings where id = 1), 30) as days),
  hit as (
    select r.id, r.name, r.created_at, r.depth, r.sector,
           (r.sections ->> 'headline') as headline
      from public.ai_reports r, d
     where public.can_use_terminal()
       and r.market = upper(p_market) and r.code = p_code
       and r.depth = coalesce(nullif(p_depth,''), 'fast')
       and r.status = 'done'
       and d.days > 0
       and r.created_at >= now() - make_interval(days => d.days)
     order by r.created_at desc
     limit 1)
  select json_build_object(
    'days',    (select days from d),
    'found',   (select count(*) > 0 from hit),
    'id',      (select id from hit),
    'name',    (select name from hit),
    'depth',   (select depth from hit),
    'sector',  (select sector from hit),
    'headline',(select headline from hit),
    'at',      (select created_at from hit),
    --  언제 다시 뽑을 수 있는지 (화면에 날짜로 적어 줍니다)
    'next_at', (select created_at + make_interval(days => (select days from d)) from hit),
    'officer', public.is_officer()
  );
$function$;

CREATE OR REPLACE FUNCTION public.ai_report_get (
  p_id bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select case when public.can_use_terminal()
              then to_jsonb(r) - 'dossier'      --  재료는 안 내려보냅니다 (무겁습니다)
              else null end
    from public.ai_reports r where r.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.ai_report_list (
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_sector text    DEFAULT NULL::text,
  p_q      text    DEFAULT NULL::text,
  p_sort   text    DEFAULT 'new'::text,
  p_depth  text    DEFAULT NULL::text
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with f as (
    select id, market, code, name, status, step, steps, sector, created_at,
           depth, mcap,
           (sections ->> 'headline') as headline
      from public.ai_reports
     where public.can_use_terminal()
       and (p_sector is null or p_sector = '' or sector = p_sector)
       and (p_depth is null or p_depth = '' or depth = p_depth)
       and (p_q is null or p_q = ''
            or name ilike '%' || p_q || '%'
            or code ilike '%' || p_q || '%'
            or coalesce(sections ->> 'headline','') ilike '%' || p_q || '%')
  ), s as (
    select f.*,
           /*  ⚠️ 고른 정렬만 «키» 가 되게 합니다. 안 고른 줄은 전부 null 이라
                  서로 같은 값이 되어 다음 키(=최신순)로 넘어갑니다.
                  예전에는 mcap 을 조건 밖에 둬서 어느 정렬을 고르든
                  시총이 먼저 먹혔습니다.                              */
           row_number() over (order by
             case when p_sort = 'mcap'   then mcap end desc nulls last,
             case when p_sort = 'name'   then name end asc nulls last,
             case when p_sort = 'sector' then coalesce(sector, '힣') end asc nulls last,
             case when p_sort = 'old'    then created_at end asc nulls last,
             created_at desc) as rn
      from f
  )
  select json_build_object(
    'total', (select count(*) from f),
    'sort',  coalesce(p_sort, 'new'),
    'rows', coalesce((
      select json_agg(x order by x.rn) from (
        select * from s order by rn
         limit greatest(1, least(coalesce(p_limit, 20), 100))
        offset greatest(0, coalesce(p_offset, 0))
      ) x), '[]'::json)
  );
$function$;

CREATE OR REPLACE FUNCTION public.ai_sectors()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(x order by x.n desc, x.sector), '[]'::json)
  from (
    select coalesce(nullif(sector,''), '미분류') as sector, count(*) as n
      from public.ai_reports
     where public.can_use_terminal() and status = 'done'
     group by 1
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.ai_spend_admin()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select case when public.is_officer() then json_build_object(
    'month_spent', coalesce((select sum(cost_usd) from public.ai_reports
                              where created_at >= date_trunc('month', now())), 0),
    'month_reports', coalesce((select count(*) from public.ai_reports
                              where created_at >= date_trunc('month', now())), 0),
    'all_spent',   coalesce((select sum(cost_usd) from public.ai_reports), 0),
    'all_reports', coalesce((select count(*) from public.ai_reports), 0),
    --  설정 화면이 <지금 값> 을 칸에 채워 넣으려면 같이 내려와야 합니다
    'recheck_days', coalesce((select ai_recheck_days from public.app_settings where id = 1), 30),
    'cache_days',   coalesce((select ai_cache_days   from public.app_settings where id = 1), 3),
    'cap',         coalesce((select ai_month_cap_usd from public.app_settings where id = 1), 20),
    'model',       coalesce((select ai_model from public.app_settings where id = 1), 'claude-haiku-4-5'),
    'cached_tok',  coalesce((select sum(tokens_cached) from public.ai_reports), 0),
    'by_model', coalesce((select json_agg(m) from (
        select model, count(*) as n, sum(cost_usd) as usd
          from public.ai_reports group by model order by sum(cost_usd) desc) m), '[]'::json),
    'recent', coalesce((select json_agg(r) from (
        select id, name, code, model, cost_usd, created_at, status
          from public.ai_reports order by created_at desc limit 20) r), '[]'::json)
  ) else null end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_health()
  RETURNS json
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  v_cron      json := null;
  v_cfg       boolean := false;
  v_last_run  timestamptz;
  v_runs_24h  int := 0;
  v_teams     json;
  v_recent    json;
  v_gen       int;
begin
  if not public.is_officer() then
    raise exception '임원진만 볼 수 있습니다.';
  end if;

  select current_gen into v_gen from public.app_settings where id = 1;

  /*  ① 스캔을 부르는 예약 작업이 등록돼 있나.
      ⚠️ cron.job 은 확장 스키마라 화면이 직접 못 읽습니다.
         못 읽어도 진단은 계속해야 하므로 통째로 감쌉니다.        */
  begin
    select json_agg(json_build_object(
             'name', jobname, 'schedule', schedule, 'active', active))
      into v_cron
    from cron.job
     where jobname in ('safe-mt-scan', 'safe-fred-warm',
                       'safe-uni-us', 'safe-uni-kr', 'safe-uni-cc');
  exception when others then v_cron := null; end;

  --  ② 주소·열쇠가 들어 있나 (예열자동.sql 1단계)
  begin
    select exists (select 1 from private_warm_cfg where id = 1) into v_cfg;
  exception when others then v_cfg := false; end;

  --  ③ 실제로 돈 흔적 — 이게 제일 확실한 증거입니다
  begin
    select max(ran_at), count(*) filter (where ran_at > now() - interval '24 hours')
      into v_last_run, v_runs_24h
    from public.auto_runs;
  exception when others then v_last_run := null; v_runs_24h := 0; end;

  --  ④ 팀마다 준비가 됐나
  select coalesce(json_agg(json_build_object(
           'id', t.id, 'name', t.name,
           'auto_on', t.auto_on,
           'budget', t.auto_budget,
           'interval', t.auto_interval,
           'last_at', t.auto_last_at,
           'strategies', (select count(*) from public.strategies s where s.team_id = t.id),
           --  무엇이 막고 있나 — 한 줄로
           'blocked', case
             when not coalesce(t.auto_on, false)         then '자동매매가 꺼져 있습니다'
             when coalesce(t.auto_budget, 0) <= 0        then '배정 금액이 0 입니다'
             when (select count(*) from public.strategies s
                    where s.team_id = t.id) = 0          then '저장된 전략이 없습니다'
             else null end)
         order by t.name), '[]'::json)
    into v_teams
  from public.teams t
  where v_gen is null or t.gen = v_gen;

  --  ⑤ 최근 실행 기록 — note 에 이유가 적혀 있습니다
  select coalesce((
    select json_agg(x order by (x->>'ran_at') desc) from (
      select json_build_object(
        'team_id', r.team_id,
        'team', (select name from public.teams t2 where t2.id = r.team_id),
        'ran_at', r.ran_at, 'scanned', r.scanned, 'matched', r.matched,
        'filled', r.filled, 'spent', r.spent, 'note', r.note) as x
      from public.auto_runs r
      order by r.ran_at desc limit 20) s), '[]'::json)
    into v_recent;

  return json_build_object(
    'ok', true,
    'now', now(),
    'cron', v_cron,
    'cron_readable', (v_cron is not null),
    'scan_scheduled', (v_cron is not null
       and exists (select 1 from json_array_elements(v_cron) e
                    where e->>'name' = 'safe-mt-scan'
                      and (e->>'active')::boolean)),
    'cfg', v_cfg,
    'last_run', v_last_run,
    'runs_24h', v_runs_24h,
    'teams', v_teams,
    'recent', v_recent,
    'trades_auto', (select count(*) from public.trades where source = 'auto'),
    'trades_all',  (select count(*) from public.trades));
end $function$;

CREATE OR REPLACE FUNCTION public.backfill_trade_fx()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int;
begin
  if not public.is_officer() then
    raise exception '임원진만 실행할 수 있습니다.';
  end if;

  update public.trades t
     set fx = r.rate
    from (
      select tr.id,
             coalesce((select pc.close from public.price_cache pc
                        where pc.market='FX' and pc.symbol='USDKRW'
                          and pc.on_date <= tr.traded_on
                        order by pc.on_date desc limit 1),
                      public.fx_rate(null)) as rate
        from public.trades tr
       where tr.market = 'US'
    ) r
   where t.id = r.id and r.rate is not null and t.market = 'US';

  get diagnostics n = row_count;

  -- 국내 주식은 언제나 1
  update public.trades set fx = 1 where market = 'KR' and fx <> 1;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.can_use_terminal()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.profiles p
    cross join public.app_settings s
    where p.id = auth.uid()
      and p.status = 'active'
      and s.id = 1
      and (p.role = 'officer' or (p.role = 'member' and p.gen = s.current_gen))
  );
$function$;

CREATE OR REPLACE FUNCTION public.clear_auto_trades (
  p_team_id bigint
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int;
begin
  if not public.in_team(p_team_id) then
    raise exception '이 팀의 거래를 수정할 권한이 없습니다.';
  end if;
  delete from public.trades where team_id = p_team_id and auto = true;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.company_db_status()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'kr',         (select count(*) from public.dart_corps),
    'kr_updated', (select max(updated_at) from public.dart_corps),
    'us',         (select count(*) from public.us_tickers),
    'us_updated', (select max(updated_at) from public.us_tickers)
  );
$function$;

CREATE OR REPLACE FUNCTION public.company_search (
  q text
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with needle as (
    select btrim(coalesce(q, '')) as raw,
           lower(btrim(coalesce(q, ''))) as low
  ),
  kr as (
    select json_build_object(
             'market','KR', 'code', c.stock_code, 'corp_code', c.corp_code,
             'name', c.corp_name, 'sub', c.stock_code) as j,
           case when c.stock_code = n.raw then 0
                when lower(c.corp_name) = n.low then 1
                when lower(c.corp_name) like n.low || '%' then 2
                else 3 end as rk,
           length(c.corp_name) as ln
    from public.dart_corps c, needle n
    where n.low <> ''
      and c.stock_code is not null and c.stock_code <> ''
      and (c.stock_code = n.raw or lower(c.corp_name) like '%' || n.low || '%')
    order by rk, ln
    limit 15
  ),
  us as (
    select json_build_object(
             'market','US', 'code', t.ticker, 'cik', t.cik,
             'name', t.title, 'sub', t.ticker) as j,
           case when lower(t.ticker) = n.low then 0
                when lower(t.title) = n.low then 1
                when lower(t.title) like n.low || '%' then 2
                else 3 end as rk,
           length(t.title) as ln
    from public.us_tickers t, needle n
    where n.low <> ''
      and (lower(t.ticker) = n.low or lower(t.title) like '%' || n.low || '%')
    order by rk, ln
    limit 15
  )
  select coalesce(json_agg(x.j order by x.rk, x.ln), '[]'::json)
  from (select * from kr union all select * from us) x;
$function$;

CREATE OR REPLACE FUNCTION public.contest_reset (
  p_team_id bigint                   DEFAULT NULL::bigint,
  p_seed    numeric                  DEFAULT NULL::numeric,
  p_starts  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_ends    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_note    text                     DEFAULT NULL::text
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  me      uuid := auth.uid();
  myname  text;
  g       int;
  tgt     bigint[] ;
  scope   text;
  n_tr int := 0; n_sn int := 0; n_dv int := 0;
  n_ar int := 0; n_sr int := 0; n_st int := 0; n_tm int := 0;
  seed_now numeric;
begin
  if not public.is_officer() then
    raise exception '임원진만 초기화할 수 있습니다.';
  end if;

  select name into myname from public.profiles where id = me;
  select current_gen into g from public.app_settings where id = 1;

  /*  ⚠️ 어느 팀을 지울지 <먼저> 확정합니다. 지우면서 고르면 중간에
      팀이 바뀌는 일이 생깁니다.
      ⚠️ 다른 기수 팀은 안 건드립니다 — 지난 학기 기록까지 날아가면
         안 됩니다.                                                    */
  if p_team_id is null then
    select array_agg(id) into tgt from public.teams where gen = g;
    scope := 'all';
  else
    select array_agg(id) into tgt from public.teams where id = p_team_id;
    if tgt is null then raise exception '그런 팀이 없습니다 (id=%).', p_team_id; end if;
    select name into scope from public.teams where id = p_team_id;
  end if;
  if tgt is null or array_length(tgt, 1) is null then
    raise exception '초기화할 팀이 없습니다. (현재 활동 기수 %기)', g;
  end if;

  --  ── 지웁니다 ──
  delete from public.trades              where team_id = any(tgt);
  get diagnostics n_tr = row_count;
  delete from public.portfolio_snapshots where team_id = any(tgt);
  get diagnostics n_sn = row_count;
  delete from public.dividends           where team_id = any(tgt);
  get diagnostics n_dv = row_count;
  delete from public.auto_runs           where team_id = any(tgt);
  get diagnostics n_ar = row_count;
  delete from public.strategy_runs       where team_id = any(tgt);
  get diagnostics n_sr = row_count;
  delete from public.strategies          where team_id = any(tgt);
  get diagnostics n_st = row_count;

  --  ── 출발선으로 되돌립니다 ──
  update public.teams set
    seed         = coalesce(p_seed, seed),
    auto_on      = false,
    auto_budget  = 0,
    auto_last_at = null,
    is_open      = true,
    started_on   = (now() at time zone 'Asia/Seoul')::date
   where id = any(tgt);
  get diagnostics n_tm = row_count;
  select max(seed) into seed_now from public.teams where id = any(tgt);

  /*  ⚠️ 대회 기간은 <전체 초기화일 때만> 바꿉니다. 한 팀 사고 때문에
      전 팀 일정이 바뀌면 안 됩니다.                                   */
  if p_team_id is null and (p_starts is not null or p_ends is not null) then
    insert into public.contest (gen, starts_at, ends_at)
    values (g, coalesce(p_starts, now()), coalesce(p_ends, now() + interval '90 days'))
    on conflict (gen) do update set
      starts_at  = coalesce(p_starts, public.contest.starts_at),
      ends_at    = coalesce(p_ends,   public.contest.ends_at),
      updated_at = now();
  end if;

  insert into public.reset_log (by_user, by_name, scope, team_id, seed,
                                starts_at, ends_at, deleted, note)
  values (me, myname, scope, p_team_id, seed_now, p_starts, p_ends,
          json_build_object('trades', n_tr, 'snapshots', n_sn, 'dividends', n_dv,
                            'auto_runs', n_ar, 'strategy_runs', n_sr,
                            'strategies', n_st, 'teams', n_tm),
          left(coalesce(p_note, ''), 200));

  return json_build_object(
    'ok', true, 'scope', scope, 'teams', n_tm, 'gen', g, 'seed', seed_now,
    'deleted', json_build_object('trades', n_tr, 'snapshots', n_sn,
                                 'dividends', n_dv, 'auto_runs', n_ar,
                                 'strategy_runs', n_sr, 'strategies', n_st));
end $function$;

CREATE OR REPLACE FUNCTION public.contest_reset_preview (
  p_team_id bigint DEFAULT NULL::bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with g as (select current_gen as gen from public.app_settings where id = 1),
  tgt as (
    select t.id, t.name, t.seed from public.teams t, g
     where public.is_officer()
       and (case when p_team_id is null then t.gen = g.gen else t.id = p_team_id end)
  )
  select json_build_object(
    'ok', public.is_officer(),
    'scope', case when p_team_id is null then 'all' else (select name from tgt limit 1) end,
    'teams', (select count(*) from tgt),
    'team_names', coalesce((select json_agg(name order by name) from tgt), '[]'::json),
    'trades',        (select count(*) from public.trades              where team_id in (select id from tgt)),
    'snapshots',     (select count(*) from public.portfolio_snapshots where team_id in (select id from tgt)),
    'dividends',     (select count(*) from public.dividends           where team_id in (select id from tgt)),
    'auto_runs',     (select count(*) from public.auto_runs           where team_id in (select id from tgt)),
    'strategies',    (select count(*) from public.strategies          where team_id in (select id from tgt)),
    'first_trade',   (select min(traded_on) from public.trades        where team_id in (select id from tgt)),
    'last_trade',    (select max(traded_on) from public.trades        where team_id in (select id from tgt))
  );
$function$;

CREATE OR REPLACE FUNCTION public.contest_settings()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'current_gen',     current_gen,
    'fx_fixed',        fx_fixed,
    'min_auto_trades', min_auto_trades,
    'scan_start',      scan_start,
    'universe_on',     public.universe_on(),
    'universe_n',      (select count(*) from public.universe)
  )
  from public.app_settings where id = 1;
$function$;

CREATE OR REPLACE FUNCTION public.contest_state()
  RETURNS TABLE (
    gen       integer,
    starts_at timestamp with time zone,
    ends_at   timestamp with time zone,
    fx_fixed  numeric,
    closed    boolean,
    my_team   bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select c.gen, c.starts_at, c.ends_at, c.fx_fixed,
         (now() >= c.ends_at) as closed,
         public.my_team_id() as my_team
    from public.contest c
   order by c.gen desc
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.crypto_pool_list()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object('symbol', symbol, 'name', name)
         order by symbol), '[]'::json)
  from public.crypto_pool
  where enabled
    and (auth.uid() is null or public.can_use_terminal());
$function$;

CREATE OR REPLACE FUNCTION public.dart_fetch (
  p_url text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  r extensions.http_response;
begin
  if p_url !~ '^https://opendart\.fss\.or\.kr/api/' then
    raise exception 'DART 주소만 호출할 수 있습니다.';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');

  select * into r from extensions.http_get(p_url);

  if r.status >= 400 then
    raise exception 'DART 응답 오류 (%)', r.status;
  end if;

  return r.content;
end $function$;

CREATE OR REPLACE FUNCTION public.display_name (
  p_nick text,
  p_name text,
  p_sid  text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  /*  ⚠️ 학번 20241234 는 «24학번» 입니다. 앞 두 글자(20)가 아니라
      <입학 연도의 뒤 두 자리> 입니다. 학회 홈페이지의 safe_entry_year
      와 같은 규칙을 씁니다 — 두 곳이 다른 숫자를 보이면 안 됩니다.    */
  select coalesce(
    nullif(btrim(coalesce(p_nick, '')), ''),
    nullif(btrim(coalesce(p_name, '')), ''),
    nullif(case when length(d) >= 4 and substring(d, 1, 4) ~ '^(19|20)\d{2}$'
                then substring(d, 3, 2) else left(d, 2) end, '') || '학번',
    '이름 없음')
  from (select regexp_replace(coalesce(p_sid, ''), '\D', '', 'g') as d) t;
$function$;

CREATE OR REPLACE FUNCTION public.dividend_upsert (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int := 0;
begin
  insert into public.dividends
    (team_id, market, symbol, name, per_share, qty, gross, tax, net, fx,
     ex_date, record_date, pay_date, source)
  select (x ->> 'team_id')::bigint,
         upper(x ->> 'market'),
         x ->> 'symbol',
         nullif(btrim(coalesce(x ->> 'name', '')), ''),
         (x ->> 'per_share')::numeric,
         (x ->> 'qty')::numeric,
         (x ->> 'gross')::numeric,
         coalesce((x ->> 'tax')::numeric, 0),
         (x ->> 'net')::numeric,
         coalesce((x ->> 'fx')::numeric, 1),
         nullif(x ->> 'ex_date', '')::date,
         nullif(x ->> 'record_date', '')::date,
         (x ->> 'pay_date')::date,
         coalesce(nullif(x ->> 'source', ''), 'auto')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
   where (x ->> 'per_share')::numeric > 0
     and (x ->> 'qty')::numeric > 0
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.fx_rate (
  p_date date DEFAULT NULL::date
)
  RETURNS numeric
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(
    (select close from public.price_cache
      where market = 'FX' and symbol = 'USDKRW'
        and (p_date is null or on_date <= p_date)
      order by on_date desc limit 1),
    (select close from public.price_cache
      where market = 'FX' and symbol = 'USDKRW'
      order by on_date desc limit 1)
  );
$function$;

CREATE OR REPLACE FUNCTION public.fx_status()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'rows',   (select count(*) from public.price_cache where market='FX' and symbol='USDKRW'),
    'latest', (select max(on_date) from public.price_cache where market='FX' and symbol='USDKRW'),
    'rate',   public.fx_rate(null)
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_strategy_universe()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare s jsonb; mk text; sy text;
begin
  for s in select * from jsonb_array_elements(coalesce(new.config -> 'symbols', '[]'::jsonb)) loop
    mk := s ->> 'market'; sy := s ->> 'symbol';
    if sy is not null and sy <> '' and not public.in_universe_ever(mk, sy) then
      raise exception '허용 종목이 아닙니다: % %. 학회가 정한 종목 안에서만 전략을 짤 수 있습니다.', mk, sy;
    end if;
  end loop;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_universe()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.side = 'sell' then
    return new;
  end if;

  if coalesce(new.source, 'manual') = 'auto' then
    if not public.in_universe(new.market, new.symbol) then
      raise exception '자동매매는 학회가 정한 명단 안에서만 삽니다: % %. (직접 매매는 제한이 없습니다)',
        new.market, new.symbol;
    end if;
    return new;
  end if;

  if not public.is_tradable(new.market, new.symbol) then
    raise exception '살 수 없는 종목입니다: % %. 상장 종목 명단에 없습니다. (매도는 언제든 가능합니다)',
      new.market, new.symbol;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  begin
    insert into public.profiles (id, student_id, gen, role, status)
    values (
      new.id,
      case when new.email like '%@safe.sogang'
           then split_part(new.email, '@', 1) else null end,
      (select current_gen from public.app_settings where id = 1),
      'member',
      'active'
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'profiles 자동 등록 실패: %', sqlerrm;
  end;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.in_team (
  p_team_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select public.is_officer() or exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.in_universe (
  p_market text,
  p_symbol text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select not public.universe_on()
      or exists (select 1 from public.universe
                  where market = p_market and symbol = p_symbol and active);
$function$;

CREATE OR REPLACE FUNCTION public.in_universe_ever (
  p_market text,
  p_symbol text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select not public.universe_on()
      or exists (select 1 from public.universe
                  where market = p_market and symbol = p_symbol);
$function$;

CREATE OR REPLACE FUNCTION public.is_officer()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'officer' and status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tradable (
  p_market text,
  p_symbol text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select
    not exists (select 1 from public.tradable where market = p_market and active)
    or exists (
      select 1 from public.tradable
       where market = p_market
         and symbol = case when p_market = 'KR' then p_symbol else upper(p_symbol) end
         and active)
    --  자동매매 명단에 있는 종목은 언제나 살 수 있습니다
    or public.in_universe(p_market, p_symbol);
$function$;

CREATE OR REPLACE FUNCTION public.leaderboard()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(row_to_json(x) order by x.pnl_pct desc), '[]'::json)
  from (
    select t.id, t.name,
           (public.team_state(t.id) ->> 'total')::numeric   as total,
           (public.team_state(t.id) ->> 'pnl')::numeric     as pnl,
           (public.team_state(t.id) ->> 'pnl_pct')::numeric as pnl_pct
    from public.teams t
    where t.gen = (select current_gen from public.app_settings where id = 1)
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.league_board()
  RETURNS TABLE (
    team_id   bigint,
    team_name text,
    gen       integer,
    seed      numeric,
    cash      numeric,
    holdings  numeric,
    total     numeric,
    pnl       numeric,
    pnl_pct   numeric,
    members   integer,
    auto_on   boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
with fx as (
  select coalesce((select fx_fixed from public.contest order by gen desc limit 1), 1400) as rate
),
--  종목별 순매수 수량과 들어간 돈
pos as (
  select t.team_id, t.market, t.symbol,
         sum(case when t.side = 'buy' then t.qty else -t.qty end) as qty,
         sum(case when t.side = 'buy' then t.qty * t.price + t.fee
                  else -(t.qty * t.price - t.fee) end) as cost
    from public.trades t
   group by 1,2,3
),
--  마지막 시세 (price_cache 가 채워둔 값)
--  종목마다 가장 최근 종가 하나씩. price_cache 의 날짜 칸은 on_date 입니다.
px as (
  select distinct on (p.market, p.symbol)
         p.market, p.symbol, p.close as last
    from public.price_cache p
   order by p.market, p.symbol, p.on_date desc
),
val as (
  select pos.team_id,
         sum(case when pos.qty > 0 then
              pos.qty * coalesce(px.last, 0)
              * case when pos.market = 'KR' then 1 else (select rate from fx) end
             else 0 end) as holdings,
         sum(pos.cost * case when pos.market = 'KR' then 1
                             else (select rate from fx) end) as spent
    from pos left join px on px.market = pos.market and px.symbol = pos.symbol
   group by 1
)
select tm.id, tm.name, tm.gen, tm.seed,
       tm.seed - coalesce(v.spent, 0)                         as cash,
       coalesce(v.holdings, 0)                                as holdings,
       tm.seed - coalesce(v.spent, 0) + coalesce(v.holdings, 0) as total,
       coalesce(v.holdings, 0) - coalesce(v.spent, 0)          as pnl,
       case when tm.seed > 0
            then (coalesce(v.holdings, 0) - coalesce(v.spent, 0)) / tm.seed * 100
            else 0 end                                        as pnl_pct,
       (select count(*)::int from public.team_members m where m.team_id = tm.id) as members,
       tm.auto_on
  from public.teams tm
  left join val v on v.team_id = tm.id
 where tm.gen = (select max(gen) from public.teams)
 order by pnl_pct desc;
$function$;

CREATE OR REPLACE FUNCTION public.meeting_docs_list()
  RETURNS TABLE (
    id         bigint,
    title      text,
    meeting_on date,
    note       text,
    path       text,
    bytes      bigint,
    by_name    text,
    created_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select d.id, d.title, d.meeting_on, d.note, d.path, d.bytes,
         coalesce(p.name, '—') as by_name, d.created_at
  from public.meeting_docs d
  left join public.profiles p on p.id = d.uploaded_by
  where public.can_use_terminal()
  order by coalesce(d.meeting_on, d.created_at::date) desc, d.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.member_label_list()
  RETURNS json
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not public.is_officer() then
    raise exception '임원진만 볼 수 있습니다.';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id',         id,
      'student_id', student_id,
      'name',       name,
      'nickname',   nickname,
      'label',      public.display_name(nickname, name, student_id),
      'gen',        gen,
      'role',       role,
      'status',     status)
      order by gen nulls last, student_id)
    from public.profiles), '[]'::json);
end $function$;

CREATE OR REPLACE FUNCTION public.member_label_set (
  p_id       uuid,
  p_nickname text
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v text; v_row public.profiles%rowtype;
begin
  if not public.is_officer() then
    raise exception '임원진만 이름표를 바꿀 수 있습니다.';
  end if;

  --  보이지 않는 글자(줄바꿈·탭 등)는 지웁니다 — 표가 깨집니다
  v := nullif(btrim(regexp_replace(coalesce(p_nickname, ''), '[[:cntrl:]]', '', 'g')), '');

  if v is not null and char_length(v) > 20 then
    raise exception '이름표는 20자까지입니다. (지금 %자)', char_length(v);
  end if;

  /*  ⚠️ 같은 이름표가 둘이면 매매 기록에서 누가 누군지 모릅니다.
      막아 둡니다. 비우는 것(null)은 여럿이어도 괜찮습니다.        */
  if v is not null and exists (
       select 1 from public.profiles
        where id <> p_id and lower(btrim(coalesce(nickname, ''))) = lower(v)) then
    raise exception '「%」 는 이미 다른 학회원이 쓰고 있습니다.', v;
  end if;

  update public.profiles set nickname = v where id = p_id
  returning * into v_row;
  if not found then
    raise exception '그런 계정이 없습니다.';
  end if;

  return json_build_object(
    'id', v_row.id, 'student_id', v_row.student_id,
    'nickname', v_row.nickname,
    'label', public.display_name(v_row.nickname, v_row.name, v_row.student_id));
end $function$;

CREATE OR REPLACE FUNCTION public.mt_call_edge (
  p_body jsonb
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  cfg private_warm_cfg;
  req_id bigint;
begin
  select * into cfg from private_warm_cfg where id = 1;
  if cfg is null then return null; end if;

  select net.http_post(
    url     := cfg.project_url || '/functions/v1/market-data',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'apikey',        cfg.anon_key,
                 'Authorization', 'Bearer ' || cfg.anon_key),
    body    := p_body || jsonb_build_object('token', cfg.warm_token),
    timeout_milliseconds := 150000
  ) into req_id;

  return req_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mt_place_trade (
  p_team_id    bigint,
  p_market     text,
  p_symbol     text,
  p_name       text,
  p_side       text,
  p_qty        numeric,
  p_price      numeric,
  p_fee        numeric,
  p_fx         numeric,
  p_source     text    DEFAULT 'manual'::text,
  p_fill_basis text    DEFAULT NULL::text,
  p_rule_name  text    DEFAULT NULL::text,
  p_by         uuid    DEFAULT NULL::uuid
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_seed  numeric;
  v_cash  numeric;
  v_held  numeric;
  v_rate  numeric;
  v_need  numeric;
  v_id    bigint;
  v_by    uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception '수량을 입력해주세요.';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception '체결가를 구하지 못했습니다.';
  end if;
  if p_side not in ('buy', 'sell') then
    raise exception '매수/매도 구분이 올바르지 않습니다.';
  end if;

  /*  누가 눌렀나.
      ⚠️ 예전에는 여기서 auth.uid() 를 그대로 썼습니다. 그런데 이 함수는
         Edge Function 이 service_role 로 부르기 때문에 auth.uid() 가
         <늘 null> 이었습니다 — created_by 칸이 있는데도 비어 있었던 이유.
         이제 Edge 가 <로그인 토큰에서 확인한> 사람을 넘겨줍니다.
         SQL 편집기에서 직접 부를 때만 auth.uid() 로 떨어집니다.        */
  v_by := coalesce(p_by, auth.uid());

  --  ── 여기가 핵심 ──
  --  이 팀 줄을 잠급니다. 같은 팀의 다음 주문은 이 함수가 끝날 때까지
  --  기다립니다. 다른 팀은 다른 줄이라 아무도 안 기다립니다.
  select t.seed into v_seed
  from public.teams t
  where t.id = p_team_id
  for update;

  if v_seed is null then
    raise exception '팀을 찾지 못했습니다.';
  end if;

  --  국내는 환율 1, 그 밖은 넘겨받은 고정 환율
  v_rate := case when upper(p_market) = 'KR' then 1 else coalesce(p_fx, 1) end;

  --  ── 남은 현금 ──
  --  거래마다 <그때 쓴 환율> 로 셉니다. 나중에 환율이 바뀌어도
  --  예전 거래의 원화 금액이 흔들리면 안 됩니다.
  select v_seed
       - coalesce(sum(
           case when t.side = 'buy'
                then (t.qty * t.price + t.fee)
                     * (case when t.market = 'KR' then 1 else coalesce(t.fx, 1) end)
                else -((t.qty * t.price - t.fee)
                     * (case when t.market = 'KR' then 1 else coalesce(t.fx, 1) end))
           end), 0)
    into v_cash
  from public.trades t
  where t.team_id = p_team_id;

  if p_side = 'buy' then
    v_need := (p_qty * p_price + coalesce(p_fee, 0)) * v_rate;
    --  1원은 반올림 오차 몫입니다
    if v_need > v_cash + 1 then
      raise exception '현금이 모자랍니다. 필요 %원, 남은 현금 %원.',
        to_char(round(v_need), 'FM999,999,999,999'),
        to_char(round(v_cash), 'FM999,999,999,999');
    end if;
  else
    select coalesce(sum(case when t.side = 'buy' then t.qty else -t.qty end), 0)
      into v_held
    from public.trades t
    where t.team_id = p_team_id
      and t.market  = upper(p_market)
      and t.symbol  = upper(p_symbol);

    if coalesce(v_held, 0) + 1e-9 < p_qty then
      raise exception '보유 수량이 모자랍니다. 가진 수량 %.',
        trim(to_char(coalesce(v_held, 0), 'FM999999990.####'));
    end if;
  end if;

  insert into public.trades
    (team_id, market, symbol, name, side, qty, price, fee, fx,
     traded_on, traded_at, source, fill_basis, rule_name, created_by)
  values
    (p_team_id, upper(p_market), upper(p_symbol), p_name, p_side,
     p_qty, p_price, coalesce(p_fee, 0), v_rate,
     (now() at time zone 'Asia/Seoul')::date, now(),
     coalesce(p_source, 'manual'), p_fill_basis, p_rule_name, v_by)
  returning id into v_id;

  return json_build_object(
    'id',         v_id,
    'team_id',    p_team_id,
    'market',     upper(p_market),
    'symbol',     upper(p_symbol),
    'name',       p_name,
    'side',       p_side,
    'qty',        p_qty,
    'price',      p_price,
    'fee',        coalesce(p_fee, 0),
    'fx',         v_rate,
    'source',     coalesce(p_source, 'manual'),
    'fill_basis', p_fill_basis,
    'by',         v_by,
    'cash_left',  round(v_cash - (case when p_side = 'buy'
                                       then (p_qty * p_price + coalesce(p_fee, 0)) * v_rate
                                       else -((p_qty * p_price - coalesce(p_fee, 0)) * v_rate) end), 2)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.my_profile()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'student_id',  p.student_id,
    'name',        p.name,
    'gen',         p.gen,
    'role',        p.role,
    'position',    p.position,
    'status',      p.status,
    'current_gen', s.current_gen,
    'allowed',     public.can_use_terminal()
  )
  from public.profiles p cross join public.app_settings s
  where p.id = auth.uid() and s.id = 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_team_id()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select team_id from public.team_members where user_id = auth.uid() limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_teams()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(row_to_json(t) order by t.name), '[]'::json)
  from (
    select tm.id, tm.name, tm.gen, tm.seed, tm.is_open, tm.started_on
    from public.teams tm
    where tm.gen = (select current_gen from public.app_settings where id = 1)
      and (public.is_officer()
           or exists (select 1 from public.team_members m
                      where m.team_id = tm.id and m.user_id = auth.uid()))
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.one_default_theme()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  if new.is_default then
    update public.chart_themes set is_default = false where id <> new.id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.presence_list (
  p_minutes integer DEFAULT 5
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with lim as (select greatest(1, least(coalesce(p_minutes, 5), 120)) as m),
  p as (
    select pr.user_id, pr.device_id, pr.device, pr.last_seen
      from public.member_presence pr
     where public.is_officer()
  ),
  agg as (
    select pf.id, pf.name, pf.nickname, pf.gen, pf.role, pf.student_id,
           max(p.last_seen) as last_seen,
           count(*) filter (where p.last_seen > now() - make_interval(mins => (select m from lim)))
             as devices_now,
           count(*) filter (where p.last_seen > now() - interval '7 days') as devices_7d,
           coalesce(
             json_agg(json_build_object('device', p.device, 'at', p.last_seen)
                      order by p.last_seen desc)
             filter (where p.last_seen > now() - interval '7 days'), '[]'::json) as list
      from public.profiles pf
      left join p on p.user_id = pf.id
     where public.is_officer()
       and pf.status = 'active'
       and pf.gen = coalesce((select current_gen from public.app_settings where id = 1), pf.gen)
     group by pf.id, pf.name, pf.nickname, pf.gen, pf.role, pf.student_id
  )
  select json_build_object(
    'ok', public.is_officer(),
    'minutes', (select m from lim),
    'now', now(),
    'rows', coalesce((
      select json_agg(json_build_object(
        'name', public.display_name(nickname, name, student_id), 'gen', gen, 'role', role,
        --  ⚠️ 학번은 통째로 안 내려보냅니다 (접속 기록 원칙과 같습니다)
        'sid2', right(coalesce(student_id, ''), 0) || left(coalesce(student_id, ''), 2),
        'last_seen', last_seen,
        'devices_now', devices_now,
        'devices_7d', devices_7d,
        'status', case
          when last_seen is null then 'never'
          when devices_now > 0 then 'online'
          when last_seen > now() - interval '30 minutes' then 'idle'
          else 'offline' end,
        'devices', list)
        order by (case when devices_now > 0 then 0 else 1 end),
                 last_seen desc nulls last, name)
      from agg), '[]'::json)
  );
$function$;

CREATE OR REPLACE FUNCTION public.presence_ping (
  p_device_id text,
  p_device    text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if not public.can_use_terminal() then return; end if;
  --  기기 번호가 없거나 이상하면 조용히 넘어갑니다 (화면을 막지 않습니다)
  if p_device_id is null or length(p_device_id) < 4 or length(p_device_id) > 64 then
    return;
  end if;
  insert into public.member_presence (user_id, device_id, device, first_seen, last_seen)
  values (me, p_device_id, left(coalesce(p_device, ''), 40), now(), now())
  on conflict (user_id, device_id) do update
     set last_seen = now(),
         device    = left(coalesce(excluded.device, member_presence.device), 40);
end $function$;

CREATE OR REPLACE FUNCTION public.presence_prune (
  p_days integer DEFAULT 60
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int;
begin
  if not public.is_officer() then
    raise exception '임원진만 실행할 수 있습니다.';
  end if;
  delete from public.member_presence
   where last_seen < now() - make_interval(days => greatest(7, least(coalesce(p_days, 60), 365)));
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.price_bulk (
  p_since date DEFAULT NULL::date
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_object_agg(k, pts), '{}'::json)
  from (
    select p.market || '|' || p.symbol as k,
           json_agg(json_build_array(p.on_date, p.close) order by p.on_date) as pts
      from public.price_cache p
      join public.universe u
        on u.market = p.market and u.symbol = p.symbol and u.active
     where public.can_use_terminal()
       and p.on_date >= coalesce(p_since, current_date - 400)
     group by p.market, p.symbol
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.price_bulk_upsert (
  p_rows jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int := 0;
begin
  insert into public.price_cache (market, symbol, on_date, close, name)
  select x ->> 'market',
         case when x ->> 'market' = 'KR' then x ->> 'symbol' else upper(x ->> 'symbol') end,
         (x ->> 'd')::date,
         (x ->> 'v')::numeric,
         nullif(btrim(coalesce(x ->> 'name', '')), '')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
   where coalesce(x ->> 'v', '') <> '' and (x ->> 'v')::numeric > 0
  on conflict (market, symbol, on_date) do update
     set close = excluded.close,
         name  = coalesce(excluded.name, public.price_cache.name),
         updated_at = now();

  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.price_stale (
  p_market text,
  p_limit  integer DEFAULT 8
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object('symbol', u.symbol, 'name', u.name)
         order by last_day nulls first, u.rank), '[]'::json)
  from (
    select u.symbol, u.name, u.rank,
           (select max(on_date) from public.price_cache p
             where p.market = u.market and p.symbol = u.symbol) as last_day
      from public.universe u
     where u.market = p_market and u.active
  ) u
  where last_day is null or last_day < current_date - 1
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$function$;

CREATE OR REPLACE FUNCTION public.record_snapshot (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare s json; d date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.can_use_terminal() then
    raise exception '권한이 없습니다.';
  end if;

  s := public.team_state(p_team_id);
  if s is null then return null; end if;

  insert into public.portfolio_snapshots (team_id, on_date, cash, holdings_value, total)
  values (p_team_id, d,
          (s ->> 'cash')::numeric, (s ->> 'holdings')::numeric, (s ->> 'total')::numeric)
  on conflict (team_id, on_date) do update
    set cash = excluded.cash,
        holdings_value = excluded.holdings_value,
        total = excluded.total,
        recorded_at = now();

  return s;
end $function$;

CREATE OR REPLACE FUNCTION public.record_visit (
  p_visitor text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v text := left(btrim(coalesce(p_visitor, '')), 64);
begin
  if v = '' then return; end if;
  insert into public.page_views (visited_on, visitor, views)
  values ((now() at time zone 'Asia/Seoul')::date, v, 1)
  on conflict (visited_on, visitor)
  do update set views = public.page_views.views + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.replace_snapshots (
  p_team_id bigint,
  p_rows    jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int;
begin
  if not public.in_team(p_team_id) then
    raise exception '이 팀의 기록을 수정할 권한이 없습니다.';
  end if;

  delete from public.portfolio_snapshots where team_id = p_team_id;

  insert into public.portfolio_snapshots (team_id, on_date, cash, holdings_value, total)
  select p_team_id,
         (e ->> 'd')::date,
         (e ->> 'cash')::numeric,
         (e ->> 'holdings')::numeric,
         (e ->> 'total')::numeric
  from jsonb_array_elements(p_rows) e
  on conflict (team_id, on_date) do update
    set cash = excluded.cash,
        holdings_value = excluded.holdings_value,
        total = excluded.total,
        recorded_at = now();

  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.reset_log_list (
  p_limit integer DEFAULT 20
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce((
    select json_agg(json_build_object(
      'at', at, 'by', by_name, 'scope', scope, 'seed', seed,
      'starts_at', starts_at, 'ends_at', ends_at,
      'deleted', deleted, 'note', note) order by at desc)
    from (select * from public.reset_log
           where public.is_officer()
           order by at desc
           limit greatest(1, least(coalesce(p_limit, 20), 100))) r), '[]'::json);
$function$;

CREATE OR REPLACE FUNCTION public.safe_entry_year (
  p_student_id text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select case
    when length(d) >= 4 and substring(d, 1, 4) ~ '^(19|20)\d{2}$'
      then substring(d, 3, 2)
    else left(d, 2)
  end
  from (select regexp_replace(coalesce(p_student_id, ''), '\D', '', 'g') as d) t;
$function$;

CREATE OR REPLACE FUNCTION public.safe_sync_member (
  p_member_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  update public.members m
  set entry_year = public.safe_entry_year(i.student_id),
      person_key = md5(
        lower(trim(m.name)) || '|' ||
        lower(trim(m.dept)) || '|' ||
        regexp_replace(i.student_id, '\D', '', 'g')
      )
  from public.member_ids i
  where i.member_id = m.id
    and m.id = p_member_id;
end $function$;

CREATE OR REPLACE FUNCTION public.safe_trg_member_ids()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin perform public.safe_sync_member(new.member_id); return new; end $function$;

CREATE OR REPLACE FUNCTION public.safe_trg_members()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin perform public.safe_sync_member(new.id); return new; end $function$;

CREATE OR REPLACE FUNCTION public.scoreboard()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object(
           'id', t.id, 'name', t.name, 'mode', t.mode,
           'state', public.team_state(t.id),
           'score', public.team_scorecard(t.id)
         ) order by t.name), '[]'::json)
  from public.teams t
  where t.gen = (select current_gen from public.app_settings where id = 1);
$function$;

CREATE OR REPLACE FUNCTION public.symbol_find (
  q   text,
  lim integer DEFAULT 12
)
  RETURNS TABLE (
    market    text,
    symbol    text,
    name      text,
    src       text,
    kind      text,
    leveraged boolean,
    scannable boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with needle as (select upper(btrim(coalesce(q, ''))) as u, btrim(coalesce(q, '')) as t)
  select t.market, t.symbol, t.name, 'tradable'::text as src,
         t.kind, t.leveraged,
         public.in_universe(t.market, t.symbol) as scannable
    from public.tradable t, needle n
   where n.t <> '' and t.active
     and (t.symbol like n.u || '%' or t.name ilike '%' || n.t || '%')
   order by (t.symbol = n.u) desc,                    -- 티커가 딱 맞으면 맨 위
            (t.symbol like n.u || '%') desc,
            public.in_universe(t.market, t.symbol) desc,
            length(t.symbol), t.symbol
   limit greatest(1, least(50, lim));
$function$;

CREATE OR REPLACE FUNCTION public.symbol_find_uni (
  q   text,
  lim integer DEFAULT 12
)
  RETURNS TABLE (
    market    text,
    symbol    text,
    name      text,
    src       text,
    kind      text,
    leveraged boolean,
    scannable boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with needle as (select btrim(coalesce(q, '')) as t)
  select u.market, u.symbol, u.name, 'universe'::text,
         'stock'::text, false, true
    from public.universe u, needle n
   where n.t <> '' and u.active
     and (u.symbol ilike n.t || '%' or u.name ilike '%' || n.t || '%')
   order by (u.symbol ilike n.t || '%') desc, length(u.symbol), u.symbol
   limit greatest(1, least(50, lim));
$function$;

CREATE OR REPLACE FUNCTION public.team_dividends (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with mine as (
    select * from public.dividends d
     where d.team_id = p_team_id
       and (public.in_team(p_team_id) or public.is_officer())
  ), ct as (
    select coalesce(max(ends_at), now() + interval '90 days') as ends_at
      from public.contest
  )
  select json_build_object(
    'paid_krw',     coalesce((select sum(net * fx) from mine
                               where pay_date <= current_date), 0),
    'coming_krw',   coalesce((select sum(net * fx) from mine
                               where pay_date > current_date
                                 and pay_date <= (select ends_at::date from ct)), 0),
    'later_krw',    coalesce((select sum(net * fx) from mine
                               where pay_date > (select ends_at::date from ct)), 0),
    'tax_krw',      coalesce((select sum(tax * fx) from mine
                               where pay_date <= current_date), 0),
    'ends_on',      (select ends_at::date from ct),
    'rows', coalesce((select json_agg(x order by x.pay_date desc)
                        from (select market, symbol, name, per_share, qty,
                                     gross, tax, net, fx,
                                     ex_date, record_date, pay_date,
                                     (pay_date <= current_date) as paid
                                from mine) x), '[]'::json)
  );
$function$;

CREATE OR REPLACE FUNCTION public.team_history (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object(
           'd', on_date, 'total', total, 'cash', cash, 'holdings', holdings_value)
         order by on_date), '[]'::json)
  from public.portfolio_snapshots where team_id = p_team_id;
$function$;

CREATE OR REPLACE FUNCTION public.team_positions (
  p_team_id bigint
)
  RETURNS TABLE (
    market       text,
    symbol       text,
    name         text,
    ccy          text,
    qty          numeric,
    avg_cost     numeric,
    avg_cost_krw numeric,
    last_price   numeric,
    fx           numeric,
    market_value numeric,
    cost_value   numeric,
    pnl          numeric,
    pnl_pct      numeric
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with fx as (
    select coalesce((select fx_fixed from public.contest order by gen desc limit 1), 1400) as rate
  ),
  --  종목별 순보유 수량과 들어간 돈 (수수료 포함, 원래 통화 기준)
  pos as (
    select t.market, t.symbol,
           max(t.name) as name,
           sum(case when t.side = 'buy' then t.qty else -t.qty end) as qty,
           sum(case when t.side = 'buy' then  (t.qty * t.price + coalesce(t.fee,0))
                                        else -(t.qty * t.price - coalesce(t.fee,0)) end) as cost
      from public.trades t
     where t.team_id = p_team_id
     group by 1, 2
  ),
  --  종목마다 가장 최근 종가 하나씩
  px as (
    select distinct on (p.market, p.symbol) p.market, p.symbol, p.close as last
      from public.price_cache p
     order by p.market, p.symbol, p.on_date desc
  )
  select pos.market,
         pos.symbol,
         pos.name,
         case when pos.market = 'KR' then 'KRW' else 'USD' end as ccy,
         pos.qty,
         case when pos.qty > 0 then pos.cost / pos.qty else 0 end          as avg_cost,
         case when pos.qty > 0
              then pos.cost / pos.qty
                 * case when pos.market = 'KR' then 1 else (select rate from fx) end
              else 0 end                                                   as avg_cost_krw,
         px.last                                                           as last_price,
         case when pos.market = 'KR' then 1 else (select rate from fx) end as fx,
         --  평가액·원가·손익은 모두 <원화> 입니다. 화면이 원으로 보여줍니다.
         pos.qty * coalesce(px.last, 0)
           * case when pos.market = 'KR' then 1 else (select rate from fx) end as market_value,
         pos.cost
           * case when pos.market = 'KR' then 1 else (select rate from fx) end as cost_value,
         (pos.qty * coalesce(px.last, 0) - pos.cost)
           * case when pos.market = 'KR' then 1 else (select rate from fx) end as pnl,
         case when pos.cost > 0
              then (pos.qty * coalesce(px.last, 0) / pos.cost - 1) * 100
              else 0 end                                                   as pnl_pct
    from pos left join px on px.market = pos.market and px.symbol = pos.symbol
   where pos.qty > 0
   order by 12 desc;
$function$;

CREATE OR REPLACE FUNCTION public.team_scorecard (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_seed numeric; v_rows int; v_first numeric; v_last numeric;
  v_mu numeric; v_sd numeric; v_sharpe numeric; v_mdd numeric;
  v_rev int; v_exp jsonb; v_exp_ret numeric; v_from date; v_base numeric;
  v_actual numeric;
begin
  select seed into v_seed from public.teams where id = p_team_id;
  if v_seed is null then return null; end if;

  select count(*) into v_rows from public.portfolio_snapshots where team_id = p_team_id;

  -- 일별 수익률로 평균·표준편차 (연 252거래일 환산)
  with s as (
    select on_date, total,
           lag(total) over (order by on_date) as prev
    from public.portfolio_snapshots where team_id = p_team_id
  ), r as (
    select (total / nullif(prev, 0) - 1) as ret
    from s where prev is not null and prev > 0
  )
  select avg(ret), stddev_samp(ret) into v_mu, v_sd from r;

  v_sharpe := case when v_sd is not null and v_sd > 0
                   then (v_mu * 252) / (v_sd * sqrt(252)) else null end;

  -- 최대 낙폭
  with s as (
    select total, max(total) over (order by on_date rows between unbounded preceding and current row) as peak
    from public.portfolio_snapshots where team_id = p_team_id
  )
  select min(case when peak > 0 then (total / peak - 1) * 100 else 0 end) into v_mdd from s;

  select total into v_first from public.portfolio_snapshots
   where team_id = p_team_id order by on_date limit 1;
  select total into v_last  from public.portfolio_snapshots
   where team_id = p_team_id order by on_date desc limit 1;

  -- 전략 수정 횟수와 가장 최근 기대치
  select count(*) into v_rev from public.strategies where team_id = p_team_id;
  select expect, effective_from into v_exp, v_from
    from public.strategies where team_id = p_team_id
    order by effective_from desc, id desc limit 1;

  v_exp_ret := nullif(v_exp ->> 'ret', '')::numeric;

  -- 그 전략이 적용된 뒤의 실제 수익률
  if v_from is not null then
    select total into v_base from public.portfolio_snapshots
     where team_id = p_team_id and on_date <= v_from order by on_date desc limit 1;
    if v_base is null then
      select total into v_base from public.portfolio_snapshots
       where team_id = p_team_id order by on_date limit 1;
    end if;
    if v_base is not null and v_base > 0 and v_last is not null then
      v_actual := (v_last / v_base - 1) * 100;
    end if;
  end if;

  return json_build_object(
    'days',        v_rows,
    'ret',         case when v_seed > 0 and v_last is not null
                        then round((v_last / v_seed - 1) * 100, 2) else null end,
    'sharpe',      round(v_sharpe, 2),
    'mdd',         round(v_mdd, 2),
    'revisions',   v_rev,
    'expect_ret',  round(v_exp_ret, 2),
    'actual_ret',  round(v_actual, 2),
    'gap',         case when v_exp_ret is not null and v_actual is not null
                        then round(v_actual - v_exp_ret, 2) else null end,
    'since',       v_from
  );
end $function$;

CREATE OR REPLACE FUNCTION public.team_state (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select case when b.team_id is null then null else json_build_object(
    'team_id',    b.team_id,
    'team_name',  b.team_name,
    'gen',        b.gen,
    'started_on', (select started_on from public.teams where id = p_team_id),
    'seed',       b.seed,
    'cash',       round(b.cash, 2),
    'holdings',   round(b.holdings, 2),
    'total',      round(b.total, 2),
    'pnl',        round(b.pnl, 2),
    'pnl_pct',    round(b.pnl_pct, 2),
    'fx',         coalesce((select fx_fixed from public.contest order by gen desc limit 1), 1400),
    'positions',  (select coalesce(json_agg(row_to_json(p)), '[]'::json)
                     from public.team_positions(p_team_id) p)
  ) end
  from (select * from public.league_board() where team_id = p_team_id) b
  right join (select 1) dummy on true
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.team_strategies (
  p_team_id bigint
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object(
           'id', id, 'name', name, 'config', config,
           'effective_from', effective_from, 'created_at', created_at)
         order by effective_from, id), '[]'::json)
  from public.strategies where team_id = p_team_id;
$function$;

CREATE OR REPLACE FUNCTION public.team_trades (
  p_team_id bigint,
  p_limit   integer DEFAULT 200
)
  RETURNS json
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_who boolean;
begin
  v_who := public.is_officer() or public.in_team(p_team_id);
  return coalesce((
    select json_agg(x order by (x->>'traded_at') desc)
    from (
      select json_build_object(
        'id', t.id, 'market', t.market, 'symbol', t.symbol, 'name', t.name,
        'side', t.side, 'qty', t.qty, 'price', t.price, 'fee', t.fee,
        'source', t.source, 'fill_basis', t.fill_basis,
        'traded_on', t.traded_on, 'traded_at', t.traded_at,
        --  ⚠️ 남의 팀 방에서는 이름을 안 내려보냅니다
        'by_name', case when v_who and t.source <> 'auto'
                        then public.display_name(p.nickname, p.name, p.student_id)
                        else null end) as x
      from public.trades t
      left join public.profiles p on p.id = t.created_by
      where t.team_id = p_team_id
      order by t.traded_at desc, t.id desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) s), '[]'::json);
end $function$;

CREATE OR REPLACE FUNCTION public.tradable_bulk_replace (
  p_market text,
  p_rows   jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int := 0;
begin
  if p_market not in ('KR','US','CRYPTO') then
    raise exception '시장 구분이 잘못되었습니다: %', p_market;
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception '빈 명단으로는 갈아끼우지 않습니다 (% 시장)', p_market;
  end if;

  update public.tradable set active = false, updated_at = now()
   where market = p_market and active;

  insert into public.tradable (market, symbol, name, kind, leveraged, active, updated_at)
  select p_market,
         case when p_market = 'KR' then x ->> 'symbol' else upper(x ->> 'symbol') end,
         nullif(btrim(coalesce(x ->> 'name','')), ''),
         coalesce(nullif(x ->> 'kind',''), 'stock'),
         coalesce((x ->> 'leveraged')::boolean, false),
         true, now()
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
   where coalesce(x ->> 'symbol','') <> ''
  on conflict (market, symbol) do update
     set name       = coalesce(excluded.name, public.tradable.name),
         kind       = excluded.kind,
         leveraged  = excluded.leveraged,
         active     = true,
         updated_at = now();

  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.tradable_status()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'us',        (select count(*) from public.tradable where market='US'     and active),
    'us_etf',    (select count(*) from public.tradable where market='US'     and active and kind='etf'),
    'us_lev',    (select count(*) from public.tradable where market='US'     and active and leveraged),
    'kr',        (select count(*) from public.tradable where market='KR'     and active),
    'kr_etf',    (select count(*) from public.tradable where market='KR'     and active and kind='etf'),
    'crypto',    (select count(*) from public.tradable where market='CRYPTO' and active),
    'updated_at',(select max(updated_at) from public.tradable where active),
    'scan_kr',   (select count(*) from public.universe where market='KR'     and active),
    'scan_us',   (select count(*) from public.universe where market='US'     and active),
    'scan_cc',   (select count(*) from public.universe where market='CRYPTO' and active)
  );
$function$;

CREATE OR REPLACE FUNCTION public.universe_auto_replace (
  p_market text,
  p_rows   jsonb,
  p_as_of  date  DEFAULT CURRENT_DATE
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n int := 0;
begin
  if p_market not in ('KR', 'US', 'CRYPTO') then
    raise exception '시장 구분이 잘못되었습니다: %', p_market;
  end if;

  update public.universe
     set active = false
   where market = p_market and auto;

  insert into public.universe (market, symbol, name, auto, active, rank, tr_value, as_of)
  select p_market,
         case when p_market = 'KR' then x ->> 'symbol' else upper(x ->> 'symbol') end,
         nullif(btrim(coalesce(x ->> 'name', '')), ''),
         true, true,
         (x ->> 'rank')::int,
         nullif(x ->> 'tr_value', '')::numeric,
         p_as_of
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
   where coalesce(btrim(x ->> 'symbol'), '') <> ''
  on conflict (market, symbol) do update
     set name     = coalesce(excluded.name, public.universe.name),
         auto     = public.universe.auto or excluded.auto,
         active   = true,
         rank     = excluded.rank,
         tr_value = excluded.tr_value,
         as_of    = excluded.as_of;

  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.universe_bulk (
  p_text    text,
  p_replace boolean DEFAULT false
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  ln text; parts text[]; n int := 0; mk text; sy text; nm text;
begin
  if not public.is_officer() then
    raise exception '임원진만 실행할 수 있습니다.';
  end if;
  if p_replace then delete from public.universe; end if;

  foreach ln in array regexp_split_to_array(coalesce(p_text, ''), E'\n') loop
    ln := btrim(ln);
    continue when ln = '' or ln like '#%';
    parts := regexp_split_to_array(ln, '\s*,\s*');
    if array_length(parts, 1) < 2 then continue; end if;

    mk := upper(btrim(parts[1]));
    sy := btrim(parts[2]);
    nm := case when array_length(parts, 1) >= 3 then btrim(parts[3]) else null end;
    if mk not in ('KR', 'US') or sy = '' then continue; end if;
    if mk = 'US' then sy := upper(sy); end if;

    insert into public.universe (market, symbol, name)
    values (mk, sy, nm)
    on conflict (market, symbol) do update set name = coalesce(excluded.name, public.universe.name);
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.universe_on()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$ select exists (select 1 from public.universe) $function$;

CREATE OR REPLACE FUNCTION public.universe_scan()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_agg(json_build_object(
           'market', market, 'symbol', symbol, 'name', name, 'rank', rank)
         order by market, coalesce(rank, 9999)), '[]'::json)
  from public.universe
  where active
    --  auth.uid() 가 NULL = 로그인한 사람이 없다 = 서버가 부른 것.
    --  아래 revoke 때문에 로그인 안 한 브라우저는 여기까지 못 옵니다.
    and (auth.uid() is null or public.can_use_terminal());
$function$;

CREATE OR REPLACE FUNCTION public.universe_status()
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select json_build_object(
    'kr_active',     (select count(*) from public.universe where market = 'KR' and active),
    'us_active',     (select count(*) from public.universe where market = 'US' and active),
    'crypto_active', (select count(*) from public.universe where market = 'CRYPTO' and active),
    'kr_ever',       (select count(*) from public.universe where market = 'KR'),
    'us_ever',       (select count(*) from public.universe where market = 'US'),
    'crypto_ever',   (select count(*) from public.universe where market = 'CRYPTO'),
    'crypto_pool',   (select count(*) from public.crypto_pool where enabled),
    'manual',        (select count(*) from public.universe where not auto),
    'as_of',         (select max(as_of) from public.universe),
    'priced',        (select count(distinct (market, symbol)) from public.price_cache)
  );
$function$;

CREATE OR REPLACE FUNCTION public.visit_stats()
  RETURNS json
  LANGUAGE sql
  STABLE
  SET search_path TO 'public'
  AS $function$
  with d as (select (now() at time zone 'Asia/Seoul')::date as today)
  select json_build_object(
    'today_visitors', (select count(*)                 from page_views, d where visited_on =  d.today),
    'today_views',    (select coalesce(sum(views), 0)  from page_views, d where visited_on =  d.today),
    'week_visitors',  (select count(distinct visitor)  from page_views, d where visited_on >  d.today - 7),
    'week_views',     (select coalesce(sum(views), 0)  from page_views, d where visited_on >  d.today - 7),
    'month_visitors', (select count(distinct visitor)  from page_views, d where visited_on >  d.today - 30),
    'month_views',    (select coalesce(sum(views), 0)  from page_views, d where visited_on >  d.today - 30),
    'total_visitors', (select count(distinct visitor)  from page_views),
    'total_views',    (select coalesce(sum(views), 0)  from page_views),
    'daily', (select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select visited_on::text as day, count(*)::int as visitors, sum(views)::int as views
        from page_views, d
        where visited_on > d.today - 30
        group by visited_on
        order by visited_on
      ) t)
  );
$function$;

CREATE OR REPLACE FUNCTION public.warm_fred_once()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare
  cfg private_warm_cfg;
  req_id bigint;
begin
  select * into cfg from private_warm_cfg where id = 1;
  if cfg is null then
    raise notice 'private_warm_cfg 가 비어 있습니다 — 1번 단계를 먼저 하세요.';
    return null;
  end if;

  select net.http_post(
    url     := cfg.project_url || '/functions/v1/market-data',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'apikey',        cfg.anon_key,
                 'Authorization', 'Bearer ' || cfg.anon_key),
    body    := jsonb_build_object(
                 'source', 'fred_warm',
                 'token',  cfg.warm_token),
    timeout_milliseconds := 120000
  ) into req_id;

  return req_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.who_names (
  p_ids uuid[]
)
  RETURNS json
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select coalesce(json_object_agg(
           p.id::text,
           public.display_name(p.nickname, p.name, p.student_id)), '{}'::json)
  from public.profiles p
  where p.id = any(coalesce(p_ids, '{}'::uuid[]));
$function$;

ALTER TABLE "public"."access_log"
  ADD CONSTRAINT "access_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."member_presence"
  ADD CONSTRAINT "member_presence_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."member_ids"
  ADD CONSTRAINT "member_ids_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."reset_log"
  ADD CONSTRAINT "reset_log_by_user_fkey" FOREIGN KEY (by_user) REFERENCES auth.users(id);

ALTER TABLE "public"."strategies"
  ADD CONSTRAINT "strategies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."team_members"
  ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."auto_runs"
  ADD CONSTRAINT "auto_runs_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."dividends"
  ADD CONSTRAINT "dividends_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."portfolio_snapshots"
  ADD CONSTRAINT "portfolio_snapshots_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."strategies"
  ADD CONSTRAINT "strategies_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."strategy_runs"
  ADD CONSTRAINT "strategy_runs_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_members"
  ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."trades"
  ADD CONSTRAINT "trades_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."trades"
  ADD CONSTRAINT "trades_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

CREATE INDEX access_log_at_idx ON public.access_log USING btree (at DESC);

CREATE INDEX access_log_user_idx ON public.access_log USING btree (user_id);

CREATE INDEX ai_reports_code ON public.ai_reports USING btree (market, code, created_at DESC);

CREATE INDEX ai_reports_dup ON public.ai_reports USING btree (market, code, depth, created_at DESC);

CREATE INDEX ai_reports_mcap ON public.ai_reports USING btree (mcap DESC NULLS LAST);

CREATE INDEX ai_reports_month ON public.ai_reports USING btree (created_at DESC);

CREATE INDEX ai_reports_sector ON public.ai_reports USING btree (sector, created_at DESC);

CREATE INDEX auto_runs_team_idx ON public.auto_runs USING btree (team_id, ran_at DESC);

CREATE INDEX dart_corps_name_idx ON public.dart_corps USING btree (lower(corp_name));

CREATE INDEX dart_corps_stock_idx ON public.dart_corps USING btree (stock_code);

CREATE INDEX dividends_team_pay ON public.dividends USING btree (team_id, pay_date DESC);

CREATE UNIQUE INDEX dividends_uniq ON public.dividends USING btree (team_id, market, symbol, pay_date, COALESCE(ex_date, record_date, pay_date));

CREATE INDEX indicator_catalog_importance ON public.indicator_catalog USING btree (importance DESC, sort_order);

CREATE UNIQUE INDEX indicator_catalog_uniq ON public.indicator_catalog USING btree (source, code, COALESCE(item_code, ''::text));

CREATE INDEX meeting_docs_on_idx ON public.meeting_docs USING btree (meeting_on DESC NULLS LAST, created_at DESC, id DESC);

CREATE INDEX member_presence_seen ON public.member_presence USING btree (last_seen DESC);

CREATE INDEX members_gen_idx ON public.members USING btree (gen);

CREATE INDEX members_pkey_idx ON public.members USING btree (person_key);

CREATE INDEX news_date_idx ON public.news USING btree (date DESC);

CREATE INDEX price_latest_idx ON public.price_cache USING btree (market, symbol, on_date DESC);

CREATE INDEX profiles_gen_idx ON public.profiles USING btree (gen);

CREATE INDEX profiles_role_idx ON public.profiles USING btree (ROLE);

CREATE INDEX reports_date_idx ON public.reports USING btree (date DESC);

CREATE INDEX reports_gen_idx ON public.reports USING btree (gen);

CREATE INDEX reset_log_at ON public.reset_log USING btree (at DESC);

CREATE INDEX strategies_team_idx ON public.strategies USING btree (team_id, effective_from);

CREATE UNIQUE INDEX team_members_one_team ON public.team_members USING btree (user_id);

CREATE INDEX team_members_user_idx ON public.team_members USING btree (user_id);

CREATE INDEX tradable_active_idx ON public.tradable USING btree (active)
  WHERE active;

CREATE INDEX tradable_name_idx ON public.tradable USING btree (market, name);

CREATE INDEX trades_auto_idx ON public.trades USING btree (team_id, auto);

CREATE INDEX trades_team_at_idx ON public.trades USING btree (team_id, traded_at DESC);

CREATE INDEX trades_team_idx ON public.trades USING btree (team_id, traded_on, id);

CREATE INDEX universe_active_idx ON public.universe USING btree (market, active);

CREATE INDEX us_tickers_title_idx ON public.us_tickers USING btree (lower(title));

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER chart_theme_default
  AFTER INSERT OR UPDATE OF is_default ON public.chart_themes
  FOR EACH ROW
  WHEN (new.is_default)
  EXECUTE FUNCTION public.one_default_theme();

CREATE TRIGGER member_ids_sync
  AFTER INSERT OR UPDATE ON public.member_ids
  FOR EACH ROW
  EXECUTE FUNCTION public.safe_trg_member_ids();

CREATE TRIGGER members_sync
  AFTER UPDATE OF name, dept ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.safe_trg_members();

CREATE TRIGGER strategies_universe
  BEFORE INSERT OR UPDATE ON public.strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_strategy_universe();

CREATE TRIGGER trades_universe
  BEFORE INSERT ON public.trades
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_universe();

CREATE POLICY "admin_write" ON "public"."about"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "public_read" ON "public"."about"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "log_insert" ON "public"."access_log"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "log_read" ON "public"."access_log"
  FOR SELECT
  TO "authenticated"
  USING (public.is_officer());

CREATE POLICY "ai_reports_read" ON "public"."ai_reports"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "settings_read" ON "public"."app_settings"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "settings_write" ON "public"."app_settings"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "auto_runs_read" ON "public"."auto_runs"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "officer_write" ON "public"."chart_themes"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "term_read" ON "public"."chart_themes"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "contest_read" ON "public"."contest"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "contest_write" ON "public"."contest"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "cp_read" ON "public"."crypto_pool"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "cp_write" ON "public"."crypto_pool"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "corps_read" ON "public"."dart_corps"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "dividends_read" ON "public"."dividends"
  FOR SELECT
  TO "authenticated"
  USING ((public.in_team(team_id) OR public.is_officer()));

CREATE POLICY "officer_write" ON "public"."indicator_catalog"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "term_read" ON "public"."indicator_catalog"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "officer_write" ON "public"."meeting_docs"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "term_read" ON "public"."meeting_docs"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "admin_only" ON "public"."member_ids"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "admin_write" ON "public"."members"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "public_read" ON "public"."members"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "admin_write" ON "public"."news"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "public_read" ON "public"."news"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "admin_read" ON "public"."page_views"
  FOR SELECT
  TO "authenticated"
  USING (public.is_officer());

CREATE POLICY "snap_read" ON "public"."portfolio_snapshots"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "price_read" ON "public"."price_cache"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "profiles_delete" ON "public"."profiles"
  FOR DELETE
  TO "authenticated"
  USING (public.is_officer());

CREATE POLICY "profiles_insert" ON "public"."profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_officer());

CREATE POLICY "profiles_read" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (((id = auth.uid()) OR public.is_officer()));

CREATE POLICY "profiles_update" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "admin_write" ON "public"."reports"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "public_read" ON "public"."reports"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "reset_log_read" ON "public"."reset_log"
  FOR SELECT
  TO "authenticated"
  USING (public.is_officer());

CREATE POLICY "officer_write" ON "public"."resource_links"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "term_read" ON "public"."resource_links"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "strat_read" ON "public"."strategies"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "strat_write" ON "public"."strategies"
  FOR ALL
  TO "authenticated"
  USING (public.in_team(team_id))
  WITH CHECK (public.in_team(team_id));

CREATE POLICY "srun_read" ON "public"."strategy_runs"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "srun_write" ON "public"."strategy_runs"
  FOR ALL
  TO "authenticated"
  USING (public.in_team(team_id))
  WITH CHECK (public.in_team(team_id));

CREATE POLICY "tm_read" ON "public"."team_members"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "tm_write" ON "public"."team_members"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "teams_mode" ON "public"."teams"
  FOR UPDATE
  TO "authenticated"
  USING (public.in_team(id))
  WITH CHECK (public.in_team(id));

CREATE POLICY "teams_read" ON "public"."teams"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "teams_write" ON "public"."teams"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "tradable_read" ON "public"."tradable"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "trades_delete" ON "public"."trades"
  FOR DELETE
  TO "authenticated"
  USING (public.in_team(team_id));

CREATE POLICY "trades_insert" ON "public"."trades"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.in_team(team_id));

CREATE POLICY "trades_read" ON "public"."trades"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "uni_read" ON "public"."universe"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "uni_write" ON "public"."universe"
  FOR ALL
  TO "authenticated"
  USING (public.is_officer())
  WITH CHECK (public.is_officer());

CREATE POLICY "tickers_read" ON "public"."us_tickers"
  FOR SELECT
  TO "authenticated"
  USING (public.can_use_terminal());

CREATE POLICY "meetdoc_delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'meeting-docs'::text) AND public.is_officer()));

CREATE POLICY "meetdoc_read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'meeting-docs'::text) AND public.can_use_terminal()));

CREATE POLICY "meetdoc_write" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'meeting-docs'::text) AND public.is_officer()));

CREATE POLICY "notices_admin_delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING ((bucket_id = 'notices'::text));

CREATE POLICY "notices_admin_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((bucket_id = 'notices'::text));

CREATE POLICY "notices_admin_update" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING ((bucket_id = 'notices'::text));

CREATE POLICY "notices_public_read" ON "storage"."objects"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((bucket_id = 'notices'::text));

CREATE POLICY "reports_admin_delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING ((bucket_id = 'reports'::text));

CREATE POLICY "reports_admin_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((bucket_id = 'reports'::text));

CREATE POLICY "reports_admin_update" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING ((bucket_id = 'reports'::text));

CREATE POLICY "reports_public_read" ON "storage"."objects"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((bucket_id = 'reports'::text));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."about";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."members";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."news";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."reports";

COMMENT ON COLUMN "public"."profiles"."nickname" IS '터미널에서 보일 이름표. 비어 있으면 name, 그것도 없으면 «NN학번».';

COMMENT ON EXTENSION "http" IS 'HTTP client for PostgreSQL, allows web page retrieval inside the database.';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';

GRANT EXECUTE ON FUNCTION "public"."access_summary"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_admin_set"(integer, numeric, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_admin_set"(integer, numeric, integer) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_budget"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_budget"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_existing"(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_existing"(text, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_report_get"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_report_get"(bigint) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_report_list"(integer, integer, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_report_list"(integer, integer, text, text, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_sectors"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_sectors"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."ai_spend_admin"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ai_spend_admin"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."auto_health"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."auto_health"() TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."backfill_trade_fx"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_use_terminal"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."clear_auto_trades"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_db_status"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_search"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."contest_reset"(bigint, numeric, timestamp WITH time zone, timestamp WITH time zone, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."contest_reset"(bigint, numeric, timestamp WITH time zone, timestamp WITH time zone, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."contest_reset_preview"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."contest_reset_preview"(bigint) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."contest_settings"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."contest_state"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."crypto_pool_list"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."crypto_pool_list"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."dart_fetch"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."dart_fetch"(text) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."display_name"(text, text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."dividend_upsert"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."dividend_upsert"(jsonb) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."fx_rate"(date) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."fx_status"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."guard_strategy_universe"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."guard_universe"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."in_team"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."in_universe"(text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."in_universe_ever"(text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_officer"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_tradable"(text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."leaderboard"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."league_board"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."meeting_docs_list"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."meeting_docs_list"() TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."member_label_list"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."member_label_set"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."mt_call_edge"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."mt_call_edge"(jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."mt_place_trade"(bigint, text, text, text, text, numeric, numeric, numeric, numeric, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."mt_place_trade"(bigint, text, text, text, text, numeric, numeric, numeric, numeric, text, text, text, uuid) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_profile"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_team_id"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."my_teams"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."one_default_theme"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."presence_list"(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."presence_list"(integer) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."presence_ping"(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."presence_ping"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."presence_prune"(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."presence_prune"(integer) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."price_bulk"(date) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."price_bulk_upsert"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."price_bulk_upsert"(jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."price_stale"(text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."price_stale"(text, integer) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."record_snapshot"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."record_visit"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."record_visit"(text) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."replace_snapshots"(bigint, jsonb) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."reset_log_list"(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."reset_log_list"(integer) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safe_entry_year"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safe_sync_member"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safe_trg_member_ids"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safe_trg_members"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."scoreboard"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."symbol_find"(text, integer) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."symbol_find_uni"(text, integer) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."team_dividends"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."team_dividends"(bigint) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_history"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_positions"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_scorecard"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_state"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_strategies"(bigint) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."team_trades"(bigint, integer) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."tradable_bulk_replace"(text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tradable_bulk_replace"(text, jsonb) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."tradable_status"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."universe_auto_replace"(text, jsonb, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."universe_auto_replace"(text, jsonb, date) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."universe_bulk"(text, boolean) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."universe_on"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."universe_scan"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."universe_scan"() TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."universe_status"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."visit_stats"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."warm_fred_once"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."warm_fred_once"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."who_names"(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."who_names"(uuid[]) TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."about" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."access_log" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ai_reports" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ai_reports" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_reports" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."auto_runs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."backup_members" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."backup_news" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."backup_reports" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."chart_themes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contest" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crypto_pool" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."dart_corps" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."dividends" FROM "authenticated";

GRANT SELECT ON TABLE "public"."dividends" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."dividends" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."indicator_catalog" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."meeting_docs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."member_ids" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."member_presence" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."members" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."news" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."page_views" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."portfolio_snapshots" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."price_cache" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."private_warm_cfg" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reports" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."reset_log" FROM "authenticated";

GRANT SELECT ON TABLE "public"."reset_log" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reset_log" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."resource_links" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."series_cache" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."strategies" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."strategy_runs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_members" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."teams" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tradable" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trades" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."universe" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."us_tickers" TO "anon", "authenticated", "postgres", "service_role";

SELECT cron.schedule_in_database('safe-assets-cc', '45 23 * * 6', ' select mt_call_edge(''{"source":"assets_crypto"}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-assets-kr', '0 9 * * 1-5', ' select mt_call_edge(''{"source":"assets_kr"}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-assets-us', '40 23 * * 6', ' select mt_call_edge(''{"source":"assets_us"}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-fred-warm', '*/10 * * * *', ' select warm_fred_once(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-mt-scan', '*/5 * * * *', ' select mt_call_edge(''{"source":"mt_scan"}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-uni-backfill', '30 23 * * 6', ' select mt_call_edge(''{"source":"backfill_us","days":10}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-uni-cc', '10 23 * * 6', ' select mt_call_edge(''{"source":"universe_crypto","top":50}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-uni-kr', '5 23 * * 6', ' select mt_call_edge(''{"source":"universe_kr","top":100}''::jsonb); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('safe-uni-us', '0 23 * * 6', ' select mt_call_edge(''{"source":"universe_us","top":0}''::jsonb); ', 'postgres', NULL, true);

ALTER TABLE "public"."meeting_docs"
  ADD CONSTRAINT "meeting_docs_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);

