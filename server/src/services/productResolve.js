// 成品解析：按平台商品ID(item_id)+规格(sku_id) 命中内部成品(SPU)，
// 命中后自动归类订单并同步成本（"报价自动同步"的核心）。

// 命中成品：优先精确 sku 匹配，其次该商品通配(sku_id='')
export function resolveProductByItem(db, itemId, skuId = '') {
  const item = String(itemId || '');
  if (!item) return null;
  const sku = String(skuId || '');

  const alias = db.prepare(`
    SELECT a.product_id, a.sku_id
    FROM factory_product_aliases a
    WHERE a.item_id = ? AND (a.sku_id = ? OR a.sku_id = '')
    ORDER BY CASE WHEN a.sku_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(item, sku, sku);
  if (!alias) return null;

  return db.prepare("SELECT * FROM factory_products WHERE id = ? AND status = 1").get(alias.product_id) || null;
}

// 把成品套用到订单：写 product_id + 分类；订单未进入工厂流程时自动同步成本=成品报价
export function applyProductToOrder(db, orderId, product) {
  if (!product) return;
  const order = db.prepare("SELECT factory_status, cost FROM orders WHERE id = ?").get(orderId);
  if (!order) return;

  // 工厂协作未开始时才自动写成本，避免覆盖进行中的协作/人工改价
  const canSyncCost = !order.factory_status || order.factory_status === '';
  if (canSyncCost && product.factory_quote > 0) {
    db.prepare(`
      UPDATE orders SET factory_product_id = ?, order_category = 'finished', cost = ?
      WHERE id = ?
    `).run(product.id, product.factory_quote, orderId);
  } else {
    db.prepare(`
      UPDATE orders SET factory_product_id = ?, order_category = 'finished'
      WHERE id = ?
    `).run(product.id, orderId);
  }
}

// 新建别名后：把同 item_id 的历史订单批量归类并同步成本
export function reresolveOrdersByItem(db, itemId) {
  const item = String(itemId || '');
  if (!item) return 0;
  const orders = db.prepare("SELECT id, sku_id FROM orders WHERE item_id = ?").all(item);
  let count = 0;
  for (const o of orders) {
    const product = resolveProductByItem(db, item, o.sku_id);
    if (product) {
      applyProductToOrder(db, o.id, product);
      count += 1;
    }
  }
  return count;
}
