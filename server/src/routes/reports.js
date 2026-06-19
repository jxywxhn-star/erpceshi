import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

const SHIPPING_DEADLINE_HOURS = 48;

function reportableOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, '')`;
  const text = orderTextSql(alias);

  return `NOT (
    ${status} IN ('unpaid', 'cancelled', 'closed')
    OR ${text} LIKE '%待付款%'
    OR ${text} LIKE '%未付款%'
    OR ${text} LIKE '%待支付%'
    OR ${text} LIKE '%等待付款%'
    OR ${text} LIKE '%等待买家付款%'
    OR ${text} LIKE '%买家未付款%'
    OR ${text} LIKE '%取消%'
    OR ${text} LIKE '%关闭%'
    OR ${text} LIKE '%作废%'
  )`;
}

function orderTextSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `(
    COALESCE(${prefix}platform_status, '') || ' ' ||
    COALESCE(${prefix}status_description, '')
  )`;
}

function completedOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, '')`;
  return `${status} = 'completed'`;
}

function unprocessedOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, '')`;
  return `${status} NOT IN ('completed', 'unpaid')`;
}

function unpaidOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, '')`;
  const text = orderTextSql(alias);
  return `(
    ${status} = 'unpaid'
    OR ${text} LIKE '%待付款%'
    OR ${text} LIKE '%未付款%'
    OR ${text} LIKE '%待支付%'
    OR ${text} LIKE '%等待付款%'
    OR ${text} LIKE '%等待买家付款%'
    OR ${text} LIKE '%买家未付款%'
  )`;
}

function workflowStatusSql(alias = '', value) {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, 'unprocessed')`;
  return `${status} = '${value}'`;
}

function unshippedOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const status = `COALESCE(${prefix}status, '')`;
  const text = orderTextSql(alias);
  return `NOT (
    ${status} IN ('unpaid', 'completed')
    OR COALESCE(${prefix}tracking_no, '') <> ''
    OR ${text} LIKE '%已出库%'
    OR ${text} LIKE '%已发货%'
    OR ${text} LIKE '%待买家确认%'
    OR ${text} LIKE '%待收货%'
    OR ${text} LIKE '%已完成%'
    OR ${text} LIKE '%完成%'
    OR ${text} LIKE '%成功%'
    OR ${text} LIKE '%签收%'
    OR ${text} LIKE '%取消%'
    OR ${text} LIKE '%关闭%'
    OR ${text} LIKE '%退款%'
    OR ${text} LIKE '%售后%'
  )`;
}

function orderTimeSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const value = `COALESCE(NULLIF(${prefix}platform_created_at, ''), ${prefix}created_at)`;
  return `CASE
    WHEN ${value} IS NULL OR ${value} = '' THEN NULL
    WHEN length(${value}) = 13 AND ${value} NOT GLOB '*[^0-9]*' THEN datetime(CAST(${value} AS INTEGER) / 1000, 'unixepoch')
    WHEN length(${value}) = 10 AND ${value} NOT GLOB '*[^0-9]*' THEN datetime(CAST(${value} AS INTEGER), 'unixepoch')
    ELSE datetime(replace(${value}, 'T', ' '))
  END`;
}

function shippingDeadlineSql(alias = '') {
  return `datetime(${orderTimeSql(alias)}, '+${SHIPPING_DEADLINE_HOURS} hours')`;
}

function shippingActionableOrderSql(alias = '') {
  return `(
    ${reportableOrderSql(alias)}
    AND ${unshippedOrderSql(alias)}
    AND ${orderTimeSql(alias)} IS NOT NULL
  )`;
}

function overdueShippingOrderSql(alias = '') {
  return `(
    ${shippingActionableOrderSql(alias)}
    AND ${shippingDeadlineSql(alias)} < datetime('now')
  )`;
}

function dueSoonShippingOrderSql(alias = '') {
  return `(
    ${shippingActionableOrderSql(alias)}
    AND ${shippingDeadlineSql(alias)} >= datetime('now')
    AND ${shippingDeadlineSql(alias)} <= datetime('now', '+6 hours')
  )`;
}

router.get('/overview', (req, res) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let dateFilter = '';
  const params = [];

  if (req.user.role !== 'admin') {
    dateFilter += ' AND handler_id = ?';
    params.push(req.user.id);
  }
  if (start_date) {
    dateFilter += ' AND DATE(created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    dateFilter += ' AND DATE(created_at) <= ?';
    params.push(end_date);
  }

  const orderStats = db.prepare(`
    SELECT
      COUNT(*) as order_count,
      COALESCE(SUM(price), 0) as total_sales,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(refund_amount), 0) as total_refund,
      COALESCE(SUM(CASE WHEN ${completedOrderSql()} THEN 1 ELSE 0 END), 0) as completed_order_count,
      COALESCE(SUM(CASE WHEN ${unprocessedOrderSql()} THEN 1 ELSE 0 END), 0) as unprocessed_order_count,
      COALESCE(SUM(CASE WHEN ${workflowStatusSql('', 'ordered_not_uploaded')} THEN 1 ELSE 0 END), 0) as ordered_not_uploaded_count,
      COALESCE(SUM(CASE WHEN ${workflowStatusSql('', 'ordered_waiting_tracking')} THEN 1 ELSE 0 END), 0) as ordered_waiting_tracking_count,
      COALESCE(SUM(CASE WHEN ${overdueShippingOrderSql()} THEN 1 ELSE 0 END), 0) as shipping_overdue_count,
      COALESCE(SUM(CASE WHEN ${dueSoonShippingOrderSql()} THEN 1 ELSE 0 END), 0) as shipping_due_soon_count
    FROM orders WHERE 1=1 ${dateFilter} AND ${reportableOrderSql()}
  `).get(...params);

  const unpaidStats = db.prepare(`
    SELECT COUNT(*) as unpaid_order_count
    FROM orders WHERE 1=1 ${dateFilter} AND ${unpaidOrderSql()}
  `).get(...params);

  const expenseParams = [];
  let expenseFilter = '';
  if (req.user.role !== 'admin') {
    expenseFilter += ' AND handler_id = ?';
    expenseParams.push(req.user.id);
  }
  if (start_date) {
    expenseFilter += ' AND created_at >= ?';
    expenseParams.push(start_date);
  }
  if (end_date) {
    expenseFilter += ' AND created_at <= ?';
    expenseParams.push(end_date + ' 23:59:59');
  }

  const expenseStats = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses WHERE 1=1 ${expenseFilter}
  `).get(...expenseParams);

  const totalProfit = orderStats.total_sales - orderStats.total_refund - orderStats.total_cost - expenseStats.total_expenses;

  res.json({
    order_count: orderStats.order_count,
    total_sales: orderStats.total_sales,
    total_cost: orderStats.total_cost,
    total_refund: orderStats.total_refund,
    total_expenses: expenseStats.total_expenses,
    total_profit: totalProfit,
    completed_order_count: orderStats.completed_order_count,
    unprocessed_order_count: orderStats.unprocessed_order_count,
    ordered_not_uploaded_count: orderStats.ordered_not_uploaded_count,
    ordered_waiting_tracking_count: orderStats.ordered_waiting_tracking_count,
    unpaid_order_count: unpaidStats.unpaid_order_count,
    shipping_overdue_count: orderStats.shipping_overdue_count,
    shipping_due_soon_count: orderStats.shipping_due_soon_count,
  });
});

