import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { resolveProductByItem, applyProductToOrder, reresolveOrdersByItem } from '../services/productResolve.js';

const router = Router();

router.use(authMiddleware);

const FACTORY_STATUSES = new Set([
  'pushed',
  'shipped',
]);

function normalizeImageList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, 30);
}

const WORKFLOW_STATUSES = new Set([
  'unpaid',
  'unprocessed',
  'ordered_not_uploaded',
  'ordered_waiting_tracking',
  'completed',
]);
const SHIPPING_DEADLINE_HOURS = 48;

function normalizeWorkflowStatus(status) {
  return WORKFLOW_STATUSES.has(status) ? status : 'unprocessed';
}

function orderTextSql(alias = 'o') {
  const prefix = alias ? `${alias}.` : '';
  return `(
    COALESCE(${prefix}platform_status, '') || ' ' || COALESCE(${prefix}status_description, '')
  )`;
}

function orderTimeSql(alias = 'o') {
  const prefix = alias ? `${alias}.` : '';
  const value = `COALESCE(NULLIF(${prefix}platform_created_at, ''), ${prefix}created_at)`;
  return `CASE
    WHEN ${value} IS NULL OR ${value} = '' THEN NULL
    WHEN length(${value}) = 13 AND ${value} NOT GLOB '*[^0-9]*' THEN datetime(CAST(${value} AS INTEGER) / 1000, 'unixepoch')
    WHEN length(${value}) = 10 AND ${value} NOT GLOB '*[^0-9]*' THEN datetime(CAST(${value} AS INTEGER), 'unixepoch')
    ELSE datetime(replace(${value}, 'T', ' '))
  END`;
}

function shippingDeadlineSql(alias = 'o') {
  return `datetime(${orderTimeSql(alias)}, '+${SHIPPING_DEADLINE_HOURS} hours')`;
}

function unpaidOrderSql(alias = 'o') {
  const prefix = alias ? `${alias}.` : '';
  const text = orderTextSql(alias);
  return `(
    COALESCE(${prefix}status, '') = 'unpaid'
    OR ${text} LIKE '%待付款%'
    OR ${text} LIKE '%未付款%'
    OR ${text} LIKE '%待支付%'
    OR ${text} LIKE '%等待付款%'
    OR ${text} LIKE '%等待买家付款%'
    OR ${text} LIKE '%买家未付款%'
  )`;
}

function nonActionablePlatformOrderSql(alias = 'o') {
  const text = orderTextSql(alias);
  return `(
    ${unpaidOrderSql(alias)}
    OR ${text} LIKE '%取消%'
    OR ${text} LIKE '%关闭%'
    OR ${text} LIKE '%作废%'
    OR ${text} LIKE '%退款%'
    OR ${text} LIKE '%售后%'
  )`;
}

function shippedOrderSql(alias = 'o') {
  const prefix = alias ? `${alias}.` : '';
  const text = orderTextSql(alias);
  return `(
    COALESCE(${prefix}tracking_no, '') <> ''
    OR ${text} LIKE '%已出库%'
    OR ${text} LIKE '%已发货%'
    OR ${text} LIKE '%待买家确认%'
    OR ${text} LIKE '%待收货%'
    OR ${text} LIKE '%交易成功%'
    OR ${text} LIKE '%已完成%'
    OR ${text} LIKE '%已签收%'
    OR ${text} LIKE '%签收%'
    OR ${text} LIKE '%已完结%'
  )`;
}

function shippingActionableOrderSql(alias = 'o') {
  const prefix = alias ? `${alias}.` : '';
  return `(
    COALESCE(${prefix}status, '') <> 'completed'
    AND
    NOT ${nonActionablePlatformOrderSql(alias)}
    AND NOT ${shippedOrderSql(alias)}
    AND ${orderTimeSql(alias)} IS NOT NULL
  )`;
}

function overdueShippingOrderSql(alias = 'o') {
  return `(
    ${shippingActionableOrderSql(alias)}
    AND ${shippingDeadlineSql(alias)} < datetime('now')
  )`;
}

function dueSoonShippingOrderSql(alias = 'o') {
  return `(
    ${shippingActionableOrderSql(alias)}
    AND ${shippingDeadlineSql(alias)} >= datetime('now')
    AND ${shippingDeadlineSql(alias)} <= datetime('now', '+6 hours')
  )`;
}

