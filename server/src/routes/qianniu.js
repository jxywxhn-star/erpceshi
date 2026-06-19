// 千牛采集数据：经营指标 / 店铺信用 / 商品诊断 的入库与查询。
// additive 独立路由，挂在 /api/qianniu，始终本地处理（与 /api/collector 一致）。
import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { ensureQianniuTables } from '../db/qianniuTables.js';

const router = Router();

router.use(authMiddleware);
router.use((req, res, next) => {
  ensureQianniuTables(getDb());
  next();
});

function resolveShopId(db, collectorShopId) {
  if (!collectorShopId) return null;
  const row = db.prepare('SELECT id FROM shops WHERE collector_shop_id = ?').get(String(collectorShopId));
  return row ? row.id : null;
}

const j = (v) => JSON.stringify(v ?? null);

// ---------- 入库（连接器调用） ----------

// 经营指标
router.post('/ingest/overview', (req, res) => {
  const db = getDb();
  const shopId = resolveShopId(db, req.body?.collector_shop_id);
  if (!shopId) return res.status(404).json({ ok: false, message: 'ERP 中找不到对应店铺' });
  const d = req.body?.data || {};
  const pick = (k) => ({ t: d[k]?.today ?? '', y: d[k]?.yesterday ?? '', c: d[k]?.change ?? '' });
  const pay = pick('pay_amt'), uv = pick('uv'), pv = pick('pv'), cnt = pick('pay_item_cnt');
  db.prepare(`
    INSERT INTO qianniu_shop_overview (
      shop_id, collector_shop_id,
      pay_amt_today, pay_amt_yesterday, pay_amt_change,
      uv_today, uv_yesterday, uv_change,
      pv_today, pv_yesterday, pv_change,
      pay_cnt_today, pay_cnt_yesterday, pay_cnt_change,
      extra_json, collected_at, updated_at
    ) VALUES (
      @shop_id, @cid, @pt, @py, @pc, @ut, @uy, @uc, @vt, @vy, @vc, @ct, @cy, @cc,
      @extra, @collected_at, CURRENT_TIMESTAMP
    )
    ON CONFLICT(shop_id) DO UPDATE SET
      collector_shop_id=excluded.collector_shop_id,
      pay_amt_today=excluded.pay_amt_today, pay_amt_yesterday=excluded.pay_amt_yesterday, pay_amt_change=excluded.pay_amt_change,
      uv_today=excluded.uv_today, uv_yesterday=excluded.uv_yesterday, uv_change=excluded.uv_change,
      pv_today=excluded.pv_today, pv_yesterday=excluded.pv_yesterday, pv_change=excluded.pv_change,
      pay_cnt_today=excluded.pay_cnt_today, pay_cnt_yesterday=excluded.pay_cnt_yesterday, pay_cnt_change=excluded.pay_cnt_change,
      extra_json=excluded.extra_json, collected_at=excluded.collected_at, updated_at=CURRENT_TIMESTAMP
  `).run({
    shop_id: shopId, cid: String(req.body?.collector_shop_id || ''),
    pt: pay.t, py: pay.y, pc: pay.c, ut: uv.t, uy: uv.y, uc: uv.c,
    vt: pv.t, vy: pv.y, vc: pv.c, ct: cnt.t, cy: cnt.y, cc: cnt.c,
    extra: j(req.body?.extra || {}), collected_at: String(req.body?.collected_at || ''),
  });
  res.json({ ok: true, shop_id: shopId });
});

// 店铺信用
router.post('/ingest/credit', (req, res) => {
  const db = getDb();
  const shopId = resolveShopId(db, req.body?.collector_shop_id);
  if (!shopId) return res.status(404).json({ ok: false, message: 'ERP 中找不到对应店铺' });
  const s = req.body?.shop || {};
  db.prepare(`
    INSERT INTO qianniu_shop_credit (shop_id, collector_shop_id, shop_taobao_id, seller_id, seller_nick, credit_level, credit_level_text, updated_at)
    VALUES (@shop_id, @cid, @sid, @seller, @nick, @lvl, @lvltext, CURRENT_TIMESTAMP)
    ON CONFLICT(shop_id) DO UPDATE SET
      collector_shop_id=excluded.collector_shop_id, shop_taobao_id=excluded.shop_taobao_id,
      seller_id=excluded.seller_id, seller_nick=excluded.seller_nick,
      credit_level=excluded.credit_level, credit_level_text=excluded.credit_level_text, updated_at=CURRENT_TIMESTAMP
  `).run({
    shop_id: shopId, cid: String(req.body?.collector_shop_id || ''),
    sid: String(s.shop_id || ''), seller: String(s.seller_id || ''), nick: String(s.seller_nick || ''),
    lvl: Number(s.credit_level || 0), lvltext: String(s.credit_level_text || ''),
  });
  res.json({ ok: true, shop_id: shopId });
});

