import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', adminMiddleware, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, nickname, role, status, created_at FROM users ORDER BY id DESC
  `).all();
  res.json(users);
});

router.post('/', adminMiddleware, (req, res) => {
  const { username, password, nickname, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码不能为空' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)'
  ).run(username, hashedPassword, nickname || username, role || 'operator');

  res.status(201).json({ id: result.lastInsertRowid, message: '用户创建成功' });
});

router.put('/:id', adminMiddleware, (req, res) => {
  const { nickname, role, status, password } = req.body;
  const db = getDb();

  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare(
      'UPDATE users SET nickname = ?, role = ?, status = ?, password = ? WHERE id = ?'
    ).run(nickname, role, status !== undefined ? status : 1, hashedPassword, req.params.id);
  } else {
    db.prepare(
      'UPDATE users SET nickname = ?, role = ?, status = ? WHERE id = ?'
    ).run(nickname, role, status !== undefined ? status : 1, req.params.id);
  }

  res.json({ message: '用户更新成功' });
});

router.delete('/:id', adminMiddleware, (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ message: '不能删除自己的账号' });
  }

  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: '用户删除成功' });
});

export default router;