function appendStatusFilter(sql, params, status) {
  if (status === 'not_completed') {
    return `${sql} AND COALESCE(o.status, '') <> 'completed' AND NOT ${nonActionablePlatformOrderSql()}`;
  }
  if (status === 'unprocessed') {
    return `${sql} AND (
      o.status IS NULL
      OR o.status = ''
      OR o.status IN ('unprocessed', 'pending', 'shipped', 'refunded', 'cancelled', 'closed')
    ) AND NOT ${nonActionablePlatformOrderSql()}`;
  }
  if (status === 'unpaid') {
    return `${sql} AND ${unpaidOrderSql()}`;
  }
  if (WORKFLOW_STATUSES.has(status)) {
    params.push(status);
    return `${sql} AND o.status = ?`;
  }
  return sql;
}

function appendDeliveryFilter(sql, deliveryStatus) {
  if (deliveryStatus === 'unshipped') {
    return `${sql} AND ${shippingActionableOrderSql()}`;
  }
  if (deliveryStatus === 'overdue') {
    return `${sql} AND ${overdueShippingOrderSql()}`;
  }
  if (deliveryStatus === 'due_soon') {
    return `${sql} AND ${dueSoonShippingOrderSql()}`;
  }
  return sql;
}

function appendBaseFilters(sql, params, req, filters) {
  const { shop_id, handler_id, keyword, start_date, end_date } = filters;

  if (req.user.role !== 'admin') {
    sql += ' AND o.handler_id = ?';
    params.push(req.user.id);
  }

  if (shop_id) {
    sql += ' AND o.shop_id = ?';
    params.push(shop_id);
  }
  if (handler_id && req.user.role === 'admin') {
    sql += ' AND o.handler_id = ?';
    params.push(handler_id);
  }
  if (keyword) {
    sql += ` AND (
      o.order_no LIKE ?
      OR o.product_name LIKE ?
      OR o.tracking_no LIKE ?
      OR o.supplier_tracking_no LIKE ?
      OR o.comfort_tracking_no LIKE ?
    )`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (start_date) {
    sql += ' AND DATE(o.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND DATE(o.created_at) <= ?';
    params.push(end_date);
  }

  return sql;
}

router.get('/', (req, res) => {
  const db = getDb();
  const { status, delivery_status, page = 1, pageSize = 20 } = req.query;

  let sql = `
    SELECT
      o.*,
      o.created_at as order_time,
      s.name as shop_name,
      s.real_name as shop_real_name,
      s.platform as shop_platform,
      u.nickname as handler_name
    FROM orders o
    LEFT JOIN shops s ON o.shop_id = s.id
    LEFT JOIN users u ON o.handler_id = u.id
    WHERE 1=1
  `;
  const params = [];

  sql = appendBaseFilters(sql, params, req, req.query);
  if (status) {
    sql = appendStatusFilter(sql, params, status);
  }
  if (delivery_status) {
    sql = appendDeliveryFilter(sql, delivery_status);
  }
  const { factory_status } = req.query;
  if (factory_status === 'pushed') {
    sql += " AND COALESCE(o.factory_status, '') <> ''";
  } else if (factory_status && FACTORY_STATUSES.has(factory_status)) {
    sql += ' AND o.factory_status = ?';
    params.push(factory_status);
  }

  const { order_category } = req.query;
  if (order_category === 'finished') {
    sql += " AND o.order_category = 'finished'";
  } else if (order_category === 'custom') {
    sql += " AND o.order_category = 'custom'";
  } else if (order_category === 'unclassified') {
    sql += " AND COALESCE(o.order_category, '') = ''";
  }

  const countSql = sql.replace(
    `SELECT
      o.*,
      o.created_at as order_time,
      s.name as shop_name,
      s.real_name as shop_real_name,
      s.platform as shop_platform,
      u.nickname as handler_name`,
    'SELECT COUNT(*) as total'
  );
  const { total } = db.prepare(countSql).get(...params);

  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const orders = db.prepare(sql).all(...params);

  res.json({ list: orders, total, page: Number(page), pageSize: Number(pageSize) });
});

router.get('/summary', (req, res) => {
  const db = getDb();
  const params = [];
  let sql = `
    SELECT
      COUNT(*) as total_count,
      COALESCE(SUM(CASE WHEN ${unpaidOrderSql()} THEN 1 ELSE 0 END), 0) as unpaid_count,
      COALESCE(SUM(CASE WHEN COALESCE(o.status, '') <> 'completed' AND NOT ${nonActionablePlatformOrderSql()} THEN 1 ELSE 0 END), 0) as not_completed_count,
      COALESCE(SUM(CASE WHEN ${shippingActionableOrderSql()} THEN 1 ELSE 0 END), 0) as unshipped_count,
      COALESCE(SUM(CASE WHEN ${overdueShippingOrderSql()} THEN 1 ELSE 0 END), 0) as shipping_overdue_count,
      COALESCE(SUM(CASE WHEN ${dueSoonShippingOrderSql()} THEN 1 ELSE 0 END), 0) as shipping_due_soon_count
    FROM orders o
    LEFT JOIN shops s ON o.shop_id = s.id
    LEFT JOIN users u ON o.handler_id = u.id
    WHERE 1=1
  `;

  sql = appendBaseFilters(sql, params, req, req.query);
  const summary = db.prepare(sql).get(...params);
  res.json(summary);
});

router.post('/', (req, res) => {
  const {
    order_no,
    product_name,
    quantity,
    shop_id,
    price,
    cost,
    tracking_no,
    supplier_tracking_no,
    comfort_tracking_no,
    status,
    note,
  } = req.body;
  if (!order_no || !shop_id) {
    return res.status(400).json({ message: '订单号和店铺不能为空' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO orders (
      order_no, product_name, quantity, shop_id, price, cost, tracking_no,
      supplier_tracking_no, comfort_tracking_no, status, handler_id, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order_no, product_name || '', quantity || 1, shop_id,
    price || 0, cost || 0, tracking_no || '',
    supplier_tracking_no || '', comfort_tracking_no || '', normalizeWorkflowStatus(status),
    req.user.id, note || ''
  );

  res.status(201).json({ id: result.lastInsertRowid, message: '订单创建成功' });
});

router.patch('/batch/status', (req, res) => {
  const { ids, status } = req.body;
  const orderIds = Array.isArray(ids)
    ? [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  if (orderIds.length === 0) {
    return res.status(400).json({ message: '请选择要批量处理的订单' });
  }
  if (!WORKFLOW_STATUSES.has(status)) {
    return res.status(400).json({ message: '处理状态不正确' });
  }

  const db = getDb();
  const placeholders = orderIds.map(() => '?').join(',');
  const ownedSql = req.user.role === 'admin'
    ? `SELECT id FROM orders WHERE id IN (${placeholders})`
    : `SELECT id FROM orders WHERE id IN (${placeholders}) AND handler_id = ?`;
  const ownedParams = req.user.role === 'admin' ? orderIds : [...orderIds, req.user.id];
  const allowedIds = db.prepare(ownedSql).all(...ownedParams).map((row) => row.id);

  if (allowedIds.length === 0) {
    return res.status(403).json({ message: '没有可更新的订单' });
  }

  const update = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of allowedIds) {
      update.run(status, id);
    }
  });
  tx();

  res.json({
    message: '批量更新成功',
    requested: orderIds.length,
    updated: allowedIds.length,
    skipped: orderIds.length - allowedIds.length,
    status,
  });
});

router.put('/:id', (req, res) => {
  const db = getDb();

  if (req.user.role !== 'admin') {
    const order = db.prepare('SELECT handler_id FROM orders WHERE id = ?').get(req.params.id);
    if (!order || order.handler_id !== req.user.id) {
      return res.status(403).json({ message: '只能修改自己的订单' });
    }
  }

  const allowed = [
    'order_no',
    'product_name',
    'quantity',
    'shop_id',
    'price',
    'cost',
    'tracking_no',
    'supplier_tracking_no',
    'comfort_tracking_no',
    'status',
    'refund_amount',
    'refund_note',
    'note',
    'receiver_name',
    'receiver_phone',
    'receiver_address',
    'receiver_raw',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  if (updates.status !== undefined) {
    updates.status = normalizeWorkflowStatus(updates.status);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: '没有要更新的字段' });
  }

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE orders SET ${setClause} WHERE id = ?`).run(
    ...Object.values(updates), req.params.id
  );

  res.json({ message: '订单更新成功' });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT o.*, s.platform
    FROM orders o
    LEFT JOIN shops s ON o.shop_id = s.id
    WHERE o.id = ?
  `).get(req.params.id);

  if (req.user.role !== 'admin') {
    if (!order || order.handler_id !== req.user.id) {
      return res.status(403).json({ message: '只能删除自己的订单' });
    }
  }

  if (!order) {
    return res.status(404).json({ message: '订单不存在' });
  }

  if (order.collector_shop_id && order.order_no) {
    db.prepare(`
      INSERT INTO order_sync_ignores (order_no, shop_id, collector_shop_id, platform, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_no, collector_shop_id) DO UPDATE SET
        shop_id = excluded.shop_id,
        platform = excluded.platform,
        reason = excluded.reason,
        created_by = excluded.created_by,
        created_at = CURRENT_TIMESTAMP
    `).run(
      order.order_no,
      order.shop_id || 0,
      order.collector_shop_id,
      order.platform || '',
      'deleted_in_erp',
      req.user.id,
    );
  }

  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ message: '订单删除成功' });
});