router.get('/by-shop', (req, res) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let dateFilter = '';
  const params = [];

  if (start_date) {
    dateFilter += ' AND DATE(o.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    dateFilter += ' AND DATE(o.created_at) <= ?';
    params.push(end_date);
  }

  let handlerFilter = '';
  if (req.user.role !== 'admin') {
    handlerFilter = ' AND o.handler_id = ?';
    params.push(req.user.id);
  }

  const shopStats = db.prepare(`
    SELECT
      s.id as shop_id, s.name as shop_name,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} THEN 1 ELSE 0 END) as order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${unpaidOrderSql('o')} THEN 1 ELSE 0 END) as unpaid_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${overdueShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_overdue_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${dueSoonShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_due_soon_count,
      COALESCE(SUM(CASE WHEN ${reportableOrderSql('o')} THEN o.price ELSE 0 END), 0) as total_sales,
      COALESCE(SUM(CASE WHEN ${reportableOrderSql('o')} THEN o.cost ELSE 0 END), 0) as total_cost,
      COALESCE(SUM(CASE WHEN ${reportableOrderSql('o')} THEN o.refund_amount ELSE 0 END), 0) as total_refund
    FROM shops s
    LEFT JOIN orders o ON s.id = o.shop_id ${dateFilter} ${handlerFilter}
    WHERE s.status = 1
    GROUP BY s.id
    ORDER BY total_sales DESC
  `).all(...params);

  res.json(shopStats);
});

