import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const db = getDb();
  const { shop_id, category, start_date, end_date, page = 1, pageSize = 20 } = req.query;

  let sql = `
    SELECT e.*, s.name as shop_name, u.nickname as handler_name
    FROM expenses e
    LEFT JOIN shops s ON e.shop_id = s.id
    LEFT JOIN users u ON e.handler_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.role !== 'admin') {
    sql += ' AND e.handler_id = ?';
    params.push(req.user.id);
  }

  if (shop_id) {
    sql += ' AND e.shop_id = ?';
    params.push(shop_id);
  }
  if (category) {
    sql += ' AND e.category = ?';
    params.push(category);
  }
  if (start_date) {
    sql += ' AND e.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND e.created_at <= ?';
    params.push(end_date + ' 23:59:59');
  }

  const countSql = sql.replace(
    'SELECT e.*, s.name as shop_name, u.nickname as handler_name',
    'SELECT COUNT(*) as total'
  );
  const { total } = db.prepare(countSql).get(...params);

  sql += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const expenses = db.prepare(sql).all(...params);

  res.json({ list: expenses, total, page: Number(page), pageSize: Number(pageSize) });
});

router.post('/', (req, res) => {
  const { shop_id, category, amount, description } = req.body;
  if (!shop_id || !amount) {
    return res.status(400).json({ message: '店铺和金额不能为空' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO expenses (shop_id, category, amount, description, handler_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(shop_id, category || 'other', amount, description || '', req.user.id);

  res.status(201).json({ id: result.lastInsertRowid, message: '开支记录创建成功' });
});

router.put('/:id', (req, res) => {
  const { shop_id, category, amount, description } = req.body;
  const db = getDb();

  if (req.user.role !== 'admin') {
    const expense = db.prepare('SELECT handler_id FROM expenses WHERE id = ?').get(req.params.id);
    if (!expense || expense.handler_id !== req.user.id) {
      return res.status(403).json({ message: '只能修改自己的记录' });
    }
  }

  db.prepare(`
    UPDATE expenses SET shop_id = ?, category = ?, amount = ?, description = ? WHERE id = ?
  `).run(shop_id, category || 'other', amount, description || '', req.params.id);

  res.json({ message: '开支记录更新成功' });
});

router.delete('/:id', (req, res) => {
  const db = getDb();

  if (req.user.role !== 'admin') {
    const expense = db.prepare('SELECT handler_id FROM expenses WHERE id = ?').get(req.params.id);
    if (!expense || expense.handler_id !== req.user.id) {
      return res.status(403).json({ message: '只能删除自己的记录' });
    }
  }

  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ message: '开支记录删除成功' });
});

export default router;