// ===== 工厂协作 =====

// 工厂账号列表（供推单下拉，仅 admin/operator 可用）
router.get('/factories', (req, res) => {
  if (req.user.role === 'factory') {
    return res.status(403).json({ message: '无权访问' });
  }
  const db = getDb();
  const list = db.prepare(`
    SELECT id, nickname, username FROM users
    WHERE role = 'factory' AND status = 1
    ORDER BY id DESC
  `).all();
  res.json(list);
});

// 推单给工厂（admin 或该单 handler）
router.post('/:id/push-factory', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: '订单不存在' });
  }
  if (req.user.role !== 'admin' && order.handler_id !== req.user.id) {
    return res.status(403).json({ message: '只能推送自己的订单' });
  }

  // 已发货的单不允许重复推送
  if (order.factory_status === 'shipped') {
    return res.status(400).json({ message: '该订单已发货，不能重复推送' });
  }

  const spec = String(req.body?.factory_spec || '');
  const size = String(req.body?.factory_size || '');
  const printText = String(req.body?.factory_print || '');
  const quantity = Number(req.body?.factory_quantity) || 0;
  const isFactory = (id) => db.prepare("SELECT id FROM users WHERE id = ? AND role = 'factory' AND status = 1").get(id);

  // 成品：复用成品库素材，工厂取自成品库配置（无报价环节）
  const product = order.factory_product_id
    ? db.prepare('SELECT * FROM factory_products WHERE id = ? AND status = 1').get(order.factory_product_id)
    : null;

  let factoryId = Number(req.body?.factory_id);
  let effectImages;
  let baseImages;
  if (product) {
    factoryId = product.factory_id || factoryId;
    effectImages = product.effect_images || '[]';
    baseImages = product.base_images || '[]';
  } else {
    effectImages = JSON.stringify(normalizeImageList(req.body?.factory_effect_images));
    baseImages = JSON.stringify(normalizeImageList(req.body?.factory_base_images));
  }
  if (!isFactory(factoryId)) {
    return res.status(400).json({ message: product ? '成品未配置工厂，请在成品库设置默认工厂或手动选择' : '请选择有效的工厂账号' });
  }

  db.prepare(`
    UPDATE orders SET
      factory_id = ?,
      factory_status = 'pushed',
      factory_spec = ?,
      factory_size = ?,
      factory_print = ?,
      factory_quantity = ?,
      factory_effect_images = ?,
      factory_base_images = ?,
      factory_reject_reason = '',
      factory_pushed_at = CURRENT_TIMESTAMP,
      factory_pushed_by = ?,
      factory_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    factoryId, spec, size, printText, quantity, effectImages, baseImages,
    req.user.id, order.id,
  );
  res.json({ message: '已推送给工厂（待发货）' });
});

// 撤回/重置工厂协作（仅 admin）
router.post('/:id/cancel-factory', adminMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: '订单不存在' });
  }
  db.prepare(`
    UPDATE orders SET
      factory_id = 0,
      factory_status = '',
      factory_quote = 0,
      factory_quote_note = '',
      factory_reject_reason = '',
      factory_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(order.id);
  res.json({ message: '已撤回工厂推送' });
});