// 商品诊断（汇总 + 逐商品）
router.post('/ingest/diagnosis', (req, res) => {
  const db = getDb();
  const shopId = resolveShopId(db, req.body?.collector_shop_id);
  if (!shopId) return res.status(404).json({ ok: false, message: 'ERP 中找不到对应店铺' });
  const sum = req.body?.summary || {};
  db.prepare(`
    INSERT INTO qianniu_shop_diagnosis_summary (shop_id, flow_accelerated_count, flow_limited_count, diagnosed_items, updated_at)
    VALUES (@shop_id, @acc, @lim, @diag, CURRENT_TIMESTAMP)
    ON CONFLICT(shop_id) DO UPDATE SET
      flow_accelerated_count=excluded.flow_accelerated_count, flow_limited_count=excluded.flow_limited_count,
      diagnosed_items=excluded.diagnosed_items, updated_at=CURRENT_TIMESTAMP
  `).run({ shop_id: shopId, acc: Number(sum.flow_accelerated_count || 0), lim: Number(sum.flow_limited_count || 0), diag: Number(sum.diagnosed_items || 0) });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const up = db.prepare(`
    INSERT INTO qianniu_item_diagnosis (shop_id, item_id, basic_score, issues_json, main_pic, jump_url, metrics_json, updated_at)
    VALUES (@shop_id, @item_id, @score, @issues, @pic, @url, @metrics, CURRENT_TIMESTAMP)
    ON CONFLICT(shop_id, item_id) DO UPDATE SET
      basic_score=excluded.basic_score, issues_json=excluded.issues_json, main_pic=excluded.main_pic,
      jump_url=excluded.jump_url, metrics_json=excluded.metrics_json, updated_at=CURRENT_TIMESTAMP
  `);
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!it?.item_id) continue;
      up.run({
        shop_id: shopId, item_id: String(it.item_id), score: Number(it.basic_score || 0),
        issues: j(it.issues || []), pic: String(it.main_pic || ''), url: String(it.jump_url || ''),
        metrics: j(it.metrics || []),
      });
    }
  });
  tx();
  res.json({ ok: true, shop_id: shopId, item_count: items.length });
});

// ---------- 查询（前端页面） ----------

router.get('/overview', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT o.*, s.name AS shop_name, s.platform, s.real_name
    FROM qianniu_shop_overview o JOIN shops s ON s.id = o.shop_id
    ORDER BY s.name
  `).all();
  res.json({ ok: true, shops: rows });
});

router.get('/credit', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, s.name AS shop_name, s.platform FROM qianniu_shop_credit c JOIN shops s ON s.id = c.shop_id
    ORDER BY c.credit_level DESC
  `).all();
  res.json({ ok: true, shops: rows });
});

router.get('/diagnosis', (req, res) => {
  const db = getDb();
  const summaries = db.prepare(`
    SELECT d.*, s.name AS shop_name, s.platform FROM qianniu_shop_diagnosis_summary d JOIN shops s ON s.id = d.shop_id
    ORDER BY s.name
  `).all();
  const shopId = req.query.shop_id ? Number(req.query.shop_id) : null;
  const items = shopId
    ? db.prepare('SELECT * FROM qianniu_item_diagnosis WHERE shop_id = ? ORDER BY basic_score ASC').all(shopId)
    : [];
  const parsed = items.map((it) => ({
    ...it,
    issues: JSON.parse(it.issues_json || '[]'),
    metrics: JSON.parse(it.metrics_json || '[]'),
  }));
  res.json({ ok: true, summaries, items: parsed });
});

export default router;
