import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = Router();
const DEFAULT_COLLECTOR_BASE_URL = process.env.COLLECTOR_BASE_URL || 'http://127.0.0.1:5069';

router.use(authMiddleware);

function normalizeCollectorBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  return url || DEFAULT_COLLECTOR_BASE_URL;
}

function getCollectorBaseUrl(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_base_url');
  return normalizeCollectorBaseUrl(row?.value);
}

async function deleteCollectorShop(db, collectorShopId) {
  if (!collectorShopId) return null;

  const url = `${getCollectorBaseUrl(db)}/api/shops/${encodeURIComponent(collectorShopId)}?purge=true`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok && response.status !== 404) {
    const message = body?.message || body?.error || `采集器删除店铺失败：${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body || { ok: true, status: response.status };
}

function markCollectorShopDeleted(db, shop, userId) {
  if (!shop?.collector_shop_id) return;

  db.prepare(`
    INSERT INTO collector_shop_deletions (collector_shop_id, platform, shop_name, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(collector_shop_id) DO UPDATE SET
      platform = excluded.platform,
      shop_name = excluded.shop_name,
      reason = excluded.reason,
      created_by = excluded.created_by,
      created_at = CURRENT_TIMESTAMP
  `).run(
    shop.collector_shop_id,
    shop.platform || '',
    shop.real_name || shop.name || '',
    'deleted_in_erp',
    userId || null,
  );
}

function ignoreOrdersForDeletedShop(db, shop, userId) {
  const orders = db.prepare(`
    SELECT order_no, collector_shop_id
    FROM orders
    WHERE shop_id = ? AND order_no != ''
  `).all(shop.id);

  const insert = db.prepare(`
    INSERT INTO order_sync_ignores (order_no, shop_id, collector_shop_id, platform, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_no, collector_shop_id) DO UPDATE SET
      shop_id = excluded.shop_id,
      platform = excluded.platform,
      reason = excluded.reason,
      created_by = excluded.created_by,
      created_at = CURRENT_TIMESTAMP
  `);

  let ignored = 0;
  for (const order of orders) {
    const collectorShopId = String(order.collector_shop_id || shop.collector_shop_id || '').trim();
    if (!collectorShopId) continue;
    insert.run(
      order.order_no,
      shop.id,
      collectorShopId,
      shop.platform || '',
      'shop_deleted_in_erp',
      userId || null,
    );
    ignored += 1;
  }

  return ignored;
}

router.get('/', (req, res) => {
  const db = getDb();
  const shops = db.prepare(`
    SELECT id, name, platform, real_name, collector_shop_id, collector_status,
           last_login_check_at, last_collect_at, status, created_at
    FROM shops
    ORDER BY id DESC
  `).all();
  res.json(shops);
});

router.post('/', adminMiddleware, (req, res) => {
  const { name, platform } = req.body;
  if (!name) {
    return res.status(400).json({ message: '店铺名称不能为空' });
  }

  const db = getDb();
  const result = db.prepare('INSERT INTO shops (name, platform) VALUES (?, ?)').run(name, platform || '');
  res.status(201).json({ id: result.lastInsertRowid, message: '店铺创建成功' });
});

router.put('/:id', adminMiddleware, (req, res) => {
  const { name, platform, status } = req.body;
  const db = getDb();
  db.prepare('UPDATE shops SET name = ?, platform = ?, status = ? WHERE id = ?')
    .run(name, platform || '', status !== undefined ? status : 1, req.params.id);
  res.json({ message: '店铺更新成功' });
});

router.delete('/:id', adminMiddleware, async (req, res, next) => {
  const db = getDb();
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop) {
    return res.status(404).json({ message: '店铺不存在' });
  }

  const force = req.query.force === '1' || req.query.force === 'true';
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE shop_id = ?')
    .get(req.params.id);
  const expenseCount = db.prepare('SELECT COUNT(*) as count FROM expenses WHERE shop_id = ?')
    .get(req.params.id);

  if ((orderCount.count > 0 || expenseCount.count > 0) && !force) {
    return res.status(400).json({ message: '该店铺下有订单数据，无法删除' });
  }

  try {
    let collector = null;
    let collector_warning = null;
    try {
      collector = await deleteCollectorShop(db, shop.collector_shop_id);
    } catch (err) {
      collector_warning = err.message;
    }
    let deletedOrders = 0;
    let deletedExpenses = 0;
    let ignoredOrders = 0;
    const tx = db.transaction(() => {
      markCollectorShopDeleted(db, shop, req.user?.id);
      if (force) {
        ignoredOrders = ignoreOrdersForDeletedShop(db, shop, req.user?.id);
        deletedOrders = db.prepare('DELETE FROM orders WHERE shop_id = ?').run(req.params.id).changes;
        deletedExpenses = db.prepare('DELETE FROM expenses WHERE shop_id = ?').run(req.params.id).changes;
        db.prepare('UPDATE collector_issues SET shop_id = NULL WHERE shop_id = ?').run(req.params.id);
      }
      db.prepare('DELETE FROM shops WHERE id = ?').run(req.params.id);
    });
    tx();
    res.json({ message: '店铺删除成功', collector });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, detail: err.body });
  }
  if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
    return res.status(503).json({ message: '采集器未启动，绑定采集器的店铺暂时不能删除' });
  }
  next(err);
});

export default router;