// 保存解密后的收件人信息到订单（供推送工厂代发货）
router.post('/:id/save-receiver', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id, handler_id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: '订单不存在' });
  }
  if (req.user.role !== 'admin' && order.handler_id !== req.user.id) {
    return res.status(403).json({ message: '只能修改自己的订单' });
  }
  const name = String(req.body?.receiver_name || '');
  const phone = String(req.body?.receiver_phone || '');
  const address = String(req.body?.receiver_address || '');
  const raw = String(req.body?.receiver_raw || '');
  if (!name && !phone && !address && !raw) {
    return res.status(400).json({ message: '没有可保存的收件信息' });
  }
  db.prepare(`
    UPDATE orders SET
      receiver_name = CASE WHEN ? <> '' THEN ? ELSE receiver_name END,
      receiver_phone = CASE WHEN ? <> '' THEN ? ELSE receiver_phone END,
      receiver_address = CASE WHEN ? <> '' THEN ? ELSE receiver_address END,
      receiver_raw = ?
    WHERE id = ?
  `).run(name, name, phone, phone, address, address, raw, order.id);
  res.json({ message: '收件信息已保存到订单' });
});

// ===== 订单分类（成品/定制）=====

// 成品候选建议（按主图相同 / 标题关键词）
router.get('/:id/product-suggestions', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT product_name, main_image_url FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ message: '订单不存在' });

  const products = db.prepare("SELECT id, name, product_code, main_image, factory_id, factory_quote FROM factory_products WHERE status = 1").all();
  const title = String(order.product_name || '');
  const tokens = title.replace(/[，。、\/]/g, ' ').split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);

  const scored = products.map((p) => {
    let score = 0;
    if (order.main_image_url && p.main_image && order.main_image_url === p.main_image) score += 100;
    const pname = String(p.name || '');
    for (const tk of tokens) if (pname.includes(tk)) score += 2;
    return { ...p, score };
  }).sort((a, b) => b.score - a.score);

  res.json(scored);
});

