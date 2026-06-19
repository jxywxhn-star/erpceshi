// 千牛采集数据表（additive，独立文件，不改动既有 init.js 的建表块）。
// 由 routes/qianniu.js 在首次请求时惰性确保，CREATE TABLE IF NOT EXISTS 幂等。

let ensured = false;

export function ensureQianniuTables(db) {
  if (ensured) return;
  db.exec(`
    -- 店铺经营指标（每店最新一条，覆盖更新）
    CREATE TABLE IF NOT EXISTS qianniu_shop_overview (
      shop_id INTEGER PRIMARY KEY,
      collector_shop_id TEXT NOT NULL DEFAULT '',
      pay_amt_today TEXT DEFAULT '', pay_amt_yesterday TEXT DEFAULT '', pay_amt_change TEXT DEFAULT '',
      uv_today TEXT DEFAULT '', uv_yesterday TEXT DEFAULT '', uv_change TEXT DEFAULT '',
      pv_today TEXT DEFAULT '', pv_yesterday TEXT DEFAULT '', pv_change TEXT DEFAULT '',
      pay_cnt_today TEXT DEFAULT '', pay_cnt_yesterday TEXT DEFAULT '', pay_cnt_change TEXT DEFAULT '',
      extra_json TEXT DEFAULT '',
      collected_at TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 店铺信用（每店最新一条）
    CREATE TABLE IF NOT EXISTS qianniu_shop_credit (
      shop_id INTEGER PRIMARY KEY,
      collector_shop_id TEXT NOT NULL DEFAULT '',
      shop_taobao_id TEXT DEFAULT '', seller_id TEXT DEFAULT '', seller_nick TEXT DEFAULT '',
      credit_level INTEGER DEFAULT 0, credit_level_text TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 商品诊断（每店每商品一条）+ 店铺级流量汇总放 overview/summary
    CREATE TABLE IF NOT EXISTS qianniu_item_diagnosis (
      shop_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      basic_score REAL DEFAULT 0,
      issues_json TEXT DEFAULT '[]',
      main_pic TEXT DEFAULT '',
      jump_url TEXT DEFAULT '',
      metrics_json TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_id, item_id)
    );

    -- 店铺诊断汇总（流量加速/受限数）
    CREATE TABLE IF NOT EXISTS qianniu_shop_diagnosis_summary (
      shop_id INTEGER PRIMARY KEY,
      flow_accelerated_count INTEGER DEFAULT 0,
      flow_limited_count INTEGER DEFAULT 0,
      diagnosed_items INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensured = true;
}
