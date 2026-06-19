import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/init.js';
import { JWT_SECRET, authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: '请输入用户名和密码' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND status = 1').get(username);

  if (!user) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, nickname: user.nickname },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    },
  });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      nickname: req.user.nickname,
      role: req.user.role,
    },
  });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.id;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: '参数不完整' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: '新密码长度不能少于6位' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }

  const valid = bcrypt.compareSync(oldPassword, user.password);
  if (!valid) {
    return res.status(401).json({ message: '原密码错误' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

  res.json({ message: '密码修改成功' });
});

export default router;