// 归类为成品：建别名 + 套用 + 批量归类同商品历史单
router.post('/:id/classify', adminMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id, item_id, sku_id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ message: '订单不存在' });
  if (!order.item_id) return res.status(400).json({ message: '该订单缺少商品ID，无法归类' });

  const productId = Number(req.body?.product_id);
  const product = db.prepare('SELECT * FROM factory_products WHERE id = ? AND status = 1').get(productId);
  if (!product) return res.status(400).json({ message: '请选择有效的成品' });

  const skuId = order.sku_id || '';
  const exists = db.prepare('SELECT product_id FROM factory_product_aliases WHERE item_id = ? AND sku_id = ?').get(order.item_id, skuId);
  if (exists && exists.product_id !== productId) {
    return res.status(400).json({ message: '该商品ID已绑定到其他成品' });
  }
  if (!exists) {
    db.prepare('INSERT INTO factory_product_aliases (product_id, item_id, sku_id) VALUES (?, ?, ?)').run(productId, order.item_id, skuId);
  }
  const affected = reresolveOrdersByItem(db, order.item_id);
  res.json({ message: `已归类为成品，套用 ${affected} 个订单` });
});

// 标为定制（待确认 → 定制）
router.post('/:id/mark-custom', adminMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id, factory_product_id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ message: '订单不存在' });
  db.prepare("UPDATE orders SET order_category = 'custom', factory_product_id = 0 WHERE id = ?").run(order.id);
  res.json({ message: '已标为定制' });
});

// 存为成品：用当前订单的报价/素材/主图建成品 + 绑定该商品ID
router.post('/:id/save-as-product', adminMiddleware, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ message: '订单不存在' });
  if (!order.item_id) return res.status(400).json({ message: '该订单缺少商品ID，无法存为成品' });

  const name = String(req.body?.name || order.product_name || '未命名成品').trim();
  const productCode = String(req.body?.product_code || '');
  const quote = order.factory_quote > 0 ? order.factory_quote : order.cost;

  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO factory_products (name, product_code, main_image, factory_id, factory_quote, effect_images, base_images, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, productCode, order.main_image_url || '', order.factory_id || 0, quote,
      order.factory_effect_images || '[]', order.factory_base_images || '[]', '由订单存档',
    );
    const productId = r.lastInsertRowid;
    const exists = db.prepare('SELECT id FROM factory_product_aliases WHERE item_id = ? AND sku_id = ?').get(order.item_id, order.sku_id || '');
    if (!exists) {
      db.prepare('INSERT INTO factory_product_aliases (product_id, item_id, sku_id) VALUES (?, ?, ?)').run(productId, order.item_id, order.sku_id || '');
    }
    db.prepare("UPDATE orders SET factory_product_id = ?, order_category = 'finished' WHERE id = ?").run(productId, order.id);
    return productId;
  });
  const productId = tx();
  // 回溯归类同商品ID的其它订单（跨店铺/链接）
  reresolveOrdersByItem(db, order.item_id);
  res.status(201).json({ id: productId, message: '已存为成品，后续同商品自动套用' });
});

export default router;
