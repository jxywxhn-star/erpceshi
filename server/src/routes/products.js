import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { reresolveOrdersByItem } from '../services/productResolve.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

function normalizeImageList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === 'string' && x.trim()).slice(0, 30);
}

// 成品库列表（含别名数、关联订单数、工厂名）
router.get('/', (req, res) => {
  const db = getDb();
  const list = db.prepare(`
    SELECT p.*,
      u.nickname AS factory_name,
      (SELECT COUNT(*) FROM factory_product_aliases a WHERE a.product_id = p.id) AS alias_count,
      (SELECT COUNT(*) FROM orders o WHERE o.factory_product_id = p.id) AS order_count
    FROM factory_products p
    LEFT JOIN users u ON p.factory_id = u.id
    ORDER BY p.id DESC
  `).all();
  const withAliases = list.map((p) => ({
    ...p,
    aliases: db.prepare('SELECT id, item_id, sku_id FROM factory_product_aliases WHERE product_id = ? ORDER BY id').all(p.id),
  }));
  res.json(withAliases);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, product_code, main_image, factory_id, factory_quote, effect_images, base_images, note } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: '请填写成品名称' });
  }
  const result = db.prepare(`
    INSERT INTO factory_products (name, product_code, main_image, factory_id, factory_quote, effect_images, base_images, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim(), String(product_code || ''), String(main_image || ''),
    Number(factory_id) || 0, Number(factory_quote) || 0,
    JSON.stringify(normalizeImageList(effect_images)), JSON.stringify(normalizeImageList(base_images)),
    String(note || ''),
  );
  res.status(201).json({ id: result.lastInsertRowid, message: '成品已创建' });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT id FROM factory_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ message: '成品不存在' });

  const { name, product_code, main_image, factory_id, factory_quote, effect_images, base_images, note, status } = req.body || {};
  db.prepare(`
    UPDATE factory_products SET
      name = ?, product_code = ?, main_image = ?, factory_id = ?, factory_quote = ?,
      effect_images = ?, base_images = ?, note = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    String(name || ''), String(product_code || ''), String(main_image || ''),
    Number(factory_id) || 0, Number(factory_quote) || 0,
    JSON.stringify(normalizeImageList(effect_images)), JSON.stringify(normalizeImageList(base_images)),
    String(note || ''), status === 0 ? 0 : 1, req.params.id,
  );

  // 改价后，同步刷新该成品下所有别名对应订单的成本
  const aliases = db.prepare('SELECT DISTINCT item_id FROM factory_product_aliases WHERE product_id = ?').all(req.params.id);
  for (const a of aliases) reresolveOrdersByItem(db, a.item_id);

  res.json({ message: '成品已更新' });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET factory_product_id = 0, order_category = '' WHERE factory_product_id = ?").run(req.params.id);
    db.prepare('DELETE FROM factory_product_aliases WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM factory_products WHERE id = ?').run(req.params.id);
  });
  tx();
  res.json({ message: '成品已删除' });
});

// 添加别名（绑定一个平台商品ID到该成品）
router.post('/:id/aliases', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT id FROM factory_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ message: '成品不存在' });

  const itemId = String(req.body?.item_id || '').trim();
  const skuId = String(req.body?.sku_id || '').trim();
  if (!itemId) return res.status(400).json({ message: '请填写商品ID' });

  const exists = db.prepare('SELECT id, product_id FROM factory_product_aliases WHERE item_id = ? AND sku_id = ?').get(itemId, skuId);
  if (exists && exists.product_id !== Number(req.params.id)) {
    return res.status(400).json({ message: '该商品ID已绑定到其他成品' });
  }
  if (!exists) {
    db.prepare('INSERT INTO factory_product_aliases (product_id, item_id, sku_id) VALUES (?, ?, ?)')
      .run(req.params.id, itemId, skuId);
  }
  const affected = reresolveOrdersByItem(db, itemId);
  res.status(201).json({ message: `已绑定，归类 ${affected} 个订单` });
});

router.delete('/aliases/:aliasId', (req, res) => {
  const db = getDb();
  const alias = db.prepare('SELECT item_id FROM factory_product_aliases WHERE id = ?').get(req.params.aliasId);
  db.prepare('DELETE FROM factory_product_aliases WHERE id = ?').run(req.params.aliasId);
  // 解绑后把该 item_id 的订单退回未分类
  if (alias?.item_id) {
    db.prepare("UPDATE orders SET factory_product_id = 0, order_category = '' WHERE item_id = ? AND COALESCE(factory_status,'') = ''").run(alias.item_id);
  }
  res.json({ message: '已解绑' });
});

export default router;