router.get('/shop-daily', (req, res) => {
  const db = getDb();
  const { start_date, end_date, shop_id, group_by = 'shop' } = req.query;

  let orderFilter = '';
  const orderParams = [];

  if (start_date) {
    orderFilter += ' AND DATE(o.created_at) >= ?';
    orderParams.push(start_date);
  }
  if (end_date) {
    orderFilter += ' AND DATE(o.created_at) <= ?';
    orderParams.push(end_date);
  }
  if (req.user.role !== 'admin') {
    orderFilter += ' AND o.handler_id = ?';
    orderParams.push(req.user.id);
  }

  if (group_by === 'date') {
    let dateFilter = orderFilter;
    const params = [...orderParams];

    if (shop_id) {
      dateFilter += ' AND o.shop_id = ?';
      params.push(shop_id);
    }

    const rows = db.prepare(`
      SELECT
        DATE(o.created_at) as date,
        s.id as shop_id,
        s.name as shop_name,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} THEN 1 ELSE 0 END) as sold_order_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${completedOrderSql('o')} THEN 1 ELSE 0 END) as completed_order_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${unshippedOrderSql('o')} THEN 1 ELSE 0 END) as unshipped_order_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${unprocessedOrderSql('o')} THEN 1 ELSE 0 END) as unprocessed_order_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${workflowStatusSql('o', 'ordered_not_uploaded')} THEN 1 ELSE 0 END) as ordered_not_uploaded_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${workflowStatusSql('o', 'ordered_waiting_tracking')} THEN 1 ELSE 0 END) as ordered_waiting_tracking_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${unpaidOrderSql('o')} THEN 1 ELSE 0 END) as unpaid_order_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${overdueShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_overdue_count,
        SUM(CASE WHEN o.id IS NOT NULL AND ${dueSoonShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_due_soon_count,
        COALESCE(SUM(CASE WHEN ${reportableOrderSql('o')} THEN o.price ELSE 0 END), 0) as total_sales
      FROM orders o
      LEFT JOIN shops s ON o.shop_id = s.id
      WHERE 1=1 ${dateFilter}
      GROUP BY DATE(o.created_at), s.id
      ORDER BY date DESC, sold_order_count DESC, s.id DESC
    `).all(...params);

    return res.json(rows);
  }

  let shopFilter = 'WHERE s.status = 1';
  const shopParams = [];
  if (shop_id) {
    shopFilter += ' AND s.id = ?';
    shopParams.push(shop_id);
  }

  const rows = db.prepare(`
    SELECT
      s.id as shop_id,
      s.name as shop_name,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} THEN 1 ELSE 0 END) as sold_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${completedOrderSql('o')} THEN 1 ELSE 0 END) as completed_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${unshippedOrderSql('o')} THEN 1 ELSE 0 END) as unshipped_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${unprocessedOrderSql('o')} THEN 1 ELSE 0 END) as unprocessed_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${workflowStatusSql('o', 'ordered_not_uploaded')} THEN 1 ELSE 0 END) as ordered_not_uploaded_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${reportableOrderSql('o')} AND ${workflowStatusSql('o', 'ordered_waiting_tracking')} THEN 1 ELSE 0 END) as ordered_waiting_tracking_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${unpaidOrderSql('o')} THEN 1 ELSE 0 END) as unpaid_order_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${overdueShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_overdue_count,
      SUM(CASE WHEN o.id IS NOT NULL AND ${dueSoonShippingOrderSql('o')} THEN 1 ELSE 0 END) as shipping_due_soon_count,
      COALESCE(SUM(CASE WHEN ${reportableOrderSql('o')} THEN o.price ELSE 0 END), 0) as total_sales,
      MAX(o.created_at) as last_order_at
    FROM shops s
    LEFT JOIN orders o ON s.id = o.shop_id ${orderFilter}
    ${shopFilter}
    GROUP BY s.id
    ORDER BY unprocessed_order_count DESC, unshipped_order_count DESC, sold_order_count DESC, s.id DESC
  `).all(...orderParams, ...shopParams);

  res.json(rows);
});

router.get('/by-handler', adminMiddleware, (req, res) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let dateFilter = '';
  const params = [];

  if (start_date) {
    dateFilter += ' AND DATE(o.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    dateFilter += ' AND DATE(o.created_at) <= ?';
    params.push(end_date);
  }

  const handlerStats = db.prepare(`
    SELECT
      u.id as handler_id, u.nickname as handler_name,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.price), 0) as total_sales,
      COALESCE(SUM(o.cost), 0) as total_cost,
      COALESCE(SUM(o.refund_amount), 0) as total_refund
    FROM users u
    LEFT JOIN orders o ON u.id = o.handler_id AND ${reportableOrderSql('o')} ${dateFilter}
    WHERE u.status = 1
    GROUP BY u.id
    ORDER BY total_sales DESC
  `).all(...params);

  res.json(handlerStats);
});

router.get('/daily', (req, res) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let dateFilter = '';
  const params = [];

  if (req.user.role !== 'admin') {
    dateFilter += ' AND handler_id = ?';
    params.push(req.user.id);
  }
  if (start_date) {
    dateFilter += ' AND DATE(created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    dateFilter += ' AND DATE(created_at) <= ?';
    params.push(end_date);
  }

  const dailyStats = db.prepare(`
    SELECT
      DATE(created_at) as date,
      COUNT(*) as order_count,
      COALESCE(SUM(price), 0) as total_sales,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(refund_amount), 0) as total_refund
    FROM orders WHERE 1=1 ${dateFilter} AND ${reportableOrderSql()}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(...params);

  res.json(dailyStats);
});

export default router;
