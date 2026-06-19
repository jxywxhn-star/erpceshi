import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb, UPLOADS_DIR } from '../db/init.js';
import { authMiddleware, factoryMiddleware } from '../middleware/auth.js';
import { buildZip } from '../services/zip.js';

const router = Router();

router.use(authMiddleware);
router.use(factoryMiddleware);

// 简化后的工厂流转：已推送(待发货) → 已发货
const FACTORY_VISIBLE_STATUSES = ['pushed', 'shipped'];

function selectFactoryOrder(db, id, factoryId) {
  return db.prepare(`
    SELECT o.*, s.name AS shop_name, s.platform AS shop_platform
    FROM orders o
    LEFT JOIN shops s ON o.shop_id = s.id
    WHERE o.id = ? AND o.factory_id = ?
  `).get(id, factoryId);
}

function parseImages(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const a = JSON.parse(value); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []; } catch { return []; }
}

// 我的推单列表
router.get('/orders', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  const params = [req.user.id, ...FACTORY_VISIBLE_STATUSES];
  let sql = `
    SELECT o.*, s.name AS shop_name, s.platform AS shop_platform
    FROM orders o
    LEFT JOIN shops s ON o.shop_id = s.id
    WHERE o.factory_id = ? AND o.factory_status IN (${FACTORY_VISIBLE_STATUSES.map(() => '?').join(',')})
  `;
  if (status && FACTORY_VISIBLE_STATUSES.includes(status)) {
    sql += ' AND o.factory_status = ?';
    params.push(status);
  }
  sql += ' ORDER BY COALESCE(o.factory_pushed_at, o.created_at) DESC';
  res.json({ list: db.prepare(sql).all(...params) });
});

// 各状态计数
router.get('/summary', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT factory_status, COUNT(*) AS count
    FROM orders WHERE factory_id = ? AND factory_status IN ('pushed','shipped')
    GROUP BY factory_status
  `).all(req.user.id);
  const summary = { pushed: 0, shipped: 0 };
  for (const r of rows) if (r.factory_status in summary) summary[r.factory_status] = r.count;
  res.json(summary);
});

// 发货并回传单号（自动同步到订单供应商单号）
router.post('/orders/:id/ship', (req, res) => {
  const db = getDb();
  const trackingNo = String(req.body?.tracking_no || '').trim();
  if (!trackingNo) return res.status(400).json({ message: '请填写物流单号' });

  const order = selectFactoryOrder(db, req.params.id, req.user.id);
  if (!order) return res.status(404).json({ message: '订单不存在或未推送给你' });
  if (order.factory_status !== 'pushed') {
    return res.status(400).json({ message: `当前状态不可发货（${order.factory_status || '未推送'}）` });
  }

  db.prepare(`
    UPDATE orders SET
      factory_status = 'shipped',
      factory_tracking_no = ?,
      supplier_tracking_no = ?,
      factory_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(trackingNo, trackingNo, order.id);
  res.json({ message: '已发货，单号已回传' });
});

// ===== 生产包一键下载 =====
function sanitizeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function packageDate(order) {
  const raw = order.platform_created_at || order.created_at || '';
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[2])}-${Number(m[3])}`;
  return '';
}

function skuText(order) {
  try {
    const j = JSON.parse(order.raw_json || '{}');
    const it = Array.isArray(j.Items) && j.Items[0] ? j.Items[0] : {};
    const t = it.SkuText;
    if (!t) return '';
    if (typeof t === 'string') return t;
    const color = t['颜色分类'] || t.color || '';
    const size = t['尺码'] || t.size || '';
    const qty = order.factory_quantity > 0 ? order.factory_quantity : order.quantity;
    if (color || size) return `${color}${color && size ? '：' : ''}${size}-${qty}件`;
    return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(' ');
  } catch { return ''; }
}

function extFromUrl(url, fallback) {
  const m = String(url).split('?')[0].match(/\.(jpg|jpeg|png|webp|gif)$/i);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}

async function fetchImageBytes(url) {
  try {
    if (!url) return null;
    if (url.startsWith('/uploads/')) {
      return readFileSync(join(UPLOADS_DIR, url.replace('/uploads/', '')));
    }
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
  } catch { /* ignore */ }
  return null;
}

router.get('/orders/:id/package', async (req, res) => {
  const db = getDb();
  const order = selectFactoryOrder(db, req.params.id, req.user.id);
  if (!order) return res.status(404).json({ message: '订单不存在或未推送给你' });

  const qty = order.factory_quantity > 0 ? order.factory_quantity : order.quantity;
  const receiver = order.receiver_name || '';
  const date = packageDate(order);
  const folder = sanitizeName(`${date} ${qty}件 ${receiver}--夏天`.trim()) || `订单${order.id}`;

  const recvLine = [order.receiver_name, order.receiver_phone, order.receiver_address || order.receiver_raw].filter(Boolean).join('，');
  const size = order.factory_size || skuText(order);
  const txt = `【款式】${order.factory_spec || ''}\r\n`
    + `【码数】${size}\r\n`
    + `合计：${qty}件\r\n`
    + `【印花】${order.factory_print || ''}\r\n`
    + '【快递】普快寄付\r\n'
    + `【收货人】${recvLine}\r\n`;

  const entries = [{ name: `${folder}/订单信息.txt`, data: Buffer.from(txt, 'utf8') }];

  const effect = parseImages(order.factory_effect_images);
  const base = parseImages(order.factory_base_images);
  let i = 1;
  for (const url of [order.main_image_url, ...effect]) {
    if (!url) continue;
    // eslint-disable-next-line no-await-in-loop
    const buf = await fetchImageBytes(url);
    if (buf) entries.push({ name: `${folder}/效果图${i}${extFromUrl(url, '.jpg')}`, data: buf });
    i += 1;
  }
  let b = 1;
  for (const url of base) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await fetchImageBytes(url);
    if (buf) entries.push({ name: `${folder}/底图${b}${extFromUrl(url, '.png')}`, data: buf });
    b += 1;
  }

  const zip = buildZip(entries);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`);
  res.send(zip);
});

export default router;
